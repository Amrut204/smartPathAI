import { Router, type Response } from "express";

import { asyncHandler, AppError } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { SupportSessionService } from "../services/support-session.service.js";
import { StudentSupportService } from "../services/student-support.service.js";
import { getMongoDb } from "../utils/mongodb.js";
import {
  createSupportSessionToken,
  getSupportSessionCookieName,
  verifySupportSessionToken,
} from "../utils/support-session-token.js";
import { successResponse } from "../utils/response-envelope.js";
import {
  approveSupportRequestSchema,
  createSupportRequestSchema,
  createStudentSupportRequestSchema,
  denySupportRequestSchema,
  listAuditLogsQuerySchema,
  resolveStudentSupportRequestSchema,
  revokeSupportRequestSchema,
} from "../validators/support.schema.js";

const router = Router();

function setSupportCookie(res: Response, token: string, maxAgeMs: number) {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie(getSupportSessionCookieName(), token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs,
  });
}

function clearSupportCookie(res: Response) {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie(getSupportSessionCookieName(), "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

router.use(asyncHandler(requireAuth));

// Admin: request / start / stop
router.post(
  "/requests",
  authorizeRole("admin"),
  asyncHandler(async (req, res) => {
    const body = createSupportRequestSchema.parse(req.body);
    const record = await SupportSessionService.requestAccess({
      requestedByUserId: req.auth!.userId,
      requestedByEmail: req.auth!.email,
      tenantSlug: body.tenantSlug,
      reason: body.reason,
    });

    await AuditLogService.log({
      tenantId: record.tenant_id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorTenantId: req.auth!.tenantId,
      eventType: "support_session_requested",
      supportSessionId: record.id,
      metadata: { tenantSlug: record.tenant_slug, tenantName: record.tenant_name },
    });

    res.status(201).json(successResponse(record));
  }),
);

router.get(
  "/requests",
  authorizeRole("admin"),
  asyncHandler(async (req, res) => {
    const rows = await SupportSessionService.listAdminRequests(req.auth!.userId);
    res.json(successResponse(rows));
  }),
);

router.post(
  "/requests/:id/start",
  authorizeRole("admin"),
  asyncHandler(async (req, res) => {
    const sessionId = String(req.params.id);
    const session = await SupportSessionService.markStarted({ sessionId, actorUserId: req.auth!.userId });

    if (!session.expires_at) {
      throw new AppError("CONFLICT", "Support session is missing an expiry timestamp", 409);
    }

    const expiresAtMs = new Date(session.expires_at).getTime();
    const nowMs = Date.now();
    const ttlMs = Math.max(1_000, expiresAtMs - nowMs);
    const token = await createSupportSessionToken(
      { sessionId: session.id, tenantId: session.tenant_id, userId: req.auth!.userId },
      Math.ceil(ttlMs / 1000),
    );

    setSupportCookie(res, token, ttlMs);

    await AuditLogService.log({
      tenantId: session.tenant_id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorTenantId: req.auth!.tenantId,
      eventType: "support_session_started",
      supportSessionId: session.id,
      metadata: { tenantSlug: session.tenant_slug, tenantName: session.tenant_name, expiresAt: session.expires_at },
    });

    res.json(successResponse({
      active: true,
      sessionId: session.id,
      tenantId: session.tenant_id,
      tenantSlug: session.tenant_slug,
      tenantName: session.tenant_name,
      expiresAt: session.expires_at,
      approvedBy: session.decided_by_email ?? "tpo",
    }));
  }),
);

router.post(
  "/session/stop",
  authorizeRole("admin"),
  asyncHandler(async (req, res) => {
    const token = req.cookies[getSupportSessionCookieName()];
    if (token) {
      const payload = await verifySupportSessionToken(String(token));
      if (payload && payload.userId === req.auth!.userId) {
        const session = await SupportSessionService.markStopped({ sessionId: payload.sessionId, actorUserId: req.auth!.userId });
        await AuditLogService.log({
          tenantId: session.tenant_id,
          actorUserId: req.auth!.userId,
          actorRole: req.auth!.role,
          actorTenantId: req.auth!.tenantId,
          eventType: "support_session_stopped",
          supportSessionId: session.id,
          metadata: { tenantSlug: session.tenant_slug, tenantName: session.tenant_name },
        });
      }
    }

    clearSupportCookie(res);
    res.json(successResponse({ active: false }));
  }),
);

router.get(
  "/session",
  authorizeRole("admin"),
  asyncHandler(async (req, res) => {
    const token = req.cookies[getSupportSessionCookieName()];
    if (!token) {
      res.json(successResponse({ active: false }));
      return;
    }

    const payload = await verifySupportSessionToken(String(token));
    if (!payload || payload.userId !== req.auth!.userId) {
      clearSupportCookie(res);
      res.json(successResponse({ active: false }));
      return;
    }

    const session = await SupportSessionService.getById(payload.sessionId);
    if (!session || session.status !== "approved" || session.tenant_id !== payload.tenantId || session.requested_by_user_id !== req.auth!.userId) {
      clearSupportCookie(res);
      res.json(successResponse({ active: false }));
      return;
    }

    if (!session.expires_at || new Date(session.expires_at).getTime() <= Date.now()) {
      clearSupportCookie(res);
      res.json(successResponse({ active: false }));
      return;
    }

    res.json(successResponse({
      active: true,
      sessionId: session.id,
      tenantId: session.tenant_id,
      tenantSlug: session.tenant_slug,
      tenantName: session.tenant_name,
      expiresAt: session.expires_at,
      approvedBy: session.decided_by_email ?? "tpo",
    }));
  }),
);

// Student: submit / list own support requests
router.post(
  "/student-requests",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const body = createStudentSupportRequestSchema.parse(req.body);
    const record = await StudentSupportService.create({
      tenantId: req.auth!.tenantId,
      studentId: req.auth!.userId,
      subject: body.subject,
      message: body.message,
    });

    await AuditLogService.log({
      tenantId: record.tenant_id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorTenantId: req.auth!.tenantId,
      eventType: "student_support_requested",
      metadata: { requestId: record.id, subject: record.subject },
    });

    res.status(201).json(successResponse(record));
  }),
);

router.get(
  "/student-requests/me",
  authorizeRole("student"),
  asyncHandler(async (req, res) => {
    const rows = await StudentSupportService.listForStudent(req.auth!.userId);
    res.json(successResponse(rows));
  }),
);

// TPO: inbox + approve/deny/revoke
router.get(
  "/inbox",
  authorizeRole("tpo"),
  asyncHandler(async (req, res) => {
    const rows = await SupportSessionService.listTenantInbox(req.auth!.tenantId);
    res.json(successResponse(rows));
  }),
);

router.get(
  "/student-requests/inbox",
  authorizeRole("tpo"),
  asyncHandler(async (req, res) => {
    const rows = await StudentSupportService.listTenantInbox(req.auth!.tenantId);
    res.json(successResponse(rows));
  }),
);

router.post(
  "/student-requests/:id/resolve",
  authorizeRole("tpo"),
  asyncHandler(async (req, res) => {
    const body = resolveStudentSupportRequestSchema.parse(req.body);
    const requestId = String(req.params.id);
    const updated = await StudentSupportService.resolve({
      tenantId: req.auth!.tenantId,
      requestId,
      resolvedByUserId: req.auth!.userId,
      resolvedByEmail: req.auth!.email,
      note: body.note,
    });

    await AuditLogService.log({
      tenantId: updated.tenant_id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: "student_support_resolved",
      metadata: { requestId: updated.id, subject: updated.subject },
    });

    res.json(successResponse(updated));
  }),
);

router.post(
  "/requests/:id/approve",
  authorizeRole("tpo"),
  asyncHandler(async (req, res) => {
    const body = approveSupportRequestSchema.parse(req.body);
    const sessionId = String(req.params.id);
    const updated = await SupportSessionService.approve({
      tenantId: req.auth!.tenantId,
      sessionId,
      decidedByUserId: req.auth!.userId,
      decidedByEmail: req.auth!.email,
      ttlMinutes: body.ttlMinutes,
      note: body.note,
    });

    await AuditLogService.log({
      tenantId: updated.tenant_id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: "support_session_approved",
      supportSessionId: updated.id,
      metadata: { expiresAt: updated.expires_at, note: updated.decision_note },
    });

    res.json(successResponse(updated));
  }),
);

router.post(
  "/requests/:id/deny",
  authorizeRole("tpo"),
  asyncHandler(async (req, res) => {
    const body = denySupportRequestSchema.parse(req.body);
    const sessionId = String(req.params.id);
    const updated = await SupportSessionService.deny({
      tenantId: req.auth!.tenantId,
      sessionId,
      decidedByUserId: req.auth!.userId,
      decidedByEmail: req.auth!.email,
      note: body.note,
    });

    await AuditLogService.log({
      tenantId: updated.tenant_id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: "support_session_denied",
      supportSessionId: updated.id,
      metadata: { note: updated.decision_note },
    });

    res.json(successResponse(updated));
  }),
);

router.post(
  "/requests/:id/revoke",
  authorizeRole("tpo"),
  asyncHandler(async (req, res) => {
    const body = revokeSupportRequestSchema.parse(req.body);
    const sessionId = String(req.params.id);
    const updated = await SupportSessionService.revoke({
      tenantId: req.auth!.tenantId,
      sessionId,
      decidedByUserId: req.auth!.userId,
      decidedByEmail: req.auth!.email,
      note: body.note,
    });

    await AuditLogService.log({
      tenantId: updated.tenant_id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      eventType: "support_session_revoked",
      supportSessionId: updated.id,
      metadata: { note: updated.decision_note },
    });

    res.json(successResponse(updated));
  }),
);

router.get(
  "/audit",
  authorizeRole("tpo"),
  asyncHandler(async (req, res) => {
    const query = listAuditLogsQuerySchema.parse(req.query);
    const db = await getMongoDb();

    const filter: Record<string, unknown> = { tenant_id: req.auth!.tenantId };
    if (query.sessionId) {
      filter.support_session_id = query.sessionId;
    }

    const rows = await db.collection("audit_logs")
      .find(filter)
      .sort({ created_at: -1 })
      .limit(query.limit)
      .project({
        _id: 0,
        id: 1,
        created_at: 1,
        event_type: 1,
        support_session_id: 1,
        actor_user_id: 1,
        actor_role: 1,
        actor_tenant_id: 1,
        method: 1,
        path: 1,
        ip: 1,
        user_agent: 1,
        metadata: 1,
      })
      .toArray();

    res.json(successResponse(rows));
  }),
);

export default router;
