import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./http.js";
import { logger } from "./logger.js";
import { apiRouter } from "./routes.js";
import { pool } from "./db.js";
import { deviceRouter } from "./deviceRoutes.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(pinoHttp({ logger, autoLogging: { ignore: (request) => request.url === "/health" } }));
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  app.use(express.json({ limit: "1mb" }));
  app.get("/live",(_request,response)=>response.json({status:"ok",service:"atlas-api",timestamp:new Date().toISOString()}));
  app.get("/health", async (_request, response) => {
    try {
      await pool.query("SELECT 1");
      response.json({ status: "ok", service: "atlas-api", database: "connected", timestamp: new Date().toISOString() });
    } catch {
      response.status(503).json({ status: "unavailable", service: "atlas-api", database: "disconnected", timestamp: new Date().toISOString() });
    }
  });
  app.use("/api/device", deviceRouter);
  app.use("/api", apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
