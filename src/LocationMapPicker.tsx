import { useEffect } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useI18n } from "./i18n";

const TASHKENT: [number, number] = [41.3111, 69.2797];

function MapInteraction({
  position,
  onChange,
}: {
  position: [number, number];
  onChange: (latitude: number, longitude: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView(position, map.getZoom(), { animate: true });
  }, [map, position]);
  useMapEvents({
    click: (event) => onChange(event.latlng.lat, event.latlng.lng),
  });
  return null;
}

export function LocationMapPicker({
  latitude,
  longitude,
  radius,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  radius: number;
  onChange: (latitude: number, longitude: number) => void;
}) {
  const { t } = useI18n();
  const position: [number, number] =
    latitude == null || longitude == null ? TASHKENT : [latitude, longitude];
  const locate = () => {
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => onChange(coords.latitude, coords.longitude),
      () => undefined,
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };
  return (
    <div className="location-map-picker">
      <div className="location-map-toolbar">
        <div>
          <strong>{t("selectLocationOnMap")}</strong>
          <small>{t("clickMapToPlaceLocation")}</small>
        </div>
        <button type="button" className="secondary-button" onClick={locate}>
          {t("useCurrentLocation")}
        </button>
      </div>
      <MapContainer
        center={position}
        zoom={14}
        scrollWheelZoom
        className="location-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapInteraction position={position} onChange={onChange} />
        {latitude != null && longitude != null && (
          <>
            <Circle
              center={position}
              radius={radius}
              pathOptions={{ color: "#244bdb", fillOpacity: 0.12 }}
            />
            <CircleMarker
              center={position}
              radius={7}
              pathOptions={{
                color: "#fff",
                weight: 3,
                fillColor: "#244bdb",
                fillOpacity: 1,
              }}
            />
          </>
        )}
      </MapContainer>
      <p className="map-coordinate-readout">
        {latitude == null || longitude == null
          ? t("locationNotSelected")
          : `${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ${radius} m`}
      </p>
    </div>
  );
}
