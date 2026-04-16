import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { AnnualReportRegisterService } from "../services/annual-report-register.service.js";
import { ReportService } from "../services/report.service.js";
import { annualRegisterEntryInputSchema, annualRegisterListQuerySchema, type AnnualRegisterEntryInput } from "../validators/annual-report-register.schema.js";
import { reportExportQuerySchema, reportFilterSchema, reportTypeSchema } from "../validators/report.schema.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("tpo", "admin"));

router.get(
  "/annual-registers",
  asyncHandler(async (req, res) => {
    const query = annualRegisterListQuerySchema.parse(req.query);
    const data = await AnnualReportRegisterService.listEntries(req.auth!.tenantId, query);
    res.json(successResponse(data));
  }),
);

router.post(
  "/annual-registers",
  asyncHandler(async (req, res) => {
    const input = annualRegisterEntryInputSchema.parse(req.body ?? {}) as AnnualRegisterEntryInput;
    const data = await AnnualReportRegisterService.createEntry(req.auth!.tenantId, req.auth!.userId, input);
    res.json(successResponse(data));
  }),
);

router.put(
  "/annual-registers/:entryId",
  asyncHandler(async (req, res) => {
    const input = annualRegisterEntryInputSchema.parse(req.body ?? {}) as AnnualRegisterEntryInput;
    const data = await AnnualReportRegisterService.updateEntry(req.auth!.tenantId, String(req.params.entryId), req.auth!.userId, input);
    res.json(successResponse(data));
  }),
);

router.delete(
  "/annual-registers/:entryId",
  asyncHandler(async (req, res) => {
    const data = await AnnualReportRegisterService.deleteEntry(req.auth!.tenantId, String(req.params.entryId));
    res.json(successResponse(data));
  }),
);

router.get(
  "/templates",
  asyncHandler(async (_req, res) => {
    res.json(successResponse(ReportService.getTemplates()));
  }),
);

router.get(
  "/:reportType/preview",
  asyncHandler(async (req, res) => {
    const reportType = reportTypeSchema.parse(req.params.reportType);
    const filters = reportFilterSchema.parse(req.query);
    const data = await ReportService.preview(req.auth!.tenantId, reportType, filters);
    res.json(successResponse(data));
  }),
);

router.get(
  "/:reportType/readiness",
  asyncHandler(async (req, res) => {
    const reportType = reportTypeSchema.parse(req.params.reportType);
    const filters = reportFilterSchema.parse(req.query);
    const data = await ReportService.readiness(req.auth!.tenantId, reportType, filters);
    res.json(successResponse(data));
  }),
);

router.get(
  "/:reportType/export",
  asyncHandler(async (req, res) => {
    const reportType = reportTypeSchema.parse(req.params.reportType);
    const query = reportExportQuerySchema.parse(req.query);
    const { format, ...filters } = query;
    const exported = await ReportService.export(req.auth!.tenantId, reportType, filters, format);
    res.setHeader("Content-Type", exported.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
    res.send(exported.body);
  }),
);

router.post(
  "/naac-5-2/refresh",
  asyncHandler(async (req, res) => {
    const filters = reportFilterSchema.parse(req.body ?? {});
    const data = await ReportService.preview(req.auth!.tenantId, "naac_5_2_progression", filters);
    res.json(successResponse(data));
  }),
);

export default router;
