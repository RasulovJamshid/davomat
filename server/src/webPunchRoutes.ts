import { Router } from "express";
import { z } from "zod";
import type { AuthRequest } from "./auth.js";
import { pool } from "./db.js";
import { asyncHandler, HttpError } from "./http.js";
export const webPunchRouter = Router();
export function canWebPunch(previous: string, next: string, sameDay: boolean) {
  if (previous === "NONE" || (previous === "CLOCK_OUT" && !sameDay))
    return next === "CLOCK_IN";
  if (previous === "CLOCK_IN" || previous === "BREAK_END")
    return ["CLOCK_OUT", "BREAK_START"].includes(next);
  return previous === "BREAK_START" && next === "BREAK_END";
}
webPunchRouter.post(
  "/me/web-punches",
  asyncHandler(async (request, response) => {
    const { eventType } = z
      .object({
        eventType: z.enum([
          "CLOCK_IN",
          "CLOCK_OUT",
          "BREAK_START",
          "BREAK_END",
        ]),
      })
      .strict()
      .parse(request.body);
    const { companyId, sub, role } = (request as AuthRequest).auth;
    if (role !== "EMPLOYEE")
      throw new HttpError(403, "Employee access required");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const employee = (
        await client.query(
          `SELECT e.id,c.timezone FROM employees e JOIN companies c ON c.id=e.company_id WHERE e.company_id=$1 AND e.user_id=$2 AND e.status='ACTIVE' FOR UPDATE OF e`,
          [companyId, sub],
        )
      ).rows[0];
      if (!employee)
        throw new HttpError(
          403,
          "An active employee profile is required to clock time",
        );
      const last = (
        await client.query(
          `SELECT event_type,shift_id,(occurred_at AT TIME ZONE $3)::date=(clock_timestamp() AT TIME ZONE $3)::date AS same_day FROM punches WHERE company_id=$1 AND employee_id=$2 ORDER BY occurred_at DESC,created_at DESC,id DESC LIMIT 1`,
          [companyId, employee.id, employee.timezone],
        )
      ).rows[0];
      if (
        !canWebPunch(
          last?.event_type ?? "NONE",
          eventType,
          last?.same_day ?? false,
        )
      )
        throw new HttpError(409, "Invalid attendance event sequence");
      const shift =
        eventType === "CLOCK_IN"
          ? (
              await client.query(
                `SELECT id FROM shifts WHERE company_id=$1 AND employee_id=$2 AND status='PUBLISHED' AND ((starts_at AT TIME ZONE $3)::date=(clock_timestamp() AT TIME ZONE $3)::date OR (starts_at<=clock_timestamp() AND ends_at>=clock_timestamp())) ORDER BY abs(extract(epoch FROM starts_at-clock_timestamp())) LIMIT 1`,
                [companyId, employee.id, employee.timezone],
              )
            ).rows[0]?.id
          : last?.shift_id;
      const result = await client.query(
        `INSERT INTO punches(company_id,employee_id,shift_id,event_type,occurred_at,source) VALUES($1,$2,$3,$4,clock_timestamp(),'WEB') RETURNING id,event_type AS "eventType",occurred_at AS "occurredAt",source`,
        [companyId, employee.id, shift ?? null, eventType],
      );
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'EMPLOYEE_WEB_PUNCH_CREATED','PUNCH',$3,$4)`,
        [companyId, sub, result.rows[0].id, JSON.stringify(result.rows[0])],
      );
      await client.query("COMMIT");
      response.status(201).json({ data: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
