ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS annual_leave_days integer NOT NULL DEFAULT 21 CHECK (annual_leave_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS default_income_tax_rate numeric(5,2) NOT NULL DEFAULT 12 CHECK (default_income_tax_rate BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS correction_window_days integer NOT NULL DEFAULT 45 CHECK (correction_window_days BETWEEN 1 AND 365);
