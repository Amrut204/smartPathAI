import useSWR from "swr";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: { code: string; message: string; details?: Array<{ field?: string; message: string }> };
  meta?: { pagination?: { cursor: string | null; has_more: boolean; limit: number }; timestamp?: string; correlation_id?: string };
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export interface VaultCompany {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  resourceCount: number;
}

export interface VaultItem {
  id: string;
  type: string;
  content: string;
  difficulty: string | null;
  topicId: string | null;
  createdAt: string;
}

export function useVaultCompanies() {
  return useSWR<VaultCompany[]>("/api/v1/vault", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useVaultItems(companyId: string | null, type?: string) {
  const params = new URLSearchParams();
  if (type) {
    params.set("type", type);
  }

  const url = companyId
    ? `/api/v1/vault/${companyId}${params.toString() ? `?${params.toString()}` : ""}`
    : null;

  return useSWR<VaultItem[]>(url, fetcher, {
    revalidateOnFocus: false,
  });
}
