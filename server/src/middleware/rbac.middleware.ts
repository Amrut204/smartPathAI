import type { Request, Response, NextFunction } from "express";
import type { AppRole } from "../types/domain.types.js";
import { AppError } from "./error-handler.js";

export function authorizeRole(...allowedRoles: AppRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }

    if (!allowedRoles.includes(req.auth.role)) {
      throw new AppError("FORBIDDEN", "Insufficient permissions", 403);
    }

    next();
  };
}
