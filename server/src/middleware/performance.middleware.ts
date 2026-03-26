import type { NextFunction, Request, Response } from "express";

import { logger } from "../utils/logger.js";

const slowRequestThresholdMs = Math.max(100, Number(process.env.SLOW_REQUEST_LOG_THRESHOLD_MS ?? 500));

export function logSlowApiRequests(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    if (!req.originalUrl.startsWith("/api/")) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (durationMs < slowRequestThresholdMs) {
      return;
    }

    logger.info("Slow API request", {
      context: {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
        responseBytes: res.getHeader("content-length") ?? null,
      },
    });
  });

  next();
}
