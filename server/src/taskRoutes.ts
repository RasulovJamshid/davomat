import { Router } from "express";
import { z } from "zod";
import { requireManager, type AuthRequest } from "./auth.js";
import { pool } from "./db.js";
import { asyncHandler, HttpError } from "./http.js";

export const taskRouter = Router();
taskRouter.delete(
  "/employees/:id",
  requireManager,
  asyncHandler(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub, role } = (request as AuthRequest).auth;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const previous = (
        await client.query(
          "SELECT user_id,access_role,status FROM employees WHERE id=$1 AND company_id=$2 FOR UPDATE",
          [id, companyId],
        )
      ).rows[0];
      if (!previous) throw new HttpError(404, "Employee not found");
      if (
        previous.user_id === sub ||
        (role !== "ADMIN" && previous.access_role !== "EMPLOYEE")
      )
        throw new HttpError(403, "Cannot remove this account");
      await client.query(
        "UPDATE employees SET status='INACTIVE',updated_at=now() WHERE id=$1",
        [id],
      );
      if (previous.user_id)
        await client.query(
          "UPDATE users SET active=false,token_version=token_version+1,updated_at=now() WHERE id=$1 AND company_id=$2",
          [previous.user_id, companyId],
        );
      await client.query(
        "UPDATE shifts SET status='CANCELLED',updated_at=now() WHERE employee_id=$1 AND company_id=$2 AND starts_at>now() AND NOT EXISTS(SELECT 1 FROM punches p WHERE p.shift_id=shifts.id)",
        [id, companyId],
      );
      await client.query(
        "INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'EMPLOYEE_ARCHIVED','EMPLOYEE',$3,$4,$5)",
        [
          companyId,
          sub,
          id,
          JSON.stringify(previous),
          JSON.stringify({ status: "INACTIVE" }),
        ],
      );
      await client.query("COMMIT");
      response.json({ data: { id, status: "INACTIVE" } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
export const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000).default(""),
  employeeId: z.string().uuid(),
  dueAt: z.string().datetime({ offset: true }),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
});
export function canTransitionTask(
  previous: string,
  next: string,
  manager: boolean,
) {
  return (
    manager ||
    (previous === "NEW" && next === "IN_PROGRESS") ||
    (previous === "IN_PROGRESS" && next === "DONE")
  );
}
taskRouter.get(
  "/tasks",
  asyncHandler(async (request, response) => {
    const { companyId, sub, role } = (request as AuthRequest).auth;
    const employeeId = z
      .string()
      .uuid()
      .optional()
      .parse(request.query.employeeId);
    const result = await pool.query(
      `SELECT t.id,t.employee_id AS "employeeId",e.full_name AS employee,t.title,t.description,t.due_at AS "dueAt",t.priority,t.status,t.completed_at AS "completedAt"
    FROM employee_tasks t JOIN employees e ON e.id=t.employee_id
    WHERE t.company_id=$1 AND ($2::boolean OR e.user_id=$3) AND ($4::uuid IS NULL OR e.id=$4)
    ORDER BY CASE t.status WHEN 'DONE' THEN 1 ELSE 0 END,t.due_at,t.created_at DESC`,
      [companyId, role !== "EMPLOYEE", sub, employeeId ?? null],
    );
    response.json({ data: result.rows });
  }),
);
taskRouter.post(
  "/tasks",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = taskSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    const result = await pool.query(
      `INSERT INTO employee_tasks(company_id,employee_id,title,description,due_at,priority,created_by)
    SELECT $1,e.id,$3,$4,$5,$6,$7 FROM employees e WHERE e.id=$2 AND e.company_id=$1 AND e.status IN ('ACTIVE','ON_LEAVE') RETURNING id`,
      [
        companyId,
        input.employeeId,
        input.title,
        input.description,
        input.dueAt,
        input.priority,
        sub,
      ],
    );
    if (!result.rows[0]) throw new HttpError(404, "Employee not found");
    response.status(201).json({ data: result.rows[0] });
  }),
);
taskRouter.patch(
  "/tasks/:id/status",
  asyncHandler(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const { status } = z
      .object({ status: z.enum(["NEW", "IN_PROGRESS", "DONE"]) })
      .strict()
      .parse(request.body);
    const { companyId, sub, role } = (request as AuthRequest).auth;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT t.status FROM employee_tasks t JOIN employees e ON e.id=t.employee_id
      WHERE t.id=$1 AND t.company_id=$2 AND ($3::boolean OR (e.user_id=$4 AND e.status='ACTIVE')) FOR UPDATE OF t`,
        [id, companyId, role !== "EMPLOYEE", sub],
      );
      if (!result.rows[0]) throw new HttpError(404, "Task not found");
      if (
        !canTransitionTask(result.rows[0].status, status, role !== "EMPLOYEE")
      )
        throw new HttpError(409, "Invalid task status transition");
      await client.query(
        `UPDATE employee_tasks SET status=$2,completed_at=CASE WHEN $2='DONE' THEN COALESCE(completed_at,now()) ELSE NULL END,updated_at=now() WHERE id=$1`,
        [id, status],
      );
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'TASK_STATUS_CHANGED','TASK',$3,$4,$5)`,
        [
          companyId,
          sub,
          id,
          JSON.stringify(result.rows[0]),
          JSON.stringify({ status }),
        ],
      );
      await client.query("COMMIT");
      response.json({ data: { id, status } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

taskRouter.get(
  "/workforce-summary",
  asyncHandler(async (request, response) => {
    const date = z.string().date();
    const input = z
      .object({
        from: date,
        to: date,
        employeeId: z.string().uuid().optional(),
      })
      .refine((v) => v.from <= v.to, "Invalid date range")
      .parse(request.query);
    if (Date.parse(input.to) - Date.parse(input.from) > 366 * 86400000)
      throw new HttpError(400, "Select at most one year");
    const { companyId, sub, role } = (request as AuthRequest).auth;
    const result = await pool.query(
      `SELECT w.employee_id AS "employeeId",w.employee,w.salary_type AS "salaryType",w.scheduled_days AS "scheduledDays",w.worked_days AS "workedDays",w.expected_minutes::float AS "expectedMinutes",w.worked_minutes::float AS "workedMinutes",w.late_days AS "lateDays",w.absent_days AS "absentDays",w.overtime_minutes::float AS "overtimeMinutes",w.completed_tasks AS "completedTasks",w.salary::float AS salary,c.currency
    FROM workforce_summary($1,$2,$3) w JOIN employees e ON e.id=w.employee_id JOIN companies c ON c.id=e.company_id
    WHERE ($4::boolean OR e.user_id=$5) AND ($6::uuid IS NULL OR e.id=$6) ORDER BY w.employee`,
      [
        companyId,
        input.from,
        input.to,
        role !== "EMPLOYEE",
        sub,
        input.employeeId ?? null,
      ],
    );
    response.json({ data: result.rows });
  }),
);
