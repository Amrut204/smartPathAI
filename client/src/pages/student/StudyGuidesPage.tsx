import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  useStudyGuides,
  useStudyGuideCategories,
  type StudyGuideListItem,
} from "../../hooks/use-study-guides";
import { Button, Card, Input, Spinner } from "../../components/ui";

type CategoryFilter = "" | "aptitude" | "technical" | "company_specific" | "soft_skills" | "branch_core";
type DifficultyFilter = "" | "beginner" | "intermediate" | "advanced";

const CATEGORY_OPTIONS: Array<{ id: CategoryFilter; label: string }> = [
  { id: "", label: "All Categories" },
  { id: "aptitude", label: "Aptitude" },
  { id: "technical", label: "Technical" },
  { id: "company_specific", label: "Company Prep" },
  { id: "soft_skills", label: "Soft Skills" },
  { id: "branch_core", label: "Branch Core" },
];

const DIFFICULTY_OPTIONS: Array<{ id: DifficultyFilter; label: string }> = [
  { id: "", label: "All Levels" },
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];

function difficultyBadgeClass(difficulty: string): string {
  if (difficulty === "beginner") return "sg-badge sg-badge-beginner";
  if (difficulty === "advanced") return "sg-badge sg-badge-advanced";
  return "sg-badge sg-badge-intermediate";
}

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    aptitude: "Aptitude",
    technical: "Technical",
    company_specific: "Company Prep",
    soft_skills: "Soft Skills",
    branch_core: "Branch Core",
  };
  return labels[category] ?? category;
}

function GuideCard({ guide }: { guide: StudyGuideListItem }) {
  return (
    <Card className="sg-card">
      <div className="sg-card-header">
        <span className="sg-badge sg-badge-category">{categoryLabel(guide.category)}</span>
        <span className={difficultyBadgeClass(guide.difficulty)}>{guide.difficulty}</span>
      </div>
      <h3 className="sg-card-title">{guide.topicName}</h3>
      <p className="sg-card-summary">{guide.summary || "Study guide for campus placement preparation."}</p>
      <div className="sg-card-meta">
        <span>{guide.estimatedReadMinutes} min read</span>
        <span>{guide.wordCount.toLocaleString()} words</span>
        {guide.keyConcepts.length > 0 && <span>{guide.keyConcepts.length} concepts</span>}
      </div>
      {guide.keyConcepts.length > 0 && (
        <div className="sg-card-chips">
          {guide.keyConcepts.slice(0, 4).map((concept) => (
            <span key={concept} className="sg-chip">{concept}</span>
          ))}
        </div>
      )}
      <div className="sg-card-footer">
        <Link to={`/study-guides/${encodeURIComponent(guide.slug)}`} className="ui-button primary">
          Read Guide
        </Link>
      </div>
    </Card>
  );
}

export default function StudyGuidesPage() {
  const [category, setCategory] = useState<CategoryFilter>("");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadedGuides, setLoadedGuides] = useState<StudyGuideListItem[]>([]);
  const [activeFilterKey, setActiveFilterKey] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filters = useMemo(() => ({
    category: category || undefined,
    difficulty: difficulty || undefined,
    search: search.trim() || undefined,
    cursor,
    limit: 50,
  }), [category, difficulty, search, cursor]);

  const { data, error, isLoading } = useStudyGuides(filters);
  const { data: categories } = useStudyGuideCategories();

  const totalGuides = useMemo(
    () => (categories ?? []).reduce((sum, c) => sum + c.count, 0),
    [categories],
  );

  const filterKey = useMemo(
    () => JSON.stringify({
      category: category || "",
      difficulty: difficulty || "",
      search,
    }),
    [category, difficulty, search],
  );

  useEffect(() => {
    if (activeFilterKey !== filterKey) {
      setCursor(undefined);
      setActiveFilterKey(filterKey);
    }
  }, [activeFilterKey, filterKey]);

  useEffect(() => {
    if (!data) return;

    setLoadedGuides((previous) => {
      if (!cursor || activeFilterKey !== filterKey) {
        return data.items;
      }

      const seen = new Set(previous.map((guide) => guide.id));
      const merged = [...previous];
      data.items.forEach((guide) => {
        if (!seen.has(guide.id)) {
          merged.push(guide);
        }
      });
      return merged;
    });
  }, [activeFilterKey, data, cursor, filterKey]);

  if (isLoading && loadedGuides.length === 0) {
    return (
      <Card className="app-state-card">
        <Spinner />
        <p className="muted-text">Loading study guides...</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="app-state-card app-state-card-error">
        <h2>Unable to load study guides</h2>
        <p className="muted-text">Please try again later.</p>
      </Card>
    );
  }

  const guides = loadedGuides;

  return (
    <section className="study-guides-page">
      <Card className="sg-hero-card">
        <div className="sg-hero-copy">
          <p className="sg-kicker">AI-Generated Study Guides</p>
          <h1>Comprehensive Placement Preparation Material</h1>
          <p>
            Original study guides covering aptitude, technical, company-specific patterns, and more.
            Each guide includes theory, solved examples, practice problems, and placement tips.
          </p>
        </div>
        <div className="sg-stat-grid">
          <Card className="sg-stat-card">
            <span className="sg-stat-label">Total Guides</span>
            <strong>{totalGuides}</strong>
          </Card>
          {(categories ?? []).slice(0, 3).map((cat) => (
            <Card key={cat.category} className="sg-stat-card">
              <span className="sg-stat-label">{categoryLabel(cat.category)}</span>
              <strong>{cat.count}</strong>
            </Card>
          ))}
        </div>
      </Card>

      <Card className="sg-toolbar-card">
        <div className="sg-toolbar-row">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search guides by topic or keyword..."
            className="sg-search-input"
          />
        </div>
        <div className="sg-filter-row">
          <div className="sg-filter-group">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`sg-filter-chip${category === opt.id ? " active" : ""}`}
                onClick={() => setCategory(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="sg-filter-group">
            {DIFFICULTY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`sg-filter-chip${difficulty === opt.id ? " active" : ""}`}
                onClick={() => setDifficulty(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <p className="sg-toolbar-meta">
          {guides.length} guide{guides.length === 1 ? "" : "s"} loaded
          {totalGuides > 0 ? ` · ${totalGuides} total published` : ""}
          {isLoading ? " · updating…" : ""}
        </p>
      </Card>

      {guides.length === 0 ? (
        <Card className="sg-empty-card">
          <h3>No study guides found</h3>
          <p className="muted-text">
            {search ? "Try adjusting your search or filters." : "Study guides are being generated. Check back soon."}
          </p>
        </Card>
      ) : (
        <div className="sg-card-grid">
          {guides.map((guide) => (
            <GuideCard key={guide.id} guide={guide} />
          ))}
        </div>
      )}

      {data?.hasMore && data.nextCursor && (
        <div className="sg-load-more">
          <Button onClick={() => setCursor(data.nextCursor ?? undefined)}>
            Load More Guides
          </Button>
        </div>
      )}
    </section>
  );
}
