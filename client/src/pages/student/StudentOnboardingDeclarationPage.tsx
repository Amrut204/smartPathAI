import { useMemo, useState, type FormEvent } from "react";

import { Button, Input } from "../../components/ui";
import { acceptOnboardingDeclaration, useStudentProfile } from "../../hooks/use-student-profile";

export default function StudentOnboardingDeclarationPage() {
  const { data, isLoading, mutate } = useStudentProfile();
  const [typedValue, setTypedValue] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const quickChecklist = useMemo(() => ([
    "My profile data directly affects my drive eligibility.",
    "Incorrect or misleading data can lead to drive removal or disciplinary escalation.",
    "Platform resources are for learning use and must not be redistributed.",
  ]), []);

  const warnings = useMemo(() => ([
    "If a discrepancy is found before a drive, you may be removed from that drive and asked to meet the TPO before continuing.",
    "If falsification is confirmed, the college may block you from further drives for the academic year and place a written record in your placement file.",
    "If false data reaches a company after an offer, your placement can be cancelled and the matter may be escalated to the TPO, HOD, or disciplinary committee.",
  ]), []);
  const resourceUsageLines = useMemo(() => ([
    "Resources available on this platform are provided for educational purposes.",
    "Some materials are sourced from public repositories.",
    "You agree not to redistribute, republish, or use materials for commercial purposes.",
  ]), []);

  if (isLoading || !data) {
    return <section className="student-workspace-shell"><div className="student-workspace-panel">Loading declaration...</div></section>;
  }

  const expectedValue = data.declarationStatus.onboarding.expectedTypedValue;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    if (!confirmed) {
      setStatus("Select the acknowledgement checkbox before continuing.");
      return;
    }

    setBusy(true);
    try {
      await acceptOnboardingDeclaration({ typedValue });
      await mutate();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save declaration");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="student-workspace-shell">
      <section className="student-workspace-panel student-declaration-panel">
        <div className="student-workspace-panel-head">
          <div>
            <p className="resources-kicker">Step 2 of 3 · Onboarding declaration</p>
            <h1>Confirm your placement profile acknowledgement.</h1>
            <p>
              Before entering your student workspace, review these points and confirm you understand them.
            </p>
          </div>
        </div>

        <div className="student-declaration-warning">
          <h2>Quick checklist</h2>
          <ul className="dashboard-bullet-list">
            {quickChecklist.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <details className="student-declaration-warning">
          <summary>
            <strong>Read full policy details</strong>
          </summary>

          <h2>Consequences of false or misleading data</h2>
          <ul className="dashboard-bullet-list">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>

          <h2>Resource usage acknowledgement</h2>
          <ul className="dashboard-bullet-list">
            {resourceUsageLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>

        <form className="student-declaration-form" onSubmit={onSubmit}>
          <label className="student-profile-checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I understand that incorrect data can affect my drive eligibility, and I agree to use Smart Path resources
              only for educational purposes without redistributing or republishing them.
            </span>
          </label>

          <label>
            Type <strong>{expectedValue}</strong> to continue
            <Input value={typedValue} onChange={(event) => setTypedValue(event.target.value)} />
            <small className="muted-text">Use the value exactly as shown.</small>
          </label>

          <div className="hero-actions">
            <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Accept and Continue"}</Button>
            {status ? <p className="error-text">{status}</p> : null}
          </div>
        </form>
      </section>
    </section>
  );
}
