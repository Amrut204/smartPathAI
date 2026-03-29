import { useEffect } from "react";
import { Link } from "react-router-dom";

import { Brand } from "../../components/composites/Brand";

const PAGE_TITLE = "Resource Usage Policy | Smart Path";

export default function ResourceUsagePolicyPage() {
  useEffect(() => {
    document.title = PAGE_TITLE;
  }, []);

  return (
    <section className="public-shell policy-shell">
      <article className="public-card policy-card">
        <div className="policy-header">
          <Brand href="/" variant="full" descriptor="Resource Usage Policy" className="policy-brand" />
          <h1>Resource Usage Policy</h1>
          <p>
            Smart Path provides resources to support student preparation and educational use. This page explains how
            those materials should be used and how rights concerns can be raised.
          </p>
        </div>

        <section className="policy-section">
          <h2>Educational use only</h2>
          <p>
            Resources available on Smart Path are provided to help students prepare for placement-related learning,
            practice, and revision. They are not provided for redistribution, republication, or commercial use.
          </p>
        </section>

        <section className="policy-section">
          <h2>Source of materials</h2>
          <p>
            Some materials made available through Smart Path are collected from open-source, public, or publicly
            accessible repositories and educational sources. Ownership and rights remain with the original authors,
            publishers, and rights holders.
          </p>
        </section>

        <section className="policy-section">
          <h2>Student responsibility</h2>
          <ul className="dashboard-bullet-list">
            <li>Do not redistribute or republish materials downloaded or viewed through Smart Path.</li>
            <li>Do not use platform resources for commercial sale, resale, or public reposting.</li>
            <li>Use the materials only for your own educational preparation unless explicit rights say otherwise.</li>
          </ul>
        </section>

        <section className="policy-section">
          <h2>Rights concerns and removals</h2>
          <p>
            If any author, publisher, or rights holder believes a resource should not appear on Smart Path, please
            contact us before taking further action. We will review the concern promptly and remove or update the
            material where appropriate.
          </p>
        </section>

        <section className="policy-section">
          <h2>Contact</h2>
          <p>
            For resource usage or rights concerns, contact <a href="mailto:admin@campusdrive.me">admin@campusdrive.me</a>.
          </p>
        </section>

        <div className="policy-actions">
          <Link to="/login" className="ui-button primary">
            Go to login
          </Link>
          <Link to="/" className="ui-button secondary">
            Back to home
          </Link>
        </div>
      </article>
    </section>
  );
}
