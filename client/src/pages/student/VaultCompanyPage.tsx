import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge, Button, Card, Select } from "../../components/ui";
import { type VaultItem, useVaultItems } from "../../hooks/use-vault";

function difficultyTone(difficulty: string | null) {
  const value = String(difficulty ?? "").toLowerCase();
  if (value === "hard") return "danger";
  if (value === "medium") return "warning";
  if (value === "easy") return "success";
  return "default";
}

function typeLabel(type: string) {
  if (type === "past_paper") return "Past Paper";
  if (type === "experience") return "Experience";
  if (type === "question") return "Question";
  if (type === "tip") return "Tip";
  return type.replace(/_/g, " ");
}

function formatDate(value: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function getCompanyAccent(name: string) {
  const seed = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const hue = seed % 360;
  return {
    hue,
    style: {
      "--company-accent": `hsl(${hue} 72% 48%)`,
      "--company-accent-soft": `hsl(${hue} 88% 95%)`,
      "--company-accent-border": `hsl(${hue} 60% 82%)`,
    } as CSSProperties,
  };
}

function VaultContentCard({ item }: { item: VaultItem }) {
  return (
    <Card className="company-hub-content-card">
      <div className="company-hub-content-head">
        <div>
          <p className="resources-kicker">{typeLabel(item.type)}</p>
          <h3>{item.title}</h3>
          <p>{item.topicName ?? "General preparation"}</p>
        </div>
        <Badge variant={difficultyTone(item.difficulty)}>{item.difficulty ?? "general"}</Badge>
      </div>
      <p className="company-hub-content-copy">{item.content}</p>
      <p className="muted-text">Added {formatDate(item.createdAt)}</p>
    </Card>
  );
}

function Section({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="mock-section company-hub-section">
      <div className="mock-section-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="mock-section-count">{count}</span>
      </div>
      {children}
    </section>
  );
}

export default function VaultCompanyPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const [sectionFilter, setSectionFilter] = useState("all");

  const { data, error, isLoading } = useVaultItems(companyId ?? null);
  const accent = useMemo(() => getCompanyAccent(data?.company.name ?? "Company"), [data?.company.name]);

  const filteredSections = useMemo(() => {
    if (!data) {
      return null;
    }

    const showAll = sectionFilter === "all";
    return {
      quickStart: showAll || sectionFilter === "quick_start" ? data.sections.quickStart : [],
      pastPapers: showAll || sectionFilter === "past_papers" ? data.sections.pastPapers : [],
      interviewExperiences: showAll || sectionFilter === "experiences" ? data.sections.interviewExperiences : [],
      quickTips: showAll || sectionFilter === "tips" ? data.sections.quickTips : [],
      questionBank: showAll || sectionFilter === "questions" ? data.sections.questionBank : [],
      relatedMocks: showAll || sectionFilter === "mocks" ? data.sections.relatedMocks : [],
      relatedResources: showAll || sectionFilter === "resources" ? data.sections.relatedResources : [],
      upcomingDrives: showAll || sectionFilter === "drives" ? data.sections.upcomingDrives : [],
    };
  }, [data, sectionFilter]);

  if (isLoading) {
    return <Card>Loading company preparation hub...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load company prep hub.</Card>;
  }

  return (
    <section className="company-hub-page" style={accent.style}>
      <Card className="company-hub-hero">
        <div className="company-hub-hero-copy">
          <p className="resources-kicker">Company Prep Hub</p>
          <div className="company-hub-brand-row">
            {data.company.logoUrl ? (
              <div className="company-hub-logo-wrap">
                <img src={data.company.logoUrl} alt={`${data.company.name} logo`} className="company-hub-logo" />
              </div>
            ) : (
              <div className="company-hub-logo-fallback" aria-hidden="true">
                {data.company.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <h1>{data.company.name}</h1>
              <p className="muted-text">Slug: {data.company.slug || "company-hub"}</p>
            </div>
          </div>
          <p>
            Use this page as the command center for rounds, practice, quick revision, and drive-linked preparation.
          </p>
          <div className="resource-topic-chips">
            {data.prepSignals.roundHints.map((hint) => (
              <span key={hint} className="resource-topic-chip">{hint}</span>
            ))}
            {data.prepSignals.recommendedFocus.map((topic) => (
              <span key={topic} className="resource-topic-chip">{topic}</span>
            ))}
            {data.prepSignals.weakTopics.map((topic) => (
              <span key={`weak-${topic}`} className="resource-topic-chip company-hub-weak-chip">{topic}</span>
            ))}
          </div>
        </div>
        <div className="company-hub-hero-stats">
          <Card className="mock-stat-card"><span>Vault Items</span><strong>{data.stats.totalItems}</strong></Card>
          <Card className="mock-stat-card"><span>Related Mocks</span><strong>{data.stats.mockCount}</strong></Card>
          <Card className="mock-stat-card"><span>Resources</span><strong>{data.stats.resourceCount}</strong></Card>
          <Card className="mock-stat-card"><span>Upcoming Drives</span><strong>{data.stats.upcomingDriveCount}</strong></Card>
        </div>
      </Card>

      <div className="company-hub-grid">
        <Card className="company-hub-progress">
          <h2>Your Readiness For {data.company.name}</h2>
          <div className="company-hub-progress-grid">
            <div>
              <span>Mock Coverage</span>
              <strong>{data.studentProgress.mockCoveragePct}%</strong>
              <p>{data.studentProgress.attemptedMocks} company-linked mocks attempted</p>
            </div>
            <div>
              <span>Avg Mock Score</span>
              <strong>{data.studentProgress.avgMockScore.toFixed(1)}%</strong>
              <p>Last attempt: {formatDate(data.studentProgress.lastAttemptAt)}</p>
            </div>
            <div>
              <span>Resource Coverage</span>
              <strong>{data.studentProgress.resourceCoveragePct}%</strong>
              <p>{data.studentProgress.openedResources} linked resources opened</p>
            </div>
            <div>
              <span>Last Resource Activity</span>
              <strong>{formatDate(data.studentProgress.lastResourceOpenAt)}</strong>
              <p>Tracked from the in-app resource viewer</p>
            </div>
          </div>
        </Card>

        <Card className="company-hub-signals">
          <h2>Preparation Snapshot</h2>
          <div className="company-hub-type-stats">
            <Badge>{data.stats.typeCounts.pastPaper} past papers</Badge>
            <Badge>{data.stats.typeCounts.experience} experiences</Badge>
            <Badge>{data.stats.typeCounts.tip} tips</Badge>
            <Badge>{data.stats.typeCounts.question} questions</Badge>
          </div>
          <h3>Top Focus Areas</h3>
          <ul className="resource-viewer-list">
            {data.prepSignals.topTopics.map((topic) => (
              <li key={topic.name}>{topic.name} ({topic.count})</li>
            ))}
          </ul>
          <label className="company-hub-filter">
            Show section
            <Select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
              <option value="all">All Sections</option>
              <option value="quick_start">Quick Start</option>
              <option value="past_papers">Past Papers</option>
              <option value="experiences">Experiences</option>
              <option value="tips">Quick Tips</option>
              <option value="questions">Question Bank</option>
              <option value="mocks">Related Mocks</option>
              <option value="resources">Related Resources</option>
              <option value="drives">Upcoming Drives</option>
            </Select>
          </label>
        </Card>
      </div>

      {filteredSections?.quickStart.length ? (
        <Section
          title="Quick Start"
          description="Start with the highest-signal company-specific items before branching into full practice."
          count={filteredSections.quickStart.length}
        >
          <div className="company-hub-content-grid">
            {filteredSections.quickStart.map((item) => (
              <VaultContentCard key={item.id} item={item} />
            ))}
          </div>
        </Section>
      ) : null}

      {filteredSections?.pastPapers.length ? (
        <Section
          title="Past Papers"
          description="Use these to rehearse pattern familiarity, time management, and company-specific pressure."
          count={filteredSections.pastPapers.length}
        >
          <div className="company-hub-content-grid">
            {filteredSections.pastPapers.map((item) => (
              <VaultContentCard key={item.id} item={item} />
            ))}
          </div>
        </Section>
      ) : null}

      {filteredSections?.interviewExperiences.length ? (
        <Section
          title="Interview Experiences"
          description="Review patterns, round flow, and likely areas to revisit before the actual process."
          count={filteredSections.interviewExperiences.length}
        >
          <div className="company-hub-content-grid">
            {filteredSections.interviewExperiences.map((item) => (
              <VaultContentCard key={item.id} item={item} />
            ))}
          </div>
        </Section>
      ) : null}

      {filteredSections?.quickTips.length ? (
        <Section
          title="Quick Tips"
          description="Fast reminders for the last-mile preparation window."
          count={filteredSections.quickTips.length}
        >
          <div className="company-hub-content-grid">
            {filteredSections.quickTips.map((item) => (
              <VaultContentCard key={item.id} item={item} />
            ))}
          </div>
        </Section>
      ) : null}

      {filteredSections?.questionBank.length ? (
        <Section
          title="Question Bank"
          description="Question-oriented snippets and repeated focus points collected for this company."
          count={filteredSections.questionBank.length}
        >
          <div className="company-hub-content-grid">
            {filteredSections.questionBank.map((item) => (
              <VaultContentCard key={item.id} item={item} />
            ))}
          </div>
        </Section>
      ) : null}

      {filteredSections?.relatedMocks.length ? (
        <Section
          title="Related Mock Tests"
          description="Company-linked mocks to move from reading to timed execution."
          count={filteredSections.relatedMocks.length}
        >
          <div className="mock-discovery-grid">
            {filteredSections.relatedMocks.map((test) => (
              <Card key={test.id} className="mock-discovery-card">
                <div className="mock-discovery-head">
                  <div>
                    <h3>{test.title}</h3>
                    <p>{test.topicName ?? "Open topic"}</p>
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
            ))}
          </div>
        </Section>
      ) : null}

      {filteredSections?.relatedResources.length ? (
        <Section
          title="Related Resources"
          description="Documents and notes already matching this company’s preparation pattern."
          count={filteredSections.relatedResources.length}
        >
          <div className="resources-grid">
            {filteredSections.relatedResources.map((resource) => (
              <Card key={resource.id} className="resource-card">
                <div className="resource-card-header">
                  <div>
                    <p className="resources-kicker">{resource.resourceType.replace(/_/g, " ")}</p>
                    <h3>{resource.title}</h3>
                    <p>{resource.summaryShort?.trim() || resource.description?.trim() || "Company-linked learning resource"}</p>
                    {resource.companyRankingReasons?.length ? (
                      <p className="company-hub-ranking-reason">
                        {resource.companyRankingReasons[0]}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="company-hub-resource-meta">
                  {typeof resource.companyRelevanceScore === "number" ? (
                    <Badge>Score {Math.round(resource.companyRelevanceScore)}</Badge>
                  ) : null}
                  {typeof resource.globalOpenCount === "number" ? (
                    <Badge>{resource.globalOpenCount} opens</Badge>
                  ) : null}
                  {resource.openedByStudent ? <Badge variant="success">Opened</Badge> : null}
                </div>
                <div className="hero-actions">
                  <Link to={`/resources/view/${resource.id}`}>
                    <Button>Open Resource</Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {filteredSections?.upcomingDrives.length ? (
        <Section
          title="Upcoming Drives"
          description="Stay close to real campus deadlines while you prepare."
          count={filteredSections.upcomingDrives.length}
        >
          <div className="company-hub-drive-grid">
            {filteredSections.upcomingDrives.map((drive) => (
              <Card key={drive.id} className="company-hub-drive-card">
                <h3>{drive.role}</h3>
                <p>{drive.company}</p>
                <p>Drive date: {formatDate(drive.driveDate)}</p>
                <p>Status: {drive.status}</p>
                <p>Eligible students: {drive.eligibleCount}</p>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}
    </section>
  );
}
