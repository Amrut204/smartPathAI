import "dotenv/config";

import crypto from "node:crypto";
import { hash } from "bcryptjs";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import { computeReadinessScore } from "../src/services/readiness.logic.js";
import { ReadinessService } from "../src/services/readiness.service.js";
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

describe("Readiness score policy", () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const studentId = crypto.randomUUID();

  beforeAll(async () => {
    const db = await getMongoDb();
    const ts = nowIso();
    const passwordHash = await hash("Test@12345", 10);

    await db.collection("tenants").insertOne({
      id: tenantId,
      slug: `tenant-readiness-${tenantId.slice(0, 8)}`,
      name: "Readiness Policy College",
      is_active: true,
      config: {
        placementPolicy: {
          excludePlacedStudentsByDefault: false,
        },
      },
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("users").insertOne({
      id: userId,
      tenant_id: tenantId,
      email: `student-readiness-${tenantId.slice(0, 6)}@test.local`,
      role: "student",
      full_name: "Readiness Student",
      is_active: true,
      password_hash: passwordHash,
      must_change_password: false,
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("students").insertOne({
      id: studentId,
      tenant_id: tenantId,
      user_id: userId,
      roll_number: "RDP-001",
      branch: "CSE",
      batch: "2026",
      cgpa: 8.2,
      backlogs: 0,
      backlogs_total: 0,
      attendance_pct: 88,
      skills: ["DSA"],
      points: 0,
      streak_current: 0,
      streak_longest: 0,
      readiness_score: 0,
      profile_data: {},
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("drives").insertOne({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      company: "Readiness Systems",
      role: "Software Engineer",
      drive_date: plusDays(7),
      criteria: {
        minCgpa: 7,
        maxBacklogs: 0,
        branches: ["CSE"],
        minAttendance: 75,
      },
      status: "published",
      eligible_count: 1,
      latest_eligibility_version: null,
      latest_eligibility_computed_at: null,
      deleted_at: null,
      created_by: userId,
      created_at: ts,
      updated_at: ts,
    });
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await db.collection("student_attempts").deleteMany({ tenant_id: tenantId });
    await db.collection("topic_mastery").deleteMany({ tenant_id: tenantId });
    await db.collection("study_hours").deleteMany({ tenant_id: tenantId });
    await db.collection("resource_view_events").deleteMany({ tenant_id: tenantId });
    await db.collection("drive_results").deleteMany({ tenant_id: tenantId });
    await db.collection("drives").deleteMany({ tenant_id: tenantId });
    await db.collection("students").deleteMany({ tenant_id: tenantId });
    await db.collection("users").deleteMany({ tenant_id: tenantId });
    await db.collection("tenants").deleteMany({ id: tenantId });
    await closeMongoConnection();
  });

  beforeEach(async () => {
    const db = await getMongoDb();
    const ts = nowIso();
    await db.collection("student_attempts").deleteMany({ tenant_id: tenantId, student_id: studentId });
    await db.collection("topic_mastery").deleteMany({ tenant_id: tenantId, student_id: studentId });
    await db.collection("study_hours").deleteMany({ tenant_id: tenantId, student_id: studentId });
    await db.collection("resource_view_events").deleteMany({ tenant_id: tenantId, student_id: studentId });
    await db.collection("drive_results").deleteMany({ tenant_id: tenantId, student_id: studentId });
    await db.collection("students").updateOne(
      { tenant_id: tenantId, id: studentId },
      {
        $set: {
          points: 0,
          readiness_score: 0,
          profile_data: {},
          updated_at: ts,
        },
      },
    );
  });

  it("keeps students with strong profile and mock evidence high-readiness even without internal study activity", () => {
    const score = computeReadinessScore({
      profileCompletenessPct: 100,
      isCertified: true,
      hasResume: true,
      avgTestScore: 84,
      avgMastery: 72,
      totalSubmittedAttempts: 4,
      recentMockAttempts14d: 2,
      eligibleUpcomingDrives: 1,
      appliedRecently: false,
    });

    expect(score).toBeGreaterThan(75);
  });

  it("does not let study hours or points inflate readiness when the strong signals are weak", async () => {
    const db = await getMongoDb();
    const initialScore = await ReadinessService.calculate(tenantId, studentId);

    await db.collection("study_hours").insertMany([
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        student_id: studentId,
        topic_id: "arrays",
        study_date: nowIso().slice(0, 10),
        hours: 12,
        created_at: nowIso(),
      },
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        student_id: studentId,
        topic_id: "graphs",
        study_date: plusDays(-1),
        hours: 14,
        created_at: nowIso(),
      },
    ]);
    await db.collection("students").updateOne(
      { tenant_id: tenantId, id: studentId },
      { $set: { points: 9000 } },
    );

    const afterActivityScore = await ReadinessService.calculate(tenantId, studentId);

    expect(initialScore).toBeLessThan(50);
    expect(afterActivityScore).toBe(initialScore);
  });

  it("does not let resource views change readiness when placement evidence is unchanged", async () => {
    const db = await getMongoDb();
    const beforeScore = await ReadinessService.calculate(tenantId, studentId);

    await db.collection("resource_view_events").insertMany([
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        student_id: studentId,
        resource_id: crypto.randomUUID(),
        event_type: "open",
        session_id: crypto.randomUUID(),
        created_at: nowIso(),
      },
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        student_id: studentId,
        resource_id: crypto.randomUUID(),
        event_type: "external_redirect",
        session_id: crypto.randomUUID(),
        created_at: nowIso(),
      },
    ]);

    const afterScore = await ReadinessService.calculate(tenantId, studentId);

    expect(afterScore).toBe(beforeScore);
  });

  it("persists stronger readiness after profile, certification, resume, and mock evidence improve", async () => {
    const db = await getMongoDb();
    const ts = nowIso();

    await db.collection("students").updateOne(
      { tenant_id: tenantId, id: studentId },
      {
        $set: {
          profile_data: {
            prn: "PRN-RDP-001",
            degree: "B.Tech",
            currentSemester: "6",
            phone: "9999999999",
            personalEmail: "readiness.student.personal@test.local",
            resumeUrl: "https://example.com/resume.pdf",
            targetRoles: ["Software Engineer"],
            preferredLocations: ["Pune"],
            willingToRelocate: true,
            dataConsentAccepted: true,
            accuracyDeclarationAccepted: true,
            declaration: {
              onboardingAcceptedAt: ts,
              onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
              onboardingTypedValue: "RDP-001",
              profileCertifiedAt: ts,
              profileCertificationVersion: STUDENT_DECLARATION_POLICY_VERSION,
              profileCertificationTypedValue: PROFILE_CERTIFICATION_TYPED_VALUE,
              profileCertificationSnapshotHash: "readiness-policy-hash",
              lastCertifiedProfileAt: ts,
              profileEditLockedAt: ts,
            },
          },
          points: 0,
        },
      },
    );

    await db.collection("student_attempts").insertMany([
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        student_id: studentId,
        test_id: "mock-1",
        status: "submitted",
        score: 82,
        submitted_at: ts,
        created_at: ts,
      },
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        student_id: studentId,
        test_id: "mock-2",
        status: "submitted",
        score: 78,
        submitted_at: ts,
        created_at: ts,
      },
    ]);

    await db.collection("topic_mastery").insertMany([
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        student_id: studentId,
        topic_id: "arrays",
        mastery_level: 74,
        updated_at: ts,
      },
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        student_id: studentId,
        topic_id: "dp",
        mastery_level: 70,
        updated_at: ts,
      },
    ]);

    const readinessScore = await ReadinessService.calculate(tenantId, studentId);
    const updatedStudent = await db.collection("students").findOne(
      { tenant_id: tenantId, id: studentId },
      { projection: { _id: 0, readiness_score: 1 } },
    );

    expect(readinessScore).toBeGreaterThan(75);
    expect(Number(updatedStudent?.readiness_score ?? 0)).toBe(readinessScore);
  });
});
