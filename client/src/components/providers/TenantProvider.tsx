import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import { useAuth } from "./AuthProvider";

export interface TenantConfig {
  brand?: { primaryColor?: string; logoUrl?: string };
  ai_enabled?: boolean;
  [key: string]: unknown;
}

interface TenantContextValue {
  tenantId: string | null;
  config: TenantConfig | null;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ children }: PropsWithChildren) {
  const { profile } = useAuth();
  const [config, setConfig] = useState<TenantConfig | null>(null);

  useEffect(() => {
    const loadTenant = async () => {
      if (!profile?.tenant_id) {
        setConfig(null);
        document.documentElement.style.removeProperty("--tenant-primary");
        return;
      }

      const response = await fetch("/api/v1/tenants/me", { credentials: "include" });

      if (!response.ok) {
        setConfig(null);
        return;
      }

      const payload = (await response.json()) as {
        success?: boolean;
        data?: { config?: TenantConfig };
      };
      const tenantConfig = (payload.data?.config ?? {}) as TenantConfig;
      setConfig(tenantConfig);

      const primaryColor = tenantConfig.brand?.primaryColor;
      if (primaryColor) {
        document.documentElement.style.setProperty("--tenant-primary", primaryColor);
      }
    };

    void loadTenant();
  }, [profile?.tenant_id]);

  const value = useMemo<TenantContextValue>(
    () => ({ tenantId: profile?.tenant_id ?? null, config }),
    [config, profile?.tenant_id],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant must be used within TenantProvider");
  }
  return ctx;
}
