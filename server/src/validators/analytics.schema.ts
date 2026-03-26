import { z } from "zod";

export const analyticsExportSchema = z.object({
  type: z.enum(["readiness", "topics", "tests", "placement"]),
  format: z.enum(["csv", "pdf"]).default("csv"),
});
