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

export interface LeaderboardRow {
  id: string;
  userId: string;
  points: number;
  readinessScore: number;
}

export function useLeaderboard(limit = 20) {
  return useSWR<{ items: LeaderboardRow[]; hasMore: boolean; nextCursor: string | null }>(`/api/v1/students/leaderboard?limit=${limit}`, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 20_000,
  });
}
