-- Bind employee accounts to one mobile installation and retain private selfie evidence.
CREATE TABLE IF NOT EXISTS mobile_device_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  installation_hash char(64) NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ANDROID','IOS')),
  device_label text NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  reset_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_mobile_binding_user
  ON mobile_device_bindings(user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_mobile_binding_installation
  ON mobile_device_bindings(installation_hash) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS attendance_face_verifications (
  punch_id uuid PRIMARY KEY REFERENCES punches(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  device_binding_id uuid NOT NULL REFERENCES mobile_device_bindings(id),
  image_data bytea NOT NULL,
  image_mime text NOT NULL CHECK (image_mime = 'image/jpeg'),
  image_sha256 char(64) NOT NULL,
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(image_data) BETWEEN 3000 AND 1572864)
);

CREATE INDEX IF NOT EXISTS idx_mobile_bindings_company_employee
  ON mobile_device_bindings(company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_face_verifications_company_created
  ON attendance_face_verifications(company_id, created_at DESC);
