import "dotenv/config";

import crypto from "node:crypto";

import { hash } from "bcryptjs";

import { CommunicationService } from "../src/services/communication.service.js";
import { TpoAutomationService } from "../src/services/tpo-automation.service.js";
import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
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

function buildCertifiedProfileData(ts: string, rollNumber: string, resumeUrl = "https://example.com/resume.pdf") {
  return {
    prn: `PRN-${rollNumber}`,
    degree: "B.Tech",
    currentSemester: "8",
    phone: "9999999999",
    personalEmail: `${rollNumber.toLowerCase()}@personal.test.local`,
    resumeUrl,
    targetRoles: ["Software Engineer"],
    preferredLocations: ["Pune"],
    willingToRelocate: true,
    dataConsentAccepted: true,
    accuracyDeclarationAccepted: true,
    declaration: {
      onboardingAcceptedAt: ts,
      onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
      onboardingTypedValue: rollNumber,
      profileCertifiedAt: ts,
      profileCertificationVersion: STUDENT_DECLARATION_POLICY_VERSION,
      profileCertificationTypedValue: PROFILE_CERTIFICATION_TYPED_VALUE,
      profileCertificationSnapshotHash: `hash-${rollNumber}`,
      lastCertifiedProfileAt: ts,
      profileEditLockedAt: ts,
    },
  };
}

describe("TPO automation flow", () => {
  const passwordHashPromise = hash("Test@12345", 10);
  const tenantId = crypto.randomUUID();
  const tenantSlug = `tenant-auto-${tenantId.slice(0, 8)}`;
  const tpoUserId = crypto.randomUUID();
  const studentPendingUserId = crypto.randomUUID();
  const studentAppliedUserId = crypto.randomUUID();
  const studentBlockedUserId = crypto.randomUUID();
  const studentPendingId = crypto.randomUUID();
  const studentAppliedId = crypto.randomUUID();
  const studentBlockedId = crypto.randomUUID();
  const driveId = crypto.randomUUID();

  beforeAll(async () => {
    const db = await getMongoDb();
    const ts = nowIso();
    const passwordHash = await passwordHashPromise;

    await db.collection("tenants").insertOne({
      id: tenantId,
      slug: tenantSlug,
      name: "Automation Test College",
      is_active: true,
      created_at: ts,
      updated_at: ts,
    });

    await db.collection("users").insertMany([
      {
        id: tpoUserId,
        tenant_id: tenantId,
        email: `tpo-auto-${tenantId.slice(0, 6)}@test.local`,
        role: "tpo",
        full_name: "Automation TPO",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: studentPendingUserId,
        tenant_id: tenantId,
        email: `student-pending-${tenantId.slice(0, 6)}@test.local`,
        role: "student",
        full_name: "Pending Student",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: studentAppliedUserId,
        tenant_id: tenantId,
        email: `student-applied-${tenantId.slice(0, 6)}@test.local`,
        role: "student",
        full_name: "Applied Student",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: studentBlockedUserId,
        tenant_id: tenantId,
        email: `student-blocked-${tenantId.slice(0, 6)}@test.local`,
        role: "student",
        full_name: "Blocked Student",
        is_active: true,
        password_hash: passwordHash,
        must_change_password: false,
        created_at: ts,
        updated_at: ts,
      },
    ]);

    await db.collection("students").insertMany([
      {
        id: studentPendingId,
        tenant_id: tenantId,
        user_id: studentPendingUserId,
        roll_number: "AUTO-001",
        branch: "Computer Science and Technology",
        batch: "2026",
        cgpa: 8.5,
        backlogs: 0,
        backlogs_total: 0,
        attendance_pct: 90,
        skills: ["DSA", "DBMS"],
        readiness_score: 82,
        points: 0,
        streak_current: 0,
        streak_longest: 0,
        profile_data: buildCertifiedProfileData(ts, "AUTO-001"),
        created_at: ts,
        updated_at: ts,
      },
      {
        id: studentAppliedId,
        tenant_id: tenantId,
        user_id: studentAppliedUserId,
        roll_number: "AUTO-002",
        branch: "Computer Science and Technology",
        batch: "2026",
        cgpa: 8.1,
        backlogs: 0,
        backlogs_total: 0,
        attendance_pct: 89,
        skills: ["React"],
        readiness_score: 78,
        points: 0,
        streak_current: 0,
        streak_longest: 0,
        profile_data: buildCertifiedProfileData(ts, "AUTO-002"),
        created_at: ts,
        updated_at: ts,
      },
      {
        id: studentBlockedId,
        tenant_id: tenantId,
        user_id: studentBlockedUserId,
        roll_number: "AUTO-003",
        branch: "Chemical Engineering",
        batch: "2026",
        cgpa: 6.9,
        backlogs: 1,
        backlogs_total: 2,
        attendance_pct: 73,
        skills: ["Heat Transfer"],
        readiness_score: 55,
        points: 0,
        streak_current: 0,
        streak_longest: 0,
        profile_data: {
          prn: "PRN-AUTO-003",
          degree: "B.Tech",
          currentSemester: "8",
          phone: "9999999998",
          personalEmail: "auto-003@personal.test.local",
          targetRoles: ["Process Engineer"],
          preferredLocations: ["Pune"],
          willingToRelocate: true,
          dataConsentAccepted: true,
          accuracyDeclarationAccepted: true,
          declaration: {
            onboardingAcceptedAt: ts,
            onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
            onboardingTypedValue: "AUTO-003",
          },
        },
        created_at: ts,
        updated_at: ts,
      },
    ]);

    await db.collection("drives").insertOne({
      id: driveId,
      tenant_id: tenantId,
      company: "Automation Corp",
      role: "Associate Engineer",
      drive_date: plusDays(2),
      criteria: {
        minCgpa: 7,
        maxBacklogs: 1,
        branches: ["Computer Science and Technology"],
        minAttendance: 70,
      },
      status: "published",
      eligible_count: 2,
      created_by: tpoUserId,
      created_at: ts,
      updated_at: ts,
      latest_eligibility_version: null,
      latest_eligibility_computed_at: null,
      deleted_at: null,
      sector: "IT Services",
      placement_source: "on_campus",
    });
  });

  beforeEach(async () => {
    const db = await getMongoDb();
    const ts = nowIso();
    await db.collection("drive_results").deleteMany({ tenant_id: tenantId });
    await db.collection("student_attempts").deleteMany({ tenant_id: tenantId });
    await db.collection("communications").deleteMany({ tenant_id: tenantId });
    await db.collection("communication_deliveries").deleteMany({ tenant_id: tenantId });
    await db.collection("communication_audits").deleteMany({ tenant_id: tenantId });
    await db.collection("communication_suppressions").deleteMany({ tenant_id: tenantId });
    await db.collection("announcements").deleteMany({ tenant_id: tenantId });
    await db.collection("announcement_reads").deleteMany({ tenant_id: tenantId });
    await db.collection("student_activity_events").deleteMany({ tenant_id: tenantId });
    await db.collection("student_placement_history").deleteMany({ tenant_id: tenantId });
    await db.collection("tpo_automation_run_items").deleteMany({ tenant_id: tenantId });
    await db.collection("tpo_automation_runs").deleteMany({ tenant_id: tenantId });
    await db.collection("tpo_automation_preferences").deleteMany({ tenant_id: tenantId });

    await db.collection("students").updateOne(
      { tenant_id: tenantId, id: studentPendingId },
      {
        $set: {
          readiness_score: 82,
          profile_data: buildCertifiedProfileData(ts, "AUTO-001"),
          updated_at: ts,
        },
      },
    );
    await db.collection("students").updateOne(
      { tenant_id: tenantId, id: studentAppliedId },
      {
        $set: {
          readiness_score: 78,
          profile_data: buildCertifiedProfileData(ts, "AUTO-002"),
          updated_at: ts,
        },
      },
    );
    await db.collection("students").updateOne(
      { tenant_id: tenantId, id: studentBlockedId },
      {
        $set: {
          readiness_score: 55,
          profile_data: {
            prn: "PRN-AUTO-003",
            degree: "B.Tech",
            currentSemester: "8",
            phone: "9999999998",
            personalEmail: "auto-003@personal.test.local",
            targetRoles: ["Process Engineer"],
            preferredLocations: ["Pune"],
            willingToRelocate: true,
            dataConsentAccepted: true,
            accuracyDeclarationAccepted: true,
            declaration: {
              onboardingAcceptedAt: ts,
              onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION,
              onboardingTypedValue: "AUTO-003",
            },
          },
          updated_at: ts,
        },
      },
    );

    await db.collection("drive_results").insertMany([
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        drive_id: driveId,
        student_id: studentPendingId,
        status: "eligible",
        application_state: "not_applied",
        outcome: "pending",
        created_at: ts,
        updated_at: ts,
      },
      {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        drive_id: driveId,
        student_id: studentAppliedId,
        status: "eligible",
        application_state: "applied",
        outcome: "pending",
        created_at: ts,
        updated_at: ts,
      },
    ]);
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await db.collection("drive_results").deleteMany({ tenant_id: tenantId });
    await db.collection("student_attempts").deleteMany({ tenant_id: tenantId });
    await db.collection("communications").deleteMany({ tenant_id: tenantId });
    await db.collection("communication_deliveries").deleteMany({ tenant_id: tenantId });
    await db.collection("communication_audits").deleteMany({ tenant_id: tenantId });
    await db.collection("communication_suppressions").deleteMany({ tenant_id: tenantId });
    await db.collection("announcements").deleteMany({ tenant_id: tenantId });
    await db.collection("announcement_reads").deleteMany({ tenant_id: tenantId });
    await db.collection("student_activity_events").deleteMany({ tenant_id: tenantId });
    await db.collection("student_placement_history").deleteMany({ tenant_id: tenantId });
    await db.collection("tpo_automation_run_items").deleteMany({ tenant_id: tenantId });
    await db.collection("tpo_automation_runs").deleteMany({ tenant_id: tenantId });
    await db.collection("tpo_automation_preferences").deleteMany({ tenant_id: tenantId });
    await db.collection("drives").deleteMany({ tenant_id: tenantId });
    await db.collection("students").deleteMany({ tenant_id: tenantId });
    await db.collection("users").deleteMany({ tenant_id: tenantId });
    await db.collection("tenants").deleteMany({ id: tenantId });
    await closeMongoConnection();
  });

  it("creates an eligible-but-not-applied draft only for truly pending eligible students", async () => {
    const runs = await TpoAutomationService.runNow({
      tenantId,
      actorUserId: tpoUserId,
      automationType: "eligible_not_applied",
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.automationType).toBe("eligible_not_applied");
    expect(runs[0]?.status).toBe("draft");
    expect(runs[0]?.counts.candidateCount).toBe(1);
    expect(runs[0]?.filters.studentIds).toEqual([studentPendingId]);
    expect(runs[0]?.items).toHaveLength(1);
    expect(runs[0]?.items[0]?.entityId).toBe(studentPendingId);
    expect(runs[0]?.items[0]?.reasonKey).toBe("ready_to_apply");
  });

  it("keeps eligible reminder runs idempotent within the same date bucket", async () => {
    const firstRuns = await TpoAutomationService.runNow({
      tenantId,
      actorUserId: tpoUserId,
      automationType: "eligible_not_applied",
    });
    const secondRuns = await TpoAutomationService.runNow({
      tenantId,
      actorUserId: tpoUserId,
      automationType: "eligible_not_applied",
    });

    expect(firstRuns).toHaveLength(1);
    expect(secondRuns).toHaveLength(1);
    expect(secondRuns[0]?.id).toBe(firstRuns[0]?.id);

    const db = await getMongoDb();
    const runCount = await db.collection("tpo_automation_runs").countDocuments({
      tenant_id: tenantId,
      automation_type: "eligible_not_applied",
    });
    expect(runCount).toBe(1);
  });

  it("creates blocked-profile drafts with clear blocker reasons", async () => {
    const runs = await TpoAutomationService.runNow({
      tenantId,
      actorUserId: tpoUserId,
      automationType: "blocked_profile_followup",
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.automationType).toBe("blocked_profile_followup");
    expect(Number(runs[0]?.counts.candidateCount ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(runs[0]?.counts.missingResume ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(runs[0]?.counts.uncertified ?? 0)).toBeGreaterThanOrEqual(1);
    const blockedStudentItem = runs[0]?.items.find((item) => item.entityId === studentBlockedId);
    expect(blockedStudentItem?.reasonKey).toBe("missing_resume");
  });

  it("releases email automation runs exactly once and keeps the linked communication", async () => {
    const sendBulkSpy = jest.spyOn(CommunicationService, "sendBulk").mockResolvedValue({
      communicationId: "comm-auto-001",
      status: "queued",
      totalRecipients: 1,
    } as never);

    try {
      const runs = await TpoAutomationService.runNow({
        tenantId,
        actorUserId: tpoUserId,
        automationType: "eligible_not_applied",
      });
      const runId = String(runs[0]?.id);

      const released = await TpoAutomationService.releaseRun({
        tenantId,
        runId,
        actorUserId: tpoUserId,
      });

      expect(sendBulkSpy).toHaveBeenCalledTimes(1);
      expect(released.linkedCommunicationId).toBe("comm-auto-001");
      expect(released.status).toBe("sent");

      const releasedAgain = await TpoAutomationService.releaseRun({
        tenantId,
        runId,
        actorUserId: tpoUserId,
      });

      expect(sendBulkSpy).toHaveBeenCalledTimes(1);
      expect(releasedAgain.linkedCommunicationId).toBe("comm-auto-001");
      expect(releasedAgain.status).toBe("sent");
    } finally {
      sendBulkSpy.mockRestore();
    }
  });

  it("creates scheduled report pack metadata with downloadable report items", async () => {
    const runs = await TpoAutomationService.runNow({
      tenantId,
      actorUserId: tpoUserId,
      automationType: "scheduled_report_pack",
      frequency: "weekly",
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.automationType).toBe("scheduled_report_pack");
    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.counts.reportCount).toBe(4);
    expect(runs[0]?.items).toHaveLength(4);
    expect(runs[0]?.items.every((item) => item.payload?.reportType)).toBe(true);
  });
});
