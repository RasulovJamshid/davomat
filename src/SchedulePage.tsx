import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Filter,
  MapPin,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { shiftsOverlap } from "./domain/scheduling";
import {
  addDateDays,
  cancelShift,
  copyScheduleWeek,
  createShift,
  editShift,
  fetchSchedule,
  localDateTime,
  mondayOfWeek,
  publishSchedule,
  type ApiEmployeeOption,
  type ApiLocation,
  type ApiShift,
} from "./workforceApi";
import { tashkentDate } from "./operationsApi";
import { intlLocale, useI18n } from "./i18n";
import { WeeklySchedules } from "./WeeklySchedules";
import { scheduleText } from "./scheduleCopy";

type ShiftTone = "sage" | "blue" | "amber" | "plum" | "slate";
interface ShiftTemplate {
  start: string;
  end: string;
  label: string;
  tone: ShiftTone;
  hours: string;
}
interface Day {
  key: string;
  name: string;
  date: string;
  dateKey: string;
  today: boolean;
}

const tones = ["plum", "blue", "gold", "green", "coral"];
const templates: ShiftTemplate[] = [
  {
    start: "09:00",
    end: "18:00",
    label: "Day shift",
    tone: "sage",
    hours: "8 paid hours",
  },
  {
    start: "08:00",
    end: "17:00",
    label: "Opening",
    tone: "blue",
    hours: "8 paid hours",
  },
  {
    start: "14:00",
    end: "22:00",
    label: "Closing",
    tone: "amber",
    hours: "7 paid hours",
  },
  {
    start: "22:00",
    end: "06:00",
    label: "Night shift",
    tone: "plum",
    hours: "8 paid hours",
  },
];
const templateNameKeys = [
  "dayShift",
  "opening",
  "closing",
  "nightShift",
] as const;
const templatePaidHours = [8, 8, 7, 8];
let scheduleTimeZone = "Asia/Tashkent";

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Tashkent",
});
const formatTime = (value: string) => timeFormatter.format(new Date(value));
const employeeView = (employee: ApiEmployeeOption, index: number) => ({
  ...employee,
  initials: employee.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase(),
  role: employee.jobTitle,
  tone: tones[index % tones.length],
});

function ShiftAssignment({
  employee,
  day,
  existing,
  locations,
  timeZone = scheduleTimeZone,
  onClose,
  onCreated,
}: {
  employee: ReturnType<typeof employeeView>;
  day: Day;
  existing: ApiShift[];
  locations: ApiLocation[];
  timeZone?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState(0);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [liveTrackingEnabled, setLiveTrackingEnabled] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const assign = async () => {
    const template = templates[selected];
    if (!locationId) return setError(t("chooseWorkLocation"));
    const start = localDateTime(day.dateKey, template.start, timeZone);
    const end = localDateTime(
      template.end <= template.start
        ? addDateDays(day.dateKey, 1)
        : day.dateKey,
      template.end,
      timeZone,
    );
    const proposed = { start: template.start, end: template.end };
    if (
      existing.some((shift) =>
        shiftsOverlap(
          { start: formatTime(shift.startsAt), end: formatTime(shift.endsAt) },
          proposed,
        ),
      )
    )
      return setError(t("shiftOverlap"));
    setSaving(true);
    setError("");
    try {
      await createShift({
        employeeId: employee.id,
        locationId,
        startsAt: start,
        endsAt: end,
        unpaidBreakMinutes: template.label === "Closing" ? 60 : 60,
        graceMinutes: 5,
        liveTrackingEnabled,
      });
      onCreated();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("assignShiftFailed"),
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
        aria-label={t("close")}
      />
      <div
        className="shift-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("assignShift")}
      >
        <div className="shift-modal-header">
          <div>
            <p className="eyebrow">{t("assignSchedule")}</p>
            <h2>
              {day.name},{" "}
              {new Intl.DateTimeFormat(intlLocale(locale), {
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              }).format(new Date(`${day.dateKey}T00:00:00Z`))}
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
        <div className="shift-person">
          <span className={`avatar ${employee.tone}`}>{employee.initials}</span>
          <div>
            <strong>{employee.name}</strong>
            <span>{employee.role}</span>
          </div>
        </div>
        {existing.length > 0 && (
          <div className="existing-notice">
            <Clock3 size={16} />
            <span>{t("existingShifts", { count: existing.length })}</span>
          </div>
        )}
        <h3 className="modal-section-title">{t("chooseTemplate")}</h3>
        <div className="template-options">
          {templates.map((template, index) => (
            <button
              type="button"
              key={template.label}
              className={selected === index ? "selected" : ""}
              onClick={() => {
                setSelected(index);
                setError("");
              }}
            >
              <span className={`template-swatch ${template.tone}`} />
              <div>
                <strong>{t(templateNameKeys[index])}</strong>
                <span>
                  {template.start} – {template.end}
                </span>
              </div>
              <small>
                {t("paidHours", { count: templatePaidHours[index] })}
              </small>
              {selected === index && <Check size={17} />}
            </button>
          ))}
        </div>
        <label className="form-field schedule-location-field">
          <span>{t("workLocation")}</span>
          <div className="select-control">
            <select
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((location) => (
                <option value={location.id} key={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </div>
        </label>
        <label className="form-check schedule-live-tracking">
          <input
            type="checkbox"
            checked={liveTrackingEnabled}
            onChange={(event) => setLiveTrackingEnabled(event.target.checked)}
          />
          <span>
            <strong>{t("enableLiveTracking")}</strong>
            <small>{t("liveTrackingScheduleHelp")}</small>
          </span>
        </label>
        {error && (
          <div className="schedule-error">
            <X size={15} />
            {error}
          </div>
        )}
        <div className="shift-modal-actions">
          <button
            className="secondary-button"
            onClick={onClose}
            disabled={saving}
          >
            {t("cancel")}
          </button>
          <button className="primary-button" onClick={assign} disabled={saving}>
            <Plus size={16} />
            {saving ? t("assigning") : t("assignShift")}
          </button>
        </div>
      </div>
    </>
  );
}

function ShiftEditor({
  shift,
  locations,
  timeZone = scheduleTimeZone,
  onClose,
  onSaved,
}: {
  shift: ApiShift;
  locations: ApiLocation[];
  timeZone?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  const [date, setDate] = useState(() =>
    tashkentDate(new Date(shift.startsAt)),
  );
  const [start, setStart] = useState(() => formatTime(shift.startsAt));
  const [end, setEnd] = useState(() => formatTime(shift.endsAt));
  const [locationId, setLocationId] = useState(shift.locationId);
  const [breakMinutes, setBreakMinutes] = useState(
    String(shift.unpaidBreakMinutes),
  );
  const [graceMinutes, setGraceMinutes] = useState(String(shift.graceMinutes));
  const [liveTrackingEnabled, setLiveTrackingEnabled] = useState(
    shift.liveTrackingEnabled,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await editShift(shift.id, {
        locationId,
        startsAt: localDateTime(date, start, timeZone),
        endsAt: localDateTime(
          end <= start ? addDateDays(date, 1) : date,
          end,
          timeZone,
        ),
        unpaidBreakMinutes: Number(breakMinutes),
        graceMinutes: Number(graceMinutes),
        liveTrackingEnabled,
      });
      onSaved(t("shiftUpdatedDraft"));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("updateShiftFailed"),
      );
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(t("cancelShiftConfirm", { name: shift.employee })))
      return;
    setSaving(true);
    setError("");
    try {
      await cancelShift(shift.id);
      onSaved(t("shiftCancelledAudit"));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("cancelShiftFailed"),
      );
      setSaving(false);
    }
  };
  return (
    <>
      <button
        className="drawer-scrim"
        onClick={onClose}
        aria-label={t("close")}
      />
      <div
        className="shift-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("editShift", { name: shift.employee })}
      >
        <div className="shift-modal-header">
          <div>
            <p className="eyebrow">{t("scheduleDetails")}</p>
            <h2>{t("editShift", { name: shift.employee })}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="profile-edit-grid">
          <label className="form-field">
            <span>{t("date")}</span>
            <input
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("workLocation")}</span>
            <select
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t("startTime")}</span>
            <input
              type="time"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("endTime")}</span>
            <input
              type="time"
              required
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("unpaidBreak")}</span>
            <input
              type="number"
              min="0"
              max="600"
              required
              value={breakMinutes}
              onChange={(event) => setBreakMinutes(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("gracePeriod")}</span>
            <input
              type="number"
              min="0"
              max="120"
              required
              value={graceMinutes}
              onChange={(event) => setGraceMinutes(event.target.value)}
            />
          </label>
          <label className="form-check schedule-live-tracking">
            <input
              type="checkbox"
              checked={liveTrackingEnabled}
              onChange={(event) => setLiveTrackingEnabled(event.target.checked)}
            />
            <span>
              <strong>{t("enableLiveTracking")}</strong>
              <small>{t("liveTrackingScheduleHelp")}</small>
            </span>
          </label>
        </div>
        <p className="modal-intro">{t("revisionDraft")}</p>
        {error && (
          <div className="schedule-error">
            <X size={15} />
            {error}
          </div>
        )}
        <div className="shift-modal-actions">
          <button
            className="reject-button"
            onClick={() => void remove()}
            disabled={saving}
          >
            <Trash2 size={16} />
            {t("cancelShift")}
          </button>
          <button
            className="secondary-button"
            onClick={onClose}
            disabled={saving}
          >
            {t("close")}
          </button>
          <button
            className="primary-button"
            onClick={() => void save()}
            disabled={saving}
          >
            <Pencil size={16} />
            {saving ? t("saving") : t("saveChanges")}
          </button>
        </div>
      </div>
    </>
  );
}

export function SchedulePage({
  initialEmployeeId,
}: {
  initialEmployeeId?: string;
}) {
  const { t, locale } = useI18n();
  const [weekStart, setWeekStart] = useState(() =>
    mondayOfWeek(tashkentDate()),
  );
  const [scheduleView, setScheduleView] = useState<"calendar" | "weekly">(
    "calendar",
  );
  const [employees, setEmployees] = useState<ApiEmployeeOption[]>([]);
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [shifts, setShifts] = useState<ApiShift[]>([]);
  const [query, setQuery] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState(initialEmployeeId ?? "");
  useEffect(
    () => setEmployeeFilter(initialEmployeeId ?? ""),
    [initialEmployeeId],
  );
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [selection, setSelection] = useState<{
    employee: ReturnType<typeof employeeView>;
    day: Day;
  } | null>(null);
  const [selectedShift, setSelectedShift] = useState<ApiShift | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [action, setAction] = useState<"copy" | "publish" | null>(null);
  const actionLock = useRef(false);
  const loadSequence = useRef(0);
  const currentWeek = mondayOfWeek(tashkentDate());
  const hasFilters = Boolean(
    employeeFilter || query || locationFilter !== "ALL" || roleFilter !== "ALL",
  );
  const clearFilters = () => {
    setQuery("");
    setEmployeeFilter("");
    setLocationFilter("ALL");
    setRoleFilter("ALL");
  };
  const weekEnd = addDateDays(weekStart, 6);
  const toExclusive = addDateDays(weekStart, 7);
  const days = useMemo<Day[]>(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const dateKey = addDateDays(weekStart, index);
        const date = new Date(`${dateKey}T00:00:00Z`);
        return {
          key: dateKey,
          name: new Intl.DateTimeFormat(intlLocale(locale), {
            weekday: "short",
            timeZone: "UTC",
          }).format(date),
          date: String(date.getUTCDate()),
          dateKey,
          today: dateKey === tashkentDate(),
        };
      }),
    [weekStart, locale],
  );
  const load = () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    return fetchSchedule(weekStart, toExclusive)
      .then((data) => {
        if (sequence !== loadSequence.current) return;
        setEmployees(data.employees);
        setLocations(data.meta.locations);
        setShifts(data.shifts.filter((shift) => shift.status !== "CANCELLED"));
        scheduleTimeZone = data.timeZone;
      })
      .catch((reason) => {
        if (sequence !== loadSequence.current) return;
        setError(
          reason instanceof Error ? reason.message : t("loadScheduleFailed"),
        );
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoading(false);
      });
  };
  useEffect(() => {
    void load();
    return () => {
      ++loadSequence.current;
    };
  }, [weekStart]);
  const people = useMemo(() => employees.map(employeeView), [employees]);
  const roles = useMemo(
    () => [...new Set(people.map((employee) => employee.role))].sort(),
    [people],
  );
  const filteredEmployees = useMemo(
    () =>
      people.filter(
        (employee) =>
          (!employeeFilter || employee.id === employeeFilter) &&
          `${employee.name} ${employee.role}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (roleFilter === "ALL" || employee.role === roleFilter) &&
          (locationFilter === "ALL" ||
            shifts.some(
              (shift) =>
                shift.employeeId === employee.id &&
                shift.locationId === locationFilter,
            )),
      ),
    [employeeFilter, locationFilter, people, query, roleFilter, shifts],
  );
  const byCell = useMemo(() => {
    const result: Record<string, ApiShift[]> = {};
    for (const shift of shifts) {
      const date = tashkentDate(new Date(shift.startsAt));
      const key = `${shift.employeeId}-${date}`;
      (result[key] ??= []).push(shift);
    }
    return result;
  }, [shifts]);
  const scheduledPeople = new Set(shifts.map((shift) => shift.employeeId));
  const coverage = employees.length
    ? Math.round(
        (employees.filter((employee) => scheduledPeople.has(employee.id))
          .length /
          employees.length) *
          100,
      )
    : 0;
  const gaps = people.filter((employee) => !scheduledPeople.has(employee.id));
  const draftCount = shifts.filter((shift) => shift.status === "DRAFT").length;
  const hasDraft = draftCount > 0;
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };
  const cancel = (shift: ApiShift) => setSelectedShift(shift);
  const publish = async () => {
    if (actionLock.current || loading || !hasDraft) return;
    actionLock.current = true;
    setAction("publish");
    setError("");
    try {
      const result = await publishSchedule(weekStart, weekEnd);
      notify(
        result.published
          ? t("shiftsPublished", { count: result.published })
          : t("scheduleAlreadyPublished"),
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("publishScheduleFailed"),
      );
    } finally {
      actionLock.current = false;
      setAction(null);
    }
  };
  const copyPrevious = async () => {
    if (actionLock.current || loading) return;
    actionLock.current = true;
    setAction("copy");
    setError("");
    try {
      const result = await copyScheduleWeek(
        addDateDays(weekStart, -7),
        weekStart,
      );
      notify(
        result.copied
          ? t("shiftsCopiedDraft", { count: result.copied })
          : t("noShiftsToCopy"),
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("copyScheduleFailed"),
      );
    } finally {
      actionLock.current = false;
      setAction(null);
    }
  };
  const rangeLabel = `${new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${weekStart}T00:00:00Z`))} – ${new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${weekEnd}T00:00:00Z`))}`;
  return (
    <div className="schedule-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("workspace")}</p>
          <h1>{t("schedule")}</h1>
          <p>{scheduleText(locale, "calendarHelp")}</p>
        </div>
        {scheduleView === "calendar" && (
          <div className="schedule-heading-actions">
            <button
              className="secondary-button"
              onClick={copyPrevious}
              disabled={loading || action !== null}
            >
              <Copy size={16} />
              {t(action === "copy" ? "copyingSchedule" : "copyPreviousWeek")}
            </button>
            <button
              className="primary-button"
              onClick={publish}
              disabled={loading || !hasDraft || action !== null}
            >
              <Send size={16} />
              {t(
                action === "publish"
                  ? "publishingSchedule"
                  : hasDraft || !shifts.length
                    ? "publishSchedule"
                    : "published",
              )}
            </button>
          </div>
        )}
      </div>
      <div
        className="schedule-view-tabs"
        role="tablist"
        aria-label={t("schedule")}
      >
        <button
          role="tab"
          aria-selected={scheduleView === "calendar"}
          onClick={() => setScheduleView("calendar")}
        >
          <CalendarDays size={18} />
          {scheduleText(locale, "calendar")}
        </button>
        <button
          role="tab"
          aria-selected={scheduleView === "weekly"}
          onClick={() => setScheduleView("weekly")}
        >
          <Sparkles size={18} />
          {scheduleText(locale, "weekly")}
        </button>
      </div>
      {scheduleView === "weekly" ? (
        <WeeklySchedules
          onChanged={() => {
            void load();
          }}
        />
      ) : (
        <>
          <div className="schedule-setup-banner">
            <div>
              <strong>{scheduleText(locale, "title")}</strong>
              <p>{scheduleText(locale, "forever")}</p>
            </div>
            <button
              className="primary-button"
              onClick={() => setScheduleView("weekly")}
            >
              {scheduleText(locale, "add")}
              <ChevronRight size={17} />
            </button>
          </div>
          {!loading && (
            <div className="workflow-hint" role="status">
              <CalendarDays size={18} aria-hidden="true" />
              <span>
                {t(
                  hasDraft
                    ? "scheduleDraftHint"
                    : shifts.length
                      ? "schedulePublishedHint"
                      : "scheduleStartHint",
                  { count: draftCount },
                )}
              </span>
            </div>
          )}
          {error && (
            <div className="operations-error">
              <X size={17} />
              <span>{error}</span>
              <button onClick={load}>{t("tryAgain")}</button>
            </div>
          )}
          <div className="schedule-insights">
            <span>
              <UsersRound size={16} />
              {t("employeesCount", { count: employees.length })}
            </span>
            <span>
              <CalendarDays size={16} />
              {t("assignedShifts", { count: shifts.length })}
            </span>
            <span className="coverage-good">
              <Check size={16} />
              {t("coveragePercent", { count: coverage })}
            </span>
            <span className="coverage-warning">
              <Sparkles size={16} />
              {t("withoutShifts", { count: gaps.length })}
            </span>
          </div>
          <div className="schedule-toolbar panel">
            <div className="week-navigator">
              <button
                aria-label={t("previousWeek")}
                disabled={action !== null}
                onClick={() => setWeekStart(addDateDays(weekStart, -7))}
              >
                <ChevronLeft size={17} />
              </button>
              <div>
                <strong>{rangeLabel}</strong>
                <span>{t("sevenDaySchedule")}</span>
              </div>
              <button
                aria-label={t("nextWeek")}
                disabled={action !== null}
                onClick={() => setWeekStart(addDateDays(weekStart, 7))}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <button
              className="secondary-button"
              disabled={weekStart === currentWeek || action !== null}
              onClick={() => setWeekStart(currentWeek)}
            >
              {t("thisWeek")}
            </button>
            <label className="workspace-search">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("findEmployee")}
              />
            </label>
            <label className="filter-menu">
              <MapPin size={16} />
              <select
                value={locationFilter}
                onChange={(event) => setLocationFilter(event.target.value)}
              >
                <option value="ALL">{t("allLocations")}</option>
                {locations.map((location) => (
                  <option value={location.id} key={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
            <label className="filter-menu">
              <Filter size={16} />
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
              >
                <option value="ALL">{t("allRoles")}</option>
                {roles.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
          </div>
          {hasFilters && (
            <div className="filter-summary">
              <span role="status">
                {t("showingTeamMembers", {
                  shown: filteredEmployees.length,
                  total: employees.length,
                })}
              </span>
              <button className="text-button" onClick={clearFilters}>
                {t("clearFilters")}
              </button>
            </div>
          )}
          <div className="schedule-layout">
            <section className="panel schedule-grid-panel">
              <div className="schedule-scroll">
                <div className="schedule-grid schedule-grid-head">
                  <div className="person-heading">{t("teamMember")}</div>
                  {days.map((day) => (
                    <div className={day.today ? "today" : ""} key={day.key}>
                      <span>{day.name}</span>
                      <strong>{day.date}</strong>
                    </div>
                  ))}
                </div>
                {loading ? (
                  <div className="schedule-loading">
                    {t("loadingWeeklySchedule")}
                  </div>
                ) : filteredEmployees.length === 0 ? (
                  <div className="workflow-empty">
                    <Search size={24} aria-hidden="true" />
                    <strong>
                      {t(
                        hasFilters ? "noMatchingEmployees" : "noTeamToSchedule",
                      )}
                    </strong>
                    <p>
                      {t(
                        hasFilters
                          ? "adjustFiltersHint"
                          : "addPeopleBeforeSchedule",
                      )}
                    </p>
                  </div>
                ) : (
                  filteredEmployees.map((employee) => (
                    <div
                      className="schedule-grid schedule-row"
                      key={employee.id}
                    >
                      <div className="schedule-person">
                        <span className={`avatar ${employee.tone}`}>
                          {employee.initials}
                        </span>
                        <div>
                          <strong>{employee.name}</strong>
                          <span>{employee.role}</span>
                        </div>
                      </div>
                      {days.map((day) => {
                        const assigned =
                          byCell[`${employee.id}-${day.dateKey}`] ?? [];
                        return (
                          <div
                            className={`schedule-cell ${day.today ? "today" : ""}`}
                            key={day.key}
                          >
                            {assigned.length === 0 ? (
                              <button
                                className="add-shift"
                                disabled={action !== null}
                                aria-label={`${t("addShift")} · ${employee.name} · ${day.dateKey}`}
                                onClick={() => setSelection({ employee, day })}
                              >
                                <Plus size={15} />
                                {t("addShift")}
                              </button>
                            ) : (
                              <>
                                {assigned.map((item) => (
                                  <button
                                    title={t("editShiftAction")}
                                    disabled={action !== null}
                                    className={`shift-block ${item.status === "DRAFT" ? "amber" : "sage"}`}
                                    key={item.id}
                                    onClick={() => setSelectedShift(item)}
                                  >
                                    <strong>
                                      {formatTime(item.startsAt)}–
                                      {formatTime(item.endsAt)}
                                    </strong>
                                    <small>
                                      {item.location} ·{" "}
                                      {item.status === "DRAFT"
                                        ? t("draft")
                                        : t("published")}
                                    </small>
                                  </button>
                                ))}
                                <button
                                  className="add-shift compact"
                                  disabled={action !== null}
                                  onClick={() =>
                                    setSelection({ employee, day })
                                  }
                                >
                                  <Plus size={13} />
                                  {t("split")}
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
              <div className="schedule-grid-footer">
                <span>
                  {t("showingTeamMembers", {
                    shown: filteredEmployees.length,
                    total: employees.length,
                  })}
                </span>
                <span>{t("shiftEditHint")}</span>
              </div>
            </section>
            <aside className="open-shifts-panel panel">
              <div className="panel-header">
                <div>
                  <h2>{t("coverageGaps")}</h2>
                  <p>{t("employeesWithoutShift")}</p>
                </div>
                <span className="count-pill">{gaps.length}</span>
              </div>
              <div className="open-shift-list">
                {gaps.length ? (
                  gaps.slice(0, 6).map((employee) => (
                    <article key={employee.id}>
                      <div className="open-shift-top">
                        <span>{t("needsCoverage")}</span>
                        <small>{employee.role}</small>
                      </div>
                      <h3>{employee.name}</h3>
                      <p>
                        <CalendarDays size={14} />
                        {t("noAssignedShifts")}
                      </p>
                    </article>
                  ))
                ) : (
                  <div className="all-clear compact">
                    <span>
                      <Check size={20} />
                    </span>
                    <strong>{t("everyoneCovered")}</strong>
                  </div>
                )}
              </div>
            </aside>
          </div>
          {selection && (
            <ShiftAssignment
              employee={selection.employee}
              day={selection.day}
              existing={
                byCell[`${selection.employee.id}-${selection.day.dateKey}`] ??
                []
              }
              locations={locations}
              onClose={() => setSelection(null)}
              onCreated={() => {
                setSelection(null);
                notify(t("shiftAssignedDraft"));
                load();
              }}
            />
          )}
          {selectedShift && (
            <ShiftEditor
              shift={selectedShift}
              locations={locations}
              onClose={() => setSelectedShift(null)}
              onSaved={(message) => {
                setSelectedShift(null);
                notify(message);
                load();
              }}
            />
          )}
          <div className={`toast ${toast ? "visible" : ""}`} role="status">
            <Check size={17} />
            {toast}
          </div>
        </>
      )}
    </div>
  );
}
