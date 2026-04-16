import "dotenv/config";
import { randomUUID } from "node:crypto";

import { hash } from "bcryptjs";
import { MongoClient } from "mongodb";

import {
  STUDENT_DECLARATION_POLICY_VERSION,
  PROFILE_CERTIFICATION_TYPED_VALUE,
  buildDeclarationProfileDataPatch,
  buildProfileCertificationPreview,
} from "../src/utils/student-declaration.js";

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
const TPO_EMAIL = "chetanawati@gmail.com";
const TPO_FULL_NAME = "Chetan Awati";
const TPO_PASSWORD = "Demo@123";
const STUDENT_PASSWORD = "Student@123";
const TENANT_NAME = "School of Engineering and Technology Shivaji University Kolhapur";
const TENANT_SLUG = "school-of-engineering-and-technology-shivaji-university-kolhapur";
const TENANT_DOMAIN = `${TENANT_SLUG}.local`;
const BATCH = "2026";
const DEGREE = "B.Tech";
const SEMESTER = "8";
const ACADEMIC_YEAR = "2025-2026";

const BRANCHES = [
  "Computer Science and Technology",
  "Food Technology",
  "Cicvil Engineering",
  "Chemical Engineering",
  "Electronics and Telecommunication",
] as const;

const BRANCH_CONFIG: Record<(typeof BRANCHES)[number], {
  shortCode: string;
  targetRoles: string[];
  preferredLocations: string[];
  defaultSkills: string[];
  coreTopics: string[];
}> = {
  "Computer Science and Technology": {
    shortCode: "CST",
    targetRoles: ["Associate Software Engineer", "Programmer Analyst"],
    preferredLocations: ["Pune", "Bengaluru", "Hyderabad"],
    defaultSkills: ["DSA", "DBMS", "OOPs", "Aptitude"],
    coreTopics: ["Data Structures & Algorithms", "DBMS", "Operating Systems", "Computer Networks"],
  },
  "Food Technology": {
    shortCode: "FT",
    targetRoles: ["QA Trainee", "Production Trainee"],
    preferredLocations: ["Kolhapur", "Pune", "Mumbai"],
    defaultSkills: ["Food Safety", "Quality Assurance", "Communication"],
    coreTopics: ["Food Process Engineering", "Food Chemistry", "Quality Assurance", "Microbiology for Food"],
  },
  "Cicvil Engineering": {
    shortCode: "CE",
    targetRoles: ["Site Engineer", "Planning Engineer"],
    preferredLocations: ["Kolhapur", "Pune", "Navi Mumbai"],
    defaultSkills: ["Surveying", "Structural Basics", "AutoCAD"],
    coreTopics: ["Structural Analysis", "Surveying", "Construction Management", "Building Materials"],
  },
  "Chemical Engineering": {
    shortCode: "CHE",
    targetRoles: ["Process Engineer", "Production Engineer"],
    preferredLocations: ["Pune", "Mumbai", "Vadodara"],
    defaultSkills: ["Process Calculations", "Heat Transfer", "MS Excel"],
    coreTopics: ["Chemical Process Calculations", "Heat Transfer", "Mass Transfer", "Process Control"],
  },
  "Electronics and Telecommunication": {
    shortCode: "ETC",
    targetRoles: ["Network Associate", "Embedded Engineer"],
    preferredLocations: ["Pune", "Bengaluru", "Noida"],
    defaultSkills: ["Digital Electronics", "Signals", "Communication Systems"],
    coreTopics: ["Digital Electronics", "Communication Systems", "Embedded Systems", "Signals & Systems"],
  },
};

const TOPIC_NAMES = [
  "Aptitude & Reasoning", "Interview Preparation", "Resume Building", "Communication Skills",
  "Data Structures & Algorithms", "DBMS", "Operating Systems", "Computer Networks",
  "Food Process Engineering", "Food Chemistry", "Quality Assurance", "Microbiology for Food",
  "Structural Analysis", "Surveying", "Construction Management", "Building Materials",
  "Chemical Process Calculations", "Heat Transfer", "Mass Transfer", "Process Control",
  "Digital Electronics", "Communication Systems", "Embedded Systems", "Signals & Systems",
] as const;

const FIRST_NAMES = ["Aarav", "Aditi", "Ananya", "Arjun", "Atharva", "Bhakti", "Chinmay", "Devanshi", "Gauri", "Harsh", "Ishika", "Jay", "Kavya", "Mihir", "Neha", "Omkar", "Pranali", "Rohit", "Saanvi", "Tanmay", "Ujwal", "Vaishnavi", "Yash", "Zara", "Adwait", "Bhavana", "Chetna", "Dhanashree", "Eshan", "Falguni"] as const;
const LAST_NAMES = ["Patil", "Jadhav", "Kulkarni", "Shinde", "Pawar", "Kadam", "Deshmukh", "Mane", "More", "Joshi", "Khot", "Chavan", "Raut", "Nalawade", "Bhosale", "Kale", "Yadav", "Magdum", "Gurav", "Salunkhe"] as const;

const TENANT_SCOPED_COLLECTIONS = [
  "students", "mock_tests", "student_attempts", "drives", "drive_results", "drive_eligibility_snapshots", "study_hours", "topic_mastery", "student_topic_progress", "resources", "shared_resources", "resource_view_events", "email_templates", "communications", "communication_deliveries", "communication_audits", "communication_suppressions", "tenant_analytics", "student_activity_events", "companies", "interview_sessions", "interview_feedback", "coding_profiles", "coding_sessions", "coding_challenges", "achievement_wallet", "mentorship_matches", "ai_conversations", "ai_messages", "career_goals", "resume_reviews", "announcements", "announcement_reads", "profile_unlock_requests", "student_support_requests", "support_sessions", "student_placement_history", "student_drive_declarations", "student_announcement_states", "student_ai_usage", "student_ai_conversations", "student_achievements", "student_coding_profiles", "student_interview_sessions", "student_weekly_goals", "points_ledger", "student_progress", "student_risk_assessments",
  "annual_report_register_entries",
] as const;

const DRIVE_DEFINITIONS = [
  { company: "Persistent Systems", role: "Associate Software Engineer", branches: ["Computer Science and Technology"], status: "completed", driveDate: "2026-02-12", visitDate: "2026-02-10", sector: "IT Services", minCgpa: 5.8, maxBacklogs: 3, minAttendance: 60, ctcMin: 4.5, ctcMax: 6.5, ctcFinal: 6.2, location: "Pune", mode: "On campus", dressCode: "Formal", mouStatus: "signed", rounds: ["Aptitude", "Technical Interview", "HR Interview"], reportingNotes: "Strong hiring interest for software engineering roles.", registrationInstructions: "Carry college ID, updated resume, and laptop for the coding round.", requiredDocuments: ["Resume", "College ID", "Marksheets"], quota: { selected: 8, shortlisted: 10 } },
  { company: "Infosys", role: "Systems Engineer", branches: ["Computer Science and Technology", "Electronics and Telecommunication"], status: "completed", driveDate: "2026-02-26", visitDate: "2026-02-24", sector: "IT Services", minCgpa: 6.0, maxBacklogs: 3, minAttendance: 60, ctcMin: 3.8, ctcMax: 5.2, ctcFinal: 5.0, location: "Pune", mode: "On campus", dressCode: "Formal", mouStatus: "signed", rounds: ["Aptitude", "Technical Interview", "Managerial Interview"], reportingNotes: "Large intake and fast result turnaround.", registrationInstructions: "Complete profile certification before the written round.", requiredDocuments: ["Resume", "ID Card", "Photograph"], quota: { selected: 12, shortlisted: 16 } },
  { company: "Larsen & Toubro", role: "Graduate Engineer Trainee", branches: ["Cicvil Engineering", "Chemical Engineering"], status: "completed", driveDate: "2026-03-07", visitDate: "2026-03-05", sector: "Engineering & Infrastructure", minCgpa: 5.8, maxBacklogs: 3, minAttendance: 60, ctcMin: 4.2, ctcMax: 6.0, ctcFinal: 5.8, location: "Mumbai", mode: "On campus", dressCode: "Formal + Safety Shoes", mouStatus: "renewed", rounds: ["Technical Test", "Technical Interview", "HR Interview"], reportingNotes: "Preferred candidates with strong site-readiness and process basics.", registrationInstructions: "Bring domain project summary and resume snapshot.", requiredDocuments: ["Resume", "ID Card", "Project Summary"], quota: { selected: 10, shortlisted: 14 } },
  { company: "Britannia Industries", role: "QA Trainee", branches: ["Food Technology"], status: "completed", driveDate: "2026-03-16", visitDate: "2026-03-14", sector: "Food Processing", minCgpa: 5.8, maxBacklogs: 3, minAttendance: 60, ctcMin: 3.6, ctcMax: 4.8, ctcFinal: 4.5, location: "Kolhapur", mode: "On campus", dressCode: "Formal", mouStatus: "signed", rounds: ["QA Test", "Technical Interview", "HR Interview"], reportingNotes: "Focus on QA readiness and hygiene compliance awareness.", registrationInstructions: "Upload updated resume and food safety certifications before the drive.", requiredDocuments: ["Resume", "Certificates", "ID Card"], quota: { selected: 7, shortlisted: 10 } },
  { company: "Tata Consultancy Services", role: "Graduate Trainee", branches: [...BRANCHES], status: "results_pending", driveDate: "2026-04-18", visitDate: "2026-04-16", sector: "IT Services", minCgpa: 6.0, maxBacklogs: 2, minAttendance: 65, ctcMin: 3.5, ctcMax: 4.6, ctcFinal: 4.2, location: "Pune", mode: "Hybrid", dressCode: "Formal", mouStatus: "in_discussion", rounds: ["Aptitude", "Coding", "Communication Round"], reportingNotes: "Good benchmark drive for broad placement participation.", registrationInstructions: "Eligible students should confirm availability before 5 PM.", requiredDocuments: ["Resume", "ID Card", "Passport Photo"] },
  { company: "Tata Chemicals", role: "Process Engineer Trainee", branches: ["Food Technology", "Chemical Engineering"], status: "in_process", driveDate: "2026-04-23", visitDate: "2026-04-22", sector: "Chemical Manufacturing", minCgpa: 6.1, maxBacklogs: 2, minAttendance: 68, ctcMin: 4.0, ctcMax: 5.4, ctcFinal: 5.0, location: "Mithapur", mode: "On campus", dressCode: "Formal", mouStatus: "signed", rounds: ["Domain Test", "Technical Interview", "Panel Interview"], reportingNotes: "Students are currently in the panel interview stage.", registrationInstructions: "Panel interview shortlist will be published on Smart Path.", requiredDocuments: ["Resume", "Marksheets", "ID Card"] },
  { company: "Jio Platforms", role: "Network Associate", branches: ["Electronics and Telecommunication"], status: "published", driveDate: "2026-05-04", visitDate: "2026-05-02", sector: "Telecom", minCgpa: 6.2, maxBacklogs: 1, minAttendance: 70, ctcMin: 4.2, ctcMax: 5.8, ctcFinal: 5.3, location: "Mumbai", mode: "On campus", dressCode: "Formal", mouStatus: "prospect", rounds: ["Aptitude", "Technical Interview"], reportingNotes: "Telecom operations role with strong growth potential.", registrationInstructions: "Students should confirm telecom/networking interest in profile.", requiredDocuments: ["Resume", "ID Card"] },
  { company: "Cognizant", role: "Programmer Analyst", branches: ["Computer Science and Technology"], status: "published", driveDate: "2026-05-11", visitDate: "2026-05-09", sector: "IT Services", minCgpa: 6.3, maxBacklogs: 1, minAttendance: 70, ctcMin: 4.0, ctcMax: 5.5, ctcFinal: 5.1, location: "Pune", mode: "Hybrid", dressCode: "Formal", mouStatus: "signed", rounds: ["Coding", "Technical Interview", "HR Interview"], reportingNotes: "Students with coding momentum are strong fits.", registrationInstructions: "Complete the coding readiness checklist before applying.", requiredDocuments: ["Resume", "ID Card", "Laptop"] },
  { company: "Shapoorji Pallonji", role: "Site Engineer Trainee", branches: ["Cicvil Engineering"], status: "published", driveDate: "2026-05-19", visitDate: "2026-05-17", sector: "Infrastructure", minCgpa: 6.0, maxBacklogs: 2, minAttendance: 68, ctcMin: 4.1, ctcMax: 5.6, ctcFinal: 5.0, location: "Pune", mode: "On campus", dressCode: "Formal", mouStatus: "prospect", rounds: ["Domain Test", "Technical Interview"], reportingNotes: "Prefers students with project execution exposure.", registrationInstructions: "Bring project drawings and internship summary if available.", requiredDocuments: ["Resume", "Project Summary", "ID Card"] },
] as const;

function logStep(message: string) { console.log(message); }
function normalizeSlug(value: string) { return String(value).trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-"); }
function isoAt(date: string, hour = 10, minute = 0) { return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`; }
function minusDays(date: string, days: number) { const d = new Date(`${date}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); }
function plusDays(date: string, days: number) { const d = new Date(`${date}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function clamp(value: number, min: number, max: number) { return Math.min(Math.max(value, min), max); }
function pad3(value: number) { return String(value).padStart(3, "0"); }
function branchKey(branch: (typeof BRANCHES)[number]) { return BRANCH_CONFIG[branch].shortCode; }
function buildQuestions(title: string) { return Array.from({ length: 10 }, (_, index) => ({ text: `${title}: Question ${index + 1}`, options: [`Correct approach for ${title}`, `Distractor 1 for ${title}`, `Distractor 2 for ${title}`, `Distractor 3 for ${title}`], correctIndex: 0, explanation: `The first option reflects the intended concept for ${title}.` })); }
function studentName(globalIndex: number) { return `${FIRST_NAMES[(globalIndex * 3) % FIRST_NAMES.length]} ${LAST_NAMES[(globalIndex * 7) % LAST_NAMES.length]}`; }
function buildTier(branchIndex: number) { if (branchIndex < 10) return "high" as const; if (branchIndex < 30) return "medium" as const; return "low" as const; }
function buildStudentMetrics(branchIndex: number) { const tier = buildTier(branchIndex); if (tier === "high") return { tier, cgpa: Number((8.1 + (branchIndex % 5) * 0.22).toFixed(2)), attendancePct: 84 + (branchIndex % 10), backlogs: 0, totalHistoricalBacklogs: branchIndex % 4 === 0 ? 1 : 0, readinessScore: 76 + (branchIndex % 18) }; if (tier === "medium") return { tier, cgpa: Number((6.7 + (branchIndex % 8) * 0.16).toFixed(2)), attendancePct: 72 + (branchIndex % 14), backlogs: branchIndex % 6 === 0 ? 1 : 0, totalHistoricalBacklogs: 1 + (branchIndex % 3), readinessScore: 58 + (branchIndex % 16) }; return { tier, cgpa: Number((5.9 + (branchIndex % 6) * 0.13).toFixed(2)), attendancePct: 63 + (branchIndex % 12), backlogs: branchIndex % 3 === 0 ? 2 : 1, totalHistoricalBacklogs: 2 + (branchIndex % 3), readinessScore: 42 + (branchIndex % 12) }; }
function buildProfileData(student: { globalIndex: number; branch: (typeof BRANCHES)[number]; fullName: string; email: string; rollNumber: string; prn: string; cgpa: number; backlogs: number; totalHistoricalBacklogs: number; attendancePct: number; }) {
  const branchInfo = BRANCH_CONFIG[student.branch];
  const resumeId = `${branchInfo.shortCode.toLowerCase()}-resume-${pad3(student.globalIndex + 1)}`;
  const resumeLink = `https://drive.google.com/file/d/${resumeId}/view`;
  const base = {
    prn: student.prn,
    degree: DEGREE,
    currentSemester: SEMESTER,
    totalHistoricalBacklogs: student.totalHistoricalBacklogs,
    phone: `98${String(70000000 + student.globalIndex).padStart(8, "0")}`.slice(0, 10),
    personalEmail: `personal.${branchInfo.shortCode.toLowerCase()}${pad3(student.globalIndex + 1)}@example.com`,
    resumeUrl: resumeLink,
    resumeStorageProvider: "google_drive",
    resumeDriveFileId: resumeId,
    resumeDriveWebLink: resumeLink,
    resumeFilename: `${normalizeSlug(student.fullName)}-resume.pdf`,
    resumeMimeType: "application/pdf",
    resumeSizeBytes: 240000 + student.globalIndex * 200,
    resumeUploadedAt: isoAt("2026-02-01", 12, student.globalIndex % 50),
    targetRoles: branchInfo.targetRoles,
    preferredLocations: branchInfo.preferredLocations,
    willingToRelocate: student.globalIndex % 2 === 0,
    linkedIn: `https://linkedin.com/in/${normalizeSlug(student.fullName)}-${branchInfo.shortCode.toLowerCase()}`,
    githubUrl: branchInfo.shortCode === "CST" || branchInfo.shortCode === "ETC" ? `https://github.com/${normalizeSlug(student.fullName).replace(/-/g, "")}` : `https://portfolio.smartpath.demo/${branchInfo.shortCode.toLowerCase()}/${pad3(student.globalIndex + 1)}`,
    portfolioUrl: `https://portfolio.smartpath.demo/${normalizeSlug(student.fullName)}`,
    internships: `${branchInfo.targetRoles[0]} internship completed with a focus on practical execution and reporting.`,
    projects: `${branchInfo.coreTopics[0]} capstone project with measurable outcomes and presentation readiness.`,
    certifications: `${branchInfo.coreTopics[1]} certification, placement readiness workshop, and resume clinic.`,
    achievements: `Presented ${branchInfo.coreTopics[2]} mini-project and secured department-level recognition.`,
    languages: ["English", "Marathi", "Hindi"],
    dataConsentAccepted: true,
    accuracyDeclarationAccepted: true,
    placementStatus: { isPlaced: false, placedAt: null, placedCompany: null, placedRole: null, placedPackageLpa: null, sourceDriveId: null, correctionReason: null, correctedAt: null },
  } as Record<string, unknown>;
  const preview = buildProfileCertificationPreview({ student: { roll_number: student.rollNumber, branch: student.branch, batch: BATCH, cgpa: student.cgpa, backlogs: student.backlogs, backlogs_total: student.totalHistoricalBacklogs, attendance_pct: student.attendancePct, profile_data: base }, user: { full_name: student.fullName, email: student.email } });
  const certifiedAt = isoAt("2026-02-03", 9, student.globalIndex % 55);
  return buildDeclarationProfileDataPatch({ profileData: base, declaration: { onboardingAcceptedAt: certifiedAt, onboardingVersion: STUDENT_DECLARATION_POLICY_VERSION, onboardingTypedValue: student.rollNumber, profileCertifiedAt: certifiedAt, profileCertificationVersion: STUDENT_DECLARATION_POLICY_VERSION, profileCertificationTypedValue: PROFILE_CERTIFICATION_TYPED_VALUE, profileCertificationSnapshotHash: preview.snapshotHash, profileCertificationInvalidatedAt: null, profileCertificationInvalidationReason: null, lastCertifiedProfileAt: certifiedAt, profileEditLockedAt: certifiedAt, profileEditUnlockedAt: null, profileEditUnlockedBy: null } });
}

function buildStudentRows(studentPasswordHash: string) {
  const students: any[] = [];
  const users: any[] = [];
  const byBranch = new Map<string, any[]>();
  let globalIndex = 0;
  BRANCHES.forEach((branch) => {
    const branchRows: any[] = [];
    for (let branchIndex = 0; branchIndex < 40; branchIndex += 1) {
      const metrics = buildStudentMetrics(branchIndex);
      const fullName = studentName(globalIndex);
      const email = `${branchKey(branch).toLowerCase()}${pad3(branchIndex + 1)}@setk-demo.edu`;
      const userId = randomUUID();
      const studentId = randomUUID();
      const rollNumber = `SETK-${BATCH}-${branchKey(branch)}-${pad3(branchIndex + 1)}`;
      const prn = `PRN-${BATCH}-${branchKey(branch)}-${pad3(branchIndex + 1)}`;
      const createdAt = isoAt(minusDays("2026-04-07", 120 - globalIndex % 60), 10, globalIndex % 50);
      const profileData = buildProfileData({ globalIndex, branch, fullName, email, rollNumber, prn, cgpa: metrics.cgpa, backlogs: metrics.backlogs, totalHistoricalBacklogs: metrics.totalHistoricalBacklogs, attendancePct: metrics.attendancePct });
      const user = { id: userId, tenant_id: "", email, role: "student", full_name: fullName, is_active: true, must_change_password: false, password_hash: studentPasswordHash, created_at: createdAt, updated_at: createdAt };
      const student = { id: studentId, tenant_id: "", user_id: userId, roll_number: rollNumber, branch, batch: BATCH, cgpa: metrics.cgpa, backlogs: metrics.backlogs, backlogs_total: metrics.totalHistoricalBacklogs, attendance_pct: metrics.attendancePct, skills: [...BRANCH_CONFIG[branch].defaultSkills, "Communication"], points: metrics.readinessScore * 10 + branchIndex, streak_current: 2 + (branchIndex % 6), streak_longest: 6 + (branchIndex % 12), readiness_score: metrics.readinessScore, profile_data: profileData, created_at: createdAt, updated_at: createdAt };
      const row = { ...student, user, student, branchIndex, globalIndex, tier: metrics.tier, fullName, email, profile_data: profileData, readiness_score: metrics.readinessScore };
      branchRows.push(row); users.push(user); students.push(student); globalIndex += 1;
    }
    byBranch.set(branch, branchRows);
  });
  return { users, students, byBranch };
}

function buildMockTests(tenantId: string, createdBy: string, topicIds: Map<string, string>) {
  return TOPIC_NAMES.slice(0, 12).map((topicName, index) => ({ id: randomUUID(), tenant_id: tenantId, created_by: createdBy, title: `${topicName} Mock ${index + 1}`, topic_id: topicIds.get(topicName) ?? null, dedupe_key: `seed:${tenantId}:${index}`, company_id: null, duration_sec: 20 * 60, difficulty: index % 3 === 0 ? "easy" : index % 3 === 1 ? "medium" : "hard", questions: buildQuestions(topicName), is_active: true, created_at: isoAt(minusDays("2026-04-07", 40 - index), 10), updated_at: isoAt(minusDays("2026-04-07", 20 - index), 10) }));
}

function buildResources(tenantId: string, topicIds: Map<string, string>) {
  const sharedResources: any[] = []; const resources: any[] = [];
  for (let index = 0; index < 60; index += 1) {
    const topicName = TOPIC_NAMES[index % TOPIC_NAMES.length];
    const branch = BRANCHES[index % BRANCHES.length];
    const base = { id: `resource-${index}`, tenant_id: tenantId, title: `${topicName} Guide ${index + 1}`, description: `Curated ${topicName.toLowerCase()} material mapped to placement preparation needs.`, url: `https://content.smartpath.demo/resources/${index + 1}`, resource_type: index % 3 === 0 ? "pdf" : index % 3 === 1 ? "article" : "video", thumbnail_url: null, duration_sec: 600 + index * 15, topic_id: topicIds.get(topicName) ?? null, dedupe_key: `seed:${tenantId}:${index}`, source_pdf: null, branch_relevance: [branch], career_tracks: BRANCH_CONFIG[branch].targetRoles, content_pack_labels: [topicName, "Placement Readiness"], recommended_for: [buildTier(index % 40)], search_index: { search_text: `${topicName} placement interview ${branch}`, summary_short: `Revision-ready notes for ${topicName}`, keywords: [topicName, branch, "placement", "mock test"], key_topics: [topicName] }, is_active: true, created_at: isoAt(minusDays("2026-04-07", 55 - (index % 20)), 11), updated_at: isoAt(minusDays("2026-04-07", 55 - (index % 20)), 11) };
    sharedResources.push(base); resources.push(base);
  }
  return { sharedResources, resources };
}

function buildDriveRows(tenantId: string, createdBy: string) {
  return DRIVE_DEFINITIONS.map((drive) => ({ id: randomUUID(), tenant_id: tenantId, company: drive.company, role: drive.role, drive_date: drive.driveDate, visit_date: drive.visitDate, criteria: { minCgpa: drive.minCgpa, maxBacklogs: drive.maxBacklogs, branches: drive.branches, minAttendance: drive.minAttendance }, sector_or_industry: drive.sector, ctc_min_lpa: drive.ctcMin, ctc_max_lpa: drive.ctcMax, ctc_final_lpa: drive.ctcFinal, location: drive.location, mode: drive.mode, dress_code: drive.dressCode, mou_status: drive.mouStatus, rounds_conducted: drive.rounds, reporting_notes: drive.reportingNotes, registration_instructions: drive.registrationInstructions, required_documents: drive.requiredDocuments, status: drive.status, eligible_count: 0, created_by: createdBy, created_at: isoAt(minusDays(drive.visitDate, 7), 9), updated_at: isoAt(drive.visitDate, 18), latest_eligibility_version: null, latest_eligibility_computed_at: null, deleted_at: null }));
}

function buildCompanyRows(tenantId: string) {
  return DRIVE_DEFINITIONS.map((drive) => ({ id: randomUUID(), tenant_id: tenantId, name: drive.company, slug: normalizeSlug(drive.company), sector: drive.sector, website: `https://${normalizeSlug(drive.company)}.example.com`, contact_name: `${drive.company} Campus Team`, contact_email: `campus@${normalizeSlug(drive.company)}.example.com`, created_at: isoAt(minusDays(drive.visitDate, 30), 10), updated_at: isoAt(minusDays(drive.visitDate, 5), 10) }));
}

function buildAttemptAndProgressData(tenantId: string, studentRows: any[], mockTests: any[], topicIds: Map<string, string>) {
  const attempts: any[] = []; const studyHours: any[] = []; const topicMastery: any[] = []; const topicProgress: any[] = []; const resourceEvents: any[] = []; const aiConversations: any[] = []; const codingProfiles: any[] = []; const interviewSessions: any[] = []; const achievementWallet: any[] = []; const mentorshipMatches: any[] = [];
  studentRows.forEach((row, index) => {
    const testCount = row.tier === "high" ? 3 : row.tier === "medium" ? 2 : 1;
    for (let i = 0; i < testCount; i += 1) {
      const test = mockTests[(index + i) % mockTests.length]; const submittedDate = minusDays("2026-04-07", 2 + ((index + i * 3) % 25)); const score = clamp(Math.round(row.readiness_score + (row.tier === "high" ? 6 : row.tier === "medium" ? 0 : -4) - i * 2), 38, 96);
      attempts.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, test_id: test.id, status: "submitted", started_at: isoAt(submittedDate, 9 + i), submitted_at: isoAt(submittedDate, 10 + i), answers: Array.from({ length: 10 }, (_, questionIndex) => ({ questionIndex, selectedOption: 0 })), score, time_taken_sec: 900 + i * 40, topic_breakdown: { [String(test.topic_id ?? "general")]: { correct: Math.max(4, Math.min(9, Math.round(score / 12))), total: 10 } }, idempotency_key: randomUUID(), created_at: isoAt(submittedDate, 10 + i), updated_at: isoAt(submittedDate, 10 + i) });
    }
    const branchTopics = BRANCH_CONFIG[row.branch].coreTopics;
    for (let i = 0; i < 2; i += 1) { const topicName = branchTopics[i % branchTopics.length] ?? "Aptitude & Reasoning"; const studyDate = minusDays("2026-04-07", 1 + ((index + i * 4) % 18)); studyHours.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, topic_id: topicIds.get(topicName) ?? null, dedupe_key: `seed:${tenantId}:${index}`, study_date: studyDate, hours: Number((1.2 + (i * 0.6) + (index % 3) * 0.2).toFixed(1)), points_awarded: 12 + i * 3, created_at: isoAt(studyDate, 8 + i) }); }
    branchTopics.slice(0, 3).forEach((topicName, masteryIndex) => {
      const masteryLevel = clamp(row.readiness_score + 4 - masteryIndex * 8, 32, 94); const updatedDate = minusDays("2026-04-07", masteryIndex + (index % 10));
      topicMastery.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, topic_id: topicIds.get(topicName) ?? null, dedupe_key: `seed:${tenantId}:${index}`, mastery_level: masteryLevel, total_attempts: masteryIndex + 1, correct_attempts: Math.max(1, masteryIndex + 1), confidence_score: clamp(masteryLevel + 3, 35, 96), last_assessed: isoAt(minusDays("2026-04-07", masteryIndex + (index % 12)), 13), created_at: isoAt(minusDays("2026-04-07", 30), 11), updated_at: isoAt(minusDays("2026-04-07", masteryIndex + (index % 12)), 13) });
      const status = masteryIndex === 0 ? "complete" : masteryIndex === 1 ? "in_progress" : "incomplete";
      topicProgress.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, topic_id: topicIds.get(topicName) ?? null, dedupe_key: `seed:${tenantId}:${index}`, status, created_at: isoAt(minusDays(updatedDate, 7), 9), updated_at: isoAt(updatedDate, 9), completed_at: status === "complete" ? isoAt(updatedDate, 9) : null });
    });
    const resourceOpenCount = row.tier === "high" ? 3 : row.tier === "medium" ? 2 : 1;
    for (let i = 0; i < resourceOpenCount; i += 1) { const sessionId = randomUUID(); const date = minusDays("2026-04-07", 1 + ((index + i) % 12)); const resourceId = `resource-${(index + i) % 60}`; const title = `Placement Resource ${((index + i) % 60) + 1}`; resourceEvents.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, resource_id: resourceId, event_type: "open", session_id: sessionId, duration_sec: 0, progress_pct: 18 + i * 20, page_number: 1, scroll_depth_pct: 28 + i * 12, source_context: "resource_library", metadata: { resourceTitle: title, resourceType: "pdf" }, created_at: isoAt(date, 14 + i), updated_at: isoAt(date, 14 + i) }); resourceEvents.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, resource_id: resourceId, event_type: "close", session_id: sessionId, duration_sec: 420 + i * 90, progress_pct: 62 + i * 10, page_number: 4 + i, scroll_depth_pct: 70 + i * 8, source_context: "resource_library", metadata: { resourceTitle: title, resourceType: "pdf" }, created_at: isoAt(date, 14 + i), updated_at: isoAt(date, 14 + i) }); }
    if (index < 80) aiConversations.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, topic: BRANCH_CONFIG[row.branch].coreTopics[index % BRANCH_CONFIG[row.branch].coreTopics.length], created_at: isoAt(minusDays("2026-04-07", 8 + (index % 20)), 16), updated_at: isoAt(minusDays("2026-04-07", index % 7), 16) });
    if (index < 90) codingProfiles.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, platform: row.branch === "Computer Science and Technology" ? "LeetCode" : row.branch === "Electronics and Telecommunication" ? "HackerRank" : "SmartPath Practice", solved_count: row.tier === "high" ? 180 + (index % 40) : row.tier === "medium" ? 90 + (index % 35) : 35 + (index % 25), weekly_goal: row.tier === "high" ? 20 : row.tier === "medium" ? 12 : 8, streak_days: row.tier === "high" ? 15 + (index % 20) : row.tier === "medium" ? 7 + (index % 12) : 2 + (index % 6), created_at: isoAt(minusDays("2026-04-07", 60), 9), updated_at: isoAt(minusDays("2026-04-07", index % 6), 9) });
    if (index < 70) interviewSessions.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, company: index % 2 === 0 ? "Mock Panel" : "Alumni Practice", role: BRANCH_CONFIG[row.branch].targetRoles[0], answer_feedback: [{ overallScore: clamp(row.readiness_score + (row.tier === "high" ? 8 : row.tier === "medium" ? 2 : -3), 40, 95), fillerCount: row.tier === "low" ? 7 : row.tier === "medium" ? 4 : 2, rubric: { clarity: row.tier === "low" ? 8 : 12, structure: row.tier === "low" ? 10 : 16, confidence: row.tier === "low" ? 7 : 12 } }], overall_score: clamp(row.readiness_score + (row.tier === "high" ? 6 : row.tier === "medium" ? 1 : -4), 40, 94), status: "completed", created_at: isoAt(minusDays("2026-04-07", 15 + (index % 20)), 15), completed_at: isoAt(minusDays("2026-04-07", 10 + (index % 12)), 16) });
    if (index < 80) achievementWallet.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, type: row.tier === "high" ? "certification" : "milestone", title: row.tier === "high" ? "Placement Readiness Milestone" : "Mock Practice Milestone", achieved_at: isoAt(minusDays("2026-04-07", 12 + (index % 18)), 12), created_at: isoAt(minusDays("2026-04-07", 12 + (index % 18)), 12) });
    if (index < 40) mentorshipMatches.push({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, domain: BRANCH_CONFIG[row.branch].targetRoles[0], created_at: isoAt(minusDays("2026-04-07", 20 + (index % 10)), 11) });
  });
  return { attempts, studyHours, topicMastery, topicProgress, resourceEvents, aiConversations, codingProfiles, interviewSessions, achievementWallet, mentorshipMatches };
}
function buildCommunicationsAndAnnouncements(tenantId: string, tpoUserId: string, studentRows: any[], drives: any[]) {
  const allEmails = studentRows.map((row) => row.email);
  const atRiskStudents = studentRows.filter((row) => row.readiness_score < 55);
  const tcsDrive = drives.find((drive) => drive.company === "Tata Consultancy Services");
  const communications = [
    { id: randomUUID(), tenant_id: tenantId, sender_id: tpoUserId, channel: "email", subject: "TCS registration reminder", body: "Complete your registration steps and check the official instructions in Smart Path.", recipients: allEmails.slice(0, 160), status: "sent", provider: "seeded", provider_message_id: `seed-${randomUUID()}`, sent_at: isoAt("2026-04-02", 9), metadata: { sent: 160, failed: 0, delivery: { delivered: 154, bounced: 6 } }, created_at: isoAt("2026-04-02", 9), updated_at: isoAt("2026-04-02", 9) },
    { id: randomUUID(), tenant_id: tenantId, sender_id: tpoUserId, channel: "email", subject: "At-risk student follow-up", body: "Please complete one mock test and update the missing profile fields today.", recipients: atRiskStudents.slice(0, 50).map((row) => row.email), status: "partial", provider: "seeded", provider_message_id: `seed-${randomUUID()}`, sent_at: isoAt("2026-04-04", 10), metadata: { sent: 43, failed: 7, delivery: { delivered: 39, bounced: 4 }, top_error: "7 recipients need profile email correction before resend." }, created_at: isoAt("2026-04-04", 10), updated_at: isoAt("2026-04-04", 10) },
  ];
  const announcements = [
    { id: randomUUID(), tenant_id: tenantId, sender_id: tpoUserId, title: "TCS registration closes this week", message: "Eligible students should complete registration, verify resume, and monitor the TCS drive card daily.", priority: "important", status: "published", recipient_student_ids: studentRows.map((row) => row.id), related_drive_id: tcsDrive?.id ?? null, related_drive_name: tcsDrive?.company ?? null, audience_summary: "All final-year students", recipient_count_snapshot: studentRows.length, show_popup: true, published_at: isoAt("2026-04-01", 9), created_at: isoAt("2026-04-01", 9), updated_at: isoAt("2026-04-01", 9), expires_at: isoAt("2026-04-18", 18) },
    { id: randomUUID(), tenant_id: tenantId, sender_id: tpoUserId, title: "Resume verification window open", message: "Students should review resume formatting and lock the final version before drive week.", priority: "important", status: "published", recipient_student_ids: studentRows.map((row) => row.id), related_drive_id: null, related_drive_name: null, audience_summary: "All students", recipient_count_snapshot: studentRows.length, show_popup: false, published_at: isoAt("2026-03-28", 11), created_at: isoAt("2026-03-28", 11), updated_at: isoAt("2026-03-28", 11), expires_at: isoAt("2026-04-30", 18) },
    { id: randomUUID(), tenant_id: tenantId, sender_id: tpoUserId, title: "Mock interview slots for intervention batch", message: "Students in the intervention queue should book one mock interview slot and attempt the assigned practice test.", priority: "urgent", status: "published", recipient_student_ids: atRiskStudents.map((row) => row.id), related_drive_id: null, related_drive_name: null, audience_summary: "At-risk students", recipient_count_snapshot: atRiskStudents.length, show_popup: true, published_at: isoAt("2026-04-05", 14), created_at: isoAt("2026-04-05", 14), updated_at: isoAt("2026-04-05", 14), expires_at: isoAt("2026-04-20", 18) },
  ];
  const announcementReads: any[] = [];
  announcements.forEach((announcement, announcementIndex) => {
    const recipients = announcement.recipient_student_ids as string[];
    const readCount = announcementIndex === 0 ? 140 : announcementIndex === 1 ? 116 : Math.min(announcement.recipient_count_snapshot, 34);
    recipients.slice(0, readCount).forEach((studentId, idx) => {
      const baseDate = announcementIndex === 0 ? "2026-04-02" : announcementIndex === 1 ? "2026-03-29" : "2026-04-05";
      announcementReads.push({ id: randomUUID(), tenant_id: tenantId, student_id: studentId, announcement_id: announcement.id, read_at: isoAt(plusDays(baseDate, idx % 3), 10 + (idx % 6)), dismissed_popup_at: announcement.show_popup ? isoAt(plusDays(baseDate, idx % 3), 10 + (idx % 6)) : null, seen_on_dashboard_at: isoAt(plusDays(baseDate, idx % 3), 9 + (idx % 6)), created_at: isoAt(baseDate, 9), updated_at: isoAt(plusDays(baseDate, idx % 3), 10 + (idx % 6)) });
    });
  });
  const emailTemplates = [
    { id: randomUUID(), tenant_id: tenantId, name: "Drive Reminder", slug: "drive-reminder", subject: "Reminder: {{drive_name}} action pending", body: "Please review your profile, resume, and drive instructions before the deadline.", is_system: false, created_by: tpoUserId, created_at: isoAt("2026-03-25", 10), updated_at: isoAt("2026-03-25", 10) },
    { id: randomUUID(), tenant_id: tenantId, name: "Intervention Follow-up", slug: "intervention-follow-up", subject: "Action needed for placement readiness", body: "Please complete the recommended practice and update your pending profile items.", is_system: false, created_by: tpoUserId, created_at: isoAt("2026-03-26", 10), updated_at: isoAt("2026-03-26", 10) },
    { id: randomUUID(), tenant_id: tenantId, name: "Result Release", slug: "result-release", subject: "Placement result update", body: "Your result has been updated in Smart Path. Please check the drive card for the latest status.", is_system: false, created_by: tpoUserId, created_at: isoAt("2026-03-27", 10), updated_at: isoAt("2026-03-27", 10) },
  ];
  return { communications, announcements, announcementReads, emailTemplates };
}

function buildSupportQueues(tenantId: string, studentRows: any[], tpoUserId: string) {
  const unlockRows = studentRows.filter((row) => row.tier !== "high").slice(0, 3).map((row, index) => ({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, requested_by_user_id: row.user.id, status: "pending", reason_category: index === 0 ? "resume_update" : index === 1 ? "cgpa_correction" : "preference_update", requested_fields: index === 0 ? ["resumeUrl"] : index === 1 ? ["cgpa"] : ["preferredLocations"], explanation: index === 0 ? "Need to upload the final approved resume before the next shortlist." : index === 1 ? "Academic office confirmed the revised CGPA sheet and profile needs to reflect it." : "Student wants to update preferred work locations before the next drive.", response_note: null, decided_at: null, decided_by: null, resolved_at: null, created_at: isoAt("2026-04-04", 10 + index), updated_at: isoAt("2026-04-04", 10 + index) }));
  const supportRequests = studentRows.filter((row) => row.tier === "low").slice(0, 3).map((row, index) => ({ id: randomUUID(), tenant_id: tenantId, student_id: row.id, student_email: row.email, student_name: row.fullName, subject: index === 0 ? "Need help with drive eligibility" : index === 1 ? "Resume verification assistance" : "Mock test schedule clarification", message: index === 0 ? "Please confirm if my latest academic update is reflected for upcoming drives." : index === 1 ? "I need support understanding why my resume is flagged for review." : "I want help selecting the right mock test plan for my branch.", status: "open", created_at: isoAt("2026-04-05", 11 + index), updated_at: isoAt("2026-04-05", 11 + index), resolved_at: null, resolved_by_user_id: null, resolved_by_email: null, resolution_note: null }));
  const supportSessions = [{ id: randomUUID(), tenant_id: tenantId, tenant_slug: TENANT_SLUG, tenant_name: TENANT_NAME, requested_by_user_id: tpoUserId, requested_by_email: TPO_EMAIL, reason: "Need admin help verifying the pilot tenant before demo day.", status: "pending", created_at: isoAt("2026-04-06", 15), decided_at: null, decided_by_user_id: null, decided_by_email: null, decision_note: null, expires_at: null, last_started_at: null, last_stopped_at: null, revoked_at: null }];
  return { unlockRows, supportRequests, supportSessions };
}

function buildAnnualReportRegisterEntries(tenantId: string, studentRows: any[], tpoUserId: string) {
  const now = isoAt("2026-04-07", 14);
  const byBranch = (branch: string) => studentRows.filter((row) => row.branch === branch);
  const cstTop = byBranch("Computer Science and Technology").slice(0, 4);
  const ftTop = byBranch("Food Technology").slice(0, 3);
  const ceTop = byBranch("Cicvil Engineering").slice(0, 3);
  const cheTop = byBranch("Chemical Engineering").slice(0, 3);
  const etcTop = byBranch("Electronics and Telecommunication").slice(0, 3);

  return [
    {
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: "training_activities",
      academic_year: ACADEMIC_YEAR,
      branch: null,
      payload: { programName: "Campus Recruitment Readiness Bootcamp", date: "2025-08-12", conductedBy: "Placement Cell and Alumni Panel" },
      created_by: tpoUserId,
      updated_by: tpoUserId,
      created_at: now,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: "training_activities",
      academic_year: ACADEMIC_YEAR,
      branch: "Computer Science and Technology",
      payload: { programName: "Coding and Interview Acceleration Program", date: "2025-10-05", conductedBy: "Persistent Systems Campus Team" },
      created_by: tpoUserId,
      updated_by: tpoUserId,
      created_at: now,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: "training_activities",
      academic_year: ACADEMIC_YEAR,
      branch: "Food Technology",
      payload: { programName: "QA and Food Safety Audit Workshop", date: "2025-11-18", conductedBy: "Britannia Industries" },
      created_by: tpoUserId,
      updated_by: tpoUserId,
      created_at: now,
      updated_at: now,
    },
    ...cstTop.slice(0, 2).map((row, index) => ({
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: "industrial_inplant_training",
      academic_year: ACADEMIC_YEAR,
      branch: row.branch,
      payload: {
        studentName: row.fullName,
        companyName: index === 0 ? "Infosys" : "Persistent Systems",
        mode: "offline",
        fromDate: index === 0 ? "2025-12-02" : "2025-12-09",
        toDate: index === 0 ? "2025-12-20" : "2025-12-27",
        programme: DEGREE,
      },
      created_by: tpoUserId,
      updated_by: tpoUserId,
      created_at: now,
      updated_at: now,
    })),
    ...ftTop.slice(0, 1).map((row) => ({
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: "industrial_inplant_training",
      academic_year: ACADEMIC_YEAR,
      branch: row.branch,
      payload: {
        studentName: row.fullName,
        companyName: "Britannia Industries",
        mode: "offline",
        fromDate: "2025-12-10",
        toDate: "2025-12-28",
        programme: DEGREE,
      },
      created_by: tpoUserId,
      updated_by: tpoUserId,
      created_at: now,
      updated_at: now,
    })),
    {
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: "higher_education_abroad",
      academic_year: ACADEMIC_YEAR,
      branch: "Computer Science and Technology",
      payload: {
        studentName: cstTop[2]?.fullName ?? "Aditi Patil",
        programme: DEGREE,
        coursePursuing: "M.S. in Computer Science",
        instituteName: "University of Texas at Dallas",
        country: "USA",
      },
      created_by: tpoUserId,
      updated_by: tpoUserId,
      created_at: now,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: "higher_education_abroad",
      academic_year: ACADEMIC_YEAR,
      branch: "Chemical Engineering",
      payload: {
        studentName: cheTop[0]?.fullName ?? "Mihir Joshi",
        programme: DEGREE,
        coursePursuing: "M.S. in Process Engineering",
        instituteName: "University of Leeds",
        country: "United Kingdom",
      },
      created_by: tpoUserId,
      updated_by: tpoUserId,
      created_at: now,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: "industrial_visit",
      academic_year: ACADEMIC_YEAR,
      branch: "Computer Science and Technology",
      payload: {
        companyName: "Tata Consultancy Services",
        studentCount: Math.max(25, cstTop.length * 10),
        visitDate: "2025-09-14",
      },
      created_by: tpoUserId,
      updated_by: tpoUserId,
      created_at: now,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: "industrial_visit",
      academic_year: ACADEMIC_YEAR,
      branch: "Cicvil Engineering",
      payload: {
        companyName: "Shapoorji Pallonji",
        studentCount: Math.max(24, ceTop.length * 10),
        visitDate: "2025-10-08",
      },
      created_by: tpoUserId,
      updated_by: tpoUserId,
      created_at: now,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      register_type: "industrial_visit",
      academic_year: ACADEMIC_YEAR,
      branch: "Electronics and Telecommunication",
      payload: {
        companyName: "Jio Platforms",
        studentCount: Math.max(22, etcTop.length * 10),
        visitDate: "2025-11-06",
      },
      created_by: tpoUserId,
      updated_by: tpoUserId,
      created_at: now,
      updated_at: now,
    },
  ];
}

function buildDriveResultsAndPlacements(params: { tenantId: string; drives: any[]; studentRows: any[]; tpoUserId: string; resultCommunicationIds: string[]; }) {
  const driveResults: any[] = []; const placementHistory: any[] = []; const selectedByStudent = new Map<string, { company: string; role: string; packageLpa: number; driveId: string; placedAt: string }>();
  params.drives.forEach((drive, driveIndex) => {
    const definition = DRIVE_DEFINITIONS[driveIndex]!; const eligibleStudents = params.studentRows.filter((row) => definition.branches.includes(row.branch)); drive.eligible_count = eligibleStudents.length;
    eligibleStudents.forEach((row, eligibleIndex) => {
      const now = isoAt(definition.visitDate, 18, eligibleIndex % 40); const selectedCutoff = (definition as any).quota?.selected ?? 0; const shortlistedCutoff = selectedCutoff + ((definition as any).quota?.shortlisted ?? 0); const isCompleted = definition.status === "completed"; const isSelected = isCompleted && eligibleIndex < selectedCutoff; const isShortlisted = isCompleted && !isSelected && eligibleIndex < shortlistedCutoff; const resultCommunicationId = params.resultCommunicationIds[driveIndex % params.resultCommunicationIds.length] ?? null;
      const base = { id: randomUUID(), tenant_id: params.tenantId, drive_id: drive.id, student_id: row.id, status: isCompleted ? "applied" : eligibleIndex % 3 === 0 ? "applied" : "eligible", application_state: isCompleted ? "applied" : eligibleIndex % 3 === 0 ? "applied" : "not_applied", outcome: isCompleted ? (isSelected ? "selected" : isShortlisted ? "shortlisted" : "rejected") : "pending", remarks: isCompleted ? (isSelected ? "Selected after final review." : isShortlisted ? "Shortlisted for the next stage." : "Needs stronger readiness before next drive cycle.") : "Awaiting next drive milestone.", registered: isCompleted ? true : eligibleIndex % 3 === 0, appeared: isCompleted ? true : null, shortlisted_round: isSelected || isShortlisted ? definition.rounds[definition.rounds.length - 1] : null, offer_date: isSelected ? definition.driveDate : null, designation_offered: isSelected ? definition.role : null, final_ctc_lpa: isSelected ? Number((definition.ctcFinal + ((eligibleIndex % 3) * 0.1)).toFixed(2)) : null, joining_status: isSelected ? (eligibleIndex % 4 === 0 ? "joined" : "confirmed") : null, offer_letter_reference: isSelected ? `${branchKey(row.branch)}-${normalizeSlug(definition.company).toUpperCase()}-${pad3(eligibleIndex + 1)}` : null, offer_letter_url: isSelected ? `https://apptipreparation.s3.us-east-1.amazonaws.com/offers/${normalizeSlug(definition.company)}-${row.roll_number}.pdf` : null, joining_letter_url: isSelected ? `https://apptipreparation.s3.us-east-1.amazonaws.com/joining/${normalizeSlug(definition.company)}-${row.roll_number}.pdf` : null, selection_source: "on_campus", verification_status: isSelected ? "verified" : "pending", source_note: "Campus drive managed by the placement cell.", non_placement_reason: isSelected ? null : isShortlisted ? "Awaiting final round closure" : row.tier === "low" ? "Low readiness in mock and interview rounds" : "Competition level and domain fit mismatch", action_plan: isSelected ? null : isShortlisted ? "Keep documents ready and revise the final interview topics." : row.tier === "low" ? "Complete two mock tests, update the resume, and attend one intervention session." : "Apply to the next matching drive and complete the recommended practice set.", declaration_accepted_at: isoAt(minusDays(definition.driveDate, 2), 10), declaration_version: STUDENT_DECLARATION_POLICY_VERSION, resume_drive_file_id_at_application: row.profile_data.resumeDriveFileId, resume_drive_web_link_at_application: row.profile_data.resumeDriveWebLink, result_released_at: isCompleted ? now : null, result_released_by: isCompleted ? params.tpoUserId : null, result_notification_status: isCompleted ? "sent" : null, result_notification_communication_id: isCompleted ? resultCommunicationId : null, offer_letter_shared_at: isSelected ? now : null, offer_letter_shared_by: isSelected ? params.tpoUserId : null, student_result_viewed_at: isCompleted ? `${plusDays(definition.driveDate, 1)}T10:00:00.000Z` : null, created_at: isoAt(minusDays(definition.driveDate, 5), 9), updated_at: now };
      driveResults.push(base);
      if (isSelected) { const existing = selectedByStudent.get(row.id); const packageLpa = base.final_ctc_lpa as number; if (!existing || packageLpa > existing.packageLpa) selectedByStudent.set(row.id, { company: definition.company, role: definition.role, packageLpa, driveId: drive.id, placedAt: base.offer_date as string }); }
    });
  });
  params.studentRows.forEach((row) => {
    const selected = selectedByStudent.get(row.id); const placementStatus = selected ? { isPlaced: true, placedAt: selected.placedAt, placedCompany: selected.company, placedRole: selected.role, placedPackageLpa: selected.packageLpa, sourceDriveId: selected.driveId, correctionReason: "Seeded placement outcome", correctedAt: isoAt("2026-04-07", 12) } : { isPlaced: false, placedAt: null, placedCompany: null, placedRole: null, placedPackageLpa: null, sourceDriveId: null, correctionReason: null, correctedAt: null };
    row.student.profile_data = { ...(row.student.profile_data ?? {}), placementStatus };
    if (selected) placementHistory.push({ id: randomUUID(), tenant_id: params.tenantId, student_id: row.id, source_drive_id: selected.driveId, company: selected.company, role: selected.role, package_lpa: selected.packageLpa, placed_at: selected.placedAt, status: "placed", correction_reason: "Seeded placement outcome", created_by: params.tpoUserId, created_at: isoAt("2026-04-07", 12), updated_at: isoAt("2026-04-07", 12) });
  });
  return { driveResults, placementHistory };
}

async function ensureTopics(db: any) {
  const existing = await db.collection("topics").find({ tenant_id: null, name: { $in: [...TOPIC_NAMES] } }, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
  const topicIds = new Map(existing.map((row: any) => [String(row.name), String(row.id)]));
  const now = isoAt("2026-04-07", 9);
  const missing = [...TOPIC_NAMES].filter((name) => !topicIds.has(name)).map((name) => ({ id: randomUUID(), tenant_id: null, name, created_at: now, updated_at: now }));
  if (missing.length > 0) { await db.collection("topics").insertMany(missing); missing.forEach((row) => topicIds.set(row.name, row.id)); }
  return topicIds;
}

async function ensureTenantContext(db: any) {
  const tenant = await db.collection("tenants").findOne({ $or: [{ name: TENANT_NAME }, { slug: TENANT_SLUG }] }, { projection: { _id: 0, id: 1, name: 1, slug: 1, domain: 1, config: 1 } });
  const tpoPasswordHash = await hash(TPO_PASSWORD, 10); const now = isoAt("2026-04-07", 9);
  if (!tenant) {
    const tenantId = randomUUID(); const tpoUserId = randomUUID();
    await db.collection("tenants").insertOne({ id: tenantId, name: TENANT_NAME, slug: TENANT_SLUG, domain: TENANT_DOMAIN, subscription_tier: "pilot", is_active: true, config: { mode: "pilot", branches: [...BRANCHES], maxStudents: 2000, placementPolicy: { excludePlacedStudentsByDefault: false }, emailSettings: { fromName: "SETK Placement Cell", fromEmail: process.env.RESEND_FROM_EMAIL ?? "admin@campusdrive.me", replyToEmail: TPO_EMAIL } }, created_at: now, updated_at: now });
    await db.collection("users").insertOne({ id: tpoUserId, tenant_id: tenantId, email: TPO_EMAIL, role: "tpo", full_name: TPO_FULL_NAME, is_active: true, must_change_password: false, password_hash: tpoPasswordHash, created_at: now, updated_at: now });
    return { tenantId, tpoUserId, createdTenant: true };
  }
  let tpo = await db.collection("users").findOne({ tenant_id: String(tenant.id), email: TPO_EMAIL }, { projection: { _id: 0, id: 1 } });
  if (!tpo) { tpo = { id: randomUUID() }; await db.collection("users").insertOne({ id: tpo.id, tenant_id: String(tenant.id), email: TPO_EMAIL, role: "tpo", full_name: TPO_FULL_NAME, is_active: true, must_change_password: false, password_hash: tpoPasswordHash, created_at: now, updated_at: now }); }
  else await db.collection("users").updateOne({ tenant_id: String(tenant.id), email: TPO_EMAIL }, { $set: { full_name: TPO_FULL_NAME, is_active: true, must_change_password: false, password_hash: tpoPasswordHash, updated_at: now } });
  await db.collection("tenants").updateOne({ id: String(tenant.id) }, { $set: { name: TENANT_NAME, slug: TENANT_SLUG, domain: String(tenant.domain ?? TENANT_DOMAIN), updated_at: now, config: { ...((tenant.config ?? {}) as Record<string, unknown>), mode: "pilot", branches: [...BRANCHES], maxStudents: 2000, placementPolicy: { excludePlacedStudentsByDefault: false }, emailSettings: { fromName: "SETK Placement Cell", fromEmail: process.env.RESEND_FROM_EMAIL ?? "admin@campusdrive.me", replyToEmail: TPO_EMAIL } } } });
  return { tenantId: String(tenant.id), tpoUserId: String(tpo.id), createdTenant: false };
}

async function resetTenantData(db: any, tenantId: string) {
  for (const name of TENANT_SCOPED_COLLECTIONS) await db.collection(name).deleteMany({ tenant_id: tenantId });
  await db.collection("users").deleteMany({ tenant_id: tenantId, role: "student" });
}
async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    logStep("Resolving tenant and TPO context...");
    const { tenantId, tpoUserId, createdTenant } = await ensureTenantContext(db);
    logStep("Resetting tenant-scoped demo data...");
    await resetTenantData(db, tenantId);
    logStep("Ensuring global topics...");
    const topicIds = await ensureTopics(db);
    logStep("Building student accounts and profiles...");
    const studentPasswordHash = await hash(STUDENT_PASSWORD, 10);
    const { users, students, byBranch } = buildStudentRows(studentPasswordHash);
    users.forEach((user) => { user.tenant_id = tenantId; });
    students.forEach((student) => { student.tenant_id = tenantId; });
    const studentRows = [...byBranch.values()].flat();
    studentRows.forEach((row) => { row.user.tenant_id = tenantId; row.student.tenant_id = tenantId; row.profile_data = row.student.profile_data; row.readiness_score = row.student.readiness_score; });

    logStep("Building drives, resources, mocks, and activity history...");
    const mockTests = buildMockTests(tenantId, tpoUserId, topicIds);
    const { sharedResources, resources } = buildResources(tenantId, topicIds);
    const drives = buildDriveRows(tenantId, tpoUserId);
    const companies = buildCompanyRows(tenantId);
    const activityData = buildAttemptAndProgressData(tenantId, studentRows, mockTests, topicIds);

    logStep("Building communications, announcements, and support queues...");
    const { communications, announcements, announcementReads, emailTemplates } = buildCommunicationsAndAnnouncements(tenantId, tpoUserId, studentRows, drives);
    const resultCommunicationIds = drives.filter((drive) => drive.status === "completed").map((drive) => {
      const communication = { id: randomUUID(), tenant_id: tenantId, sender_id: tpoUserId, channel: "email", subject: `${drive.company} result release`, body: `Your result for ${drive.company} has been released in Smart Path.`, recipients: studentRows.filter((row) => DRIVE_DEFINITIONS.find((item) => item.company === drive.company)?.branches.includes(row.branch)).map((row) => row.email), status: "sent", provider: "seeded", provider_message_id: `seed-${randomUUID()}`, sent_at: isoAt(drive.visit_date ?? drive.drive_date, 18), metadata: { sent: drive.eligible_count, failed: 0, delivery: { delivered: drive.eligible_count, bounced: 0 } }, created_at: isoAt(drive.visit_date ?? drive.drive_date, 18), updated_at: isoAt(drive.visit_date ?? drive.drive_date, 18) };
      communications.push(communication);
      return communication.id;
    });
    const { unlockRows, supportRequests, supportSessions } = buildSupportQueues(tenantId, studentRows, tpoUserId);
    const annualReportRegisterEntries = buildAnnualReportRegisterEntries(tenantId, studentRows, tpoUserId);

    logStep("Building drive results and placement summaries...");
    const { driveResults, placementHistory } = buildDriveResultsAndPlacements({ tenantId, drives, studentRows, tpoUserId, resultCommunicationIds });
    students.forEach((student) => { const source = studentRows.find((row) => row.id === student.id); if (source) student.profile_data = source.student.profile_data; });

    logStep("Writing seeded tenant data to MongoDB...");
    await db.collection("users").insertMany(users);
    await db.collection("students").insertMany(students);
    await db.collection("companies").insertMany(companies);
    await db.collection("mock_tests").insertMany(mockTests);
    await db.collection("shared_resources").insertMany(sharedResources);
    await db.collection("resources").insertMany(resources);
    await db.collection("drives").insertMany(drives);
    await db.collection("drive_results").insertMany(driveResults);
    await db.collection("student_attempts").insertMany(activityData.attempts);
    await db.collection("study_hours").insertMany(activityData.studyHours);
    await db.collection("topic_mastery").insertMany(activityData.topicMastery);
    await db.collection("student_topic_progress").insertMany(activityData.topicProgress);
    await db.collection("resource_view_events").insertMany(activityData.resourceEvents);
    await db.collection("ai_conversations").insertMany(activityData.aiConversations);
    await db.collection("coding_profiles").insertMany(activityData.codingProfiles);
    await db.collection("interview_sessions").insertMany(activityData.interviewSessions);
    await db.collection("achievement_wallet").insertMany(activityData.achievementWallet);
    await db.collection("mentorship_matches").insertMany(activityData.mentorshipMatches);
    await db.collection("email_templates").insertMany(emailTemplates);
    await db.collection("communications").insertMany(communications);
    await db.collection("announcements").insertMany(announcements);
    await db.collection("announcement_reads").insertMany(announcementReads);
    await db.collection("profile_unlock_requests").insertMany(unlockRows);
    await db.collection("student_support_requests").insertMany(supportRequests);
    await db.collection("support_sessions").insertMany(supportSessions);
    await db.collection("student_placement_history").insertMany(placementHistory);
    await db.collection("annual_report_register_entries").insertMany(annualReportRegisterEntries);

    logStep("Seed complete.");
    console.log(JSON.stringify({ ok: true, tenantId, tenantName: TENANT_NAME, tenantSlug: TENANT_SLUG, createdTenant, tpoEmail: TPO_EMAIL, tpoPassword: TPO_PASSWORD, studentPassword: STUDENT_PASSWORD, academicYear: ACADEMIC_YEAR, students: students.length, branches: Object.fromEntries(BRANCHES.map((branch) => [branch, studentRows.filter((row) => row.branch === branch).length])), drives: drives.length, mockTests: mockTests.length, resources: sharedResources.length, announcements: announcements.length, communications: communications.length, unlockRequests: unlockRows.length, supportRequests: supportRequests.length, annualRegisterEntries: annualReportRegisterEntries.length }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

