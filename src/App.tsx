import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CalendarDays,
  Check,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Download,
  FileBarChart,
  Gauge,
  Inbox,
  LayoutGrid,
  LogOut,
  MapPin,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import type { EmployeeRow, ExceptionItem } from "./data";
import {
  AttendancePage,
  type AttendanceTab,
  type RecordFilter,
} from "./AttendancePage";
import { SchedulePage } from "./SchedulePage";
import { PeoplePage } from "./PeoplePage";
import { PayrollPage } from "./PayrollPage";
import {
  apiRequest,
  ApiError,
  getCurrentUser,
  sessionStore,
  type SessionUser,
} from "./api";
import { LoginPage } from "./LoginPage";
import { SettingsPage } from "./SettingsPage";
import { EmployeePortal } from "./EmployeePortal";
import { LeavePage } from "./LeavePage";
import { AdvancedPage } from "./AdvancedPage";
import { NotificationCenter } from "./Notifications";
import { PageGuide, SetupChecklist, Toast, type SetupTarget } from "./Guidance";
import {
  fetchOperationsSnapshot,
  resolveAttendanceException,
  tashkentDate,
  type DashboardData,
} from "./operationsApi";
import { recordPunch } from "./workforceApi";
import { intlLocale, LanguageSwitcher, useI18n } from "./i18n";
import { TasksPage } from "./TasksPage";
import { WorkforceReport, WorkforceMetrics } from "./WorkforceReport";
import { BrandMark } from "./BrandMark";

const LiveLocationsMap = lazy(() =>
  import("./LiveLocationsMap").then((module) => ({
    default: module.LiveLocationsMap,
  })),
);

type Page =
  | "LiveLocations"
  | "Tasks"
  | "Reports"
  | "Overview"
  | "Attendance"
  | "Schedule"
  | "Leave"
  | "People"
  | "Payroll"
  | "Settings";

function RequiredPasswordChange({ onComplete }: { onComplete: () => void }) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 10) return setError(t("useTenCharacters"));
    if (newPassword !== confirmation) return setError(t("passwordsMismatch"));
    setSaving(true);
    setError("");
    try {
      await apiRequest("/auth/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onComplete();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("passwordChangeFailed"),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="drawer-scrim forced-password-scrim" />
      <form className="adjustment-modal forced-password" onSubmit={submit}>
        <div>
          <p className="eyebrow">{t("accountSecurity")}</p>
          <h2>{t("temporaryPasswordRequired")}</h2>
          <p className="modal-intro">{t("temporaryPasswordIntro")}</p>
        </div>
        <label className="form-field">
          <span>{t("temporaryPassword")}</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>{t("newPassword")}</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>{t("confirmNewPassword")}</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error && (
          <div className="schedule-error">
            <X size={15} />
            {error}
          </div>
        )}
        <button className="primary-button wide" disabled={saving}>
          <ShieldCheck size={17} />
          {saving ? t("changing") : t("changePassword")}
        </button>
      </form>
    </>
  );
}

// Each concept has exactly one icon so the same idea looks the same everywhere.
const navItems: Array<{ label: Page; icon: typeof Gauge }> = [
  { label: "Overview", icon: LayoutGrid },
  { label: "Attendance", icon: Clock3 },
  { label: "Schedule", icon: CalendarDays },
  { label: "LiveLocations", icon: MapPin },
  { label: "People", icon: UsersRound },
  { label: "Leave", icon: Inbox },
  { label: "Tasks", icon: ClipboardList },
  { label: "Payroll", icon: CircleDollarSign },
  { label: "Reports", icon: FileBarChart },
];

// Grouped by the job the manager is doing, not by how the features were built.
const navGroups: Array<{
  label: "dailyWork" | "management";
  items: Array<{ label: Page; icon: typeof Gauge }>;
}> = [
  {
    label: "dailyWork",
    items: ["Overview", "Attendance", "LiveLocations", "Tasks", "Schedule"].map(
      (label) => navItems.find((item) => item.label === label)!,
    ),
  },
  {
    label: "management",
    items: ["People", "Leave", "Payroll", "Reports"].map((label) =>
      navItems.find((item) => item.label === label)!,
    ),
  },
];

const pageSlugs: Record<Page, string> = {
  LiveLocations: "live-locations",
  Tasks: "tasks",
  Reports: "reports",
  Overview: "overview",
  Attendance: "attendance",
  Schedule: "schedule",
  Leave: "leave",
  People: "people",
  Payroll: "payroll",
  Settings: "settings",
};

// Old bookmarks keep working after the "Advanced" workspace was folded into
// Reports, Payroll, Requests, and Settings.
const legacySlugs: Record<string, Page> = { advanced: "Reports" };

function pageFromHash(): Page {
  const slug = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  return (
    (Object.keys(pageSlugs) as Page[]).find(
      (candidate) => pageSlugs[candidate] === slug,
    ) ??
    legacySlugs[slug] ??
    "Overview"
  );
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
  WEB: "webBrowser",
  MANUAL: "manual",
  QR: "qrCode",
  UNRECORDED: "noRecord",
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

function Avatar({
  initials,
  tone,
  small = false,
}: {
  initials: string;
  tone: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${tone} ${small ? "small" : ""}`}>{initials}</span>
  );
}

function Sidebar({
  page,
  onPageChange,
  open,
  onClose,
  exceptionCount,
  user,
  onLogout,
}: {
  page: Page;
  onPageChange: (page: Page) => void;
  open: boolean;
  onClose: () => void;
  exceptionCount: number;
  user: SessionUser;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand">
        <span className="brand-mark">
          <BrandMark />
        </span>
        <span>
          davomat<span className="brand-period">.</span>
        </span>
      </div>

      <nav className="nav-group" aria-label={t("mainNavigation")}>
        {navGroups.map((group) => (
          <div className="nav-section" key={group.label}>
            <p className="nav-title">{t(group.label)}</p>
            {group.items.map(({ label, icon: Icon }) => (
              <button
                className={`nav-item ${page === label ? "active" : ""}`}
                key={label}
                aria-current={page === label ? "page" : undefined}
                onClick={() => {
                  onPageChange(label);
                  onClose();
                }}
              >
                <Icon size={18} />
                <span>{t(label.toLowerCase())}</span>
                {label === "Attendance" && exceptionCount > 0 && (
                  <span className="nav-count">{exceptionCount}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button
          className={`nav-item ${page === "Settings" ? "active" : ""}`}
          aria-current={page === "Settings" ? "page" : undefined}
          onClick={() => {
            onPageChange("Settings");
            onClose();
          }}
        >
          <Settings size={18} />
          <span>{t("settings")}</span>
        </button>
        <div className="account">
          <Avatar
            initials={user.displayName
              .split(/\s+/)
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
            tone="navy"
            small
          />
          <div>
            <strong>{user.displayName}</strong>
            <span>{t(user.role.toLowerCase())}</span>
          </div>
          <button
            className="account-logout"
            onClick={onLogout}
            aria-label={t("signOut")}
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function Header({
  onMenu,
  page,
  companyName,
  query,
  onSearch,
  onNavigate,
  onNotification,
}: {
  onMenu: () => void;
  page: Page;
  companyName: string;
  query: string;
  onSearch: (value: string) => void;
  onNavigate: (page: Page) => void;
  onNotification: (action: string) => void;
}) {
  const { t, locale } = useI18n();
  const searchRef = useRef<HTMLInputElement>(null);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  return (
    <header className="topbar">
      <button
        className="icon-button mobile-menu"
        onClick={onMenu}
        aria-label={t("openMenu")}
      >
        <Menu size={20} />
      </button>
      <button
        className="company-switcher"
        onClick={() => onNavigate("Settings")}
        title={t("openCompanySettings")}
      >
        <span className="company-logo">
          {companyName
            .split(/\s+/)
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <div>
          <strong>{companyName}</strong>
          <span>{t("openCompanySettings")}</span>
        </div>
        <Settings size={16} aria-hidden="true" />
      </button>
      <label className="search-box">
        <Search size={17} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && query.trim()) onNavigate("People");
          }}
          placeholder={t("searchPeople")}
        />
        <kbd>{isMac ? "⌘ K" : "Ctrl K"}</kbd>
      </label>
      <div className="top-actions">
        <LanguageSwitcher compact />
        <NotificationCenter onAction={onNotification} />
        <button
          className="date-button"
          onClick={() => onNavigate("Attendance")}
          title={t("openTodayAttendance")}
        >
          <CalendarDays size={17} />
          <span>
            {new Intl.DateTimeFormat(intlLocale(locale), {
              month: "short",
              day: "numeric",
              year: "numeric",
            }).format(new Date())}
          </span>
        </button>
      </div>
    </header>
  );
}

function MobileNavigation({
  page,
  onNavigate,
  exceptionCount,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  exceptionCount: number;
}) {
  const { t } = useI18n();
  // The five things a manager does on a phone; everything else is in the menu.
  const items = [
    "Overview",
    "Attendance",
    "LiveLocations",
    "Tasks",
    "People",
  ].map((label) => navItems.find((item) => item.label === label)!);
  return (
    <nav className="mobile-navigation" aria-label={t("quickNavigation")}>
      {items.map(({ label, icon: Icon }) => (
        <button
          key={label}
          className={page === label ? "active" : ""}
          aria-current={page === label ? "page" : undefined}
          onClick={() => onNavigate(label)}
        >
          <Icon size={19} />
          <span>{t(label.toLowerCase())}</span>
          {label === "Attendance" && exceptionCount > 0 && (
            <i className="mobile-nav-badge" aria-hidden="true">
              {exceptionCount > 9 ? "9+" : exceptionCount}
            </i>
          )}
        </button>
      ))}
    </nav>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
  icon: typeof Clock3;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`metric-card metric-card-button metric-${tone}`}
      onClick={onClick}
    >
      <div className={`metric-icon ${tone}`}>
        <Icon size={19} />
      </div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </button>
  );
}

function AttendanceChart({
  data,
}: {
  data: DashboardData["weeklyAttendance"];
}) {
  const { t } = useI18n();
  const max = Math.max(
    1,
    ...data.map((item) => item.present + item.late + item.absent),
  );
  return (
    <section className="panel chart-panel">
      <div className="panel-header">
        <div>
          <h2>{t("weeklyAttendance")}</h2>
          <p>{t("presenceLocations")}</p>
        </div>
        <div className="legend">
          <span>
            <i className="present" />
            {t("present")}
          </span>
          <span>
            <i className="late" />
            {t("late")}
          </span>
          <span>
            <i className="absent" />
            {t("absent")}
          </span>
        </div>
      </div>
      <div className="chart">
        <div className="axis-lines">
          <span />
          <span />
          <span />
          <span />
        </div>
        {data.map((item) => (
          <div className="bar-column" key={item.day}>
            <div
              className="bar-stack"
              title={t("attendanceChartSummary", {
                present: item.present,
                late: item.late,
                absent: item.absent,
              })}
            >
              <span
                className="bar absent"
                style={{ height: `${(item.absent / max) * 100}%` }}
              />
              <span
                className="bar late"
                style={{ height: `${(item.late / max) * 100}%` }}
              />
              <span
                className="bar present"
                style={{ height: `${(item.present / max) * 100}%` }}
              />
            </div>
            <span>{t(item.day.toLowerCase())}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Exceptions({
  items,
  onReview,
}: {
  items: ExceptionItem[];
  onReview: (id: string | number) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="panel exceptions-panel">
      <div className="panel-header">
        <div>
          <h2>{t("needsAttentionTitle")}</h2>
          <p>{t("resolveBeforePayroll")}</p>
        </div>
        <span className="count-pill">{items.length}</span>
      </div>
      <div className="exception-list">
        {items.length === 0 ? (
          <div className="empty-state">
            <span>
              <Check size={22} />
            </span>
            <strong>{t("everythingClear")}</strong>
            <p>{t("noAttendanceExceptions")}</p>
          </div>
        ) : (
          items.slice(0, 3).map((item) => (
            <article className="exception-item" key={item.id}>
              <Avatar initials={item.initials} tone={item.tone} small />
              <div className="exception-copy">
                <div>
                  <strong>
                    {t(
                      exceptionTitleTranslationKey[item.type ?? ""] ??
                        item.title,
                    )}
                  </strong>
                  <span className={`severity ${item.severity}`} />
                </div>
                <p>{item.employee}</p>
                <small>
                  {exceptionDetailTranslationKey[item.type ?? ""]
                    ? t(exceptionDetailTranslationKey[item.type ?? ""])
                    : item.detail}
                </small>
              </div>
              <div className="exception-action">
                <time>{item.time}</time>
                <button onClick={() => onReview(item.id)}>{t("review")}</button>
              </div>
            </article>
          ))
        )}
      </div>
      {items.length > 0 && (
        <button
          className="text-button full"
          onClick={() => onReview(items[0].id)}
        >
          {t("viewExceptionInbox")} <span>→</span>
        </button>
      )}
    </section>
  );
}

function LiveAttendance({
  records,
  loading,
  onViewAll,
}: {
  records: EmployeeRow[];
  loading: boolean;
  onViewAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const { t } = useI18n();
  const filtered = useMemo(
    () =>
      records.filter((employee) =>
        `${employee.name} ${employee.branch} ${employee.role}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query, records],
  );
  const exportAttendance = () => {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      [
        t("employee"),
        t("role"),
        t("location"),
        t("shift"),
        t("clockIn"),
        t("clockOut"),
        t("worked"),
        t("source"),
        t("status"),
      ],
      ...filtered.map((employee) => [
        employee.name,
        employee.role,
        employee.branch || t("unassigned"),
        employee.shift || t("notScheduled"),
        employee.clockIn,
        employee.clockOut,
        employee.worked,
        t(sourceTranslationKey[employee.source]),
        t(statusTranslationKey[employee.status]),
      ]),
    ];
    const blob = new Blob(
      [rows.map((row) => row.map(quote).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "atlas-attendance.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <section className="panel attendance-panel">
      <div className="panel-header table-heading">
        <div>
          <h2>{t("liveAttendance")}</h2>
          <p>{t("updatedRecently")}</p>
        </div>
        <div className="table-actions">
          <label className="mini-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("findEmployee")}
            />
          </label>
          <button className="secondary-button" onClick={exportAttendance}>
            <Download size={16} />
            {t("export")}
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("employee")}</th>
              <th>{t("location")}</th>
              <th>{t("shift")}</th>
              <th>{t("clockIn")}</th>
              <th>{t("worked")}</th>
              <th>{t("source")}</th>
              <th>{t("status")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}>{t("loadingLiveAttendance")}</td>
              </tr>
            ) : (
              filtered.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <div className="employee-cell">
                      <Avatar
                        initials={employee.initials}
                        tone={employee.tone}
                        small
                      />
                      <div>
                        <strong>{employee.name}</strong>
                        <span>{employee.role}</span>
                      </div>
                    </div>
                  </td>
                  <td>{employee.branch || t("unassigned")}</td>
                  <td>{employee.shift || t("notScheduled")}</td>
                  <td className="mono">{employee.clockIn}</td>
                  <td className="mono">{employee.worked}</td>
                  <td>
                    <span className="source">
                      <ShieldCheck size={14} />
                      {t(sourceTranslationKey[employee.source])}
                    </span>
                  </td>
                  <td>
                    <span className={`status ${employee.status.toLowerCase()}`}>
                      <i />
                      {t(statusTranslationKey[employee.status])}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>
          {t("showingEmployees", {
            shown: filtered.length,
            total: records.length,
          })}
        </span>
        <button className="text-button" onClick={onViewAll}>
          {t("viewAllAttendance")} <span>→</span>
        </button>
      </div>
    </section>
  );
}

function Overview({
  dashboard,
  records,
  exceptions,
  loading,
  error,
  user,
  onRetry,
  onReview,
  onPeople,
  onAttendance,
  onTasks,
  onLiveLocations,
  onSetup,
}: {
  dashboard: DashboardData;
  records: EmployeeRow[];
  exceptions: ExceptionItem[];
  loading: boolean;
  error: string;
  user: SessionUser;
  onRetry: () => void;
  onReview: (id: string | number) => void;
  onPeople: () => void;
  onAttendance: (filter?: RecordFilter) => void;
  onTasks: () => void;
  onLiveLocations: () => void;
  onSetup: (target: SetupTarget) => void;
}) {
  const { t } = useI18n();
  const workingPercent =
    dashboard.activeEmployees > 0
      ? Math.round((dashboard.workingToday / dashboard.activeEmployees) * 100)
      : 0;
  return (
    <div className="operations-overview">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">{t("todayOperations")}</p>
          <h1>{t("greeting", { name: user.displayName.split(" ")[0] })}</h1>
          <p>{t("overviewDescription")}</p>
        </div>
        <div className="overview-heading-actions">
          <button
            className="primary-button"
            onClick={() =>
              exceptions.length ? onReview(exceptions[0].id) : onAttendance()
            }
          >
            <ShieldCheck size={17} />
            {exceptions.length
              ? t("reviewIssuesCount", { count: exceptions.length })
              : t("reviewTodayAttendance")}
          </button>
          <button className="secondary-button" onClick={onPeople}>
            <UserRoundCheck size={17} />
            {t("addEmployee")}
          </button>
        </div>
      </div>
      {error && (
        <div className="operations-error">
          <X size={17} />
          <span>{error}</span>
          <button onClick={onRetry}>{t("tryAgain")}</button>
        </div>
      )}
      <SetupChecklist onOpen={onSetup} />
      <section className="admin-start panel" aria-label={t("commonTasks")}>
        <div>
          <span>{t("startHere")}</span>
          <strong>{t("commonTasks")}</strong>
        </div>
        <button onClick={() => onAttendance()}>
          <Clock3 size={18} />
          <span>
            <strong>{t("checkAttendance")}</strong>
            <small>{t("checkAttendanceHelp")}</small>
          </span>
        </button>
        <button onClick={onLiveLocations}>
          <MapPin size={18} />
          <span>
            <strong>{t("locateTeam")}</strong>
            <small>{t("locateTeamHelp")}</small>
          </span>
        </button>
        <button onClick={onTasks}>
          <ClipboardList size={18} />
          <span>
            <strong>{t("assignTask")}</strong>
            <small>{t("assignTaskHelp")}</small>
          </span>
        </button>
      </section>
      <section className="metrics-grid">
        <MetricCard
          label={t("currentlyWorking")}
          value={loading ? "—" : dashboard.workingToday.toString()}
          note={t("workingOfTotal", {
            count: workingPercent,
            total: dashboard.activeEmployees,
          })}
          tone="mint"
          icon={UserRoundCheck}
          onClick={() => onAttendance("working")}
        />
        <MetricCard
          label={t("lateArrivals")}
          value={loading ? "—" : dashboard.lateToday.toString()}
          note={t("pastGracePeriod")}
          tone="sand"
          icon={Clock3}
          onClick={() => onAttendance("late")}
        />
        <MetricCard
          label={t("absentToday")}
          value={loading ? "—" : dashboard.absentToday.toString()}
          note={t("approvedLeaveCount", { count: dashboard.approvedLeave })}
          tone="rose"
          icon={UsersRound}
          onClick={() => onAttendance("absent")}
        />
        <MetricCard
          label={t("openExceptions")}
          value={exceptions.length.toString()}
          note={t("requiresManagerReview")}
          tone="lavender"
          icon={ShieldCheck}
          onClick={() => onReview(exceptions[0]?.id ?? 0)}
        />
      </section>
      <div className="dashboard-grid">
        <AttendanceChart data={dashboard.weeklyAttendance} />
        <Exceptions items={exceptions} onReview={onReview} />
      </div>
      <LiveAttendance
        records={records}
        loading={loading}
        onViewAll={onAttendance}
      />
    </div>
  );
}

function ReportsPage() {
  const { t } = useI18n();
  return (
    <div className="reports-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("workspace")}</p>
          <h1>{t("reports")}</h1>
          <p>{t("reportsDescription")}</p>
        </div>
      </div>
      <PageGuide
        id="reports"
        steps={[t("guideReports1"), t("guideReports2"), t("guideReports3")]}
      />
      <WorkforceMetrics />
      <WorkforceReport />
      <AdvancedPage section="reports" />
    </div>
  );
}

function WorkspaceApp({
  user,
  onLogout,
  onUserChange,
}: {
  user: SessionUser;
  onLogout: () => void;
  onUserChange: (user: SessionUser) => void;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<Page>(() => pageFromHash());
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [attendanceTab, setAttendanceTab] = useState<AttendanceTab>("records");
  const [attendanceFilter, setAttendanceFilter] = useState<RecordFilter>("all");
  const openAttendance = (filter: RecordFilter = "all") => {
    setAttendanceTab("records");
    setAttendanceFilter(filter);
    setPage("Attendance");
  };
  const [attendanceDate, setAttendanceDate] = useState(() => tashkentDate());
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const [attendance, setAttendance] = useState<EmployeeRow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData>({
    activeEmployees: 0,
    workingToday: 0,
    lateToday: 0,
    absentToday: 0,
    approvedLeave: 0,
    openExceptions: 0,
    payrollReviews: 0,
    weeklyAttendance: [],
  });
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [operationsError, setOperationsError] = useState("");
  const [resolutionToast, setResolutionToast] = useState<string | null>(null);
  const [peopleAddRequest, setPeopleAddRequest] = useState(0);
  const [scheduleEmployeeId, setScheduleEmployeeId] = useState<string>();
  const [peopleEmployeeId, setPeopleEmployeeId] = useState<string>();
  const [liveEmployeeId, setLiveEmployeeId] = useState<string>();
  const [liveEmployeeName, setLiveEmployeeName] = useState("");
  const [settingsSection, setSettingsSection] = useState<string>();
  const openEmployeeSchedule = (id?: string) => {
    setScheduleEmployeeId(id);
    setPage("Schedule");
  };
  const openEmployee = (id: string) => {
    setPeopleEmployeeId(id);
    setPage("People");
  };
  const openLiveLocations = (id?: string, name = "") => {
    setLiveEmployeeId(id);
    setLiveEmployeeName(name);
    setPage("LiveLocations");
  };
  const navigate = (next: Page) => {
    setPeopleEmployeeId(undefined);
    setScheduleEmployeeId(undefined);
    setLiveEmployeeId(undefined);
    setSettingsSection(undefined);
    setPage(next);
  };
  const openSetupStep = (target: SetupTarget) => {
    if (target === "People") {
      setPeopleAddRequest((current) => current + 1);
      setPage("People");
      return;
    }
    if (target === "Schedule") return navigate("Schedule");
    navigate("Settings");
    setSettingsSection(
      target === "Devices" ? "settings-devices" : "settings-locations",
    );
  };

  useEffect(() => {
    const syncFromAddress = () => setPage(pageFromHash());
    window.addEventListener("hashchange", syncFromAddress);
    return () => window.removeEventListener("hashchange", syncFromAddress);
  }, []);

  useEffect(() => {
    const nextHash = `#/${pageSlugs[page]}`;
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
    document.title = `${t(page.toLowerCase())} · davomat`;
  }, [page, t]);

  useEffect(() => {
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeMenu);
    return () => window.removeEventListener("keydown", closeMenu);
  }, []);

  const refreshOperations = async () => {
    setOperationsLoading(true);
    setOperationsError("");
    try {
      const snapshot = await fetchOperationsSnapshot(
        page === "Attendance" ? attendanceDate : tashkentDate(),
      );
      setDashboard(snapshot.dashboard);
      setAttendance(snapshot.attendance);
      setExceptions(snapshot.exceptions);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return onLogout();
      setOperationsError(
        error instanceof Error ? error.message : t("loadOperationsFailed"),
      );
    } finally {
      setOperationsLoading(false);
    }
  };

  useEffect(() => {
    if (page === "Overview" || page === "Attendance") refreshOperations();
  }, [page, attendanceDate]);

  useEffect(() => {
    const refresh = () => void refreshOperations();
    window.addEventListener("atlas:attendance-changed", refresh);
    return () =>
      window.removeEventListener("atlas:attendance-changed", refresh);
  }, [page, attendanceDate]);

  const resolveException = async (
    id: string | number,
    resolution: "approved" | "rejected",
    managerNote: string,
  ) => {
    const result = await resolveAttendanceException(
      id,
      resolution,
      managerNote,
    );
    setExceptions((current) => current.filter((item) => item.id !== id));
    setDashboard((current) => ({
      ...current,
      openExceptions: Math.max(0, current.openExceptions - 1),
    }));
    setResolutionToast(
      resolution === "approved"
        ? result.appliedPunchId
          ? t("correctionApprovedTimesheet")
          : t("exceptionApprovedAudit")
        : t("exceptionRejectedAudit"),
    );
    window.setTimeout(() => setResolutionToast(null), 5000);
  };
  const reviewException = (_id: string | number) => {
    setAttendanceTab("exceptions");
    setPage("Attendance");
  };
  const addPunch = async (input: {
    employeeId: string;
    eventType: "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
    occurredAt: string;
    note?: string;
  }) => {
    await recordPunch(input);
    await refreshOperations();
    setResolutionToast(t("clockEventRecordedRefreshed"));
    window.setTimeout(() => setResolutionToast(null), 5000);
  };
  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        onPageChange={navigate}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        exceptionCount={exceptions.length}
        user={user}
        onLogout={onLogout}
      />
      {menuOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setMenuOpen(false)}
          aria-label={t("closeMenu")}
        />
      )}
      <div className="content-shell">
        <Header
          onMenu={() => setMenuOpen(true)}
          page={page}
          companyName={user.company.name}
          query={globalSearch}
          onSearch={setGlobalSearch}
          onNotification={(action) => {
            // Attendance notifications are always about an open issue.
            if (action === "Attendance") {
              setAttendanceDate(tashkentDate());
              return reviewException(0);
            }
            navigate(action as Page);
          }}
          onNavigate={(next) => {
            if (next === "Attendance") setAttendanceDate(tashkentDate());
            navigate(next);
          }}
        />
        <main id="main-content" tabIndex={-1}>
          {page === "Overview" && (
            <Overview
              dashboard={dashboard}
              records={attendance}
              exceptions={exceptions}
              loading={operationsLoading}
              error={operationsError}
              user={user}
              onRetry={refreshOperations}
              onReview={reviewException}
              onPeople={() => {
                setPeopleAddRequest((current) => current + 1);
                setPage("People");
              }}
              onAttendance={openAttendance}
              onTasks={() => navigate("Tasks")}
              onLiveLocations={() => navigate("LiveLocations")}
              onSetup={openSetupStep}
            />
          )}
          {page === "Attendance" && (
            <AttendancePage
              date={attendanceDate}
              onDateChange={setAttendanceDate}
              exceptions={exceptions}
              records={attendance}
              loading={operationsLoading}
              tab={attendanceTab}
              onTabChange={setAttendanceTab}
              filter={attendanceFilter}
              onFilterChange={setAttendanceFilter}
              onResolve={resolveException}
              onRecordPunch={addPunch}
            />
          )}
          {page === "LiveLocations" && (
            <Suspense fallback={<p>{t("loading")}</p>}>
              {liveEmployeeId && (
                <div className="filter-summary">
                  <strong>{liveEmployeeName}</strong>
                  <button
                    className="secondary-button"
                    onClick={() => setLiveEmployeeId(undefined)}
                  >
                    {t("showAllEmployees")}
                  </button>
                </div>
              )}
              <LiveLocationsMap
                standalone
                employeeId={liveEmployeeId}
                onOpenSchedule={openEmployeeSchedule}
                onOpenEmployee={openEmployee}
              />
            </Suspense>
          )}
          {page === "Schedule" && (
            <SchedulePage initialEmployeeId={scheduleEmployeeId} />
          )}
          {page === "Tasks" && <TasksPage timeZone={user.company.timezone} />}
          {page === "Reports" && <ReportsPage />}
          {page === "Leave" && <LeavePage />}
          {page === "People" && (
            <PeoplePage
              companyName={user.company.name}
              initialQuery={globalSearch}
              openAddRequest={peopleAddRequest}
              initialEmployeeId={peopleEmployeeId}
              onOpenSchedule={openEmployeeSchedule}
              onOpenLiveLocations={openLiveLocations}
            />
          )}
          {page === "Payroll" && (
            <PayrollPage onOpenAttendance={() => openAttendance()} />
          )}
          {page === "Settings" && (
            <SettingsPage
              user={user}
              focusSection={settingsSection}
              onCompanyUpdated={(name) =>
                onUserChange({ ...user, company: { ...user.company, name } })
              }
            />
          )}
        </main>
      </div>
      <MobileNavigation
        page={page}
        onNavigate={navigate}
        exceptionCount={exceptions.length}
      />
      <Toast
        message={resolutionToast}
        onDismiss={() => setResolutionToast(null)}
      />
    </div>
  );
}

export function App() {
  const { t } = useI18n();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionStore.getToken()));

  useEffect(() => {
    if (!sessionStore.getToken()) return;
    getCurrentUser()
      .then(setUser)
      .catch(() => sessionStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    sessionStore.clear();
    setUser(null);
  };
  if (loading)
    return (
      <div className="app-loading">
        <span>
          <BrandMark size={32} />
        </span>
        <p>{t("openingAtlas")}</p>
      </div>
    );
  if (!user) return <LoginPage onAuthenticated={setUser} />;
  if (user.mustChangePassword)
    return <RequiredPasswordChange onComplete={logout} />;
  if (user.role === "EMPLOYEE")
    return <EmployeePortal user={user} onLogout={logout} />;
  return <WorkspaceApp user={user} onLogout={logout} onUserChange={setUser} />;
}
