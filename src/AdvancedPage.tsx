import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Check,
  Cpu,
  Download,
  FileBarChart,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { apiRequest, downloadApiFile } from "./api";
import { fetchSchedule } from "./workforceApi";
import { tashkentDate } from "./operationsApi";
import { useI18n } from "./i18n";

type Device = {
  id: string;
  name: string;
  vendor: string;
  serialNumber: string;
  deviceType: string;
  active: boolean;
  lastSeenAt: string | null;
  location: string | null;
  identityCount: number;
};
type Rule = {
  overtimeMultiplier: number;
  nightMultiplier: number;
  holidayMultiplier: number;
  nightStartsAt: string;
  nightEndsAt: string;
  pensionRate: number;
  socialTaxRate: number;
};
type Holiday = { id: string; date: string; name: string; paid: boolean };
type Report = {
  id: string;
  name: string;
  reportType: string;
  format: string;
  scheduleCron: string | null;
  recipients: string[];
  active: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
};
type Swap = {
  id: string;
  requester: string;
  offeredToName: string | null;
  acceptedByName: string | null;
  reason: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
};
const today = () => new Date().toISOString().slice(0, 10);

export type AdvancedSection = "devices" | "payroll" | "swaps" | "reports";

type Frequency = "manual" | "daily" | "weekly" | "monthly";
const cronFor = (frequency: Frequency, time: string) => {
  const [hour = "8", minute = "0"] = time.split(":");
  const h = Number(hour);
  const m = Number(minute);
  if (frequency === "daily") return `${m} ${h} * * *`;
  if (frequency === "weekly") return `${m} ${h} * * 1`;
  if (frequency === "monthly") return `${m} ${h} 1 * *`;
  return "";
};
/** Turns the stored cron back into a plain-language label. */
const describeCron = (
  cron: string | null,
  t: (key: string, values?: Record<string, string | number>) => string,
) => {
  if (!cron) return t("frequencyManual");
  const match = /^(\d+) (\d+) (\*|1) \* (\*|1)$/.exec(cron.trim());
  if (!match) return cron;
  const [, minute, hour, dayOfMonth, dayOfWeek] = match;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  const label =
    dayOfMonth === "1"
      ? t("frequencyMonthly")
      : dayOfWeek === "1"
        ? t("frequencyWeekly")
        : t("frequencyDaily");
  return `${label} · ${time}`;
};

/**
 * Administrative tools, embedded inside the workspace they belong to:
 * devices in Settings, pay rules in Payroll, swaps in Requests, reports in Reports.
 */
export function AdvancedPage({ section }: { section: AdvancedSection }) {
  const { t } = useI18n();
  const tab = section;
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [sendTime, setSendTime] = useState("08:00");
  const [devices, setDevices] = useState<Device[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [rule, setRule] = useState<Rule>({
    overtimeMultiplier: 1.5,
    nightMultiplier: 1.2,
    holidayMultiplier: 2,
    nightStartsAt: "22:00",
    nightEndsAt: "06:00",
    pensionRate: 0,
    socialTaxRate: 0,
  });
  const [employees, setEmployees] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [locations, setLocations] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deviceSecret, setDeviceSecret] = useState("");
  const [device, setDevice] = useState({
    name: "",
    vendor: "",
    serialNumber: "",
    deviceType: "FACE_TERMINAL",
    locationId: "",
  });
  const [holiday, setHoliday] = useState({
    date: today(),
    name: "",
    paid: true,
  });
  const [report, setReport] = useState({
    name: "",
    reportType: "ATTENDANCE",
    format: "CSV",
    scheduleCron: "",
    recipients: "",
    nextRunAt: "",
  });
  const [rate, setRate] = useState({
    employeeId: "",
    effectiveFrom: today(),
    hourlyRate: "0",
    baseSalary: "0",
  });
  const [benefit, setBenefit] = useState({
    employeeId: "",
    name: "",
    amount: "0",
    taxable: true,
    active: true,
  });
  const [identity, setIdentity] = useState({
    deviceId: "",
    employeeId: "",
    externalUserId: "",
    biometricType: "FACE",
  });
  const load = async () => {
    setError("");
    try {
      // Only load what this section shows.
      const needsPeople = section === "devices" || section === "payroll";
      const schedule = needsPeople
        ? await fetchSchedule(tashkentDate(), tashkentDate())
        : { employees: [], meta: { locations: [] } };
      const [d, r, h, rep, s] = await Promise.all([
        section === "devices"
          ? apiRequest<Device[]>("/devices")
          : Promise.resolve<Device[]>([]),
        section === "payroll"
          ? apiRequest<Rule>("/payroll-rules")
          : Promise.resolve<Rule | null>(null),
        section === "payroll"
          ? apiRequest<Holiday[]>("/holidays")
          : Promise.resolve<Holiday[]>([]),
        section === "reports"
          ? apiRequest<Report[]>("/reports")
          : Promise.resolve<Report[]>([]),
        section === "swaps"
          ? apiRequest<Swap[]>("/shift-swaps")
          : Promise.resolve<Swap[]>([]),
      ]);
      setDevices(d);
      if (r) setRule(r);
      setHolidays(h);
      setReports(rep);
      setSwaps(s);
      setEmployees(schedule.employees);
      setLocations(schedule.meta.locations);

      const first = schedule.employees[0]?.id || "";
      setDevice((v) => ({
        ...v,
        locationId: v.locationId || schedule.meta.locations[0]?.id || "",
      }));
      setRate((v) => ({ ...v, employeeId: v.employeeId || first }));
      setBenefit((v) => ({ ...v, employeeId: v.employeeId || first }));
      setIdentity((v) => ({
        ...v,
        employeeId: v.employeeId || first,
        deviceId: v.deviceId || d[0]?.id || "",
      }));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("loadAdvancedFailed"),
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true);
    setError("");
    try {
      await action();
      setMessage(success);
      window.setTimeout(() => setMessage(""), 2500);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  const registerDevice = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest<{ apiKey: string }>("/devices", {
        method: "POST",
        body: JSON.stringify({
          ...device,
          locationId: device.locationId || null,
        }),
      });
      setDeviceSecret(result.apiKey);
      setDevice((v) => ({ ...v, name: "", serialNumber: "" }));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  const addHoliday = (e: FormEvent) => {
    e.preventDefault();
    return run(
      () =>
        apiRequest("/holidays", {
          method: "POST",
          body: JSON.stringify(holiday),
        }),
      t("holidaySaved"),
    );
  };
  const saveRule = (e: FormEvent) => {
    e.preventDefault();
    return run(
      () =>
        apiRequest("/payroll-rules", {
          method: "PUT",
          body: JSON.stringify(rule),
        }),
      t("payrollRulesSaved"),
    );
  };
  const addReport = (e: FormEvent) => {
    e.preventDefault();
    return run(
      () =>
        apiRequest("/reports", {
          method: "POST",
          body: JSON.stringify({
            ...report,
            scheduleCron: cronFor(frequency, sendTime) || null,
            recipients: report.recipients
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            nextRunAt: report.nextRunAt
              ? new Date(report.nextRunAt).toISOString()
              : null,
            filters: {},
          }),
        }),
      t("reportSaved"),
    );
  };
  const saveRate = (e: FormEvent) => {
    e.preventDefault();
    return run(
      () =>
        apiRequest(`/employees/${rate.employeeId}/rates`, {
          method: "POST",
          body: JSON.stringify({
            effectiveFrom: rate.effectiveFrom,
            hourlyRate: Number(rate.hourlyRate),
            baseSalary: Number(rate.baseSalary),
          }),
        }),
      t("rateSaved"),
    );
  };
  const saveBenefit = (e: FormEvent) => {
    e.preventDefault();
    return run(
      () =>
        apiRequest(`/employees/${benefit.employeeId}/benefits`, {
          method: "POST",
          body: JSON.stringify({ ...benefit, amount: Number(benefit.amount) }),
        }),
      t("benefitSaved"),
    );
  };
  const linkIdentity = (e: FormEvent) => {
    e.preventDefault();
    return run(
      () =>
        apiRequest(`/devices/${identity.deviceId}/identities`, {
          method: "POST",
          body: JSON.stringify(identity),
        }),
      t("identityLinked"),
    );
  };
  return (
    <div className={`advanced-page advanced-${section}`}>
      {error && (
        <div className="operations-error">
          <X size={17} />
          {error}
        </div>
      )}
      {message && (
        <div className="portal-success">
          <Check size={16} />
          {message}
        </div>
      )}
      {tab === "devices" && (
        <div className="advanced-grid">
          <form className="panel advanced-form" onSubmit={registerDevice}>
            <h2>{t("registerDevice")}</h2>
            <label className="form-field">
              <span>{t("deviceName")}</span>
              <input
                required
                minLength={2}
                value={device.name}
                onChange={(e) => setDevice({ ...device, name: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>{t("vendor")}</span>
              <input
                required
                minLength={2}
                value={device.vendor}
                onChange={(e) =>
                  setDevice({ ...device, vendor: e.target.value })
                }
              />
            </label>
            <label className="form-field">
              <span>{t("serialNumber")}</span>
              <input
                required
                value={device.serialNumber}
                onChange={(e) =>
                  setDevice({ ...device, serialNumber: e.target.value })
                }
              />
            </label>
            <label className="form-field">
              <span>{t("deviceType")}</span>
              <select
                value={device.deviceType}
                onChange={(e) =>
                  setDevice({ ...device, deviceType: e.target.value })
                }
              >
                <option value="FACE_TERMINAL">{t("faceTerminal")}</option>
                <option value="BIOMETRIC">{t("biometricTerminal")}</option>
                <option value="TURNSTILE">{t("turnstile")}</option>
                <option value="KIOSK">{t("kiosk")}</option>
              </select>
            </label>
            <label className="form-field">
              <span>{t("workLocation")}</span>
              <select
                value={device.locationId}
                onChange={(e) =>
                  setDevice({ ...device, locationId: e.target.value })
                }
              >
                {locations.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" disabled={saving}>
              <Plus size={16} />
              {t("registerDevice")}
            </button>
            {deviceSecret && (
              <div className="secret-callout">
                <ShieldCheck size={18} />
                <div>
                  <strong>{t("copyDeviceKeyNow")}</strong>
                  <code>{deviceSecret}</code>
                </div>
              </div>
            )}
          </form>
          <section className="panel advanced-list">
            <h2>{t("connectedDevices")}</h2>
            {devices.length ? (
              devices.map((d) => (
                <article key={d.id}>
                  <Cpu size={19} />
                  <div>
                    <strong>{d.name}</strong>
                    <span>
                      {d.vendor} · {d.serialNumber} ·{" "}
                      {d.location || t("unassigned")}
                    </span>
                    <small>
                      {t("identitiesCount", { count: d.identityCount })} ·{" "}
                      {d.lastSeenAt
                        ? new Date(d.lastSeenAt).toLocaleString()
                        : t("neverConnected")}
                    </small>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void run(
                        () =>
                          apiRequest(`/devices/${d.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ active: !d.active }),
                          }),
                        t("deviceUpdated"),
                      )
                    }
                  >
                    {d.active ? t("disable") : t("enable")}
                  </button>
                </article>
              ))
            ) : (
              <p>{t("noDevices")}</p>
            )}
          </section>
          <form
            className="panel advanced-form identity-form"
            onSubmit={linkIdentity}
          >
            <h2>{t("linkBiometricIdentity")}</h2>
            <label className="form-field">
              <span>{t("device")}</span>
              <select
                required
                value={identity.deviceId}
                onChange={(e) =>
                  setIdentity({ ...identity, deviceId: e.target.value })
                }
              >
                <option value="">—</option>
                {devices.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>{t("employee")}</span>
              <select
                required
                value={identity.employeeId}
                onChange={(e) =>
                  setIdentity({ ...identity, employeeId: e.target.value })
                }
              >
                {employees.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>{t("externalUserId")}</span>
              <input
                required
                value={identity.externalUserId}
                onChange={(e) =>
                  setIdentity({ ...identity, externalUserId: e.target.value })
                }
              />
            </label>
            <label className="form-field">
              <span>{t("biometricType")}</span>
              <select
                value={identity.biometricType}
                onChange={(e) =>
                  setIdentity({ ...identity, biometricType: e.target.value })
                }
              >
                <option value="FACE">{t("face")}</option>
                <option value="FINGERPRINT">{t("fingerprint")}</option>
                <option value="CARD">{t("accessCard")}</option>
              </select>
            </label>
            <button className="primary-button" disabled={saving}>
              {t("linkIdentity")}
            </button>
          </form>
        </div>
      )}
      {tab === "payroll" && (
        <div className="advanced-grid">
          <form className="panel advanced-form" onSubmit={saveRule}>
            <h2>{t("payrollRules")}</h2>
            {(
              [
                ["overtimeMultiplier", "overtimeMultiplier"],
                ["nightMultiplier", "nightMultiplier"],
                ["holidayMultiplier", "holidayMultiplier"],
                ["pensionRate", "pensionRate"],
                ["socialTaxRate", "socialTaxRate"],
              ] as const
            ).map(([key, label]) => (
              <label className="form-field" key={key}>
                <span>{t(label)}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={rule[key]}
                  onChange={(e) =>
                    setRule({ ...rule, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
            <div className="field-grid">
              <label className="form-field">
                <span>{t("nightStarts")}</span>
                <input
                  type="time"
                  value={rule.nightStartsAt.slice(0, 5)}
                  onChange={(e) =>
                    setRule({ ...rule, nightStartsAt: e.target.value })
                  }
                />
              </label>
              <label className="form-field">
                <span>{t("nightEnds")}</span>
                <input
                  type="time"
                  value={rule.nightEndsAt.slice(0, 5)}
                  onChange={(e) =>
                    setRule({ ...rule, nightEndsAt: e.target.value })
                  }
                />
              </label>
            </div>
            <button className="primary-button" disabled={saving}>
              {t("saveRules")}
            </button>
          </form>
          <section className="panel advanced-form">
            <form onSubmit={addHoliday}>
              <h2>{t("holidays")}</h2>
              <label className="form-field">
                <span>{t("date")}</span>
                <input
                  type="date"
                  required
                  value={holiday.date}
                  onChange={(e) =>
                    setHoliday({ ...holiday, date: e.target.value })
                  }
                />
              </label>
              <label className="form-field">
                <span>{t("holidayName")}</span>
                <input
                  required
                  value={holiday.name}
                  onChange={(e) =>
                    setHoliday({ ...holiday, name: e.target.value })
                  }
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={holiday.paid}
                  onChange={(e) =>
                    setHoliday({ ...holiday, paid: e.target.checked })
                  }
                />
                {t("paidHoliday")}
              </label>
              <button className="primary-button" disabled={saving}>
                <Plus size={16} />
                {t("addHoliday")}
              </button>
            </form>
            <div className="compact-list">
              {holidays.map((h) => (
                <div key={h.id}>
                  <span>
                    <strong>{h.name}</strong>
                    <small>{h.date}</small>
                  </span>
                  <button
                    onClick={() =>
                      void run(
                        () =>
                          apiRequest(`/holidays/${h.id}`, { method: "DELETE" }),
                        t("holidayRemoved"),
                      )
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="panel compensation-forms">
            <form className="advanced-form" onSubmit={saveRate}>
              <h2>{t("datedCompensation")}</h2>
              <label className="form-field">
                <span>{t("employee")}</span>
                <select
                  required
                  value={rate.employeeId}
                  onChange={(e) =>
                    setRate({ ...rate, employeeId: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {employees.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-grid">
                <label className="form-field">
                  <span>{t("effectiveFrom")}</span>
                  <input
                    type="date"
                    value={rate.effectiveFrom}
                    onChange={(e) =>
                      setRate({ ...rate, effectiveFrom: e.target.value })
                    }
                  />
                </label>
                <label className="form-field">
                  <span>{t("hourlyRate")}</span>
                  <input
                    type="number"
                    min="0"
                    value={rate.hourlyRate}
                    onChange={(e) =>
                      setRate({ ...rate, hourlyRate: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="form-field">
                <span>{t("baseSalary")}</span>
                <input
                  type="number"
                  min="0"
                  value={rate.baseSalary}
                  onChange={(e) =>
                    setRate({ ...rate, baseSalary: e.target.value })
                  }
                />
              </label>
              <button className="primary-button" disabled={saving}>
                {t("saveRate")}
              </button>
            </form>
            <form className="advanced-form" onSubmit={saveBenefit}>
              <h2>{t("employeeBenefits")}</h2>
              <label className="form-field">
                <span>{t("employee")}</span>
                <select
                  required
                  value={benefit.employeeId}
                  onChange={(e) =>
                    setBenefit({ ...benefit, employeeId: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {employees.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>{t("benefitName")}</span>
                <input
                  required
                  value={benefit.name}
                  onChange={(e) =>
                    setBenefit({ ...benefit, name: e.target.value })
                  }
                />
              </label>
              <label className="form-field">
                <span>{t("amountUzs")}</span>
                <input
                  type="number"
                  min="0"
                  value={benefit.amount}
                  onChange={(e) =>
                    setBenefit({ ...benefit, amount: e.target.value })
                  }
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={benefit.taxable}
                  onChange={(e) =>
                    setBenefit({ ...benefit, taxable: e.target.checked })
                  }
                />
                {t("taxableBenefit")}
              </label>
              <button className="primary-button" disabled={saving}>
                {t("saveBenefit")}
              </button>
            </form>
          </section>
        </div>
      )}
      {tab === "swaps" && (
        <div className="advanced-grid single">
          <div>
            <section className="panel advanced-list">
              <h2>{t("shiftSwapApprovals")}</h2>
              {swaps.length ? (
                swaps.map((s) => (
                  <article key={s.id}>
                    <CalendarClock size={18} />
                    <div>
                      <strong>
                        {s.requester} →{" "}
                        {s.acceptedByName || s.offeredToName || t("openToTeam")}
                      </strong>
                      <span>
                        {new Date(s.startsAt).toLocaleString()} ·{" "}
                        {t(s.status.toLowerCase())}
                      </span>
                      <small>{s.reason}</small>
                    </div>
                    {s.status === "ACCEPTED" && (
                      <>
                        <button
                          onClick={() =>
                            void run(
                              () =>
                                apiRequest(`/shift-swaps/${s.id}/resolve`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ status: "APPROVED" }),
                                }),
                              t("swapApproved"),
                            )
                          }
                        >
                          {t("approve")}
                        </button>
                        <button
                          onClick={() =>
                            void run(
                              () =>
                                apiRequest(`/shift-swaps/${s.id}/resolve`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ status: "REJECTED" }),
                                }),
                              t("rejected"),
                            )
                          }
                        >
                          {t("reject")}
                        </button>
                      </>
                    )}
                  </article>
                ))
              ) : (
                <p>{t("noShiftSwaps")}</p>
              )}
            </section>
          </div>
        </div>
      )}
      {tab === "reports" && (
        <div className="advanced-grid">
          <form className="panel advanced-form" onSubmit={addReport}>
            <h2>{t("scheduledReports")}</h2>
            <label className="form-field">
              <span>{t("reportName")}</span>
              <input
                required
                value={report.name}
                onChange={(e) => setReport({ ...report, name: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>{t("reportType")}</span>
              <select
                value={report.reportType}
                onChange={(e) =>
                  setReport({ ...report, reportType: e.target.value })
                }
              >
                {["ATTENDANCE", "PAYROLL", "ACCOUNTING", "AUDIT"].map((x) => (
                  <option key={x} value={x}>
                    {t(`reportType${x}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>{t("recipients")}</span>
              <input
                type="text"
                placeholder="finance@example.com, hr@example.com"
                value={report.recipients}
                onChange={(e) =>
                  setReport({ ...report, recipients: e.target.value })
                }
              />
              <small className="field-hint">{t("recipientsHelp")}</small>
            </label>
            <label className="form-field">
              <span>{t("reportFrequency")}</span>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
              >
                <option value="manual">{t("frequencyManual")}</option>
                <option value="daily">{t("frequencyDaily")}</option>
                <option value="weekly">{t("frequencyWeekly")}</option>
                <option value="monthly">{t("frequencyMonthly")}</option>
              </select>
            </label>
            {frequency !== "manual" && (
              <>
                <label className="form-field">
                  <span>{t("reportTime")}</span>
                  <input
                    type="time"
                    value={sendTime}
                    onChange={(e) => setSendTime(e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>
                    {t("nextRun")} <em>{t("optional")}</em>
                  </span>
                  <input
                    type="datetime-local"
                    value={report.nextRunAt}
                    onChange={(e) =>
                      setReport({ ...report, nextRunAt: e.target.value })
                    }
                  />
                </label>
              </>
            )}
            <button className="primary-button" disabled={saving}>
              <Plus size={16} />
              {t("scheduleReport")}
            </button>
          </form>
          <section className="panel advanced-list">
            <h2>{t("exports")}</h2>
            <div className="export-buttons">
              {["attendance", "payroll", "accounting", "audit"].map((type) => (
                <button
                  className="secondary-button"
                  key={type}
                  onClick={() =>
                    void downloadApiFile(
                      `/reports/export/${type}`,
                      `atlas-${type}.csv`,
                    ).catch((e) => setError(e.message))
                  }
                >
                  <Download size={16} />
                  {t(`export_${type}`)}
                </button>
              ))}
            </div>
            <h2>{t("savedSchedules")}</h2>
            {reports.map((r) => (
              <article key={r.id}>
                <FileBarChart size={18} />
                <div>
                  <strong>{r.name}</strong>
                  <span>
                    {t(`reportType${r.reportType}`)} · {r.format} ·{" "}
                    {describeCron(r.scheduleCron, t)}
                  </span>
                  <small>{r.recipients.join(", ") || t("noRecipients")}</small>
                </div>
              </article>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
