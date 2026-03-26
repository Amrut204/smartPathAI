import "dotenv/config";

import request from "supertest";

import app from "../src/app.js";
import {
  getAccessTokenCookieName,
  getRefreshTokenCookieName,
} from "../src/utils/auth-session.js";
import { createUnsubscribeToken } from "../src/utils/unsubscribe-token.js";
import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";

type DemoContext = {
  tenantId: string;
  tenantName: string;
  studentUserId: string;
  studentId: string;
  tpoUserId: string;
  baselinePoints: number;
  baselineReadiness: number;
  baselineMockTestsTaken7d: number;
  baselineTopicMastery: { _id?: unknown } & Record<string, unknown> | null;
  demoTest: {
    id: string;
    topicId: string | null;
    questionCount: number;
  };
};

const DEMO_TENANT_SLUGS = ["st-xaviers-demo", "stxaviers-demo"];
const DEMO_TENANT_NAME = "St. Xavier's Institute of Technology";
const DEMO_TPO_EMAIL = "tpo@stxaviers-demo.edu";
const DEMO_STUDENT_EMAIL = "student001@stxaviers-demo.edu";

let demo: DemoContext;
let tpoAgent: ReturnType<typeof request.agent>;
let studentAgent: ReturnType<typeof request.agent>;
let createdAttemptId: string | null = null;
let createdAnnouncementIds: string[] = [];
let tpoCsrfToken: string | null = null;
let studentCsrfToken: string | null = null;
const originalCommRateLimit = process.env.COMM_RATE_MAX_SENDS_10M;

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

function expectSessionCookies(setCookieHeader: string | string[] | undefined) {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : typeof setCookieHeader === "string"
      ? [setCookieHeader]
      : [];

  expect(cookies.length).toBeGreaterThanOrEqual(2);
  const accessTokenName = `${getAccessTokenCookieName()}=`;
  const refreshTokenName = `${getRefreshTokenCookieName()}=`;

  expect(cookies.some((cookie) => cookie.startsWith(accessTokenName))).toBe(true);
  expect(cookies.some((cookie) => cookie.startsWith(refreshTokenName))).toBe(true);

  const sessionCookies = cookies.filter((cookie) =>
    cookie.startsWith(accessTokenName) || cookie.startsWith(refreshTokenName));

  sessionCookies.forEach((cookie) => {
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
  });
}

function expectString(value: unknown) {
  expect(typeof value).toBe("string");
  expect(String(value).trim().length).toBeGreaterThan(0);
}

function expectNumber(value: unknown) {
  expect(typeof value).toBe("number");
  expect(Number.isFinite(value)).toBe(true);
}

async function loadDemoContext(): Promise<DemoContext> {
  const db = await getMongoDb();
  const tenant = await db.collection("tenants").findOne(
    { slug: { $in: DEMO_TENANT_SLUGS } },
    { projection: { _id: 0, id: 1, name: 1 } },
  );

  if (!tenant) {
    throw new Error(`Missing demo tenant "${DEMO_TENANT_SLUGS[0]}". Run "npm run seed:demo" before "npm run test:demo".`);
  }

  if (String(tenant.name) !== DEMO_TENANT_NAME) {
    throw new Error(`Demo tenant name mismatch. Expected "${DEMO_TENANT_NAME}", got "${String(tenant.name)}".`);
  }

  const [tpoUser, studentUser, student, studentCount, driveCount, mockTestCount, resourceCount] = await Promise.all([
    db.collection("users").findOne(
      { tenant_id: tenant.id, email: DEMO_TPO_EMAIL },
      { projection: { _id: 0, id: 1 } },
    ),
    db.collection("users").findOne(
      { tenant_id: tenant.id, email: DEMO_STUDENT_EMAIL },
      { projection: { _id: 0, id: 1 } },
    ),
    db.collection("students").findOne(
      { tenant_id: tenant.id, roll_number: /^SXIT-/ },
      { projection: { _id: 0, id: 1, user_id: 1, points: 1, readiness_score: 1 } },
    ),
    db.collection("students").countDocuments({ tenant_id: tenant.id }),
    db.collection("drives").countDocuments({ tenant_id: tenant.id, deleted_at: null }),
    db.collection("mock_tests").countDocuments({ tenant_id: tenant.id, is_active: true }),
    db.collection("resources").countDocuments({ tenant_id: tenant.id, is_active: true }),
  ]);

  if (!tpoUser) {
    throw new Error(`Missing demo TPO user "${DEMO_TPO_EMAIL}". Run "npm run seed:demo" before "npm run test:demo".`);
  }

  if (!studentUser || !student) {
    throw new Error(`Missing demo student "${DEMO_STUDENT_EMAIL}". Run "npm run seed:demo" before "npm run test:demo".`);
  }

  if (studentCount !== 200) {
    throw new Error(`Demo seed integrity check failed: expected 200 students, found ${studentCount}.`);
  }

  if (driveCount < 5) {
    throw new Error(`Demo seed integrity check failed: expected at least 5 drives, found ${driveCount}.`);
  }

  if (mockTestCount < 10) {
    throw new Error(`Demo seed integrity check failed: expected at least 10 active mock tests, found ${mockTestCount}.`);
  }

  if (resourceCount < 50) {
    throw new Error(`Demo seed integrity check failed: expected at least 50 active resources, found ${resourceCount}.`);
  }

  const demoTest = await db.collection("mock_tests").findOne(
    { tenant_id: tenant.id, is_active: true },
    { projection: { _id: 0, id: 1, topic_id: 1, questions: 1 } },
  );

  if (!demoTest || !demoTest.id || !Array.isArray(demoTest.questions) || demoTest.questions.length === 0) {
    throw new Error("Demo seed integrity check failed: missing an active mock test with questions.");
  }

  await db.collection("student_attempts").deleteMany({
    tenant_id: tenant.id,
    student_id: student.id,
    test_id: demoTest.id,
    status: "pending",
  });

  // Keep demo-flow tests repeatable even if someone unsubscribed in a previous run.
  await db.collection("communication_suppressions").deleteMany({
    tenant_id: tenant.id,
    email: DEMO_STUDENT_EMAIL,
  });

  const baselineDashboard = await request(app)
    .get("/api/v1/demo/auto-login-student")
    .redirects(0);

  expect(baselineDashboard.status).toBe(302);

  const studentSessionAgent = request.agent(app);
  const loginResponse = await studentSessionAgent
    .get("/api/v1/demo/auto-login-student")
    .redirects(0);

  expect(loginResponse.status).toBe(302);

  const dashboardResponse = await studentSessionAgent
    .get("/api/v1/students/me/pilot-dashboard");

  if (dashboardResponse.status !== 200) {
    throw new Error(`Unable to load baseline pilot dashboard for seeded demo student. Received ${dashboardResponse.status}.`);
  }

  const baselineMockTestsTaken7d = Number(dashboardResponse.body?.data?.mockTestsTaken7d ?? NaN);
  if (!Number.isFinite(baselineMockTestsTaken7d)) {
    throw new Error("Demo seed integrity check failed: baseline student dashboard is missing mockTestsTaken7d.");
  }

  const baselineCgpa = Number(dashboardResponse.body?.data?.cgpa ?? NaN);
  if (!Number.isFinite(baselineCgpa) || baselineCgpa <= 0) {
    throw new Error(`Demo seed integrity check failed: baseline student dashboard returned cgpa=${String(dashboardResponse.body?.data?.cgpa)}.`);
  }

  const baselineTopicMastery = demoTest.topic_id
    ? await db.collection("topic_mastery").findOne({
        tenant_id: tenant.id,
        student_id: student.id,
        topic_id: demoTest.topic_id,
      })
    : null;

  return {
    tenantId: String(tenant.id),
    tenantName: String(tenant.name),
    studentUserId: String(studentUser.id),
    studentId: String(student.id),
    tpoUserId: String(tpoUser.id),
    baselinePoints: Number(student.points ?? 0),
    baselineReadiness: Number(student.readiness_score ?? 0),
    baselineMockTestsTaken7d,
    baselineTopicMastery: baselineTopicMastery ? { ...baselineTopicMastery } : null,
    demoTest: {
      id: String(demoTest.id),
      topicId: demoTest.topic_id ? String(demoTest.topic_id) : null,
      questionCount: demoTest.questions.length,
    },
  };
}

async function restoreDemoState() {
  if (!demo) {
    return;
  }

  const db = await getMongoDb();

  if (createdAttemptId) {
    await db.collection("student_attempts").deleteOne({
      tenant_id: demo.tenantId,
      student_id: demo.studentId,
      id: createdAttemptId,
    });

    await db.collection("student_activity_events").deleteMany({
      tenant_id: demo.tenantId,
      $or: [
        { id: `mock-start:${createdAttemptId}` },
        { id: `attempt:${createdAttemptId}` },
        { id: `attempt-improved:${createdAttemptId}` },
        { entity_id: createdAttemptId },
      ],
    });
  }

  await db.collection("students").updateOne(
    { tenant_id: demo.tenantId, id: demo.studentId },
    {
      $set: {
        points: demo.baselinePoints,
        readiness_score: demo.baselineReadiness,
      },
    },
  );

  if (demo.demoTest.topicId) {
    if (demo.baselineTopicMastery) {
      await db.collection("topic_mastery").replaceOne(
        {
          tenant_id: demo.tenantId,
          student_id: demo.studentId,
          topic_id: demo.demoTest.topicId,
        },
        demo.baselineTopicMastery,
        { upsert: true },
      );
    } else {
      await db.collection("topic_mastery").deleteMany({
        tenant_id: demo.tenantId,
        student_id: demo.studentId,
        topic_id: demo.demoTest.topicId,
      });
  }

  if (createdAnnouncementIds.length > 0) {
    await db.collection("announcements").deleteMany({
      tenant_id: demo.tenantId,
      id: { $in: createdAnnouncementIds },
    });

    await db.collection("announcement_reads").deleteMany({
      tenant_id: demo.tenantId,
      announcement_id: { $in: createdAnnouncementIds },
    });
  }
}
}

describe("7-minute demo flow", () => {
  beforeAll(async () => {
    process.env.COMM_RATE_MAX_SENDS_10M = "50";
    demo = await loadDemoContext();
    tpoAgent = request.agent(app);
    studentAgent = request.agent(app);
  });

  afterAll(async () => {
    process.env.COMM_RATE_MAX_SENDS_10M = originalCommRateLimit;
    await restoreDemoState();
    await closeMongoConnection();
  });

  it("auto-logs in the demo TPO and sets both session cookies", async () => {
    const response = await tpoAgent
      .get("/api/v1/demo/auto-login-tpo")
      .redirects(0);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/tpo/dashboard");
    expectSessionCookies(response.headers["set-cookie"]);
    tpoCsrfToken = extractCookieValue(response.headers["set-cookie"], "cdai_csrf");
    expectString(tpoCsrfToken);
  });

  it("auto-logs in the demo student and sets both session cookies", async () => {
    const response = await studentAgent
      .get("/api/v1/demo/auto-login-student")
      .redirects(0);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/dashboard");
    expectSessionCookies(response.headers["set-cookie"]);
    studentCsrfToken = extractCookieValue(response.headers["set-cookie"], "cdai_csrf");
    expectString(studentCsrfToken);
  });

  it("loads the TPO pilot dashboard with the expected seeded demo structure", async () => {
    const response = await tpoAgent.get("/api/v1/tpo/dashboard/mvp");

    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);

    const data = response.body?.data;
    expect(data).toBeDefined();

    expect(data.summary).toBeDefined();
    expect(data.readiness).toBeDefined();
    expect(Array.isArray(data.upcomingDrives)).toBe(true);
    expect(Array.isArray(data.studentsNeedingAttention)).toBe(true);

    expect(data.summary.totalStudents).toBe(200);
    expectNumber(data.summary.upcomingDrives);
    expectNumber(data.summary.eligibleStudents);
    expectNumber(data.summary.mockTestsTakenThisWeek);

    expectNumber(data.readiness.high);
    expectNumber(data.readiness.medium);
    expectNumber(data.readiness.low);

    expect(data.upcomingDrives.length).toBeGreaterThan(0);
    const drive = data.upcomingDrives[0];
    expectString(drive.driveId);
    expectString(drive.company);
    expectString(drive.role);
    expectString(drive.driveDate);
    expectNumber(drive.eligibleStudents);
    expectNumber(drive.driveRiskScore);

    expect(data.studentsNeedingAttention.length).toBeGreaterThan(0);
    const student = data.studentsNeedingAttention[0];
    expectString(student.studentId);
    expectString(student.fullName);
    expectString(student.branch);
    expectString(student.batch);
    expectNumber(student.cgpa);
    expectNumber(student.profileCompletenessPct);
    expectNumber(student.mockAttempts);
    expect(typeof student.isActive7d).toBe("boolean");
    expectString(student.nextRecommendedAction);
  });

  it("respects unsubscribe suppression for communications", async () => {
    const templatesResponse = await tpoAgent.get("/api/v1/communication/templates");
    expect(templatesResponse.status).toBe(200);
    expect(templatesResponse.body?.success).toBe(true);
    expect(Array.isArray(templatesResponse.body?.data)).toBe(true);
    expect(templatesResponse.body.data.length).toBeGreaterThan(0);

    const templateId = String(templatesResponse.body.data[0].id);
    expectString(templateId);

    const previewResponse = await tpoAgent
      .post("/api/v1/communication/preview")
      .set("x-csrf-token", String(tpoCsrfToken))
      .send({
        templateId,
        filters: {
          eligibleOnly: false,
          maxRecipients: 5,
          emails: [DEMO_STUDENT_EMAIL],
        },
      });

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body?.success).toBe(true);
    expectNumber(previewResponse.body?.data?.recipientCount);
    expect(previewResponse.body.data.recipientCount).toBe(1);
    expect(Array.isArray(previewResponse.body.data.sampleRecipients)).toBe(true);

    const token = createUnsubscribeToken({ tenantId: demo.tenantId, email: DEMO_STUDENT_EMAIL, ttlDays: 7 });
    const unsubscribeResponse = await request(app).get(`/api/v1/communication/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(unsubscribeResponse.status).toBe(200);
    expect(unsubscribeResponse.body?.success).toBe(true);

    const previewAfterUnsub = await tpoAgent
      .post("/api/v1/communication/preview")
      .set("x-csrf-token", String(tpoCsrfToken))
      .send({
        templateId,
        filters: {
          eligibleOnly: false,
          maxRecipients: 5,
          emails: [DEMO_STUDENT_EMAIL],
        },
      });

    expect(previewAfterUnsub.status).toBe(200);
    expect(previewAfterUnsub.body?.success).toBe(true);
    expect(previewAfterUnsub.body.data.recipientCount).toBe(0);

    const sendResponse = await tpoAgent
      .post("/api/v1/communication/send")
      .set("x-csrf-token", String(tpoCsrfToken))
      .send({
        templateId,
        filters: {
          eligibleOnly: false,
          maxRecipients: 5,
          emails: [DEMO_STUDENT_EMAIL],
        },
      });

    expect(sendResponse.status).toBe(400);
    expect(sendResponse.body?.success).toBe(false);
  });

  it("queues a small communication batch through the inline dispatcher", async () => {
    const db = await getMongoDb();
    const extraUsers = await db.collection("users").find(
      {
        tenant_id: demo.tenantId,
        role: "student",
        email: { $ne: DEMO_STUDENT_EMAIL },
      },
      { projection: { _id: 0, email: 1 } },
    ).limit(3).toArray();

    expect(extraUsers.length).toBe(3);
    const emails = extraUsers.map((row) => String(row.email));

    const templatesResponse = await tpoAgent.get("/api/v1/communication/templates");
    expect(templatesResponse.status).toBe(200);
    expect(templatesResponse.body?.success).toBe(true);
    const templateId = String(templatesResponse.body.data[0].id);

    const sendResponse = await tpoAgent
      .post("/api/v1/communication/send")
      .set("x-csrf-token", String(tpoCsrfToken))
      .send({
        templateId,
        filters: {
          eligibleOnly: false,
          maxRecipients: 10,
          emails,
        },
      });

    expect(sendResponse.status).toBe(200);
    expect(sendResponse.body?.success).toBe(true);
    expectString(sendResponse.body?.data?.communicationId);
    expect(sendResponse.body.data.recipientCount).toBe(3);

    const communicationId = String(sendResponse.body.data.communicationId);

    let finalStatus: string | null = null;
    for (let i = 0; i < 15; i += 1) {
      const statusResponse = await tpoAgent.get(`/api/v1/communication/${communicationId}/status`);
      expect(statusResponse.status).toBe(200);
      expect(statusResponse.body?.success).toBe(true);
      finalStatus = String(statusResponse.body?.data?.status ?? "");
      if (finalStatus && finalStatus !== "queued" && finalStatus !== "processing") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(finalStatus === "sent" || finalStatus === "partial" || finalStatus === "failed").toBe(true);
  });

  it("publishes an urgent announcement and exposes read and dismiss state to the targeted student", async () => {
    const db = await getMongoDb();
    await db.collection("communication_suppressions").deleteMany({
      tenant_id: demo.tenantId,
      email: DEMO_STUDENT_EMAIL,
    });

    const previewResponse = await tpoAgent
      .post("/api/v1/communication/announcements/preview")
      .set("x-csrf-token", String(tpoCsrfToken))
      .send({
        title: "Urgent lab shift for demo student",
        message: "Report to Lab 3 by 9:15 AM with your college ID.",
        priority: "urgent",
        filters: {
          eligibleOnly: false,
          maxRecipients: 5,
          emails: [DEMO_STUDENT_EMAIL],
        },
      });

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body?.success).toBe(true);
    expect(previewResponse.body?.data?.recipientCount).toBe(1);
    expect(previewResponse.body?.data?.preview?.showPopup).toBe(true);

    const publishResponse = await tpoAgent
      .post("/api/v1/communication/announcements")
      .set("x-csrf-token", String(tpoCsrfToken))
      .send({
        title: "Urgent lab shift for demo student",
        message: "Report to Lab 3 by 9:15 AM with your college ID.",
        priority: "urgent",
        filters: {
          eligibleOnly: false,
          maxRecipients: 5,
          emails: [DEMO_STUDENT_EMAIL],
        },
      });

    expect(publishResponse.status).toBe(201);
    expect(publishResponse.body?.success).toBe(true);
    expectString(publishResponse.body?.data?.announcementId);
    createdAnnouncementIds.push(String(publishResponse.body.data.announcementId));

    const tpoListResponse = await tpoAgent.get("/api/v1/communication/announcements?limit=10");
    expect(tpoListResponse.status).toBe(200);
    expect(tpoListResponse.body?.success).toBe(true);
    expect(Array.isArray(tpoListResponse.body?.data)).toBe(true);
    expect(tpoListResponse.body.data.some((item: { id?: string }) =>
      String(item.id) === String(publishResponse.body.data.announcementId))).toBe(true);

    const studentListResponse = await studentAgent.get("/api/v1/students/me/announcements?limit=10");
    expect(studentListResponse.status).toBe(200);
    expect(studentListResponse.body?.success).toBe(true);
    expect(Array.isArray(studentListResponse.body?.data)).toBe(true);

    const studentAnnouncement = studentListResponse.body.data.find(
      (item: { id?: string }) => String(item.id) === String(publishResponse.body.data.announcementId),
    );
    expect(studentAnnouncement).toBeDefined();
    expect(studentAnnouncement.unread).toBe(true);
    expect(studentAnnouncement.popupEligible).toBe(true);

    const dismissResponse = await studentAgent
      .post(`/api/v1/students/me/announcements/${encodeURIComponent(String(publishResponse.body.data.announcementId))}/dismiss-popup`)
      .set("x-csrf-token", String(studentCsrfToken))
      .send({});

    expect(dismissResponse.status).toBe(200);
    expect(dismissResponse.body?.success).toBe(true);

    const afterDismiss = await studentAgent.get("/api/v1/students/me/announcements?limit=10");
    const afterDismissAnnouncement = afterDismiss.body.data.find(
      (item: { id?: string }) => String(item.id) === String(publishResponse.body.data.announcementId),
    );
    expect(afterDismissAnnouncement.popupEligible).toBe(false);
    expect(afterDismissAnnouncement.unread).toBe(true);

    const readResponse = await studentAgent
      .post(`/api/v1/students/me/announcements/${encodeURIComponent(String(publishResponse.body.data.announcementId))}/read`)
      .set("x-csrf-token", String(studentCsrfToken))
      .send({});

    expect(readResponse.status).toBe(200);
    expect(readResponse.body?.success).toBe(true);

    const afterRead = await studentAgent.get("/api/v1/students/me/announcements?limit=10");
    const afterReadAnnouncement = afterRead.body.data.find(
      (item: { id?: string }) => String(item.id) === String(publishResponse.body.data.announcementId),
    );
    expect(afterReadAnnouncement.unread).toBe(false);
    expect(afterReadAnnouncement.readAt).toBeTruthy();
  });

  it("keeps saved outcomes internal until release, then exposes them to the student and supports resend", async () => {
    const db = await getMongoDb();
    let targetRow = await db.collection("drive_results").findOne(
      { tenant_id: demo.tenantId, student_id: demo.studentId },
      { projection: { _id: 1, tenant_id: 1, drive_id: 1, student_id: 1 } },
    );
    let insertedRow = false;

    if (!targetRow) {
      const fallbackDrive = await db.collection("drives").findOne(
        { tenant_id: demo.tenantId, deleted_at: null },
        { projection: { _id: 0, id: 1 } },
      );
      if (!fallbackDrive?.id) {
        throw new Error("Demo tenant has no drive to test result release.");
      }
      const now = new Date().toISOString();
      await db.collection("drive_results").insertOne({
        id: `demo-release-${Date.now()}`,
        tenant_id: demo.tenantId,
        drive_id: String(fallbackDrive.id),
        student_id: demo.studentId,
        status: "eligible",
        outcome: "pending",
        created_at: now,
        updated_at: now,
      });
      targetRow = await db.collection("drive_results").findOne(
        { tenant_id: demo.tenantId, student_id: demo.studentId, drive_id: String(fallbackDrive.id) },
        { projection: { _id: 1, tenant_id: 1, drive_id: 1, student_id: 1 } },
      );
      insertedRow = true;
    }

    if (!targetRow) {
      throw new Error("Unable to create a drive result row for the demo student.");
    }

    const originalRow = await db.collection("drive_results").findOne({
      _id: targetRow._id,
    });

    await db.collection("drive_results").updateOne(
      { _id: targetRow._id },
      {
        $set: {
          status: "applied",
          outcome: "selected",
          designation_offered: "Graduate Engineer Trainee",
          offer_date: "2026-03-21",
          final_ctc_lpa: 6.5,
          offer_letter_reference: "LNT-OFFER-001",
          offer_letter_url: "https://example.com/offer-letter.pdf",
          verification_status: "verified",
          result_released_at: null,
          result_released_by: null,
          result_notification_status: null,
          result_notification_communication_id: null,
          offer_letter_shared_at: null,
          offer_letter_shared_by: null,
        },
      },
    );

    try {
      const beforeRelease = await studentAgent.get("/api/v1/students/me/drives");
      expect(beforeRelease.status).toBe(200);
      const hiddenDrive = beforeRelease.body.data.find(
        (item: { id?: string }) => String(item.id) === String(targetRow.drive_id),
      );
      expect(hiddenDrive).toBeDefined();
      expect(hiddenDrive.myOutcome).toBe("pending");

      const previewResponse = await tpoAgent
        .post(`/api/v1/drives/${encodeURIComponent(String(targetRow.drive_id))}/results/release-preview`)
        .set("x-csrf-token", String(tpoCsrfToken))
        .send({ audience: "selected" });

      expect(previewResponse.status).toBe(200);
      expect(previewResponse.body?.success).toBe(true);
      expect(previewResponse.body?.data?.selectedCount).toBeGreaterThanOrEqual(1);
      expect(previewResponse.body?.data?.recipientCount).toBeGreaterThanOrEqual(1);

      const releaseResponse = await tpoAgent
        .post(`/api/v1/drives/${encodeURIComponent(String(targetRow.drive_id))}/results/release`)
        .set("x-csrf-token", String(tpoCsrfToken))
        .send({ audience: "selected" });

      expect(releaseResponse.status).toBe(200);
      expect(releaseResponse.body?.success).toBe(true);
      expect(releaseResponse.body?.data?.selectedCount).toBeGreaterThanOrEqual(1);

      let releaseStatusRow: Record<string, unknown> | undefined;
      for (let i = 0; i < 15; i += 1) {
        const statusResponse = await tpoAgent.get(`/api/v1/drives/${encodeURIComponent(String(targetRow.drive_id))}/results/release-status`);
        expect(statusResponse.status).toBe(200);
        expect(statusResponse.body?.success).toBe(true);
        releaseStatusRow = statusResponse.body?.data?.items?.find(
          (item: { studentId?: string }) => String(item.studentId) === demo.studentId,
        );
        if (releaseStatusRow && String(releaseStatusRow.resultNotificationStatus ?? "") !== "queued") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(releaseStatusRow).toBeDefined();
      expect(["sent", "failed", "queued"]).toContain(String(releaseStatusRow?.resultNotificationStatus ?? ""));
      expect(String(releaseStatusRow?.resultReleasedAt ?? "")).not.toBe("");

      const afterRelease = await studentAgent.get("/api/v1/students/me/drives");
      expect(afterRelease.status).toBe(200);
      const visibleDrive = afterRelease.body.data.find(
        (item: { id?: string }) => String(item.id) === String(targetRow.drive_id),
      );
      expect(visibleDrive).toBeDefined();
      expect(visibleDrive.myOutcome).toBe("selected");
      expect(visibleDrive.offerLetterUrl).toBe("https://example.com/offer-letter.pdf");

      const resendResponse = await tpoAgent
        .post(`/api/v1/drives/${encodeURIComponent(String(targetRow.drive_id))}/results/${demo.studentId}/resend-result-email`)
        .set("x-csrf-token", String(tpoCsrfToken))
        .send({});

      expect(resendResponse.status).toBe(200);
      expect(resendResponse.body?.success).toBe(true);
      expectString(resendResponse.body?.data?.communicationId);
      expect(resendResponse.body?.data?.outcome).toBe("selected");
    } finally {
      if (insertedRow) {
        await db.collection("drive_results").deleteOne({ _id: targetRow._id });
      } else if (originalRow) {
        await db.collection("drive_results").replaceOne(
          { _id: targetRow._id },
          originalRow,
          { upsert: true },
        );
      }
    }
  });

  it("returns the seeded student drives list with eligibility details", async () => {
    const response = await studentAgent.get("/api/v1/students/me/drives");

    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);
    expect(Array.isArray(response.body?.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThanOrEqual(5);

    const drive = response.body.data[0];
    expectString(drive.id);
    expectString(drive.company);
    expectString(drive.role);
    expectString(drive.driveDate);
    expectString(drive.status);
    expectNumber(drive.eligibleCount);
    expect(typeof drive.isEligible).toBe("boolean");
    expect(Array.isArray(drive.reasons)).toBe(true);
    expect(drive.criteria).toBeDefined();
    expectNumber(drive.criteria.minCgpa);
    expectNumber(drive.criteria.maxBacklogs);
    expect(Array.isArray(drive.criteria.branches)).toBe(true);
    expectNumber(drive.criteria.minAttendance);
    expectString(drive.myStatus);
    expectString(drive.myOutcome);

    expect(
      response.body.data.every((item: { isEligible?: boolean; reasons?: unknown[] }) =>
        typeof item.isEligible === "boolean" && Array.isArray(item.reasons)),
    ).toBe(true);
  });

  it("starts and submits a mock test attempt against the seeded demo test catalog", async () => {
    const startResponse = await studentAgent
      .post(`/api/v1/mock-tests/${demo.demoTest.id}/start`)
      .set("x-csrf-token", String(studentCsrfToken))
      .send({});

    expect(startResponse.status).toBe(200);
    expect(startResponse.body?.success).toBe(true);

    const startData = startResponse.body?.data;
    expectString(startData.attemptId);
    expectString(startData.startedAt);
    expectString(startData.serverTime);
    expectNumber(startData.durationSec);
    expect(Array.isArray(startData.questions)).toBe(true);
    expect(startData.questions.length).toBe(demo.demoTest.questionCount);
    expect(startData.questions[0]).toEqual(
      expect.objectContaining({
        text: expect.any(String),
        options: expect.any(Array),
      }),
    );

    createdAttemptId = String(startData.attemptId);

    const answers = startData.questions.map((_question: unknown, questionIndex: number) => ({
      questionIndex,
      selectedOption: 0,
    }));

    const submitResponse = await studentAgent
      .post(`/api/v1/mock-tests/${demo.demoTest.id}/submit`)
      .set("x-csrf-token", String(studentCsrfToken))
      .send({
        attemptId: createdAttemptId,
        idempotencyKey: `demo-flow-test-${Date.now()}`,
        answers,
      });

    expect(submitResponse.status).toBe(200);
    expect(submitResponse.body?.success).toBe(true);

    const submitData = submitResponse.body?.data;
    expectString(submitData.attemptId);
    expect(submitData.attemptId).toBe(createdAttemptId);
    expectNumber(submitData.score);
    expectNumber(submitData.timeTakenSec);
    expectNumber(submitData.pointsAwarded);
    expectNumber(submitData.readinessScore);
    expect(typeof submitData.idempotent).toBe("boolean");
    expect(submitData.idempotent).toBe(false);
    expect(typeof submitData.topicBreakdown).toBe("object");

    const resultResponse = await studentAgent.get(`/api/v1/mock-tests/attempts/${createdAttemptId}`);
    expect(resultResponse.status).toBe(200);
    expect(resultResponse.body?.success).toBe(true);
    expect(resultResponse.body?.data?.attemptId).toBe(createdAttemptId);
    expect(Array.isArray(resultResponse.body?.data?.questions)).toBe(true);
    expect(Array.isArray(resultResponse.body?.data?.answers)).toBe(true);
  });

  it("loads student dashboard metrics from the seeded demo tenant", async () => {
    const response = await studentAgent.get("/api/v1/students/me/pilot-dashboard");

    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);

    const data = response.body?.data;
    expectString(data.studentName);
    expectString(data.branch);
    expectString(data.batch);
    expectNumber(data.cgpa);
    expectNumber(data.readinessScore);
    expectNumber(data.profileCompletenessPct);
    expect(data.totalStudents).toBe(200);
    expectNumber(data.studyHours7d);
    expectNumber(data.mockTestsTaken7d);
    expectNumber(data.eligibleUpcomingDrives);
    expect(Array.isArray(data.checklist)).toBe(true);
    expect(Array.isArray(data.upcomingDrives)).toBe(true);
    expect(Array.isArray(data.recentResources)).toBe(true);

    expect(data.mockTestsTaken7d).toBeGreaterThanOrEqual(demo.baselineMockTestsTaken7d);
    if (data.checklist.length > 0) {
      expect(data.checklist[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          label: expect.any(String),
          done: expect.any(Boolean),
        }),
      );
    }
    if (data.upcomingDrives.length > 0) {
      expect(data.upcomingDrives[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          company: expect.any(String),
          role: expect.any(String),
          driveDate: expect.any(String),
          status: expect.any(String),
          eligibleCount: expect.any(Number),
          myStatus: expect.any(String),
          myOutcome: expect.any(String),
        }),
      );
    }
  });
});
