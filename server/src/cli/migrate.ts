import { closeDatabase } from "../db.js";
import { runMigrations } from "../migrations.js";

await runMigrations();
await closeDatabase();
