import "dotenv/config";

import crypto from "node:crypto";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import { AdminOpsService } from "../src/services/admin-ops.service.js";
import { MockTestService } from "../src/services/mock-test.service.js";

jest.setTimeout(120000);

function nowIso() {
  return new Date().toISOString();
}

function buildImportedRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    text: `Question ${index + 1}`,
    option_1: "Alpha",
    option_2: "Beta",
    option_3: "Gamma",
    option_4: "Delta",
    correct_index: "2",
    explanation: `Explanation ${index + 1}`,
    skill_tag: "Aptitude",
  }));
}

describe("Admin mock test targeting and import", () => {
  const tenantId = crypto.randomUUID();
  const now = nowIso();
  const adminUserId = crypto.randomUUID();
  const matchingUserId = crypto.randomUUID();
  const blockedUserId = crypto.randomUUID();
  const matchingStudentId = crypto.randomUUID();
  const blockedStudentId = crypto.randomUUID();

  beforeAll(async () => {
    const db = await getMongoDb();

    await db.collection("tenants").insertOne({
      id: tenantId,
      slug: `mock-targeting-${crypto.randomUUID().slice(0, 8)}`,
      name: "Mock Targeting College",
      is_active: true,
      config: {
        branches: ["CSE", "ME"],
      },
      created_at: now,
      updated_at: now,
    });

    await db.collection("users").insertMany([
      {
        id: matchingUserId,
        tenant_id: tenantId,
        email: `student-match-${crypto.randomUUID().slice(0, 8)}@test.local`,
        role: "student",
        full_name: "Matching Student",
        is_active: true,
        password_hash: "not-used-in-service-test",
        created_at: now,
        updated_at: now,
      },
      {
        id: blockedUserId,
        tenant_id: tenantId,
        email: `student-blocked-${crypto.randomUUID().slice(0, 8)}@test.local`,
        role: "student",
        full_name: "Blocked Student",
        is_active: true,
        password_hash: "not-used-in-service-test",
        created_at: now,
        updated_at: now,
      },
    ]);

    await db.collection("students").insertMany([
      {
        id: matchingStudentId,
        tenant_id: tenantId,
        user_id: matchingUserId,
        roll_number: "CSE-001",
        branch: "CSE",
        batch: "2026",
        cgpa: 8.1,
        backlogs: 0,
        backlogs_total: 0,
        attendance_pct: 86,
        skills: [],
        points: 0,
        streak_current: 0,
        streak_longest: 0,
        readiness_score: 62,
        profile_data: {
          prn: "PRN-CSE-001",
          phone: "9999999991",
          personalEmail: "matching.personal@test.local",
          resumeUrl: "https://example.com/resume-cse.pdf",
          targetRoles: ["Analyst"],
          preferredLocations: ["Pune"],
          willingToRelocate: true,
          dataConsentAccepted: true,
          accuracyDeclarationAccepted: true,
          degree: "B.Tech",
          currentSemester: "8",
        },
        created_at: now,
        updated_at: now,
      },
      {
        id: blockedStudentId,
        tenant_id: tenantId,
        user_id: blockedUserId,
        roll_number: "ME-001",
        branch: "ME",
        batch: "2027",
        cgpa: 7.4,
        backlogs: 0,
        backlogs_total: 0,
        attendance_pct: 83,
        skills: [],
        points: 0,
        streak_current: 0,
        streak_longest: 0,
        readiness_score: 58,
        profile_data: {
          prn: "PRN-ME-001",
          phone: "9999999992",
          personalEmail: "blocked.personal@test.local",
          resumeUrl: "https://example.com/resume-me.pdf",
          targetRoles: ["Engineer"],
          preferredLocations: ["Mumbai"],
          willingToRelocate: true,
          dataConsentAccepted: true,
          accuracyDeclarationAccepted: true,
          degree: "B.E.",
          currentSemester: "8",
        },
        created_at: now,
        updated_at: now,
      },
    ]);
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await Promise.all([
      db.collection("student_activity_events").deleteMany({ tenant_id: tenantId }),
      db.collection("student_attempts").deleteMany({ tenant_id: tenantId }),
      db.collection("mock_tests").deleteMany({ tenant_id: tenantId }),
      db.collection("students").deleteMany({ tenant_id: tenantId }),
      db.collection("users").deleteMany({ tenant_id: tenantId }),
      db.collection("tenants").deleteMany({ id: tenantId }),
    ]);
    await closeMongoConnection();
  });

  it("previews question-sheet imports with row-level validation", async () => {
    const preview = await AdminOpsService.previewMockQuestionImport([
      buildImportedRows(1)[0],
      {
        text: "Broken row",
        option_1: "Only one",
        option_2: "",
        option_3: "",
        option_4: "",
        correct_index: "4",
      },
    ]);

    expect(preview.totalRows).toBe(2);
    expect(preview.validRows).toBe(1);
    expect(preview.rejectedRows).toBe(1);
    expect(preview.questions[0]?.correctIndex).toBe(1);
    expect(preview.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 3,
          message: expect.stringContaining("option_2"),
        }),
      ]),
    );
  });

  it("stores audience rules and hides filtered tests from non-matching students", async () => {
    const created = await AdminOpsService.createMockTestFromImportedRows({
      tenantId,
      actorUserId: adminUserId,
      title: "CSE 2026 placement mock",
      durationSec: 3600,
      difficulty: "medium",
      isActive: true,
      audienceMode: "filtered",
      audienceBranches: ["CSE"],
      audienceBatches: ["2026"],
      rows: buildImportedRows(10),
    });

    expect(created.audienceMode).toBe("filtered");
    expect(created.audienceBranches).toEqual(["CSE"]);
    expect(created.audienceBatches).toEqual(["2026"]);
    expect(created.audienceSummary).toBe("CSE | 2026");

    const matchingList = await MockTestService.listTests({
      tenantId,
      userId: matchingUserId,
      role: "student",
      limit: 20,
    });
    const blockedList = await MockTestService.listTests({
      tenantId,
      userId: blockedUserId,
      role: "student",
      limit: 20,
    });

    expect(matchingList.items.some((item) => item.id === created.id)).toBe(true);
    expect(blockedList.items.some((item) => item.id === created.id)).toBe(false);

    await expect(
      MockTestService.getTestMetadata(tenantId, created.id, "student", blockedUserId),
    ).rejects.toMatchObject({ code: "TEST_NOT_FOUND" });

    const started = await MockTestService.startAttempt(tenantId, matchingUserId, created.id);
    expect(started.attemptId).toBeTruthy();

    await expect(
      MockTestService.startAttempt(tenantId, blockedUserId, created.id),
    ).rejects.toMatchObject({ code: "TEST_NOT_FOUND" });
  });

  it("keeps all-students tenant mocks visible regardless of branch and batch", async () => {
    const created = await AdminOpsService.createMockTest({
      tenantId,
      actorUserId: adminUserId,
      title: "Common aptitude mock",
      durationSec: 3600,
      difficulty: "easy",
      isActive: true,
      audienceMode: "all",
      audienceBranches: [],
      audienceBatches: [],
      questions: buildImportedRows(10).map((row) => ({
        text: row.text,
        options: [row.option_1, row.option_2, row.option_3, row.option_4],
        correctIndex: 1,
        explanation: row.explanation,
        skillTag: row.skill_tag,
      })),
    });

    const matchingList = await MockTestService.listTests({
      tenantId,
      userId: matchingUserId,
      role: "student",
      limit: 20,
    });
    const blockedList = await MockTestService.listTests({
      tenantId,
      userId: blockedUserId,
      role: "student",
      limit: 20,
    });

    expect(matchingList.items.some((item) => item.id === created.id)).toBe(true);
    expect(blockedList.items.some((item) => item.id === created.id)).toBe(true);
  });
});
