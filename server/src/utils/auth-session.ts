import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { Response } from "express";

import type { AppRole } from "../types/domain.types.js";
import { getEnvVar } from "./env.js";

const ACCESS_TOKEN_COOKIE = "cdai_access_token";
const REFRESH_TOKEN_COOKIE = "cdai_refresh_token";
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 8;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

type SessionTokenType = "access" | "refresh";

export interface SessionPayload {
  sessionId: string;
  userId: string;
  email: string;
  role: AppRole;
  tenantId: string;
}

interface TokenPayload extends SessionPayload, JWTPayload {
  type: SessionTokenType;
}

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(getEnvVar("APP_JWT_SECRET"));
}

async function signToken(payload: TokenPayload, expiresInSeconds: number): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getJwtSecret());
}

export async function createSessionTokens(session: SessionPayload): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const [accessToken, refreshToken] = await Promise.all([
    signToken({ ...session, type: "access" }, ACCESS_TOKEN_TTL_SECONDS),
    signToken({ ...session, type: "refresh" }, REFRESH_TOKEN_TTL_SECONDS),
  ]);

  return { accessToken, refreshToken };
}

async function verifyToken(token: string, expectedType: SessionTokenType): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (payload.type !== expectedType) {
      return null;
    }

    if (
      typeof payload.sessionId !== "string" ||
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.tenantId !== "string"
    ) {
      return null;
    }

    return {
      sessionId: payload.sessionId,
      userId: payload.userId,
      email: payload.email,
      role: payload.role as AppRole,
      tenantId: payload.tenantId,
    };
  } catch {
    return null;
  }
}

export function getAccessTokenCookieName(): string {
  return ACCESS_TOKEN_COOKIE;
}

export function getRefreshTokenCookieName(): string {
  return REFRESH_TOKEN_COOKIE;
}

export async function verifyAccessToken(token: string): Promise<SessionPayload | null> {
  return verifyToken(token, "access");
}

export async function verifyRefreshToken(token: string): Promise<SessionPayload | null> {
  return verifyToken(token, "refresh");
}

export function setSessionCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const isProduction = process.env.NODE_ENV === "production";

  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });

  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookies(res: Response): void {
  const isProduction = process.env.NODE_ENV === "production";

  res.cookie(ACCESS_TOKEN_COOKIE, "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  res.cookie(REFRESH_TOKEN_COOKIE, "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
