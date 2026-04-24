import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import { getMongoDb } from "../utils/mongodb.js";
import { normalizeStudentProfileData } from "../utils/student-profile.js";
import { CommunicationService } from "./communication.service.js";
import { NotificationService } from "./notification.service.js";

type SupportRole = "student" | "tpo" | "admin" | "hod";
type SupportTicketDestinationRole = "tpo" | "hod";
type SupportTicketType = "grievance" | "suggestion" | "feedback";
type SupportTicketCategory =
  | "placement_process"
  | "drive_eligibility"
  | "profile_or_resume"
  | "mock_tests"
  | "resources"
  | "technical_issue"
  | "harassment_or_misconduct"
  | "general_feedback";
type SupportTicketPriority = "low" | "medium" | "high" | "urgent";
type SupportTicketStatus = "open" | "in_review" | "resolved" | "closed" | "rejected";

const TICKETS_COLLECTION = "grievance_tickets";
const TICKET_EVENTS_COLLECTION = "grievance_ticket_events";

function nowIso() {
  return new Date().toISOString();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanString(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function ensureIndexes() {
  const db = await getMongoDb();
  await db.collection(TICKETS_COLLECTION).createIndex({ tenant_id: 1, destination_role: 1, created_at: -1 });
  await db.collection(TICKETS_COLLECTION).createIndex({ tenant_id: 1, destination_role: 1, status: 1, updated_at: -1 });
  await db.collection(TICKETS_COLLECTION).createIndex({ tenant_id: 1, created_by_user_id: 1, created_at: -1 });
  await db.collection(TICKETS_COLLECTION).createIndex({ tenant_id: 1, assigned_to_user_id: 1, updated_at: -1 });
  await db.collection(TICKETS_COLLECTION).createIndex({ tenant_id: 1, destination_department: 1, destination_role: 1, updated_at: -1 });
  await db.collection(TICKET_EVENTS_COLLECTION).createIndex({ tenant_id: 1, ticket_id: 1, created_at: 1 });
}

async function resolveActorProfile(userId: string) {
  const user = await MongoAuthRepository.findUserById(userId);
  if (!user) {
    throw new AppError("SUPPORT_ACTOR_NOT_FOUND", "User not found", 404);
  }
  return user;
}

async function resolveStudentSupportContext(tenantId: string, userId: string) {
  const db = await getMongoDb();
  const student = await db.collection("students").findOne(
    { tenant_id: tenantId, user_id: userId },
    { projection: { _id: 0, id: 1, branch: 1, batch: 1, profile_data: 1 } },
  );
  if (!student) return null;

  const profile = normalizeStudentProfileData(student.profile_data);
  const semesterNumber = Number(profile.currentSemester);
  const validSemester = Number.isFinite(semesterNumber) ? semesterNumber : null;
  return {
    studentId: String(student.id),
    branch: String(student.branch ?? "").trim(),
    batch: String(student.batch ?? "").trim(),
    academicYear: validSemester
      ? validSemester <= 2
        ? "first_year"
        : validSemester <= 4
          ? "second_year"
          : validSemester <= 6
            ? "third_year"
            : "final_year"
      : null,
  };
}

async function resolveHodScope(tenantId: string, userId: string) {
  const user = await MongoAuthRepository.findUserById(userId);
  if (!user || user.tenant_id !== tenantId || user.role !== "hod") {
    throw new AppError("HOD_NOT_FOUND", "HOD profile not found", 404);
  }

  const department = String(user.department ?? "").trim();
  if (!department) {
    throw new AppError("HOD_DEPARTMENT_MISSING", "HOD account is missing a department mapping.", 400);
  }

  return {
    userId: user.id,
    department,
    fullName: user.full_name ?? user.email,
    email: user.email,
  };
}

async function appendTicketEvent(params: {
  tenantId: string;
  ticketId: string;
  actorUserId: string;
  actorRole: SupportRole;
  eventType: string;
  note?: string | null;
  changes?: Record<string, unknown>;
}) {
  const db = await getMongoDb();
  await db.collection(TICKET_EVENTS_COLLECTION).insertOne({
    id: randomUUID(),
    tenant_id: params.tenantId,
    ticket_id: params.ticketId,
    actor_user_id: params.actorUserId,
    actor_role: params.actorRole,
    event_type: params.eventType,
    note: params.note ?? null,
    changes: params.changes ?? {},
    created_at: nowIso(),
  });
}

function toTicketSummary(doc: Record<string, unknown>) {
  return {
    id: String(doc.id),
    destinationRole: String(doc.destination_role) as SupportTicketDestinationRole,
    destinationDepartment: doc.destination_department ? String(doc.destination_department) : null,
    ticketType: String(doc.ticket_type) as SupportTicketType,
    category: String(doc.category) as SupportTicketCategory,
    title: String(doc.title),
    description: String(doc.description),
    priority: String(doc.priority) as SupportTicketPriority,
    status: String(doc.status) as SupportTicketStatus,
    confidential: Boolean(doc.confidential),
    createdAt: String(doc.created_at),
    updatedAt: String(doc.updated_at),
    resolvedAt: doc.resolved_at ? String(doc.resolved_at) : null,
    closedAt: doc.closed_at ? String(doc.closed_at) : null,
    resolutionNote: doc.resolution_note ? String(doc.resolution_note) : null,
    createdBy: {
      userId: String(doc.created_by_user_id),
      role: String(doc.created_by_role) as SupportRole,
      fullName: String(doc.created_by_name ?? ""),
      email: String(doc.created_by_email ?? ""),
    },
    assignedTo: doc.assigned_to_user_id ? {
      userId: String(doc.assigned_to_user_id),
      fullName: String(doc.assigned_to_name ?? ""),
      email: String(doc.assigned_to_email ?? ""),
    } : null,
  };
}

function toTicketEvent(doc: Record<string, unknown>) {
  return {
    id: String(doc.id),
    eventType: String(doc.event_type),
    actorUserId: String(doc.actor_user_id),
    actorRole: String(doc.actor_role) as SupportRole,
    note: doc.note ? String(doc.note) : null,
    changes: (doc.changes && typeof doc.changes === "object") ? doc.changes as Record<string, unknown> : {},
    createdAt: String(doc.created_at),
  };
}

async function notifyStudentOnTicketUpdate(params: {
  tenantId: string;
  actorUserId: string;
  ticket: Record<string, unknown>;
  status: SupportTicketStatus;
  resolutionNote?: string | null;
}) {
  const studentId = cleanString(params.ticket.created_by_student_id);
  if (!studentId) return;

  const title = `Support ticket update: ${String(params.ticket.title)}`;
  const categoryLabel = String(params.ticket.category ?? "").replace(/_/g, " ");
  const statusLabel = params.status.replace(/_/g, " ");
  const ownerLabel = String(params.ticket.destination_role) === "hod" ? "department office" : "placement office";
  const message = [
    `Your ${String(params.ticket.ticket_type)} ticket is now marked as ${statusLabel}.`,
    categoryLabel ? `Category: ${categoryLabel}.` : "",
    params.resolutionNote ? `Update from ${ownerLabel}: ${params.resolutionNote}` : "",
  ].filter(Boolean).join(" ");

  await CommunicationService.publishAnnouncement(params.tenantId, params.actorUserId, {
    title,
    message,
    priority: params.status === "rejected" ? "important" : "normal",
    filters: {
      audienceMode: "custom",
      studentIds: [studentId],
    },
  });
}

async function getTicketOrThrow(tenantId: string, ticketId: string) {
  const db = await getMongoDb();
  const ticket = await db.collection(TICKETS_COLLECTION).findOne(
    { tenant_id: tenantId, id: ticketId },
    { projection: { _id: 0 } },
  );
  if (!ticket) {
    throw new AppError("SUPPORT_TICKET_NOT_FOUND", "Support ticket not found", 404);
  }
  return ticket as Record<string, unknown>;
}

async function ensureTicketAccessForOwner(params: {
  tenantId: string;
  ticketId: string;
  ownerRole: "tpo" | "hod" | "admin";
  actorUserId: string;
}) {
  const ticket = await getTicketOrThrow(params.tenantId, params.ticketId);
  if (params.ownerRole === "admin") return ticket;
  if (params.ownerRole === "tpo") {
    if (String(ticket.destination_role) !== "tpo") {
      throw new AppError("SUPPORT_TICKET_NOT_FOUND", "Support ticket not found", 404);
    }
    return ticket;
  }

  const hod = await resolveHodScope(params.tenantId, params.actorUserId);
  if (String(ticket.destination_role) !== "hod" || String(ticket.destination_department ?? "") !== hod.department) {
    throw new AppError("SUPPORT_TICKET_NOT_FOUND", "Support ticket not found", 404);
  }
  return ticket;
}

function assigneeRolesForOwner(ownerRole: "tpo" | "hod" | "admin") {
  if (ownerRole === "hod") return ["hod", "admin"];
  return ["tpo", "admin"];
}

export const SupportService = {
  async createTicket(input: {
    tenantId: string;
    actorUserId: string;
    actorRole: SupportRole;
    ticketType: SupportTicketType;
    category: SupportTicketCategory;
    title: string;
    description: string;
    priority: SupportTicketPriority;
    destinationRole: SupportTicketDestinationRole;
    confidential?: boolean;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const actor = await resolveActorProfile(input.actorUserId);
    const studentContext = input.actorRole === "student"
      ? await resolveStudentSupportContext(input.tenantId, input.actorUserId)
      : null;
    const now = nowIso();
    const destinationDepartment = input.destinationRole === "hod"
      ? cleanString(studentContext?.branch ?? actor.department)
      : null;

    if (input.destinationRole === "hod" && !destinationDepartment) {
      throw new AppError("SUPPORT_HOD_DESTINATION_INVALID", "A department-mapped ticket is required to send this grievance to the HOD.", 400);
    }

    const doc = {
      id: randomUUID(),
      tenant_id: input.tenantId,
      destination_role: input.destinationRole,
      destination_department: destinationDepartment,
      created_by_user_id: input.actorUserId,
      created_by_role: input.actorRole,
      created_by_name: actor.full_name ?? actor.email,
      created_by_email: actor.email,
      created_by_student_id: studentContext?.studentId ?? null,
      created_by_branch: studentContext?.branch ?? cleanString(actor.department),
      created_by_batch: studentContext?.batch ?? null,
      created_by_academic_year: studentContext?.academicYear ?? null,
      ticket_type: input.ticketType,
      category: input.category,
      title: input.title.trim(),
      description: input.description.trim(),
      priority: input.priority,
      status: "open" as SupportTicketStatus,
      assigned_to_user_id: null,
      assigned_to_name: null,
      assigned_to_email: null,
      resolution_note: null,
      confidential: Boolean(input.confidential),
      created_at: now,
      updated_at: now,
      resolved_at: null,
      closed_at: null,
    };

    await db.collection(TICKETS_COLLECTION).insertOne(doc);
    await appendTicketEvent({
      tenantId: input.tenantId,
      ticketId: doc.id,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      eventType: "created",
      note: `Ticket created for ${input.destinationRole.toUpperCase()}`,
    });

    await NotificationService.createRoleNotifications({
      tenantId: input.tenantId,
      recipientRole: input.destinationRole,
      department: input.destinationRole === "hod" ? destinationDepartment : null,
      type: "grievance_created",
      kind: "action",
      priority: input.priority === "urgent" ? "urgent" : input.priority === "high" ? "important" : "normal",
      title: `New grievance for ${input.destinationRole.toUpperCase()}: ${doc.title}`,
      message: `${doc.created_by_name} submitted a ${doc.ticket_type} ticket in ${String(doc.category).replace(/_/g, " ")}.`,
      targetPath: input.destinationRole === "hod" ? "/hod#grievance" : "/tpo/support",
      targetEntityId: doc.id,
      sourceType: "support_ticket",
      sourceId: doc.id,
      metadata: {
        category: doc.category,
        ticketType: doc.ticket_type,
        destinationDepartment,
      },
    });

    return toTicketSummary(doc);
  },

  async listMyTickets(tenantId: string, userId: string) {
    await ensureIndexes();
    const db = await getMongoDb();
    const rows = await db.collection(TICKETS_COLLECTION).find(
      { tenant_id: tenantId, created_by_user_id: userId },
      { projection: { _id: 0 } },
    ).sort({ updated_at: -1 }).limit(100).toArray();

    return rows.map((row) => toTicketSummary(row as Record<string, unknown>));
  },

  async listTicketsForOwner(input: {
    tenantId: string;
    actorUserId: string;
    ownerRole: "tpo" | "hod" | "admin";
    status?: SupportTicketStatus;
    category?: SupportTicketCategory;
    priority?: SupportTicketPriority;
    submitterRole?: "student" | "tpo" | "hod";
    assignedToMe?: boolean;
    q?: string;
    limit: number;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: input.tenantId };

    if (input.ownerRole === "tpo") {
      filter.destination_role = "tpo";
    } else if (input.ownerRole === "hod") {
      const hod = await resolveHodScope(input.tenantId, input.actorUserId);
      filter.destination_role = "hod";
      filter.destination_department = hod.department;
    }

    if (input.status) filter.status = input.status;
    if (input.category) filter.category = input.category;
    if (input.priority) filter.priority = input.priority;
    if (input.submitterRole) filter.created_by_role = input.submitterRole;
    if (input.assignedToMe) filter.assigned_to_user_id = input.actorUserId;
    if (input.q) {
      const regex = new RegExp(escapeRegex(input.q), "i");
      filter.$or = [
        { title: regex },
        { description: regex },
        { created_by_name: regex },
        { created_by_email: regex },
      ];
    }

    const countsBase = { tenant_id: input.tenantId } as Record<string, unknown>;
    if (filter.destination_role) countsBase.destination_role = filter.destination_role;
    if (filter.destination_department) countsBase.destination_department = filter.destination_department;

    const [items, openCount, reviewCount, resolvedCount] = await Promise.all([
      db.collection(TICKETS_COLLECTION).find(filter, { projection: { _id: 0 } }).sort({ updated_at: -1 }).limit(input.limit).toArray(),
      db.collection(TICKETS_COLLECTION).countDocuments({ ...countsBase, status: "open" }),
      db.collection(TICKETS_COLLECTION).countDocuments({ ...countsBase, status: "in_review" }),
      db.collection(TICKETS_COLLECTION).countDocuments({ ...countsBase, status: { $in: ["resolved", "closed"] } }),
    ]);

    return {
      counts: {
        open: openCount,
        inReview: reviewCount,
        resolved: resolvedCount,
      },
      items: items.map((row) => toTicketSummary(row as Record<string, unknown>)),
    };
  },

  async getTicketForOwner(input: {
    tenantId: string;
    ticketId: string;
    actorUserId: string;
    ownerRole: "tpo" | "hod" | "admin";
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const ticket = await ensureTicketAccessForOwner(input);
    const events = await db.collection(TICKET_EVENTS_COLLECTION).find(
      { tenant_id: input.tenantId, ticket_id: input.ticketId },
      { projection: { _id: 0 } },
    ).sort({ created_at: 1 }).toArray();

    return {
      ...toTicketSummary(ticket),
      events: events.map((event) => toTicketEvent(event as Record<string, unknown>)),
    };
  },

  async updateTicketForOwner(input: {
    tenantId: string;
    ticketId: string;
    actorUserId: string;
    actorRole: SupportRole;
    ownerRole: "tpo" | "hod" | "admin";
    status?: SupportTicketStatus;
    priority?: SupportTicketPriority;
    assignedToUserId?: string | null;
    resolutionNote?: string | null;
    confidential?: boolean;
  }) {
    await ensureIndexes();
    const db = await getMongoDb();
    const existing = await ensureTicketAccessForOwner({
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      ownerRole: input.ownerRole,
      actorUserId: input.actorUserId,
    });

    let assignedUser = null;
    const assignedToUserId = input.assignedToUserId === undefined
      ? undefined
      : cleanString(input.assignedToUserId);

    if (assignedToUserId) {
      assignedUser = await MongoAuthRepository.findUserById(assignedToUserId);
      if (
        !assignedUser
        || assignedUser.tenant_id !== input.tenantId
        || !assigneeRolesForOwner(input.ownerRole).includes(assignedUser.role)
      ) {
        throw new AppError("SUPPORT_ASSIGNEE_INVALID", "Assigned user is not valid for this grievance queue", 400);
      }
      if (input.ownerRole === "hod") {
        const assignedDepartment = String(assignedUser.department ?? "").trim();
        const ticketDepartment = String(existing.destination_department ?? "");
        if (assignedUser.role === "hod" && assignedDepartment !== ticketDepartment) {
          throw new AppError("SUPPORT_ASSIGNEE_INVALID", "Assigned HOD must belong to the same department", 400);
        }
      }
    }

    const update: Record<string, unknown> = {
      updated_at: nowIso(),
    };
    const changes: Record<string, unknown> = {};

    if (input.status !== undefined) {
      update.status = input.status;
      changes.status = { from: existing.status, to: input.status };
      if (input.status === "resolved") {
        update.resolved_at = nowIso();
      }
      if (input.status === "closed" || input.status === "rejected") {
        update.closed_at = nowIso();
      }
    }

    if (input.priority !== undefined) {
      update.priority = input.priority;
      changes.priority = { from: existing.priority, to: input.priority };
    }

    if (input.confidential !== undefined) {
      update.confidential = input.confidential;
      changes.confidential = { from: existing.confidential, to: input.confidential };
    }

    if (assignedToUserId !== undefined) {
      update.assigned_to_user_id = assignedToUserId;
      update.assigned_to_name = assignedUser?.full_name ?? assignedUser?.email ?? null;
      update.assigned_to_email = assignedUser?.email ?? null;
      changes.assignedToUserId = { from: existing.assigned_to_user_id ?? null, to: assignedToUserId };
    }

    if (input.resolutionNote !== undefined) {
      update.resolution_note = cleanString(input.resolutionNote);
      changes.resolutionNote = true;
    }

    await db.collection(TICKETS_COLLECTION).updateOne(
      { tenant_id: input.tenantId, id: input.ticketId },
      { $set: update },
    );

    await appendTicketEvent({
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      eventType: input.status ? `status_${input.status}` : assignedToUserId !== undefined ? "assignment_updated" : "updated",
      note: cleanString(input.resolutionNote) ?? "Ticket updated",
      changes,
    });

    const nextTicket = await getTicketOrThrow(input.tenantId, input.ticketId);

    if (input.status && ["resolved", "closed", "rejected"].includes(input.status)) {
      await notifyStudentOnTicketUpdate({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        ticket: nextTicket,
        status: input.status,
        resolutionNote: cleanString(input.resolutionNote),
      });
    }

    if (input.status && String(nextTicket.created_by_role) === "student") {
      await NotificationService.createRoleNotifications({
        tenantId: input.tenantId,
        recipientRole: "student",
        recipientUserIds: [String(nextTicket.created_by_user_id)],
        type: "grievance_updated",
        kind: "action",
        priority: input.status === "rejected" ? "important" : "normal",
        title: `Grievance update: ${String(nextTicket.title ?? "")}`,
        message: `Your grievance is now marked as ${String(input.status).replace(/_/g, " ")}.${cleanString(input.resolutionNote) ? ` ${cleanString(input.resolutionNote)}` : ""}`,
        targetPath: "/support",
        targetEntityId: input.ticketId,
        sourceType: "support_ticket_status",
        sourceId: input.ticketId,
        metadata: {
          status: input.status,
        },
      });
    }

    return this.getTicketForOwner({
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      actorUserId: input.actorUserId,
      ownerRole: input.ownerRole,
    });
  },

  async resolveTicketForOwner(input: {
    tenantId: string;
    ticketId: string;
    actorUserId: string;
    actorRole: SupportRole;
    ownerRole: "tpo" | "hod" | "admin";
    resolutionNote: string;
    status: "resolved" | "closed" | "rejected";
  }) {
    return this.updateTicketForOwner({
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      ownerRole: input.ownerRole,
      resolutionNote: input.resolutionNote,
      status: input.status,
    });
  },
};
