type ServerEnvVarName =
  | "MONGODB_URI"
  | "MONGODB_DB_NAME"
  | "APP_JWT_SECRET"
  | "GEMINI_API_KEY"
  | "SENDGRID_API_KEY"
  | "SENDGRID_FROM_EMAIL";

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getEnvVar(name: ServerEnvVarName): string {
  return requireEnvValue(name, process.env[name]);
}
