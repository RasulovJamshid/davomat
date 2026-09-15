import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../dist/app.js";
import { pool } from "../dist/db.js";
import { signAccessToken } from "../dist/auth.js";
import { maintainWeeklySchedules } from "../dist/weeklySchedules.js";
const company = randomUUID(),
  otherCompany = randomUUID(),
  admin = randomUUID(),
  worker = randomUUID(),
  foreignAdmin = randomUUID(),
  employee = randomUUID(),
  location = randomUUID();
const server = createApp().listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api`;
const token = (id, co, role) =>
  signAccessToken({
    sub: id,
    companyId: co,
    role,
    email: "test@example.invalid",
    tokenVersion: 0,
  });
const managerToken = token(admin, company, "ADMIN"),
  employeeToken = token(worker, company, "EMPLOYEE"),
  otherToken = token(foreignAdmin, otherCompany, "ADMIN");
async function api(path, method = "GET", body, auth = managerToken) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
try {
  await pool.query(
    "INSERT INTO companies(id,name,timezone) VALUES($1,'Weekly test','Asia/Tashkent'),($2,'Other','Asia/Tashkent')",
    [company, otherCompany],
  );
  for (const [id, co, role] of [
    [admin, company, "ADMIN"],
    [worker, company, "EMPLOYEE"],
    [foreignAdmin, otherCompany, "ADMIN"],
  ])
    await pool.query(
      "INSERT INTO users(id,company_id,email,password_hash,display_name,role) VALUES($1::uuid,$2,$1::text||'@example.invalid','unused','Test',$3)",
      [id, co, role],
    );
  await pool.query(
    "INSERT INTO locations(id,company_id,name) VALUES($1,$2,'Office')",
    [location, company],
  );
  async function addEmployee(id, user = null) {
    await pool.query(
      "INSERT INTO employees(id,company_id,user_id,employee_number,full_name,phone,job_title,status,primary_location_id) VALUES($1::uuid,$2,$3,$1::text,'Test employee',$1::text,'Tester','ACTIVE',$4)",
      [id, company, user, location],
    );
  }
  await addEmployee(employee, worker);
  const today = (
    await pool.query(
      "SELECT (now() AT TIME ZONE 'Asia/Tashkent')::date::text AS day",
    )
  ).rows[0].day;
  const definition = {
    name: "Office week",
    scope: "ALL",
    scopeId: null,
    weekdays: [1, 2, 3, 4, 5],
    startsAt: "09:00",
    endsAt: "18:00",
    unpaidBreakMinutes: 60,
    graceMinutes: 5,
    locationId: null,
    effectiveFrom: today,
  };
  assert.equal(
    (await api("/work-schedules", "POST", definition, employeeToken)).status,
    403,
  );
  const first = await api("/work-schedules", "POST", definition);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const rule = first.body.data.id;
  assert.ok(first.body.data.created > 20);
  const generated = await pool.query(
    "SELECT *,recurring_date::text AS day FROM shifts WHERE company_id=$1 AND recurring_rule_id=$2 AND status='PUBLISHED' ORDER BY starts_at",
    [company, rule],
  );
  assert.ok(
    generated.rows.every((s) =>
      [1, 2, 3, 4, 5].includes(new Date(s.day + "T00:00Z").getUTCDay()),
    ),
  );
  assert.ok(
    generated.rows.every((s) => +s.ends_at - +s.starts_at === 9 * 3600000),
  );
  await maintainWeeklySchedules();
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM shifts WHERE company_id=$1 AND status<>'CANCELLED'",
        [company],
      )
    ).rows[0].n,
    generated.rowCount,
  );
  assert.equal((await api("/work-schedules", "POST", definition)).status, 409);
  assert.equal(
    (await api(`/work-schedules/${rule}`, "PUT", definition, otherToken))
      .status,
    404,
  );
  assert.equal(
    (await api("/work-schedules", "GET", undefined, otherToken)).body.data
      .length,
    0,
  );
  // Mobile and legacy web read the same rule IDs; no separate live template store remains.
  assert.ok(
    (await api("/schedule-templates")).body.data.some((r) => r.id === rule),
  );
  assert.ok(
    (await api("/recurring-schedules")).body.data.some((r) => r.id === rule),
  );
  // A fresh employee automatically inherits the company rule.
  const newcomer = randomUUID();
  await addEmployee(newcomer);
  await maintainWeeklySchedules();
  assert.ok(
    (
      await pool.query(
        "SELECT id FROM shifts WHERE employee_id=$1 AND status='PUBLISHED'",
        [newcomer],
      )
    ).rowCount > 20,
  );
  // Cancelling a single shift must survive regeneration and changes to the weekly rule.
  const cancelled = generated.rows.find(
    (s) => +s.starts_at > Date.now() + 86400000,
  );
  assert.equal(
    (await api(`/shifts/${cancelled.id}/cancel`, "PATCH")).status,
    200,
  );
  await maintainWeeklySchedules();
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM shifts WHERE employee_id=$1 AND recurring_date=$2 AND status<>'CANCELLED'",
        [employee, cancelled.day],
      )
    ).rowCount,
    0,
  );
  // An individual rule replaces the automatic company shift for that employee only.
  const individual = await api("/work-schedules", "POST", {
    ...definition,
    name: "Individual hours",
    scope: "EMPLOYEE",
    scopeId: employee,
    weekdays: [1, 2, 3],
    startsAt: "10:00",
    endsAt: "19:00",
  });
  assert.equal(individual.status, 201, JSON.stringify(individual.body));
  assert.ok(
    (
      await pool.query(
        "SELECT id FROM shifts WHERE employee_id=$1 AND status='PUBLISHED' AND recurring_rule_id=$2",
        [employee, individual.body.data.id],
      )
    ).rowCount > 10,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM shifts WHERE employee_id=$1 AND status='PUBLISHED' AND starts_at>now() AND extract(isodow FROM starts_at AT TIME ZONE 'Asia/Tashkent') IN (4,5)",
        [employee],
      )
    ).rowCount,
    0,
  );
  const manual = (
    await pool.query(
      "SELECT id,starts_at,ends_at,recurring_date::text AS day FROM shifts WHERE employee_id=$1 AND recurring_rule_id=$2 AND starts_at>now()+interval '2 days' AND status='PUBLISHED' ORDER BY starts_at LIMIT 1",
      [employee, individual.body.data.id],
    )
  ).rows[0];
  await pool.query(
    "UPDATE shifts SET starts_at=starts_at+interval '30 minutes' WHERE id=$1",
    [manual.id],
  );
  const edited = await api(
    `/work-schedules/${individual.body.data.id}`,
    "PUT",
    {
      ...definition,
      name: "Individual hours",
      scope: "EMPLOYEE",
      scopeId: employee,
      startsAt: "11:00",
      endsAt: "20:00",
    },
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const preserved = (
    await pool.query("SELECT * FROM shifts WHERE id=$1", [manual.id])
  ).rows[0];
  assert.equal(+preserved.starts_at, +manual.starts_at + 30 * 60000);
  assert.equal(preserved.status, "PUBLISHED");
  assert.equal(preserved.recurring_rule_id, null);
  // Simulate a gap at the far edge; the worker refills it without any UI request.
  const far = (
    await pool.query(
      "DELETE FROM shifts WHERE id=(SELECT id FROM shifts WHERE employee_id=$1 AND status='PUBLISHED' AND recurring_rule_id IS NOT NULL ORDER BY starts_at DESC LIMIT 1) RETURNING recurring_date::text AS day",
      [newcomer],
    )
  ).rows[0];
  await maintainWeeklySchedules();
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM shifts WHERE employee_id=$1 AND recurring_date=$2 AND status='PUBLISHED'",
        [newcomer, far.day],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (await api(`/work-schedules/${individual.body.data.id}`, "DELETE")).status,
    200,
  );
  assert.equal((await api(`/work-schedules/${rule}`, "DELETE")).status, 200);
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM shifts WHERE company_id=$1 AND recurring_rule_id IS NOT NULL AND starts_at>now() AND status<>'CANCELLED'",
        [company],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await pool.query("SELECT status FROM shifts WHERE id=$1", [manual.id]))
      .rows[0].status,
    "PUBLISHED",
  );
  const legacy = await api("/schedule-templates", "POST", {
    name: "Legacy draft",
    employeeId: newcomer,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    startTime: "09:00",
    endTime: "18:00",
  });
  assert.equal(legacy.status, 201);
  const draftDay = new Date(Date.now() + 10 * 86400000)
    .toISOString()
    .slice(0, 10);
  assert.equal(
    (
      await api(`/schedule-templates/${legacy.body.data.id}/generate`, "POST", {
        from: draftDay,
        to: draftDay,
      })
    ).status,
    200,
  );
  await api(`/work-schedules/${rule}`, "PUT", definition);
  await maintainWeeklySchedules();
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM shifts WHERE recurring_rule_id=$1 AND status='DRAFT'",
        [legacy.body.data.id],
      )
    ).rowCount,
    1,
  );
  console.log(
    "PASS: auto publication, shared web/mobile records, repeat safety, new employees, individual priority, cancellation/edit preservation, future refill, pause and tenant/role isolation",
  );
} finally {
  await pool.query("DELETE FROM companies WHERE id IN($1,$2)", [
    company,
    otherCompany,
  ]);
  await new Promise((r) => server.close(r));
  await pool.end();
}
