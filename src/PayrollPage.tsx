import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  FileCheck2,
  MinusCircle,
  Plus,
  PlusCircle,
  Search,
  Send,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { formatUzs } from "./domain/payroll";
import {
  addPayrollAdjustment,
  approvePayslip,
  approveReadyPayslips,
  fetchPayroll,
  generatePayrollPeriod,
  markPayrollPaid,
  type ApiPayslip,
} from "./workforceApi";
import { tashkentDate } from "./operationsApi";
import { intlLocale, useI18n, type Locale } from "./i18n";
import { AdvancedPage } from "./AdvancedPage";
import { PageGuide, Toast } from "./Guidance";

type PayrollStep = "generate" | "review" | "approve" | "paid" | "done";
const payrollSteps: Array<Exclude<PayrollStep, "done">> = [
  "generate",
  "review",
  "approve",
  "paid",
];
const stepLabelKey: Record<Exclude<PayrollStep, "done">, string> = {
  generate: "payrollStepGenerate",
  review: "payrollStepReview",
  approve: "payrollStepApprove",
  paid: "payrollStepPaid",
};

/** Shows where the period is in Generate → Review → Approve → Paid. */
function PayrollStepper({ step }: { step: PayrollStep }) {
  const { t } = useI18n();
  const index =
    step === "done" ? payrollSteps.length : payrollSteps.indexOf(step);
  return (
    <div className="payroll-stepper" role="group" aria-label={t("payroll")}>
      <ol>
        {payrollSteps.map((name, position) => (
          <li
            key={name}
            className={
              position < index ? "done" : position === index ? "current" : ""
            }
            aria-current={position === index ? "step" : undefined}
          >
            <span>{position < index ? <Check size={13} /> : position + 1}</span>
            {t(stepLabelKey[name])}
          </li>
        ))}
      </ol>
      <p>
        {t(
          step === "done"
            ? "payrollStepDoneHint"
            : `payrollStep${step[0].toUpperCase()}${step.slice(1)}Hint`,
        )}
      </p>
    </div>
  );
}

type PayslipStatus = ApiPayslip["status"];
type PayrollFilter = "ALL" | PayslipStatus;
interface PayrollEmployee extends ApiPayslip {
  initials: string;
  tone: string;
  adjustmentReason?: string;
}
const tones = ["plum", "blue", "gold", "green", "coral"];
const statusLabel: Record<PayslipStatus, string> = {
  READY: "Ready",
  REVIEW: "Needs review",
  APPROVED: "Approved",
  PAID: "Paid",
};
const statusTranslationKey: Record<PayslipStatus, string> = {
  READY: "ready",
  REVIEW: "needsReview",
  APPROVED: "approved",
  PAID: "paid",
};
const toEmployee = (person: ApiPayslip, index: number): PayrollEmployee => ({
  ...person,
  initials: person.employee
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase(),
  tone: tones[index % tones.length],
});
const periodLabel = (start: string, end: string, locale: Locale) =>
  `${new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${start.slice(0, 10)}T00:00:00Z`))} – ${new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${end.slice(0, 10)}T00:00:00Z`))}`;

function PayrollAvatar({ person }: { person: PayrollEmployee }) {
  return <span className={`avatar ${person.tone}`}>{person.initials}</span>;
}

function AdjustmentModal({
  person,
  onClose,
  onSaved,
}: {
  person: PayrollEmployee;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const [type, setType] = useState<"bonus" | "deduction">("bonus");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(amount.replace(/\s/g, ""));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0)
      return setError(t("amountGreaterThanZero"));
    if (reason.trim().length < 3)
      return setError(t("auditableAdjustmentReason"));
    setSaving(true);
    setError("");
    try {
      await addPayrollAdjustment(
        person.id,
        type === "bonus" ? "BONUS" : "DEDUCTION",
        Math.round(numericAmount),
        reason.trim(),
      );
      onSaved();
    } catch (reasonValue) {
      setError(
        reasonValue instanceof Error
          ? reasonValue.message
          : t("saveAdjustmentFailed"),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <button
        className="drawer-scrim"
        onClick={onClose}
        aria-label={t("closeAdjustment")}
      />
      <form className="adjustment-modal" onSubmit={submit}>
        <div className="shift-modal-header">
          <div>
            <p className="eyebrow">{t("payrollAdjustment")}</p>
            <h2>{t("addLineItem")}</h2>
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
        <div className="adjustment-person">
          <PayrollAvatar person={person} />
          <div>
            <strong>{person.employee}</strong>
            <span>{periodLabel(person.startsOn, person.endsOn, locale)}</span>
          </div>
        </div>
        <div className="adjustment-type">
          <button
            type="button"
            className={type === "bonus" ? "active" : ""}
            onClick={() => {
              setType("bonus");
              setError("");
            }}
          >
            <PlusCircle size={18} />
            {t("addition")}
          </button>
          <button
            type="button"
            className={type === "deduction" ? "active" : ""}
            onClick={() => {
              setType("deduction");
              setError("");
            }}
          >
            <MinusCircle size={18} />
            {t("deduction")}
          </button>
        </div>
        <label className="form-field">
          <span>{t("amountUzs")}</span>
          <div className="money-input">
            <input
              inputMode="numeric"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value.replace(/[^0-9 ]/g, ""));
                setError("");
              }}
              placeholder="250 000"
            />
            <strong>UZS</strong>
          </div>
        </label>
        <label className="form-field">
          <span>{t("reason")}</span>
          <textarea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError("");
            }}
            placeholder={t("adjustmentReason")}
          />
        </label>
        {error && (
          <div className="schedule-error">
            <X size={15} />
            {error}
          </div>
        )}
        <div className="audit-notice">
          <ShieldCheck size={17} />
          <span>{t("auditAdjustment")}</span>
        </div>
        <div className="shift-modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={saving}
          >
            {t("cancel")}
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            <Plus size={16} />
            {saving ? t("saving") : t("addAdjustment")}
          </button>
        </div>
      </form>
    </>
  );
}

function PayslipDrawer({
  person,
  onClose,
  onAdjust,
  onApprove,
  onAttendance,
}: {
  person: PayrollEmployee;
  onClose: () => void;
  onAdjust: () => void;
  onApprove: () => Promise<void>;
  onAttendance: () => void;
}) {
  const { t, locale } = useI18n();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const completion =
    person.expectedMinutes > 0
      ? Math.min(
          100,
          Math.round((person.workedMinutes / person.expectedMinutes) * 100),
        )
      : 0;
  const approve = async () => {
    setSaving(true);
    setError("");
    try {
      await onApprove();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("approvePayslipFailed"),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <button
        className="drawer-scrim"
        onClick={onClose}
        aria-label={t("closePayslip")}
      />
      <aside className="attendance-drawer payroll-drawer">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">{t("payslipCalculation")}</p>
            <h2>{periodLabel(person.startsOn, person.endsOn, locale)}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="payroll-person">
          <PayrollAvatar person={person} />
          <div>
            <strong>{person.employee}</strong>
            <span>{person.role}</span>
          </div>
          <span className={`payslip-status ${person.status.toLowerCase()}`}>
            <i />
            {t(statusTranslationKey[person.status])}
          </span>
        </div>
        {person.attendanceIssue && (
          <div className="payroll-warning">
            <AlertTriangle size={17} />
            <div>
              <strong>{t("attendanceReviewNeeded")}</strong>
              <span>{t("attendanceExceptionsRequireReview")}</span>
            </div>
          </div>
        )}
        <section className="payroll-drawer-section">
          <div className="section-title-row">
            <h3>{t("earnings")}</h3>
            <button onClick={onAdjust}>
              <Plus size={14} />
              {t("adjustment")}
            </button>
          </div>
          <dl className="payroll-lines">
            <div>
              <dt>
                <span>{t("baseSalary")}</span>
                <small>{t("monthlyAgreement")}</small>
              </dt>
              <dd>{formatUzs(person.baseSalary)}</dd>
            </div>
            <div>
              <dt>
                <span>{t("overtime")}</span>
                <small>
                  {t("minutesShort", { count: person.overtimeMinutes })} ×{" "}
                  {formatUzs(person.hourlyRate)}/{t("hour")}
                </small>
              </dt>
              <dd>+ {formatUzs(person.overtimePay)}</dd>
            </div>
            <div>
              <dt>
                <span>{t("nightWork")}</span>
                <small>
                  {t("minutesShort", { count: person.nightMinutes })}
                </small>
              </dt>
              <dd>+ {formatUzs(person.nightPay)}</dd>
            </div>
            <div>
              <dt>
                <span>{t("holidayWork")}</span>
                <small>
                  {t("minutesShort", { count: person.holidayMinutes })}
                </small>
              </dt>
              <dd>+ {formatUzs(person.holidayPay)}</dd>
            </div>
            <div>
              <dt>
                <span>{t("benefits")}</span>
                <small>{t("configuredBenefits")}</small>
              </dt>
              <dd>+ {formatUzs(person.benefits)}</dd>
            </div>
            <div>
              <dt>
                <span>{t("bonuses")}</span>
                <small>{t("approvedAdditions")}</small>
              </dt>
              <dd>+ {formatUzs(person.bonuses)}</dd>
            </div>
          </dl>
          <div className="payroll-subtotal">
            <span>{t("grossEarnings")}</span>
            <strong>{formatUzs(person.grossPay)}</strong>
          </div>
        </section>
        <section className="payroll-drawer-section">
          <div className="section-title-row">
            <h3>{t("deductions")}</h3>
            <button onClick={onAdjust}>
              <Plus size={14} />
              {t("adjustment")}
            </button>
          </div>
          <dl className="payroll-lines">
            <div>
              <dt>
                <span>{t("incomeTax")}</span>
                <small>{t("configuredRule")}</small>
              </dt>
              <dd>− {formatUzs(person.tax)}</dd>
            </div>
            <div>
              <dt>
                <span>{t("otherDeductions")}</span>
                <small>{t("manualAdjustments")}</small>
              </dt>
              <dd>− {formatUzs(person.deductions)}</dd>
            </div>
          </dl>
        </section>
        <section className="attendance-basis">
          <div className="section-title-row">
            <h3>{t("attendanceBasis")}</h3>
            <span>{t("complete", { count: completion })}</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${completion}%` }} />
          </div>
          <div className="basis-grid">
            <div>
              <span>{t("expected")}</span>
              <strong>{Math.round(person.expectedMinutes / 60)}h</strong>
            </div>
            <div>
              <span>{t("recorded")}</span>
              <strong>
                {Math.floor(person.workedMinutes / 60)}h{" "}
                {person.workedMinutes % 60}m
              </strong>
            </div>
            <div>
              <span>{t("overtime")}</span>
              <strong>
                {Math.floor(person.overtimeMinutes / 60)}h{" "}
                {person.overtimeMinutes % 60}m
              </strong>
            </div>
          </div>
          <button className="secondary-button wide" onClick={onAttendance}>
            <Clock3 size={16} />
            {t("inspectAttendance")}
          </button>
        </section>
        <div className="net-pay-card">
          <span>{t("netAmount")}</span>
          <strong>{formatUzs(person.netPay)}</strong>
          <small>{t("afterDeductions")}</small>
        </div>
        {error && (
          <div className="schedule-error">
            <X size={15} />
            {error}
          </div>
        )}
        <div className="drawer-payroll-actions">
          <button className="secondary-button" onClick={() => window.print()}>
            <Download size={16} />
            {t("printPreview")}
          </button>
          {person.status !== "APPROVED" && person.status !== "PAID" && (
            <button
              className="primary-button"
              disabled={person.status === "REVIEW" || saving}
              onClick={approve}
            >
              <Check size={16} />
              {saving ? t("approving") : t("approvePayslip")}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

export function PayrollPage({
  onOpenAttendance,
}: {
  onOpenAttendance: () => void;
}) {
  const { t, locale } = useI18n();
  const [payroll, setPayroll] = useState<PayrollEmployee[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PayrollFilter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [runningAction, setRunningAction] = useState<
    "generate" | "approve" | "pay" | null
  >(null);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await fetchPayroll();
      const mapped = rows.map(toEmployee);
      setPayroll(mapped);
      setSelectedPeriod((current) => current || mapped[0]?.periodId || "");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("loadPayrollFailed"),
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const periods = useMemo(
    () => [
      ...new Map(
        payroll.map((person) => [
          person.periodId,
          { id: person.periodId, start: person.startsOn, end: person.endsOn },
        ]),
      ).values(),
    ],
    [payroll],
  );
  const periodPayroll = payroll.filter(
    (person) => person.periodId === selectedPeriod,
  );
  const selected = payroll.find((person) => person.id === selectedId) ?? null;
  const filtered = useMemo(
    () =>
      periodPayroll.filter(
        (person) =>
          `${person.employee} ${person.role}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (filter === "ALL" || person.status === filter),
      ),
    [filter, periodPayroll, query],
  );
  const totals = periodPayroll.reduce(
    (sum, person) => ({
      gross: sum.gross + person.grossPay,
      deductions: sum.deductions + person.deductions + person.tax,
      net: sum.net + person.netPay,
    }),
    { gross: 0, deductions: 0, net: 0 },
  );
  const completed = periodPayroll.filter((person) =>
    ["READY", "APPROVED", "PAID"].includes(person.status),
  ).length;
  const readiness = periodPayroll.length
    ? Math.round((completed / periodPayroll.length) * 100)
    : 0;
  const reviewCount = periodPayroll.filter(
    (person) => person.status === "REVIEW",
  ).length;
  const [payrollTab, setPayrollTab] = useState<"payslips" | "rules">(
    "payslips",
  );
  const step: PayrollStep = !periodPayroll.length
    ? "generate"
    : reviewCount > 0
      ? "review"
      : periodPayroll.some((person) => person.status === "READY")
        ? "approve"
        : periodPayroll.every((person) => person.status === "PAID")
          ? "done"
          : "paid";
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 5000);
  };
  const approve = async (id: string) => {
    await approvePayslip(id);
    notify(t("payslipApprovedAudit"));
    await load();
  };
  const approveAll = async () => {
    if (!selectedPeriod || runningAction) return;
    setRunningAction("approve");
    setError("");
    try {
      const result = await approveReadyPayslips(selectedPeriod);
      notify(
        result.approved
          ? t("readyPayslipsApproved", { count: result.approved })
          : t("noPayslipsToApprove"),
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("approvePayrollFailed"),
      );
    } finally {
      setRunningAction(null);
    }
  };
  const markPaid = async () => {
    if (!selectedPeriod || runningAction) return;
    setRunningAction("pay");
    setError("");
    try {
      const result = await markPayrollPaid(selectedPeriod);
      notify(
        result.paid
          ? t("payslipsMarkedPaid", { count: result.paid })
          : t("payrollAlreadyPaid"),
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("markPayrollPaidFailed"),
      );
    } finally {
      setRunningAction(null);
    }
  };
  const generate = async () => {
    if (runningAction) return;
    setRunningAction("generate");
    setError("");
    const today = tashkentDate();
    const startsOn = `${today.slice(0, 7)}-01`;
    const nextMonth = new Date(`${startsOn}T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    nextMonth.setUTCDate(0);
    const endsOn = nextMonth.toISOString().slice(0, 10);
    try {
      const result = await generatePayrollPeriod(startsOn, endsOn);
      notify(
        result.created
          ? t("payslipsGenerated", { count: result.created })
          : t("payrollPeriodExists"),
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("generatePayrollFailed"),
      );
    } finally {
      setRunningAction(null);
    }
  };
  const exportCsv = () => {
    const quote = (value: string | number) =>
      `"${String(value).replaceAll('"', '""')}"`;
    const rows = [
      [
        t("employee"),
        t("baseSalary"),
        t("overtimePay"),
        t("nightWork"),
        t("holidayWork"),
        t("benefits"),
        t("bonuses"),
        t("deductions"),
        t("tax"),
        t("netPay"),
        t("status"),
      ],
      ...periodPayroll.map((person) => [
        person.employee,
        person.baseSalary,
        person.overtimePay,
        person.nightPay,
        person.holidayPay,
        person.benefits,
        person.bonuses,
        person.deductions,
        person.tax,
        person.netPay,
        t(statusTranslationKey[person.status]),
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((row) => row.map(quote).join(",")).join("\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `atlas-payroll-${periodPayroll[0]?.startsOn?.slice(0, 7) ?? "export"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify(t("payrollCsvExported"));
  };
  const activePeriod = periodPayroll[0];
  return (
    <div className="payroll-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("workspace")}</p>
          <h1>{t("payroll")}</h1>
          <p>{t("payrollDescription")}</p>
        </div>
        <div className="schedule-heading-actions">
          <button
            className="secondary-button"
            onClick={generate}
            disabled={runningAction !== null}
          >
            <Plus size={16} />
            {runningAction === "generate"
              ? t("generating")
              : t("generateMonth")}
          </button>
          <button
            className="secondary-button"
            onClick={exportCsv}
            disabled={!periodPayroll.length || runningAction !== null}
          >
            <Download size={16} />
            {t("exportCsv")}
          </button>
          <button
            className="primary-button"
            onClick={approveAll}
            disabled={
              runningAction !== null ||
              !periodPayroll.some((person) => person.status === "READY")
            }
            title={
              !periodPayroll.some((person) => person.status === "READY")
                ? t("noReadyPayslips")
                : undefined
            }
          >
            <Send size={16} />
            {runningAction === "approve" ? t("approving") : t("approveReady")}
          </button>
          <button
            className="primary-button"
            onClick={markPaid}
            disabled={
              runningAction !== null ||
              !periodPayroll.length ||
              periodPayroll.some(
                (person) => !["APPROVED", "PAID"].includes(person.status),
              ) ||
              periodPayroll.every((person) => person.status === "PAID")
            }
            title={
              periodPayroll.some(
                (person) => !["APPROVED", "PAID"].includes(person.status),
              )
                ? t("approveBeforePaid")
                : undefined
            }
          >
            <CheckCircle2 size={16} />
            {runningAction === "pay" ? t("markingPaid") : t("markPaid")}
          </button>
        </div>
      </div>
      {error && (
        <div className="operations-error">
          <X size={17} />
          <span>{error}</span>
          <button onClick={load}>{t("tryAgain")}</button>
        </div>
      )}
      <PageGuide
        id="payroll"
        steps={[t("guidePayroll1"), t("guidePayroll2"), t("guidePayroll3")]}
      />
      <div className="workspace-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={payrollTab === "payslips"}
          className={payrollTab === "payslips" ? "active" : ""}
          onClick={() => setPayrollTab("payslips")}
        >
          {t("payrollTabPayslips")} <span>{periodPayroll.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={payrollTab === "rules"}
          className={payrollTab === "rules" ? "active" : ""}
          onClick={() => setPayrollTab("rules")}
        >
          {t("payrollTabRules")}
        </button>
      </div>
      {payrollTab === "rules" && <AdvancedPage section="payroll" />}
      <div hidden={payrollTab !== "payslips"}>
        <PayrollStepper step={step} />
        <section className="payroll-hero">
          <div>
            <span className="hero-icon">
              <WalletCards size={23} />
            </span>
            <div>
              <p>{t("estimatedNetPayroll")}</p>
              <strong>{formatUzs(totals.net)}</strong>
              <span>
                {activePeriod
                  ? periodLabel(
                      activePeriod.startsOn,
                      activePeriod.endsOn,
                      locale,
                    )
                  : t("noPeriodSelected")}{" "}
                · {t("payslipCount", { count: periodPayroll.length })}
              </span>
            </div>
          </div>
          <div className="payroll-progress">
            <div>
              <span>{t("periodReadiness")}</span>
              <strong>{readiness}%</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${readiness}%` }} />
            </div>
            <p>
              <CheckCircle2 size={15} />
              {t("readyApproved", { count: completed })} <span>·</span>
              <AlertTriangle size={15} />
              {t("needReviewCount", { count: reviewCount })}
            </p>
          </div>
        </section>
        <div className="payroll-summary">
          <article>
            <span>
              <CircleDollarSign size={18} />
            </span>
            <div>
              <small>{t("grossEarnings")}</small>
              <strong>{formatUzs(totals.gross)}</strong>
            </div>
          </article>
          <article>
            <span>
              <MinusCircle size={18} />
            </span>
            <div>
              <small>{t("taxDeductions")}</small>
              <strong>{formatUzs(totals.deductions)}</strong>
            </div>
          </article>
          <article>
            <span>
              <Banknote size={18} />
            </span>
            <div>
              <small>{t("netPayable")}</small>
              <strong>{formatUzs(totals.net)}</strong>
            </div>
          </article>
          <article>
            <span>
              <FileCheck2 size={18} />
            </span>
            <div>
              <small>{t("approvedPayslips")}</small>
              <strong>
                {t("countOf", {
                  count: periodPayroll.filter((person) =>
                    ["APPROVED", "PAID"].includes(person.status),
                  ).length,
                  total: periodPayroll.length,
                })}
              </strong>
            </div>
          </article>
        </div>
        <section className="panel payroll-workspace">
          <div className="payroll-toolbar">
            <label className="workspace-search">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchEmployee")}
              />
            </label>
            <div className="payroll-filters">
              <label className="payroll-period-select">
                <CalendarDays size={16} />
                <select
                  value={selectedPeriod}
                  onChange={(event) => setSelectedPeriod(event.target.value)}
                >
                  {periods.length ? (
                    <>
                      {periods.map((period) => (
                        <option value={period.id} key={period.id}>
                          {periodLabel(period.start, period.end, locale)}
                        </option>
                      ))}
                    </>
                  ) : (
                    <option value="">{t("noPayrollPeriods")}</option>
                  )}
                </select>
                <ChevronDown size={15} />
              </label>
              {(
                [
                  "ALL",
                  "READY",
                  "REVIEW",
                  "APPROVED",
                  "PAID",
                ] as PayrollFilter[]
              ).map((item) => (
                <button
                  className={filter === item ? "active" : ""}
                  key={item}
                  onClick={() => setFilter(item)}
                >
                  {item === "ALL" ? t("all") : t(statusTranslationKey[item])}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>{t("employee")}</th>
                  <th>{t("baseSalary")}</th>
                  <th>{t("overtime")}</th>
                  <th>{t("additions")}</th>
                  <th>{t("deductionsTax")}</th>
                  <th>{t("netPay")}</th>
                  <th>{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7}>{t("loadingPayroll")}</td>
                  </tr>
                ) : filtered.length ? (
                  filtered.map((person) => (
                    <tr
                      className="clickable-row"
                      key={person.id}
                      onClick={() => setSelectedId(person.id)}
                    >
                      <td>
                        <div className="employee-cell">
                          <PayrollAvatar person={person} />
                          <div>
                            <strong>{person.employee}</strong>
                            <span>{person.role}</span>
                          </div>
                        </div>
                      </td>
                      <td className="mono">{formatUzs(person.baseSalary)}</td>
                      <td className="positive-value">
                        + {formatUzs(person.overtimePay)}
                      </td>
                      <td className="positive-value">
                        + {formatUzs(person.bonuses)}
                      </td>
                      <td className="negative-value">
                        − {formatUzs(person.deductions + person.tax)}
                      </td>
                      <td className="net-value">{formatUzs(person.netPay)}</td>
                      <td>
                        <span
                          className={`payslip-status ${person.status.toLowerCase()}`}
                        >
                          <i />
                          {t(statusTranslationKey[person.status])}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">
                        <span>
                          <WalletCards size={22} />
                        </span>
                        <strong>{t("noPayslips")}</strong>
                        {!periodPayroll.length && (
                          <button
                            type="button"
                            className="primary-button"
                            onClick={generate}
                            disabled={runningAction !== null}
                          >
                            <Plus size={16} />
                            {runningAction === "generate"
                              ? t("generating")
                              : t("generateMonth")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>{t("payslipsShown", { count: filtered.length })}</span>
            <span>{t("openCalculation")}</span>
          </div>
        </section>
      </div>
      {selected && !adjusting && (
        <PayslipDrawer
          person={selected}
          onClose={() => setSelectedId(null)}
          onAdjust={() => setAdjusting(true)}
          onApprove={() => approve(selected.id)}
          onAttendance={onOpenAttendance}
        />
      )}{" "}
      {selected && adjusting && (
        <AdjustmentModal
          person={selected}
          onClose={() => setAdjusting(false)}
          onSaved={() => {
            setAdjusting(false);
            notify(t("adjustmentSavedRecalculated"));
            void load();
          }}
        />
      )}
      <Toast message={toast || null} onDismiss={() => setToast("")} />
    </div>
  );
}
