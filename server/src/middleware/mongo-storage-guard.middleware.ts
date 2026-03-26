import type { NextFunction, Request, Response } from "express";

import { AppError } from "./error-handler.js";
import { MongoStorageGuardService } from "../services/mongo-storage-guard.service.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH"]);
const EXEMPT_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
]);

function shouldBypass(req: Request): boolean {
  const method = String(req.method || "").toUpperCase();
  if (!MUTATING_METHODS.has(method)) {
    return true;
  }

  const path = String(req.path || "");
  const originalUrl = String(req.originalUrl || req.url || "").split("?")[0];
  return EXEMPT_PATHS.has(path) || EXEMPT_PATHS.has(originalUrl);
}

export async function enforceMongoStorageGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (shouldBypass(req)) {
    next();
    return;
  }

  const status = await MongoStorageGuardService.getStatus();
  res.setHeader("X-Mongo-Storage-Level", status.level);
  res.setHeader("X-Mongo-Storage-Used", String(status.usedBytes));
  res.setHeader("X-Mongo-Storage-Limit", String(status.limitBytes));
  res.setHeader("X-Mongo-Storage-Percent", String(status.percentUsed));

  if (status.enabled && status.level === "blocked") {
    next(new AppError(
      "MONGO_STORAGE_LIMIT_REACHED",
      status.message ?? "New writes are paused because the Atlas storage safety cap has been reached.",
      507,
    ));
    return;
  }

  next();
}
