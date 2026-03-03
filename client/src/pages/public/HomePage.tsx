import { Link } from "react-router-dom";

import { Badge, Button, Card } from "../../components/ui";

export default function HomePage() {
  return (
    <section className="hero-grid">
      <header>
        <Badge>Dual Persona Platform</Badge>
        <h1>Operate your entire campus placement lifecycle from one system.</h1>
        <p>
          Students get structured preparation with mock tests and AI doubt assistance. TPO teams
          get drive orchestration, eligibility filtering, and analytics.
        </p>
      </header>

      <div className="hero-actions">
        <Link to="/login">
          <Button>Login</Button>
        </Link>
        <Link to="/signup">
          <Button variant="secondary">Student Sign up</Button>
        </Link>
      </div>

      <Card>
        <strong>Architecture Status</strong>
        <p>Sprints 0-11 implemented. Sprint 12 hardening is in progress.</p>
      </Card>
    </section>
  );
}
