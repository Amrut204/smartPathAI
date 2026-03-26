import { Router } from "express";

import { getMongoDb } from "../utils/mongodb.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();
const DEMO_TENANT_NAME = "St. Xavier's Institute of Technology";
const DEMO_TPO_EMAIL = "tpo@stxaviers-demo.edu";
const ACCEPTED_DEMO_SLUGS = ["st-xaviers-demo", "stxaviers-demo"] as const;

router.get(
  "/",
  async (_req, res) => {
    try {
      const db = await getMongoDb();
      await db.command({ ping: 1 });

      res.json(
        successResponse({
          status: "healthy",
          mongodb: "connected",
          uptime: process.uptime(),
        }),
      );
    } catch {
      res.status(503).json({
        success: false,
        error: {
          code: "HEALTH_CHECK_FAILED",
          message: "Service unhealthy",
        },
        meta: { timestamp: new Date().toISOString() },
      });
    }
  },
);

router.get(
  "/demo",
  async (_req, res) => {
    const timestamp = new Date().toISOString();
    const checks = {
      database: false,
      demoTenant: false,
      demoTPO: false,
      demoStudents: false,
      demoDrives: false,
      demoMockTests: false,
      demoResources: false,
    };
    const details: Record<string, unknown> = {
      expectedTenantName: DEMO_TENANT_NAME,
      expectedTenantSlug: ACCEPTED_DEMO_SLUGS[0],
      acceptedTenantSlugs: [...ACCEPTED_DEMO_SLUGS],
      expectedTpoEmail: DEMO_TPO_EMAIL,
      studentCount: 0,
      driveCount: 0,
      mockTestCount: 0,
      resourceCount: 0,
      tenantSlug: null,
      tenantId: null,
    };

    try {
      const db = await getMongoDb();
      await db.command({ ping: 1 });
      checks.database = true;

      const tenant = await db.collection("tenants").findOne(
        {
          name: DEMO_TENANT_NAME,
          slug: { $in: [...ACCEPTED_DEMO_SLUGS] },
          is_active: true,
        },
        { projection: { _id: 0, id: 1, slug: 1, name: 1 } },
      );

      if (tenant) {
        checks.demoTenant = true;
        details.tenantId = String(tenant.id ?? "");
        details.tenantSlug = String(tenant.slug ?? "");
      }

      if (tenant?.id) {
        const todayIso = new Date().toISOString().slice(0, 10);
        const [tpoUser, studentCount, driveCount, mockTestCount, resourceCount] = await Promise.all([
          db.collection("users").findOne(
            {
              tenant_id: tenant.id,
              email: DEMO_TPO_EMAIL,
              is_active: true,
              role: { $in: ["tpo", "admin"] },
            },
            { projection: { _id: 0, id: 1, email: 1, role: 1 } },
          ),
          db.collection("students").countDocuments({ tenant_id: tenant.id }),
          db.collection("drives").countDocuments({
            tenant_id: tenant.id,
            deleted_at: null,
            drive_date: { $gte: todayIso },
          }),
          db.collection("mock_tests").countDocuments({
            tenant_id: tenant.id,
            is_active: true,
          }),
          db.collection("resources").countDocuments({
            tenant_id: tenant.id,
            is_active: true,
          }),
        ]);

        details.studentCount = studentCount;
        details.driveCount = driveCount;
        details.mockTestCount = mockTestCount;
        details.resourceCount = resourceCount;
        details.tpoRole = tpoUser?.role ? String(tpoUser.role) : null;

        checks.demoTPO = Boolean(tpoUser);
        checks.demoStudents = studentCount >= 100;
        checks.demoDrives = driveCount >= 3;
        checks.demoMockTests = mockTestCount >= 2;
        checks.demoResources = resourceCount >= 20;
      }

      const allHealthy = Object.values(checks).every(Boolean);
      const status = allHealthy ? "healthy" : checks.database ? "degraded" : "unhealthy";

      res.status(allHealthy ? 200 : 500).json({
        status,
        checks,
        details,
        timestamp,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        status: "unhealthy",
        checks,
        details: {
          ...details,
          error: message,
        },
        timestamp,
      });
    }
  },
);

export default router;
