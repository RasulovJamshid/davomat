import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { pool } from "./db.js";
import { logger } from "./logger.js";

const ids = {
  company: "10000000-0000-4000-8000-000000000001",
  admin: "20000000-0000-4000-8000-000000000001",
  employeeUser: "20000000-0000-4000-8000-000000000002",
  departments: {
    sales: "30000000-0000-4000-8000-000000000001",
    operations: "30000000-0000-4000-8000-000000000002",
    finance: "30000000-0000-4000-8000-000000000003",
    logistics: "30000000-0000-4000-8000-000000000004",
  },
  locations: {
    head: "40000000-0000-4000-8000-000000000001",
    yunusobod: "40000000-0000-4000-8000-000000000002",
    chilonzor: "40000000-0000-4000-8000-000000000003",
    mirzo: "40000000-0000-4000-8000-000000000004",
    sergeli: "40000000-0000-4000-8000-000000000005",
  },
};

const seedEmployees = [
  ["50000000-0000-4000-8000-000000000001", "NR-0001", "Aziza Karimova", "+998 90 245 18 40", "aziza@navruz.uz", "Sales lead", ids.departments.sales, ids.locations.yunusobod, "EMPLOYEE", "ACTIVE", 6_200_000, 35_000],
  ["50000000-0000-4000-8000-000000000002", "NR-0002", "Jahongir Sobirov", "+998 93 620 44 10", "jahongir@navruz.uz", "Barista", ids.departments.operations, ids.locations.chilonzor, "EMPLOYEE", "ACTIVE", 4_100_000, 23_000],
  ["50000000-0000-4000-8000-000000000003", "NR-0003", "Malika Normurodova", "+998 97 335 09 72", "malika@navruz.uz", "Accountant", ids.departments.finance, ids.locations.head, "ADMINISTRATOR", "ACTIVE", 7_400_000, 42_000],
  ["50000000-0000-4000-8000-000000000004", "NR-0004", "Bekzod Rahimov", "+998 99 734 28 15", "bekzod@navruz.uz", "Courier", ids.departments.logistics, ids.locations.mirzo, "EMPLOYEE", "ACTIVE", 4_800_000, 27_000],
  ["50000000-0000-4000-8000-000000000005", "NR-0005", "Sabina Olimova", "+998 95 187 54 32", "sabina@navruz.uz", "Store manager", ids.departments.operations, ids.locations.sergeli, "LOCATION_MANAGER", "ON_LEAVE", 6_800_000, 38_000],
  ["50000000-0000-4000-8000-000000000006", "NR-0006", "Dilshod Nazarov", "+998 90 653 73 18", "dilshod@navruz.uz", "Stock associate", ids.departments.operations, ids.locations.sergeli, "EMPLOYEE", "ACTIVE", 4_300_000, 24_000],
] as const;

export async function seedDatabase(): Promise<void> {
  const passwordHash = await bcrypt.hash(config.SEED_ADMIN_PASSWORD, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO companies(id, name) VALUES ($1, 'Navruz Retail') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`, [ids.company]);
    await client.query(`INSERT INTO users(id, company_id, email, password_hash, display_name, role) VALUES ($1,$2,$3,$4,'Aziz N.','ADMIN') ON CONFLICT (company_id,email) DO NOTHING`, [ids.admin, ids.company, config.SEED_ADMIN_EMAIL.toLowerCase(), passwordHash]);
    for (const [key, name] of [[ids.departments.sales, "Sales"], [ids.departments.operations, "Operations"], [ids.departments.finance, "Finance"], [ids.departments.logistics, "Logistics"]]) {
      await client.query(`INSERT INTO departments(id, company_id, name) VALUES ($1,$2,$3) ON CONFLICT (company_id,name) DO NOTHING`, [key, ids.company, name]);
    }
    for (const [key, name, latitude, longitude] of [[ids.locations.head, "Head office", 41.311081, 69.240562], [ids.locations.yunusobod, "Yunusobod", 41.366180, 69.288451], [ids.locations.chilonzor, "Chilonzor", 41.274810, 69.203400], [ids.locations.mirzo, "Mirzo Ulugbek", 41.326210, 69.326890], [ids.locations.sergeli, "Sergeli", 41.226570, 69.219790]] as const) {
      await client.query(`INSERT INTO locations(id, company_id, name, latitude, longitude) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (company_id,name) DO UPDATE SET latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude`, [key, ids.company, name, latitude, longitude]);
    }
    for (const person of seedEmployees) {
      await client.query(`INSERT INTO employees(id,company_id,employee_number,full_name,phone,email,job_title,department_id,primary_location_id,access_role,status,joined_on,base_salary,hourly_rate) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_DATE - interval '300 days',$12,$13) ON CONFLICT (company_id,employee_number) DO UPDATE SET full_name=EXCLUDED.full_name, job_title=EXCLUDED.job_title, base_salary=EXCLUDED.base_salary, hourly_rate=EXCLUDED.hourly_rate`, [person[0], ids.company, ...person.slice(1)]);
    }
    await client.query(
      `INSERT INTO users(id,company_id,email,password_hash,display_name,role)
       VALUES($1,$2,'employee@atlas.local',$3,'Aziza Karimova','EMPLOYEE')
       ON CONFLICT (company_id,email) DO UPDATE SET password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name,active=true`,
      [ids.employeeUser, ids.company, passwordHash],
    );
    await client.query(`UPDATE employees SET user_id=$1 WHERE id=$2 AND company_id=$3`, [ids.employeeUser, seedEmployees[0][0], ids.company]);
    const period = await client.query<{ id: string }>(`INSERT INTO payroll_periods(company_id,starts_on,ends_on,status) VALUES ($1,date_trunc('month',CURRENT_DATE)::date,(date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day')::date,'REVIEW') ON CONFLICT (company_id,starts_on,ends_on) DO UPDATE SET status=payroll_periods.status RETURNING id`, [ids.company]);
    for (let index = 0; index < seedEmployees.length; index += 1) {
      const person = seedEmployees[index];
      const base = Number(person[10]); const overtimeMinutes = [95,210,0,145,60,320][index]; const overtimePay = Math.round(Number(person[11]) * overtimeMinutes / 60 * 1.5); const bonuses = [350000,150000,500000,200000,400000,100000][index]; const deductions = [67500,92000,0,135000,0,48000][index]; const tax = Math.round(base * 0.12); const gross = base + overtimePay + bonuses; const net = gross - deductions - tax; const status = ["READY","REVIEW","APPROVED","REVIEW","READY","READY"][index];
      await client.query(`INSERT INTO payslips(company_id,payroll_period_id,employee_id,base_salary,overtime_minutes,overtime_pay,bonuses,deductions,tax,gross_pay,net_pay,status,attendance_issue) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (payroll_period_id,employee_id) DO NOTHING`, [ids.company, period.rows[0].id, person[0], base, overtimeMinutes, overtimePay, bonuses, deductions, tax, gross, net, status, status === "REVIEW" ? "Attendance exceptions require review" : null]);
    }
    const employeeIds = seedEmployees.map((person) => person[0]);
    for (let index = 0; index < employeeIds.length; index += 1) {
      const employeeId = employeeIds[index];
      const locationId = seedEmployees[index][7];
      const shiftResult = await client.query<{ id: string }>(`INSERT INTO shifts(company_id,employee_id,location_id,starts_at,ends_at,created_by) SELECT $1,$2,$3,CURRENT_DATE + time '09:00',CURRENT_DATE + time '18:00',$4 WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE company_id=$1 AND employee_id=$2 AND starts_at::date=CURRENT_DATE) RETURNING id`, [ids.company, employeeId, locationId, ids.admin]);
      if (shiftResult.rows[0] && index < 4) {
        const late = index === 1 ? 17 : index === 3 ? 4 : 0;
        await client.query(`INSERT INTO punches(company_id,employee_id,shift_id,event_type,occurred_at,source,within_geofence) VALUES ($1,$2,$3,'CLOCK_IN',CURRENT_DATE + time '09:00' + ($4 || ' minutes')::interval,$5,$6)`, [ids.company, employeeId, shiftResult.rows[0].id, late, index % 2 ? "KIOSK" : "MOBILE", index !== 3]);
      }
    }
    for (const [employeeIndex, type, severity, details] of [[3,"OUTSIDE_GEOFENCE","HIGH","Clock-in was recorded outside the approved work location"],[1,"LATE","MEDIUM","Arrival exceeded the configured grace period"],[5,"MISSING_CLOCK_OUT","HIGH","Previous shift has no clock-out event"]] as const) {
      await client.query(`INSERT INTO attendance_exceptions(company_id,employee_id,exception_type,severity,details) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM attendance_exceptions WHERE company_id=$1 AND employee_id=$2 AND exception_type=$3 AND status='PENDING')`, [ids.company, employeeIds[employeeIndex], type, severity, details]);
    }
    await client.query("COMMIT");
    logger.info({ adminEmail: config.SEED_ADMIN_EMAIL }, "development data seeded");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
