import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { QuestionBankService } from "../services/question-bank.service.js";
import { getMongoDb } from "../utils/mongodb.js";
import adminOpsRoutes from "./admin-ops.routes.js";
import {
  listQuestionBankQuerySchema,
  reviewQuestionBankSchema,
} from "../validators/question-bank.schema.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("admin"));
router.use("/admin-ops", adminOpsRoutes);

router.get(
  "/platform-overview",
  asyncHandler(async (_req, res) => {
    const db = await getMongoDb();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      tenantTotal,
      tenantActive,
      userTotal,
      userActive,
      studentTotal,
      driveTotal,
      commTotal,
      studentRoleCount,
      tpoRoleCount,
      adminRoleCount,
      activityEvents7d,
    ] = await Promise.all([
      db.collection("tenants").countDocuments({}),
      db.collection("tenants").countDocuments({ is_active: true }),
      db.collection("users").countDocuments({}),
      db.collection("users").countDocuments({ is_active: true }),
      db.collection("students").countDocuments({}),
      db.collection("drives").countDocuments({ deleted_at: null }),
      db.collection("communications").countDocuments({}),
      db.collection("users").countDocuments({ role: "student" }),
      db.collection("users").countDocuments({ role: "tpo" }),
      db.collection("users").countDocuments({ role: "admin" }),
      db.collection("student_activity_events").countDocuments({ created_at: { $gte: since7d } }),
    ]);

    res.json(successResponse({
      timestamp: new Date().toISOString(),
      tenants: {
        total: tenantTotal,
        active: tenantActive,
      },
      users: {
        total: userTotal,
        active: userActive,
        byRole: {
          student: studentRoleCount,
          tpo: tpoRoleCount,
          admin: adminRoleCount,
        },
      },
      students: {
        total: studentTotal,
      },
      drives: {
        total: driveTotal,
      },
      communications: {
        total: commTotal,
      },
      activity: {
        events7d: activityEvents7d,
      },
    }));
  }),
);

router.get(
  "/question-bank",
  asyncHandler(async (req, res) => {
    const query = listQuestionBankQuerySchema.parse(req.query);
    const data = await QuestionBankService.list(query);
    res.json(successResponse(data));
  }),
);

router.get(
  "/question-bank/stats",
  asyncHandler(async (_req, res) => {
    const data = await QuestionBankService.getStats();
    res.json(successResponse(data));
  }),
);

router.get(
  "/question-bank/:id",
  asyncHandler(async (req, res) => {
    const data = await QuestionBankService.getById(String(req.params.id));
    res.json(successResponse(data));
  }),
);

router.patch(
  "/question-bank/:id",
  asyncHandler(async (req, res) => {
    const body = reviewQuestionBankSchema.parse(req.body);
    const data = await QuestionBankService.review(String(req.params.id), req.auth!.userId, body);
    res.json(successResponse(data));
  }),
);

// REMOVED: All /demo-feedback and /demo-analytics routes (demo mode deleted)

export default router;
