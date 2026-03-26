import type { PropsWithChildren } from "react";
import { SWRConfig } from "swr";

import { AuthProvider } from "./AuthProvider";
import { TenantProvider } from "./TenantProvider";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        keepPreviousData: true,
        dedupingInterval: 30_000,
        focusThrottleInterval: 60_000,
        errorRetryCount: 1,
        shouldRetryOnError: false,
      }}
    >
      <AuthProvider>
        <TenantProvider>{children}</TenantProvider>
      </AuthProvider>
    </SWRConfig>
  );
}
