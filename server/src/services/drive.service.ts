import {
  DriveRepository,
  buildDriveCriteriaDigest,
  normalizeDriveLifecycle,
  type DriveApplicationState,
  type DriveLifecycle,
  type DriveResultRound,
} from "../repositories/drive.repository.js";
import { EligibilityService } from "./eligibility.service.js";
import { AppError } from "../middleware/error-handler.js";
import { StudentActivityService } from "./student-activity.service.js";
import { AuditLogService } from "./audit-log.service.js";
import { CommunicationService } from "./communication.service.js";
import { getMongoDb } from "../utils/mongodb.js";
import { buildStudentDeclarationStatus } from "../utils/student-declaration.js";
import { normalizeStudentProfileData } from "../utils/student-profile.js";

const VALID_TRANSITIONS: Record<DriveLifecycle, DriveLifecycle[]> = {
  draft: ["published", "cancelled"],
  published: ["draft", "registration_closed", "cancelled"],
  registration_closed: ["in_process", "cancelled"],
  in_process: ["results_pending", "completed", "cancelled"],
  results_pending: ["completed", "cancelled"],
  completed: ["archived"],
  archived: [],
  cancelled: [],
};

function assertStatusTransition(currentStatus: DriveLifecycle, nextStatus: DriveLifecycle) {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!VALID_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new AppError(
      "INVALID_DRIVE_STATE_TRANSITION",
      `Cannot transition drive from ${currentStatus} to ${nextStatus}`,
      409,
    );
  }
}

type ReleaseAudience = "selected" | "rejected" | "finalized";

type ResultNotificationRow = Awaited<ReturnType<typeof DriveRepository.listDriveResults>>[number];
type DriveOutcome = "pending" | "shortlisted" | "selected" | "rejected";

function requiresPreviewForStatus(status: DriveLifecycle) {
  return status !== "draft" && status !== "cancelled";
}

const VALID_OUTCOME_TRANSITIONS: Record<DriveOutcome, DriveOutcome[]> = {
  pending: ["pending", "shortlisted", "selected", "rejected"],
  shortlisted: ["shortlisted", "selected", "rejected"],
  selected: ["selected"],
  rejected: ["rejected"],
};

function formatDriveName(drive: { company: string; role: string | null }) {
  return `${drive.company}${drive.role ? ` - ${drive.role}` : ""}`;
}

function daysUntilDrive(dateIso: string): number | null {
  if (!dateIso) return null;
  const target = new Date(dateIso);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

async function loadEligibleStudentNotificationState(tenantId: string, studentIds: string[]) {
  const ids = [...new Set(studentIds.map(String).filter(Boolean))];
  if (ids.length === 0) {
    return new Map<string, { hasResume: boolean; isCertified: boolean }>();
  }

  const db = await getMongoDb();
  const students = await db.collection("students").find(
    { tenant_id: tenantId, id: { $in: ids } },
    { projection: { _id: 0, id: 1, roll_number: 1, profile_data: 1 } },
  ).toArray();

  return new Map(
    students.map((student) => {
      const normalizedProfile = normalizeStudentProfileData(student.profile_data);
      const declarationStatus = buildStudentDeclarationStatus({
        student: student as Record<string, unknown>,
        user: { full_name: "", email: "" },
      });
      return [
        String(student.id),
        {
          hasResume: Boolean(normalizedProfile.resumeDriveWebLink || normalizedProfile.resumeUrl),
          isCertified: declarationStatus.profileCertification.isCertified,
        },
      ] as const;
    }),
  );
}

async function publishDriveStudentAnnouncements(params: {
  tenantId: string;
  senderId: string;
  driveId: string;
  company: string;
  role: string | null;
  driveDate: string;
  eligibleStudents: Array<{ id: string }>;
  previousResults: ResultNotificationRow[];
}) {
  const driveName = formatDriveName({ company: params.company, role: params.role });
  const daysRemaining = daysUntilDrive(params.driveDate);
  const previousEligibleIds = new Set(
    params.previousResults
      .filter((row) => row.status === "eligible" || row.applicationState === "applied")
      .map((row) => row.id),
  );
  const appliedStudentIds = new Set(
    params.previousResults
      .filter((row) => row.applicationState === "applied")
      .map((row) => row.id),
  );
  const stateMap = await loadEligibleStudentNotificationState(
    params.tenantId,
    params.eligibleStudents.map((student) => student.id),
  );

  const newlyEligibleReadyIds: string[] = [];
  const newlyEligibleResumeBlockedIds: string[] = [];
  const newlyEligibleCertificationBlockedIds: string[] = [];
  const newlyEligibleFullyBlockedIds: string[] = [];
  const deadlineReadyIds: string[] = [];
  const deadlineBlockedIds: string[] = [];

  for (const student of params.eligibleStudents) {
    const state = stateMap.get(student.id) ?? { hasResume: false, isCertified: false };
    const wasEligibleBefore = previousEligibleIds.has(student.id);
    const canApplyNow = state.hasResume && state.isCertified;
    const isApplied = appliedStudentIds.has(student.id);

    if (!wasEligibleBefore) {
      if (canApplyNow) newlyEligibleReadyIds.push(student.id);
      else if (!state.hasResume && !state.isCertified) newlyEligibleFullyBlockedIds.push(student.id);
      else if (!state.hasResume) newlyEligibleResumeBlockedIds.push(student.id);
      else newlyEligibleCertificationBlockedIds.push(student.id);
    }

    if (daysRemaining !== null && daysRemaining <= 3 && !isApplied) {
      if (canApplyNow) deadlineReadyIds.push(student.id);
      else deadlineBlockedIds.push(student.id);
    }
  }

  if (newlyEligibleReadyIds.length > 0) {
    await CommunicationService.publishSystemAnnouncementToStudents({
      tenantId: params.tenantId,
      senderId: params.senderId,
      studentIds: newlyEligibleReadyIds,
      systemKey: `drive-eligible-ready:${params.driveId}`,
      title: `You are eligible for ${driveName}`,
      message: `You now match the current criteria for ${driveName}. Open Drives and apply while registration is still open.`,
      priority: "important",
      relatedDriveId: params.driveId,
    });
  }

  if (newlyEligibleResumeBlockedIds.length > 0) {
    await CommunicationService.publishSystemAnnouncementToStudents({
      tenantId: params.tenantId,
      senderId: params.senderId,
      studentIds: newlyEligibleResumeBlockedIds,
      systemKey: `drive-eligible-resume-blocked:${params.driveId}`,
      title: `Upload your resume for ${driveName}`,
      message: `You match the criteria for ${driveName}, but you still need to upload your resume before you can apply.`,
      priority: "important",
      relatedDriveId: params.driveId,
    });
  }

  if (newlyEligibleCertificationBlockedIds.length > 0) {
    await CommunicationService.publishSystemAnnouncementToStudents({
      tenantId: params.tenantId,
      senderId: params.senderId,
      studentIds: newlyEligibleCertificationBlockedIds,
      systemKey: `drive-eligible-certification-blocked:${params.driveId}`,
      title: `Certify your profile for ${driveName}`,
      message: `You match the criteria for ${driveName}, but you still need to certify your profile before you can apply.`,
      priority: "important",
      relatedDriveId: params.driveId,
    });
  }

  if (newlyEligibleFullyBlockedIds.length > 0) {
    await CommunicationService.publishSystemAnnouncementToStudents({
      tenantId: params.tenantId,
      senderId: params.senderId,
      studentIds: newlyEligibleFullyBlockedIds,
      systemKey: `drive-eligible-fully-blocked:${params.driveId}`,
      title: `Complete your profile steps for ${driveName}`,
      message: `You match the criteria for ${driveName}, but you still need both a certified profile and an uploaded resume before you can apply.`,
      priority: "important",
      relatedDriveId: params.driveId,
    });
  }

  if (deadlineReadyIds.length > 0) {
    await CommunicationService.publishSystemAnnouncementToStudents({
      tenantId: params.tenantId,
      senderId: params.senderId,
      studentIds: deadlineReadyIds,
      systemKey: `drive-deadline-ready:${params.driveId}`,
      title: `Deadline approaching for ${driveName}`,
      message: `This drive closes soon${daysRemaining === null ? "." : ` in ${daysRemaining} day(s).`} Your profile is ready, so apply now if you want this opportunity.`,
      priority: "urgent",
      relatedDriveId: params.driveId,
      showPopup: true,
    });
  }

  if (deadlineBlockedIds.length > 0) {
    await CommunicationService.publishSystemAnnouncementToStudents({
      tenantId: params.tenantId,
      senderId: params.senderId,
      studentIds: deadlineBlockedIds,
      systemKey: `drive-deadline-blocked:${params.driveId}`,
      title: `Deadline approaching: action needed for ${driveName}`,
      message: `This drive closes soon${daysRemaining === null ? "." : ` in ${daysRemaining} day(s).`} Complete the missing resume or certification step now if you want to apply.`,
      priority: "urgent",
      relatedDriveId: params.driveId,
      showPopup: true,
    });
  }
}

function pickReleaseRows(
  rows: ResultNotificationRow[],
  audience: ReleaseAudience,
) {
  if (audience === "selected") {
    return rows.filter((row) => row.outcome === "selected");
  }
  if (audience === "rejected") {
    return rows.filter((row) => row.outcome === "rejected");
  }
  return rows.filter((row) => row.outcome === "selected" || row.outcome === "rejected");
}

function buildSelectedRecipientVariables(
  row: ResultNotificationRow,
  drive: { company: string; role: string | null },
  driveName: string,
  collegeName: string,
) {
  const designation = String(row.designationOffered ?? "").trim();
  const offerDate = String(row.offerDate ?? "").trim();
  const ctc = row.finalCtcLpa !== null && row.finalCtcLpa !== undefined ? String(row.finalCtcLpa) : "";
  const offerLetterReference = String(row.offerLetterReference ?? "").trim();
  const offerLetterLink = String(row.offerLetterUrl ?? "").trim();

  return {
    student_name: row.fullName,
    drive_name: driveName,
    company_name: drive.company,
    role_name: drive.role ?? "",
    designation_offered: designation,
    offer_date: offerDate,
    final_ctc_lpa: ctc,
    offer_letter_reference: offerLetterReference,
    offer_letter_link: offerLetterLink,
    college_name: collegeName,
    designation_line: designation ? `Designation: ${designation}` : "Designation details will be shared by the placement cell.",
    offer_date_line: offerDate ? `Offer date: ${offerDate}` : "Offer date will be shared once confirmed by the employer.",
    ctc_line: ctc ? `CTC (LPA): ${ctc}` : "CTC details will follow once confirmed by the employer.",
    offer_letter_line: offerLetterLink || offerLetterReference
      ? `Offer letter: ${offerLetterLink || offerLetterReference}`
      : "Offer letter will be shared by the placement cell once received from the employer.",
  };
}

function buildRejectedRecipientVariables(
  row: ResultNotificationRow,
  drive: { company: string; role: string | null },
  driveName: string,
  collegeName: string,
) {
  return {
    student_name: row.fullName,
    drive_name: driveName,
    company_name: drive.company,
    role_name: drive.role ?? "",
    college_name: collegeName,
  };
}

function assertOutcomeTransition(
  currentOutcome: DriveOutcome,
  nextOutcome: DriveOutcome,
  allowOverride = false,
) {
  if (allowOverride || currentOutcome === nextOutcome) {
    return;
  }

  if (!VALID_OUTCOME_TRANSITIONS[currentOutcome].includes(nextOutcome)) {
    throw new AppError(
      "INVALID_DRIVE_RESULT_TRANSITION",
      `Cannot transition drive outcome from ${currentOutcome} to ${nextOutcome} without an explicit override.`,
      409,
    );
  }
}

export const DriveService = {
  async listDrives(
    tenantId: string,
    query: {
      limit: number;
      cursor?: string;
      status?: DriveLifecycle;
    },
  ) {
    return DriveRepository.listDrives(tenantId, query);
  },

  async createDrive(
    tenantId: string,
    createdBy: string,
    input: {
      company: string;
      role?: string;
      driveDate: string;
      sectorOrIndustry?: string;
      ctcMinLpa?: number;
      ctcMaxLpa?: number;
      ctcFinalLpa?: number;
      visitDate?: string;
      roundsConducted?: string[];
      mouStatus?: "not_started" | "in_discussion" | "signed" | "not_applicable";
      reportingNotes?: string;
      registrationInstructions?: string;
      requiredDocuments?: string[];
      location?: string;
      mode?: "on_campus" | "off_campus" | "hybrid";
      dressCode?: string;
      previewDigest?: string;
      criteria: {
        minCgpa?: number;
        maxBacklogs?: number;
        maxActiveBacklogs?: number;
        maxTotalBacklogs?: number;
        branches?: string[];
        minAttendance?: number;
        excludePlacedStudents?: boolean;
      };
      status: DriveLifecycle;
    },
  ) {
    const requestedStatus = normalizeDriveLifecycle(input.status);
    const criteriaDigest = buildDriveCriteriaDigest(input.criteria);
    if (requiresPreviewForStatus(requestedStatus) && input.previewDigest !== criteriaDigest) {
      throw new AppError("DRIVE_PREVIEW_REVIEW_REQUIRED", "Run and review eligibility preview before publishing this drive.", 409);
    }

    return DriveRepository.createDrive(tenantId, createdBy, input);
  },

  async previewEligibility(
    tenantId: string,
    criteria: {
      minCgpa?: number;
      maxBacklogs?: number;
      maxActiveBacklogs?: number;
      maxTotalBacklogs?: number;
      branches?: string[];
      minAttendance?: number;
      excludePlacedStudents?: boolean;
    },
  ) {
    return EligibilityService.preview(tenantId, criteria);
  },

  async getDriveById(tenantId: string, driveId: string) {
    return DriveRepository.getDriveById(tenantId, driveId);
  },

  async updateDrive(
    tenantId: string,
    driveId: string,
    updates: Partial<{
      company: string;
      role: string;
      driveDate: string;
      sectorOrIndustry: string;
      ctcMinLpa: number;
      ctcMaxLpa: number;
      ctcFinalLpa: number;
      visitDate: string;
      roundsConducted: string[];
      mouStatus: "not_started" | "in_discussion" | "signed" | "not_applicable";
      reportingNotes: string;
      registrationInstructions: string;
      requiredDocuments: string[];
      location: string;
      mode: "on_campus" | "off_campus" | "hybrid";
      dressCode: string;
      previewDigest: string;
      criteria: {
        minCgpa?: number;
        maxBacklogs?: number;
        maxActiveBacklogs?: number;
        maxTotalBacklogs?: number;
        branches?: string[];
        minAttendance?: number;
        excludePlacedStudents?: boolean;
      };
      status: DriveLifecycle;
    }>,
  ) {
    const existing = await DriveRepository.getDriveById(tenantId, driveId);
    const currentStatus = normalizeDriveLifecycle(existing.status);

    if (updates.status) {
      const nextStatus = normalizeDriveLifecycle(updates.status);
      assertStatusTransition(currentStatus, nextStatus);
    }

    const nextCriteria = updates.criteria ?? existing.criteria;
    const nextStatus = normalizeDriveLifecycle(updates.status ?? currentStatus);
    const criteriaChanged = updates.criteria !== undefined;
    const patch: typeof updates = { ...updates };

    if (criteriaChanged && currentStatus !== "draft" && currentStatus !== "cancelled") {
      patch.status = "draft";
      patch.previewDigest = "";
    }

    const effectiveStatus = normalizeDriveLifecycle(patch.status ?? nextStatus);
    const nextDigest = buildDriveCriteriaDigest(nextCriteria);
    if (requiresPreviewForStatus(effectiveStatus) && patch.previewDigest !== nextDigest && existing.previewDigest !== nextDigest) {
      throw new AppError("DRIVE_PREVIEW_REVIEW_REQUIRED", "Review eligibility preview again before moving this drive forward.", 409);
    }

    if (!patch.previewDigest && existing.previewDigest === nextDigest && requiresPreviewForStatus(effectiveStatus)) {
      patch.previewDigest = existing.previewDigest ?? undefined;
    }

    return DriveRepository.updateDrive(tenantId, driveId, patch);
  },

  async deleteDrive(tenantId: string, driveId: string) {
    await DriveRepository.softDeleteDrive(tenantId, driveId);
  },

  async computeEligibility(tenantId: string, driveId: string, computedBy: string) {
    const previousResults = await DriveRepository.listDriveResults(tenantId, driveId);
    const result = await EligibilityService.compute(tenantId, driveId, computedBy);
    const drive = await DriveRepository.getDriveById(tenantId, driveId);
    const previousEligibleIds = new Set(
      previousResults
        .filter((row) => row.status === "eligible" || row.status === "applied")
        .map((row) => row.id),
    );
    const nextEligibleIds = new Set(result.students.map((student) => student.id));

    const events = result.students
      .filter((student) => !previousEligibleIds.has(student.id))
      .map((student) => ({
        id: `drive:${driveId}:${student.id}:eligible`,
        tenantId,
        studentId: student.id,
        eventType: "drive_eligibility_changed",
        eventSource: "drive_results",
        entityId: driveId,
        entityType: "drive_result",
        title: "Drive eligibility updated",
        description: `Became eligible for ${drive.company}${drive.role ? ` (${drive.role})` : ""}.`,
        metadata: {
          driveId,
          company: drive.company,
          role: drive.role,
          status: "eligible",
        },
        impactScore: 76,
        module: "Drives",
      }));

    for (const previous of previousResults.filter((row) => !nextEligibleIds.has(row.id) && row.status === "eligible")) {
      events.push({
        id: `drive:${driveId}:${previous.id}:not_eligible`,
        tenantId,
        studentId: previous.id,
        eventType: "drive_eligibility_changed",
        eventSource: "drive_results",
        entityId: driveId,
        entityType: "drive_result",
        title: "Drive eligibility updated",
        description: `No longer eligible for ${drive.company}${drive.role ? ` (${drive.role})` : ""}.`,
        metadata: {
          driveId,
          company: drive.company,
          role: drive.role,
          status: "not_eligible",
        },
        impactScore: 48,
        module: "Drives",
      });
    }

    await StudentActivityService.logEvents(events);
    await publishDriveStudentAnnouncements({
      tenantId,
      senderId: computedBy,
      driveId,
      company: String(drive.company ?? ""),
      role: drive.role ? String(drive.role) : null,
      driveDate: String(drive.driveDate ?? ""),
      eligibleStudents: result.students,
      previousResults,
    });

    return {
      ...result,
      drive,
    };
  },

  async listDriveResults(tenantId: string, driveId: string) {
    await DriveRepository.getDriveById(tenantId, driveId);
    return DriveRepository.listDriveResults(tenantId, driveId);
  },

  async withdrawStudentApplication(input: {
    tenantId: string;
    driveId: string;
    studentId: string;
  }) {
    const [drive, existingResult] = await Promise.all([
      DriveRepository.getDriveById(input.tenantId, input.driveId),
      DriveRepository.getDriveResultForStudent(input.tenantId, input.driveId, input.studentId),
    ]);

    if (normalizeDriveLifecycle(drive.status) !== "published") {
      throw new AppError("DRIVE_WITHDRAWAL_CLOSED", "You can withdraw only while registration is open.", 409);
    }

    if (!existingResult || existingResult.applicationState !== "applied") {
      throw new AppError("DRIVE_WITHDRAWAL_INVALID", "Only applied drives can be withdrawn.", 409);
    }

    await DriveRepository.markDriveWithdrawn(input.tenantId, input.driveId, input.studentId);
    await DriveRepository.recountDriveEligibleCount(input.tenantId, input.driveId);

    return {
      driveId: input.driveId,
      studentId: input.studentId,
      applicationState: "withdrawn" as const,
    };
  },

  async updateDriveResults(
    tenantId: string,
    driveId: string,
    payload: {
      actorUserId?: string;
      updates: Array<{
        studentId: string;
        outcome: "pending" | "shortlisted" | "selected" | "rejected";
        applicationState?: DriveApplicationState;
        remarks?: string;
        registered?: boolean;
        appeared?: boolean;
        shortlistedRound?: string;
        offerDate?: string;
        designationOffered?: string;
        finalCtcLpa?: number;
        joiningStatus?: "pending" | "joined" | "not_joined" | "deferred";
        offerLetterReference?: string;
        offerLetterUrl?: string;
        joiningLetterUrl?: string;
        selectionSource?: "on_campus" | "off_campus" | "self_reported";
        verificationStatus?: "pending" | "verified" | "rejected";
        sourceNote?: string;
        nonPlacementReason?: string;
        actionPlan?: string;
        rounds?: DriveResultRound[];
      }>;
      resultIntake?: {
        source?: "employer_email" | "employer_portal" | "manual_update";
        receivedAt?: string;
        companyResultReference?: string;
        attachmentNote?: string;
      };
      markCompleted?: boolean;
      allowOutcomeOverride?: boolean;
    },
  ) {
    const existingResults = await DriveRepository.listDriveResults(tenantId, driveId);
    const existingOutcomeMap = new Map(existingResults.map((row) => [row.id, row.outcome]));
    const existingStatusMap = new Map(existingResults.map((row) => [row.id, row.status]));
    const drive = await DriveRepository.getDriveById(tenantId, driveId);

    payload.updates.forEach((update) => {
      const currentOutcome = (existingOutcomeMap.get(update.studentId) ?? "pending") as DriveOutcome;
      assertOutcomeTransition(currentOutcome, update.outcome, Boolean(payload.allowOutcomeOverride));
    });

    await DriveRepository.upsertDriveResults(
      tenantId,
      driveId,
      payload.updates.map((update) => {
        const currentStatus = existingStatusMap.get(update.studentId) ?? "eligible";
        const nextStatus =
          update.applicationState === "applied" || update.applicationState === "absent" || update.outcome !== "pending"
            ? "applied"
            : (currentStatus === "applied" ? "applied" : "eligible");

        return {
          ...update,
          status: nextStatus,
          applicationState: update.applicationState
            ?? (update.outcome !== "pending" ? "applied" : undefined),
        };
      }),
    );

    const changedOutcomeStudentIds = payload.updates
      .filter((update) => existingOutcomeMap.get(update.studentId) && existingOutcomeMap.get(update.studentId) !== update.outcome)
      .map((update) => update.studentId);

    if (changedOutcomeStudentIds.length > 0) {
      await DriveRepository.updateDriveResultReleaseStatus(
        tenantId,
        driveId,
        changedOutcomeStudentIds.map((studentId) => ({
          studentId,
          resultReleasedAt: null,
          resultReleasedBy: null,
          resultNotificationStatus: null,
          resultNotificationCommunicationId: null,
          offerLetterSharedAt: null,
          offerLetterSharedBy: null,
        })),
      );
    }

    if (payload.resultIntake) {
      await DriveRepository.updateDriveResultIntake(tenantId, driveId, {
        source: payload.resultIntake.source,
        receivedAt: payload.resultIntake.receivedAt,
        companyResultReference: payload.resultIntake.companyResultReference,
        attachmentNote: payload.resultIntake.attachmentNote,
        receivedBy: payload.actorUserId,
      });
    }

    if (payload.markCompleted) {
      const existing = await DriveRepository.getDriveById(tenantId, driveId);
      const currentLifecycle = normalizeDriveLifecycle(existing.status);
      const nextLifecycle = currentLifecycle === "in_process" ? "results_pending" : "completed";
      assertStatusTransition(currentLifecycle, nextLifecycle);
      await DriveRepository.updateDriveStatus(tenantId, driveId, nextLifecycle);
    }

    await StudentActivityService.logEvents(
      payload.updates
        .filter((update) => existingOutcomeMap.get(update.studentId) !== update.outcome)
        .map((update) => ({
          id: `drive-outcome:${driveId}:${update.studentId}:${update.outcome}`,
          tenantId,
          studentId: update.studentId,
          eventType: "drive_outcome_updated",
          eventSource: "drive_results",
          entityId: driveId,
          entityType: "drive_result",
          title: "Drive outcome updated",
          description: `${drive.company}${drive.role ? ` (${drive.role})` : ""} marked as ${update.outcome}.`,
          metadata: {
            driveId,
            company: drive.company,
            role: drive.role,
            outcome: update.outcome,
            remarks: update.remarks ?? null,
          },
          impactScore:
            update.outcome === "selected"
              ? 92
              : update.outcome === "shortlisted"
                ? 82
                : update.outcome === "rejected"
                  ? 36
                  : 44,
          module: "Drives",
        })),
    );

    return {
      driveId,
      updated: payload.updates.length,
      results: await DriveRepository.listDriveResults(tenantId, driveId),
    };
  },

  async previewResultRelease(
    tenantId: string,
    driveId: string,
    payload: { audience: ReleaseAudience },
  ) {
    const [drive, rows, senderPreview] = await Promise.all([
      DriveRepository.getDriveById(tenantId, driveId),
      DriveRepository.listDriveResults(tenantId, driveId),
      CommunicationService.getSenderIdentityPreview(tenantId),
    ]);

    const targetRows = pickReleaseRows(rows, payload.audience);
    const selectedRows = targetRows.filter((row) => row.outcome === "selected");
    const rejectedRows = targetRows.filter((row) => row.outcome === "rejected");
    const driveName = formatDriveName({ company: drive.company, role: drive.role });
    const warnings: string[] = [];
    const selectedMissingOfferProof = selectedRows.filter(
      (row) => !String(row.offerLetterReference ?? "").trim() && !String(row.offerLetterUrl ?? "").trim(),
    ).length;

    if (selectedMissingOfferProof > 0) {
      warnings.push(`${selectedMissingOfferProof} selected student(s) do not have offer proof yet. Their email will say that the offer letter will follow.`);
    }

    return {
      audience: payload.audience,
      driveId,
      driveName,
      sender: senderPreview.sender,
      recipientCount: targetRows.length,
      selectedCount: selectedRows.length,
      rejectedCount: rejectedRows.length,
      selectedWithOfferLetters: selectedRows.filter(
        (row) => String(row.offerLetterReference ?? "").trim() || String(row.offerLetterUrl ?? "").trim(),
      ).length,
      warnings,
      sampleRecipients: targetRows.slice(0, 8).map((row) => ({
        studentId: row.id,
        fullName: row.fullName,
        email: row.email,
        outcome: row.outcome,
        hasOfferLetter: Boolean(String(row.offerLetterReference ?? "").trim() || String(row.offerLetterUrl ?? "").trim()),
      })),
    };
  },

  async releaseDriveResults(input: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    driveId: string;
    audience: ReleaseAudience;
  }) {
    const [drive, senderPreview] = await Promise.all([
      DriveRepository.getDriveById(input.tenantId, input.driveId),
      CommunicationService.getSenderIdentityPreview(input.tenantId),
    ]);
    const rows = await DriveRepository.listDriveResults(input.tenantId, input.driveId);
    const targetRows = pickReleaseRows(rows, input.audience);

    if (targetRows.length === 0) {
      throw new AppError("DRIVE_RESULT_RELEASE_EMPTY", "No finalized results matched the selected release audience", 400);
    }

    const driveName = formatDriveName({ company: drive.company, role: drive.role });
    const now = new Date().toISOString();
    const selectedRows = targetRows.filter((row) => row.outcome === "selected");
    const rejectedRows = targetRows.filter((row) => row.outcome === "rejected");

    await DriveRepository.updateDriveResultReleaseStatus(
      input.tenantId,
      input.driveId,
      targetRows.map((row) => ({
        studentId: row.id,
        resultReleasedAt: now,
        resultReleasedBy: input.actorUserId,
        resultNotificationStatus: "queued",
      })),
    );

    const communications: Array<{
      communicationId: string;
      audience: "selected" | "rejected";
      recipientCount: number;
    }> = [];

    if (selectedRows.length > 0) {
      const queued = await CommunicationService.sendTemplatedToRecipients({
        tenantId: input.tenantId,
        senderId: input.actorUserId,
        templateSlug: "selected-result-notification",
        recipients: selectedRows.map((row) => ({
          studentId: row.id,
          fullName: row.fullName,
          email: row.email,
          driveName,
          variables: buildSelectedRecipientVariables(row, { company: drive.company, role: drive.role }, driveName, senderPreview.sender.tenantName),
        })),
        metadata: {
          drive_id: input.driveId,
          result_release: {
            drive_id: input.driveId,
            released_at: now,
            released_by: input.actorUserId,
            email_kind: "selected",
            audience: input.audience,
          },
        },
        allowUnsubscribe: false,
      });
      await DriveRepository.updateDriveResultReleaseStatus(
        input.tenantId,
        input.driveId,
        selectedRows.map((row) => ({
          studentId: row.id,
          resultNotificationCommunicationId: queued.communicationId,
        })),
      );
      communications.push({
        communicationId: queued.communicationId,
        audience: "selected",
        recipientCount: selectedRows.length,
      });
    }

    if (rejectedRows.length > 0) {
      const queued = await CommunicationService.sendTemplatedToRecipients({
        tenantId: input.tenantId,
        senderId: input.actorUserId,
        templateSlug: "rejected-result-notification",
        recipients: rejectedRows.map((row) => ({
          studentId: row.id,
          fullName: row.fullName,
          email: row.email,
          driveName,
          variables: buildRejectedRecipientVariables(row, { company: drive.company, role: drive.role }, driveName, senderPreview.sender.tenantName),
        })),
        metadata: {
          drive_id: input.driveId,
          result_release: {
            drive_id: input.driveId,
            released_at: now,
            released_by: input.actorUserId,
            email_kind: "rejected",
            audience: input.audience,
          },
        },
        allowUnsubscribe: false,
      });
      await DriveRepository.updateDriveResultReleaseStatus(
        input.tenantId,
        input.driveId,
        rejectedRows.map((row) => ({
          studentId: row.id,
          resultNotificationCommunicationId: queued.communicationId,
        })),
      );
      communications.push({
        communicationId: queued.communicationId,
        audience: "rejected",
        recipientCount: rejectedRows.length,
      });
    }

    await AuditLogService.log({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      eventType: "drive_results_released",
      metadata: {
        driveId: input.driveId,
        audience: input.audience,
        selectedCount: selectedRows.length,
        rejectedCount: rejectedRows.length,
        communicationIds: communications.map((item) => item.communicationId),
      },
    });

    await CommunicationService.publishSystemAnnouncementToStudents({
      tenantId: input.tenantId,
      senderId: input.actorUserId,
      studentIds: targetRows.map((row) => row.id),
      systemKey: `drive-results-published:${input.driveId}:${input.audience}`,
      title: `Results published for ${driveName}`,
      message: `Your placement office has published the latest result update for ${driveName}. Open Drives to review your outcome and the next steps.`,
      priority: "important",
      relatedDriveId: input.driveId,
    });

    return {
      driveId: input.driveId,
      audience: input.audience,
      releasedAt: now,
      selectedCount: selectedRows.length,
      rejectedCount: rejectedRows.length,
      communications,
      results: await DriveRepository.listDriveResults(input.tenantId, input.driveId),
    };
  },

  async resendResultEmail(input: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    driveId: string;
    studentId: string;
  }) {
    const [drive, senderPreview] = await Promise.all([
      DriveRepository.getDriveById(input.tenantId, input.driveId),
      CommunicationService.getSenderIdentityPreview(input.tenantId),
    ]);
    const rows = await DriveRepository.listDriveResults(input.tenantId, input.driveId);
    const row = rows.find((item) => item.id === input.studentId);

    if (!row) {
      throw new AppError("DRIVE_RESULT_NOT_FOUND", "Drive result not found for this student", 404);
    }

    if (row.outcome !== "selected" && row.outcome !== "rejected") {
      throw new AppError("DRIVE_RESULT_RELEASE_INVALID", "Only selected or rejected results can be emailed to students", 400);
    }

    const driveName = formatDriveName({ company: drive.company, role: drive.role });
    const now = new Date().toISOString();
    const templateSlug = row.outcome === "selected" ? "selected-result-notification" : "rejected-result-notification";
    const variables = row.outcome === "selected"
      ? buildSelectedRecipientVariables(row, { company: drive.company, role: drive.role }, driveName, senderPreview.sender.tenantName)
      : buildRejectedRecipientVariables(row, { company: drive.company, role: drive.role }, driveName, senderPreview.sender.tenantName);

    await DriveRepository.updateDriveResultReleaseStatus(input.tenantId, input.driveId, [{
      studentId: row.id,
      resultReleasedAt: row.resultReleasedAt ?? now,
      resultReleasedBy: row.resultReleasedBy ?? input.actorUserId,
      resultNotificationStatus: "queued",
    }]);

    const queued = await CommunicationService.sendTemplatedToRecipients({
      tenantId: input.tenantId,
      senderId: input.actorUserId,
      templateSlug,
      recipients: [{
        studentId: row.id,
        fullName: row.fullName,
        email: row.email,
        driveName,
        variables,
      }],
      metadata: {
        drive_id: input.driveId,
        result_release: {
          drive_id: input.driveId,
          released_at: row.resultReleasedAt ?? now,
          released_by: row.resultReleasedBy ?? input.actorUserId,
          email_kind: row.outcome,
          audience: row.outcome,
          resend: true,
        },
      },
      allowUnsubscribe: false,
    });

    await DriveRepository.updateDriveResultReleaseStatus(input.tenantId, input.driveId, [{
      studentId: row.id,
      resultNotificationCommunicationId: queued.communicationId,
    }]);

    await AuditLogService.log({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      eventType: "drive_result_email_resent",
      metadata: {
        driveId: input.driveId,
        studentId: row.id,
        outcome: row.outcome,
        communicationId: queued.communicationId,
      },
    });

    return {
      driveId: input.driveId,
      studentId: row.id,
      communicationId: queued.communicationId,
      outcome: row.outcome,
      status: "queued",
    };
  },

  async getDriveReleaseStatus(tenantId: string, driveId: string) {
    const [drive, items] = await Promise.all([
      DriveRepository.getDriveById(tenantId, driveId),
      DriveRepository.listDriveReleaseStatusRows(tenantId, driveId),
    ]);

    return {
      driveId,
      driveName: formatDriveName({ company: drive.company, role: drive.role }),
      summary: {
        selectedCount: items.filter((item) => item.outcome === "selected").length,
        rejectedCount: items.filter((item) => item.outcome === "rejected").length,
        releasedCount: items.filter((item) => item.resultReleasedAt).length,
        pendingReleaseCount: items.filter((item) => !item.resultReleasedAt).length,
        queuedCount: items.filter((item) => item.resultNotificationStatus === "queued").length,
        sentCount: items.filter((item) => item.resultNotificationStatus === "sent").length,
        failedCount: items.filter((item) => item.resultNotificationStatus === "failed").length,
        offerAttachedCount: items.filter((item) => item.outcome === "selected" && (item.offerLetterReference || item.offerLetterUrl)).length,
        offerSharedCount: items.filter((item) => item.outcome === "selected" && item.offerLetterSharedAt).length,
      },
      items,
    };
  },

  async setEligibilityOverride(input: {
    tenantId: string;
    actorUserId: string;
    actorEmail: string;
    actorRole: string;
    driveId: string;
    studentId: string;
    decision: "eligible" | "not_eligible";
    reason: string;
  }) {
    const eligibleCount = await DriveRepository.setEligibilityOverride({
      tenantId: input.tenantId,
      driveId: input.driveId,
      studentId: input.studentId,
      decision: input.decision,
      reason: input.reason,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
    });

    await AuditLogService.log({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      eventType: "drive_eligibility_override_set",
      metadata: {
        driveId: input.driveId,
        studentId: input.studentId,
        decision: input.decision,
        reason: input.reason,
      },
    });

    return {
      driveId: input.driveId,
      studentId: input.studentId,
      decision: input.decision,
      eligibleCount,
    };
  },

  async clearEligibilityOverride(input: {
    tenantId: string;
    actorUserId: string;
    actorEmail: string;
    actorRole: string;
    driveId: string;
    studentId: string;
  }) {
    const eligibleCount = await DriveRepository.clearEligibilityOverride({
      tenantId: input.tenantId,
      driveId: input.driveId,
      studentId: input.studentId,
    });

    await AuditLogService.log({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      eventType: "drive_eligibility_override_cleared",
      metadata: {
        driveId: input.driveId,
        studentId: input.studentId,
      },
    });

    return {
      driveId: input.driveId,
      studentId: input.studentId,
      eligibleCount,
      note: "Override cleared. Recompute eligibility to restore deterministic rules.",
    };
  },
};
