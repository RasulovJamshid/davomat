-- One canonical rule store for web, mobile and the rolling scheduler.
ALTER TABLE recurring_schedules ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE recurring_schedules ADD COLUMN name text NOT NULL DEFAULT 'Weekly schedule';
ALTER TABLE recurring_schedules ADD COLUMN scope text NOT NULL DEFAULT 'EMPLOYEE' CHECK(scope IN ('ALL','DEPARTMENT','LOCATION','EMPLOYEE'));
ALTER TABLE recurring_schedules ADD COLUMN scope_id uuid;
ALTER TABLE recurring_schedules ADD COLUMN auto_publish boolean NOT NULL DEFAULT false;
ALTER TABLE recurring_schedules ADD COLUMN generated_until date;
ALTER TABLE recurring_schedules ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE recurring_schedules SET scope_id=employee_id;
INSERT INTO recurring_schedules(id,company_id,employee_id,scope_id,location_id,name,weekdays,starts_at,ends_at,unpaid_break_minutes,grace_minutes,effective_from,created_by,created_at)
SELECT t.id,t.company_id,t.employee_id,t.employee_id,t.location_id,t.name,t.weekdays::smallint[],t.start_time,t.end_time,t.unpaid_break_minutes,t.grace_minutes,(t.created_at AT TIME ZONE c.timezone)::date,t.created_by,t.created_at FROM schedule_templates t JOIN companies c ON c.id=t.company_id ON CONFLICT(id) DO NOTHING;
-- Archive the old table; all live endpoints now use recurring_schedules.
ALTER TABLE schedule_templates RENAME TO schedule_templates_archive;
CREATE VIEW schedule_templates AS SELECT id,company_id,employee_id,location_id,name,weekdays,starts_at AS start_time,ends_at AS end_time,unpaid_break_minutes,grace_minutes,created_by,created_at FROM recurring_schedules WHERE scope='EMPLOYEE';
ALTER TABLE shifts ADD COLUMN recurring_rule_id uuid REFERENCES recurring_schedules(id) ON DELETE SET NULL;
ALTER TABLE shifts ADD COLUMN recurring_date date;
CREATE INDEX shifts_recurring_rule ON shifts(recurring_rule_id,recurring_date);
CREATE TABLE schedule_exclusions (
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 day date NOT NULL, PRIMARY KEY(employee_id,day)
);
-- Changing/cancelling an automatically created shift makes that day an exception.
CREATE FUNCTION preserve_schedule_exception() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.recurring_rule_id IS NOT NULL AND COALESCE(current_setting('app.recurring_worker',true),'')<>'true' AND
 (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes OR NEW.grace_minutes IS DISTINCT FROM OLD.grace_minutes OR NEW.live_tracking_enabled IS DISTINCT FROM OLD.live_tracking_enabled OR NEW.status='CANCELLED') THEN
 INSERT INTO schedule_exclusions(company_id,employee_id,day) VALUES(OLD.company_id,OLD.employee_id,OLD.recurring_date) ON CONFLICT DO NOTHING;
 NEW.recurring_rule_id:=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_recurring_shift BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION preserve_schedule_exception();
DROP TRIGGER shift_push ON shifts;
CREATE TRIGGER shift_push AFTER INSERT OR UPDATE ON shifts FOR EACH ROW
WHEN (COALESCE(current_setting('app.recurring_worker',true),'')<>'true') EXECUTE FUNCTION queue_workforce_push();
