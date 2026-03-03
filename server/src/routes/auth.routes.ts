import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { AuthService } from "../services/auth.service.js";
import { loginSchema, signupSchema } from "../validators/auth.schema.js";
import { successResponse } from "../utils/response-envelope.js";
import {
  setSessionCookies,
  clearSessionCookies,
  getRefreshTokenCookieName,
} from "../utils/auth-session.js";

const router = Router();

router.post(
  "/login",
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
      }),
    );
  }),
);

router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const body = signupSchema.parse(req.body);
    const result = await AuthService.signup(body);

    setSessionCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });

    res.status(201).json(
      successResponse({
        profile: result.profile,
        redirectTo: result.redirectTo,
      }),
    );
  }),
);

router.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    await AuthService.logout();
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
