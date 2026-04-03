import "dotenv/config";

import crypto from "node:crypto";

import request from "supertest";
import { hash } from "bcryptjs";

import app from "../src/app.js";
import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import { getCsrfCookieName } from "../src/middleware/csrf.middleware.js";
import { PROFILE_CERTIFICATION_TYPED_VALUE, STUDENT_DECLARATION_POLICY_VERSION } from "../src/utils/student-declaration.js";

jest.setTimeout(120000);

function nowIso() {
  return new Date().toISOString();
}

function plusDays(days: number) {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
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

describe("Drive application hardening", () => {
  const password = "Test@12345";
  const tenant = { id: crypto.randomUUID(), slug: `tenant-drive-${crypto.randomUUID().slice(0, 8)}`, name: "Tenant Drive" };
  const user = { id: crypto.randomUUID(), email: `student-drive-${crypto.randomUUID().slice(0, 8)}@test.local` };
  const student = { id: crypto.randomUUID(), rollNumber: "DRV-001" };
  const eligibleDriveId = crypto.randomUUID();
  const expiredDriveId = crypto.randomUUID();
  const ineligibleDriveId = crypto.randomUUID();

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

    await db.collection("users").insertOne({
      id: user.id,
      tenant_id: tenant.id,
      email: user.email.toLowerCase(),
      role: "student",
      full_name: "Drive Student",
      is_active: true,
      password_hash: passwordHash,
      must_change_password: false,
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("students").insertOne({
      id: student.id,
      tenant_id: tenant.id,
      user_id: user.id,
      roll_number: student.rollNumber,
      branch: "CSE",
      batch: "2026",
      cgpa: 8.2,
      backlogs: 0,
      backlogs_total: 0,
      attendance_pct: 88,
      skills: ["SQL"],
      points: 0,
      streak_current: 0,
      streak_longest: 0,
      readiness_score: 72,
      profile_data: {
        prn: "PRN-DRV-001",
        phone: "9999999999",
        personalEmail: "personal@example.com",
        resumeUrl: "https://example.com/resume.pdf",
        targetRoles: ["Software Engineer"],
        preferredLocations: ["Pune"],
        willingToRelocate: true,
        dataConsentAccepted: true,
        accuracyDeclarationAccepted: true,
        declaration: {
          onboardingAcceptedAt: ts,
          onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
          onboardingTypedValue: student.rollNumber,
          profileCertifiedAt: ts,
          profileCertificationVersion: STUDENT_DECLARATION_POLICY_VERSION,
          profileCertificationTypedValue: PROFILE_CERTIFICATION_TYPED_VALUE,
          profileCertificationSnapshotHash: "test-hash",
          lastCertifiedProfileAt: ts,
        },
      },
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("drives").insertMany([
      {
        id: eligibleDriveId,
        tenant_id: tenant.id,
        company: "Eligible Corp",
        role: "Engineer",
        drive_date: plusDays(10),
        criteria: { minCgpa: 7.0, maxBacklogs: 0, branches: ["CSE"], minAttendance: 75 },
        status: "upcoming",
        eligible_count: 0,
        created_by: user.id,
        created_at: ts,
        updated_at: ts,
        latest_eligibility_version: null,
        latest_eligibility_computed_at: null,
        deleted_at: null,
      },
      {
        id: expiredDriveId,
        tenant_id: tenant.id,
        company: "Expired Corp",
        role: "Engineer",
        drive_date: plusDays(-1),
        criteria: { minCgpa: 7.0, maxBacklogs: 0, branches: ["CSE"], minAttendance: 75 },
        status: "upcoming",
        eligible_count: 0,
        created_by: user.id,
        created_at: ts,
        updated_at: ts,
        latest_eligibility_version: null,
        latest_eligibility_computed_at: null,
        deleted_at: null,
      },
      {
        id: ineligibleDriveId,
        tenant_id: tenant.id,
        company: "Strict Corp",
        role: "Engineer",
        drive_date: plusDays(10),
        criteria: { minCgpa: 9.5, maxBacklogs: 0, branches: ["CSE"], minAttendance: 75 },
        status: "upcoming",
        eligible_count: 0,
        created_by: user.id,
        created_at: ts,
        updated_at: ts,
        latest_eligibility_version: null,
        latest_eligibility_computed_at: null,
        deleted_at: null,
      },
    ]);
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await db.collection("student_drive_declarations").deleteMany({ tenant_id: tenant.id });
    await db.collection("drive_results").deleteMany({ tenant_id: tenant.id });
    await db.collection("refresh_sessions").deleteMany({ tenant_id: tenant.id });
    await db.collection("drives").deleteMany({ tenant_id: tenant.id });
    await db.collection("students").deleteMany({ tenant_id: tenant.id });
    await db.collection("users").deleteMany({ tenant_id: tenant.id });
    await db.collection("tenants").deleteMany({ id: tenant.id });
    await closeMongoConnection();
  });

  it("blocks duplicate, expired, and ineligible drive applications cleanly", async () => {
    const agent = request.agent(app);
    const loginResponse = await agent.post("/api/v1/auth/login").send({ email: user.email, password });

    expect(loginResponse.status).toBe(200);
    const csrfToken = extractCookieValue(loginResponse.headers["set-cookie"], getCsrfCookieName());
    expect(csrfToken).toBeTruthy();

    const firstApply = await agent
      .post(`/api/v1/students/me/drives/${eligibleDriveId}/apply`)
      .set("x-csrf-token", String(csrfToken))
      .send({ confirmDeclaration: true });

    expect(firstApply.status).toBe(200);
    expect(firstApply.body?.success).toBe(true);

    const secondApply = await agent
      .post(`/api/v1/students/me/drives/${eligibleDriveId}/apply`)
      .set("x-csrf-token", String(csrfToken))
      .send({ confirmDeclaration: true });

    expect(secondApply.status).toBe(409);
    expect(secondApply.body?.error?.code).toBe("DRIVE_ALREADY_APPLIED");

    const expiredApply = await agent
      .post(`/api/v1/students/me/drives/${expiredDriveId}/apply`)
      .set("x-csrf-token", String(csrfToken))
      .send({ confirmDeclaration: true });

    expect(expiredApply.status).toBe(409);
    expect(expiredApply.body?.error?.code).toBe("DRIVE_DEADLINE_PASSED");

    const ineligibleApply = await agent
      .post(`/api/v1/students/me/drives/${ineligibleDriveId}/apply`)
      .set("x-csrf-token", String(csrfToken))
      .send({ confirmDeclaration: true });

    expect(ineligibleApply.status).toBe(409);
    expect(ineligibleApply.body?.error?.code).toBe("DRIVE_NOT_ELIGIBLE");
  });
});
