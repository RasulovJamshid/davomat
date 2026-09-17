import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ScanFace,
  Search,
  UsersRound,
} from "lucide-react";
import { apiRequest } from "./api";
import { GeofenceStatus } from "./GeofenceStatus";
import { intlLocale, useI18n } from "./i18n";
import { tashkentDate } from "./operationsApi";
import {
  addDateDays,
  fetchEmployeeAttendance,
  mondayOfWeek,
  type EmployeeAttendanceDay,
} from "./workforceApi";
import { hours, type WorkforceSummary } from "./WorkforceReport";

const statusKey: Record<EmployeeAttendanceDay["status"], string> = {
  ON_LEAVE: "approvedLeave",
  UNSCHEDULED: "unscheduled",
  UPCOMING: "statusUPCOMING",
  ABSENT: "absent",
  OUTSIDE_GEOFENCE: "locationIssue",
  LATE: "late",
  ON_SHIFT: "onShift",
  ON_TIME: "onTime",
};
const sourceKey: Record<string, string> = {
  MOBILE: "mobile",
  KIOSK: "faceKiosk",
  TURNSTILE: "turnstile",
  WEB: "webBrowser",
  MANUAL: "manual",
  QR: "qrCode",
};

/** Who was late or absent most often since the first of the month. */
function LatenessThisMonth({
  onPick,
}: {
  onPick: (employeeId: string) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<WorkforceSummary[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const today = tashkentDate();
    apiRequest<WorkforceSummary[]>(
      `/workforce-summary?from=${today.slice(0, 7)}-01&to=${today}`,
    )
      .then((data) =>
        setRows(
          data
            .filter((row) => row.lateDays > 0 || row.absentDays > 0)
            .sort(
              (a, b) => b.lateDays + b.absentDays - (a.lateDays + a.absentDays),
            )
            .slice(0, 8),
        ),
      )
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : t("loadFailed")),
      );
  }, []);
  return (
    <section className="panel lateness-panel">
      <div className="panel-header">
        <div>
          <h2>{t("lateThisMonth")}</h2>
          <p>{t("lateThisMonthHint")}</p>
        </div>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : rows.length === 0 ? (
        <p className="lateness-empty">{t("noLatenessThisMonth")}</p>
      ) : (
        <ul className="lateness-list">
          {rows.map((row) => (
            <li key={row.employeeId}>
              <button type="button" onClick={() => onPick(row.employeeId)}>
                <strong>{row.employee}</strong>
                <span>
                  <em className="late">
                    {t("lateDaysCount", { count: row.lateDays })}
                  </em>
                  <em className="absent">
                    {t("absentDaysCount", { count: row.absentDays })}
                  </em>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function EmployeeAttendance({
  initialEmployeeId,
}: {
  initialEmployeeId?: string;
}) {
  const { t, locale } = useI18n();
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? "");
  const [query, setQuery] = useState("");
  const [weekStart, setWeekStart] = useState(() =>
    mondayOfWeek(tashkentDate()),
  );
  const [days, setDays] = useState<EmployeeAttendanceDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    apiRequest<{ id: string; name: string; status: string }[]>("/employees")
      .then((rows) =>
        setPeople(rows.filter((row) => row.status !== "INACTIVE")),
      )
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : t("loadFailed")),
      );
  }, []);
  useEffect(() => {
    if (!employeeId) return;
    let active = true;
    setLoading(true);
    setError("");
    fetchEmployeeAttendance(employeeId, weekStart, addDateDays(weekStart, 6))
      .then((rows) => {
        if (active) setDays(rows);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : t("loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [employeeId, weekStart]);

  const time = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(intlLocale(locale), {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(value))
      : "—";
  const dayLabel = (value: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  const filteredPeople = useMemo(
    () =>
      people.filter((person) =>
        person.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [people, query],
  );
  const totals = useMemo(
    () => ({
      worked: days.reduce((sum, day) => sum + (day.workedMinutes ?? 0), 0),
      late: days.filter((day) => day.status === "LATE").length,
      absent: days.filter((day) => day.status === "ABSENT").length,
      issues: days.filter((day) => day.status === "OUTSIDE_GEOFENCE").length,
    }),
    [days],
  );
  const selected = people.find((person) => person.id === employeeId);

  return (
    <div className="employee-attendance">
      <div className="employee-attendance-layout">
        <aside className="panel employee-picker">
          <label className="mini-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("findEmployee")}
            />
          </label>
          <ul>
            {filteredPeople.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className={person.id === employeeId ? "active" : ""}
                  aria-pressed={person.id === employeeId}
                  onClick={() => setEmployeeId(person.id)}
                >
                  {person.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="employee-week">
          {!employeeId ? (
            <div className="empty-state panel">
              <span>
                <UsersRound size={22} />
              </span>
              <strong>{t("chooseEmployee")}</strong>
              <p>{t("byEmployee")}</p>
            </div>
          ) : (
            <section className="panel">
              <div className="panel-header table-heading">
                <div>
                  <h2>{selected?.name}</h2>
                  <p>{t("weekOf", { date: dayLabel(weekStart) })}</p>
                </div>
                <div className="week-navigator compact">
                  <button
                    aria-label={t("previousWeek")}
                    onClick={() => setWeekStart(addDateDays(weekStart, -7))}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <button
                    className="secondary-button"
                    disabled={weekStart === mondayOfWeek(tashkentDate())}
                    onClick={() => setWeekStart(mondayOfWeek(tashkentDate()))}
                  >
                    {t("thisWeek")}
                  </button>
                  <button
                    aria-label={t("nextWeek")}
                    onClick={() => setWeekStart(addDateDays(weekStart, 7))}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
              <div className="employee-week-totals">
                <span>
                  {t("workedShort")}: <strong>{hours(totals.worked)}</strong>
                </span>
                <span>
                  {t("lateArrivals")}: <strong>{totals.late}</strong>
                </span>
                <span>
                  {t("absent")}: <strong>{totals.absent}</strong>
                </span>
                <span>
                  {t("locationIssue")}: <strong>{totals.issues}</strong>
                </span>
              </div>
              {error && (
                <p className="operations-error" role="alert">
                  {error}
                </p>
              )}
              <div className="table-wrap">
                <table className="employee-week-table">
                  <thead>
                    <tr>
                      <th>{t("date")}</th>
                      <th>{t("shift")}</th>
                      <th>{t("clockIn")}</th>
                      <th>{t("clockOut")}</th>
                      <th>{t("workedShort")}</th>
                      <th>{t("evidence")}</th>
                      <th>{t("status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7}>{t("loading")}</td>
                      </tr>
                    ) : (
                      days.map((day) => (
                        <tr
                          key={day.date}
                          className={`day-${day.status.toLowerCase()}`}
                        >
                          <td>{dayLabel(day.date)}</td>
                          <td>
                            {day.shiftStart ? (
                              <>
                                <span className="mono">
                                  {time(day.shiftStart)}–{time(day.shiftEnd)}
                                </span>
                                {day.location && <small>{day.location}</small>}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="mono">
                            {time(day.clockIn)}
                            {day.clockInSource && (
                              <small>
                                {t(sourceKey[day.clockInSource] ?? "noRecord")}
                              </small>
                            )}
                          </td>
                          <td className="mono">{time(day.clockOut)}</td>
                          <td className="mono">
                            {day.workedMinutes != null
                              ? hours(day.workedMinutes)
                              : "—"}
                          </td>
                          <td>
                            {day.clockIn ? (
                              <span className="evidence-cell">
                                <GeofenceStatus
                                  value={day.clockInWithinGeofence}
                                />
                                <span
                                  className={`face-check ${day.clockInFaceVerified ? "ok" : ""}`}
                                  title={t(
                                    day.clockInFaceVerified
                                      ? "faceVerified"
                                      : "noFaceCheck",
                                  )}
                                >
                                  <ScanFace size={14} aria-hidden="true" />
                                  {t(
                                    day.clockInFaceVerified
                                      ? "faceVerified"
                                      : "noFaceCheck",
                                  )}
                                </span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <span
                              className={`status ${day.status.toLowerCase()}`}
                            >
                              {["LATE", "ABSENT", "OUTSIDE_GEOFENCE"].includes(
                                day.status,
                              ) ? (
                                <AlertTriangle size={12} aria-hidden="true" />
                              ) : (
                                <i />
                              )}
                              {t(statusKey[day.status])}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
      <LatenessThisMonth onPick={setEmployeeId} />
    </div>
  );
}
