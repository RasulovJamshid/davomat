import { Router } from "express";
import { z } from "zod";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { pool } from "./db.js";
import type { AuthRequest } from "./auth.js";
import { asyncHandler } from "./http.js";
import { logger } from "./logger.js";

export const pushRouter = Router();
pushRouter.post(
  "/push/devices",
  asyncHandler(async (req, res) => {
    const { token } = z
        .object({ token: z.string().min(20).max(4096) })
        .parse(req.body),
      a = (req as AuthRequest).auth;
    await pool.query(
      "INSERT INTO push_devices(token,company_id,user_id) VALUES($1,$2,$3) ON CONFLICT(token) DO UPDATE SET company_id=excluded.company_id,user_id=excluded.user_id,updated_at=now()",
      [token, a.companyId, a.sub],
    );
    res.json({ data: { registered: true } });
  }),
);
pushRouter.delete(
  "/push/devices",
  asyncHandler(async (req, res) => {
    const { token } = z
        .object({ token: z.string().min(20).max(4096) })
        .parse(req.body),
      a = (req as AuthRequest).auth;
    await pool.query(
      "DELETE FROM push_devices WHERE token=$1 AND user_id=$2 AND company_id=$3",
      [token, a.sub, a.companyId],
    );
    res.json({ data: { removed: true } });
  }),
);
pushRouter.get(
  "/inbox",
  asyncHandler(async (req, res) => {
    const a = (req as AuthRequest).auth;
    res.json({
      data: (
        await pool.query(
          'SELECT id,title,body,action,created_at AS "createdAt",read_at IS NOT NULL AS read FROM push_events WHERE company_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100',
          [a.companyId, a.sub],
        )
      ).rows,
    });
  }),
);
pushRouter.post(
  "/inbox/:id/read",
  asyncHandler(async (req, res) => {
    const a = (req as AuthRequest).auth;
    await pool.query(
      "UPDATE push_events SET read_at=now() WHERE id=$1 AND user_id=$2 AND company_id=$3",
      [z.string().uuid().parse(req.params.id), a.sub, a.companyId],
    );
    res.json({ data: { read: true } });
  }),
);
// The outbox survives restarts. Advisory locking prevents duplicate workers across API replicas.
export async function deliverPushBatch() {
  if (process.env.PUSH_ENABLED !== "true") return;
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (
      await client.query("SELECT pg_try_advisory_lock(74192019) AS locked")
    ).rows[0].locked;
    if (!locked) return;
    const events = (
      await client.query(
        `SELECT p.* FROM push_events p JOIN users u ON u.id=p.user_id AND u.company_id=p.company_id AND u.active WHERE p.sent_at IS NULL AND p.attempts<8 AND p.next_attempt_at<=now() AND p.created_at>now()-interval '7 days' ORDER BY p.created_at LIMIT 25`,
      )
    ).rows;
    for (const event of events) {
      const tokens = (
        await client.query(
          "SELECT token FROM push_devices WHERE user_id=$1 AND company_id=$2 ORDER BY updated_at DESC LIMIT 500",
          [event.user_id, event.company_id],
        )
      ).rows.map((r) => r.token as string);
      if (!tokens.length) {
        await client.query(
          "UPDATE push_events SET next_attempt_at=now()+interval '1 hour' WHERE id=$1",
          [event.id],
        );
        continue;
      }
      try {
        const result = await getMessaging().sendEachForMulticast({
          tokens,
          notification: { title: event.title, body: event.body },
          data: { action: event.action, eventId: event.id },
          android: { priority: "high" },
          apns: { payload: { aps: { sound: "default" } } },
        });
        let retry = false;
        for (let i = 0; i < result.responses.length; i++) {
          const r = result.responses[i];
          if (r.success) continue;
          if (
            [
              "messaging/registration-token-not-registered",
              "messaging/invalid-registration-token",
            ].includes(r.error?.code ?? "")
          )
            await client.query("DELETE FROM push_devices WHERE token=$1", [
              tokens[i],
            ]);
          else retry = true;
        }
        await client.query(
          "UPDATE push_events SET sent_at=CASE WHEN $2 THEN NULL ELSE now() END,attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int)) WHERE id=$1",
          [event.id, retry],
        );
      } catch {
        await client.query(
          "UPDATE push_events SET attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int)) WHERE id=$1",
          [event.id],
        );
        logger.warn("Push delivery failed; queued for retry");
      }
    }
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(74192019)");
    client.release();
  }
}
export function startPushWorker() {
  const timer = setInterval(() => {
    void deliverPushBatch().catch(() => logger.warn("Push worker failed"));
  }, 15000);
  timer.unref();
  return timer;
}
