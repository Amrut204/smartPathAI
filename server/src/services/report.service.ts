import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";

import { AppError } from "../middleware/error-handler.js";
import { getMongoDb } from "../utils/mongodb.js";

export type ReportType =
  | "drive_completion_summary"
  | "weekly_placement_status"
  | "monthly_branch_breakdown"
  | "company_visit_register"
  | "final_placement_statistics"
  | "naac_5_2_progression"
  | "branch_wise_placement_analysis"
  | "placement_brochure_pack"
  | "unplaced_student_action_report";

export interface ReportFilters {
  preset: "this_week" | "this_month" | "placement_season" | "academic_year" | "custom";
  academicYear?: string;
  dateFrom?: string;
  dateTo?: string;
  branch?: string;
  placementSource?: "on_campus" | "off_campus" | "self_reported";
  verificationStatus?: "pending" | "verified" | "rejected";
  campusMode?: "on_campus" | "off_campus";
  driveStatus?: "upcoming" | "active" | "completed" | "cancelled";
  company?: string;
  sector?: string;
  driveId?: string;
  includeOffCampus?: boolean;
}

type ReportAudience = "Principal / Director" | "HODs" | "Management" | "NAAC / NBA" | "All Authorities";
type ReportAudienceExtended =
  | ReportAudience
  | "Placement Office / Principal"
  | "Placement Office"
  | "Management / Marketing";
type ReportGroup = "Must-have Reports" | "Compliance / Evidence" | "Operational Tracking" | "Exports";
type ReportRowValue = string | number | boolean | null;

interface ReportMetric {
  label: string;
  value: ReportRowValue;
}

interface PreparedReport {
  type: ReportType;
  title: string;
  audience: ReportAudienceExtended;
  group: ReportGroup;
  reportingPeriod: string;
  generatedAt: string;
  ready: boolean;
  blockers: string[];
  missingData: Array<{ key: string; label: string; count: number }>;
  summaryMetrics: ReportMetric[];
  columns: string[];
  rows: Array<Record<string, ReportRowValue>>;
  filtersUsed: ReportFilters & { dateFrom: string; dateTo: string };
}

interface DriveRecord {
  id: string;
  company: string;
  role: string | null;
  driveDate: string | null;
  visitDate: string | null;
  status: string;
  branchCriteria: string[];
  eligibleCount: number;
  sectorOrIndustry: string | null;
  ctcMinLpa: number | null;
  ctcMaxLpa: number | null;
  ctcFinalLpa: number | null;
  mouStatus: string | null;
  roundsConducted: string[];
  reportingNotes: string | null;
}

interface StudentRecord {
  id: string;
  fullName: string;
  email: string;
  rollNumber: string;
  branch: string;
  batch: string;
  cgpa: number;
  readinessScore: number;
}

interface ResultRecord {
  driveId: string;
  studentId: string;
  status: string;
  outcome: string;
  remarks: string | null;
  registered: boolean | null;
  appeared: boolean | null;
  shortlistedRound: string | null;
  offerDate: string | null;
  designationOffered: string | null;
  finalCtcLpa: number | null;
  joiningStatus: string | null;
  offerLetterReference: string | null;
  offerLetterUrl: string | null;
  joiningLetterUrl: string | null;
  selectionSource: "on_campus" | "off_campus" | "self_reported";
  verificationStatus: "pending" | "verified" | "rejected";
  sourceNote: string | null;
  nonPlacementReason: string | null;
  actionPlan: string | null;
  updatedAt: string | null;
  student: StudentRecord | null;
  drive: DriveRecord | null;
}

interface AttemptStat {
  studentId: string;
  attempts: number;
  averageScore: number;
}

const TEMPLATE_META: Array<{
  type: ReportType;
  title: string;
  audience: ReportAudienceExtended;
  group: ReportGroup;
  description: string;
}> = [
  { type: "drive_completion_summary", title: "Drive Report", audience: "Placement Office / Principal", group: "Must-have Reports", description: "Per-drive summary of eligible, appeared, shortlisted, selected, and final CTC." },
  { type: "weekly_placement_status", title: "Weekly Drive Activity Report", audience: "Principal / Director", group: "Must-have Reports", description: "Peak-season weekly update on drives conducted, offers made, and cumulative placed count." },
  { type: "monthly_branch_breakdown", title: "Monthly Branch Snapshot", audience: "HODs", group: "Operational Tracking", description: "Internal branch-wise participation view, useful mainly during peak season." },
  { type: "company_visit_register", title: "Company Visit Register", audience: "NAAC / NBA", group: "Must-have Reports", description: "Running visit log for companies, roles, CTC, outcomes, and NAAC-ready evidence tracking." },
  { type: "final_placement_statistics", title: "Season Placement Summary", audience: "All Authorities", group: "Must-have Reports", description: "End-of-season placement summary with placement %, offers, companies, and CTC." },
  { type: "naac_5_2_progression", title: "NAAC Placement Evidence Package", audience: "NAAC / NBA", group: "Compliance / Evidence", description: "Placement evidence export with student rows, offer proof readiness, and verification status." },
  { type: "branch_wise_placement_analysis", title: "Branch-wise Placement Breakdown", audience: "HODs", group: "Operational Tracking", description: "Branch-level placement and unplaced visibility, best used as an internal branch view." },
  { type: "placement_brochure_pack", title: "Marketing / Brochure Export", audience: "Management / Marketing", group: "Exports", description: "Marketing-oriented headline export, not a core TPO report." },
  { type: "unplaced_student_action_report", title: "Unplaced Student Tracker", audience: "Placement Office", group: "Operational Tracking", description: "Internal tracker for unplaced students, gaps, and follow-up actions." },
];

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2))
    : Number(sorted[middle].toFixed(2));
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "report";
}

function escapeCsvCell(value: ReportRowValue) {
  const raw = String(value ?? "");
  if (/[\",\\n\\r]/.test(raw)) {
    return `\"${raw.replace(/\"/g, '\"\"')}\"`;
  }
  return raw;
}

function uniqueCount(values: string[]) {
  return new Set(values.filter(Boolean)).size;
}

function renderPlacementPct(placed: number, total: number) {
  return total > 0 ? Number(((placed / total) * 100).toFixed(2)) : 0;
}

function dateWithin(dateValue: string | null | undefined, dateFrom: string, dateTo: string) {
  if (!dateValue) return false;
  const date = String(dateValue).slice(0, 10);
  return date >= dateFrom && date <= dateTo;
}

function resolveWindow(filters: ReportFilters) {
  if (filters.preset === "custom" && filters.dateFrom && filters.dateTo) {
    return { dateFrom: filters.dateFrom, dateTo: filters.dateTo, reportingPeriod: `${filters.dateFrom} to ${filters.dateTo}` };
  }

  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);

  if (filters.preset === "this_week") {
    const day = end.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setUTCDate(end.getUTCDate() - diff);
  } else if (filters.preset === "this_month") {
    start.setUTCDate(1);
  } else {
    const yearToken = String(filters.academicYear ?? end.getUTCFullYear());
    const yearMatch = yearToken.match(/\d{4}/);
    const startYear = yearMatch ? Number(yearMatch[0]) : end.getUTCFullYear();
    start.setUTCFullYear(startYear, 6, 1);
    end.setUTCFullYear(startYear + 1, 5, 30);
  }

  return { dateFrom: toIsoDate(start), dateTo: toIsoDate(end), reportingPeriod: `${toIsoDate(start)} to ${toIsoDate(end)}` };
}

async function loadReportDataset(tenantId: string) {
  const db = await getMongoDb();
  const [studentsRaw, users, drivesRaw, resultsRaw, attemptsRaw] = await Promise.all([
    db.collection("students").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, user_id: 1, roll_number: 1, branch: 1, batch: 1, cgpa: 1, readiness_score: 1 } },
    ).toArray(),
    db.collection("users").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, full_name: 1, email: 1 } },
    ).toArray(),
    db.collection("drives").find(
      { tenant_id: tenantId, deleted_at: null },
      {
        projection: {
          _id: 0,
          id: 1,
          company: 1,
          role: 1,
          drive_date: 1,
          visit_date: 1,
          sector_or_industry: 1,
          ctc_min_lpa: 1,
          ctc_max_lpa: 1,
          ctc_final_lpa: 1,
          rounds_conducted: 1,
          mou_status: 1,
          reporting_notes: 1,
          criteria: 1,
          status: 1,
          eligible_count: 1,
        },
      },
    ).toArray(),
    db.collection("drive_results").find(
      { tenant_id: tenantId },
      {
        projection: {
          _id: 0,
          drive_id: 1,
          student_id: 1,
          status: 1,
          outcome: 1,
          remarks: 1,
          registered: 1,
          appeared: 1,
          shortlisted_round: 1,
          offer_date: 1,
          designation_offered: 1,
          final_ctc_lpa: 1,
          joining_status: 1,
          offer_letter_reference: 1,
          offer_letter_url: 1,
          joining_letter_url: 1,
          selection_source: 1,
          verification_status: 1,
          source_note: 1,
          non_placement_reason: 1,
          action_plan: 1,
          updated_at: 1,
        },
      },
    ).toArray(),
    db.collection("student_attempts").find(
      { tenant_id: tenantId, status: "submitted" },
      { projection: { _id: 0, student_id: 1, score: 1 } },
    ).toArray(),
  ]);

  const userMap = new Map(users.map((user) => [String(user.id), user]));
  const studentMap = new Map<string, StudentRecord>();
  studentsRaw.forEach((student) => {
    const user = userMap.get(String(student.user_id));
    studentMap.set(String(student.id), {
      id: String(student.id),
      fullName: String(user?.full_name ?? ""),
      email: String(user?.email ?? ""),
      rollNumber: String(student.roll_number ?? ""),
      branch: String(student.branch ?? ""),
      batch: String(student.batch ?? ""),
      cgpa: Number(student.cgpa ?? 0),
      readinessScore: Number(student.readiness_score ?? 0),
    });
  });

  const driveMap = new Map<string, DriveRecord>();
  drivesRaw.forEach((drive) => {
    const criteria = (drive.criteria ?? {}) as { branches?: string[] };
    driveMap.set(String(drive.id), {
      id: String(drive.id),
      company: String(drive.company ?? ""),
      role: drive.role ? String(drive.role) : null,
      driveDate: drive.drive_date ? String(drive.drive_date) : null,
      visitDate: drive.visit_date ? String(drive.visit_date) : null,
      status: String(drive.status ?? "upcoming"),
      branchCriteria: Array.isArray(criteria.branches) ? criteria.branches.map((item) => String(item)) : [],
      eligibleCount: Number(drive.eligible_count ?? 0),
      sectorOrIndustry: drive.sector_or_industry ? String(drive.sector_or_industry) : null,
      ctcMinLpa: drive.ctc_min_lpa === undefined || drive.ctc_min_lpa === null ? null : Number(drive.ctc_min_lpa),
      ctcMaxLpa: drive.ctc_max_lpa === undefined || drive.ctc_max_lpa === null ? null : Number(drive.ctc_max_lpa),
      ctcFinalLpa: drive.ctc_final_lpa === undefined || drive.ctc_final_lpa === null ? null : Number(drive.ctc_final_lpa),
      mouStatus: drive.mou_status ? String(drive.mou_status) : null,
      roundsConducted: Array.isArray(drive.rounds_conducted) ? drive.rounds_conducted.map((item) => String(item)) : [],
      reportingNotes: drive.reporting_notes ? String(drive.reporting_notes) : null,
    });
  });

  const attemptScores = new Map<string, number[]>();
  attemptsRaw.forEach((attempt) => {
    const key = String(attempt.student_id);
    const list = attemptScores.get(key) ?? [];
    list.push(Number(attempt.score ?? 0));
    attemptScores.set(key, list);
  });

  const attemptStats = new Map<string, AttemptStat>();
  attemptScores.forEach((scores, studentId) => {
    attemptStats.set(studentId, {
      studentId,
      attempts: scores.length,
      averageScore: average(scores),
    });
  });

  const results: ResultRecord[] = resultsRaw.map((result) => ({
    driveId: String(result.drive_id),
    studentId: String(result.student_id),
    status: String(result.status ?? "eligible"),
    outcome: String(result.outcome ?? "pending"),
    remarks: result.remarks ? String(result.remarks) : null,
    registered: result.registered === undefined || result.registered === null ? null : Boolean(result.registered),
    appeared: result.appeared === undefined || result.appeared === null ? null : Boolean(result.appeared),
    shortlistedRound: result.shortlisted_round ? String(result.shortlisted_round) : null,
    offerDate: result.offer_date ? String(result.offer_date) : null,
    designationOffered: result.designation_offered ? String(result.designation_offered) : null,
    finalCtcLpa: result.final_ctc_lpa === undefined || result.final_ctc_lpa === null ? null : Number(result.final_ctc_lpa),
    joiningStatus: result.joining_status ? String(result.joining_status) : null,
    offerLetterReference: result.offer_letter_reference ? String(result.offer_letter_reference) : null,
    offerLetterUrl: result.offer_letter_url ? String(result.offer_letter_url) : null,
    joiningLetterUrl: result.joining_letter_url ? String(result.joining_letter_url) : null,
    selectionSource: (result.selection_source ? String(result.selection_source) : "on_campus") as ResultRecord["selectionSource"],
    verificationStatus: (result.verification_status ? String(result.verification_status) : "pending") as ResultRecord["verificationStatus"],
    sourceNote: result.source_note ? String(result.source_note) : null,
    nonPlacementReason: result.non_placement_reason ? String(result.non_placement_reason) : null,
    actionPlan: result.action_plan ? String(result.action_plan) : null,
    updatedAt: result.updated_at ? String(result.updated_at) : null,
    student: studentMap.get(String(result.student_id)) ?? null,
    drive: driveMap.get(String(result.drive_id)) ?? null,
  }));

  return { students: [...studentMap.values()], drives: [...driveMap.values()], results, attemptStats };
}

function applyReportFilters(
  dataset: Awaited<ReturnType<typeof loadReportDataset>>,
  filters: ReportFilters & { dateFrom: string; dateTo: string },
) {
  const driveIds = new Set(
    dataset.drives
      .filter((drive) => {
        if (filters.driveId && drive.id !== filters.driveId) return false;
        if (filters.company && !drive.company.toLowerCase().includes(filters.company.toLowerCase())) return false;
        if (filters.sector && !String(drive.sectorOrIndustry ?? "").toLowerCase().includes(filters.sector.toLowerCase())) return false;
        if (filters.driveStatus && drive.status !== filters.driveStatus) return false;
        return dateWithin(drive.visitDate ?? drive.driveDate, filters.dateFrom, filters.dateTo);
      })
      .map((drive) => drive.id),
  );

  const students = dataset.students.filter((student) => !filters.branch || student.branch === filters.branch);
  const studentIds = new Set(students.map((student) => student.id));
  const drives = dataset.drives.filter((drive) => driveIds.has(drive.id));
  const results = dataset.results.filter((result) => {
    if (!driveIds.has(result.driveId) || !studentIds.has(result.studentId)) return false;
    if (filters.placementSource && result.selectionSource !== filters.placementSource) return false;
    if (filters.verificationStatus && result.verificationStatus !== filters.verificationStatus) return false;
    if (filters.campusMode === "on_campus" && result.selectionSource !== "on_campus") return false;
    if (filters.campusMode === "off_campus" && result.selectionSource === "on_campus") return false;
    if (filters.includeOffCampus === false && result.selectionSource !== "on_campus") return false;
    return true;
  });

  return { students, drives, results, attemptStats: dataset.attemptStats };
}

function buildReadinessBlockers(type: ReportType, results: ResultRecord[], drives: DriveRecord[], students: StudentRecord[]) {
  const selectedResults = results.filter((result) => result.outcome === "selected");
  const missingOfferLetters = selectedResults.filter((result) => !result.offerLetterReference && !result.offerLetterUrl).length;
  const unverifiedOffCampus = selectedResults.filter((result) => result.selectionSource !== "on_campus" && result.verificationStatus !== "verified").length;
  const missingVisitMetadata = drives.filter((drive) => !drive.visitDate || !drive.sectorOrIndustry).length;
  const missingActionPlan = students.filter((student) => {
    const studentResults = results.filter((result) => result.studentId === student.id);
    return studentResults.every((result) => result.outcome !== "selected")
      && studentResults.some((result) => !result.actionPlan || !result.nonPlacementReason);
  }).length;

  const missingData = [
    { key: "missingOfferLetters", label: "Missing offer letters", count: missingOfferLetters },
    { key: "unverifiedOffCampus", label: "Off-campus confirmations pending", count: unverifiedOffCampus },
    { key: "missingVisitMetadata", label: "Drives missing visit metadata", count: missingVisitMetadata },
    { key: "missingActionPlan", label: "Unplaced students missing action plans", count: missingActionPlan },
  ].filter((item) => item.count > 0);

  const blockers: string[] = [];
  if (type === "naac_5_2_progression" && missingOfferLetters > 0) blockers.push(`${missingOfferLetters} selected records are missing offer proof references.`);
  if (type === "naac_5_2_progression" && unverifiedOffCampus > 0) blockers.push(`${unverifiedOffCampus} off-campus placements are not yet verified.`);
  if (type === "company_visit_register" && missingVisitMetadata > 0) blockers.push(`${missingVisitMetadata} drives need sector or visit-date metadata.`);
  if (type === "unplaced_student_action_report" && missingActionPlan > 0) blockers.push(`${missingActionPlan} unplaced students still need an action plan or reason.`);

  return { missingData, blockers, ready: blockers.length === 0 };
}

function summarizeForType(
  type: ReportType,
  data: ReturnType<typeof applyReportFilters>,
  reportingPeriod: string,
): Omit<PreparedReport, "generatedAt" | "filtersUsed"> {
  const meta = TEMPLATE_META.find((item) => item.type === type);
  if (!meta) throw new AppError("REPORT_TEMPLATE_NOT_FOUND", "Report template not found", 404);

  const selectedResults = data.results.filter((result) => result.outcome === "selected");
  const shortlistedResults = data.results.filter((result) => result.outcome === "shortlisted" || result.outcome === "selected");
  const registeredResults = data.results.filter((result) => result.registered === true || result.status === "applied" || result.outcome !== "pending");
  const appearedResults = data.results.filter((result) => result.appeared === true || ["shortlisted", "selected", "rejected"].includes(result.outcome));
  const ctcValues = selectedResults
    .map((result) => result.finalCtcLpa ?? result.drive?.ctcFinalLpa ?? result.drive?.ctcMaxLpa ?? result.drive?.ctcMinLpa ?? 0)
    .filter((value) => value > 0);
  const readiness = buildReadinessBlockers(type, data.results, data.drives, data.students);

  if (type === "drive_completion_summary") {
    const drive = data.drives[0] ?? null;
    const rows = data.results.map((result) => ({
      company: result.drive?.company ?? "",
      role: result.drive?.role ?? "",
      student_name: result.student?.fullName ?? "",
      roll_number: result.student?.rollNumber ?? "",
      branch: result.student?.branch ?? "",
      registered: result.registered ?? (result.status === "applied"),
      appeared: result.appeared ?? ["shortlisted", "selected", "rejected"].includes(result.outcome),
      outcome: result.outcome,
      final_ctc_lpa: result.finalCtcLpa ?? result.drive?.ctcFinalLpa ?? result.drive?.ctcMaxLpa ?? "",
      offer_reference: result.offerLetterReference ?? "",
      verification_status: result.verificationStatus,
    }));

    return {
      type,
      title: meta.title,
      audience: meta.audience,
      group: meta.group,
      reportingPeriod,
      ready: readiness.ready,
      blockers: readiness.blockers,
      missingData: readiness.missingData,
      summaryMetrics: [
        { label: "Company", value: drive?.company ?? "-" },
        { label: "Drive Date", value: drive?.visitDate ?? drive?.driveDate ?? "-" },
        { label: "Eligible", value: drive?.eligibleCount ?? data.results.length },
        { label: "Registered", value: registeredResults.length },
        { label: "Appeared", value: appearedResults.length },
        { label: "Shortlisted", value: shortlistedResults.length },
        { label: "Offers", value: selectedResults.length },
        { label: "Highest CTC", value: ctcValues.length ? Math.max(...ctcValues) : 0 },
      ],
      columns: ["company", "role", "student_name", "roll_number", "branch", "registered", "appeared", "outcome", "final_ctc_lpa", "offer_reference", "verification_status"],
      rows,
    };
  }

  if (type === "weekly_placement_status") {
    return {
      type,
      title: meta.title,
      audience: meta.audience,
      group: meta.group,
      reportingPeriod,
      ready: true,
      blockers: [],
      missingData: [],
      summaryMetrics: [
        { label: "Drives Conducted", value: data.drives.length },
        { label: "Offers Made", value: selectedResults.length },
        { label: "Unique Students Placed", value: uniqueCount(selectedResults.map((result) => result.studentId)) },
        { label: "Companies Visited", value: uniqueCount(data.drives.map((drive) => drive.company)) },
      ],
      columns: ["period", "drives_conducted", "offers_made", "unique_students_placed", "companies_visited"],
      rows: [{
        period: "selected_window",
        drives_conducted: data.drives.length,
        offers_made: selectedResults.length,
        unique_students_placed: uniqueCount(selectedResults.map((result) => result.studentId)),
        companies_visited: uniqueCount(data.drives.map((drive) => drive.company)),
      }],
    };
  }

  if (type === "monthly_branch_breakdown" || type === "branch_wise_placement_analysis") {
    const branches = [...new Set(data.students.map((student) => student.branch))];
    const rows = branches.map((branch) => {
      const branchStudents = data.students.filter((student) => student.branch === branch);
      const branchResults = data.results.filter((result) => result.student?.branch === branch);
      const placed = uniqueCount(branchResults.filter((result) => result.outcome === "selected").map((result) => result.studentId));
      const ctc = branchResults
        .filter((result) => result.outcome === "selected")
        .map((result) => result.finalCtcLpa ?? result.drive?.ctcFinalLpa ?? result.drive?.ctcMaxLpa ?? 0)
        .filter((value) => value > 0);
      return {
        branch,
        total_students: branchStudents.length,
        eligible_students: uniqueCount(branchResults.filter((result) => ["eligible", "applied"].includes(result.status)).map((result) => result.studentId)),
        registered_students: uniqueCount(branchResults.filter((result) => result.registered === true || result.status === "applied" || result.outcome !== "pending").map((result) => result.studentId)),
        appeared_students: uniqueCount(branchResults.filter((result) => result.appeared === true || ["shortlisted", "selected", "rejected"].includes(result.outcome)).map((result) => result.studentId)),
        placed_students: placed,
        placement_pct: renderPlacementPct(placed, branchStudents.length),
        average_ctc_lpa: average(ctc),
        top_recruiters: [...new Set(branchResults.filter((result) => result.outcome === "selected").map((result) => result.drive?.company ?? "").filter(Boolean))].slice(0, 3).join(", "),
        unplaced_students: branchStudents.filter((student) => !branchResults.some((result) => result.studentId === student.id && result.outcome === "selected")).map((student) => student.fullName).slice(0, 5).join(", "),
      };
    });

    return {
      type,
      title: meta.title,
      audience: meta.audience,
      group: meta.group,
      reportingPeriod,
      ready: true,
      blockers: [],
      missingData: [],
      summaryMetrics: [
        { label: "Branches Covered", value: branches.length },
        { label: "Total Students", value: data.students.length },
        { label: "Placed Students", value: uniqueCount(selectedResults.map((result) => result.studentId)) },
        { label: "Placement %", value: renderPlacementPct(uniqueCount(selectedResults.map((result) => result.studentId)), data.students.length) },
      ],
      columns: ["branch", "total_students", "eligible_students", "registered_students", "appeared_students", "placed_students", "placement_pct", "average_ctc_lpa", "top_recruiters", "unplaced_students"],
      rows,
    };
  }

  if (type === "company_visit_register") {
    const rows = data.drives.map((drive) => {
      const driveResults = data.results.filter((result) => result.driveId === drive.id);
      const offers = driveResults.filter((result) => result.outcome === "selected").length;
      const appeared = driveResults.filter((result) => result.appeared === true || ["shortlisted", "selected", "rejected"].includes(result.outcome)).length;
      return {
        company: drive.company,
        sector: drive.sectorOrIndustry ?? "",
        visit_date: drive.visitDate ?? drive.driveDate ?? "",
        roles_offered: drive.role ?? "",
        ctc_range_lpa: `${drive.ctcMinLpa ?? ""}${drive.ctcMaxLpa !== null ? ` - ${drive.ctcMaxLpa}` : ""}`,
        students_appeared: appeared,
        offers_made: offers,
        conversion_rate_pct: renderPlacementPct(offers, appeared),
        mou_status: drive.mouStatus ?? "not_started",
      };
    });

    return {
      type,
      title: meta.title,
      audience: meta.audience,
      group: meta.group,
      reportingPeriod,
      ready: readiness.ready,
      blockers: readiness.blockers,
      missingData: readiness.missingData,
      summaryMetrics: [
        { label: "Companies Logged", value: data.drives.length },
        { label: "Offers Made", value: selectedResults.length },
        { label: "Appeared", value: appearedResults.length },
      ],
      columns: ["company", "sector", "visit_date", "roles_offered", "ctc_range_lpa", "students_appeared", "offers_made", "conversion_rate_pct", "mou_status"],
      rows,
    };
  }

  if (type === "final_placement_statistics") {
    return {
      type,
      title: meta.title,
      audience: meta.audience,
      group: meta.group,
      reportingPeriod,
      ready: true,
      blockers: [],
      missingData: [],
      summaryMetrics: [
        { label: "Total Eligible Students", value: data.students.length },
        { label: "Total Placed", value: uniqueCount(selectedResults.map((result) => result.studentId)) },
        { label: "Placement %", value: renderPlacementPct(uniqueCount(selectedResults.map((result) => result.studentId)), data.students.length) },
        { label: "Total Offers", value: selectedResults.length },
        { label: "Total Companies Visited", value: uniqueCount(data.drives.map((drive) => drive.company)) },
        { label: "Highest CTC", value: ctcValues.length ? Math.max(...ctcValues) : 0 },
        { label: "Average CTC", value: average(ctcValues) },
        { label: "Median CTC", value: median(ctcValues) },
      ],
      columns: ["metric", "value"],
      rows: [
        { metric: "total_eligible_students", value: data.students.length },
        { metric: "total_placed", value: uniqueCount(selectedResults.map((result) => result.studentId)) },
        { metric: "placement_pct", value: renderPlacementPct(uniqueCount(selectedResults.map((result) => result.studentId)), data.students.length) },
        { metric: "total_offers", value: selectedResults.length },
        { metric: "total_companies_visited", value: uniqueCount(data.drives.map((drive) => drive.company)) },
        { metric: "highest_ctc", value: ctcValues.length ? Math.max(...ctcValues) : 0 },
        { metric: "average_ctc", value: average(ctcValues) },
        { metric: "median_ctc", value: median(ctcValues) },
      ],
    };
  }

  if (type === "naac_5_2_progression") {
    return {
      type,
      title: meta.title,
      audience: meta.audience,
      group: meta.group,
      reportingPeriod,
      ready: readiness.ready,
      blockers: readiness.blockers,
      missingData: readiness.missingData,
      summaryMetrics: [
        { label: "Selected Rows", value: selectedResults.length },
        { label: "Verified Rows", value: selectedResults.filter((result) => result.verificationStatus === "verified").length },
        { label: "Missing Proof", value: selectedResults.filter((result) => !result.offerLetterReference && !result.offerLetterUrl).length },
      ],
      columns: ["student_name", "roll_number", "branch", "company_name", "designation_offered", "ctc_lpa", "offer_letter_reference", "date_of_offer", "joining_status", "verification_status"],
      rows: selectedResults.map((result) => ({
        student_name: result.student?.fullName ?? "",
        roll_number: result.student?.rollNumber ?? "",
        branch: result.student?.branch ?? "",
        company_name: result.drive?.company ?? "",
        designation_offered: result.designationOffered ?? result.drive?.role ?? "",
        ctc_lpa: result.finalCtcLpa ?? result.drive?.ctcFinalLpa ?? result.drive?.ctcMaxLpa ?? "",
        offer_letter_reference: result.offerLetterReference ?? "",
        date_of_offer: result.offerDate ?? result.drive?.visitDate ?? result.drive?.driveDate ?? "",
        joining_status: result.joiningStatus ?? "pending",
        verification_status: result.verificationStatus,
      })),
    };
  }

  if (type === "placement_brochure_pack") {
    const recruiterCounts = new Map<string, number>();
    const sectorCounts = new Map<string, number>();
    selectedResults.forEach((result) => {
      recruiterCounts.set(result.drive?.company ?? "Unknown", (recruiterCounts.get(result.drive?.company ?? "Unknown") ?? 0) + 1);
      const sector = result.drive?.sectorOrIndustry ?? "Unspecified";
      sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
    });

    return {
      type,
      title: meta.title,
      audience: meta.audience,
      group: meta.group,
      reportingPeriod,
      ready: true,
      blockers: [],
      missingData: [],
      summaryMetrics: [
        { label: "Highest Package", value: ctcValues.length ? Math.max(...ctcValues) : 0 },
        { label: "Average Package", value: average(ctcValues) },
        { label: "Top Recruiters", value: recruiterCounts.size },
        { label: "Sector Buckets", value: sectorCounts.size },
      ],
      columns: ["section", "label", "value"],
      rows: [
        ...[...recruiterCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ section: "top_recruiters", label, value })),
        ...[...sectorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ section: "sector_distribution", label, value })),
      ],
    };
  }

  const unplacedRows = data.students
    .filter((student) => !data.results.some((result) => result.studentId === student.id && result.outcome === "selected"))
    .map((student) => {
      const studentResults = data.results.filter((result) => result.studentId === student.id);
      const attempts = data.attemptStats.get(student.id);
      const latestAction = studentResults.find((result) => result.actionPlan || result.nonPlacementReason);
      return {
        student_name: student.fullName,
        roll_number: student.rollNumber,
        branch: student.branch,
        drives_tracked: studentResults.length,
        drives_appeared: studentResults.filter((result) => result.appeared === true || ["shortlisted", "selected", "rejected"].includes(result.outcome)).length,
        average_mock_score: attempts?.averageScore ?? 0,
        reason_for_non_placement: latestAction?.nonPlacementReason ?? "",
        skill_gaps_identified: [
          student.readinessScore < 55 ? "low_readiness" : null,
          (attempts?.averageScore ?? 0) > 0 && (attempts?.averageScore ?? 0) < 60 ? "mock_scores" : null,
          studentResults.length === 0 ? "no_drive_history" : null,
        ].filter(Boolean).join(", "),
        action_plan: latestAction?.actionPlan ?? "",
      };
    });

  return {
    type,
    title: meta.title,
    audience: meta.audience,
    group: meta.group,
    reportingPeriod,
    ready: readiness.ready,
    blockers: readiness.blockers,
    missingData: readiness.missingData,
    summaryMetrics: [
      { label: "Unplaced Students", value: unplacedRows.length },
      { label: "With Action Plan", value: unplacedRows.filter((row) => String(row.action_plan)).length },
      { label: "Need TPO Follow-up", value: unplacedRows.filter((row) => !String(row.action_plan)).length },
    ],
    columns: ["student_name", "roll_number", "branch", "drives_tracked", "drives_appeared", "average_mock_score", "reason_for_non_placement", "skill_gaps_identified", "action_plan"],
    rows: unplacedRows,
  };
}

async function buildPdf(report: PreparedReport) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 44;
  const lineHeight = 16;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawLine = (text: string, opts?: { bold?: boolean; size?: number }) => {
    const usedFont = opts?.bold ? bold : font;
    const size = opts?.size ?? 11;
    if (y < margin + lineHeight) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(text, { x: margin, y, size, font: usedFont });
    y -= lineHeight;
  };

  drawLine(report.title, { bold: true, size: 16 });
  drawLine(`Audience: ${report.audience}`);
  drawLine(`Reporting period: ${report.reportingPeriod}`);
  drawLine(`Generated: ${report.generatedAt}`);
  drawLine("");

  drawLine("Summary", { bold: true, size: 13 });
  report.summaryMetrics.forEach((metric) => drawLine(`${metric.label}: ${String(metric.value ?? "-")}`));
  if (report.blockers.length > 0) {
    drawLine("");
    drawLine("Readiness blockers", { bold: true, size: 13 });
    report.blockers.forEach((blocker) => drawLine(`- ${blocker}`));
  }

  drawLine("");
  drawLine("Preview rows", { bold: true, size: 13 });
  report.rows.slice(0, 24).forEach((row, index) => {
    drawLine(`${index + 1}. ${report.columns.map((column) => `${column}: ${String(row[column] ?? "")}`).join(" | ")}`);
  });

  return Buffer.from(await pdf.save());
}

function buildCsv(report: PreparedReport) {
  const header = report.columns.join(",");
  const body = report.rows.map((row) => report.columns.map((column) => escapeCsvCell(row[column] ?? "")).join(","));
  return `${header}\n${body.join("\n")}\n`;
}

function buildXlsx(report: PreparedReport) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.summaryMetrics.map((metric) => ({ metric: metric.label, value: metric.value }))), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.rows), "Data");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

export const ReportService = {
  getTemplates() {
    return TEMPLATE_META.map((item) => ({
      ...item,
      exportFormats: ["xlsx", "pdf", "csv"],
    }));
  },

  async preview(tenantId: string, type: ReportType, rawFilters: ReportFilters) {
    const window = resolveWindow(rawFilters);
    const filters = { ...rawFilters, ...window };
    const dataset = await loadReportDataset(tenantId);
    const filtered = applyReportFilters(dataset, filters);
    return {
      ...summarizeForType(type, filtered, window.reportingPeriod),
      generatedAt: new Date().toISOString(),
      filtersUsed: filters,
    } satisfies PreparedReport;
  },

  async readiness(tenantId: string, type: ReportType, filters: ReportFilters) {
    const report = await this.preview(tenantId, type, filters);
    return {
      type: report.type,
      title: report.title,
      ready: report.ready,
      blockers: report.blockers,
      missingData: report.missingData,
      reportingPeriod: report.reportingPeriod,
      generatedAt: report.generatedAt,
      filtersUsed: report.filtersUsed,
    };
  },

  async export(tenantId: string, type: ReportType, filters: ReportFilters, format: "xlsx" | "pdf" | "csv") {
    const report = await this.preview(tenantId, type, filters);
    const filename = `${safeFilename(report.title)}-${report.generatedAt.slice(0, 10)}.${format}`;

    if (format === "csv") {
      return { filename, contentType: "text/csv; charset=utf-8", body: Buffer.from(buildCsv(report), "utf-8") };
    }

    if (format === "pdf") {
      return { filename, contentType: "application/pdf", body: await buildPdf(report) };
    }

    return {
      filename,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: buildXlsx(report),
    };
  },
};
