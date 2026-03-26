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
  title: string;
  content: string;
  difficulty: string | null;
  topicId: string | null;
  topicName?: string | null;
  createdAt: string;
}

export interface VaultMockTest {
  id: string;
  title: string;
  topicId: string | null;
  companyId: string | null;
  topicName?: string | null;
  companyName?: string | null;
  durationSec: number;
  difficulty: string;
  attemptCount: number;
}

export interface VaultResourceSummary {
  id: string;
  title: string;
  description: string;
  url: string;
  resourceType: string;
  sourceMode: string;
  summaryShort?: string;
  keyTopics?: string[];
  companyRelevanceScore?: number;
  companyRankingReasons?: string[];
  globalOpenCount?: number;
  openedByStudent?: boolean;
}

export interface VaultDriveSummary {
  id: string;
  company: string;
  role: string;
  driveDate: string;
  status: string;
  eligibleCount: number;
}

export interface VaultCompanyHub {
  company: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
  stats: {
    totalItems: number;
    mockCount: number;
    resourceCount: number;
    upcomingDriveCount: number;
    typeCounts: {
      question: number;
      tip: number;
      pastPaper: number;
      experience: number;
    };
  };
  studentProgress: {
    attemptedMocks: number;
    mockCoveragePct: number;
    avgMockScore: number;
    openedResources: number;
    resourceCoveragePct: number;
    lastAttemptAt: string | null;
    lastResourceOpenAt: string | null;
  };
  prepSignals: {
    topTopics: Array<{ name: string; count: number }>;
    recommendedFocus: string[];
    weakTopics: string[];
    roundHints: string[];
  };
  sections: {
    quickStart: VaultItem[];
    pastPapers: VaultItem[];
    interviewExperiences: VaultItem[];
    quickTips: VaultItem[];
    questionBank: VaultItem[];
    relatedMocks: VaultMockTest[];
    relatedResources: VaultResourceSummary[];
    upcomingDrives: VaultDriveSummary[];
  };
}

export function useVaultCompanies() {
  return useSWR<VaultCompany[]>("/api/v1/vault", fetcher, {
    revalidateOnFocus: false,
  });
}

export function useVaultItems(companyId: string | null) {
  const url = companyId ? `/api/v1/vault/${companyId}` : null;

  return useSWR<VaultCompanyHub>(url, fetcher, {
    revalidateOnFocus: false,
  });
}
