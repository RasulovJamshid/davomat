import { useEffect, useState } from "react";
import { Camera, Check, Pencil, Trash2, X } from "lucide-react";
import { apiRequest, readApiImage } from "./api";
import { GeofenceStatus } from "./GeofenceStatus";
import {
  deletePunch,
  fetchEmployeePunches,
  localDateTime,
  updatePunch,
  type ApiPunch,
  type CompanyInfo,
} from "./workforceApi";
import { useI18n } from "./i18n";

const eventTypes: ApiPunch["eventType"][] = [
  "CLOCK_IN",
  "BREAK_START",
  "BREAK_END",
  "CLOCK_OUT",
];
const wallTime = (value: string, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
};

export function AttendanceEventsModal({
  employeeId,
  employee,
  date,
  onClose,
  onChanged,
}: {
  employeeId: string;
  employee: string;
  date: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<ApiPunch[]>([]);
  const [timeZone, setTimeZone] = useState("Asia/Tashkent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const load = () => {
    setLoading(true);
    Promise.all([
      fetchEmployeePunches(employeeId, date),
      apiRequest<CompanyInfo>("/auth/me"),
    ])
      .then(([events, companyInfo]) => {
        setItems(events);
        setTimeZone(companyInfo.timezone);
      })
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : t("loadEventsFailed"),
        ),
      )
      .finally(() => setLoading(false));
  };
  useEffect(load, [employeeId, date]);
  const change = (id: string, patch: Partial<ApiPunch>) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  const save = async (item: ApiPunch) => {
    const local = wallTime(item.occurredAt, timeZone);
    setSaving(item.id);
    setError("");
    try {
      await updatePunch(item.id, {
        eventType: item.eventType,
        occurredAt: localDateTime(
          local.slice(0, 10),
          local.slice(11),
          timeZone,
        ),
        note: item.note?.trim() || t("managerCorrectionNote"),
      });
      onChanged();
      load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("updateEventFailed"),
      );
    } finally {
      setSaving("");
    }
  };
  const remove = async (item: ApiPunch) => {
    const reason = window.prompt(t("removeEventPrompt"));
    if (!reason) return;
    setSaving(item.id);
    setError("");
    try {
      await deletePunch(item.id, reason);
      onChanged();
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("removeEventFailed"));
    } finally {
      setSaving("");
    }
  };
  const showPhoto = async (id: string) => {
    setSaving(id);
    try {
      const source = await readApiImage(`/punches/${id}/verification-photo`);
      setPhotos((current) => ({ ...current, [id]: source }));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("loadSelfieFailed"),
      );
    } finally {
      setSaving("");
    }
  };
  return (
    <>
      <button
        className="drawer-scrim"
        onClick={onClose}
        aria-label={t("close")}
      />
      <aside className="attendance-drawer event-manager">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">{t("clockEventCorrection")}</p>
            <h2>{employee}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </div>
        <p className="modal-intro">{t("clockCorrectionIntro")}</p>
        {error && (
          <div className="schedule-error">
            <X size={15} />
            {error}
          </div>
        )}
        <div className="event-manager-list">
          {loading ? (
            <p>{t("loadingEvents")}</p>
          ) : items.length === 0 ? (
            <p>{t("noEventsDate")}</p>
          ) : (
            items.map((item) => (
              <article key={item.id}>
                <div className="event-geofence">
                  <span>{t("geofenceCheck")}</span>
                  <GeofenceStatus value={item.withinGeofence} />
                </div>
                <select
                  value={item.eventType}
                  onChange={(event) =>
                    change(item.id, {
                      eventType: event.target.value as ApiPunch["eventType"],
                    })
                  }
                >
                  {eventTypes.map((type) => (
                    <option key={type} value={type}>
                      {t(
                        type === "CLOCK_IN"
                          ? "clockIn"
                          : type === "CLOCK_OUT"
                            ? "clockOut"
                            : type === "BREAK_START"
                              ? "startBreak"
                              : "endBreak",
                      )}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={wallTime(item.occurredAt, timeZone)}
                  onChange={(event) =>
                    change(item.id, {
                      occurredAt: localDateTime(
                        event.target.value.slice(0, 10),
                        event.target.value.slice(11),
                        timeZone,
                      ),
                    })
                  }
                />
                <input
                  value={item.note ?? ""}
                  onChange={(event) =>
                    change(item.id, { note: event.target.value })
                  }
                  placeholder={t("correctionReason")}
                />
                <button
                  className="secondary-button"
                  disabled={saving === item.id}
                  onClick={() => void save(item)}
                >
                  <Pencil size={15} />
                  {t("save")}
                </button>
                <button
                  className="reject-button"
                  disabled={saving === item.id}
                  onClick={() => void remove(item)}
                >
                  <Trash2 size={15} />
                  {t("remove")}
                </button>
                {item.hasFaceVerification && (
                  <button
                    className="secondary-button"
                    disabled={saving === item.id}
                    onClick={() => void showPhoto(item.id)}
                  >
                    <Camera size={15} />
                    {t("viewAttendanceSelfie")}
                  </button>
                )}
                {photos[item.id] && (
                  <img
                    className="attendance-selfie"
                    src={photos[item.id]}
                    alt={t("attendanceSelfie")}
                  />
                )}
              </article>
            ))
          )}
        </div>
        <button className="primary-button wide" onClick={onClose}>
          <Check size={16} />
          {t("done")}
        </button>
      </aside>
    </>
  );
}
