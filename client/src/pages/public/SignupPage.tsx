import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Brand } from "../../components/composites/Brand";
import { useAuth } from "../../components/providers/AuthProvider";
import { Badge, Button, Input } from "../../components/ui";

export default function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [branch, setBranch] = useState("");
  const [batch, setBatch] = useState("");
  const [prn, setPrn] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const redirectTo = await signup({
        email,
        password,
        fullName,
        tenantSlug,
        branch,
        batch,
        prn,
        rollNumber: rollNumber.trim() || undefined,
      });

      navigate(redirectTo);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign up");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="public-auth-shell">
      <div className="public-auth-layout public-auth-layout-signup">
        <aside className="public-auth-aside">
          <Brand href="/" variant="full" descriptor="Placement readiness platform" className="public-auth-brand" />

          <Badge>Student onboarding</Badge>
          <h1>Join your college workspace and track your placement readiness with clarity.</h1>
          <p className="public-auth-lead">
            Students can use Smart Path to monitor eligibility, take mock tests, study the right material, and
            stay aligned with upcoming drives.
          </p>

          <div className="public-auth-highlights">
            <div>
              <strong>Profile setup</strong>
              <span>PRN and academic details help the platform match you to the right drives.</span>
            </div>
            <div>
              <strong>Readiness flow</strong>
              <span>Mock tests, resources, and preparation activity make your progress visible.</span>
            </div>
            <div>
              <strong>Placement support</strong>
              <span>Your TPO can guide you better when the data is complete and updated.</span>
            </div>
          </div>
        </aside>

        <div className="public-auth-panel">
          <header className="public-auth-header">
            <p className="public-auth-kicker">Create account</p>
            <h2>Start your student workspace</h2>
            <p>Enter your college details carefully so your dashboard and drive eligibility stay accurate.</p>
          </header>

          <form onSubmit={onSubmit} className="form-grid public-auth-form">
            <div className="public-auth-field-grid">
              <label>
                Full name
                <Input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  placeholder="Your full name"
                />
              </label>

              <label>
                PRN
                <Input
                  value={prn}
                  onChange={(event) => setPrn(event.target.value)}
                  required
                  placeholder="Permanent Registration Number"
                />
              </label>
            </div>

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
                autoComplete="new-password"
                placeholder="Create a strong password"
              />
            </label>

            <div className="public-auth-field-grid">
              <label>
                College slug
                <Input
                  value={tenantSlug}
                  onChange={(event) => setTenantSlug(event.target.value)}
                  required
                  placeholder="apex-institute"
                />
              </label>

              <label>
                Branch
                <Input
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  required
                  placeholder="Mechanical, CS, Civil, Commerce"
                />
              </label>
            </div>

            <label>
              Batch
              <Input
                value={batch}
                onChange={(event) => setBatch(event.target.value)}
                required
                placeholder="2026"
              />
            </label>

            <label>
              Roll number (optional)
              <Input
                value={rollNumber}
                onChange={(event) => setRollNumber(event.target.value)}
                placeholder="College roll number"
              />
            </label>

            {error ? (
              <p className="error-text" role="alert" aria-live="polite">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={submitting} className="auth-submit">
              {submitting ? "Creating account..." : "Create account"}
            </Button>
          </form>

          <div className="public-auth-meta">
            <p>
              Already registered? <Link to="/login">Sign in</Link>
            </p>
            <p>
              Not sure about your college slug? Ask your TPO or admin before signing up.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
