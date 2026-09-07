export interface Coordinates {
  latitude: number;
  longitude: number;
}

const earthRadiusMeters = 6_371_000;
const radians = (degrees: number) => degrees * Math.PI / 180;

export function distanceMeters(first: Coordinates, second: Coordinates): number {
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function isWithinGeofence(workplace: Coordinates, punch: Coordinates, radiusMeters: number): boolean {
  if (radiusMeters < 0) return false;
  return distanceMeters(workplace, punch) <= radiusMeters;
}
