import pg from "pg";
import { config } from "./config.js";

const { Pool, types } = pg;
types.setTypeParser(20, (value) => Number(value));

export const pool = new Pool({
  ...(config.DATABASE_URL
    ? { connectionString: config.DATABASE_URL }
    : {
        host: config.DB_HOST,
        port: config.DB_PORT,
        database: config.DB_NAME,
        user: config.DB_USER,
        password: config.DB_PASSWORD,
      }),
  max: config.NODE_ENV === "production" ? 20 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
