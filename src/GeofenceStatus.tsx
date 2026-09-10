import { MapPin, MapPinOff, CircleHelp } from "lucide-react";
import { useI18n } from "./i18n";

export function GeofenceStatus({ value }: { value?: boolean | null }) {
  const { t } = useI18n();
  const state =
    value === true ? "inside" : value === false ? "outside" : "unknown";
  const Icon =
    value === true ? MapPin : value === false ? MapPinOff : CircleHelp;
  return (
    <span className={`geofence-status ${state}`}>
      <Icon size={14} aria-hidden="true" />
      {t(`geofence_${state}`)}
    </span>
  );
}
