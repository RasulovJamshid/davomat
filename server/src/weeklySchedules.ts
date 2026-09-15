import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./db.js";
import { requireManager, type AuthRequest } from "./auth.js";
import { asyncHandler, HttpError } from "./http.js";
import { logger } from "./logger.js";

const uuid = z.string().uuid();
export const weeklyRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120).default("Weekly schedule"),
    scope: z.enum(["ALL", "DEPARTMENT", "LOCATION", "EMPLOYEE"]).default("ALL"),
    scopeId: uuid.nullable().default(null),
    locationId: uuid.nullable().default(null),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .transform((v) => [...new Set(v)].sort()),
    startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    unpaidBreakMinutes: z.number().int().min(0).max(600).default(0),
    graceMinutes: z.number().int().min(0).max(120).default(5),
    effectiveFrom: z.string().date(),
    effectiveUntil: z.string().date().nullable().default(null),
    active: z.boolean().default(true),
  })
  .superRefine((v, c) => {
    if ((v.scope === "ALL") !== (v.scopeId === null))
      c.addIssue({
        code: "custom",
        message: "Select who this schedule applies to",
      });
    if (v.effectiveUntil && v.effectiveUntil < v.effectiveFrom)
      c.addIssue({ code: "custom", message: "End must be on or after start" });
    const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    if (v.unpaidBreakMinutes >= (m(v.endsAt) - m(v.startsAt) + 1440) % 1440)
      c.addIssue({
        code: "custom",
        message: "Workday must be longer than its unpaid break",
      });
  });
const columns = `r.id,r.name,r.scope,r.scope_id AS "scopeId",r.employee_id AS "employeeId",r.location_id AS "locationId",r.weekdays,to_char(r.starts_at,'HH24:MI') AS "startsAt",to_char(r.ends_at,'HH24:MI') AS "endsAt",r.unpaid_break_minutes AS "unpaidBreakMinutes",r.grace_minutes AS "graceMinutes",r.effective_from::text AS "effectiveFrom",r.effective_until::text AS "effectiveUntil",r.active,r.auto_publish AS "autoPublish",r.generated_until::text AS "generatedUntil"`;
export const weeklyRouter = Router();
weeklyRouter.use(
  ["/work-schedules", "/schedule-templates", "/recurring-schedules"],
  requireManager,
);

async function lockCompany(c: PoolClient, company: string) {
  await c.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [company]);
  await c.query("SELECT set_config('app.recurring_worker','true',true)");
}
async function validateReferences(
  c: PoolClient,
  company: string,
  v: z.infer<typeof weeklyRuleSchema>,
) {
  if (
    v.locationId &&
    !(
      await c.query(
        "SELECT id FROM locations WHERE company_id=$1 AND id=$2 AND active",
        [company, v.locationId],
      )
    ).rowCount
  )
    throw new HttpError(400, "Invalid work location");
  if (v.scope !== "ALL") {
    const table =
      v.scope === "EMPLOYEE"
        ? "employees"
        : v.scope === "DEPARTMENT"
          ? "departments"
          : "locations";
    if (
      !(
        await c.query(`SELECT id FROM ${table} WHERE company_id=$1 AND id=$2`, [
          company,
          v.scopeId,
        ])
      ).rowCount
    )
      throw new HttpError(400, "Invalid schedule group");
  }
}

// Compute the winning rule once per employee/day. Individual > group > company; newer rules win ties.
// Manual shifts, cancellations and punch-linked work are preserved. Entire current + next two months
// are maintained so fixed monthly payroll always has a complete published denominator.
export async function materializeWeekly(
  c: PoolClient,
  company: string,
  from?: string,
  to?: string,
  onlyRule?: string,
  manual = false,
) {
  const bounds = (
    await c.query(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today,(date_trunc('month',now() AT TIME ZONE timezone)+interval '3 months - 1 day')::date::text AS horizon,timezone FROM companies WHERE id=$1`,
      [company],
    )
  ).rows[0];
  const start = from ?? bounds.today,
    end = to ?? bounds.horizon;
  const candidates = (
    await c.query(
      `WITH matched AS (
 SELECT e.id AS employee,r.id AS rule,r.location_id,e.primary_location_id,r.starts_at,r.ends_at,r.unpaid_break_minutes,r.grace_minutes,r.created_by,r.auto_publish,r.weekdays,d::date AS day,
 row_number() OVER(PARTITION BY e.id,d ORDER BY CASE r.scope WHEN 'EMPLOYEE' THEN 3 WHEN 'ALL' THEN 1 ELSE 2 END DESC,r.updated_at DESC,r.id) AS rank
 FROM employees e JOIN recurring_schedules r ON r.company_id=e.company_id AND (r.scope='ALL' OR (r.scope='EMPLOYEE' AND r.scope_id=e.id) OR (r.scope='DEPARTMENT' AND r.scope_id=e.department_id) OR (r.scope='LOCATION' AND r.scope_id=e.primary_location_id))
 CROSS JOIN generate_series($2::date,$3::date,interval '1 day') d
 WHERE e.company_id=$1 AND e.status IN ('ACTIVE','ON_LEAVE') AND r.active AND (r.auto_publish OR $5::boolean) AND ($4::uuid IS NULL OR r.id=$4)
 AND d::date>=r.effective_from AND (r.effective_until IS NULL OR d::date<=r.effective_until)
 ) SELECT *,day::text AS "localDate",(day+starts_at) AT TIME ZONE $6 AS start,(day+ends_at+CASE WHEN ends_at<=starts_at THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE $6 AS finish FROM matched WHERE rank=1 AND extract(isodow FROM day)::int=ANY(weekdays) ORDER BY day,employee`,
      [company, start, end, onlyRule ?? null, manual, bounds.timezone],
    )
  ).rows;
  let created = 0,
    preserved = 0;
  const desired = new Map(
    candidates.map((r) => [`${r.employee}:${r.localDate}`, r]),
  );
  // Remove only future untouched auto shifts that no longer match the active rule.
  if (!manual) {
    const existing = (
      await c.query(
        `SELECT s.*,s.recurring_date::text AS "localDate" FROM shifts s JOIN recurring_schedules r ON r.id=s.recurring_rule_id AND r.auto_publish WHERE s.company_id=$1 AND s.status<>'CANCELLED' AND s.starts_at>now() AND s.recurring_date BETWEEN $2::date AND $3::date AND NOT EXISTS(SELECT 1 FROM punches p WHERE p.shift_id=s.id) FOR UPDATE OF s`,
        [company, start, end],
      )
    ).rows;
    for (const s of existing) {
      const r = desired.get(`${s.employee_id}:${s.localDate}`);
      if (
        !r ||
        s.recurring_rule_id !== r.rule ||
        +s.starts_at !== +r.start ||
        +s.ends_at !== +r.finish ||
        s.location_id !== (r.location_id ?? r.primary_location_id) ||
        s.unpaid_break_minutes !== r.unpaid_break_minutes ||
        s.grace_minutes !== r.grace_minutes
      ) {
        await c.query(
          "UPDATE shifts SET status='CANCELLED',updated_at=now() WHERE id=$1",
          [s.id],
        );
      }
    }
  }
  for (const r of candidates) {
    // A cancelled or edited day is intentionally absent from automatic generation.
    const excluded = (
      await c.query(
        "SELECT 1 FROM schedule_exclusions WHERE employee_id=$1 AND day=$2",
        [r.employee, r.localDate],
      )
    ).rowCount;
    const overlapping = (
      await c.query(
        "SELECT id,starts_at,ends_at FROM shifts WHERE company_id=$1 AND employee_id=$2 AND status<>'CANCELLED' AND starts_at<$4 AND ends_at>$3",
        [company, r.employee, r.start, r.finish],
      )
    ).rows;
    if (excluded || overlapping.length) {
      if (
        manual &&
        overlapping.some(
          (s) => +s.starts_at !== +r.start || +s.ends_at !== +r.finish,
        )
      )
        throw new HttpError(409, "Generated schedule overlaps existing shifts");
      preserved++;
      continue;
    }
    // Do not generate past shifts automatically (manual compatibility generation is explicitly ranged).
    if (!manual && +r.start < Date.now()) continue;
    await c.query("SAVEPOINT new_shift");
    try {
      await c.query(
        `INSERT INTO shifts(company_id,employee_id,location_id,starts_at,ends_at,unpaid_break_minutes,grace_minutes,status,created_by,recurring_rule_id,recurring_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          company,
          r.employee,
          r.location_id ?? r.primary_location_id,
          r.start,
          r.finish,
          r.unpaid_break_minutes,
          r.grace_minutes,
          manual ? "DRAFT" : "PUBLISHED",
          r.created_by,
          r.rule,
          r.localDate,
        ],
      );
      created++;
      await c.query("RELEASE SAVEPOINT new_shift");
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT new_shift");
      if ((e as { code?: string }).code !== "23P01") throw e;
      preserved++;
    }
  }
  await c.query(
    "UPDATE recurring_schedules SET generated_until=$2 WHERE company_id=$1 AND active AND auto_publish",
    [company, end],
  );
  return { created, preserved, skipped: preserved, generatedUntil: end };
}
export async function maintainWeeklySchedules() {
  const companies = (
    await pool.query(
      "SELECT DISTINCT company_id FROM recurring_schedules WHERE active AND auto_publish",
    )
  ).rows;
  for (const row of companies) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await lockCompany(c, row.company_id);
      await materializeWeekly(c, row.company_id);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      logger.error({ error: e }, "Automatic schedule refresh failed");
    } finally {
      c.release();
    }
  }
}
export function startWeeklyScheduler() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await maintainWeeklySchedules();
    } catch (e) {
      logger.error({ error: e }, "Weekly scheduler failed");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 60 * 60 * 1000);
  timer.unref();
  return timer;
}

async function saveRule(
  company: string,
  actor: string,
  input: unknown,
  id?: string,
  automatic = true,
) {
  const v = weeklyRuleSchema.parse(input),
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    await lockCompany(c, company);
    await validateReferences(c, company, v);
    if (
      id &&
      !(
        await c.query(
          "SELECT id FROM recurring_schedules WHERE id=$1 AND company_id=$2 FOR UPDATE",
          [id, company],
        )
      ).rowCount
    )
      throw new HttpError(404, "Schedule not found");
    if (
      automatic &&
      v.active &&
      (
        await c.query(
          `SELECT id FROM recurring_schedules WHERE company_id=$1 AND scope=$2 AND scope_id IS NOT DISTINCT FROM $3::uuid AND active AND auto_publish AND ($4::uuid IS NULL OR id<>$4) AND effective_from<=COALESCE($6::date,'infinity'::date) AND COALESCE(effective_until,'infinity'::date)>=$5::date LIMIT 1`,
          [
            company,
            v.scope,
            v.scopeId,
            id ?? null,
            v.effectiveFrom,
            v.effectiveUntil,
          ],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "An automatic schedule already exists for this group. Edit it instead.",
      );
    const values = [
      company,
      v.scope === "EMPLOYEE" ? v.scopeId : null,
      v.locationId,
      v.weekdays,
      v.startsAt,
      v.endsAt,
      v.unpaidBreakMinutes,
      v.graceMinutes,
      v.effectiveFrom,
      v.effectiveUntil,
      actor,
      v.name,
      v.scope,
      v.scopeId,
      v.active,
      automatic,
    ];
    const result = id
      ? await c.query(
          `UPDATE recurring_schedules SET employee_id=$2,location_id=$3,weekdays=$4,starts_at=$5,ends_at=$6,unpaid_break_minutes=$7,grace_minutes=$8,effective_from=$9,effective_until=$10,created_by=$11,name=$12,scope=$13,scope_id=$14,active=$15,auto_publish=$16,updated_at=now() WHERE company_id=$1 AND id=$17 RETURNING id`,
          [...values, id],
        )
      : await c.query(
          `INSERT INTO recurring_schedules(company_id,employee_id,location_id,weekdays,starts_at,ends_at,unpaid_break_minutes,grace_minutes,effective_from,effective_until,created_by,name,scope,scope_id,active,auto_publish) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          values,
        );
    const summary = automatic ? await materializeWeekly(c, company) : {};
    if (automatic)
      await c.query(
        `INSERT INTO push_events(company_id,user_id,title,body,action) SELECT $1,user_id,'Weekly schedule updated','Your regular working days or hours have changed.','schedule' FROM employees WHERE company_id=$1 AND user_id IS NOT NULL AND status IN ('ACTIVE','ON_LEAVE') AND ($2='ALL' OR ($2='EMPLOYEE' AND id=$3) OR ($2='DEPARTMENT' AND department_id=$3) OR ($2='LOCATION' AND primary_location_id=$3))`,
        [company, v.scope, v.scopeId],
      );
    await c.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'WEEKLY_SCHEDULE_SAVED','SCHEDULE',$3,$4)`,
      [company, actor, result.rows[0].id, JSON.stringify(v)],
    );
    await c.query("COMMIT");
    return { ...result.rows[0], ...summary };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
weeklyRouter.get(
  ["/work-schedules", "/schedule-templates", "/recurring-schedules"],
  asyncHandler(async (req, res) => {
    const { companyId } = (req as AuthRequest).auth;
    const rows = (
      await pool.query(
        `SELECT ${columns},COALESCE(e.full_name,d.name,l.name,'Everyone') AS "scopeName",e.full_name AS employee,to_char(r.starts_at,'HH24:MI') AS "startTime",to_char(r.ends_at,'HH24:MI') AS "endTime" FROM recurring_schedules r LEFT JOIN employees e ON r.scope='EMPLOYEE' AND e.id=r.scope_id LEFT JOIN departments d ON r.scope='DEPARTMENT' AND d.id=r.scope_id LEFT JOIN locations l ON r.scope='LOCATION' AND l.id=r.scope_id WHERE r.company_id=$1 ORDER BY r.active DESC,r.updated_at DESC`,
        [companyId],
      )
    ).rows;
    res.json({ data: rows });
  }),
);
weeklyRouter.post(
  "/work-schedules",
  asyncHandler(async (req, res) => {
    const a = (req as AuthRequest).auth;
    res
      .status(201)
      .json({ data: await saveRule(a.companyId, a.sub, req.body) });
  }),
);
weeklyRouter.put(
  "/work-schedules/:id",
  asyncHandler(async (req, res) => {
    const a = (req as AuthRequest).auth;
    res.json({
      data: await saveRule(
        a.companyId,
        a.sub,
        req.body,
        uuid.parse(req.params.id),
      ),
    });
  }),
);
weeklyRouter.post(
  ["/schedule-templates", "/recurring-schedules"],
  asyncHandler(async (req, res) => {
    const a = (req as AuthRequest).auth,
      v = req.body;
    const date = (
      await pool.query(
        "SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM companies WHERE id=$1",
        [a.companyId],
      )
    ).rows[0].today;
    res
      .status(201)
      .json({
        data: await saveRule(
          a.companyId,
          a.sub,
          {
            ...v,
            scope: "EMPLOYEE",
            scopeId: v.employeeId,
            startsAt: v.startsAt ?? v.startTime,
            endsAt: v.endsAt ?? v.endTime,
            effectiveFrom: v.effectiveFrom ?? date,
          },
          undefined,
          false,
        ),
      });
  }),
);
weeklyRouter.post(
  ["/schedule-templates/:id/generate", "/recurring-schedules/materialize"],
  asyncHandler(async (req, res) => {
    const v = z
        .object({ from: z.string().date(), to: z.string().date() })
        .refine(
          (v) =>
            v.from <= v.to &&
            Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
          "Select up to one year",
        )
        .parse(req.body),
      a = (req as AuthRequest).auth,
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      await lockCompany(c, a.companyId);
      const id = req.params.id ? uuid.parse(req.params.id) : undefined;
      if (
        id &&
        !(
          await c.query(
            "SELECT id FROM recurring_schedules WHERE id=$1 AND company_id=$2",
            [id, a.companyId],
          )
        ).rowCount
      )
        throw new HttpError(404, "Schedule not found");
      const summary = await materializeWeekly(
        c,
        a.companyId,
        v.from,
        v.to,
        id,
        true,
      );
      await c.query("COMMIT");
      res.json({
        data: { created: summary.created, skipped: summary.skipped },
      });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }),
);
weeklyRouter.delete(
  ["/work-schedules/:id", "/schedule-templates/:id"],
  asyncHandler(async (req, res) => {
    const a = (req as AuthRequest).auth,
      id = uuid.parse(req.params.id),
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      await lockCompany(c, a.companyId);
      const r = await c.query(
        "UPDATE recurring_schedules SET active=false,updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING id",
        [id, a.companyId],
      );
      if (!r.rowCount) throw new HttpError(404, "Schedule not found");
      await materializeWeekly(c, a.companyId);
      await c.query("COMMIT");
      res.json({ data: { id, active: false } });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }),
);
