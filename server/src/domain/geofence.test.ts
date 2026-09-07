import { describe, expect, it } from "vitest";
import { distanceMeters, isWithinGeofence } from "./geofence.js";

describe("geofence rules", () => {
  const office = { latitude: 41.311081, longitude: 69.240562 };

  it("accepts the same coordinate", () => {
    expect(distanceMeters(office, office)).toBe(0);
    expect(isWithinGeofence(office, office, 10)).toBe(true);
  });

  it("accepts a nearby attendance event", () => {
    const nearby = { latitude: 41.3112, longitude: 69.2406 };
    expect(isWithinGeofence(office, nearby, 50)).toBe(true);
  });

  it("rejects an event outside the configured radius", () => {
    const distant = { latitude: 41.32621, longitude: 69.32689 };
    expect(isWithinGeofence(office, distant, 500)).toBe(false);
  });

  it("rejects a negative radius", () => {
    expect(isWithinGeofence(office, office, -1)).toBe(false);
  });
});
