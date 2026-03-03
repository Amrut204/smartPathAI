import { useParams } from "react-router-dom";
import { useState } from "react";

import { Button, Card, Input } from "../../components/ui";
import { updateTpoStudent, useTpoStudentById } from "../../hooks/use-tpo-students";

export default function TpoStudentDetailPage() {
  const { studentId } = useParams();

  const { data, error, isLoading, mutate } = useTpoStudentById(studentId ?? null);

  const [cgpa, setCgpa] = useState("");
  const [backlogs, setBacklogs] = useState("");
  const [attendancePct, setAttendancePct] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  if (isLoading) {
    return <Card>Loading student profile...</Card>;
  }

  if (error || !data || !studentId) {
    return <Card>Unable to load student profile.</Card>;
  }

  const onSave = async () => {
    setStatus(null);

    try {
      await updateTpoStudent(studentId, {
        cgpa: Number(cgpa || Number(data.cgpa ?? 0)),
        backlogs: Number(backlogs || Number(data.backlogs ?? 0)),
        attendancePct: Number(attendancePct || Number(data.attendancePct ?? 0)),
      });
      await mutate();
      setStatus("Updated successfully");
    } catch (saveError) {
      setStatus(saveError instanceof Error ? saveError.message : "Update failed");
    }
  };

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>{String(data.fullName)}</h1>
        <p>Email: {String(data.email)}</p>
        <p>Roll Number: {String(data.rollNumber)}</p>
        <p>Branch: {String(data.branch)}</p>
        <p>Batch: {String(data.batch)}</p>
        <p>Readiness: {Number(data.readinessScore ?? 0).toFixed(1)}%</p>
      </Card>

      <Card>
        <h2>Edit Academic Data</h2>
        <label>
          CGPA
          <Input
            type="number"
            min="0"
            max="10"
            step="0.1"
            value={cgpa || String(Number(data.cgpa ?? 0))}
            onChange={(event) => setCgpa(event.target.value)}
          />
        </label>
        <label>
          Backlogs
          <Input
            type="number"
            min="0"
            value={backlogs || String(Number(data.backlogs ?? 0))}
            onChange={(event) => setBacklogs(event.target.value)}
          />
        </label>
        <label>
          Attendance %
          <Input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={attendancePct || String(Number(data.attendancePct ?? 0))}
            onChange={(event) => setAttendancePct(event.target.value)}
          />
        </label>
        <div className="hero-actions">
          <Button onClick={onSave}>Save</Button>
        </div>
        {status ? <p>{status}</p> : null}
      </Card>

      <Card>
        <h2>Recent Attempts</h2>
        <ul>
          {(Array.isArray(data.attempts) ? data.attempts : []).map((attempt) => {
            const item = attempt as {
              id: string;
              testId: string;
              testTitle: string;
              testDifficulty: string;
              score: number;
              submittedAt: string | null;
            };
            return (
              <li key={item.id}>
                {item.testTitle}
                {item.testDifficulty ? ` (${item.testDifficulty})` : ""}: {item.score.toFixed(1)}% (
                {item.submittedAt ?? "pending"})
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2>Mastery Snapshot</h2>
        <ul>
          {(Array.isArray(data.mastery) ? data.mastery : []).map((entry) => {
            const item = entry as { topicId: string; topicName: string; masteryLevel: number };
            return (
              <li key={item.topicId}>
                {item.topicName}: {item.masteryLevel.toFixed(1)}%
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2>Drive History</h2>
        <ul>
          {(Array.isArray(data.driveParticipation) ? data.driveParticipation : []).map((entry) => {
            const item = entry as {
              driveId: string;
              company: string;
              role: string | null;
              driveDate: string | null;
              outcome: string;
            };
            return (
              <li key={item.driveId}>
                {item.company} {item.role ? `(${item.role})` : ""} - {item.driveDate ?? "N/A"} - {item.outcome}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
