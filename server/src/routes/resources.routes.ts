import { Router } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AppError } from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { StudentService } from "../services/student.service.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

function resolveMaterialRoot(): string {
  const routeDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(routeDir, "../../../material"),
    path.resolve(process.cwd(), "../material"),
    path.resolve(process.cwd(), "material"),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  return found ?? candidates[0];
}

const materialRoot = resolveMaterialRoot();

router.use(asyncHandler(requireAuth));

router.get(
  "/",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const topicId = req.query.topicId as string | undefined;
    const data = await StudentService.getResources(req.auth!.tenantId, topicId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/topics",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const query = req.query.query as string | undefined;
    const limit = Number(req.query.limit ?? 20);
    const data = await StudentService.listTopics(req.auth!.tenantId, query, limit);
    res.json(successResponse(data));
  }),
);

router.get(
  "/search",
  authorizeRole("student"),
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
  "/file",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const requested = String(req.query.path ?? "").trim();
    if (!requested) {
      throw new AppError("INVALID_RESOURCE_PATH", "Resource path is required", 400);
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

    res.sendFile(absolutePath);
  }),
);

export default router;
