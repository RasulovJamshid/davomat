import { describe, it, expect } from "vitest";
process.env.JWT_SECRET ??= "isolated-schema-test-secret-123456789";
process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost/unused";
const { weeklyRuleSchema } = await import("./weeklySchedules.js");
const base = {
  scope: "ALL",
  weekdays: [1, 2, 3, 4, 5],
  startsAt: "09:00",
  endsAt: "18:00",
  effectiveFrom: "2026-09-15",
};
describe("Automatic weekly schedule input", () => {
  it("supports indefinite company weeks and overnight shifts", () => {
    expect(weeklyRuleSchema.parse(base)).toMatchObject({
      scopeId: null,
      effectiveUntil: null,
      active: true,
      liveTrackingEnabled: false,
    });
    expect(
      weeklyRuleSchema.parse({ ...base, liveTrackingEnabled: true })
        .liveTrackingEnabled,
    ).toBe(true);
    expect(
      weeklyRuleSchema.parse({
        ...base,
        startsAt: "22:00",
        endsAt: "06:00",
        weekdays: [3, 1, 1],
      }).weekdays,
    ).toEqual([1, 3]);
  });
  it("requires a valid group, dates, weekdays, clock times and paid duration", () => {
    for (const change of [
      { scope: "EMPLOYEE" },
      { scopeId: "00000000-0000-4000-8000-000000000001" },
      { effectiveUntil: "2026-09-14" },
      { weekdays: [] },
      { weekdays: [8] },
      { startsAt: "24:00" },
      { endsAt: "09:00" },
      { unpaidBreakMinutes: 540 },
    ]) {
      expect(weeklyRuleSchema.safeParse({ ...base, ...change }).success).toBe(
        false,
      );
    }
  });
});
