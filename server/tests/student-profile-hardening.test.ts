import "dotenv/config";

import crypto from "node:crypto";

import request from "supertest";
import { hash } from "bcryptjs";

import app from "../src/app.js";
import { GoogleDriveResumeService } from "../src/services/google-drive-resume.service.js";
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

function buildIncompleteProfileData() {
  return {
    declaration: {
      onboardingAcceptedAt: nowIso(),
      onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
      onboardingTypedValue: "PRF-001",
    },
  };
}

function buildLockedCertifiedProfileData(ts: string) {
  return {
    prn: "PRN-PRF-001",
    degree: "B.Tech",
    currentSemester: "6",
    phone: "9999999999",
    personalEmail: "profile.student.personal@test.local",
    resumeUrl: "https://example.com/original-resume.pdf",
    targetRoles: ["Software Engineer"],
    preferredLocations: ["Pune"],
    willingToRelocate: true,
    declaration: {
      onboardingAcceptedAt: ts,
      onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
      onboardingTypedValue: "PRF-001",
      profileCertifiedAt: ts,
      profileCertificationVersion: STUDENT_DECLARATION_POLICY_VERSION,
      profileCertificationTypedValue: PROFILE_CERTIFICATION_TYPED_VALUE,
      profileCertificationSnapshotHash: "profile-hardening-hash",
      lastCertifiedProfileAt: ts,
      profileEditLockedAt: ts,
    },
  };
}

describe("Student profile hardening", () => {
  const password = "Test@12345";
  const tenant = {
    id: crypto.randomUUID(),
    slug: `tenant-profile-${crypto.randomUUID().slice(0, 8)}`,
    name: "Tenant Profile",
  };
  const studentUser = {
    id: crypto.randomUUID(),
    email: `student-profile-${crypto.randomUUID().slice(0, 8)}@test.local`,
  };
  const student = {
    id: crypto.randomUUID(),
    rollNumber: "PRF-001",
  };

  async function loginStudent(ipSuffix: number) {
    const agent = request.agent(app);
    const loginResponse = await agent
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", `10.20.0.${ipSuffix}`)
      .send({ email: studentUser.email, password });

    expect(loginResponse.status).toBe(200);
    const csrfToken = extractCookieValue(loginResponse.headers["set-cookie"], getCsrfCookieName());
    expect(csrfToken).toBeTruthy();

    return { agent, csrfToken: String(csrfToken) };
  }

  async function resetStudentProfile(profileData: Record<string, unknown>) {
    const db = await getMongoDb();
    const ts = nowIso();
    await db.collection("students").updateOne(
      { tenant_id: tenant.id, id: student.id },
      {
        $set: {
          profile_data: profileData,
          updated_at: ts,
        },
      },
    );
    await db.collection("student_activity_events").deleteMany({ tenant_id: tenant.id, student_id: student.id });
    await db.collection("profile_unlock_requests").deleteMany({ tenant_id: tenant.id, student_id: student.id });
    await db.collection("announcements").deleteMany({ tenant_id: tenant.id });
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

    await db.collection("users").insertOne({
      id: studentUser.id,
      tenant_id: tenant.id,
      email: studentUser.email.toLowerCase(),
      role: "student",
      full_name: "Profile Student",
      is_active: true,
      password_hash: passwordHash,
      must_change_password: false,
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("students").insertOne({
      id: student.id,
      tenant_id: tenant.id,
      user_id: studentUser.id,
      roll_number: student.rollNumber,
      branch: "CSE",
      batch: "2026",
      cgpa: 8.1,
      backlogs: 0,
      backlogs_total: 0,
      attendance_pct: 86,
      skills: ["React"],
      points: 0,
      streak_current: 0,
      streak_longest: 0,
      readiness_score: 70,
      profile_data: buildIncompleteProfileData(),
      created_at: ts,
      updated_at: ts,
    });
  });

  beforeEach(async () => {
    await resetStudentProfile(buildIncompleteProfileData());
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await db.collection("announcements").deleteMany({ tenant_id: tenant.id });
    await db.collection("profile_unlock_requests").deleteMany({ tenant_id: tenant.id });
    await db.collection("student_activity_events").deleteMany({ tenant_id: tenant.id });
    await db.collection("refresh_sessions").deleteMany({ tenant_id: tenant.id });
    await db.collection("students").deleteMany({ tenant_id: tenant.id });
    await db.collection("users").deleteMany({ tenant_id: tenant.id });
    await db.collection("tenants").deleteMany({ id: tenant.id });
    await closeMongoConnection();
  });

  it("updates an unlocked profile successfully", async () => {
    const { agent, csrfToken } = await loginStudent(1);

    const response = await agent
      .patch("/api/v1/students/me")
      .set("x-csrf-token", csrfToken)
      .send({
        prn: "PRN-PRF-001",
        degree: "B.Tech",
        currentSemester: "6",
        phone: "9999999999",
        personalEmail: "profile.student.personal@test.local",
        targetRoles: ["Software Engineer"],
        preferredLocations: ["Pune"],
        willingToRelocate: true,
      });

    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);

    const db = await getMongoDb();
    const updated = await db.collection("students").findOne(
      { tenant_id: tenant.id, id: student.id },
      { projection: { _id: 0, profile_data: 1 } },
    );
    const profileData = (updated?.profile_data ?? {}) as Record<string, unknown>;
    expect(profileData.prn).toBe("PRN-PRF-001");
    expect(profileData.degree).toBe("B.Tech");
    expect(profileData.currentSemester).toBe("6");
    expect(profileData.phone).toBe("9999999999");
    expect(profileData.personalEmail).toBe("profile.student.personal@test.local");
    expect(profileData.targetRoles).toEqual(["Software Engineer"]);
    expect(profileData.preferredLocations).toEqual(["Pune"]);
    expect(profileData.willingToRelocate).toBe(true);
  });

  it("blocks profile edits when a certified profile is locked", async () => {
    const ts = nowIso();
    await resetStudentProfile(buildLockedCertifiedProfileData(ts));
    const { agent, csrfToken } = await loginStudent(2);

    const response = await agent
      .patch("/api/v1/students/me")
      .set("x-csrf-token", csrfToken)
      .send({ phone: "8888888888" });

    expect(response.status).toBe(409);
    expect(response.body?.error?.code).toBe("PROFILE_LOCKED");
  });

  it("rejects non-PDF resume uploads", async () => {
    const { agent, csrfToken } = await loginStudent(3);

    const response = await agent
      .post("/api/v1/students/me/resume")
      .set("x-csrf-token", csrfToken)
      .attach("resume", Buffer.from("not a pdf"), {
        filename: "resume.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(400);
    expect(response.body?.error?.code).toBe("RESUME_FILE_INVALID");
  });

  it("uploads a valid PDF resume and records managed resume metadata", async () => {
    const uploadedAt = nowIso();
    const uploadSpy = jest.spyOn(GoogleDriveResumeService, "uploadCurrentResume").mockResolvedValue({
      provider: "google_drive",
      fileId: "drive-file-123",
      webViewLink: "https://drive.google.com/file/d/drive-file-123/view",
      filename: "resume.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      uploadedAt,
    });

    try {
      const { agent, csrfToken } = await loginStudent(4);

      const response = await agent
        .post("/api/v1/students/me/resume")
        .set("x-csrf-token", csrfToken)
        .attach("resume", Buffer.from("%PDF-1.4 test pdf"), {
          filename: "resume.pdf",
          contentType: "application/pdf",
        });

      expect(response.status).toBe(200);
      expect(response.body?.success).toBe(true);

      const db = await getMongoDb();
      const updated = await db.collection("students").findOne(
        { tenant_id: tenant.id, id: student.id },
        { projection: { _id: 0, profile_data: 1 } },
      );
      const profileData = (updated?.profile_data ?? {}) as Record<string, unknown>;
      expect(profileData.resumeStorageProvider).toBe("google_drive");
      expect(profileData.resumeDriveFileId).toBe("drive-file-123");
      expect(profileData.resumeDriveWebLink).toBe("https://drive.google.com/file/d/drive-file-123/view");
      expect(profileData.resumeUrl).toBe("https://drive.google.com/file/d/drive-file-123/view");
      expect(profileData.resumeFilename).toBe("resume.pdf");

      const events = await db.collection("student_activity_events").find(
        { tenant_id: tenant.id, student_id: student.id, event_type: "resume_uploaded" },
        { projection: { _id: 0, event_type: 1, metadata: 1 } },
      ).toArray();
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata?.resumeFilename).toBe("resume.pdf");
    } finally {
      uploadSpy.mockRestore();
    }
  });

  it("emits profile_completed only once when required fields become complete", async () => {
    const { agent, csrfToken } = await loginStudent(5);

    const completeResponse = await agent
      .patch("/api/v1/students/me")
      .set("x-csrf-token", csrfToken)
      .send({
        prn: "PRN-PRF-001",
        degree: "B.Tech",
        currentSemester: "6",
        phone: "9999999999",
        personalEmail: "profile.student.personal@test.local",
        resumeUrl: "https://example.com/resume.pdf",
        targetRoles: ["Software Engineer"],
        preferredLocations: ["Pune"],
        willingToRelocate: true,
      });

    expect(completeResponse.status).toBe(200);
    expect(completeResponse.body?.data?.profileCompleteness?.pct).toBe(100);

    const followUpResponse = await agent
      .patch("/api/v1/students/me")
      .set("x-csrf-token", csrfToken)
      .send({
        achievements: "Won hackathon",
      });

    expect(followUpResponse.status).toBe(200);

    const db = await getMongoDb();
    const completionEvents = await db.collection("student_activity_events").find(
      { tenant_id: tenant.id, student_id: student.id, event_type: "profile_completed" },
      { projection: { _id: 0, event_type: 1 } },
    ).toArray();

    expect(completionEvents).toHaveLength(1);
  });
});
