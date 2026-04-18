import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Brand } from "../../components/composites/Brand";
import { useAuth } from "../../components/providers/AuthProvider";
import { Button, Input } from "../../components/ui";

export default function InitialPasswordResetPage() {
  const navigate = useNavigate();
  const { profile, initialPasswordReset, logout } = useAuth();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const redirectTo = await initialPasswordReset(newPassword);
      navigate(redirectTo, { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to update password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="public-auth-shell">
      <div className="public-auth-layout">
        <aside className="public-auth-aside">
          <Brand href="/" variant="full" descriptor="Secure account setup" className="public-auth-brand" />
          <p className="public-auth-kicker">Step 1 of 3 · First-time setup</p>
          <h1>Create your permanent password.</h1>
          <p className="public-auth-lead">
            Your account was created by the placement office. Your temporary password works only for this first sign-in.
          </p>
          <p className="public-auth-lead">After this step, you will confirm your onboarding declaration and then continue to your student dashboard.</p>
        </aside>

        <div className="public-auth-panel">
          <header className="public-auth-header">
            <p className="public-auth-kicker">Step 1 of 3</p>
            <h2>Set your password</h2>
            <p>{profile?.email ?? "Student account"}</p>
          </header>

          <form onSubmit={onSubmit} className="form-grid public-auth-form">
            <label>
              New Password
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </label>

            <label>
              Confirm Password
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </label>

            {error ? <p className="error-text">{error}</p> : null}

            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving password..." : "Continue to workspace"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void logout()}>
              Logout
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
