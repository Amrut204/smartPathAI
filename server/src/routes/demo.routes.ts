import { Router } from "express";

import { asyncHandler, AppError } from "../middleware/error-handler.js";
import { AuthService } from "../services/auth.service.js";
import { setSessionCookies } from "../utils/auth-session.js";

const router = Router();

const DEFAULT_DEMO_TPO_EMAIL = "tpo@stxaviers-demo.edu";
const DEFAULT_DEMO_TPO_PASSWORD = "Demo@123";
const DEFAULT_DEMO_STUDENT_EMAIL = "student001@stxaviers-demo.edu";
const DEFAULT_DEMO_STUDENT_PASSWORD = "Student@123";

function resolveDemoCredentials(kind: "tpo" | "student") {
  if (kind === "tpo") {
    return {
      email: process.env.DEMO_TPO_EMAIL || DEFAULT_DEMO_TPO_EMAIL,
      password: process.env.DEMO_TPO_PASSWORD || DEFAULT_DEMO_TPO_PASSWORD,
    };
  }

  return {
    email: process.env.DEMO_STUDENT_EMAIL || DEFAULT_DEMO_STUDENT_EMAIL,
    password: process.env.DEMO_STUDENT_PASSWORD || DEFAULT_DEMO_STUDENT_PASSWORD,
  };
}

async function autoLoginDemoUser(kind: "tpo" | "student") {
  const credentials = resolveDemoCredentials(kind);

  try {
    return await AuthService.login({
      email: credentials.email,
      password: credentials.password,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_CREDENTIALS") {
      throw new AppError(
        "DEMO_LOGIN_UNAVAILABLE",
        `Demo ${kind.toUpperCase()} login is unavailable. Seed or verify demo credentials first.`,
        404,
      );
    }
    throw error;
  }
}

router.get(
  "/auto-login-tpo",
  asyncHandler(async (_req, res) => {
    const result = await autoLoginDemoUser("tpo");
    setSessionCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });

    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, result.redirectTo);
  }),
);

router.get(
  "/auto-login-student",
  asyncHandler(async (_req, res) => {
    const result = await autoLoginDemoUser("student");
    setSessionCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });

    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, result.redirectTo);
  }),
);

export default router;