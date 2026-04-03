import "dotenv/config";

import crypto from "node:crypto";

import request from "supertest";
import { hash } from "bcryptjs";

import app from "../src/app.js";
import { getMongoDb, closeMongoConnection } from "../src/utils/mongodb.js";

jest.setTimeout(120000);

function nowIso() {
  return new Date().toISOString();
}

describe("Tenant isolation", () => {
  const password = "Test@12345";

  const tenantA = { id: crypto.randomUUID(), slug: `tenant-a-${crypto.randomUUID().slice(0, 8)}`, name: "Tenant A" };
  const tenantB = { id: crypto.randomUUID(), slug: `tenant-b-${crypto.randomUUID().slice(0, 8)}`, name: "Tenant B" };

  const tpoA = { id: crypto.randomUUID(), email: `tpo-a-${crypto.randomUUID().slice(0, 8)}@test.local` };
  const tpoB = { id: crypto.randomUUID(), email: `tpo-b-${crypto.randomUUID().slice(0, 8)}@test.local` };

  const studentUserA = { id: crypto.randomUUID(), email: `student-a-${crypto.randomUUID().slice(0, 8)}@test.local` };
  const studentUserB = { id: crypto.randomUUID(), email: `student-b-${crypto.randomUUID().slice(0, 8)}@test.local` };

  const studentA = { id: crypto.randomUUID(), user_id: studentUserA.id, roll_number: "A-001", branch: "ME", batch: "2026" };
  const studentB = { id: crypto.randomUUID(), user_id: studentUserB.id, roll_number: "B-001", branch: "CSE", batch: "2026" };

  const driveA = { id: crypto.randomUUID(), company: "Alpha Corp", role: "Analyst", drive_date: "2026-04-01" };
  const driveB = { id: crypto.randomUUID(), company: "Beta Corp", role: "Engineer", drive_date: "2026-04-02" };
  const resourceA = { id: crypto.randomUUID(), title: "Tenant A Notes" };
  const resourceB = { id: crypto.randomUUID(), title: "Tenant B Notes" };
  const announcementA = { id: crypto.randomUUID(), title: "Tenant A Update" };
  const announcementB = { id: crypto.randomUUID(), title: "Tenant B Update" };

  let agentA: ReturnType<typeof request.agent>;
  let studentAgentA: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const db = await getMongoDb();
    const ts = nowIso();

    const passwordHash = await hash(password, 10);

    await db.collection("tenants").insertMany([
      { id: tenantA.id, slug: tenantA.slug, name: tenantA.name, is_active: true, created_at: ts, updated_at: ts },
      { id: tenantB.id, slug: tenantB.slug, name: tenantB.name, is_active: true, created_at: ts, updated_at: ts },
    ]);

    await db.collection("users").insertMany([
      {
        id: tpoA.id,
        tenant_id: tenantA.id,
        email: tpoA.email.toLowerCase(),
        role: "tpo",
        full_name: "TPO A",
        is_active: true,
        password_hash: passwordHash,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: tpoB.id,
        tenant_id: tenantB.id,
        email: tpoB.email.toLowerCase(),
        role: "tpo",
        full_name: "TPO B",
        is_active: true,
        password_hash: passwordHash,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: studentUserA.id,
        tenant_id: tenantA.id,
        email: studentUserA.email.toLowerCase(),
        role: "student",
        full_name: "Student A",
        is_active: true,
        password_hash: passwordHash,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: studentUserB.id,
        tenant_id: tenantB.id,
        email: studentUserB.email.toLowerCase(),
        role: "student",
        full_name: "Student B",
        is_active: true,
        password_hash: passwordHash,
        created_at: ts,
        updated_at: ts,
      },
    ]);

    await db.collection("students").insertMany([
      {
        id: studentA.id,
        tenant_id: tenantA.id,
        user_id: studentA.user_id,
        roll_number: studentA.roll_number,
        branch: studentA.branch,
        batch: studentA.batch,
        cgpa: 7.5,
        backlogs: 0,
        backlogs_total: 0,
        attendance_pct: 85,
        skills: [],
        points: 0,
        streak_current: 0,
        streak_longest: 0,
        readiness_score: 55,
        profile_data: {
          prn: "P-A-001",
          phone: "9999999991",
          personalEmail: "student-a.personal@test.local",
          resumeUrl: "https://example.com/student-a-resume.pdf",
          targetRoles: ["Analyst"],
          preferredLocations: ["Pune"],
          willingToRelocate: true,
          dataConsentAccepted: true,
          accuracyDeclarationAccepted: true,
          degree: "B.E.",
          currentSemester: "8",
        },
        created_at: ts,
        updated_at: ts,
      },
      {
        id: studentB.id,
        tenant_id: tenantB.id,
        user_id: studentB.user_id,
        roll_number: studentB.roll_number,
        branch: studentB.branch,
        batch: studentB.batch,
        cgpa: 8.2,
        backlogs: 0,
        backlogs_total: 0,
        attendance_pct: 90,
        skills: [],
        points: 0,
        streak_current: 0,
        streak_longest: 0,
        readiness_score: 70,
        profile_data: {
          prn: "P-B-001",
          phone: "9999999992",
          personalEmail: "student-b.personal@test.local",
          resumeUrl: "https://example.com/student-b-resume.pdf",
          targetRoles: ["Engineer"],
          preferredLocations: ["Bengaluru"],
          willingToRelocate: true,
          dataConsentAccepted: true,
          accuracyDeclarationAccepted: true,
          degree: "B.Tech",
          currentSemester: "8",
        },
        created_at: ts,
        updated_at: ts,
      },
    ]);

    await db.collection("drives").insertMany([
      {
        id: driveA.id,
        tenant_id: tenantA.id,
        company: driveA.company,
        role: driveA.role,
        drive_date: driveA.drive_date,
        criteria: { minCgpa: 6.0, maxBacklogs: 0, branches: [], minAttendance: 0 },
        status: "upcoming",
        eligible_count: 0,
        created_by: tpoA.id,
        created_at: ts,
        updated_at: ts,
        latest_eligibility_version: null,
        latest_eligibility_computed_at: null,
        deleted_at: null,
      },
      {
        id: driveB.id,
        tenant_id: tenantB.id,
        company: driveB.company,
        role: driveB.role,
        drive_date: driveB.drive_date,
        criteria: { minCgpa: 6.0, maxBacklogs: 0, branches: [], minAttendance: 0 },
        status: "upcoming",
        eligible_count: 0,
        created_by: tpoB.id,
        created_at: ts,
        updated_at: ts,
        latest_eligibility_version: null,
        latest_eligibility_computed_at: null,
        deleted_at: null,
      },
    ]);

    await db.collection("resources").insertMany([
      {
        id: resourceA.id,
        tenant_id: tenantA.id,
        title: resourceA.title,
        description: "Tenant A private resource",
        url: "https://example.com/tenant-a-resource.pdf",
        resource_type: "pdf",
        is_active: true,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: resourceB.id,
        tenant_id: tenantB.id,
        title: resourceB.title,
        description: "Tenant B private resource",
        url: "https://example.com/tenant-b-resource.pdf",
        resource_type: "pdf",
        is_active: true,
        created_at: ts,
        updated_at: ts,
      },
    ]);

    await db.collection("announcements").insertMany([
      {
        id: announcementA.id,
        tenant_id: tenantA.id,
        title: announcementA.title,
        message: "Tenant A only announcement",
        priority: "normal",
        status: "published",
        show_popup: false,
        recipient_student_ids: [studentA.id],
        created_at: ts,
        published_at: ts,
        expires_at: null,
      },
      {
        id: announcementB.id,
        tenant_id: tenantB.id,
        title: announcementB.title,
        message: "Tenant B only announcement",
        priority: "normal",
        status: "published",
        show_popup: false,
        recipient_student_ids: [studentB.id],
        created_at: ts,
        published_at: ts,
        expires_at: null,
      },
    ]);

    agentA = request.agent(app);
    const loginResponse = await agentA.post("/api/v1/auth/login").send({ email: tpoA.email, password });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body?.success).toBe(true);

    studentAgentA = request.agent(app);
    const studentLoginResponse = await studentAgentA.post("/api/v1/auth/login").send({ email: studentUserA.email, password });
    expect(studentLoginResponse.status).toBe(200);
    expect(studentLoginResponse.body?.success).toBe(true);
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await db.collection("announcement_reads").deleteMany({ tenant_id: { $in: [tenantA.id, tenantB.id] } });
    await db.collection("announcements").deleteMany({ tenant_id: { $in: [tenantA.id, tenantB.id] } });
    await db.collection("resources").deleteMany({ tenant_id: { $in: [tenantA.id, tenantB.id] } });
    await db.collection("drive_results").deleteMany({ tenant_id: { $in: [tenantA.id, tenantB.id] } });
    await db.collection("drives").deleteMany({ tenant_id: { $in: [tenantA.id, tenantB.id] } });
    await db.collection("students").deleteMany({ tenant_id: { $in: [tenantA.id, tenantB.id] } });
    await db.collection("users").deleteMany({ tenant_id: { $in: [tenantA.id, tenantB.id] } });
    await db.collection("tenants").deleteMany({ id: { $in: [tenantA.id, tenantB.id] } });
    await closeMongoConnection();
  });

  it("does not leak students across tenants", async () => {
    const response = await agentA.get("/api/v1/students?limit=50");
    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);

    const items = response.body?.data?.items ?? [];
    expect(Array.isArray(items)).toBe(true);
    const emails = items.map((row: { email?: unknown }) => String(row.email ?? ""));
    expect(emails.some((e: string) => e === studentUserA.email.toLowerCase())).toBe(true);
    expect(emails.some((e: string) => e === studentUserB.email.toLowerCase())).toBe(false);
  });

  it("does not allow reading drives across tenants", async () => {
    const list = await agentA.get("/api/v1/drives?limit=50");
    expect(list.status).toBe(200);
    expect(list.body?.success).toBe(true);
    const companies = (list.body?.data?.items ?? []).map((row: { company?: unknown }) => String(row.company ?? ""));
    expect(companies).toContain(driveA.company);
    expect(companies).not.toContain(driveB.company);

    const cross = await agentA.get(`/api/v1/drives/${driveB.id}`);
    expect(cross.status).toBe(404);
    expect(cross.body?.success).toBe(false);
  });

  it("does not allow reading another tenant's student record by id", async () => {
    const cross = await agentA.get(`/api/v1/students/${studentB.id}`);
    expect(cross.status === 404 || cross.status === 403).toBe(true);
  });

  it("does not allow reading another tenant's drive results", async () => {
    const cross = await agentA.get(`/api/v1/drives/${driveB.id}/results`);
    expect(cross.status === 404 || cross.status === 403).toBe(true);
  });

  it("does not allow students to read another tenant's private resource by id", async () => {
    const own = await studentAgentA.get(`/api/v1/resources/${resourceA.id}`);
    expect(own.status).toBe(200);
    expect(own.body?.success).toBe(true);

    const cross = await studentAgentA.get(`/api/v1/resources/${resourceB.id}`);
    expect(cross.status === 404 || cross.status === 403).toBe(true);
  });

  it("does not leak another tenant's announcements to students", async () => {
    const own = await studentAgentA.get("/api/v1/students/me/announcements");
    expect(own.status).toBe(200);
    expect(own.body?.success).toBe(true);
    const announcementIds = (own.body?.data ?? []).map((item: { id?: unknown }) => String(item.id ?? ""));
    expect(announcementIds).toContain(announcementA.id);
    expect(announcementIds).not.toContain(announcementB.id);
  });
});

