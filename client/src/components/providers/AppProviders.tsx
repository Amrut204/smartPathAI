import type { PropsWithChildren } from "react";

import { AuthProvider } from "./AuthProvider";
import { TenantProvider } from "./TenantProvider";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <AuthProvider>
      <TenantProvider>{children}</TenantProvider>
    </AuthProvider>
  );
}
