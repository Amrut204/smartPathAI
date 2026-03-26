import "dotenv/config";

import crypto from "node:crypto";

import request from "supertest";
import { hash } from "bcryptjs";

import app from "../src/app.js";
import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";

function nowIso() {
  return new Date().toISOString();
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Student import async job", () => {
  const password = "Test@12345";

  const tenant = { id: crypto.randomUUID(), slug: `import-${crypto.randomUUID().slice(0, 8)}`, name: "Import Tenant" };
  const tpo = { id: crypto.randomUUID(), email: `tpo-import-${crypto.randomUUID().slice(0, 8)}@test.local` };

  let agent: ReturnType<typeof request.agent>;
  let csrfToken: string | null = null;

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
      id: tpo.id,
      tenant_id: tenant.id,
      email: tpo.email.toLowerCase(),
      role: "tpo",
      full_name: "TPO Import",
      is_active: true,
      password_hash: passwordHash,
      created_at: ts,
      updated_at: ts,
    });

    agent = request.agent(app);
    const loginResponse = await agent.post("/api/v1/auth/login").send({ email: tpo.email, password });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body?.success).toBe(true);
    csrfToken = extractCookieValue(loginResponse.headers["set-cookie"], "cdai_csrf");
  });

  afterAll(async () => {
    const db = await getMongoDb();
    await db.collection("student_import_jobs").deleteMany({ tenant_id: tenant.id });
    await db.collection("students").deleteMany({ tenant_id: tenant.id });
    await db.collection("users").deleteMany({ tenant_id: tenant.id });
    await db.collection("tenants").deleteMany({ id: tenant.id });
    await closeMongoConnection();
  });

  it("creates a job and completes it in the background", async () => {
    const payload = {
      mapping: {
        fullName: "full_name",
        email: "email",
        rollNumber: "roll_number",
        branch: "branch",
        batch: "batch",
        cgpa: "cgpa",
        backlogs: "backlogs",
        attendancePct: "attendance",
      },
      rows: [
        {
          full_name: "Student One",
          email: `student1-${crypto.randomUUID().slice(0, 8)}@test.local`,
          roll_number: "R-001",
          branch: "ME",
          batch: "2026",
          cgpa: "7.2",
          backlogs: "0",
          attendance: "80",
        },
        {
          full_name: "Student Two",
          email: `student2-${crypto.randomUUID().slice(0, 8)}@test.local`,
          roll_number: "R-002",
          branch: "ECE",
          batch: "2026",
          cgpa: "8.1",
          backlogs: "0",
          attendance: "90",
        },
      ],
    };

    const createResponse = await agent
      .post("/api/v1/students/upload/confirm-async")
      .set("x-csrf-token", String(csrfToken))
      .send(payload);
    expect(createResponse.status).toBe(202);
    expect(createResponse.body?.success).toBe(true);
    const jobId = String(createResponse.body?.data?.id ?? "");
    expect(jobId.length).toBeGreaterThan(10);

    let status = String(createResponse.body?.data?.status ?? "");
    let attempts = 0;
    let latest: any = createResponse.body?.data;

    while (status !== "completed" && status !== "failed" && attempts < 120) {
      await sleep(250);
      const poll = await agent.get(`/api/v1/students/upload/jobs/${jobId}`);
      expect(poll.status).toBe(200);
      expect(poll.body?.success).toBe(true);
      latest = poll.body?.data;
      status = String(latest?.status ?? "");
      attempts += 1;
    }

    expect(status).toBe("completed");
    expect(latest?.totals?.created).toBe(2);

    const db = await getMongoDb();
    const studentCount = await db.collection("students").countDocuments({ tenant_id: tenant.id });
    expect(studentCount).toBeGreaterThanOrEqual(2);
  }, 60000);
});
