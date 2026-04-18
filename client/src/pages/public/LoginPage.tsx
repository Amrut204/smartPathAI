import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Brand } from "../../components/composites/Brand";
import { useAuth } from "../../components/providers/AuthProvider";
import { Badge, Button, Input } from "../../components/ui";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const redirectTo = await login(email, password);
      navigate(redirectTo);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to login");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="public-auth-shell">
      <div className="public-auth-layout">
        <aside className="public-auth-aside">
          <Brand href="/" variant="full" descriptor="Placement readiness platform" className="public-auth-brand" />

          <Badge>Readiness and intervention workspace</Badge>
          <h1>See readiness, blockers, and next actions in one college placement workspace.</h1>
          <p className="public-auth-lead">
            Smart Path is designed for placement offices that need clearer operational visibility and students who need
            a guided next step for placements. Students can still prepare from GFG, PrepInsta, YouTube, or any trusted source while using Smart Path for official college workflow and readiness guidance.
          </p>

          <div className="public-auth-highlights">
            <div>
              <strong>For TPOs</strong>
              <span>Find blocked students, nudge ready-but-inactive students, and run drives from one operations console.</span>
            </div>
            <div>
              <strong>For students</strong>
              <span>Know what to do next for placements with clearer readiness, drive, resource, and mock guidance.</span>
            </div>
            <div>
              <strong>For rollout</strong>
              <span>Start with activation, readiness, and intervention workflows before expanding the wider platform footprint.</span>
            </div>
          </div>

          <div className="public-auth-demo-links">
            <a href="/api/v1/demo/auto-login-tpo">Open TPO demo</a>
            <a href="/api/v1/demo/auto-login-student">Open student demo</a>
          </div>
        </aside>

        <div className="public-auth-panel">
          <header className="public-auth-header">
            <p className="public-auth-kicker">Sign in</p>
            <h2>Welcome back</h2>
            <p>Use your college credentials to open the student, TPO, or admin workspace connected to your placement process.</p>
          </header>

          <form onSubmit={onSubmit} className="form-grid public-auth-form">
            <label>
              Email
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                placeholder="you@college.edu"
              />
            </label>

            <label>
              Password
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
              />
            </label>

            {error ? (
              <p className="error-text" role="alert" aria-live="polite">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={submitting} className="auth-submit">
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <div className="public-auth-meta">
            <p>
              Accounts are created by your college admin or TPO. Use the seeded credentials shared with you to sign in.
            </p>
            <p>
              First-time student flow: Sign in, set your permanent password, review onboarding declaration, then continue to dashboard.
            </p>
            <p>
              Need access help? <a href="mailto:admin@campusdrive.me?subject=Smart%20Path%20Access">Contact us</a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
