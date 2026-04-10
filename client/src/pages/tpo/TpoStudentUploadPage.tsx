import { useEffect, useState } from "react";

import { TpoActionMenu } from "../../components/composites/TpoActionMenu";
import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { useAuth } from "../../components/providers/AuthProvider";
import { Button, Card, Select, Table } from "../../components/ui";
import { getTpoGreeting } from "../../config/tpo-workspace";
import {
  type StudentImportJob,
  confirmStudentCsvAsync,
  downloadStudentImportErrorReport,
  fetchStudentImportJob,
  previewStudentCsv,
  previewStudentFile,
} from "../../hooks/use-tpo-students";

function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/plain; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TpoStudentUploadPage() {
  const { profile } = useAuth();
  const [csvText, setCsvText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<null | {
    headers: string[];
    rows: Array<Record<string, string>>;
    mapping: Record<string, string> | null;
    errors: Array<{ row: number; message: string }>;
  }>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importJob, setImportJob] = useState<StudentImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!importJob?.id) return;
    if (importJob.status === "completed" || importJob.status === "failed") return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const next = await fetchStudentImportJob(importJob.id);
        if (cancelled) return;
        setImportJob(next);
      } catch (pollError) {
        if (cancelled) return;
        setError(pollError instanceof Error ? pollError.message : "Unable to refresh import status");
      }
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [importJob?.id, importJob?.status]);

  const runPreview = async () => {
    setError(null);
    setBusy(true);

    try {
      const data = file ? await previewStudentFile(file) : await previewStudentCsv(csvText);
      setPreview(data);
      setMapping(data.mapping ?? {});
      setImportJob(null);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!preview) {
      return;
    }

    setError(null);
    setBusy(true);

    try {
        const job = await confirmStudentCsvAsync({
          mapping: {
            fullName: mapping.fullName,
            email: mapping.email,
            prn: mapping.prn,
            rollNumber: mapping.rollNumber,
            degree: mapping.degree,
            branch: mapping.branch,
            batch: mapping.batch,
            currentSemester: mapping.currentSemester,
            cgpa: mapping.cgpa,
            backlogs: mapping.backlogs,
            totalHistoricalBacklogs: mapping.totalHistoricalBacklogs,
            attendancePct: mapping.attendancePct,
          },
        rows: preview.rows,
      });
      setImportJob(job);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Upload confirm failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tpo-page-shell tpo-student-upload-page">
      <TpoWorkspaceHeader
        eyebrow="Student Upload"
        greeting={getTpoGreeting(profile?.full_name ?? "Placement team")}
        title="Import one roster cleanly before moving on."
        description="Preview the file, confirm the mapping, then review the job report. This keeps upload work in one pane instead of scattering steps across multiple buttons."
        actionMenu={(
          <TpoActionMenu
            items={[
              {
                label: "Download CSV Template",
                onSelect: () => {
                  downloadTextFile(
                    "student-upload-template.csv",
                    "full_name,email,prn,roll_number,degree,branch,batch,current_semester,cgpa,backlogs,total_historical_backlogs,attendance\n",
                  );
                },
              },
            ]}
          />
        )}
      />

      <Card>
        <h1>Student Upload Wizard</h1>
        <p>Step 1: Upload CSV/Excel or paste CSV, Step 2: Review mapping, Step 3: Validate, Step 4: Confirm upsert.</p>
        <label>
          Upload file (.csv / .xlsx)
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
              if (selected) {
                setCsvText("");
              }
            }}
          />
        </label>
        <p className="muted-text">If you upload a file, the paste box is ignored.</p>
        <textarea
          rows={10}
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder="full_name,email,prn,roll_number,degree,branch,batch,current_semester,cgpa,backlogs,total_historical_backlogs,attendance"
        />
        <div className="hero-actions">
          <Button onClick={runPreview} disabled={busy}>
            {busy ? "Processing..." : "Preview"}
          </Button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </Card>

      {preview ? (
        <Card>
          <h2>Column Mapping</h2>
          {[
            "fullName",
            "email",
            "prn",
            "rollNumber",
            "degree",
            "branch",
            "batch",
            "currentSemester",
            "cgpa",
            "backlogs",
            "totalHistoricalBacklogs",
            "attendancePct",
          ].map((field) => (
            <label key={field}>
              {field}
              <Select
                value={mapping[field] ?? ""}
                onChange={(event) => setMapping((prev) => ({ ...prev, [field]: event.target.value }))}
              >
                <option value="">Select column</option>
                {preview.headers.map((header) => (
                  <option key={`${field}_${header}`} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </label>
          ))}

          <h3>Validation Errors</h3>
          <ul>
            {preview.errors.map((entry) => (
              <li key={`${entry.row}_${entry.message}`}>
                Row {entry.row}: {entry.message}
              </li>
            ))}
          </ul>

          <h3>Sample Rows</h3>
          <Table>
            <thead>
              <tr>
                {preview.headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 5).map((row, index) => (
                <tr key={`row_${index}`}>
                  {preview.headers.map((header) => (
                    <td key={`${index}_${header}`}>{row[header]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="hero-actions">
            <Button onClick={runConfirm} disabled={busy}>
              {busy ? "Starting Import..." : "Confirm Upsert"}
            </Button>
          </div>
        </Card>
      ) : null}

      {importJob ? (
        <Card>
          <h2>Upload Report</h2>
          <p>Status: {importJob.status}</p>
          <p>
            Progress: {importJob.totals.processedRows}/{importJob.totals.totalRows}
          </p>
          <p>Created: {importJob.totals.created}</p>
          <p>Updated: {importJob.totals.updated}</p>
          <p>Skipped: {importJob.totals.skipped}</p>
          {importJob.errorCsvAvailable ? (
            <div className="hero-actions">
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    const csv = await downloadStudentImportErrorReport(importJob.id);
                    downloadTextFile("student-upload-errors.csv", csv);
                  } catch (downloadError) {
                    setError(downloadError instanceof Error ? downloadError.message : "Unable to download error report");
                  }
                }}
              >
                Download Error Report
              </Button>
            </div>
          ) : null}
          <ul>
            {importJob.errors.map((entry) => (
              <li key={`${entry.row}_${entry.message}`}>
                Row {entry.row}: {entry.message}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}
