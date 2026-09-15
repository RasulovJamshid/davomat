import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "./api";
import { useI18n } from "./i18n";
export interface Task {
  id: string;
  employeeId: string;
  employee: string;
  title: string;
  description: string;
  dueAt: string;
  priority: string;
  status: "NEW" | "IN_PROGRESS" | "DONE";
}
export function TasksPage({
  employee = false,
  employeeId,
}: {
  employee?: boolean;
  employeeId?: string;
}) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<
    { id: string; name: string; status: string }[]
  >([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    employeeId: employeeId ?? "",
    dueAt: "",
    priority: "NORMAL",
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
    if (!employee)
      apiRequest<typeof people>("/employees")
        .then(setPeople)
        .catch((e) => setError(e.message));
  }, [employee, employeeId]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest("/tasks", {
        method: "POST",
        body: JSON.stringify({
          ...form,
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
  const update = async (task: Task, status: string) => {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/tasks/${task.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="workforce-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{t("management")}</p>
          <h1>{t("tasks")}</h1>
        </div>
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
      ) : (
        <div className="workforce-task-grid">
          {tasks
            .filter((x) => !filter || x.status === filter)
            .map((task) => (
              <article className="panel workforce-task" key={task.id}>
                <div className="page-heading-row">
                  <span className={`task-priority priority-${task.priority}`}>
                    {t(`priority${task.priority}`)}
                  </span>
                  <span>{t(`task${task.status}`)}</span>
                </div>
                <h2>{task.title}</h2>
                <p className="task-description">{task.description}</p>
                <p>{task.employee}</p>
                <p
                  className={
                    task.status !== "DONE" &&
                    Date.parse(task.dueAt) < Date.now()
                      ? "task-overdue"
                      : ""
                  }
                >
                  {t("taskDeadline")}: {new Date(task.dueAt).toLocaleString()}
                </p>
                {employee ? (
                  task.status !== "DONE" && (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() =>
                        void update(
                          task,
                          task.status === "NEW" ? "IN_PROGRESS" : "DONE",
                        )
                      }
                    >
                      {t(task.status === "NEW" ? "startTask" : "completeTask")}
                    </button>
                  )
                ) : (
                  <label className="form-field">
                    <span>{t("status")}</span>
                    <select
                      disabled={busy}
                      value={task.status}
                      onChange={(e) => void update(task, e.target.value)}
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
            ))}
          {!tasks.filter((x) => !filter || x.status === filter).length && (
            <p>{t("noTasks")}</p>
          )}
        </div>
      )}
    </section>
  );
}
