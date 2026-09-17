import { describe, expect, it } from "vitest";
import { localDateTime } from "./workforceApi";

describe("company timezone conversion", () => {
  it("converts Tashkent wall time to UTC", () => {
    expect(localDateTime("2026-09-06", "09:00", "Asia/Tashkent")).toBe(
      "2026-09-06T04:00:00.000Z",
    );
  });

  it("honors daylight-saving offsets", () => {
    expect(localDateTime("2026-07-15", "09:00", "Europe/Berlin")).toBe(
      "2026-07-15T07:00:00.000Z",
    );
    expect(localDateTime("2026-01-15", "09:00", "Europe/Berlin")).toBe(
      "2026-01-15T08:00:00.000Z",
    );
  });
});
