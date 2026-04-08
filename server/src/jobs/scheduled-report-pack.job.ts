import { logger } from "../utils/logger.js";
import { TpoAutomationService } from "../services/tpo-automation.service.js";

async function runScheduledReportPacks() {
  const tenantIds = await TpoAutomationService.getActiveTenantIds();
  const isMonthStart = new Date().getDate() === 1;
  for (const tenantId of tenantIds) {
    try {
      await TpoAutomationService.runScheduledReportPackForTenant(tenantId, "weekly");
      if (isMonthStart) {
        await TpoAutomationService.runScheduledReportPackForTenant(tenantId, "monthly");
      }
    } catch (error) {
      logger.warn("Scheduled report pack job failed", {
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
  next.setHours(8, 45, 0, 0);
  const currentDay = next.getDay();
  const daysUntilMonday = currentDay === 0 ? 1 : currentDay === 1 && next > now ? 0 : (8 - currentDay) % 7;
  next.setDate(next.getDate() + daysUntilMonday);
  if (next <= now) next.setDate(next.getDate() + 7);

  const delay = Math.max(1000, next.getTime() - now.getTime());
  const timer = setTimeout(async () => {
    await runScheduledReportPacks();
    scheduleNextRun();
  }, delay);
  timer.unref?.();
}

export function scheduleScheduledReportPackJob() {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.DISABLE_SCHEDULED_REPORT_PACK_JOB === "true") return;
  scheduleNextRun();
}
