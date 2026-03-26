import type { Request, Response, NextFunction } from "express";

import { AppError } from "./error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { getAccessTokenCookieName, verifyAccessToken } from "../utils/auth-session.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { SupportSessionService } from "../services/support-session.service.js";
import { getSupportSessionCookieName, verifySupportSessionToken } from "../utils/support-session-token.js";

function clearSupportCookie(res: Response) {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie(getSupportSessionCookieName(), "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const accessToken = req.cookies[getAccessTokenCookieName()];
  if (!accessToken) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }

  const payload = await verifyAccessToken(accessToken);
  if (!payload) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }

  const user = await MongoAuthRepository.findUserById(payload.userId);
  if (!user || !user.is_active) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }

  const session = await MongoAuthRepository.findRefreshSessionById(payload.sessionId);
  const sessionExpired = !session?.expires_at || new Date(session.expires_at).getTime() <= Date.now();
  if (
    !session ||
    session.user_id !== user.id ||
    session.tenant_id !== user.tenant_id ||
    session.revoked_at ||
    sessionExpired
  ) {
    throw new AppError("SESSION_REVOKED", "Your session is no longer active. Please log in again.", 401);
  }

  const baseUrl = String(req.baseUrl ?? "");
  const isAuthRoute = baseUrl.startsWith("/api/v1/auth") || baseUrl.startsWith("/api/auth");
  if (user.role === "student" && user.must_change_password && !isAuthRoute) {
    throw new AppError(
      "PASSWORD_RESET_REQUIRED",
      "You must change your temporary password before accessing the platform.",
      403,
    );
  }

  req.auth = {
    sessionId: payload.sessionId,
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenant_id,
  };

  // Admins only: allow time-limited, college-approved support mode via a separate cookie.
  if (user.role === "admin") {
    const supportToken = req.cookies[getSupportSessionCookieName()];
    if (supportToken) {
      const payload = await verifySupportSessionToken(String(supportToken));
      if (!payload || payload.userId !== user.id) {
        clearSupportCookie(res);
      } else {
        const session = await SupportSessionService.getById(payload.sessionId);
        const nowMs = Date.now();
        const expiresAtMs = session?.expires_at ? new Date(session.expires_at).getTime() : 0;

        const isValid =
          !!session
          && session.status === "approved"
          && session.requested_by_user_id === user.id
          && session.tenant_id === payload.tenantId
          && expiresAtMs > nowMs;

        if (!isValid) {
          clearSupportCookie(res);
        } else {
          req.auth.actorTenantId = req.auth.tenantId;
          req.auth.tenantId = session.tenant_id;
          req.auth.support = {
            sessionId: session.id,
            tenantId: session.tenant_id,
            expiresAt: session.expires_at!,
            approvedBy: session.decided_by_email ?? "tpo",
          };

          await AuditLogService.log({
            tenantId: session.tenant_id,
            actorUserId: user.id,
            actorRole: user.role,
            actorTenantId: req.auth.actorTenantId,
            eventType: "support_access",
            supportSessionId: session.id,
            method: req.method,
            path: req.originalUrl ?? req.path,
            ip: (req.headers["x-forwarded-for"] as string | undefined) ?? req.ip,
            userAgent: req.headers["user-agent"] as string | undefined,
          });
        }
      }
    }
  }

  next();
}
