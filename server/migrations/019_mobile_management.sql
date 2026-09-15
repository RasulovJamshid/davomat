CREATE TABLE schedule_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL REFERENCES employees(id), location_id uuid NOT NULL REFERENCES locations(id),
 name text NOT NULL, weekdays int[] NOT NULL, start_time time NOT NULL, end_time time NOT NULL,
 unpaid_break_minutes int NOT NULL DEFAULT 0, grace_minutes int NOT NULL DEFAULT 5,
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collaboration_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('announcements','discussions','checklists','surveys','documents','trips')),
 title text NOT NULL, body text NOT NULL DEFAULT '', employee_id uuid REFERENCES employees(id),
 details jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'OPEN',
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collaboration_company_kind ON collaboration_items(company_id,kind,created_at DESC);
CREATE TABLE collaboration_responses (
 item_id uuid NOT NULL REFERENCES collaboration_items(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id),
 value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(item_id,user_id)
);
CREATE TABLE collaboration_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES collaboration_items(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id), body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collaboration_files (
 item_id uuid PRIMARY KEY REFERENCES collaboration_items(id) ON DELETE CASCADE, filename text NOT NULL, mime text NOT NULL, content bytea NOT NULL
);
CREATE TABLE push_devices (
 token text PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE push_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, title text NOT NULL, body text NOT NULL,
 action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
 sent_at timestamptz, attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_pending ON push_events(next_attempt_at) WHERE sent_at IS NULL;
CREATE FUNCTION queue_workforce_push() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user uuid; heading text; destination text;
BEGIN
 IF TG_TABLE_NAME='employee_tasks' THEN
   IF TG_OP='UPDATE' AND NEW.status=OLD.status THEN RETURN NEW; END IF;
   heading:=CASE WHEN TG_OP='INSERT' THEN 'New task assigned' ELSE 'Task updated' END; destination:='tasks';
 ELSIF TG_TABLE_NAME='shifts' THEN
   IF NEW.status='DRAFT' THEN RETURN NEW; END IF;
   heading:='Work schedule updated'; destination:='schedule';
 ELSE
   IF NEW.status='PENDING' THEN RETURN NEW; END IF;
   heading:='Request decision available'; destination:='requests';
 END IF;
 SELECT user_id INTO target_user FROM employees WHERE id=NEW.employee_id AND company_id=NEW.company_id;
 IF target_user IS NOT NULL THEN
   INSERT INTO push_events(company_id,user_id,title,body,action) VALUES(NEW.company_id,target_user,heading,'Open the app to view details.',destination);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_push AFTER INSERT OR UPDATE ON employee_tasks FOR EACH ROW EXECUTE FUNCTION queue_workforce_push();
CREATE TRIGGER shift_push AFTER INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION queue_workforce_push();
CREATE TRIGGER leave_push AFTER UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION queue_workforce_push();
CREATE TRIGGER correction_push AFTER UPDATE ON attendance_exceptions FOR EACH ROW EXECUTE FUNCTION queue_workforce_push();
