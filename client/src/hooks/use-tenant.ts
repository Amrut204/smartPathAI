import { mutate } from "swr";
import useSWR from "swr";

import { withCsrfHeader } from "../utils/csrf";

type ApiResponse<T> = {
  success: boolean;
  data: T;
  error: { code: string; message: string };
};

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = await response.json() as ApiResponse<T>;
  if (!payload.success) {
    throw new Error(payload.error.message);
  }
  return payload.data;
}

export type TenantEmailSettings = {
  fromName?: string;
  fromEmail?: string;
  replyToEmail?: string;
};

export function useTenantSettings() {
  return useSWR<{
    id: string;
    name: string;
    slug: string;
    config: {
      emailSettings?: TenantEmailSettings;
    };
  }>("/api/v1/tenants/me", fetcher, {
    revalidateOnFocus: false,
  });
}

export async function updateTenantEmailSettings(input: TenantEmailSettings) {
  const response = await fetch("/api/v1/tenants/me/email-settings", {
    method: "PATCH",
    credentials: "include",
    headers: withCsrfHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  const payload = await response.json() as ApiResponse<{
    id: string;
    name: string;
    slug: string;
    config: {
      emailSettings?: TenantEmailSettings;
    };
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  await mutate("/api/v1/tenants/me");
  return payload.data;
}
