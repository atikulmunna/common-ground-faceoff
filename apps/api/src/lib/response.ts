import type { ApiErrorCode } from "@common-ground/shared";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  } | null;
}

export function createSuccessResponse<T>(data: T): ApiEnvelope<T> {
  return { success: true, data, error: null };
}

export function createErrorResponse(code: ApiErrorCode, message: string, details?: unknown): ApiEnvelope<null> {
  return { success: false, data: null, error: { code, message, details } };
}
