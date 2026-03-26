const CSRF_COOKIE = "cdai_csrf";

export function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.split("=")[1];

  return value ? decodeURIComponent(value) : null;
}

export function getCsrfToken(): string | null {
  return getCookieValue(CSRF_COOKIE);
}

export function withCsrfHeader(headers: HeadersInit | undefined): HeadersInit {
  const token = getCsrfToken();
  if (!token) return headers ?? {};

  if (!headers) {
    return { "x-csrf-token": token };
  }

  if (headers instanceof Headers) {
    const cloned = new Headers(headers);
    cloned.set("x-csrf-token", token);
    return cloned;
  }

  if (Array.isArray(headers)) {
    return [...headers, ["x-csrf-token", token]];
  }

  return { ...headers, "x-csrf-token": token };
}

