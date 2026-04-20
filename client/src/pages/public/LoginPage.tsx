import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../components/providers/AuthProvider";
import { Button, Input } from "../../components/ui";
import { isClientFeatureEnabled } from "../../config/features";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const demoAutoLoginEnabled = isClientFeatureEnabled("demoAutoLogin");

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
      <div className="public-auth-layout public-auth-layout-login-only">
        <div className="public-auth-panel">
          <header className="public-auth-header">
            <div className="public-auth-login-actions">
              <a href="/" className="ui-button ghost">Home</a>
            </div>
            <p className="public-auth-kicker">Sign in</p>
            <h2>Welcome back</h2>
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

          {demoAutoLoginEnabled ? (
            <div className="public-auth-login-demo-links">
              <a href="/api/v1/demo/auto-login-tpo">Open TPO demo</a>
              <a href="/api/v1/demo/auto-login-student">Open student demo</a>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
