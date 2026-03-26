import useSWR from "swr";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { message: string };
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Request failed");
  }
  return payload.data;
}

export interface PlatformOverview {
  timestamp: string;
  tenants: { total: number; active: number };
  users: { total: number; active: number; byRole: { student: number; tpo: number; admin: number } };
  students: { total: number };
  drives: { total: number };
  communications: { total: number };
  activity: { events7d: number };
}

export function usePlatformOverview() {
  return useSWR<PlatformOverview>("/api/internal/platform-overview", fetcher, {
    revalidateOnFocus: false,
  });
}

