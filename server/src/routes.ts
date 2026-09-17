import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  requireAuth,
  requireManager,
  signAccessToken,
  type AuthRequest,
} from "./auth.js";
import { pool } from "./db.js";
import { asyncHandler, HttpError } from "./http.js";
import { employeeRouter } from "./employeeRoutes.js";
import { taskRouter } from "./taskRoutes.js";
import { weeklyRouter } from "./weeklySchedules.js";
import { mobileManagementRouter } from "./mobileManagementRoutes.js";
import { pushRouter } from "./push.js";
import { webPunchRouter } from "./webPunchRoutes.js";
import { notificationRouter } from "./notificationRoutes.js";
import { sendPasswordReset } from "./mailer.js";
import { config } from "./config.js";
import { createAccountToken, hashAccountToken } from "./accountSecurity.js";
import { advancedRouter } from "./advancedRoutes.js";
import { localize } from "./localization.js";
import { bindOrVerifyMobileDevice } from "./mobileVerification.js";

export const apiRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.NODE_ENV === "production" ? 10 : 100,
  keyGenerator: (request) =>
    String(request.body?.email ?? "anonymous")
      .trim()
      .toLowerCase(),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request, response) =>
    response.status(429).json({
      error: {
        code: "LOGIN_RATE_LIMITED",
        message: localize(
          request,
          "Too many sign-in attempts. Try again later",
        ),
      },
    }),
});
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request, response) =>
    response.status(429).json({
      error: {
        code: "RECOVERY_RATE_LIMITED",
        message: localize(
          request,
          "Too many recovery attempts. Try again later",
        ),
      },
    }),
});
const loginSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    clientType: z.enum(["WEB", "MOBILE"]).default("WEB"),
    deviceInstallationId: z.string().min(32).max(160).optional(),
    devicePlatform: z.enum(["ANDROID", "IOS"]).optional(),
    deviceLabel: z.string().trim().min(2).max(120).optional(),
  })
  .superRefine((value, context) => {
    if (value.clientType === "MOBILE") {
      for (const field of [
        "deviceInstallationId",
        "devicePlatform",
        "deviceLabel",
      ] as const)
        if (!value[field])
          context.addIssue({
            code: "custom",
            path: [field],
            message: "Required for mobile sign-in",
          });
    }
  });

apiRouter.post(
  "/auth/login",
  loginLimiter,
  asyncHandler(async (request, response) => {
    const input = loginSchema.parse(request.body);
    const result = await pool.query<{
      id: string;
      company_id: string;
      email: string;
      password_hash: string;
      display_name: string;
      role: "ADMIN" | "MANAGER" | "EMPLOYEE";
      company_name: string;
      token_version: number;
      must_change_password: boolean;
    }>(
      `SELECT u.id,u.company_id,u.email,u.password_hash,u.display_name,u.role,u.token_version,u.must_change_password,c.name AS company_name FROM users u JOIN companies c ON c.id=u.company_id WHERE lower(u.email)=lower($1) AND u.active=true LIMIT 1`,
      [input.email],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(input.password, user.password_hash)))
      throw new HttpError(401, "Invalid email or password");
    if (input.clientType === "MOBILE" && user.role === "EMPLOYEE") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const employee = await client.query<{ id: string }>(
          `SELECT id FROM employees WHERE user_id=$1 AND company_id=$2 AND status<>'INACTIVE' FOR UPDATE`,
          [user.id, user.company_id],
        );
        if (!employee.rows[0])
          throw new HttpError(
            403,
            "No active employee profile is linked to this account",
          );
        await bindOrVerifyMobileDevice(client, {
          companyId: user.company_id,
          userId: user.id,
          employeeId: employee.rows[0].id,
          installationId: input.deviceInstallationId!,
          platform: input.devicePlatform!,
          deviceLabel: input.deviceLabel!,
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    const token = signAccessToken({
      sub: user.id,
      companyId: user.company_id,
      role: user.role,
      email: user.email,
      tokenVersion: user.token_version,
    });
    response.json({
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
          mustChangePassword: user.must_change_password,
          company: { id: user.company_id, name: user.company_name },
        },
      },
    });
  }),
);

apiRouter.post(
  "/auth/forgot-password",
  recoveryLimiter,
  asyncHandler(async (request, response) => {
    const input = z
      .object({ email: z.string().trim().email() })
      .parse(request.body);
    const result = await pool.query<{
      id: string;
      email: string;
      display_name: string;
    }>(
      `SELECT id,email,display_name FROM users WHERE lower(email)=lower($1) AND active=true LIMIT 1`,
      [input.email],
    );
    const user = result.rows[0];
    if (user) {
      const token = createAccountToken();
      await pool.query(
        "UPDATE account_tokens SET used_at=now() WHERE user_id=$1 AND purpose='PASSWORD_RESET' AND used_at IS NULL",
        [user.id],
      );
      await pool.query(
        `INSERT INTO account_tokens(user_id,token_hash,purpose,expires_at,requested_ip) VALUES($1,$2,'PASSWORD_RESET',now()+interval '30 minutes',$3)`,
        [user.id, hashAccountToken(token), request.ip ?? null],
      );
      await sendPasswordReset({
        email: user.email,
        name: user.display_name,
        token,
      });
    }
    response.json({
      data: {
        accepted: true,
        message: "If an active account exists, a reset link has been sent.",
      },
    });
  }),
);

apiRouter.post(
  "/auth/reset-password",
  recoveryLimiter,
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/i),
        newPassword: z.string().min(10).max(128),
      })
      .parse(request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string;
        user_id: string;
        company_id: string;
      }>(
        `SELECT t.id,t.user_id,u.company_id FROM account_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.purpose='PASSWORD_RESET' AND t.used_at IS NULL AND t.expires_at>now() AND u.active=true FOR UPDATE`,
        [hashAccountToken(input.token)],
      );
      const reset = result.rows[0];
      if (!reset)
        throw new HttpError(400, "This reset link is invalid or has expired");
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await client.query(
        "UPDATE users SET password_hash=$1,must_change_password=false,token_version=token_version+1,updated_at=now() WHERE id=$2",
        [passwordHash, reset.user_id],
      );
      await client.query(
        "UPDATE account_tokens SET used_at=now() WHERE id=$1",
        [reset.id],
      );
      await client.query(
        "UPDATE account_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [reset.user_id],
      );
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'PASSWORD_RESET','USER',$2)`,
        [reset.company_id, reset.user_id],
      );
      await client.query("COMMIT");
      response.json({ data: { changed: true } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

apiRouter.use(requireAuth);
apiRouter.use(weeklyRouter);
apiRouter.use(taskRouter);
apiRouter.use(mobileManagementRouter);
apiRouter.use(pushRouter);
apiRouter.use(webPunchRouter);
apiRouter.use(employeeRouter);
apiRouter.use(notificationRouter);
apiRouter.use(advancedRouter);

apiRouter.get(
  "/auth/me",
  asyncHandler(async (request, response) => {
    const { sub, companyId } = (request as AuthRequest).auth;
    const result = await pool.query(
      `SELECT u.id,u.email,u.display_name AS "displayName",u.role,u.must_change_password AS "mustChangePassword",c.id AS "companyId",c.name AS "companyName",c.timezone,c.currency,c.annual_leave_days AS "annualLeaveDays",c.default_income_tax_rate::float AS "defaultIncomeTaxRate",c.correction_window_days AS "correctionWindowDays" FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=$1 AND u.company_id=$2 AND u.active=true`,
      [sub, companyId],
    );
    if (!result.rows[0]) throw new HttpError(401, "User is no longer active");
    response.json({ data: result.rows[0] });
  }),
);

const passwordSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(10).max(128),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "New password must be different",
    path: ["newPassword"],
  });

apiRouter.patch(
  "/auth/password",
  asyncHandler(async (request, response) => {
    const input = passwordSchema.parse(request.body);
    const { sub, companyId } = (request as AuthRequest).auth;
    const user = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1 AND company_id=$2 AND active=true",
      [sub, companyId],
    );
    if (
      !user.rows[0] ||
      !(await bcrypt.compare(input.currentPassword, user.rows[0].password_hash))
    )
      throw new HttpError(400, "Current password is incorrect");
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE users SET password_hash=$1,must_change_password=false,token_version=token_version+1,updated_at=now() WHERE id=$2 AND company_id=$3",
        [passwordHash, sub, companyId],
      );
      await client.query(
        "INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'PASSWORD_CHANGED','USER',$2)",
        [companyId, sub],
      );
      await client.query("COMMIT");
      response.json({ data: { changed: true } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

apiRouter.get(
  "/meta",
  asyncHandler(async (request, response) => {
    const { companyId } = (request as AuthRequest).auth;
    const includeInactive = request.query.includeInactive === "true";
    const [departments, locations] = await Promise.all([
      pool.query(
        `SELECT id,name FROM departments WHERE company_id=$1 ORDER BY name`,
        [companyId],
      ),
      pool.query(
        `SELECT id,name,address,latitude,longitude,geofence_radius_m AS "geofenceRadiusM",active FROM locations WHERE company_id=$1 AND ($2::boolean OR active=true) ORDER BY active DESC,name`,
        [companyId, includeInactive],
      ),
    ]);
    response.json({
      data: { departments: departments.rows, locations: locations.rows },
    });
  }),
);

apiRouter.get(
  "/audit",
  requireManager,
  asyncHandler(async (request, response) => {
    const { companyId } = (request as AuthRequest).auth;
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .parse(request.query.limit);
    const result = await pool.query(
      `SELECT a.id,a.action,a.entity_type AS "entityType",a.entity_id AS "entityId",a.created_at AS "createdAt",u.display_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.company_id=$1 ORDER BY a.created_at DESC LIMIT $2`,
      [companyId, limit],
    );
    response.json({ data: result.rows });
  }),
);

apiRouter.get(
  "/integrations/status",
  requireManager,
  asyncHandler(async (request, response) => {
    const { companyId } = (request as AuthRequest).auth;
    const registeredDevices = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM devices WHERE company_id=$1 AND active=true",
      [companyId],
    );
    const pending = (configured: boolean, configuration: string) => ({
      configured,
      configuration,
      state: configured ? "CREDENTIALS_PRESENT" : "NOT_CONFIGURED",
    });
    response.json({
      data: {
        email: {
          configured: Boolean(config.SMTP_URL),
          configuration: "SMTP_URL",
          state: config.SMTP_URL ? "ACTIVE" : "NOT_CONFIGURED",
        },
        telegram: pending(
          Boolean(process.env.TELEGRAM_BOT_TOKEN),
          "TELEGRAM_BOT_TOKEN",
        ),
        devices: {
          configured: (registeredDevices.rows[0]?.count ?? 0) > 0,
          configuration: "Advanced / Devices",
          state:
            (registeredDevices.rows[0]?.count ?? 0) > 0
              ? "ACTIVE"
              : "NOT_CONFIGURED",
        },
      },
    });
  }),
);

const companySchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(2).max(80).default("Asia/Tashkent"),
  currency: z.string().trim().length(3).default("UZS"),
  annualLeaveDays: z.number().int().min(0).max(365),
  defaultIncomeTaxRate: z.number().min(0).max(100),
  correctionWindowDays: z.number().int().min(1).max(365),
});
apiRouter.patch(
  "/company",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = companySchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    const result = await pool.query(
      `UPDATE companies SET name=$1,timezone=$2,currency=upper($3),annual_leave_days=$4,default_income_tax_rate=$5,correction_window_days=$6,updated_at=now() WHERE id=$7 RETURNING id,name,timezone,currency,annual_leave_days AS "annualLeaveDays",default_income_tax_rate::float AS "defaultIncomeTaxRate",correction_window_days AS "correctionWindowDays"`,
      [
        input.name,
        input.timezone,
        input.currency,
        input.annualLeaveDays,
        input.defaultIncomeTaxRate,
        input.correctionWindowDays,
        companyId,
      ],
    );
    await pool.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'COMPANY_UPDATED','COMPANY',$1,$3)`,
      [companyId, sub, JSON.stringify(result.rows[0])],
    );
    response.json({ data: result.rows[0] });
  }),
);

const departmentSchema = z.object({ name: z.string().trim().min(2).max(80) });
apiRouter.post(
  "/departments",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = departmentSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    try {
      const result = await pool.query(
        `INSERT INTO departments(company_id,name) VALUES($1,$2) RETURNING id,name`,
        [companyId, input.name],
      );
      await pool.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'DEPARTMENT_CREATED','DEPARTMENT',$3,$4)`,
        [companyId, sub, result.rows[0].id, JSON.stringify(result.rows[0])],
      );
      response.status(201).json({ data: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new HttpError(409, "This department already exists");
      throw error;
    }
  }),
);

apiRouter.patch(
  "/departments/:id",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = departmentSchema.parse(request.body);
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub } = (request as AuthRequest).auth;
    try {
      const previous = await pool.query(
        `SELECT id,name FROM departments WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );
      if (!previous.rows[0]) throw new HttpError(404, "Department not found");
      const result = await pool.query(
        `UPDATE departments SET name=$1 WHERE id=$2 AND company_id=$3 RETURNING id,name`,
        [input.name, id, companyId],
      );
      await pool.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'DEPARTMENT_UPDATED','DEPARTMENT',$3,$4,$5)`,
        [
          companyId,
          sub,
          id,
          JSON.stringify(previous.rows[0]),
          JSON.stringify(result.rows[0]),
        ],
      );
      response.json({ data: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new HttpError(409, "This department already exists");
      throw error;
    }
  }),
);

const locationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(250).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geofenceRadiusM: z.number().int().min(10).max(5000).default(150),
});
apiRouter.post(
  "/locations",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = locationSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    try {
      const result = await pool.query(
        `INSERT INTO locations(company_id,name,address,latitude,longitude,geofence_radius_m) VALUES($1,$2,NULLIF($3,''),$4,$5,$6) RETURNING id,name,address,latitude,longitude,geofence_radius_m AS "geofenceRadiusM"`,
        [
          companyId,
          input.name,
          input.address ?? "",
          input.latitude,
          input.longitude,
          input.geofenceRadiusM,
        ],
      );
      await pool.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'LOCATION_CREATED','LOCATION',$3,$4)`,
        [companyId, sub, result.rows[0].id, JSON.stringify(result.rows[0])],
      );
      response.status(201).json({ data: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new HttpError(409, "This location already exists");
      throw error;
    }
  }),
);

const locationUpdateSchema = locationSchema.extend({ active: z.boolean() });
apiRouter.patch(
  "/locations/:id",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = locationUpdateSchema.parse(request.body);
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub } = (request as AuthRequest).auth;
    try {
      const previous = await pool.query(
        `SELECT id,name,address,latitude,longitude,geofence_radius_m,active FROM locations WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );
      if (!previous.rows[0]) throw new HttpError(404, "Location not found");
      const result = await pool.query(
        `UPDATE locations SET name=$1,address=NULLIF($2,''),latitude=$3,longitude=$4,geofence_radius_m=$5,active=$6 WHERE id=$7 AND company_id=$8 RETURNING id,name,address,latitude,longitude,geofence_radius_m AS "geofenceRadiusM",active`,
        [
          input.name,
          input.address ?? "",
          input.latitude,
          input.longitude,
          input.geofenceRadiusM,
          input.active,
          id,
          companyId,
        ],
      );
      await pool.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'LOCATION_UPDATED','LOCATION',$3,$4,$5)`,
        [
          companyId,
          sub,
          id,
          JSON.stringify(previous.rows[0]),
          JSON.stringify(result.rows[0]),
        ],
      );
      response.json({ data: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new HttpError(409, "This location already exists");
      throw error;
    }
  }),
);

apiRouter.get(
  "/dashboard",
  requireManager,
  asyncHandler(async (request, response) => {
    const { companyId } = (request as AuthRequest).auth;
    const [summary, week] = await Promise.all([
      pool.query(
        `SELECT
      (SELECT count(*)::int FROM employees WHERE company_id=$1 AND status='ACTIVE') AS "activeEmployees",
      (SELECT count(*)::int FROM employees WHERE company_id=$1 AND status<>'INACTIVE') AS "totalEmployees",
      (SELECT count(*)::int FROM employee_tasks WHERE company_id=$1 AND status<>'DONE') AS "activeTasks",
      (SELECT count(*)::int FROM employee_tasks WHERE company_id=$1 AND status='DONE') AS "completedTasks",
      (SELECT COALESCE(sum(w.worked_minutes),0)::float/60 FROM companies c CROSS JOIN LATERAL workforce_summary($1,date_trunc('month',now() AT TIME ZONE c.timezone)::date,(date_trunc('month',now() AT TIME ZONE c.timezone)+interval '1 month - 1 day')::date) w WHERE c.id=$1) AS "monthlyHours",
      (SELECT COALESCE(sum(w.salary),0)::float FROM companies c CROSS JOIN LATERAL workforce_summary($1,date_trunc('month',now() AT TIME ZONE c.timezone)::date,(date_trunc('month',now() AT TIME ZONE c.timezone)+interval '1 month - 1 day')::date) w WHERE c.id=$1) AS "monthlySalary",
      (SELECT currency FROM companies WHERE id=$1) AS currency,
      (SELECT count(DISTINCT employee_id)::int FROM punches WHERE company_id=$1 AND occurred_at::date=CURRENT_DATE AND event_type='CLOCK_IN') AS "workingToday",
      (SELECT count(*)::int FROM employees e JOIN LATERAL (SELECT p.event_type FROM punches p WHERE p.company_id=$1 AND p.employee_id=e.id AND p.event_type IN ('CLOCK_IN','CLOCK_OUT') AND p.occurred_at<=now() ORDER BY p.occurred_at DESC, p.created_at DESC LIMIT 1) latest ON latest.event_type='CLOCK_IN' WHERE e.company_id=$1 AND e.status='ACTIVE') AS "workingNow",
      (SELECT count(*)::int FROM shifts s JOIN LATERAL (SELECT occurred_at FROM punches p WHERE p.shift_id=s.id AND p.event_type='CLOCK_IN' ORDER BY occurred_at LIMIT 1) pin ON true WHERE s.company_id=$1 AND s.starts_at::date=CURRENT_DATE AND pin.occurred_at>s.starts_at+(s.grace_minutes||' minutes')::interval) AS "lateToday",
      (SELECT count(*)::int FROM shifts s JOIN employees e ON e.id=s.employee_id LEFT JOIN punches p ON p.shift_id=s.id AND p.event_type='CLOCK_IN' WHERE s.company_id=$1 AND s.starts_at::date=CURRENT_DATE AND s.status<>'CANCELLED' AND e.status='ACTIVE' AND p.id IS NULL AND NOT EXISTS(SELECT 1 FROM leave_requests lr WHERE lr.company_id=$1 AND lr.employee_id=e.id AND lr.status='APPROVED' AND CURRENT_DATE BETWEEN lr.starts_on AND lr.ends_on)) AS "absentToday",
      (SELECT count(*)::int FROM employees e WHERE e.company_id=$1 AND (e.status='ON_LEAVE' OR EXISTS(SELECT 1 FROM leave_requests lr WHERE lr.company_id=$1 AND lr.employee_id=e.id AND lr.status='APPROVED' AND CURRENT_DATE BETWEEN lr.starts_on AND lr.ends_on))) AS "approvedLeave",
      (SELECT count(*)::int FROM attendance_exceptions WHERE company_id=$1 AND status='PENDING') AS "openExceptions",
      (SELECT count(*)::int FROM payslips p JOIN payroll_periods pp ON pp.id=p.payroll_period_id WHERE p.company_id=$1 AND pp.starts_on<=CURRENT_DATE AND pp.ends_on>=CURRENT_DATE AND p.status='REVIEW') AS "payrollReviews"`,
        [companyId],
      ),
      pool.query(
        `WITH days AS (
      SELECT generate_series(CURRENT_DATE-interval '6 days',CURRENT_DATE,interval '1 day')::date AS day
    ), daily AS (
      SELECT d.day,count(s.id)::int AS scheduled,count(pin.employee_id)::int AS clocked_in,
        count(pin.employee_id) FILTER (WHERE pin.occurred_at>s.starts_at+(s.grace_minutes||' minutes')::interval)::int AS late
      FROM days d
      LEFT JOIN shifts s ON s.company_id=$1 AND s.starts_at::date=d.day AND s.status<>'CANCELLED'
      LEFT JOIN LATERAL (SELECT p.employee_id,p.occurred_at FROM punches p WHERE p.shift_id=s.id AND p.event_type='CLOCK_IN' ORDER BY p.occurred_at LIMIT 1) pin ON true
      GROUP BY d.day
    ) SELECT to_char(day,'Dy') AS day,GREATEST(clocked_in-late,0)::int AS present,late,GREATEST(scheduled-clocked_in,0)::int AS absent FROM daily ORDER BY day`,
        [companyId],
      ),
    ]);
    response.json({
      data: { ...summary.rows[0], weeklyAttendance: week.rows },
    });
  }),
);

apiRouter.get(
  "/employees",
  requireManager,
  asyncHandler(async (request, response) => {
    const { companyId } = (request as AuthRequest).auth;
    const status = z
      .enum(["ACTIVE", "ON_LEAVE", "INVITED", "INACTIVE"])
      .optional()
      .parse(request.query.status);
    const values: unknown[] = [companyId];
    let where = "e.company_id=$1";
    if (status) {
      values.push(status);
      where += ` AND e.status=$${values.length}`;
    }
    const result = await pool.query(
      `SELECT e.id,e.employee_number AS "employeeNumber",e.full_name AS name,e.phone,e.email,e.job_title AS "jobTitle",e.access_role AS "accessRole",e.status,e.joined_on AS "joinedOn",e.salary_type AS "salaryType",e.base_salary AS "baseSalary",e.hourly_rate AS "hourlyRate",u.email AS "accountEmail",COALESCE(u.active,false) AS "accountActive",d.id AS "departmentId",d.name AS department,l.id AS "locationId",l.name AS location,COALESCE((SELECT json_agg(json_build_object('id',sl.id,'name',sl.name) ORDER BY sl.name) FROM employee_locations el JOIN locations sl ON sl.id=el.location_id WHERE el.employee_id=e.id),'[]') AS "secondaryLocations" FROM employees e LEFT JOIN users u ON u.id=e.user_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN locations l ON l.id=e.primary_location_id WHERE ${where} ORDER BY e.created_at DESC`,
      values,
    );
    response.json({ data: result.rows });
  }),
);

const employeeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().regex(/^\+998\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}$/),
  email: z.string().email().or(z.literal("")).optional(),
  jobTitle: z.string().trim().min(2).max(80),
  departmentId: z.string().uuid(),
  locationId: z.string().uuid(),
  secondaryLocationIds: z.array(z.string().uuid()).max(50).default([]),
  accessRole: z
    .enum(["EMPLOYEE", "LOCATION_MANAGER", "ADMINISTRATOR"])
    .default("EMPLOYEE"),
  salaryType: z.enum(["MONTHLY", "HOURLY"]).default("MONTHLY"),
  baseSalary: z.number().int().min(0).default(0),
  hourlyRate: z.number().int().min(0).default(0),
});
apiRouter.post(
  "/employees",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = employeeSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT id FROM companies WHERE id=$1 FOR UPDATE`, [
        companyId,
      ]);
      const count = await client.query<{ next: number }>(
        `SELECT count(*)::int + 1 AS next FROM employees WHERE company_id=$1`,
        [companyId],
      );
      const result = await client.query(
        `INSERT INTO employees(company_id,employee_number,full_name,phone,email,job_title,department_id,primary_location_id,access_role,status,joined_on,base_salary,hourly_rate,salary_type) SELECT $1,$2,$3,$4,NULLIF($5,''),$6,d.id,l.id,$9,'ACTIVE',CURRENT_DATE,$10,$11,$12 FROM departments d CROSS JOIN locations l WHERE d.id=$7 AND d.company_id=$1 AND l.id=$8 AND l.company_id=$1 RETURNING id,employee_number AS "employeeNumber",full_name AS name,phone,email,job_title AS "jobTitle",access_role AS "accessRole",status,base_salary AS "baseSalary",hourly_rate AS "hourlyRate"`,
        [
          companyId,
          `NR-${String(count.rows[0].next).padStart(4, "0")}`,
          input.name,
          input.phone,
          input.email ?? "",
          input.jobTitle,
          input.departmentId,
          input.locationId,
          input.accessRole,
          input.baseSalary,
          input.hourlyRate,
          input.salaryType,
        ],
      );
      if (!result.rows[0])
        throw new HttpError(
          400,
          "Department or location is not valid for this company",
        );
      if (input.secondaryLocationIds.length) {
        const inserted = await client.query(
          `INSERT INTO employee_locations(employee_id,location_id) SELECT $1,l.id FROM locations l WHERE l.company_id=$2 AND l.active=true AND l.id=ANY($3::uuid[]) AND l.id<>$4 RETURNING location_id`,
          [
            result.rows[0].id,
            companyId,
            input.secondaryLocationIds,
            input.locationId,
          ],
        );
        const expected = new Set(
          input.secondaryLocationIds.filter(
            (locationId) => locationId !== input.locationId,
          ),
        ).size;
        if (inserted.rowCount !== expected)
          throw new HttpError(
            400,
            "One or more secondary locations are invalid or inactive",
          );
      }
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES ($1,$2,'EMPLOYEE_CREATED','EMPLOYEE',$3,$4)`,
        [companyId, sub, result.rows[0].id, JSON.stringify(result.rows[0])],
      );
      await client.query("COMMIT");
      response.status(201).json({ data: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new HttpError(
          409,
          "An employee with this phone number already exists",
        );
      throw error;
    } finally {
      client.release();
    }
  }),
);

const employeeUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z
      .string()
      .regex(/^\+998\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}$/)
      .optional(),
    email: z.string().email().or(z.literal("")).optional(),
    departmentId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
    secondaryLocationIds: z.array(z.string().uuid()).max(50).optional(),
    status: z.enum(["ACTIVE", "ON_LEAVE", "INACTIVE"]).optional(),
    accessRole: z
      .enum(["EMPLOYEE", "LOCATION_MANAGER", "ADMINISTRATOR"])
      .optional(),
    jobTitle: z.string().trim().min(2).max(80).optional(),
    salaryType: z.enum(["MONTHLY", "HOURLY"]).optional(),
    baseSalary: z.number().int().min(0).optional(),
    hourlyRate: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one employee change",
  });
apiRouter.patch(
  "/employees/:id",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = employeeUpdateSchema.parse(request.body);
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub } = (request as AuthRequest).auth;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query(
        `SELECT full_name,phone,email,department_id,primary_location_id,status,access_role,job_title,base_salary,hourly_rate,user_id FROM employees WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!previous.rows[0]) throw new HttpError(404, "Employee not found");
      if (input.departmentId) {
        const valid = await client.query(
          `SELECT id FROM departments WHERE id=$1 AND company_id=$2`,
          [input.departmentId, companyId],
        );
        if (!valid.rows[0])
          throw new HttpError(400, "Department is not valid for this company");
      }
      if (input.locationId) {
        const valid = await client.query(
          `SELECT id FROM locations WHERE id=$1 AND company_id=$2 AND active=true`,
          [input.locationId, companyId],
        );
        if (!valid.rows[0])
          throw new HttpError(400, "Location is not active for this company");
      }
      const result = await client.query(
        `UPDATE employees SET full_name=COALESCE($1,full_name),phone=COALESCE($2,phone),email=CASE WHEN $3::text IS NULL THEN email ELSE NULLIF($3,'') END,department_id=COALESCE($4,department_id),primary_location_id=COALESCE($5,primary_location_id),status=COALESCE($6,status),access_role=COALESCE($7,access_role),job_title=COALESCE($8,job_title),base_salary=COALESCE($9,base_salary),hourly_rate=COALESCE($10,hourly_rate),salary_type=COALESCE($13,salary_type),joined_on=CASE WHEN $6='ACTIVE' AND joined_on IS NULL THEN CURRENT_DATE ELSE joined_on END,updated_at=now() WHERE id=$11 AND company_id=$12 RETURNING id,full_name AS name,phone,email,department_id AS "departmentId",primary_location_id AS "locationId",status,access_role AS "accessRole",job_title AS "jobTitle",base_salary AS "baseSalary",hourly_rate AS "hourlyRate"`,
        [
          input.name ?? null,
          input.phone ?? null,
          input.email ?? null,
          input.departmentId ?? null,
          input.locationId ?? null,
          input.status ?? null,
          input.accessRole ?? null,
          input.jobTitle ?? null,
          input.baseSalary ?? null,
          input.hourlyRate ?? null,
          id,
          companyId,
          input.salaryType ?? null,
        ],
      );
      if (input.secondaryLocationIds) {
        const primaryLocationId =
          input.locationId ?? previous.rows[0].primary_location_id;
        const requested = [
          ...new Set(
            input.secondaryLocationIds.filter(
              (locationId) => locationId !== primaryLocationId,
            ),
          ),
        ];
        const valid = requested.length
          ? await client.query<{ id: string }>(
              `SELECT id FROM locations WHERE company_id=$1 AND active=true AND id=ANY($2::uuid[])`,
              [companyId, requested],
            )
          : { rows: [] as { id: string }[] };
        if (valid.rows.length !== requested.length)
          throw new HttpError(
            400,
            "One or more secondary locations are invalid or inactive",
          );
        await client.query(
          `DELETE FROM employee_locations WHERE employee_id=$1`,
          [id],
        );
        if (requested.length)
          await client.query(
            `INSERT INTO employee_locations(employee_id,location_id) SELECT $1,unnest($2::uuid[])`,
            [id, requested],
          );
      }
      if (
        (input.accessRole || input.name || input.status) &&
        previous.rows[0].user_id
      ) {
        const accountRole =
          input.accessRole === "ADMINISTRATOR"
            ? "ADMIN"
            : input.accessRole === "LOCATION_MANAGER"
              ? "MANAGER"
              : input.accessRole === "EMPLOYEE"
                ? "EMPLOYEE"
                : null;
        await client.query(
          `UPDATE users SET display_name=COALESCE($1,display_name),role=COALESCE($2,role),active=CASE WHEN $3::text IS NULL THEN active ELSE $3<>'INACTIVE' END,token_version=CASE WHEN $2::text IS NULL AND $3::text IS NULL THEN token_version ELSE token_version+1 END,updated_at=now() WHERE id=$4 AND company_id=$5`,
          [
            input.name ?? null,
            accountRole,
            input.status ?? null,
            previous.rows[0].user_id,
            companyId,
          ],
        );
      }
      if (input.status && previous.rows[0].user_id)
        await client.query(
          `UPDATE users SET active=$1,updated_at=now() WHERE id=$2 AND company_id=$3`,
          [input.status !== "INACTIVE", previous.rows[0].user_id, companyId],
        );
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'EMPLOYEE_UPDATED','EMPLOYEE',$3,$4,$5)`,
        [
          companyId,
          sub,
          id,
          JSON.stringify(previous.rows[0]),
          JSON.stringify(result.rows[0]),
        ],
      );
      await client.query("COMMIT");
      response.json({ data: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

apiRouter.get(
  "/attendance",
  requireManager,
  asyncHandler(async (request, response) => {
    const { companyId } = (request as AuthRequest).auth;
    const date = z
      .string()
      .date()
      .default(new Date().toISOString().slice(0, 10))
      .parse(request.query.date);
    const result = await pool.query(
      `SELECT e.id,e.full_name AS name,e.job_title AS role,e.status AS "employmentStatus",l.name AS location,s.starts_at AS "shiftStart",s.ends_at AS "shiftEnd",pin.occurred_at AS "clockIn",pout.occurred_at AS "clockOut",pin.source,pin.within_geofence AS "withinGeofence",pout.within_geofence AS "clockOutWithinGeofence",CASE WHEN e.status='ON_LEAVE' OR leave_request.id IS NOT NULL THEN 'ON_LEAVE' WHEN s.id IS NULL THEN 'UNSCHEDULED' WHEN pin.id IS NULL THEN 'ABSENT' WHEN pin.within_geofence=false THEN 'OUTSIDE_GEOFENCE' WHEN pin.occurred_at>s.starts_at+(s.grace_minutes||' minutes')::interval THEN 'LATE' WHEN pout.id IS NULL THEN 'ON_SHIFT' ELSE 'ON_TIME' END AS status FROM employees e LEFT JOIN locations l ON l.id=e.primary_location_id LEFT JOIN shifts s ON s.employee_id=e.id AND s.company_id=e.company_id AND s.starts_at::date=$2::date LEFT JOIN LATERAL (SELECT id FROM leave_requests lr WHERE lr.company_id=e.company_id AND lr.employee_id=e.id AND lr.status='APPROVED' AND $2::date BETWEEN lr.starts_on AND lr.ends_on LIMIT 1) leave_request ON true LEFT JOIN LATERAL (SELECT * FROM punches p WHERE p.employee_id=e.id AND p.occurred_at::date=$2::date AND p.event_type='CLOCK_IN' ORDER BY p.occurred_at LIMIT 1) pin ON true LEFT JOIN LATERAL (SELECT * FROM punches p WHERE p.employee_id=e.id AND p.occurred_at::date=$2::date AND p.event_type='CLOCK_OUT' ORDER BY p.occurred_at DESC LIMIT 1) pout ON true WHERE e.company_id=$1 AND e.status IN ('ACTIVE','ON_LEAVE') ORDER BY e.full_name`,
      [companyId, date],
    );
    response.json({ data: result.rows });
  }),
);

const reconcileAttendanceSchema = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    message: "End date must be after start date",
    path: ["to"],
  });
apiRouter.post(
  "/attendance/reconcile",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = reconcileAttendanceSchema.parse(request.body ?? {});
    const { companyId, sub } = (request as AuthRequest).auth;
    const company = await pool.query<{ timezone: string }>(
      `SELECT timezone FROM companies WHERE id=$1`,
      [companyId],
    );
    const timeZone = company.rows[0]?.timezone ?? "Asia/Tashkent";
    const localDate = (value: Date) => {
      const parts = new Intl.DateTimeFormat("en", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(value);
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === type)?.value ?? "";
      return `${part("year")}-${part("month")}-${part("day")}`;
    };
    const from = input.from ?? localDate(new Date(Date.now() - 7 * 86_400_000));
    const to = input.to ?? localDate(new Date());
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 31)
      throw new HttpError(
        400,
        "Attendance reconciliation is limited to 31 days",
      );
    const result = await pool.query(
      `WITH candidates AS (
    SELECT s.id AS shift_id,s.employee_id,'MISSING_CLOCK_IN'::text AS exception_type,'HIGH'::text AS severity,'No clock-in was recorded for the published shift'::text AS details
    FROM shifts s WHERE s.company_id=$1 AND s.status='PUBLISHED' AND (s.starts_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date AND s.starts_at+s.grace_minutes*interval '1 minute'<now()
      AND NOT EXISTS(SELECT 1 FROM punches p WHERE p.shift_id=s.id AND p.event_type='CLOCK_IN')
      AND NOT EXISTS(SELECT 1 FROM leave_requests l WHERE l.company_id=$1 AND l.employee_id=s.employee_id AND l.status='APPROVED' AND (s.starts_at AT TIME ZONE $4)::date BETWEEN l.starts_on AND l.ends_on)
    UNION ALL
    SELECT s.id,s.employee_id,'MISSING_CLOCK_OUT','HIGH','No clock-out was recorded after the published shift ended'
    FROM shifts s WHERE s.company_id=$1 AND s.status='PUBLISHED' AND (s.starts_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date AND s.ends_at+s.grace_minutes*interval '1 minute'<now()
      AND EXISTS(SELECT 1 FROM punches p WHERE p.shift_id=s.id AND p.event_type='CLOCK_IN') AND NOT EXISTS(SELECT 1 FROM punches p WHERE p.shift_id=s.id AND p.event_type='CLOCK_OUT')
    UNION ALL
    SELECT s.id,s.employee_id,'LATE','MEDIUM','The first clock-in was later than the configured grace period'
    FROM shifts s JOIN LATERAL(SELECT occurred_at FROM punches p WHERE p.shift_id=s.id AND p.event_type='CLOCK_IN' ORDER BY occurred_at LIMIT 1)pin ON true
    WHERE s.company_id=$1 AND s.status='PUBLISHED' AND (s.starts_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date AND pin.occurred_at>s.starts_at+s.grace_minutes*interval '1 minute'
  ) INSERT INTO attendance_exceptions(company_id,employee_id,shift_id,exception_type,severity,details)
  SELECT $1,c.employee_id,c.shift_id,c.exception_type,c.severity,c.details FROM candidates c
  WHERE NOT EXISTS(SELECT 1 FROM attendance_exceptions x WHERE x.company_id=$1 AND x.shift_id=c.shift_id AND x.exception_type=c.exception_type)
  RETURNING id`,
      [companyId, from, to, timeZone],
    );
    if ((result.rowCount ?? 0) > 0)
      await pool.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,next_value) VALUES($1,$2,'ATTENDANCE_RECONCILED','ATTENDANCE', $3)`,
        [
          companyId,
          sub,
          JSON.stringify({ from, to, created: result.rowCount }),
        ],
      );
    response.json({ data: { from, to, created: result.rowCount ?? 0 } });
  }),
);

apiRouter.get(
  "/exceptions",
  requireManager,
  asyncHandler(async (request, response) => {
    const { companyId } = (request as AuthRequest).auth;
    const result = await pool.query(
      `SELECT x.id,x.exception_type AS type,x.severity,x.details,x.requested_correction AS "requestedCorrection",x.status,x.manager_note AS "managerNote",x.created_at AS "createdAt",e.id AS "employeeId",e.full_name AS employee,e.job_title AS role FROM attendance_exceptions x JOIN employees e ON e.id=x.employee_id WHERE x.company_id=$1 AND x.status=COALESCE($2,x.status) ORDER BY CASE x.severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,x.created_at`,
      [companyId, request.query.status ?? "PENDING"],
    );
    response.json({ data: result.rows });
  }),
);

const resolutionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  managerNote: z.string().trim().min(3).max(500),
});
const requestedCorrectionSchema = z.object({
  operation: z.literal("CREATE_PUNCH"),
  eventType: z.enum(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"]),
  occurredAt: z.string().datetime({ offset: true }),
});
apiRouter.patch(
  "/exceptions/:id",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = resolutionSchema.parse(request.body);
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub } = (request as AuthRequest).auth;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query(
        `SELECT * FROM attendance_exceptions WHERE id=$1 AND company_id=$2 AND status='PENDING' FOR UPDATE`,
        [id, companyId],
      );
      if (!previous.rows[0])
        throw new HttpError(404, "Pending exception not found");
      let appliedPunchId: string | null = null;
      const correction = requestedCorrectionSchema.safeParse(
        previous.rows[0].requested_correction,
      );
      if (input.status === "APPROVED" && correction.success) {
        const duplicate = await client.query<{ id: string }>(
          `SELECT id FROM punches WHERE company_id=$1 AND employee_id=$2 AND event_type=$3 AND occurred_at BETWEEN $4::timestamptz-interval '1 minute' AND $4::timestamptz+interval '1 minute' LIMIT 1`,
          [
            companyId,
            previous.rows[0].employee_id,
            correction.data.eventType,
            correction.data.occurredAt,
          ],
        );
        if (duplicate.rows[0]) appliedPunchId = duplicate.rows[0].id;
        else {
          const punch = await client.query<{ id: string }>(
            `INSERT INTO punches(company_id,employee_id,shift_id,event_type,occurred_at,source,note) VALUES($1,$2,$3,$4,$5,'MANUAL',$6) RETURNING id`,
            [
              companyId,
              previous.rows[0].employee_id,
              previous.rows[0].shift_id,
              correction.data.eventType,
              correction.data.occurredAt,
              `Approved correction: ${input.managerNote}`,
            ],
          );
          appliedPunchId = punch.rows[0].id;
          await client.query(
            `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'PUNCH_CORRECTION_APPLIED','PUNCH',$3,$4)`,
            [companyId, sub, appliedPunchId, JSON.stringify(correction.data)],
          );
        }
      }
      const updated = await client.query(
        `UPDATE attendance_exceptions SET status=$1,manager_note=$2,resolved_by=$3,resolved_at=now() WHERE id=$4 RETURNING id,status,manager_note AS "managerNote",resolved_at AS "resolvedAt"`,
        [input.status, input.managerNote, sub, id],
      );
      const responseData = { ...updated.rows[0], appliedPunchId };
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES ($1,$2,'ATTENDANCE_EXCEPTION_RESOLVED','ATTENDANCE_EXCEPTION',$3,$4,$5)`,
        [
          companyId,
          sub,
          id,
          JSON.stringify(previous.rows[0]),
          JSON.stringify(responseData),
        ],
      );
      await client.query("COMMIT");
      response.json({ data: responseData });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

apiRouter.get(
  "/shifts",
  requireManager,
  asyncHandler(async (request, response) => {
    const { companyId } = (request as AuthRequest).auth;
    const from = z
      .string()
      .date()
      .default(new Date().toISOString().slice(0, 10))
      .parse(request.query.from);
    const to = z.string().date().optional().parse(request.query.to);
    const result = await pool.query(
      `SELECT s.id,s.employee_id AS "employeeId",e.full_name AS employee,s.location_id AS "locationId",l.name AS location,s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.unpaid_break_minutes AS "unpaidBreakMinutes",s.grace_minutes AS "graceMinutes",s.live_tracking_enabled AS "liveTrackingEnabled",s.status FROM shifts s JOIN employees e ON e.id=s.employee_id LEFT JOIN locations l ON l.id=s.location_id WHERE s.company_id=$1 AND s.starts_at >= $2::date AND s.starts_at < COALESCE($3::date,$2::date+interval '7 days') ORDER BY s.starts_at,e.full_name`,
      [companyId, from, to],
    );
    response.json({ data: result.rows });
  }),
);

const shiftSchema = z
  .object({
    employeeId: z.string().uuid(),
    locationId: z.string().uuid(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    unpaidBreakMinutes: z.number().int().min(0).max(600).default(60),
    graceMinutes: z.number().int().min(0).max(120).default(5),
    liveTrackingEnabled: z.boolean().default(false),
    status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    message: "Shift end must be after its start",
    path: ["endsAt"],
  });
apiRouter.post(
  "/shifts",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = shiftSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    const overlap = await pool.query(
      `SELECT id FROM shifts WHERE company_id=$1 AND employee_id=$2 AND status<>'CANCELLED' AND starts_at<$4 AND ends_at>$3 LIMIT 1`,
      [companyId, input.employeeId, input.startsAt, input.endsAt],
    );
    if (overlap.rows[0])
      throw new HttpError(409, "This shift overlaps an existing assignment");
    const result = await pool.query(
      `INSERT INTO shifts(company_id,employee_id,location_id,starts_at,ends_at,unpaid_break_minutes,grace_minutes,live_tracking_enabled,status,created_by) SELECT $1,e.id,l.id,$4,$5,$6,$7,$8,$9,$10 FROM employees e CROSS JOIN locations l WHERE e.id=$2 AND e.company_id=$1 AND l.id=$3 AND l.company_id=$1 RETURNING id,employee_id AS "employeeId",location_id AS "locationId",starts_at AS "startsAt",ends_at AS "endsAt",live_tracking_enabled AS "liveTrackingEnabled",status`,
      [
        companyId,
        input.employeeId,
        input.locationId,
        input.startsAt,
        input.endsAt,
        input.unpaidBreakMinutes,
        input.graceMinutes,
        input.liveTrackingEnabled,
        input.status,
        sub,
      ],
    );
    if (!result.rows[0])
      throw new HttpError(400, "Invalid employee or location");
    await pool.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'SHIFT_CREATED','SHIFT',$3,$4)`,
      [companyId, sub, result.rows[0].id, JSON.stringify(result.rows[0])],
    );
    response.status(201).json({ data: result.rows[0] });
  }),
);

const shiftUpdateSchema = z
  .object({
    locationId: z.string().uuid(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    unpaidBreakMinutes: z.number().int().min(0).max(600),
    graceMinutes: z.number().int().min(0).max(120),
    liveTrackingEnabled: z.boolean(),
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    message: "Shift end must be after its start",
    path: ["endsAt"],
  });
apiRouter.patch(
  "/shifts/:id",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = shiftUpdateSchema.parse(request.body);
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub } = (request as AuthRequest).auth;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query(
        `SELECT * FROM shifts WHERE id=$1 AND company_id=$2 AND status<>'CANCELLED' FOR UPDATE`,
        [id, companyId],
      );
      if (!previous.rows[0]) throw new HttpError(404, "Active shift not found");
      const overlap = await client.query(
        `SELECT id FROM shifts WHERE company_id=$1 AND employee_id=$2 AND id<>$3 AND status<>'CANCELLED' AND starts_at<$5 AND ends_at>$4 LIMIT 1`,
        [
          companyId,
          previous.rows[0].employee_id,
          id,
          input.startsAt,
          input.endsAt,
        ],
      );
      if (overlap.rows[0])
        throw new HttpError(409, "This shift overlaps an existing assignment");
      const validLocation = await client.query(
        `SELECT id FROM locations WHERE id=$1 AND company_id=$2 AND active=true`,
        [input.locationId, companyId],
      );
      if (!validLocation.rows[0])
        throw new HttpError(400, "Choose an active work location");
      const result = await client.query(
        `UPDATE shifts SET location_id=$1,starts_at=$2,ends_at=$3,unpaid_break_minutes=$4,grace_minutes=$5,live_tracking_enabled=$6,status='DRAFT',updated_at=now() WHERE id=$7 RETURNING id,employee_id AS "employeeId",location_id AS "locationId",starts_at AS "startsAt",ends_at AS "endsAt",unpaid_break_minutes AS "unpaidBreakMinutes",grace_minutes AS "graceMinutes",live_tracking_enabled AS "liveTrackingEnabled",status`,
        [
          input.locationId,
          input.startsAt,
          input.endsAt,
          input.unpaidBreakMinutes,
          input.graceMinutes,
          input.liveTrackingEnabled,
          id,
        ],
      );
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'SHIFT_UPDATED','SHIFT',$3,$4,$5)`,
        [
          companyId,
          sub,
          id,
          JSON.stringify(previous.rows[0]),
          JSON.stringify(result.rows[0]),
        ],
      );
      await client.query("COMMIT");
      response.json({ data: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

const publishSchema = z
  .object({ from: z.string().date(), to: z.string().date() })
  .refine((value) => value.to >= value.from, {
    message: "End date must be after start date",
    path: ["to"],
  });
const copyWeekSchema = z.object({
  sourceFrom: z.string().date(),
  targetFrom: z.string().date(),
});
apiRouter.post(
  "/shifts/copy-week",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = copyWeekSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    const result = await pool.query(
      `INSERT INTO shifts(company_id,employee_id,location_id,starts_at,ends_at,unpaid_break_minutes,grace_minutes,live_tracking_enabled,status,created_by) SELECT s.company_id,s.employee_id,s.location_id,s.starts_at+(($3::date-$2::date)*interval '1 day'),s.ends_at+(($3::date-$2::date)*interval '1 day'),s.unpaid_break_minutes,s.grace_minutes,s.live_tracking_enabled,'DRAFT',$4 FROM shifts s WHERE s.company_id=$1 AND s.status<>'CANCELLED' AND s.starts_at >= $2::date AND s.starts_at < $2::date+interval '7 days' AND NOT EXISTS(SELECT 1 FROM shifts existing WHERE existing.company_id=$1 AND existing.employee_id=s.employee_id AND existing.starts_at=s.starts_at+(($3::date-$2::date)*interval '1 day') AND existing.status<>'CANCELLED') RETURNING id`,
      [companyId, input.sourceFrom, input.targetFrom, sub],
    );
    await pool.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,next_value) VALUES($1,$2,'SCHEDULE_WEEK_COPIED','SCHEDULE',$3)`,
      [companyId, sub, JSON.stringify({ ...input, copied: result.rowCount })],
    );
    response.status(201).json({ data: { copied: result.rowCount ?? 0 } });
  }),
);
apiRouter.post(
  "/shifts/publish",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = publishSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    const result = await pool.query(
      `UPDATE shifts SET status='PUBLISHED',updated_at=now() WHERE company_id=$1 AND status='DRAFT' AND starts_at >= $2::date AND starts_at < $3::date+interval '1 day' RETURNING id`,
      [companyId, input.from, input.to],
    );
    await pool.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,next_value) VALUES($1,$2,'SCHEDULE_PUBLISHED','SCHEDULE',$3)`,
      [
        companyId,
        sub,
        JSON.stringify({
          from: input.from,
          to: input.to,
          count: result.rowCount,
        }),
      ],
    );
    response.json({ data: { published: result.rowCount ?? 0 } });
  }),
);

apiRouter.patch(
  "/shifts/:id/cancel",
  requireManager,
  asyncHandler(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub } = (request as AuthRequest).auth;
    const result = await pool.query(
      `UPDATE shifts SET status='CANCELLED',updated_at=now() WHERE id=$1 AND company_id=$2 AND status<>'CANCELLED' RETURNING id,status`,
      [id, companyId],
    );
    if (!result.rows[0]) throw new HttpError(404, "Active shift not found");
    await pool.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'SHIFT_CANCELLED','SHIFT',$3,$4)`,
      [companyId, sub, id, JSON.stringify(result.rows[0])],
    );
    response.json({ data: result.rows[0] });
  }),
);

const punchSchema = z.object({
  employeeId: z.string().uuid(),
  eventType: z.enum(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"]),
  occurredAt: z.string().datetime({ offset: true }),
  source: z
    .enum(["MOBILE", "KIOSK", "TURNSTILE", "MANUAL", "QR"])
    .default("MANUAL"),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  note: z.string().trim().max(500).optional(),
});
apiRouter.post(
  "/punches",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = punchSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    const employee = await pool.query(
      `SELECT id,primary_location_id FROM employees WHERE id=$1 AND company_id=$2 AND status<>'INACTIVE'`,
      [input.employeeId, companyId],
    );
    if (!employee.rows[0]) throw new HttpError(404, "Employee not found");
    const duplicate = await pool.query(
      `SELECT id FROM punches WHERE company_id=$1 AND employee_id=$2 AND event_type=$3 AND occurred_at BETWEEN $4::timestamptz-interval '1 minute' AND $4::timestamptz+interval '1 minute' LIMIT 1`,
      [companyId, input.employeeId, input.eventType, input.occurredAt],
    );
    if (duplicate.rows[0])
      throw new HttpError(
        409,
        "A matching clock event already exists near this time",
      );
    const shift = await pool.query<{ id: string }>(
      `SELECT id FROM shifts WHERE company_id=$1 AND employee_id=$2 AND starts_at::date=$3::timestamptz::date AND status<>'CANCELLED' ORDER BY abs(extract(epoch from(starts_at-$3::timestamptz))) LIMIT 1`,
      [companyId, input.employeeId, input.occurredAt],
    );
    const result = await pool.query(
      `INSERT INTO punches(company_id,employee_id,shift_id,event_type,occurred_at,source,latitude,longitude,within_geofence,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULLIF($9,'')) RETURNING id,employee_id AS "employeeId",shift_id AS "shiftId",event_type AS "eventType",occurred_at AS "occurredAt",source,note`,
      [
        companyId,
        input.employeeId,
        shift.rows[0]?.id ?? null,
        input.eventType,
        input.occurredAt,
        input.source,
        input.latitude ?? null,
        input.longitude ?? null,
        input.note ?? "",
      ],
    );
    await pool.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'PUNCH_CREATED','PUNCH',$3,$4)`,
      [companyId, sub, result.rows[0].id, JSON.stringify(result.rows[0])],
    );
    response.status(201).json({ data: result.rows[0] });
  }),
);

apiRouter.get(
  "/employees/:id/punches",
  requireManager,
  asyncHandler(async (request, response) => {
    const employeeId = z.string().uuid().parse(request.params.id);
    const date = z.string().date().parse(request.query.date);
    const { companyId } = (request as AuthRequest).auth;
    const company = await pool.query<{ timezone: string }>(
      `SELECT timezone FROM companies WHERE id=$1`,
      [companyId],
    );
    const result = await pool.query(
      `SELECT p.id,p.event_type AS "eventType",p.occurred_at AS "occurredAt",p.source,p.within_geofence AS "withinGeofence",p.note,EXISTS(SELECT 1 FROM attendance_face_verifications f WHERE f.punch_id=p.id) AS "hasFaceVerification" FROM punches p WHERE p.company_id=$1 AND p.employee_id=$2 AND (p.occurred_at AT TIME ZONE $4)::date=$3::date ORDER BY p.occurred_at`,
      [
        companyId,
        employeeId,
        date,
        company.rows[0]?.timezone ?? "Asia/Tashkent",
      ],
    );
    response.json({ data: result.rows });
  }),
);

// One employee, one day per row, for the manager's per-employee week view.
apiRouter.get(
  "/employees/:id/attendance",
  requireManager,
  asyncHandler(async (request, response) => {
    const employeeId = z.string().uuid().parse(request.params.id);
    const range = z
      .object({ from: z.string().date(), to: z.string().date() })
      .refine((value) => value.to >= value.from, "Invalid date range")
      .parse(request.query);
    if (Date.parse(range.to) - Date.parse(range.from) > 62 * 86400000)
      throw new HttpError(400, "Select at most two months");
    const { companyId } = (request as AuthRequest).auth;
    const result = await pool.query(
      `WITH company AS (SELECT timezone FROM companies WHERE id=$1),
       days AS (SELECT d::date AS day FROM generate_series($3::date,$4::date,interval '1 day') d)
       SELECT days.day::text AS date,s.id AS "shiftId",s.starts_at AS "shiftStart",s.ends_at AS "shiftEnd",l.name AS location,
              pin.occurred_at AS "clockIn",pin.source AS "clockInSource",pin.within_geofence AS "clockInWithinGeofence",
              EXISTS(SELECT 1 FROM attendance_face_verifications f WHERE f.punch_id=pin.id) AS "clockInFaceVerified",
              pout.occurred_at AS "clockOut",pout.within_geofence AS "clockOutWithinGeofence",
              CASE WHEN leave_request.id IS NOT NULL THEN 'ON_LEAVE' WHEN s.id IS NULL THEN 'UNSCHEDULED' WHEN pin.id IS NULL AND s.starts_at>now() THEN 'UPCOMING' WHEN pin.id IS NULL THEN 'ABSENT' WHEN pin.within_geofence=false THEN 'OUTSIDE_GEOFENCE' WHEN pin.occurred_at>s.starts_at+(s.grace_minutes||' minutes')::interval THEN 'LATE' WHEN pout.id IS NULL THEN 'ON_SHIFT' ELSE 'ON_TIME' END AS status,
              CASE WHEN pin.id IS NOT NULL AND pout.id IS NOT NULL THEN GREATEST(0,extract(epoch FROM pout.occurred_at-pin.occurred_at)/60-COALESCE(s.unpaid_break_minutes,0))::int END AS "workedMinutes"
       FROM days CROSS JOIN company
       LEFT JOIN shifts s ON s.company_id=$1 AND s.employee_id=$2 AND s.status<>'CANCELLED' AND (s.starts_at AT TIME ZONE company.timezone)::date=days.day
       LEFT JOIN locations l ON l.id=s.location_id
       LEFT JOIN LATERAL (SELECT id FROM leave_requests lr WHERE lr.company_id=$1 AND lr.employee_id=$2 AND lr.status='APPROVED' AND days.day BETWEEN lr.starts_on AND lr.ends_on LIMIT 1) leave_request ON true
       LEFT JOIN LATERAL (SELECT * FROM punches p WHERE p.company_id=$1 AND p.employee_id=$2 AND (p.occurred_at AT TIME ZONE company.timezone)::date=days.day AND p.event_type='CLOCK_IN' ORDER BY p.occurred_at LIMIT 1) pin ON true
       LEFT JOIN LATERAL (SELECT * FROM punches p WHERE p.company_id=$1 AND p.employee_id=$2 AND (p.occurred_at AT TIME ZONE company.timezone)::date=days.day AND p.event_type='CLOCK_OUT' ORDER BY p.occurred_at DESC LIMIT 1) pout ON true
       ORDER BY days.day`,
      [companyId, employeeId, range.from, range.to],
    );
    response.json({ data: result.rows });
  }),
);

const punchUpdateSchema = z.object({
  eventType: z.enum(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"]),
  occurredAt: z.string().datetime({ offset: true }),
  note: z.string().trim().min(3).max(500),
});
apiRouter.patch(
  "/punches/:id",
  requireManager,
  asyncHandler(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const input = punchUpdateSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query(
        `SELECT * FROM punches WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!previous.rows[0]) throw new HttpError(404, "Clock event not found");
      const paid = await client.query(
        `SELECT 1 FROM payslips p JOIN payroll_periods pp ON pp.id=p.payroll_period_id WHERE p.company_id=$1 AND p.employee_id=$2 AND p.status='PAID' AND $3::timestamptz::date BETWEEN pp.starts_on AND pp.ends_on LIMIT 1`,
        [companyId, previous.rows[0].employee_id, previous.rows[0].occurred_at],
      );
      if (paid.rows[0])
        throw new HttpError(409, "Paid payroll attendance cannot be changed");
      const duplicate = await client.query(
        `SELECT id FROM punches WHERE company_id=$1 AND employee_id=$2 AND id<>$3 AND event_type=$4 AND occurred_at BETWEEN $5::timestamptz-interval '1 minute' AND $5::timestamptz+interval '1 minute' LIMIT 1`,
        [
          companyId,
          previous.rows[0].employee_id,
          id,
          input.eventType,
          input.occurredAt,
        ],
      );
      if (duplicate.rows[0])
        throw new HttpError(
          409,
          "A matching clock event already exists near this time",
        );
      const shift = await client.query<{ id: string }>(
        `SELECT id FROM shifts WHERE company_id=$1 AND employee_id=$2 AND (starts_at AT TIME ZONE (SELECT timezone FROM companies WHERE id=$1))::date=($3::timestamptz AT TIME ZONE (SELECT timezone FROM companies WHERE id=$1))::date AND status<>'CANCELLED' ORDER BY abs(extract(epoch from(starts_at-$3::timestamptz))) LIMIT 1`,
        [companyId, previous.rows[0].employee_id, input.occurredAt],
      );
      const result = await client.query(
        `UPDATE punches SET shift_id=$1,event_type=$2,occurred_at=$3,source='MANUAL',note=$4 WHERE id=$5 RETURNING id,employee_id AS "employeeId",shift_id AS "shiftId",event_type AS "eventType",occurred_at AS "occurredAt",source,note`,
        [
          shift.rows[0]?.id ?? null,
          input.eventType,
          input.occurredAt,
          input.note,
          id,
        ],
      );
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'PUNCH_UPDATED','PUNCH',$3,$4,$5)`,
        [
          companyId,
          sub,
          id,
          JSON.stringify(previous.rows[0]),
          JSON.stringify(result.rows[0]),
        ],
      );
      await client.query("COMMIT");
      response.json({ data: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

const punchDeleteSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
apiRouter.delete(
  "/punches/:id",
  requireManager,
  asyncHandler(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const input = punchDeleteSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query(
        `SELECT * FROM punches WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!previous.rows[0]) throw new HttpError(404, "Clock event not found");
      const paid = await client.query(
        `SELECT 1 FROM payslips p JOIN payroll_periods pp ON pp.id=p.payroll_period_id WHERE p.company_id=$1 AND p.employee_id=$2 AND p.status='PAID' AND $3::timestamptz::date BETWEEN pp.starts_on AND pp.ends_on LIMIT 1`,
        [companyId, previous.rows[0].employee_id, previous.rows[0].occurred_at],
      );
      if (paid.rows[0])
        throw new HttpError(409, "Paid payroll attendance cannot be changed");
      await client.query(`DELETE FROM punches WHERE id=$1`, [id]);
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'PUNCH_DELETED','PUNCH',$3,$4,$5)`,
        [
          companyId,
          sub,
          id,
          JSON.stringify(previous.rows[0]),
          JSON.stringify({ reason: input.reason }),
        ],
      );
      await client.query("COMMIT");
      response.json({ data: { id, deleted: true } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

apiRouter.get(
  "/payroll",
  requireManager,
  asyncHandler(async (request, response) => {
    const { companyId } = (request as AuthRequest).auth;
    const result = await pool.query(
      `SELECT pp.id AS "periodId",pp.starts_on AS "startsOn",pp.ends_on AS "endsOn",pp.status AS "periodStatus",p.id,p.employee_id AS "employeeId",e.full_name AS employee,e.job_title AS role,COALESCE((p.calculation_breakdown->>'hourlyRate')::bigint,e.hourly_rate) AS "hourlyRate",p.base_salary AS "baseSalary",p.overtime_minutes AS "overtimeMinutes",p.overtime_pay AS "overtimePay",p.night_minutes AS "nightMinutes",p.night_pay AS "nightPay",p.holiday_minutes AS "holidayMinutes",p.holiday_pay AS "holidayPay",p.benefits,p.employer_contributions AS "employerContributions",p.calculation_breakdown AS "calculationBreakdown",p.bonuses,p.deductions,p.tax,p.gross_pay AS "grossPay",p.net_pay AS "netPay",p.status,p.attendance_issue AS "attendanceIssue",COALESCE((p.calculation_breakdown->>'expectedMinutes')::int,0) AS "expectedMinutes",COALESCE((p.calculation_breakdown->>'workedMinutes')::int,0) AS "workedMinutes" FROM payroll_periods pp JOIN payslips p ON p.payroll_period_id=pp.id JOIN employees e ON e.id=p.employee_id WHERE pp.company_id=$1 ORDER BY pp.starts_on DESC,e.full_name`,
      [companyId],
    );
    response.json({ data: result.rows });
  }),
);

const payrollPeriodSchema = z
  .object({
    startsOn: z.string().date(),
    endsOn: z.string().date(),
    taxRate: z.number().min(0).max(100).optional(),
  })
  .refine((value) => value.endsOn >= value.startsOn, {
    message: "End date must be after start date",
    path: ["endsOn"],
  });
apiRouter.post(
  "/payroll/periods",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = payrollPeriodSchema.parse(request.body);
    const { companyId, sub } = (request as AuthRequest).auth;
    const policy = await pool.query<{ taxRate: number }>(
      `SELECT default_income_tax_rate::float AS "taxRate" FROM companies WHERE id=$1`,
      [companyId],
    );
    const taxRate = input.taxRate ?? policy.rows[0]?.taxRate ?? 12;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const period = await client.query<{ id: string }>(
        `INSERT INTO payroll_periods(company_id,starts_on,ends_on,status) VALUES($1,$2,$3,'REVIEW') ON CONFLICT(company_id,starts_on,ends_on) DO UPDATE SET status=payroll_periods.status RETURNING id`,
        [companyId, input.startsOn, input.endsOn],
      );
      const created = await client.query(
        `WITH attendance AS (SELECT e.*,COALESCE((SELECT sum(GREATEST(0,extract(epoch FROM(s.ends_at-s.starts_at))/60-s.unpaid_break_minutes))::int FROM shifts s WHERE s.company_id=$1 AND s.employee_id=e.id AND s.status<>'CANCELLED' AND s.starts_at::date BETWEEN $4::date AND $5::date),0) AS expected_minutes,COALESCE((SELECT sum(GREATEST(0,extract(epoch FROM(pout.occurred_at-pin.occurred_at))/60))::int FROM shifts s JOIN LATERAL(SELECT occurred_at FROM punches WHERE shift_id=s.id AND event_type='CLOCK_IN' ORDER BY occurred_at LIMIT 1)pin ON true JOIN LATERAL(SELECT occurred_at FROM punches WHERE shift_id=s.id AND event_type='CLOCK_OUT' ORDER BY occurred_at DESC LIMIT 1)pout ON true WHERE s.company_id=$1 AND s.employee_id=e.id AND s.status<>'CANCELLED' AND s.starts_at::date BETWEEN $4::date AND $5::date),0) AS worked_minutes FROM employees e WHERE e.company_id=$1 AND e.status IN('ACTIVE','ON_LEAVE')),calculated AS (SELECT attendance.*,GREATEST(0,worked_minutes-expected_minutes)::int AS overtime_minutes FROM attendance) INSERT INTO payslips(company_id,payroll_period_id,employee_id,base_salary,overtime_minutes,overtime_pay,bonuses,deductions,tax,gross_pay,net_pay,status,attendance_issue) SELECT $1,$2,e.id,e.base_salary,e.overtime_minutes,round(e.overtime_minutes/60.0*e.hourly_rate)::bigint,0,0,round((e.base_salary+e.overtime_minutes/60.0*e.hourly_rate)*$3/100.0)::bigint,round(e.base_salary+e.overtime_minutes/60.0*e.hourly_rate)::bigint,GREATEST(0,round((e.base_salary+e.overtime_minutes/60.0*e.hourly_rate)*(1-$3/100.0))::bigint),CASE WHEN EXISTS(SELECT 1 FROM attendance_exceptions x WHERE x.employee_id=e.id AND x.company_id=$1 AND x.status='PENDING' AND x.created_at::date BETWEEN $4::date AND $5::date) THEN 'REVIEW' ELSE 'READY' END,CASE WHEN EXISTS(SELECT 1 FROM attendance_exceptions x WHERE x.employee_id=e.id AND x.company_id=$1 AND x.status='PENDING' AND x.created_at::date BETWEEN $4::date AND $5::date) THEN 'Attendance exceptions require review' ELSE NULL END FROM calculated e ON CONFLICT(payroll_period_id,employee_id) DO NOTHING RETURNING id`,
        [companyId, period.rows[0].id, taxRate, input.startsOn, input.endsOn],
      );
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'PAYROLL_PERIOD_GENERATED','PAYROLL_PERIOD',$3,$4)`,
        [
          companyId,
          sub,
          period.rows[0].id,
          JSON.stringify({
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            taxRate,
            created: created.rowCount,
          }),
        ],
      );
      await client.query("COMMIT");
      response.status(201).json({
        data: { periodId: period.rows[0].id, created: created.rowCount ?? 0 },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

apiRouter.post(
  "/payroll/periods/:id/recalculate",
  requireManager,
  asyncHandler(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const input = z
      .object({ taxRate: z.number().min(0).max(100).optional() })
      .parse(request.body ?? {});
    const { companyId, sub } = (request as AuthRequest).auth;
    const period = await pool.query<{ taxRate: number; status: string }>(
      `SELECT tax_rate::float AS "taxRate",status FROM payroll_periods WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    if (!period.rows[0]) throw new HttpError(404, "Payroll period not found");
    if (period.rows[0].status === "PAID")
      throw new HttpError(409, "Paid payroll cannot be recalculated");
    const taxRate = input.taxRate ?? period.rows[0].taxRate;
    const result = await pool.query<{ count: number }>(
      `SELECT recalculate_payroll_period($1,$2,$3)::int AS count`,
      [companyId, id, taxRate],
    );
    await pool.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'PAYROLL_RECALCULATED','PAYROLL_PERIOD',$3,$4)`,
      [
        companyId,
        sub,
        id,
        JSON.stringify({ updated: result.rows[0]?.count ?? 0, taxRate }),
      ],
    );
    response.json({ data: { updated: result.rows[0]?.count ?? 0 } });
  }),
);

apiRouter.post(
  "/payroll/periods/:id/approve-ready",
  requireManager,
  asyncHandler(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub } = (request as AuthRequest).auth;
    const result = await pool.query(
      `UPDATE payslips SET status='APPROVED',approved_by=$1,approved_at=now(),updated_at=now() WHERE company_id=$2 AND payroll_period_id=$3 AND status='READY' RETURNING id`,
      [sub, companyId, id],
    );
    await pool.query(
      `UPDATE payroll_periods SET status=CASE WHEN EXISTS(SELECT 1 FROM payslips WHERE payroll_period_id=$1 AND status IN('READY','REVIEW')) THEN 'REVIEW' ELSE 'APPROVED' END WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    await pool.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'PAYROLL_READY_APPROVED','PAYROLL_PERIOD',$3,$4)`,
      [companyId, sub, id, JSON.stringify({ approved: result.rowCount })],
    );
    response.json({ data: { approved: result.rowCount ?? 0 } });
  }),
);

const adjustmentSchema = z.object({
  type: z.enum(["BONUS", "DEDUCTION"]),
  amount: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});
apiRouter.post(
  "/payroll/:id/adjustments",
  requireManager,
  asyncHandler(async (request, response) => {
    const input = adjustmentSchema.parse(request.body);
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub } = (request as AuthRequest).auth;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query(
        `SELECT * FROM payslips WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!previous.rows[0]) throw new HttpError(404, "Payslip not found");
      await client.query(
        `INSERT INTO payroll_adjustments(company_id,payslip_id,adjustment_type,amount,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
        [companyId, id, input.type, input.amount, input.reason, sub],
      );
      const result = await client.query(
        `UPDATE payslips SET bonuses=bonuses+CASE WHEN $1='BONUS' THEN $2 ELSE 0 END,deductions=deductions+CASE WHEN $1='DEDUCTION' THEN $2 ELSE 0 END,gross_pay=base_salary+overtime_pay+bonuses+CASE WHEN $1='BONUS' THEN $2 ELSE 0 END,net_pay=GREATEST(0,base_salary+overtime_pay+bonuses+CASE WHEN $1='BONUS' THEN $2 ELSE 0 END-tax-deductions-CASE WHEN $1='DEDUCTION' THEN $2 ELSE 0 END),status=CASE WHEN status='APPROVED' THEN 'READY' ELSE status END,updated_at=now() WHERE id=$3 RETURNING *`,
        [input.type, input.amount, id],
      );
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'PAYROLL_ADJUSTMENT_CREATED','PAYSLIP',$3,$4,$5)`,
        [
          companyId,
          sub,
          id,
          JSON.stringify(previous.rows[0]),
          JSON.stringify(result.rows[0]),
        ],
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

apiRouter.patch(
  "/payroll/:id/approve",
  requireManager,
  asyncHandler(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub } = (request as AuthRequest).auth;
    const result = await pool.query(
      `UPDATE payslips SET status='APPROVED',approved_by=$1,approved_at=now(),updated_at=now() WHERE id=$2 AND company_id=$3 AND status='READY' RETURNING id,status,approved_at AS "approvedAt"`,
      [sub, id, companyId],
    );
    if (!result.rows[0])
      throw new HttpError(409, "Only a ready payslip can be approved");
    await pool.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'PAYSLIP_APPROVED','PAYSLIP',$3,$4)`,
      [companyId, sub, id, JSON.stringify(result.rows[0])],
    );
    response.json({ data: result.rows[0] });
  }),
);

apiRouter.post(
  "/payroll/periods/:id/mark-paid",
  requireManager,
  asyncHandler(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const { companyId, sub } = (request as AuthRequest).auth;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const period = await client.query(
        `SELECT id,status FROM payroll_periods WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!period.rows[0]) throw new HttpError(404, "Payroll period not found");
      const unresolved = await client.query(
        `SELECT count(*)::int AS count FROM payslips WHERE payroll_period_id=$1 AND company_id=$2 AND status<>'APPROVED' AND status<>'PAID'`,
        [id, companyId],
      );
      if (unresolved.rows[0].count > 0)
        throw new HttpError(
          409,
          "Approve every payslip before marking the period paid",
        );
      const paid = await client.query(
        `UPDATE payslips SET status='PAID',updated_at=now() WHERE payroll_period_id=$1 AND company_id=$2 AND status='APPROVED' RETURNING id`,
        [id, companyId],
      );
      await client.query(
        `UPDATE payroll_periods SET status='PAID' WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );
      await client.query(
        `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'PAYROLL_PERIOD_PAID','PAYROLL_PERIOD',$3,$4)`,
        [companyId, sub, id, JSON.stringify({ paid: paid.rowCount })],
      );
      await client.query("COMMIT");
      response.json({ data: { paid: paid.rowCount ?? 0 } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
