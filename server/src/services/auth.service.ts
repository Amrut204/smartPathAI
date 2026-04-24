import { compare, hash } from "bcryptjs";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import type { AppRole, UserProfile } from "../types/domain.types.js";
import {
  createSessionTokens,
  verifyAccessToken,
  verifyRefreshToken,
} from "../utils/auth-session.js";
import { HOD_DASHBOARD_PATH, TPO_DASHBOARD_PATH, STUDENT_DASHBOARD_PATH } from "../utils/constants.js";
import { StudentActivityService } from "./student-activity.service.js";

interface LoginInput {
  email: string;
  password: string;
}

interface SignupInput {
  email: string;
  password: string;
  fullName: string;
  tenantSlug: string;
  branch: string;
  batch: string;
  prn: string;
  rollNumber?: string;
}

interface AuthSessionResult {
  profile: UserProfile;
  redirectTo: string;
  mustChangePassword: boolean;
  accessToken: string;
  refreshToken: string;
}

const REFRESH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function resolveRedirectPath(role: AppRole): string {
  if (role === "admin") {
    return "/admin/hub";
  }

  if (role === "hod") {
    return HOD_DASHBOARD_PATH;
  }

  if (role === "tpo") {
    return TPO_DASHBOARD_PATH;
  }

  return STUDENT_DASHBOARD_PATH;
}

function resolvePostLoginPath(profile: UserProfile): string {
  if (profile.must_change_password) {
    return "/password/setup";
  }

  return resolveRedirectPath(profile.role);
}

async function getUserProfile(userId: string): Promise<UserProfile> {
  const user = await MongoAuthRepository.findUserById(userId);
  if (!user) {
    throw new AppError("PROFILE_NOT_FOUND", "User profile was not found", 404);
  }

  return {
    id: user.id,
    tenant_id: user.tenant_id,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
    department: user.department ?? null,
    is_active: user.is_active,
    must_change_password: Boolean((user as UserProfile & { must_change_password?: boolean }).must_change_password),
  };
}

async function createUserSession(user: {
  id: string;
  email: string;
  role: AppRole;
  tenant_id: string;
}, rotatedFrom?: string | null): Promise<{ accessToken: string; refreshToken: string }> {
  const expiresAt = new Date(Date.now() + REFRESH_SESSION_TTL_MS).toISOString();
  const session = await MongoAuthRepository.createRefreshSession({
    userId: user.id,
    tenantId: user.tenant_id,
    expiresAt,
    rotatedFrom,
  });

  return createSessionTokens({
    sessionId: session.id,
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenant_id,
  });
}

export const AuthService = {
  async login(input: LoginInput): Promise<AuthSessionResult> {
    const user = await MongoAuthRepository.findUserByEmail(input.email);
    if (!user) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }

    const validPassword = await compare(input.password, user.password_hash);
    if (!validPassword || !user.is_active) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }

    const profile = await getUserProfile(user.id);
    const tokens = await createUserSession(user);

    if (user.role === "student") {
      await StudentActivityService.logEventForUser(user.tenant_id, user.id, {
        eventType: "login",
        eventSource: "auth",
        entityId: user.id,
        entityType: "user",
        title: "Logged into platform",
        description: "Student logged in successfully.",
        impactScore: 20,
        module: "Auth",
      });
    }

    return {
      profile,
      redirectTo: resolvePostLoginPath(profile),
      mustChangePassword: profile.must_change_password,
      ...tokens,
    };
  },

  async signup(input: SignupInput): Promise<AuthSessionResult> {
    const tenant = await MongoAuthRepository.findTenantBySlug(input.tenantSlug);
    if (!tenant) {
      throw new AppError("TENANT_NOT_FOUND", "Invalid tenant", 404);
    }

    if (!tenant.is_active) {
      throw new AppError("TENANT_INACTIVE", "Tenant is inactive", 403);
    }

    const existingUser = await MongoAuthRepository.findUserByEmail(input.email);
    if (existingUser) {
      throw new AppError("EMAIL_IN_USE", "Email is already registered", 409);
    }

    const passwordHash = await hash(input.password, 10);
    const createdUser = await MongoAuthRepository.createUser({
      tenantId: tenant.id,
      email: input.email,
      role: "student",
      fullName: input.fullName,
      passwordHash,
      mustChangePassword: false,
    });

    await MongoAuthRepository.createStudent({
      tenantId: tenant.id,
      userId: createdUser.id,
      prn: input.prn,
      rollNumber: input.rollNumber,
      branch: input.branch,
      batch: input.batch,
    });

    await StudentActivityService.logEventForUser(tenant.id, createdUser.id, {
      eventType: "signup_completed",
      eventSource: "auth",
      entityId: createdUser.id,
      entityType: "user",
      title: "Account created",
      description: "Student completed account signup.",
      impactScore: 18,
      module: "Auth",
    });

    const profile = await getUserProfile(createdUser.id);
    const tokens = await createUserSession(createdUser);

    return {
      profile,
      redirectTo: resolvePostLoginPath(profile),
      mustChangePassword: profile.must_change_password,
      ...tokens,
    };
  },

  async logout(tokens?: { refreshToken?: string; accessToken?: string }): Promise<void> {
    const refreshPayload = tokens?.refreshToken ? await verifyRefreshToken(tokens.refreshToken) : null;
    if (refreshPayload) {
      await MongoAuthRepository.revokeRefreshSession(refreshPayload.sessionId, "logout");
      return;
    }

    const accessPayload = tokens?.accessToken ? await verifyAccessToken(tokens.accessToken) : null;
    if (accessPayload) {
      await MongoAuthRepository.revokeRefreshSession(accessPayload.sessionId, "logout");
    }
  },

  async refreshSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = await verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new AppError("REFRESH_FAILED", "Invalid refresh token", 401);
    }

    const user = await MongoAuthRepository.findUserById(payload.userId);
    if (!user || !user.is_active) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }

    const session = await MongoAuthRepository.findRefreshSessionById(payload.sessionId);
    if (
      !session ||
      session.user_id !== user.id ||
      session.tenant_id !== user.tenant_id
    ) {
      throw new AppError("REFRESH_FAILED", "Invalid refresh token", 401);
    }

    if (session.revoked_at) {
      if (session.revoked_reason === "rotated") {
        throw new AppError("REFRESH_REPLAY_DETECTED", "This refresh token has already been used.", 401);
      }
      throw new AppError("SESSION_REVOKED", "Your session is no longer active. Please log in again.", 401);
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await MongoAuthRepository.revokeRefreshSession(session.id, "expired");
      throw new AppError("SESSION_REVOKED", "Your session has expired. Please log in again.", 401);
    }

    await MongoAuthRepository.revokeRefreshSession(session.id, "rotated");
    return createUserSession(user, session.id);
  },

  async me(userId: string): Promise<UserProfile> {
    return getUserProfile(userId);
  },

  async completeInitialPasswordReset(userId: string, newPassword: string): Promise<{ profile: UserProfile; redirectTo: string }> {
    const user = await MongoAuthRepository.findUserById(userId);
    if (!user || !user.is_active) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }

    const passwordHash = await hash(newPassword, 10);
    const nextPasswordVersion = Number((user as { password_version?: unknown }).password_version ?? 0) + 1;
    const updated = await MongoAuthRepository.updateInitialPassword(userId, passwordHash, nextPasswordVersion);
    if (!updated) {
      throw new AppError("PASSWORD_RESET_FAILED", "Unable to update password", 500);
    }
    await MongoAuthRepository.revokeAllRefreshSessionsForUser(userId, "password_reset");

    const profile = await getUserProfile(userId);
    return {
      profile,
      redirectTo: resolveRedirectPath(profile.role),
    };
  },
};
