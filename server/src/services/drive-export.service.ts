import { PDFDocument, StandardFonts } from "pdf-lib";

import { AppError } from "../middleware/error-handler.js";
import { DriveRepository } from "../repositories/drive.repository.js";

function escapeCsvCell(value: string) {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

function safeFilename(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "drive";
}

export const DriveExportService = {
  async buildEligibleCsv(tenantId: string, driveId: string) {
    const drive = await DriveRepository.getDriveById(tenantId, driveId);
    const rows = drive.results ?? [];

    if (rows.length === 0) {
      throw new AppError(
        "DRIVE_EXPORT_NO_ELIGIBILITY",
        "No eligible students found for this drive yet. Run 'Compute Eligibility' first.",
        409,
      );
    }

    const header = [
      "full_name",
      "email",
      "roll_number",
      "branch",
      "batch",
      "cgpa",
      "backlogs",
      "attendance_pct",
      "readiness_score",
      "outcome",
      "remarks",
      "updated_at",
    ].join(",");

    const lines = rows.map((student) => [
      escapeCsvCell(student.fullName),
      escapeCsvCell(student.email),
      escapeCsvCell(student.rollNumber),
      escapeCsvCell(student.branch),
      escapeCsvCell(student.batch),
      String(Number(student.cgpa ?? 0)),
      String(Number(student.backlogs ?? 0)),
      String(Number(student.attendancePct ?? 0)),
      String(Number(student.readinessScore ?? 0)),
      escapeCsvCell(String(student.outcome ?? "")),
      escapeCsvCell(student.remarks ? String(student.remarks) : ""),
      escapeCsvCell(String(student.updatedAt ?? "")),
    ].join(","));

    const csv = `${header}\n${lines.join("\n")}\n`;
    const filename = `${safeFilename(drive.company)}-${safeFilename(drive.role ?? "drive")}-eligible.csv`;

    return { filename, csv };
  },

  async buildResumeCsv(tenantId: string, driveId: string) {
    const drive = await DriveRepository.getDriveById(tenantId, driveId);
    const rows = await DriveRepository.listDriveResumeExportRows(tenantId, driveId);

    if (rows.length === 0) {
      throw new AppError(
        "DRIVE_EXPORT_NO_RESUMES",
        "No applied students with stored resume snapshots were found for this drive yet.",
        409,
      );
    }

    const header = [
      "name",
      "roll_number",
      "email",
      "branch",
      "cgpa",
      "application_state",
      "outcome",
      "resume_filename",
      "resume_url",
    ].join(",");

    const lines = rows.map((student) => [
      escapeCsvCell(student.fullName),
      escapeCsvCell(student.rollNumber),
      escapeCsvCell(student.email),
      escapeCsvCell(student.branch),
      String(Number(student.cgpa ?? 0)),
      escapeCsvCell(student.applicationState),
      escapeCsvCell(student.outcome),
      escapeCsvCell(student.resumeFilename ?? ""),
      escapeCsvCell(student.resumeUrl),
    ].join(","));

    return {
      filename: `${safeFilename(drive.company)}-${safeFilename(drive.role ?? "drive")}-resumes.csv`,
      csv: `${header}\n${lines.join("\n")}\n`,
    };
  },

  async buildSummaryPdf(tenantId: string, driveId: string) {
    const drive = await DriveRepository.getDriveById(tenantId, driveId);
    const latestSnapshot = drive.eligibility?.snapshots?.[0] ?? null;

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const margin = 48;
    const lineHeight = 16;
    const pageWidth = 612;
    const pageHeight = 792;

    let page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    const drawLine = (text: string, options?: { bold?: boolean; size?: number }) => {
      const size = options?.size ?? 12;
      const usedFont = options?.bold ? fontBold : font;
      const maxWidth = pageWidth - margin * 2;

      const words = String(text ?? "").split(/\s+/).filter(Boolean);
      let current = "";

      const flush = (line: string) => {
        if (y < margin + lineHeight) {
          page = pdf.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(line, { x: margin, y, size, font: usedFont });
        y -= lineHeight;
      };

      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        const width = usedFont.widthOfTextAtSize(next, size);
        if (width > maxWidth && current) {
          flush(current);
          current = word;
        } else {
          current = next;
        }
      }
      if (current) {
        flush(current);
      }
    };

    const title = `${drive.company}${drive.role ? ` - ${drive.role}` : ""}`;
    drawLine("Smart Path Drive Export Summary", { bold: true, size: 16 });
    drawLine(title, { bold: true, size: 14 });
    drawLine(`Drive date: ${drive.driveDate}`);
    drawLine(`Generated at: ${new Date().toISOString()}`);
    drawLine("");

    drawLine("Eligibility Snapshot", { bold: true, size: 13 });
    if (latestSnapshot) {
      drawLine(`Latest version: v${latestSnapshot.version} (${latestSnapshot.computedAt})`);
      drawLine(`Eligible: ${latestSnapshot.eligibleCount} / ${latestSnapshot.totalStudents}`);
      drawLine(`Ineligible: ${latestSnapshot.ineligibleCount}`);
    } else {
      drawLine("No eligibility snapshot found yet. Run 'Compute Eligibility' to generate one.");
    }
    drawLine("");

    drawLine("Outcome Snapshot", { bold: true, size: 13 });
    const participants = (drive.results ?? []).map((row) => ({
      status: String((row as { status?: unknown }).status ?? ""),
      outcome: String((row as { outcome?: unknown }).outcome ?? ""),
    }));
    const appliedCount = participants.filter((row) => row.status === "applied" || (row.outcome && row.outcome !== "pending")).length;
    const pendingCount = participants.filter((row) => row.outcome === "pending").length;
    const shortlistedCount = participants.filter((row) => row.outcome === "shortlisted").length;
    const selectedCount = participants.filter((row) => row.outcome === "selected").length;
    const rejectedCount = participants.filter((row) => row.outcome === "rejected").length;
    drawLine(`Participants tracked: ${participants.length}`);
    drawLine(`Applied/in process: ${appliedCount}`);
    drawLine(`Pending: ${pendingCount}`);
    drawLine(`Shortlisted: ${shortlistedCount}`);
    drawLine(`Selected: ${selectedCount}`);
    drawLine(`Rejected: ${rejectedCount}`);
    drawLine("");

    drawLine("Criteria", { bold: true, size: 13 });
    const criteria = drive.criteria ?? {};
    drawLine(`Min CGPA: ${criteria.minCgpa ?? "-"}`);
    drawLine(`Max Active Backlogs: ${(criteria.maxActiveBacklogs ?? criteria.maxBacklogs) ?? "-"}`);
    drawLine(`Max Total Backlogs: ${criteria.maxTotalBacklogs ?? "-"}`);
    drawLine(`10th Marks Min: ${criteria.tenthMarksMin ?? "-"}`);
    drawLine(`10th Marks Max: ${criteria.tenthMarksMax ?? "-"}`);
    drawLine(`12th Marks Min: ${criteria.twelfthMarksMin ?? "-"}`);
    drawLine(`12th Marks Max: ${criteria.twelfthMarksMax ?? "-"}`);
    drawLine(`Diploma Marks Min: ${criteria.diplomaMarksMin ?? "-"}`);
    drawLine(`Diploma Marks Max: ${criteria.diplomaMarksMax ?? "-"}`);
    drawLine(`Min Attendance: ${criteria.minAttendance ?? "-"}`);
    drawLine(`Min Readiness: ${criteria.readinessMin ?? "-"}`);
    drawLine(`Min Profile Completeness: ${criteria.profileCompletenessMin ?? "-"}`);
    drawLine(`Resume Required: ${criteria.hasResume === undefined ? "-" : criteria.hasResume ? "Yes" : "No"}`);
    drawLine(`Profile Certified Required: ${criteria.isCertified === undefined ? "-" : criteria.isCertified ? "Yes" : "No"}`);
    drawLine(`Resource Access Required: ${criteria.canAccessResources === undefined ? "-" : criteria.canAccessResources ? "Yes" : "No"}`);
    drawLine(`Mock Test Access Required: ${criteria.canAccessMockTests === undefined ? "-" : criteria.canAccessMockTests ? "Yes" : "No"}`);
    drawLine(`Branches: ${criteria.branches?.length ? criteria.branches.join(", ") : "-"}`);
    drawLine(`Exclude Already Placed: ${criteria.excludePlacedStudents ? "Yes" : "No"}`);
    drawLine("");

    if (latestSnapshot?.reasons?.length) {
      drawLine("Top Ineligibility Reasons", { bold: true, size: 13 });
      latestSnapshot.reasons.forEach((reason) => {
        drawLine(`${reason.label}: ${reason.count}`);
      });
      drawLine("");
    }

    drawLine("Eligible Students (preview)", { bold: true, size: 13 });
    const eligible = drive.results ?? [];
    if (eligible.length === 0) {
      drawLine("No eligible students stored yet. Compute eligibility first.");
    } else {
      eligible.slice(0, 30).forEach((student, index) => {
        drawLine(
          `${index + 1}. ${student.fullName} | ${student.branch} | CGPA ${Number(student.cgpa ?? 0).toFixed(2)} | ${student.email}`,
        );
      });
      if (eligible.length > 30) {
        drawLine(`...and ${eligible.length - 30} more.`);
      }
    }

    const bytes = await pdf.save();
    const filename = `${safeFilename(drive.company)}-${safeFilename(drive.role ?? "drive")}-summary.pdf`;

    return { filename, bytes };
  },
};
