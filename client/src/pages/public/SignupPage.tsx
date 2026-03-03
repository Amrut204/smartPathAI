import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../components/providers/AuthProvider";
import { Button, Input } from "../../components/ui";

export default function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [branch, setBranch] = useState("");
  const [batch, setBatch] = useState("");
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
        rollNumber,
      });

      navigate(redirectTo);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign up");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <h1>Create student account</h1>
      <p>Join your campus tenant and start placement readiness tracking.</p>
      <form onSubmit={onSubmit} className="form-grid">
        <label>
          Full name
          <Input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
        </label>
        <label>
          Email
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
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
          />
        </label>
        <label>
          Tenant slug
          <Input
            value={tenantSlug}
            onChange={(event) => setTenantSlug(event.target.value)}
            required
            placeholder="apex-institute"
          />
        </label>
        <label>
          Branch
          <Input value={branch} onChange={(event) => setBranch(event.target.value)} required />
        </label>
        <label>
          Batch
          <Input value={batch} onChange={(event) => setBatch(event.target.value)} required />
        </label>
        <label>
          Roll number
          <Input value={rollNumber} onChange={(event) => setRollNumber(event.target.value)} required />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating account..." : "Create account"}
        </Button>
      </form>
    </section>
  );
}
