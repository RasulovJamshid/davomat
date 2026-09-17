import { useEffect, useMemo, useState } from "react";
import {
  CalendarCheck,
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  Search,
  ShieldAlert,
  UserRoundCheck,
  X,
} from "lucide-react";
import { fetchLeaves, resolveLeave, type ApiLeave } from "./workforceApi";
import { intlLocale, useI18n } from "./i18n";
import { AdvancedPage } from "./AdvancedPage";
import { PageGuide } from "./Guidance";

const leaveKeys = {
  ANNUAL: "annualLeave",
  SICK: "sickLeave",
  UNPAID: "unpaidLeave",
  OTHER: "otherLeave",
} as const;
const statusKeys = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
} as const;

function LeaveCard({
  leave,
  onResolved,
}: {
  leave: ApiLeave;
  onResolved: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const dateFormat = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const resolve = async (status: "APPROVED" | "REJECTED") => {
    if (note.trim().length < 3) return setError(t("managerNoteMinimum"));
    setSaving(true);
    setError("");
    try {
      await resolveLeave(leave.id, status, note.trim());
      await onResolved();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("resolveLeaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <article className="leave-card">
      <div className="leave-card-main">
        <span className="leave-avatar">
          {leave.employee
            .split(/\s+/)
            .map((part) => part[0])
            .join("")
            .slice(0, 2)}
        </span>
        <div className="leave-person">
          <strong>{leave.employee}</strong>
          <p>
            {leave.jobTitle} · {leave.location ?? t("unassigned")}
          </p>
        </div>
        <span className={`leave-status ${leave.status.toLowerCase()}`}>
          {t(statusKeys[leave.status])}
        </span>
      </div>
      <div className="leave-details">
        <div>
          <CalendarDays size={17} />
          <span>
            <strong>
              {dateFormat.format(
                new Date(`${leave.startsOn.slice(0, 10)}T00:00:00Z`),
              )}{" "}
              –{" "}
              {dateFormat.format(
                new Date(`${leave.endsOn.slice(0, 10)}T00:00:00Z`),
              )}
            </strong>
            {t("workingDays", { count: leave.days })} ·{" "}
            {t(leaveKeys[leave.leaveType])}
          </span>
        </div>
        {leave.shiftConflicts > 0 && (
          <div className="leave-conflict">
            <ShieldAlert size={17} />
            <span>
              <strong>
                {t("scheduledShifts", { count: leave.shiftConflicts })}
              </strong>
              {t("coverageReassign")}
            </span>
          </div>
        )}
        <blockquote>{leave.reason}</blockquote>
      </div>
      {leave.status === "PENDING" ? (
        <div className="leave-review">
          <label>
            <span>{t("managerNote")}</span>
            <input
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setError("");
              }}
              placeholder={t("decisionNote")}
            />
          </label>
          {error && (
            <p>
              <X size={15} />
              {error}
            </p>
          )}
          <div>
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => void resolve("REJECTED")}
            >
              <X size={16} />
              {t("reject")}
            </button>
            <button
              className="primary-button"
              disabled={saving}
              onClick={() => void resolve("APPROVED")}
            >
              <Check size={16} />
              {t("approveLeave")}
            </button>
          </div>
        </div>
      ) : (
        leave.managerNote && (
          <div className="leave-decision">
            <UserRoundCheck size={16} />
            <span>
              <strong>{t("managerDecision")}</strong>
              {leave.managerNote}
            </span>
          </div>
        )
      )}
    </article>
  );
}

export function LeavePage() {
  const { t } = useI18n();
  const [leaves, setLeaves] = useState<ApiLeave[]>([]);
  const [filter, setFilter] = useState<"ALL" | ApiLeave["status"]>("PENDING");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const load = async () => {
    setError("");
    try {
      setLeaves(await fetchLeaves());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("loadLeavesFailed"),
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const visible = useMemo(
    () =>
      leaves.filter(
        (leave) =>
          (filter === "ALL" || leave.status === filter) &&
          `${leave.employee} ${leave.jobTitle} ${leave.location} ${leave.leaveType}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [leaves, filter, query],
  );
  const resolved = async () => {
    await load();
    setToast(t("leaveDecisionSaved"));
    window.setTimeout(() => setToast(""), 2500);
  };
  return (
    <div className="leave-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("workspace")}</p>
          <h1>{t("leave")}</h1>
          <p>{t("leaveDescription")}</p>
        </div>
      </div>
      <PageGuide
        id="requests"
        steps={[t("guideRequests1"), t("guideRequests2"), t("guideRequests3")]}
      />
      <section className="leave-stats">
        <article>
          <span>
            <Clock3 size={19} />
          </span>
          <div>
            <strong>
              {leaves.filter((item) => item.status === "PENDING").length}
            </strong>
            <small>{t("awaitingReview")}</small>
          </div>
        </article>
        <article>
          <span>
            <CalendarCheck size={19} />
          </span>
          <div>
            <strong>
              {leaves.filter((item) => item.status === "APPROVED").length}
            </strong>
            <small>{t("approvedRequests")}</small>
          </div>
        </article>
        <article>
          <span>
            <ShieldAlert size={19} />
          </span>
          <div>
            <strong>
              {
                leaves.filter(
                  (item) =>
                    item.status === "PENDING" && item.shiftConflicts > 0,
                ).length
              }
            </strong>
            <small>{t("coverageConflicts")}</small>
          </div>
        </article>
      </section>
      <section className="panel leave-workspace">
        <div className="leave-toolbar">
          <label className="workspace-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchEmployeesLocations")}
            />
          </label>
          <div>
            {(["PENDING", "APPROVED", "REJECTED", "ALL"] as const).map(
              (item) => (
                <button
                  className={filter === item ? "active" : ""}
                  onClick={() => setFilter(item)}
                  key={item}
                >
                  {item === "ALL" ? t("all") : t(statusKeys[item])}
                </button>
              ),
            )}
          </div>
        </div>
        {error && (
          <div className="operations-error">
            <X size={16} />
            <span>{error}</span>
            <button onClick={() => void load()}>{t("retry")}</button>
          </div>
        )}
        <div className="leave-list">
          {loading ? (
            <div className="leave-empty">{t("loadingLeaves")}</div>
          ) : visible.length === 0 ? (
            <div className="leave-empty">
              <CalendarCheck size={25} />
              <strong>{t("noMatchingRequests")}</strong>
              <p>{t("newLeaveHere")}</p>
            </div>
          ) : (
            visible.map((leave) => (
              <LeaveCard key={leave.id} leave={leave} onResolved={resolved} />
            ))
          )}
        </div>
      </section>
      <AdvancedPage section="swaps" />
      <div className={`toast ${toast ? "visible" : ""}`}>
        <Check size={17} />
        {toast}
      </div>
    </div>
  );
}
