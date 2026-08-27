export class OwnedItemNotFoundError extends Error {
  readonly status = 404;
  readonly code = "NOT_FOUND" as const;

  constructor() {
    super("Item not found");
    this.name = "OwnedItemNotFoundError";
  }
}

export function throwOwnedItemNotFound(): never {
  throw new OwnedItemNotFoundError();
}
