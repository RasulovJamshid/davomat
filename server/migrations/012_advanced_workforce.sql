-- Advanced workforce operations: devices, scheduling, payroll policy and reports.
CREATE TABLE IF NOT EXISTS holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL,
  paid boolean NOT NULL DEFAULT true,
  UNIQUE(company_id, holiday_date)
);

CREATE TABLE IF NOT EXISTS payroll_rules (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  overtime_multiplier numeric(6,3) NOT NULL DEFAULT 1.5 CHECK(overtime_multiplier >= 1),
  night_multiplier numeric(6,3) NOT NULL DEFAULT 1.2 CHECK(night_multiplier >= 1),
  holiday_multiplier numeric(6,3) NOT NULL DEFAULT 2 CHECK(holiday_multiplier >= 1),
  night_starts_at time NOT NULL DEFAULT '22:00',
  night_ends_at time NOT NULL DEFAULT '06:00',
  pension_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK(pension_rate BETWEEN 0 AND 100),
  social_tax_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK(social_tax_rate BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_rate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  hourly_rate bigint NOT NULL CHECK(hourly_rate >= 0),
  base_salary bigint NOT NULL CHECK(base_salary >= 0),
  UNIQUE(employee_id, effective_from)
);

CREATE TABLE IF NOT EXISTS employee_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount bigint NOT NULL CHECK(amount >= 0),
  taxable boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  starts_on date,
  ends_on date,
  UNIQUE(employee_id, name)
);

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS night_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS night_pay bigint NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS holiday_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS holiday_pay bigint NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS benefits bigint NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employer_contributions bigint NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS calculation_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS employee_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  availability text NOT NULL CHECK(availability IN ('AVAILABLE','UNAVAILABLE','PREFERRED')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS recurring_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  weekdays smallint[] NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  unpaid_break_minutes integer NOT NULL DEFAULT 60,
  grace_minutes integer NOT NULL DEFAULT 5,
  effective_from date NOT NULL,
  effective_until date,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shift_swaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  offered_to uuid REFERENCES employees(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  reason text,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACCEPTED','APPROVED','REJECTED','CANCELLED')),
  manager_note text,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shift_id, status)
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  vendor text NOT NULL,
  serial_number text NOT NULL,
  device_type text NOT NULL CHECK(device_type IN ('BIOMETRIC','FACE_TERMINAL','TURNSTILE','KIOSK')),
  api_key_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, serial_number)
);

CREATE TABLE IF NOT EXISTS biometric_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
  external_user_id text NOT NULL,
  biometric_type text NOT NULL CHECK(biometric_type IN ('FACE','FINGERPRINT','CARD')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, external_user_id, biometric_type)
);

CREATE TABLE IF NOT EXISTS access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  external_event_id text NOT NULL,
  external_user_id text,
  event_type text NOT NULL CHECK(event_type IN ('ENTRY','EXIT','ACCESS_GRANTED','ACCESS_DENIED')),
  occurred_at timestamptz NOT NULL,
  confidence numeric(5,4),
  liveness_passed boolean,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  punch_id uuid REFERENCES punches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, external_event_id)
);

CREATE TABLE IF NOT EXISTS report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  report_type text NOT NULL CHECK(report_type IN ('ATTENDANCE','PAYROLL','AUDIT','ACCOUNTING')),
  format text NOT NULL CHECK(format IN ('CSV','JSON')),
  schedule_cron text,
  recipients text[] NOT NULL DEFAULT '{}',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_definition_id uuid REFERENCES report_definitions(id) ON DELETE SET NULL,
  report_type text NOT NULL,
  format text NOT NULL,
  status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
  row_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_access_events_company_time ON access_events(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_availability_employee_time ON employee_availability(employee_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_swaps_company_status ON shift_swaps(company_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_due ON report_definitions(active, next_run_at);
