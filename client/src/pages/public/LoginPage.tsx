import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../components/providers/AuthProvider";
import { Button, Input } from "../../components/ui";

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
    <section className="auth-shell">
      <article className="auth-card">
        <header className="auth-header">
          <p className="auth-eyebrow">CampusDrive AI</p>
          <h1>Welcome back</h1>
          <p className="auth-subtitle">Sign in to continue to your student or TPO workspace.</p>
        </header>
        <form onSubmit={onSubmit} className="form-grid auth-form">
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
        <p className="auth-footer">
          New student? <Link to="/signup">Create account</Link>
        </p>
      </article>
    </section>
  );
}
