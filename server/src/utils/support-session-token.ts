import { jwtVerify, SignJWT, type JWTPayload } from "jose";

import { getEnvVar } from "./env.js";

const SUPPORT_COOKIE = "cdai_support_session";
const SUPPORT_TOKEN_TTL_SECONDS_DEFAULT = 60 * 60; // 1 hour

type SupportTokenType = "support";

export interface SupportSessionPayload {
  sessionId: string;
  tenantId: string;
  userId: string;
}

interface TokenPayload extends SupportSessionPayload, JWTPayload {
  type: SupportTokenType;
}

function getSupportSecret(): Uint8Array {
  // Reuse the app secret unless a separate one is provided.
  const secret = process.env.SUPPORT_SESSION_SECRET || getEnvVar("APP_JWT_SECRET");
  return new TextEncoder().encode(secret);
}

export function getSupportSessionCookieName() {
  return SUPPORT_COOKIE;
}

export async function createSupportSessionToken(
  payload: SupportSessionPayload,
  ttlSeconds = SUPPORT_TOKEN_TTL_SECONDS_DEFAULT,
) {
  return new SignJWT({ ...payload, type: "support" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(getSupportSecret());
}

export async function verifySupportSessionToken(token: string): Promise<SupportSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSupportSecret());
    if (payload.type !== "support") {
      return null;
    }
    if (
      typeof payload.sessionId !== "string"
      || typeof payload.tenantId !== "string"
      || typeof payload.userId !== "string"
    ) {
      return null;
    }
    return {
      sessionId: payload.sessionId,
      tenantId: payload.tenantId,
      userId: payload.userId,
    };
  } catch {
    return null;
  }
}

