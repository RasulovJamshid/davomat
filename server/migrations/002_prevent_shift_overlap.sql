CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shifts_no_active_overlap'
  ) THEN
    ALTER TABLE shifts
      ADD CONSTRAINT shifts_no_active_overlap
      EXCLUDE USING gist (
        employee_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      )
      WHERE (status <> 'CANCELLED');
  END IF;
END
$$;
