import type { Request, Response, NextFunction } from "express";

import { AppError } from "./error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { getAccessTokenCookieName, verifyAccessToken } from "../utils/auth-session.js";

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
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

  req.auth = {
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenant_id,
  };

  next();
}
