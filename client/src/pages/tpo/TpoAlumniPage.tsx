import { useMemo, useState } from "react";

import { TpoActionMenu } from "../../components/composites/TpoActionMenu";
import { TpoSubviewSwitcher } from "../../components/composites/TpoSubviewSwitcher";
import { TpoWorkspaceHeader } from "../../components/composites/TpoWorkspaceHeader";
import { useAuth } from "../../components/providers/AuthProvider";
import { Badge, Button, Card, Input, Select, Spinner } from "../../components/ui";
import { getTpoGreeting } from "../../config/tpo-workspace";
import { useDrives } from "../../hooks/use-drives";
import {
  createAlumniContact,
  createAlumniOpportunity,
  type AlumniAcademicYear,
  type AlumniOpportunityStatus,
  type AlumniOpportunityType,
  type AlumniVerificationStatus,
  updateAlumniContact,
  updateAlumniOpportunity,
  useAlumniContacts,
  useAlumniOpportunities,
} from "../../hooks/use-alumni";

type AlumniView = "directory" | "referral" | "hiring_lead" | "mentorship_session" | "alumni_talk";

const academicYearOptions: Array<{ value: AlumniAcademicYear; label: string }> = [
  { value: "first_year", label: "First year" },
  { value: "second_year", label: "Second year" },
  { value: "third_year", label: "Third year" },
  { value: "final_year", label: "Final year" },
];

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

export default function TpoAlumniPage() {
  const { profile } = useAuth();
  const greeting = getTpoGreeting(profile?.full_name ?? "Placement team");
  const [activeView, setActiveView] = useState<AlumniView>("directory");
  const [contactName, setContactName] = useState("");
  const [contactBranch, setContactBranch] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<AlumniVerificationStatus>("pending");
  const [canRefer, setCanRefer] = useState(false);
  const [canMentor, setCanMentor] = useState(false);
  const [isHiring, setIsHiring] = useState(false);
  const [opportunityTitle, setOpportunityTitle] = useState("");
  const [opportunityDescription, setOpportunityDescription] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [selectedDriveId, setSelectedDriveId] = useState("");
  const [opportunityBranches, setOpportunityBranches] = useState("");
  const [opportunityBatches, setOpportunityBatches] = useState("");
  const [opportunityNotes, setOpportunityNotes] = useState("");
  const [opportunityStatus, setOpportunityStatus] = useState<AlumniOpportunityStatus>("draft");
  const [opportunityYears, setOpportunityYears] = useState<AlumniAcademicYear[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const contacts = useAlumniContacts();
  const opportunities = useAlumniOpportunities({
    type: activeView === "directory" ? undefined : activeView,
  });
  const { data: drives } = useDrives();

  const visibleOpportunities = useMemo(() => {
    const items = opportunities.data ?? [];
    if (activeView === "directory") return items;
    return items.filter((item) => item.type === activeView);
  }, [activeView, opportunities.data]);

  const submitContact = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await createAlumniContact({
        fullName: contactName,
        branch: contactBranch,
        graduationYear,
        company,
        role,
        location,
        linkedinUrl,
        email,
        phone,
        canRefer,
        canMentor,
        isHiring,
        notes,
        verificationStatus,
      });
      setContactName("");
      setContactBranch("");
      setGraduationYear("");
      setCompany("");
      setRole("");
      setLocation("");
      setLinkedinUrl("");
      setEmail("");
      setPhone("");
      setNotes("");
      setCanRefer(false);
      setCanMentor(false);
      setIsHiring(false);
      setVerificationStatus("pending");
      setStatusMessage("Alumni contact added.");
    } catch (submitError) {
      setStatusMessage(submitError instanceof Error ? submitError.message : "Unable to add alumni contact right now.");
    } finally {
      setBusy(false);
    }
  };

  const submitOpportunity = async (type: AlumniOpportunityType) => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await createAlumniOpportunity({
        type,
        title: opportunityTitle,
        description: opportunityDescription,
        alumniContactId: selectedContactId,
        branches: opportunityBranches.split(",").map((value) => value.trim()).filter(Boolean),
        batches: opportunityBatches.split(",").map((value) => value.trim()).filter(Boolean),
        academicYears: opportunityYears,
        driveId: selectedDriveId || undefined,
        status: opportunityStatus,
        studentIds: [],
        notes: opportunityNotes,
      });
      setOpportunityTitle("");
      setOpportunityDescription("");
      setSelectedDriveId("");
      setOpportunityBranches("");
      setOpportunityBatches("");
      setOpportunityNotes("");
      setOpportunityStatus("draft");
      setOpportunityYears([]);
      setStatusMessage("Alumni opportunity created.");
    } catch (submitError) {
      setStatusMessage(submitError instanceof Error ? submitError.message : "Unable to create alumni opportunity right now.");
    } finally {
      setBusy(false);
    }
  };

  const toggleAcademicYear = (year: AlumniAcademicYear) => {
    setOpportunityYears((current) => current.includes(year)
      ? current.filter((item) => item !== year)
      : [...current, year]);
  };

  return (
    <section className="tpo-dashboard control-center-page">
      <TpoWorkspaceHeader
        eyebrow="Alumni Connect"
        greeting={greeting}
        title="Manage alumni as a placement extension, not a social feed."
        description="Store alumni who can refer, mentor, or hire. Then publish only the structured opportunities that belong in the placement funnel."
        primaryAction={(
          <Button onClick={() => setActiveView("directory")}>Add alumni contact</Button>
        )}
        actionMenu={(
          <TpoActionMenu
            items={[
              { label: "Alumni directory", onSelect: () => setActiveView("directory") },
              { label: "Referral opportunities", onSelect: () => setActiveView("referral") },
              { label: "Hiring leads", onSelect: () => setActiveView("hiring_lead") },
              { label: "Mentorship sessions", onSelect: () => setActiveView("mentorship_session") },
              { label: "Alumni talks", onSelect: () => setActiveView("alumni_talk") },
            ]}
          />
        )}
      />

      <TpoSubviewSwitcher
        label="Alumni connect views"
        items={[
          { id: "directory", label: "Alumni Directory" },
          { id: "referral", label: "Referral Opportunities" },
          { id: "hiring_lead", label: "Hiring Leads" },
          { id: "mentorship_session", label: "Mentorship Sessions" },
          { id: "alumni_talk", label: "Alumni Talks" },
        ]}
        activeId={activeView}
        onChange={(next) => setActiveView(next as AlumniView)}
      />

      {activeView === "directory" ? (
        <Card className="tpo-single-pane-card">
          <div className="tpo-inline-section-head">
            <div>
              <p className="workspace-eyebrow">Alumni directory</p>
              <h2>Add trusted alumni contacts</h2>
              <p className="muted-text">Keep this directory operational: who can refer, who can mentor, and who is actively hiring.</p>
            </div>
          </div>
          <div className="student-profile-field-grid">
            <label>
              Full name
              <Input value={contactName} onChange={(event) => setContactName(event.target.value)} />
            </label>
            <label>
              Branch
              <Input value={contactBranch} onChange={(event) => setContactBranch(event.target.value)} />
            </label>
            <label>
              Graduation year
              <Input value={graduationYear} onChange={(event) => setGraduationYear(event.target.value)} placeholder="2021" />
            </label>
            <label>
              Company
              <Input value={company} onChange={(event) => setCompany(event.target.value)} />
            </label>
            <label>
              Role
              <Input value={role} onChange={(event) => setRole(event.target.value)} />
            </label>
            <label>
              Location
              <Input value={location} onChange={(event) => setLocation(event.target.value)} />
            </label>
            <label>
              LinkedIn URL
              <Input value={linkedinUrl} onChange={(event) => setLinkedinUrl(event.target.value)} />
            </label>
            <label>
              Email
              <Input value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Phone
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            <label>
              Verification
              <Select value={verificationStatus} onChange={(event) => setVerificationStatus(event.target.value as AlumniVerificationStatus)}>
                <option value="pending">Pending</option>
                <option value="verified">Verified</option>
                <option value="unverified">Unverified</option>
              </Select>
            </label>
            <label className="tpo-communication-full">
              Notes
              <textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </div>
          <div className="student-workspace-inline-note">
            <label><input type="checkbox" checked={canRefer} onChange={(event) => setCanRefer(event.target.checked)} /> Can refer</label>
            <label><input type="checkbox" checked={canMentor} onChange={(event) => setCanMentor(event.target.checked)} /> Can mentor</label>
            <label><input type="checkbox" checked={isHiring} onChange={(event) => setIsHiring(event.target.checked)} /> Hiring now</label>
          </div>
          <div className="hero-actions">
            <Button
              onClick={() => void submitContact()}
              disabled={busy || contactName.trim().length < 2 || contactBranch.trim().length < 2 || graduationYear.trim().length !== 4 || company.trim().length < 2 || role.trim().length < 2}
            >
              {busy ? "Saving..." : "Save alumni contact"}
            </Button>
          </div>

          <div className="tpo-inline-section">
            <div className="tpo-inline-section-head">
              <div>
                <h3>Directory</h3>
                <p className="muted-text">Use the directory as the source of truth for referrals and hiring leads.</p>
              </div>
            </div>
            {contacts.isLoading ? (
              <div className="app-state-card"><Spinner /><p className="muted-text">Loading alumni contacts...</p></div>
            ) : contacts.error ? (
              <Card className="app-state-card app-state-card-error">
                <h3>Unable to load alumni contacts</h3>
                <p>{contacts.error instanceof Error ? contacts.error.message : "Unknown error"}</p>
              </Card>
            ) : !contacts.data || contacts.data.length === 0 ? (
              <p className="muted-text">No alumni contacts yet.</p>
            ) : (
              <div className="student-workspace-list">
                {contacts.data.map((contact) => (
                  <div key={contact.id} className="student-workspace-row">
                    <div>
                      <strong>{contact.fullName}</strong>
                      <p>{contact.company} • {contact.role} • {contact.branch} • {contact.graduationYear}</p>
                      <p className="muted-text">{contact.email ?? "No email"} {contact.location ? `• ${contact.location}` : ""}</p>
                      {contact.notes ? <p className="muted-text">{contact.notes}</p> : null}
                    </div>
                    <div className="student-announcement-row-meta">
                      <Badge variant={contact.verificationStatus === "verified" ? "success" : "warning"}>{contact.verificationStatus}</Badge>
                      <TpoActionMenu
                        items={[
                          { label: "Mark verified", onSelect: () => void updateAlumniContact(contact.id, { verificationStatus: "verified" }) },
                          { label: "Mark can refer", onSelect: () => void updateAlumniContact(contact.id, { canRefer: true }) },
                          { label: "Mark hiring now", onSelect: () => void updateAlumniContact(contact.id, { isHiring: true }) },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card className="tpo-single-pane-card">
          <div className="tpo-inline-section-head">
            <div>
              <p className="workspace-eyebrow">{formatLabel(activeView)}</p>
              <h2>Publish one curated alumni opportunity at a time</h2>
              <p className="muted-text">Students should only see the targeted opportunity, not the full alumni directory.</p>
            </div>
          </div>
          <div className="student-profile-field-grid">
            <label>
              Opportunity title
              <Input value={opportunityTitle} onChange={(event) => setOpportunityTitle(event.target.value)} />
            </label>
            <label>
              Alumni contact
              <Select value={selectedContactId} onChange={(event) => setSelectedContactId(event.target.value)}>
                <option value="">Select contact</option>
                {(contacts.data ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>{contact.fullName} • {contact.company}</option>
                ))}
              </Select>
            </label>
            <label>
              Linked drive
              <Select value={selectedDriveId} onChange={(event) => setSelectedDriveId(event.target.value)}>
                <option value="">No linked drive</option>
                {(drives?.items ?? []).map((drive) => (
                  <option key={drive.id} value={drive.id}>{drive.company}{drive.role ? ` - ${drive.role}` : ""}</option>
                ))}
              </Select>
            </label>
            <label>
              Branches
              <Input value={opportunityBranches} onChange={(event) => setOpportunityBranches(event.target.value)} placeholder="CSE, CST" />
            </label>
            <label>
              Batches
              <Input value={opportunityBatches} onChange={(event) => setOpportunityBatches(event.target.value)} placeholder="2026, 2027" />
            </label>
            <label>
              Status
              <Select value={opportunityStatus} onChange={(event) => setOpportunityStatus(event.target.value as AlumniOpportunityStatus)}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="archived">Archived</option>
              </Select>
            </label>
            <label className="tpo-communication-full">
              Description
              <textarea rows={5} value={opportunityDescription} onChange={(event) => setOpportunityDescription(event.target.value)} />
            </label>
            <label className="tpo-communication-full">
              Notes
              <textarea rows={4} value={opportunityNotes} onChange={(event) => setOpportunityNotes(event.target.value)} />
            </label>
          </div>
          <div className="student-workspace-inline-note">
            {academicYearOptions.map((year) => (
              <label key={year.value}>
                <input
                  type="checkbox"
                  checked={opportunityYears.includes(year.value)}
                  onChange={() => toggleAcademicYear(year.value)}
                />
                {year.label}
              </label>
            ))}
          </div>
          <div className="hero-actions">
            <Button
              onClick={() => void submitOpportunity(activeView)}
              disabled={busy || !selectedContactId || opportunityTitle.trim().length < 3 || opportunityDescription.trim().length < 10}
            >
              {busy ? "Saving..." : "Save opportunity"}
            </Button>
          </div>

          <div className="tpo-inline-section">
            <div className="tpo-inline-section-head">
              <div>
                <h3>{formatLabel(activeView)} queue</h3>
                <p className="muted-text">These are the curated alumni-linked opportunities currently stored for placement workflows.</p>
              </div>
            </div>
            {opportunities.isLoading ? (
              <div className="app-state-card"><Spinner /><p className="muted-text">Loading alumni opportunities...</p></div>
            ) : opportunities.error ? (
              <Card className="app-state-card app-state-card-error">
                <h3>Unable to load alumni opportunities</h3>
                <p>{opportunities.error instanceof Error ? opportunities.error.message : "Unknown error"}</p>
              </Card>
            ) : visibleOpportunities.length === 0 ? (
              <p className="muted-text">No opportunities in this view yet.</p>
            ) : (
              <div className="student-workspace-list">
                {visibleOpportunities.map((opportunity) => (
                  <div key={opportunity.id} className="student-workspace-row">
                    <div>
                      <strong>{opportunity.title}</strong>
                      <p>{formatLabel(opportunity.type)} • {opportunity.alumniContact?.fullName ?? "Unknown alumni"} • {opportunity.alumniContact?.company ?? "-"}</p>
                      <p className="muted-text">{opportunity.description}</p>
                      <p className="muted-text">
                        {opportunity.branches.length > 0 ? `Branches: ${opportunity.branches.join(", ")}` : "All branches"}
                        {" • "}
                        {opportunity.academicYears.length > 0 ? `Years: ${opportunity.academicYears.map(formatLabel).join(", ")}` : "All years"}
                      </p>
                    </div>
                    <div className="student-announcement-row-meta">
                      <Badge variant={opportunity.status === "active" ? "success" : opportunity.status === "draft" ? "warning" : "default"}>
                        {opportunity.status}
                      </Badge>
                      <TpoActionMenu
                        items={[
                          { label: "Mark active", onSelect: () => void updateAlumniOpportunity(opportunity.id, { status: "active" }) },
                          { label: "Mark closed", onSelect: () => void updateAlumniOpportunity(opportunity.id, { status: "closed" }) },
                          { label: "Archive", onSelect: () => void updateAlumniOpportunity(opportunity.id, { status: "archived" }) },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {statusMessage ? <p className="muted-text">{statusMessage}</p> : null}
    </section>
  );
}
