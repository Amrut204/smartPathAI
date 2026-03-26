import type {
  ApiErrorPayload,
  ApiErrorResponse,
  ApiSuccessResponse,
  ResponseMeta,
} from "../types/api.types.js";

export function successResponse<T>(data: T, meta?: ResponseMeta): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

export function errorResponse(error: ApiErrorPayload, meta?: ResponseMeta): ApiErrorResponse {
  return {
    success: false,
    error,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}
