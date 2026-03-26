import { Router } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { AppError } from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { requireCompletedStudentProfile } from "../middleware/student-profile.middleware.js";
import { StudentService } from "../services/student.service.js";
import { ResourceStorageBudgetService } from "../services/resource-storage-budget.service.js";
import { successResponse } from "../utils/response-envelope.js";
import { isManagedCloudUrl, resolveMaterialRoot } from "../utils/storage.js";
import { clampListLimit } from "../utils/pagination.js";

const router = Router();

const materialRoot = resolveMaterialRoot();

function resolveFileResponseMode(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".pdf") {
    return { contentType: "application/pdf", disposition: "inline" };
  }

  if (extension === ".md" || extension === ".markdown" || extension === ".txt") {
    return { contentType: "text/plain; charset=utf-8", disposition: "inline" };
  }

  if (extension === ".json" || extension === ".ipynb") {
    return { contentType: "application/json; charset=utf-8", disposition: "inline" };
  }

  if (extension === ".csv") {
    return { contentType: "text/csv; charset=utf-8", disposition: "inline" };
  }

  return { contentType: null, disposition: "attachment" };
}

router.use(asyncHandler(requireAuth));

router.get(
  "/",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const topicId = req.query.topicId as string | undefined;
    const limit = clampListLimit(req.query.limit, { defaultLimit: 24, maxLimit: 100 });
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const data = await StudentService.getResourcesPage(req.auth!.tenantId, {
      topicId,
      limit,
      cursor,
    });
    res.json(successResponse(data.items, {
      pagination: {
        cursor: data.nextCursor,
        has_more: data.hasMore,
        limit,
      },
    }));
  }),
);

router.get(
  "/topics",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const query = req.query.query as string | undefined;
    const limit = clampListLimit(req.query.limit, { defaultLimit: 20, maxLimit: 200 });
    const data = await StudentService.listTopics(req.auth!.tenantId, query, limit);
    res.json(successResponse(data));
  }),
);

router.get(
  "/search",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const topic = String(req.query.topic ?? "").trim();
    if (!topic) {
      throw new AppError("TOPIC_QUERY_REQUIRED", "topic query is required", 400);
    }
    const data = await StudentService.searchStudyContent(req.auth!.tenantId, topic);
    res.json(successResponse(data));
  }),
);

router.get(
  "/storage-budget",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (_req, res) => {
    const data = await ResourceStorageBudgetService.getStatus();
    res.json(successResponse(data));
  }),
);

router.get(
  "/admin/storage-budget",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (_req, res) => {
    const data = await ResourceStorageBudgetService.getAdminDashboard();
    res.json(successResponse(data));
  }),
);

router.get(
  "/file",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const requested = String(req.query.path ?? "").trim();
    const remoteUrl = String(req.query.url ?? "").trim();
    if (!requested && !remoteUrl) {
      throw new AppError("INVALID_RESOURCE_PATH", "Resource path is required", 400);
    }

    if (remoteUrl) {
      if (!isManagedCloudUrl(remoteUrl)) {
        throw new AppError("INVALID_RESOURCE_PATH", "Invalid cloud resource url", 400);
      }

      const reservation = await ResourceStorageBudgetService.reserveCloudRead().catch(async (error: unknown) => {
        const budget = await ResourceStorageBudgetService.getStatus();
        if (budget.enabled && budget.overallStatus === "blocked") {
          throw new AppError(
            "RESOURCE_BUDGET_EXCEEDED",
            budget.message ?? "Cloud resource access is temporarily paused to prevent extra AWS charges.",
            429,
          );
        }

        throw new AppError(
          "RESOURCE_ACCESS_UNAVAILABLE",
          error instanceof Error && error.message
            ? `Cloud resource access is temporarily unavailable. ${error.message}`
            : "Cloud resource access is temporarily unavailable. Please try again in a moment.",
          503,
        );
      });

      const response = await fetch(remoteUrl);
      if (!response.ok || !response.body) {
        await reservation.rollback();
        throw new AppError("RESOURCE_NOT_FOUND", `Cloud resource unavailable (${response.status})`, 404);
      }

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (
        reservation.status.enabled
        && Number.isFinite(contentLength)
        && contentLength > 0
        && reservation.status.transfer.remaining < contentLength
      ) {
        await reservation.rollback();
        throw new AppError(
          "RESOURCE_BUDGET_EXCEEDED",
          "Cloud resource access is paused because downloading this file would exceed this month's AWS safety cap.",
          429,
        );
      }

      const cloudPath = new URL(remoteUrl).pathname;
      const { contentType, disposition } = resolveFileResponseMode(cloudPath);
      res.setHeader("X-Resource-Budget-Status", reservation.status.overallStatus);
      res.setHeader("X-Resource-Budget-Requests-Used", String(reservation.status.requests.used));
      res.setHeader("X-Resource-Budget-Requests-Limit", String(reservation.status.requests.limit));
      res.setHeader("X-Resource-Budget-Transfer-Used", String(reservation.status.transfer.used));
      res.setHeader("X-Resource-Budget-Transfer-Limit", String(reservation.status.transfer.limit));
      res.type(contentType || String(response.headers.get("content-type") ?? "application/octet-stream"));
      res.setHeader("Content-Disposition", `${disposition}; filename="${path.basename(cloudPath)}"`);

      let transferredBytes = 0;
      let completed = false;
      const stream = Readable.fromWeb(response.body as any);

      const finalizeSuccess = async () => {
        if (completed) return;
        completed = true;
        await reservation.commit(transferredBytes);
      };

      const finalizeFailure = async () => {
        if (completed) return;
        completed = true;
        await reservation.rollback();
      };

      stream.on("data", (chunk) => {
        transferredBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      });

      stream.on("error", () => {
        void finalizeFailure();
      });

      res.on("finish", () => {
        void finalizeSuccess();
      });

      res.on("close", () => {
        if (!res.writableEnded) {
          void finalizeFailure();
        }
      });

      stream.pipe(res);
      return;
    }

    const normalizedRelative = path.posix.normalize(requested.replace(/\\/g, "/"));
    if (normalizedRelative.startsWith("../") || normalizedRelative.includes("/../")) {
      throw new AppError("INVALID_RESOURCE_PATH", "Invalid resource path", 400);
    }

    const absolutePath = path.resolve(materialRoot, normalizedRelative);
    if (!absolutePath.startsWith(materialRoot)) {
      throw new AppError("INVALID_RESOURCE_PATH", "Invalid resource path", 400);
    }
    if (!existsSync(absolutePath)) {
      throw new AppError("RESOURCE_NOT_FOUND", "Resource file not found", 404);
    }

    const { contentType, disposition } = resolveFileResponseMode(absolutePath);
    if (contentType) {
      res.type(contentType);
    }
    res.setHeader("Content-Disposition", `${disposition}; filename="${path.basename(absolutePath)}"`);

    res.sendFile(absolutePath);
  }),
);

router.get(
  "/:resourceId",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const resourceId = String(req.params.resourceId ?? "").trim();
    if (!resourceId) {
      throw new AppError("RESOURCE_ID_REQUIRED", "Resource id is required", 400);
    }

    const data = await StudentService.getResourceById(req.auth!.tenantId, resourceId);
    if (!data) {
      throw new AppError("RESOURCE_NOT_FOUND", "Resource not found", 404);
    }

    res.json(successResponse(data));
  }),
);

router.post(
  "/:resourceId/view-events",
  authorizeRole("student"),
  asyncHandler(requireCompletedStudentProfile),
  asyncHandler(async (req, res) => {
    const resourceId = String(req.params.resourceId ?? "").trim();
    const eventType = String(req.body?.eventType ?? "").trim().toLowerCase();
    const sessionId = String(req.body?.sessionId ?? "").trim();

    if (!resourceId) {
      throw new AppError("RESOURCE_ID_REQUIRED", "Resource id is required", 400);
    }
    if (!sessionId) {
      throw new AppError("RESOURCE_SESSION_REQUIRED", "sessionId is required", 400);
    }
    if (!["open", "heartbeat", "close", "external_redirect"].includes(eventType)) {
      throw new AppError("RESOURCE_EVENT_INVALID", "Unsupported resource view event", 400);
    }

    const data = await StudentService.recordResourceViewEvent({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      resourceId,
      eventType,
      sessionId,
      durationSec: Number(req.body?.durationSec ?? 0),
      progressPct: req.body?.progressPct !== undefined ? Number(req.body.progressPct) : undefined,
      pageNumber: req.body?.pageNumber !== undefined ? Number(req.body.pageNumber) : undefined,
      scrollDepthPct: req.body?.scrollDepthPct !== undefined ? Number(req.body.scrollDepthPct) : undefined,
      sourceContext: req.body?.sourceContext ? String(req.body.sourceContext) : undefined,
      metadata: req.body?.metadata && typeof req.body.metadata === "object"
        ? req.body.metadata as Record<string, unknown>
        : undefined,
    });

    res.json(successResponse(data));
  }),
);

export default router;
