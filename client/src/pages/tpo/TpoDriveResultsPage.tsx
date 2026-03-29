import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";

import { Badge, Button, Card, Input, Select, Table } from "../../components/ui";
import {
  previewDriveResultRelease,
  releaseDriveResults,
  resendDriveResultEmail,
  updateDriveResults,
  useDriveById,
  useDriveReleaseStatus,
  useDriveResults,
} from "../../hooks/use-drives";

type Outcome = "pending" | "shortlisted" | "selected" | "rejected";
type ReleaseAudience = "selected" | "rejected" | "finalized";

interface DraftRow {
  outcome?: Outcome;
  applicationState?: "not_applied" | "applied" | "withdrawn" | "absent";
  remarks?: string;
  registered?: boolean;
  appeared?: boolean;
  shortlistedRound?: string;
  offerDate?: string;
  designationOffered?: string;
  finalCtcLpa?: string;
  joiningStatus?: "pending" | "joined" | "not_joined" | "deferred";
  offerLetterReference?: string;
  offerLetterUrl?: string;
  selectionSource?: "on_campus" | "off_campus" | "self_reported";
  verificationStatus?: "pending" | "verified" | "rejected";
  nonPlacementReason?: string;
  actionPlan?: string;
}

export default function TpoDriveResultsPage() {
  const { driveId } = useParams();

  const { data: drive, isLoading: driveLoading } = useDriveById(driveId ?? null);
  const { data: results, isLoading: resultsLoading, error, mutate } = useDriveResults(driveId ?? null);
  const { data: releaseStatus, mutate: mutateReleaseStatus } = useDriveReleaseStatus(driveId ?? null);
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [releaseAudience, setReleaseAudience] = useState<ReleaseAudience>("selected");
  const [releasePreview, setReleasePreview] = useState<Awaited<ReturnType<typeof previewDriveResultRelease>> | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [resendBusyId, setResendBusyId] = useState<string | null>(null);
  const [resultIntake, setResultIntake] = useState({
    source: "manual_update" as "employer_email" | "employer_portal" | "manual_update",
    receivedAt: "",
    companyResultReference: "",
    attachmentNote: "",
  });

  useEffect(() => {
    if (!drive) return;
    setResultIntake({
      source: drive.resultIntake.source ?? "manual_update",
      receivedAt: drive.resultIntake.receivedAt ? String(drive.resultIntake.receivedAt).slice(0, 16) : "",
      companyResultReference: drive.resultIntake.companyResultReference ?? "",
      attachmentNote: drive.resultIntake.attachmentNote ?? "",
    });
  }, [drive]);

  if (driveLoading || resultsLoading) {
    return <Card>Loading drive results...</Card>;
  }

  if (error || !driveId || !drive) {
    return <Card>Unable to load drive results.</Card>;
  }

  const rows = results ?? [];

  const getOutcome = (studentId: string, current: Outcome) => {
    return draft[studentId]?.outcome ?? current;
  };

  const getRemarks = (studentId: string, current: string | null) => {
    return draft[studentId]?.remarks ?? (current ?? "");
  };

  const getValue = <K extends keyof DraftRow>(studentId: string, key: K, current: DraftRow[K]) =>
    draft[studentId]?.[key] ?? current;

  const toPayload = () =>
    rows.map((row) => ({
      studentId: row.id,
      outcome: getOutcome(row.id, row.outcome),
      applicationState: getValue(row.id, "applicationState", row.applicationState),
      remarks: getRemarks(row.id, row.remarks),
      registered: getValue(row.id, "registered", row.registered ?? undefined),
      appeared: getValue(row.id, "appeared", row.appeared ?? undefined),
      shortlistedRound: getValue(row.id, "shortlistedRound", row.shortlistedRound ?? undefined),
      offerDate: getValue(row.id, "offerDate", row.offerDate ?? undefined),
      designationOffered: getValue(row.id, "designationOffered", row.designationOffered ?? undefined),
      finalCtcLpa: (() => {
        const value = getValue(row.id, "finalCtcLpa", row.finalCtcLpa !== null ? String(row.finalCtcLpa) : undefined);
        return value ? Number(value) : undefined;
      })(),
      joiningStatus: getValue(row.id, "joiningStatus", row.joiningStatus),
      offerLetterReference: getValue(row.id, "offerLetterReference", row.offerLetterReference ?? undefined),
      offerLetterUrl: getValue(row.id, "offerLetterUrl", row.offerLetterUrl ?? undefined),
      selectionSource: getValue(row.id, "selectionSource", row.selectionSource),
      verificationStatus: getValue(row.id, "verificationStatus", row.verificationStatus),
      nonPlacementReason: getValue(row.id, "nonPlacementReason", row.nonPlacementReason ?? undefined),
      actionPlan: getValue(row.id, "actionPlan", row.actionPlan ?? undefined),
    }));

  const onSave = async (markCompleted = false) => {
    setBusy(true);
    setStatus(null);

    try {
      const payload = toPayload();
      await updateDriveResults({
        driveId,
        updates: payload,
        resultIntake: {
          source: resultIntake.source,
          receivedAt: resultIntake.receivedAt ? new Date(resultIntake.receivedAt).toISOString() : undefined,
          companyResultReference: resultIntake.companyResultReference.trim() || undefined,
          attachmentNote: resultIntake.attachmentNote.trim() || undefined,
        },
        markCompleted,
      });
      await Promise.all([mutate(), mutateReleaseStatus()]);
      setStatus(markCompleted ? "Results and intake details saved. Drive marked completed." : "Results and intake details saved.");
    } catch (saveError) {
      setStatus(saveError instanceof Error ? saveError.message : "Unable to save results");
    } finally {
      setBusy(false);
    }
  };

  const onPreviewRelease = async () => {
    setReleaseBusy(true);
    setStatus(null);
    try {
      const preview = await previewDriveResultRelease({
        driveId,
        audience: releaseAudience,
      });
      setReleasePreview(preview);
    } catch (previewError) {
      setStatus(previewError instanceof Error ? previewError.message : "Unable to preview result release");
    } finally {
      setReleaseBusy(false);
    }
  };

  const onRelease = async () => {
    setReleaseBusy(true);
    setStatus(null);
    try {
      const released = await releaseDriveResults({
        driveId,
        audience: releaseAudience,
      });
      await Promise.all([mutate(), mutateReleaseStatus()]);
      setStatus(`Queued ${released.selectedCount + released.rejectedCount} result email(s) for ${releaseAudience} release.`);
      setReleasePreview(null);
    } catch (releaseError) {
      setStatus(releaseError instanceof Error ? releaseError.message : "Unable to release results");
    } finally {
      setReleaseBusy(false);
    }
  };

  const onResend = async (studentId: string) => {
    setResendBusyId(studentId);
    setStatus(null);
    try {
      await resendDriveResultEmail({
        driveId,
        studentId,
      });
      await Promise.all([mutate(), mutateReleaseStatus()]);
      setStatus("Queued a fresh result email for the selected student.");
    } catch (resendError) {
      setStatus(resendError instanceof Error ? resendError.message : "Unable to resend result email");
    } finally {
      setResendBusyId(null);
    }
  };

  const onDownloadCsv = () => {
    const header = ["name", "email", "roll_number", "branch", "cgpa", "outcome", "verification_status", "offer_letter_reference", "result_notification_status", "remarks"];
    const body = rows.map((row) =>
      [
        row.fullName,
        row.email,
        row.rollNumber,
        row.branch,
        row.cgpa.toFixed(2),
        getOutcome(row.id, row.outcome),
        getValue(row.id, "verificationStatus", row.verificationStatus),
        getValue(row.id, "offerLetterReference", row.offerLetterReference ?? ""),
        row.resultNotificationStatus ?? "",
        getRemarks(row.id, row.remarks),
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );

    const csv = [header.join(","), ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${drive.company.replace(/\s+/g, "-").toLowerCase()}-results.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="dashboard-grid tpo-drive-results-page">
      <Card className="tpo-table-actions-card">
        <h1>Drive Results: {drive.company}</h1>
        <p>Save employer outcomes internally, review readiness, then release official result emails to students.</p>

        <div className="hero-actions">
          <Link to={`/tpo/drives/${drive.id}`}>
            <Button variant="ghost">Back to Drive</Button>
          </Link>
          <Link to={`/tpo/reports?group=Drive+Reports&reportType=drive_completion_summary&driveId=${drive.id}`}>
            <Button variant="secondary">Generate Drive Summary</Button>
          </Link>
          <Button variant="secondary" onClick={onDownloadCsv}>
            Download CSV
          </Button>
          <Button disabled={busy} onClick={() => void onSave(false)}>
            {busy ? "Saving..." : "Save"}
          </Button>
          <Button disabled={busy} onClick={() => void onSave(true)}>
            {busy ? "Saving..." : "Save + Mark Completed"}
          </Button>
        </div>

        <div className="form-grid">
          <label>
            <span>Result source</span>
            <Select
              value={resultIntake.source}
              onChange={(event) => setResultIntake((current) => ({ ...current, source: event.target.value as typeof current.source }))}
            >
              <option value="employer_email">Employer email</option>
              <option value="employer_portal">Employer portal</option>
              <option value="manual_update">Manual update</option>
            </Select>
          </label>
          <label>
            <span>Received at</span>
            <Input
              type="datetime-local"
              value={resultIntake.receivedAt}
              onChange={(event) => setResultIntake((current) => ({ ...current, receivedAt: event.target.value }))}
            />
          </label>
          <label>
            <span>Company result reference</span>
            <Input
              value={resultIntake.companyResultReference}
              onChange={(event) => setResultIntake((current) => ({ ...current, companyResultReference: event.target.value }))}
            />
          </label>
          <label className="tpo-communication-full">
            <span>Attachment / proof note</span>
            <Input
              value={resultIntake.attachmentNote}
              onChange={(event) => setResultIntake((current) => ({ ...current, attachmentNote: event.target.value }))}
            />
          </label>
        </div>

        {status ? <p>{status}</p> : null}
      </Card>

      <Card>
        <h2>Release Workspace</h2>
        <p>Students are notified only when you explicitly release finalized results. Release uses the last saved result data.</p>
        <div className="form-grid">
          <label>
            <span>Release audience</span>
            <Select
              value={releaseAudience}
              onChange={(event) => setReleaseAudience(event.target.value as ReleaseAudience)}
            >
              <option value="selected">Release selected results</option>
              <option value="rejected">Release rejected results</option>
              <option value="finalized">Release all finalized results</option>
            </Select>
          </label>
          <div className="hero-actions">
            <Button variant="secondary" disabled={releaseBusy} onClick={() => void onPreviewRelease()}>
              {releaseBusy ? "Loading..." : "Preview Release"}
            </Button>
            <Button disabled={releaseBusy} onClick={() => void onRelease()}>
              {releaseBusy ? "Releasing..." : "Release Results"}
            </Button>
          </div>
        </div>

        {releasePreview ? (
          <div className="tpo-communication-preview-block">
            <p><strong>Sender:</strong> {releasePreview.sender.displayFrom}</p>
            <p><strong>Recipients:</strong> {releasePreview.recipientCount} total | selected {releasePreview.selectedCount} | rejected {releasePreview.rejectedCount}</p>
            <p><strong>Selected with offer letters:</strong> {releasePreview.selectedWithOfferLetters}</p>
            {releasePreview.warnings.length > 0 ? (
              <ul className="dashboard-bullet-list">
                {releasePreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : (
              <p className="muted-text">No blockers detected for this release.</p>
            )}
          </div>
        ) : null}

        {releaseStatus ? (
          <div className="student-profile-certification-grid">
            <div><span>Selected</span><strong>{releaseStatus.summary.selectedCount}</strong></div>
            <div><span>Rejected</span><strong>{releaseStatus.summary.rejectedCount}</strong></div>
            <div><span>Released</span><strong>{releaseStatus.summary.releasedCount}</strong></div>
            <div><span>Pending release</span><strong>{releaseStatus.summary.pendingReleaseCount}</strong></div>
            <div><span>Queued</span><strong>{releaseStatus.summary.queuedCount}</strong></div>
            <div><span>Sent</span><strong>{releaseStatus.summary.sentCount}</strong></div>
            <div><span>Failed</span><strong>{releaseStatus.summary.failedCount}</strong></div>
            <div><span>Offer letters attached</span><strong>{releaseStatus.summary.offerAttachedCount}</strong></div>
          </div>
        ) : null}
      </Card>

      <Card className="tpo-table-card">
        <div className="tpo-ranking-table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Branch</th>
                <th>CGPA</th>
                <th>Registered</th>
                <th>Appeared</th>
                <th>Application State</th>
                <th>Outcome</th>
                <th>Reporting Fields</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.fullName}</td>
                  <td>{row.email}</td>
                  <td>{row.branch}</td>
                  <td>{row.cgpa.toFixed(2)}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(getValue(row.id, "registered", row.registered ?? false))}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [row.id]: {
                            ...current[row.id],
                            registered: event.target.checked,
                          },
                        }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(getValue(row.id, "appeared", row.appeared ?? false))}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [row.id]: {
                            ...current[row.id],
                            appeared: event.target.checked,
                          },
                        }))
                      }
                    />
                  </td>
                  <td>
                    <Select
                      value={getValue(row.id, "applicationState", row.applicationState)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [row.id]: {
                            ...current[row.id],
                            applicationState: event.target.value as DraftRow["applicationState"],
                          },
                        }))
                      }
                    >
                      <option value="not_applied">not applied</option>
                      <option value="applied">applied</option>
                      <option value="withdrawn">withdrawn</option>
                      <option value="absent">absent</option>
                    </Select>
                  </td>
                  <td>
                    <div className="tpo-student-cell-stack">
                      <Select
                        value={getOutcome(row.id, row.outcome)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [row.id]: {
                              ...current[row.id],
                              outcome: event.target.value as Outcome,
                            },
                          }))
                        }
                      >
                        <option value="pending">pending</option>
                        <option value="shortlisted">shortlisted</option>
                        <option value="selected">selected</option>
                        <option value="rejected">rejected</option>
                      </Select>
                      <div className="hero-actions">
                        <Badge variant={row.resultNotificationStatus === "sent" ? "success" : row.resultNotificationStatus === "failed" ? "danger" : "default"}>
                          {row.resultNotificationStatus ?? "not released"}
                        </Badge>
                        {row.resultReleasedAt ? (
                          <small>Released {new Date(row.resultReleasedAt).toLocaleString()}</small>
                        ) : (
                          <small>Hidden from student</small>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="tpo-student-cell-stack">
                      <label>
                        <span>Designation</span>
                        <Input
                          value={getValue(row.id, "designationOffered", row.designationOffered ?? "") ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                designationOffered: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Offer Date</span>
                        <Input
                          type="date"
                          value={getValue(row.id, "offerDate", row.offerDate ?? "") ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                offerDate: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Final CTC</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.1"
                          value={getValue(row.id, "finalCtcLpa", row.finalCtcLpa !== null ? String(row.finalCtcLpa) : "") ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                finalCtcLpa: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Shortlisted Round</span>
                        <Input
                          value={getValue(row.id, "shortlistedRound", row.shortlistedRound ?? "") ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                shortlistedRound: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Offer Ref</span>
                        <Input
                          value={getValue(row.id, "offerLetterReference", row.offerLetterReference ?? "") ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                offerLetterReference: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Offer URL</span>
                        <Input
                          value={getValue(row.id, "offerLetterUrl", row.offerLetterUrl ?? "") ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                offerLetterUrl: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Source</span>
                        <Select
                          value={getValue(row.id, "selectionSource", row.selectionSource)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                selectionSource: event.target.value as DraftRow["selectionSource"],
                              },
                            }))
                          }
                        >
                          <option value="on_campus">on campus</option>
                          <option value="off_campus">off campus</option>
                          <option value="self_reported">self reported</option>
                        </Select>
                      </label>
                      <label>
                        <span>Verification</span>
                        <Select
                          value={getValue(row.id, "verificationStatus", row.verificationStatus)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                verificationStatus: event.target.value as DraftRow["verificationStatus"],
                              },
                            }))
                          }
                        >
                          <option value="pending">pending</option>
                          <option value="verified">verified</option>
                          <option value="rejected">rejected</option>
                        </Select>
                      </label>
                      <label>
                        <span>Joining</span>
                        <Select
                          value={getValue(row.id, "joiningStatus", row.joiningStatus)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                joiningStatus: event.target.value as DraftRow["joiningStatus"],
                              },
                            }))
                          }
                        >
                          <option value="pending">pending</option>
                          <option value="joined">joined</option>
                          <option value="not_joined">not joined</option>
                          <option value="deferred">deferred</option>
                        </Select>
                      </label>
                      <label>
                        <span>Non-placement Reason</span>
                        <Input
                          value={getValue(row.id, "nonPlacementReason", row.nonPlacementReason ?? "") ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                nonPlacementReason: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Action Plan</span>
                        <Input
                          value={getValue(row.id, "actionPlan", row.actionPlan ?? "") ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                actionPlan: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Remarks</span>
                        <Input
                          value={getRemarks(row.id, row.remarks)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.id]: {
                                ...current[row.id],
                                remarks: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      {(getOutcome(row.id, row.outcome) === "selected" || getOutcome(row.id, row.outcome) === "rejected") ? (
                        <Button
                          variant="secondary"
                          disabled={resendBusyId === row.id}
                          onClick={() => void onResend(row.id)}
                        >
                          {resendBusyId === row.id ? "Queueing..." : "Resend Result Email"}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </section>
  );
}
