import { useEffect } from "react";
import { Link } from "react-router-dom";

import { Badge } from "../../components/ui";

const PAGE_TITLE = "Smart Path | Placement Readiness For Students, TPOs, And Colleges";
const PAGE_DESCRIPTION = "Smart Path helps colleges run placement readiness, resources, mock tests, and student support from one clean platform.";
const OG_IMAGE = "/og-placementiq.svg";

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
    title: "Student readiness",
    body: "Mock tests, study resources, profile completion, and clear next steps stay in one place so students know what to work on next.",
  },
  {
    title: "College operations",
    body: "TPO teams can manage drives, monitor readiness, and support students from one operational workspace instead of scattered sheets and chats.",
  },
  {
    title: "Ongoing administration",
    body: "Admins can manage the college workspace, seed data, issue credentials, and update resources without redeploying the app.",
  },
];

const audienceBlocks = [
  {
    title: "Students",
    body: "Understand what to prepare, access resources, and stay aligned with the placement process.",
  },
  {
    title: "TPOs",
    body: "Coordinate student readiness, communication, and placement workflows with less manual follow-up.",
  },
  {
    title: "Colleges",
    body: "Keep a cleaner placement support system with one platform for preparation, operations, and visibility.",
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
        <Link to="/" className="marketing-brand" aria-label="Smart Path home">
          <span className="marketing-brand-mark">SP</span>
          <span>
            Smart Path
            <small>Placement readiness platform</small>
          </span>
        </Link>

        <nav className="marketing-nav" aria-label="Primary">
          <a href="#about">About</a>
          <a href="#who-its-for">Who it&apos;s for</a>
          <a href="#capabilities">Capabilities</a>
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
          <Badge>For placement cells and college operations</Badge>
          <h1>Smart Path gives colleges one clean place to guide placement preparation.</h1>
          <p className="marketing-lead">
            Smart Path brings together student readiness, mock tests, resources, communication, and admin operations
            so colleges can support placement preparation without relying on scattered tools.
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
          <p className="marketing-kicker">What Smart Path does</p>
          <ul className="marketing-list">
            <li>Helps students prepare with resources, mock tests, and profile tracking</li>
            <li>Supports TPO teams with communication and day-to-day placement workflows</li>
            <li>Keeps admin operations manageable from one shared platform</li>
          </ul>
        </div>
      </section>

      <section className="marketing-section" id="who-its-for">
        <div className="marketing-section-heading">
          <p className="marketing-kicker">Who it&apos;s for</p>
          <h2>A focused placement support platform for the people using it every day.</h2>
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
          <p className="marketing-kicker">Core capabilities</p>
          <h2>Built to explain the product clearly, not to simulate fake live activity.</h2>
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

      <footer className="marketing-footer">
        <div>
          <strong>Smart Path</strong>
          <p>Placement readiness and operations support for students, TPOs, and colleges.</p>
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
