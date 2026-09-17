import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  MapPin,
  MessageSquareText,
} from "lucide-react";
import { apiRequest } from "./api";
import { intlLocale, useI18n } from "./i18n";
import { PageGuide } from "./Guidance";

export interface Task {
  id: string;
  employeeId: string;
  employee: string;
  title: string;
  description: string;
  dueAt: string;
  priority: string;
  status: "NEW" | "IN_PROGRESS" | "DONE";
  completedAt?: string | null;
  locationId?: string | null;
  location?: string | null;
  completionNote?: string;
  managerNote?: string;
}
type Lane = "overdue" | "NEW" | "IN_PROGRESS" | "DONE";
const DEFAULT_TIME_ZONE = "Asia/Tashkent";

export function laneFor(task: Task, now = Date.now()): Lane {
  if (task.status === "DONE") return "DONE";
  if (Date.parse(task.dueAt) < now) return "overdue";
  return task.status;
}

/** Note the employee leaves when completing, or the manager's comment. */
function TaskNoteForm({
  label,
  placeholder,
  confirmLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder: string;
  confirmLabel: string;
  busy: boolean;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  return (
    <form
      className="task-note-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(note.trim());
      }}
    >
      <label className="form-field">
        <span>{label}</span>
        <textarea
          rows={2}
          maxLength={2000}
          autoFocus
          value={note}
          placeholder={placeholder}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="task-note-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={onCancel}
          disabled={busy}
        >
          {t("cancel")}
        </button>
        <button className="primary-button" disabled={busy}>
          <Check size={15} />
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}

export function TasksPage({
  employee = false,
  employeeId,
  timeZone = DEFAULT_TIME_ZONE,
}: {
  employee?: boolean;
  employeeId?: string;
  /** Company timezone, so deadlines read the same for everyone. */
  timeZone?: string;
}) {
  const { t, locale } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<
    { id: string; name: string; status: string }[]
  >([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [personFilter, setPersonFilter] = useState(employeeId ?? "");
  const [showDone, setShowDone] = useState(false);
  const [noteFor, setNoteFor] = useState<{
    task: Task;
    status: Task["status"];
  } | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    employeeId: employeeId ?? "",
    dueAt: "",
    priority: "NORMAL",
    locationId: "",
  });
  const load = async () => {
    setError("");
    try {
      setTasks(
        await apiRequest<Task[]>(
          `/tasks${employeeId ? `?employeeId=${employeeId}` : ""}`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    if (!employee) {
      apiRequest<typeof people>("/employees")
        .then(setPeople)
        .catch((e) => setError(e.message));
      apiRequest<{ locations: typeof locations }>("/meta")
        .then((meta) => setLocations(meta.locations))
        .catch(() => setLocations([]));
    }
  }, [employee, employeeId]);
  const formatDue = (value: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest("/tasks", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          locationId: form.locationId || null,
          dueAt: new Date(form.dueAt).toISOString(),
        }),
      });
      setForm({ ...form, title: "", description: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setBusy(false);
    }
  };
  const update = async (task: Task, status: string, note?: string) => {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/tasks/${task.id}/status`, {
        method: "PATCH",
        body: JSON.stringify(note ? { status, note } : { status }),
      });
      setNoteFor(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setBusy(false);
    }
  };
  const now = Date.now();
  const visibleTasks = useMemo(
    () =>
      tasks
        .filter((task) => !filter || task.status === filter)
        .filter((task) => !personFilter || task.employeeId === personFilter)
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)),
    [tasks, filter, personFilter],
  );
  const lanes: Lane[] = ["overdue", "NEW", "IN_PROGRESS", "DONE"];
  const byLane = (lane: Lane) =>
    visibleTasks.filter((task) => laneFor(task, now) === lane);
  const doneCount = byLane("DONE").length;

  const renderCard = (task: Task) => {
    const overdue = laneFor(task, now) === "overdue";
    const noteOpen = noteFor?.task.id === task.id;
    return (
      <article
        className={`panel workforce-task ${overdue ? "is-overdue" : ""} ${task.status === "DONE" ? "is-done" : ""}`}
        key={task.id}
      >
        <div className="task-card-head">
          <span className={`task-priority priority-${task.priority}`}>
            {t(`priority${task.priority}`)}
          </span>
          {overdue && (
            <span className="task-overdue">
              <AlertTriangle size={13} aria-hidden="true" />
              {t("taskLaneOverdue")}
            </span>
          )}
        </div>
        <h2>{task.title}</h2>
        {task.description && (
          <p className="task-description">{task.description}</p>
        )}
        <p className="task-meta">
          {!employee && <span>{task.employee}</span>}
          {task.location && (
            <span>
              <MapPin size={13} aria-hidden="true" />
              {task.location}
            </span>
          )}
        </p>
        <p className={`task-due ${overdue ? "task-overdue" : ""}`}>
          {t(overdue ? "taskOverdueBy" : "taskDueIn", {
            time: formatDue(task.dueAt),
          })}
        </p>
        {task.completionNote && (
          <p className="task-note">
            <MessageSquareText size={13} aria-hidden="true" />
            <span>
              <strong>{t("completionNote")}:</strong> {task.completionNote}
            </span>
          </p>
        )}
        {task.managerNote && (
          <p className="task-note manager">
            <MessageSquareText size={13} aria-hidden="true" />
            <span>
              <strong>{t("managerNote")}:</strong> {task.managerNote}
            </span>
          </p>
        )}
        {noteOpen ? (
          <TaskNoteForm
            label={employee ? t("completionNote") : t("managerNote")}
            placeholder={
              employee
                ? t("completionNotePlaceholder")
                : t("managerNotePlaceholder")
            }
            confirmLabel={
              noteFor!.status === "DONE"
                ? t("confirmComplete")
                : t(`task${noteFor!.status}`)
            }
            busy={busy}
            onSubmit={(note) => void update(task, noteFor!.status, note)}
            onCancel={() => setNoteFor(null)}
          />
        ) : employee ? (
          task.status !== "DONE" && (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                task.status === "NEW"
                  ? void update(task, "IN_PROGRESS")
                  : setNoteFor({ task, status: "DONE" })
              }
            >
              {t(task.status === "NEW" ? "startTask" : "completeTask")}
            </button>
          )
        ) : (
          <label className="form-field task-status-field">
            <span>{t("status")}</span>
            <select
              disabled={busy}
              value={task.status}
              onChange={(e) =>
                setNoteFor({
                  task,
                  status: e.target.value as Task["status"],
                })
              }
            >
              {["NEW", "IN_PROGRESS", "DONE"].map((s) => (
                <option value={s} key={s}>
                  {t(`task${s}`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </article>
    );
  };

  return (
    <section className="workforce-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("dailyWork")}</p>
          <h1>{t("tasks")}</h1>
        </div>
        <div className="task-filters">
          {!employee && !employeeId && (
            <label className="form-field">
              <span>{t("taskFilterEmployee")}</span>
              <select
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
              >
                <option value="">{t("allEmployees")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="form-field">
            <span>{t("status")}</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">{t("allTasks")}</option>
              {["NEW", "IN_PROGRESS", "DONE"].map((s) => (
                <option key={s} value={s}>
                  {t(`task${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {!employee && !employeeId && (
        <PageGuide
          id="tasks"
          steps={[t("guideTasks1"), t("guideTasks2"), t("guideTasks3")]}
        />
      )}
      {error && (
        <p className="operations-error" role="alert">
          {error}
          <button onClick={() => void load()}>{t("retry")}</button>
        </p>
      )}
      {!employee && (
        <form className="panel workforce-task-form" onSubmit={create}>
          <h2>{t("createTask")}</h2>
          <div className="workforce-fields">
            <label className="form-field">
              <span>{t("taskTitle")}</span>
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>{t("employee")}</span>
              <select
                required
                value={form.employeeId}
                onChange={(e) =>
                  setForm({ ...form, employeeId: e.target.value })
                }
              >
                <option value="">{t("selectEmployee")}</option>
                {people
                  .filter((p) => ["ACTIVE", "ON_LEAVE"].includes(p.status))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="form-field">
              <span>{t("taskDeadline")}</span>
              <input
                type="datetime-local"
                required
                value={form.dueAt}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>{t("taskPriority")}</span>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {["LOW", "NORMAL", "HIGH"].map((p) => (
                  <option key={p} value={p}>
                    {t(`priority${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>
                {t("taskLocation")} <em>{t("optional")}</em>
              </span>
              <select
                value={form.locationId}
                onChange={(e) =>
                  setForm({ ...form, locationId: e.target.value })
                }
              >
                <option value="">{t("noLocation")}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="form-field">
            <span>{t("description")}</span>
            <textarea
              maxLength={10000}
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <button className="primary-button" disabled={busy}>
            {t("createTask")}
          </button>
        </form>
      )}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : !visibleTasks.length ? (
        <div className="empty-state panel workforce-empty">
          <span>
            <ClipboardList size={22} />
          </span>
          <strong>{t("noTasks")}</strong>
          <p>{t(employee ? "noTasksEmployee" : "noTasksHint")}</p>
        </div>
      ) : (
        <div className="task-board" aria-label={t("taskBoard")}>
          {lanes.map((lane) => {
            const items = byLane(lane);
            if (lane === "DONE") {
              return (
                <section className="task-lane task-lane-done" key={lane}>
                  <header>
                    <h3>{t("taskLaneDONE")}</h3>
                    <span>{items.length}</span>
                    {doneCount > 0 && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setShowDone((value) => !value)}
                      >
                        {showDone
                          ? t("hideCompleted")
                          : t("showCompleted", { count: doneCount })}
                      </button>
                    )}
                  </header>
                  {showDone && items.map(renderCard)}
                </section>
              );
            }
            if (lane === "overdue" && !items.length) return null;
            return (
              <section className={`task-lane task-lane-${lane}`} key={lane}>
                <header>
                  <h3>
                    {t(
                      lane === "overdue"
                        ? "taskLaneOverdue"
                        : `taskLane${lane}`,
                    )}
                  </h3>
                  <span>{items.length}</span>
                </header>
                {items.length ? (
                  items.map(renderCard)
                ) : (
                  <p className="task-lane-empty">—</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
