import assert from "node:assert/strict";

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
};

const BASE_URL = String(process.env.COMM_TEST_BASE_URL ?? "http://localhost:5000").replace(/\/+$/, "");
const EMAIL = String(process.env.COMM_TEST_EMAIL ?? "tpo@apex.edu");
const PASSWORD = String(process.env.COMM_TEST_PASSWORD ?? "Password@123");

const cookieJar = new Map<string, string>();

function parseSetCookieHeader(header: string): Array<{ name: string; value: string }> {
  return header
    .split(/,(?=[^;,]+=)/g)
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter((value) => value.includes("="))
    .map((value) => {
      const [name, ...rest] = value.split("=");
      return {
        name: name.trim(),
        value: rest.join("=").trim(),
      };
    })
    .filter((row) => row.name.length > 0);
}

function updateCookies(response: Response) {
  const getSetCookie = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = typeof getSetCookie === "function"
    ? getSetCookie.call(response.headers)
    : [];

  if (setCookies.length > 0) {
    setCookies.forEach((cookie) => {
      parseSetCookieHeader(cookie).forEach((pair) => cookieJar.set(pair.name, pair.value));
    });
    return;
  }

  const singleHeader = response.headers.get("set-cookie");
  if (singleHeader) {
    parseSetCookieHeader(singleHeader).forEach((pair) => cookieJar.set(pair.name, pair.value));
  }
}

function cookieHeaderValue() {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<ApiEnvelope<T>> {
  const headers = new Headers(options?.headers ?? {});
  if (!headers.has("Content-Type") && options?.body) {
    headers.set("Content-Type", "application/json");
  }

  const cookies = cookieHeaderValue();
  if (cookies) {
    headers.set("Cookie", cookies);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  updateCookies(response);

  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !payload.success) {
    throw new Error(`Request failed (${response.status}) ${path}: ${payload.error?.message ?? "Unknown error"}`);
  }
  return payload;
}

async function main() {
  console.log(`[comm-test] Base URL: ${BASE_URL}`);

  await apiRequest<{ profile: { role: string } }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
    }),
  });

  const stamp = Date.now();
  const template = await apiRequest<{ id: string }>("/api/v1/communication/templates", {
    method: "POST",
    body: JSON.stringify({
      name: `Comm Smoke ${stamp}`,
      slug: `comm-smoke-${stamp}`,
      subject: "Demo: {{drive_name}}",
      body: "Hello {{student_name}}, this is a communication smoke test. {{message}}",
    }),
  });
  assert.ok(template.data.id);

  const preview = await apiRequest<{
    recipientCount: number;
    sampleRecipients: Array<{ email: string }>;
    mode: "mock" | "sendgrid";
    queueBackend: "inline" | "bullmq";
  }>("/api/v1/communication/preview", {
    method: "POST",
    body: JSON.stringify({
      templateId: template.data.id,
      filters: {
        batch: "2026",
      },
    }),
  });
  assert.ok(preview.data.recipientCount >= preview.data.sampleRecipients.length);

  const send = await apiRequest<{
    communicationId: string;
    recipientCount: number;
    status: string;
  }>("/api/v1/communication/send", {
    method: "POST",
    body: JSON.stringify({
      templateId: template.data.id,
      variables: {
        message: "Please check your dashboard for details.",
      },
      filters: {
        batch: "2026",
      },
    }),
  });
  assert.ok(send.data.communicationId);
  assert.equal(send.data.status, "queued");

  let terminalStatus = "queued";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await apiRequest<{ status: string }>(
      `/api/v1/communication/${send.data.communicationId}/status`,
    );
    terminalStatus = status.data.status;
    if (["sent", "partial", "failed"].includes(terminalStatus)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  assert.ok(["sent", "partial", "failed"].includes(terminalStatus));

  const history = await apiRequest<{
    items: Array<{ id: string; topFailureReason: string | null }>;
  }>("/api/v1/communication/history?limit=50");
  const record = history.data.items.find((item) => item.id === send.data.communicationId);
  assert.ok(record, "Communication history should contain queued communication");

  const webhookSecret = String(process.env.SENDGRID_WEBHOOK_SECRET ?? "");
  await apiRequest<{ processed: number; matched: number }>("/api/v1/communication/webhooks/sendgrid", {
    method: "POST",
    headers: webhookSecret ? { "x-webhook-secret": webhookSecret } : undefined,
    body: JSON.stringify([
      {
        event: "delivered",
        communication_id: send.data.communicationId,
        timestamp: Math.floor(Date.now() / 1000),
      },
    ]),
  });

  const statusAfterWebhook = await apiRequest<{
    delivery: { delivered: number };
  }>(`/api/v1/communication/${send.data.communicationId}/status`);
  assert.ok(statusAfterWebhook.data.delivery.delivered >= 1);

  console.log(
    `[comm-test] Passed. communicationId=${send.data.communicationId} terminalStatus=${terminalStatus} recipients=${send.data.recipientCount}`,
  );
}

main().catch((error) => {
  console.error(`[comm-test] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

