import { Router } from "express";

import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { StudentService } from "../services/student.service.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

router.use(asyncHandler(requireAuth));
router.use(authorizeRole("student"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await StudentService.getVaultCompanies(req.auth!.tenantId);
    res.json(successResponse(data));
  }),
);

router.get(
  "/:companyId",
  asyncHandler(async (req, res) => {
    const data = await StudentService.getVaultByCompany(
      req.auth!.tenantId,
      req.auth!.userId,
      req.params.companyId as string,
    );
    res.json(successResponse(data));
  }),
);

export default router;
