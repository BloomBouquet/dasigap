import { differenceInCalendarDays } from "../shared/dates";

const DAYS_PER_MONTH = 30.4375;

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export type UsageCostInput = {
  purchasePrice: number;
  soldPrice: number;
  purchaseDate: Date;
  soldAt: Date;
};

export type UsageCostResult = {
  usageCost: number;
  monthlyUsageCost: number;
  ownershipDays: number;
  ownershipMonths: number;
  kind: "COST" | "BREAK_EVEN" | "PROFIT";
};

function assertPositiveKrwAmount(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainValidationError(`${field} must be a positive KRW integer`);
  }
}

function assertValidDate(date: Date, field: string): void {
  if (Number.isNaN(date.getTime())) {
    throw new DomainValidationError(`${field} must be a valid date`);
  }
}

export function calculateUsageCost(input: UsageCostInput): UsageCostResult {
  assertPositiveKrwAmount(input.purchasePrice, "purchasePrice");
  assertPositiveKrwAmount(input.soldPrice, "soldPrice");
  assertValidDate(input.purchaseDate, "purchaseDate");
  assertValidDate(input.soldAt, "soldAt");

  if (input.soldAt.getTime() < input.purchaseDate.getTime()) {
    throw new DomainValidationError("soldAt cannot be before purchaseDate");
  }

  const usageCost = input.purchasePrice - input.soldPrice;
  const ownershipDays = Math.max(
    1,
    differenceInCalendarDays(input.soldAt, input.purchaseDate),
  );
  const ownershipMonths = ownershipDays / DAYS_PER_MONTH;
  const monthlyUsageCost = Math.round(usageCost / ownershipMonths);

  const kind = usageCost > 0 ? "COST" : usageCost < 0 ? "PROFIT" : "BREAK_EVEN";

  return {
    usageCost,
    monthlyUsageCost,
    ownershipDays,
    ownershipMonths,
    kind,
  };
}
