import { logger } from "../utils/logger.js";

type QueueBackend = "inline";

interface CommunicationJobData {
  tenantId: string;
  communicationId: string;
}

type JobProcessor = (data: CommunicationJobData) => Promise<void>;

let queueBackend: QueueBackend = "inline";
let initialized = false;
let processor: JobProcessor | null = null;

export function getCommunicationQueueBackend(): QueueBackend {
  return queueBackend;
}

export function isCommunicationQueueInitialized() {
  return initialized;
}

export async function initializeCommunicationQueue(params: {
  processor: JobProcessor;
}) {
  if (initialized) {
    return;
  }

  queueBackend = "inline";
  processor = params.processor;

  initialized = true;
  logger.info("Communication queue initialized", {
    context: {
      queueBackend,
    },
  });
}

export async function enqueueCommunicationJob(job: CommunicationJobData) {
  if (!initialized || !processor) {
    throw new Error("Communication queue processor is not initialized");
  }

  setTimeout(() => {
    void processor?.(job).catch((error) => {
      logger.error("Inline communication job failed", {
        context: {
          communicationId: job.communicationId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }, 0);
}

export async function shutdownCommunicationQueue() {
  if (!initialized) {
    return;
  }

  initialized = false;
  processor = null;
}
