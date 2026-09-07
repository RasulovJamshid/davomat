CREATE UNIQUE INDEX IF NOT EXISTS users_email_global_unique ON users (lower(email));

CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id) WHERE user_id IS NOT NULL;
