import { useMemo, useState, type FormEvent } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  DoorOpen,
  Filter,
  MapPin,
  Pencil,
  Plus,
  ScanFace,
  Search,
  Smartphone,
  UserRoundCheck,
  X,
  XCircle,
} from "lucide-react";
import type { EmployeeRow, ExceptionItem } from "./data";
import { intlLocale, useI18n } from "./i18n";
import { AttendanceEventsModal } from "./AttendanceEventsModal";

export type AttendanceTab = "records" | "exceptions";
type RecordFilter = "all" | "working" | "attention";
type Resolution = "approved" | "rejected";

interface AttendancePageProps {
  date: string;
  exceptions: ExceptionItem[];
  records: EmployeeRow[];
  loading: boolean;
  tab: AttendanceTab;
  onTabChange: (tab: AttendanceTab) => void;
  onResolve: (
    id: string | number,
    resolution: Resolution,
    managerNote: string,
  ) => Promise<void>;
  onRecordPunch: (input: {
    employeeId: string;
    eventType: "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
    occurredAt: string;
    note?: string;
  }) => Promise<void>;
  onDateChange: (date: string) => void;
}

const statusTranslationKey = {
  ON_SHIFT: "onShift",
  ON_TIME: "onTime",
  LATE: "late",
  INCOMPLETE: "incomplete",
  ABSENT: "absent",
  OUTSIDE_GEOFENCE: "locationIssue",
  ON_LEAVE: "approvedLeave",
  UNSCHEDULED: "unscheduled",
};

const sourceTranslationKey = {
  MOBILE: "mobile",
  KIOSK: "faceKiosk",
  TURNSTILE: "turnstile",
  MANUAL: "manual",
  QR: "qrCode",
  UNRECORDED: "noRecord",
};

const sourceIcon = {
  MOBILE: Smartphone,
  KIOSK: ScanFace,
  TURNSTILE: DoorOpen,
  MANUAL: UserRoundCheck,
  QR: Smartphone,
  UNRECORDED: Clock3,
};
const exceptionTitleTranslationKey: Record<string, string> = {
  OUTSIDE_GEOFENCE: "outsideGeofence",
  LATE: "lateArrival",
  MISSING_CLOCK_OUT: "missingClockOut",
  MISSING_CLOCK_IN: "missingClockIn",
  OVERTIME: "overtimeApproval",
  CORRECTION_REQUEST: "correctionRequest",
};
const exceptionDetailTranslationKey: Record<string, string> = {
  OUTSIDE_GEOFENCE: "outsideGeofenceDetail",
  MISSING_CLOCK_OUT: "missingClockOutDetail",
  MISSING_CLOCK_IN: "missingClockInDetail",
  OVERTIME: "overtimeReviewDetail",
};

function PersonAvatar({ employee }: { employee: EmployeeRow }) {
  return <span className={`avatar ${employee.tone}`}>{employee.initials}</span>;
}

function AttendanceSummary({ records }: { records: EmployeeRow[] }) {
  const { t } = useI18n();
  const total = Math.max(records.length, 1);
  const working = records.filter(
    (record) => record.clockIn !== "—" && record.clockOut === "—",
  ).length;
  const late = records.filter((record) => record.status === "LATE").length;
  const absent = records.filter((record) => record.status === "ABSENT").length;
  const leave = records.filter((record) => record.status === "ON_LEAVE").length;
  const percent = (value: number) => `${Math.round((value / total) * 100)}%`;
  return (
    <div className="attendance-summary">
      <article>
        <span className="summary-symbol green">
          <UserRoundCheck size={18} />
        </span>
        <div>
          <strong>{working}</strong>
          <span>{t("workingNow")}</span>
        </div>
        <small>{percent(working)}</small>
      </article>
      <article>
        <span className="summary-symbol amber">
          <Clock3 size={18} />
        </span>
        <div>
          <strong>{late}</strong>
          <span>{t("lateArrivals")}</span>
        </div>
        <small>{percent(late)}</small>
      </article>
      <article>
        <span className="summary-symbol red">
          <XCircle size={18} />
        </span>
        <div>
          <strong>{absent}</strong>
          <span>{t("absent")}</span>
        </div>
        <small>{percent(absent)}</small>
      </article>
      <article>
        <span className="summary-symbol purple">
          <CheckCircle2 size={18} />
        </span>
        <div>
          <strong>{leave}</strong>
          <span>{t("approvedLeave")}</span>
        </div>
        <small>{percent(leave)}</small>
      </article>
    </div>
  );
}

function EmployeeDrawer({
  employee,
  date,
  onManage,
  onClose,
}: {
  employee: EmployeeRow;
  date: string;
  onManage: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const SourceIcon = sourceIcon[employee.source];
  const hasClockIn = employee.clockIn !== "—";
  return (
    <>
      <button
        className="drawer-scrim"
        onClick={onClose}
        aria-label={t("closeDetails")}
      />
      <aside
        className="attendance-drawer"
        aria-label={t("employeeAttendanceDetails", { name: employee.name })}
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">{t("attendanceRecord")}</p>
            <h2>
              {new Intl.DateTimeFormat(intlLocale(locale), {
                dateStyle: "medium",
                timeZone: "UTC",
              }).format(new Date(`${date}T00:00:00Z`))}
            </h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="drawer-person">
          <PersonAvatar employee={employee} />
          <div>
            <strong>{employee.name}</strong>
            <span>
              {employee.role} · {employee.branch || t("unassigned")}
            </span>
          </div>
        </div>
        <div className="drawer-status-row">
          <span className={`status ${employee.status.toLowerCase()}`}>
            <i />
            {t(statusTranslationKey[employee.status])}
          </span>
          <span className="verified-label">
            <Check size={13} />
            {hasClockIn ? t("identityVerified") : t("noAttendanceEvent")}
          </span>
        </div>
        <section className="drawer-section">
          <h3>{t("timeline")}</h3>
          <div className="timeline">
            <div>
              <span className={`timeline-dot ${hasClockIn ? "success" : ""}`} />
              <div>
                <strong>
                  {hasClockIn ? t("clockInRecorded") : t("noClockIn")}
                </strong>
                <small>
                  {hasClockIn
                    ? `${employee.clockIn} · ${t(sourceTranslationKey[employee.source])}`
                    : t("waitingAttendance")}
                </small>
              </div>
              <time>{t("today")}</time>
            </div>
            <div>
              <span className="timeline-dot neutral" />
              <div>
                <strong>
                  {employee.clockOut === "—"
                    ? t("shiftInProgress")
                    : t("clockOutRecorded")}
                </strong>
                <small>
                  {t("recordedDuration", { duration: employee.worked })}
                </small>
              </div>
              <time>
                {employee.clockOut === "—" ? t("live") : employee.clockOut}
              </time>
            </div>
            <div className="muted">
              <span className="timeline-dot" />
              <div>
                <strong>{t("scheduledClockOut")}</strong>
                <small>
                  {employee.shift.split("–")[1]?.trim() || t("notScheduled")}
                </small>
              </div>
              <time>{t("expectedLabel")}</time>
            </div>
          </div>
        </section>
        <section className="drawer-section">
          <h3>{t("verificationTitle")}</h3>
          <div className="verification-card">
            <span>
              <SourceIcon size={18} />
            </span>
            <div>
              <strong>{t(sourceTranslationKey[employee.source])}</strong>
              <small>{hasClockIn ? t("trustedSource") : t("noSource")}</small>
            </div>
            {hasClockIn ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}
          </div>
          <div className="verification-card">
            <span>
              <MapPin size={18} />
            </span>
            <div>
              <strong>{employee.branch || t("unassigned")}</strong>
              <small>
                {employee.withinGeofence == null
                  ? t("noLocationEvidence")
                  : t("approvedLocationCheck")}
              </small>
            </div>
            {employee.withinGeofence === false ? (
              <XCircle className="danger-icon" size={18} />
            ) : employee.withinGeofence === true ? (
              <CheckCircle2 size={18} />
            ) : (
              <Clock3 size={18} />
            )}
          </div>
        </section>
        <section className="drawer-section calculation-card">
          <h3>{t("timeCalculation")}</h3>
          <dl>
            <div>
              <dt>{t("scheduled")}</dt>
              <dd>{employee.shift || t("notScheduled")}</dd>
            </div>
            <div>
              <dt>{t("worked")}</dt>
              <dd>{employee.worked}</dd>
            </div>
            <div>
              <dt>{t("payable")}</dt>
              <dd>{employee.worked}</dd>
            </div>
          </dl>
          <button className="secondary-button wide" onClick={onManage}>
            <Pencil size={16} />
            {t("manageClockEvents")}
          </button>
        </section>
      </aside>
    </>
  );
}

function RecordsView({
  records,
  loading,
  date,
}: {
  records: EmployeeRow[];
  loading: boolean;
  date: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RecordFilter>("all");
  const [selected, setSelected] = useState<EmployeeRow | null>(null);
  const [managing, setManaging] = useState<EmployeeRow | null>(null);
  const filtered = useMemo(
    () =>
      records.filter((employee) => {
        const matchesSearch =
          `${employee.name} ${employee.role} ${employee.branch}`
            .toLowerCase()
            .includes(query.toLowerCase());
        const matchesFilter =
          filter === "all" ||
          (filter === "working" &&
            employee.clockIn !== "—" &&
            employee.clockOut === "—") ||
          (filter === "attention" &&
            ["LATE", "INCOMPLETE", "ABSENT", "OUTSIDE_GEOFENCE"].includes(
              employee.status,
            ));
        return matchesSearch && matchesFilter;
      }),
    [filter, query, records],
  );
  return (
    <>
      <section className="panel records-workspace">
        <div className="records-toolbar">
          <label className="workspace-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchEmployees")}
            />
          </label>
          <div className="filter-buttons">
            <Filter size={15} />
            {(["all", "working", "attention"] as RecordFilter[]).map((item) => (
              <button
                key={item}
                className={filter === item ? "active" : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all"
                  ? t("allRecords")
                  : item === "working"
                    ? t("workingNow")
                    : t("needsAttention")}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap attendance-workspace-table">
          <table>
            <thead>
              <tr>
                <th>{t("employee")}</th>
                <th>{t("scheduled")}</th>
                <th>{t("firstIn")}</th>
                <th>{t("lastOut")}</th>
                <th>{t("worked")}</th>
                <th>{t("verification")}</th>
                <th>{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7}>{t("loadingAttendance")}</td>
                </tr>
              ) : (
                filtered.map((employee) => {
                  const SourceIcon = sourceIcon[employee.source];
                  return (
                    <tr
                      key={employee.id}
                      onClick={() => setSelected(employee)}
                      className="clickable-row"
                    >
                      <td>
                        <div className="employee-cell">
                          <PersonAvatar employee={employee} />
                          <div>
                            <strong>{employee.name}</strong>
                            <span>
                              {employee.role} ·{" "}
                              {employee.branch || t("unassigned")}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>{employee.shift || t("notScheduled")}</td>
                      <td className="mono">{employee.clockIn}</td>
                      <td className="mono">{employee.clockOut}</td>
                      <td className="mono">{employee.worked}</td>
                      <td>
                        <span className="source">
                          <SourceIcon size={15} />
                          {t(sourceTranslationKey[employee.source])}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status ${employee.status.toLowerCase()}`}
                        >
                          <i />
                          {t(statusTranslationKey[employee.status])}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>{t("recordsShown", { count: filtered.length })}</span>
          <span>{t("inspectCalculation")}</span>
        </div>
      </section>
      {selected && !managing && (
        <EmployeeDrawer
          employee={selected}
          date={date}
          onManage={() => setManaging(selected)}
          onClose={() => setSelected(null)}
        />
      )}
      {managing && (
        <AttendanceEventsModal
          employeeId={managing.id}
          employee={managing.name}
          date={date}
          onClose={() => {
            setManaging(null);
            setSelected(null);
          }}
          onChanged={() =>
            window.dispatchEvent(new CustomEvent("atlas:attendance-changed"))
          }
        />
      )}
    </>
  );
}

function ExceptionReview({
  item,
  onResolve,
}: {
  item: ExceptionItem;
  onResolve: AttendancePageProps["onResolve"];
}) {
  const { t, locale } = useI18n();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const resolve = async (resolution: Resolution) => {
    if (note.trim().length < 3) return setError(t("managerNoteMinimum"));
    setSaving(true);
    setError("");
    try {
      await onResolve(item.id, resolution, note.trim());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("resolveExceptionFailed"),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <article className={`review-card severity-${item.severity}`}>
      <div className="review-main">
        <div className="exception-identity">
          <span className={`avatar ${item.tone}`}>{item.initials}</span>
          <div>
            <strong>{item.employee}</strong>
            <span>{item.time}</span>
          </div>
        </div>
        <div className="review-problem">
          <span className={`severity-label ${item.severity}`}>
            {item.severity}
          </span>
          <h3>
            {t(exceptionTitleTranslationKey[item.type ?? ""] ?? item.title)}
          </h3>
          <p>
            {exceptionDetailTranslationKey[item.type ?? ""]
              ? t(exceptionDetailTranslationKey[item.type ?? ""])
              : item.detail}
          </p>
          {(item.requestedChange || item.requestedEventType) && (
            <div className="requested-change">
              <Clock3 size={15} />
              <span>
                <strong>{t("requestedEvent")}</strong>
                {item.requestedEventType && item.requestedOccurredAt
                  ? `${t(item.requestedEventType === "CLOCK_IN" ? "clockIn" : item.requestedEventType === "CLOCK_OUT" ? "clockOut" : item.requestedEventType === "BREAK_START" ? "startBreak" : "endBreak")} · ${new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(item.requestedOccurredAt))}`
                  : item.requestedChange}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="review-evidence">
        <div>
          <MapPin size={16} />
          <span>
            <strong>{t("evidence")}</strong>
            <small>{t("deviceLocationAvailable")}</small>
          </span>
        </div>
        <label>
          <span>{t("managerNote")}</span>
          <input
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setError("");
            }}
            placeholder={t("requiredCorrectionNote")}
          />
        </label>
      </div>
      {error && (
        <div className="schedule-error">
          <X size={15} />
          {error}
        </div>
      )}
      <div className="review-actions">
        <button
          className="reject-button"
          disabled={saving}
          onClick={() => resolve("rejected")}
        >
          <X size={16} />
          {t("reject")}
        </button>
        <button
          className="approve-button"
          disabled={saving}
          onClick={() => resolve("approved")}
        >
          <Check size={16} />
          {saving ? t("saving") : t("approveCorrection")}
        </button>
      </div>
    </article>
  );
}

function PunchModal({
  records,
  onClose,
  onSave,
}: {
  records: EmployeeRow[];
  onClose: () => void;
  onSave: AttendancePageProps["onRecordPunch"];
}) {
  const { t } = useI18n();
  const defaultDate = new Date(
    Date.now() - new Date().getTimezoneOffset() * 60_000,
  )
    .toISOString()
    .slice(0, 16);
  const [employeeId, setEmployeeId] = useState(records[0]?.id ?? "");
  const [eventType, setEventType] = useState<
    "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END"
  >("CLOCK_IN");
  const [occurredAt, setOccurredAt] = useState(defaultDate);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!employeeId) return setError(t("chooseEmployee"));
    const timestamp = new Date(occurredAt);
    if (Number.isNaN(timestamp.getTime()))
      return setError(t("chooseValidDateTime"));
    setSaving(true);
    setError("");
    try {
      await onSave({
        employeeId,
        eventType,
        occurredAt: timestamp.toISOString(),
        note: note.trim() || undefined,
      });
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("recordClockEventFailed"),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <button
        className="drawer-scrim"
        onClick={onClose}
        aria-label={t("closeClockEventForm")}
      />
      <form className="adjustment-modal punch-modal" onSubmit={submit}>
        <div className="shift-modal-header">
          <div>
            <p className="eyebrow">{t("attendanceEntry")}</p>
            <h2>{t("recordEvent")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </div>
        <p className="modal-intro">{t("manualEventNote")}</p>
        <label className="form-field">
          <span>{t("employee")}</span>
          <select
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
          >
            {records.map((record) => (
              <option value={record.id} key={record.id}>
                {record.name} · {record.branch}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>{t("eventType")}</span>
          <select
            value={eventType}
            onChange={(event) =>
              setEventType(event.target.value as typeof eventType)
            }
          >
            <option value="CLOCK_IN">{t("clockIn")}</option>
            <option value="CLOCK_OUT">{t("clockOut")}</option>
            <option value="BREAK_START">{t("startBreak")}</option>
            <option value="BREAK_END">{t("endBreak")}</option>
          </select>
        </label>
        <label className="form-field">
          <span>{t("dateTime")}</span>
          <input
            type="datetime-local"
            required
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>{t("managerNote")}</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("whyManual")}
          />
        </label>
        {error && (
          <div className="schedule-error">
            <X size={15} />
            {error}
          </div>
        )}
        <div className="shift-modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={saving}
          >
            {t("cancel")}
          </button>
          <button className="primary-button" disabled={saving}>
            <Plus size={16} />
            {saving ? t("recording") : t("recordEvent")}
          </button>
        </div>
      </form>
    </>
  );
}

export function AttendancePage({
  date,
  exceptions,
  records,
  loading,
  tab,
  onTabChange,
  onResolve,
  onRecordPunch,
  onDateChange,
}: AttendancePageProps) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  return (
    <div className="attendance-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("workspace")}</p>
          <h1>{t("attendance")}</h1>
          <p>{t("attendanceDescription")}</p>
        </div>
        <div className="schedule-heading-actions">
          <label className="secondary-button date-range-button">
            <CalendarDays size={17} />
            <input
              type="date"
              value={date}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
          <button
            className="primary-button"
            onClick={() => setRecording(true)}
            disabled={!records.length}
          >
            <Plus size={16} />
            {t("recordTime")}
          </button>
        </div>
      </div>
      <AttendanceSummary records={records} />
      <div className="workspace-tabs" role="tablist">
        <button
          className={tab === "records" ? "active" : ""}
          onClick={() => onTabChange("records")}
        >
          {t("timeRecords")} <span>{records.length}</span>
        </button>
        <button
          className={tab === "exceptions" ? "active" : ""}
          onClick={() => onTabChange("exceptions")}
        >
          {t("exceptions")}{" "}
          <span className="alert-count">{exceptions.length}</span>
        </button>
      </div>
      {tab === "records" ? (
        <RecordsView records={records} loading={loading} date={date} />
      ) : (
        <div className="exception-workspace">
          <div className="exception-workspace-heading">
            <div>
              <h2>{t("correctionInbox")}</h2>
              <p>{t("correctionInboxDescription")}</p>
            </div>
            <span>{exceptions.length} pending</span>
          </div>
          {exceptions.length > 0 ? (
            exceptions.map((item) => (
              <ExceptionReview
                key={item.id}
                item={item}
                onResolve={onResolve}
              />
            ))
          ) : (
            <div className="panel all-clear">
              <span>
                <Check size={24} />
              </span>
              <h2>{t("allCaughtUp")}</h2>
              <p>{t("noCorrections")}</p>
            </div>
          )}
        </div>
      )}
      {recording && (
        <PunchModal
          records={records}
          onClose={() => setRecording(false)}
          onSave={onRecordPunch}
        />
      )}{" "}
    </div>
  );
}
