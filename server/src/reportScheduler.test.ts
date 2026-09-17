import { describe, expect, it } from "vitest";
import { nextCronRun } from "./domain/cron.js";

describe("scheduled report cron", () => {
  it("finds the next matching UTC minute", () => {
    expect(
      nextCronRun("0 8 * * 1", new Date("2026-09-07T07:59:20Z")).toISOString(),
    ).toBe("2026-09-07T08:00:00.000Z");
  });
  it("supports step expressions", () => {
    expect(
      nextCronRun(
        "*/15 * * * *",
        new Date("2026-09-07T08:01:00Z"),
      ).toISOString(),
    ).toBe("2026-09-07T08:15:00.000Z");
  });
  it("rejects malformed expressions", () =>
    expect(() => nextCronRun("daily")).toThrow(/five fields/));
});
