export type AppRole = "student" | "tpo" | "admin";

export interface AuthContext {
  userId: string;
  email: string;
  role: AppRole;
  tenantId: string;
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
  is_active: boolean;
}
