import "dotenv/config";
import { randomUUID } from "node:crypto";

import { hash } from "bcryptjs";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";

const TENANT = {
  name: "Apex Institute of Technology",
  slug: "apex-demo",
  domain: "apex-demo.edu",
  subscription_tier: "pilot",
};

const COMPANIES = ["TCS", "Infosys", "Wipro", "Accenture"];
const STUDENT_COUNT = 24;
const TOPIC_NAMES = [
  "Aptitude & Reasoning",
  "Data Structures & Algorithms",
  "SQL & Databases",
  "Interview Preparation",
];
const BRANCHES = ["CSE", "IT", "ECE", "Mechanical"];
const FIRST_NAMES = ["Aarav", "Ananya", "Rohan", "Sneha", "Karan", "Meera", "Nikhil", "Ishita"];
const LAST_NAMES = ["Sharma", "Patel", "Reddy", "Nair", "Gupta", "Rao", "Joshi", "Roy"];

function nowIso() {
  return new Date().toISOString();
}

function pad3(value) {
  return String(value).padStart(3, "0");
}

function buildQuestions(prefix) {
  return [
    {
      text: `${prefix}: What should a student review first before a placement test?`,
      options: ["Eligibility and syllabus", "Desk wallpaper", "Phone ringtone", "Library card"],
      correctIndex: 0,
      explanation: "Students should begin with eligibility and the syllabus for targeted preparation.",
    },
    {
      text: `${prefix}: Which practice improves consistency the most?`,
      options: ["Weekly revision and mock analysis", "Random guessing", "Ignoring explanations", "Skipping mistakes"],
      correctIndex: 0,
      explanation: "Repeated practice and reviewing explanations improves consistency.",
    },
    {
      text: `${prefix}: What should be complete before a drive opens?`,
      options: ["Profile, resume, and contact details", "Browser theme", "Wallpaper", "Music playlist"],
      correctIndex: 0,
      explanation: "A complete profile and resume are essential before applying to a drive.",
    },
  ];
}

async function ensureGlobalTopics(db) {
  const now = nowIso();
  const existing = await db.collection("topics").find(
    { tenant_id: null, name: { $in: TOPIC_NAMES } },
    { projection: { _id: 0, id: 1, name: 1 } },
  ).toArray();
  const topicMap = new Map(existing.map((row) => [String(row.name), String(row.id)]));

  const missing = TOPIC_NAMES.filter((name) => !topicMap.has(name)).map((name) => ({
    id: randomUUID(),
    tenant_id: null,
    name,
    created_at: now,
    updated_at: now,
  }));

  if (missing.length > 0) {
    await db.collection("topics").insertMany(missing);
    missing.forEach((row) => topicMap.set(row.name, row.id));
  }

  return topicMap;
}

async function ensureGlobalCompanies(db) {
  const now = nowIso();
  const existing = await db.collection("companies").find(
    { tenant_id: null, name: { $in: COMPANIES } },
    { projection: { _id: 0, id: 1, name: 1 } },
  ).toArray();
  const companyMap = new Map(existing.map((row) => [String(row.name), String(row.id)]));

  const missing = COMPANIES.filter((name) => !companyMap.has(name)).map((name) => ({
    id: randomUUID(),
    tenant_id: null,
    name,
    created_at: now,
    updated_at: now,
  }));

  if (missing.length > 0) {
    await db.collection("companies").insertMany(missing);
    missing.forEach((row) => companyMap.set(row.name, row.id));
  }

  return companyMap;
}

async function seed() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const existingTenant = await db.collection("tenants").findOne(
      { slug: TENANT.slug },
      { projection: { _id: 0, id: 1, name: 1, slug: 1 } },
    );

    await ensureGlobalCompanies(db);
    const topicMap = await ensureGlobalTopics(db);

    if (existingTenant) {
      console.log(`Tenant already exists: ${existingTenant.name} (${existingTenant.id})`);
      return;
    }

    const now = nowIso();
    const tenantId = randomUUID();
    const tpoUserId = randomUUID();
    const demoPasswordHash = await hash("Demo@123", 10);
    const studentPasswordHash = await hash("Student@123", 10);

    await db.collection("tenants").insertOne({
      id: tenantId,
      name: TENANT.name,
      slug: TENANT.slug,
      domain: TENANT.domain,
      subscription_tier: TENANT.subscription_tier,
      is_active: true,
      config: {
        mode: "pilot",
        maxStudents: 500,
        emailSettings: {
          fromName: "Apex Placement Cell",
          replyToEmail: "tpo@apex-demo.edu",
        },
        adminOps: {
          integrations: {
            label: "Apex placement intake form",
            googleForm: "https://forms.google.com/apex-demo-placeholder",
            googleSheet: "https://docs.google.com/spreadsheets/d/apex-demo-placeholder",
            notes: "Placeholder integration link for Apex demo tenant.",
          },
        },
      },
      created_at: now,
      updated_at: now,
    });

    await db.collection("users").insertOne({
      id: tpoUserId,
      tenant_id: tenantId,
      email: "tpo@apex-demo.edu",
      role: "tpo",
      full_name: "Ms. Kavya Menon",
      is_active: true,
      password_hash: demoPasswordHash,
      created_at: now,
      updated_at: now,
    });

    const studentUsers = [];
    const students = [];
    for (let index = 1; index <= STUDENT_COUNT; index += 1) {
      const userId = randomUUID();
      const studentId = randomUUID();
      const branch = BRANCHES[(index - 1) % BRANCHES.length];
      const batch = index % 2 === 0 ? "2026" : "2027";
      const fullName = `${FIRST_NAMES[(index - 1) % FIRST_NAMES.length]} ${LAST_NAMES[(index - 1) % LAST_NAMES.length]}`;
      const email = `student${pad3(index)}@apex-demo.edu`;
      const cgpa = Number((6.4 + ((index * 3) % 20) / 10).toFixed(2));
      const attendance = 72 + (index % 18);
      const readiness = Math.max(48, Math.min(91, Math.round(cgpa * 9 + attendance * 0.25)));

      studentUsers.push({
        id: userId,
        tenant_id: tenantId,
        email,
        role: "student",
        full_name: fullName,
        is_active: true,
        password_hash: studentPasswordHash,
        created_at: now,
        updated_at: now,
      });

      students.push({
        id: studentId,
        tenant_id: tenantId,
        user_id: userId,
        roll_number: `APEX-${batch}-${branch}-${pad3(index)}`,
        branch,
        batch,
        cgpa,
        backlogs: index % 9 === 0 ? 1 : 0,
        backlogs_total: index % 9 === 0 ? 1 : 0,
        attendance_pct: attendance,
        skills: ["Communication", "Problem Solving", branch === "CSE" || branch === "IT" ? "Programming" : "Core Fundamentals"],
        points: readiness * 10,
        streak_current: index % 5,
        streak_longest: 4 + (index % 7),
        readiness_score: readiness,
        profile_data: {
          prn: `APRN-${batch}-${pad3(index)}`,
          degree: "B.Tech",
          currentSemester: batch === "2026" ? "8" : "6",
          totalHistoricalBacklogs: index % 9 === 0 ? 1 : 0,
          phone: `90000${String(index).padStart(5, "0")}`,
          personalEmail: `apex.personal${pad3(index)}@mail.test`,
          targetRoles: [branch === "CSE" || branch === "IT" ? "Software Engineer" : "Graduate Engineer Trainee"],
          preferredLocations: ["Pune", "Bengaluru"],
          willingToRelocate: index % 2 === 0,
          dataConsentAccepted: true,
          accuracyDeclarationAccepted: true,
        },
        created_at: now,
        updated_at: now,
      });
    }

    await db.collection("users").insertMany(studentUsers);
    await db.collection("students").insertMany(students);

    const mockTests = TOPIC_NAMES.map((topicName, index) => ({
      id: randomUUID(),
      tenant_id: tenantId,
      created_by: tpoUserId,
      title: `${topicName} Practice Set ${index + 1}`,
      topic_id: topicMap.get(topicName) ?? null,
      company_id: null,
      duration_sec: 1800,
      difficulty: index % 3 === 0 ? "easy" : index % 3 === 1 ? "medium" : "hard",
      questions: buildQuestions(topicName),
      is_active: true,
      created_at: now,
      updated_at: now,
    }));
    await db.collection("mock_tests").insertMany(mockTests);

    const resources = TOPIC_NAMES.map((topicName, index) => ({
      id: randomUUID(),
      tenant_id: tenantId,
      title: `${topicName} Resource ${index + 1}`,
      description: `Curated ${topicName.toLowerCase()} material for Apex students.`,
      url: `https://apptipreparation.s3.us-east-1.amazonaws.com/smartpathai/resources/demo/apex/${index + 1}.pdf`,
      resource_type: "pdf",
      thumbnail_url: null,
      duration_sec: 900,
      topic_id: topicMap.get(topicName) ?? null,
      source_pdf: `smartpathai/resources/demo/apex/${index + 1}.pdf`,
      is_active: true,
      created_at: now,
      updated_at: now,
    }));
    await db.collection("resources").insertMany(resources);

    await db.collection("communications").insertOne({
      id: randomUUID(),
      tenant_id: tenantId,
      sender_id: tpoUserId,
      channel: "email",
      subject: "Welcome to Apex placement preparation",
      body: "Complete your profile and attempt the first mock test this week.",
      recipients: studentUsers.slice(0, 12).map((user) => user.email),
      status: "sent",
      provider: "resend",
      provider_message_id: `seed-${randomUUID()}`,
      sent_at: now,
      metadata: { sent: 12, failed: 0, errors: [] },
      created_at: now,
      updated_at: now,
    });

    console.log(`Seeded tenant: ${TENANT.name}`);
    console.log(`Tenant slug: ${TENANT.slug}`);
    console.log("TPO login: tpo@apex-demo.edu / Demo@123");
    console.log("Student login: student001@apex-demo.edu / Student@123");
  } finally {
    await client.close();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
