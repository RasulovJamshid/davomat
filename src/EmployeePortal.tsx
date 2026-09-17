import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarDays,
  Check,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Coffee,
  FilePenLine,
  LoaderCircle,
  LogOut,
  MapPin,
  Navigation,
  Plus,
  RefreshCw,
  ShieldCheck,
  Timer,
  X,
} from "lucide-react";
import { apiRequest, type SessionUser } from "./api";
import { formatUzs } from "./domain/payroll";
import { NotificationCenter } from "./Notifications";
import { intlLocale, LanguageSwitcher, useI18n } from "./i18n";
import { TasksPage } from "./TasksPage";
import { WorkforceReport } from "./WorkforceReport";
import { BrandMark } from "./BrandMark";

type EventType = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
interface PortalShift {
  id: string;
  startsAt: string;
  endsAt: string;
  unpaidBreakMinutes: number;
  location: string | null;
}
interface PortalPunch {
  id: string;
  shiftId: string | null;
  eventType: EventType;
  occurredAt: string;
  source: string;
  withinGeofence: boolean | null;
}
interface PortalPayslip {
  id: string;
  startsOn: string;
  endsOn: string;
  grossPay: number;
  netPay: number;
  status: "APPROVED" | "PAID";
  currency: string;
}
interface PortalCorrection {
  id: string;
  type: string;
  details: string;
  requestedCorrection: { eventType?: EventType; occurredAt?: string } | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  managerNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
interface PortalLeave {
  id: string;
  leaveType: "ANNUAL" | "SICK" | "UNPAID" | "OTHER";
  startsOn: string;
  endsOn: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  managerNote: string | null;
  createdAt: string;
}
interface PortalData {
  profile: {
    id: string;
    employeeNumber: string;
    name: string;
    jobTitle: string;
    status: string;
    department: string | null;
    location: string | null;
    companyName: string;
    timezone: string;
    currency: string;
  };
  shifts: PortalShift[];
  punches: PortalPunch[];
  payslips: PortalPayslip[];
  corrections: PortalCorrection[];
  leaves: PortalLeave[];
  leaveBalance: { annualAllowance: number; annualUsed: number };
}
interface AvailabilityItem {
  id: string;
  startsAt: string;
  endsAt: string;
  availability: "AVAILABLE" | "UNAVAILABLE" | "PREFERRED";
  note: string | null;
}
interface SwapItem {
  id: string;
  shiftId: string;
  requester: string;
  requestedBy: string;
  offeredTo: string | null;
  acceptedBy: string | null;
  acceptedByName: string | null;
  reason: string | null;
  status: "OPEN" | "ACCEPTED" | "APPROVED" | "REJECTED" | "CANCELLED";
  startsAt: string;
  endsAt: string;
}

const eventLabels: Record<EventType, string> = {
  CLOCK_IN: "Clock in",
  CLOCK_OUT: "Clock out",
  BREAK_START: "Start break",
  BREAK_END: "End break",
};
const eventTranslationKey: Record<EventType, string> = {
  CLOCK_IN: "clockIn",
  CLOCK_OUT: "clockOut",
  BREAK_START: "startBreak",
  BREAK_END: "endBreak",
};
const requestStatusTranslationKey = {
  PENDING: "waitingForReview",
  APPROVED: "approved",
  REJECTED: "rejected",
};
const leaveLabels = {
  ANNUAL: "Annual leave",
  SICK: "Sick leave",
  UNPAID: "Unpaid leave",
  OTHER: "Other leave",
};
const leaveTranslationKey: Record<PortalLeave["leaveType"], string> = {
  ANNUAL: "annualLeave",
  SICK: "sickLeave",
  UNPAID: "unpaidLeave",
  OTHER: "otherLeave",
};
const sourceTranslationKey: Record<string, string> = {
  MOBILE: "mobile",
  KIOSK: "faceKiosk",
  TURNSTILE: "turnstile",
  WEB: "webBrowser",
  MANUAL: "manual",
  QR: "qrCode",
};
const localInputNow = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
const localDate = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

function ShiftList({
  shifts,
  timeZone,
}: {
  shifts: PortalShift[];
  timeZone: string;
}) {
  const { locale, t } = useI18n();
  const formatDate = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const formatTime = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <div className="portal-list">
      {shifts.length === 0 ? (
        <div className="portal-empty">
          <CalendarDays size={24} />
          <strong>{t("noPublishedShifts")}</strong>
          <p>{t("upcomingScheduleHere")}</p>
        </div>
      ) : (
        shifts.map((shift) => (
          <article key={shift.id}>
            <span className="portal-list-icon">
              <CalendarDays size={18} />
            </span>
            <div>
              <strong>{formatDate.format(new Date(shift.startsAt))}</strong>
              <p>
                {formatTime.format(new Date(shift.startsAt))} –{" "}
                {formatTime.format(new Date(shift.endsAt))} ·{" "}
                {shift.location ?? t("locationNotAssigned")}
              </p>
            </div>
            <small>
              {t("breakMinutes", { count: shift.unpaidBreakMinutes })}
            </small>
          </article>
        ))
      )}
    </div>
  );
}

function ScheduleSelfService({
  shifts,
  timeZone,
}: {
  shifts: PortalShift[];
  timeZone: string;
}) {
  const { t } = useI18n();
  const [availability, setAvailability] = useState<AvailabilityItem[]>([]);
  const [swaps, setSwaps] = useState<SwapItem[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    startsAt: localInputNow(),
    endsAt: localInputNow(),
    availability: "UNAVAILABLE" as AvailabilityItem["availability"],
    note: "",
  });
  const load = async () => {
    try {
      const [a, s] = await Promise.all([
        apiRequest<AvailabilityItem[]>("/me/availability"),
        apiRequest<SwapItem[]>("/shift-swaps"),
      ]);
      setAvailability(a);
      setSwaps(s);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("loadRequestsFailed"),
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const execute = async (action: () => Promise<unknown>) => {
    setSaving(true);
    setError("");
    try {
      await action();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  const submitAvailability = (e: FormEvent) => {
    e.preventDefault();
    return execute(() =>
      apiRequest("/me/availability", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
        }),
      }),
    );
  };
  const format = new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <div className="portal-request-grid schedule-self-service">
      <form
        className="portal-panel portal-correction-form"
        onSubmit={submitAvailability}
      >
        <div>
          <h3>{t("yourAvailability")}</h3>
          <p>{t("availabilityDescription")}</p>
        </div>
        <label>
          <span>{t("starts")}</span>
          <input
            type="datetime-local"
            required
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
          />
        </label>
        <label>
          <span>{t("ends")}</span>
          <input
            type="datetime-local"
            required
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
          />
        </label>
        <label>
          <span>{t("availability")}</span>
          <select
            value={form.availability}
            onChange={(e) =>
              setForm({
                ...form,
                availability: e.target
                  .value as AvailabilityItem["availability"],
              })
            }
          >
            <option value="UNAVAILABLE">{t("unavailable")}</option>
            <option value="AVAILABLE">{t("available")}</option>
            <option value="PREFERRED">{t("preferred")}</option>
          </select>
        </label>
        <label>
          <span>{t("note")}</span>
          <input
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>
        <button className="portal-secondary full" disabled={saving}>
          <Plus size={16} />
          {t("addAvailability")}
        </button>
        {error && (
          <div className="portal-inline-error full">
            <X size={15} />
            {error}
          </div>
        )}
        <div className="compact-list full">
          {availability.map((a) => (
            <div key={a.id}>
              <span>
                <strong>{t(a.availability.toLowerCase())}</strong>
                <small>
                  {format.format(new Date(a.startsAt))} –{" "}
                  {format.format(new Date(a.endsAt))}
                </small>
              </span>
              <button
                type="button"
                onClick={() =>
                  void execute(() =>
                    apiRequest(`/me/availability/${a.id}`, {
                      method: "DELETE",
                    }),
                  )
                }
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      </form>
      <section className="portal-panel">
        <div className="portal-panel-heading">
          <div>
            <h2>{t("shiftSwaps")}</h2>
            <p>{t("shiftSwapDescription")}</p>
          </div>
        </div>
        <div className="portal-list">
          {shifts
            .filter((s) => Date.parse(s.startsAt) > Date.now())
            .map((shift) => (
              <article key={shift.id}>
                <span className="portal-list-icon">
                  <CalendarDays size={18} />
                </span>
                <div>
                  <strong>{format.format(new Date(shift.startsAt))}</strong>
                  <p>{shift.location}</p>
                </div>
                <button
                  className="portal-cancel-request"
                  disabled={
                    saving ||
                    swaps.some(
                      (s) =>
                        s.shiftId === shift.id &&
                        ["OPEN", "ACCEPTED"].includes(s.status),
                    )
                  }
                  onClick={() =>
                    void execute(() =>
                      apiRequest("/me/shift-swaps", {
                        method: "POST",
                        body: JSON.stringify({
                          shiftId: shift.id,
                          reason: t("swapRequestedByEmployee"),
                        }),
                      }),
                    )
                  }
                >
                  {t("requestSwap")}
                </button>
              </article>
            ))}
          {swaps
            .filter((s) => s.status === "OPEN")
            .map((s) => (
              <article key={s.id}>
                <span className="portal-list-icon">
                  <RefreshCw size={18} />
                </span>
                <div>
                  <strong>{s.requester}</strong>
                  <p>
                    {format.format(new Date(s.startsAt))} · {s.reason}
                  </p>
                </div>
                <button
                  className="portal-secondary"
                  disabled={saving}
                  onClick={() =>
                    void execute(() =>
                      apiRequest(`/me/shift-swaps/${s.id}/accept`, {
                        method: "POST",
                      }),
                    )
                  }
                >
                  {t("acceptSwap")}
                </button>
              </article>
            ))}
        </div>
      </section>
    </div>
  );
}

function CorrectionForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const [eventType, setEventType] = useState<EventType>("CLOCK_IN");
  const [occurredAt, setOccurredAt] = useState(localInputNow());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 10) return setError(t("correctionMinimum"));
    setSaving(true);
    setError("");
    try {
      await apiRequest("/me/corrections", {
        method: "POST",
        body: JSON.stringify({
          eventType,
          occurredAt: new Date(occurredAt).toISOString(),
          reason: reason.trim(),
        }),
      });
      setReason("");
      setDone(true);
      await onSaved();
      window.setTimeout(() => setDone(false), 2500);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("submitCorrectionFailed"),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="portal-correction-form" onSubmit={submit}>
      <div>
        <h3>{t("requestCorrection")}</h3>
        <p>{t("correctionDescription")}</p>
      </div>
      <label>
        <span>{t("missingEvent")}</span>
        <select
          value={eventType}
          onChange={(event) => setEventType(event.target.value as EventType)}
        >
          {Object.keys(eventLabels).map((value) => (
            <option value={value} key={value}>
              {t(eventTranslationKey[value as EventType])}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("dateTime")}</span>
        <input
          type="datetime-local"
          required
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
        />
      </label>
      <label className="full">
        <span>{t("whatHappened")}</span>
        <textarea
          required
          minLength={10}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("correctionExplanation")}
        />
      </label>
      {error && (
        <div className="portal-inline-error full">
          <X size={16} />
          {error}
        </div>
      )}
      <button className="portal-secondary full" disabled={saving}>
        {saving ? (
          <LoaderCircle className="spinner" size={17} />
        ) : (
          <FilePenLine size={17} />
        )}
        {t("submitCorrection")}
      </button>
      {done && (
        <div className="portal-success full">
          <Check size={16} />
          {t("requestSent")}
        </div>
      )}
    </form>
  );
}

function PasswordForm() {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 10)
      return setMessage({ ok: false, text: t("useTenCharacters") });
    if (newPassword !== confirmation)
      return setMessage({
        ok: false,
        text: t("passwordsMismatch"),
      });
    setSaving(true);
    setMessage(null);
    try {
      await apiRequest("/auth/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setMessage({ ok: true, text: t("passwordChanged") });
    } catch (reason) {
      setMessage({
        ok: false,
        text:
          reason instanceof Error ? reason.message : t("passwordChangeFailed"),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="portal-password-form" onSubmit={submit}>
      <div>
        <h3>{t("accountSecurity")}</h3>
        <p>{t("securityDescription")}</p>
      </div>
      <label>
        <span>{t("currentPassword")}</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label>
        <span>{t("newPassword")}</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </label>
      <label>
        <span>{t("confirmPassword")}</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <button className="portal-secondary" disabled={saving}>
        {saving ? (
          <LoaderCircle className="spinner" size={17} />
        ) : (
          <ShieldCheck size={17} />
        )}
        {t("changePassword")}
      </button>
      {message && (
        <div className={message.ok ? "portal-success" : "portal-inline-error"}>
          {message.ok ? <Check size={16} /> : <X size={16} />} {message.text}
        </div>
      )}
    </form>
  );
}

function LeaveForm({
  balance,
  onSaved,
}: {
  balance: PortalData["leaveBalance"];
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [leaveType, setLeaveType] =
    useState<PortalLeave["leaveType"]>("ANNUAL");
  const [startsOn, setStartsOn] = useState(tomorrow);
  const [endsOn, setEndsOn] = useState(tomorrow);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (endsOn < startsOn)
      return setMessage({
        ok: false,
        text: t("endDateBeforeStart"),
      });
    if (reason.trim().length < 10)
      return setMessage({
        ok: false,
        text: t("reasonMinimum"),
      });
    setSaving(true);
    setMessage(null);
    try {
      await apiRequest("/me/leaves", {
        method: "POST",
        body: JSON.stringify({
          leaveType,
          startsOn,
          endsOn,
          reason: reason.trim(),
        }),
      });
      setReason("");
      setMessage({ ok: true, text: t("leaveRequestSent") });
      await onSaved();
    } catch (reason) {
      setMessage({
        ok: false,
        text:
          reason instanceof Error ? reason.message : t("requestLeaveFailed"),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="portal-correction-form" onSubmit={submit}>
      <div>
        <h3>{t("requestLeave")}</h3>
        <p>
          {t("leaveAvailable", {
            available: Math.max(
              0,
              balance.annualAllowance - balance.annualUsed,
            ),
            total: balance.annualAllowance,
          })}
        </p>
      </div>
      <label>
        <span>{t("leaveType")}</span>
        <select
          value={leaveType}
          onChange={(event) =>
            setLeaveType(event.target.value as PortalLeave["leaveType"])
          }
        >
          {Object.keys(leaveLabels).map((value) => (
            <option value={value} key={value}>
              {t(leaveTranslationKey[value as PortalLeave["leaveType"]])}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("startDate")}</span>
        <input
          type="date"
          required
          value={startsOn}
          onChange={(event) => {
            setStartsOn(event.target.value);
            if (endsOn < event.target.value) setEndsOn(event.target.value);
          }}
        />
      </label>
      <label>
        <span>{t("endDate")}</span>
        <input
          type="date"
          required
          value={endsOn}
          onChange={(event) => setEndsOn(event.target.value)}
        />
      </label>
      <label>
        <span>{t("reason")}</span>
        <input
          required
          minLength={10}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("leaveReason")}
        />
      </label>
      <button className="portal-secondary full" disabled={saving}>
        {saving ? (
          <LoaderCircle className="spinner" size={17} />
        ) : (
          <CalendarDays size={17} />
        )}
        {t("submitLeave")}
      </button>
      {message && (
        <div
          className={`${message.ok ? "portal-success" : "portal-inline-error"} full`}
        >
          {message.ok ? <Check size={16} /> : <X size={16} />} {message.text}
        </div>
      )}
    </form>
  );
}

export function EmployeePortal({
  user,
  onLogout,
}: {
  user: SessionUser;
  onLogout: () => void;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clocking, setClocking] = useState(false);
  const [clockMessage, setClockMessage] = useState("");
  const [tab, setTab] = useState<
    "home" | "schedule" | "pay" | "requests" | "tasks" | "hours"
  >("home");
  const load = async () => {
    setError("");
    try {
      setData(await apiRequest<PortalData>("/me/workspace"));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("loadWorkspaceFailed"),
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const todaysPunches = useMemo(
    () =>
      data
        ? data.punches
            .filter(
              (punch) =>
                localDate(new Date(punch.occurredAt), data.profile.timezone) ===
                localDate(new Date(), data.profile.timezone),
            )
            .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
        : [],
    [data],
  );
  const latest = data?.punches[0];
  const lastEvent =
    latest && latest.eventType !== "CLOCK_OUT"
      ? latest.eventType
      : (todaysPunches.at(-1)?.eventType ?? "NONE");
  const mainAction: EventType | null =
    lastEvent === "NONE"
      ? "CLOCK_IN"
      : lastEvent === "CLOCK_IN"
        ? "CLOCK_OUT"
        : lastEvent === "BREAK_START"
          ? "BREAK_END"
          : lastEvent === "BREAK_END"
            ? "CLOCK_OUT"
            : null;
  const secondaryAction: EventType | null =
    lastEvent === "CLOCK_IN" || lastEvent === "BREAK_END"
      ? "BREAK_START"
      : null;
  const activeShift =
    data?.shifts.find(
      (shift) =>
        Date.parse(shift.startsAt) - 4 * 3_600_000 <= Date.now() &&
        Date.parse(shift.endsAt) + 4 * 3_600_000 >= Date.now(),
    ) ?? data?.shifts.find((shift) => Date.parse(shift.startsAt) > Date.now());
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      timeZone: data?.profile.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  const punch = async (eventType: EventType) => {
    setClocking(true);
    setClockMessage(t("savingClockEvent"));
    try {
      await apiRequest("/me/web-punches", {
        method: "POST",
        body: JSON.stringify({ eventType }),
      });
      setClockMessage(t("webPunchSaved"));
      await load();
    } catch (reason) {
      setClockMessage(
        reason instanceof Error ? reason.message : t("recordTimeFailed"),
      );
    } finally {
      setClocking(false);
    }
  };
  const cancelLeave = async (id: string) => {
    if (!window.confirm(t("cancelLeaveConfirm"))) return;
    try {
      await apiRequest(`/me/leaves/${id}/cancel`, { method: "PATCH" });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("cancelLeaveFailed"),
      );
    }
  };
  if (loading)
    return (
      <div className="portal-loading">
        <LoaderCircle className="spinner" />
        <p>{t("loadingWorkspace")}</p>
      </div>
    );
  if (!data)
    return (
      <div className="portal-loading">
        <X />
        <p>{error || t("employeeWorkspaceUnavailable")}</p>
        <button
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          {t("tryAgain")}
        </button>
        <button onClick={onLogout}>{t("signOut")}</button>
      </div>
    );
  const profile = data.profile;
  return (
    <main className="employee-portal">
      <header className="portal-header">
        <div className="portal-brand">
          <span>
            <BrandMark />
          </span>
          <div>
            <strong>davomat.</strong>
            <small>{profile.companyName}</small>
          </div>
        </div>
        <div className="portal-header-actions">
          <LanguageSwitcher compact />
          <NotificationCenter
            employee
            onAction={(action) =>
              setTab(action === "schedule" ? "schedule" : "requests")
            }
          />
          <button onClick={onLogout}>
            <LogOut size={18} />
            {t("signOut")}
          </button>
        </div>
      </header>
      <div className="portal-shell">
        <section className="portal-welcome">
          <div>
            <p className="eyebrow">{t("employeeWorkspace")}</p>
            <h1>{t("hello", { name: profile.name.split(" ")[0] })}</h1>
            <p>
              {profile.jobTitle} ·{" "}
              {profile.location ?? t("locationNotAssigned")}
            </p>
          </div>
          <span>{profile.employeeNumber}</span>
        </section>
        {error && (
          <div className="portal-inline-error">
            <X size={16} />
            {error}
            <button onClick={() => void load()}>
              <RefreshCw size={15} />
              {t("retry")}
            </button>
          </div>
        )}
        <nav className="portal-tabs">
          {(
            [
              ["home", Clock3, "today"],
              ["schedule", CalendarDays, "schedule"],
              ["requests", FilePenLine, "requests"],
              ["tasks", ClipboardList, "tasks"],
              ["hours", Timer, "myWorkHours"],
              ["pay", CircleDollarSign, "payslips"],
            ] as const
          ).map(([name, Icon, key]) => (
            <button
              key={name}
              className={tab === name ? "active" : ""}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => setTab(name)}
            >
              <Icon size={17} />
              {t(key)}
            </button>
          ))}
        </nav>
        {tab === "tasks" && <TasksPage employee />}
        {tab === "hours" && <WorkforceReport employee />}
        {tab === "home" && (
          <div className="portal-home-grid">
            <section className="portal-clock-card">
              <div className="portal-clock-icon">
                <Clock3 size={25} />
              </div>
              <p>
                {new Intl.DateTimeFormat(intlLocale(locale), {
                  timeZone: profile.timezone,
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                }).format(new Date())}
              </p>
              <h2>
                {lastEvent === "NONE"
                  ? t("readyToStart")
                  : lastEvent === "CLOCK_OUT"
                    ? t("shiftCompleted")
                    : lastEvent === "BREAK_START"
                      ? t("breakInProgress")
                      : t("clockedIn")}
              </h2>
              {activeShift ? (
                <div className="portal-shift-summary">
                  <MapPin size={17} />
                  <span>
                    <strong>
                      {formatTime(activeShift.startsAt)} –{" "}
                      {formatTime(activeShift.endsAt)}
                    </strong>
                    {activeShift.location ?? t("locationNotAssigned")}
                  </span>
                </div>
              ) : (
                <div className="portal-shift-summary">
                  <CalendarDays size={17} />
                  <span>
                    <strong>{t("noNearbyShift")}</strong>
                    {t("canRecordTime")}
                  </span>
                </div>
              )}
              {mainAction && (
                <button
                  className="portal-clock-button"
                  disabled={clocking}
                  onClick={() => void punch(mainAction)}
                >
                  {clocking ? (
                    <LoaderCircle className="spinner" size={20} />
                  ) : mainAction === "BREAK_END" ? (
                    <Coffee size={20} />
                  ) : (
                    <Navigation size={20} />
                  )}{" "}
                  {t(
                    mainAction === "CLOCK_IN"
                      ? "startWorkingDay"
                      : mainAction === "CLOCK_OUT"
                        ? "finishWorkingDay"
                        : eventTranslationKey[mainAction],
                  )}
                </button>
              )}
              {secondaryAction && (
                <button
                  className="portal-break-button"
                  disabled={clocking}
                  onClick={() => void punch(secondaryAction)}
                >
                  <Coffee size={17} />
                  {t(eventTranslationKey[secondaryAction])}
                </button>
              )}
              {clockMessage && (
                <p className="portal-clock-message">{clockMessage}</p>
              )}
              <p className="portal-clock-message">{t("webAttendanceHint")}</p>
              <div className="portal-privacy">
                <ShieldCheck size={16} />
                {t("webAttendanceHint")}
              </div>
            </section>
            <section className="portal-panel">
              <div className="portal-panel-heading">
                <div>
                  <h2>{t("todayTimeline")}</h2>
                  <p>{t("recordedEvents", { count: todaysPunches.length })}</p>
                </div>
                <button onClick={() => void load()} aria-label={t("refresh")}>
                  <RefreshCw size={17} />
                </button>
              </div>
              <div className="portal-timeline">
                {todaysPunches.length === 0 ? (
                  <div className="portal-empty">
                    <Clock3 size={22} />
                    <p>{t("noEventsToday")}</p>
                  </div>
                ) : (
                  todaysPunches.map((item) => (
                    <article key={item.id}>
                      <i />
                      <div>
                        <strong>
                          {t(eventTranslationKey[item.eventType])}
                        </strong>
                        <span>
                          {t(
                            sourceTranslationKey[item.source] ??
                              "unknownSource",
                          )}{" "}
                          {item.withinGeofence === true
                            ? `· ${t("locationVerified")}`
                            : item.withinGeofence === false
                              ? `· ${t("outsideLocation")}`
                              : ""}
                        </span>
                      </div>
                      <time>{formatTime(item.occurredAt)}</time>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
        {tab === "schedule" && (
          <>
            <section className="portal-panel portal-tab-panel">
              <div className="portal-panel-heading">
                <div>
                  <h2>{t("publishedSchedule")}</h2>
                  <p>{t("nextDays")}</p>
                </div>
              </div>
              <ShiftList shifts={data.shifts} timeZone={profile.timezone} />
            </section>
            <ScheduleSelfService
              shifts={data.shifts}
              timeZone={profile.timezone}
            />
          </>
        )}
        {tab === "pay" && (
          <section className="portal-panel portal-tab-panel">
            <div className="portal-panel-heading">
              <div>
                <h2>{t("yourPayslips")}</h2>
                <p>{t("approvedOnly")}</p>
              </div>
            </div>
            <div className="portal-list">
              {data.payslips.length === 0 ? (
                <div className="portal-empty">
                  <CircleDollarSign size={24} />
                  <strong>{t("noApprovedPayslips")}</strong>
                  <p>{t("approvedPayrollHere")}</p>
                </div>
              ) : (
                data.payslips.map((slip) => (
                  <article key={slip.id}>
                    <span className="portal-list-icon">
                      <CircleDollarSign size={18} />
                    </span>
                    <div>
                      <strong>
                        {new Intl.DateTimeFormat(intlLocale(locale), {
                          month: "long",
                          year: "numeric",
                          timeZone: "UTC",
                        }).format(
                          new Date(`${slip.startsOn.slice(0, 10)}T00:00:00Z`),
                        )}
                      </strong>
                      <p>
                        {t("gross")} {formatUzs(slip.grossPay)} ·{" "}
                        {t(slip.status.toLowerCase())}
                      </p>
                    </div>
                    <strong className="portal-pay-value">
                      {formatUzs(slip.netPay)}
                    </strong>
                  </article>
                ))
              )}
            </div>
          </section>
        )}
        {tab === "requests" && (
          <div className="portal-request-grid">
            <section className="portal-panel">
              <CorrectionForm onSaved={load} />
            </section>
            <section className="portal-panel">
              <LeaveForm balance={data.leaveBalance} onSaved={load} />
            </section>
            <section className="portal-panel portal-security">
              <div className="portal-panel-heading">
                <div>
                  <h2>{t("requestHistory")}</h2>
                  <p>{t("recentDecisions")}</p>
                </div>
              </div>
              <div className="portal-list correction-history">
                {data.leaves.map((item) => (
                  <article key={`leave-${item.id}`}>
                    <span
                      className={`request-status ${item.status.toLowerCase()}`}
                    />
                    <div>
                      <strong>{t(leaveTranslationKey[item.leaveType])}</strong>
                      <p>
                        {item.startsOn} – {item.endsOn} · {item.reason}
                        {item.managerNote && (
                          <>
                            {" "}
                            · {t("manager")}: {item.managerNote}
                          </>
                        )}
                      </p>
                    </div>
                    {item.status === "PENDING" ? (
                      <button
                        className="portal-cancel-request"
                        onClick={() => void cancelLeave(item.id)}
                      >
                        <X size={14} />
                        {t("cancel")}
                      </button>
                    ) : (
                      <small>
                        {item.status === "CANCELLED"
                          ? t("cancelled")
                          : t(requestStatusTranslationKey[item.status])}
                      </small>
                    )}
                  </article>
                ))}
                {data.corrections.map((item) => (
                  <article key={`correction-${item.id}`}>
                    <span
                      className={`request-status ${item.status.toLowerCase()}`}
                    />
                    <div>
                      <strong>
                        {item.requestedCorrection?.eventType
                          ? t(
                              eventTranslationKey[
                                item.requestedCorrection.eventType
                              ],
                            )
                          : t("correctionRequest")}
                      </strong>
                      <p>
                        {item.details}
                        {item.managerNote && (
                          <>
                            {" "}
                            · {t("manager")}: {item.managerNote}
                          </>
                        )}
                      </p>
                    </div>
                    <small>{t(requestStatusTranslationKey[item.status])}</small>
                  </article>
                ))}
                {data.leaves.length === 0 && data.corrections.length === 0 && (
                  <div className="portal-empty">
                    <FilePenLine size={22} />
                    <p>{t("noRequests")}</p>
                  </div>
                )}
              </div>
            </section>
            <section className="portal-panel portal-security">
              <PasswordForm />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
