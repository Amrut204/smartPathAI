type ServerEnvVarName =
  | "MONGODB_URI"
  | "MONGODB_DB_NAME"
  | "APP_JWT_SECRET"
  | "APP_URL"
  | "GROQ_API_KEY"
  | "AI_TIMEOUT_MS"
  | "AI_CACHE_TTL_SEC"
  | "GROQ_MODEL"
  | "RESEND_API_KEY"
  | "RESEND_FROM_EMAIL"
  | "COMM_UNSUB_SECRET"
  | "GROQ_BUDGET_ENABLED"
  | "GROQ_REQUEST_LIMIT_MONTHLY"
  | "GROQ_TOKEN_LIMIT_MONTHLY"
  | "GROQ_COST_LIMIT_USD_MONTHLY"
  | "GROQ_WARNING_PCT";

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getEnvVar(name: ServerEnvVarName): string {
  return requireEnvValue(name, process.env[name]);
}

export function getOptionalEnvVar(name: ServerEnvVarName): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === null || value.trim() === "") {
    return undefined;
  }
  return value;
}

export function validateRuntimeEnv(): void {
  getEnvVar("MONGODB_URI");
  getEnvVar("MONGODB_DB_NAME");
  getEnvVar("APP_JWT_SECRET");
}
