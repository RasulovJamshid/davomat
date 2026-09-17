import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { asyncHandler, HttpError } from "./http.js";

export const deviceRouter = Router();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const eventSchema = z.object({
  eventId: z.string().trim().min(1).max(160),
  externalUserId: z.string().trim().min(1).max(160),
  eventType: z.enum(["ENTRY", "EXIT", "ACCESS_GRANTED", "ACCESS_DENIED"]),
  occurredAt: z.string().datetime(),
  confidence: z.number().min(0).max(1).optional(),
  livenessPassed: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

deviceRouter.post(
  "/events",
  asyncHandler(async (request, response) => {
    const serial = String(request.headers["x-device-serial"] ?? "");
    const apiKey = String(request.headers["x-device-key"] ?? "");
    if (!serial || !apiKey)
      throw new HttpError(401, "Device authentication required");
    const deviceResult = await pool.query<{
      id: string;
      company_id: string;
      device_type: string;
      api_key_hash: string;
    }>(
      "SELECT id,company_id,device_type,api_key_hash FROM devices WHERE serial_number=$1 AND active=true",
      [serial],
    );
    const device = deviceResult.rows[0];
    if (!device || !safeEqual(hash(apiKey), device.api_key_hash))
      throw new HttpError(401, "Device authentication failed");
    const input = eventSchema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const identity = await client.query<{
        employee_id: string;
        biometric_type: string;
      }>(
        `SELECT employee_id,biometric_type FROM biometric_identities WHERE device_id=$1 AND external_user_id=$2 AND active=true LIMIT 1`,
        [device.id, input.externalUserId],
      );
      const employeeId = identity.rows[0]?.employee_id ?? null;
      const livenessRejected =
        identity.rows[0]?.biometric_type === "FACE" &&
        input.livenessPassed !== true;
      const inserted = await client.query<{
        id: string;
        punch_id: string | null;
      }>(
        `INSERT INTO access_events(company_id,device_id,employee_id,external_event_id,external_user_id,event_type,occurred_at,confidence,liveness_passed,raw_payload)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(device_id,external_event_id) DO UPDATE SET external_event_id=excluded.external_event_id
         RETURNING id,punch_id`,
        [
          device.company_id,
          device.id,
          employeeId,
          input.eventId,
          input.externalUserId,
          livenessRejected ? "ACCESS_DENIED" : input.eventType,
          input.occurredAt,
          input.confidence ?? null,
          input.livenessPassed ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      let punchId = inserted.rows[0].punch_id;
      if (
        !punchId &&
        employeeId &&
        !livenessRejected &&
        ["ENTRY", "EXIT"].includes(input.eventType)
      ) {
        const shift = await client.query<{ id: string }>(
          `SELECT id FROM shifts WHERE company_id=$1 AND employee_id=$2 AND status='PUBLISHED'
           AND starts_at <= $3::timestamptz + interval '12 hours' AND ends_at >= $3::timestamptz - interval '12 hours'
           ORDER BY abs(extract(epoch FROM(starts_at-$3::timestamptz))) LIMIT 1`,
          [device.company_id, employeeId, input.occurredAt],
        );
        const punch = await client.query<{ id: string }>(
          `INSERT INTO punches(company_id,employee_id,shift_id,event_type,occurred_at,source,device_id,note)
           VALUES($1,$2,$3,$4,$5,$6,$7,'Imported from access device') RETURNING id`,
          [
            device.company_id,
            employeeId,
            shift.rows[0]?.id ?? null,
            input.eventType === "ENTRY" ? "CLOCK_IN" : "CLOCK_OUT",
            input.occurredAt,
            device.device_type === "TURNSTILE" ? "TURNSTILE" : "KIOSK",
            device.id,
          ],
        );
        punchId = punch.rows[0].id;
        await client.query("UPDATE access_events SET punch_id=$1 WHERE id=$2", [
          punchId,
          inserted.rows[0].id,
        ]);
      }
      await client.query("UPDATE devices SET last_seen_at=now() WHERE id=$1", [
        device.id,
      ]);
      await client.query("COMMIT");
      response
        .status(202)
        .json({
          data: {
            accepted: true,
            eventId: inserted.rows[0].id,
            employeeMatched: Boolean(employeeId),
            punchId,
            livenessRejected,
          },
        });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

export function createDeviceSecret(): string {
  return randomBytes(32).toString("hex");
}
export function hashDeviceSecret(secret: string): string {
  return hash(secret);
}
