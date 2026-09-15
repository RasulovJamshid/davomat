import { useEffect, useState } from "react";
import { apiRequest } from "./api";
import { useI18n } from "./i18n";
import { tashkentDate } from "./operationsApi";
export interface WorkforceSummary {
  employeeId: string;
  employee: string;
  salaryType: string;
  scheduledDays: number;
  workedDays: number;
  expectedMinutes: number;
  workedMinutes: number;
  lateDays: number;
  absentDays: number;
  overtimeMinutes: number;
  completedTasks: number;
  salary: number;
  currency: string;
}
export const hours = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(Math.floor(minutes % 60)).padStart(2, "0")}`;
export function WorkforceReport({
  employeeId,
  employee = false,
}: {
  employeeId?: string;
  employee?: boolean;
}) {
  const { t } = useI18n();
  const today = tashkentDate();
  const [from, setFrom] = useState(today.slice(0, 7) + "-01");
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<WorkforceSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    if (!from || !to || from > to) {
      setRows([]);
      setError(t("invalidReportPeriod"));
      setLoading(false);
      return;
    }
    apiRequest<WorkforceSummary[]>(
      `/workforce-summary?from=${from}&to=${to}${employeeId ? `&employeeId=${employeeId}` : ""}`,
    )
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) {
          setRows([]);
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, employeeId, retry]);
  const columns = [
    "employee",
    "scheduledDays",
    "workedDays",
    "expectedHours",
    "workedHours",
    "lateArrivals",
    "absences",
    "overtime",
    "completedTasks",
    "calculatedSalary",
  ];
  const values = (r: WorkforceSummary) => [
    r.employee,
    r.scheduledDays,
    r.workedDays,
    hours(r.expectedMinutes),
    hours(r.workedMinutes),
    r.lateDays,
    r.absentDays,
    hours(r.overtimeMinutes),
    r.completedTasks,
    `${r.salary.toLocaleString()} ${r.currency}`,
  ];
  const download = () => {
    const quote = (v: unknown) =>
      `"${String(v)
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`;
    const blob = new Blob(
      [
        "\uFEFF",
        [columns.map((c) => t(c)), ...rows.map(values)]
          .map((row) => row.map(quote).join(","))
          .join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workforce-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="panel workforce-report">
      <div className="page-heading-row">
        <h2>{t(employee ? "myWorkHours" : "workforceReport")}</h2>
        <div className="table-actions no-print">
          <button
            className="secondary-button"
            disabled={loading || !rows.length}
            onClick={download}
          >
            {t("exportExcelCsv")}
          </button>
          <button
            className="secondary-button"
            disabled={loading || !rows.length}
            onClick={() => window.print()}
          >
            {t("printPdf")}
          </button>
        </div>
      </div>
      <div className="workforce-fields no-print">
        <label className="form-field">
          <span>{t("reportFrom")}</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span>{t("reportTo")}</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="secondary-button"
          onClick={() => {
            setFrom(today);
            setTo(today);
          }}
        >
          {t("today")}
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            const d = new Date(today + "T12:00:00Z");
            d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
            setFrom(d.toISOString().slice(0, 10));
            setTo(today);
          }}
        >
          {t("thisWeek")}
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            setFrom(today.slice(0, 7) + "-01");
            setTo(today);
          }}
        >
          {t("thisMonth")}
        </button>
      </div>
      <p>
        {from} — {to}
      </p>
      <p>{t("salaryEstimateHelp")}</p>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setRetry((r) => r + 1)}>{t("retry")}</button>
        </p>
      )}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{t(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  {values(r).map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              ))}
              {!rows.length && !error && (
                <tr>
                  <td colSpan={columns.length}>{t("noRecords")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function WorkforceMetrics() {
  const { t } = useI18n();
  const [data, setData] = useState<{
    rows: WorkforceSummary[];
    active: number;
    done: number;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const day = tashkentDate();
    Promise.all([
      apiRequest<WorkforceSummary[]>(
        `/workforce-summary?from=${day.slice(0, 7)}-01&to=${day}`,
      ),
      apiRequest<{ status: string }[]>("/tasks"),
    ])
      .then(([rows, tasks]) => {
        if (active)
          setData({
            rows,
            active: tasks.filter((x) => x.status !== "DONE").length,
            done: tasks.filter((x) => x.status === "DONE").length,
          });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  if (error) return <p role="alert">{error}</p>;
  return (
    <section className="workforce-fields workforce-metrics">
      {[
        ["activeTasks", data?.active],
        ["completedTasks", data?.done],
        [
          "workedHours",
          data
            ? hours(data.rows.reduce((s, r) => s + r.workedMinutes, 0))
            : undefined,
        ],
        [
          "calculatedSalary",
          data
            ? `${data.rows.reduce((s, r) => s + r.salary, 0).toLocaleString()} ${data.rows[0]?.currency ?? ""}`
            : undefined,
        ],
      ].map(([key, value]) => (
        <div className="panel" key={key}>
          <p>{t(String(key))}</p>
          <strong>{value ?? "…"}</strong>
        </div>
      ))}
    </section>
  );
}
