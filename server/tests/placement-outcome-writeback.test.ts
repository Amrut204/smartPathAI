import "dotenv/config";

import crypto from "node:crypto";
import { hash } from "bcryptjs";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import { DriveService } from "../src/services/drive.service.js";
import { StudentService } from "../src/services/student.service.js";
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

describe("Placement outcome writeback", () => {
  const tenantId = crypto.randomUUID();
  const tpoUserId = crypto.randomUUID();
  const studentUserId = crypto.randomUUID();
  const studentId = crypto.randomUUID();
  const selectedDriveId = crypto.randomUUID();
  const futureDriveId = crypto.randomUUID();
  const strictFutureDriveId = crypto.randomUUID();
  const passwordHashPromise = hash("Test@12345", 10);

  async function resetPlacementState(excludePlacedStudentsByDefault = true) {
    const db = await getMongoDb();
    const ts = nowIso();
    await db.collection("tenants").updateOne(
      { id: tenantId },
      {
        $set: {
          "config.placementPolicy.excludePlacedStudentsByDefault": excludePlacedStudentsByDefault,
          updated_at: ts,
        },
      },
    );
    await db.collection("students").updateOne(
      { tenant_id: tenantId, id: studentId },
      {
        $set: {
          profile_data: {
            prn: "PRN-PLC-001",
            phone: "9999999999",
            personalEmail: "student.personal@test.local",
            resumeUrl: "https://example.com/resume.pdf",
            targetRoles: ["Software Engineer"],
            preferredLocations: ["Pune"],
            willingToRelocate: true,
            declaration: {
              onboardingAcceptedAt: ts,
              onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
              onboardingTypedValue: "PLC-001",
              profileCertifiedAt: ts,
              profileCertificationVersion: STUDENT_DECLARATION_POLICY_VERSION,
              profileCertificationTypedValue: PROFILE_CERTIFICATION_TYPED_VALUE,
              profileCertificationSnapshotHash: "placement-test-hash",
              lastCertifiedProfileAt: ts,
            },
          },
          updated_at: ts,
        },
      },
    );
    await db.collection("student_placement_history").deleteMany({ tenant_id: tenantId, student_id: studentId });
    await db.collection("announcements").deleteMany({ tenant_id: tenantId });
    await db.collection("communications").deleteMany({ tenant_id: tenantId });
    await db.collection("audit_logs").deleteMany({ tenant_id: tenantId });
    await db.collection("drive_results").deleteMany({ tenant_id: tenantId, drive_id: selectedDriveId, student_id: studentId });
    await db.collection("drive_results").insertOne({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      drive_id: selectedDriveId,
      student_id: studentId,
      status: "applied",
      application_state: "applied",
      outcome: "selected",
      final_ctc_lpa: 8.5,
      remarks: null,
      registered: true,
      appeared: true,
      created_at: ts,
      updated_at: ts,
    });
  }

  beforeAll(async () => {
    const db = await getMongoDb();
    const ts = nowIso();
    const passwordHash = await passwordHashPromise;

    await db.collection("tenants").insertOne({
      id: tenantId,
      slug: `tenant-placement-${tenantId.slice(0, 8)}`,
      name: "Placement Policy College",
      is_active: true,
      config: {
        placementPolicy: {
          excludePlacedStudentsByDefault: true,
        },
      },
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("users").insertMany([
      {
        id: tpoUserId,
        tenant_id: tenantId,
        email: `tpo-${tenantId.slice(0, 6)}@test.local`,
        role: "tpo",
        full_name: "Placement Officer",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: studentUserId,
        tenant_id: tenantId,
        email: `student-${tenantId.slice(0, 6)}@test.local`,
        role: "student",
        full_name: "Placed Student",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
    ]);

    await db.collection("students").insertOne({
      id: studentId,
      tenant_id: tenantId,
      user_id: studentUserId,
      roll_number: "PLC-001",
      branch: "CSE",
      batch: "2026",
      cgpa: 8.6,
      backlogs: 0,
      backlogs_total: 0,
      attendance_pct: 90,
      skills: ["SQL", "DSA"],
      readiness_score: 78,
      points: 0,
      streak_current: 0,
      streak_longest: 0,
      profile_data: {
        prn: "PRN-PLC-001",
        phone: "9999999999",
        personalEmail: "student.personal@test.local",
        resumeUrl: "https://example.com/resume.pdf",
        targetRoles: ["Software Engineer"],
        preferredLocations: ["Pune"],
        willingToRelocate: true,
        declaration: {
          onboardingAcceptedAt: ts,
          onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
          onboardingTypedValue: "PLC-001",
          profileCertifiedAt: ts,
          profileCertificationVersion: STUDENT_DECLARATION_POLICY_VERSION,
          profileCertificationTypedValue: PROFILE_CERTIFICATION_TYPED_VALUE,
          profileCertificationSnapshotHash: "placement-test-hash",
          lastCertifiedProfileAt: ts,
        },
      },
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("drives").insertMany([
      {
        id: selectedDriveId,
        tenant_id: tenantId,
        company: "Placed Corp",
        role: "Software Engineer",
        drive_date: plusDays(2),
        criteria: { minCgpa: 7.0, maxBacklogs: 0, branches: ["CSE"], minAttendance: 75 },
        status: "published",
        eligible_count: 1,
        created_by: tpoUserId,
        created_at: ts,
        updated_at: ts,
        latest_eligibility_version: null,
        latest_eligibility_computed_at: null,
        deleted_at: null,
      },
      {
        id: futureDriveId,
        tenant_id: tenantId,
        company: "Future Corp",
        role: "Developer",
        drive_date: plusDays(10),
        criteria: { minCgpa: 7.0, maxBacklogs: 0, branches: ["CSE"], minAttendance: 75, excludePlacedStudents: false },
        status: "published",
        eligible_count: 1,
        created_by: tpoUserId,
        created_at: ts,
        updated_at: ts,
        latest_eligibility_version: null,
        latest_eligibility_computed_at: null,
        deleted_at: null,
      },
      {
        id: strictFutureDriveId,
        tenant_id: tenantId,
        company: "Strict Future Corp",
        role: "Developer",
        drive_date: plusDays(12),
        criteria: { minCgpa: 7.0, maxBacklogs: 0, branches: ["CSE"], minAttendance: 75, excludePlacedStudents: true },
        status: "published",
        eligible_count: 1,
        created_by: tpoUserId,
        created_at: ts,
        updated_at: ts,
        latest_eligibility_version: null,
        latest_eligibility_computed_at: null,
        deleted_at: null,
      },
    ]);

    await resetPlacementState(true);
  });

  beforeEach(async () => {
    await resetPlacementState(true);
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await db.collection("announcements").deleteMany({ tenant_id: tenantId });
    await db.collection("communications").deleteMany({ tenant_id: tenantId });
    await db.collection("audit_logs").deleteMany({ tenant_id: tenantId });
    await db.collection("student_placement_history").deleteMany({ tenant_id: tenantId });
    await db.collection("student_drive_declarations").deleteMany({ tenant_id: tenantId });
    await db.collection("drive_results").deleteMany({ tenant_id: tenantId });
    await db.collection("drives").deleteMany({ tenant_id: tenantId });
    await db.collection("students").deleteMany({ tenant_id: tenantId });
    await db.collection("users").deleteMany({ tenant_id: tenantId });
    await db.collection("tenants").deleteMany({ id: tenantId });
    await closeMongoConnection();
  });

  it("writes selected outcomes to student placement summary, applies policy-based blocking, and restores eligibility after correction", async () => {
    const release = await DriveService.releaseDriveResults({
      tenantId,
      actorUserId: tpoUserId,
      actorRole: "tpo",
      driveId: selectedDriveId,
      audience: "selected",
    });

    expect(release.selectedCount).toBe(1);

    const db = await getMongoDb();
    const updatedStudent = await db.collection("students").findOne(
      { tenant_id: tenantId, id: studentId },
      { projection: { _id: 0, profile_data: 1 } },
    );
    const placementStatus = (updatedStudent?.profile_data as Record<string, unknown> | undefined)?.placementStatus as Record<string, unknown> | undefined;
    expect(placementStatus?.isPlaced).toBe(true);
    expect(placementStatus?.placedCompany).toBe("Placed Corp");
    expect(placementStatus?.placedRole).toBe("Software Engineer");
    expect(placementStatus?.sourceDriveId).toBe(selectedDriveId);

    const placementHistory = await db.collection("student_placement_history").find({ tenant_id: tenantId, student_id: studentId }).toArray();
    expect(placementHistory.length).toBeGreaterThan(0);

    const blockedByTenantPolicy = await StudentService.getDriveDeclarationPreview(tenantId, studentUserId, futureDriveId);
    expect(blockedByTenantPolicy.eligible).toBe(false);
    expect(blockedByTenantPolicy.reasons.some((reason) => reason.code === "already_placed")).toBe(true);

    await db.collection("tenants").updateOne(
      { id: tenantId },
      {
        $set: {
          "config.placementPolicy.excludePlacedStudentsByDefault": false,
          updated_at: nowIso(),
        },
      },
    );

    const allowedWhenTenantAllows = await StudentService.getDriveDeclarationPreview(tenantId, studentUserId, futureDriveId);
    expect(allowedWhenTenantAllows.eligible).toBe(true);

    const blockedByDriveOverride = await StudentService.getDriveDeclarationPreview(tenantId, studentUserId, strictFutureDriveId);
    expect(blockedByDriveOverride.eligible).toBe(false);
    expect(blockedByDriveOverride.reasons.some((reason) => reason.code === "already_placed")).toBe(true);

    const review = await StudentService.reviewPlacementStatus({
      tenantId,
      studentId,
      actorUserId: tpoUserId,
      actorRole: "tpo",
      isPlaced: false,
      reason: "Selected by mistake during verification",
    });

    expect(review.placementStatus.isPlaced).toBe(false);

    const afterCorrection = await StudentService.getDriveDeclarationPreview(tenantId, studentUserId, strictFutureDriveId);
    expect(afterCorrection.eligible).toBe(true);

    const placedOnly = await StudentService.listStudentsForTpo(tenantId, {
      limit: 50,
      isPlaced: true,
      sortBy: "created_at",
      sortDir: "desc",
    });
    expect(placedOnly.items.some((item) => item.id === studentId)).toBe(false);

    const auditRows = await db.collection("audit_logs").find({
      tenant_id: tenantId,
      event_type: "student_placement_status_reviewed",
    }).toArray();
    expect(auditRows.length).toBeGreaterThan(0);
  });

  it("surfaces placed students in placed/unplaced TPO filters after result release", async () => {
    await DriveService.releaseDriveResults({
      tenantId,
      actorUserId: tpoUserId,
      actorRole: "tpo",
      driveId: selectedDriveId,
      audience: "selected",
    });

    const placedOnly = await StudentService.listStudentsForTpo(tenantId, {
      limit: 50,
      isPlaced: true,
      sortBy: "created_at",
      sortDir: "desc",
    });
    expect(placedOnly.items.some((item) => item.id === studentId)).toBe(true);

    const unplacedOnly = await StudentService.listStudentsForTpo(tenantId, {
      limit: 50,
      isPlaced: false,
      sortBy: "created_at",
      sortDir: "desc",
    });
    expect(unplacedOnly.items.some((item) => item.id === studentId)).toBe(false);
  });

  it("publishes the result announcement only once per drive audience key", async () => {
    await DriveService.releaseDriveResults({
      tenantId,
      actorUserId: tpoUserId,
      actorRole: "tpo",
      driveId: selectedDriveId,
      audience: "selected",
    });

    await DriveService.releaseDriveResults({
      tenantId,
      actorUserId: tpoUserId,
      actorRole: "tpo",
      driveId: selectedDriveId,
      audience: "selected",
    });

    const db = await getMongoDb();
    const announcements = await db.collection("announcements").find(
      { tenant_id: tenantId, system_key: `drive-results-published:${selectedDriveId}:selected` },
      { projection: { _id: 0, system_key: 1, recipient_student_ids: 1 } },
    ).toArray();

    expect(announcements).toHaveLength(1);
    expect(announcements[0]?.recipient_student_ids).toContain(studentId);
  });
});
