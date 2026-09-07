import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { closeDatabase, pool } from "../db.js";
import { runMigrations } from "../migrations.js";

async function bootstrap(): Promise<void> {
  await runMigrations();
  const passwordHash = await bcrypt.hash(config.SEED_ADMIN_PASSWORD, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let company = await client.query<{ id: string }>(
      "SELECT id FROM companies WHERE name=$1 ORDER BY created_at LIMIT 1",
      [config.BOOTSTRAP_COMPANY_NAME],
    );
    if (!company.rows[0]) {
      company = await client.query<{ id: string }>(
        "INSERT INTO companies(name) VALUES ($1) RETURNING id",
        [config.BOOTSTRAP_COMPANY_NAME],
      );
    }
    const result = await client.query<{ id: string }>(
      `INSERT INTO users(company_id,email,password_hash,display_name,role)
       VALUES ($1,$2,$3,'Administrator','ADMIN')
       ON CONFLICT (company_id,email) DO NOTHING
       RETURNING id`,
      [company.rows[0].id, config.SEED_ADMIN_EMAIL.toLowerCase(), passwordHash],
    );
    await client.query("COMMIT");
    console.log(result.rows[0]
      ? `Created ${config.SEED_ADMIN_EMAIL} for ${config.BOOTSTRAP_COMPANY_NAME}.`
      : `Admin ${config.SEED_ADMIN_EMAIL} already exists; no password was changed.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

bootstrap()
  .finally(closeDatabase)
  .catch((error) => { console.error(error); process.exitCode = 1; });
