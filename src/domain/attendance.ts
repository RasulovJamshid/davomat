export type PunchType = "CLOCK_IN" | "CLOCK_OUT";
export type PunchSource = "MOBILE" | "KIOSK" | "TURNSTILE" | "MANUAL";

export interface Shift {
  id: string;
  employeeId: string;
  startsAt: string;
  endsAt: string;
  unpaidBreakMinutes: number;
  graceMinutes: number;
}

export interface Punch {
  id: string;
  employeeId: string;
  occurredAt: string;
  type: PunchType;
  source: PunchSource;
  withinGeofence: boolean;
}

export type AttendanceStatus =
  | "ON_TIME"
  | "LATE"
  | "INCOMPLETE"
  | "ABSENT"
  | "OUTSIDE_GEOFENCE";

export interface AttendanceResult {
  workedMinutes: number;
  expectedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
  issues: string[];
}

const minutesBetween = (start: Date, end: Date) =>
  Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));

export function calculateAttendance(shift: Shift, punches: Punch[]): AttendanceResult {
  const relevant = punches
    .filter((punch) => punch.employeeId === shift.employeeId)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  const shiftStart = new Date(shift.startsAt);
  const shiftEnd = new Date(shift.endsAt);
  const expectedMinutes = Math.max(
    0,
    minutesBetween(shiftStart, shiftEnd) - shift.unpaidBreakMinutes,
  );
  const issues: string[] = [];

  if (relevant.length === 0) {
    return {
      workedMinutes: 0,
      expectedMinutes,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      status: "ABSENT",
      issues: ["No attendance records"],
    };
  }

  const hasGeofenceFailure = relevant.some((punch) => !punch.withinGeofence);
  const firstClockIn = relevant.find((punch) => punch.type === "CLOCK_IN");
  const lastClockOut = [...relevant].reverse().find((punch) => punch.type === "CLOCK_OUT");
  let workedMinutes = 0;
  let openClockIn: Punch | undefined;

  for (const punch of relevant) {
    if (punch.type === "CLOCK_IN") {
      if (openClockIn) issues.push("Duplicate clock-in");
      openClockIn = punch;
    } else if (!openClockIn) {
      issues.push("Clock-out without a clock-in");
    } else {
      workedMinutes += minutesBetween(
        new Date(openClockIn.occurredAt),
        new Date(punch.occurredAt),
      );
      openClockIn = undefined;
    }
  }

  if (openClockIn) issues.push("Missing clock-out");
  if (hasGeofenceFailure) issues.push("Record outside an approved location");

  const rawLateMinutes = firstClockIn
    ? minutesBetween(shiftStart, new Date(firstClockIn.occurredAt))
    : 0;
  const lateMinutes = Math.max(0, rawLateMinutes - shift.graceMinutes);
  const earlyLeaveMinutes = lastClockOut
    ? minutesBetween(new Date(lastClockOut.occurredAt), shiftEnd)
    : 0;
  const overtimeMinutes = Math.max(0, workedMinutes - expectedMinutes);

  let status: AttendanceStatus = "ON_TIME";
  if (issues.some((issue) => issue !== "Record outside an approved location")) {
    status = "INCOMPLETE";
  } else if (hasGeofenceFailure) {
    status = "OUTSIDE_GEOFENCE";
  } else if (lateMinutes > 0) {
    status = "LATE";
  }

  return {
    workedMinutes,
    expectedMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    status,
    issues,
  };
}

export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}
