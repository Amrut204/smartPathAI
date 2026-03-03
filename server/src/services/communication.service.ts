import { randomUUID } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

type Recipient = {
  studentId: string;
  fullName: string;
  email: string;
  driveName: string | undefined;
};

export function renderTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => variables[key] ?? "");
}

async function resolveRecipients(
  tenantId: string,
  filters?: {
    driveId?: string;
    eligibleOnly?: boolean;
    batch?: string;
    branch?: string;
    minCgpa?: number;
  },
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
  if (studentIds && studentIds.length > 0) {
    studentFilter.id = { $in: studentIds };
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

  return students
    .map((student) => {
      const user = userMap.get(String(student.user_id));
      if (!user?.email) {
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
}

async function sendEmailViaSendGrid(params: {
  to: string;
  subject: string;
  body: string;
}) {
  const sendGridKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;

  if (!sendGridKey || !fromEmail || sendGridKey.includes("<")) {
    return { provider: "mock", providerMessageId: `mock-${Date.now()}` };
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendGridKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: params.to }],
        },
      ],
      from: { email: fromEmail },
      subject: params.subject,
      content: [{ type: "text/plain", value: params.body }],
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || "SendGrid send failed");
  }

  return {
    provider: "sendgrid",
    providerMessageId: response.headers.get("x-message-id") ?? null,
  };
}

function chunkRecipients<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function sendWithRetry(
  params: { to: string; subject: string; body: string },
  maxAttempts = 3,
): Promise<{ provider: string; providerMessageId: string | null }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await sendEmailViaSendGrid(params);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 200));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Dispatch failed after retries");
}

export const CommunicationService = {
  async listTemplates(tenantId: string) {
    const db = await getMongoDb();
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

  async getHistory(tenantId: string, query: { limit: number; cursor?: string }) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { tenant_id: tenantId };

    if (query.cursor) {
      filter.id = { $lt: query.cursor };
    }

    const data = await db.collection("communications").find(
      filter,
      { projection: { _id: 0, id: 1, channel: 1, subject: 1, status: 1, provider: 1, sent_at: 1, recipients: 1, created_at: 1, metadata: 1 } },
    ).sort({ created_at: -1 }).limit(query.limit + 1).toArray();

    const hasMore = data.length > query.limit;
    const items = hasMore ? data.slice(0, query.limit) : data;

    return {
      items: items.map((item) => ({
        id: String(item.id),
        channel: String(item.channel),
        subject: item.subject ? String(item.subject) : "",
        status: String(item.status),
        provider: item.provider ? String(item.provider) : null,
        sentAt: item.sent_at ? String(item.sent_at) : null,
        createdAt: String(item.created_at),
        recipientCount: Array.isArray(item.recipients) ? item.recipients.length : 0,
        metadata: (item.metadata ?? {}) as Record<string, unknown>,
      })),
      hasMore,
      nextCursor: hasMore ? String(items[items.length - 1]?.id) : null,
    };
  },

  async getStatus(tenantId: string, communicationId: string) {
    const db = await getMongoDb();
    const data = await db.collection("communications").findOne(
      { tenant_id: tenantId, id: communicationId },
      { projection: { _id: 0, id: 1, status: 1, provider: 1, provider_message_id: 1, sent_at: 1, metadata: 1, updated_at: 1 } },
    );

    if (!data) {
      throw new AppError("COMM_STATUS_NOT_FOUND", "Communication record not found", 404);
    }

    const metadata = (data.metadata ?? {}) as {
      sent?: number;
      failed?: number;
      errors?: Array<{ email: string; message: string }>;
    };

    return {
      id: String(data.id),
      status: String(data.status),
      provider: data.provider ? String(data.provider) : null,
      providerMessageId: data.provider_message_id ? String(data.provider_message_id) : null,
      sentAt: data.sent_at ? String(data.sent_at) : null,
      updatedAt: String(data.updated_at),
      sent: Number(metadata.sent ?? 0),
      failed: Number(metadata.failed ?? 0),
      errors: Array.isArray(metadata.errors) ? metadata.errors : [],
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
      filters?: {
        driveId?: string;
        eligibleOnly?: boolean;
        batch?: string;
        branch?: string;
        minCgpa?: number;
      };
    },
  ) {
    const db = await getMongoDb();
    const recipients = await resolveRecipients(tenantId, payload.filters);

    if (recipients.length === 0) {
      throw new AppError("COMM_NO_RECIPIENTS", "No recipients matched the selected filters", 400);
    }

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

    const communicationId = randomUUID();
    const now = new Date().toISOString();

    await db.collection("communications").insertOne({
      id: communicationId,
      tenant_id: tenantId,
      sender_id: senderId,
      channel: "email",
      subject,
      body,
      recipients: recipients.map((recipient) => recipient.email),
      status: "queued",
      provider: "sendgrid",
      metadata: {
        filters: payload.filters ?? {},
        template_id: payload.templateId ?? null,
      },
      created_at: now,
      updated_at: now,
    });

    void this.dispatchCommunication({
      communicationId,
      tenantId,
      subject,
      body,
      recipients,
      variables: payload.variables ?? {},
    });

    return {
      communicationId,
      recipientCount: recipients.length,
      status: "queued",
    };
  },

  async dispatchCommunication(input: {
    communicationId: string;
    tenantId: string;
    subject: string;
    body: string;
    recipients: Recipient[];
    variables: Record<string, string>;
  }) {
    const db = await getMongoDb();
    await db.collection("communications").updateOne(
      { tenant_id: input.tenantId, id: input.communicationId },
      { $set: { status: "processing" } },
    );

    let sent = 0;
    let failed = 0;
    let providerMessageId: string | null = null;
    let provider = "sendgrid";
    const errors: Array<{ email: string; message: string }> = [];

    for (const batch of chunkRecipients(input.recipients, 100)) {
      for (const recipient of batch) {
        try {
          const variables = {
            ...input.variables,
            student_name: recipient.fullName,
            drive_name: recipient.driveName ?? input.variables.drive_name ?? "Campus Drive",
          };
          const compiledSubject = renderTemplate(input.subject, variables);
          const compiledBody = renderTemplate(input.body, variables);
          const delivered = await sendWithRetry({
            to: recipient.email,
            subject: compiledSubject,
            body: compiledBody,
          });

          provider = delivered.provider;
          providerMessageId = delivered.providerMessageId;
          sent += 1;
        } catch (dispatchError) {
          failed += 1;
          errors.push({
            email: recipient.email,
            message: dispatchError instanceof Error ? dispatchError.message : "Unknown dispatch error",
          });
        }
      }
    }

    const finalStatus = failed === 0 ? "sent" : sent > 0 ? "partial" : "failed";

    await db.collection("communications").updateOne(
      { tenant_id: input.tenantId, id: input.communicationId },
      {
        $set: {
          status: finalStatus,
          provider,
          provider_message_id: providerMessageId,
          sent_at: sent > 0 ? new Date().toISOString() : null,
          metadata: {
            sent,
            failed,
            errors,
          },
          updated_at: new Date().toISOString(),
        },
      },
    );
  },
};
