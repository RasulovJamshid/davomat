import { describe, expect, it } from "vitest";
import { calculateAttendance, type Punch, type Shift } from "./attendance";

const shift: Shift = {
  id: "shift-1",
  employeeId: "employee-1",
  startsAt: "2026-09-04T09:00:00+05:00",
  endsAt: "2026-09-04T18:00:00+05:00",
  unpaidBreakMinutes: 60,
  graceMinutes: 5,
};

const punch = (id: string, type: Punch["type"], occurredAt: string): Punch => ({
  id,
  type,
  occurredAt,
  employeeId: "employee-1",
  source: "MOBILE",
  withinGeofence: true,
});

describe("calculateAttendance", () => {
  it("calculates worked time across multiple attendance pairs", () => {
    const result = calculateAttendance(shift, [
      punch("1", "CLOCK_IN", "2026-09-04T09:02:00+05:00"),
      punch("2", "CLOCK_OUT", "2026-09-04T13:00:00+05:00"),
      punch("3", "CLOCK_IN", "2026-09-04T14:00:00+05:00"),
      punch("4", "CLOCK_OUT", "2026-09-04T18:05:00+05:00"),
    ]);

    expect(result.workedMinutes).toBe(483);
    expect(result.status).toBe("ON_TIME");
    expect(result.lateMinutes).toBe(0);
  });

  it("applies the grace period to lateness", () => {
    const result = calculateAttendance(shift, [
      punch("1", "CLOCK_IN", "2026-09-04T09:12:00+05:00"),
      punch("2", "CLOCK_OUT", "2026-09-04T18:00:00+05:00"),
    ]);

    expect(result.lateMinutes).toBe(7);
    expect(result.status).toBe("LATE");
  });

  it("flags a missing clock-out instead of inventing worked time", () => {
    const result = calculateAttendance(shift, [
      punch("1", "CLOCK_IN", "2026-09-04T09:00:00+05:00"),
    ]);

    expect(result.workedMinutes).toBe(0);
    expect(result.status).toBe("INCOMPLETE");
    expect(result.issues).toContain("Missing clock-out");
  });

  it("marks a scheduled employee with no records absent", () => {
    expect(calculateAttendance(shift, []).status).toBe("ABSENT");
  });

  it("prioritizes incomplete event sequences over geofence warnings", () => {
    const outside = {
      ...punch("1", "CLOCK_IN", "2026-09-04T09:00:00+05:00"),
      withinGeofence: false,
    };
    const result = calculateAttendance(shift, [outside]);

    expect(result.status).toBe("INCOMPLETE");
    expect(result.issues).toHaveLength(2);
  });
});
