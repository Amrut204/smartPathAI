import crypto from "node:crypto";

type LogLevel = "info" | "warn" | "error";

interface LogPayload {
  level: LogLevel;
  message: string;
  correlation_id?: string;
  tenant_id?: string;
  user_id?: string;
  context?: Record<string, unknown>;
}

function writeLog(payload: LogPayload): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level: payload.level,
    message: payload.message,
    correlation_id: payload.correlation_id ?? `req_${crypto.randomUUID()}`,
    tenant_id: payload.tenant_id,
    user_id: payload.user_id,
    context: payload.context,
  };

  if (payload.level === "error") {
    console.error(JSON.stringify(entry));
    return;
  }

  console.log(JSON.stringify(entry));
}

export const logger = {
  info(message: string, context?: Omit<LogPayload, "message" | "level">) {
    writeLog({ level: "info", message, ...context });
  },
  warn(message: string, context?: Omit<LogPayload, "message" | "level">) {
    writeLog({ level: "warn", message, ...context });
  },
  error(message: string, context?: Omit<LogPayload, "message" | "level">) {
    writeLog({ level: "error", message, ...context });
  },
};
