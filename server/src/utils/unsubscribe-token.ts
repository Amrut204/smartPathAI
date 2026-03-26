import { createHmac, timingSafeEqual } from "node:crypto";

import { AppError } from "../middleware/error-handler.js";

type UnsubscribePayload = {
  v: 1;
  tenantId: string;
  email: string;
  exp: number;
};

function base64UrlEncode(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const paddingNeeded = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(paddingNeeded);
  return Buffer.from(padded, "base64").toString("utf8");
}

function getSecret() {
  const secret = String(process.env.COMM_UNSUB_SECRET ?? process.env.APP_JWT_SECRET ?? "").trim();
  if (!secret) {
    throw new AppError(
      "COMM_UNSUB_SECRET_MISSING",
      "COMM_UNSUB_SECRET (or APP_JWT_SECRET fallback) is required for unsubscribe tokens",
      500,
    );
  }
  return secret;
}

function sign(payloadB64: string) {
  const secret = getSecret();
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createUnsubscribeToken(input: {
  tenantId: string;
  email: string;
  ttlDays?: number;
}) {
  const ttlDays = input.ttlDays ?? 90;
  const now = Date.now();
  const payload: UnsubscribePayload = {
    v: 1,
    tenantId: input.tenantId,
    email: String(input.email).trim().toLowerCase(),
    exp: now + ttlDays * 24 * 60 * 60 * 1000,
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload {
  const trimmed = String(token ?? "").trim();
  const [payloadB64, sig] = trimmed.split(".");
  if (!payloadB64 || !sig) {
    throw new AppError("COMM_UNSUB_TOKEN_INVALID", "Invalid unsubscribe token", 400);
  }

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError("COMM_UNSUB_TOKEN_INVALID", "Invalid unsubscribe token", 400);
  }

  let parsed: UnsubscribePayload;
  try {
    parsed = JSON.parse(base64UrlDecode(payloadB64)) as UnsubscribePayload;
  } catch {
    throw new AppError("COMM_UNSUB_TOKEN_INVALID", "Invalid unsubscribe token", 400);
  }

  if (parsed.v !== 1 || !parsed.tenantId || !parsed.email || !parsed.exp) {
    throw new AppError("COMM_UNSUB_TOKEN_INVALID", "Invalid unsubscribe token", 400);
  }

  if (Date.now() > Number(parsed.exp)) {
    throw new AppError("COMM_UNSUB_TOKEN_EXPIRED", "Unsubscribe token expired", 400);
  }

  return {
    ...parsed,
    email: String(parsed.email).trim().toLowerCase(),
  };
}

