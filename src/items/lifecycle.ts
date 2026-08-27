import type { ItemStatus } from "./domain";

export type ResolveLifecycleStatusInput = {
  now: Date;
  returnDeadline: Date | null;
  resaleStarted: boolean;
  listedExternally: boolean;
  soldAt: Date | null;
};

export function resolveLifecycleStatus(
  input: ResolveLifecycleStatusInput,
): ItemStatus {
  if (input.soldAt) {
    return "SOLD";
  }

  if (input.listedExternally) {
    return "LISTED_EXTERNALLY";
  }

  if (input.resaleStarted) {
    return "SELL_PREPARING";
  }

  if (input.returnDeadline && input.returnDeadline > input.now) {
    return "RETURNABLE";
  }

  return "OWNED";
}
