import { describe, expect, it } from "vitest";
import { shiftsOverlap, timeToMinutes, totalScheduledMinutes } from "./scheduling";

describe("scheduling rules", () => {
  it("converts clock time to minutes", () => {
    expect(timeToMinutes("09:30")).toBe(570);
  });

  it("detects overlapping shifts", () => {
    expect(shiftsOverlap({ start: "09:00", end: "18:00" }, { start: "17:00", end: "21:00" })).toBe(true);
  });

  it("allows adjacent shifts", () => {
    expect(shiftsOverlap({ start: "09:00", end: "13:00" }, { start: "13:00", end: "18:00" })).toBe(false);
  });

  it("calculates overnight duration", () => {
    expect(totalScheduledMinutes([{ start: "22:00", end: "06:00" }])).toBe(480);
  });
});
