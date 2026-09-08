import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Check,
  Cpu,
  Download,
  FileBarChart,
  KeyRound,
  Plus,
  RefreshCw,
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
type WorkweekTemplate = {
  weekdays: number[];
  startsAt: string;
  endsAt: string;
  unpaidBreakMinutes: number;
  graceMinutes: number;
  locationId: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
export function AdvancedPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<
    "devices" | "payroll" | "scheduling" | "reports"
  >("devices");
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
  const [departments, setDepartments] = useState<
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
  const [recurring, setRecurring] = useState({
    employeeId: "",
    locationId: "",
    weekdays: [1, 2, 3, 4, 5],
    startsAt: "09:00",
    endsAt: "18:00",
    effectiveFrom: today(),
  });
  const [workweek, setWorkweek] = useState<WorkweekTemplate>({
    weekdays: [1, 2, 3, 4, 5],
    startsAt: "08:00",
    endsAt: "17:00",
    unpaidBreakMinutes: 60,
    graceMinutes: 5,
    locationId: null,
  });
  const [workweekScope, setWorkweekScope] = useState<{
    scope: "ALL" | "DEPARTMENT" | "LOCATION";
    scopeId: string;
    effectiveFrom: string;
    effectiveUntil: string;
    replaceExisting: boolean;
  }>({
    scope: "ALL",
    scopeId: "",
    effectiveFrom: today(),
    effectiveUntil: "",
    replaceExisting: true,
  });
  const [materialize, setMaterialize] = useState({
    from: today(),
    to: today(),
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
      const schedule = await fetchSchedule(tashkentDate(), tashkentDate());
      const [d, r, h, rep, s, w] = await Promise.all([
        apiRequest<Device[]>("/devices"),
        apiRequest<Rule>("/payroll-rules"),
        apiRequest<Holiday[]>("/holidays"),
        apiRequest<Report[]>("/reports"),
        apiRequest<Swap[]>("/shift-swaps"),
        apiRequest<WorkweekTemplate>("/workweek-template"),
      ]);
      setDevices(d);
      setRule(r);
      setHolidays(h);
      setReports(rep);
      setSwaps(s);
      setWorkweek({
        ...w,
        startsAt: w.startsAt.slice(0, 5),
        endsAt: w.endsAt.slice(0, 5),
      });
      setEmployees(schedule.employees);
      setLocations(schedule.meta.locations);
      setDepartments(schedule.meta.departments);
      const first = schedule.employees[0]?.id || "";
      setRecurring((v) => ({
        ...v,
        employeeId: v.employeeId || first,
        locationId: v.locationId || schedule.meta.locations[0]?.id || "",
      }));
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
  const saveWorkweek = (e: FormEvent) => {
    e.preventDefault();
    return run(
      () =>
        apiRequest("/workweek-template", {
          method: "PUT",
          body: JSON.stringify(workweek),
        }),
      t("workweekSaved"),
    );
  };
  const applyWorkweek = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiRequest("/workweek-template", {
        method: "PUT",
        body: JSON.stringify(workweek),
      });
      const result = await apiRequest<{ matched: number; created: number }>(
        "/workweek-template/apply",
        {
          method: "POST",
          body: JSON.stringify({
            ...workweekScope,
            scopeId:
              workweekScope.scope === "ALL" ? null : workweekScope.scopeId,
            effectiveUntil: workweekScope.effectiveUntil || null,
          }),
        },
      );
      setMessage(
        t("workweekAppliedCount", {
          count: result.created,
          matched: result.matched,
        }),
      );
      window.setTimeout(() => setMessage(""), 2500);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  const addRecurring = (e: FormEvent) => {
    e.preventDefault();
    return run(
      () =>
        apiRequest("/recurring-schedules", {
          method: "POST",
          body: JSON.stringify({
            ...recurring,
            locationId: recurring.locationId || null,
            unpaidBreakMinutes: 60,
            graceMinutes: 5,
          }),
        }),
      t("recurringSaved"),
    );
  };
  const generateRecurring = (e: FormEvent) => {
    e.preventDefault();
    return run(
      () =>
        apiRequest("/recurring-schedules/materialize", {
          method: "POST",
          body: JSON.stringify(materialize),
        }),
      t("shiftsGenerated"),
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
            scheduleCron: report.scheduleCron || null,
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
    <div className="advanced-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("administration")}</p>
          <h1>{t("advancedOperations")}</h1>
          <p>{t("advancedOperationsDescription")}</p>
        </div>
        <button className="secondary-button" onClick={() => void load()}>
          <RefreshCw size={16} />
          {t("refresh")}
        </button>
      </div>
      <nav className="advanced-tabs">
        {(["devices", "payroll", "scheduling", "reports"] as const).map(
          (name) => (
            <button
              key={name}
              className={tab === name ? "active" : ""}
              onClick={() => setTab(name)}
            >
              {name === "devices" ? (
                <Cpu size={17} />
              ) : name === "payroll" ? (
                <KeyRound size={17} />
              ) : name === "scheduling" ? (
                <CalendarClock size={17} />
              ) : (
                <FileBarChart size={17} />
              )}{" "}
              {t(`advanced_${name}`)}
            </button>
          ),
        )}
      </nav>
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
      {tab === "scheduling" && (
        <div className="advanced-grid">
          <form
            className="panel advanced-form workweek-card"
            onSubmit={saveWorkweek}
          >
            <div>
              <h2>{t("companyWorkweek")}</h2>
              <p className="muted-copy">{t("companyWorkweekDescription")}</p>
            </div>
            <div className="weekday-picker">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <button
                  type="button"
                  className={workweek.weekdays.includes(day) ? "active" : ""}
                  key={day}
                  onClick={() =>
                    setWorkweek({
                      ...workweek,
                      weekdays: workweek.weekdays.includes(day)
                        ? workweek.weekdays.length === 1
                          ? workweek.weekdays
                          : workweek.weekdays.filter((x) => x !== day)
                        : [...workweek.weekdays, day].sort(),
                    })
                  }
                >
                  {t(`weekday${day}`)}
                </button>
              ))}
            </div>
            <div className="field-grid">
              <label className="form-field">
                <span>{t("workdayStarts")}</span>
                <input
                  required
                  type="time"
                  value={workweek.startsAt}
                  onChange={(e) =>
                    setWorkweek({ ...workweek, startsAt: e.target.value })
                  }
                />
              </label>
              <label className="form-field">
                <span>{t("workdayEnds")}</span>
                <input
                  required
                  type="time"
                  value={workweek.endsAt}
                  onChange={(e) =>
                    setWorkweek({ ...workweek, endsAt: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="field-grid">
              <label className="form-field">
                <span>{t("unpaidBreakMinutes")}</span>
                <input
                  required
                  type="number"
                  min="0"
                  max="480"
                  value={workweek.unpaidBreakMinutes}
                  onChange={(e) =>
                    setWorkweek({
                      ...workweek,
                      unpaidBreakMinutes: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>{t("graceMinutes")}</span>
                <input
                  required
                  type="number"
                  min="0"
                  max="120"
                  value={workweek.graceMinutes}
                  onChange={(e) =>
                    setWorkweek({
                      ...workweek,
                      graceMinutes: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <label className="form-field">
              <span>{t("defaultWorkLocation")}</span>
              <select
                value={workweek.locationId || ""}
                onChange={(e) =>
                  setWorkweek({
                    ...workweek,
                    locationId: e.target.value || null,
                  })
                }
              >
                <option value="">{t("employeePrimaryLocation")}</option>
                {locations.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" disabled={saving}>
              {t("saveWorkweek")}
            </button>
          </form>
          <form className="panel advanced-form" onSubmit={applyWorkweek}>
            <h2>{t("applyCompanyWorkweek")}</h2>
            <label className="form-field">
              <span>{t("applyTo")}</span>
              <select
                value={workweekScope.scope}
                onChange={(e) =>
                  setWorkweekScope({
                    ...workweekScope,
                    scope: e.target.value as "ALL" | "DEPARTMENT" | "LOCATION",
                    scopeId: "",
                  })
                }
              >
                <option value="ALL">{t("allActiveEmployees")}</option>
                <option value="DEPARTMENT">{t("department")}</option>
                <option value="LOCATION">{t("workLocation")}</option>
              </select>
            </label>
            {workweekScope.scope === "DEPARTMENT" && (
              <label className="form-field">
                <span>{t("department")}</span>
                <select
                  required
                  value={workweekScope.scopeId}
                  onChange={(e) =>
                    setWorkweekScope({
                      ...workweekScope,
                      scopeId: e.target.value,
                    })
                  }
                >
                  <option value="">—</option>
                  {departments.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {workweekScope.scope === "LOCATION" && (
              <label className="form-field">
                <span>{t("workLocation")}</span>
                <select
                  required
                  value={workweekScope.scopeId}
                  onChange={(e) =>
                    setWorkweekScope({
                      ...workweekScope,
                      scopeId: e.target.value,
                    })
                  }
                >
                  <option value="">—</option>
                  {locations.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="field-grid">
              <label className="form-field">
                <span>{t("effectiveFrom")}</span>
                <input
                  required
                  type="date"
                  value={workweekScope.effectiveFrom}
                  onChange={(e) =>
                    setWorkweekScope({
                      ...workweekScope,
                      effectiveFrom: e.target.value,
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>{t("effectiveUntilOptional")}</span>
                <input
                  type="date"
                  min={workweekScope.effectiveFrom}
                  value={workweekScope.effectiveUntil}
                  onChange={(e) =>
                    setWorkweekScope({
                      ...workweekScope,
                      effectiveUntil: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={workweekScope.replaceExisting}
                onChange={(e) =>
                  setWorkweekScope({
                    ...workweekScope,
                    replaceExisting: e.target.checked,
                  })
                }
              />
              {t("replaceRecurringSchedules")}
            </label>
            <p className="muted-copy">{t("applyWorkweekHelp")}</p>
            <button className="primary-button" disabled={saving}>
              {t("applyWorkweek")}
            </button>
          </form>
          <form className="panel advanced-form" onSubmit={addRecurring}>
            <h2>{t("individualRecurringSchedule")}</h2>
            <label className="form-field">
              <span>{t("employee")}</span>
              <select
                value={recurring.employeeId}
                onChange={(e) =>
                  setRecurring({ ...recurring, employeeId: e.target.value })
                }
              >
                {employees.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>{t("workLocation")}</span>
              <select
                value={recurring.locationId}
                onChange={(e) =>
                  setRecurring({ ...recurring, locationId: e.target.value })
                }
              >
                {locations.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="weekday-picker">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <button
                  type="button"
                  className={recurring.weekdays.includes(day) ? "active" : ""}
                  key={day}
                  onClick={() =>
                    setRecurring({
                      ...recurring,
                      weekdays: recurring.weekdays.includes(day)
                        ? recurring.weekdays.filter((x) => x !== day)
                        : [...recurring.weekdays, day],
                    })
                  }
                >
                  {t(`weekday${day}`)}
                </button>
              ))}
            </div>
            <div className="field-grid">
              <label className="form-field">
                <span>{t("starts")}</span>
                <input
                  type="time"
                  value={recurring.startsAt}
                  onChange={(e) =>
                    setRecurring({ ...recurring, startsAt: e.target.value })
                  }
                />
              </label>
              <label className="form-field">
                <span>{t("ends")}</span>
                <input
                  type="time"
                  value={recurring.endsAt}
                  onChange={(e) =>
                    setRecurring({ ...recurring, endsAt: e.target.value })
                  }
                />
              </label>
            </div>
            <label className="form-field">
              <span>{t("effectiveFrom")}</span>
              <input
                type="date"
                value={recurring.effectiveFrom}
                onChange={(e) =>
                  setRecurring({ ...recurring, effectiveFrom: e.target.value })
                }
              />
            </label>
            <button className="primary-button" disabled={saving}>
              {t("saveRecurring")}
            </button>
          </form>
          <div>
            <form className="panel advanced-form" onSubmit={generateRecurring}>
              <h2>{t("generateFromTemplates")}</h2>
              <div className="field-grid">
                <label className="form-field">
                  <span>{t("from")}</span>
                  <input
                    type="date"
                    value={materialize.from}
                    onChange={(e) =>
                      setMaterialize({ ...materialize, from: e.target.value })
                    }
                  />
                </label>
                <label className="form-field">
                  <span>{t("to")}</span>
                  <input
                    type="date"
                    value={materialize.to}
                    onChange={(e) =>
                      setMaterialize({ ...materialize, to: e.target.value })
                    }
                  />
                </label>
              </div>
              <button className="primary-button" disabled={saving}>
                {t("generateShifts")}
              </button>
            </form>
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
                  <option key={x}>{x}</option>
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
            </label>
            <label className="form-field">
              <span>{t("cronSchedule")}</span>
              <input
                placeholder="0 8 1 * *"
                value={report.scheduleCron}
                onChange={(e) =>
                  setReport({ ...report, scheduleCron: e.target.value })
                }
              />
            </label>
            <label className="form-field">
              <span>{t("nextRun")}</span>
              <input
                type="datetime-local"
                value={report.nextRunAt}
                onChange={(e) =>
                  setReport({ ...report, nextRunAt: e.target.value })
                }
              />
            </label>
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
                    {r.reportType} · {r.format} ·{" "}
                    {r.scheduleCron || t("manual")}
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
