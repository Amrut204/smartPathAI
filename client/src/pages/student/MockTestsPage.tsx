import { Link } from "react-router-dom";
import { useMemo, useState } from "react";

import { PilotFeedbackStrip } from "../../components/composites/PilotFeedbackStrip";
import { Badge, Button, Card, Select, Spinner, Tabs } from "../../components/ui";
import { isClientFeatureEnabled } from "../../config/features";
import {
  useCuratedMockTests,
  type MockTestListItem,
  useInfiniteMockTests,
  useMockTestCompanyOptions,
  useMockTestTopicOptions,
} from "../../hooks/use-mock-tests";

function difficultyTone(difficulty: string) {
  const value = difficulty.toLowerCase();
  if (value === "hard") return "danger";
  if (value === "medium") return "warning";
  return "success";
}

function TestCard({
  test,
  topicName,
  companyName,
}: {
  test: MockTestListItem;
  topicName?: string;
  companyName?: string;
}) {
  return (
    <Card className="mock-discovery-card">
      <div className="mock-discovery-head">
        <div>
          <h3>{test.title}</h3>
          <p>{topicName ?? test.topicName ?? "Open topic"}{companyName ?? test.companyName ? ` - ${companyName ?? test.companyName}` : ""}</p>
        </div>
        <Badge variant={difficultyTone(test.difficulty)}>{test.difficulty}</Badge>
      </div>

      <div className="mock-discovery-stats">
        <div>
          <span>Duration</span>
          <strong>{Math.ceil(test.durationSec / 60)} min</strong>
        </div>
        <div>
          <span>Attempts</span>
          <strong>{test.attemptCount}</strong>
        </div>
      </div>

      <div className="mock-discovery-footer">
        <Link to={`/mock-tests/${test.id}`}>
          <Button>Open Test</Button>
        </Link>
      </div>
    </Card>
  );
}

export default function MockTestsPage() {
  const [topicId, setTopicId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [activeSection, setActiveSection] = useState("recommended");

  const {
    items,
    error,
    isLoadingInitial,
    isLoadingMore,
    hasMore,
    size,
    setSize,
  } = useInfiniteMockTests({
    topicId: topicId || undefined,
    companyId: companyId || undefined,
    difficulty: difficulty || undefined,
    limit: 24,
  });
  const { data: curatedCatalog } = useCuratedMockTests({
    topicId: topicId || undefined,
    companyId: companyId || undefined,
    difficulty: difficulty || undefined,
  });
  const { data: topicOptions, isLoading: topicOptionsLoading } = useMockTestTopicOptions();
  const { data: companyOptions, isLoading: companyOptionsLoading } = useMockTestCompanyOptions();
  const showExpandedMockCatalog = isClientFeatureEnabled("studentExpandedMockCatalog");

  const topicMap = useMemo(
    () => new Map((topicOptions ?? []).map((topic) => [topic.id, topic.name])),
    [topicOptions],
  );
  const companyMap = useMemo(
    () => new Map((companyOptions ?? []).map((company) => [company.id, company.name])),
    [companyOptions],
  );

  const mockSections = useMemo(() => {
    const sections = [
      { id: "recommended", label: "Suggested", items: curatedCatalog?.sections.recommended ?? [] },
      { id: "company", label: "Company Prep", items: curatedCatalog?.sections.companyPrep ?? [] },
      { id: "verbal", label: "Verbal", items: curatedCatalog?.sections.verbal ?? [] },
      { id: "all", label: "All Tests", items },
    ].filter((section) => section.items.length > 0 || section.id === "all");
    return sections;
  }, [curatedCatalog?.sections.companyPrep, curatedCatalog?.sections.recommended, curatedCatalog?.sections.verbal, items]);

  const resolvedActiveSection = mockSections.some((section) => section.id === activeSection)
    ? activeSection
    : (mockSections[0]?.id ?? "all");
  const currentSection = mockSections.find((section) => section.id === resolvedActiveSection) ?? null;

  return (
    <section className="student-workspace-shell mock-tests-page">
      <section className="student-workspace-header">
        <div className="mock-hero-copy">
          <p className="resources-kicker">Practice Library</p>
          <h1>Find a test by topic, company, and difficulty.</h1>
          <p>Use the filters below to narrow the catalog, then open the test you want to attempt.</p>
        </div>
        {showExpandedMockCatalog && curatedCatalog ? (
          <div className="student-workspace-metrics">
            <div><span>Catalog</span><strong>{curatedCatalog.stats.totalCatalog}</strong></div>
            <div><span>Hard Sets</span><strong>{curatedCatalog.stats.hardSets}</strong></div>
            <div><span>Company Focused</span><strong>{curatedCatalog.stats.companyFocused}</strong></div>
            <div><span>Avg Attempts</span><strong>{curatedCatalog.stats.avgAttempts.toFixed(1)}</strong></div>
          </div>
        ) : null}
      </section>

      <section className="student-workspace-panel mock-filter-toolbar">
        <div className="mock-filter-grid">
          <label>
            Topic
            <Select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
              <option value="">All Topics</option>
              {(topicOptions ?? []).map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </Select>
            {topicOptionsLoading ? <small className="muted-text">Loading topics...</small> : null}
          </label>
          <label>
            Company
            <Select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="">All Companies</option>
              {(companyOptions ?? []).map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
            {companyOptionsLoading ? <small className="muted-text">Loading companies...</small> : null}
          </label>
          <label>
            Difficulty
            <Select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              <option value="">All</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </label>
        </div>
      </section>

      {isLoadingInitial ? <div className="student-workspace-panel app-state-card"><Spinner /><p className="muted-text">Loading tests...</p></div> : null}
      {error ? <div className="student-workspace-panel app-state-card app-state-card-error"><h2>Unable to load tests</h2></div> : null}

      {showExpandedMockCatalog && !isLoadingInitial && !error && mockSections.length > 0 ? (
        <div className="student-workspace-switcher">
          <Tabs
            tabs={mockSections.map((section) => ({ id: section.id, label: section.label }))}
            activeId={resolvedActiveSection}
            onChange={(id) => setActiveSection(id)}
          />
        </div>
      ) : null}

      {!isLoadingInitial && !error ? (
        <section className="mock-section">
          <div className="mock-section-header">
            <div>
              <h2>{showExpandedMockCatalog ? (currentSection?.label ?? "Available Tests") : "Available Tests"}</h2>
              <p>
                {showExpandedMockCatalog
                  ? "Browse the section that fits your current preparation mode."
                  : "Open the tests that match your current topic, company, and difficulty filters."}
              </p>
            </div>
            <span className="mock-section-count">{showExpandedMockCatalog ? (currentSection?.items.length ?? 0) : items.length}</span>
          </div>

          {(showExpandedMockCatalog ? (currentSection?.items.length ?? 0) === 0 : items.length === 0) ? (
            <Card className="resources-empty-card">No tests match the current filters.</Card>
          ) : null}

          <div className="mock-discovery-grid">
            {(showExpandedMockCatalog ? (currentSection?.items ?? []) : items).map((test) => (
              <TestCard
                key={test.id}
                test={test}
                topicName={test.topicId ? topicMap.get(test.topicId) : undefined}
                companyName={test.companyId ? companyMap.get(test.companyId) : undefined}
              />
            ))}
          </div>
        </section>
      ) : null}

      {!showExpandedMockCatalog && !isLoadingInitial && !error && hasMore ? (
        <section className="student-workspace-panel">
          <div className="hero-actions">
            <Button onClick={() => setSize(size + 1)} disabled={isLoadingMore}>
              {isLoadingMore ? "Loading more..." : "Load More Tests"}
            </Button>
          </div>
        </section>
      ) : null}

      <PilotFeedbackStrip
        title="Problem with a mock test?"
        description="Report timer issues, missing questions, wrong results, or any problem you hit during a test attempt."
      />
    </section>
  );
}
