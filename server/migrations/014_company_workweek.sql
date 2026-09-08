-- Company-wide workweek defaults that can be applied to employee schedules.
CREATE TABLE IF NOT EXISTS company_workweek_templates (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  starts_at time NOT NULL DEFAULT '08:00',
  ends_at time NOT NULL DEFAULT '17:00',
  unpaid_break_minutes integer NOT NULL DEFAULT 60 CHECK (unpaid_break_minutes BETWEEN 0 AND 480),
  grace_minutes integer NOT NULL DEFAULT 5 CHECK (grace_minutes BETWEEN 0 AND 120),
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(weekdays) BETWEEN 1 AND 7),
  CHECK (weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CHECK (starts_at <> ends_at)
);
