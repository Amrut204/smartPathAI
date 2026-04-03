import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";

import { requireFeature } from "./middleware/feature-flag.middleware.js";
import { errorHandler } from "./middleware/error-handler.js";
import { ensureCorrelationId } from "./middleware/correlation.middleware.js";
import { ensureCsrfCookie, requireCsrf } from "./middleware/csrf.middleware.js";
import { logger } from "./utils/logger.js";
import { ensureCoreIndexes } from "./utils/ensure-indexes.js";
import { closeMongoConnection } from "./utils/mongodb.js";
import { validateRuntimeEnv } from "./utils/env.js";

import authRoutes from "./routes/auth.routes.js";
import studentRoutes from "./routes/student.routes.js";
import mockTestRoutes from "./routes/mock-test.routes.js";
import driveRoutes from "./routes/drive.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import communicationRoutes from "./routes/communication.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import vaultRoutes from "./routes/vault.routes.js";
import tenantRoutes from "./routes/tenant.routes.js";
import resourcesRoutes from "./routes/resources.routes.js";
import supportRoutes from "./routes/support.routes.js";
import healthRoutes from "./routes/health.routes.js";
import careerRoutes from "./routes/career.routes.js";
import tpoRoutes from "./routes/tpo.routes.js";
import reportRoutes from "./routes/report.routes.js";
import demoRoutes from "./routes/demo.routes.js";
import internalRoutes from "./routes/internal.routes.js";
import salesRoutes from "./routes/sales.routes.js";
import riskAssessmentRoutes from "./routes/risk-assessment.routes.js";
import studyGuideRoutes from "./routes/study-guide.routes.js";
import { CommunicationService } from "./services/communication.service.js";
import { initializeCommunicationQueue } from "./services/communication.queue.js";
import { shutdownCommunicationQueue } from "./services/communication.queue.js";
import { scheduleDailyRiskCheck } from "./jobs/daily-risk-check.job.js";
import { scheduleCriticalStudentReminders } from "./jobs/critical-student-reminders.job.js";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Needed when running behind Nginx / a load balancer (secure cookies, IP-based rate limits).
// Keep this opt-in in non-production to avoid trusting spoofed X-Forwarded-* headers by default.
const trustProxy = process.env.TRUST_PROXY === "true" || process.env.NODE_ENV === "production";
if (trustProxy) {
  app.set("trust proxy", 1);
}

if (process.env.NODE_ENV !== "test") {
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", {
      context: {
        reason: reason instanceof Error ? reason.message : String(reason),
      },
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", {
      context: {
        error: error instanceof Error ? error.message : String(error),
      },
    });

    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  });
}

app.use(helmet({
  // This server is primarily an API behind a separate SPA/Nginx layer.
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(cors({
  origin: process.env.APP_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(ensureCorrelationId);
app.use(ensureCsrfCookie);
app.use(requireCsrf);

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/demo", demoRoutes);
app.use("/api/v1/students", studentRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/v1/mock-tests", mockTestRoutes);
app.use("/api/v1/drives", driveRoutes);
app.use("/api/v1/ai", requireFeature("aiAssistant"), aiRoutes);
app.use("/api/v1/communication", communicationRoutes);
app.use("/api/v1/analytics", requireFeature("analytics"), analyticsRoutes);
app.use("/api/v1/vault", requireFeature("vault"), vaultRoutes);
app.use("/api/v1/tenants", tenantRoutes);
app.use("/api/v1/resources", resourcesRoutes);
app.use("/api/v1/support", supportRoutes);
app.use("/api/v1/study-guides", requireFeature("studyGuides"), studyGuideRoutes);
app.use("/api/v1/career", requireFeature("careerLab"), careerRoutes);
app.use("/api/v1/tpo", tpoRoutes);
app.use("/api/v1/tpo", riskAssessmentRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/tpo", riskAssessmentRoutes);
app.use("/api/v1/internal", internalRoutes);
app.use("/api/internal", internalRoutes);
app.use("/api/v1/sales", salesRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/v1/health", healthRoutes);
app.use("/api/health", healthRoutes);

app.use(errorHandler);

export async function initializeRuntime(): Promise<void> {
  try {
    validateRuntimeEnv();
    await ensureCoreIndexes();
    CommunicationService.assertRuntimeConfig();
    await initializeCommunicationQueue({
      processor: ({ tenantId, communicationId }) =>
        CommunicationService.dispatchQueuedCommunication({ tenantId, communicationId }),
    });
    scheduleDailyRiskCheck();
    scheduleCriticalStudentReminders();
  } catch (error) {
    logger.error("Failed to initialize communication infrastructure", {
      context: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  }
}

export function startServer() {
  const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    void initializeRuntime();
  });

  const shutdown = async (signal: string) => {
    logger.warn("Graceful shutdown requested", { context: { signal } });

    // Stop accepting new connections.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    // Close background workers + DB connections.
    await shutdownCommunicationQueue();
    await closeMongoConnection();
  };

  let shuttingDown = false;
  const handle = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    const forceTimer = setTimeout(() => {
      logger.error("Forced shutdown after timeout", { context: { signal } });
      process.exit(1);
    }, 10_000);
    forceTimer.unref?.();

    void shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error("Graceful shutdown failed", {
          context: { signal, error: error instanceof Error ? error.message : String(error) },
        });
        process.exit(1);
      })
      .finally(() => clearTimeout(forceTimer));
  };

  process.on("SIGTERM", () => handle("SIGTERM"));
  process.on("SIGINT", () => handle("SIGINT"));

  return server;
}

const shouldStartServer = process.env.NODE_ENV !== "test"
  && !process.env.JEST_WORKER_ID
  && process.env.DISABLE_SERVER_START !== "true";

if (shouldStartServer) {
  startServer();
}

export default app;
