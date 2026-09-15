import { describe, it, expect } from "vitest";
// Config is validated when the router imports the DB; integration tests exercise routes.
process.env.JWT_SECRET ??= "isolated-schema-test-secret-123456789";
process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost/unused";
const { recurringSchema, collaborationSchema } =
  await import("./mobileManagementRoutes.js");
const id = "00000000-0000-4000-8000-000000000001";
describe("Recurring work schedule validation", () => {
  const schedule = {
    name: "Office",
    employeeId: id,
    locationId: id,
    weekdays: [1, 2, 3, 4, 5],
    startTime: "09:00",
    endTime: "18:00",
  };
  it("supports overnight work and deduplicates weekdays", () => {
    expect(
      recurringSchema.parse({
        ...schedule,
        startTime: "22:00",
        endTime: "06:00",
        weekdays: [1, 1, 2],
      }).weekdays,
    ).toEqual([1, 2]);
  });
  it("rejects invalid times, empty days and breaks exceeding work duration", () => {
    for (const change of [
      { startTime: "25:00" },
      { weekdays: [] },
      { weekdays: [0] },
      { endTime: "09:00" },
      { unpaidBreakMinutes: 540 },
    ])
      expect(
        recurringSchema.safeParse({ ...schedule, ...change }).success,
      ).toBe(false);
  });
});
describe("Workplace input validation", () => {
  it("requires real checklist items and survey choices", () => {
    expect(
      collaborationSchema.safeParse({ kind: "checklists", title: "Open" })
        .success,
    ).toBe(false);
    expect(
      collaborationSchema.safeParse({
        kind: "surveys",
        title: "Lunch",
        details: { options: ["One"] },
      }).success,
    ).toBe(false);
  });
  it("requires documents and blocks path-like filenames", () => {
    expect(
      collaborationSchema.safeParse({ kind: "documents", title: "Policy" })
        .success,
    ).toBe(false);
    expect(
      collaborationSchema.safeParse({
        kind: "documents",
        title: "Policy",
        file: { name: "../policy.txt", mime: "text/plain", base64: "YWJj" },
      }).success,
    ).toBe(false);
  });
  it("rejects reversed trip dates", () => {
    expect(
      collaborationSchema.safeParse({
        kind: "trips",
        title: "Visit",
        employeeId: id,
        details: {
          destination: "Tashkent",
          startsOn: "2026-10-03",
          endsOn: "2026-10-01",
        },
      }).success,
    ).toBe(false);
  });
});
