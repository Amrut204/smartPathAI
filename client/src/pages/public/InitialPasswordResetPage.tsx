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
          <p className="public-auth-kicker">First login setup</p>
          <h1>Set your permanent password before entering your workspace.</h1>
          <p className="public-auth-lead">
            Your account was created by the placement office. For security, the temporary password works only for this first login.
          </p>
        </aside>

        <div className="public-auth-panel">
          <header className="public-auth-header">
            <p className="public-auth-kicker">Password setup</p>
            <h2>Create your new password</h2>
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
              {submitting ? "Saving..." : "Save Password"}
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
