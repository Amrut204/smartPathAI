export type AppRole = "student" | "tpo" | "admin" | "hod";

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  role: AppRole;
  tenantId: string;
  actorTenantId?: string;
  support?: {
    sessionId: string;
    tenantId: string;
    expiresAt: string;
    approvedBy: string;
  };
}

export interface TenantConfig {
  ai_enabled?: boolean;
  brand?: {
    primaryColor?: string;
    logo?: string;
  };
  [key: string]: unknown;
}

export interface UserProfile {
  id: string;
  tenant_id: string;
  email: string;
  role: AppRole;
  full_name: string | null;
  department?: string | null;
  is_active: boolean;
  must_change_password: boolean;
}
