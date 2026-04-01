import { Link } from "react-router-dom";
import { useMemo, useState, type MouseEvent } from "react";

import { PilotFeedbackStrip } from "../../components/composites/PilotFeedbackStrip";
import { Badge, Button, Card, Select, Spinner } from "../../components/ui";
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

function difficultyFitLabel(value?: "stretch" | "fit" | "easy") {
  if (value === "stretch") return "Stretch";
  if (value === "easy") return "Warm-up";
  return "Best fit";
}

function TestCard({
  test,
  topicName,
  companyName,
  emphasizeReasons = false,
}: {
  test: MockTestListItem;
  topicName?: string;
  companyName?: string;
  emphasizeReasons?: boolean;
}) {
  return (
    <Card className="mock-discovery-card">
      <div className="mock-discovery-head">
        <div>
          <h3>{test.title}</h3>
          <p>{topicName ?? test.topicName ?? "Open topic"}{companyName ?? test.companyName ? ` - ${companyName ?? test.companyName}` : ""}</p>
        </div>
        <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
          <Badge variant={difficultyTone(test.difficulty)}>{test.difficulty}</Badge>
          {test.difficultyFit ? <Badge variant="warning">{difficultyFitLabel(test.difficultyFit)}</Badge> : null}
        </div>
      </div>

      {emphasizeReasons && (test.recommendationReasons?.length ?? 0) > 0 ? (
        <div className="resource-topic-chips">
          {(test.recommendationReasons ?? []).map((reason) => (
            <span key={`${test.id}_${reason}`} className="resource-topic-chip resource-topic-chip-reason">{reason}</span>
          ))}
        </div>
      ) : null}

      {(test.lastScore !== null && test.lastScore !== undefined) || test.lastSubmittedAt ? (
        <div className="resource-topic-chips">
          {test.lastScore !== null && test.lastScore !== undefined ? (
            <span className="resource-topic-chip">Last score {Math.round(test.lastScore)}%</span>
          ) : null}
          {test.lastSubmittedAt ? (
            <span className="resource-topic-chip">Last attempt {new Date(test.lastSubmittedAt).toLocaleDateString()}</span>
          ) : null}
        </div>
      ) : null}

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

  const scrollToLayer = (event: MouseEvent<HTMLButtonElement>, layerId: string) => {
    event.preventDefault();
    const target = document.getElementById(layerId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const recommendationSections = useMemo(() => {
    if (!curatedCatalog) return [] as Array<{
      id: string;
      eyebrow: string;
      label: string;
      description: string;
      accent: "branch" | "essentials" | "company" | "interview";
      items: MockTestListItem[];
    }>;

    return [
      {
        id: "branch",
        eyebrow: "Layer 1",
        label: "For Your Branch",
        description: curatedCatalog.context.branchCoverageQualified
          ? `${curatedCatalog.context.branchTrackLabel ?? "Your branch"} practice and branch-relevant technical tests.`
          : `A guided starter layer for ${curatedCatalog.context.branchTrackLabel ?? "your branch"}, with common prep kept strong while branch depth grows.`,
        accent: "branch",
        items: curatedCatalog.sections.forYourBranch,
      },
      {
        id: "essentials",
        eyebrow: "Layer 2",
        label: "Placement Essentials",
        description: "Common placement prep that stays valuable across branches: aptitude, reasoning, verbal, and foundational readiness.",
        accent: "essentials",
        items: curatedCatalog.sections.placementEssentials,
      },
      {
        id: "company",
        eyebrow: "Layer 3",
        label: "Company Pattern Prep",
        description: "Tests boosted for upcoming drives, role context, and company-linked practice.",
        accent: "company",
        items: curatedCatalog.sections.companyPatternPrep,
      },
      {
        id: "interview",
        eyebrow: "Layer 4",
        label: "Interview Practice",
        description: "Round-based mock support, viva-style rehearsal, and interview-adjacent practice.",
        accent: "interview",
        items: curatedCatalog.sections.interviewPractice,
      },
    ].filter((section) => section.items.length > 0);
  }, [curatedCatalog]);

  const quickJumpItems = useMemo(() => {
    const items = recommendationSections.map((section) => ({
      id: section.id,
      label: section.label,
      description: section.description,
    }));
    return [
      ...items,
      { id: "explore", label: "Explore More", description: "Use the full library after the guided layers." },
    ];
  }, [recommendationSections]);

  return (
    <section className="student-workspace-shell mock-tests-page">
      <section className="student-workspace-header">
        <div className="mock-hero-copy">
          <p className="resources-kicker">Practice Library</p>
          <h1>Take the best next test for your current preparation state.</h1>
          <p>Use the filters below to narrow the catalog, then lean on the smart sections to decide what to attempt next.</p>
          {showExpandedMockCatalog && curatedCatalog ? (
            <div className="resources-hero-pills">
              <span className="resources-hero-pill">Branch path: {curatedCatalog.context.branchTrackLabel ?? "General placement prep"}</span>
              {curatedCatalog.context.targetRoles.map((role) => (
                <span key={`target-role-${role}`} className="resources-hero-pill resources-hero-pill-muted">{role}</span>
              ))}
            </div>
          ) : null}
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

      {showExpandedMockCatalog && curatedCatalog ? (
        <section className="resources-discovery-strip">
          <div className="resources-discovery-copy">
            <p className="resources-kicker">How This Page Works</p>
            <h2>Mock tests now follow the same guided preparation flow as Resources.</h2>
            <p>
              Start with {curatedCatalog.context.branchTrackLabel ?? "your branch"}, move through placement essentials,
              then company-pattern and interview practice before browsing the wider catalog.
            </p>
          </div>
          <div className="resources-discovery-steps">
            {quickJumpItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`resources-discovery-step${item.id === "branch" ? " resources-discovery-step-branch" : ""}${item.id === "essentials" ? " resources-discovery-step-essentials" : ""}${item.id === "company" ? " resources-discovery-step-company" : ""}${item.id === "interview" ? " resources-discovery-step-interview" : ""}`}
                onClick={(event) => scrollToLayer(event, `mock-layer-${item.id}`)}
              >
                <strong>{index + 1}. {item.label}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

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

      {showExpandedMockCatalog && !isLoadingInitial && !error && curatedCatalog?.preDriveBundle ? (
        <section className="mock-section mock-section-company" id="mock-layer-pre-drive">
          <div className="mock-section-header">
            <div>
              <p className="resources-section-eyebrow">Drive Bundle</p>
              <h2>{curatedCatalog.preDriveBundle.title}</h2>
              <p>{curatedCatalog.preDriveBundle.description}</p>
            </div>
            <span className="mock-section-count">{curatedCatalog.preDriveBundle.items.length}</span>
          </div>
          <div className="mock-discovery-grid">
            {curatedCatalog.preDriveBundle.items.map((test) => (
              <TestCard
                key={`pre-drive_${test.id}`}
                test={test}
                topicName={test.topicId ? topicMap.get(test.topicId) : undefined}
                companyName={test.companyId ? companyMap.get(test.companyId) : undefined}
                emphasizeReasons
              />
            ))}
          </div>
        </section>
      ) : null}

      {showExpandedMockCatalog && !isLoadingInitial && !error ? recommendationSections.map((section) => (
        <section key={section.id} id={`mock-layer-${section.id}`} className={`mock-section mock-section-${section.accent}`}>
          <div className="mock-section-header">
            <div>
              <p className="resources-section-eyebrow">{section.eyebrow}</p>
              <h2>{section.label}</h2>
              <p>{section.description}</p>
              {section.id === "branch" && section.items.length > 0 && section.items.length <= 8 ? (
                <p className="muted-text">More branch-specific tests will appear here as the catalog expands.</p>
              ) : null}
            </div>
            <span className="mock-section-count">{section.items.length}</span>
          </div>

          <div className="mock-discovery-grid">
            {section.items.map((test) => (
              <TestCard
                key={`${section.id}_${test.id}`}
                test={test}
                topicName={test.topicId ? topicMap.get(test.topicId) : undefined}
                companyName={test.companyId ? companyMap.get(test.companyId) : undefined}
                emphasizeReasons
              />
            ))}
          </div>
        </section>
      )) : null}

      {!isLoadingInitial && !error ? (
        <section id="mock-layer-explore" className="mock-section">
          <div className="mock-section-header">
            <div>
              <p className="resources-section-eyebrow">Full Library</p>
              <h2>Explore More Tests</h2>
              <p>Browse the filtered catalog directly whenever you want to go wider than the top recommendations.</p>
            </div>
            <span className="mock-section-count">{items.length}</span>
          </div>

          {items.length === 0 ? (
            <Card className="resources-empty-card">No tests match the current filters.</Card>
          ) : null}

          <div className="mock-discovery-grid">
            {items.map((test) => (
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

      {!isLoadingInitial && !error && hasMore ? (
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
