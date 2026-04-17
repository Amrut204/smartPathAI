import "dotenv/config";

import crypto from "node:crypto";
import { hash } from "bcryptjs";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import { PROFILE_CERTIFICATION_TYPED_VALUE, STUDENT_DECLARATION_POLICY_VERSION } from "../src/utils/student-declaration.js";
import { TpoControlCenterService } from "../src/services/tpo-control-center.service.js";

jest.setTimeout(120000);

function nowIso() {
  return new Date().toISOString();
}

function plusDays(days: number) {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

describe("TPO control center contract", () => {
  const emptyTenantId = crypto.randomUUID();
  const populatedTenantId = crypto.randomUUID();
  const tpoUserId = crypto.randomUUID();
  const studentUserId = crypto.randomUUID();
  const studentId = crypto.randomUUID();
  const driveId = crypto.randomUUID();
  const announcementId = crypto.randomUUID();
  const unlockRequestId = crypto.randomUUID();
  const passwordHashPromise = hash("Test@12345", 10);

  beforeAll(async () => {
    const db = await getMongoDb();
    const ts = nowIso();
    const passwordHash = await passwordHashPromise;

    await db.collection("tenants").insertMany([
      {
        id: emptyTenantId,
        slug: `tenant-empty-cc-${emptyTenantId.slice(0, 8)}`,
        name: "Empty Control Center College",
        is_active: true,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: populatedTenantId,
        slug: `tenant-populated-cc-${populatedTenantId.slice(0, 8)}`,
        name: "Populated Control Center College",
        is_active: true,
        created_at: ts,
        updated_at: ts,
      },
    ]);

    await db.collection("users").insertMany([
      {
        id: tpoUserId,
        tenant_id: populatedTenantId,
        email: `tpo-cc-${populatedTenantId.slice(0, 6)}@test.local`,
        role: "tpo",
        full_name: "Control Center TPO",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: studentUserId,
        tenant_id: populatedTenantId,
        email: `student-cc-${populatedTenantId.slice(0, 6)}@test.local`,
        role: "student",
        full_name: "Control Center Student",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
    ]);

    await db.collection("students").insertOne({
      id: studentId,
      tenant_id: populatedTenantId,
      user_id: studentUserId,
      roll_number: "CC-001",
      branch: "CSE",
      batch: "2026",
      cgpa: 8.8,
      backlogs: 0,
      backlogs_total: 0,
      attendance_pct: 92,
      skills: ["DSA", "React"],
      readiness_score: 81,
      points: 0,
      streak_current: 0,
      streak_longest: 0,
      profile_data: {
        prn: "PRN-CC-001",
        degree: "B.Tech",
        currentSemester: "6",
        phone: "9999999999",
        personalEmail: "cc.student.personal@test.local",
        resumeUrl: "https://example.com/resume.pdf",
        targetRoles: ["Software Engineer"],
        preferredLocations: ["Pune"],
        willingToRelocate: true,
        dataConsentAccepted: true,
        accuracyDeclarationAccepted: true,
        declaration: {
          onboardingAcceptedAt: ts,
          onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
          onboardingTypedValue: "CC-001",
          profileCertifiedAt: ts,
          profileCertificationVersion: STUDENT_DECLARATION_POLICY_VERSION,
          profileCertificationTypedValue: PROFILE_CERTIFICATION_TYPED_VALUE,
          profileCertificationSnapshotHash: "control-center-hash",
          lastCertifiedProfileAt: ts,
          profileEditLockedAt: ts,
        },
      },
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("drives").insertOne({
      id: driveId,
      tenant_id: populatedTenantId,
      company: "Control Center Corp",
      role: "Developer",
      drive_date: plusDays(5),
      criteria: { minCgpa: 7.0, maxBacklogs: 0, branches: ["CSE"], minAttendance: 75 },
      status: "published",
      eligible_count: 1,
      created_by: tpoUserId,
      created_at: ts,
      updated_at: ts,
      latest_eligibility_version: null,
      latest_eligibility_computed_at: null,
      deleted_at: null,
    });

    await db.collection("profile_unlock_requests").insertOne({
      id: unlockRequestId,
      tenant_id: populatedTenantId,
      student_id: studentId,
      requested_by_user_id: studentUserId,
      status: "pending",
      reason_category: "resume_update",
      requested_fields: ["resumeUrl"],
      explanation: "Need to update the resume before the upcoming shortlist.",
      response_note: null,
      decided_at: null,
      decided_by: null,
      resolved_at: null,
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("announcements").insertOne({
      id: announcementId,
      tenant_id: populatedTenantId,
      sender_id: tpoUserId,
      title: "Drive reminder",
      message: "Please review the upcoming drive and complete your profile updates.",
      priority: "important",
      status: "published",
      recipient_student_ids: [studentId],
      related_drive_id: driveId,
      published_at: ts,
      created_at: ts,
      updated_at: ts,
      expires_at: null,
    });

    await db.collection("announcement_reads").insertOne({
      id: crypto.randomUUID(),
      tenant_id: populatedTenantId,
      announcement_id: announcementId,
      student_id: studentId,
      read_at: ts,
      first_read_at: ts,
      updated_at: ts,
      dismissed_popup_at: null,
    });
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await db.collection("announcement_reads").deleteMany({ tenant_id: { $in: [emptyTenantId, populatedTenantId] } });
    await db.collection("announcements").deleteMany({ tenant_id: { $in: [emptyTenantId, populatedTenantId] } });
    await db.collection("profile_unlock_requests").deleteMany({ tenant_id: { $in: [emptyTenantId, populatedTenantId] } });
    await db.collection("drives").deleteMany({ tenant_id: { $in: [emptyTenantId, populatedTenantId] } });
    await db.collection("students").deleteMany({ tenant_id: { $in: [emptyTenantId, populatedTenantId] } });
    await db.collection("users").deleteMany({ tenant_id: { $in: [emptyTenantId, populatedTenantId] } });
    await db.collection("tenants").deleteMany({ id: { $in: [emptyTenantId, populatedTenantId] } });
    await closeMongoConnection();
  });

  it("returns a safe zero-state control-center shape for empty tenants", async () => {
    const data = await TpoControlCenterService.getControlCenter(emptyTenantId);

    expect(data.summary.totalStudents).toBe(0);
    expect(data.summary.totalDrives).toBe(0);
    expect(data.readinessFunnel.totalStudents).toBe(0);
    expect(data.dashboardQueues.profileUnlockRequests.count).toBe(0);
    expect(data.dashboardQueues.studentSupportRequests.count).toBe(0);
    expect(Array.isArray(data.nextBestActions)).toBe(true);
    expect(data.pilotProof.metrics.announcementReadRate.pct).toBe(0);
  });

  it("returns the core readiness, queue, action, and adoption snapshot fields for populated tenants", async () => {
    const data = await TpoControlCenterService.getControlCenter(populatedTenantId);

    expect(data.summary.totalStudents).toBe(1);
    expect(data.summary.totalDrives).toBe(1);
    expect(data.readinessFunnel.totalStudents).toBe(1);
    expect(typeof data.readinessFunnel.completeProfiles).toBe("number");
    expect(typeof data.readinessFunnel.certifiedProfiles).toBe("number");
    expect(typeof data.readinessFunnel.resumeReadyProfiles).toBe("number");
    expect(data.dashboardQueues.profileUnlockRequests.count).toBe(1);
    expect(data.dashboardQueues.profileUnlockRequests.items[0]?.id).toBe(unlockRequestId);
    expect(Array.isArray(data.nextBestActions)).toBe(true);
    expect(data.nextBestActions.length).toBeGreaterThan(0);
    expect(data.pilotProof.metrics.announcementReadRate.readCount).toBe(1);
    expect(data.pilotProof.milestoneChecklist.importedStudents).toBe(true);
    expect(data.pilotProof.milestoneChecklist.createdFirstDrive).toBe(true);
    expect(data.pilotProof.milestoneChecklist.sentFirstAnnouncement).toBe(true);
    expect(data.operationsBoard.items[0]).toMatchObject({
      interventionPriority: expect.any(String),
      interventionPriorityLabel: expect.any(String),
      interventionReason: expect.any(String),
      interventionLabel: expect.any(String),
    });
  });
});
