import { compare, hash } from "bcryptjs";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";
import type { AppRole, UserProfile } from "../types/domain.types.js";
import {
  createSessionTokens,
  verifyRefreshToken,
} from "../utils/auth-session.js";
import { TPO_DASHBOARD_PATH, STUDENT_DASHBOARD_PATH } from "../utils/constants.js";

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
  rollNumber: string;
}

interface AuthSessionResult {
  profile: UserProfile;
  redirectTo: string;
  accessToken: string;
  refreshToken: string;
}

function resolveRedirectPath(role: AppRole): string {
  if (role === "tpo" || role === "admin") {
    return TPO_DASHBOARD_PATH;
  }

  return STUDENT_DASHBOARD_PATH;
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
    is_active: user.is_active,
  };
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
    const tokens = await createSessionTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
    });

    return {
      profile,
      redirectTo: resolveRedirectPath(profile.role),
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
    });

    await MongoAuthRepository.createStudent({
      tenantId: tenant.id,
      userId: createdUser.id,
      rollNumber: input.rollNumber,
      branch: input.branch,
      batch: input.batch,
    });

    const profile = await getUserProfile(createdUser.id);
    const tokens = await createSessionTokens({
      userId: createdUser.id,
      email: createdUser.email,
      role: createdUser.role,
      tenantId: createdUser.tenant_id,
    });

    return {
      profile,
      redirectTo: resolveRedirectPath(profile.role),
      ...tokens,
    };
  },

  async logout(): Promise<void> {
    return Promise.resolve();
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

    return createSessionTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
    });
  },

  async me(userId: string): Promise<UserProfile> {
    return getUserProfile(userId);
  },
};
