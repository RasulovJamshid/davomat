import type { AttendanceStatus, PunchSource } from "./domain/attendance";

export type AttendanceUiStatus =
  AttendanceStatus | "ON_SHIFT" | "ON_LEAVE" | "UNSCHEDULED";
export type AttendanceUiSource = PunchSource | "WEB" | "QR" | "UNRECORDED";

export interface EmployeeRow {
  id: string;
  initials: string;
  name: string;
  role: string;
  branch: string;
  shift: string;
  clockIn: string;
  clockOut: string;
  worked: string;
  status: AttendanceUiStatus;
  source: AttendanceUiSource;
  withinGeofence?: boolean | null;
  clockOutWithinGeofence?: boolean | null;
  tone: string;
}

export interface ExceptionItem {
  id: string | number;
  initials: string;
  employee: string;
  title: string;
  detail: string;
  type?: string;
  requestedEventType?: string;
  requestedOccurredAt?: string;
  requestedChange?: string;
  time: string;
  severity: "high" | "medium" | "low";
  tone: string;
}

export const employees: EmployeeRow[] = [
  {
    id: "1",
    initials: "AK",
    name: "Aziza Karimova",
    role: "Sales lead",
    branch: "Yunusobod",
    shift: "09:00 – 18:00",
    clockIn: "08:56",
    clockOut: "—",
    worked: "4h 21m",
    status: "ON_SHIFT",
    source: "MOBILE",
    tone: "plum",
  },
  {
    id: "2",
    initials: "JS",
    name: "Jahongir Sobirov",
    role: "Barista",
    branch: "Chilonzor",
    shift: "08:00 – 17:00",
    clockIn: "08:17",
    clockOut: "—",
    worked: "5h 00m",
    status: "LATE",
    source: "KIOSK",
    tone: "blue",
  },
  {
    id: "3",
    initials: "MN",
    name: "Malika Normurodova",
    role: "Accountant",
    branch: "Head office",
    shift: "09:00 – 18:00",
    clockIn: "09:01",
    clockOut: "—",
    worked: "4h 16m",
    status: "ON_SHIFT",
    source: "TURNSTILE",
    tone: "gold",
  },
  {
    id: "4",
    initials: "BR",
    name: "Bekzod Rahimov",
    role: "Courier",
    branch: "Mirzo Ulugbek",
    shift: "09:00 – 18:00",
    clockIn: "09:04",
    clockOut: "12:48",
    worked: "3h 44m",
    status: "OUTSIDE_GEOFENCE",
    source: "MOBILE",
    tone: "green",
  },
  {
    id: "5",
    initials: "SO",
    name: "Sabina Olimova",
    role: "Store manager",
    branch: "Sergeli",
    shift: "08:30 – 17:30",
    clockIn: "08:29",
    clockOut: "—",
    worked: "4h 48m",
    status: "ON_SHIFT",
    source: "KIOSK",
    tone: "coral",
  },
];

export const initialExceptions: ExceptionItem[] = [
  {
    id: 1,
    initials: "BR",
    employee: "Bekzod Rahimov",
    title: "Outside geofence",
    detail: "Clock-out was 1.4 km from Mirzo Ulugbek",
    time: "12:48",
    severity: "high",
    tone: "green",
  },
  {
    id: 2,
    initials: "JS",
    employee: "Jahongir Sobirov",
    title: "17 minutes late",
    detail: "5-minute grace period was applied",
    time: "08:17",
    severity: "medium",
    tone: "blue",
  },
  {
    id: 3,
    initials: "DN",
    employee: "Dilshod Nazarov",
    title: "Missing clock-out",
    detail: "Yesterday’s shift remains incomplete",
    time: "Yesterday",
    severity: "high",
    tone: "plum",
  },
  {
    id: 4,
    initials: "NS",
    employee: "Nigora Saidova",
    title: "Overtime approval",
    detail: "Requested 1h 24m overtime",
    time: "11:32",
    severity: "low",
    tone: "gold",
  },
];

export const weekData = [
  { day: "Mon", present: 112, late: 6, absent: 4 },
  { day: "Tue", present: 116, late: 3, absent: 3 },
  { day: "Wed", present: 109, late: 8, absent: 5 },
  { day: "Thu", present: 118, late: 4, absent: 2 },
  { day: "Fri", present: 111, late: 6, absent: 4 },
  { day: "Sat", present: 72, late: 2, absent: 2 },
  { day: "Sun", present: 42, late: 1, absent: 1 },
];
