import { useMemo, useState } from "react";

import { Badge, Button, Card, Input, Progress, Select, Spinner } from "../../components/ui";
import {
  useMastery,
  useTopicProgress,
  updateTopicProgress,
  updateTopicProgressBulk,
  type TopicProgressStatus,
} from "../../hooks/use-mastery";

function masteryBand(level: number) {
  if (level >= 80) return { label: "Strong", variant: "success" as const };
  if (level >= 50) return { label: "Improving", variant: "warning" as const };
  return { label: "Needs Focus", variant: "danger" as const };
}

function statusBadgeVariant(status: TopicProgressStatus) {
  if (status === "complete") return "success" as const;
  if (status === "in_progress") return "warning" as const;
  return "default" as const;
}

function statusLabel(status: TopicProgressStatus) {
  if (status === "in_progress") return "In Progress";
  if (status === "complete") return "Complete";
  return "Incomplete";
}

export default function MasteryPage() {
  const { data: masteryData, error: masteryError, isLoading: masteryLoading } = useMastery();
  const { data: progressData, error: progressError, isLoading: progressLoading } = useTopicProgress();

  const [performanceQuery, setPerformanceQuery] = useState("");
  const [progressQuery, setProgressQuery] = useState("");
  const [sortBy, setSortBy] = useState("mastery_desc");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<TopicProgressStatus>("in_progress");
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [savingTopicId, setSavingTopicId] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const masteryItems = masteryData ?? [];
  const progressItems = progressData?.items ?? [];
  const progressSummary = progressData?.summary ?? {
    totalTopics: 0,
    completeCount: 0,
    inProgressCount: 0,
    incompleteCount: 0,
    coveredCount: 0,
    completionPct: 0,
  };

  const progressMap = useMemo(
    () => new Map(progressItems.map((item) => [item.topicId, item])),
    [progressItems],
  );

  const filteredPerformance = useMemo(() => {
    const normalizedQuery = performanceQuery.trim().toLowerCase();
    const base = masteryItems.filter((item) => {
      if (!normalizedQuery) return true;
      return item.topicName.toLowerCase().includes(normalizedQuery);
    });

    const sorted = [...base];
    if (sortBy === "mastery_desc") sorted.sort((a, b) => b.masteryLevel - a.masteryLevel);
    if (sortBy === "mastery_asc") sorted.sort((a, b) => a.masteryLevel - b.masteryLevel);
    if (sortBy === "confidence_desc") sorted.sort((a, b) => b.confidenceScore - a.confidenceScore);
    if (sortBy === "attempts_desc") sorted.sort((a, b) => b.totalAttempts - a.totalAttempts);
    return sorted;
  }, [masteryItems, performanceQuery, sortBy]);

  const filteredProgress = useMemo(() => {
    const normalizedQuery = progressQuery.trim().toLowerCase();
    return progressItems.filter((item) => {
      if (!normalizedQuery) return true;
      return item.topicName.toLowerCase().includes(normalizedQuery);
    });
  }, [progressItems, progressQuery]);

  const performanceTotals = useMemo(() => {
    const topicCount = masteryItems.length;
    const avgMastery = topicCount > 0
      ? masteryItems.reduce((sum, item) => sum + item.masteryLevel, 0) / topicCount
      : 0;
    const strongCount = masteryItems.filter((item) => item.masteryLevel >= 80).length;
    const focusCount = masteryItems.filter((item) => item.masteryLevel < 50).length;
    return {
      topicCount,
      avgMastery,
      strongCount,
      focusCount,
    };
  }, [masteryItems]);

  const allFilteredSelected = filteredProgress.length > 0
    && filteredProgress.every((item) => selectedTopicIds.includes(item.topicId));

  const toggleTopicSelection = (topicId: string) => {
    setSelectedTopicIds((previous) =>
      previous.includes(topicId)
        ? previous.filter((value) => value !== topicId)
        : [...previous, topicId]);
  };

  const toggleAllFiltered = () => {
    setSelectedTopicIds((previous) => {
      if (allFilteredSelected) {
        const filteredSet = new Set(filteredProgress.map((item) => item.topicId));
        return previous.filter((topicId) => !filteredSet.has(topicId));
      }

      const next = new Set(previous);
      filteredProgress.forEach((item) => next.add(item.topicId));
      return [...next];
    });
  };

  const handleSingleStatusUpdate = async (topicId: string, status: TopicProgressStatus) => {
    setActionMessage("");
    setActionError("");
    setSavingTopicId(topicId);
    try {
      await updateTopicProgress({ topicId, status });
      setActionMessage(`Topic updated to ${statusLabel(status)}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update topic status.");
    } finally {
      setSavingTopicId("");
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedTopicIds.length === 0 || isBulkSaving) {
      return;
    }

    setActionMessage("");
    setActionError("");
    setIsBulkSaving(true);
    try {
      const result = await updateTopicProgressBulk({
        topicIds: selectedTopicIds,
        status: bulkStatus,
      });
      setActionMessage(`${result.updatedCount} topic(s) updated to ${statusLabel(bulkStatus)}.`);
      setSelectedTopicIds([]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to bulk update topics.");
    } finally {
      setIsBulkSaving(false);
    }
  };

  if (masteryLoading || progressLoading) {
    return <Card className="app-state-card"><Spinner /><p className="muted-text">Loading mastery...</p></Card>;
  }

  if (masteryError || progressError || !masteryData || !progressData) {
    return <Card className="app-state-card app-state-card-error"><h2>Unable to load mastery data</h2></Card>;
  }

  return (
    <section className="mastery-page">
      <Card>
        <h1>Topic Mastery</h1>
        <p>Track topic-wise strengths and mark topics as complete/incomplete based on your preparation.</p>
      </Card>

      <div className="mastery-summary-grid">
        <Card>
          <h3>Topics Tracked</h3>
          <p>{progressSummary.totalTopics}</p>
        </Card>
        <Card>
          <h3>Completed</h3>
          <p>{progressSummary.completeCount}</p>
        </Card>
        <Card>
          <h3>In Progress</h3>
          <p>{progressSummary.inProgressCount}</p>
        </Card>
        <Card>
          <h3>Completion</h3>
          <p>{progressSummary.completionPct.toFixed(1)}%</p>
          <Progress value={progressSummary.completionPct} />
        </Card>
      </div>

      <Card>
        <h2>Covered Topics Tracker</h2>
        <p>Select topics and mark them complete/incomplete as you study.</p>
        <div className="mastery-filter-grid">
          <label>
            Search Topics
            <Input
              value={progressQuery}
              onChange={(event) => setProgressQuery(event.target.value)}
              placeholder="Type topic name"
            />
          </label>
          <label>
            Bulk Status
            <Select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as TopicProgressStatus)}>
              <option value="incomplete">Incomplete</option>
              <option value="in_progress">In Progress</option>
              <option value="complete">Complete</option>
            </Select>
          </label>
        </div>
        <div className="hero-actions">
          <Button variant="ghost" onClick={toggleAllFiltered}>
            {allFilteredSelected ? "Unselect Visible" : "Select Visible"}
          </Button>
          <Button onClick={handleBulkUpdate} disabled={selectedTopicIds.length === 0 || isBulkSaving}>
            {isBulkSaving ? "Updating..." : `Apply to ${selectedTopicIds.length} selected`}
          </Button>
        </div>
        {actionMessage ? <p className="muted-text">{actionMessage}</p> : null}
        {actionError ? <p className="error-text">{actionError}</p> : null}

        <div className="topic-progress-list">
          {filteredProgress.map((item) => (
            <div key={item.topicId} className="topic-progress-row">
              <label className="topic-progress-select">
                <input
                  type="checkbox"
                  checked={selectedTopicIds.includes(item.topicId)}
                  onChange={() => toggleTopicSelection(item.topicId)}
                />
                <span>{item.topicName}</span>
              </label>
              <Badge variant={statusBadgeVariant(item.status)}>{statusLabel(item.status)}</Badge>
              <div className="topic-progress-actions">
                <Button
                  variant="secondary"
                  onClick={() => handleSingleStatusUpdate(item.topicId, "complete")}
                  disabled={savingTopicId === item.topicId}
                >
                  Complete
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleSingleStatusUpdate(item.topicId, "incomplete")}
                  disabled={savingTopicId === item.topicId}
                >
                  Incomplete
                </Button>
              </div>
            </div>
          ))}
          {filteredProgress.length === 0 ? <div className="app-empty-state"><p>No topics matched your search.</p></div> : null}
        </div>
      </Card>

      <Card>
        <h2>Performance by Topic</h2>
        <div className="mastery-filter-grid">
          <label>
            Search Topic
            <Input
              value={performanceQuery}
              onChange={(event) => setPerformanceQuery(event.target.value)}
              placeholder="Type topic name"
            />
          </label>
          <label>
            Sort By
            <Select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="mastery_desc">Mastery (High to Low)</option>
              <option value="mastery_asc">Mastery (Low to High)</option>
              <option value="confidence_desc">Confidence (High to Low)</option>
              <option value="attempts_desc">Attempts (High to Low)</option>
            </Select>
          </label>
        </div>
      </Card>

      {masteryItems.length === 0 ? (
        <Card className="app-state-card app-empty-state-card">
          <h2>No mastery data yet</h2>
          <p>Attempt a mock test to start tracking topic-level performance.</p>
        </Card>
      ) : (
        <div className="mastery-topic-grid">
          {filteredPerformance.map((item) => {
            const band = masteryBand(item.masteryLevel);
            const progress = progressMap.get(item.topicId);
            const actionHint = item.masteryLevel < 50
              ? "Revise fundamentals and attempt one focused mock test."
              : item.masteryLevel < 80
                ? "Practice mixed-difficulty questions to move into strong zone."
                : "Maintain this topic with periodic quick revision.";

            return (
              <Card key={item.topicId}>
                <div className="header-actions">
                  <h3>{item.topicName}</h3>
                  <Badge variant={band.variant}>{band.label}</Badge>
                </div>
                <p>Attempts: {item.totalAttempts} | Correct: {item.correctAttempts}</p>
                {progress ? (
                  <p>
                    Status: <Badge variant={statusBadgeVariant(progress.status)}>{statusLabel(progress.status)}</Badge>
                  </p>
                ) : null}

                <div className="header-actions">
                  <span>Mastery</span>
                  <strong>{item.masteryLevel.toFixed(1)}%</strong>
                </div>
                <Progress value={item.masteryLevel} />

                <div className="header-actions">
                  <span>Confidence</span>
                  <strong>{item.confidenceScore.toFixed(1)}%</strong>
                </div>
                <Progress value={item.confidenceScore} />

                <p className="muted-text">{actionHint}</p>
              </Card>
            );
          })}
          {filteredPerformance.length === 0 ? <Card className="app-state-card app-empty-state-card"><p>No topics matched your search.</p></Card> : null}
        </div>
      )}

      <div className="mastery-summary-grid">
        <Card>
          <h3>Performance Topics</h3>
          <p>{performanceTotals.topicCount}</p>
        </Card>
        <Card>
          <h3>Avg Mastery</h3>
          <p>{performanceTotals.avgMastery.toFixed(1)}%</p>
        </Card>
        <Card>
          <h3>Strong Topics</h3>
          <p>{performanceTotals.strongCount}</p>
        </Card>
        <Card>
          <h3>Need Focus</h3>
          <p>{performanceTotals.focusCount}</p>
        </Card>
      </div>
    </section>
  );
}
