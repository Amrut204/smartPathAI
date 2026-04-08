import { logger } from "../utils/logger.js";
import { TpoAutomationService } from "../services/tpo-automation.service.js";

async function runUnplacedInterventionRefresh() {
  const tenantIds = await TpoAutomationService.getActiveTenantIds();
  for (const tenantId of tenantIds) {
    try {
      await TpoAutomationService.runScheduledBlockedProfilesForTenant(tenantId);
      await TpoAutomationService.runScheduledUnplacedRefreshForTenant(tenantId);
    } catch (error) {
      logger.warn("Unplaced intervention refresh job failed", {
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
  next.setHours(1, 30, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  const delay = Math.max(1000, next.getTime() - now.getTime());
  const timer = setTimeout(async () => {
    await runUnplacedInterventionRefresh();
    scheduleNextRun();
  }, delay);
  timer.unref?.();
}

export function scheduleUnplacedInterventionRefresh() {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.DISABLE_UNPLACED_INTERVENTION_REFRESH_JOB === "true") return;
  scheduleNextRun();
}
