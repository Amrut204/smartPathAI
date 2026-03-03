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

export function usePointsHistory(limit = 20) {
  return useSWR<{
    totalPoints: number;
    items: Array<{
      id: string;
      source: "study_hours" | "mock_test";
      points: number;
      at: string;
    }>;
  }>(`/api/v1/students/me/points?limit=${limit}`, fetcher, {
    revalidateOnFocus: false,
  });
}
