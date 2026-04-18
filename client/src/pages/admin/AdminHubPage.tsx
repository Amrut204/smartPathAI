import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button, ConfirmActionModal, Input, Select, Table } from "../../components/ui";
import {
  adminCreateExternalResource,
  adminCreateCollege,
  adminCreateMockTestFromImport,
  adminCreateMockTest,
  adminCreateStudent,
  adminCreateStudentImportJob,
  adminDeleteStudent,
  adminCreateTpo,
  adminDownloadImportErrorReport,
  adminFetchImportJob,
  adminPreviewStudentCsv,
  adminPreviewStudentFile,
  adminPreviewMockTestImportFile,
  adminPublishMockTest,
  adminQueueImportCredentials,
  adminReleaseJob,
  adminResetStudentCredentials,
  adminSendStudentCredentials,
  adminUnlockStudentProfile,
  adminResetTpoCredentials,
  adminRetryJob,
  adminSaveEmailSettings,
  adminSaveIntegrations,
  adminSavePlacementPolicy,
  adminUpdateMockTest,
  adminUpdateMockTestFromImport,
  adminUpdateMockTestQuestions,
  adminUpdateResource,
  adminUpdateTpo,
  adminUploadResource,
  type AdminJobRow,
  type AdminMockQuestionImportPreview,
  useAdminEmailSettings,
  useAdminIntegrations,
  useAdminJobs,
  useAdminMockTestQuestions,
  useAdminMockTests,
  useAdminPlacementPolicy,
  useAdminResources,
  useAdminStudents,
  useAdminTenants,
  useAdminTpos,
  useAdminWorkspace,
  type StudentImportPreview,
} from "../../hooks/use-admin-ops";
import { useAdminResourceStorageBudget } from "../../hooks/use-resources";

const tabs = [
  { id: "students", label: "Students" },
  { id: "tpos", label: "TPOs" },
  { id: "mock-tests", label: "Mock Tests" },
  { id: "resources", label: "Resources" },
  { id: "storage", label: "Storage" },
  { id: "jobs", label: "Jobs" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof tabs)[number]["id"];
type ImportMappingState = NonNullable<StudentImportPreview["mapping"]>;
type StudentImportSeedPreviewRow = {
  rowNumber: number;
  fullName: string;
  email: string;
  prn: string;
  rollNumber: string;
  branch: string;
  batch: string;
  issues: string[];
};
const storageSections = [
  { id: "summary", label: "Summary" },
  { id: "history", label: "History" },
  { id: "aws-setup", label: "AWS Setup" },
] as const;
type StorageSectionId = (typeof storageSections)[number]["id"];

const importFields: Array<{ key: keyof ImportMappingState; label: string; required: boolean }> = [
  { key: "fullName", label: "Full name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "prn", label: "PRN", required: true },
  { key: "rollNumber", label: "Roll number", required: false },
  { key: "branch", label: "Branch", required: true },
  { key: "batch", label: "Batch", required: true },
];

function blankMapping(): ImportMappingState {
  return {
    fullName: "",
    email: "",
    rollNumber: "",
    branch: "",
    batch: "",
    prn: "",
  };
}

function blankMockTestForm(): {
  title: string;
  topicId: string;
  customTopicName: string;
  companyId: string;
  customCompanyName: string;
  durationSec: string;
  difficulty: string;
  isActive: boolean;
  audienceMode: "all" | "filtered";
  audienceBranches: string[];
  audienceBatches: string[];
  audienceYears: Array<"first_year" | "second_year" | "third_year" | "final_year">;
  questionsJson: string;
} {
  return {
    title: "",
    topicId: "",
    customTopicName: "",
    companyId: "",
    customCompanyName: "",
    durationSec: "3600",
    difficulty: "medium",
    isActive: false,
    audienceMode: "all",
    audienceBranches: [] as string[],
    audienceBatches: [] as string[],
    audienceYears: [] as Array<"first_year" | "second_year" | "third_year" | "final_year">,
    questionsJson: "[]",
  };
}

const CUSTOM_TOPIC_VALUE = "__custom_topic__";
const CUSTOM_COMPANY_VALUE = "__custom_company__";

const academicYearOptions: Array<{ value: "first_year" | "second_year" | "third_year" | "final_year"; label: string }> = [
  { value: "first_year", label: "First year" },
  { value: "second_year", label: "Second year" },
  { value: "third_year", label: "Third year" },
  { value: "final_year", label: "Final year" },
];

function isImportJob(job: AdminJobRow): job is Extract<AdminJobRow, { type: "student_import" }> {
  return (job as { type?: string }).type === "student_import";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleListValue<T extends string>(values: T[], value: T, checked: boolean) {
  if (checked) {
    return values.includes(value) ? values : [...values, value];
  }
  return values.filter((item) => item !== value);
}

function formatAcademicYearLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildAudienceSummary(input: {
  audienceMode: "all" | "filtered";
  audienceBranches: string[];
  audienceBatches: string[];
  audienceYears: string[];
}) {
  if (input.audienceMode !== "filtered") {
    return "All students";
  }

  const parts = [];
  if (input.audienceBranches.length > 0) parts.push(input.audienceBranches.join(", "));
  if (input.audienceBatches.length > 0) parts.push(input.audienceBatches.join(", "));
  if (input.audienceYears.length > 0) parts.push(input.audienceYears.map(formatAcademicYearLabel).join(", "));
  return parts.length > 0 ? parts.join(" | ") : "Choose at least one branch, year, or batch.";
}

function parseMockQuestionsJson(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Questions JSON is invalid. Check commas, quotes, and brackets, then try again.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Questions JSON must be an array of question objects.");
  }

  parsed.forEach((question, index) => {
    if (!question || typeof question !== "object") {
      throw new Error(`Question ${index + 1} must be an object.`);
    }
    const row = question as Record<string, unknown>;
    if (typeof row.text !== "string" || !row.text.trim()) {
      throw new Error(`Question ${index + 1} is missing text.`);
    }
    if (!Array.isArray(row.options) || row.options.length < 2) {
      throw new Error(`Question ${index + 1} needs at least 2 options.`);
    }
    if (!row.options.every((option) => typeof option === "string" && option.trim())) {
      throw new Error(`Question ${index + 1} has an empty option.`);
    }
    if (!Number.isInteger(row.correctIndex)) {
      throw new Error(`Question ${index + 1} needs a numeric correctIndex.`);
    }
  });

  return parsed as Array<{ text: string; options: string[]; correctIndex: number; explanation?: string; skillTag?: string }>;
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validateStudentForm(input: {
  fullName: string;
  email: string;
  prn: string;
  rollNumber?: string;
  branch: string;
  batch: string;
}) {
  if (!input.fullName.trim()) throw new Error("Enter the student's full name.");
  if (!input.email.trim()) throw new Error("Enter the student's email address.");
  if (!isValidEmail(input.email.trim())) throw new Error("Enter a valid student email address.");
  if (!input.prn.trim()) throw new Error("Enter the student's PRN.");
  if (!input.branch.trim() || input.branch.trim().length < 2) throw new Error("Enter a valid branch name.");
  if (!/^\d{4}$/.test(input.batch.trim())) throw new Error("Batch must be a 4-digit year like 2026.");
}

function validateTpoForm(input: { fullName: string; email: string }) {
  if (!input.fullName.trim()) throw new Error("Enter the TPO's full name.");
  if (!input.email.trim()) throw new Error("Enter the TPO email address.");
  if (!isValidEmail(input.email.trim())) throw new Error("Enter a valid TPO email address.");
}

function validateCollegeForm(input: {
  collegeName: string;
  tpoFullName: string;
  tpoEmail: string;
  tpoPassword: string;
  branchesText: string;
}) {
  if (!input.collegeName.trim()) throw new Error("Enter the college name.");
  validateTpoForm({ fullName: input.tpoFullName, email: input.tpoEmail });
  if (input.tpoPassword.trim().length < 8) throw new Error("TPO password must be at least 8 characters.");
  const branches = input.branchesText
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (branches.length === 0) throw new Error("Add at least one branch for the college.");
  return [...new Set(branches)];
}

export default function AdminHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = tabs.some((tab) => tab.id === requestedTab) ? (requestedTab as TabId) : "students";
  const tenants = useAdminTenants();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [activeStorageSection, setActiveStorageSection] = useState<StorageSectionId>("summary");
  const workspace = useAdminWorkspace(selectedTenantId);
  const students = useAdminStudents(activeTab === "students" ? selectedTenantId : null);
  const tpos = useAdminTpos(activeTab === "tpos" ? selectedTenantId : null);
  const tests = useAdminMockTests(activeTab === "mock-tests" ? selectedTenantId : null);
  const resources = useAdminResources(activeTab === "resources" ? selectedTenantId : null);
  const storageBudget = useAdminResourceStorageBudget(activeTab === "storage");
  const jobs = useAdminJobs(activeTab === "jobs" ? selectedTenantId : null);
  const integrations = useAdminIntegrations(activeTab === "settings" ? selectedTenantId : null);
  const emailSettings = useAdminEmailSettings(activeTab === "settings" ? selectedTenantId : null);
  const placementPolicy = useAdminPlacementPolicy(activeTab === "settings" ? selectedTenantId : null);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [csvText, setCsvText] = useState("");
  const [importPreview, setImportPreview] = useState<StudentImportPreview | null>(null);
  const [importMapping, setImportMapping] = useState<ImportMappingState>(blankMapping());
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);

  const [studentForm, setStudentForm] = useState({ fullName: "", email: "", prn: "", rollNumber: "", branch: "", batch: "2026" });
  const [tpoForm, setTpoForm] = useState({ fullName: "", email: "" });
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [mockTestForm, setMockTestForm] = useState(blankMockTestForm);
  const selectedMockTestQuestions = useAdminMockTestQuestions(activeTab === "mock-tests" ? selectedTenantId : null, activeTab === "mock-tests" ? selectedTestId : null);
  const [mockQuestionSource, setMockQuestionSource] = useState<"upload" | "json">("upload");
  const [mockQuestionImportFile, setMockQuestionImportFile] = useState<File | null>(null);
  const [mockQuestionImportPreview, setMockQuestionImportPreview] = useState<AdminMockQuestionImportPreview | null>(null);
  const [mockImportAppendMode, setMockImportAppendMode] = useState<"replace" | "append">("replace");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [resourceForm, setResourceForm] = useState({ title: "", description: "", topicId: "", resourceType: "pdf", url: "", isActive: true, branchRelevance: "", careerTracks: "", recommendedFor: "", contentPackLabels: "" });
  const [externalForm, setExternalForm] = useState({ title: "", description: "", topicId: "", resourceType: "external_link", url: "", isActive: true, branchRelevance: "", careerTracks: "", recommendedFor: "", contentPackLabels: "" });
  const [integrationForm, setIntegrationForm] = useState({
    googleForm: "",
    googleSheet: "",
    googleDriveSharedDriveId: "",
    googleDriveRootFolderId: "",
    label: "",
    notes: "",
  });
  const [emailForm, setEmailForm] = useState({ fromName: "", fromEmail: "", replyToEmail: "" });
  const [placementPolicyForm, setPlacementPolicyForm] = useState({ excludePlacedStudentsByDefault: false });
  const [collegeForm, setCollegeForm] = useState({
    collegeName: "",
    tpoFullName: "",
    tpoEmail: "",
    tpoPassword: "",
    branchesText: "",
  });
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  }>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("admin:selectedTenantId");
    if (stored) setSelectedTenantId(stored);
  }, []);

  useEffect(() => {
    if (!tenants.data?.length) return;
    if (selectedTenantId && tenants.data.some((tenant) => tenant.id === selectedTenantId)) return;
    const nextTenantId = tenants.data[0]?.id ?? null;
    setSelectedTenantId(nextTenantId);
  }, [selectedTenantId, tenants.data]);

  useEffect(() => {
    if (selectedTenantId) window.localStorage.setItem("admin:selectedTenantId", selectedTenantId);
  }, [selectedTenantId]);

  useEffect(() => {
    if (!requestedTab) return;
    if (!tabs.some((tab) => tab.id === requestedTab)) return;
    setActiveTab(requestedTab as TabId);
  }, [requestedTab]);

  useEffect(() => {
    if (!importPreview) return;
    const next = blankMapping();
    for (const field of importFields) next[field.key] = importPreview.mapping?.[field.key] ?? "";
    setImportMapping(next);
  }, [importPreview]);

  useEffect(() => {
    if (!integrations.data) return;
    setIntegrationForm({
      googleForm: integrations.data.googleForm ?? "",
      googleSheet: integrations.data.googleSheet ?? "",
      googleDriveSharedDriveId: integrations.data.googleDriveSharedDriveId ?? "",
      googleDriveRootFolderId: integrations.data.googleDriveRootFolderId ?? "",
      label: integrations.data.label ?? "",
      notes: integrations.data.notes ?? "",
    });
  }, [integrations.data]);

  useEffect(() => {
    if (!emailSettings.data) return;
    setEmailForm({
      fromName: emailSettings.data.fromName ?? "",
      fromEmail: emailSettings.data.fromEmail ?? "",
      replyToEmail: emailSettings.data.replyToEmail ?? "",
    });
  }, [emailSettings.data]);

  useEffect(() => {
    if (!placementPolicy.data) return;
    setPlacementPolicyForm({
      excludePlacedStudentsByDefault: placementPolicy.data.excludePlacedStudentsByDefault,
    });
  }, [placementPolicy.data]);

  useEffect(() => {
    if (!selectedTenantId || !selectedTestId || !tests.data) return;
    const selected = tests.data.find((item) => item.id === selectedTestId);
    if (!selected) return;
    setMockTestForm({
      title: selected.title,
      topicId: selected.topicId ?? "",
      customTopicName: "",
      companyId: selected.companyId ?? "",
      customCompanyName: "",
      durationSec: String(selected.durationSec),
      difficulty: selected.difficulty,
      isActive: selected.isActive,
      audienceMode: selected.audienceMode,
      audienceBranches: selected.audienceBranches,
      audienceBatches: selected.audienceBatches,
      audienceYears: (selected.audienceYears ?? []) as Array<"first_year" | "second_year" | "third_year" | "final_year">,
      questionsJson: selectedMockTestQuestions.data ? JSON.stringify(selectedMockTestQuestions.data, null, 2) : "[]",
    });
    setMockQuestionImportPreview(null);
    setMockQuestionImportFile(null);
    setMockImportAppendMode("replace");
  }, [selectedTenantId, selectedTestId, selectedMockTestQuestions.data, tests.data]);

  const latestImportJobs = useMemo(() => (jobs.data ?? []).filter(isImportJob), [jobs.data]);
  const latestCredentialJobs = useMemo(() => (jobs.data ?? []).filter((job) => !isImportJob(job)), [jobs.data]);
  const selectedTenantName = workspace.data?.tenant.name ?? "Selected college";
  const tenantOptions = tenants.data ?? [];
  const effectiveTenantId = selectedTenantId ?? tenantOptions[0]?.id ?? null;
  const effectiveTenant = tenantOptions.find((tenant) => tenant.id === effectiveTenantId) ?? null;
  const availableTopics = workspace.data?.referenceData.topics ?? [];
  const availableCompanies = workspace.data?.referenceData.companies ?? [];
  const availableBranches = workspace.data?.referenceData.branches ?? [];
  const availableBatches = workspace.data?.referenceData.batches ?? [];
  const isCustomTopic = mockTestForm.topicId === CUSTOM_TOPIC_VALUE;
  const isCustomCompany = mockTestForm.companyId === CUSTOM_COMPANY_VALUE;

  const previewStudents = useMemo<StudentImportSeedPreviewRow[]>(() => {
    if (!importPreview) return [];

    const getMappedValue = (row: Record<string, string>, key: keyof ImportMappingState) => {
      const mappedColumn = String(importMapping[key] ?? "").trim();
      if (!mappedColumn) return "";
      return String(row[mappedColumn] ?? "").trim();
    };

    return importPreview.rows
      .map((row, index) => {
        const fullName = getMappedValue(row, "fullName");
        const email = getMappedValue(row, "email");
        const prn = getMappedValue(row, "prn");
        const rollNumber = getMappedValue(row, "rollNumber");
        const branch = getMappedValue(row, "branch");
        const batch = getMappedValue(row, "batch");

        const hasAnyData = [fullName, email, prn, rollNumber, branch, batch].some(Boolean);
        if (!hasAnyData) {
          return null;
        }

        const issues: string[] = [];
        if (!fullName) issues.push("Full name missing");
        if (!email) {
          issues.push("Email missing");
        } else if (!isValidEmail(email)) {
          issues.push("Email format invalid");
        }
        if (!prn) issues.push("PRN missing");
        if (!branch) issues.push("Branch missing");
        if (!batch) {
          issues.push("Batch missing");
        } else if (!/^\d{4}$/.test(batch)) {
          issues.push("Batch must be 4 digits");
        }

        return {
          rowNumber: index + 2,
          fullName,
          email,
          prn,
          rollNumber,
          branch,
          batch,
          issues,
        };
      })
      .filter((item): item is StudentImportSeedPreviewRow => Boolean(item));
  }, [importPreview, importMapping]);

  const previewStudentsSummary = useMemo(() => {
    const totalRows = previewStudents.length;
    const validRows = previewStudents.filter((row) => row.issues.length === 0).length;
    return {
      totalRows,
      validRows,
      invalidRows: totalRows - validRows,
    };
  }, [previewStudents]);

  const setMessage = (message: string | null, kind: "success" | "error") => {
    if (kind === "success") {
      setStatusMessage(message);
      setErrorMessage(null);
      return;
    }
    setStatusMessage(null);
    setErrorMessage(message);
  };

  const requireTenant = () => {
    if (!selectedTenantId) throw new Error("Select a college before continuing.");
    return selectedTenantId;
  };

  const runAction = async (actionKey: string, work: () => Promise<void>) => {
    setBusyAction(actionKey);
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.", "error");
    } finally {
      setBusyAction(null);
    }
  };

  const waitForStudentImportCompletion = async (tenantId: string, jobId: string) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const latest = await adminFetchImportJob({ tenantId, jobId });
      if (latest.status === "completed" || latest.status === "failed") {
        return latest;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1500);
      });
    }

    throw new Error("Import is taking longer than expected. Check Jobs for live progress.");
  };

  const setTab = (tab: TabId) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  const openConfirmAction = (config: NonNullable<typeof confirmAction>) => {
    setConfirmAction(config);
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    const nextAction = confirmAction.onConfirm;
    setConfirmAction(null);
    await nextAction();
  };

  return (
    <section className="admin-ops-shell">
      <header className="admin-ops-header">
        <div>
          <h1>Admin Operations Hub</h1>
          <p className="muted-text">Global admin workspace. Every action below applies only to the selected college context.</p>
        </div>
        <label className="admin-ops-tenant-field">
          <span className="muted-text">College context</span>
          {tenants.isLoading ? (
            <div className="admin-ops-tenant-readonly">Loading colleges...</div>
          ) : tenants.error ? (
            <div className="admin-ops-tenant-readonly">Unable to load colleges</div>
          ) : tenantOptions.length <= 1 ? (
            <div className="admin-ops-tenant-readonly">{effectiveTenant?.name ?? "No college available"}</div>
          ) : (
            <Select value={effectiveTenantId ?? ""} onChange={(event) => setSelectedTenantId(event.target.value || null)}>
              <option value="">Select a college</option>
              {tenantOptions.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </Select>
          )}
        </label>
      </header>

      {statusMessage ? <p className="success-text">{statusMessage}</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      <div className="admin-ops-context-bar">
        {!selectedTenantId || workspace.isLoading ? <p className="muted-text">Select a college to load workspace details.</p> : workspace.error || !workspace.data ? <p className="error-text">Unable to load workspace.</p> : (
          <>
            <strong>{workspace.data.tenant.name}</strong>
            <span>Students {workspace.data.stats.students}</span>
            <span>TPOs {workspace.data.stats.tpos}</span>
            <span>Mock tests {workspace.data.stats.tests}</span>
            <span>Resources {workspace.data.stats.resources}</span>
            <span>Comms {workspace.data.stats.communications}</span>
            <span>Login URL {workspace.data.referenceData.loginUrl}</span>
          </>
        )}
      </div>

      <nav className="admin-ops-nav" aria-label="Admin sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === activeTab ? "admin-ops-nav-link is-active" : "admin-ops-nav-link"}
            onClick={() => setTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="admin-ops-content">
      {activeTab === "students" ? (
        <>
          <section className="admin-ops-section">
            <h2>Student Import</h2>
            <p className="muted-text">
              Use the same columns as single-student creation: <strong>full_name</strong>, <strong>email</strong>, <strong>prn</strong>, <strong>roll_number</strong>, <strong>branch</strong>, <strong>batch</strong>.
            </p>
            <p className="muted-text">
              Mandatory columns: <strong>full_name</strong>, <strong>email</strong>, <strong>prn</strong>, <strong>branch</strong>, <strong>batch</strong>. <strong>roll_number</strong> is optional.
            </p>
            <p className="muted-text">
              If a student email is wrong, the import can still complete but credential delivery may fail for that student.
              Re-import the corrected row (same PRN), then use <strong>Send Credentials</strong> (or <strong>Retry</strong> from Jobs).
            </p>
            <div className="hero-actions" style={{ marginBottom: 12 }}>
              <a href="/student-import-sample.csv" download className="ui-button ghost">Download Sample CSV</a>
            </div>
            <div className="form-grid">
              <label><span className="muted-text">Paste CSV</span><textarea className="ui-input" rows={8} value={csvText} onChange={(event) => setCsvText(event.target.value)} /></label>
              <label><span className="muted-text">Or upload file</span><input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => setSelectedImportFile(event.target.files?.[0] ?? null)} /></label>
            </div>
            <div className="hero-actions">
              <Button onClick={() => runAction("preview-csv", async () => {
                const tenantId = requireTenant();
                if (!csvText.trim()) throw new Error("Paste CSV content before previewing.");
                const preview = await adminPreviewStudentCsv({ tenantId, csv: csvText });
                setImportPreview(preview);
                setMessage("CSV preview loaded.", "success");
              })} disabled={busyAction === "preview-csv"}>Preview Pasted CSV</Button>
              <Button variant="secondary" onClick={() => runAction("preview-file", async () => {
                const tenantId = requireTenant();
                if (!selectedImportFile) throw new Error("Choose a file before previewing.");
                const preview = await adminPreviewStudentFile({ tenantId, file: selectedImportFile });
                setImportPreview(preview);
                setMessage(`Loaded ${preview.rows.length} rows from file preview.`, "success");
              })} disabled={busyAction === "preview-file"}>Upload File And Preview Students</Button>
            </div>
            {importPreview ? (
              <div style={{ marginTop: 16 }}>
                <p className="muted-text">Rows: {importPreview.rows.length}. Headers: {importPreview.headers.join(", ") || "-"}</p>
                <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                  {importFields.map((field) => (
                    <label key={field.key}><span className="muted-text">{field.label}{field.required ? " *" : ""}</span><Select value={importMapping[field.key] ?? ""} onChange={(event) => setImportMapping((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">{field.required ? "Select column" : "Ignore"}</option>{importPreview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</Select></label>
                  ))}
                </div>

                <div className="workspace-panel" style={{ marginTop: 16 }}>
                  <h3>Preview Students To Be Seeded</h3>
                  <p className="muted-text">
                    Total preview rows: {previewStudentsSummary.totalRows}. Ready: {previewStudentsSummary.validRows}. Needs fixes: {previewStudentsSummary.invalidRows}.
                  </p>

                  {importPreview.errors.length > 0 ? (
                    <>
                      <p className="error-text">Fix the import preview errors below before confirming.</p>
                      <ul className="dashboard-bullet-list">
                        {importPreview.errors.slice(0, 10).map((error) => (
                          <li key={`${error.row}:${error.message}`}>Row {error.row}: {error.message}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {previewStudents.length > 0 ? (
                    <div className="tpo-ranking-table-wrap">
                      <Table>
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>PRN</th>
                            <th>Roll No.</th>
                            <th>Branch</th>
                            <th>Batch</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewStudents.slice(0, 25).map((row) => (
                            <tr key={`${row.rowNumber}:${row.email}:${row.prn}`}>
                              <td>{row.rowNumber}</td>
                              <td>{row.fullName || "-"}</td>
                              <td>{row.email || "-"}</td>
                              <td>{row.prn || "-"}</td>
                              <td>{row.rollNumber || "-"}</td>
                              <td>{row.branch || "-"}</td>
                              <td>{row.batch || "-"}</td>
                              <td>{row.issues.length === 0 ? <span className="success-text">Ready</span> : <span className="error-text">{row.issues.join("; ")}</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  ) : (
                    <p className="muted-text">No mapped rows to preview yet.</p>
                  )}

                  {previewStudents.length > 25 ? <p className="muted-text">Showing first 25 rows. Upload still includes all rows.</p> : null}
                </div>

                <div className="hero-actions" style={{ marginTop: 16 }}>
                  <Button onClick={() => openConfirmAction({
                    title: "Confirm student import",
                    message: `Import ${previewStudentsSummary.validRows} ready row(s) into ${selectedTenantName}? Credentials for newly created students will be queued automatically after import completes.`,
                    confirmLabel: "Confirm import",
                    onConfirm: async () => runAction("import-job", async () => {
                      const tenantId = requireTenant();
                      for (const field of importFields.filter((item) => item.required)) if (!importMapping[field.key]) throw new Error(`Map the ${field.label} column before starting the import.`);
                      if (importPreview.errors.length > 0) throw new Error("Fix preview errors before confirming import.");
                      if (previewStudentsSummary.totalRows === 0) throw new Error("No student rows found in preview.");
                      if (previewStudentsSummary.invalidRows > 0) throw new Error(`Fix ${previewStudentsSummary.invalidRows} invalid preview row(s) before confirming import.`);

                      const job = await adminCreateStudentImportJob({ tenantId, mapping: importMapping, rows: importPreview.rows });
                      setMessage(`Import job ${job.id} started. Waiting for completion...`, "success");

                      const completedImport = await waitForStudentImportCompletion(tenantId, job.id);
                      if (completedImport.status !== "completed") {
                        throw new Error(completedImport.errorMessage ?? `Import job ${job.id} failed.`);
                      }

                      let credentialStatus = "No new students were created, so no credentials were queued.";
                      const createdCount = completedImport.createdStudentIds?.length ?? 0;
                      if (createdCount > 0) {
                        const credentialJob = await adminQueueImportCredentials({ tenantId, importJobId: job.id });
                        credentialStatus = `Credential job ${credentialJob.id} queued automatically for ${createdCount} new student(s).`;
                      }

                      await students.mutate();
                      await jobs.mutate();
                      await workspace.mutate();

                      setMessage(
                        `Import completed. Created ${completedImport.totals.created}, updated ${completedImport.totals.updated}, skipped ${completedImport.totals.skipped}. ${credentialStatus}`,
                        "success",
                      );

                      setImportPreview(null);
                      setImportMapping(blankMapping());
                      setSelectedImportFile(null);
                      setCsvText("");
                    }),
                  })} disabled={busyAction === "import-job"}>Confirm Import And Auto Send Credentials</Button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="admin-ops-section">
            <h2>Create Single Student</h2>
            <div className="form-grid">
              <label><span className="muted-text">Full name</span><Input value={studentForm.fullName} onChange={(event) => setStudentForm((current) => ({ ...current, fullName: event.target.value }))} /></label>
              <label><span className="muted-text">Email</span><Input value={studentForm.email} onChange={(event) => setStudentForm((current) => ({ ...current, email: event.target.value }))} /></label>
              <label><span className="muted-text">PRN</span><Input value={studentForm.prn} onChange={(event) => setStudentForm((current) => ({ ...current, prn: event.target.value }))} /></label>
              <label><span className="muted-text">Roll number (optional)</span><Input value={studentForm.rollNumber} onChange={(event) => setStudentForm((current) => ({ ...current, rollNumber: event.target.value }))} /></label>
              <label><span className="muted-text">Branch</span><Input value={studentForm.branch} onChange={(event) => setStudentForm((current) => ({ ...current, branch: event.target.value }))} /></label>
              <label><span className="muted-text">Batch</span><Input value={studentForm.batch} onChange={(event) => setStudentForm((current) => ({ ...current, batch: event.target.value }))} /></label>
            </div>
            <div className="hero-actions">
              <Button onClick={() => runAction("create-student", async () => {
                const tenantId = requireTenant();
                validateStudentForm(studentForm);
                const created = await adminCreateStudent({ tenantId, ...studentForm });
                setMessage(`Created ${created.student.fullName}. Credential job ${created.credentialJob.id} is ready. Use Send Credentials from the student row or Jobs tab.`, "success");
                setStudentForm((current) => ({ ...current, fullName: "", email: "", prn: "", rollNumber: "", branch: "" }));
              })} disabled={busyAction === "create-student"}>Create Student</Button>
            </div>
          </section>

          <section className="admin-ops-section admin-ops-section-table">
            <h2>Students</h2>
            {!selectedTenantId || students.isLoading ? <p className="muted-text">Loading students...</p> : students.error || !students.data ? <p className="error-text">Unable to load students.</p> : (
              <div className="tpo-ranking-table-wrap">
                <Table>
                  <thead><tr><th>Name</th><th>Email</th><th>Branch</th><th>Batch</th><th>CGPA</th><th>Profile</th><th>Action</th></tr></thead>
                  <tbody>
                    {students.data.items.map((student) => (
                      <tr key={student.id}>
                        <td>
                          {student.fullName}
                          <br />
                          <span className="muted-text">PRN: {student.prn || "-"}</span>
                          {student.rollNumber ? <><br /><span className="muted-text">Roll: {student.rollNumber}</span></> : null}
                        </td>
                        <td>{student.email}</td>
                        <td>{student.branch}</td>
                        <td>{student.batch}</td>
                        <td>{student.cgpa}</td>
                        <td>{student.profileCompletenessPct}%</td>
                        <td>
                          <div className="hero-actions">
                            <Button variant="secondary" onClick={() => runAction(`send-${student.id}`, async () => {
                              const tenantId = requireTenant();
                              const job = await adminSendStudentCredentials({ tenantId, studentId: student.id });
                              setMessage(`Credential send queued for ${student.fullName}. Job ${job.id}.`, "success");
                            })} disabled={busyAction === `send-${student.id}`}>
                              {student.pendingCredentialJobId ? "Send Credentials" : "Send Again"}
                            </Button>
                            <Button variant="ghost" onClick={() => runAction(`reset-${student.id}`, async () => {
                              const tenantId = requireTenant();
                              const job = await adminResetStudentCredentials({ tenantId, studentId: student.id });
                              setMessage(`Credential reset queued for ${student.fullName}. Job ${job.id}.`, "success");
                            })} disabled={busyAction === `reset-${student.id}`}>Reset Credentials</Button>
                            {student.isProfileLocked ? (
                              <Button variant="ghost" onClick={() => runAction(`unlock-${student.id}`, async () => {
                                const tenantId = requireTenant();
                                await adminUnlockStudentProfile({ tenantId, studentId: student.id });
                                setMessage(`${student.fullName}'s profile is unlocked for corrections.`, "success");
                              })} disabled={busyAction === `unlock-${student.id}`}>Unlock Profile</Button>
                            ) : null}
                            <Button variant="ghost" onClick={() => runAction(`delete-${student.id}`, async () => {
                              const tenantId = requireTenant();
                              if (!window.confirm(`Delete ${student.fullName} from this college? This removes the student account and linked student activity data.`)) {
                                return;
                              }
                              await adminDeleteStudent({ tenantId, studentId: student.id });
                              setMessage(`${student.fullName} deleted.`, "success");
                            })} disabled={busyAction === `delete-${student.id}`}>Delete Student</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {activeTab === "mock-tests" ? (
        <>
          <section className="admin-ops-section">
            <div className="hero-actions" style={{ justifyContent: "space-between" }}>
              <h2>{selectedTestId ? "Edit Tenant Mock Test" : "Create Tenant Mock Test"}</h2>
              {selectedTestId ? <Button variant="ghost" onClick={() => {
                setSelectedTestId(null);
                setMockTestForm(blankMockTestForm());
                setMockQuestionSource("upload");
                setMockQuestionImportFile(null);
                setMockQuestionImportPreview(null);
                setMockImportAppendMode("replace");
              }}>Create New</Button> : null}
            </div>
            <div className="form-grid">
              <label><span className="muted-text">Title</span><Input value={mockTestForm.title} onChange={(event) => setMockTestForm((current) => ({ ...current, title: event.target.value }))} /></label>
              <label>
                <span className="muted-text">Topic</span>
                <Select value={mockTestForm.topicId} onChange={(event) => setMockTestForm((current) => ({
                  ...current,
                  topicId: event.target.value,
                  customTopicName: event.target.value === CUSTOM_TOPIC_VALUE ? current.customTopicName : "",
                }))}>
                  <option value="">Select topic</option>
                  {availableTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
                  <option value={CUSTOM_TOPIC_VALUE}>Custom topic</option>
                </Select>
                {isCustomTopic ? (
                  <Input
                    value={mockTestForm.customTopicName}
                    onChange={(event) => setMockTestForm((current) => ({ ...current, customTopicName: event.target.value }))}
                    placeholder="Enter a new topic name"
                    style={{ marginTop: 8 }}
                  />
                ) : null}
              </label>
              <label>
                <span className="muted-text">Company</span>
                <Select value={mockTestForm.companyId} onChange={(event) => setMockTestForm((current) => ({
                  ...current,
                  companyId: event.target.value,
                  customCompanyName: event.target.value === CUSTOM_COMPANY_VALUE ? current.customCompanyName : "",
                }))}>
                  <option value="">Select company</option>
                  {availableCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                  <option value={CUSTOM_COMPANY_VALUE}>Custom company</option>
                </Select>
                {isCustomCompany ? (
                  <Input
                    value={mockTestForm.customCompanyName}
                    onChange={(event) => setMockTestForm((current) => ({ ...current, customCompanyName: event.target.value }))}
                    placeholder="Enter a new company name"
                    style={{ marginTop: 8 }}
                  />
                ) : null}
              </label>
              <label><span className="muted-text">Duration (seconds)</span><Input value={mockTestForm.durationSec} onChange={(event) => setMockTestForm((current) => ({ ...current, durationSec: event.target.value }))} /></label>
              <label><span className="muted-text">Difficulty</span><Select value={mockTestForm.difficulty} onChange={(event) => setMockTestForm((current) => ({ ...current, difficulty: event.target.value }))}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></Select></label>
              <label><span className="muted-text">Status</span><Select value={String(mockTestForm.isActive)} onChange={(event) => setMockTestForm((current) => ({ ...current, isActive: event.target.value === "true" }))}><option value="false">Draft</option><option value="true">Published</option></Select></label>
            </div>
            <div className="form-grid" style={{ marginTop: 16 }}>
              <label>
                <span className="muted-text">Audience</span>
                <Select
                  value={mockTestForm.audienceMode}
                  onChange={(event) => setMockTestForm((current) => ({
                    ...current,
                    audienceMode: event.target.value as "all" | "filtered",
                    audienceBranches: event.target.value === "all" ? [] : current.audienceBranches,
                    audienceBatches: event.target.value === "all" ? [] : current.audienceBatches,
                    audienceYears: event.target.value === "all" ? [] : current.audienceYears,
                  }))}
                >
                  <option value="all">All students</option>
                  <option value="filtered">Filtered audience</option>
                </Select>
              </label>
              <label>
                <span className="muted-text">Question source</span>
                <Select value={mockQuestionSource} onChange={(event) => setMockQuestionSource(event.target.value as "upload" | "json")}>
                  <option value="upload">Upload Excel/CSV</option>
                  <option value="json">Paste JSON</option>
                </Select>
              </label>
              {selectedTestId && mockQuestionSource === "upload" ? (
                <label>
                  <span className="muted-text">Import mode</span>
                  <Select value={mockImportAppendMode} onChange={(event) => setMockImportAppendMode(event.target.value as "replace" | "append")}>
                    <option value="replace">Replace questions</option>
                    <option value="append">Append questions</option>
                  </Select>
                </label>
              ) : null}
            </div>
            {mockTestForm.audienceMode === "filtered" ? (
              <div style={{ marginTop: 16 }}>
                <div className="form-grid">
                  <div className="workspace-panel">
                    <span className="muted-text">Branches</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                      {availableBranches.map((branch) => (
                        <label key={branch} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={mockTestForm.audienceBranches.includes(branch)}
                            onChange={(event) => setMockTestForm((current) => ({
                              ...current,
                              audienceBranches: toggleListValue(current.audienceBranches, branch, event.target.checked),
                            }))}
                          />
                          <span>{branch}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="workspace-panel">
                    <span className="muted-text">Batch / year</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                      {availableBatches.map((batch) => (
                        <label key={batch} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={mockTestForm.audienceBatches.includes(batch)}
                            onChange={(event) => setMockTestForm((current) => ({
                              ...current,
                              audienceBatches: toggleListValue(current.audienceBatches, batch, event.target.checked),
                            }))}
                          />
                          <span>{batch}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="workspace-panel" style={{ marginTop: 16 }}>
                  <span className="muted-text">Academic year</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                    {academicYearOptions.map((year) => (
                      <label key={year.value} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={mockTestForm.audienceYears.includes(year.value)}
                          onChange={(event) => setMockTestForm((current) => ({
                            ...current,
                            audienceYears: toggleListValue(current.audienceYears, year.value, event.target.checked),
                          }))}
                        />
                        <span>{year.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="workspace-panel" style={{ marginTop: 16 }}>
                  <p className="muted-text">Audience summary: {buildAudienceSummary(mockTestForm)}</p>
                </div>
              </div>
            ) : (
              <p className="muted-text" style={{ marginTop: 16 }}>This mock test will be visible to every student in the selected college.</p>
            )}
            {mockQuestionSource === "upload" ? (
              <div style={{ marginTop: 16 }}>
                <div className="form-grid">
                  <label>
                    <span className="muted-text">Upload question sheet</span>
                    <input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => setMockQuestionImportFile(event.target.files?.[0] ?? null)} />
                  </label>
                </div>
                <p className="muted-text">Expected columns: text, option_1, option_2, option_3, option_4, correct_index, explanation, skill_tag</p>
                <div className="hero-actions" style={{ marginTop: 12 }}>
                  <Button variant="secondary" onClick={() => runAction("preview-mock-import", async () => {
                    const tenantId = requireTenant();
                    if (!mockQuestionImportFile) throw new Error("Choose a .csv, .xlsx, or .xls file before previewing.");
                    const preview = await adminPreviewMockTestImportFile({ tenantId, file: mockQuestionImportFile });
                    setMockQuestionImportPreview(preview);
                    setMessage(`Question sheet preview ready. ${preview.validRows} valid row(s), ${preview.rejectedRows} rejected.`, "success");
                  })} disabled={busyAction === "preview-mock-import"}>Preview Question Sheet</Button>
                </div>
                {mockQuestionImportPreview ? (
                  <div className="workspace-panel" style={{ marginTop: 16 }}>
                    <p className="muted-text">
                      Rows: {mockQuestionImportPreview.totalRows}. Valid: {mockQuestionImportPreview.validRows}. Rejected: {mockQuestionImportPreview.rejectedRows}.
                    </p>
                    {mockQuestionImportPreview.errors.length > 0 ? (
                      <ul className="dashboard-bullet-list">
                        {mockQuestionImportPreview.errors.slice(0, 8).map((error) => <li key={`${error.row}:${error.message}`}>Row {error.row}: {error.message}</li>)}
                      </ul>
                    ) : (
                      <p className="success-text">All imported rows are valid.</p>
                    )}
                  </div>
                ) : null}
                <details style={{ marginTop: 16 }}>
                  <summary>Paste JSON instead</summary>
                  <label>
                    <span className="muted-text">Questions JSON</span>
                    <textarea className="ui-input" rows={10} value={mockTestForm.questionsJson} onChange={(event) => setMockTestForm((current) => ({ ...current, questionsJson: event.target.value }))} placeholder='[{"text":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"...","skillTag":"Time and Work"}]' />
                  </label>
                  <p className="muted-text">If the JSON is malformed or a question is missing text, options, or correctIndex, save will stop with a clear error before anything is created.</p>
                </details>
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <label style={{ display: "block" }}>
                  <span className="muted-text">Questions JSON</span>
                  <textarea className="ui-input" rows={10} value={mockTestForm.questionsJson} onChange={(event) => setMockTestForm((current) => ({ ...current, questionsJson: event.target.value }))} placeholder='[{"text":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"...","skillTag":"Time and Work"}]' />
                </label>
                <p className="muted-text" style={{ marginTop: 8 }}>Save validates the JSON before sending it. If there is a syntax issue or a broken question row, the form will stop and show a clear error.</p>
              </div>
            )}
            <div className="hero-actions" style={{ marginTop: 16 }}>
              <Button onClick={() => runAction("create-mock", async () => {
                const tenantId = requireTenant();
                const topicId = isCustomTopic ? undefined : (mockTestForm.topicId || undefined);
                const companyId = isCustomCompany ? undefined : (mockTestForm.companyId || undefined);
                const customTopicName = isCustomTopic ? mockTestForm.customTopicName.trim() : undefined;
                const customCompanyName = isCustomCompany ? mockTestForm.customCompanyName.trim() : undefined;
                if (mockQuestionSource === "upload") {
                  if (!mockQuestionImportPreview) throw new Error("Preview the question sheet before saving this mock test.");
                  if (mockQuestionImportPreview.validRows === 0 || mockQuestionImportPreview.rejectedRows > 0) {
                    throw new Error("Fix the rejected rows in the question sheet before saving.");
                  }
                  if (!selectedTestId) {
                    await adminCreateMockTestFromImport({
                      tenantId,
                      title: mockTestForm.title,
                      topicId,
                      customTopicName,
                      companyId,
                      customCompanyName,
                      durationSec: Number(mockTestForm.durationSec),
                      difficulty: mockTestForm.difficulty as "easy" | "medium" | "hard",
                      isActive: mockTestForm.isActive,
                      audienceMode: mockTestForm.audienceMode as "all" | "filtered",
                      audienceBranches: mockTestForm.audienceBranches,
                      audienceBatches: mockTestForm.audienceBatches,
                      audienceYears: mockTestForm.audienceYears,
                      rows: mockQuestionImportPreview.rows,
                    });
                    setMessage("Mock test created from uploaded question sheet.", "success");
                  } else {
                    await adminUpdateMockTest({
                      tenantId,
                      testId: selectedTestId,
                      title: mockTestForm.title,
                      topicId,
                      customTopicName,
                      companyId,
                      customCompanyName,
                      durationSec: Number(mockTestForm.durationSec),
                      difficulty: mockTestForm.difficulty as "easy" | "medium" | "hard",
                      isActive: mockTestForm.isActive,
                      audienceMode: mockTestForm.audienceMode as "all" | "filtered",
                      audienceBranches: mockTestForm.audienceBranches,
                      audienceBatches: mockTestForm.audienceBatches,
                      audienceYears: mockTestForm.audienceYears,
                    });
                    await adminUpdateMockTestFromImport({
                      tenantId,
                      testId: selectedTestId,
                      append: mockImportAppendMode === "append",
                      rows: mockQuestionImportPreview.rows,
                    });
                    setMessage("Mock test updated from uploaded question sheet.", "success");
                  }
                } else {
                  const questions = parseMockQuestionsJson(mockTestForm.questionsJson);
                  if (!selectedTestId) {
                    await adminCreateMockTest({
                      tenantId,
                      title: mockTestForm.title,
                      topicId,
                      customTopicName,
                      companyId,
                      customCompanyName,
                      durationSec: Number(mockTestForm.durationSec),
                      difficulty: mockTestForm.difficulty as "easy" | "medium" | "hard",
                      isActive: mockTestForm.isActive,
                      audienceMode: mockTestForm.audienceMode as "all" | "filtered",
                      audienceBranches: mockTestForm.audienceBranches,
                      audienceBatches: mockTestForm.audienceBatches,
                      audienceYears: mockTestForm.audienceYears,
                      questions,
                    });
                    setMessage("Mock test created.", "success");
                  } else {
                    await adminUpdateMockTest({
                      tenantId,
                      testId: selectedTestId,
                      title: mockTestForm.title,
                      topicId,
                      customTopicName,
                      companyId,
                      customCompanyName,
                      durationSec: Number(mockTestForm.durationSec),
                      difficulty: mockTestForm.difficulty as "easy" | "medium" | "hard",
                      isActive: mockTestForm.isActive,
                      audienceMode: mockTestForm.audienceMode as "all" | "filtered",
                      audienceBranches: mockTestForm.audienceBranches,
                      audienceBatches: mockTestForm.audienceBatches,
                      audienceYears: mockTestForm.audienceYears,
                    });
                    await adminUpdateMockTestQuestions({ tenantId, testId: selectedTestId, append: false, questions });
                    setMessage("Mock test updated.", "success");
                  }
                }
                setMockTestForm(blankMockTestForm());
                setSelectedTestId(null);
                setMockQuestionSource("upload");
                setMockQuestionImportFile(null);
                setMockQuestionImportPreview(null);
                setMockImportAppendMode("replace");
              })} disabled={busyAction === "create-mock"}>{selectedTestId ? "Save Mock Test" : "Create Mock Test"}</Button>
            </div>
          </section>

          <section className="admin-ops-section admin-ops-section-table">
            <h2>Mock Test Catalog</h2>
            {!selectedTenantId || tests.isLoading ? <p className="muted-text">Loading mock tests...</p> : tests.error || !tests.data ? <p className="error-text">Unable to load mock tests.</p> : (
              <div className="tpo-ranking-table-wrap">
                <Table>
                  <thead><tr><th>Title</th><th>Topic</th><th>Difficulty</th><th>Audience</th><th>Source</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {tests.data.map((test) => (
                      <tr key={test.id}>
                        <td>{test.title}</td>
                        <td>{test.topicName ?? "-"}</td>
                        <td>{test.difficulty}</td>
                        <td>{test.audienceSummary}</td>
                        <td>{test.source}</td>
                        <td>{test.isActive ? "Published" : "Draft"}</td>
                        <td>
                          <div className="hero-actions">
                            <Button variant="secondary" disabled={test.source !== "tenant"} onClick={() => setSelectedTestId(test.id)}>Edit</Button>
                            <Button variant="ghost" disabled={test.source !== "tenant"} onClick={() => runAction(`publish-${test.id}`, async () => {
                              const tenantId = requireTenant();
                              await adminPublishMockTest({ tenantId, testId: test.id, isActive: !test.isActive });
                              setMessage(`${test.title} ${test.isActive ? "unpublished" : "published"}.`, "success");
                            })}>{test.isActive ? "Unpublish" : "Publish"}</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </section>
        </>
      ) : null}
      {activeTab === "tpos" ? (
        <>
          <section className="admin-ops-section">
            <h2>Create TPO Account</h2>
            <div className="form-grid">
              <label><span className="muted-text">Full name</span><Input value={tpoForm.fullName} onChange={(event) => setTpoForm((current) => ({ ...current, fullName: event.target.value }))} /></label>
              <label><span className="muted-text">Email</span><Input value={tpoForm.email} onChange={(event) => setTpoForm((current) => ({ ...current, email: event.target.value }))} /></label>
            </div>
            <div className="hero-actions">
              <Button onClick={() => runAction("create-tpo", async () => {
                const tenantId = requireTenant();
                validateTpoForm(tpoForm);
                const created = await adminCreateTpo({ tenantId, ...tpoForm });
                setMessage(`Created TPO ${created.tpo.fullName}. Credential job ${created.credentialJob.id} queued.`, "success");
                setTpoForm({ fullName: "", email: "" });
              })} disabled={busyAction === "create-tpo"}>Create TPO And Queue Credentials</Button>
            </div>
          </section>

          <section className="admin-ops-section admin-ops-section-table">
            <h2>TPO Accounts</h2>
            {!selectedTenantId || tpos.isLoading ? <p className="muted-text">Loading TPO accounts...</p> : tpos.error || !tpos.data ? <p className="error-text">Unable to load TPO accounts.</p> : (
              <div className="tpo-ranking-table-wrap">
                <Table>
                  <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Last password issue</th><th>Action</th></tr></thead>
                  <tbody>
                    {tpos.data.map((tpo) => (
                      <tr key={tpo.id}>
                        <td>{tpo.fullName}</td>
                        <td>{tpo.email}</td>
                        <td>{tpo.isActive ? "Active" : "Inactive"}</td>
                        <td>{formatDateTime(tpo.lastPasswordIssuedAt)}</td>
                        <td>
                          <div className="hero-actions">
                            <Button variant="secondary" onClick={() => runAction(`reset-tpo-${tpo.id}`, async () => {
                              const tenantId = requireTenant();
                              const job = await adminResetTpoCredentials({ tenantId, userId: tpo.id });
                              setMessage(`Credential reset queued for ${tpo.fullName}. Job ${job.id}.`, "success");
                            })} disabled={busyAction === `reset-tpo-${tpo.id}`}>Reset Credentials</Button>
                            <Button variant="ghost" onClick={() => runAction(`toggle-tpo-${tpo.id}`, async () => {
                              const tenantId = requireTenant();
                              await adminUpdateTpo({ tenantId, userId: tpo.id, isActive: !tpo.isActive });
                              setMessage(`${tpo.fullName} ${tpo.isActive ? "deactivated" : "activated"}.`, "success");
                            })} disabled={busyAction === `toggle-tpo-${tpo.id}`}>
                              {tpo.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </section>
        </>
      ) : null}
      {activeTab === "resources" ? (
        <>
          <section className="admin-ops-section">
            <h2>Upload File Resource To S3</h2>
            <div className="form-grid">
              <label><span className="muted-text">Title</span><Input value={resourceForm.title} onChange={(event) => setResourceForm((current) => ({ ...current, title: event.target.value }))} /></label>
              <label><span className="muted-text">Resource type</span><Input value={resourceForm.resourceType} onChange={(event) => setResourceForm((current) => ({ ...current, resourceType: event.target.value }))} /></label>
              <label><span className="muted-text">Topic</span><Select value={resourceForm.topicId} onChange={(event) => setResourceForm((current) => ({ ...current, topicId: event.target.value }))}><option value="">Select topic</option>{(workspace.data?.referenceData.topics ?? []).map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</Select></label>
              <label><span className="muted-text">File</span><input type="file" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label>
              <label style={{ gridColumn: "1 / -1" }}><span className="muted-text">Description</span><textarea className="ui-input" rows={3} value={resourceForm.description} onChange={(event) => setResourceForm((current) => ({ ...current, description: event.target.value }))} /></label>
              <label><span className="muted-text">Branch relevance</span><Input value={resourceForm.branchRelevance} onChange={(event) => setResourceForm((current) => ({ ...current, branchRelevance: event.target.value }))} placeholder="Mechanical, Civil, ECE" /></label>
              <label><span className="muted-text">Career tracks</span><Input value={resourceForm.careerTracks} onChange={(event) => setResourceForm((current) => ({ ...current, careerTracks: event.target.value }))} placeholder="Graduate Engineer Trainee, Analyst" /></label>
              <label><span className="muted-text">Recommended for</span><Input value={resourceForm.recommendedFor} onChange={(event) => setResourceForm((current) => ({ ...current, recommendedFor: event.target.value }))} placeholder="Interview revision, aptitude prep" /></label>
              <label><span className="muted-text">Pack labels</span><Input value={resourceForm.contentPackLabels} onChange={(event) => setResourceForm((current) => ({ ...current, contentPackLabels: event.target.value }))} placeholder="Mechanical Core Concepts Pack" /></label>
            </div>
            <div className="hero-actions"><Button onClick={() => runAction("upload-resource", async () => {
              const tenantId = requireTenant();
              if (!uploadFile) throw new Error("Choose a file before uploading.");
              await adminUploadResource({
                tenantId,
                title: resourceForm.title,
                description: resourceForm.description,
                topicId: resourceForm.topicId || null,
                resourceType: resourceForm.resourceType,
                file: uploadFile,
                isActive: resourceForm.isActive,
                branchRelevance: splitCsv(resourceForm.branchRelevance),
                careerTracks: splitCsv(resourceForm.careerTracks),
                recommendedFor: splitCsv(resourceForm.recommendedFor),
                contentPackLabels: splitCsv(resourceForm.contentPackLabels),
              });
              setMessage("Resource uploaded to S3 and registered.", "success");
              setResourceForm({ title: "", description: "", topicId: "", resourceType: "pdf", url: "", isActive: true, branchRelevance: "", careerTracks: "", recommendedFor: "", contentPackLabels: "" });
              setUploadFile(null);
            })} disabled={busyAction === "upload-resource"}>Upload Resource</Button></div>
          </section>

          <section className="admin-ops-section">
            <h2>Create External Resource</h2>
            <div className="form-grid">
              <label><span className="muted-text">Title</span><Input value={externalForm.title} onChange={(event) => setExternalForm((current) => ({ ...current, title: event.target.value }))} /></label>
              <label><span className="muted-text">URL</span><Input value={externalForm.url} onChange={(event) => setExternalForm((current) => ({ ...current, url: event.target.value }))} /></label>
              <label><span className="muted-text">Topic</span><Select value={externalForm.topicId} onChange={(event) => setExternalForm((current) => ({ ...current, topicId: event.target.value }))}><option value="">Select topic</option>{(workspace.data?.referenceData.topics ?? []).map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</Select></label>
              <label style={{ gridColumn: "1 / -1" }}><span className="muted-text">Description</span><textarea className="ui-input" rows={3} value={externalForm.description} onChange={(event) => setExternalForm((current) => ({ ...current, description: event.target.value }))} /></label>
              <label><span className="muted-text">Branch relevance</span><Input value={externalForm.branchRelevance} onChange={(event) => setExternalForm((current) => ({ ...current, branchRelevance: event.target.value }))} placeholder="Mechanical, Civil, ECE" /></label>
              <label><span className="muted-text">Career tracks</span><Input value={externalForm.careerTracks} onChange={(event) => setExternalForm((current) => ({ ...current, careerTracks: event.target.value }))} placeholder="Graduate Engineer Trainee, Analyst" /></label>
              <label><span className="muted-text">Recommended for</span><Input value={externalForm.recommendedFor} onChange={(event) => setExternalForm((current) => ({ ...current, recommendedFor: event.target.value }))} placeholder="Interview revision, aptitude prep" /></label>
              <label><span className="muted-text">Pack labels</span><Input value={externalForm.contentPackLabels} onChange={(event) => setExternalForm((current) => ({ ...current, contentPackLabels: event.target.value }))} placeholder="Civil Interview Quick Revision" /></label>
            </div>
            <div className="hero-actions"><Button onClick={() => runAction("external-resource", async () => {
              const tenantId = requireTenant();
              await adminCreateExternalResource({
                tenantId,
                title: externalForm.title,
                description: externalForm.description,
                url: externalForm.url,
                resourceType: externalForm.resourceType,
                topicId: externalForm.topicId || null,
                isActive: externalForm.isActive,
                branchRelevance: splitCsv(externalForm.branchRelevance),
                careerTracks: splitCsv(externalForm.careerTracks),
                recommendedFor: splitCsv(externalForm.recommendedFor),
                contentPackLabels: splitCsv(externalForm.contentPackLabels),
              });
              setMessage("External resource added.", "success");
              setExternalForm({ title: "", description: "", topicId: "", resourceType: "external_link", url: "", isActive: true, branchRelevance: "", careerTracks: "", recommendedFor: "", contentPackLabels: "" });
            })} disabled={busyAction === "external-resource"}>Save External Resource</Button></div>
          </section>

          <section className="admin-ops-section admin-ops-section-table">
            <h2>Tenant Resources</h2>
            {!selectedTenantId || resources.isLoading ? <p className="muted-text">Loading resources...</p> : resources.error || !resources.data ? <p className="error-text">Unable to load resources.</p> : (
              <div className="tpo-ranking-table-wrap">
                <Table>
                  <thead><tr><th>Title</th><th>Type</th><th>Topic</th><th>Branch Relevance</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {resources.data.map((resource) => (
                      <tr key={resource.id}>
                        <td>{resource.title}</td>
                        <td>{resource.resourceType}</td>
                        <td>{resource.topicName ?? "-"}</td>
                        <td>{resource.branchRelevance.length > 0 ? resource.branchRelevance.join(", ") : "Common"}</td>
                        <td>{resource.isActive ? "Published" : "Archived"}</td>
                        <td>
                          <Button variant="ghost" onClick={() => runAction(`resource-${resource.id}`, async () => {
                            const tenantId = requireTenant();
                            await adminUpdateResource({ tenantId, resourceId: resource.id, isActive: !resource.isActive });
                            setMessage(`${resource.title} ${resource.isActive ? "archived" : "published"}.`, "success");
                          })} disabled={busyAction === `resource-${resource.id}`}>
                            {resource.isActive ? "Archive" : "Publish"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {activeTab === "storage" ? (
        <section className="admin-ops-section">
          <div className="workspace-panel-header">
            <div>
              <h2>Storage Guardrails</h2>
              <p className="muted-text">These AWS and S3 cost controls belong to admin operations, not the TPO workflow.</p>
            </div>
          </div>

          <nav className="workspace-subnav" aria-label="Storage sections">
            {storageSections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={section.id === activeStorageSection ? "workspace-subnav-link is-active" : "workspace-subnav-link"}
                onClick={() => setActiveStorageSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          {storageBudget.isLoading ? <p className="muted-text">Loading storage guardrails...</p> : null}
          {storageBudget.error || !storageBudget.data ? <p className="error-text">Unable to load storage guardrails.</p> : null}

          {storageBudget.data && activeStorageSection === "summary" ? (
            <div className="workspace-panel">
              <div className="workspace-metrics-grid">
                <div className="workspace-metric">
                  <span>Current period</span>
                  <strong>{storageBudget.data.status.periodKey}</strong>
                </div>
                <div className="workspace-metric">
                  <span>Overall status</span>
                  <strong>{storageBudget.data.status.overallStatus.toUpperCase()}</strong>
                </div>
                <div className="workspace-metric">
                  <span>Read requests</span>
                  <strong>{storageBudget.data.status.requests.used.toLocaleString()} / {storageBudget.data.status.requests.limit.toLocaleString()}</strong>
                </div>
                <div className="workspace-metric">
                  <span>Transfer usage</span>
                  <strong>{storageBudget.data.status.transfer.displayUsed}</strong>
                </div>
              </div>

              <div className="workspace-split-grid">
                <div className="workspace-block">
                  <h3>Current guardrails</h3>
                  <ul className="dashboard-bullet-list">
                    <li>Monthly S3 read cap: {storageBudget.data.config.requestLimit.toLocaleString()} requests</li>
                    <li>Monthly S3 transfer cap: {storageBudget.data.config.transferLimitDisplay}</li>
                    <li>Read warning threshold: {formatPercent(storageBudget.data.config.requestWarningPct)}</li>
                    <li>Transfer warning threshold: {formatPercent(storageBudget.data.config.transferWarningPct)}</li>
                    <li>Applied only to cloud-hosted resource opens routed through the app.</li>
                  </ul>
                </div>

                <div className="workspace-block">
                  <h3>Current month usage</h3>
                  <ul className="dashboard-bullet-list">
                    <li>Read requests used: {storageBudget.data.status.requests.used.toLocaleString()}</li>
                    <li>Read requests remaining: {storageBudget.data.status.requests.remaining.toLocaleString()}</li>
                    <li>Transfer used: {storageBudget.data.status.transfer.displayUsed}</li>
                    <li>Transfer remaining: {storageBudget.data.status.transfer.displayRemaining}</li>
                  </ul>
                  {storageBudget.data.status.message ? <p className="muted-text">{storageBudget.data.status.message}</p> : null}
                </div>
              </div>
            </div>
          ) : null}

          {storageBudget.data && activeStorageSection === "history" ? (
            <div className="workspace-panel">
              <h3>Recent history</h3>
              {storageBudget.data.history.length === 0 ? (
                <p className="muted-text">No monthly cloud usage history has been recorded yet.</p>
              ) : (
                <div className="workspace-table-wrap">
                  <table className="workspace-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Status</th>
                        <th>Read Requests</th>
                        <th>Transfer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storageBudget.data.history.map((item) => (
                        <tr key={item.periodKey}>
                          <td>{item.periodKey}</td>
                          <td>{item.status.toUpperCase()}</td>
                          <td>{item.requestCount.toLocaleString()}</td>
                          <td>{item.transferDisplay}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {storageBudget.data && activeStorageSection === "aws-setup" ? (
            <div className="workspace-panel">
              <div className="workspace-block">
                <h3>AWS-side alarms</h3>
                <p className="muted-text">
                  The in-app cap is already active. Use these server-side budget files if you also want AWS to warn you outside the app.
                </p>
                <ul className="dashboard-bullet-list">
                  <li>Budget guide: <code>server/aws/budgets/README.md</code></li>
                  <li>Generator script: <code>server/scripts/generate-aws-budget-files.mjs</code></li>
                  <li>Generated output folder: <code>server/storage_reports/aws-budgets</code></li>
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "jobs" ? (
        <section className="admin-ops-section admin-ops-section-table">
          <h2>Recent Jobs</h2>
          {!selectedTenantId || jobs.isLoading ? <p className="muted-text">Loading jobs...</p> : jobs.error || !jobs.data ? <p className="error-text">Unable to load job history.</p> : jobs.data.length === 0 ? <p className="muted-text">No jobs yet for this college.</p> : (
            <div className="tpo-ranking-table-wrap">
              <Table>
                <thead><tr><th>Type</th><th>Status</th><th>Created</th><th>Progress</th><th>Action</th></tr></thead>
                <tbody>
                  {jobs.data.map((job) => {
                    const progressLabel = isImportJob(job) ? `${job.totals.processedRows}/${job.totals.totalRows}` : `${job.progress?.processed ?? 0}/${job.progress?.total ?? 0}`;
                    return (
                      <tr key={job.id}>
                        <td>{isImportJob(job) ? "student_import" : job.type}</td>
                        <td>{job.status}</td>
                        <td>{formatDateTime(job.createdAt)}</td>
                        <td>{progressLabel}</td>
                        <td>
                          <div className="hero-actions">
                            {isImportJob(job) && job.status === "completed" && (job.createdStudentIds?.length ?? 0) > 0 ? <Button variant="secondary" onClick={() => openConfirmAction({
                              title: "Send imported student credentials",
                              message: `You are about to queue credential emails for ${(job.createdStudentIds?.length ?? 0)} imported student(s).`,
                              confirmLabel: "Queue credentials",
                              onConfirm: async () => runAction(`credentials-${job.id}`, async () => {
                                const tenantId = requireTenant();
                                const queued = await adminQueueImportCredentials({ tenantId, importJobId: job.id });
                                setMessage(`Credential batch ${queued.id} queued for import ${job.id}.`, "success");
                              }),
                            })}>Send Credentials</Button> : null}
                            {isImportJob(job) && job.errorCsvAvailable ? <Button variant="ghost" onClick={() => runAction(`download-${job.id}`, async () => {
                              const tenantId = requireTenant();
                              const csv = await adminDownloadImportErrorReport({ tenantId, jobId: job.id });
                              downloadText(`student-import-${job.id}-errors.csv`, csv);
                              setMessage("Import error report downloaded.", "success");
                            })}>Errors CSV</Button> : null}
                            {!isImportJob(job) && job.status === "ready" ? <Button variant="secondary" onClick={() => openConfirmAction({
                              title: "Release credential batch",
                              message: "You are about to release this credential job for delivery.",
                              confirmLabel: "Release batch",
                              onConfirm: async () => runAction(`release-${job.id}`, async () => {
                                const tenantId = requireTenant();
                                const released = await adminReleaseJob({ tenantId, jobId: job.id });
                                setMessage(`Credential job ${released.id} queued for sending.`, "success");
                              }),
                            })}>Send Credentials</Button> : null}
                            {!isImportJob(job) && (job.status === "failed" || job.status === "partial") ? <Button variant="ghost" onClick={() => runAction(`retry-${job.id}`, async () => {
                              const tenantId = requireTenant();
                              const retried = await adminRetryJob({ tenantId, jobId: job.id });
                              setMessage(`Retry job ${retried.id} queued.`, "success");
                            })}>Retry</Button> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
          {latestImportJobs.length > 0 ? <p className="muted-text">Newest import job: {latestImportJobs[0]?.id} ({latestImportJobs[0]?.status}).</p> : null}
          {latestCredentialJobs.length > 0 ? <p className="muted-text">Newest credential batch: {latestCredentialJobs[0]?.id} ({latestCredentialJobs[0]?.status}).</p> : null}
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <>
          <section className="admin-ops-section">
            <h2>Add College</h2>
            <div className="form-grid">
              <label><span className="muted-text">College name</span><Input value={collegeForm.collegeName} onChange={(event) => setCollegeForm((current) => ({ ...current, collegeName: event.target.value }))} /></label>
              <label><span className="muted-text">First TPO full name</span><Input value={collegeForm.tpoFullName} onChange={(event) => setCollegeForm((current) => ({ ...current, tpoFullName: event.target.value }))} /></label>
              <label><span className="muted-text">TPO email</span><Input value={collegeForm.tpoEmail} onChange={(event) => setCollegeForm((current) => ({ ...current, tpoEmail: event.target.value }))} /></label>
              <label><span className="muted-text">Manual password</span><Input type="password" value={collegeForm.tpoPassword} onChange={(event) => setCollegeForm((current) => ({ ...current, tpoPassword: event.target.value }))} /></label>
              <label style={{ gridColumn: "1 / -1" }}><span className="muted-text">Branches (comma separated)</span><Input value={collegeForm.branchesText} onChange={(event) => setCollegeForm((current) => ({ ...current, branchesText: event.target.value }))} placeholder="CSE, CST, AIML, E&TC" /></label>
            </div>
            <div className="hero-actions"><Button onClick={() => runAction("create-college", async () => {
              const branches = validateCollegeForm(collegeForm);
              const created = await adminCreateCollege({
                collegeName: collegeForm.collegeName.trim(),
                tpoFullName: collegeForm.tpoFullName.trim(),
                tpoEmail: collegeForm.tpoEmail.trim(),
                tpoPassword: collegeForm.tpoPassword,
                branches,
              });
              setSelectedTenantId(created.tenant.id);
              setCollegeForm({ collegeName: "", tpoFullName: "", tpoEmail: "", tpoPassword: "", branchesText: "" });
              setMessage(`Created ${created.tenant.name} and sent the first TPO credentials to ${created.tpo.email}.`, "success");
            })} disabled={busyAction === "create-college"}>Create College</Button></div>
          </section>

          <section className="admin-ops-section">
            <h2>Email Settings</h2>
            <div className="form-grid">
              <label><span className="muted-text">From name</span><Input value={emailForm.fromName} onChange={(event) => setEmailForm((current) => ({ ...current, fromName: event.target.value }))} /></label>
              <label><span className="muted-text">From email</span><Input value={emailForm.fromEmail} onChange={(event) => setEmailForm((current) => ({ ...current, fromEmail: event.target.value }))} /></label>
              <label><span className="muted-text">Reply-to email</span><Input value={emailForm.replyToEmail} onChange={(event) => setEmailForm((current) => ({ ...current, replyToEmail: event.target.value }))} /></label>
            </div>
            <div className="hero-actions"><Button onClick={() => runAction("email-settings", async () => {
              const tenantId = requireTenant();
              await adminSaveEmailSettings({ tenantId, fromName: emailForm.fromName || null, fromEmail: emailForm.fromEmail || null, replyToEmail: emailForm.replyToEmail || null });
              setMessage(`Email settings saved for ${selectedTenantName}.`, "success");
            })} disabled={busyAction === "email-settings"}>Save Email Settings</Button></div>
          </section>

          <section className="admin-ops-section">
            <h2>Placement Policy</h2>
            <div className="form-grid">
              <label>
                <span className="muted-text">Placed student participation</span>
                <Select
                  value={placementPolicyForm.excludePlacedStudentsByDefault ? "blocked" : "allowed"}
                  onChange={(event) => setPlacementPolicyForm({
                    excludePlacedStudentsByDefault: event.target.value === "blocked",
                  })}
                >
                  <option value="allowed">Allow placed students unless a drive blocks them</option>
                  <option value="blocked">Block placed students by default</option>
                </Select>
              </label>
              <div style={{ gridColumn: "1 / -1" }}>
                <p className="muted-text">
                  This is the tenant-wide default. Individual drives can still explicitly exclude already placed students when required.
                </p>
              </div>
            </div>
            <div className="hero-actions"><Button onClick={() => runAction("placement-policy", async () => {
              const tenantId = requireTenant();
              await adminSavePlacementPolicy({
                tenantId,
                excludePlacedStudentsByDefault: placementPolicyForm.excludePlacedStudentsByDefault,
              });
              setMessage(`Placement policy saved for ${selectedTenantName}.`, "success");
            })} disabled={busyAction === "placement-policy"}>Save Placement Policy</Button></div>
          </section>

          <section className="admin-ops-section">
            <h2>Integrations</h2>
            <div className="form-grid">
              <label><span className="muted-text">Label</span><Input value={integrationForm.label} onChange={(event) => setIntegrationForm((current) => ({ ...current, label: event.target.value }))} /></label>
              <label><span className="muted-text">Google Form URL</span><Input value={integrationForm.googleForm} onChange={(event) => setIntegrationForm((current) => ({ ...current, googleForm: event.target.value }))} /></label>
              <label><span className="muted-text">Google Sheet URL</span><Input value={integrationForm.googleSheet} onChange={(event) => setIntegrationForm((current) => ({ ...current, googleSheet: event.target.value }))} /></label>
              <label><span className="muted-text">Resume Shared Drive ID (optional)</span><Input value={integrationForm.googleDriveSharedDriveId} onChange={(event) => setIntegrationForm((current) => ({ ...current, googleDriveSharedDriveId: event.target.value }))} placeholder="Leave blank if using a normal Drive folder" /></label>
              <label><span className="muted-text">Resume root folder ID</span><Input value={integrationForm.googleDriveRootFolderId} onChange={(event) => setIntegrationForm((current) => ({ ...current, googleDriveRootFolderId: event.target.value }))} placeholder="Folder ID in your managed Google Drive storage" /></label>
              <label style={{ gridColumn: "1 / -1" }}><span className="muted-text">Drive auth mode</span><Input value={integrations.data?.googleDriveServiceAccountEmail ?? ""} readOnly /></label>
              <label style={{ gridColumn: "1 / -1" }}><span className="muted-text">Notes</span><textarea className="ui-input" rows={3} value={integrationForm.notes} onChange={(event) => setIntegrationForm((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <p className="muted-text">Use Smart Path-managed Google Drive storage by setting the root folder ID above. A Shared Drive is optional; a normal Drive folder also works when OAuth-based Drive access is configured on the server.</p>
            <div className="hero-actions"><Button onClick={() => runAction("integrations", async () => {
              const tenantId = requireTenant();
              await adminSaveIntegrations({
                tenantId,
                googleForm: integrationForm.googleForm || null,
                googleSheet: integrationForm.googleSheet || null,
                googleDriveSharedDriveId: integrationForm.googleDriveSharedDriveId || null,
                googleDriveRootFolderId: integrationForm.googleDriveRootFolderId || null,
                label: integrationForm.label || null,
                notes: integrationForm.notes || null,
              });
              setMessage(`Integration links saved for ${selectedTenantName}.`, "success");
            })} disabled={busyAction === "integrations"}>Save Integrations</Button></div>
          </section>
        </>
      ) : null}
      </div>

      <ConfirmActionModal
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void runConfirmedAction()}
        busy={Boolean(confirmAction && busyAction)}
        title={confirmAction?.title ?? "Confirm admin action"}
        message={confirmAction?.message ?? "Confirm this admin action."}
        confirmLabel={confirmAction?.confirmLabel ?? "Confirm"}
      />
    </section>
  );
}
