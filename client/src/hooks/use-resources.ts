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

export interface ResourceItem {
  id: string;
  title: string;
  description: string;
  url: string;
  resourceType: string;
  thumbnailUrl: string | null;
  durationSec: number;
  topicId: string | null;
  matchSource?: "pdf_content" | "metadata";
  matchSnippet?: string | null;
}

export function useResources(topicId?: string) {
  const params = new URLSearchParams();
  if (topicId) {
    params.set("topicId", topicId);
  }

  const url = `/api/v1/resources${params.toString() ? `?${params.toString()}` : ""}`;

  return useSWR<ResourceItem[]>(url, fetcher, {
    revalidateOnFocus: false,
  });
}

export interface TopicSearchResult {
  query: string;
  matchedTopics: Array<{ id: string; name: string }>;
  resources: ResourceItem[];
  youtubeVideos: Array<{
    title: string;
    url: string;
    thumbnailUrl: string;
    channelName: string;
  }>;
}

export function useTopicSearch(topicQuery: string | null) {
  const value = topicQuery?.trim() ?? "";
  const url = value ? `/api/v1/resources/search?topic=${encodeURIComponent(value)}` : null;

  return useSWR<TopicSearchResult>(url, fetcher, {
    revalidateOnFocus: false,
  });
}
