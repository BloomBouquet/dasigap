import type { ItemStatus } from "./domain";

const MILLISECONDS_PER_DAY = 86_400_000;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ResolveLifecycleStatusInput = {
  now: Date;
  returnDeadline: Date | null;
  resaleStarted: boolean;
  listedExternally: boolean;
  soldAt: Date | null;
};

function calendarParts(value: string | Date): [number, number, number] {
  if (value instanceof Date) {
    return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()];
  }

  const match = CALENDAR_DATE.exec(value);
  if (!match) throw new Error("Invalid calendar date");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));

  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  ) {
    throw new Error("Invalid calendar date");
  }

  return [year, month, day];
}

export function formatCalendarDate(value: string | Date): string {
  const [year, month, day] = calendarParts(value);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

export function calendarDateDifference(
  target: string | Date,
  base: string | Date,
): number {
  const [targetYear, targetMonth, targetDay] = calendarParts(target);
  const [baseYear, baseMonth, baseDay] = calendarParts(base);
  const targetUtc = Date.UTC(targetYear, targetMonth - 1, targetDay);
  const baseUtc = Date.UTC(baseYear, baseMonth - 1, baseDay);

  return Math.round((targetUtc - baseUtc) / MILLISECONDS_PER_DAY);
}

export function resolveLifecycleStatus(
  input: ResolveLifecycleStatusInput,
): ItemStatus {
  if (input.soldAt) return "SOLD";
  if (input.listedExternally) return "LISTED_EXTERNALLY";
  if (input.resaleStarted) return "SELL_PREPARING";
  if (input.returnDeadline && input.returnDeadline > input.now) return "RETURNABLE";
  return "OWNED";
}
