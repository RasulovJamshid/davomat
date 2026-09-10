import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Clock3, LocateFixed, RefreshCw, UserRound } from "lucide-react";
import { intlLocale, useI18n } from "./i18n";
import { fetchLiveLocations, type LiveLocation } from "./workforceApi";

const TASHKENT: [number, number] = [41.3111, 69.2797];

function FitLivePoints({
  points,
  focus,
}: {
  points: LiveLocation[];
  focus: string;
}) {
  const map = useMap();
  const pointIds = points
    .map((point) => point.shiftId)
    .sort()
    .join(",");
  useEffect(() => {
    const selected = points.find(
      (point) => point.shiftId === focus.split(":")[0],
    );
    if (selected?.latitude != null && selected.longitude != null) {
      map.setView([selected.latitude, selected.longitude], 16);
      return;
    }
    const coordinates = points
      .filter((point) => point.latitude != null && point.longitude != null)
      .map((point) => [point.latitude!, point.longitude!] as [number, number]);
    if (coordinates.length === 1) map.setView(coordinates[0], 16);
    if (coordinates.length > 1)
      map.fitBounds(coordinates, { padding: [36, 36], maxZoom: 16 });
  }, [map, pointIds, focus]);
  return null;
}

export function LiveLocationsMap({
  employeeId,
  onOpenSchedule,
  onOpenEmployee,
  standalone = false,
}: {
  employeeId?: string;
  onOpenSchedule?: (employeeId?: string) => void;
  onOpenEmployee?: (employeeId: string) => void;
  standalone?: boolean;
}) {
  const { t, locale } = useI18n();
  const [locations, setLocations] = useState<LiveLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [focus, setFocus] = useState("");
  const inFlight = useRef(false);
  const active = useRef(true);
  const Header = standalone ? "h1" : "h2";

  const load = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setError("");
      const result = await fetchLiveLocations();
      if (!active.current) return;
      setLocations(result);
      setRefreshedAt(new Date());
    } catch (reason) {
      if (!active.current) return;
      setError(
        reason instanceof Error ? reason.message : t("loadLiveLocationsFailed"),
      );
    } finally {
      inFlight.current = false;
      if (active.current) setLoading(false);
    }
  };

  useEffect(() => {
    active.current = true;
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      active.current = false;
      window.clearInterval(timer);
    };
  }, []);

  const now = Date.now();
  const scoped = locations.filter(
    (item) => !employeeId || item.employeeId === employeeId,
  );
  const visible = useMemo(
    () =>
      scoped.filter((item) => item.latitude != null && item.longitude != null),
    [locations, employeeId],
  );
  const isStale = (item: LiveLocation) =>
    !item.capturedAt || now - new Date(item.capturedAt).getTime() > 90_000;
  const time = (value: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));

  return (
    <section className="live-location-workspace">
      <div className="live-location-heading">
        <div>
          <Header>{t("liveLocations")}</Header>
          <p>{t("liveLocationsDescription")}</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={16} />
          {t("refresh")}
        </button>
      </div>
      <details className="tracking-guide" open={scoped.length === 0}>
        <summary>{t("howToSeeLiveLocation")}</summary>
        <ol>
          <li>
            <strong>{t("trackingStepSchedule")}</strong>
            <p>{t("trackingStepScheduleHelp")}</p>
            {onOpenSchedule && (
              <button
                className="secondary-button"
                onClick={() => onOpenSchedule(employeeId)}
              >
                {t("configureTracking")}
              </button>
            )}
          </li>
          <li>
            <strong>{t("trackingStepPhone")}</strong>
            <p>{t("trackingStepPhoneHelp")}</p>
          </li>
          <li>
            <strong>{t("trackingStepView")}</strong>
            <p>{t("trackingStepViewHelp")}</p>
          </li>
        </ol>
      </details>
      {!loading && (
        <div className="live-summary" role="status">
          <span>{t("trackingActiveCount", { count: scoped.length })}</span>
          <span>
            {t("trackingReceivingCount", {
              count: visible.filter((item) => !isStale(item)).length,
            })}
          </span>
          <span>
            {t("trackingWaitingCount", {
              count: scoped.length - visible.length,
            })}
          </span>
          <span>
            {t("trackingStaleCount", { count: visible.filter(isStale).length })}
          </span>
        </div>
      )}
      {error && <div className="schedule-error">{error}</div>}
      <div className="live-location-layout">
        <div className="live-location-map-wrap">
          <MapContainer
            center={TASHKENT}
            zoom={13}
            className="live-location-map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitLivePoints points={visible} focus={focus} />
            {visible.map((item) => (
              <Fragment key={item.shiftId}>
                <Circle
                  center={[item.latitude!, item.longitude!]}
                  radius={item.accuracyM ?? 25}
                  pathOptions={{
                    color: isStale(item) ? "#b7791f" : "#244bdb",
                    fillOpacity: 0.1,
                  }}
                />
                <CircleMarker
                  center={[item.latitude!, item.longitude!]}
                  radius={8}
                  pathOptions={{
                    color: "#fff",
                    weight: 3,
                    fillColor: isStale(item) ? "#b7791f" : "#244bdb",
                    fillOpacity: 1,
                  }}
                >
                  <Popup>
                    <strong>{item.employee}</strong>
                    <br />
                    {item.capturedAt
                      ? `${t("updatedAt")} ${time(item.capturedAt)}`
                      : t("waitingForLocation")}
                  </Popup>
                </CircleMarker>
              </Fragment>
            ))}
          </MapContainer>
          <div className="map-actions">
            <small>{t("liveMapAccuracyHint")}</small>
            <button
              className="secondary-button"
              disabled={!visible.length}
              onClick={() => setFocus(`all:${Date.now()}`)}
            >
              {t("showAllOnMap")}
            </button>
          </div>
          {refreshedAt && (
            <small className="live-map-refreshed">
              {t("mapRefreshedAt", { time: time(refreshedAt.toISOString()) })}
            </small>
          )}
        </div>
        <div className="live-employee-list">
          {loading && !scoped.length ? (
            <p>{t("loading")}</p>
          ) : scoped.length === 0 ? (
            <div className="live-location-empty">
              <LocateFixed size={28} />
              <strong>
                {t(error ? "loadLiveLocationsFailed" : "noLiveTrackingNow")}
              </strong>
              <p>{t("liveTrackingAvailabilityHint")}</p>
            </div>
          ) : (
            scoped.map((item) => (
              <article
                key={item.shiftId}
                className={focus.startsWith(item.shiftId) ? "selected" : ""}
              >
                <span className="summary-symbol green">
                  <UserRound size={17} />
                </span>
                <div>
                  <strong>{item.employee}</strong>
                  <small>
                    {item.jobTitle} ·{" "}
                    {item.scheduledLocation ?? t("unassigned")}
                  </small>
                  <small>
                    {time(item.startsAt)} – {time(item.endsAt)}
                  </small>
                  <small
                    className={isStale(item) ? "live-stale" : "live-current"}
                  >
                    <Clock3 size={13} />
                    {!item.capturedAt
                      ? t("waitingForLocation")
                      : isStale(item)
                        ? t("locationStale", { time: time(item.capturedAt) })
                        : t("locationCurrent", { time: time(item.capturedAt) })}
                  </small>
                  {!item.capturedAt && (
                    <p className="tracking-recovery">
                      {t("waitingForPhoneHint")}
                    </p>
                  )}
                  <div className="live-person-actions">
                    <button
                      className="secondary-button"
                      disabled={item.latitude == null || item.longitude == null}
                      onClick={() => setFocus(`${item.shiftId}:${Date.now()}`)}
                    >
                      {t("locateEmployee")}
                    </button>
                    {onOpenEmployee && (
                      <button
                        className="text-button"
                        onClick={() => onOpenEmployee(item.employeeId)}
                      >
                        {t("openEmployeeProfile")}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
