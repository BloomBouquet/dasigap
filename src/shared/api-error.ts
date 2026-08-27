import { z } from "zod";

import {
  AuthConfigurationError,
  AuthenticationError,
} from "../auth/server-auth";
import { OwnedItemNotFoundError } from "../db/ownership";
import { InvalidDocumentFormError } from "../documents/repository";
import {
  ObjectStorageConfigurationError,
  ObjectStorageOperationError,
} from "../documents/storage";
import { DocumentUploadPolicyError } from "../documents/upload-policy";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
};

export class InvalidJsonBodyError extends Error {
  constructor() {
    super("Invalid JSON body");
    this.name = "InvalidJsonBodyError";
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new InvalidJsonBodyError();
  }
}

function validationFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : "_root";

    if (!fields[field]) {
      fields[field] = issue.message;
    }
  }

  return fields;
}

function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string>,
): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(fields ? { fields } : {}),
    },
  };

  return Response.json(body, { status });
}

export function toApiErrorResponse(error: unknown): Response {
  if (error instanceof AuthenticationError) {
    return jsonError(401, "UNAUTHORIZED", "Authentication required");
  }

  if (error instanceof OwnedItemNotFoundError) {
    return jsonError(404, "NOT_FOUND", "Item not found");
  }

  if (error instanceof z.ZodError) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "입력값을 확인해주세요.",
      validationFields(error),
    );
  }

  if (error instanceof InvalidJsonBodyError) {
    return jsonError(400, "VALIDATION_ERROR", "올바른 JSON 요청이 아닙니다.", {
      _root: "Invalid JSON body",
    });
  }

  if (error instanceof InvalidDocumentFormError || error instanceof DocumentUploadPolicyError) {
    return jsonError(400, "VALIDATION_ERROR", error.message);
  }

  if (
    error instanceof AuthConfigurationError ||
    error instanceof ObjectStorageConfigurationError ||
    error instanceof ObjectStorageOperationError
  ) {
    return jsonError(500, "INTERNAL_ERROR", "Server configuration error");
  }

  return jsonError(500, "INTERNAL_ERROR", "Unexpected server error");
}
