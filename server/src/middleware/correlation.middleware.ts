import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function ensureCorrelationId(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers["x-correlation-id"];
  const existing = typeof raw === "string" ? raw.trim() : "";
  const correlationId = existing.length > 6 ? existing : `req_${crypto.randomUUID()}`;

  // Keep a stable value for downstream handlers and error middleware.
  (req as unknown as { correlationId?: string }).correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);

  next();
}

