import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";
import { invalidFieldMessage, localize } from "./localization.js";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const asyncHandler = (handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (request, response, next) => { void handler(request, response, next).catch(next); };

export function notFoundHandler(request: Request, response: Response): void {
  response.status(404).json({ error: { code: "ROUTE_NOT_FOUND", message: localize(request, "Route not found") } });
}

export function errorHandler(error: unknown, request: Request, response: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    const fields=Object.fromEntries(Object.keys(error.flatten().fieldErrors).map((field)=>[field,[invalidFieldMessage(request)]]));
    response.status(400).json({ error: { code: "VALIDATION_FAILED", message: localize(request, "Validation failed"), fields } });
    return;
  }
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: { code: "REQUEST_FAILED", message: localize(request, error.message), details: error.details } });
    return;
  }
  const databaseError = error as { code?: string };
  if (databaseError.code === "23P01") {
    response.status(409).json({ error: { code: "SHIFT_OVERLAP", message: localize(request, "This shift overlaps an existing assignment") } });
    return;
  }
  if (databaseError.code === "23505") {
    response.status(409).json({ error: { code: "DUPLICATE_RECORD", message: localize(request, "A record with these values already exists") } });
    return;
  }
  logger.error({ error, method: request.method, path: request.path }, "unhandled request error");
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: localize(request, "An unexpected server error occurred") } });
}
