export interface TimeRange {
  start: string;
  end: string;
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new Error(`Invalid time: ${value}`);
  }
  return hours * 60 + minutes;
}

function normalizedRange(range: TimeRange): [number, number] {
  const start = timeToMinutes(range.start);
  let end = timeToMinutes(range.end);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

export function shiftsOverlap(first: TimeRange, second: TimeRange): boolean {
  const [firstStart, firstEnd] = normalizedRange(first);
  const [secondStart, secondEnd] = normalizedRange(second);
  return firstStart < secondEnd && secondStart < firstEnd;
}

export function totalScheduledMinutes(ranges: TimeRange[]): number {
  return ranges.reduce((total, range) => {
    const [start, end] = normalizedRange(range);
    return total + (end - start);
  }, 0);
}
