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
}

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
  const titleKeys: Record<string, string> = {
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
  const localizedTitle = (item: Notice) =>
    t(titleKeys[item.title] ?? item.title);
  const localizedBody = (item: Notice) => {
    if (item.key.startsWith("shift:")) {
      const location = item.body.split(" · ")[0];
      return t("upcomingShiftBody", {
        location: location === "Work location" ? t("workLocation") : location,
        date: new Intl.DateTimeFormat(intlLocale(locale), {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(item.createdAt)),
      });
    }
    if (item.key.startsWith("leave:")) {
      const [prefix, end] = item.body.split(" to ");
      const parts = prefix.split(" · ");
      const start = parts.at(-1) ?? prefix;
      return parts.length > 1
        ? t("employeeLeaveDates", { employee: parts[0], start, end: end ?? "" })
        : t("leaveDates", { start, end: end ?? "" });
    }
    if (item.key.startsWith("payroll:")) {
      return t("employeeAttendanceIssue", {
        employee: item.body.split(" · ")[0],
      });
    }
    if (item.key.startsWith("exception:")) {
      const [employee, issue = ""] = item.body.split(" · ");
      const issueKey = issue.replaceAll(" ", "_").toUpperCase();
      const keys: Record<string, string> = {
        OUTSIDE_GEOFENCE: "outsideGeofence",
        LATE: "lateArrival",
        MISSING_CLOCK_OUT: "missingClockOut",
        MISSING_CLOCK_IN: "missingClockIn",
        OVERTIME: "overtimeApproval",
        CORRECTION_REQUEST: "correctionRequest",
      };
      return t("employeeIssue", {
        employee,
        issue: t(keys[issueKey] ?? issue),
      });
    }
    return item.body;
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
                      <time>
                        {new Intl.DateTimeFormat(intlLocale(locale), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(item.createdAt))}
                      </time>
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
