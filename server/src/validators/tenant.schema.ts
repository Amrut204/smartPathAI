import { z } from "zod";

const optionalEmailSchema = z.union([z.string().trim().email().max(320), z.literal("")]).optional();
const optionalNameSchema = z.union([z.string().trim().min(2).max(120), z.literal("")]).optional();

export const updateTenantEmailSettingsSchema = z.object({
  fromName: optionalNameSchema,
  fromEmail: optionalEmailSchema,
  replyToEmail: optionalEmailSchema,
});
