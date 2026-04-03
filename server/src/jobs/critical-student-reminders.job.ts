import { CommunicationService } from "../services/communication.service.js";
import { buildStudentDeclarationStatus } from "../utils/student-declaration.js";
import { logger } from "../utils/logger.js";
import { getMongoDb } from "../utils/mongodb.js";
import { normalizeStudentProfileData } from "../utils/student-profile.js";

const REMINDER_WINDOW_DAYS = 3;

function daysUntilDrive(dateIso: string): number | null {
  if (!dateIso) return null;
  const target = new Date(dateIso);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatDriveName(drive: { company: string; role: string | null }) {
  return `${drive.company}${drive.role ? ` - ${drive.role}` : ""}`;
}

async function resolveTenantSenderId(tenantId: string) {
  const db = await getMongoDb();
  const rows = await db.collection("users").find(
    {
      tenant_id: tenantId,
      role: { $in: ["tpo", "admin"] },
      is_active: true,
    },
    { projection: { _id: 0, id: 1 } },
  ).limit(1).toArray();

  return rows[0]?.id ? String(rows[0].id) : `system:${tenantId}`;
}

async function loadStudentReminderState(tenantId: string, studentIds: string[]) {
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

async function runCriticalStudentReminders() {
  const db = await getMongoDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + REMINDER_WINDOW_DAYS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const tenants = await db.collection("tenants").find(
    { is_active: true },
    { projection: { _id: 0, id: 1 } },
  ).toArray();

  const tenantIds = tenants.length > 0
    ? tenants.map((tenant) => String(tenant.id))
    : [...new Set((await db.collection("students").find({}, { projection: { tenant_id: 1 } }).toArray()).map((row) => String(row.tenant_id)))];

  for (const tenantId of tenantIds) {
    try {
      const senderId = await resolveTenantSenderId(tenantId);
      const drives = await db.collection("drives").find(
        {
          tenant_id: tenantId,
          deleted_at: null,
          drive_date: { $gte: todayIso, $lte: cutoffIso },
          status: { $in: ["published", "upcoming"] },
        },
        {
          projection: {
            _id: 0,
            id: 1,
            company: 1,
            role: 1,
            drive_date: 1,
          },
        },
      ).toArray();

      for (const drive of drives) {
        const rows = await db.collection("drive_results").find(
          {
            tenant_id: tenantId,
            drive_id: String(drive.id),
            status: "eligible",
          },
          {
            projection: {
              _id: 0,
              student_id: 1,
              application_state: 1,
            },
          },
        ).toArray();

        const pendingStudents = rows.filter((row) => {
          const applicationState = String(row.application_state ?? "");
          return applicationState !== "applied" && applicationState !== "withdrawn" && applicationState !== "absent";
        });

        if (pendingStudents.length === 0) {
          continue;
        }

        const stateMap = await loadStudentReminderState(
          tenantId,
          pendingStudents.map((row) => String(row.student_id)),
        );

        const readyIds: string[] = [];
        const blockedIds: string[] = [];

        pendingStudents.forEach((row) => {
          const studentId = String(row.student_id);
          const state = stateMap.get(studentId) ?? { hasResume: false, isCertified: false };
          if (state.hasResume && state.isCertified) {
            readyIds.push(studentId);
          } else {
            blockedIds.push(studentId);
          }
        });

        const driveName = formatDriveName({
          company: String(drive.company ?? "Drive"),
          role: drive.role ? String(drive.role) : null,
        });
        const daysRemaining = daysUntilDrive(String(drive.drive_date ?? ""));

        if (readyIds.length > 0) {
          await CommunicationService.publishSystemAnnouncementToStudents({
            tenantId,
            senderId,
            studentIds: readyIds,
            systemKey: `scheduled-drive-deadline-ready:${String(drive.id)}:${todayIso}`,
            title: `Last call for ${driveName}`,
            message: `Registration is still open for ${driveName}${daysRemaining === null ? "." : ` for ${daysRemaining} more day(s).`} Your profile is ready, so apply now if you want this opportunity.`,
            priority: "urgent",
            relatedDriveId: String(drive.id),
            showPopup: true,
          });
        }

        if (blockedIds.length > 0) {
          await CommunicationService.publishSystemAnnouncementToStudents({
            tenantId,
            senderId,
            studentIds: blockedIds,
            systemKey: `scheduled-drive-deadline-blocked:${String(drive.id)}:${todayIso}`,
            title: `Action needed today for ${driveName}`,
            message: `Registration for ${driveName} is closing soon${daysRemaining === null ? "." : ` in ${daysRemaining} day(s).`} Upload your resume or certify your profile now if you want to apply in time.`,
            priority: "urgent",
            relatedDriveId: String(drive.id),
            showPopup: true,
          });
        }
      }
    } catch (error) {
      logger.warn("Critical student reminder job failed", {
        context: {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

function scheduleNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(9, 15, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  const delay = Math.max(1000, next.getTime() - now.getTime());
  const timer = setTimeout(async () => {
    await runCriticalStudentReminders();
    scheduleNextRun();
  }, delay);
  timer.unref?.();
}

export function scheduleCriticalStudentReminders() {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.DISABLE_CRITICAL_REMINDER_JOB === "true") return;
  scheduleNextRun();
}
