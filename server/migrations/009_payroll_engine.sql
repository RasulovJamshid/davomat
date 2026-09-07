ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 12 CHECK(tax_rate BETWEEN 0 AND 100);

CREATE OR REPLACE FUNCTION recalculate_payroll_period(target_company uuid,target_period uuid,configured_tax_rate numeric)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  UPDATE payroll_periods SET tax_rate=configured_tax_rate WHERE id=target_period AND company_id=target_company AND status<>'PAID';

  WITH period AS (
    SELECT starts_on,ends_on FROM payroll_periods WHERE id=target_period AND company_id=target_company AND status<>'PAID'
  ), employee_time AS (
    SELECT e.id,e.base_salary,e.hourly_rate,
      COALESCE((SELECT round(sum(e.base_salary::numeric/(SELECT count(*) FROM generate_series(date_trunc('month',d.day)::date,(date_trunc('month',d.day)+interval '1 month'-interval '1 day')::date,interval '1 day') md WHERE extract(isodow FROM md)<6)))::bigint
        FROM generate_series(p.starts_on,p.ends_on,interval '1 day') d(day)
        WHERE extract(isodow FROM d.day)<6 AND (e.joined_on IS NULL OR d.day::date>=e.joined_on)
          AND NOT EXISTS(SELECT 1 FROM leave_requests lr WHERE lr.company_id=target_company AND lr.employee_id=e.id AND lr.status='APPROVED' AND lr.leave_type='UNPAID' AND d.day::date BETWEEN lr.starts_on AND lr.ends_on)),0) AS prorated_base,
      COALESCE((SELECT sum(GREATEST(0,extract(epoch FROM(s.ends_at-s.starts_at))/60-s.unpaid_break_minutes))::int FROM shifts s WHERE s.company_id=target_company AND s.employee_id=e.id AND s.status<>'CANCELLED' AND (s.starts_at AT TIME ZONE c.timezone)::date BETWEEN p.starts_on AND p.ends_on),0) AS expected_minutes,
      COALESCE((SELECT sum(GREATEST(0,extract(epoch FROM(pout.occurred_at-pin.occurred_at))/60-
        COALESCE((SELECT sum(extract(epoch FROM(be.occurred_at-bs.occurred_at))/60) FROM punches bs JOIN LATERAL(SELECT occurred_at FROM punches bx WHERE bx.shift_id=s.id AND bx.event_type='BREAK_END' AND bx.occurred_at>bs.occurred_at ORDER BY bx.occurred_at LIMIT 1)be ON true WHERE bs.shift_id=s.id AND bs.event_type='BREAK_START'),0)))::int
        FROM shifts s JOIN LATERAL(SELECT occurred_at FROM punches WHERE shift_id=s.id AND event_type='CLOCK_IN' ORDER BY occurred_at LIMIT 1)pin ON true
        JOIN LATERAL(SELECT occurred_at FROM punches WHERE shift_id=s.id AND event_type='CLOCK_OUT' ORDER BY occurred_at DESC LIMIT 1)pout ON true
        WHERE s.company_id=target_company AND s.employee_id=e.id AND s.status<>'CANCELLED' AND (s.starts_at AT TIME ZONE c.timezone)::date BETWEEN p.starts_on AND p.ends_on),0) AS worked_minutes,
      EXISTS(SELECT 1 FROM attendance_exceptions x LEFT JOIN shifts xs ON xs.id=x.shift_id WHERE x.employee_id=e.id AND x.company_id=target_company AND x.status='PENDING' AND COALESCE((xs.starts_at AT TIME ZONE c.timezone)::date,x.created_at::date) BETWEEN p.starts_on AND p.ends_on) AS has_issue
    FROM employees e JOIN companies c ON c.id=e.company_id CROSS JOIN period p WHERE e.company_id=target_company AND e.status IN('ACTIVE','ON_LEAVE')
  ), calculated AS (
    SELECT *,GREATEST(0,worked_minutes-expected_minutes)::int AS overtime_minutes FROM employee_time
  ), upserted AS (
    INSERT INTO payslips(company_id,payroll_period_id,employee_id,base_salary,overtime_minutes,overtime_pay,bonuses,deductions,tax,gross_pay,net_pay,status,attendance_issue)
    SELECT target_company,target_period,id,prorated_base,overtime_minutes,round(overtime_minutes/60.0*hourly_rate)::bigint,0,0,
      round((prorated_base+overtime_minutes/60.0*hourly_rate)*configured_tax_rate/100.0)::bigint,
      round(prorated_base+overtime_minutes/60.0*hourly_rate)::bigint,
      GREATEST(0,round((prorated_base+overtime_minutes/60.0*hourly_rate)*(1-configured_tax_rate/100.0))::bigint),
      CASE WHEN has_issue THEN 'REVIEW' ELSE 'READY' END,CASE WHEN has_issue THEN 'Attendance exceptions require review' ELSE NULL END
    FROM calculated
    ON CONFLICT(payroll_period_id,employee_id) DO UPDATE SET base_salary=excluded.base_salary,overtime_minutes=excluded.overtime_minutes,overtime_pay=excluded.overtime_pay,
      tax=round((excluded.gross_pay+payslips.bonuses)*configured_tax_rate/100.0)::bigint,gross_pay=excluded.gross_pay+payslips.bonuses,
      net_pay=GREATEST(0,excluded.gross_pay+payslips.bonuses-round((excluded.gross_pay+payslips.bonuses)*configured_tax_rate/100.0)::bigint-payslips.deductions),
      status=excluded.status,attendance_issue=excluded.attendance_issue,updated_at=now()
    WHERE payslips.status NOT IN('APPROVED','PAID') RETURNING id
  ) SELECT count(*) INTO affected FROM upserted;
  RETURN affected;
END $$;

CREATE OR REPLACE FUNCTION normalize_payslip_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rate numeric;
BEGIN
  SELECT tax_rate INTO rate FROM payroll_periods WHERE id=NEW.payroll_period_id;
  NEW.gross_pay=NEW.base_salary+NEW.overtime_pay+NEW.bonuses;
  NEW.tax=round(NEW.gross_pay*COALESCE(rate,12)/100.0)::bigint;
  NEW.net_pay=GREATEST(0,NEW.gross_pay-NEW.tax-NEW.deductions);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_normalize_payslip_totals ON payslips;
CREATE TRIGGER trg_normalize_payslip_totals BEFORE INSERT OR UPDATE OF base_salary,overtime_pay,bonuses,deductions,gross_pay ON payslips FOR EACH ROW EXECUTE FUNCTION normalize_payslip_totals();
