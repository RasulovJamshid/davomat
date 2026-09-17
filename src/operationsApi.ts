import { apiRequest } from "./api";
import type {
  AttendanceUiSource,
  AttendanceUiStatus,
  EmployeeRow,
  ExceptionItem,
} from "./data";

const timeZone = "Asia/Tashkent";
const tones = ["plum", "blue", "gold", "green", "coral"];

export interface DashboardData {
  activeEmployees: number;
  workingToday: number;
  lateToday: number;
  absentToday: number;
  approvedLeave: number;
  openExceptions: number;
  payrollReviews: number;
  weeklyAttendance: Array<{
    day: string;
    present: number;
    late: number;
    absent: number;
  }>;
}

interface AttendanceApiRow {
  id: string;
  name: string;
  role: string;
  employmentStatus: string;
  location: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  clockIn: string | null;
  clockOut: string | null;
  source: AttendanceUiSource | null;
  withinGeofence: boolean | null;
  clockOutWithinGeofence?: boolean | null;
  status: AttendanceUiStatus;
}

interface ExceptionApiRow {
  id: string;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  details: string;
  createdAt: string;
  employeeId: string;
  employee: string;
  requestedCorrection?: {
    operation?: string;
    eventType?: string;
    occurredAt?: string;
  } | null;
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone,
});

export function tashkentDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(value);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function formatTime(value: string | null): string {
  return value ? timeFormatter.format(new Date(value)) : "—";
}

function workedTime(row: AttendanceApiRow): string {
  if (!row.clockIn) return "0h 00m";
  const start = Date.parse(row.clockIn);
  const finish = row.clockOut ? Date.parse(row.clockOut) : Date.now();
  const total = Math.max(0, Math.floor((finish - start) / 60_000));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function titleForException(type: string): string {
  const known: Record<string, string> = {
    OUTSIDE_GEOFENCE: "Outside geofence",
    LATE: "Late arrival",
    MISSING_CLOCK_OUT: "Missing clock-out",
    MISSING_CLOCK_IN: "Missing clock-in",
    OVERTIME: "Overtime approval",
  };
  return (
    known[type] ??
    type
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}

export function mapAttendance(rows: AttendanceApiRow[]): EmployeeRow[] {
  return rows.map((row, index) => ({
    id: row.id,
    initials: row.name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    name: row.name,
    role: row.role,
    branch: row.location ?? "",
    shift:
      row.shiftStart && row.shiftEnd
        ? `${formatTime(row.shiftStart)} – ${formatTime(row.shiftEnd)}`
        : "",
    clockIn: formatTime(row.clockIn),
    clockOut: formatTime(row.clockOut),
    worked: workedTime(row),
    status: row.status,
    source: row.source ?? "UNRECORDED",
    withinGeofence: row.withinGeofence,
    clockOutWithinGeofence: row.clockOutWithinGeofence,
    tone: tones[index % tones.length],
  }));
}

export function mapExceptions(rows: ExceptionApiRow[]): ExceptionItem[] {
  return rows.map((row, index) => ({
    id: row.id,
    initials: row.employee
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    employee: row.employee,
    title: titleForException(row.type),
    detail: row.details,
    type: row.type,
    requestedEventType: row.requestedCorrection?.eventType,
    requestedOccurredAt: row.requestedCorrection?.occurredAt,
    requestedChange:
      row.requestedCorrection?.eventType && row.requestedCorrection.occurredAt
        ? `${row.requestedCorrection.eventType.toLowerCase().replaceAll("_", " ")} · ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(row.requestedCorrection.occurredAt))}`
        : undefined,
    time: timeFormatter.format(new Date(row.createdAt)),
    severity: row.severity.toLowerCase() as ExceptionItem["severity"],
    tone: tones[index % tones.length],
  }));
}

export async function fetchOperationsSnapshot(date = tashkentDate()): Promise<{
  dashboard: DashboardData;
  attendance: EmployeeRow[];
  exceptions: ExceptionItem[];
}> {
  await apiRequest("/attendance/reconcile", {
    method: "POST",
    body: JSON.stringify({ from: date, to: date }),
  });
  const [dashboard, attendance, exceptions] = await Promise.all([
    apiRequest<DashboardData>("/dashboard"),
    apiRequest<AttendanceApiRow[]>(
      `/attendance?date=${encodeURIComponent(date)}`,
    ),
    apiRequest<ExceptionApiRow[]>("/exceptions?status=PENDING"),
  ]);
  return {
    dashboard,
    attendance: mapAttendance(attendance),
    exceptions: mapExceptions(exceptions),
  };
}

export function resolveAttendanceException(
  id: string | number,
  resolution: "approved" | "rejected",
  managerNote: string,
): Promise<{ id: string; status: string; appliedPunchId?: string | null }> {
  return apiRequest(`/exceptions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: resolution.toUpperCase(), managerNote }),
  });
}
