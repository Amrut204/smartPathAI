import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { MulterError } from "multer";

import { errorResponse } from "../utils/response-envelope.js";
import { logger } from "../utils/logger.js";

export class AppError extends Error {
  code: string;
  status: number;
  details?: Array<{ field?: string; message: string }>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details?: Array<{ field?: string; message: string }>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isDependencyNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  if (message.includes("fetch failed")) return true;

  const cause = (error as { cause?: { code?: string } }).cause;
  const causeCode = cause?.code ?? "";

  return (
    causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
    causeCode === "UND_ERR_CONNECT_ERROR" ||
    causeCode === "ECONNREFUSED" ||
    causeCode === "ENOTFOUND"
  );
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const correlationId =
    (req as unknown as { correlationId?: string }).correlationId
    ?? (req.headers["x-correlation-id"] as string | undefined);

  if (err instanceof AppError) {
    res.status(err.status).json(
      errorResponse(
        { code: err.code, message: err.message, details: err.details },
        { correlation_id: correlationId },
      ),
    );
    return;
  }

  if (err instanceof z.ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));

    res.status(400).json(
      errorResponse(
        { code: "VALIDATION_ERROR", message: "Request validation failed", details },
        { correlation_id: correlationId },
      ),
    );
    return;
  }

  if (err instanceof MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json(
        errorResponse(
          { code: "RESUME_FILE_TOO_LARGE", message: "Keep the resume PDF under 1 MB." },
          { correlation_id: correlationId },
        ),
      );
      return;
    }

    res.status(400).json(
      errorResponse(
        { code: "UPLOAD_ERROR", message: err.message || "File upload failed" },
        { correlation_id: correlationId },
      ),
    );
    return;
  }

  if (isDependencyNetworkError(err)) {
    res.status(503).json(
      errorResponse(
        { code: "DEPENDENCY_UNAVAILABLE", message: "A required service is temporarily unavailable. Please try again shortly." },
        { correlation_id: correlationId },
      ),
    );
    return;
  }

  logger.error("Unhandled API error", {
    correlation_id: correlationId,
    context: {
      error: { name: err.name, message: err.message, stack: err.stack },
    },
  });

  res.status(500).json(
    errorResponse(
      { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong" },
      { correlation_id: correlationId },
    ),
  );
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
