import "dotenv/config";

import { compare } from "bcryptjs";
import { StudentRepository } from "../src/repositories/student.repository.js";
import { ReportService } from "../src/services/report.service.js";
import { TpoControlCenterService } from "../src/services/tpo-control-center.service.js";
import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";

const TPO_EMAIL = "chetanawati@gmail.com";
const TPO_PASSWORD = "Demo@123";
const TENANT_SLUG = "school-of-engineering-and-technology-shivaji-university-kolhapur";
const BRANCHES = [
  "Computer Science and Technology",
  "Food Technology",
  "Cicvil Engineering",
  "Chemical Engineering",
  "Electronics and Telecommunication",
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const db = await getMongoDb();
  try {
    const tenant = await db.collection("tenants").findOne(
      { slug: TENANT_SLUG },
      { projection: { _id: 0, id: 1, slug: 1 } },
    );
    assert(tenant?.id, `Missing tenant ${TENANT_SLUG}`);

    const tpoUser = await db.collection("users").findOne(
      { email: TPO_EMAIL, role: "tpo", tenant_id: String(tenant.id) },
      { projection: { _id: 0, id: 1, tenant_id: 1, email: 1, full_name: 1, is_active: 1 } },
    );
    assert(tpoUser?.tenant_id, `Missing TPO user ${TPO_EMAIL}`);
    const tenantId = String(tpoUser.tenant_id);

    const passwordOk = await compare(
      TPO_PASSWORD,
      String((await db.collection("users").findOne(
        { email: TPO_EMAIL, role: "tpo", tenant_id: tenantId },
        { projection: { password_hash: 1 } },
      ))?.password_hash ?? ""),
    );
    assert(passwordOk, "TPO password verification failed");

    const branchAgg = await db.collection("students").aggregate([
      { $match: { tenant_id: tenantId } },
      { $group: { _id: "$branch", count: { $sum: 1 } } },
    ]).toArray();
    const branchCounts = new Map(branchAgg.map((row) => [String(row._id), Number(row.count)]));

    const [studentCount, driveCount, mockCount, sharedResourceCount, announcementCount, communicationCount, unlockCount, supportCount] = await Promise.all([
      db.collection("students").countDocuments({ tenant_id: tenantId }),
      db.collection("drives").countDocuments({ tenant_id: tenantId, deleted_at: null }),
      db.collection("mock_tests").countDocuments({ tenant_id: tenantId, is_active: true }),
      db.collection("shared_resources").countDocuments({ tenant_id: tenantId, is_active: true }),
      db.collection("announcements").countDocuments({ tenant_id: tenantId, status: "published" }),
      db.collection("communications").countDocuments({ tenant_id: tenantId }),
      db.collection("profile_unlock_requests").countDocuments({ tenant_id: tenantId, status: "pending" }),
      db.collection("student_support_requests").countDocuments({ tenant_id: tenantId, status: "open" }),
    ]);

    assert(studentCount === 200, `Expected 200 students, found ${studentCount}`);
    BRANCHES.forEach((branch) => assert(branchCounts.get(branch) === 40, `Expected 40 students in ${branch}, found ${branchCounts.get(branch) ?? 0}`));
    assert(driveCount >= 9, `Expected at least 9 drives, found ${driveCount}`);
    assert(mockCount >= 10, `Expected at least 10 active mock tests, found ${mockCount}`);
    assert(sharedResourceCount >= 50, `Expected at least 50 shared resources, found ${sharedResourceCount}`);
    assert(announcementCount >= 3, `Expected at least 3 announcements, found ${announcementCount}`);
    assert(communicationCount >= 2, `Expected at least 2 communications, found ${communicationCount}`);
    assert(unlockCount >= 1, `Expected at least 1 pending unlock request, found ${unlockCount}`);
    assert(supportCount >= 1, `Expected at least 1 open support request, found ${supportCount}`);

    const studentsPage = await StudentRepository.listStudentsForTpo(tenantId, {
      limit: 200,
      sortBy: "created_at",
      sortDir: "desc",
    });
    assert(Array.isArray(studentsPage.items), "Student list did not return items");
    assert(studentsPage.items.length === 200, `Expected 200 student rows, found ${studentsPage.items.length}`);

    studentsPage.items.slice(0, 12).forEach((row: any, index: number) => {
      assert(String(row.fullName ?? "").trim(), `Student row ${index} missing fullName`);
      assert(String(row.email ?? "").trim(), `Student row ${index} missing email`);
      assert(String(row.prn ?? "").trim(), `Student row ${index} missing prn`);
      assert(String(row.rollNumber ?? "").trim(), `Student row ${index} missing rollNumber`);
      assert(String(row.branch ?? "").trim(), `Student row ${index} missing branch`);
      assert(String(row.batch ?? "").trim(), `Student row ${index} missing batch`);
      assert(Number.isFinite(Number(row.cgpa)), `Student row ${index} missing cgpa`);
      assert(Number.isFinite(Number(row.attendancePct)), `Student row ${index} missing attendancePct`);
      assert(Number.isFinite(Number(row.backlogs)), `Student row ${index} missing backlogs`);
      assert(Number.isFinite(Number(row.readinessScore)), `Student row ${index} missing readinessScore`);
      assert(Number(row.profileCompletenessPct) >= 100, `Student row ${index} completeness below 100`);
      assert(row.hasResumeReady === true, `Student row ${index} not resume-ready`);
      assert(row.isProfileCertified === true, `Student row ${index} not certified`);
    });

    const sampleIds = studentsPage.items.slice(0, 3).map((row: any) => String(row.id));
    for (const studentId of sampleIds) {
      const detail = await StudentRepository.getStudentByIdForTpo(tenantId, studentId);
      assert(detail, `Missing student detail for ${studentId}`);
      assert(String(detail.profileData?.prn ?? "").trim(), `Student detail ${studentId} missing profile prn`);
      assert(String(detail.profileData?.degree ?? "").trim(), `Student detail ${studentId} missing degree`);
      assert(String(detail.profileData?.currentSemester ?? "").trim(), `Student detail ${studentId} missing semester`);
      assert(detail.engagementSummary, `Student detail ${studentId} missing engagement summary`);
      assert(Array.isArray(detail.driveParticipation) && detail.driveParticipation.length > 0, `Student detail ${studentId} missing drive participation`);
    }

    const controlCenter: any = await TpoControlCenterService.getControlCenter(tenantId);
    assert(controlCenter.summary?.totalStudents === 200, `Control center totalStudents mismatch: ${controlCenter.summary?.totalStudents}`);
    assert(Number(controlCenter.summary?.totalDrives) > 0, "Control center totalDrives is empty");
    assert(Number(controlCenter.readinessFunnel?.totalStudents) === 200, "Readiness funnel totalStudents mismatch");
    assert(Array.isArray(controlCenter.nextBestActions) && controlCenter.nextBestActions.length > 0, "Missing next best actions");
    assert(controlCenter.dashboardQueues, "Missing dashboard queues");
    assert(controlCenter.pilotProof, "Missing pilotProof block");
    assert(Number(controlCenter.pilotProof.metrics?.activatedStudents7d?.pct) >= 0, "Missing pilotProof activatedStudents7d metric");
    assert(Number(controlCenter.pilotProof.metrics?.announcementReadRate?.pct) >= 0, "Missing pilotProof announcementReadRate metric");

    const templates = ReportService.getTemplates();
    const reportChecks: Array<{ type: string; rows: number; xlsx: number; csv: number; pdf: number }> = [];
    for (const template of templates) {
      const preview = await ReportService.preview(tenantId, template.type as any, {
        preset: "academic_year",
        academicYear: "2025-2026",
      });
      if (template.type !== "employer_data_register") {
        assert(preview.ready === true, `Report ${template.type} is not ready: ${preview.blockers.join("; ")}`);
      }
      assert(Array.isArray(preview.rows) && preview.rows.length > 0, `Report ${template.type} returned no rows`);
      const xlsx = await ReportService.export(tenantId, template.type as any, { preset: "academic_year", academicYear: "2025-2026" }, "xlsx");
      const supportsCsv = template.exportFormats.includes("csv");
      const supportsPdf = template.exportFormats.includes("pdf");
      const csv = supportsCsv
        ? await ReportService.export(tenantId, template.type as any, { preset: "academic_year", academicYear: "2025-2026" }, "csv")
        : null;
      const pdf = supportsPdf
        ? await ReportService.export(tenantId, template.type as any, { preset: "academic_year", academicYear: "2025-2026" }, "pdf")
        : null;
      assert(xlsx.body.length > 0, `Report ${template.type} xlsx export empty`);
      if (csv) assert(csv.body.length > 0, `Report ${template.type} csv export empty`);
      if (pdf) assert(pdf.body.length > 0, `Report ${template.type} pdf export empty`);
      reportChecks.push({ type: template.type, rows: preview.rows.length, xlsx: xlsx.body.length, csv: csv?.body.length ?? 0, pdf: pdf?.body.length ?? 0 });
    }

    console.log(JSON.stringify({
      ok: true,
      tenantId,
      tpoEmail: TPO_EMAIL,
      students: studentCount,
      branches: Object.fromEntries(BRANCHES.map((branch) => [branch, branchCounts.get(branch) ?? 0])),
      drives: driveCount,
      mockTests: mockCount,
      sharedResources: sharedResourceCount,
      announcements: announcementCount,
      communications: communicationCount,
      unlockRequests: unlockCount,
      supportRequests: supportCount,
      reports: reportChecks,
    }, null, 2));
  } finally {
    await closeMongoConnection();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});


