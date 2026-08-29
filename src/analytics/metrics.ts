import { prisma } from "../db/prisma";
import { productEventRetentionCutoff } from "./retention";

export type ValidationEvent = {
  userId: string;
  itemId: string | null;
  type: string;
  durationMs: number | null;
  createdAt: Date;
};

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function kstDateKey(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function uniqueUsers(events: ValidationEvent[], type: string) {
  return new Set(events.filter((event) => event.type === type).map((event) => event.userId));
}

function uniqueItems(events: ValidationEvent[], type: string) {
  return new Set(
    events
      .filter((event) => event.type === type && event.itemId)
      .map((event) => event.itemId as string),
  );
}

function intersect<T>(values: Set<T>, cohort: Set<T>) {
  return new Set([...values].filter((value) => cohort.has(value)));
}

function firstRegistrationDates(events: ValidationEvent[]) {
  const datesByUser = new Map<string, string>();

  for (const event of events) {
    if (event.type !== "ITEM_REGISTRATION_COMPLETED") continue;

    const dateKey = kstDateKey(event.createdAt);
    const current = datesByUser.get(event.userId);
    if (!current || dateKey < current) {
      datesByUser.set(event.userId, dateKey);
    }
  }

  return datesByUser;
}

function visitDates(events: ValidationEvent[]) {
  const datesByUser = new Map<string, Set<string>>();

  for (const event of events) {
    if (event.type !== "APP_VISITED") continue;
    const dates = datesByUser.get(event.userId) ?? new Set<string>();
    dates.add(kstDateKey(event.createdAt));
    datesByUser.set(event.userId, dates);
  }

  return datesByUser;
}

function hasVisitBetween(dates: Set<string>, start: string, end: string) {
  return [...dates].some((date) => date >= start && date <= end);
}

export function computeValidationMetrics(events: ValidationEvent[], now: Date) {
  const registrationStartedUsers = uniqueUsers(events, "ITEM_REGISTRATION_STARTED");
  const registrationCompletedUsers = intersect(
    uniqueUsers(events, "ITEM_REGISTRATION_COMPLETED"),
    registrationStartedUsers,
  );
  const registrationDurations = events.flatMap((event) =>
    event.type === "ITEM_REGISTRATION_COMPLETED" && event.durationMs !== null
      ? [event.durationMs]
      : [],
  );

  const observationDate = kstDateKey(now);
  const registrationDatesByUser = firstRegistrationDates(events);
  const visitDatesByUser = visitDates(events);

  let d7EligibleUsers = 0;
  let d7Users = 0;
  let d30EligibleUsers = 0;
  let d30Users = 0;

  for (const [userId, cohortDate] of registrationDatesByUser) {
    const dates = visitDatesByUser.get(userId) ?? new Set<string>();
    const d7Start = addCalendarDays(cohortDate, 6);
    const d7End = addCalendarDays(cohortDate, 8);
    const d30Start = addCalendarDays(cohortDate, 27);
    const d30End = addCalendarDays(cohortDate, 33);

    if (observationDate >= d7End) {
      d7EligibleUsers += 1;
      if (hasVisitBetween(dates, d7Start, d7End)) d7Users += 1;
    }

    if (observationDate >= d30End) {
      d30EligibleUsers += 1;
      if (hasVisitBetween(dates, d30Start, d30End)) d30Users += 1;
    }
  }

  const resaleStartedItems = uniqueItems(events, "RESALE_STARTED");
  const resaleCompletedItems = intersect(
    uniqueItems(events, "RESALE_COMPLETED"),
    resaleStartedItems,
  );
  const copiedItems = intersect(uniqueItems(events, "RESALE_COPY_COPIED"), resaleCompletedItems);
  const soldItems = intersect(uniqueItems(events, "SALE_COMPLETED"), resaleStartedItems);

  const lifecycleEvents = events.filter((event) => event.type === "ITEM_LIFECYCLE_UPDATED");
  const usageCostEvents = events.filter((event) => event.type === "USAGE_COST_VIEWED");

  return {
    firstItem: {
      startedUsers: registrationStartedUsers.size,
      completedUsers: registrationCompletedUsers.size,
      conversionRate: rate(registrationCompletedUsers.size, registrationStartedUsers.size),
    },
    registrationDuration: {
      sampleSize: registrationDurations.length,
      medianMs: median(registrationDurations),
    },
    retention: {
      d7EligibleUsers,
      d7Users,
      d7Rate: rate(d7Users, d7EligibleUsers),
      d30EligibleUsers,
      d30Users,
      d30Rate: rate(d30Users, d30EligibleUsers),
    },
    resaleCompletion: {
      startedItems: resaleStartedItems.size,
      completedItems: resaleCompletedItems.size,
      conversionRate: rate(resaleCompletedItems.size, resaleStartedItems.size),
    },
    copyUsage: {
      completedItems: resaleCompletedItems.size,
      copiedItems: copiedItems.size,
      conversionRate: rate(copiedItems.size, resaleCompletedItems.size),
    },
    saleCompletion: {
      startedItems: resaleStartedItems.size,
      soldItems: soldItems.size,
      conversionRate: rate(soldItems.size, resaleStartedItems.size),
    },
    lifecycle: {
      updates: lifecycleEvents.length,
      uniqueUsers: new Set(lifecycleEvents.map((event) => event.userId)).size,
      uniqueItems: new Set(lifecycleEvents.flatMap((event) => (event.itemId ? [event.itemId] : []))).size,
    },
    usageCost: {
      views: usageCostEvents.length,
      uniqueUsers: new Set(usageCostEvents.map((event) => event.userId)).size,
    },
  };
}

export async function getValidationMetrics(now = new Date()) {
  const events = await prisma.productEvent.findMany({
    where: { createdAt: { gte: productEventRetentionCutoff(now) } },
    select: {
      userId: true,
      itemId: true,
      type: true,
      durationMs: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return computeValidationMetrics(events, now);
}
