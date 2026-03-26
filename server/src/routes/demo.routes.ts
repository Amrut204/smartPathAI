import type { Request, Response } from "express";
import { Router } from "express";

import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { clearSessionCookies, createSessionTokens, setSessionCookies } from "../utils/auth-session.js";
import { logger } from "../utils/logger.js";
import { getMongoDb } from "../utils/mongodb.js";

const router = Router();
const DEMO_LOGIN_ATTEMPTS_COLLECTION = "demo_login_attempts";
const DEMO_SUPPORT_EMAIL = process.env.DEMO_SUPPORT_EMAIL || "your-email@domain.com";
const DEMO_SUPPORT_PHONE = process.env.DEMO_SUPPORT_PHONE || "+91-XXXXX-XXXXX";
const DEMO_REPORT_URL = process.env.DEMO_REPORT_URL || `mailto:${DEMO_SUPPORT_EMAIL}?subject=Demo%20Issue`;
const ACCEPTED_DEMO_SLUGS = ["st-xaviers-demo", "stxaviers-demo"] as const;
const DEMO_REFRESH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const demoAccounts = {
  tpo: "tpo@stxaviers-demo.edu",
  student: "student001@stxaviers-demo.edu",
} as const;

function buildErrorId() {
  return `demo-${Date.now()}`;
}

function renderDemoErrorPage(params: {
  errorId: string;
  title?: string;
  error: string;
  whatWentWrong: string;
  nextSteps?: string[];
}) {
  const nextSteps = params.nextSteps ?? [
    "Contact support using the details below.",
    "Mention the error ID so we can diagnose the demo quickly.",
    "We aim to restore the demo within 15 minutes.",
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${params.title ?? "Demo Unavailable"}</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 20px; color: #111827; line-height: 1.6;">
  <h1 style="margin-bottom: 16px;">Demo Temporarily Unavailable</h1>
  <p><strong>Error:</strong> ${params.error}</p>
  <p>${params.whatWentWrong}</p>
  <h3>Next Steps</h3>
  <ul>
    ${nextSteps.map((step) => `<li>${step}</li>`).join("")}
    <li>Contact: <a href="mailto:${DEMO_SUPPORT_EMAIL}">${DEMO_SUPPORT_EMAIL}</a></li>
    <li>Phone: <a href="tel:${DEMO_SUPPORT_PHONE}">${DEMO_SUPPORT_PHONE}</a></li>
    <li><a href="${DEMO_REPORT_URL}">Report this issue</a></li>
  </ul>
  <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">
    Error ID: ${params.errorId} - Please mention this when contacting support.
  </p>
</body>
</html>`;
}

async function logDemoAttempt(input: {
  route: string;
  persona: string;
  success: boolean;
  errorMessage?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  email?: string | null;
  errorId?: string | null;
  req: Request;
}) {
  const payload = {
    route: input.route,
    persona: input.persona,
    success: input.success,
    errorMessage: input.errorMessage ?? null,
    tenantId: input.tenantId ?? null,
    userId: input.userId ?? null,
    email: input.email ?? null,
    errorId: input.errorId ?? null,
    ip: input.req.ip,
    userAgent: String(input.req.get("user-agent") ?? ""),
  };

  if (input.success) {
    logger.info("Demo login attempt", {
      tenant_id: input.tenantId ?? undefined,
      user_id: input.userId ?? undefined,
      context: payload,
    });
  } else {
    logger.error("Demo login attempt failed", {
      tenant_id: input.tenantId ?? undefined,
      user_id: input.userId ?? undefined,
      context: payload,
    });
  }

  try {
    const db = await getMongoDb();
    await db.collection(DEMO_LOGIN_ATTEMPTS_COLLECTION).insertOne({
      id: input.errorId ?? buildErrorId(),
      route: input.route,
      persona: input.persona,
      success: input.success,
      error_message: input.errorMessage ?? null,
      tenant_id: input.tenantId ?? null,
      user_id: input.userId ?? null,
      email: input.email ?? null,
      ip: input.req.ip ?? null,
      user_agent: String(input.req.get("user-agent") ?? ""),
      created_at: new Date().toISOString(),
    });
  } catch (loggingError) {
    logger.error("Failed to persist demo login attempt", {
      context: {
        route: input.route,
        persona: input.persona,
        loggingError: loggingError instanceof Error ? loggingError.message : String(loggingError),
      },
    });
  }
}

async function respondWithDemoError(
  req: Request,
  res: Response,
  params: {
    persona: string;
    route: string;
    status: number;
    error: string;
    whatWentWrong: string;
    tenantId?: string | null;
    userId?: string | null;
    email?: string | null;
  },
) {
  const errorId = buildErrorId();
  clearSessionCookies(res);
  await logDemoAttempt({
    route: params.route,
    persona: params.persona,
    success: false,
    errorMessage: params.error,
    tenantId: params.tenantId ?? null,
    userId: params.userId ?? null,
    email: params.email ?? null,
    errorId,
    req,
  });

  res
    .status(params.status)
    .type("html")
    .send(renderDemoErrorPage({
      errorId,
      error: params.error,
      whatWentWrong: params.whatWentWrong,
    }));
}

async function autoLoginDemoPersona(persona: string, req: Request, res: Response) {
  const normalizedPersona = String(persona ?? "").trim().toLowerCase();
  const email = normalizedPersona === "tpo"
    ? demoAccounts.tpo
    : normalizedPersona === "student"
      ? demoAccounts.student
      : null;

  if (!email) {
    await respondWithDemoError(req, res, {
      persona: normalizedPersona || "unknown",
      route: req.originalUrl,
      status: 404,
      error: "Unknown demo persona",
      whatWentWrong: "The requested demo route does not map to a supported persona.",
    });
    return;
  }

  clearSessionCookies(res);

  try {
    const user = await MongoAuthRepository.findUserByEmail(email);
    if (!user) {
      await respondWithDemoError(req, res, {
        persona: normalizedPersona,
        route: req.originalUrl,
        status: 503,
        error: "Demo environment not initialized",
        whatWentWrong: "The demo user account could not be found. This usually means the demo data needs to be seeded before the call.",
        email,
      });
      return;
    }

    const tenant = await MongoAuthRepository.findTenantById(user.tenant_id);
    const tenantSlug = String(tenant?.slug ?? "");
    if (!tenant || !tenant.is_active || !ACCEPTED_DEMO_SLUGS.includes(tenantSlug as typeof ACCEPTED_DEMO_SLUGS[number])) {
      await respondWithDemoError(req, res, {
        persona: normalizedPersona,
        route: req.originalUrl,
        status: 503,
        error: "Demo tenant missing or inactive",
        whatWentWrong: "The demo account exists, but its tenant could not be validated. The demo environment may be partially seeded or disabled.",
        tenantId: user.tenant_id,
        userId: user.id,
        email,
      });
      return;
    }

    const tokens = await createSessionTokens({
      sessionId: (
        await MongoAuthRepository.createRefreshSession({
          userId: user.id,
          tenantId: user.tenant_id,
          expiresAt: new Date(Date.now() + DEMO_REFRESH_SESSION_TTL_MS).toISOString(),
        })
      ).id,
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
    });

    if (!tokens.accessToken || !tokens.refreshToken) {
      await respondWithDemoError(req, res, {
        persona: normalizedPersona,
        route: req.originalUrl,
        status: 503,
        error: "Unable to create demo session",
        whatWentWrong: "The demo account was found, but session token generation did not complete successfully.",
        tenantId: user.tenant_id,
        userId: user.id,
        email,
      });
      return;
    }

    setSessionCookies(res, tokens);
    await logDemoAttempt({
      route: req.originalUrl,
      persona: normalizedPersona,
      success: true,
      tenantId: user.tenant_id,
      userId: user.id,
      email: user.email,
      req,
    });
    res.redirect(user.role === "student" ? "/dashboard" : "/tpo/dashboard");
  } catch (error) {
    await respondWithDemoError(req, res, {
      persona: normalizedPersona,
      route: req.originalUrl,
      status: 503,
      error: "Demo session failed to start",
      whatWentWrong: "An unexpected issue interrupted the demo login flow. The application handled it safely and prevented a broken or partial session.",
      email,
    });
  }
}

router.get(
  "/auto-login-tpo",
  async (req, res) => {
    await autoLoginDemoPersona("tpo", req, res);
  },
);

router.get(
  "/auto-login-student",
  async (req, res) => {
    await autoLoginDemoPersona("student", req, res);
  },
);

router.get(
  "/auto-login/:persona",
  async (req, res) => {
    await autoLoginDemoPersona(String(req.params.persona ?? ""), req, res);
  },
);

export default router;
