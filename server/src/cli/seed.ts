import { closeDatabase } from "../db.js";
import { seedDatabase } from "../seed.js";

await seedDatabase();
await closeDatabase();
