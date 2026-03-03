export interface PaginationMeta {
  cursor: string | null;
  has_more: boolean;
  limit: number;
}

export interface ResponseMeta {
  pagination?: PaginationMeta;
  timestamp?: string;
  correlation_id?: string;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
  meta?: ResponseMeta;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
