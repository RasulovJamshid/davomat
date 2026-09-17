import { useEffect, useState } from "react";
import { fetchEmployeePunches, type ApiPunch } from "./workforceApi";
import { tashkentDate } from "./operationsApi";
import { intlLocale, useI18n } from "./i18n";
import { GeofenceStatus } from "./GeofenceStatus";

export function EmployeeActivity({ employeeId }: { employeeId: string }) {
  const { t, locale } = useI18n();
  const [date, setDate] = useState(tashkentDate);
  const [items, setItems] = useState<ApiPunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchEmployeePunches(employeeId, date)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : t("loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [employeeId, date, retry]);
  const eventKeys = {
    CLOCK_IN: "clockIn",
    CLOCK_OUT: "clockOut",
    BREAK_START: "startBreak",
    BREAK_END: "endBreak",
  };
  const sourceKeys: Record<string, string> = {
    MOBILE: "mobile",
    KIOSK: "faceKiosk",
    TURNSTILE: "turnstile",
    WEB: "webBrowser",
    MANUAL: "manual",
    QR: "qrCode",
  };
  return (
    <section className="profile-section employee-activity">
      <div className="page-heading-row">
        <h2>{t("timeRecords")}</h2>
        <label className="form-field">
          <span>{t("date")}</span>
          <input
            type="date"
            value={date}
            onChange={(event) => {
              if (event.target.value) setDate(event.target.value);
            }}
          />
        </label>
      </div>
      <p>{t("geofenceRecordedHint")}</p>
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            className="secondary-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("retry")}
          </button>
        </div>
      ) : !items.length ? (
        <div className="workflow-empty">
          <strong>{t("noAttendanceForDate")}</strong>
          <p>{t("chooseAttendanceDate")}</p>
        </div>
      ) : (
        <ul className="employee-punch-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{t(eventKeys[item.eventType])}</strong>
                <p>
                  <time dateTime={item.occurredAt}>
                    {new Intl.DateTimeFormat(intlLocale(locale), {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Tashkent",
                    }).format(new Date(item.occurredAt))}
                  </time>{" "}
                  · {t(sourceKeys[item.source] ?? "noRecord")}
                </p>
                {item.note && <small>{item.note}</small>}
              </div>
              <GeofenceStatus value={item.withinGeofence} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
