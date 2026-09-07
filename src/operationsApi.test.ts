import { describe, expect, it } from "vitest";
import { mapAttendance, mapExceptions, tashkentDate } from "./operationsApi";

describe("operations API mapping", () => {
  it("uses the company timezone when selecting today's attendance", () => {
    expect(tashkentDate(new Date("2026-09-03T20:00:00.000Z"))).toBe("2026-09-04");
  });

  it("maps database timestamps into readable attendance records", () => {
    const [record] = mapAttendance([{
      id: "employee-1",
      name: "Aziza Karimova",
      role: "Sales lead",
      employmentStatus: "ACTIVE",
      location: "Yunusobod",
      shiftStart: "2026-09-04T04:00:00.000Z",
      shiftEnd: "2026-09-04T13:00:00.000Z",
      clockIn: "2026-09-04T04:00:00.000Z",
      clockOut: "2026-09-04T05:30:00.000Z",
      source: "MOBILE",
      withinGeofence: true,
      status: "ON_TIME",
    }]);
    expect(record).toMatchObject({ initials: "AK", shift: "09:00 – 18:00", clockIn: "09:00", clockOut: "10:30", worked: "1h 30m", status: "ON_TIME" });
  });

  it("maps pending exception severity and title", () => {
    const [exception] = mapExceptions([{
      id: "exception-1",
      type: "MISSING_CLOCK_OUT",
      severity: "HIGH",
      details: "No clock-out event",
      createdAt: "2026-09-04T05:00:00.000Z",
      employeeId: "employee-1",
      employee: "Dilshod Nazarov",
    }]);
    expect(exception).toMatchObject({ id: "exception-1", initials: "DN", title: "Missing clock-out", severity: "high" });
  });

  it("describes the real punch requested by an employee", () => {
    const [exception] = mapExceptions([{
      id: "exception-2", type: "CORRECTION_REQUEST", severity: "MEDIUM",
      details: "I forgot to clock out", createdAt: "2026-09-04T06:00:00.000Z",
      employeeId: "employee-1", employee: "Aziza Karimova",
      requestedCorrection: { operation: "CREATE_PUNCH", eventType: "CLOCK_OUT", occurredAt: "2026-09-03T13:00:00.000Z" },
    }]);
    expect(exception.requestedChange).toContain("clock out");
    expect(exception.requestedChange).toContain("Sep 3, 2026");
  });
});
