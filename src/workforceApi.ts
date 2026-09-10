import { apiRequest } from "./api";

export interface ApiEmployeeOption {
  id: string;
  name: string;
  jobTitle: string;
  status: "ACTIVE" | "ON_LEAVE" | "INVITED" | "INACTIVE";
}

export interface ApiLocation {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number;
  active?: boolean;
}
export interface ApiDepartment {
  id: string;
  name: string;
}
export interface DirectoryMeta {
  departments: ApiDepartment[];
  locations: ApiLocation[];
}

export interface ApiShift {
  id: string;
  employeeId: string;
  employee: string;
  locationId: string;
  location: string;
  startsAt: string;
  endsAt: string;
  unpaidBreakMinutes: number;
  graceMinutes: number;
  liveTrackingEnabled: boolean;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
}

export interface ApiPayslip {
  periodId: string;
  startsOn: string;
  endsOn: string;
  periodStatus: "DRAFT" | "REVIEW" | "APPROVED" | "PAID";
  id: string;
  employeeId: string;
  employee: string;
  role: string;
  baseSalary: number;
  hourlyRate: number;
  overtimeMinutes: number;
  overtimePay: number;
  bonuses: number;
  deductions: number;
  tax: number;
  nightMinutes: number;
  nightPay: number;
  holidayMinutes: number;
  holidayPay: number;
  benefits: number;
  employerContributions: number;
  calculationBreakdown: Record<string, number>;
  grossPay: number;
  netPay: number;
  status: "READY" | "REVIEW" | "APPROVED" | "PAID";
  attendanceIssue: string | null;
  expectedMinutes: number;
  workedMinutes: number;
}

export const addDateDays = (date: string, amount: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};

export const mondayOfWeek = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay();
  return addDateDays(date, -(day === 0 ? 6 : day - 1));
};

export function localDateTime(
  date: string,
  time: string,
  timeZone: string,
): string {
  const desired = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(desired)) throw new Error("Invalid local date or time");
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    return (
      Date.UTC(
        value("year"),
        value("month") - 1,
        value("day"),
        value("hour"),
        value("minute"),
        value("second"),
      ) - instant
    );
  };
  let instant = desired - offsetAt(desired);
  instant = desired - offsetAt(instant);
  return new Date(instant).toISOString();
}

export async function fetchSchedule(from: string, to: string) {
  const [employees, meta, shifts, company] = await Promise.all([
    apiRequest<ApiEmployeeOption[]>("/employees?status=ACTIVE"),
    apiRequest<DirectoryMeta>("/meta"),
    apiRequest<ApiShift[]>(`/shifts?from=${from}&to=${to}`),
    apiRequest<CompanyInfo>("/auth/me"),
  ]);
  return { employees, meta, shifts, timeZone: company.timezone };
}

export const createShift = (input: {
  employeeId: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  unpaidBreakMinutes: number;
  graceMinutes: number;
  liveTrackingEnabled: boolean;
}) =>
  apiRequest<ApiShift>("/shifts", {
    method: "POST",
    body: JSON.stringify({ ...input, status: "DRAFT" }),
  });
export const editShift = (
  id: string,
  input: {
    locationId: string;
    startsAt: string;
    endsAt: string;
    unpaidBreakMinutes: number;
    graceMinutes: number;
    liveTrackingEnabled: boolean;
  },
) =>
  apiRequest<ApiShift>(`/shifts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
export const cancelShift = (id: string) =>
  apiRequest(`/shifts/${id}/cancel`, { method: "PATCH" });
export const publishSchedule = (from: string, to: string) =>
  apiRequest<{ published: number }>("/shifts/publish", {
    method: "POST",
    body: JSON.stringify({ from, to }),
  });
export const copyScheduleWeek = (sourceFrom: string, targetFrom: string) =>
  apiRequest<{ copied: number }>("/shifts/copy-week", {
    method: "POST",
    body: JSON.stringify({ sourceFrom, targetFrom }),
  });

export interface LiveLocation {
  shiftId: string;
  employeeId: string;
  employee: string;
  jobTitle: string;
  startsAt: string;
  endsAt: string;
  scheduledLocation: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  capturedAt: string | null;
  receivedAt: string | null;
}

export const fetchLiveLocations = () =>
  apiRequest<LiveLocation[]>("/live-locations");

export const fetchPayroll = () => apiRequest<ApiPayslip[]>("/payroll");
export const addPayrollAdjustment = (
  id: string,
  type: "BONUS" | "DEDUCTION",
  amount: number,
  reason: string,
) =>
  apiRequest(`/payroll/${id}/adjustments`, {
    method: "POST",
    body: JSON.stringify({ type, amount, reason }),
  });
export const approvePayslip = (id: string) =>
  apiRequest(`/payroll/${id}/approve`, { method: "PATCH" });
export const approveReadyPayslips = (periodId: string) =>
  apiRequest<{ approved: number }>(
    `/payroll/periods/${periodId}/approve-ready`,
    { method: "POST" },
  );
export const markPayrollPaid = (periodId: string) =>
  apiRequest<{ paid: number }>(`/payroll/periods/${periodId}/mark-paid`, {
    method: "POST",
  });
export const generatePayrollPeriod = async (
  startsOn: string,
  endsOn: string,
  taxRate?: number,
) => {
  const result = await apiRequest<{ periodId: string; created: number }>(
    "/payroll/periods",
    {
      method: "POST",
      body: JSON.stringify({
        startsOn,
        endsOn,
        ...(taxRate == null ? {} : { taxRate }),
      }),
    },
  );
  await apiRequest(`/payroll/periods/${result.periodId}/recalculate`, {
    method: "POST",
    body: JSON.stringify(taxRate == null ? {} : { taxRate }),
  });
  return result;
};

export interface CompanyInfo {
  id: string;
  email: string;
  displayName: string;
  role: string;
  companyId: string;
  companyName: string;
  timezone: string;
  currency: string;
  annualLeaveDays: number;
  defaultIncomeTaxRate: number;
  correctionWindowDays: number;
}
export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actor: string | null;
}
export interface IntegrationStatus {
  configured: boolean;
  configuration: string;
  state: "ACTIVE" | "CREDENTIALS_PRESENT" | "NOT_CONFIGURED";
}
export interface Integrations {
  email: IntegrationStatus;
  telegram: IntegrationStatus;
  devices: IntegrationStatus;
}
export const fetchCompanySetup = async () =>
  Promise.all([
    apiRequest<CompanyInfo>("/auth/me"),
    apiRequest<DirectoryMeta>("/meta?includeInactive=true"),
    apiRequest<AuditEntry[]>("/audit?limit=20"),
    apiRequest<Integrations>("/integrations/status"),
  ]).then(([company, meta, audit, integrations]) => ({
    company,
    meta,
    audit,
    integrations,
  }));
export const updateCompany = (input: {
  name: string;
  timezone: string;
  currency: string;
  annualLeaveDays: number;
  defaultIncomeTaxRate: number;
  correctionWindowDays: number;
}) =>
  apiRequest<{
    id: string;
    name: string;
    timezone: string;
    currency: string;
    annualLeaveDays: number;
    defaultIncomeTaxRate: number;
    correctionWindowDays: number;
  }>("/company", { method: "PATCH", body: JSON.stringify(input) });
export const createDepartment = (name: string) =>
  apiRequest<ApiDepartment>("/departments", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
export const editDepartment = (id: string, name: string) =>
  apiRequest<ApiDepartment>(`/departments/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
export const createLocation = (input: {
  name: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  geofenceRadiusM: number;
}) =>
  apiRequest<ApiLocation>("/locations", {
    method: "POST",
    body: JSON.stringify(input),
  });
export const editLocation = (
  id: string,
  input: {
    name: string;
    address?: string;
    latitude?: number | null;
    longitude?: number | null;
    geofenceRadiusM: number;
    active: boolean;
  },
) =>
  apiRequest<ApiLocation>(`/locations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
export const recordPunch = (input: {
  employeeId: string;
  eventType: "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
  occurredAt: string;
  note?: string;
}) =>
  apiRequest("/punches", {
    method: "POST",
    body: JSON.stringify({ ...input, source: "MANUAL" }),
  });
export interface ApiPunch {
  id: string;
  eventType: "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
  occurredAt: string;
  source: string;
  withinGeofence: boolean | null;
  note: string | null;
  hasFaceVerification: boolean;
}
export const fetchEmployeePunches = (employeeId: string, date: string) =>
  apiRequest<ApiPunch[]>(
    `/employees/${employeeId}/punches?date=${encodeURIComponent(date)}`,
  );
export const updatePunch = (
  id: string,
  input: { eventType: ApiPunch["eventType"]; occurredAt: string; note: string },
) =>
  apiRequest<ApiPunch>(`/punches/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
export const deletePunch = (id: string, reason: string) =>
  apiRequest<{ id: string; deleted: boolean }>(`/punches/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
export const updateEmployee = (
  id: string,
  input: {
    name?: string;
    phone?: string;
    email?: string;
    departmentId?: string;
    locationId?: string;
    secondaryLocationIds?: string[];
    status?: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
    accessRole?: "EMPLOYEE" | "LOCATION_MANAGER" | "ADMINISTRATOR";
    jobTitle?: string;
    baseSalary?: number;
    hourlyRate?: number;
  },
) =>
  apiRequest(`/employees/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
export const provisionEmployeeAccount = (
  id: string,
  input: { email: string; temporaryPassword: string },
) =>
  apiRequest<{
    employeeId: string;
    userId: string;
    email: string;
    active: boolean;
    invitation: {
      delivered: boolean;
      channel: "email" | "development-log" | "unavailable";
    };
  }>(`/employees/${id}/account`, {
    method: "POST",
    body: JSON.stringify(input),
  });
export interface ApiLeave {
  id: string;
  leaveType: "ANNUAL" | "SICK" | "UNPAID" | "OTHER";
  startsOn: string;
  endsOn: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  managerNote: string | null;
  createdAt: string;
  employeeId: string;
  employee: string;
  jobTitle: string;
  location: string | null;
  shiftConflicts: number;
  days: number;
}
export const fetchLeaves = (status?: ApiLeave["status"]) =>
  apiRequest<ApiLeave[]>(`/leaves${status ? `?status=${status}` : ""}`);
export const resolveLeave = (
  id: string,
  status: "APPROVED" | "REJECTED",
  managerNote: string,
) =>
  apiRequest<{
    id: string;
    status: string;
    managerNote: string;
    resolvedAt: string;
  }>(`/leaves/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, managerNote }),
  });
export const cancelMyLeave = (id: string) =>
  apiRequest<{ id: string; status: "CANCELLED" }>(`/me/leaves/${id}/cancel`, {
    method: "PATCH",
  });
