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

function buildLockedCertifiedProfileData(ts: string) {
  return {
    prn: "PRN-UNL-001",
    degree: "B.Tech",
    currentSemester: "6",
    phone: "9999999999",
    personalEmail: "unlock.student.personal@test.local",
    resumeUrl: "https://example.com/resume.pdf",
    targetRoles: ["Software Engineer"],
    preferredLocations: ["Pune"],
    willingToRelocate: true,
    declaration: {
      onboardingAcceptedAt: ts,
      onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
      onboardingTypedValue: "UNL-001",
      profileCertifiedAt: ts,
      profileCertificationVersion: STUDENT_DECLARATION_POLICY_VERSION,
      profileCertificationTypedValue: PROFILE_CERTIFICATION_TYPED_VALUE,
      profileCertificationSnapshotHash: "unlock-hardening-hash",
      lastCertifiedProfileAt: ts,
      profileEditLockedAt: ts,
    },
  };
}

describe("Student unlock workflow", () => {
  const password = "Test@12345";
  const tenant = {
    id: crypto.randomUUID(),
    slug: `tenant-unlock-${crypto.randomUUID().slice(0, 8)}`,
    name: "Tenant Unlock",
  };
  const studentUser = {
    id: crypto.randomUUID(),
    email: `student-unlock-${crypto.randomUUID().slice(0, 8)}@test.local`,
  };
  const tpoUser = {
    id: crypto.randomUUID(),
    email: `tpo-unlock-${crypto.randomUUID().slice(0, 8)}@test.local`,
  };
  const student = {
    id: crypto.randomUUID(),
    rollNumber: "UNL-001",
  };

  async function login(email: string, ipSuffix: number) {
    const agent = request.agent(app);
    const response = await agent
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", `10.30.0.${ipSuffix}`)
      .send({ email, password });

    expect(response.status).toBe(200);
    const csrfToken = extractCookieValue(response.headers["set-cookie"], getCsrfCookieName());
    expect(csrfToken).toBeTruthy();

    return { agent, csrfToken: String(csrfToken) };
  }

  async function resetWorkflowState() {
    const db = await getMongoDb();
    const ts = nowIso();
    await db.collection("students").updateOne(
      { tenant_id: tenant.id, id: student.id },
      {
        $set: {
          profile_data: buildLockedCertifiedProfileData(ts),
          updated_at: ts,
        },
      },
    );
    await db.collection("profile_unlock_requests").deleteMany({ tenant_id: tenant.id, student_id: student.id });
    await db.collection("student_activity_events").deleteMany({ tenant_id: tenant.id, student_id: student.id });
    await db.collection("announcements").deleteMany({ tenant_id: tenant.id });
    await db.collection("audit_logs").deleteMany({ tenant_id: tenant.id });
    await db.collection("refresh_sessions").deleteMany({ tenant_id: tenant.id });
  }

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
        id: studentUser.id,
        tenant_id: tenant.id,
        email: studentUser.email.toLowerCase(),
        role: "student",
        full_name: "Unlock Student",
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
        full_name: "Unlock TPO",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
    ]);

    await db.collection("students").insertOne({
      id: student.id,
      tenant_id: tenant.id,
      user_id: studentUser.id,
      roll_number: student.rollNumber,
      branch: "CSE",
      batch: "2026",
      cgpa: 8.4,
      backlogs: 0,
      backlogs_total: 0,
      attendance_pct: 89,
      skills: ["Node.js"],
      points: 0,
      streak_current: 0,
      streak_longest: 0,
      readiness_score: 74,
      profile_data: buildLockedCertifiedProfileData(ts),
      created_at: ts,
      updated_at: ts,
    });
  });

  beforeEach(async () => {
    await resetWorkflowState();
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await db.collection("announcements").deleteMany({ tenant_id: tenant.id });
    await db.collection("audit_logs").deleteMany({ tenant_id: tenant.id });
    await db.collection("student_activity_events").deleteMany({ tenant_id: tenant.id });
    await db.collection("profile_unlock_requests").deleteMany({ tenant_id: tenant.id });
    await db.collection("refresh_sessions").deleteMany({ tenant_id: tenant.id });
    await db.collection("students").deleteMany({ tenant_id: tenant.id });
    await db.collection("users").deleteMany({ tenant_id: tenant.id });
    await db.collection("tenants").deleteMany({ id: tenant.id });
    await closeMongoConnection();
  });

  it("lets a locked-profile student submit an unlock request", async () => {
    const { agent, csrfToken } = await login(studentUser.email, 1);

    const response = await agent
      .post("/api/v1/students/me/profile-unlock-request")
      .set("x-csrf-token", csrfToken)
      .send({
        reasonCategory: "resume_update",
        requestedFields: ["resumeUrl", "targetRoles"],
        explanation: "Need to update my resume and role preferences before the next drive.",
      });

    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);

    const db = await getMongoDb();
    const requestDoc = await db.collection("profile_unlock_requests").findOne(
      { tenant_id: tenant.id, student_id: student.id },
      { projection: { _id: 0, status: 1, reason_category: 1 } },
    );
    expect(requestDoc?.status).toBe("pending");
    expect(requestDoc?.reason_category).toBe("resume_update");

    const auditLog = await db.collection("audit_logs").findOne(
      { tenant_id: tenant.id, event_type: "student_support_requested" },
      { projection: { _id: 0, event_type: 1, metadata: 1 } },
    );
    expect(auditLog?.metadata?.supportType).toBe("profile_unlock_request");

    const activity = await db.collection("student_activity_events").findOne(
      { tenant_id: tenant.id, student_id: student.id, event_type: "profile_unlock_requested" },
      { projection: { _id: 0, event_type: 1 } },
    );
    expect(activity?.event_type).toBe("profile_unlock_requested");
  });

  it("rejects duplicate pending unlock requests", async () => {
    const { agent, csrfToken } = await login(studentUser.email, 2);

    const firstResponse = await agent
      .post("/api/v1/students/me/profile-unlock-request")
      .set("x-csrf-token", csrfToken)
      .send({
        reasonCategory: "academic_record",
        requestedFields: ["cgpa"],
        explanation: "Need to correct my CGPA before the shortlist is generated.",
      });

    expect(firstResponse.status).toBe(200);

    const secondResponse = await agent
      .post("/api/v1/students/me/profile-unlock-request")
      .set("x-csrf-token", csrfToken)
      .send({
        reasonCategory: "academic_record",
        requestedFields: ["cgpa"],
        explanation: "Trying again before the first request is reviewed.",
      });

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body?.error?.code).toBe("PROFILE_UNLOCK_ALREADY_REQUESTED");
  });

  it("lets TPOs approve an unlock request, logs the review, and notifies the student", async () => {
    const studentSession = await login(studentUser.email, 3);
    const requestResponse = await studentSession.agent
      .post("/api/v1/students/me/profile-unlock-request")
      .set("x-csrf-token", studentSession.csrfToken)
      .send({
        reasonCategory: "resume_update",
        requestedFields: ["resumeUrl"],
        explanation: "Need to upload the corrected resume before applications close.",
      });

    expect(requestResponse.status).toBe(200);
    const requestId = String(requestResponse.body?.data?.unlockRequest?.id ?? "");
    expect(requestId).toBeTruthy();

    const tpoSession = await login(tpoUser.email, 4);
    const reviewResponse = await tpoSession.agent
      .patch(`/api/v1/students/${student.id}/profile-unlock-request/${requestId}`)
      .set("x-csrf-token", tpoSession.csrfToken)
      .send({
        decision: "approved",
        responseNote: "Resume updates are approved for this drive window.",
      });

    expect(reviewResponse.status).toBe(200);
    expect(reviewResponse.body?.data?.decision).toBe("approved");

    const db = await getMongoDb();
    const requestDoc = await db.collection("profile_unlock_requests").findOne(
      { tenant_id: tenant.id, student_id: student.id, id: requestId },
      { projection: { _id: 0, status: 1, response_note: 1 } },
    );
    expect(requestDoc?.status).toBe("approved");
    expect(requestDoc?.response_note).toBe("Resume updates are approved for this drive window.");

    const studentDoc = await db.collection("students").findOne(
      { tenant_id: tenant.id, id: student.id },
      { projection: { _id: 0, profile_data: 1 } },
    );
    const declaration = ((studentDoc?.profile_data ?? {}) as Record<string, any>).declaration ?? {};
    expect(declaration.profileEditUnlockedAt).toBeTruthy();
    expect(declaration.profileCertificationInvalidatedAt).toBeTruthy();

    const auditLog = await db.collection("audit_logs").findOne(
      { tenant_id: tenant.id, event_type: "student_profile_unlock_reviewed" },
      { projection: { _id: 0, metadata: 1 } },
    );
    expect(auditLog?.metadata?.decision).toBe("approved");

    const activity = await db.collection("student_activity_events").findOne(
      { tenant_id: tenant.id, student_id: student.id, event_type: "profile_unlock_resolved" },
      { projection: { _id: 0, metadata: 1 } },
    );
    expect(activity?.metadata?.decision).toBe("approved");

    const announcement = await db.collection("announcements").findOne(
      { tenant_id: tenant.id, system_key: `profile-unlock-review:${requestId}` },
      { projection: { _id: 0, title: 1, recipient_student_ids: 1 } },
    );
    expect(announcement?.title).toContain("approved");
    expect(announcement?.recipient_student_ids).toContain(student.id);
  });
});
