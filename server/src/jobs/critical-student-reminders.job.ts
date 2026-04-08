import { logger } from "../utils/logger.js";
import { TpoAutomationService } from "../services/tpo-automation.service.js";

async function runCriticalStudentReminders() {
  const tenantIds = await TpoAutomationService.getActiveTenantIds();
  for (const tenantId of tenantIds) {
    try {
      await TpoAutomationService.runScheduledEligibleNotAppliedForTenant(tenantId);
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
