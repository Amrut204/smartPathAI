import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { errorHandler } from "./middleware/error-handler.js";
import { logger } from "./utils/logger.js";

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
import healthRoutes from "./routes/health.routes.js";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors({
  origin: process.env.APP_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/students", studentRoutes);
app.use("/api/v1/mock-tests", mockTestRoutes);
app.use("/api/v1/drives", driveRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use("/api/v1/communication", communicationRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/vault", vaultRoutes);
app.use("/api/v1/tenants", tenantRoutes);
app.use("/api/v1/resources", resourcesRoutes);
app.use("/api/v1/health", healthRoutes);
app.use("/api/health", healthRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

export default app;
