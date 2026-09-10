import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { HttpError } from "./http.js";

type Queryable = Pick<PoolClient, "query">;

export const hashInstallationId = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function bindOrVerifyMobileDevice(
  database: Queryable,
  input: {
    companyId: string;
    userId: string;
    employeeId: string;
    installationId: string;
    platform: "ANDROID" | "IOS";
    deviceLabel: string;
  },
): Promise<string> {
  const installationHash = hashInstallationId(input.installationId);
  const existing = await database.query<{
    id: string;
    installation_hash: string;
  }>(
    `SELECT id,installation_hash FROM mobile_device_bindings
     WHERE user_id=$1 AND company_id=$2 AND revoked_at IS NULL FOR UPDATE`,
    [input.userId, input.companyId],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].installation_hash.trim() !== installationHash)
      throw new HttpError(
        409,
        "This account is already linked to another mobile device",
      );
    await database.query(
      `UPDATE mobile_device_bindings SET last_seen_at=now(),device_label=$1,platform=$2 WHERE id=$3`,
      [input.deviceLabel, input.platform, existing.rows[0].id],
    );
    return existing.rows[0].id;
  }

  const occupied = await database.query(
    `SELECT id FROM mobile_device_bindings WHERE installation_hash=$1 AND revoked_at IS NULL`,
    [installationHash],
  );
  if (occupied.rows[0])
    throw new HttpError(
      409,
      "This mobile device is already linked to another account",
    );

  const result = await database.query<{ id: string }>(
    `INSERT INTO mobile_device_bindings(company_id,user_id,employee_id,installation_hash,platform,device_label)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      input.companyId,
      input.userId,
      input.employeeId,
      installationHash,
      input.platform,
      input.deviceLabel,
    ],
  );
  return result.rows[0].id;
}

export function decodeAttendanceSelfie(value: string): Buffer {
  const image = Buffer.from(value, "base64");
  const jpeg =
    image.length >= 4 &&
    image[0] === 0xff &&
    image[1] === 0xd8 &&
    image[2] === 0xff;
  if (!jpeg || image.length < 3000 || image.length > 1_572_864)
    throw new HttpError(400, "A valid attendance selfie is required");
  return image;
}
