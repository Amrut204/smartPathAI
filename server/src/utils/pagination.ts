export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

export function clampListLimit(
  raw: unknown,
  options?: { defaultLimit?: number; maxLimit?: number },
) {
  const defaultLimit = options?.defaultLimit ?? DEFAULT_LIST_LIMIT;
  const maxLimit = options?.maxLimit ?? MAX_LIST_LIMIT;

  const parsed = typeof raw === "string" || typeof raw === "number"
    ? Number(raw)
    : Number.NaN;

  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : defaultLimit;
  return Math.max(1, Math.min(value, maxLimit));
}

export function clampWindowDays(raw: unknown, options?: { defaultDays?: number; maxDays?: number }) {
  const defaultDays = options?.defaultDays ?? 30;
  const maxDays = options?.maxDays ?? 365;

  const parsed = typeof raw === "string" || typeof raw === "number"
    ? Number(raw)
    : Number.NaN;
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : defaultDays;
  return Math.max(1, Math.min(value, maxDays));
}

