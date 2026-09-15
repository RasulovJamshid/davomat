CREATE TABLE employee_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  due_at timestamptz NOT NULL,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH')),
  status text NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','IN_PROGRESS','DONE')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX employee_tasks_company_employee ON employee_tasks(company_id,employee_id,status);
ALTER TABLE punches DROP CONSTRAINT punches_source_check;
ALTER TABLE punches ADD CONSTRAINT punches_source_check CHECK(source IN ('WEB','MOBILE','KIOSK','TURNSTILE','MANUAL','QR'));

-- One row per employee; attendance and task aggregates are independent to avoid fan-out.
CREATE FUNCTION workforce_summary(target_company uuid, date_from date, date_to date)
RETURNS TABLE(employee_id uuid, employee text, salary_type text, scheduled_days bigint,
  worked_days bigint, expected_minutes numeric, worked_minutes numeric, late_days bigint,
  absent_days bigint, overtime_minutes numeric, completed_tasks bigint, salary numeric)
LANGUAGE sql STABLE AS $$
WITH sequenced AS (
 SELECT p.*,c.timezone,(s.starts_at AT TIME ZONE c.timezone)::date AS shift_day,
 max(p.occurred_at) FILTER(WHERE p.event_type='CLOCK_IN') OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS session_start,
 lead(p.event_type) OVER w AS next_type,lead(p.occurred_at) OVER w AS next_at
 FROM punches p JOIN companies c ON c.id=p.company_id LEFT JOIN shifts s ON s.id=p.shift_id
 WHERE p.company_id=target_company
 WINDOW w AS (PARTITION BY p.employee_id ORDER BY p.occurred_at,p.created_at,p.id)
), events AS (
 SELECT *,COALESCE(shift_day,(COALESCE(session_start,occurred_at) AT TIME ZONE timezone)::date) AS day FROM sequenced
), actual AS (
 SELECT employee_id,day,min(occurred_at) FILTER(WHERE event_type='CLOCK_IN') AS arrival,
 sum(CASE WHEN event_type IN ('CLOCK_IN','BREAK_END') AND next_type IN ('BREAK_START','CLOCK_OUT')
 THEN extract(epoch FROM(next_at-occurred_at))/60 ELSE 0 END) AS minutes
 FROM events GROUP BY employee_id,day
), planned AS (
 SELECT s.employee_id,(s.starts_at AT TIME ZONE c.timezone)::date AS day,
 sum(GREATEST(0,extract(epoch FROM(s.ends_at-s.starts_at))/60-s.unpaid_break_minutes)) AS minutes,
 min(s.starts_at+make_interval(mins=>s.grace_minutes)) AS latest_arrival,
 max(s.ends_at) AS ends_at
 FROM shifts s JOIN companies c ON c.id=s.company_id
 WHERE s.company_id=target_company AND s.status='PUBLISHED'
 GROUP BY s.employee_id,(s.starts_at AT TIME ZONE c.timezone)::date
), days AS (
 SELECT COALESCE(p.employee_id,a.employee_id) AS employee_id,COALESCE(p.day,a.day) AS day,
 p.minutes AS expected,a.minutes AS worked,a.arrival,p.latest_arrival,p.ends_at
 FROM planned p FULL JOIN actual a ON a.employee_id=p.employee_id AND a.day=p.day
), month_time AS (
 SELECT d.employee_id,date_trunc('month',d.day) AS month,
 sum(COALESCE(d.worked,0)) AS worked,sum(COALESCE(d.expected,0)) AS expected
 FROM days d WHERE d.day BETWEEN date_from AND date_to GROUP BY d.employee_id,date_trunc('month',d.day)
), month_plan AS (
 SELECT p.employee_id,date_trunc('month',p.day) AS month,sum(p.minutes) AS minutes
 FROM planned p GROUP BY p.employee_id,date_trunc('month',p.day)
), month_pay AS (
 SELECT e.id,m.month,
 CASE WHEN e.salary_type='HOURLY' THEN m.worked/60*COALESCE(r.hourly_rate,e.hourly_rate)
 ELSE COALESCE(r.base_salary,e.base_salary)*LEAST(m.worked,m.expected)/NULLIF(p.minutes,0) END AS amount
 FROM employees e JOIN month_time m ON m.employee_id=e.id
 LEFT JOIN month_plan p ON p.employee_id=e.id AND p.month=m.month
 LEFT JOIN LATERAL(SELECT rh.base_salary,rh.hourly_rate FROM employee_rate_history rh
   WHERE rh.employee_id=e.id AND rh.company_id=target_company AND rh.effective_from<=LEAST(date_to,(m.month+interval '1 month - 1 day')::date)
   ORDER BY rh.effective_from DESC LIMIT 1) r ON true
 WHERE e.company_id=target_company
)
SELECT e.id,e.full_name,e.salary_type,
 count(d.day) FILTER(WHERE d.expected IS NOT NULL),count(d.day) FILTER(WHERE d.arrival IS NOT NULL),
 COALESCE(sum(d.expected),0),COALESCE(sum(d.worked),0),
 count(d.day) FILTER(WHERE d.arrival>d.latest_arrival),
 count(d.day) FILTER(WHERE d.expected IS NOT NULL AND d.arrival IS NULL AND d.ends_at<now()),
 COALESCE(sum(GREATEST(0,COALESCE(d.worked,0)-COALESCE(d.expected,0))),0),
 (SELECT count(*) FROM employee_tasks t JOIN companies c ON c.id=t.company_id WHERE t.company_id=target_company AND t.employee_id=e.id AND t.status='DONE' AND (t.completed_at AT TIME ZONE c.timezone)::date BETWEEN date_from AND date_to),
 round(COALESCE((SELECT sum(m.amount) FROM month_pay m WHERE m.id=e.id),0))
FROM employees e LEFT JOIN days d ON d.employee_id=e.id AND d.day BETWEEN date_from AND date_to
WHERE e.company_id=target_company GROUP BY e.id
$$;
