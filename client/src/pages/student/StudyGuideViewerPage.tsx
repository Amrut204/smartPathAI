import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useStudyGuideBySlug, type StudyGuideSection, type StudyGuidePracticeQuestion } from "../../hooks/use-study-guides";
import { Button, Card, Spinner } from "../../components/ui";

/* ------------------------------------------------------------------ */
/*  Lightweight markdown renderer                                      */
/* ------------------------------------------------------------------ */

function renderMarkdownLine(line: string): string {
  let html = line;
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="sg-inline-code">$1</code>');
  return html;
}

function MarkdownBlock({ content }: { content: string }) {
  const rendered = useMemo(() => {
    const lines = content.split("\n");
    const blocks: string[] = [];
    let inCodeBlock = false;
    let codeBuffer: string[] = [];
    let codeLang = "";

    for (const line of lines) {
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          blocks.push(`<pre class="sg-code-block"><code class="language-${codeLang}">${codeBuffer.join("\n").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
          codeBuffer = [];
          codeLang = "";
          inCodeBlock = false;
        } else {
          codeLang = line.slice(3).trim();
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // Headings within section content (### and below since ## is section-level)
      const h3 = line.match(/^###\s+(.+)/);
      if (h3) { blocks.push(`<h4 class="sg-content-h4">${renderMarkdownLine(h3[1])}</h4>`); continue; }

      const h4 = line.match(/^####\s+(.+)/);
      if (h4) { blocks.push(`<h5 class="sg-content-h5">${renderMarkdownLine(h4[1])}</h5>`); continue; }

      // Unordered list
      const ul = line.match(/^\s*[-*]\s+(.+)/);
      if (ul) { blocks.push(`<li class="sg-li">${renderMarkdownLine(ul[1])}</li>`); continue; }

      // Ordered list
      const ol = line.match(/^\s*\d+[\.\)]\s+(.+)/);
      if (ol) { blocks.push(`<li class="sg-li sg-li-ordered">${renderMarkdownLine(ol[1])}</li>`); continue; }

      // Table row
      if (line.includes("|") && line.trim().startsWith("|")) {
        const cells = line.split("|").slice(1, -1).map((c) => c.trim());
        if (cells.every((c) => /^[-:]+$/.test(c))) continue; // separator row
        const isHeader = blocks.length > 0 && !blocks[blocks.length - 1].includes("<tr>");
        const tag = isHeader ? "th" : "td";
        blocks.push(`<tr>${cells.map((c) => `<${tag} class="sg-table-cell">${renderMarkdownLine(c)}</${tag}>`).join("")}</tr>`);
        continue;
      }

      // Empty line
      if (!line.trim()) { blocks.push(""); continue; }

      // Regular paragraph
      blocks.push(`<p class="sg-p">${renderMarkdownLine(line)}</p>`);
    }

    // Close any unclosed code block
    if (inCodeBlock && codeBuffer.length > 0) {
      blocks.push(`<pre class="sg-code-block"><code>${codeBuffer.join("\n").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
    }

    // Wrap consecutive <li> elements in <ul>
    let html = blocks.join("\n");
    html = html.replace(
      /(<li class="sg-li">[\s\S]*?<\/li>\n?)+/g,
      (match) => `<ul class="sg-ul">${match}</ul>`,
    );
    html = html.replace(
      /(<li class="sg-li sg-li-ordered">[\s\S]*?<\/li>\n?)+/g,
      (match) => `<ol class="sg-ol">${match.replace(/sg-li-ordered/g, "sg-li")}</ol>`,
    );
    // Wrap consecutive <tr> in <table>
    html = html.replace(
      /(<tr>[\s\S]*?<\/tr>\n?)+/g,
      (match) => `<table class="sg-table">${match}</table>`,
    );

    return html;
  }, [content]);

  return <div className="sg-markdown" dangerouslySetInnerHTML={{ __html: rendered }} />;
}

/* ------------------------------------------------------------------ */
/*  Practice question card                                             */
/* ------------------------------------------------------------------ */

function PracticeQuestionCard({ question, index }: { question: StudyGuidePracticeQuestion; index: number }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Card className="sg-practice-card">
      <div className="sg-practice-header">
        <span className="sg-practice-number">Q{index + 1}</span>
        <button
          type="button"
          className="sg-practice-toggle"
          onClick={() => setRevealed(!revealed)}
        >
          {revealed ? "Hide Answer" : "Show Answer"}
        </button>
      </div>
      <MarkdownBlock content={question.question} />
      {revealed && (
        <div className="sg-practice-answer">
          <h4 className="sg-content-h4">Solution</h4>
          <MarkdownBlock content={question.answer || question.explanation} />
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Section component                                                  */
/* ------------------------------------------------------------------ */

function GuideSection({ section }: { section: StudyGuideSection }) {
  const anchorId = section.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <section className="sg-section" id={anchorId}>
      <h2 className="sg-section-heading">{section.heading}</h2>
      <MarkdownBlock content={section.content} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Main viewer page                                                   */
/* ------------------------------------------------------------------ */

export default function StudyGuideViewerPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: guide, error, isLoading } = useStudyGuideBySlug(slug ?? null);

  const tocItems = useMemo(
    () => (guide?.sections ?? []).map((s) => ({
      heading: s.heading,
      anchorId: s.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    })),
    [guide?.sections],
  );

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (isLoading) {
    return (
      <Card className="app-state-card">
        <Spinner />
        <p className="muted-text">Loading study guide...</p>
      </Card>
    );
  }

  if (error || !guide) {
    return (
      <Card className="app-state-card app-state-card-error">
        <h2>Study guide not found</h2>
        <p className="muted-text">This guide may not exist or hasn't been published yet.</p>
        <Link to="/study-guides" className="ui-button secondary">Back to Study Guides</Link>
      </Card>
    );
  }

  const categoryLabels: Record<string, string> = {
    aptitude: "Aptitude",
    technical: "Technical",
    company_specific: "Company Prep",
    soft_skills: "Soft Skills",
    branch_core: "Branch Core",
  };

  return (
    <section className="sg-viewer-page">
      <div className="sg-viewer-header">
        <Link to="/study-guides" className="sg-back-link">Back to Study Guides</Link>
        <Card className="sg-viewer-hero">
          <div className="sg-viewer-badges">
            <span className="sg-badge sg-badge-category">{categoryLabels[guide.category] ?? guide.category}</span>
            <span className={`sg-badge sg-badge-${guide.difficulty}`}>{guide.difficulty}</span>
          </div>
          <h1 className="sg-viewer-title">{guide.title}</h1>
          <p className="sg-viewer-summary">{guide.summary}</p>
          <div className="sg-viewer-meta">
            <span>{guide.estimated_read_minutes} min read</span>
            <span>{guide.word_count.toLocaleString()} words</span>
            <span>{guide.sections.length} sections</span>
            {guide.practice_questions.length > 0 && (
              <span>{guide.practice_questions.length} practice problems</span>
            )}
          </div>
          <div className="sg-viewer-actions">
            <Button onClick={handlePrint}>Print / Save PDF</Button>
          </div>
        </Card>
      </div>

      <div className="sg-viewer-layout">
        <aside className="sg-toc">
          <Card className="sg-toc-card">
            <h3 className="sg-toc-title">Table of Contents</h3>
            <nav className="sg-toc-nav">
              {tocItems.map((item) => (
                <a key={item.anchorId} href={`#${item.anchorId}`} className="sg-toc-link">
                  {item.heading}
                </a>
              ))}
              {guide.practice_questions.length > 0 && (
                <a href="#practice-problems" className="sg-toc-link">Practice Problems</a>
              )}
              {guide.placement_tips.length > 0 && (
                <a href="#placement-tips-summary" className="sg-toc-link">Placement Tips</a>
              )}
            </nav>
          </Card>
        </aside>

        <div className="sg-viewer-content">
          {guide.key_concepts.length > 0 && (
            <Card className="sg-concepts-card">
              <h3>Key Concepts</h3>
              <div className="sg-concepts-chips">
                {guide.key_concepts.map((concept) => (
                  <span key={concept} className="sg-chip">{concept}</span>
                ))}
              </div>
            </Card>
          )}

          {guide.sections.map((section) => (
            <GuideSection key={section.order} section={section} />
          ))}

          {guide.practice_questions.length > 0 && (
            <section className="sg-section" id="practice-problems">
              <h2 className="sg-section-heading">Practice Problems</h2>
              <div className="sg-practice-list">
                {guide.practice_questions.map((q, i) => (
                  <PracticeQuestionCard key={i} question={q} index={i} />
                ))}
              </div>
            </section>
          )}

          {guide.placement_tips.length > 0 && (
            <section className="sg-section" id="placement-tips-summary">
              <h2 className="sg-section-heading">Placement Tips Summary</h2>
              <Card className="sg-tips-card">
                <ol className="sg-tips-list">
                  {guide.placement_tips.map((tip, i) => (
                    <li key={i} className="sg-tips-item">{tip}</li>
                  ))}
                </ol>
              </Card>
            </section>
          )}

          <Card className="sg-footer-card">
            <p>
              This study guide was generated for educational purposes. All content is original.
            </p>
            <div className="sg-footer-meta">
              <span>Provider: {guide.ai_provider}</span>
              <span>Version: {guide.version}</span>
              {guide.published_at && <span>Published: {new Date(guide.published_at).toLocaleDateString("en-IN")}</span>}
            </div>
            <Link to="/study-guides" className="ui-button secondary">Browse More Guides</Link>
          </Card>
        </div>
      </div>
    </section>
  );
}
