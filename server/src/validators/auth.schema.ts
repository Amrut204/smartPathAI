import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const signupSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be 72 characters or fewer"),
  fullName: z.string().trim().min(2).max(120),
  tenantSlug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/, "Invalid tenant slug"),
  branch: z.string().trim().min(2).max(64),
  batch: z.string().trim().min(4).max(4).regex(/^\d{4}$/),
  prn: z.string().trim().min(3).max(64),
  rollNumber: z.string().trim().min(1).max(64).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const initialPasswordResetSchema = z.object({
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be 72 characters or fewer"),
});
