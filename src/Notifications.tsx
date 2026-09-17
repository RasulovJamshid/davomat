import { useEffect, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { apiRequest } from "./api";
import { intlLocale, useI18n } from "./i18n";

interface Notice {
  key: string;
  title: string;
  body: string;
  createdAt: string;
  action: string;
  read: boolean;
  /** Machine-readable type; the server sends it alongside the English title. */
  kind?: string;
  meta?: Record<string, string | null> | null;
}

const kindTitleKey: Record<string, string> = {
  leave_submitted: "leaveRequestSubmitted",
  leave_approved: "leaveApproved",
  leave_declined: "leaveRequestDeclined",
  correction_pending: "correctionAwaitingReview",
  correction_approved: "timeCorrectionApproved",
  correction_declined: "timeCorrectionDeclined",
  shift_upcoming: "upcomingShift",
  attendance_issue: "attendanceException",
  leave_request: "leaveRequest",
  payroll_review: "payrollNeedsReview",
};
// Fallback for servers that only send the English title.
const legacyTitleKey: Record<string, string> = {
  "Leave request submitted": "leaveRequestSubmitted",
  "Leave approved": "leaveApproved",
  "Leave request declined": "leaveRequestDeclined",
  "Correction awaiting review": "correctionAwaitingReview",
  "Time correction approved": "timeCorrectionApproved",
  "Time correction declined": "timeCorrectionDeclined",
  "Upcoming shift": "upcomingShift",
  "Attendance exception": "attendanceException",
  "Leave request": "leaveRequest",
  "Payroll needs review": "payrollNeedsReview",
};
const issueKey: Record<string, string> = {
  OUTSIDE_GEOFENCE: "outsideGeofence",
  LATE: "lateArrival",
  MISSING_CLOCK_OUT: "missingClockOut",
  MISSING_CLOCK_IN: "missingClockIn",
  OVERTIME: "overtimeApproval",
  CORRECTION_REQUEST: "correctionRequest",
};

export function NotificationCenter({
  onAction,
  employee = false,
}: {
  onAction?: (action: string) => void;
  employee?: boolean;
}) {
  const { t, locale } = useI18n();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    try {
      setNotices(await apiRequest<Notice[]>("/notifications"));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("loadNotificationsFailed"),
      );
    }
  };
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const unread = notices.filter((item) => !item.read).length;
  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const localizedTitle = (item: Notice) =>
    t(
      (item.kind && kindTitleKey[item.kind]) ??
        legacyTitleKey[item.title] ??
        item.title,
    );
  const localizedBody = (item: Notice) => {
    const meta = item.meta ?? {};
    const kind = item.kind ?? item.key.split(":")[0];
    switch (kind) {
      case "shift_upcoming":
      case "shift":
        return t("upcomingShiftBody", {
          location: meta.location ?? t("workLocation"),
          date: formatDateTime(meta.startsAt ?? item.createdAt),
        });
      case "leave_submitted":
      case "leave_approved":
      case "leave_declined":
        return t("leaveDates", {
          start: meta.startsOn ?? "",
          end: meta.endsOn ?? "",
        });
      case "leave_request":
        return t("employeeLeaveDates", {
          employee: meta.employee ?? "",
          start: meta.startsOn ?? "",
          end: meta.endsOn ?? "",
        });
      case "payroll_review":
      case "payroll":
        return t("employeeAttendanceIssue", {
          employee: meta.employee ?? item.body.split(" · ")[0],
        });
      case "attendance_issue":
      case "exception":
        return t("employeeIssue", {
          employee: meta.employee ?? item.body.split(" · ")[0],
          issue: t(issueKey[meta.issueType ?? ""] ?? item.body),
        });
      case "correction_pending":
      case "correction_approved":
      case "correction_declined":
        return meta.details ?? item.body;
      default:
        return item.body;
    }
  };
  const markRead = async (keys: string[]) => {
    if (!keys.length) return;
    await apiRequest("/notifications/read", {
      method: "POST",
      body: JSON.stringify({ keys }),
    });
    setNotices((current) =>
      current.map((item) =>
        keys.includes(item.key) ? { ...item, read: true } : item,
      ),
    );
  };
  const select = async (item: Notice) => {
    if (!item.read) await markRead([item.key]);
    setOpen(false);
    onAction?.(item.action);
  };
  return (
    <div
      className={`notification-center ${employee ? "employee-notifications" : ""}`}
    >
      <button
        className="icon-button notification-trigger"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void load();
        }}
        aria-label={t("unreadNotifications", { count: unread })}
      >
        <Bell size={19} />
        {unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <button
            className="notification-scrim"
            onClick={() => setOpen(false)}
            aria-label={t("closeNotifications")}
          />
          <aside className="notification-drawer">
            <div className="notification-heading">
              <div>
                <h2>{t("notifications")}</h2>
                <p>{t("unread", { count: unread })}</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label={t("close")}>
                <X size={18} />
              </button>
            </div>
            {error && <div className="notification-error">{error}</div>}
            <div className="notification-list">
              {notices.length === 0 ? (
                <div className="notification-empty">
                  <Check size={22} />
                  <strong>{t("caughtUp")}</strong>
                  <p>{t("newActivity")}</p>
                </div>
              ) : (
                notices.map((item) => (
                  <button
                    className={item.read ? "read" : ""}
                    key={item.key}
                    onClick={() => void select(item)}
                  >
                    <i />
                    <span>
                      <strong>{localizedTitle(item)}</strong>
                      <p>{localizedBody(item)}</p>
                      <time>{formatDateTime(item.createdAt)}</time>
                    </span>
                  </button>
                ))
              )}
            </div>
            {unread > 0 && (
              <button
                className="mark-read"
                onClick={() =>
                  void markRead(
                    notices
                      .filter((item) => !item.read)
                      .map((item) => item.key),
                  )
                }
              >
                {t("markAllRead")}
              </button>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
