import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDatabase, pool } from "./db.js";
import { logger } from "./logger.js";
import { runMigrations } from "./migrations.js";
import { seedDatabase } from "./seed.js";
import { startReportScheduler } from "./reportScheduler.js";
import { startPushWorker } from "./push.js";

async function start(): Promise<void> {
  await pool.query("SELECT 1");
  if (config.runMigrations) await runMigrations();
  if (config.runSeed) await seedDatabase();
  const server = createApp().listen(config.PORT, "0.0.0.0", () => logger.info({ port: config.PORT }, "Atlas API listening"));
  const reportTimer=startReportScheduler();
  const pushTimer=startPushWorker();
  const shutdown = (signal: string) => {
    logger.info({ signal }, "graceful shutdown started");
    clearInterval(reportTimer);clearInterval(pushTimer);server.close(() => { void closeDatabase().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => { logger.fatal({ error }, "API failed to start"); process.exit(1); });
