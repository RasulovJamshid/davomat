import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters";
process.env.DB_PASSWORD = "test-password";
const { decodeAttendanceSelfie, hashInstallationId } = await import(
  "./mobileVerification.js"
);

describe("mobile attendance verification", () => {
  it("hashes installation identifiers without retaining the raw identifier", () => {
    const value = "android:device:secure-installation-secret";
    expect(hashInstallationId(value)).toHaveLength(64);
    expect(hashInstallationId(value)).toBe(hashInstallationId(value));
    expect(hashInstallationId(value)).not.toContain(value);
  });

  it("accepts a bounded JPEG selfie", () => {
    const jpeg = Buffer.alloc(3_500, 1);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[2] = 0xff;
    expect(decodeAttendanceSelfie(jpeg.toString("base64"))).toEqual(jpeg);
  });

  it("rejects non-JPEG or undersized evidence", () => {
    expect(() =>
      decodeAttendanceSelfie(Buffer.from("not a selfie").toString("base64")),
    ).toThrow("A valid attendance selfie is required");
  });
});
