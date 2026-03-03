import { useState } from "react";

import { Button, Card, Select, Table } from "../../components/ui";
import { confirmStudentCsv, previewStudentCsv } from "../../hooks/use-tpo-students";

export default function TpoStudentUploadPage() {
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<null | {
    headers: string[];
    rows: Array<Record<string, string>>;
    mapping: Record<string, string> | null;
    errors: Array<{ row: number; message: string }>;
  }>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [report, setReport] = useState<null | {
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ row: number; message: string }>;
  }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPreview = async () => {
    setError(null);
    setBusy(true);

    try {
      const data = await previewStudentCsv(csvText);
      setPreview(data);
      setMapping(data.mapping ?? {});
      setReport(null);
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
      const result = await confirmStudentCsv({
        mapping: {
          fullName: mapping.fullName,
          email: mapping.email,
          rollNumber: mapping.rollNumber,
          branch: mapping.branch,
          batch: mapping.batch,
          cgpa: mapping.cgpa,
          backlogs: mapping.backlogs,
          attendancePct: mapping.attendancePct,
        },
        rows: preview.rows,
      });
      setReport(result);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Upload confirm failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>CSV Upload Wizard</h1>
        <p>Step 1: Paste CSV, Step 2: Review mapping, Step 3: Validate, Step 4: Confirm upsert.</p>
        <textarea
          rows={10}
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder="full_name,email,roll_number,branch,batch,cgpa,backlogs,attendance"
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
            "rollNumber",
            "branch",
            "batch",
            "cgpa",
            "backlogs",
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
              {busy ? "Upserting..." : "Confirm Upsert"}
            </Button>
          </div>
        </Card>
      ) : null}

      {report ? (
        <Card>
          <h2>Upload Report</h2>
          <p>Created: {report.created}</p>
          <p>Updated: {report.updated}</p>
          <p>Skipped: {report.skipped}</p>
          <ul>
            {report.errors.map((entry) => (
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
