import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { authorizeRole } from "../middleware/rbac.middleware.js";
import { SupportService } from "../services/support.service.js";
import { successResponse } from "../utils/response-envelope.js";
import {
  createSupportTicketSchema,
  resolveSupportTicketSchema,
  supportTicketListQuerySchema,
  updateSupportTicketSchema,
} from "../validators/support.schema.js";

export const supportRoutes = Router();
export const tpoSupportRoutes = Router();
export const hodSupportRoutes = Router();

supportRoutes.use(asyncHandler(requireAuth));
supportRoutes.use(authorizeRole("student", "tpo", "hod"));

supportRoutes.post(
  "/tickets",
  asyncHandler(async (req, res) => {
    const body = createSupportTicketSchema.parse(req.body ?? {});
    const data = await SupportService.createTicket({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role as "student" | "tpo" | "hod",
      ticketType: body.ticketType,
      category: body.category,
      title: body.title,
      description: body.description,
      priority: body.priority,
      destinationRole: body.destinationRole,
      confidential: body.confidential,
    });
    res.status(201).json(successResponse(data));
  }),
);

supportRoutes.get(
  "/tickets/me",
  asyncHandler(async (req, res) => {
    const data = await SupportService.listMyTickets(req.auth!.tenantId, req.auth!.userId);
    res.json(successResponse(data));
  }),
);

tpoSupportRoutes.use(asyncHandler(requireAuth));
tpoSupportRoutes.use(authorizeRole("tpo", "admin"));

tpoSupportRoutes.get(
  "/tickets",
  asyncHandler(async (req, res) => {
    const query = supportTicketListQuerySchema.parse(req.query);
    const data = await SupportService.listTicketsForOwner({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      ownerRole: req.auth!.role === "admin" ? "admin" : "tpo",
      status: query.status,
      category: query.category,
      priority: query.priority,
      submitterRole: query.submitterRole,
      assignedToMe: query.assignedToMe,
      q: query.q,
      limit: query.limit,
    });
    res.json(successResponse(data));
  }),
);

tpoSupportRoutes.get(
  "/tickets/:ticketId",
  asyncHandler(async (req, res) => {
    const data = await SupportService.getTicketForOwner({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      ownerRole: req.auth!.role === "admin" ? "admin" : "tpo",
      ticketId: String(req.params.ticketId),
    });
    res.json(successResponse(data));
  }),
);

tpoSupportRoutes.patch(
  "/tickets/:ticketId",
  asyncHandler(async (req, res) => {
    const body = updateSupportTicketSchema.parse(req.body ?? {});
    const data = await SupportService.updateTicketForOwner({
      tenantId: req.auth!.tenantId,
      ticketId: String(req.params.ticketId),
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role as "tpo" | "admin",
      ownerRole: req.auth!.role === "admin" ? "admin" : "tpo",
      status: body.status,
      priority: body.priority,
      assignedToUserId: body.assignedToUserId ? String(body.assignedToUserId) : body.assignedToUserId === "" ? null : undefined,
      resolutionNote: body.resolutionNote ? String(body.resolutionNote) : body.resolutionNote === "" ? null : undefined,
      confidential: body.confidential,
    });
    res.json(successResponse(data));
  }),
);

tpoSupportRoutes.post(
  "/tickets/:ticketId/resolve",
  asyncHandler(async (req, res) => {
    const body = resolveSupportTicketSchema.parse(req.body ?? {});
    const data = await SupportService.resolveTicketForOwner({
      tenantId: req.auth!.tenantId,
      ticketId: String(req.params.ticketId),
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role as "tpo" | "admin",
      ownerRole: req.auth!.role === "admin" ? "admin" : "tpo",
      resolutionNote: body.resolutionNote,
      status: body.status,
    });
    res.json(successResponse(data));
  }),
);

hodSupportRoutes.use(asyncHandler(requireAuth));
hodSupportRoutes.use(authorizeRole("hod"));

hodSupportRoutes.get(
  "/tickets",
  asyncHandler(async (req, res) => {
    const query = supportTicketListQuerySchema.parse(req.query);
    const data = await SupportService.listTicketsForOwner({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      ownerRole: "hod",
      status: query.status,
      category: query.category,
      priority: query.priority,
      submitterRole: query.submitterRole as "student" | "tpo" | "hod" | undefined,
      assignedToMe: query.assignedToMe,
      q: query.q,
      limit: query.limit,
    });
    res.json(successResponse(data));
  }),
);

hodSupportRoutes.get(
  "/tickets/:ticketId",
  asyncHandler(async (req, res) => {
    const data = await SupportService.getTicketForOwner({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      ownerRole: "hod",
      ticketId: String(req.params.ticketId),
    });
    res.json(successResponse(data));
  }),
);

hodSupportRoutes.patch(
  "/tickets/:ticketId",
  asyncHandler(async (req, res) => {
    const body = updateSupportTicketSchema.parse(req.body ?? {});
    const data = await SupportService.updateTicketForOwner({
      tenantId: req.auth!.tenantId,
      ticketId: String(req.params.ticketId),
      actorUserId: req.auth!.userId,
      actorRole: "hod",
      ownerRole: "hod",
      status: body.status,
      priority: body.priority,
      assignedToUserId: body.assignedToUserId ? String(body.assignedToUserId) : body.assignedToUserId === "" ? null : undefined,
      resolutionNote: body.resolutionNote ? String(body.resolutionNote) : body.resolutionNote === "" ? null : undefined,
      confidential: body.confidential,
    });
    res.json(successResponse(data));
  }),
);

hodSupportRoutes.post(
  "/tickets/:ticketId/resolve",
  asyncHandler(async (req, res) => {
    const body = resolveSupportTicketSchema.parse(req.body ?? {});
    const data = await SupportService.resolveTicketForOwner({
      tenantId: req.auth!.tenantId,
      ticketId: String(req.params.ticketId),
      actorUserId: req.auth!.userId,
      actorRole: "hod",
      ownerRole: "hod",
      resolutionNote: body.resolutionNote,
      status: body.status,
    });
    res.json(successResponse(data));
  }),
);
