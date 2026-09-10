ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS live_tracking_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS live_location_updates (
  shift_id uuid PRIMARY KEY REFERENCES shifts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  device_binding_id uuid NOT NULL REFERENCES mobile_device_bindings(id) ON DELETE CASCADE,
  latitude numeric(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m numeric(8,2) NOT NULL CHECK (accuracy_m >= 0 AND accuracy_m <= 5000),
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_locations_company_received
  ON live_location_updates(company_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_shifts_live_tracking_window
  ON shifts(company_id, starts_at, ends_at)
  WHERE live_tracking_enabled = true AND status = 'PUBLISHED';
