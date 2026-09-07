import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireManager, type AuthRequest } from "./auth.js";
import { pool } from "./db.js";
import { isWithinGeofence } from "./domain/geofence.js";
import { asyncHandler, HttpError } from "./http.js";
import { sendEmployeeInvitation } from "./mailer.js";

export const employeeRouter = Router();

const accountSchema = z.object({
  email: z.string().trim().email(),
  temporaryPassword: z.string().min(10).max(128),
});

employeeRouter.post("/employees/:id/account", requireManager, asyncHandler(async (request, response) => {
  const employeeId = z.string().uuid().parse(request.params.id);
  const input = accountSchema.parse(request.body);
  const { companyId, sub } = (request as AuthRequest).auth;
  const passwordHash = await bcrypt.hash(input.temporaryPassword, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const employee = await client.query<{ id: string; user_id: string | null; full_name: string; access_role: "EMPLOYEE"|"LOCATION_MANAGER"|"ADMINISTRATOR" }>(
      `SELECT id,user_id,full_name,access_role FROM employees WHERE id=$1 AND company_id=$2 FOR UPDATE`,
      [employeeId, companyId],
    );
    if (!employee.rows[0]) throw new HttpError(404, "Employee not found");

    const accountRole=employee.rows[0].access_role==="ADMINISTRATOR"?"ADMIN":employee.rows[0].access_role==="LOCATION_MANAGER"?"MANAGER":"EMPLOYEE";
    let userId = employee.rows[0].user_id;
    if (userId) {
      const updated = await client.query<{ id: string }>(
        `UPDATE users SET email=lower($1),password_hash=$2,display_name=$3,role=$4,active=true,must_change_password=true,token_version=token_version+1,updated_at=now()
         WHERE id=$5 AND company_id=$6 RETURNING id`,
        [input.email, passwordHash, employee.rows[0].full_name, accountRole, userId, companyId],
      );
      if (!updated.rows[0]) throw new HttpError(404, "Linked user account not found");
    } else {
      const created = await client.query<{ id: string }>(
        `INSERT INTO users(company_id,email,password_hash,display_name,role,must_change_password)
         VALUES($1,lower($2),$3,$4,$5,true) RETURNING id`,
        [companyId, input.email, passwordHash, employee.rows[0].full_name, accountRole],
      );
      userId = created.rows[0].id;
    }
    await client.query(`UPDATE employees SET user_id=$1,email=lower($2),status=CASE WHEN status='INVITED' THEN 'ACTIVE' ELSE status END,updated_at=now() WHERE id=$3`, [userId, input.email, employeeId]);
    await client.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value)
       VALUES($1,$2,'EMPLOYEE_ACCOUNT_PROVISIONED','EMPLOYEE',$3,$4)`,
      [companyId, sub, employeeId, JSON.stringify({ userId, email: input.email.toLowerCase(), role:accountRole, active: true })],
    );
    await client.query("COMMIT");
    const company=await pool.query<{name:string}>("SELECT name FROM companies WHERE id=$1",[companyId]);
    const delivery=await sendEmployeeInvitation({email:input.email.toLowerCase(),name:employee.rows[0].full_name,company:company.rows[0]?.name??"Atlas",temporaryPassword:input.temporaryPassword});
    response.status(201).json({ data: { employeeId, userId, email: input.email.toLowerCase(), active: true, invitation:delivery } });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") throw new HttpError(409, "That email is already used by another account");
    throw error;
  } finally { client.release(); }
}));

async function employeeForUser(userId: string, companyId: string) {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM employees WHERE user_id=$1 AND company_id=$2 AND status<>'INACTIVE'`,
    [userId, companyId],
  );
  if (!result.rows[0]) throw new HttpError(403, "No active employee profile is linked to this account");
  return result.rows[0].id;
}

employeeRouter.get("/me/workspace", asyncHandler(async (request, response) => {
  const { sub, companyId, role } = (request as AuthRequest).auth;
  if (role !== "EMPLOYEE") throw new HttpError(403, "Employee access required");
  const employeeId = await employeeForUser(sub, companyId);
  const [profile, shifts, punches, payslips, corrections, leaves, leaveBalance] = await Promise.all([
    pool.query(
      `SELECT e.id,e.employee_number AS "employeeNumber",e.full_name AS name,e.job_title AS "jobTitle",e.status,
        d.name AS department,l.name AS location,c.name AS "companyName",c.timezone,c.currency
       FROM employees e JOIN companies c ON c.id=e.company_id
       LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN locations l ON l.id=e.primary_location_id
       WHERE e.id=$1 AND e.company_id=$2`, [employeeId, companyId],
    ),
    pool.query(
      `SELECT s.id,s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.unpaid_break_minutes AS "unpaidBreakMinutes",l.name AS location
       FROM shifts s LEFT JOIN locations l ON l.id=s.location_id
       WHERE s.company_id=$1 AND s.employee_id=$2 AND s.status='PUBLISHED'
         AND s.ends_at >= now()-interval '1 day' AND s.starts_at < now()+interval '21 days'
       ORDER BY s.starts_at`, [companyId, employeeId],
    ),
    pool.query(
      `SELECT id,shift_id AS "shiftId",event_type AS "eventType",occurred_at AS "occurredAt",source,within_geofence AS "withinGeofence"
       FROM punches WHERE company_id=$1 AND employee_id=$2 AND occurred_at>=CURRENT_DATE-interval '7 days'
       ORDER BY occurred_at DESC LIMIT 40`, [companyId, employeeId],
    ),
    pool.query(
      `SELECT p.id,pp.starts_on AS "startsOn",pp.ends_on AS "endsOn",p.gross_pay AS "grossPay",p.net_pay AS "netPay",p.status,c.currency
       FROM payslips p JOIN payroll_periods pp ON pp.id=p.payroll_period_id JOIN companies c ON c.id=p.company_id
       WHERE p.company_id=$1 AND p.employee_id=$2 AND p.status IN('APPROVED','PAID') ORDER BY pp.starts_on DESC LIMIT 12`,
      [companyId, employeeId],
    ),
    pool.query(
      `SELECT id,exception_type AS type,details,requested_correction AS "requestedCorrection",status,manager_note AS "managerNote",created_at AS "createdAt",resolved_at AS "resolvedAt"
       FROM attendance_exceptions WHERE company_id=$1 AND employee_id=$2 ORDER BY created_at DESC LIMIT 20`,
      [companyId, employeeId],
    ),
    pool.query(
      `SELECT id,leave_type AS "leaveType",starts_on AS "startsOn",ends_on AS "endsOn",reason,status,manager_note AS "managerNote",created_at AS "createdAt"
       FROM leave_requests WHERE company_id=$1 AND employee_id=$2 ORDER BY starts_on DESC LIMIT 30`, [companyId, employeeId],
    ),
    pool.query(
      `SELECT c.annual_leave_days::int AS "annualAllowance",
        COALESCE(sum((SELECT count(*) FROM generate_series(l.starts_on,l.ends_on,interval '1 day') d WHERE extract(isodow FROM d)<6)),0)::int AS "annualUsed"
       FROM companies c LEFT JOIN leave_requests l ON l.company_id=c.id AND l.employee_id=$2 AND l.leave_type='ANNUAL' AND l.status='APPROVED' AND extract(year FROM l.starts_on)=extract(year FROM CURRENT_DATE) WHERE c.id=$1 GROUP BY c.annual_leave_days`,
      [companyId, employeeId],
    ),
  ]);
  response.json({ data: { profile: profile.rows[0], shifts: shifts.rows, punches: punches.rows, payslips: payslips.rows, corrections: corrections.rows, leaves:leaves.rows, leaveBalance:leaveBalance.rows[0] } });
}));

const selfPunchSchema = z.object({
  eventType: z.enum(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"]),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
}).refine((value) => (value.latitude == null) === (value.longitude == null), { message: "Provide both coordinates or neither" });

const allowedNext: Record<string, string[]> = {
  NONE: ["CLOCK_IN"], CLOCK_IN: ["BREAK_START", "CLOCK_OUT"], BREAK_START: ["BREAK_END"], BREAK_END: ["BREAK_START", "CLOCK_OUT"], CLOCK_OUT: [],
};

employeeRouter.post("/me/punches", asyncHandler(async (request, response) => {
  const input = selfPunchSchema.parse(request.body);
  const { sub, companyId, role } = (request as AuthRequest).auth;
  if (role !== "EMPLOYEE") throw new HttpError(403, "Employee access required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const employee = await client.query<{ id: string; primary_location_id: string | null; timezone:string }>(
      `SELECT e.id,e.primary_location_id,c.timezone FROM employees e JOIN companies c ON c.id=e.company_id WHERE e.user_id=$1 AND e.company_id=$2 AND e.status='ACTIVE' FOR UPDATE OF e`, [sub, companyId],
    );
    if (!employee.rows[0]) throw new HttpError(403, "An active employee profile is required to clock time");
    const last = await client.query<{ event_type: string }>(
      `SELECT event_type FROM punches WHERE company_id=$1 AND employee_id=$2 AND (occurred_at AT TIME ZONE $3)::date=(now() AT TIME ZONE $3)::date ORDER BY occurred_at DESC LIMIT 1`,
      [companyId, employee.rows[0].id, employee.rows[0].timezone],
    );
    const previousType = last.rows[0]?.event_type ?? "NONE";
    if (!allowedNext[previousType]?.includes(input.eventType)) throw new HttpError(409, `Cannot record ${input.eventType.toLowerCase().replaceAll("_", " ")} after ${previousType.toLowerCase().replaceAll("_", " ")}`);

    const shift = await client.query<{ id: string; location_id: string | null }>(
      `SELECT id,location_id FROM shifts WHERE company_id=$1 AND employee_id=$2 AND status='PUBLISHED'
       AND (starts_at AT TIME ZONE $3)::date=(now() AT TIME ZONE $3)::date ORDER BY abs(extract(epoch FROM starts_at-now())) LIMIT 1`, [companyId, employee.rows[0].id, employee.rows[0].timezone],
    );
    const locationId = shift.rows[0]?.location_id ?? employee.rows[0].primary_location_id;
    const location = locationId ? await client.query<{ name: string; latitude: string | null; longitude: string | null; geofence_radius_m: number }>(
      `SELECT name,latitude,longitude,geofence_radius_m FROM locations WHERE id=$1 AND company_id=$2 AND active=true`, [locationId, companyId],
    ) : null;
    const configured = location?.rows[0]?.latitude != null && location.rows[0].longitude != null;
    const hasCoordinates = input.latitude != null && input.longitude != null;
    const withinGeofence = configured && hasCoordinates
      ? isWithinGeofence(
          { latitude: Number(location!.rows[0].latitude), longitude: Number(location!.rows[0].longitude) },
          { latitude: input.latitude!, longitude: input.longitude! }, location!.rows[0].geofence_radius_m,
        )
      : null;
    const punch = await client.query(
      `INSERT INTO punches(company_id,employee_id,shift_id,event_type,occurred_at,source,latitude,longitude,within_geofence)
       VALUES($1,$2,$3,$4,now(),'MOBILE',$5,$6,$7)
       RETURNING id,event_type AS "eventType",occurred_at AS "occurredAt",source,within_geofence AS "withinGeofence"`,
      [companyId, employee.rows[0].id, shift.rows[0]?.id ?? null, input.eventType, input.latitude ?? null, input.longitude ?? null, withinGeofence],
    );
    if (input.eventType === "CLOCK_IN" && configured && withinGeofence !== true) {
      const type = withinGeofence === false ? "OUTSIDE_GEOFENCE" : "LOCATION_UNVERIFIED";
      const severity = withinGeofence === false ? "HIGH" : "MEDIUM";
      const details = withinGeofence === false ? `Clock-in was outside ${location!.rows[0].name}` : "Clock-in location could not be verified";
      await client.query(
        `INSERT INTO attendance_exceptions(company_id,employee_id,shift_id,exception_type,severity,details)
         VALUES($1,$2,$3,$4,$5,$6)`, [companyId, employee.rows[0].id, shift.rows[0]?.id ?? null, type, severity, details],
      );
    }
    await client.query(
      `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value)
       VALUES($1,$2,'EMPLOYEE_PUNCH_CREATED','PUNCH',$3,$4)`, [companyId, sub, punch.rows[0].id, JSON.stringify(punch.rows[0])],
    );
    await client.query("COMMIT");
    response.status(201).json({ data: { ...punch.rows[0], location: location?.rows[0]?.name ?? null } });
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}));

const correctionSchema = z.object({
  eventType: z.enum(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"]),
  occurredAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(10).max(500),
}).superRefine((value, context) => {
  const timestamp = Date.parse(value.occurredAt);
  if (timestamp > Date.now() + 5 * 60_000) context.addIssue({ code: "custom", path: ["occurredAt"], message: "Correction time cannot be in the future" });
});

employeeRouter.post("/me/corrections", asyncHandler(async (request, response) => {
  const input = correctionSchema.parse(request.body);
  const { sub, companyId, role } = (request as AuthRequest).auth;
  if (role !== "EMPLOYEE") throw new HttpError(403, "Employee access required");
  const policy=await pool.query<{days:number}>(`SELECT correction_window_days::int AS days FROM companies WHERE id=$1`,[companyId]);const correctionDays=policy.rows[0]?.days??45;if(Date.parse(input.occurredAt)<Date.now()-correctionDays*86_400_000)throw new HttpError(400,`Corrections are limited to the last ${correctionDays} days`);
  const employeeId = await employeeForUser(sub, companyId);
  const shift = await pool.query<{ id: string }>(
    `SELECT id FROM shifts WHERE company_id=$1 AND employee_id=$2 AND status<>'CANCELLED' AND starts_at::date=$3::timestamptz::date
     ORDER BY abs(extract(epoch FROM starts_at-$3::timestamptz)) LIMIT 1`, [companyId, employeeId, input.occurredAt],
  );
  const requestedCorrection = { operation: "CREATE_PUNCH", eventType: input.eventType, occurredAt: input.occurredAt };
  const result = await pool.query(
    `INSERT INTO attendance_exceptions(company_id,employee_id,shift_id,exception_type,severity,details,requested_correction)
     VALUES($1,$2,$3,'CORRECTION_REQUEST','MEDIUM',$4,$5)
     RETURNING id,status,created_at AS "createdAt",requested_correction AS "requestedCorrection"`,
    [companyId, employeeId, shift.rows[0]?.id ?? null, input.reason, JSON.stringify(requestedCorrection)],
  );
  await pool.query(
    `INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value)
     VALUES($1,$2,'ATTENDANCE_CORRECTION_REQUESTED','ATTENDANCE_EXCEPTION',$3,$4)`,
    [companyId, sub, result.rows[0].id, JSON.stringify({ ...requestedCorrection, reason: input.reason })],
  );
  response.status(201).json({ data: result.rows[0] });
}));

const leaveRequestSchema=z.object({leaveType:z.enum(["ANNUAL","SICK","UNPAID","OTHER"]),startsOn:z.string().date(),endsOn:z.string().date(),reason:z.string().trim().min(10).max(500)}).superRefine((value,context)=>{if(value.endsOn<value.startsOn)context.addIssue({code:"custom",path:["endsOn"],message:"End date must be on or after start date"});const duration=(Date.parse(value.endsOn)-Date.parse(value.startsOn))/86_400_000;if(duration>365)context.addIssue({code:"custom",path:["endsOn"],message:"Leave cannot exceed one year"});});

employeeRouter.post("/me/leaves",asyncHandler(async(request,response)=>{
  const input=leaveRequestSchema.parse(request.body);const{sub,companyId,role}=(request as AuthRequest).auth;if(role!=="EMPLOYEE")throw new HttpError(403,"Employee access required");const employeeId=await employeeForUser(sub,companyId);
  const overlap=await pool.query(`SELECT id FROM leave_requests WHERE company_id=$1 AND employee_id=$2 AND status IN('PENDING','APPROVED') AND starts_on<=$4::date AND ends_on>=$3::date LIMIT 1`,[companyId,employeeId,input.startsOn,input.endsOn]);if(overlap.rows[0])throw new HttpError(409,"A pending or approved leave request already covers these dates");
  const result=await pool.query(`INSERT INTO leave_requests(company_id,employee_id,leave_type,starts_on,ends_on,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,leave_type AS "leaveType",starts_on AS "startsOn",ends_on AS "endsOn",reason,status,created_at AS "createdAt"`,[companyId,employeeId,input.leaveType,input.startsOn,input.endsOn,input.reason]);
  await pool.query(`INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,next_value) VALUES($1,$2,'LEAVE_REQUESTED','LEAVE_REQUEST',$3,$4)`,[companyId,sub,result.rows[0].id,JSON.stringify(result.rows[0])]);response.status(201).json({data:result.rows[0]});
}));

employeeRouter.patch("/me/leaves/:id/cancel",asyncHandler(async(request,response)=>{
  const id=z.string().uuid().parse(request.params.id);const{sub,companyId,role}=(request as AuthRequest).auth;if(role!=="EMPLOYEE")throw new HttpError(403,"Employee access required");const employeeId=await employeeForUser(sub,companyId);const previous=await pool.query(`SELECT * FROM leave_requests WHERE id=$1 AND company_id=$2 AND employee_id=$3 AND status='PENDING'`,[id,companyId,employeeId]);if(!previous.rows[0])throw new HttpError(404,"Pending leave request not found");const result=await pool.query(`UPDATE leave_requests SET status='CANCELLED',updated_at=now() WHERE id=$1 RETURNING id,status`,[id]);await pool.query(`INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'LEAVE_CANCELLED','LEAVE_REQUEST',$3,$4,$5)`,[companyId,sub,id,JSON.stringify(previous.rows[0]),JSON.stringify(result.rows[0])]);response.json({data:result.rows[0]});
}));

employeeRouter.get("/leaves",requireManager,asyncHandler(async(request,response)=>{
  const{companyId}=(request as AuthRequest).auth;const status=z.enum(["PENDING","APPROVED","REJECTED","CANCELLED"]).optional().parse(request.query.status);const values:unknown[]=[companyId];let filter="l.company_id=$1";if(status){values.push(status);filter+=` AND l.status=$${values.length}`;}
  const result=await pool.query(`SELECT l.id,l.leave_type AS "leaveType",l.starts_on AS "startsOn",l.ends_on AS "endsOn",l.reason,l.status,l.manager_note AS "managerNote",l.created_at AS "createdAt",e.id AS "employeeId",e.full_name AS employee,e.job_title AS "jobTitle",loc.name AS location,(SELECT count(*)::int FROM shifts s WHERE s.employee_id=e.id AND s.company_id=l.company_id AND s.status<>'CANCELLED' AND s.starts_at::date BETWEEN l.starts_on AND l.ends_on) AS "shiftConflicts",(SELECT count(*)::int FROM generate_series(l.starts_on,l.ends_on,interval '1 day') d WHERE extract(isodow FROM d)<6) AS days FROM leave_requests l JOIN employees e ON e.id=l.employee_id LEFT JOIN locations loc ON loc.id=e.primary_location_id WHERE ${filter} ORDER BY CASE l.status WHEN 'PENDING' THEN 1 ELSE 2 END,l.starts_on`,values);response.json({data:result.rows});
}));

const leaveResolutionSchema=z.object({status:z.enum(["APPROVED","REJECTED"]),managerNote:z.string().trim().min(3).max(500)});
employeeRouter.patch("/leaves/:id",requireManager,asyncHandler(async(request,response)=>{
  const id=z.string().uuid().parse(request.params.id);const input=leaveResolutionSchema.parse(request.body);const{companyId,sub}=(request as AuthRequest).auth;const client=await pool.connect();try{await client.query("BEGIN");const previous=await client.query(`SELECT * FROM leave_requests WHERE id=$1 AND company_id=$2 AND status='PENDING' FOR UPDATE`,[id,companyId]);if(!previous.rows[0])throw new HttpError(404,"Pending leave request not found");const result=await client.query(`UPDATE leave_requests SET status=$1,manager_note=$2,resolved_by=$3,resolved_at=now(),updated_at=now() WHERE id=$4 RETURNING id,status,manager_note AS "managerNote",resolved_at AS "resolvedAt"`,[input.status,input.managerNote,sub,id]);await client.query(`INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,previous_value,next_value) VALUES($1,$2,'LEAVE_RESOLVED','LEAVE_REQUEST',$3,$4,$5)`,[companyId,sub,id,JSON.stringify(previous.rows[0]),JSON.stringify(result.rows[0])]);await client.query("COMMIT");response.json({data:result.rows[0]});}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}));
