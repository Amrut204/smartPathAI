import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { nowIso, renderTemplate, writeJson } from "./runtime.mjs";

async function readTemplate(filePath) {
  return readFile(filePath, "utf8");
}

export async function loadCredentialTemplates() {
  const templateRoot = path.resolve(process.cwd(), "ops/student-onboarding/templates");
  const subject = await readTemplate(path.join(templateRoot, "credential-subject.txt"));
  const body = await readTemplate(path.join(templateRoot, "credential-body.txt"));
  return {
    subject: subject.trim(),
    body: body.trim(),
  };
}

async function sendViaSendGrid(config, params) {
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.sendGridApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: params.to }],
          custom_args: {
            onboarding_batch_id: params.batchId,
            recipient_email: params.to,
          },
        },
      ],
      from: { email: config.sendGridFromEmail },
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

async function sendViaResend(config, params) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.resendFromEmail,
      to: [params.to],
      subject: params.subject,
      text: params.body,
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

async function sendMock(config, params) {
  const mockPayload = {
    sentAt: nowIso(),
    to: params.to,
    subject: params.subject,
    body: params.body,
    mode: config.emailMode,
  };

  if (params.outputPath) {
    await writeJson(params.outputPath, mockPayload);
  }

  return {
    provider: "mock",
    providerMessageId: `mock-${Date.now()}-${randomUUID()}`,
  };
}

export async function deliverCredentialEmail(config, params) {
  if (config.emailMode === "sendgrid") {
    if (!config.sendGridApiKey || !config.sendGridFromEmail) {
      throw new Error("EMAIL_MODE=sendgrid requires SENDGRID_API_KEY and SENDGRID_FROM_EMAIL.");
    }
    return sendViaSendGrid(config, params);
  }

  if (config.emailMode === "resend") {
    if (!config.resendApiKey || !config.resendFromEmail) {
      throw new Error("EMAIL_MODE=resend requires RESEND_API_KEY and RESEND_FROM_EMAIL.");
    }
    return sendViaResend(config, params);
  }

  return sendMock(config, params);
}

export function buildCredentialMessage(templates, variables) {
  return {
    subject: renderTemplate(templates.subject, variables),
    body: renderTemplate(templates.body, variables),
  };
}
