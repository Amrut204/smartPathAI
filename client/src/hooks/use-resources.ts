import useSWR from "swr";
import useSWRInfinite from "swr/infinite";

import { parseApiEnvelope, requestJson } from "../utils/api";

async function fetcher<T>(url: string): Promise<T> {
  return requestJson<T>(url, { credentials: "include" }, "Resources API");
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
  sourceMode?: "local" | "cloud" | "external";
  matchSource?: "pdf_content" | "metadata" | "reference";
  matchSnippet?: string | null;
  summaryShort?: string;
  searchText?: string;
  summaryStatus?: string;
  keywords?: string[];
  keyTopics?: string[];
  onePageTriageBucket?: "keep" | "review" | "hide";
  onePageSuggestedLabel?: string;
  studyDocument?: {
    title?: string;
    topic?: string;
    subtopic?: string;
    branchRelevance?: string[];
    careerTracks?: string[];
    difficulty?: string;
    whatThisCovers?: string;
    keyConcepts?: string[];
    importantDefinitions?: string[];
    coreExplanation?: string;
    stepByStepUnderstanding?: string[];
    interviewFocus?: string[];
    commonMistakes?: string[];
    quickRevisionPoints?: string[];
    practicePrompts?: string[];
    recommendedFor?: string[];
    searchText?: string;
    sourceQualityNotes?: string;
  };
}

export interface PaginatedResourcesResult {
  items: ResourceItem[];
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

export type ResourceListFilter = "all" | "pdf" | "notes" | "guide" | "notebook" | "external";

type ResourcePageResponse = {
  items: ResourceItem[];
  pagination: {
    cursor: string | null;
    hasMore: boolean;
    limit: number;
  };
};

export interface ResourceStorageBudgetMetric {
  used: number;
  limit: number;
  remaining: number;
  warningAt: number;
  percentUsed: number;
  status: "ok" | "warning" | "blocked";
  displayUsed: string;
  displayLimit: string;
  displayRemaining: string;
}

export interface ResourceStorageBudgetStatus {
  enabled: boolean;
  periodKey: string;
  overallStatus: "ok" | "warning" | "blocked";
  requests: ResourceStorageBudgetMetric;
  transfer: ResourceStorageBudgetMetric;
  appliesTo: "cloud_resources";
  message: string | null;
}

export interface ResourceStorageBudgetHistoryItem {
  periodKey: string;
  requestCount: number;
  transferBytes: number;
  transferDisplay: string;
  status: "ok" | "warning" | "blocked";
}

export interface ResourceStorageBudgetDashboard {
  status: ResourceStorageBudgetStatus;
  config: {
    enabled: boolean;
    requestLimit: number;
    requestWarningPct: number;
    transferLimitBytes: number;
    transferWarningPct: number;
    transferLimitDisplay: string;
  };
  history: ResourceStorageBudgetHistoryItem[];
}

async function fetchResourcePage(url: string): Promise<ResourcePageResponse> {
  const response = await fetch(url, { credentials: "include" });
  const payload = await parseApiEnvelope<ResourceItem[]>(response, "Resources API");
  return {
    items: payload.data,
    pagination: {
      cursor: payload.meta?.pagination?.cursor ?? null,
      hasMore: Boolean(payload.meta?.pagination?.has_more),
      limit: payload.meta?.pagination?.limit ?? 24,
    },
  };
}

export function useResources(topicId?: string, options?: { limit?: number; filter?: ResourceListFilter }) {
  const limit = options?.limit ?? 24;
  const filter = options?.filter ?? "all";

  const swr = useSWRInfinite<ResourcePageResponse>(
    (pageIndex, previousPageData) => {
      if (previousPageData && !previousPageData.pagination.hasMore) {
        return null;
      }

      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (topicId) {
        params.set("topicId", topicId);
      }
      if (filter !== "all") {
        params.set("filter", filter);
      }
      if (pageIndex > 0) {
        const cursor = previousPageData?.pagination.cursor;
        if (!cursor) return null;
        params.set("cursor", cursor);
      }

      return `/api/v1/resources?${params.toString()}`;
    },
    fetchResourcePage,
    {
      revalidateOnFocus: false,
      persistSize: true,
    },
  );

  const pages = swr.data ?? [];
  const items = pages.flatMap((page) => page.items);
  const lastPage = pages[pages.length - 1];

  return {
    ...swr,
    data: items,
    limit,
    hasMore: lastPage?.pagination.hasMore ?? false,
    nextCursor: lastPage?.pagination.cursor ?? null,
    isLoading: !swr.data && !swr.error,
    isLoadingMore: swr.isValidating && pages.length > 0,
    loadMore: () => swr.setSize((size) => size + 1),
  };
}

export function useResourceStorageBudget() {
  return useSWR<ResourceStorageBudgetStatus>("/api/v1/resources/storage-budget", fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
  });
}

export function useAdminResourceStorageBudget(enabled = true) {
  const key = enabled ? "/api/v1/resources/admin/storage-budget" : null;
  return useSWR<ResourceStorageBudgetDashboard>(key, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
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
