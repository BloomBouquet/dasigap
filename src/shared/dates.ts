const MILLISECONDS_PER_DAY = 86_400_000;

function utcStartOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function differenceInCalendarDays(later: Date, earlier: Date): number {
  return Math.round((utcStartOfDay(later) - utcStartOfDay(earlier)) / MILLISECONDS_PER_DAY);
}
