import { useEffect, useState, type ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Cpu,
  Lightbulb,
  UsersRound,
  X,
} from "lucide-react";
import { apiRequest } from "./api";
import { useI18n } from "./i18n";

const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode or blocked storage */
    }
  },
};

/**
 * Short "what you can do here" block shown at the top of a workspace.
 * Collapsed state is remembered per page in the browser.
 */
export function PageGuide({
  id,
  steps,
  children,
}: {
  id: string;
  steps: string[];
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const key = `davomat.guide.${id}`;
  const [open, setOpen] = useState(() => storage.get(key) !== "closed");
  return (
    <details
      className="page-guide"
      open={open}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        storage.set(key, next ? "open" : "closed");
      }}
    >
      <summary>
        <Lightbulb size={16} aria-hidden="true" />
        {t("guideTitle")}
      </summary>
      <ol>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {children}
    </details>
  );
}

/** Inline explanation shown next to a control that is disabled or unusual. */
export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="field-hint" role="note">
      {children}
    </p>
  );
}

export type SetupTarget = "Settings" | "People" | "Schedule" | "Devices";

type SetupState = {
  locations: number;
  employees: number;
  schedules: number;
  devices: number;
};

/**
 * First-run checklist for a company that has not finished basic setup.
 * Hidden once every required step is done, or when the manager hides it.
 */
export function SetupChecklist({
  onOpen,
}: {
  onOpen: (target: SetupTarget) => void;
}) {
  const { t } = useI18n();
  const dismissKey = "davomat.setup.hidden";
  const [hidden, setHidden] = useState(() => storage.get(dismissKey) === "1");
  const [state, setState] = useState<SetupState | null>(null);
  useEffect(() => {
    if (hidden) return;
    let active = true;
    const count = (path: string) =>
      apiRequest<unknown[]>(path)
        .then((rows) => (Array.isArray(rows) ? rows.length : 0))
        .catch(() => 0);
    Promise.all([
      apiRequest<{ locations: unknown[] }>("/meta")
        .then((meta) => meta.locations.length)
        .catch(() => 0),
      count("/employees"),
      count("/work-schedules"),
      count("/devices"),
    ]).then(([locations, employees, schedules, devices]) => {
      if (active) setState({ locations, employees, schedules, devices });
    });
    return () => {
      active = false;
    };
  }, [hidden]);
  if (hidden || !state) return null;
  const steps: Array<{
    key: string;
    done: boolean;
    optional?: boolean;
    icon: typeof Building2;
    target: SetupTarget;
  }> = [
    {
      key: "Locations",
      done: state.locations > 0,
      icon: Building2,
      target: "Settings",
    },
    {
      key: "Employees",
      done: state.employees > 0,
      icon: UsersRound,
      target: "People",
    },
    {
      key: "Schedule",
      done: state.schedules > 0,
      icon: CalendarDays,
      target: "Schedule",
    },
    {
      key: "Devices",
      done: state.devices > 0,
      optional: true,
      icon: Cpu,
      target: "Devices",
    },
  ];
  const required = steps.filter((step) => !step.optional);
  const doneCount = required.filter((step) => step.done).length;
  if (doneCount === required.length) return null;
  return (
    <section className="panel setup-checklist" aria-label={t("setupTitle")}>
      <div className="setup-heading">
        <div>
          <p className="eyebrow">{t("startHere")}</p>
          <h2>{t("setupTitle")}</h2>
          <p>{t("setupIntro")}</p>
        </div>
        <div className="setup-progress">
          <strong>
            {t("setupProgress", { done: doneCount, total: required.length })}
          </strong>
          <button
            type="button"
            className="icon-button"
            aria-label={t("setupHide")}
            title={t("setupHide")}
            onClick={() => {
              storage.set(dismissKey, "1");
              setHidden(true);
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <ol className="setup-steps">
        {steps.map(({ key, done, optional, icon: Icon, target }) => (
          <li key={key} className={done ? "done" : ""}>
            <span className="setup-icon" aria-hidden="true">
              {done ? <Check size={16} /> : <Icon size={16} />}
            </span>
            <div>
              <strong>
                {t(`setup${key}`)}
                {optional && <em> · {t("optional")}</em>}
              </strong>
              <small>{t(`setup${key}Help`)}</small>
            </div>
            {done ? (
              <span className="setup-done">{t("setupDone")}</span>
            ) : (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onOpen(target)}
              >
                {t("setupOpen")}
                <ChevronRight size={15} />
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
