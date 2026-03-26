import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

import { AppError } from "./error-handler.js";

const CSRF_COOKIE = "cdai_csrf";
const CSRF_HEADER = "x-csrf-token";
const CSRF_TTL_MS = 1000 * 60 * 60 * 24; // 24h

function isMutatingMethod(method: string) {
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function normalizeHost(value: string) {
  return String(value ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

function buildAllowedOrigins(req: Request) {
  const allowed = new Set<string>();
  const fromEnv = normalizeOrigin(String(process.env.APP_URL ?? ""));
  if (fromEnv) {
    allowed.add(fromEnv);

    try {
      const parsed = new URL(fromEnv);
      const baseHost = normalizeHost(parsed.host);
      if (baseHost.startsWith("www.")) {
        allowed.add(`${parsed.protocol}//${baseHost.slice(4)}`);
      } else {
        allowed.add(`${parsed.protocol}//www.${baseHost}`);
      }
    } catch {
      // Ignore invalid APP_URL formatting here and fall back to request-derived origins.
    }
  }

  const forwardedProto = normalizeHost(String(req.headers["x-forwarded-proto"] ?? ""));
  const forwardedHost = normalizeHost(String(req.headers["x-forwarded-host"] ?? ""));
  const requestHost = normalizeHost(String(req.headers.host ?? ""));
  const requestProto = forwardedProto || req.protocol || "http";
  const effectiveHost = forwardedHost || requestHost;
  if (effectiveHost) {
    allowed.add(`${requestProto}://${effectiveHost}`);
  }

  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ].forEach((origin) => allowed.add(origin));

  return allowed;
}

function isExcludedPath(path: string) {
  // These endpoints are called before the user has any session/CSRF context.
  // Login/Signup are protected by rate limiting.
  if (path === "/api/v1/auth/login"
    || path === "/api/v1/auth/signup"
    || path === "/api/auth/login"
    || path === "/api/auth/signup") {
    return true;
  }

  // Low-risk telemetry endpoint used with navigator.sendBeacon(), which cannot set headers.
  if ((path.startsWith("/api/v1/resources/") || path.startsWith("/api/resources/")) && path.endsWith("/view-events")) {
    return true;
  }

  return false;
}

export function ensureCsrfCookie(req: Request, res: Response, next: NextFunction) {
  const existing = req.cookies?.[CSRF_COOKIE];
  if (!existing || typeof existing !== "string" || existing.length < 16) {
    const token = crypto.randomBytes(24).toString("base64url");
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: CSRF_TTL_MS,
    });
  }

  next();
}

export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (!isMutatingMethod(req.method)) {
    next();
    return;
  }

  if (isExcludedPath(req.path)) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || typeof cookieToken !== "string" || !headerToken || cookieToken !== headerToken) {
    throw new AppError("CSRF_INVALID", "Invalid CSRF token", 403);
  }

  // Extra safeguard: ensure requests come from our frontend origin in production.
  if (process.env.NODE_ENV === "production" && process.env.APP_URL) {
    const origin = req.headers.origin ? normalizeOrigin(String(req.headers.origin)) : "";
    const allowed = buildAllowedOrigins(req);
    if (!origin || !allowed.has(origin)) {
      throw new AppError("CSRF_ORIGIN_BLOCKED", "Origin not allowed", 403);
    }
  }

  next();
}

export function getCsrfCookieName() {
  return CSRF_COOKIE;
}
