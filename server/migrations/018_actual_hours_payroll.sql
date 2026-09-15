CREATE OR REPLACE FUNCTION recalculate_payroll_period(target_company uuid,target_period uuid,configured_tax_rate numeric)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  UPDATE payroll_periods SET tax_rate=configured_tax_rate WHERE id=target_period AND company_id=target_company AND status<>'PAID';
  INSERT INTO payroll_rules(company_id) VALUES(target_company) ON CONFLICT DO NOTHING;

  WITH period AS (
    SELECT starts_on,ends_on FROM payroll_periods WHERE id=target_period AND company_id=target_company AND status<>'PAID'
  ), policy AS (
    SELECT * FROM payroll_rules WHERE company_id=target_company
  ), people AS (
    SELECT e.id,e.joined_on,e.salary_type,
      COALESCE((SELECT rh.base_salary FROM employee_rate_history rh CROSS JOIN period p WHERE rh.employee_id=e.id AND rh.effective_from<=p.ends_on ORDER BY rh.effective_from DESC LIMIT 1),e.base_salary) AS base_salary,
      COALESCE((SELECT rh.hourly_rate FROM employee_rate_history rh CROSS JOIN period p WHERE rh.employee_id=e.id AND rh.effective_from<=p.ends_on ORDER BY rh.effective_from DESC LIMIT 1),e.hourly_rate) AS hourly_rate
    FROM employees e WHERE e.company_id=target_company AND e.status IN('ACTIVE','ON_LEAVE')
  ), actual_shift AS (
    SELECT s.employee_id,s.id,s.starts_at,s.ends_at,pin.occurred_at AS clock_in,pout.occurred_at AS clock_out,
      GREATEST(0,extract(epoch FROM(pout.occurred_at-pin.occurred_at))/60-
        COALESCE((SELECT sum(extract(epoch FROM(be.occurred_at-bs.occurred_at))/60) FROM punches bs JOIN LATERAL(SELECT occurred_at FROM punches bx WHERE bx.shift_id=s.id AND bx.event_type='BREAK_END' AND bx.occurred_at>bs.occurred_at ORDER BY bx.occurred_at LIMIT 1)be ON true WHERE bs.shift_id=s.id AND bs.event_type='BREAK_START'),0))::int AS worked_minutes
    FROM shifts s CROSS JOIN period p JOIN companies c ON c.id=s.company_id
    JOIN LATERAL(SELECT occurred_at FROM punches WHERE shift_id=s.id AND event_type='CLOCK_IN' ORDER BY occurred_at LIMIT 1)pin ON true
    JOIN LATERAL(SELECT occurred_at FROM punches WHERE shift_id=s.id AND event_type='CLOCK_OUT' ORDER BY occurred_at DESC LIMIT 1)pout ON true
    WHERE s.company_id=target_company AND s.status<>'CANCELLED' AND (s.starts_at AT TIME ZONE c.timezone)::date BETWEEN p.starts_on AND p.ends_on
  ), shift_special AS (
    SELECT a.*,
      CASE WHEN EXISTS(SELECT 1 FROM holidays h JOIN companies c ON c.id=h.company_id WHERE h.company_id=target_company AND h.holiday_date=(a.starts_at AT TIME ZONE c.timezone)::date) THEN a.worked_minutes ELSE 0 END AS holiday_minutes,
      COALESCE((SELECT sum(GREATEST(0,extract(epoch FROM(LEAST(a.clock_out,(d.day+pr.night_ends_at+interval '1 day') AT TIME ZONE c.timezone)-GREATEST(a.clock_in,(d.day+pr.night_starts_at) AT TIME ZONE c.timezone)))/60))::int
        FROM policy pr JOIN companies c ON c.id=target_company
        CROSS JOIN generate_series((a.clock_in AT TIME ZONE c.timezone)::date-1,(a.clock_out AT TIME ZONE c.timezone)::date,interval '1 day') d(day)
        WHERE LEAST(a.clock_out,(d.day+pr.night_ends_at+interval '1 day') AT TIME ZONE c.timezone)>GREATEST(a.clock_in,(d.day+pr.night_starts_at) AT TIME ZONE c.timezone)),0) AS night_minutes
    FROM actual_shift a
  ), employee_time AS (
    SELECT e.id,e.base_salary,e.hourly_rate,
      COALESCE(w.salary,0)::bigint AS prorated_base,
      COALESCE(w.expected_minutes,0)::int AS expected_minutes,
      COALESCE(w.worked_minutes,0)::int AS worked_minutes,
      e.salary_type,
      COALESCE((SELECT sum(night_minutes)::int FROM shift_special x WHERE x.employee_id=e.id),0) AS night_minutes,
      COALESCE((SELECT sum(holiday_minutes)::int FROM shift_special x WHERE x.employee_id=e.id),0) AS holiday_minutes,
      COALESCE((SELECT sum(b.amount)::bigint FROM employee_benefits b CROSS JOIN period p WHERE b.employee_id=e.id AND b.active=true AND COALESCE(b.starts_on,p.starts_on)<=p.ends_on AND COALESCE(b.ends_on,p.ends_on)>=p.starts_on),0) AS benefits,
      COALESCE((SELECT sum(b.amount)::bigint FROM employee_benefits b CROSS JOIN period p WHERE b.employee_id=e.id AND b.active=true AND b.taxable=true AND COALESCE(b.starts_on,p.starts_on)<=p.ends_on AND COALESCE(b.ends_on,p.ends_on)>=p.starts_on),0) AS taxable_benefits,
      EXISTS(SELECT 1 FROM attendance_exceptions x LEFT JOIN shifts xs ON xs.id=x.shift_id JOIN companies c ON c.id=x.company_id CROSS JOIN period p WHERE x.employee_id=e.id AND x.company_id=target_company AND x.status='PENDING' AND COALESCE((xs.starts_at AT TIME ZONE c.timezone)::date,x.created_at::date) BETWEEN p.starts_on AND p.ends_on) AS has_issue
    FROM people e CROSS JOIN period p LEFT JOIN LATERAL workforce_summary(target_company,p.starts_on,p.ends_on) w ON w.employee_id=e.id
  ), calculated AS (
    SELECT e.*,GREATEST(0,worked_minutes-expected_minutes)::int AS overtime_minutes,
      round(GREATEST(0,worked_minutes-expected_minutes)/60.0*hourly_rate*(CASE WHEN salary_type='HOURLY' THEN GREATEST(0,pr.overtime_multiplier-1) ELSE pr.overtime_multiplier END))::bigint AS overtime_pay,
      round(night_minutes/60.0*hourly_rate*(pr.night_multiplier-1))::bigint AS night_pay,
      round(holiday_minutes/60.0*hourly_rate*(pr.holiday_multiplier-1))::bigint AS holiday_pay,
      pr.pension_rate,pr.social_tax_rate,pr.overtime_multiplier,pr.night_multiplier,pr.holiday_multiplier
    FROM employee_time e CROSS JOIN policy pr
  ), values_to_save AS (
    SELECT c.*,
      COALESCE((SELECT sum(amount) FROM payroll_adjustments a JOIN payslips oldp ON oldp.id=a.payslip_id WHERE oldp.payroll_period_id=target_period AND oldp.employee_id=c.id AND a.adjustment_type='BONUS'),0)::bigint AS manual_bonus,
      COALESCE((SELECT sum(amount) FROM payroll_adjustments a JOIN payslips oldp ON oldp.id=a.payslip_id WHERE oldp.payroll_period_id=target_period AND oldp.employee_id=c.id AND a.adjustment_type='DEDUCTION'),0)::bigint AS manual_deduction
    FROM calculated c
  ), upserted AS (
    INSERT INTO payslips(company_id,payroll_period_id,employee_id,base_salary,overtime_minutes,overtime_pay,night_minutes,night_pay,holiday_minutes,holiday_pay,benefits,bonuses,deductions,tax,gross_pay,net_pay,employer_contributions,status,attendance_issue,calculation_breakdown)
    SELECT target_company,target_period,id,prorated_base,overtime_minutes,overtime_pay,night_minutes,night_pay,holiday_minutes,holiday_pay,benefits,manual_bonus,
      manual_deduction+round((prorated_base+overtime_pay+night_pay+holiday_pay+taxable_benefits+manual_bonus)*pension_rate/100.0)::bigint,
      round((prorated_base+overtime_pay+night_pay+holiday_pay+taxable_benefits+manual_bonus)*configured_tax_rate/100.0)::bigint,
      prorated_base+overtime_pay+night_pay+holiday_pay+benefits+manual_bonus,
      GREATEST(0,prorated_base+overtime_pay+night_pay+holiday_pay+benefits+manual_bonus-round((prorated_base+overtime_pay+night_pay+holiday_pay+taxable_benefits+manual_bonus)*configured_tax_rate/100.0)::bigint-manual_deduction-round((prorated_base+overtime_pay+night_pay+holiday_pay+taxable_benefits+manual_bonus)*pension_rate/100.0)::bigint),
      round((prorated_base+overtime_pay+night_pay+holiday_pay+taxable_benefits+manual_bonus)*social_tax_rate/100.0)::bigint,
      CASE WHEN has_issue THEN 'REVIEW' ELSE 'READY' END,CASE WHEN has_issue THEN 'Attendance exceptions require review' ELSE NULL END,
      jsonb_build_object('hourlyRate',hourly_rate,'workedMinutes',worked_minutes,'expectedMinutes',expected_minutes,'taxableBenefits',taxable_benefits,'overtimeMultiplier',overtime_multiplier,'nightMultiplier',night_multiplier,'holidayMultiplier',holiday_multiplier,'taxRate',configured_tax_rate,'pensionRate',pension_rate,'socialTaxRate',social_tax_rate)
    FROM values_to_save
    ON CONFLICT(payroll_period_id,employee_id) DO UPDATE SET base_salary=excluded.base_salary,overtime_minutes=excluded.overtime_minutes,overtime_pay=excluded.overtime_pay,night_minutes=excluded.night_minutes,night_pay=excluded.night_pay,holiday_minutes=excluded.holiday_minutes,holiday_pay=excluded.holiday_pay,benefits=excluded.benefits,bonuses=excluded.bonuses,deductions=excluded.deductions,tax=excluded.tax,gross_pay=excluded.gross_pay,net_pay=excluded.net_pay,employer_contributions=excluded.employer_contributions,status=excluded.status,attendance_issue=excluded.attendance_issue,calculation_breakdown=excluded.calculation_breakdown,updated_at=now()
    WHERE payslips.status NOT IN('APPROVED','PAID') RETURNING id
  ) SELECT count(*) INTO affected FROM upserted;
  RETURN affected;
END $$;

