import { Router } from "express";
import { z } from "zod";
import { requireManager, type AuthRequest } from "./auth.js";
import { pool } from "./db.js";
import { asyncHandler, HttpError } from "./http.js";

export const mobileManagementRouter = Router();
const uuid = z.string().uuid();
export const recurringSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    employeeId: uuid,
    locationId: uuid,
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .transform((v) => [...new Set(v)]),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    unpaidBreakMinutes: z.number().int().min(0).max(600).default(0),
    graceMinutes: z.number().int().min(0).max(120).default(5),
  })
  .refine((v) => v.startTime !== v.endTime, "Start and end must differ")
  .refine((v) => {
    const minutes = (s: string) =>
      Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    return (
      v.unpaidBreakMinutes <
      (minutes(v.endTime) - minutes(v.startTime) + 1440) % 1440
    );
  }, "Break must be shorter than the shift");
mobileManagementRouter.get(
  "/schedule-templates",
  requireManager,
  asyncHandler(async (req, res) => {
    const { companyId } = (req as AuthRequest).auth;
    const r = await pool.query(
      `SELECT t.id,t.name,t.employee_id AS "employeeId",e.full_name AS employee,t.location_id AS "locationId",t.weekdays,to_char(t.start_time,'HH24:MI') AS "startTime",to_char(t.end_time,'HH24:MI') AS "endTime",t.unpaid_break_minutes AS "unpaidBreakMinutes",t.grace_minutes AS "graceMinutes" FROM schedule_templates t JOIN employees e ON e.id=t.employee_id WHERE t.company_id=$1 ORDER BY t.name`,
      [companyId],
    );
    res.json({ data: r.rows });
  }),
);
mobileManagementRouter.post(
  "/schedule-templates",
  requireManager,
  asyncHandler(async (req, res) => {
    const v = recurringSchema.parse(req.body),
      { companyId, sub } = (req as AuthRequest).auth;
    const r = await pool.query(
      `INSERT INTO schedule_templates(company_id,employee_id,location_id,name,weekdays,start_time,end_time,unpaid_break_minutes,grace_minutes,created_by) SELECT $1,e.id,l.id,$4,$5,$6,$7,$8,$9,$10 FROM employees e CROSS JOIN locations l WHERE e.id=$2 AND e.company_id=$1 AND e.status IN ('ACTIVE','ON_LEAVE') AND l.id=$3 AND l.company_id=$1 RETURNING id`,
      [
        companyId,
        v.employeeId,
        v.locationId,
        v.name,
        v.weekdays,
        v.startTime,
        v.endTime,
        v.unpaidBreakMinutes,
        v.graceMinutes,
        sub,
      ],
    );
    if (!r.rows[0]) throw new HttpError(404, "Employee or location not found");
    res.status(201).json({ data: r.rows[0] });
  }),
);
mobileManagementRouter.delete(
  "/schedule-templates/:id",
  requireManager,
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      "DELETE FROM schedule_templates WHERE id=$1 AND company_id=$2 RETURNING id",
      [uuid.parse(req.params.id), (req as AuthRequest).auth.companyId],
    );
    if (!r.rowCount) throw new HttpError(404, "Schedule not found");
    res.json({ data: r.rows[0] });
  }),
);
mobileManagementRouter.post(
  "/schedule-templates/:id/generate",
  requireManager,
  asyncHandler(async (req, res) => {
    const v = z
      .object({ from: z.string().date(), to: z.string().date() })
      .refine(
        (v) =>
          v.from <= v.to &&
          Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
        "Select up to one year",
      )
      .parse(req.body);
    const { companyId, sub } = (req as AuthRequest).auth,
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      const t = (
        await c.query(
          "SELECT * FROM schedule_templates WHERE id=$1 AND company_id=$2 FOR UPDATE",
          [uuid.parse(req.params.id), companyId],
        )
      ).rows[0];
      if (!t) throw new HttpError(404, "Schedule not found");
      // Serialize all template generation for this employee. Exact repeats are harmless; other overlaps roll back.
      const e = await c.query(
        "SELECT id FROM employees WHERE id=$1 AND company_id=$2 AND status IN ('ACTIVE','ON_LEAVE') FOR UPDATE",
        [t.employee_id, companyId],
      );
      if (!e.rowCount) throw new HttpError(409, "Employee is inactive");
      const dates = (
        await c.query(
          `SELECT (d::date+t.start_time) AT TIME ZONE c.timezone AS starts,(d::date+t.end_time+CASE WHEN t.end_time<t.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE c.timezone AS ends FROM schedule_templates t JOIN companies c ON c.id=t.company_id CROSS JOIN generate_series($2::date,$3::date,interval '1 day') d WHERE t.id=$1 AND extract(isodow FROM d)::int=ANY(t.weekdays)`,
          [t.id, v.from, v.to],
        )
      ).rows;
      let created = 0,
        skipped = 0;
      for (const d of dates) {
        const overlaps = (
          await c.query(
            "SELECT starts_at,ends_at FROM shifts WHERE company_id=$1 AND employee_id=$2 AND status<>'CANCELLED' AND starts_at<$4 AND ends_at>$3",
            [companyId, t.employee_id, d.starts, d.ends],
          )
        ).rows;
        if (overlaps.length) {
          if (
            overlaps.length === 1 &&
            +overlaps[0].starts_at === +d.starts &&
            +overlaps[0].ends_at === +d.ends
          ) {
            skipped++;
            continue;
          }
          throw new HttpError(
            409,
            "Generated schedule overlaps existing shifts",
          );
        }
        await c.query(
          "INSERT INTO shifts(company_id,employee_id,location_id,starts_at,ends_at,unpaid_break_minutes,grace_minutes,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8)",
          [
            companyId,
            t.employee_id,
            t.location_id,
            d.starts,
            d.ends,
            t.unpaid_break_minutes,
            t.grace_minutes,
            sub,
          ],
        );
        created++;
      }
      await c.query("COMMIT");
      res.json({ data: { created, skipped } });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }),
);

mobileManagementRouter.get(
  "/employees/:id/overview",
  requireManager,
  asyncHandler(async (req, res) => {
    const { companyId } = (req as AuthRequest).auth,
      id = uuid.parse(req.params.id);
    const employee = (
      await pool.query(
        `SELECT e.id,e.full_name AS name,e.job_title AS "jobTitle",e.status,e.salary_type AS "salaryType",e.base_salary AS "baseSalary",e.hourly_rate AS "hourlyRate",c.currency,(now() AT TIME ZONE c.timezone)::date::text AS today,c.timezone FROM employees e JOIN companies c ON c.id=e.company_id WHERE e.id=$1 AND e.company_id=$2`,
        [id, companyId],
      )
    ).rows[0];
    if (!employee) throw new HttpError(404, "Employee not found");
    const periods = (
      await pool.query(
        `WITH bounds AS (SELECT 'day' AS period,$2::date AS start,$2::date AS finish UNION ALL SELECT 'week',date_trunc('week',$2::date)::date,(date_trunc('week',$2::date)+interval '6 days')::date UNION ALL SELECT 'month',date_trunc('month',$2::date)::date,(date_trunc('month',$2::date)+interval '1 month - 1 day')::date) SELECT b.period,w.* FROM bounds b CROSS JOIN LATERAL workforce_summary($1,b.start,b.finish) w WHERE w.employee_id=$3`,
        [companyId, employee.today, id],
      )
    ).rows;
    const [shifts, punches, tasks] = await Promise.all([
      pool.query(
        `SELECT id,starts_at AS "startsAt",ends_at AS "endsAt",status FROM shifts WHERE company_id=$1 AND employee_id=$2 AND status<>'CANCELLED' AND (starts_at AT TIME ZONE $4)::date BETWEEN $3::date AND $3::date+6 ORDER BY starts_at`,
        [companyId, id, employee.today, employee.timezone],
      ),
      pool.query(
        `SELECT id,event_type AS "eventType",occurred_at AS "occurredAt" FROM punches WHERE company_id=$1 AND employee_id=$2 AND (occurred_at AT TIME ZONE $4)::date=$3 ORDER BY occurred_at`,
        [companyId, id, employee.today, employee.timezone],
      ),
      pool.query(
        `SELECT id,title,status,due_at AS "dueAt",priority FROM employee_tasks WHERE company_id=$1 AND employee_id=$2 ORDER BY status='DONE',due_at LIMIT 100`,
        [companyId, id],
      ),
    ]);
    res.json({
      data: {
        employee,
        periods,
        shifts: shifts.rows,
        punches: punches.rows,
        tasks: tasks.rows,
      },
    });
  }),
);

const kind = z.enum([
  "announcements",
  "discussions",
  "checklists",
  "surveys",
  "documents",
  "trips",
]);
export const collaborationSchema = z
  .object({
    kind,
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(10000).default(""),
    employeeId: uuid.nullable().default(null),
    details: z
      .object({
        items: z
          .array(z.string().trim().min(1).max(300))
          .min(1)
          .max(50)
          .optional(),
        options: z
          .array(z.string().trim().min(1).max(200))
          .min(2)
          .max(10)
          .optional(),
        destination: z.string().trim().min(1).max(200).optional(),
        startsOn: z.string().date().optional(),
        endsOn: z.string().date().optional(),
      })
      .strict()
      .default({}),
    file: z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[^\\/\r\n]+$/),
        mime: z.enum([
          "application/pdf",
          "image/png",
          "image/jpeg",
          "text/plain",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ]),
        base64: z
          .string()
          .min(4)
          .max(2700000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .optional(),
  })
  .superRefine((v, c) => {
    const fail = (message: string) => c.addIssue({ code: "custom", message });
    if (v.kind === "checklists" && !v.details.items)
      fail("Checklist items are required");
    if (v.kind === "surveys" && !v.details.options)
      fail("Survey options are required");
    if (
      v.kind === "trips" &&
      (!v.details.destination ||
        !v.details.startsOn ||
        !v.details.endsOn ||
        v.details.startsOn > v.details.endsOn ||
        !v.employeeId)
    )
      fail("Select an employee, destination and valid trip dates");
    if (v.kind === "documents" && !v.file) fail("Attach a document");
    if (v.file && v.kind !== "documents")
      fail("Attachments are supported for documents");
  });
async function visibleItem(id: string, auth: AuthRequest["auth"]) {
  const r = await pool.query(
    `SELECT i.*,u.display_name AS author FROM collaboration_items i JOIN users u ON u.id=i.created_by LEFT JOIN employees e ON e.id=i.employee_id WHERE i.id=$1 AND i.company_id=$2 AND ($3::boolean OR i.employee_id IS NULL OR e.user_id=$4)`,
    [id, auth.companyId, auth.role !== "EMPLOYEE", auth.sub],
  );
  if (!r.rows[0]) throw new HttpError(404, "Item not found");
  return r.rows[0];
}
mobileManagementRouter.get(
  "/collaboration",
  asyncHandler(async (req, res) => {
    const k = kind.parse(req.query.kind),
      { companyId, sub, role } = (req as AuthRequest).auth;
    const r = await pool.query(
      `SELECT i.id,i.kind,i.title,i.body,i.details,i.status,i.employee_id AS "employeeId",e.full_name AS employee,u.display_name AS author,i.created_at AS "createdAt",r.value AS response,(SELECT count(*)::int FROM collaboration_comments c WHERE c.item_id=i.id) AS "commentCount" FROM collaboration_items i JOIN users u ON u.id=i.created_by LEFT JOIN employees e ON e.id=i.employee_id LEFT JOIN collaboration_responses r ON r.item_id=i.id AND r.user_id=$3 WHERE i.company_id=$1 AND i.kind=$2 AND ($4::boolean OR i.employee_id IS NULL OR e.user_id=$3) ORDER BY i.created_at DESC LIMIT 200`,
      [companyId, k, sub, role !== "EMPLOYEE"],
    );
    res.json({ data: r.rows });
  }),
);
mobileManagementRouter.post(
  "/collaboration",
  asyncHandler(async (req, res) => {
    const v = collaborationSchema.parse(req.body),
      a = (req as AuthRequest).auth;
    if (a.role === "EMPLOYEE" && !["discussions", "trips"].includes(v.kind))
      throw new HttpError(403, "Manager access required");
    if (v.employeeId) {
      const e = (
        await pool.query(
          "SELECT user_id FROM employees WHERE id=$1 AND company_id=$2 AND status<>'INACTIVE'",
          [v.employeeId, a.companyId],
        )
      ).rows[0];
      if (!e) throw new HttpError(404, "Employee not found");
      if (a.role === "EMPLOYEE" && e.user_id !== a.sub)
        throw new HttpError(403, "Select your own profile");
    }
    if (a.role === "EMPLOYEE" && v.kind === "discussions" && v.employeeId)
      throw new HttpError(400, "Discussions are shared with the company");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const row = (
        await c.query(
          `INSERT INTO collaboration_items(company_id,kind,title,body,employee_id,details,created_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            a.companyId,
            v.kind,
            v.title,
            v.body,
            v.employeeId,
            JSON.stringify(v.details),
            a.sub,
            v.kind === "trips" ? "PENDING" : "OPEN",
          ],
        )
      ).rows[0];
      if (v.file) {
        const content = Buffer.from(v.file.base64, "base64");
        if (content.length > 2000000)
          throw new HttpError(400, "Maximum file size is 2 MB");
        await c.query(
          "INSERT INTO collaboration_files(item_id,filename,mime,content) VALUES($1,$2,$3,$4)",
          [row.id, v.file.name, v.file.mime, content],
        );
      }
      await c.query(
        `INSERT INTO push_events(company_id,user_id,title,body,action) SELECT $1,u.id,'New workplace update','Open the app to view details.',$2 FROM users u LEFT JOIN employees e ON e.user_id=u.id AND e.company_id=u.company_id WHERE u.company_id=$1 AND u.active AND u.id<>$3 AND ($4::uuid IS NULL OR e.id=$4 OR u.role IN ('ADMIN','MANAGER'))`,
        [a.companyId, v.kind, a.sub, v.employeeId],
      );
      await c.query("COMMIT");
      res.status(201).json({ data: row });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }),
);
mobileManagementRouter.get(
  "/collaboration/:id",
  asyncHandler(async (req, res) => {
    const a = (req as AuthRequest).auth,
      id = uuid.parse(req.params.id),
      item = await visibleItem(id, a);
    const comments = (
      await pool.query(
        'SELECT c.id,c.body,c.created_at AS "createdAt",u.display_name AS author FROM collaboration_comments c JOIN users u ON u.id=c.user_id WHERE item_id=$1 ORDER BY c.created_at LIMIT 500',
        [id],
      )
    ).rows;
    const responses = (
      await pool.query(
        'SELECT r.value,u.display_name AS name,r.user_id AS "userId" FROM collaboration_responses r JOIN users u ON u.id=r.user_id WHERE item_id=$1',
        [id],
      )
    ).rows;
    const file = (
      await pool.query(
        "SELECT filename,mime FROM collaboration_files WHERE item_id=$1",
        [id],
      )
    ).rows[0];
    // Employees see aggregate survey counts, never other people's votes or checklist progress.
    res.json({
      data: {
        ...item,
        comments,
        file,
        response: responses.find((r) => r.userId === a.sub)?.value ?? null,
        responses: a.role === "EMPLOYEE" ? undefined : responses,
        counts:
          item.kind === "surveys"
            ? (item.details.options as string[]).map(
                (_, i) => responses.filter((r) => r.value.option === i).length,
              )
            : undefined,
      },
    });
  }),
);
mobileManagementRouter.post(
  "/collaboration/:id/comments",
  asyncHandler(async (req, res) => {
    const a = (req as AuthRequest).auth,
      id = uuid.parse(req.params.id);
    await visibleItem(id, a);
    const { body } = z
      .object({ body: z.string().trim().min(1).max(4000) })
      .parse(req.body);
    const r = await pool.query(
      "INSERT INTO collaboration_comments(item_id,user_id,body) VALUES($1,$2,$3) RETURNING id",
      [id, a.sub, body],
    );
    res.status(201).json({ data: r.rows[0] });
  }),
);
mobileManagementRouter.put(
  "/collaboration/:id/response",
  asyncHandler(async (req, res) => {
    const a = (req as AuthRequest).auth,
      id = uuid.parse(req.params.id),
      item = await visibleItem(id, a);
    if (item.status !== "OPEN") throw new HttpError(409, "Item is closed");
    let value: unknown;
    if (item.kind === "surveys")
      value = z
        .object({
          option: z
            .number()
            .int()
            .min(0)
            .max(item.details.options.length - 1),
        })
        .strict()
        .parse(req.body);
    else if (item.kind === "checklists")
      value = z
        .object({
          checked: z
            .array(
              z
                .number()
                .int()
                .min(0)
                .max(item.details.items.length - 1),
            )
            .max(50)
            .transform((v) => [...new Set(v)]),
        })
        .strict()
        .parse(req.body);
    else if (item.kind === "documents" || item.kind === "announcements")
      value = z
        .object({ acknowledged: z.literal(true) })
        .strict()
        .parse(req.body);
    else throw new HttpError(400, "Responses are not supported here");
    await pool.query(
      "INSERT INTO collaboration_responses(item_id,user_id,value) VALUES($1,$2,$3) ON CONFLICT(item_id,user_id) DO UPDATE SET value=excluded.value,updated_at=now()",
      [id, a.sub, JSON.stringify(value)],
    );
    res.json({ data: value });
  }),
);
mobileManagementRouter.patch(
  "/collaboration/:id/status",
  requireManager,
  asyncHandler(async (req, res) => {
    const a = (req as AuthRequest).auth,
      id = uuid.parse(req.params.id),
      item = await visibleItem(id, a);
    const v = z
      .object({
        status: z.enum(["OPEN", "CLOSED", "APPROVED", "REJECTED"]),
        note: z.string().trim().max(2000).default(""),
      })
      .parse(req.body);
    if (
      item.kind === "trips"
        ? !["APPROVED", "REJECTED"].includes(v.status) || v.note.length < 3
        : !["OPEN", "CLOSED"].includes(v.status)
    )
      throw new HttpError(400, "Invalid decision or missing note");
    await pool.query(
      `UPDATE collaboration_items SET status=$2,details=details||jsonb_build_object('decisionNote',$3::text),updated_at=now() WHERE id=$1`,
      [id, v.status, v.note],
    );
    if (item.employee_id)
      await pool.query(
        `INSERT INTO push_events(company_id,user_id,title,body,action) SELECT $1,user_id,'Trip request reviewed','Open the app to view the decision.','trips' FROM employees WHERE id=$2 AND user_id IS NOT NULL`,
        [a.companyId, item.employee_id],
      );
    res.json({ data: { id, status: v.status } });
  }),
);
mobileManagementRouter.get(
  "/collaboration/:id/file",
  asyncHandler(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await visibleItem(id, (req as AuthRequest).auth);
    const f = (
      await pool.query("SELECT * FROM collaboration_files WHERE item_id=$1", [
        id,
      ])
    ).rows[0];
    if (!f) throw new HttpError(404, "File not found");
    res.setHeader("Content-Type", f.mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(f.content);
  }),
);
