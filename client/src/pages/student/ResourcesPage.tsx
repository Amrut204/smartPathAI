import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { askAiOnce } from "../../hooks/use-ai-assistant";
import { PilotFeedbackStrip } from "../../components/composites/PilotFeedbackStrip";
import { isClientFeatureEnabled } from "../../config/features";
import {
  type ResourceItem,
  type ResourceStorageBudgetStatus,
  useResourceStorageBudget,
  useResources,
  useTopicSearch,
} from "../../hooks/use-resources";
import { useStudentDashboard } from "../../hooks/use-student-dashboard";
import { Button, Card, Input, Skeleton, Tabs } from "../../components/ui";
import { finishPerfMark, startPerfMark } from "../../utils/perf";

type ResourceFilter = "all" | "pdf" | "notes" | "guide" | "notebook" | "external";

const RESOURCE_FILTERS: Array<{ id: ResourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "pdf", label: "PDFs" },
  { id: "notes", label: "Notes" },
  { id: "guide", label: "Guides" },
  { id: "notebook", label: "Notebooks" },
  { id: "external", label: "External" },
];

function resourceTypeLabel(resource: ResourceItem): string {
  const type = String(resource.resourceType ?? "").toLowerCase();
  if (type === "pdf") return "PDF";
  if (type === "markdown") return "Guide";
  if (type === "notebook") return "Notebook";
  if (type === "text" || type === "notes") return "Notes";
  if (type === "document") return "Document";
  if (type === "external_link") return "External";
  return type ? type.replace(/_/g, " ") : "Resource";
}

function resourceCtaLabel(resource: ResourceItem): string {
  if (resource.sourceMode === "external") {
    return "Open External Resource";
  }
  const type = String(resource.resourceType ?? "").toLowerCase();
  if (type === "notebook") return "Open Notebook";
  if (type === "markdown" || type === "text" || type === "notes") return "Open Notes";
  if (type === "pdf") return "Open PDF";
  return "Open Resource";
}

function resourceSummary(resource: ResourceItem): string {
  return resource.studyDocument?.whatThisCovers?.trim()
    || resource.summaryShort?.trim()
    || resource.description?.trim()
    || "No description available.";
}

function matchesFilter(resource: ResourceItem, filter: ResourceFilter) {
  const type = String(resource.resourceType ?? "").toLowerCase();
  if (filter === "all") return true;
  if (filter === "pdf") return type === "pdf";
  if (filter === "notes") return type === "text" || type === "notes" || type === "document";
  if (filter === "guide") return type === "markdown";
  if (filter === "notebook") return type === "notebook";
  if (filter === "external") return type === "external_link" || resource.sourceMode === "external";
  return true;
}

function ResourceCard({ resource }: { resource: ResourceItem }) {
  return (
    <Card className="resource-visual-card">
      <div className="resource-card-media">
        {resource.thumbnailUrl ? (
          <img src={resource.thumbnailUrl} alt={resource.title} className="resource-card-media-image" />
        ) : (
          <div className="resource-card-media-fallback">
            <span className="resource-card-media-badge">{resourceTypeLabel(resource)}</span>
          </div>
        )}
      </div>

      <div className="resource-card-body">
        <div className="resource-card-head">
          <h3 className="resource-card-title">{resource.title}</h3>
        </div>
        <p className="resource-card-meta">{resourceSummary(resource)}</p>
        {(resource.keyTopics ?? []).length > 0 ? (
          <div className="resource-topic-chips">
            {(resource.keyTopics ?? []).slice(0, 3).map((topic) => (
              <span key={`${resource.id}_${topic}`} className="resource-topic-chip">{topic}</span>
            ))}
          </div>
        ) : null}
        <p className="resource-card-meta">
          {resourceTypeLabel(resource)}
          {resource.durationSec > 0 ? ` - ${Math.ceil(resource.durationSec / 60)} min` : ""}
        </p>
        <div className="resource-card-footer">
          <Link
            to={`/resources/view/${encodeURIComponent(resource.id)}`}
            state={{ resource }}
            className="ui-button primary"
          >
            {resourceCtaLabel(resource)}
          </Link>
        </div>
      </div>
    </Card>
  );
}

function ResourceCardSkeleton() {
  return (
    <Card className="resource-visual-card">
      <div className="resource-card-media resource-card-media-fallback">
        <Skeleton size="md" />
      </div>
      <div className="resource-card-body">
        <div style={{ display: "grid", gap: 10 }}>
          <Skeleton size="md" />
          <Skeleton size="sm" />
          <Skeleton size="sm" />
          <Skeleton size="md" />
        </div>
      </div>
    </Card>
  );
}

function budgetBannerCopy(budget: ResourceStorageBudgetStatus) {
  if (budget.overallStatus === "blocked") {
    return budget.message ?? "Cloud resource opens are paused for the rest of this month to prevent extra AWS charges.";
  }

  return budget.message
    ?? `Cloud resource usage is close to this month's safety cap: ${budget.requests.used}/${budget.requests.limit} reads and ${budget.transfer.displayUsed}/${budget.transfer.displayLimit} transfer used.`;
}

export default function ResourcesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const topicFromUrl = (searchParams.get("topic") ?? "").trim();
  const [topicInput, setTopicInput] = useState(topicFromUrl);
  const [activeFilter, setActiveFilter] = useState<ResourceFilter>("all");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("recommended");

  const {
    data: resources,
    error,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
  } = useResources();
  const { data: storageBudget } = useResourceStorageBudget();
  const { data: dashboard } = useStudentDashboard();
  const { data: topicSearchData, error: topicSearchError, isLoading: topicSearchLoading } = useTopicSearch(topicFromUrl || null);
  const showExpandedResources = isClientFeatureEnabled("studentExpandedResources");
  const showAiStudyAssist = isClientFeatureEnabled("studentAiStudyAssist");
  const branchTrackLabel = dashboard?.branchTrack?.label ?? "your track";
  const branchTrackFocusAreas = Array.isArray(dashboard?.branchTrack?.focusAreas) ? dashboard.branchTrack.focusAreas : [];

  useEffect(() => {
    startPerfMark("student-resources:first-visible");
    return () => finishPerfMark("student-resources:first-visible");
  }, []);

  useEffect(() => {
    if (!isLoading && !topicSearchLoading && (resources ?? []).length > 0) {
      finishPerfMark("student-resources:first-visible");
    }
  }, [isLoading, resources, topicSearchLoading]);

  const resourceMap = useMemo(
    () => new Map((resources ?? []).map((resource) => [resource.id, resource])),
    [resources],
  );

  const continueReadingResources = useMemo(
    () => (dashboard?.resourceUsage.recentResources ?? [])
      .map((item) => resourceMap.get(item.resourceId))
      .filter((item): item is ResourceItem => Boolean(item))
      .slice(0, 6),
    [dashboard?.resourceUsage.recentResources, resourceMap],
  );

  const visibleResources = useMemo(() => {
    const base = topicFromUrl ? (topicSearchData?.resources ?? []) : (resources ?? []);
    return base.filter((resource) => matchesFilter(resource, activeFilter));
  }, [activeFilter, resources, topicFromUrl, topicSearchData?.resources]);

  const recommendedResources = useMemo(() => {
    if (branchTrackFocusAreas.length === 0) return [] as ResourceItem[];
    return visibleResources
      .filter((resource) => {
        const haystack = `${resource.title} ${resource.description} ${resource.summaryShort ?? ""}`.toLowerCase();
        return branchTrackFocusAreas.some((item) => haystack.includes(item.topicName.toLowerCase()));
      })
      .slice(0, 8);
  }, [branchTrackFocusAreas, visibleResources]);

  const expandedSections = useMemo(() => {
    const sections = [
      { id: "recommended", label: "Recommended", items: recommendedResources },
      { id: "continue", label: "Continue", items: continueReadingResources },
      { id: "all", label: "All Resources", items: visibleResources },
    ].filter((section) => section.items.length > 0 || section.id === "all");
    return sections;
  }, [continueReadingResources, recommendedResources, visibleResources]);

  const resolvedSection = expandedSections.some((section) => section.id === activeSection)
    ? activeSection
    : (expandedSections[0]?.id ?? "all");

  const currentSection = expandedSections.find((section) => section.id === resolvedSection) ?? null;
  const activeItems = showExpandedResources && !topicFromUrl ? (currentSection?.items ?? []) : visibleResources;

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = topicInput.trim();
    if (!value) {
      setSearchParams({});
      setAiResponse("");
      setAiError(null);
      return;
    }
    setSearchParams({ topic: value });
    setAiResponse("");
    setAiError(null);
  };

  const onShowAiResults = async () => {
    if (!topicFromUrl || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const data = await askAiOnce(`Student asked to study "${topicFromUrl}". Give a focused placement-oriented study plan, key concepts, and practice strategy.`);
      setAiResponse(data.response);
    } catch (submitError) {
      setAiError(submitError instanceof Error ? submitError.message : "Unable to get AI results");
    } finally {
      setAiLoading(false);
    }
  };

  if (error && !resources) {
    return <Card className="app-state-card app-state-card-error"><h2>Unable to load resources</h2></Card>;
  }

  return (
    <section className="student-workspace-shell resources-page">
      <section className="student-workspace-header resources-hero-card">
        <div className="resources-hero-copy">
          <p className="resources-kicker">Resource Library</p>
          <h1>Search and open placement study material from one place.</h1>
          <p>Use topic search and content-type filters to find the exact material you need, then continue reading from where you left off.</p>
        </div>
      </section>

      <section className="student-workspace-panel resources-toolbar-card">
        {storageBudget?.enabled && storageBudget.overallStatus !== "ok" ? (
          <Card className={`app-state-card${storageBudget.overallStatus === "blocked" ? " app-state-card-error" : ""}`}>
            <h2>{storageBudget.overallStatus === "blocked" ? "Cloud Resource Access Paused" : "Cloud Resource Usage Warning"}</h2>
            <p className="muted-text">{budgetBannerCopy(storageBudget)}</p>
            <p className="muted-text">
              Reads: {storageBudget.requests.used}/{storageBudget.requests.limit}
              {" - "}
              Transfer: {storageBudget.transfer.displayUsed}/{storageBudget.transfer.displayLimit}
            </p>
          </Card>
        ) : null}

        <form className="resources-topic-form" onSubmit={onSearch}>
          <label className="resources-field">
            <span>Search resources</span>
            <Input
              value={topicInput}
              onChange={(event) => setTopicInput(event.target.value)}
              placeholder="e.g., SQL joins, percentages, operating systems"
            />
          </label>
          <button type="submit" className="ui-button primary">Search</button>
        </form>

        <div className="resources-filter-row">
          {RESOURCE_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`resources-filter-chip${activeFilter === filter.id ? " active" : ""}`}
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="resources-toolbar-meta">
          <span>{activeItems.length} resource(s) loaded in this view</span>
          {topicFromUrl ? (
            <span>Showing topic results for "{topicFromUrl}"</span>
          ) : null}
          {showExpandedResources && dashboard ? (
            <span>Recommended for {branchTrackLabel}: {branchTrackFocusAreas.map((item) => item.topicName).join(", ")}</span>
          ) : null}
        </div>
      </section>

      {showExpandedResources && !topicFromUrl && expandedSections.length > 0 ? (
        <div className="student-workspace-switcher">
          <Tabs
            tabs={expandedSections.map((section) => ({ id: section.id, label: section.label }))}
            activeId={resolvedSection}
            onChange={(id) => setActiveSection(id)}
          />
        </div>
      ) : null}

      {!showExpandedResources && continueReadingResources.length > 0 ? (
        <section className="resources-section">
          <div className="resources-section-header">
            <div>
              <h2>Continue Reading</h2>
              <p>Pick up the resources you opened recently.</p>
            </div>
            <span className="resources-section-count">{continueReadingResources.length}</span>
          </div>

          <div className="resources-card-grid">
            {continueReadingResources.map((resource) => (
              <ResourceCard key={`continue_${resource.id}`} resource={resource} />
            ))}
          </div>
        </section>
      ) : null}

      {showExpandedResources && topicFromUrl && showAiStudyAssist ? (
        <section className="student-workspace-panel">
          <div className="student-workspace-panel-head">
            <div>
              <h2>AI Study Assist</h2>
              <p>Generate a focused study approach for this topic.</p>
            </div>
            <Button onClick={onShowAiResults} disabled={aiLoading}>
              {aiLoading ? "Getting AI Results..." : "Show AI Results"}
            </Button>
          </div>
          {aiError ? <p className="error-text">{aiError}</p> : null}
          {aiResponse ? <pre className="ai-inline-result">{aiResponse}</pre> : null}
        </section>
      ) : null}

      <section className="resources-section">
        <div className="resources-section-header">
          <div>
            <h2>
              {topicFromUrl
                ? "Search Results"
                : showExpandedResources
                  ? (currentSection?.label ?? "All Resources")
                  : "All Resources"}
            </h2>
            <p>
              {topicFromUrl
                ? "Matched materials from your topic search."
                : showExpandedResources && resolvedSection === "recommended"
                  ? "Resources aligned to your current branch focus."
                  : showExpandedResources && resolvedSection === "continue"
                    ? "Pick up the resources you opened recently."
                    : "Browse the current filtered library."}
            </p>
          </div>
          <span className="resources-section-count">{activeItems.length}</span>
        </div>

        {topicSearchLoading ? <Card className="app-state-card app-state-card-compact"><p className="muted-text">Searching resources...</p></Card> : null}
        {topicSearchError ? <p className="error-text">Unable to fetch topic results.</p> : null}

        {!topicSearchLoading && !isLoading && activeItems.length === 0 ? (
          <Card className="resources-empty-card">
            {topicFromUrl ? "No resources match this topic and filter." : "No resources match the current filter."}
          </Card>
        ) : null}

        <div className="resources-card-grid">
          {isLoading
            ? Array.from({ length: 8 }).map((_, index) => <ResourceCardSkeleton key={`resource-skeleton-${index}`} />)
            : activeItems.map((resource) => <ResourceCard key={resource.id} resource={resource} />)}
        </div>

        {!topicFromUrl && !isLoading && hasMore ? (
          <div className="resources-load-more">
            <Button variant="secondary" onClick={() => void loadMore()} disabled={isLoadingMore}>
              {isLoadingMore ? "Loading more..." : "Load More"}
            </Button>
          </div>
        ) : null}
      </section>

      <PilotFeedbackStrip
        title="Missing file or wrong resource?"
        description="Use these links if a resource does not open, the wrong content appears, or an external link is broken."
      />
    </section>
  );
}
