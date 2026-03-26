import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { successResponse } from "../utils/response-envelope.js";
import { StudyGuideRepository } from "../repositories/study-guide.repository.js";
import { StudyGuideGeneratorService } from "../services/study-guide-generator.service.js";
import type { StudyGuideCategory } from "../models/StudyGuide.js";
import {
  listStudyGuidesSchema,
  generateStudyGuideSchema,
  reviewStudyGuideSchema,
  batchGenerateSchema,
} from "../validators/study-guide.schema.js";

const router = Router();

router.use(asyncHandler(requireAuth));

/* ------------------------------------------------------------------ */
/*  Student-facing endpoints                                           */
/* ------------------------------------------------------------------ */

// List published study guides
router.get(
  "/",
  authorizeRole("student", "tpo", "admin"),
  asyncHandler(async (req, res) => {
    const query = listStudyGuidesSchema.parse(req.query);
    const data = await StudyGuideRepository.listGuides({
      tenantId: req.auth!.role === "student" ? req.auth!.tenantId : undefined,
      category: query.category,
      difficulty: query.difficulty,
      search: query.search,
      status: "published",
      limit: query.limit,
      cursor: query.cursor,
    });
    res.json(successResponse(data));
  }),
);

// Category summary (counts per category)
router.get(
  "/categories/summary",
  authorizeRole("student", "tpo", "admin"),
  asyncHandler(async (req, res) => {
    const data = await StudyGuideRepository.countByCategory(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

// Get guide by slug
router.get(
  "/by-slug/:slug",
  authorizeRole("student", "tpo", "admin"),
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug ?? "").trim();
    const scopedTenantId = req.auth!.role === "student" ? req.auth!.tenantId : undefined;
    const guide = await StudyGuideRepository.getGuideBySlug(slug, scopedTenantId);

    // Students can only see published guides
    if (req.auth!.role === "student" && guide.status !== "published") {
      res.status(404).json(successResponse(null));
      return;
    }

    res.json(successResponse(guide));
  }),
);

// Get guide by ID
router.get(
  "/guide/:guideId",
  authorizeRole("student", "tpo", "admin"),
  asyncHandler(async (req, res) => {
    const guideId = String(req.params.guideId ?? "").trim();
    const scopedTenantId = req.auth!.role === "student" ? req.auth!.tenantId : undefined;
    const guide = await StudyGuideRepository.getGuideById(guideId, scopedTenantId);

    if (req.auth!.role === "student" && guide.status !== "published") {
      res.status(404).json(successResponse(null));
      return;
    }

    res.json(successResponse(guide));
  }),
);

/* ------------------------------------------------------------------ */
/*  Admin / TPO endpoints                                              */
/* ------------------------------------------------------------------ */

// List all guides (including non-published) for review
router.get(
  "/admin/all",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const query = listStudyGuidesSchema.parse(req.query);
    const data = await StudyGuideRepository.listGuides({
      tenantId: req.auth!.tenantId,
      category: query.category,
      difficulty: query.difficulty,
      search: query.search,
      status: undefined, // all statuses
      limit: query.limit,
      cursor: query.cursor,
    });
    res.json(successResponse(data));
  }),
);

// Cost summary
router.get(
  "/admin/cost-summary",
  authorizeRole("admin"),
  asyncHandler(async (req, res) => {
    const since = req.query.since ? String(req.query.since) : undefined;
    const data = await StudyGuideRepository.getCostSummary(since);
    res.json(successResponse(data));
  }),
);

// Available topics for generation
router.get(
  "/admin/topics",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const category = req.query.category as string | undefined;
    const validCategories: StudyGuideCategory[] = ["aptitude", "technical", "company_specific", "soft_skills", "branch_core"];
    const data = await StudyGuideRepository.getTopics(
      category && validCategories.includes(category as StudyGuideCategory) ? category as StudyGuideCategory : undefined,
    );
    res.json(successResponse(data));
  }),
);

// Generate a single study guide
router.post(
  "/generate",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const body = generateStudyGuideSchema.parse(req.body);
    const guide = await StudyGuideGeneratorService.generateGuide({
      tenantId: req.auth!.tenantId,
      topicName: body.topicName,
      category: body.category,
      subcategory: body.subcategory,
      difficulty: body.difficulty,
      companyContext: body.companyContext,
      createdBy: req.auth!.userId,
    });
    res.status(201).json(successResponse(guide));
  }),
);

// Batch generate guides
router.post(
  "/batch-generate",
  authorizeRole("admin"),
  asyncHandler(async (req, res) => {
    const body = batchGenerateSchema.parse(req.body);
    const topics = await StudyGuideRepository.getTopics(body.category);
    const topicSlice = topics.slice(0, body.limit).map((t) => ({
      topicName: String(t.name),
      category: String(t.category) as StudyGuideCategory,
      subcategory: String(t.subcategory ?? "general"),
    }));

    const result = await StudyGuideGeneratorService.batchGenerate({
      tenantId: req.auth!.tenantId,
      topics: topicSlice,
      difficulty: body.difficulty,
      createdBy: req.auth!.userId,
    });

    res.status(201).json(successResponse(result));
  }),
);

// Review / approve / reject a guide
router.patch(
  "/:guideId/review",
  authorizeRole("tpo", "admin"),
  asyncHandler(async (req, res) => {
    const guideId = String(req.params.guideId ?? "").trim();
    const body = reviewStudyGuideSchema.parse(req.body);

    const guide = await StudyGuideRepository.updateGuideStatus(guideId, body.status, {
      qualityScore: body.qualityScore,
      reviewNotes: body.reviewNotes,
      reviewedBy: req.auth!.userId,
    });

    res.json(successResponse(guide));
  }),
);

// Delete a guide
router.delete(
  "/:guideId",
  authorizeRole("admin"),
  asyncHandler(async (req, res) => {
    const guideId = String(req.params.guideId ?? "").trim();
    await StudyGuideRepository.deleteGuide(guideId);
    res.json(successResponse({ deleted: true }));
  }),
);

export default router;
