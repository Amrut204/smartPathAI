import { Router } from "express";

import { getMongoDb } from "../utils/mongodb.js";
import { successResponse } from "../utils/response-envelope.js";

const router = Router();

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

export default router;
