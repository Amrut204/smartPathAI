import { DriveRepository } from "../repositories/drive.repository.js";
import { EligibilityService } from "./eligibility.service.js";
import { AppError } from "../middleware/error-handler.js";

type DriveStatus = "upcoming" | "active" | "completed" | "cancelled";

const VALID_TRANSITIONS: Record<DriveStatus, DriveStatus[]> = {
  upcoming: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function assertStatusTransition(currentStatus: DriveStatus, nextStatus: DriveStatus) {
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

export const DriveService = {
  async listDrives(
    tenantId: string,
    query: {
      limit: number;
      cursor?: string;
      status?: DriveStatus;
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
      criteria: {
        minCgpa?: number;
        maxBacklogs?: number;
        branches?: string[];
        minAttendance?: number;
      };
      status: DriveStatus;
    },
  ) {
    return DriveRepository.createDrive(tenantId, createdBy, input);
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
      criteria: {
        minCgpa?: number;
        maxBacklogs?: number;
        branches?: string[];
        minAttendance?: number;
      };
      status: DriveStatus;
    }>,
  ) {
    if (updates.status) {
      const existing = await DriveRepository.getDriveById(tenantId, driveId);
      assertStatusTransition(existing.status as DriveStatus, updates.status);
    }

    return DriveRepository.updateDrive(tenantId, driveId, updates);
  },

  async deleteDrive(tenantId: string, driveId: string) {
    await DriveRepository.softDeleteDrive(tenantId, driveId);
  },

  async computeEligibility(tenantId: string, driveId: string) {
    const result = await EligibilityService.compute(tenantId, driveId);
    const drive = await DriveRepository.getDriveById(tenantId, driveId);

    return {
      ...result,
      drive,
    };
  },

  async listDriveResults(tenantId: string, driveId: string) {
    return DriveRepository.listDriveResults(tenantId, driveId);
  },

  async updateDriveResults(
    tenantId: string,
    driveId: string,
    payload: {
      updates: Array<{
        studentId: string;
        outcome: "pending" | "shortlisted" | "selected" | "rejected";
        remarks?: string;
      }>;
      markCompleted?: boolean;
    },
  ) {
    await DriveRepository.upsertDriveResults(tenantId, driveId, payload.updates);

    if (payload.markCompleted) {
      const existing = await DriveRepository.getDriveById(tenantId, driveId);
      assertStatusTransition(existing.status as DriveStatus, "completed");
      await DriveRepository.updateDriveStatus(tenantId, driveId, "completed");
    }

    return {
      driveId,
      updated: payload.updates.length,
      results: await DriveRepository.listDriveResults(tenantId, driveId),
    };
  },
};
