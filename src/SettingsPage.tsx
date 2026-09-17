import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import {
  Building2,
  Check,
  History,
  KeyRound,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Power,
  Send,
  ShieldCheck,
  Smartphone,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { apiRequest, type SessionUser } from "./api";
import { AdvancedPage } from "./AdvancedPage";
import { PageGuide } from "./Guidance";
import {
  createDepartment,
  createLocation,
  editDepartment,
  editLocation,
  fetchCompanySetup,
  updateCompany,
  type ApiDepartment,
  type ApiLocation,
  type AuditEntry,
  type Integrations,
} from "./workforceApi";
import { intlLocale, LanguageSwitcher, useI18n } from "./i18n";

const LocationMapPicker = lazy(() =>
  import("./LocationMapPicker").then((module) => ({
    default: module.LocationMapPicker,
  })),
);

const auditActionKeys: Record<string, string> = {
  PASSWORD_RESET: "auditPasswordReset",
  PASSWORD_CHANGED: "auditPasswordChanged",
  COMPANY_UPDATED: "auditCompanyUpdated",
  DEPARTMENT_CREATED: "auditDepartmentCreated",
  DEPARTMENT_UPDATED: "auditDepartmentUpdated",
  LOCATION_CREATED: "auditLocationCreated",
  LOCATION_UPDATED: "auditLocationUpdated",
  EMPLOYEE_CREATED: "auditEmployeeCreated",
  EMPLOYEE_UPDATED: "auditEmployeeUpdated",
  EMPLOYEE_ACCOUNT_PROVISIONED: "auditEmployeeAccountProvisioned",
  ATTENDANCE_RECONCILED: "auditAttendanceReconciled",
  PUNCH_CORRECTION_APPLIED: "auditPunchCorrectionApplied",
  ATTENDANCE_EXCEPTION_RESOLVED: "auditAttendanceExceptionResolved",
  SHIFT_CREATED: "auditShiftCreated",
  SHIFT_UPDATED: "auditShiftUpdated",
  SHIFT_CANCELLED: "auditShiftCancelled",
  SCHEDULE_WEEK_COPIED: "auditScheduleCopied",
  SCHEDULE_PUBLISHED: "auditSchedulePublished",
  PUNCH_CREATED: "auditPunchCreated",
  PUNCH_UPDATED: "auditPunchUpdated",
  PUNCH_DELETED: "auditPunchDeleted",
  PAYROLL_PERIOD_GENERATED: "auditPayrollGenerated",
  PAYROLL_RECALCULATED: "auditPayrollRecalculated",
  PAYROLL_READY_APPROVED: "auditPayrollApproved",
  PAYROLL_ADJUSTMENT_CREATED: "auditPayrollAdjustmentCreated",
  PAYSLIP_APPROVED: "auditPayslipApproved",
  PAYROLL_PERIOD_PAID: "auditPayrollPaid",
  LEAVE_REQUESTED: "auditLeaveRequested",
  LEAVE_CANCELLED: "auditLeaveCancelled",
  LEAVE_RESOLVED: "auditLeaveResolved",
  WORKWEEK_TEMPLATE_UPDATED: "auditWorkweekTemplateUpdated",
  WORKWEEK_TEMPLATE_APPLIED: "auditWorkweekTemplateApplied",
  MOBILE_DEVICE_RESET: "auditMobileDeviceReset",
};
const auditEntityKeys: Record<string, string> = {
  USER: "user",
  COMPANY: "company",
  DEPARTMENT: "department",
  LOCATION: "location",
  EMPLOYEE: "employee",
  ATTENDANCE: "attendance",
  ATTENDANCE_EXCEPTION: "attendanceException",
  PUNCH: "clockEvent",
  SHIFT: "shift",
  SCHEDULE: "schedule",
  PAYROLL_PERIOD: "payrollPeriod",
  PAYSLIP: "payslip",
  LEAVE_REQUEST: "leaveRequest",
};

export function SettingsPage({
  user,
  onCompanyUpdated,
  focusSection,
}: {
  user: SessionUser;
  onCompanyUpdated: (name: string) => void;
  /** Section id to scroll to on open, e.g. from the setup checklist. */
  focusSection?: string;
}) {
  const { t, locale } = useI18n();
  useEffect(() => {
    if (!focusSection) return;
    const timer = window.setTimeout(
      () =>
        document
          .getElementById(focusSection)
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      150,
    );
    return () => window.clearTimeout(timer);
  }, [focusSection]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [company, setCompany] = useState({
    name: user.company.name,
    timezone: "Asia/Tashkent",
    currency: "UZS",
    annualLeaveDays: 21,
    defaultIncomeTaxRate: 12,
    correctionWindowDays: 45,
  });
  const [departments, setDepartments] = useState<ApiDepartment[]>([]);
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [departmentName, setDepartmentName] = useState("");
  const [editingDepartment, setEditingDepartment] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [location, setLocation] = useState({
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    geofenceRadiusM: "150",
  });
  const [editingLocationId, setEditingLocationId] = useState<string | null>(
    null,
  );
  const [setupError, setSetupError] = useState("");
  const [savingSetup, setSavingSetup] = useState(false);

  const load = async () => {
    try {
      const data = await fetchCompanySetup();
      setCompany({
        name: data.company.companyName,
        timezone: data.company.timezone,
        currency: data.company.currency,
        annualLeaveDays: data.company.annualLeaveDays,
        defaultIncomeTaxRate: data.company.defaultIncomeTaxRate,
        correctionWindowDays: data.company.correctionWindowDays,
      });
      setDepartments(data.meta.departments);
      setLocations(data.meta.locations);
      setAudit(data.audit);
      setIntegrations(data.integrations);
    } catch (reason) {
      setSetupError(
        reason instanceof Error ? reason.message : t("loadCompanySetupFailed"),
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const notify = (tone: "success" | "error", text: string) => {
    setMessage({ tone, text });
    if (tone === "success") window.setTimeout(() => setMessage(null), 2600);
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 10) return notify("error", t("useTenCharacters"));
    if (newPassword !== confirmation)
      return notify("error", t("passwordsMismatch"));
    setSavingPassword(true);
    setMessage(null);
    try {
      await apiRequest("/auth/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      notify("success", t("passwordChanged"));
      await load();
    } catch (reason) {
      notify(
        "error",
        reason instanceof Error ? reason.message : t("passwordChangeFailed"),
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const saveCompany = async (event: FormEvent) => {
    event.preventDefault();
    setSavingSetup(true);
    setSetupError("");
    try {
      const result = await updateCompany(company);
      setCompany({
        name: result.name,
        timezone: result.timezone,
        currency: result.currency,
        annualLeaveDays: result.annualLeaveDays,
        defaultIncomeTaxRate: result.defaultIncomeTaxRate,
        correctionWindowDays: result.correctionWindowDays,
      });
      onCompanyUpdated(result.name);
      notify("success", t("companySettingsSaved"));
      await load();
    } catch (reason) {
      setSetupError(
        reason instanceof Error
          ? reason.message
          : t("saveCompanySettingsFailed"),
      );
    } finally {
      setSavingSetup(false);
    }
  };

  const addDepartment = async (event: FormEvent) => {
    event.preventDefault();
    if (departmentName.trim().length < 2)
      return setSetupError(t("departmentNameMinimum"));
    setSavingSetup(true);
    setSetupError("");
    try {
      await createDepartment(departmentName.trim());
      setDepartmentName("");
      await load();
      notify("success", t("departmentCreated"));
    } catch (reason) {
      setSetupError(
        reason instanceof Error ? reason.message : t("createDepartmentFailed"),
      );
    } finally {
      setSavingSetup(false);
    }
  };

  const saveDepartment = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingDepartment) return;
    setSavingSetup(true);
    setSetupError("");
    try {
      await editDepartment(editingDepartment.id, editingDepartment.name.trim());
      setEditingDepartment(null);
      await load();
      notify("success", t("departmentUpdated"));
    } catch (reason) {
      setSetupError(
        reason instanceof Error ? reason.message : t("updateDepartmentFailed"),
      );
    } finally {
      setSavingSetup(false);
    }
  };

  const addLocation = async (event: FormEvent) => {
    event.preventDefault();
    const latitude =
      location.latitude === "" ? null : Number(location.latitude);
    const longitude =
      location.longitude === "" ? null : Number(location.longitude);
    if (latitude === null || longitude === null)
      return setSetupError(t("selectLocationOnMapRequired"));
    setSavingSetup(true);
    setSetupError("");
    try {
      if (editingLocationId)
        await editLocation(editingLocationId, {
          name: location.name.trim(),
          address: location.address.trim(),
          latitude,
          longitude,
          geofenceRadiusM: Number(location.geofenceRadiusM),
          active: true,
        });
      else
        await createLocation({
          name: location.name.trim(),
          address: location.address.trim(),
          latitude,
          longitude,
          geofenceRadiusM: Number(location.geofenceRadiusM),
        });
      setLocation({
        name: "",
        address: "",
        latitude: "",
        longitude: "",
        geofenceRadiusM: "150",
      });
      setEditingLocationId(null);
      await load();
      notify(
        "success",
        editingLocationId ? t("workLocationUpdated") : t("workLocationCreated"),
      );
    } catch (reason) {
      setSetupError(
        reason instanceof Error ? reason.message : t("saveWorkLocationFailed"),
      );
    } finally {
      setSavingSetup(false);
    }
  };

  const startLocationEdit = (item: ApiLocation) => {
    setEditingLocationId(item.id);
    setLocation({
      name: item.name,
      address: item.address ?? "",
      latitude: item.latitude == null ? "" : String(item.latitude),
      longitude: item.longitude == null ? "" : String(item.longitude),
      geofenceRadiusM: String(item.geofenceRadiusM),
    });
  };
  const toggleLocation = async (item: ApiLocation) => {
    setSavingSetup(true);
    setSetupError("");
    try {
      await editLocation(item.id, {
        name: item.name,
        address: item.address ?? "",
        latitude: item.latitude,
        longitude: item.longitude,
        geofenceRadiusM: item.geofenceRadiusM,
        active: !(item.active ?? true),
      });
      await load();
      notify(
        "success",
        item.active === false
          ? t("locationActivated", { name: item.name })
          : t("locationDeactivated", { name: item.name }),
      );
    } catch (reason) {
      setSetupError(
        reason instanceof Error ? reason.message : t("updateLocationFailed"),
      );
    } finally {
      setSavingSetup(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("workspace")}</p>
          <h1>{t("settings")}</h1>
          <p>{t("settingsDescription")}</p>
        </div>
        <LanguageSwitcher />
      </div>
      {message && (
        <div className={`settings-message global ${message.tone}`}>
          {message.tone === "success" ? (
            <Check size={16} />
          ) : (
            <ShieldCheck size={16} />
          )}{" "}
          {message.text}
        </div>
      )}
      {setupError && (
        <div className="operations-error">
          <X size={17} />
          <span>{setupError}</span>
          <button onClick={() => setSetupError("")}>{t("dismiss")}</button>
        </div>
      )}
      <PageGuide
        id="settings"
        steps={[t("guideSettings1"), t("guideSettings2"), t("guideSettings3")]}
      />
      <nav className="settings-jump-nav" aria-label={t("settingsSections")}>
        {[
          ["settings-account", t("yourAccount")],
          ["settings-company", t("companyConfiguration")],
          ["settings-departments", t("departments")],
          ["settings-locations", t("workLocations")],
          ["settings-devices", t("settingsDevices")],
          ["settings-activity", t("recentActivity")],
          ["settings-integrations", t("integrationReadiness")],
        ].map(([target, label]) => (
          <button
            key={target}
            type="button"
            onClick={() =>
              document.getElementById(target)?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-grid">
        <section className="panel settings-card" id="settings-account">
          <div className="settings-card-heading">
            <span>
              <UserRound size={19} />
            </span>
            <div>
              <h2>{t("yourAccount")}</h2>
              <p>{t("accountAuditIdentity")}</p>
            </div>
          </div>
          <dl className="settings-details">
            <div>
              <dt>{t("name")}</dt>
              <dd>{user.displayName}</dd>
            </div>
            <div>
              <dt>{t("email")}</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>{t("role")}</dt>
              <dd>{user.role}</dd>
            </div>
            <div>
              <dt>{t("company")}</dt>
              <dd>{company.name}</dd>
            </div>
          </dl>
          <div className="security-note">
            <ShieldCheck size={18} />
            <span>{t("auditNotice")}</span>
          </div>
        </section>
        <form className="panel settings-card" onSubmit={changePassword}>
          <div className="settings-card-heading">
            <span>
              <KeyRound size={19} />
            </span>
            <div>
              <h2>{t("changePassword")}</h2>
              <p>{t("uniquePassword")}</p>
            </div>
          </div>
          <label className="form-field">
            <span>{t("currentPassword")}</span>
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
              required
              minLength={10}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("confirmNewPassword")}</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <button
            className="primary-button settings-save"
            type="submit"
            disabled={savingPassword}
          >
            <KeyRound size={17} />
            {savingPassword ? t("changing") : t("changePassword")}
          </button>
        </form>
      </div>
      <form
        className="panel settings-company-form"
        id="settings-company"
        onSubmit={saveCompany}
      >
        <div className="settings-card-heading">
          <span>
            <Building2 size={19} />
          </span>
          <div>
            <h2>{t("companyConfiguration")}</h2>
            <p>{t("configurationDescription")}</p>
          </div>
        </div>
        <div className="company-form-grid policy-form-grid">
          <label className="form-field">
            <span>{t("companyName")}</span>
            <input
              required
              minLength={2}
              value={company.name}
              onChange={(event) =>
                setCompany((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label className="form-field">
            <span>{t("timezone")}</span>
            <select
              value={company.timezone}
              onChange={(event) =>
                setCompany((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))
              }
            >
              <option>Asia/Tashkent</option>
              <option>UTC</option>
              <option>Asia/Samarkand</option>
            </select>
          </label>
          <label className="form-field">
            <span>{t("currency")}</span>
            <input
              required
              minLength={3}
              maxLength={3}
              value={company.currency}
              onChange={(event) =>
                setCompany((current) => ({
                  ...current,
                  currency: event.target.value.toUpperCase(),
                }))
              }
            />
          </label>
          <label className="form-field">
            <span>{t("annualLeaveDays")}</span>
            <input
              type="number"
              min="0"
              max="365"
              required
              value={company.annualLeaveDays}
              onChange={(event) =>
                setCompany((current) => ({
                  ...current,
                  annualLeaveDays: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="form-field">
            <span>{t("defaultIncomeTax")}</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={company.defaultIncomeTaxRate}
              onChange={(event) =>
                setCompany((current) => ({
                  ...current,
                  defaultIncomeTaxRate: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="form-field">
            <span>{t("correctionWindow")}</span>
            <input
              type="number"
              min="1"
              max="365"
              required
              value={company.correctionWindowDays}
              onChange={(event) =>
                setCompany((current) => ({
                  ...current,
                  correctionWindowDays: Number(event.target.value),
                }))
              }
            />
          </label>
          <button className="primary-button" disabled={savingSetup}>
            {t("savePolicies")}
          </button>
        </div>
      </form>
      <div className="settings-organization-grid">
        <section className="panel settings-card" id="settings-departments">
          <div className="settings-card-heading">
            <span>
              <UsersRound size={19} />
            </span>
            <div>
              <h2>{t("departments")}</h2>
              <p>{t("organizationalGroups", { count: departments.length })}</p>
            </div>
          </div>
          <div className="organization-edit-list">
            {departments.map((item) =>
              editingDepartment?.id === item.id ? (
                <form key={item.id} onSubmit={saveDepartment}>
                  <input
                    autoFocus
                    required
                    minLength={2}
                    value={editingDepartment.name}
                    onChange={(event) =>
                      setEditingDepartment({
                        ...editingDepartment,
                        name: event.target.value,
                      })
                    }
                  />
                  <button className="primary-button" disabled={savingSetup}>
                    {t("save")}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setEditingDepartment(null)}
                  >
                    {t("cancel")}
                  </button>
                </form>
              ) : (
                <div key={item.id}>
                  <strong>{item.name}</strong>
                  <button
                    className="icon-button"
                    title={t("renameDepartment", { name: item.name })}
                    aria-label={t("renameDepartment", { name: item.name })}
                    onClick={() => setEditingDepartment(item)}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
              ),
            )}
          </div>
          <form className="setup-inline-form" onSubmit={addDepartment}>
            <input
              value={departmentName}
              onChange={(event) => setDepartmentName(event.target.value)}
              placeholder={t("newDepartment")}
            />
            <button className="primary-button" disabled={savingSetup}>
              <Plus size={16} />
              {t("add")}
            </button>
          </form>
        </section>
        <section className="panel settings-card" id="settings-locations">
          <div className="settings-card-heading">
            <span>
              <MapPin size={19} />
            </span>
            <div>
              <h2>{t("workLocations")}</h2>
              <p>
                {t("activeLocations", {
                  count: locations.filter((item) => item.active !== false)
                    .length,
                })}
              </p>
            </div>
          </div>
          <div className="location-setup-list">
            {locations.map((item) => (
              <div
                key={item.id}
                className={item.active === false ? "inactive" : ""}
              >
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.address || t("noStreetAddress")} ·{" "}
                    {item.active === false ? t("inactive") : t("active")}
                  </small>
                </span>
                <em>{item.geofenceRadiusM} m</em>
                <button
                  className="icon-button"
                  title={t("editLocation", { name: item.name })}
                  aria-label={t("editLocation", { name: item.name })}
                  onClick={() => startLocationEdit(item)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-button"
                  title={
                    item.active === false
                      ? t("activateLocation", { name: item.name })
                      : t("deactivateLocation", { name: item.name })
                  }
                  aria-label={
                    item.active === false
                      ? t("activateLocation", { name: item.name })
                      : t("deactivateLocation", { name: item.name })
                  }
                  onClick={() => void toggleLocation(item)}
                >
                  <Power size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <form
        className="panel settings-card location-create-form"
        onSubmit={addLocation}
      >
        <div className="settings-card-heading">
          <span>
            <MapPin size={19} />
          </span>
          <div>
            <h2>
              {editingLocationId ? t("editWorkLocation") : t("addWorkLocation")}
            </h2>
            <p>{t("selectLocationOnMapDescription")}</p>
          </div>
        </div>
        <div className="location-form-grid">
          <label className="form-field">
            <span>{t("name")}</span>
            <input
              required
              minLength={2}
              value={location.name}
              onChange={(event) =>
                setLocation((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label className="form-field">
            <span>{t("address")}</span>
            <input
              value={location.address}
              onChange={(event) =>
                setLocation((current) => ({
                  ...current,
                  address: event.target.value,
                }))
              }
            />
          </label>
          <Suspense
            fallback={<div className="location-map">{t("loading")}</div>}
          >
            <LocationMapPicker
              latitude={
                location.latitude === "" ? null : Number(location.latitude)
              }
              longitude={
                location.longitude === "" ? null : Number(location.longitude)
              }
              radius={Number(location.geofenceRadiusM) || 150}
              onChange={(latitude, longitude) =>
                setLocation((current) => ({
                  ...current,
                  latitude: String(latitude),
                  longitude: String(longitude),
                }))
              }
            />
          </Suspense>
          <label className="form-field">
            <span>{t("geofenceRadius")}</span>
            <input
              type="number"
              min={10}
              max={5000}
              required
              value={location.geofenceRadiusM}
              onChange={(event) =>
                setLocation((current) => ({
                  ...current,
                  geofenceRadiusM: event.target.value,
                }))
              }
            />
          </label>
          <button className="primary-button" disabled={savingSetup}>
            {editingLocationId ? <Pencil size={16} /> : <Plus size={16} />}{" "}
            {editingLocationId ? t("saveLocation") : t("createLocation")}
          </button>
          {editingLocationId && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setEditingLocationId(null);
                setLocation({
                  name: "",
                  address: "",
                  latitude: "",
                  longitude: "",
                  geofenceRadiusM: "150",
                });
              }}
            >
              {t("cancelEdit")}
            </button>
          )}
        </div>
      </form>
      <section className="settings-devices" id="settings-devices">
        <div className="settings-card-heading">
          <span>
            <Smartphone size={19} />
          </span>
          <div>
            <h2>{t("settingsDevices")}</h2>
            <p>{t("settingsDevicesDescription")}</p>
          </div>
        </div>
        <AdvancedPage section="devices" />
      </section>
      <section
        className="panel settings-card audit-card"
        id="settings-activity"
      >
        <div className="settings-card-heading">
          <span>
            <History size={19} />
          </span>
          <div>
            <h2>{t("recentActivity")}</h2>
            <p>{t("activityDescription")}</p>
          </div>
        </div>
        <div className="audit-list">
          {audit.length === 0 ? (
            <p className="audit-empty">{t("noActivity")}</p>
          ) : (
            audit.map((entry) => (
              <article key={entry.id}>
                <span className="audit-dot" />
                <div>
                  <strong>
                    {t(auditActionKeys[entry.action] ?? "auditActivityUpdated")}
                  </strong>
                  <p>
                    {entry.actor || t("system")} ·{" "}
                    {t(auditEntityKeys[entry.entityType] ?? "record")}
                  </p>
                </div>
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString(intlLocale(locale))}
                </time>
              </article>
            ))
          )}
        </div>
      </section>
      <section
        className="panel settings-card integration-card"
        id="settings-integrations"
      >
        <div className="settings-card-heading">
          <span>
            <Send size={19} />
          </span>
          <div>
            <h2>{t("integrationReadiness")}</h2>
            <p>{t("integrationDescription")}</p>
          </div>
        </div>
        <div className="integration-list">
          {integrations &&
            (
              [
                { key: "email", label: t("emailDelivery"), icon: Mail },
                {
                  key: "telegram",
                  label: t("telegramNotifications"),
                  icon: Send,
                },
                { key: "devices", label: t("clockDevices"), icon: Smartphone },
              ] as const
            ).map(({ key, label, icon: Icon }) => {
              const item = integrations[key];
              return (
                <article key={key}>
                  <span>
                    <Icon size={18} />
                  </span>
                  <div>
                    <strong>{label}</strong>
                    <small>
                      {item.state === "ACTIVE"
                        ? t("adapterActive")
                        : item.configured
                          ? t("credentialsPending")
                          : t("setEnvironment", {
                              configuration: item.configuration,
                            })}
                    </small>
                  </div>
                  <em className={item.configured ? "ready" : "not-ready"}>
                    {item.state === "ACTIVE"
                      ? t("activeIntegration")
                      : item.configured
                        ? t("credentialsFound")
                        : t("notConfigured")}
                  </em>
                </article>
              );
            })}
        </div>
      </section>
    </div>
  );
}
