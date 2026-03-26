import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

import { hash } from "bcryptjs";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
const SHOULD_RESET = process.argv.includes("--reset");
const SKIP_BACKUP = process.env.SKIP_DEMO_BACKUP === "1" || process.argv.includes("--skip-backup");
const DEMO_EMAIL_DOMAIN = "stxaviers-demo.edu";
const DEMO_EMAIL_PATTERN = new RegExp(`@${DEMO_EMAIL_DOMAIN.replace(".", "\\.")}$`, "i");
const DEMO_TENANT_NAME = "St. Xavier's Institute of Technology";
const ACCEPTED_DEMO_SLUGS = ["st-xaviers-demo", "stxaviers-demo"];
const DEMO_TENANT = {
  id: randomUUID(),
  name: DEMO_TENANT_NAME,
  slug: "st-xaviers-demo",
  domain: DEMO_EMAIL_DOMAIN,
};

const BRANCHES = ["CSE", "IT", "ECE", "Mech", "Civil"];
const BATCHES = ["2025", "2026", "2027"];
const TOPICS = [
  "Aptitude & Reasoning",
  "Data Structures & Algorithms",
  "SQL & Databases",
  "Operating Systems",
  "Computer Networks",
  "OOPs",
  "DBMS",
  "Interview Preparation",
  "Resume Building",
  "Core Engineering",
];
const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Arjun", "Ishaan", "Kabir", "Rohan", "Vihaan", "Aryan", "Krishna",
  "Aditi", "Ananya", "Priya", "Sneha", "Ishita", "Riya", "Meera", "Kavya", "Pooja", "Nisha",
  "Rahul", "Karan", "Siddharth", "Nikhil", "Varun", "Harsh", "Akshay", "Manish", "Abhishek", "Yash",
];
const LAST_NAMES = [
  "Sharma", "Verma", "Patel", "Reddy", "Nair", "Iyer", "Gupta", "Mehta", "Kulkarni", "Mishra",
  "Singh", "Jain", "Rao", "Joshi", "Yadav", "Agarwal", "Menon", "Roy", "Saxena", "Kumar",
];

const DRIVE_CONFIGS = [
  { company: "TCS", role: "Digital", minCgpa: 6.0, maxBacklogs: 0, branches: ["CSE", "IT", "ECE"], minAttendance: 70, dayOffset: 5, status: "upcoming" },
  { company: "Infosys", role: "Systems Engineer", minCgpa: 6.5, maxBacklogs: 0, branches: ["CSE", "IT", "ECE"], minAttendance: 72, dayOffset: 11, status: "upcoming" },
  { company: "Wipro", role: "Project Engineer", minCgpa: 6.0, maxBacklogs: 1, branches: ["CSE", "IT", "ECE", "Mech"], minAttendance: 68, dayOffset: 18, status: "upcoming" },
  { company: "Capgemini", role: "Analyst", minCgpa: 7.0, maxBacklogs: 0, branches: ["CSE", "IT"], minAttendance: 75, dayOffset: 23, status: "active" },
  { company: "Larsen & Toubro", role: "Graduate Engineer Trainee", minCgpa: 6.2, maxBacklogs: 0, branches: ["Civil", "Mech", "ECE"], minAttendance: 70, dayOffset: 30, status: "upcoming" },
];

const TENANT_SCOPED_COLLECTIONS = [
  "students",
  "mock_tests",
  "student_attempts",
  "drives",
  "drive_results",
  "drive_eligibility_snapshots",
  "study_hours",
  "topic_mastery",
  "student_topic_progress",
  "resources",
  "resource_view_events",
  "email_templates",
  "communications",
  "tenant_analytics",
  "student_activity_events",
  "companies",
  "interview_sessions",
  "interview_feedback",
  "coding_sessions",
  "coding_challenges",
  "calendar_events",
  "campaigns",
  "recruiters",
  "billing_accounts",
  "billing_invoices",
  "wallet_transactions",
  "wallet_accounts",
  "mentorship_sessions",
  "mentorship_requests",
  "ai_conversations",
  "ai_messages",
  "career_goals",
  "resume_reviews",
  "communication_audits",
  "communication_deliveries",
];

function logStep(message) {
  console.log(message);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      // Avoid Windows shell quoting issues (e.g. `C:\Program Files\...`) by spawning directly.
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function isoDayOffset(dayOffset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

function isoDaysAgo(dayOffset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - dayOffset);
  return date.toISOString().slice(0, 10);
}

function isoTimestampDaysAgo(dayOffset, hourOffset = 10) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - dayOffset);
  date.setUTCHours(hourOffset, 0, 0, 0);
  return date.toISOString();
}

function padNumber(value) {
  return String(value).padStart(3, "0");
}

function buildQuestionSet(title) {
  return [
    {
      text: `${title}: What should a student check first before applying?`,
      options: ["Eligibility criteria", "Dress code", "LinkedIn ads", "Hostel timing"],
      correctIndex: 0,
      explanation: "Eligibility determines whether the student should apply at all.",
    },
    {
      text: `${title}: Which habit improves placement readiness most consistently?`,
      options: ["Weekly practice", "Random guessing", "Skipping mock tests", "Waiting for reminders"],
      correctIndex: 0,
      explanation: "Consistency is the main driver of placement readiness.",
    },
    {
      text: `${title}: Which item should be complete before a drive?`,
      options: ["Profile and resume", "Desktop wallpaper", "Exam timetable", "Library card"],
      correctIndex: 0,
      explanation: "The placement profile and resume are critical before the drive starts.",
    },
    {
      text: `${title}: What is the best use of mock test feedback?`,
      options: ["Identify weak areas", "Ignore the score", "Share only screenshots", "Delete the attempt"],
      correctIndex: 0,
      explanation: "Mock feedback should guide follow-up preparation.",
    },
    {
      text: `${title}: What should happen after shortlist publication?`,
      options: ["Immediate student follow-up", "Silence", "Delete the drive", "Reset all profiles"],
      correctIndex: 0,
      explanation: "Shortlist communication should be immediate and clear.",
    },
    {
      text: `${title}: What is the safest default before sitting for an assessment?`,
      options: ["Check device, network, and login access", "Open social media", "Skip instructions", "Change your email id"],
      correctIndex: 0,
      explanation: "A quick readiness check prevents avoidable attempt failures.",
    },
    {
      text: `${title}: Which action usually improves mock-test scores over time?`,
      options: ["Review explanations after each attempt", "Retake without reviewing", "Ignore weak topics", "Only check the timer"],
      correctIndex: 0,
      explanation: "Students improve faster when they review why answers were right or wrong.",
    },
    {
      text: `${title}: What should a student do if a required document is missing?`,
      options: ["Update the profile before applying", "Apply anyway", "Wait for the result", "Delete the mock test"],
      correctIndex: 0,
      explanation: "Incomplete documentation should be fixed before the application is submitted.",
    },
    {
      text: `${title}: Which behavior helps maintain trust with the placement office?`,
      options: ["Keep profile details accurate", "Enter guessed marks", "Hide backlog changes", "Reuse another student's resume"],
      correctIndex: 0,
      explanation: "Accurate profile data is essential for fair eligibility checks and employer trust.",
    },
    {
      text: `${title}: What should a student do after a poor mock-test score?`,
      options: ["Target weak topics and retry later", "Stop practicing", "Only change the test title", "Ignore the result page"],
      correctIndex: 0,
      explanation: "The best next step is focused follow-up practice on weak areas.",
    },
  ];
}

function evaluateEligibility(student, criteria) {
  const reasons = [];
  if (student.cgpa < criteria.minCgpa) reasons.push("CGPA below minimum");
  if (student.backlogs > criteria.maxBacklogs) reasons.push("Backlogs above maximum");
  if (criteria.branches.length > 0 && !criteria.branches.includes(student.branch)) reasons.push("Branch not allowed");
  if (student.attendancePct < criteria.minAttendance) reasons.push("Attendance below minimum");
  return reasons;
}

async function getExistingDemoContext(db) {
  const tenant = await db.collection("tenants").findOne(
    {
      $or: [
        { slug: { $in: ACCEPTED_DEMO_SLUGS } },
        { domain: DEMO_EMAIL_DOMAIN },
        { name: DEMO_TENANT_NAME },
      ],
    },
    { projection: { _id: 0, id: 1, slug: 1, name: 1, domain: 1 } },
  );

  const demoUserCount = await db.collection("users").countDocuments({
    email: DEMO_EMAIL_PATTERN,
  });

  return {
    tenant,
    exists: Boolean(tenant) || demoUserCount > 0,
    demoUserCount,
  };
}

async function resetDemoData(db, existingContext) {
  logStep("Resetting demo data...");

  const tenantIds = new Set();
  if (existingContext?.tenant?.id) {
    tenantIds.add(String(existingContext.tenant.id));
  }

  const demoUsers = await db.collection("users").find(
    { email: DEMO_EMAIL_PATTERN },
    { projection: { _id: 0, id: 1, tenant_id: 1 } },
  ).toArray();
  demoUsers.forEach((user) => {
    if (user?.tenant_id) {
      tenantIds.add(String(user.tenant_id));
    }
  });

  const tenantIdList = [...tenantIds];

  for (const collectionName of TENANT_SCOPED_COLLECTIONS) {
    if (tenantIdList.length === 0) {
      break;
    }
    await db.collection(collectionName).deleteMany({ tenant_id: { $in: tenantIdList } });
  }

  await db.collection("users").deleteMany({
    $or: [
      { email: DEMO_EMAIL_PATTERN },
      ...(tenantIdList.length > 0 ? [{ tenant_id: { $in: tenantIdList } }] : []),
    ],
  });

  if (tenantIdList.length > 0) {
    await db.collection("students").deleteMany({ tenant_id: { $in: tenantIdList } });
    await db.collection("tenants").deleteMany({ id: { $in: tenantIdList } });
  }

  await db.collection("tenants").deleteMany({
    $or: [
      { slug: { $in: ACCEPTED_DEMO_SLUGS } },
      { domain: DEMO_EMAIL_DOMAIN },
      { name: DEMO_TENANT_NAME },
    ],
  });
}

async function ensureTopics(db, now) {
  const existingTopics = await db.collection("topics").find(
    {
      tenant_id: null,
      name: { $in: TOPICS },
    },
    { projection: { _id: 0, id: 1, name: 1 } },
  ).toArray();

  const topicMap = new Map(existingTopics.map((topic) => [String(topic.name), String(topic.id)]));
  const missingTopics = TOPICS
    .filter((name) => !topicMap.has(name))
    .map((name) => ({
      id: randomUUID(),
      tenant_id: null,
      name,
      created_at: now,
      updated_at: now,
    }));

  if (missingTopics.length > 0) {
    await db.collection("topics").insertMany(missingTopics);
    missingTopics.forEach((topic) => topicMap.set(topic.name, topic.id));
  }

  return topicMap;
}

async function createDemoSeed(db) {
  const [demoPasswordHash, studentPasswordHash] = await Promise.all([
    hash("Demo@123", 10),
    hash("Student@123", 10),
  ]);
  const now = new Date().toISOString();

  logStep("Creating demo tenant...");
  await db.collection("tenants").insertOne({
    id: DEMO_TENANT.id,
    name: DEMO_TENANT.name,
    slug: DEMO_TENANT.slug,
    domain: DEMO_TENANT.domain,
    subscription_tier: "pilot",
    is_active: true,
    config: {
      mode: "pilot",
      maxStudents: 500,
      emailSettings: {
        fromName: "St. Xavier's Placement Cell",
        replyToEmail: "tpo@stxaviers-demo.edu",
      },
    },
    created_at: now,
    updated_at: now,
  });

  logStep("Ensuring demo topics exist...");
  const topicMap = await ensureTopics(db, now);

  const tpoUserId = randomUUID();
  const adminUserId = randomUUID();

  logStep("Creating demo accounts...");
  const users = [
    {
      id: tpoUserId,
      tenant_id: DEMO_TENANT.id,
      email: "tpo@stxaviers-demo.edu",
      role: "tpo",
      full_name: "Dr. Rajesh Kumar",
      is_active: true,
      password_hash: demoPasswordHash,
      created_at: now,
      updated_at: now,
    },
    {
      id: adminUserId,
      tenant_id: DEMO_TENANT.id,
      email: "admin@stxaviers-demo.edu",
      role: "admin",
      full_name: "Placement Admin",
      is_active: true,
      password_hash: demoPasswordHash,
      created_at: now,
      updated_at: now,
    },
  ];

  const students = [];
  const studentUsers = [];
  logStep("Creating 200 students...");
  for (let index = 1; index <= 200; index += 1) {
    const userId = randomUUID();
    const studentId = randomUUID();
    const firstName = FIRST_NAMES[(index - 1) % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(index - 1) % LAST_NAMES.length];
    const branch = BRANCHES[(index - 1) % BRANCHES.length];
    const batch = BATCHES[(index - 1) % BATCHES.length];
    const cgpa = Number((6 + ((index * 7) % 35) / 10).toFixed(2));
    const backlogs = index % 9 === 0 ? 1 : index % 23 === 0 ? 2 : 0;
    const totalHistoricalBacklogs = backlogs + (index % 11 === 0 ? 1 : 0);
    const attendancePct = 65 + (index % 31);
    const readinessScore = Math.min(94, Math.max(38, Math.round(cgpa * 9 + attendancePct * 0.3 - backlogs * 8 + (index % 12))));
    const email = `student${padNumber(index)}@stxaviers-demo.edu`;
    const hasResume = index % 6 !== 0;
    const hasSkills = index % 8 !== 0;
    const hasCompletedProfile = index % 4 !== 0;

    studentUsers.push({
      id: userId,
      tenant_id: DEMO_TENANT.id,
      email,
      role: "student",
      full_name: `${firstName} ${lastName}`,
      is_active: true,
      password_hash: studentPasswordHash,
      created_at: now,
      updated_at: now,
    });

    students.push({
      id: studentId,
      tenant_id: DEMO_TENANT.id,
      user_id: userId,
      roll_number: `SXIT-${batch}-${branch}-${padNumber(index)}`,
      branch,
      batch,
      cgpa,
      backlogs,
      backlogs_total: totalHistoricalBacklogs,
      attendance_pct: attendancePct,
      skills: hasSkills ? ["Communication", "Problem Solving", branch === "CSE" ? "DSA" : "Core Fundamentals"] : [],
      points: readinessScore * 10,
      streak_current: index % 7,
      streak_longest: 4 + (index % 15),
      readiness_score: readinessScore,
      profile_data: {
        prn: `PRN-${batch}-${padNumber(index)}`,
        totalHistoricalBacklogs,
        phone: hasCompletedProfile ? `99999${String(index).padStart(5, "0")}` : "",
        personalEmail: hasCompletedProfile ? `student.personal${padNumber(index)}@mail.test` : "",
        resumeUrl: hasResume ? `https://demo.local/resumes/${padNumber(index)}.pdf` : "",
        targetRoles: hasCompletedProfile ? [branch === "Civil" || branch === "Mech" ? "Graduate Engineer Trainee" : "Analyst"] : [],
        preferredLocations: hasCompletedProfile ? ["Pune", "Mumbai"] : [],
        willingToRelocate: hasCompletedProfile ? index % 2 === 0 : null,
        dataConsentAccepted: hasCompletedProfile,
        accuracyDeclarationAccepted: hasCompletedProfile,
        linkedIn: index % 5 === 0 ? "" : `https://linkedin.com/in/demo-${index}`,
      },
      created_at: now,
      updated_at: now,
    });
  }

  await db.collection("users").insertMany([...users, ...studentUsers]);
  await db.collection("students").insertMany(students);

  logStep("Creating demo drives...");
  const drives = DRIVE_CONFIGS.map((config) => ({
    id: randomUUID(),
    tenant_id: DEMO_TENANT.id,
    company: config.company,
    role: config.role,
    drive_date: isoDayOffset(config.dayOffset),
    criteria: {
      minCgpa: config.minCgpa,
      maxBacklogs: config.maxBacklogs,
      branches: config.branches,
      minAttendance: config.minAttendance,
    },
    status: config.status,
    eligible_count: 0,
    created_by: tpoUserId,
    created_at: now,
    updated_at: now,
    latest_eligibility_version: null,
    latest_eligibility_computed_at: null,
    deleted_at: null,
  }));

  const driveResults = [];
  for (const drive of drives) {
    let eligibleCount = 0;
    for (const student of students) {
      const reasons = evaluateEligibility(
        {
          cgpa: student.cgpa,
          backlogs: student.backlogs,
          branch: student.branch,
          attendancePct: student.attendance_pct,
        },
        drive.criteria,
      );
      if (reasons.length > 0) continue;

      eligibleCount += 1;
      driveResults.push({
        id: randomUUID(),
        tenant_id: DEMO_TENANT.id,
        drive_id: drive.id,
        student_id: student.id,
        status: "eligible",
        outcome: student.readiness_score >= 80 ? "shortlisted" : "pending",
        remarks: student.readiness_score < 60 ? "Needs more mock practice before the drive." : null,
        created_at: now,
        updated_at: now,
      });
    }
    drive.eligible_count = eligibleCount;
  }

  await db.collection("drives").insertMany(drives);
  await db.collection("drive_results").insertMany(driveResults);

  logStep("Creating 10 mock tests...");
  const mockTests = Array.from({ length: 10 }, (_, index) => {
    const topicName = TOPICS[index % TOPICS.length];
    return {
      id: randomUUID(),
      tenant_id: DEMO_TENANT.id,
      created_by: tpoUserId,
      title: `${topicName} Mock ${index + 1}`,
      topic_id: topicMap.get(topicName) ?? null,
      company_id: null,
      duration_sec: 20 * 60,
      difficulty: index % 3 === 0 ? "easy" : index % 3 === 1 ? "medium" : "hard",
      questions: buildQuestionSet(topicName),
      is_active: true,
      created_at: now,
      updated_at: now,
    };
  });
  await db.collection("mock_tests").insertMany(mockTests);

  logStep("Creating 50 resources...");
  const attempts = [];
  const studyHours = [];
  const topicMastery = [];
  const resourceEvents = [];
  const resources = Array.from({ length: 50 }, (_, index) => {
    const topicName = TOPICS[index % TOPICS.length];
    return {
      id: randomUUID(),
      tenant_id: DEMO_TENANT.id,
      title: `${topicName} Resource ${index + 1}`,
      description: `Curated ${topicName.toLowerCase()} preparation material for placement season.`,
      url: `https://demo.local/resources/${index + 1}`,
      resource_type: index % 3 === 0 ? "pdf" : "article",
      thumbnail_url: null,
      duration_sec: 900 + index * 10,
      topic_id: topicMap.get(topicName) ?? null,
      source_pdf: null,
      search_index: {
        search_text: `${topicName} placement interview practice`,
        summary_short: `Placement preparation for ${topicName}`,
        keywords: [topicName, "placement", "interview"],
        key_topics: [topicName],
      },
      is_active: true,
      created_at: now,
      updated_at: now,
    };
  });
  await db.collection("resources").insertMany(resources);

  logStep("Creating demo activity history...");
  for (let index = 0; index < students.length; index += 1) {
    const student = students[index];
    const selectedTest = mockTests[index % mockTests.length];
    const score = Math.max(38, Math.min(96, Math.round(student.readiness_score - 8 + (index % 15))));
    const attemptCount = index % 5 === 0 ? 0 : index % 4 === 0 ? 1 : 2;

    for (let attemptIndex = 0; attemptIndex < attemptCount; attemptIndex += 1) {
      const daysAgo = 2 + ((index + attemptIndex) % 70);
      const submittedAt = isoTimestampDaysAgo(daysAgo, 9 + (attemptIndex % 4));
      attempts.push({
        id: randomUUID(),
        tenant_id: DEMO_TENANT.id,
        student_id: student.id,
        test_id: selectedTest.id,
        status: "submitted",
        started_at: submittedAt,
        submitted_at: submittedAt,
        answers: [],
        score: Math.max(35, Math.min(98, score - attemptIndex * 3)),
        time_taken_sec: 980 - attemptIndex * 30,
        topic_breakdown: {
          [selectedTest.topic_id]: {
            correct: 3 + (attemptIndex % 2),
            total: 5,
          },
        },
        idempotency_key: randomUUID(),
        created_at: submittedAt,
        updated_at: submittedAt,
      });
    }

    const studySessionCount = 1 + (index % 3);
    for (let studyIndex = 0; studyIndex < studySessionCount; studyIndex += 1) {
      const topicName = TOPICS[(index + studyIndex) % TOPICS.length];
      const studyDate = isoDaysAgo((index + studyIndex) % 75);
      studyHours.push({
        id: randomUUID(),
        tenant_id: DEMO_TENANT.id,
        student_id: student.id,
        topic_id: topicMap.get(topicName) ?? null,
        study_date: studyDate,
        hours: Number((1 + ((index + studyIndex) % 4) * 0.5).toFixed(1)),
        created_at: `${studyDate}T08:00:00.000Z`,
      });
    }

    topicMastery.push({
      id: randomUUID(),
      tenant_id: DEMO_TENANT.id,
      student_id: student.id,
      topic_id: mockTests[index % mockTests.length].topic_id,
      mastery_level: Math.max(30, Math.min(92, student.readiness_score - 6)),
      total_attempts: 2,
      correct_attempts: 1 + (index % 2),
      last_assessed: isoTimestampDaysAgo(index % 30, 13),
      confidence_score: Math.max(35, Math.min(95, student.readiness_score)),
      created_at: now,
      updated_at: now,
    });

    if (index % 2 === 0) {
      const resource = resources[index % resources.length];
      const sessionId = randomUUID();
      const openedAt = isoTimestampDaysAgo(index % 21, 11);
      resourceEvents.push({
        id: randomUUID(),
        tenant_id: DEMO_TENANT.id,
        student_id: student.id,
        resource_id: resource.id,
        event_type: "open",
        session_id: sessionId,
        duration_sec: 0,
        progress_pct: 15 + (index % 70),
        page_number: 1,
        scroll_depth_pct: null,
        source_context: "resource_library",
        metadata: {
          resourceTitle: resource.title,
          resourceType: resource.resource_type,
        },
        created_at: openedAt,
        updated_at: openedAt,
      });
      resourceEvents.push({
        id: randomUUID(),
        tenant_id: DEMO_TENANT.id,
        student_id: student.id,
        resource_id: resource.id,
        event_type: "close",
        session_id: sessionId,
        duration_sec: 300 + (index % 600),
        progress_pct: 50 + (index % 40),
        page_number: 3,
        scroll_depth_pct: null,
        source_context: "resource_library",
        metadata: {
          resourceTitle: resource.title,
          resourceType: resource.resource_type,
        },
        created_at: openedAt,
        updated_at: openedAt,
      });
    }
  }

  await db.collection("student_attempts").insertMany(attempts);
  await db.collection("study_hours").insertMany(studyHours);
  await db.collection("topic_mastery").insertMany(topicMastery);
  await db.collection("resource_view_events").insertMany(resourceEvents);

  logStep("Creating communication templates and history...");
  await db.collection("email_templates").insertMany([
    {
      id: randomUUID(),
      tenant_id: null,
      name: "Drive Reminder",
      slug: "drive-reminder",
      subject: "Drive reminder for {{drive_name}}",
      body: "Dear {{student_name}}, please review your profile and be ready for {{drive_name}}.",
      is_system: true,
      created_by: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: DEMO_TENANT.id,
      name: "Complete Profile",
      slug: "complete-profile",
      subject: "Complete your placement profile",
      body: "Your TPO has requested you to complete your profile before the next drive.",
      is_system: false,
      created_by: tpoUserId,
      created_at: now,
      updated_at: now,
    },
  ]);

  await db.collection("communications").insertOne({
    id: randomUUID(),
    tenant_id: DEMO_TENANT.id,
    sender_id: tpoUserId,
    channel: "email",
    subject: "Weekly placement prep reminder",
    body: "Complete one mock test and update your profile this week.",
    recipients: studentUsers.slice(0, 40).map((user) => user.email),
    status: "sent",
    provider: "mock",
    provider_message_id: `mock-${randomUUID()}`,
    sent_at: now,
    metadata: {
      sent: 40,
      failed: 0,
      errors: [],
    },
    created_at: now,
    updated_at: now,
  });

  logStep(`Demo seed complete for ${DEMO_TENANT.name}`);
  logStep("TPO login: tpo@stxaviers-demo.edu / Demo@123");
  logStep("Student login: student001@stxaviers-demo.edu / Student@123");
}

async function seed() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    logStep("Checking for existing demo data...");
    const existingContext = await getExistingDemoContext(db);

    if (existingContext.exists && !SHOULD_RESET) {
      logStep("Demo already exists. Use --reset to recreate.");
      if (existingContext.tenant?.slug) {
        logStep(`Existing demo tenant slug: ${existingContext.tenant.slug}`);
      }
      return;
    }

    if (SHOULD_RESET) {
      if (!SKIP_BACKUP) {
        logStep("Backing up demo data before reset...");
        const backupScript = path.join(process.cwd(), "scripts", "backup-demo.mjs");
        const backupResult = await runCommand(process.execPath, [backupScript]);
        if (backupResult.code !== 0) {
          throw new Error(
            `Backup failed before reset: ${backupResult.stderr || backupResult.stdout || "unknown error"}`,
          );
        }
      }
      await resetDemoData(db, existingContext);
    }

    await createDemoSeed(db);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Demo seed failed: ${message}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    try {
      await client.close();
    } catch (closeError) {
      const message = closeError instanceof Error ? closeError.message : String(closeError);
      console.error(`Failed to close MongoDB connection: ${message}`);
      process.exitCode = 1;
    }
  }
}

await seed();
