import { useEffect, useState, useRef, type FormEvent } from "react";
import {
  CalendarDays,
  Repeat2,
  Plus,
  Pencil,
  Pause,
  ArrowRight,
  X,
  CheckCircle2,
} from "lucide-react";
import { apiRequest } from "./api";
import { useI18n, intlLocale } from "./i18n";
import { scheduleText } from "./scheduleCopy";
import { tashkentDate } from "./operationsApi";
import "./weekly-schedules.css";
export interface WeeklyRule {
  id?: string;
  name: string;
  scope: "ALL" | "DEPARTMENT" | "LOCATION" | "EMPLOYEE";
  scopeId: string | null;
  scopeName?: string;
  locationId: string | null;
  weekdays: number[];
  startsAt: string;
  endsAt: string;
  unpaidBreakMinutes: number;
  graceMinutes: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  active: boolean;
  autoPublish?: boolean;
  generatedUntil?: string | null;
}
type Option = { id: string; name: string };
export function WeeklySchedules({ onChanged }: { onChanged: () => void }) {
  const { locale } = useI18n();
  const label = (k: string) => scheduleText(locale, k);
  const [rules, setRules] = useState<WeeklyRule[]>([]),
    [form, setForm] = useState<WeeklyRule | null>(null),
    [pause, setPause] = useState<WeeklyRule | null>(null);
  const [meta, setMeta] = useState<{
      locations: Option[];
      departments: Option[];
    }>({ locations: [], departments: [] }),
    [employees, setEmployees] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const modalOpen = Boolean(form || pause);
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
      const first = items[0],
        last = items.at(-1);
      if (!first) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.current?.querySelector<HTMLElement>("input,button")?.focus();
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modalOpen]);
  const day = (d: number) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 0, 4 + d)));
  const load = async () => {
    try {
      const [r, m, e] = await Promise.all([
        apiRequest<WeeklyRule[]>("/work-schedules"),
        apiRequest<typeof meta>("/meta"),
        apiRequest<Option[]>("/employees"),
      ]);
      setRules(r);
      setMeta(m);
      setEmployees(e);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const start = (rule?: WeeklyRule) => {
    setError("");
    setMessage("");
    setForm(
      rule
        ? { ...rule, active: true }
        : {
            name: label("weekly"),
            scope: "ALL",
            scopeId: null,
            locationId: null,
            weekdays: [1, 2, 3, 4, 5],
            startsAt: "09:00",
            endsAt: "18:00",
            unpaidBreakMinutes: 0,
            graceMinutes: 5,
            effectiveFrom: tashkentDate(),
            effectiveUntil: null,
            active: true,
          },
    );
  };
  useEffect(() => {
    if (!form && !pause) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setForm(null);
        setPause(null);
      }
    };
    document.addEventListener("keydown", handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = previous;
    };
  }, [form, pause, busy]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await apiRequest<{ created: number; preserved: number }>(
        `/work-schedules${form.id ? `/${form.id}` : ""}`,
        { method: form.id ? "PUT" : "POST", body: JSON.stringify(form) },
      );
      setMessage(
        `${label("saved")} ${r.created}. ${label("preserved")} ${r.preserved}.`,
      );
      setForm(null);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!pause || busy) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/work-schedules/${pause.id}`, { method: "DELETE" });
      setPause(null);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choices =
    form?.scope === "EMPLOYEE"
      ? employees
      : form?.scope === "DEPARTMENT"
        ? meta.departments
        : meta.locations;
  return (
    <section className="weekly-section" aria-label={label("weekly")}>
      <div className="weekly-intro">
        <div className="weekly-intro-icon">
          <Repeat2 size={25} />
        </div>
        <div>
          <p className="eyebrow">{label("weekly")}</p>
          <h2>{label("title")}</h2>
          <p>{label("help")}</p>
        </div>
        <button
          className="primary-button"
          onClick={() => start()}
          disabled={loading}
        >
          <Plus size={17} />
          {label("add")}
        </button>
      </div>
      {message && (
        <div className="weekly-success" role="status">
          <CheckCircle2 size={19} />
          {message}
        </div>
      )}
      {error && !form && !pause && (
        <div className="operations-error" role="alert">
          {error}
          <button
            onClick={() => {
              setError("");
              void load();
            }}
          >
            ↻
          </button>
        </div>
      )}
      {!loading && rules.length === 0 && (
        <p className="weekly-empty">{label("empty")}</p>
      )}
      <div className="weekly-rules">
        {rules.map((r) => (
          <article className="weekly-rule" key={r.id}>
            <div className="weekly-rule-heading">
              <span
                className={`weekly-state ${r.active && r.autoPublish ? "is-active" : ""}`}
              >
                <span />
                {label(
                  !r.active ? "paused" : r.autoPublish ? "running" : "imported",
                )}
              </span>
              <div className="weekly-rule-actions">
                <button
                  className="icon-button"
                  title={label("edit")}
                  aria-label={`${label("edit")}: ${r.name}`}
                  onClick={() => start(r)}
                >
                  <Pencil size={17} />
                </button>
                {r.active && r.autoPublish ? (
                  <button
                    className="icon-button"
                    title={label("pause")}
                    aria-label={`${label("pause")}: ${r.name}`}
                    onClick={() => {
                      setPause(r);
                      setError("");
                    }}
                  >
                    <Pause size={17} />
                  </button>
                ) : (
                  <button className="text-button" onClick={() => start(r)}>
                    {label("resume")}
                    <ArrowRight size={15} />
                  </button>
                )}
              </div>
            </div>
            <h3>{r.scope === "ALL" ? label("everyone") : r.scopeName}</h3>
            <p className="weekly-time">
              {r.startsAt}–{r.endsAt}
            </p>
            <div className="weekly-days">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <span
                  key={d}
                  className={r.weekdays.includes(d) ? "selected" : ""}
                >
                  {day(d)}
                </span>
              ))}
            </div>
            <p className="weekly-rule-note">
              {r.effectiveFrom} · {r.effectiveUntil ?? label("forever")}
            </p>
            {r.generatedUntil && r.active && r.autoPublish && (
              <small>
                {label("generated")} {r.generatedUntil}
              </small>
            )}
          </article>
        ))}
      </div>
      {(form || pause) && (
        <div
          className="modal-backdrop weekly-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setForm(null);
              setPause(null);
            }
          }}
        >
          <section
            ref={dialog}
            className="weekly-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="weekly-dialog-title"
          >
            <header>
              <div>
                <p className="eyebrow">{label("weekly")}</p>
                <h2 id="weekly-dialog-title">
                  {label(pause ? "pause" : form?.id ? "edit" : "add")}
                </h2>
              </div>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={label("cancel")}
                onClick={() => {
                  setForm(null);
                  setPause(null);
                }}
              >
                <X size={20} />
              </button>
            </header>
            {error && (
              <div className="operations-error" role="alert">
                {error}
              </div>
            )}
            {pause ? (
              <>
                <p>{label("pausedHint")}</p>
                <footer>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setPause(null)}
                  >
                    {label("cancel")}
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void stop()}
                  >
                    {label("pause")}
                  </button>
                </footer>
              </>
            ) : (
              form && (
                <form onSubmit={save}>
                  <fieldset disabled={busy}>
                    <label className="form-field">
                      <span>{label("name")}</span>
                      <input
                        autoFocus
                        required
                        maxLength={120}
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                      />
                    </label>
                    <div className="field-grid">
                      <label className="form-field">
                        <span>{label("who")}</span>
                        <select
                          value={form.scope}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              scope: e.target.value as WeeklyRule["scope"],
                              scopeId: null,
                            })
                          }
                        >
                          <option value="ALL">{label("everyone")}</option>
                          <option value="DEPARTMENT">{label("department")}</option>
                          <option value="LOCATION">{label("location")}</option>
                          <option value="EMPLOYEE">{label("employee")}</option>
                        </select>
                      </label>
                      {form.scope !== "ALL" && (
                        <label className="form-field">
                          <span>{label(form.scope.toLowerCase())}</span>
                          <select
                            required
                            value={form.scopeId ?? ""}
                            onChange={(e) =>
                              setForm({ ...form, scopeId: e.target.value })
                            }
                          >
                            <option value="">{label("choose")}</option>
                            {choices.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    <div className="form-field">
                      <span>{label("days")}</span>
                      <div className="weekly-picker">
                        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                          <button
                            type="button"
                            key={d}
                            aria-pressed={form.weekdays.includes(d)}
                            className={
                              form.weekdays.includes(d) ? "selected" : ""
                            }
                            onClick={() =>
                              setForm({
                                ...form,
                                weekdays: form.weekdays.includes(d)
                                  ? form.weekdays.length === 1
                                    ? form.weekdays
                                    : form.weekdays.filter((x) => x !== d)
                                  : [...form.weekdays, d].sort(),
                              })
                            }
                          >
                            {day(d)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="field-grid">
                      <label className="form-field">
                        <span>{label("starts")}</span>
                        <input
                          type="time"
                          required
                          value={form.startsAt}
                          onChange={(e) =>
                            setForm({ ...form, startsAt: e.target.value })
                          }
                        />
                      </label>
                      <label className="form-field">
                        <span>{label("ends")}</span>
                        <input
                          type="time"
                          required
                          value={form.endsAt}
                          onChange={(e) =>
                            setForm({ ...form, endsAt: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <label className="form-field">
                      <span>{label("from")}</span>
                      <input
                        type="date"
                        required
                        value={form.effectiveFrom}
                        onChange={(e) =>
                          setForm({ ...form, effectiveFrom: e.target.value })
                        }
                      />
                    </label>
                    <details className="weekly-details">
                      <summary>{label("details")}</summary>
                      <div className="field-grid">
                        <label className="form-field">
                          <span>{label("break")}</span>
                          <input
                            type="number"
                            min="0"
                            max="600"
                            required
                            value={form.unpaidBreakMinutes}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                unpaidBreakMinutes: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="form-field">
                          <span>{label("grace")}</span>
                          <input
                            type="number"
                            min="0"
                            max="120"
                            required
                            value={form.graceMinutes}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                graceMinutes: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      <label className="form-field">
                        <span>{label("location")}</span>
                        <select
                          value={form.locationId ?? ""}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              locationId: e.target.value || null,
                            })
                          }
                        >
                          <option value="">{label("assigned")}</option>
                          {meta.locations.map((l) => (
                            <option value={l.id} key={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field">
                        <span>{label("until")}</span>
                        <input
                          type="date"
                          min={form.effectiveFrom}
                          value={form.effectiveUntil ?? ""}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              effectiveUntil: e.target.value || null,
                            })
                          }
                        />
                      </label>
                    </details>
                    <div className="weekly-preview">
                      <CalendarDays size={21} />
                      <div>
                        <strong>
                          {label("preview")}: {form.weekdays.map(day).join(", ")} ·{" "}
                          {form.startsAt}–{form.endsAt}
                        </strong>
                        <p>{label("exception")}</p>
                      </div>
                    </div>
                  </fieldset>
                  <footer>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setForm(null)}
                    >
                      {label("cancel")}
                    </button>
                    <button className="primary-button" disabled={busy}>
                      {label(busy ? "saving" : "activate")}
                    </button>
                  </footer>
                </form>
              )
            )}
          </section>
        </div>
      )}
    </section>
  );
}
