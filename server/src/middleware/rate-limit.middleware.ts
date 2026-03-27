import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { RequestHandler } from "express";

import { logger } from "../utils/logger.js";

function rateLimitJsonHandler(code: string, message: string): RequestHandler {
  return (req, res) => {
    logger.warn("Rate limit triggered", {
      context: {
        code,
        ip: req.ip,
        path: req.path,
      },
    });

    res.status(429).json({
      success: false,
      error: { code, message },
    });
  };
}

export const authLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Count only failed attempts; a successful login should reset friction.
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    return `${ipKeyGenerator(ip)}:${email}`;
  },
  handler: rateLimitJsonHandler(
    "AUTH_RATE_LIMITED",
    "Too many login attempts. Please try again after 15 minutes.",
  ),
});

export const authSignupRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: rateLimitJsonHandler(
    "SIGNUP_RATE_LIMITED",
    "Too many signup attempts. Please try again later.",
  ),
});

export const uploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 25,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = (req as unknown as { auth?: { userId?: string; tenantId?: string } }).auth;
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    return `${ipKeyGenerator(ip)}:${String(auth?.tenantId ?? "no-tenant")}:${String(auth?.userId ?? "anon")}`;
  },
  handler: rateLimitJsonHandler(
    "UPLOAD_RATE_LIMITED",
    "Too many uploads recently. Please wait a few minutes and try again.",
  ),
});

export const exportRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = (req as unknown as { auth?: { userId?: string; tenantId?: string } }).auth;
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    return `${ipKeyGenerator(ip)}:${String(auth?.tenantId ?? "no-tenant")}:${String(auth?.userId ?? "anon")}`;
  },
  handler: rateLimitJsonHandler(
    "EXPORT_RATE_LIMITED",
    "Too many exports recently. Please wait a few minutes and try again.",
  ),
});

function buildTenantUserRateLimiter(options: {
  windowMs: number;
  limit: number;
  code: string;
  message: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const auth = (req as unknown as { auth?: { userId?: string; tenantId?: string } }).auth;
      const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
      return `${ipKeyGenerator(ip)}:${String(auth?.tenantId ?? "no-tenant")}:${String(auth?.userId ?? "anon")}`;
    },
    handler: rateLimitJsonHandler(options.code, options.message),
  });
}

export const communicationSendRateLimiter = buildTenantUserRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  code: "COMMUNICATION_SEND_RATE_LIMITED",
  message: "Too many communication sends recently. Please wait a few minutes and try again.",
});

export const resultReleaseRateLimiter = buildTenantUserRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 5,
  code: "RESULT_RELEASE_RATE_LIMITED",
  message: "Too many result release attempts recently. Please wait a few minutes and try again.",
});

export const mockTestStartRateLimiter = buildTenantUserRateLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  code: "MOCK_TEST_START_RATE_LIMITED",
  message: "Too many mock test starts recently. Please wait a few minutes and try again.",
});
