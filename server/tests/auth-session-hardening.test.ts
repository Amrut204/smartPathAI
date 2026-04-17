import "dotenv/config";

import crypto from "node:crypto";

import request from "supertest";
import { hash } from "bcryptjs";

import app from "../src/app.js";
import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import { getCsrfCookieName } from "../src/middleware/csrf.middleware.js";
import { getRefreshTokenCookieName } from "../src/utils/auth-session.js";

function nowIso() {
  return new Date().toISOString();
}

function extractCookieValue(setCookieHeader: string | string[] | undefined, cookieName: string): string | null {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : typeof setCookieHeader === "string"
      ? [setCookieHeader]
      : [];

  const prefix = `${cookieName}=`;
  const raw = cookies.find((cookie) => cookie.startsWith(prefix));
  if (!raw) return null;
  return raw.slice(prefix.length).split(";")[0] ?? null;
}

describe("Auth session hardening", () => {
  const password = "Test@12345";
  const tenant = { id: crypto.randomUUID(), slug: `tenant-auth-${crypto.randomUUID().slice(0, 8)}`, name: "Tenant Auth" };
  const user = { id: crypto.randomUUID(), email: `student-auth-${crypto.randomUUID().slice(0, 8)}@test.local` };
  const tpoUser = { id: crypto.randomUUID(), email: `tpo-auth-${crypto.randomUUID().slice(0, 8)}@test.local` };
  const inactiveUser = { id: crypto.randomUUID(), email: `inactive-auth-${crypto.randomUUID().slice(0, 8)}@test.local` };

  beforeAll(async () => {
    const db = await getMongoDb();
    const ts = nowIso();
    const passwordHash = await hash(password, 10);

    await db.collection("tenants").insertOne({
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      is_active: true,
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("users").insertMany([
      {
        id: user.id,
        tenant_id: tenant.id,
        email: user.email.toLowerCase(),
        role: "student",
        full_name: "Auth Student",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: tpoUser.id,
        tenant_id: tenant.id,
        email: tpoUser.email.toLowerCase(),
        role: "tpo",
        full_name: "Auth TPO",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: inactiveUser.id,
        tenant_id: tenant.id,
        email: inactiveUser.email.toLowerCase(),
        role: "student",
        full_name: "Inactive Auth Student",
        is_active: false,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
    ]);
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await db.collection("refresh_sessions").deleteMany({ tenant_id: tenant.id });
    await db.collection("users").deleteMany({ tenant_id: tenant.id });
    await db.collection("tenants").deleteMany({ id: tenant.id });
    await closeMongoConnection();
  });

  it("rotates refresh tokens as single-use tokens", async () => {
    const agent = request.agent(app);
    const loginResponse = await agent
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.10.10.1")
      .send({ email: user.email, password });

    expect(loginResponse.status).toBe(200);
    const csrfToken = extractCookieValue(loginResponse.headers["set-cookie"], getCsrfCookieName());
    const originalRefreshToken = extractCookieValue(loginResponse.headers["set-cookie"], getRefreshTokenCookieName());
    expect(csrfToken).toBeTruthy();
    expect(originalRefreshToken).toBeTruthy();

    const refreshResponse = await agent
      .post("/api/v1/auth/refresh")
      .set("x-csrf-token", String(csrfToken))
      .send({});

    expect(refreshResponse.status).toBe(200);
    const rotatedRefreshToken = extractCookieValue(refreshResponse.headers["set-cookie"], getRefreshTokenCookieName());
    expect(rotatedRefreshToken).toBeTruthy();
    expect(rotatedRefreshToken).not.toBe(originalRefreshToken);

    const replayResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", [`${getRefreshTokenCookieName()}=${originalRefreshToken}`, `${getCsrfCookieName()}=${csrfToken}`])
      .set("x-csrf-token", String(csrfToken))
      .send({});

    expect(replayResponse.status).toBe(401);
    expect(replayResponse.body?.error?.code).toBe("REFRESH_REPLAY_DETECTED");
  });

  it("revokes refresh sessions on logout", async () => {
    const agent = request.agent(app);
    const loginResponse = await agent
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.10.10.2")
      .send({ email: user.email, password });

    expect(loginResponse.status).toBe(200);
    const csrfToken = extractCookieValue(loginResponse.headers["set-cookie"], getCsrfCookieName());
    const refreshToken = extractCookieValue(loginResponse.headers["set-cookie"], getRefreshTokenCookieName());
    expect(csrfToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();

    const logoutResponse = await agent
      .post("/api/v1/auth/logout")
      .set("x-csrf-token", String(csrfToken))
      .send({});

    expect(logoutResponse.status).toBe(200);

    const refreshAfterLogout = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", [`${getRefreshTokenCookieName()}=${refreshToken}`, `${getCsrfCookieName()}=${csrfToken}`])
      .set("x-csrf-token", String(csrfToken))
      .send({});

    expect(refreshAfterLogout.status).toBe(401);
    expect(refreshAfterLogout.body?.error?.code).toBe("SESSION_REVOKED");
  });

  it("returns student redirect and session cookies on login", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.10.10.3")
      .send({ email: user.email, password });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body?.success).toBe(true);
    expect(loginResponse.body?.data?.redirectTo).toBe("/dashboard");
    expect(loginResponse.body?.data?.profile?.role).toBe("student");
    expect(extractCookieValue(loginResponse.headers["set-cookie"], getCsrfCookieName())).toBeTruthy();
    expect(extractCookieValue(loginResponse.headers["set-cookie"], getRefreshTokenCookieName())).toBeTruthy();
  });

  it("returns TPO redirect and session cookies on login", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.10.10.4")
      .send({ email: tpoUser.email, password });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body?.success).toBe(true);
    expect(loginResponse.body?.data?.redirectTo).toBe("/tpo/dashboard");
    expect(loginResponse.body?.data?.profile?.role).toBe("tpo");
    expect(extractCookieValue(loginResponse.headers["set-cookie"], getCsrfCookieName())).toBeTruthy();
    expect(extractCookieValue(loginResponse.headers["set-cookie"], getRefreshTokenCookieName())).toBeTruthy();
  });

  it("rejects invalid passwords with 401", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.10.10.5")
      .send({ email: user.email, password: "WrongPassword!123" });

    expect(loginResponse.status).toBe(401);
    expect(loginResponse.body?.error?.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects inactive users with 401", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.10.10.6")
      .send({ email: inactiveUser.email, password });

    expect(loginResponse.status).toBe(401);
    expect(loginResponse.body?.error?.code).toBe("INVALID_CREDENTIALS");
  });
});
