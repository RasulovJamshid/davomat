import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  DB_HOST: z.string().min(1).default("localhost"),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1).default("atlas"),
  DB_USER: z.string().min(1).default("atlas"),
  DB_PASSWORD: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("8h"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  RUN_MIGRATIONS: z.enum(["true", "false"]).default("true"),
  RUN_SEED: z.enum(["true", "false"]).default("false"),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@atlas.local"),
  SEED_ADMIN_PASSWORD: z.string().min(10).default("ChangeMe123!"),
  BOOTSTRAP_COMPANY_NAME: z.string().trim().min(2).max(120).default("Atlas Company"),
  LOG_LEVEL: z.string().default("info"),
  SMTP_URL: z.preprocess((value)=>value===""?undefined:value,z.string().url().optional()),
  EMAIL_FROM: z.string().default("Atlas Workforce <no-reply@atlas.local>"),
  APP_PUBLIC_URL: z.string().url().default("http://localhost:5173"),
}).superRefine((environment, context) => {
  if (!environment.DATABASE_URL && !environment.DB_PASSWORD) {
    context.addIssue({
      code: "custom",
      path: ["DATABASE_URL"],
      message: "Set DATABASE_URL or DB_PASSWORD",
    });
  }
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  runMigrations: parsed.data.RUN_MIGRATIONS === "true",
  runSeed: parsed.data.RUN_SEED === "true",
};
