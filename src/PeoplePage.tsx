import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronDown,
  CircleUserRound,
  Download,
  Filter,
  Mail,
  MapPin,
  MoreHorizontal,
  KeyRound,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import {
  hasValidationErrors,
  validateEmployee,
  type EmployeeInput,
  type EmployeeValidationErrors,
} from "./domain/people";
import { apiRequest } from "./api";
import { provisionEmployeeAccount, updateEmployee } from "./workforceApi";
import { formatUzs } from "./domain/payroll";
import { intlLocale, useI18n } from "./i18n";
import { TasksPage } from "./TasksPage";
import { WorkforceReport } from "./WorkforceReport";
import { EmployeeActivity } from "./EmployeeActivity";

type EmploymentStatus = "ACTIVE" | "ON_LEAVE" | "INVITED" | "INACTIVE";
type DirectoryFilter = "ALL" | EmploymentStatus;

interface Person {
  id: string;
  employeeNumber: string;
  initials: string;
  name: string;
  jobTitle: string;
  department: string;
  departmentId: string | null;
  location: string;
  locationId: string | null;
  secondaryLocations: Array<{ id: string; name: string }>;
  phone: string;
  email: string;
  status: EmploymentStatus;
  access: "Employee" | "Location manager" | "Administrator";
  joined: string;
  salaryType?: "MONTHLY" | "HOURLY";
  baseSalary: number;
  hourlyRate: number;
  accountEmail: string;
  accountActive: boolean;
  tone: string;
}

interface DirectoryMeta {
  departments: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
}

interface ApiEmployee {
  id: string;
  employeeNumber: string;
  name: string;
  phone: string;
  email: string | null;
  jobTitle: string;
  accessRole: "EMPLOYEE" | "LOCATION_MANAGER" | "ADMINISTRATOR";
  status: EmploymentStatus;
  joinedOn: string | null;
  departmentId: string | null;
  department: string | null;
  locationId: string | null;
  location: string | null;
  secondaryLocations: Array<{ id: string; name: string }>;
  salaryType?: "MONTHLY" | "HOURLY";
  baseSalary: number;
  hourlyRate: number;
  accountEmail: string | null;
  accountActive: boolean;
}
interface MobileDeviceBinding {
  id: string;
  platform: "ANDROID" | "IOS";
  deviceLabel: string;
  boundAt: string;
  lastSeenAt: string;
}

const tones = ["plum", "blue", "gold", "green", "coral"];
const accessLabels: Record<ApiEmployee["accessRole"], Person["access"]> = {
  EMPLOYEE: "Employee",
  LOCATION_MANAGER: "Location manager",
  ADMINISTRATOR: "Administrator",
};

function toPerson(
  employee: ApiEmployee,
  index: number,
  locale: "en" | "uz" | "ru",
): Person {
  const initials = employee.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return {
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    initials,
    name: employee.name,
    jobTitle: employee.jobTitle,
    department: employee.department ?? "",
    departmentId: employee.departmentId ?? null,
    location: employee.location ?? "",
    locationId: employee.locationId ?? null,
    secondaryLocations: employee.secondaryLocations,
    phone: employee.phone,
    email: employee.email ?? "",
    status: employee.status,
    access: accessLabels[employee.accessRole],
    joined:
      employee.status === "INVITED" && !employee.joinedOn
        ? "INVITATION_PENDING"
        : employee.joinedOn
          ? new Intl.DateTimeFormat(intlLocale(locale), {
              dateStyle: "medium",
            }).format(new Date(employee.joinedOn))
          : "NOT_STARTED",
    salaryType: employee.salaryType ?? "MONTHLY",
    baseSalary: employee.baseSalary,
    hourlyRate: employee.hourlyRate,
    accountEmail: employee.accountEmail ?? "",
    accountActive: employee.accountActive,
    tone: tones[index % tones.length],
  };
}

const statusLabel: Record<EmploymentStatus, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  INVITED: "Invite pending",
  INACTIVE: "Inactive",
};
const statusTranslationKey: Record<EmploymentStatus, string> = {
  ACTIVE: "active",
  ON_LEAVE: "onLeave",
  INVITED: "invitePending",
  INACTIVE: "inactive",
};

const emptyForm: EmployeeInput = {
  name: "",
  phone: "+998 ",
  email: "",
  role: "",
  department: "",
  location: "",
  salaryType: "MONTHLY",
  baseSalary: "",
  hourlyRate: "0",
};

function Avatar({
  person,
  large = false,
}: {
  person: Person;
  large?: boolean;
}) {
  return (
    <span className={`avatar ${person.tone} ${large ? "profile-avatar" : ""}`}>
      {person.initials}
    </span>
  );
}

function SelectField({
  label,
  name,
  value,
  options,
  optionLabels,
  error,
  onChange,
}: {
  label: string;
  name: keyof EmployeeInput;
  value: string;
  options: string[];
  optionLabels?: Record<string, string>;
  error?: string;
  onChange: (name: keyof EmployeeInput, value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label className={`form-field ${error ? "has-error" : ""}`}>
      <span>{label}</span>
      <div className="select-control">
        <select
          value={value}
          onChange={(event) => onChange(name, event.target.value)}
        >
          <option value="">
            {t("selectField", { field: label.toLowerCase() })}
          </option>
          {options.map((option) => (
            <option value={option} key={option}>
              {optionLabels?.[option] ?? option}
            </option>
          ))}
        </select>
        <ChevronDown size={16} />
      </div>
      {error && <small>{error}</small>}
    </label>
  );
}

function AddEmployeeModal({
  onClose,
  onAdd,
  departments,
  locations,
}: {
  onClose: () => void;
  onAdd: (input: EmployeeInput) => Promise<void>;
  departments: string[];
  locations: string[];
}) {
  const { t } = useI18n();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<EmployeeValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const update = (name: keyof EmployeeInput, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const rawErrors = validateEmployee(form);
    const errorKeys: Record<keyof EmployeeInput, string> = {
      salaryType: "salaryType",
      name: "employeeNameRequired",
      phone: "uzbekPhoneRequired",
      email: "validEmailRequired",
      role: "roleRequired",
      department: "departmentRequired",
      location: "primaryLocationRequired",
      baseSalary: "salaryGreaterThanZero",
      hourlyRate: "validHourlyRate",
    };
    const nextErrors = Object.fromEntries(
      Object.keys(rawErrors).map((field) => [
        field,
        t(errorKeys[field as keyof EmployeeInput]),
      ]),
    ) as EmployeeValidationErrors;
    setErrors(nextErrors);
    if (hasValidationErrors(nextErrors)) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await onAdd(form);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : t("createEmployeeFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <button
        className="drawer-scrim"
        onClick={onClose}
        aria-label={t("closeEmployeeForm")}
      />
      <form className="people-modal" onSubmit={submit} noValidate>
        <div className="shift-modal-header">
          <div>
            <p className="eyebrow">{t("employeeOnboarding")}</p>
            <h2>{t("addTeamMember")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </div>
        <p className="modal-intro">{t("onboardingDescription")}</p>
        <div className="people-form-grid">
          <label
            className={`form-field full ${errors.name ? "has-error" : ""}`}
          >
            <span>{t("fullName")}</span>
            <input
              autoFocus
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder={t("employeeNameExample")}
            />
            {errors.name && <small>{errors.name}</small>}
          </label>
          <label className={`form-field ${errors.phone ? "has-error" : ""}`}>
            <span>{t("phoneNumber")}</span>
            <input
              value={form.phone}
              onChange={(event) => update("phone", event.target.value)}
              placeholder="+998 90 123 45 67"
            />
            {errors.phone && <small>{errors.phone}</small>}
          </label>
          <label className={`form-field ${errors.email ? "has-error" : ""}`}>
            <span>
              {t("email")} <em>{t("optional")}</em>
            </span>
            <input
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              placeholder="name@company.uz"
            />
            {errors.email && <small>{errors.email}</small>}
          </label>
          <SelectField
            label={t("jobTitle")}
            name="role"
            value={form.role}
            options={[
              "Sales associate",
              "Store manager",
              "Barista",
              "Courier",
              "Accountant",
              "Stock associate",
            ]}
            optionLabels={{
              "Sales associate": t("salesAssociate"),
              "Store manager": t("storeManager"),
              Barista: t("barista"),
              Courier: t("courier"),
              Accountant: t("accountant"),
              "Stock associate": t("stockAssociate"),
            }}
            error={errors.role}
            onChange={update}
          />
          <SelectField
            label={t("department")}
            name="department"
            value={form.department}
            options={departments}
            error={errors.department}
            onChange={update}
          />
          <SelectField
            label={t("primaryLocation")}
            name="location"
            value={form.location}
            options={locations}
            error={errors.location}
            onChange={update}
          />
          <label className="form-field">
            <span>{t("salaryType")}</span>
            <select
              value={form.salaryType ?? "MONTHLY"}
              onChange={(e) =>
                update("salaryType", e.target.value as "MONTHLY" | "HOURLY")
              }
            >
              <option value="MONTHLY">{t("fixedPay")}</option>
              <option value="HOURLY">{t("hourlyPay")}</option>
            </select>
          </label>
          <label
            className={`form-field ${errors.baseSalary ? "has-error" : ""}`}
          >
            <span>{t("monthlySalary")} (UZS)</span>
            <input
              inputMode="numeric"
              value={form.baseSalary}
              onChange={(event) =>
                update("baseSalary", event.target.value.replace(/[^0-9 ]/g, ""))
              }
              placeholder="6 200 000"
            />
            {errors.baseSalary && <small>{errors.baseSalary}</small>}
          </label>
          <label
            className={`form-field ${errors.hourlyRate ? "has-error" : ""}`}
          >
            <span>{t("hourlyRateLabel")} (UZS)</span>
            <input
              inputMode="numeric"
              value={form.hourlyRate}
              onChange={(event) =>
                update("hourlyRate", event.target.value.replace(/[^0-9 ]/g, ""))
              }
              placeholder="35 000"
            />
            {errors.hourlyRate && <small>{errors.hourlyRate}</small>}
          </label>
          <div className="access-default">
            <ShieldCheck size={18} />
            <div>
              <strong>{t("employeeAccess")}</strong>
              <span>{t("employeeAccessDescription")}</span>
            </div>
            <BadgeCheck size={18} />
          </div>
        </div>
        {submitError && (
          <div className="schedule-error">
            <X size={15} />
            {submitError}
          </div>
        )}
        <div className="shift-modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={submitting}
          >
            {t("cancel")}
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={submitting}
          >
            <UserRoundPlus size={17} />
            {submitting ? t("creatingEmployee") : t("createEmployee")}
          </button>
        </div>
      </form>
    </>
  );
}

function PersonProfile({
  person,
  departments,
  locations,
  onClose,
  onRemove,
  onUpdate,
  onProvision,
  onOpenSchedule,
  onOpenLiveLocations,
}: {
  person: Person;
  departments: DirectoryMeta["departments"];
  locations: DirectoryMeta["locations"];
  onClose: () => void;
  onRemove: () => Promise<void>;
  onOpenSchedule?: (employeeId: string) => void;
  onOpenLiveLocations?: (employeeId: string, name?: string) => void;
  onUpdate: (input: {
    name: string;
    phone: string;
    email: string;
    jobTitle: string;
    departmentId: string;
    locationId: string;
    secondaryLocationIds: string[];
    salaryType?: "MONTHLY" | "HOURLY";
    baseSalary: number;
    hourlyRate: number;
    status: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
    accessRole: "EMPLOYEE" | "LOCATION_MANAGER" | "ADMINISTRATOR";
  }) => Promise<void>;
  onProvision: (input: {
    email: string;
    temporaryPassword: string;
  }) => Promise<{
    invitation: {
      delivered: boolean;
      channel: "email" | "development-log" | "unavailable";
    };
  }>;
}) {
  const { t } = useI18n();
  const accessCode =
    person.access === "Employee"
      ? "EMPLOYEE"
      : person.access === "Location manager"
        ? "LOCATION_MANAGER"
        : "ADMINISTRATOR";
  const [section, setSection] = useState("overview");
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [person.id]);
  const [saved, setSaved] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [deviceRetry, setDeviceRetry] = useState(0);
  const [status, setStatus] = useState<"ACTIVE" | "ON_LEAVE" | "INACTIVE">(
    person.status === "INVITED" ? "ACTIVE" : person.status,
  );
  const [accessRole, setAccessRole] = useState<typeof accessCode>(accessCode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(person.name);
  const [phone, setPhone] = useState(person.phone);
  const [email, setEmail] = useState(person.email);
  const [jobTitle, setJobTitle] = useState(person.jobTitle);
  const [departmentId, setDepartmentId] = useState(person.departmentId ?? "");
  const [locationId, setLocationId] = useState(person.locationId ?? "");
  const [salaryType, setSalaryType] = useState(person.salaryType ?? "MONTHLY");
  const [baseSalary, setBaseSalary] = useState(String(person.baseSalary));
  const [hourlyRate, setHourlyRate] = useState(String(person.hourlyRate));
  const [secondaryLocationIds, setSecondaryLocationIds] = useState(() =>
    person.secondaryLocations.map((location) => location.id),
  );
  const [accountEmail, setAccountEmail] = useState(
    person.accountEmail || person.email,
  );
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [mobileDevice, setMobileDevice] = useState<MobileDeviceBinding | null>(
    null,
  );
  const [deviceLoading, setDeviceLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setDeviceLoading(true);
    setDeviceError("");
    apiRequest<MobileDeviceBinding | null>(
      `/employees/${person.id}/mobile-device`,
    )
      .then((device) => {
        if (active) setMobileDevice(device);
      })
      .catch((reason) => {
        if (active)
          setDeviceError(
            reason instanceof Error ? reason.message : t("loadFailed"),
          );
      })
      .finally(() => {
        if (active) setDeviceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [person.id, deviceRetry]);
  const resetMobileDevice = async () => {
    if (!window.confirm(t("resetMobileDeviceConfirm"))) return;
    setDeviceLoading(true);
    try {
      await apiRequest(`/employees/${person.id}/mobile-device`, {
        method: "DELETE",
      });
      setMobileDevice(null);
      setAccountMessage(t("mobileDeviceReset"));
    } catch (reason) {
      setAccountMessage(
        reason instanceof Error ? reason.message : t("mobileDeviceResetFailed"),
      );
    } finally {
      setDeviceLoading(false);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!departmentId || !locationId)
      return setError(t("chooseDepartmentLocation"));
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await onUpdate({
        name: name.trim(),
        phone,
        email: email.trim(),
        jobTitle: jobTitle.trim(),
        departmentId,
        locationId,
        secondaryLocationIds: secondaryLocationIds.filter(
          (id) => id !== locationId,
        ),
        salaryType,
        baseSalary: Number(baseSalary),
        hourlyRate: Number(hourlyRate),
        status,
        accessRole,
      });
      setSaved(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("updateEmployeeFailed"),
      );
    } finally {
      setSaving(false);
    }
  };
  const provision = async (event: FormEvent) => {
    event.preventDefault();
    if (temporaryPassword.length < 10)
      return setAccountMessage(t("atLeastCharacters", { count: 10 }));
    setProvisioning(true);
    setAccountMessage("");
    try {
      const result = await onProvision({
        email: accountEmail.trim(),
        temporaryPassword,
      });
      setTemporaryPassword("");
      setAccountMessage(
        result.invitation.channel === "email"
          ? t("invitationSent")
          : result.invitation.channel === "development-log"
            ? t("invitationLogged")
            : t("invitationUnavailable"),
      );
    } catch (reason) {
      setAccountMessage(
        reason instanceof Error ? reason.message : t("createLoginFailed"),
      );
    } finally {
      setProvisioning(false);
    }
  };
  return (
    <section className="employee-workspace">
      {error && section !== "employmentDetails" && (
        <p className="operations-error" role="alert">
          {error}
        </p>
      )}
      <button className="text-button employee-back" onClick={onClose}>
        <ArrowLeft size={18} />
        {t("backToPeople")}
      </button>
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("employeeProfile")}</p>
          <h1>{person.name}</h1>
        </div>
        <div className="employee-quick-actions">
          {person.status !== "INACTIVE" && (
            <button
              className="secondary-button"
              disabled={saving}
              onClick={async () => {
                if (!window.confirm(t("removeEmployeeConfirm"))) return;
                setSaving(true);
                try {
                  await onRemove();
                } catch (e) {
                  setError(e instanceof Error ? e.message : t("loadFailed"));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {t("removeEmployee")}
            </button>
          )}
          {onOpenSchedule && (
            <button
              className="secondary-button"
              onClick={() => onOpenSchedule(person.id)}
            >
              {t("openEmployeeSchedule")}
            </button>
          )}
          {onOpenLiveLocations && (
            <button
              className="secondary-button"
              onClick={() => onOpenLiveLocations(person.id, person.name)}
            >
              <MapPin size={16} />
              {t("liveLocations")}
            </button>
          )}
        </div>
      </div>
      <div className="profile-hero">
        <Avatar person={person} large />
        <div>
          <strong>
            {t("employeeId")}: {person.employeeNumber}
          </strong>
          <p>{person.jobTitle}</p>
          <span className={`employment-status ${person.status.toLowerCase()}`}>
            <i />
            {t(statusTranslationKey[person.status])}
          </span>
        </div>
      </div>
      <div
        className="workspace-tabs employee-section-nav"
        aria-label={t("employeeProfile")}
      >
        {["overview", "employmentDetails", "employeeLogin", "attendance"].map(
          (key) => (
            <button
              key={key}
              className={section === key ? "active" : ""}
              aria-pressed={section === key}
              onClick={() => setSection(key)}
            >
              {t(key)}
            </button>
          ),
        )}
      </div>
      {section === "attendance" && (
        <>
          <EmployeeActivity employeeId={person.id} />
          <WorkforceReport employeeId={person.id} />
          <TasksPage employeeId={person.id} />
        </>
      )}
      <div hidden={section !== "overview"} className="employee-overview">
        <section className="profile-section">
          <h3>{t("contactDetails")}</h3>
          <dl className="profile-definition">
            <div>
              <dt>{t("email")}</dt>
              <dd>{person.email || "—"}</dd>
            </div>
            <div>
              <dt>{t("phone")}</dt>
              <dd>{person.phone || "—"}</dd>
            </div>
            <div>
              <dt>{t("department")}</dt>
              <dd>{person.department}</dd>
            </div>
            <div>
              <dt>{t("location")}</dt>
              <dd>{person.location}</dd>
            </div>
          </dl>
        </section>
        <section className="profile-section">
          <h3>{t("employeeAccessSummary")}</h3>
          <p>
            {person.accountActive
              ? t("activeAs", { email: person.accountEmail })
              : t("noLoginAccount")}
          </p>
          <p>
            {deviceLoading
              ? t("loading")
              : deviceError ||
                (mobileDevice
                  ? `${mobileDevice.deviceLabel} · ${mobileDevice.platform}`
                  : t("noLinkedMobileDevice"))}
          </p>
          <button
            className="secondary-button"
            onClick={() => setSection("employeeLogin")}
          >
            {t("manageEmployeeAccess")}
          </button>
        </section>
      </div>
      <form
        hidden={section !== "employmentDetails"}
        className="profile-section profile-edit-form"
        onSubmit={save}
      >
        <h3>{t("editEmploymentProfile")}</h3>
        <label className="form-field">
          <span>{t("fullName")}</span>
          <input
            required
            minLength={2}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="profile-edit-grid">
          <label className="form-field">
            <span>{t("phone")}</span>
            <input
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("email")}</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("jobTitle")}</span>
            <input
              required
              minLength={2}
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("department")}</span>
            <select
              required
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              {departments.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t("primaryLocation")}</span>
            <select
              required
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
          <fieldset className="form-field full">
            <legend>{t("secondaryLocations")}</legend>
            <div className="location-checkboxes">
              {locations
                .filter((item) => item.id !== locationId)
                .map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={secondaryLocationIds.includes(item.id)}
                      onChange={(event) =>
                        setSecondaryLocationIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, item.id])]
                            : current.filter((id) => id !== item.id),
                        )
                      }
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
            </div>
          </fieldset>
          <label className="form-field">
            <span>{t("salaryType")}</span>
            <select
              value={salaryType}
              onChange={(e) =>
                setSalaryType(e.target.value as "MONTHLY" | "HOURLY")
              }
            >
              <option value="MONTHLY">{t("fixedPay")}</option>
              <option value="HOURLY">{t("hourlyPay")}</option>
            </select>
          </label>
          <label className="form-field">
            <span>{t("monthlySalary")}</span>
            <input
              type="number"
              min="0"
              required
              value={baseSalary}
              onChange={(event) => setBaseSalary(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("hourlyRateLabel")}</span>
            <input
              type="number"
              min="0"
              required
              value={hourlyRate}
              onChange={(event) => setHourlyRate(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("accessRole")}</span>
            <select
              value={accessRole}
              onChange={(event) =>
                setAccessRole(event.target.value as typeof accessRole)
              }
            >
              <option value="EMPLOYEE">{t("employee")}</option>
              <option value="LOCATION_MANAGER">{t("locationManager")}</option>
              <option value="ADMINISTRATOR">{t("administrator")}</option>
            </select>
          </label>
          <label className="form-field">
            <span>{t("employmentStatus")}</span>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as typeof status)
              }
            >
              <option value="ACTIVE">{t("active")}</option>
              <option value="ON_LEAVE">{t("onLeave")}</option>
              <option value="INACTIVE">{t("inactive")}</option>
            </select>
          </label>
        </div>
        {error && (
          <div className="schedule-error">
            <X size={15} />
            {error}
          </div>
        )}
        <button className="primary-button wide" disabled={saving}>
          <ShieldCheck size={16} />
          {saving ? t("saving") : t("saveEmployeeChanges")}
        </button>
        {saved && (
          <p role="status">{t("employeeUpdated", { name: person.name })}</p>
        )}
      </form>
      <form
        hidden={section !== "employeeLogin"}
        className="profile-section account-provision"
        onSubmit={provision}
      >
        <h3>{t("employeeLogin")}</h3>
        <div
          className={`account-state ${person.accountActive ? "active" : ""}`}
        >
          <i />
          <span>
            {person.accountActive
              ? t("activeAs", { email: person.accountEmail })
              : t("noLoginAccount")}
          </span>
        </div>
        <label className="form-field">
          <span>{t("loginEmail")}</span>
          <input
            type="email"
            required
            value={accountEmail}
            onChange={(event) => setAccountEmail(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>
            {person.accountActive
              ? t("newTemporaryPassword")
              : t("temporaryPassword")}
          </span>
          <input
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={temporaryPassword}
            onChange={(event) => setTemporaryPassword(event.target.value)}
            placeholder={t("atLeastCharacters", { count: 10 })}
          />
        </label>
        {accountMessage && <p className="account-message">{accountMessage}</p>}
        <button className="secondary-button wide" disabled={provisioning}>
          <KeyRound size={16} />
          {provisioning
            ? t("saving")
            : person.accountActive
              ? t("resetCredentials")
              : t("createLogin")}
        </button>
      </form>
      <section
        hidden={section !== "employeeLogin"}
        className="profile-section account-provision"
      >
        <h3>{t("linkedMobileDevice")}</h3>
        {deviceLoading ? (
          <p>{t("loading")}</p>
        ) : deviceError ? (
          <div role="alert">
            <p className="schedule-error">{deviceError}</p>
            <button
              className="secondary-button"
              onClick={() => setDeviceRetry((value) => value + 1)}
            >
              {t("retry")}
            </button>
          </div>
        ) : mobileDevice ? (
          <>
            <div className="account-state active">
              <Smartphone size={17} />
              <span>
                {mobileDevice.deviceLabel} · {mobileDevice.platform}
              </span>
            </div>
            <p className="account-message">
              {t("lastVerifiedAt", {
                date: new Date(mobileDevice.lastSeenAt).toLocaleString(),
              })}
            </p>
            <button
              type="button"
              className="reject-button wide"
              onClick={() => void resetMobileDevice()}
            >
              {t("resetMobileDevice")}
            </button>
          </>
        ) : (
          <p className="account-message">{t("noLinkedMobileDevice")}</p>
        )}
      </section>
      <section hidden={section !== "overview"} className="profile-section">
        <h3>{t("employment")}</h3>
        <dl className="profile-definition">
          <div>
            <dt>{t("joined")}</dt>
            <dd>
              {person.joined === "INVITATION_PENDING"
                ? t("invitationPending")
                : person.joined === "NOT_STARTED"
                  ? t("notStarted")
                  : person.joined}
            </dd>
          </div>
          <div>
            <dt>{t("employeeId")}</dt>
            <dd>{person.employeeNumber}</dd>
          </div>
          <div>
            <dt>{t("monthlySalary")}</dt>
            <dd>{formatUzs(person.baseSalary)}</dd>
          </div>
          <div>
            <dt>{t("hourlyRateLabel")}</dt>
            <dd>
              {formatUzs(person.hourlyRate)}/{t("hour")}
            </dd>
          </div>
        </dl>
      </section>
    </section>
  );
}

export function PeoplePage({
  companyName,
  initialQuery = "",
  openAddRequest = 0,
  initialEmployeeId,
  onOpenSchedule,
  onOpenLiveLocations,
}: {
  companyName: string;
  initialQuery?: string;
  openAddRequest?: number;
  initialEmployeeId?: string;
  onOpenSchedule?: (employeeId: string) => void;
  onOpenLiveLocations?: (employeeId: string, name?: string) => void;
}) {
  const { t, locale } = useI18n();
  const [people, setPeople] = useState<Person[]>([]);
  const [meta, setMeta] = useState<DirectoryMeta>({
    departments: [],
    locations: [],
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<DirectoryFilter>("ALL");
  const [department, setDepartment] = useState("All departments");
  const [selected, setSelected] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadDirectory = async () => {
    const [employeeRows, directoryMeta] = await Promise.all([
      apiRequest<ApiEmployee[]>("/employees"),
      apiRequest<DirectoryMeta>("/meta"),
    ]);
    const nextPeople = employeeRows.map((employee, index) =>
      toPerson(employee, index, locale),
    );
    setPeople(nextPeople);
    setSelected((current) =>
      current
        ? (nextPeople.find((person) => person.id === current.id) ?? null)
        : null,
    );
    setMeta(directoryMeta);
  };

  useEffect(() => {
    loadDirectory()
      .catch((error) =>
        setLoadError(
          error instanceof Error ? error.message : t("loadDirectoryFailed"),
        ),
      )
      .finally(() => setLoading(false));
  }, [locale]);
  useEffect(() => setQuery(initialQuery), [initialQuery]);
  useEffect(() => {
    if (initialEmployeeId && !loading)
      setSelected(
        people.find((person) => person.id === initialEmployeeId) ?? null,
      );
  }, [initialEmployeeId, loading]);
  useEffect(() => {
    if (openAddRequest > 0) setAdding(true);
  }, [openAddRequest]);

  const filtered = useMemo(
    () =>
      people.filter((person) => {
        const matchesQuery =
          `${person.name} ${person.jobTitle} ${person.department} ${person.location}`
            .toLowerCase()
            .includes(query.toLowerCase());
        const matchesStatus = filter === "ALL" || person.status === filter;
        const matchesDepartment =
          department === "All departments" || person.department === department;
        return matchesQuery && matchesStatus && matchesDepartment;
      }),
    [department, filter, people, query],
  );

  const addEmployee = async (input: EmployeeInput) => {
    const departmentId = meta.departments.find(
      (item) => item.name === input.department,
    )?.id;
    const locationId = meta.locations.find(
      (item) => item.name === input.location,
    )?.id;
    if (!departmentId || !locationId)
      throw new Error(t("chooseValidDepartmentLocation"));
    await apiRequest("/employees", {
      method: "POST",
      body: JSON.stringify({
        name: input.name.trim(),
        phone: input.phone,
        email: input.email,
        jobTitle: input.role,
        departmentId,
        locationId,
        salaryType: input.salaryType ?? "MONTHLY",
        baseSalary: Number(input.baseSalary.replace(/\s/g, "")),
        hourlyRate: Number(input.hourlyRate.replace(/\s/g, "")),
      }),
    });
    await loadDirectory();
    setAdding(false);
    setToast(t("employeeAdded", { name: input.name.trim() }));
    window.setTimeout(() => setToast(null), 2500);
  };

  const updateSelected = async (input: {
    name: string;
    phone: string;
    email: string;
    jobTitle: string;
    departmentId: string;
    locationId: string;
    secondaryLocationIds: string[];
    salaryType?: "MONTHLY" | "HOURLY";
    baseSalary: number;
    hourlyRate: number;
    status: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
    accessRole: "EMPLOYEE" | "LOCATION_MANAGER" | "ADMINISTRATOR";
  }) => {
    if (!selected) return;
    await updateEmployee(selected.id, input);
    await loadDirectory();
    setToast(t("employeeUpdated", { name: input.name }));
    window.setTimeout(() => setToast(null), 2500);
  };
  const provisionSelected = async (input: {
    email: string;
    temporaryPassword: string;
  }) => {
    if (!selected) throw new Error(t("selectEmployee"));
    const result = await provisionEmployeeAccount(selected.id, input);
    setSelected({
      ...selected,
      accountEmail: result.email,
      accountActive: result.active,
      email: result.email,
    });
    await loadDirectory();
    setToast(t("employeeCanSignIn", { name: selected.name }));
    window.setTimeout(() => setToast(null), 2500);
    return result;
  };

  const exportDirectory = () => {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      [
        t("employeeId"),
        t("name"),
        t("jobTitle"),
        t("department"),
        t("location"),
        t("phone"),
        t("email"),
        t("status"),
      ],
      ...filtered.map((person) => [
        person.employeeNumber,
        person.name,
        person.jobTitle,
        person.department,
        person.location,
        person.phone,
        person.email,
        t(statusTranslationKey[person.status]),
      ]),
    ];
    const blob = new Blob(
      [rows.map((row) => row.map(quote).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "atlas-people.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (selected)
    return (
      <PersonProfile
        key={selected.id}
        person={selected}
        departments={meta.departments}
        locations={meta.locations}
        onClose={() => setSelected(null)}
        onRemove={async () => {
          await apiRequest(`/employees/${selected.id}`, { method: "DELETE" });
          await loadDirectory();
          setSelected(null);
        }}
        onUpdate={updateSelected}
        onProvision={provisionSelected}
        onOpenSchedule={onOpenSchedule}
        onOpenLiveLocations={onOpenLiveLocations}
      />
    );

  return (
    <div className="people-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("workspace")}</p>
          <h1>{t("people")}</h1>
          <p>{t("peopleDescription")}</p>
        </div>
        <button className="primary-button" onClick={() => setAdding(true)}>
          <UserRoundPlus size={17} />
          {t("addEmployee")}
        </button>
      </div>
      <div className="people-stats">
        <article>
          <span>
            <UsersRound size={18} />
          </span>
          <div>
            <strong>{people.length}</strong>
            <small>{t("totalPeople")}</small>
          </div>
        </article>
        <article>
          <span>
            <BadgeCheck size={18} />
          </span>
          <div>
            <strong>
              {people.filter((person) => person.status === "ACTIVE").length}
            </strong>
            <small>{t("activeEmployees")}</small>
          </div>
        </article>
        <article>
          <span>
            <Mail size={18} />
          </span>
          <div>
            <strong>
              {people.filter((person) => person.status === "INVITED").length}
            </strong>
            <small>{t("pendingInvites")}</small>
          </div>
        </article>
        <article>
          <span>
            <Building2 size={18} />
          </span>
          <div>
            <strong>{meta.locations.length}</strong>
            <small>{t("workLocations")}</small>
          </div>
        </article>
      </div>
      <section className="panel people-directory">
        <div className="people-toolbar">
          <label className="workspace-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchDirectory")}
            />
          </label>
          <div className="people-filters">
            <div className="select-filter">
              <Filter size={16} />
              <select
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
              >
                <option value="All departments">{t("allDepartments")}</option>
                {meta.departments.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
            <button className="secondary-button" onClick={exportDirectory}>
              <Download size={16} />
              {t("export")}
            </button>
          </div>
        </div>
        <div className="directory-tabs">
          {(["ALL", "ACTIVE", "ON_LEAVE", "INVITED"] as DirectoryFilter[]).map(
            (item) => (
              <button
                className={filter === item ? "active" : ""}
                onClick={() => setFilter(item)}
                key={item}
              >
                {item === "ALL" ? t("everyone") : t(statusTranslationKey[item])}
              </button>
            ),
          )}
        </div>
        {loadError && (
          <div className="schedule-error">
            <X size={15} />
            {loadError}
            <button
              className="text-button"
              onClick={() => {
                setLoadError("");
                setLoading(true);
                loadDirectory()
                  .catch((error) =>
                    setLoadError(
                      error instanceof Error
                        ? error.message
                        : t("loadDirectoryFailed"),
                    ),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              {t("tryAgain")}
            </button>
          </div>
        )}
        <div className="table-wrap">
          <table className="people-table">
            <thead>
              <tr>
                <th>{t("employee")}</th>
                <th>{t("department")}</th>
                <th>{t("primaryLocation")}</th>
                <th>{t("contact")}</th>
                <th>{t("access")}</th>
                <th>{t("status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7}>{t("loadingDirectory")}</td>
                </tr>
              ) : (
                filtered.map((person) => (
                  <tr
                    className="clickable-row"
                    key={person.id}
                    onClick={() => setSelected(person)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        setSelected(person);
                      }
                    }}
                  >
                    <td>
                      <div className="employee-cell">
                        <Avatar person={person} />
                        <div>
                          <strong>{person.name}</strong>
                          <span>{person.jobTitle}</span>
                        </div>
                      </div>
                    </td>
                    <td>{person.department || t("unassigned")}</td>
                    <td>
                      <span className="location-cell">
                        <MapPin size={14} />
                        {person.location || t("unassigned")}
                        {person.secondaryLocations.length > 0 && (
                          <small>+{person.secondaryLocations.length}</small>
                        )}
                      </span>
                    </td>
                    <td>
                      <div className="contact-cell">
                        <span>{person.phone}</span>
                        <small>{person.email}</small>
                      </div>
                    </td>
                    <td>
                      <span className="access-badge">
                        <ShieldCheck size={14} />
                        {person.access === "Employee"
                          ? t("employee")
                          : person.access === "Location manager"
                            ? t("locationManager")
                            : t("administrator")}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`employment-status ${person.status.toLowerCase()}`}
                      >
                        <i />
                        {t(statusTranslationKey[person.status])}
                      </span>
                    </td>
                    <td>
                      <button
                        className="row-menu"
                        aria-label={t("editEmployee", { name: person.name })}
                        title={t("editEmployee", { name: person.name })}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected(person);
                        }}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>
            {t("showingPeople", {
              shown: filtered.length,
              total: people.length,
            })}
          </span>
          <span>{t("scopedTo", { company: companyName })}</span>
        </div>
      </section>
      {adding && (
        <AddEmployeeModal
          onClose={() => setAdding(false)}
          onAdd={addEmployee}
          departments={meta.departments.map((item) => item.name)}
          locations={meta.locations.map((item) => item.name)}
        />
      )}
      <div className={`toast ${toast ? "visible" : ""}`}>
        <Check size={17} />
        {toast}
      </div>
    </div>
  );
}
