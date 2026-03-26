import { Router } from "express";

import { AppError } from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authLoginRateLimiter } from "../middleware/rate-limit.middleware.js";
import { AuthService } from "../services/auth.service.js";
import { initialPasswordResetSchema, loginSchema } from "../validators/auth.schema.js";
import { successResponse } from "../utils/response-envelope.js";
import {
  setSessionCookies,
  clearSessionCookies,
  getAccessTokenCookieName,
  getRefreshTokenCookieName,
} from "../utils/auth-session.js";

const router = Router();

router.post(
  "/login",
  authLoginRateLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const result = await AuthService.login(body);

    setSessionCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });

    res.json(
      successResponse({
        profile: result.profile,
        redirectTo: result.redirectTo,
        mustChangePassword: result.mustChangePassword,
      }),
    );
  }),
);

router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    void req;
    void res;
    throw new AppError(
      "SELF_SIGNUP_DISABLED",
      "Self-signup is disabled. Accounts are created and shared by your college admin or TPO.",
      403,
    );
  }),
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    await AuthService.logout({
      refreshToken: req.cookies[getRefreshTokenCookieName()],
      accessToken: req.cookies[getAccessTokenCookieName()],
    });
    clearSessionCookies(res);
    res.json(successResponse({ message: "Logged out" }));
  }),
);

router.get(
  "/me",
  asyncHandler(async (req, res, next) => {
    await requireAuth(req, res, next);
  }),
  asyncHandler(async (req, res) => {
    const profile = await AuthService.me(req.auth!.userId);
    res.json(successResponse(profile));
  }),
);

router.post(
  "/password/initial-reset",
  asyncHandler(async (req, res, next) => {
    await requireAuth(req, res, next);
  }),
  asyncHandler(async (req, res) => {
    const body = initialPasswordResetSchema.parse(req.body);
    const result = await AuthService.completeInitialPasswordReset(req.auth!.userId, body.newPassword);
    res.json(successResponse(result));
  }),
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies[getRefreshTokenCookieName()];
    if (!refreshToken) {
      res.status(401).json({ success: false, error: { code: "NO_REFRESH_TOKEN", message: "No refresh token" } });
      return;
    }

    const tokens = await AuthService.refreshSession(refreshToken);
    setSessionCookies(res, tokens);
    res.json(successResponse({ message: "Session refreshed" }));
  }),
);

export default router;
