import { useEffect } from "react";
import { Link } from "react-router-dom";

import { Brand } from "../../components/composites/Brand";
import { Badge } from "../../components/ui";

const PAGE_TITLE = "Smart Path | Placement Readiness And Intervention For TPOs";
const PAGE_DESCRIPTION = "Smart Path helps placement offices see readiness, blockers, and interventions in one place so students know what to do next.";
const OG_IMAGE = "/smart-path-og.svg";

function upsertMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element?.setAttribute(key, value);
  });
}

const capabilityBlocks = [
  {
    title: "Know who is ready",
    body: "See profile readiness, resume status, drive eligibility, and student momentum without stitching together spreadsheets and chat updates.",
  },
  {
    title: "Fix what is blocking students",
    body: "Surface missing resumes, uncertified profiles, weak readiness, and inactive-but-eligible students as action queues instead of hidden problems.",
  },
  {
    title: "Act before drive deadlines",
    body: "Run drive workflows, reminders, result releases, and preparation follow-through from one operational workspace before deadlines slip.",
  },
];

const audienceBlocks = [
  {
    title: "Students",
    body: "See the next best step for placements while continuing to learn from any trusted source that works for you.",
  },
  {
    title: "TPOs",
    body: "See readiness, blockers, and interventions in one place so follow-up becomes operational instead of reactive.",
  },
  {
    title: "Colleges",
    body: "Run a cleaner placement cell with fewer spreadsheets, fewer missed follow-ups, and clearer proof of readiness.",
  },
];

export default function HomePage() {
  useEffect(() => {
    document.title = PAGE_TITLE;
    upsertMeta('meta[name="description"]', { name: "description", content: PAGE_DESCRIPTION });
    upsertMeta('meta[property="og:title"]', { property: "og:title", content: PAGE_TITLE });
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: PAGE_DESCRIPTION });
    upsertMeta('meta[property="og:type"]', { property: "og:type", content: "website" });
    upsertMeta('meta[property="og:image"]', { property: "og:image", content: OG_IMAGE });
    upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: PAGE_TITLE });
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: PAGE_DESCRIPTION });
    upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: OG_IMAGE });
  }, []);

  return (
    <div className="marketing-shell">
      <header className="marketing-topbar">
        <Brand href="/" variant="full" descriptor="Placement readiness platform" className="marketing-brand" />

        <nav className="marketing-nav" aria-label="Primary">
          <a href="#about">Why it works</a>
          <a href="#who-its-for">Who it&apos;s for</a>
          <a href="#capabilities">What you can do</a>
        </nav>

        <div className="marketing-topbar-actions">
          <Link to="/login" className="marketing-login-link">
            Login
          </Link>
          <a href="mailto:admin@campusdrive.me?subject=Smart%20Path%20Enquiry" className="ui-button ghost">
            Contact
          </a>
        </div>
      </header>

      <section className="marketing-hero marketing-hero-simple" id="about">
        <div className="marketing-hero-copy">
          <Badge>For placement cells that need operational clarity</Badge>
          <h1>Help the placement office know who is ready, who is blocked, and what to do next.</h1>
          <p className="marketing-lead">
            Smart Path is built for tier-2 and tier-3 college placement teams that still chase readiness through sheets,
            WhatsApp, and manual follow-up. Students get a guided next step. TPOs get one intervention workspace. Smart Path does not replace every prep source students already trust. It connects that preparation back to official college workflows, readiness, and follow-up.
          </p>
          <div className="hero-actions marketing-hero-actions">
            <Link to="/login" className="ui-button primary">
              Login to Smart Path
            </Link>
            <a href="mailto:admin@campusdrive.me?subject=Smart%20Path%20Support" className="ui-button secondary">
              Contact support
            </a>
          </div>
        </div>

        <div className="marketing-hero-simple-panel">
          <p className="marketing-kicker">What changes in practice</p>
          <ul className="marketing-list">
            <li>TPOs can see blockers, ready-but-inactive students, and drive risk in one place</li>
            <li>Students can see what to do next for placements instead of getting lost in feature clutter</li>
            <li>Drive operations, reminders, and readiness proof stay inside one operational flow</li>
          </ul>
        </div>
      </section>

      <section className="marketing-section" id="who-its-for">
        <div className="marketing-section-heading">
          <p className="marketing-kicker">Who it&apos;s for</p>
          <h2>A focused readiness and intervention system for the people running placements every day.</h2>
        </div>

        <div className="marketing-platform-grid">
          {audienceBlocks.map((block) => (
            <section key={block.title}>
              <span className="marketing-platform-tag">{block.title}</span>
              <h3>{block.title}</h3>
              <p>{block.body}</p>
            </section>
          ))}
        </div>
      </section>

      <section className="marketing-section" id="capabilities">
        <div className="marketing-section-heading">
          <p className="marketing-kicker">What the product is optimized for</p>
          <h2>Built around operational placement workflows, not generic AI claims.</h2>
        </div>

        <div className="marketing-columns marketing-columns-three">
          {capabilityBlocks.map((block) => (
            <div className="marketing-column" key={block.title}>
              <h3>{block.title}</h3>
              <p>{block.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-section-heading">
          <p className="marketing-kicker">How teams use it</p>
          <h2>Four workflows matter more than feature count.</h2>
        </div>

        <div className="marketing-workflow">
          <article>
            <h2>1. Find blocked students</h2>
            <p>Resume gaps, uncertified profiles, weak readiness, and incomplete records surface as queues instead of hidden exceptions.</p>
          </article>
          <article>
            <h2>2. Nudge ready but inactive students</h2>
            <p>See who qualifies for drives but is not acting, then follow up before the deadline becomes the problem.</p>
          </article>
          <article>
            <h2>3. Run drives cleanly</h2>
            <p>Create drives, compute eligibility, release results, export resumes, and keep announcements connected to action.</p>
          </article>
          <article>
            <h2>4. Prove readiness to leadership</h2>
            <p>Use reports and dashboard views to show profile completion, eligibility coverage, intervention queues, and progress over time.</p>
          </article>
        </div>
      </section>

      <footer className="marketing-footer">
        <div>
          <Brand href="/" variant="compact" className="marketing-footer-brand" />
          <p>Placement readiness and intervention support for students, TPOs, and colleges.</p>
        </div>
        <div className="marketing-footer-links">
          <Link to="/login">Login</Link>
          <Link to="/resource-usage-policy">Resource Usage Policy</Link>
          <a href="mailto:admin@campusdrive.me">Contact</a>
        </div>
      </footer>
    </div>
  );
}
