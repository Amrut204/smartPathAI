import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { askAiOnce } from "../../hooks/use-ai-assistant";
import { type ResourceItem, useResources, useTopicSearch } from "../../hooks/use-resources";
import { Button, Card, Input } from "../../components/ui";

function resolveResourceUrl(url: string): string {
  const value = url.trim();
  if (!value) return "#";

  if (/^https?:\/\//i.test(value)) return value;
  if (/^www\./i.test(value)) return `https://${value}`;

  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("material/")) {
    const relativePath = normalized.slice("material/".length);
    return `/api/v1/resources/file?path=${encodeURIComponent(relativePath)}`;
  }

  if (normalized.endsWith(".pdf")) {
    return `/api/v1/resources/file?path=${encodeURIComponent(normalized)}`;
  }

  return value;
}

function isPdfResource(resource: ResourceItem): boolean {
  const type = String(resource.resourceType ?? "").toLowerCase();
  const url = String(resource.url ?? "").toLowerCase();
  return type === "pdf" || url.includes(".pdf");
}

type ExpandableTextProps = {
  text?: string | null;
  clampLength?: number;
  className?: string;
};

function ExpandableText({ text, clampLength = 160, className }: ExpandableTextProps) {
  const value = (text ?? "").trim();
  const [expanded, setExpanded] = useState(false);
  const rootClassName = `expandable-text-wrap ${expanded ? "expanded" : "collapsed"}${className ? ` ${className}` : ""}`;

  if (!value) {
    return (
      <div className={rootClassName}>
        <p className="expandable-text-content muted-text">No description available.</p>
      </div>
    );
  }

  const canExpand = value.length > clampLength;

  return (
    <div className={rootClassName}>
      <p className="expandable-text-content">{value}</p>
      {canExpand ? (
        <button
          type="button"
          className="expandable-text-toggle"
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

type VisualResourceCardProps = {
  title: string;
  description?: string | null;
  link: string;
  ctaLabel: string;
  ctaVariant?: "primary" | "secondary";
  meta?: string;
  mediaThumbnail?: string;
  mediaAlt?: string;
  descriptionClampLength?: number;
  matchSource?: "pdf_content" | "metadata";
  matchSnippet?: string | null;
};

function VisualResourceCard({
  title,
  description,
  link,
  ctaLabel,
  ctaVariant = "primary",
  meta,
  mediaThumbnail,
  mediaAlt,
  descriptionClampLength = 160,
  matchSource,
  matchSnippet,
}: VisualResourceCardProps) {
  return (
    <Card className="resource-visual-card">
      <div className="resource-card-media">
        {mediaThumbnail ? (
          <img src={mediaThumbnail} alt={mediaAlt ?? title} className="resource-card-media-image" />
        ) : (
          <div className="resource-card-media-fallback">
            <span className="resource-card-media-badge">PDF</span>
          </div>
        )}
      </div>

      <div className="resource-card-body">
        <h3 className="resource-card-title">{title}</h3>
        {matchSource === "pdf_content" ? (
          <p className="resource-match-chip">Matched in PDF content</p>
        ) : null}
        <ExpandableText text={description} clampLength={descriptionClampLength} className="resource-card-description" />
        {matchSnippet ? (
          <p className="resource-match-snippet">...{matchSnippet}...</p>
        ) : null}
        {meta ? <p className="resource-card-meta">{meta}</p> : null}
        <div className="resource-card-footer">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={`ui-button ${ctaVariant}`}
          >
            {ctaLabel}
          </a>
        </div>
      </div>
    </Card>
  );
}

export default function ResourcesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const topicFromUrl = (searchParams.get("topic") ?? "").trim();
  const [topicInput, setTopicInput] = useState(topicFromUrl);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);

  const { data: resources, error, isLoading } = useResources();
  const { data: topicSearchData, error: topicSearchError, isLoading: topicSearchLoading } = useTopicSearch(
    topicFromUrl || null,
  );

  useEffect(() => {
    setTopicInput(topicFromUrl);
  }, [topicFromUrl]);

  const pdfResources = useMemo(
    () => (resources ?? []).filter(isPdfResource),
    [resources],
  );

  const topicResources = useMemo(
    () => (topicSearchData?.resources ?? []).filter(isPdfResource),
    [topicSearchData?.resources],
  );

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
      const data = await askAiOnce(
        `Student asked to study "${topicFromUrl}". Give a focused placement-oriented study plan, key concepts, and practice strategy.`,
      );
      setAiResponse(data.response);
    } catch (submitError) {
      setAiError(submitError instanceof Error ? submitError.message : "Unable to get AI results");
    } finally {
      setAiLoading(false);
    }
  };

  if (isLoading) return <Card>Loading resources...</Card>;
  if (error || !resources) return <Card>Unable to load resources.</Card>;

  const allPdfSection = (
    <div className="resources-all-inside">
      <div className="resources-all-header">
        <h2>All PDF Resources</h2>
        <p>{pdfResources.length} PDFs available.</p>
      </div>

      <div className="resources-pdf-list">
        {pdfResources.map((resource) => {
          const resolvedUrl = resolveResourceUrl(resource.url);
          return (
            <VisualResourceCard
              key={resource.id}
              title={resource.title}
              description={resource.description}
              link={resolvedUrl}
              ctaLabel="View & Start Studying"
              meta={`Duration: ${Math.ceil(resource.durationSec / 60)} min`}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <section className="resources-page">
      <Card className="resources-search-card">
        <h1>Resources</h1>
        <p>All study PDFs are listed below. Use topic search for focused results.</p>
        <form className="form-grid" onSubmit={onSearch}>
          <label>
            Search by topic name
            <Input
              value={topicInput}
              onChange={(event) => setTopicInput(event.target.value)}
              placeholder="e.g., SQL joins, DSA recursion, aptitude percentages"
            />
          </label>
          <Button type="submit">Search Topic</Button>
        </form>
      </Card>

      {topicFromUrl ? (
        <Card className="resources-topic-card">
          <h2>Topic Results: {topicFromUrl}</h2>
          {topicSearchLoading ? <p>Searching resources...</p> : null}
          {topicSearchError ? <p className="error-text">Unable to fetch topic results.</p> : null}

          {topicSearchData?.matchedTopics?.length ? (
            <p>
              Matched topics: {topicSearchData.matchedTopics.map((topic) => topic.name).join(", ")}
            </p>
          ) : null}

          <div className="hero-actions">
            <Button onClick={onShowAiResults} disabled={aiLoading}>
              {aiLoading ? "Getting AI Results..." : "Show AI Results"}
            </Button>
          </div>
          {aiError ? <p className="error-text">{aiError}</p> : null}
          {aiResponse ? <pre className="ai-inline-result">{aiResponse}</pre> : null}

          <div className="resources-topic-columns">
            <aside className="resources-youtube-column">
              <h3>YouTube Videos</h3>
              {topicSearchData?.youtubeVideos?.length ? (
                <div className="resources-topic-list">
                  {topicSearchData.youtubeVideos.map((video) => (
                    <VisualResourceCard
                      key={video.url}
                      title={video.title}
                      description={video.channelName}
                      link={video.url}
                      ctaLabel="View on YouTube"
                      ctaVariant="secondary"
                      mediaThumbnail={video.thumbnailUrl}
                      mediaAlt={video.title}
                      descriptionClampLength={90}
                    />
                  ))}
                </div>
              ) : (
                <p>No YouTube suggestions available for this topic yet.</p>
              )}
            </aside>

            <div className="resources-material-column">
              <h3>Topic Materials</h3>
              {topicResources.length === 0 ? <p>No PDF materials found for this topic.</p> : null}
              <div className="resources-topic-list">
                {topicResources.map((resource) => {
                  const resolvedUrl = resolveResourceUrl(resource.url);
                  return (
                    <VisualResourceCard
                      key={`topic_${resource.id}`}
                      title={resource.title}
                      description={resource.description}
                      matchSource={resource.matchSource}
                      matchSnippet={resource.matchSnippet}
                      link={resolvedUrl}
                      ctaLabel="View & Start Studying"
                      meta={`Duration: ${Math.ceil(resource.durationSec / 60)} min`}
                    />
                  );
                })}
              </div>
              {allPdfSection}
            </div>
          </div>
        </Card>
      ) : null}

      {!topicFromUrl ? allPdfSection : null}
    </section>
  );
}
