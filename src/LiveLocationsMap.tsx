import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Clock3,
  LocateFixed,
  MapPin,
  RefreshCw,
  Route,
  UserRound,
} from "lucide-react";
import { intlLocale, useI18n } from "./i18n";
import {
  fetchLiveLocationHistory,
  fetchLiveLocations,
  type LiveLocation,
  type LiveLocationHistory,
} from "./workforceApi";

const TASHKENT: [number, number] = [41.3111, 69.2797];
const STALE_AFTER_MS = 90_000;
const JUST_STARTED_MS = 3 * 60_000;

function FitLivePoints({
  points,
  focus,
  route,
}: {
  points: LiveLocation[];
  focus: string;
  route: LiveLocationHistory | null;
}) {
  const map = useMap();
  const pointIds = points
    .map((point) => point.shiftId)
    .sort()
    .join(",");
  useEffect(() => {
    if (route && route.points.length) {
      const coordinates = route.points.map(
        (point) => [point.latitude, point.longitude] as [number, number],
      );
      if (coordinates.length === 1) map.setView(coordinates[0], 16);
      else map.fitBounds(coordinates, { padding: [36, 36], maxZoom: 17 });
      return;
    }
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
  }, [map, pointIds, focus, route?.shiftId, route?.points.length]);
  return null;
}

/** Plain-language reason why a tracked shift has no fresh point. */
function silenceReason(
  item: LiveLocation,
  now: number,
  t: (key: string, values?: Record<string, string | number>) => string,
  time: (value: string) => string,
) {
  if (item.deviceLinked === false) return t("reasonNoDevice");
  if (
    !item.capturedAt &&
    now - new Date(item.startsAt).getTime() < JUST_STARTED_MS
  )
    return t("reasonJustStarted");
  if (item.capturedAt)
    return t("reasonAppBackground", { time: time(item.capturedAt) });
  if (item.deviceLastSeenAt)
    return t("reasonAppBackground", { time: time(item.deviceLastSeenAt) });
  return t("reasonDeviceSilent");
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
  const [route, setRoute] = useState<LiveLocationHistory | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeIndex, setRouteIndex] = useState(0);
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

  const openRoute = async (shiftId: string) => {
    if (route?.shiftId === shiftId) return setRoute(null);
    setRouteLoading(true);
    try {
      const history = await fetchLiveLocationHistory(shiftId);
      if (!active.current) return;
      setRoute(history);
      setRouteIndex(Math.max(0, history.points.length - 1));
      setFocus(`${shiftId}:${Date.now()}`);
    } catch (reason) {
      if (active.current)
        setError(
          reason instanceof Error
            ? reason.message
            : t("loadLiveLocationsFailed"),
        );
    } finally {
      if (active.current) setRouteLoading(false);
    }
  };

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
    !item.capturedAt ||
    now - new Date(item.capturedAt).getTime() > STALE_AFTER_MS;
  const time = (value: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  const shortTime = (value: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));

  // Silent employees first, grouped by where they are supposed to be.
  const groups = useMemo(() => {
    const byLocation = new Map<string, LiveLocation[]>();
    for (const item of scoped) {
      const key = item.scheduledLocation ?? "";
      byLocation.set(key, [...(byLocation.get(key) ?? []), item]);
    }
    return [...byLocation.entries()]
      .map(([location, items]) => ({
        location,
        items: [...items].sort(
          (a, b) => Number(isStale(b)) - Number(isStale(a)),
        ),
        silent: items.filter(isStale).length,
      }))
      .sort((a, b) => b.silent - a.silent);
  }, [scoped, now]);

  const routePoint = route?.points[routeIndex];

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
            <p>{t("liveTrackingNotOnSchedule")}</p>
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
            <FitLivePoints points={visible} focus={focus} route={route} />
            {route &&
              route.locationLatitude != null &&
              route.locationLongitude != null && (
                <Circle
                  center={[route.locationLatitude, route.locationLongitude]}
                  radius={route.geofenceRadiusM ?? 100}
                  pathOptions={{
                    color: "#1e7a45",
                    dashArray: "6 6",
                    fillOpacity: 0.05,
                  }}
                />
              )}
            {route && route.points.length > 1 && (
              <Polyline
                positions={route.points.map(
                  (point) =>
                    [point.latitude, point.longitude] as [number, number],
                )}
                pathOptions={{ color: "#244bdb", weight: 4, opacity: 0.7 }}
              />
            )}
            {routePoint && (
              <CircleMarker
                center={[routePoint.latitude, routePoint.longitude]}
                radius={9}
                pathOptions={{
                  color: "#fff",
                  weight: 3,
                  fillColor: "#9b514a",
                  fillOpacity: 1,
                }}
              >
                <Popup>
                  <strong>{route?.employee}</strong>
                  <br />
                  {t("routeAt", { time: time(routePoint.capturedAt) })}
                </Popup>
              </CircleMarker>
            )}
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
              onClick={() => {
                setRoute(null);
                setFocus(`all:${Date.now()}`);
              }}
            >
              {t("showAllOnMap")}
            </button>
          </div>
          {refreshedAt && (
            <small className="live-map-refreshed">
              {t("mapRefreshedAt", { time: time(refreshedAt.toISOString()) })}
            </small>
          )}
          {route && (
            <section className="route-panel" aria-live="polite">
              <div className="route-panel-heading">
                <div>
                  <strong>
                    <Route size={16} aria-hidden="true" />
                    {t("routeTitle", { employee: route.employee })}
                  </strong>
                  <small>
                    {shortTime(route.startsAt)} – {shortTime(route.endsAt)} ·{" "}
                    {t("routePoints", { count: route.points.length })}
                  </small>
                </div>
                <button className="text-button" onClick={() => setRoute(null)}>
                  {t("hideRoute")}
                </button>
              </div>
              {route.points.length ? (
                <>
                  <label className="route-scrub">
                    <span>{t("routeScrub")}</span>
                    <input
                      type="range"
                      min={0}
                      max={route.points.length - 1}
                      value={routeIndex}
                      onChange={(event) =>
                        setRouteIndex(Number(event.target.value))
                      }
                    />
                    <strong>
                      {routePoint
                        ? t("routeAt", { time: time(routePoint.capturedAt) })
                        : ""}
                    </strong>
                  </label>
                  <div className="route-ticks" aria-hidden="true">
                    <span>{shortTime(route.points[0].capturedAt)}</span>
                    <span>{shortTime(route.points.at(-1)!.capturedAt)}</span>
                  </div>
                </>
              ) : (
                <p>{t("routeEmpty")}</p>
              )}
              <small className="route-retention">{t("routeRetention")}</small>
            </section>
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
            groups.map((group) => (
              <div className="live-location-group" key={group.location}>
                <h3>
                  <MapPin size={14} aria-hidden="true" />
                  {group.location || t("unassigned")}
                  <span>
                    {group.items.length - group.silent}/{group.items.length}
                  </span>
                </h3>
                {group.items.map((item) => (
                  <article
                    key={item.shiftId}
                    className={focus.startsWith(item.shiftId) ? "selected" : ""}
                  >
                    <span
                      className={`summary-symbol ${isStale(item) ? "amber" : "green"}`}
                    >
                      <UserRound size={17} />
                    </span>
                    <div>
                      <strong>{item.employee}</strong>
                      <small>
                        {item.jobTitle} · {shortTime(item.startsAt)} –{" "}
                        {shortTime(item.endsAt)}
                      </small>
                      <small
                        className={
                          isStale(item) ? "live-stale" : "live-current"
                        }
                      >
                        <Clock3 size={13} />
                        {!item.capturedAt
                          ? t("waitingForLocation")
                          : isStale(item)
                            ? t("locationStale", {
                                time: time(item.capturedAt),
                              })
                            : t("locationCurrent", {
                                time: time(item.capturedAt),
                              })}
                      </small>
                      {isStale(item) && (
                        <p className="tracking-recovery">
                          {silenceReason(item, now, t, time)}
                        </p>
                      )}
                      <div className="live-person-actions">
                        <button
                          className="secondary-button"
                          disabled={
                            item.latitude == null || item.longitude == null
                          }
                          onClick={() => {
                            setRoute(null);
                            setFocus(`${item.shiftId}:${Date.now()}`);
                          }}
                        >
                          {t("locateEmployee")}
                        </button>
                        <button
                          className="secondary-button"
                          disabled={routeLoading || !item.pointCount}
                          onClick={() => void openRoute(item.shiftId)}
                        >
                          <Route size={15} />
                          {route?.shiftId === item.shiftId
                            ? t("hideRoute")
                            : t("viewRoute")}
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
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
