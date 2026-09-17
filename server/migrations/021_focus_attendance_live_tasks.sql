-- Weekly schedules can turn on live-location tracking for every shift they generate.
ALTER TABLE recurring_schedules ADD COLUMN IF NOT EXISTS live_tracking_enabled boolean NOT NULL DEFAULT false;

-- Location history for a tracked shift. The latest point still lives in
-- live_location_updates; this table keeps the route so a manager can answer
-- "where was this person at 14:00". Rows are removed 7 days after capture.
CREATE TABLE IF NOT EXISTS live_location_points (
  id bigserial PRIMARY KEY,
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  latitude numeric(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m numeric(8,2) NOT NULL CHECK (accuracy_m >= 0 AND accuracy_m <= 5000),
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_location_points_shift ON live_location_points(shift_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_live_location_points_company_captured ON live_location_points(company_id, captured_at);

-- Tasks can be tied to a work location and carry completion evidence.
ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS completion_note text NOT NULL DEFAULT '';
ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS manager_note text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS employee_tasks_company_due ON employee_tasks(company_id, due_at);
