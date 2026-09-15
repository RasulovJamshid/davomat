// Run against an isolated migrated test database after `npm run build`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../dist/app.js";
import { pool } from "../dist/db.js";
import { signAccessToken } from "../dist/auth.js";
import bcrypt from "bcryptjs";

const server = createApp().listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const url = `http://127.0.0.1:${server.address().port}/api`;
const company = randomUUID();
const otherCompany = randomUUID();
const manager = randomUUID(),
  worker = randomUUID(),
  otherWorker = randomUUID();
const hourly = randomUUID(),
  fixed = randomUUID();
const token = (sub, role, companyId = company) =>
  signAccessToken({
    sub,
    role,
    companyId,
    email: "test@example.invalid",
    tokenVersion: 0,
  });
const adminToken = token(manager, "ADMIN"),
  workerToken = token(worker, "EMPLOYEE"),
  otherToken = token(otherWorker, "EMPLOYEE", otherCompany);
async function api(path, token, method = "GET", body) {
  const response = await fetch(url + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
try {
  await pool.query(
    "INSERT INTO companies(id,name) VALUES($1,'Workforce test'),($2,'Other tenant')",
    [company, otherCompany],
  );
  for (const [id, co, role] of [
    [manager, company, "ADMIN"],
    [worker, company, "EMPLOYEE"],
    [otherWorker, otherCompany, "EMPLOYEE"],
  ])
    await pool.query(
      "INSERT INTO users(id,company_id,email,password_hash,display_name,role) VALUES($1,$2,$3,'unused','Test',$4)",
      [id, co, `${id}@example.invalid`, role],
    );
  for (const [id, uid, type] of [
    [hourly, worker, "HOURLY"],
    [fixed, null, "MONTHLY"],
  ])
    await pool.query(
      "INSERT INTO employees(id,company_id,user_id,employee_number,full_name,phone,job_title,status,salary_type,base_salary,hourly_rate) VALUES($1::uuid,$2,$3,$1::text,'Test employee',$1::text,'Tester','ACTIVE',$4,5280000,30000)",
      [id, company, uid, type],
    );
  // Mobile management must not require an employee profile or bind an attendance device.
  const password = "MobileAdminTest123!";
  await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
    await bcrypt.hash(password, 4),
    manager,
  ]);
  for (const role of ["ADMIN", "MANAGER"]) {
    await pool.query("UPDATE users SET role=$1 WHERE id=$2", [role, manager]);
    const login = await api("/auth/login", "", "POST", {
      email: `${manager}@example.invalid`,
      password,
      clientType: "MOBILE",
      deviceInstallationId: "mobile-management-test-installation-0001",
      devicePlatform: "ANDROID",
      deviceLabel: "Test Android",
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.user.role, role);
    assert.equal((await api("/employees", login.body.data.token)).status, 200);
    assert.equal(
      (await api("/me/workspace", login.body.data.token)).status,
      403,
    );
  }
  await pool.query("UPDATE users SET role='ADMIN' WHERE id=$1", [manager]);
  assert.equal((await api("/employees", workerToken)).status, 403);
  assert.equal((await api("/dashboard", workerToken)).status, 403);
  // June 2026: 22 planned 8-hour days, one missed day = 168 / 176 hours.
  await pool.query(
    `INSERT INTO shifts(company_id,employee_id,starts_at,ends_at,unpaid_break_minutes,status)
 SELECT $1,e.id,(d.day::date+time '09:00') AT TIME ZONE 'Asia/Tashkent',(d.day::date+time '17:00') AT TIME ZONE 'Asia/Tashkent',0,'PUBLISHED'
 FROM employees e CROSS JOIN generate_series('2026-06-01'::date,'2026-06-30'::date,interval '1 day') d(day) WHERE e.company_id=$1 AND extract(isodow FROM d.day)<6`,
    [company],
  );
  await pool.query(
    `INSERT INTO punches(company_id,employee_id,shift_id,event_type,occurred_at,source)
 SELECT company_id,employee_id,id,'CLOCK_IN',starts_at,'WEB' FROM shifts WHERE company_id=$1 AND (starts_at AT TIME ZONE 'Asia/Tashkent')::date<>'2026-06-30'
 UNION ALL SELECT company_id,employee_id,id,'CLOCK_OUT',ends_at,'WEB' FROM shifts WHERE company_id=$1 AND (starts_at AT TIME ZONE 'Asia/Tashkent')::date<>'2026-06-30'`,
    [company],
  );
  const summary = await api(
    "/workforce-summary?from=2026-06-01&to=2026-06-30",
    adminToken,
  );
  assert.equal(summary.status, 200);
  assert.equal(summary.body.data.length, 2);
  for (const row of summary.body.data) {
    assert.equal(row.expectedMinutes, 176 * 60);
    assert.equal(row.workedMinutes, 168 * 60);
    assert.equal(row.salary, 5040000);
    assert.equal(row.absentDays, 1);
    assert.equal(row.workedDays, 21);
  }
  const own = await api(
    "/workforce-summary?from=2026-06-01&to=2026-06-30",
    workerToken,
  );
  assert.equal(own.body.data.length, 1);
  assert.equal(own.body.data[0].employeeId, hourly);
  assert.equal(
    (
      await api(
        `/workforce-summary?from=2026-06-01&to=2026-06-30&employeeId=${fixed}`,
        workerToken,
      )
    ).body.data.length,
    0,
  );
  assert.equal(
    (await api("/workforce-summary?from=2026-06-01&to=2026-06-30", otherToken))
      .body.data.length,
    0,
  );
  assert.equal(
    (await api("/workforce-summary?from=2026-06-30&to=2026-06-01", adminToken))
      .status,
    400,
  );
  const period = (
    await pool.query(
      "INSERT INTO payroll_periods(company_id,starts_on,ends_on,tax_rate) VALUES($1,'2026-06-01','2026-06-30',0) RETURNING id",
      [company],
    )
  ).rows[0].id;
  await pool.query("SELECT recalculate_payroll_period($1,$2,0)", [
    company,
    period,
  ]);
  for (const row of (
    await pool.query(
      "SELECT base_salary,net_pay FROM payslips WHERE company_id=$1",
      [company],
    )
  ).rows) {
    assert.equal(row.base_salary, 5040000);
    assert.equal(row.net_pay, 5040000);
  }
  await pool.query(
    `INSERT INTO punches(company_id,employee_id,event_type,occurred_at,source) VALUES
    ($1,$2,'CLOCK_IN','2026-07-01 09:02+05','WEB'),($1,$2,'CLOCK_OUT','2026-07-01 18:05+05','WEB'),
    ($1,$2,'CLOCK_IN','2026-07-02 23:00+05','WEB'),($1,$2,'BREAK_START','2026-07-03 01:00+05','WEB'),
    ($1,$2,'BREAK_END','2026-07-03 01:30+05','WEB'),($1,$2,'CLOCK_OUT','2026-07-03 05:00+05','WEB')`,
    [company, fixed],
  );
  const precise = await api(
    `/workforce-summary?from=2026-07-01&to=2026-07-01&employeeId=${fixed}`,
    adminToken,
  );
  assert.equal(precise.body.data[0].workedMinutes, 543);
  const overnight = await api(
    `/workforce-summary?from=2026-07-02&to=2026-07-02&employeeId=${fixed}`,
    adminToken,
  );
  assert.equal(overnight.body.data[0].workedMinutes, 330);
  assert.equal(overnight.body.data[0].workedDays, 1);
  const task = {
    title: "Prepare report",
    description: "June report",
    employeeId: hourly,
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    priority: "HIGH",
  };
  assert.equal((await api("/tasks", workerToken, "POST", task)).status, 403);
  const created = await api("/tasks", adminToken, "POST", task);
  assert.equal(created.status, 201);
  const taskId = created.body.data.id;
  assert.equal((await api("/tasks", workerToken)).body.data.length, 1);
  assert.equal((await api("/tasks", otherToken)).body.data.length, 0);
  assert.equal(
    (
      await api(`/tasks/${taskId}/status`, otherToken, "PATCH", {
        status: "IN_PROGRESS",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await api(`/tasks/${taskId}/status`, workerToken, "PATCH", {
        status: "DONE",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api(`/tasks/${taskId}/status`, workerToken, "PATCH", {
        status: "IN_PROGRESS",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api(`/tasks/${taskId}/status`, workerToken, "PATCH", {
        status: "DONE",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api(`/tasks/${taskId}/status`, workerToken, "PATCH", {
        status: "NEW",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api(`/tasks/${taskId}/status`, adminToken, "PATCH", {
        status: "NEW",
      })
    ).status,
    200,
  );
  const concurrent = await Promise.all([
    api("/me/web-punches", workerToken, "POST", { eventType: "CLOCK_IN" }),
    api("/me/web-punches", workerToken, "POST", { eventType: "CLOCK_IN" }),
  ]);
  assert.deepEqual(concurrent.map((x) => x.status).sort(), [201, 409]);
  assert.equal((await api("/dashboard", adminToken)).body.data.workingNow, 1);
  assert.equal(
    (
      await api("/me/web-punches", adminToken, "POST", {
        eventType: "CLOCK_IN",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/me/web-punches", workerToken, "POST", {
        eventType: "CLOCK_OUT",
        occurredAt: "2000-01-01",
      })
    ).status,
    400,
  );
  // Move this test's open event across midnight; checkout must still be allowed.
  await pool.query(
    "UPDATE punches SET occurred_at=now()-interval '1 day' WHERE id=$1",
    [concurrent.find((x) => x.status === 201).body.data.id],
  );
  assert.equal((await api("/dashboard", adminToken)).body.data.workingNow, 1);
  assert.equal(
    (
      await api("/me/web-punches", workerToken, "POST", {
        eventType: "CLOCK_OUT",
      })
    ).status,
    201,
  );
  assert.equal((await api("/dashboard", adminToken)).body.data.workingNow, 0);
  assert.equal(
    (
      await api("/me/web-punches", workerToken, "POST", {
        eventType: "CLOCK_OUT",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("/me/web-punches", workerToken, "POST", {
        eventType: "CLOCK_IN",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api(`/employees/${fixed}`, adminToken, "PATCH", {
        salaryType: "HOURLY",
        hourlyRate: 32000,
      })
    ).status,
    200,
  );
  assert.equal(
    (await api("/employees", adminToken)).body.data.find((x) => x.id === fixed)
      .salaryType,
    "HOURLY",
  );
  // Native management workflows use tenant-scoped, persistent records.
  const location = randomUUID();
  await pool.query(
    "INSERT INTO locations(id,company_id,name) VALUES($1,$2,'Test office')",
    [location, company],
  );
  const template = {
    name: "Weekdays",
    employeeId: hourly,
    locationId: location,
    weekdays: [1, 2, 3, 4, 5],
    startTime: "09:00",
    endTime: "18:00",
    unpaidBreakMinutes: 60,
  };
  assert.equal(
    (await api("/schedule-templates", workerToken, "POST", template)).status,
    403,
  );
  const schedule = await api(
    "/schedule-templates",
    adminToken,
    "POST",
    template,
  );
  assert.equal(schedule.status, 201);
  const generation = { from: "2027-01-04", to: "2027-01-10" };
  const generated = await api(
    `/schedule-templates/${schedule.body.data.id}/generate`,
    adminToken,
    "POST",
    generation,
  );
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  assert.deepEqual(generated.body.data, { created: 5, skipped: 0 });
  assert.deepEqual(
    (
      await api(
        `/schedule-templates/${schedule.body.data.id}/generate`,
        adminToken,
        "POST",
        generation,
      )
    ).body.data,
    { created: 0, skipped: 5 },
  );
  const conflict = await api("/schedule-templates", adminToken, "POST", {
    ...template,
    startTime: "10:00",
  });
  assert.equal(
    (
      await api(
        `/schedule-templates/${conflict.body.data.id}/generate`,
        adminToken,
        "POST",
        generation,
      )
    ).status,
    409,
  );
  assert.equal(
    (await api(`/employees/${hourly}/overview`, adminToken)).body.data.periods
      .length,
    3,
  );
  assert.equal(
    (await api(`/employees/${hourly}/overview`, workerToken)).status,
    403,
  );
  assert.equal(
    (await api(`/employees/${hourly}/overview`, otherToken)).status,
    403,
  );
  await pool.query("UPDATE users SET role='MANAGER' WHERE id=$1", [
    otherWorker,
  ]);
  assert.equal(
    (await api(`/employees/${hourly}/overview`, otherToken)).status,
    404,
  );
  assert.equal(
    (
      await api(
        `/schedule-templates/${schedule.body.data.id}/generate`,
        otherToken,
        "POST",
        generation,
      )
    ).status,
    404,
  );
  await pool.query("UPDATE users SET role='EMPLOYEE' WHERE id=$1", [
    otherWorker,
  ]);
  const checklist = await api("/collaboration", adminToken, "POST", {
    kind: "checklists",
    title: "Opening",
    employeeId: hourly,
    details: { items: ["Lights", "Stock"] },
  });
  assert.equal(checklist.status, 201, JSON.stringify(checklist.body));
  const checklistId = checklist.body.data.id;
  assert.equal(
    (await api(`/collaboration/${checklistId}`, otherToken)).status,
    404,
  );
  assert.equal(
    (
      await api(`/collaboration/${checklistId}/response`, workerToken, "PUT", {
        checked: [0, 1],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api(`/collaboration/${checklistId}/response`, workerToken, "PUT", {
        checked: [9],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api(`/collaboration/${checklistId}/comments`, workerToken, "POST", {
        body: "Done",
      })
    ).status,
    201,
  );
  assert.equal(
    (await api(`/collaboration/${checklistId}`, adminToken)).body.data
      .responses[0].value.checked.length,
    2,
  );
  assert.equal(
    (
      await api(`/collaboration/${checklistId}/status`, workerToken, "PATCH", {
        status: "CLOSED",
      })
    ).status,
    403,
  );
  await api(`/collaboration/${checklistId}/status`, adminToken, "PATCH", {
    status: "CLOSED",
  });
  assert.equal(
    (
      await api(`/collaboration/${checklistId}/response`, workerToken, "PUT", {
        checked: [],
      })
    ).status,
    409,
  );
  const survey = await api("/collaboration", adminToken, "POST", {
    kind: "surveys",
    title: "Lunch",
    details: { options: ["A", "B"] },
  });
  const surveyId = survey.body.data.id;
  await api(`/collaboration/${surveyId}/response`, workerToken, "PUT", {
    option: 1,
  });
  await api(`/collaboration/${surveyId}/response`, workerToken, "PUT", {
    option: 0,
  });
  const answers = (await api(`/collaboration/${surveyId}`, workerToken)).body
    .data;
  assert.deepEqual(answers.counts, [1, 0]);
  assert.equal(answers.responses, undefined);
  assert.equal(
    (
      await api("/collaboration", workerToken, "POST", {
        kind: "announcements",
        title: "Unauthorized",
      })
    ).status,
    403,
  );
  const document = await api("/collaboration", adminToken, "POST", {
    kind: "documents",
    title: "Policy",
    employeeId: hourly,
    file: {
      name: "policy.txt",
      mime: "text/plain",
      base64: Buffer.from("Policy text").toString("base64"),
    },
  });
  assert.equal(document.status, 201, JSON.stringify(document.body));
  const file = await fetch(
    `${url}/collaboration/${document.body.data.id}/file`,
    { headers: { Authorization: `Bearer ${workerToken}` } },
  );
  assert.equal(file.status, 200);
  assert.equal(await file.text(), "Policy text");
  assert.equal(
    (
      await fetch(`${url}/collaboration/${document.body.data.id}/file`, {
        headers: { Authorization: `Bearer ${otherToken}` },
      })
    ).status,
    404,
  );
  const trip = await api("/collaboration", workerToken, "POST", {
    kind: "trips",
    title: "Client visit",
    employeeId: hourly,
    details: {
      destination: "Samarkand",
      startsOn: "2027-01-01",
      endsOn: "2027-01-02",
    },
  });
  assert.equal(trip.status, 201);
  assert.equal(
    (
      await api(
        `/collaboration/${trip.body.data.id}/status`,
        adminToken,
        "PATCH",
        { status: "APPROVED", note: "Approved travel" },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await api("/collaboration", workerToken, "POST", {
        kind: "trips",
        title: "Invalid",
        employeeId: fixed,
        details: {
          destination: "A",
          startsOn: "2027-01-01",
          endsOn: "2027-01-02",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/push/devices", workerToken, "POST", {
        token: "test-device-token-00000000000000000001",
      })
    ).status,
    200,
  );
  assert.ok((await api("/inbox", workerToken)).body.data.length > 0);
  assert.equal((await api("/inbox", otherToken)).body.data.length, 0);
  const inbox = (await api("/inbox", workerToken)).body.data;
  await api(`/inbox/${inbox[0].id}/read`, workerToken, "POST");
  assert.equal((await api("/inbox", workerToken)).body.data[0].read, true);
  assert.equal(
    (
      await api("/push/devices", workerToken, "DELETE", {
        token: "test-device-token-00000000000000000001",
      })
    ).status,
    200,
  );
  assert.equal(
    (await api(`/employees/${hourly}`, workerToken, "DELETE")).status,
    403,
  );
  assert.equal(
    (await api(`/employees/${hourly}`, adminToken, "DELETE")).status,
    200,
  );
  assert.equal((await api("/tasks", workerToken)).status, 401);
  assert.ok(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM punches WHERE employee_id=$1",
        [hourly],
      )
    ).rows[0].count > 0,
  );
  console.log(
    "PASS: attendance/payroll/task regressions; mobile role boundaries; recurring generation; employee profiles; checklists/surveys/documents/trips; tenant isolation; notification inbox.",
  );
} finally {
  await pool.query(
    "DELETE FROM collaboration_items WHERE company_id IN($1,$2)",
    [company, otherCompany],
  );
  await pool.query(
    "DELETE FROM schedule_templates WHERE company_id IN($1,$2)",
    [company, otherCompany],
  );
  await pool.query("DELETE FROM employee_tasks WHERE company_id IN($1,$2)", [
    company,
    otherCompany,
  ]);
  await pool.query("DELETE FROM companies WHERE id IN($1,$2)", [
    company,
    otherCompany,
  ]);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
