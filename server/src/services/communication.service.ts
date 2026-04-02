import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import {
  getCommunicationQueueBackend,
  enqueueCommunicationJob,
  initializeCommunicationQueue,
  isCommunicationQueueInitialized,
} from "./communication.queue.js";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "../utils/unsubscribe-token.js";

type EmailMode = "resend";

type SenderIdentity = {
  fromEmail: string;
  fromName: string;
  replyToEmail: string | null;
  tenantName: string;
  senderSource: "tenant" | "platform-fallback";
  displayFrom: string;
};

type Recipient = {
  studentId: string;
  fullName: string;
  email: string;
  driveName: string | undefined;
  variables?: Record<string, string>;
};

type CommunicationFilters = {
  driveId?: string;
  eligibleOnly?: boolean;
  batch?: string;
  branch?: string;
  minCgpa?: number;
  maxRecipients?: number;
  emails?: string[];
  studentIds?: string[];
};

type DeliveryMetrics = {
  delivered: number;
  opened: number;
  bounced: number;
  blocked: number;
};

type AnnouncementPriority = "normal" | "important" | "urgent";

type AnnouncementStatus = "published" | "expired" | "archived";

type SystemEmailTemplate = {
  name: string;
  slug: string;
  subject: string;
  body: string;
};

const SYSTEM_EMAIL_TEMPLATES: SystemEmailTemplate[] = [
  {
    name: "Drive Announcement",
    slug: "drive-announcement",
    subject: "New Drive: {{drive_name}}",
    body: "Dear {{student_name}},\nA new placement drive {{drive_name}} has been announced.\nPlease check your dashboard.",
  },
  {
    name: "Eligibility Notification",
    slug: "eligibility-notification",
    subject: "You are eligible for {{drive_name}}",
    body: "Dear {{student_name}},\nYou are eligible for {{drive_name}}. Prepare well and all the best.",
  },
  {
    name: "Result Published",
    slug: "result-published",
    subject: "Drive results published for {{drive_name}}",
    body: "Dear {{student_name}},\nDrive results are now available for {{drive_name}}.\nCheck your portal for details.",
  },
  {
    name: "Selected Result Notification",
    slug: "selected-result-notification",
    subject: "Selection update: {{drive_name}}",
    body: "Dear {{student_name}},\n\nYou have been selected for {{drive_name}}.\n{{designation_line}}\n{{offer_date_line}}\n{{ctc_line}}\n{{offer_letter_line}}\nIf you have any questions, please contact the placement cell.\n\nRegards,\n{{college_name}} Placement Cell",
  },
  {
    name: "Rejected Result Notification",
    slug: "rejected-result-notification",
    subject: "Application update: {{drive_name}}",
    body: "Dear {{student_name}},\n\nThis is to inform you that you were not selected for {{drive_name}} in the current process.\nPlease stay in touch with the placement cell for upcoming opportunities.\n\nRegards,\n{{college_name}} Placement Cell",
  },
  {
    name: "Offer Letter Shared Notification",
    slug: "offer-letter-shared-notification",
    subject: "Offer letter shared: {{drive_name}}",
    body: "Dear {{student_name}},\n\nYour offer letter for {{drive_name}} is now available.\n{{offer_letter_line}}\nIf the link does not open or any detail is incorrect, please contact the placement cell immediately.\n\nRegards,\n{{college_name}} Placement Cell",
  },
  {
    name: "Student Onboarding Credentials",
    slug: "student-onboarding-credentials",
    subject: "Your Smart Path login credentials",
    body: "Dear {{student_name}},\n\nYour Smart Path account is now ready.\n\nLogin URL: {{login_url}}\nEmail: {{student_email}}\nTemporary password: {{temporary_password}}\nRoll number: {{roll_number}}\nIssued by: {{issued_by}}\n\nPlease sign in and change your password immediately after the first login.\n\nRegards,\n{{college_name}} Placement Cell",
  },
  {
    name: "TPO Onboarding Credentials",
    slug: "tpo-onboarding-credentials",
    subject: "Your Smart Path TPO login credentials",
    body: "Dear {{tpo_name}},\n\nYour Smart Path TPO account is now ready.\n\nLogin URL: {{login_url}}\nEmail: {{tpo_email}}\nTemporary password: {{temporary_password}}\nIssued by: {{issued_by}}\n\nPlease sign in and change your password immediately after the first login.\n\nRegards,\n{{college_name}} Placement Cell",
  },
];

type SendGridWebhookEvent = {
  event?: string;
  email?: string;
  timestamp?: number;
  reason?: string;
  response?: string;
  communication_id?: string;
  tenant_id?: string;
  [key: string]: unknown;
};

const SUPPRESSION_COLLECTION = "communication_suppressions";
const ANNOUNCEMENTS_COLLECTION = "announcements";
const ANNOUNCEMENT_READS_COLLECTION = "announcement_reads";

type SuppressionReason =
  | "unsubscribed"
  | "bounce"
  | "blocked"
  | "spamreport";

let suppressionIndexesEnsured = false;
let announcementIndexesEnsured = false;
let systemTemplatesEnsured = false;

async function ensureSuppressionIndexes(db: Awaited<ReturnType<typeof getMongoDb>>) {
  if (suppressionIndexesEnsured) return;
  await db.collection(SUPPRESSION_COLLECTION).createIndex({ tenant_id: 1, email: 1 }, { unique: true });
  await db.collection(SUPPRESSION_COLLECTION).createIndex({ tenant_id: 1, created_at: -1 });
  suppressionIndexesEnsured = true;
}

async function ensureAnnouncementIndexes(db: Awaited<ReturnType<typeof getMongoDb>>) {
  if (announcementIndexesEnsured) return;
  await db.collection(ANNOUNCEMENTS_COLLECTION).createIndex({ tenant_id: 1, created_at: -1 });
  await db.collection(ANNOUNCEMENTS_COLLECTION).createIndex({ tenant_id: 1, status: 1, published_at: -1 });
  await db.collection(ANNOUNCEMENTS_COLLECTION).createIndex({ tenant_id: 1, expires_at: 1, status: 1 });
  await db.collection(ANNOUNCEMENTS_COLLECTION).createIndex({ tenant_id: 1, recipient_student_ids: 1 });
  await db.collection(ANNOUNCEMENT_READS_COLLECTION).createIndex(
    { tenant_id: 1, announcement_id: 1, student_id: 1 },
    { unique: true },
  );
  await db.collection(ANNOUNCEMENT_READS_COLLECTION).createIndex({ tenant_id: 1, student_id: 1, updated_at: -1 });
  announcementIndexesEnsured = true;
}

async function ensureSystemEmailTemplates(db: Awaited<ReturnType<typeof getMongoDb>>) {
  if (systemTemplatesEnsured) return;

  for (const template of SYSTEM_EMAIL_TEMPLATES) {
    const now = new Date().toISOString();
    await db.collection("email_templates").updateOne(
      { tenant_id: null, slug: template.slug },
      {
        $set: {
          name: template.name,
          subject: template.subject,
          body: template.body,
          is_system: true,
          updated_at: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          tenant_id: null,
          created_by: null,
          created_at: now,
        },
      },
      { upsert: true },
    );
  }

  systemTemplatesEnsured = true;
}

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

async function upsertSuppression(params: {
  tenantId: string;
  email: string;
  reason: SuppressionReason;
  source: "user" | "provider";
}) {
  const db = await getMongoDb();
  await ensureSuppressionIndexes(db);

  const email = normalizeEmail(params.email);
  if (!email) return;

  const now = new Date().toISOString();
  await db.collection(SUPPRESSION_COLLECTION).updateOne(
    { tenant_id: params.tenantId, email },
    {
      $set: {
        tenant_id: params.tenantId,
        email,
        reason: params.reason,
        source: params.source,
        updated_at: now,
      },
      $setOnInsert: {
        id: randomUUID(),
        created_at: now,
      },
    },
    { upsert: true },
  );
}

async function listSuppressedEmails(tenantId: string, emails: string[]) {
  const db = await getMongoDb();
  await ensureSuppressionIndexes(db);
  const normalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (normalized.length === 0) return new Set<string>();

  const rows = await db.collection(SUPPRESSION_COLLECTION).find(
    { tenant_id: tenantId, email: { $in: normalized } },
    { projection: { _id: 0, email: 1 } },
  ).toArray();

  return new Set(rows.map((row) => normalizeEmail(String(row.email))));
}

function defaultDeliveryMetrics(): DeliveryMetrics {
  return {
    delivered: 0,
    opened: 0,
    bounced: 0,
    blocked: 0,
  };
}

function getPlatformFromEmail(mode: EmailMode): string {
  return String(process.env.RESEND_FROM_EMAIL ?? "admin@campusdrive.me").trim();
}

function normalizeEmailMode(): EmailMode {
  return "resend";
}

function assertResendConfig() {
  const resendKey = String(process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL ?? "").trim();

  if (!resendKey || resendKey.includes("<")) {
    throw new AppError(
      "COMM_RESEND_KEY_INVALID",
      "RESEND_API_KEY is required and must be a real key when EMAIL_MODE=resend",
      500,
    );
  }

  if (!fromEmail) {
    throw new AppError(
      "COMM_RESEND_FROM_EMAIL_MISSING",
      "RESEND_FROM_EMAIL is required when EMAIL_MODE=resend",
      500,
    );
  }
}

async function resolveSenderIdentity(tenantId: string, mode: EmailMode): Promise<SenderIdentity> {
  const tenant = await MongoAuthRepository.findTenantById(tenantId);
  if (!tenant) {
    throw new AppError("TENANT_NOT_FOUND", "Tenant not found", 404);
  }

  const tenantName = String(tenant.name ?? "College").trim() || "College";
  const rawConfig = tenant.config && typeof tenant.config === "object"
    ? tenant.config as Record<string, unknown>
    : {};
  const emailSettings = rawConfig.emailSettings && typeof rawConfig.emailSettings === "object"
    ? rawConfig.emailSettings as Record<string, unknown>
    : {};

  const configuredFromEmail = normalizeEmail(String(emailSettings.fromEmail ?? ""));
  const configuredReplyToEmail = normalizeEmail(String(emailSettings.replyToEmail ?? ""));
  const configuredFromName = String(emailSettings.fromName ?? "").trim();
  const platformFromEmail = getPlatformFromEmail(mode);
  const fromNameBase = configuredFromName || `${tenantName} Placement Cell`;

  if (configuredFromEmail) {
    return {
      fromEmail: configuredFromEmail,
      fromName: fromNameBase,
      replyToEmail: configuredReplyToEmail || configuredFromEmail,
      tenantName,
      senderSource: "tenant",
      displayFrom: `${fromNameBase} <${configuredFromEmail}>`,
    };
  }

  return {
    fromEmail: platformFromEmail,
    fromName: fromNameBase,
    replyToEmail: configuredReplyToEmail || null,
    tenantName,
    senderSource: "platform-fallback",
    displayFrom: `${fromNameBase} <${platformFromEmail}>`,
  };
}

function extractErrorMessage(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "Unknown dispatch error";
  }

  try {
    const parsed = JSON.parse(raw) as {
      errors?: Array<{ message?: string }>;
      message?: string;
    };
    const fromArray = parsed.errors?.[0]?.message;
    if (fromArray && String(fromArray).trim().length > 0) {
      return String(fromArray).trim();
    }
    if (parsed.message && String(parsed.message).trim().length > 0) {
      return String(parsed.message).trim();
    }
  } catch {
    // Keep raw string fallback.
  }

  if (raw.length > 240) {
    return `${raw.slice(0, 240)}...`;
  }

  return raw;
}

function buildTopFailureReason(errors: Array<{ email: string; message: string }>): string | null {
  if (errors.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();
  errors.forEach((entry) => {
    const extracted = extractErrorMessage(entry.message);
    const normalized = extracted;
    counts.set(normalized, Number(counts.get(normalized) ?? 0) + 1);
  });

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

function resolveCommunicationIdFromWebhook(event: SendGridWebhookEvent): string {
  const direct = String(event.communication_id ?? "").trim();
  if (direct) {
    return direct;
  }

  const uniqueArgs = (event.unique_args ?? event.custom_args ?? {}) as Record<string, unknown>;
  const nested = String(uniqueArgs.communication_id ?? "").trim();
  return nested;
}

function mapSendGridEventToDeliveryKey(eventName: string): keyof DeliveryMetrics | null {
  const normalized = eventName.trim().toLowerCase();

  if (normalized === "delivered") return "delivered";
  if (normalized === "open") return "opened";
  if (normalized === "bounce") return "bounced";
  if (normalized === "blocked" || normalized === "dropped") return "blocked";

  return null;
}

function shouldSuppressFromSendGridEvent(eventName: string): SuppressionReason | null {
  const normalized = eventName.trim().toLowerCase();
  if (normalized === "unsubscribe" || normalized === "group_unsubscribe") return "unsubscribed";
  if (normalized === "spamreport") return "spamreport";
  if (normalized === "bounce") return "bounce";
  if (normalized === "blocked" || normalized === "dropped") return "blocked";
  return null;
}

function toSampleRecipient(recipient: Recipient) {
  return {
    studentId: recipient.studentId,
    fullName: recipient.fullName,
    email: recipient.email,
    driveName: recipient.driveName ?? null,
  };
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function parseRecipientPayload(value: unknown): Recipient[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const recipient: Recipient = {
        studentId: String(row.studentId ?? "").trim(),
        fullName: String(row.fullName ?? "").trim(),
        email: String(row.email ?? "").trim(),
        driveName: row.driveName ? String(row.driveName) : undefined,
        variables: parseMetadata(row.variables) as Record<string, string>,
      };
      return recipient;
    })
    .filter((item): item is Recipient => item !== null && item.email.length > 0);
}

export function renderTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => variables[key] ?? "");
}

async function resolveRecipients(
  tenantId: string,
  filters?: CommunicationFilters,
): Promise<Recipient[]> {
  const db = await getMongoDb();
  let driveName: string | undefined;
  let studentIds: string[] | null = null;

  if (filters?.driveId) {
    const drive = await db.collection("drives").findOne(
      { tenant_id: tenantId, id: filters.driveId, deleted_at: null },
      { projection: { _id: 0, id: 1, company: 1, role: 1 } },
    );

    if (!drive) {
      throw new AppError("COMM_DRIVE_NOT_FOUND", "Drive not found for recipient filter", 404);
    }

    driveName = `${String(drive.company)}${drive.role ? ` - ${String(drive.role)}` : ""}`;

    if (filters.eligibleOnly ?? true) {
      const eligibleRows = await db.collection("drive_results").find(
        { tenant_id: tenantId, drive_id: filters.driveId, status: "eligible" },
        { projection: { _id: 0, student_id: 1 } },
      ).toArray();

      studentIds = eligibleRows.map((row) => String(row.student_id));
      if (studentIds.length === 0) {
        return [];
      }
    }
  }

  const studentFilter: Record<string, unknown> = { tenant_id: tenantId };

  if (filters?.batch) {
    studentFilter.batch = filters.batch;
  }
  if (filters?.branch) {
    studentFilter.branch = filters.branch;
  }
  if (filters?.minCgpa !== undefined) {
    studentFilter.cgpa = { $gte: filters.minCgpa };
  }
  if (filters?.studentIds?.length) {
    studentFilter.id = { $in: filters.studentIds };
  }
  if (studentIds && studentIds.length > 0) {
    if (studentFilter.id && typeof studentFilter.id === "object" && "$in" in studentFilter.id) {
      const existingIds = Array.isArray((studentFilter.id as { $in?: unknown[] }).$in)
        ? (studentFilter.id as { $in?: unknown[] }).$in!.map((value) => String(value))
        : [];
      studentFilter.id = { $in: studentIds.filter((id) => existingIds.includes(id)) };
    } else {
      studentFilter.id = { $in: studentIds };
    }
  }

  const students = await db.collection("students").find(
    studentFilter,
    { projection: { _id: 0, id: 1, user_id: 1 } },
  ).toArray();

  const userIds = students.map((student) => String(student.user_id));
  if (userIds.length === 0) {
    return [];
  }

  const users = await db.collection("users").find(
    { tenant_id: tenantId, id: { $in: userIds } },
    { projection: { _id: 0, id: 1, full_name: 1, email: 1 } },
  ).toArray();

  const userMap = new Map(users.map((user) => [String(user.id), user]));
  const suppressed = await listSuppressedEmails(
    tenantId,
    users.map((user) => String(user.email ?? "")),
  );

  let list = students
    .map((student) => {
      const user = userMap.get(String(student.user_id));
      if (!user?.email) {
        return null;
      }
      if (suppressed.has(normalizeEmail(String(user.email)))) {
        return null;
      }
      return {
        studentId: String(student.id),
        fullName: String(user.full_name ?? ""),
        email: String(user.email),
        driveName,
      };
    })
    .filter((item): item is Recipient => item !== null);

  if (filters?.emails && filters.emails.length > 0) {
    const allow = new Set(filters.emails.map(normalizeEmail).filter(Boolean));
    list = list.filter((recipient) => allow.has(normalizeEmail(recipient.email)));
  }

  if (filters?.maxRecipients && list.length > filters.maxRecipients) {
    return list.slice(0, Math.max(0, filters.maxRecipients));
  }

  return list;
}

function summarizeAudience(filters?: CommunicationFilters) {
  if (!filters) {
    return "All students";
  }

  const parts: string[] = [];
  if (filters.driveId) {
    parts.push(filters.eligibleOnly ?? true ? "eligible for selected drive" : "selected drive audience");
  }
  if (filters.branch) {
    parts.push(`branch ${filters.branch}`);
  }
  if (filters.batch) {
    parts.push(`batch ${filters.batch}`);
  }
  if (filters.minCgpa !== undefined) {
    parts.push(`CGPA ${filters.minCgpa}+`);
  }
  if (filters.emails?.length) {
    parts.push(`${filters.emails.length} direct email${filters.emails.length === 1 ? "" : "s"}`);
  }
  if (filters.studentIds?.length) {
    parts.push(`${filters.studentIds.length} selected student${filters.studentIds.length === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) {
    return "All students";
  }
  return parts.join(" • ");
}

async function resolveDriveLabel(tenantId: string, driveId?: string) {
  if (!driveId) return null;
  const db = await getMongoDb();
  const drive = await db.collection("drives").findOne(
    { tenant_id: tenantId, id: driveId, deleted_at: null },
    { projection: { _id: 0, company: 1, role: 1 } },
  );
  if (!drive) return null;
  return `${String(drive.company)}${drive.role ? ` - ${String(drive.role)}` : ""}`;
}

async function resolveStudentRecordId(tenantId: string, userId: string) {
  const db = await getMongoDb();
  const student = await db.collection("students").findOne(
    { tenant_id: tenantId, user_id: userId },
    { projection: { _id: 0, id: 1 } },
  );

  if (!student?.id) {
    throw new AppError("STUDENT_NOT_FOUND", "Student record not found", 404);
  }

  return String(student.id);
}

async function expireAnnouncements(tenantId: string) {
  const db = await getMongoDb();
  await ensureAnnouncementIndexes(db);
  await db.collection(ANNOUNCEMENTS_COLLECTION).updateMany(
    {
      tenant_id: tenantId,
      status: "published",
      expires_at: { $lte: new Date().toISOString() },
    },
    {
      $set: {
        status: "expired",
        updated_at: new Date().toISOString(),
      },
    },
  );
}

function buildAnnouncementPreview(params: {
  title: string;
  message: string;
  priority: AnnouncementPriority;
  driveName?: string | null;
  expiresAt?: string;
}) {
  return {
    title: params.title,
    message: params.message,
    priority: params.priority,
    relatedDriveName: params.driveName ?? null,
    expiresAt: params.expiresAt ?? null,
    showPopup: params.priority === "urgent",
  };
}

async function resolveMessageContent(
  tenantId: string,
  payload: {
    templateId?: string;
    subject?: string;
    body?: string;
  },
) {
  const db = await getMongoDb();
  await ensureSystemEmailTemplates(db);
  let subject = payload.subject ?? "";
  let body = payload.body ?? "";

  if (payload.templateId) {
    const template = await db.collection("email_templates").findOne(
      { $or: [{ tenant_id: tenantId }, { tenant_id: null }], id: payload.templateId },
      { projection: { _id: 0, id: 1, subject: 1, body: 1 } },
    );

    if (!template) {
      throw new AppError("COMM_TEMPLATE_NOT_FOUND", "Template not found", 404);
    }

    subject = String(template.subject);
    body = String(template.body);
  }

  if (!subject.trim() || !body.trim()) {
    throw new AppError(
      "COMM_MESSAGE_INVALID",
      "Either templateId or subject+body must be provided",
      400,
    );
  }

  return {
    subject,
    body,
  };
}

async function resolveTemplateBySlug(tenantId: string, slug: string) {
  const db = await getMongoDb();
  await ensureSystemEmailTemplates(db);
  const template = await db.collection("email_templates").findOne(
    { $or: [{ tenant_id: tenantId }, { tenant_id: null }], slug },
    { projection: { _id: 0, id: 1, slug: 1, subject: 1, body: 1 } },
  );

  if (!template) {
    throw new AppError("COMM_TEMPLATE_NOT_FOUND", "Template not found", 404);
  }

  return {
    id: String(template.id),
    slug: String(template.slug),
    subject: String(template.subject),
    body: String(template.body),
  };
}

async function queueEmailBatch(params: {
  tenantId: string;
  senderId: string;
  recipients: Recipient[];
  subject: string;
  body: string;
  providerMode?: EmailMode;
  templateId?: string | null;
  variables?: Record<string, string>;
  metadata?: Record<string, unknown>;
  allowUnsubscribe?: boolean;
}) {
  const db = await getMongoDb();
  const mode = params.providerMode ?? normalizeEmailMode();
  const senderIdentity = await resolveSenderIdentity(params.tenantId, mode);
  assertResendConfig();

  if (params.recipients.length === 0) {
    throw new AppError("COMM_NO_RECIPIENTS", "No recipients matched the selected filters", 400);
  }

  await assertCommunicationRateLimit(params.tenantId, params.recipients.length);

  const communicationId = randomUUID();
  const now = new Date().toISOString();
  const queueBackend = getCommunicationQueueBackend();

  await db.collection("communications").insertOne({
    id: communicationId,
    tenant_id: params.tenantId,
    sender_id: params.senderId,
    channel: "email",
    subject: params.subject,
    body: params.body,
    recipients: params.recipients.map((recipient) => recipient.email),
    recipient_count: params.recipients.length,
    status: "queued",
    provider: mode,
    metadata: {
      template_id: params.templateId ?? null,
      variables: params.variables ?? {},
      queue_backend: queueBackend,
      sender_identity: senderIdentity,
      recipient_payload: params.recipients.map((recipient) => ({
        studentId: recipient.studentId,
        fullName: recipient.fullName,
        email: recipient.email,
        driveName: recipient.driveName ?? null,
        variables: recipient.variables ?? {},
      })),
      allow_unsubscribe: params.allowUnsubscribe ?? true,
      sent: 0,
      failed: 0,
      errors: [],
      top_error: null,
      delivery: defaultDeliveryMetrics(),
      ...(params.metadata ?? {}),
    },
    created_at: now,
    updated_at: now,
  });

  try {
    if (!isCommunicationQueueInitialized()) {
      await initializeCommunicationQueue({
        processor: ({ tenantId, communicationId }) =>
          CommunicationService.dispatchQueuedCommunication({ tenantId, communicationId }),
      });
    }
    await enqueueCommunicationJob({
      tenantId: params.tenantId,
      communicationId,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Queue dispatch failed";
      await db.collection("communications").updateOne(
        { tenant_id: params.tenantId, id: communicationId },
        {
          $set: {
            status: "failed",
            metadata: {
              ...(params.metadata ?? {}),
              template_id: params.templateId ?? null,
              variables: params.variables ?? {},
              sender_identity: senderIdentity,
              recipient_payload: params.recipients.map((recipient) => ({
                studentId: recipient.studentId,
                fullName: recipient.fullName,
                email: recipient.email,
                driveName: recipient.driveName ?? null,
                variables: recipient.variables ?? {},
              })),
              allow_unsubscribe: params.allowUnsubscribe ?? true,
              sent: 0,
              failed: params.recipients.length,
              errors: params.recipients.map((recipient) => ({ email: recipient.email, message: reason })),
              top_error: reason,
              queue_backend: queueBackend,
            delivery: defaultDeliveryMetrics(),
          },
          updated_at: new Date().toISOString(),
        },
      },
    );
    throw new AppError("COMM_QUEUE_ENQUEUE_FAILED", "Unable to queue communication", 503);
  }

  return {
    communicationId,
    recipientCount: params.recipients.length,
    status: "queued" as const,
    mode,
    queueBackend,
    sender: senderIdentity,
  };
}

async function sendEmailViaResend(params: {
  tenantId: string;
  communicationId: string;
  to: string;
  subject: string;
  body: string;
  sender: SenderIdentity;
}) {
  assertResendConfig();
  const resendKey = String(process.env.RESEND_API_KEY ?? "").trim();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${params.sender.fromName} <${params.sender.fromEmail}>`,
      to: [params.to],
      subject: params.subject,
      text: params.body,
      reply_to: params.sender.replyToEmail ?? undefined,
      tags: [
        { name: "communication_id", value: params.communicationId },
        { name: "tenant_id", value: params.tenantId },
      ],
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || "Resend send failed");
  }

  const payload = await response.json().catch(() => ({}));
  return {
    provider: "resend",
    providerMessageId: payload?.id ? String(payload.id) : null,
  };
}

async function sendWithRetry(
  params: {
    mode: EmailMode;
    tenantId: string;
    communicationId: string;
    to: string;
    subject: string;
    body: string;
    unsubscribeUrl?: string | null;
    sender: SenderIdentity;
  },
  maxAttempts = 3,
): Promise<{ provider: string; providerMessageId: string | null }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await sendEmailViaResend({
        tenantId: params.tenantId,
        communicationId: params.communicationId,
        to: params.to,
        subject: params.subject,
        body: params.body,
        sender: params.sender,
      });
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Dispatch failed after retries");
}

function resolveAppUrl() {
  const fromEnv = String(process.env.APP_URL ?? "").trim();
  return fromEnv || "http://localhost:5173";
}

function buildUnsubscribeUrl(params: { tenantId: string; email: string }) {
  const token = createUnsubscribeToken({
    tenantId: params.tenantId,
    email: params.email,
  });
  const base = resolveAppUrl().replace(/\/+$/, "");
  return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
}

function appendUnsubscribeFooter(body: string, unsubscribeUrl: string) {
  const trimmed = String(body ?? "").trimEnd();
  return `${trimmed}\n\n---\nUnsubscribe: ${unsubscribeUrl}\n`;
}

async function assertCommunicationRateLimit(tenantId: string, recipientCount: number) {
  const maxSendsWindow = Number(process.env.COMM_RATE_MAX_SENDS_10M ?? 3);
  const maxRecipientsDay = Number(process.env.COMM_RATE_MAX_RECIPIENTS_24H ?? 2000);

  if (!Number.isFinite(maxSendsWindow) || maxSendsWindow <= 0) return;

  const now = Date.now();
  const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const db = await getMongoDb();

  const [recentSendCount, recentRecipientAgg] = await Promise.all([
    db.collection("communications").countDocuments({
      tenant_id: tenantId,
      created_at: { $gte: tenMinutesAgo },
    }),
    db.collection("communications").aggregate([
      { $match: { tenant_id: tenantId, created_at: { $gte: dayAgo } } },
      { $group: { _id: null, total: { $sum: "$recipient_count" } } },
    ]).toArray(),
  ]);

  if (recentSendCount >= maxSendsWindow) {
    throw new AppError(
      "COMM_RATE_LIMITED",
      "Too many messages queued recently. Wait a few minutes and try again.",
      429,
    );
  }

  const last24h = Number(recentRecipientAgg?.[0]?.total ?? 0);
  if (Number.isFinite(maxRecipientsDay) && maxRecipientsDay > 0 && last24h + recipientCount > maxRecipientsDay) {
    throw new AppError(
      "COMM_RATE_LIMITED",
      "Daily recipient limit reached. Try again later or narrow the recipient filter.",
      429,
    );
  }
}

async function syncDriveResultNotifications(params: {
  tenantId: string;
  communicationId: string;
  metadata: Record<string, unknown>;
  recipientResults: Array<{ studentId: string; sent: boolean; variables?: Record<string, string> }>;
}) {
  const release = parseMetadata(params.metadata.result_release);
  const driveId = String(release.drive_id ?? "").trim();
  if (!driveId) return;

  const releasedBy = String(release.released_by ?? "").trim() || null;
  const emailKind = String(release.email_kind ?? "").trim();
  const now = new Date().toISOString();
  const db = await getMongoDb();

  const bulkOps = params.recipientResults.map((recipient) => {
    const hadOfferLetter = Boolean(
      String(recipient.variables?.offer_letter_link ?? "").trim()
      || String(recipient.variables?.offer_letter_reference ?? "").trim(),
    );

    const setPayload: Record<string, unknown> = {
      result_notification_status: recipient.sent ? "sent" : "failed",
      result_notification_communication_id: params.communicationId,
      updated_at: now,
    };

    if (recipient.sent) {
      setPayload.result_released_at = String(release.released_at ?? now);
      setPayload.result_released_by = releasedBy;
      if (emailKind === "selected" && hadOfferLetter) {
        setPayload.offer_letter_shared_at = now;
        setPayload.offer_letter_shared_by = releasedBy;
      }
    }

    return {
      updateOne: {
        filter: {
          tenant_id: params.tenantId,
          drive_id: driveId,
          student_id: recipient.studentId,
        },
        update: { $set: setPayload },
      },
    };
  });

  if (bulkOps.length > 0) {
    await db.collection("drive_results").bulkWrite(bulkOps);
  }
}

export const CommunicationService = {
  assertRuntimeConfig() {
    normalizeEmailMode();
  },

  async listTemplates(tenantId: string) {
    const db = await getMongoDb();
    await ensureSystemEmailTemplates(db);
    const data = await db.collection("email_templates").find(
      { $or: [{ tenant_id: tenantId }, { tenant_id: null }] },
      { projection: { _id: 0, id: 1, name: 1, slug: 1, subject: 1, body: 1, is_system: 1, created_at: 1 } },
    ).sort({ is_system: -1, created_at: -1 }).toArray();

    return data.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      slug: String(item.slug),
      subject: String(item.subject),
      body: String(item.body),
      isSystem: Boolean(item.is_system),
      createdAt: String(item.created_at),
    }));
  },

  async unsubscribeFromToken(token: string) {
    const payload = verifyUnsubscribeToken(token);
    await upsertSuppression({
      tenantId: payload.tenantId,
      email: payload.email,
      reason: "unsubscribed",
      source: "user",
    });
    return {
      tenantId: payload.tenantId,
      email: payload.email,
    };
  },

  async createTemplate(
    tenantId: string,
    userId: string,
    input: {
      name: string;
      slug: string;
      subject: string;
      body: string;
    },
  ) {
    const db = await getMongoDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.collection("email_templates").insertOne({
      id,
      tenant_id: tenantId,
      name: input.name,
      slug: input.slug,
      subject: input.subject,
      body: input.body,
      is_system: false,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });

    return { id };
  },

  async previewRecipients(
    tenantId: string,
    payload: {
      templateId?: string;
      subject?: string;
      body?: string;
      filters?: CommunicationFilters;
    },
  ) {
    const recipients = await resolveRecipients(tenantId, payload.filters);
    const mode = normalizeEmailMode();
    const queueBackend = getCommunicationQueueBackend();
    const message = await resolveMessageContent(tenantId, payload).catch(() => null);
    const sender = await resolveSenderIdentity(tenantId, mode);

    return {
      mode,
      queueBackend,
      sender,
      recipientCount: recipients.length,
      sampleRecipients: recipients.slice(0, 12).map((recipient) => toSampleRecipient(recipient)),
      subject: message?.subject ?? null,
      bodyPreview: message ? message.body.slice(0, 280) : null,
    };
  },

  async getSenderIdentityPreview(tenantId: string) {
    const mode = normalizeEmailMode();
    const queueBackend = getCommunicationQueueBackend();
    const sender = await resolveSenderIdentity(tenantId, mode);

    return {
      mode,
      queueBackend,
      sender,
    };
  },

  async previewAnnouncement(
    tenantId: string,
    payload: {
      title: string;
      message: string;
      priority: AnnouncementPriority;
      relatedDriveId?: string;
      expiresAt?: string;
      filters?: CommunicationFilters;
    },
  ) {
    const recipients = await resolveRecipients(tenantId, payload.filters);
    const driveName = await resolveDriveLabel(tenantId, payload.relatedDriveId);

    return {
      recipientCount: recipients.length,
      sampleRecipients: recipients.slice(0, 12).map((recipient) => toSampleRecipient(recipient)),
      audienceSummary: summarizeAudience(payload.filters),
      preview: buildAnnouncementPreview({
        title: payload.title,
        message: payload.message,
        priority: payload.priority,
        driveName,
        expiresAt: payload.expiresAt,
      }),
    };
  },

  async publishAnnouncement(
    tenantId: string,
    senderId: string,
    payload: {
      title: string;
      message: string;
      priority: AnnouncementPriority;
      relatedDriveId?: string;
      expiresAt?: string;
      filters?: CommunicationFilters;
    },
  ) {
    const db = await getMongoDb();
    await ensureAnnouncementIndexes(db);

    if (payload.expiresAt && Number.isNaN(Date.parse(payload.expiresAt))) {
      throw new AppError("ANNOUNCEMENT_EXPIRES_AT_INVALID", "Expiry must be a valid date/time", 400);
    }

    const recipients = await resolveRecipients(tenantId, payload.filters);
    if (recipients.length === 0) {
      throw new AppError("ANNOUNCEMENT_NO_RECIPIENTS", "No recipients matched the selected filters", 400);
    }

    const relatedDriveName = await resolveDriveLabel(tenantId, payload.relatedDriveId);
    const now = new Date().toISOString();
    const id = randomUUID();

    await db.collection(ANNOUNCEMENTS_COLLECTION).insertOne({
      id,
      tenant_id: tenantId,
      created_by: senderId,
      title: payload.title,
      message: payload.message,
      priority: payload.priority,
      audience_filters: payload.filters ?? {},
      audience_summary: summarizeAudience(payload.filters),
      related_drive_id: payload.relatedDriveId ?? null,
      related_drive_name: relatedDriveName,
      published_at: now,
      expires_at: payload.expiresAt ?? null,
      status: "published",
      show_popup: payload.priority === "urgent",
      recipient_count_snapshot: recipients.length,
      recipient_student_ids: recipients.map((recipient) => recipient.studentId),
      created_at: now,
      updated_at: now,
    });

    return {
      announcementId: id,
      recipientCount: recipients.length,
      status: "published" as AnnouncementStatus,
    };
  },

  async getHistory(tenantId: string, query: { limit: number; cursor?: string }) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId };

    if (query.cursor) {
      filter.id = { $lt: query.cursor };
    }

    const data = await db.collection("communications").find(
      filter,
      {
        projection: {
          _id: 0,
          id: 1,
          channel: 1,
          subject: 1,
          status: 1,
          provider: 1,
          sent_at: 1,
          recipients: 1,
          created_at: 1,
          metadata: 1,
          updated_at: 1,
        },
      },
    ).sort({ created_at: -1 }).limit(query.limit + 1).toArray();

    const hasMore = data.length > query.limit;
    const items = hasMore ? data.slice(0, query.limit) : data;

    return {
      items: items.map((item) => {
        const metadata = parseMetadata(item.metadata);
        const publicMetadata = { ...metadata };
        delete (publicMetadata as Record<string, unknown>).recipient_payload;
        delete (publicMetadata as Record<string, unknown>).variables;
        const errors = Array.isArray(metadata.errors)
          ? (metadata.errors as Array<{ email: string; message: string }>)
          : [];
        const topFailureReason = String(
          metadata.top_error
          ?? buildTopFailureReason(errors)
          ?? "",
        ).trim();
        const delivery = {
          ...defaultDeliveryMetrics(),
          ...(parseMetadata(metadata.delivery) as Partial<DeliveryMetrics>),
        };

        return {
          id: String(item.id),
          channel: String(item.channel),
          subject: item.subject ? String(item.subject) : "",
          status: String(item.status),
          provider: item.provider ? String(item.provider) : null,
          sentAt: item.sent_at ? String(item.sent_at) : null,
          createdAt: String(item.created_at),
          updatedAt: item.updated_at ? String(item.updated_at) : String(item.created_at),
          recipientCount: Array.isArray(item.recipients) ? item.recipients.length : 0,
          topFailureReason: topFailureReason || null,
          sent: Number(metadata.sent ?? 0),
          failed: Number(metadata.failed ?? 0),
          delivery,
          metadata: publicMetadata,
        };
      }),
      hasMore,
      nextCursor: hasMore ? String(items[items.length - 1]?.id) : null,
    };
  },

  async listAnnouncements(tenantId: string, query: { limit: number }) {
    const db = await getMongoDb();
    await ensureAnnouncementIndexes(db);
    await expireAnnouncements(tenantId);

    const rows = await db.collection(ANNOUNCEMENTS_COLLECTION).find(
      { tenant_id: tenantId },
      {
        projection: {
          _id: 0,
          id: 1,
          title: 1,
          message: 1,
          priority: 1,
          audience_summary: 1,
          related_drive_name: 1,
          recipient_count_snapshot: 1,
          status: 1,
          show_popup: 1,
          published_at: 1,
          expires_at: 1,
          created_at: 1,
        },
      },
    ).sort({ published_at: -1, created_at: -1 }).limit(query.limit).toArray();

    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      message: String(row.message),
      priority: String(row.priority) as AnnouncementPriority,
      audienceSummary: String(row.audience_summary ?? "All students"),
      relatedDriveName: row.related_drive_name ? String(row.related_drive_name) : null,
      recipientCount: Number(row.recipient_count_snapshot ?? 0),
      status: String(row.status ?? "published") as AnnouncementStatus,
      showPopup: Boolean(row.show_popup),
      publishedAt: String(row.published_at ?? row.created_at),
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      createdAt: String(row.created_at),
    }));
  },

  async listStudentAnnouncements(tenantId: string, userId: string, query: { limit: number }) {
    const db = await getMongoDb();
    await ensureAnnouncementIndexes(db);
    await expireAnnouncements(tenantId);
    const studentId = await resolveStudentRecordId(tenantId, userId);

    const rows = await db.collection(ANNOUNCEMENTS_COLLECTION).find(
      {
        tenant_id: tenantId,
        status: "published",
        recipient_student_ids: studentId,
        $or: [
          { expires_at: null },
          { expires_at: { $gt: new Date().toISOString() } },
        ],
      },
      {
        projection: {
          _id: 0,
          id: 1,
          title: 1,
          message: 1,
          priority: 1,
          related_drive_name: 1,
          show_popup: 1,
          published_at: 1,
          expires_at: 1,
          created_at: 1,
        },
      },
    ).sort({ published_at: -1, created_at: -1 }).limit(query.limit).toArray();

    const announcementIds = rows.map((row) => String(row.id));
    const readRows = announcementIds.length > 0
      ? await db.collection(ANNOUNCEMENT_READS_COLLECTION).find(
          { tenant_id: tenantId, student_id: studentId, announcement_id: { $in: announcementIds } },
          { projection: { _id: 0, announcement_id: 1, read_at: 1, dismissed_popup_at: 1, seen_on_dashboard_at: 1 } },
        ).toArray()
      : [];

    const readMap = new Map(readRows.map((row) => [String(row.announcement_id), row]));

    return rows.map((row) => {
      const state = readMap.get(String(row.id));
      const readAt = state?.read_at ? String(state.read_at) : null;
      const dismissedPopupAt = state?.dismissed_popup_at ? String(state.dismissed_popup_at) : null;
      const seenOnDashboardAt = state?.seen_on_dashboard_at ? String(state.seen_on_dashboard_at) : null;
      const priority = String(row.priority) as AnnouncementPriority;
      return {
        id: String(row.id),
        title: String(row.title),
        message: String(row.message),
        priority,
        relatedDriveName: row.related_drive_name ? String(row.related_drive_name) : null,
        showPopup: Boolean(row.show_popup),
        publishedAt: String(row.published_at ?? row.created_at),
        expiresAt: row.expires_at ? String(row.expires_at) : null,
        readAt,
        dismissedPopupAt,
        seenOnDashboardAt,
        unread: !readAt,
        popupEligible: priority === "urgent" && !readAt && !dismissedPopupAt,
        hasNavIndicator: !seenOnDashboardAt,
      };
    });
  },

  async markAnnouncementsSeen(tenantId: string, userId: string) {
    const db = await getMongoDb();
    await ensureAnnouncementIndexes(db);
    await expireAnnouncements(tenantId);
    const studentId = await resolveStudentRecordId(tenantId, userId);
    const now = new Date().toISOString();

    const announcementRows = await db.collection(ANNOUNCEMENTS_COLLECTION).find(
      {
        tenant_id: tenantId,
        status: "published",
        recipient_student_ids: studentId,
        $or: [
          { expires_at: null },
          { expires_at: { $gt: now } },
        ],
      },
      { projection: { _id: 0, id: 1 } },
    ).toArray();

    const announcementIds = announcementRows.map((row) => String(row.id));
    if (announcementIds.length === 0) {
      return { count: 0, seenAt: now };
    }

    await db.collection(ANNOUNCEMENT_READS_COLLECTION).bulkWrite(
      announcementIds.map((announcementId) => ({
        updateOne: {
          filter: { tenant_id: tenantId, student_id: studentId, announcement_id: announcementId },
          update: {
            $set: {
              updated_at: now,
              seen_on_dashboard_at: now,
            },
            $setOnInsert: {
              id: randomUUID(),
              tenant_id: tenantId,
              student_id: studentId,
              announcement_id: announcementId,
              created_at: now,
              read_at: null,
              dismissed_popup_at: null,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    return {
      count: announcementIds.length,
      seenAt: now,
    };
  },

  async markAnnouncementRead(tenantId: string, userId: string, announcementId: string) {
    const db = await getMongoDb();
    await ensureAnnouncementIndexes(db);
    const now = new Date().toISOString();
    const studentId = await resolveStudentRecordId(tenantId, userId);

    const announcement = await db.collection(ANNOUNCEMENTS_COLLECTION).findOne(
      { tenant_id: tenantId, id: announcementId, recipient_student_ids: studentId },
      { projection: { _id: 0, id: 1 } },
    );

    if (!announcement) {
      throw new AppError("ANNOUNCEMENT_NOT_FOUND", "Announcement not found", 404);
    }

    await db.collection(ANNOUNCEMENT_READS_COLLECTION).updateOne(
      { tenant_id: tenantId, student_id: studentId, announcement_id: announcementId },
      {
        $set: {
          read_at: now,
          updated_at: now,
          seen_on_dashboard_at: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          created_at: now,
          dismissed_popup_at: null,
        },
      },
      { upsert: true },
    );

    return { announcementId, readAt: now };
  },

  async dismissAnnouncementPopup(tenantId: string, userId: string, announcementId: string) {
    const db = await getMongoDb();
    await ensureAnnouncementIndexes(db);
    const now = new Date().toISOString();
    const studentId = await resolveStudentRecordId(tenantId, userId);

    const announcement = await db.collection(ANNOUNCEMENTS_COLLECTION).findOne(
      { tenant_id: tenantId, id: announcementId, recipient_student_ids: studentId },
      { projection: { _id: 0, id: 1 } },
    );

    if (!announcement) {
      throw new AppError("ANNOUNCEMENT_NOT_FOUND", "Announcement not found", 404);
    }

    await db.collection(ANNOUNCEMENT_READS_COLLECTION).updateOne(
      { tenant_id: tenantId, student_id: studentId, announcement_id: announcementId },
      {
        $set: {
          dismissed_popup_at: now,
          updated_at: now,
          seen_on_dashboard_at: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          created_at: now,
          read_at: null,
        },
      },
      { upsert: true },
    );

    return { announcementId, dismissedPopupAt: now };
  },

  async getStatus(tenantId: string, communicationId: string) {
    const db = await getMongoDb();
    const data = await db.collection("communications").findOne(
      { tenant_id: tenantId, id: communicationId },
      {
        projection: {
          _id: 0,
          id: 1,
          status: 1,
          provider: 1,
          provider_message_id: 1,
          sent_at: 1,
          metadata: 1,
          updated_at: 1,
        },
      },
    );

    if (!data) {
      throw new AppError("COMM_STATUS_NOT_FOUND", "Communication record not found", 404);
    }

    const metadata = parseMetadata(data.metadata);
    const errors = Array.isArray(metadata.errors)
      ? (metadata.errors as Array<{ email: string; message: string }>)
      : [];

    return {
      id: String(data.id),
      status: String(data.status),
      provider: data.provider ? String(data.provider) : null,
      providerMessageId: data.provider_message_id ? String(data.provider_message_id) : null,
      sentAt: data.sent_at ? String(data.sent_at) : null,
      updatedAt: String(data.updated_at),
      sent: Number(metadata.sent ?? 0),
      failed: Number(metadata.failed ?? 0),
      topFailureReason: String(metadata.top_error ?? buildTopFailureReason(errors) ?? "").trim() || null,
      delivery: {
        ...defaultDeliveryMetrics(),
        ...(parseMetadata(metadata.delivery) as Partial<DeliveryMetrics>),
      },
      errors,
    };
  },

  async sendBulk(
    tenantId: string,
    senderId: string,
    payload: {
      templateId?: string;
      subject?: string;
      body?: string;
      variables?: Record<string, string>;
      filters?: CommunicationFilters;
    },
  ) {
    const recipients = await resolveRecipients(tenantId, payload.filters);
    const message = await resolveMessageContent(tenantId, payload);
    return queueEmailBatch({
      tenantId,
      senderId,
      recipients,
      subject: message.subject,
      body: message.body,
      templateId: payload.templateId ?? null,
      variables: payload.variables,
      metadata: {
        filters: payload.filters ?? {},
      },
    });
  },

  async sendTemplatedToRecipients(input: {
    tenantId: string;
    senderId: string;
    templateSlug: string;
    recipients: Array<Recipient>;
    variables?: Record<string, string>;
    metadata?: Record<string, unknown>;
    allowUnsubscribe?: boolean;
  }) {
    const template = await resolveTemplateBySlug(input.tenantId, input.templateSlug);
    return queueEmailBatch({
      tenantId: input.tenantId,
      senderId: input.senderId,
      recipients: input.recipients,
      subject: template.subject,
      body: template.body,
      templateId: template.id,
      variables: input.variables,
      metadata: input.metadata,
      allowUnsubscribe: input.allowUnsubscribe,
    });
  },

  async dispatchQueuedCommunication(input: { tenantId: string; communicationId: string }) {
    const db = await getMongoDb();
    const row = await db.collection("communications").findOne(
      { tenant_id: input.tenantId, id: input.communicationId },
      {
        projection: {
          _id: 0,
          id: 1,
          tenant_id: 1,
          subject: 1,
          body: 1,
          status: 1,
          provider: 1,
          metadata: 1,
        },
      },
    );

    if (!row) {
      return;
    }

    const existingStatus = String(row.status ?? "");
    if (["sent", "partial", "failed"].includes(existingStatus)) {
      return;
    }

    const metadata = parseMetadata(row.metadata);
    const recipientPayload = parseRecipientPayload(metadata.recipient_payload);
    if (recipientPayload.length === 0) {
      throw new AppError("COMM_RECIPIENT_PAYLOAD_MISSING", "No recipients available for queued dispatch", 500);
    }

    const variables = parseMetadata(metadata.variables) as Record<string, string>;
    const mode = normalizeEmailMode();
    const allowUnsubscribe = metadata.allow_unsubscribe !== false;
    const senderIdentity = ((metadata.sender_identity && typeof metadata.sender_identity === "object")
      ? metadata.sender_identity
      : null) as SenderIdentity | null;
    const effectiveSender = senderIdentity ?? await resolveSenderIdentity(input.tenantId, mode);

    assertResendConfig();

    await db.collection("communications").updateOne(
      { tenant_id: input.tenantId, id: input.communicationId },
      {
        $set: {
          status: "processing",
          updated_at: new Date().toISOString(),
        },
      },
    );

    let sent = 0;
    let failed = 0;
    let providerMessageId: string | null = null;
    const errors: Array<{ email: string; message: string }> = [];
    const recipientResults: Array<{ studentId: string; sent: boolean; variables?: Record<string, string> }> = [];
    const delivery = {
      ...defaultDeliveryMetrics(),
      ...(parseMetadata(metadata.delivery) as Partial<DeliveryMetrics>),
    };

    for (const recipient of recipientPayload) {
      try {
        const mergedVars = {
          ...variables,
          ...(recipient.variables ?? {}),
          student_name: recipient.fullName,
          drive_name: recipient.driveName ?? variables.drive_name ?? "Campus Drive",
          unsubscribe_url: allowUnsubscribe
            ? buildUnsubscribeUrl({ tenantId: input.tenantId, email: recipient.email })
            : "",
        };

        const compiledSubject = renderTemplate(String(row.subject ?? ""), mergedVars);
        const renderedBody = renderTemplate(String(row.body ?? ""), mergedVars);
        const compiledBody = allowUnsubscribe
          ? appendUnsubscribeFooter(
              renderedBody,
              String(mergedVars.unsubscribe_url),
            )
          : renderedBody;

        const delivered = await sendWithRetry({
          mode,
          tenantId: input.tenantId,
          communicationId: input.communicationId,
          to: recipient.email,
          subject: compiledSubject,
          body: compiledBody,
          unsubscribeUrl: allowUnsubscribe ? String(mergedVars.unsubscribe_url) : null,
          sender: effectiveSender,
        });

        providerMessageId = delivered.providerMessageId;
        sent += 1;
        recipientResults.push({ studentId: recipient.studentId, sent: true, variables: recipient.variables });
      } catch (dispatchError) {
        failed += 1;
        recipientResults.push({ studentId: recipient.studentId, sent: false, variables: recipient.variables });
        errors.push({
          email: recipient.email,
          message: extractErrorMessage(dispatchError instanceof Error ? dispatchError.message : dispatchError),
        });
      }
    }

    const finalStatus = failed === 0 ? "sent" : sent > 0 ? "partial" : "failed";
    const topError = buildTopFailureReason(errors);
    await db.collection("communications").updateOne(
      { tenant_id: input.tenantId, id: input.communicationId },
      {
        $set: {
          status: finalStatus,
          provider: mode,
          provider_message_id: providerMessageId,
          sent_at: sent > 0 ? new Date().toISOString() : null,
          metadata: {
            ...metadata,
            sent,
            failed,
            errors: errors.slice(0, 200),
            top_error: topError,
            delivery,
          },
          updated_at: new Date().toISOString(),
        },
      },
    );

    await syncDriveResultNotifications({
      tenantId: input.tenantId,
      communicationId: input.communicationId,
      metadata,
      recipientResults,
    });
  },

  async handleSendGridWebhook(
    events: SendGridWebhookEvent[],
    secretHeader?: string,
  ) {
    void events;
    void secretHeader;
    throw new AppError("COMM_SENDGRID_DISABLED", "SendGrid webhook handling has been disabled. Resend is the only supported email provider.", 410);
  },
};
