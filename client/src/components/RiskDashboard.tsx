import { useState } from "react";

import { Badge, Button, Card } from "./ui";
import { logRiskIntervention, useTpoRiskAssessment } from "../hooks/use-risk-assessment";

export function RiskDashboard() {
  const { data, isLoading, error, mutate } = useTpoRiskAssessment();
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  if (isLoading) {
    return <Card>Loading risk assessment...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load risk assessment.</Card>;
  }

  const total = data.summary.totalStudents || 1;
  const highPct = Math.round((data.summary.highRisk / total) * 100);
  const mediumPct = Math.round((data.summary.mediumRisk / total) * 100);
  const lowPct = Math.max(0, 100 - highPct - mediumPct);

  const handleAction = async (studentId: string, action: string) => {
    setActionMessage(null);
    try {
      await logRiskIntervention({ studentId, action });
      setActionMessage("Action logged.");
      void mutate();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Unable to log action.");
    }
  };

  return (
    <Card className="risk-dashboard-card">
      <div className="risk-dashboard-header">
        <div>
          <h2>At-Risk Students</h2>
          <p className="muted-text">Priority follow-ups based on activity, preparation, and eligibility gaps.</p>
        </div>
        <div className="risk-summary-grid">
          <div>
            <span>High Risk</span>
            <strong>{data.summary.highRisk}</strong>
          </div>
          <div>
            <span>Medium Risk</span>
            <strong>{data.summary.mediumRisk}</strong>
          </div>
          <div>
            <span>Low Risk</span>
            <strong>{data.summary.lowRisk}</strong>
          </div>
        </div>
      </div>

      <div className="risk-distribution">
        <div className="risk-distribution-bar">
          <span className="risk-bar high" style={{ width: `${highPct}%` }} />
          <span className="risk-bar medium" style={{ width: `${mediumPct}%` }} />
          <span className="risk-bar low" style={{ width: `${lowPct}%` }} />
        </div>
        <div className="risk-distribution-labels">
          <span>High {highPct}%</span>
          <span>Medium {mediumPct}%</span>
          <span>Low {lowPct}%</span>
        </div>
      </div>

      <div className="risk-trend-row">
        <span>
          Weekly change: High {data.trends.weeklyChange.highRisk >= 0 ? "+" : ""}
          {data.trends.weeklyChange.highRisk}, Medium {data.trends.weeklyChange.mediumRisk >= 0 ? "+" : ""}
          {data.trends.weeklyChange.mediumRisk}, Low {data.trends.weeklyChange.lowRisk >= 0 ? "+" : ""}
          {data.trends.weeklyChange.lowRisk}
        </span>
        {actionMessage ? <span className="muted-text">{actionMessage}</span> : null}
      </div>

      <div className="risk-student-list">
        {data.highRiskStudents.slice(0, 6).map((student) => (
          <div key={student.studentId} className="risk-student-row">
            <div className="risk-student-info">
              <strong>{student.fullName}</strong>
              <span>{student.branch} - CGPA {student.cgpa.toFixed(1)}</span>
              <div className="risk-factor-list">
                {student.riskFactors.map((factor) => (
                  <Badge key={factor} variant="warning">{factor}</Badge>
                ))}
              </div>
            </div>
            <div className="risk-student-meta">
              <Badge variant="danger">Risk {student.riskScore}</Badge>
              <div className="risk-action-buttons">
                <Button variant="secondary" onClick={() => handleAction(student.studentId, "reminder_sent")}>
                  Send Reminder
                </Button>
                <Button onClick={() => handleAction(student.studentId, "marked_for_followup")}>
                  Mark Follow-up
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
