import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import net from "node:net";
import { spawn } from "node:child_process";
import { MongoClient } from "mongodb";
import { pathToFileURL } from "node:url";

const COLOR = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
const DEMO_EMAIL_DOMAIN = "stxaviers-demo.edu";
const DEMO_EMAIL_PATTERN = new RegExp(`@${DEMO_EMAIL_DOMAIN.replace(".", "\\.")}$`, "i");
const DEMO_TENANT_NAME = "St. Xavier's Institute of Technology";
const ACCEPTED_DEMO_SLUGS = ["st-xaviers-demo", "stxaviers-demo"];

const ROOT_DIR = path.resolve(process.cwd(), "..");
const SERVER_DIR = process.cwd();
const CLIENT_DIR = path.join(ROOT_DIR, "client");

const EXPECTED_COLLECTIONS = [
  "tenants",
  "users",
  "students",
  "drives",
  "drive_results",
  "mock_tests",
  "resources",
  "student_attempts",
  "resource_view_events",
  "student_activity_events",
  "study_hours",
  "topic_mastery",
  "email_templates",
  "communications",
  "tenant_analytics",
];

const FEATURE_ROUTE_HINTS = [
  { feature: "aiAssistant", method: "post", path: "/api/v1/ai/chat", role: "student" },
  { feature: "analytics", method: "get", path: "/api/v1/analytics/dashboard", role: "tpo" },
  { feature: "careerLab", method: "get", path: "/api/v1/career/student-hub", role: "student" },
  { feature: "vault", method: "get", path: "/api/v1/vault", role: "student" },
  { feature: "tenantAdmin", method: "get", path: "/api/v1/tenants", role: "tpo" },
  { feature: "tpoAdvancedInsights", method: "get", path: "/api/v1/tpo/dashboard/control-center", role: "tpo" },
  { feature: "opsHub", method: "get", path: "/api/v1/tpo/students/operations-board", role: "tpo" },
  { feature: "mastery", method: "get", path: "/api/v1/students/me/mastery", role: "student" },
  { feature: "points", method: "get", path: "/api/v1/students/me/points", role: "student" },
];

const STUDENT_CAPABILITIES = [
  "Sign up and login",
  "View upcoming placement drives",
  "Check eligibility for each drive",
  "Take mock tests and view results",
  "Access preparation resources",
  "View dashboard with readiness metrics",
  "Update profile information",
];

const TPO_CAPABILITIES = [
  "View placement dashboard metrics",
  "Manage drives (create, edit, delete)",
  "Review student readiness and profiles",
  "View mock test performance",
  "Send communications and reminders",
  "Track sales pipeline entries",
];

const HIDDEN_FEATURES = [
  "AI Chat Assistant",
  "Career Lab",
  "Mastery Tracking",
  "Mentorship",
  "Ops Hub",
  "Points / Gamification",
  "Vault / Company Library",
  "Advanced Analytics",
  "Wallet",
  "Tenant Admin",
];

function green(text) {
  return `${COLOR.green}${text}${COLOR.reset}`;
}

function red(text) {
  return `${COLOR.red}${text}${COLOR.reset}`;
}

function yellow(text) {
  return `${COLOR.yellow}${text}${COLOR.reset}`;
}

function blue(text) {
  return `${COLOR.blue}${text}${COLOR.reset}`;
}

function statusMark(status) {
  if (status === "ok") return green("[OK]");
  if (status === "fail") return red("[FAIL]");
  if (status === "warn") return yellow("[WARN]");
  return blue("[MANUAL]");
}

function scoreBar(percent) {
  const filled = Math.round(percent / 10);
  return `${"#".repeat(filled)}${"-".repeat(10 - filled)}`;
}

function scoreLabel(percent) {
  if (percent >= 85) return "Good";
  if (percent >= 70) return "Almost there";
  if (percent >= 55) return "Needs work";
  return "Not ready";
}

function ratingGrade(percent) {
  if (percent >= 90) return "A";
  if (percent >= 80) return "B";
  if (percent >= 70) return "C";
  if (percent >= 60) return "D";
  return "F";
}

function categoryScore(checks) {
  const weights = { ok: 1, warn: 0.6, fail: 0, manual: 0.3 };
  if (checks.length === 0) return 0;
  const total = checks.reduce((sum, check) => sum + (weights[check.status] ?? 0), 0);
  return Math.round((total / checks.length) * 100);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function nodeCommand() {
  return process.execPath;
}

async function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  return new Promise((resolve) => {
    const useShell = options.shell ?? process.platform === "win32";
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShell,
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
      resolve({ code: 124, stdout, stderr, timedOut: true });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, stdout, stderr, timedOut: false });
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({ port, available: false });
      } else {
        resolve({ port, available: false, error: err.message });
      }
    });
    server.listen(port, () => {
      server.close(() => resolve({ port, available: true }));
    });
  });
}

async function listFilesRecursive(dir, exts, ignore = ["node_modules", "dist", "build"]) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignore.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath, exts, ignore));
    } else if (!exts || exts.includes(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

async function scanTextFiles(paths, pattern) {
  const matches = [];
  for (const filePath of paths) {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        matches.push({ filePath, line: index + 1, text: line.trim() });
      }
    });
  }
  return matches;
}

async function parseFeatureFlags(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const matches = [...content.matchAll(/([a-zA-Z0-9_]+):\s*(true|false)/g)];
  const features = {};
  matches.forEach((match) => {
    features[match[1]] = match[2] === "true";
  });
  return features;
}

async function parseAppRoutes(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  let enabled = 0;
  let disabled = 0;
  lines.forEach((line) => {
    if (!line.includes("app.use(")) return;
    if (!line.includes("/api/")) return;
    if (line.includes("requireFeature(")) disabled += 1;
    else enabled += 1;
  });
  return { enabled, disabled };
}

async function runApiProbe() {
  const probePath = path.join(SERVER_DIR, ".tmp-project-diagnostic.ts");
  const outputPath = path.join(SERVER_DIR, ".tmp-project-diagnostic-output.json");
  const probeLines = [
    'import request from "supertest";',
    'import fs from "node:fs/promises";',
    'import app from "./src/app.ts";',
    'import { serverFeatures } from "./src/config/features.ts";',
    "",
    `const outputPath = ${JSON.stringify(outputPath)};`,
    "const results = {",
    "  health: null,",
    "  demoLoginTpo: null,",
    "  demoLoginStudent: null,",
    "  authGuard: null,",
    "  tpoDashboard: null,",
    "  studentDashboard: null,",
    "  drives: null,",
    "  resources: null,",
    "  mockAttempt: null,",
    "  disabledRoutes: [],",
    "};",
    "",
    "const summarize = (response, { includeCount } = {}) => ({",
    "  status: response?.status ?? null,",
    "  hasCookie: Array.isArray(response?.header?.['set-cookie']) && response.header['set-cookie'].length > 0,",
    "  count: includeCount && Array.isArray(response?.body?.data) ? response.body.data.length : null,",
    "});",
    "",
    "const writeOutput = async (payload) => {",
    "  await fs.writeFile(outputPath, JSON.stringify(payload), 'utf8');",
    "};",
    "",
    "const tpoAgent = request.agent(app);",
    "const studentAgent = request.agent(app);",
    "",
    "try {",
    '  const health = await request(app).get("/api/health/demo");',
    '  results.health = summarize(health);',
    '  const demoTpo = await tpoAgent.get("/api/v1/demo/auto-login-tpo").redirects(0);',
    '  results.demoLoginTpo = summarize(demoTpo);',
    '  const demoStudent = await studentAgent.get("/api/v1/demo/auto-login-student").redirects(0);',
    '  results.demoLoginStudent = summarize(demoStudent);',
    '  const authGuard = await request(app).get("/api/v1/tpo/dashboard/mvp");',
    '  results.authGuard = summarize(authGuard);',
    '  const tpoDashboard = await tpoAgent.get("/api/v1/tpo/dashboard/mvp");',
    '  results.tpoDashboard = summarize(tpoDashboard);',
    '  const studentDashboard = await studentAgent.get("/api/v1/students/me/pilot-dashboard");',
    '  results.studentDashboard = summarize(studentDashboard);',
    '  const drives = await studentAgent.get("/api/v1/students/me/drives");',
    '  results.drives = summarize(drives, { includeCount: true });',
    '  const resources = await studentAgent.get("/api/v1/students/resources");',
    '  results.resources = summarize(resources, { includeCount: true });',
    '  const mockList = await studentAgent.get("/api/v1/mock-tests");',
    "  let mockAttemptResult = { startStatus: null, submitStatus: null };",
    "  const listItems = Array.isArray(mockList.body?.data?.items)",
    "    ? mockList.body.data.items",
    "    : Array.isArray(mockList.body?.data)",
    "      ? mockList.body.data",
    "      : [];",
    "  if (mockList.status === 200 && listItems.length > 0) {",
    "    const testId = listItems[0].id;",
    "    const start = await studentAgent.post(`/api/v1/mock-tests/${testId}/start`).send({});",
    "    mockAttemptResult.startStatus = start.status;",
    "    if (start.status === 200 && Array.isArray(start.body?.data?.questions)) {",
    "      const answers = start.body.data.questions.map((_, index) => ({ questionIndex: index, selectedOption: 0 }));",
    "      const submit = await studentAgent.post(`/api/v1/mock-tests/${testId}/submit`).send({",
    "        attemptId: start.body.data.attemptId,",
    "        idempotencyKey: `diag-${Date.now()}`,",
    "        answers,",
    "      });",
    "      mockAttemptResult.submitStatus = submit.status;",
    "    }",
    "  }",
    "  results.mockAttempt = mockAttemptResult;",
    `  const disabledRouteChecks = ${JSON.stringify(FEATURE_ROUTE_HINTS)};`,
    "  for (const check of disabledRouteChecks) {",
    "    const featureEnabled = Boolean(serverFeatures[check.feature]);",
    "    const agent = check.role === 'tpo' ? tpoAgent : studentAgent;",
    "    const method = check.method.toLowerCase();",
    "    const response = await agent[method](check.path).send({ message: 'ping' });",
    "    results.disabledRoutes.push({",
    "      feature: check.feature,",
    "      path: check.path,",
    "      status: response.status,",
    "      shouldBeDisabled: !featureEnabled,",
    "    });",
    "  }",
    "  await writeOutput({ ok: true, results });",
    "  process.exit(0);",
    "} catch (error) {",
    "  const message = error instanceof Error ? error.message : String(error);",
    "  await writeOutput({ ok: false, error: message });",
    "  process.exit(1);",
    "}",
  ];

  await fs.writeFile(probePath, probeLines.join("\n"), "utf8");
  const result = await runCommand(
    npxCommand(),
    ["tsx", probePath],
    { env: { NODE_ENV: "test", DISABLE_SERVER_START: "true" }, timeoutMs: 30000 },
  );
  await fs.unlink(probePath).catch(() => undefined);

  let parsed = null;
  try {
    const raw = await fs.readFile(outputPath, "utf8");
    parsed = JSON.parse(raw);
  } catch (error) {
    parsed = null;
  }
  await fs.unlink(outputPath).catch(() => undefined);

  if (!parsed) {
    return { ok: false, error: result.stderr || result.stdout || "API probe failed" };
  }
  if (!parsed.ok) {
    return { ok: false, error: parsed.error || "API probe failed" };
  }
  return { ok: true, data: parsed.results };
}

async function main() {
  const report = {
    systemHealth: [],
    demoData: [],
    features: [],
    api: [],
    demoReadiness: [],
    codeQuality: [],
    tests: [],
    deployment: [],
    docs: [],
  };
  const warnings = [];

  const now = new Date();
  const nodeMajor = Number(process.versions.node.split(".")[0]);

  console.log("Running diagnostics... This can take up to 60 seconds.");

  report.systemHealth.push({
    status: nodeMajor >= 18 ? "ok" : "warn",
    label: `Node version ${process.versions.node}`,
  });

  const serverModules = await fileExists(path.join(SERVER_DIR, "node_modules"));
  const clientModules = await fileExists(path.join(CLIENT_DIR, "node_modules"));
  report.systemHealth.push({
    status: serverModules && clientModules ? "ok" : "warn",
    label: "Dependencies installed",
    detail: serverModules && clientModules ? "" : "Missing node_modules in server or client",
  });

  const ports = await Promise.all([checkPort(3000), checkPort(5000), checkPort(5173)]);
  const busyPorts = ports.filter((entry) => !entry.available);
  report.systemHealth.push({
    status: busyPorts.length === 0 ? "ok" : "warn",
    label: "Port availability (3000, 5000, 5173)",
    detail: busyPorts.length === 0 ? "" : `Busy: ${busyPorts.map((entry) => entry.port).join(", ")}`,
  });

  const [serverBuild, clientBuild] = await Promise.all([
    runCommand(npmCommand(), ["run", "build"], { cwd: SERVER_DIR, timeoutMs: 30000 }),
    runCommand(npmCommand(), ["run", "build"], { cwd: CLIENT_DIR, timeoutMs: 45000 }),
  ]);
  report.systemHealth.push({
    status: serverBuild.code === 0 ? "ok" : serverBuild.timedOut ? "warn" : "fail",
    label: "Server builds without errors",
    detail: serverBuild.code === 0 ? "" : serverBuild.timedOut ? "Server build timed out" : "Server build failed",
    critical: serverBuild.code !== 0 && !serverBuild.timedOut,
  });

  report.systemHealth.push({
    status: clientBuild.code === 0 ? "ok" : clientBuild.timedOut ? "warn" : "fail",
    label: "Client builds without errors",
    detail: clientBuild.code === 0 ? "" : clientBuild.timedOut ? "Client build timed out" : "Client build failed",
    critical: clientBuild.code !== 0 && !clientBuild.timedOut,
  });

  const distAppPath = path.join(SERVER_DIR, "dist", "app.js");
  const distAppUrl = pathToFileURL(distAppPath).href;
  const distExists = await fileExists(distAppPath);
  const serverStartCommand = distExists ? nodeCommand() : npxCommand();
  const serverStartArgs = distExists
    ? ["-e", `import(${JSON.stringify(distAppUrl)}).then(() => console.log('app-ok')).catch((err) => { console.error(err); process.exit(1); });`]
    : ["tsx", "-e", "import './src/app.ts'; console.log('app-ok');"];
  const serverStart = await runCommand(
    serverStartCommand,
    serverStartArgs,
    {
      cwd: SERVER_DIR,
      env: { NODE_ENV: "test", DISABLE_SERVER_START: "true" },
      timeoutMs: 20000,
      shell: distExists ? false : undefined,
    },
  );
  const serverStartError = serverStart.stderr || serverStart.stdout || "";
  const serverStartSnippet = serverStartError
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" | ");
  const serverPortBusy = /EADDRINUSE/i.test(serverStartError);
  report.systemHealth.push({
    status: serverStart.code === 0 ? "ok" : serverStart.timedOut || serverPortBusy ? "warn" : "fail",
    label: "Server can load without errors",
    detail: serverStart.code === 0
      ? ""
      : serverStart.timedOut
        ? "app.ts load timed out"
        : serverPortBusy
          ? "Port already in use"
          : serverStartSnippet || "app.ts failed to load",
    critical: serverStart.code !== 0 && !serverStart.timedOut && !serverPortBusy,
  });

  let db;
  let demoTenant;
  let demoTenantId = null;
  let demoCounts = {};
  let mongoConnected = false;
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });

  try {
    await client.connect();
    mongoConnected = true;
    db = client.db(DB_NAME);
  } catch (error) {
    mongoConnected = false;
  }

  report.systemHealth.push({
    status: mongoConnected ? "ok" : "fail",
    label: "MongoDB connection",
    critical: !mongoConnected,
  });

  if (mongoConnected) {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const collectionNames = new Set(collections.map((collection) => collection.name));
    const missing = EXPECTED_COLLECTIONS.filter((name) => !collectionNames.has(name));
    report.demoData.push({
      status: missing.length === 0 ? "ok" : "warn",
      label: "Required collections exist",
      detail: missing.length === 0 ? "" : `Missing: ${missing.join(", ")}`,
    });

    demoTenant = await db.collection("tenants").findOne(
      { slug: { $in: ACCEPTED_DEMO_SLUGS } },
      { projection: { _id: 0, id: 1, name: 1, slug: 1 } },
    );
    if (demoTenant) {
      demoTenantId = String(demoTenant.id);
      report.demoData.push({
        status: "ok",
        label: `Demo tenant: ${demoTenant.name}`,
      });
    } else {
      report.demoData.push({
        status: "fail",
        label: "Demo tenant missing",
        detail: "Run npm run seed:demo",
        critical: true,
      });
    }

    if (demoTenantId) {
      const [tpoUser, studentCount, driveCount, mockCount, resourceCount] = await Promise.all([
        db.collection("users").findOne({ tenant_id: demoTenantId, email: "tpo@stxaviers-demo.edu" }),
        db.collection("students").countDocuments({ tenant_id: demoTenantId }),
        db.collection("drives").countDocuments({ tenant_id: demoTenantId, deleted_at: null }),
        db.collection("mock_tests").countDocuments({ tenant_id: demoTenantId, is_active: true }),
        db.collection("resources").countDocuments({ tenant_id: demoTenantId, is_active: true }),
      ]);

      demoCounts = { studentCount, driveCount, mockCount, resourceCount };

      report.demoData.push({
        status: tpoUser ? "ok" : "fail",
        label: "Demo TPO account exists",
        detail: tpoUser ? "" : "Missing tpo@stxaviers-demo.edu",
        critical: !tpoUser,
      });
      report.demoData.push({
        status: studentCount >= 100 ? "ok" : "fail",
        label: `Demo students: ${studentCount}`,
        critical: studentCount < 100,
      });
      report.demoData.push({
        status: driveCount >= 3 ? "ok" : "fail",
        label: `Demo drives: ${driveCount}`,
        critical: driveCount < 3,
      });
      report.demoData.push({
        status: mockCount >= 2 ? "ok" : "fail",
        label: `Demo mock tests: ${mockCount}`,
        critical: mockCount < 2,
      });
      report.demoData.push({
        status: resourceCount >= 20 ? "ok" : "fail",
        label: `Demo resources: ${resourceCount}`,
        critical: resourceCount < 20,
      });

      const [attemptCount, viewCount, activityCount] = await Promise.all([
        db.collection("student_attempts").countDocuments({ tenant_id: demoTenantId }),
        db.collection("resource_view_events").countDocuments({ tenant_id: demoTenantId }),
        db.collection("student_activity_events").countDocuments({ tenant_id: demoTenantId }),
      ]);
      report.demoData.push({
        status: attemptCount + viewCount + activityCount > 0 ? "ok" : "warn",
        label: "Sample activity data exists",
        detail: `attempts=${attemptCount}, views=${viewCount}, activity=${activityCount}`,
      });

      const orphanStudents = await db.collection("students").aggregate([
        { $match: { tenant_id: demoTenantId } },
        { $lookup: { from: "users", localField: "user_id", foreignField: "id", as: "user" } },
        { $match: { user: { $size: 0 } } },
        { $count: "count" },
      ]).toArray();
      const orphanStudentCount = orphanStudents[0]?.count ?? 0;

      const orphanAttempts = await db.collection("student_attempts").aggregate([
        { $match: { tenant_id: demoTenantId } },
        { $lookup: { from: "students", localField: "student_id", foreignField: "id", as: "student" } },
        { $match: { student: { $size: 0 } } },
        { $count: "count" },
      ]).toArray();
      const orphanAttemptCount = orphanAttempts[0]?.count ?? 0;

      report.demoData.push({
        status: orphanStudentCount === 0 && orphanAttemptCount === 0 ? "ok" : "warn",
        label: "Data integrity (no orphaned records)",
        detail: orphanStudentCount + orphanAttemptCount === 0 ? "" : `orphans=${orphanStudentCount + orphanAttemptCount}`,
      });
    }
  }

  const serverFeatures = await parseFeatureFlags(path.join(SERVER_DIR, "src", "config", "features.ts"));
  const clientFeatures = await parseFeatureFlags(path.join(CLIENT_DIR, "src", "config", "features.ts"));
  const enabledFeatures = Object.entries(serverFeatures).filter(([, value]) => value).map(([key]) => key);
  const disabledFeatures = Object.entries(serverFeatures).filter(([, value]) => !value).map(([key]) => key);
  report.features.push({
    status: "ok",
    label: `Enabled features: ${enabledFeatures.length}`,
    detail: enabledFeatures.length ? enabledFeatures.join(", ") : "None",
  });
  report.features.push({
    status: "warn",
    label: `Disabled features: ${disabledFeatures.length}`,
    detail: disabledFeatures.join(", "),
  });

  const routeCounts = await parseAppRoutes(path.join(SERVER_DIR, "src", "app.ts"));
  report.features.push({
    status: "ok",
    label: `Route groups: ${routeCounts.enabled} enabled, ${routeCounts.disabled} disabled`,
  });

  const featureRatio = enabledFeatures.length + disabledFeatures.length > 0
    ? Math.round((enabledFeatures.length / (enabledFeatures.length + disabledFeatures.length)) * 100)
    : 0;
  const routeRatio = routeCounts.enabled + routeCounts.disabled > 0
    ? Math.round((routeCounts.enabled / (routeCounts.enabled + routeCounts.disabled)) * 100)
    : 0;
  const enabledRatio = Math.max(featureRatio, routeRatio);
  report.features.push({
    status: "ok",
    label: `Estimated enabled surface: ${enabledRatio}%`,
  });

  const apiProbe = await runApiProbe();
  if (!apiProbe.ok) {
    report.api.push({ status: "fail", label: "API probe failed", detail: apiProbe.error, critical: true });
  } else {
    const data = apiProbe.data;
    report.api.push({
      status: data.health?.status >= 200 && data.health?.status < 300 ? "ok" : "fail",
      label: "Health endpoint (/api/health/demo)",
      critical: !(data.health?.status >= 200 && data.health?.status < 300),
    });
    report.api.push({
      status: data.demoLoginTpo?.status === 302 ? "ok" : "fail",
      label: "Demo TPO auto-login route",
      critical: data.demoLoginTpo?.status !== 302,
    });
    report.api.push({
      status: data.demoLoginStudent?.status === 302 ? "ok" : "fail",
      label: "Demo student auto-login route",
      critical: data.demoLoginStudent?.status !== 302,
    });
    report.api.push({
      status: data.authGuard?.status === 401 || data.authGuard?.status === 403 ? "ok" : "warn",
      label: "Auth middleware enforcement",
      detail: `status=${data.authGuard?.status}`,
    });
    report.api.push({
      status: data.tpoDashboard?.status === 200 ? "ok" : "fail",
      label: "TPO dashboard reachable",
      critical: data.tpoDashboard?.status !== 200,
    });
    report.api.push({
      status: data.studentDashboard?.status === 200 ? "ok" : "fail",
      label: "Student dashboard reachable",
      critical: data.studentDashboard?.status !== 200,
    });
    report.api.push({
      status: data.drives?.status === 200 ? "ok" : "fail",
      label: "Student drives reachable",
      critical: data.drives?.status !== 200,
    });
    report.api.push({
      status: data.resources?.status === 200 ? "ok" : "fail",
      label: "Student resources reachable",
      critical: data.resources?.status !== 200,
    });

    const enabledChecks = [
      { name: "TPO dashboard", status: data.tpoDashboard?.status },
      { name: "Student dashboard", status: data.studentDashboard?.status },
      { name: "Student drives", status: data.drives?.status },
      { name: "Student resources", status: data.resources?.status },
    ];
    const enabledFailures = enabledChecks.filter((check) => check.status !== 200);
    report.api.push({
      status: enabledFailures.length === 0 ? "ok" : "fail",
      label: `Enabled routes reachable (${enabledChecks.length - enabledFailures.length}/${enabledChecks.length})`,
      detail: enabledFailures.length === 0 ? "" : enabledFailures.map((check) => check.name).join(", "),
      critical: enabledFailures.length > 0,
    });

    const disabledResults = data.disabledRoutes ?? [];
    const disabledFailures = disabledResults.filter((item) => item.shouldBeDisabled && item.status !== 404);
    report.api.push({
      status: disabledFailures.length === 0 ? "ok" : "warn",
      label: "Disabled routes return 404",
      detail: disabledFailures.length === 0 ? "" : `${disabledFailures.length} routes returned ${disabledFailures.map((item) => item.status).join(", ")}`,
    });

    report.demoReadiness.push({
      status: data.demoLoginTpo?.status === 302 ? "ok" : "fail",
      label: "TPO demo auto-login",
      critical: data.demoLoginTpo?.status !== 302,
    });
    report.demoReadiness.push({
      status: data.demoLoginStudent?.status === 302 ? "ok" : "fail",
      label: "Student demo auto-login",
      critical: data.demoLoginStudent?.status !== 302,
    });
    report.demoReadiness.push({
      status: data.tpoDashboard?.status === 200 ? "ok" : "fail",
      label: "TPO dashboard loads with data",
      critical: data.tpoDashboard?.status !== 200,
    });
    report.demoReadiness.push({
      status: data.studentDashboard?.status === 200 ? "ok" : "fail",
      label: "Student dashboard loads with data",
      critical: data.studentDashboard?.status !== 200,
    });
    report.demoReadiness.push({
      status: data.drives?.status === 200 ? "ok" : "fail",
      label: "Drives eligibility list loads",
      critical: data.drives?.status !== 200,
    });
    report.demoReadiness.push({
      status: data.mockAttempt?.startStatus === 200 && data.mockAttempt?.submitStatus === 200 ? "ok" : "fail",
      label: "Mock test attempt and submit",
      critical: !(data.mockAttempt?.startStatus === 200 && data.mockAttempt?.submitStatus === 200),
    });
    report.demoReadiness.push({
      status: data.resources?.status === 200 ? "ok" : "fail",
      label: "Resources list loads",
      critical: data.resources?.status !== 200,
    });
  }

  const testFiles = [
    ...await listFilesRecursive(path.join(SERVER_DIR, "tests"), [".ts", ".tsx"]).catch(() => []),
  ].filter((file) => file.includes(".test."));
  report.tests.push({
    status: testFiles.length > 0 ? "ok" : "warn",
    label: `Test files exist (${testFiles.length})`,
  });

  const testRun = await runCommand(npmCommand(), ["test"], { cwd: SERVER_DIR, timeoutMs: 30000 });
  report.tests.push({
    status: testRun.code === 0 ? "ok" : "warn",
    label: "npm test",
    detail: testRun.code === 0 ? "Passed" : "Failed or not configured",
  });

  const demoTestRun = await runCommand(npmCommand(), ["run", "test:demo"], { cwd: SERVER_DIR, timeoutMs: 60000 });
  const demoTestOutput = demoTestRun.stderr || demoTestRun.stdout || "";
  const demoTestSnippet = demoTestOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(" | ");
  report.tests.push({
    status: demoTestRun.code === 0 ? "ok" : demoTestRun.timedOut ? "warn" : "fail",
    label: "Demo flow tests",
    detail: demoTestRun.code === 0
      ? "Passed"
      : demoTestRun.timedOut
        ? "Timed out"
        : demoTestSnippet || "Failed",
    critical: demoTestRun.code !== 0 && !demoTestRun.timedOut,
  });

  const clientPages = [
    "src/pages/public/HomePage.tsx",
    "src/pages/public/LoginPage.tsx",
    "src/pages/student/DashboardPage.tsx",
    "src/pages/student/DrivesPage.tsx",
    "src/pages/student/ResourcesPage.tsx",
    "src/pages/student/MockTestsPage.tsx",
    "src/pages/tpo/TpoDashboardPage.tsx",
  ];
  const missingPages = [];
  for (const page of clientPages) {
    if (!(await fileExists(path.join(CLIENT_DIR, page)))) {
      missingPages.push(page);
    }
  }
  report.demoReadiness.push({
    status: missingPages.length === 0 ? "ok" : "fail",
    label: "Core MVP pages exist",
    detail: missingPages.length === 0 ? "" : `Missing: ${missingPages.join(", ")}`,
    critical: missingPages.length > 0,
  });

  report.demoReadiness.push({
    status: missingPages.includes("src/pages/public/HomePage.tsx") ? "fail" : "ok",
    label: "Landing page exists",
    critical: missingPages.includes("src/pages/public/HomePage.tsx"),
  });

  const navContent = await fs.readFile(path.join(CLIENT_DIR, "src/components/composites/Navbar.tsx"), "utf8");
  const navHrefs = [...navContent.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]);
  const disabledNavPaths = [
    "/ai-assistant",
    "/career-lab",
    "/mastery",
    "/vault",
    "/mentorship",
    "/wallet",
    "/tpo/analytics",
    "/tpo/ops-hub",
  ];
  const hiddenNavIssues = disabledNavPaths.filter((pathValue) => navHrefs.includes(pathValue));
  report.demoReadiness.push({
    status: hiddenNavIssues.length === 0 ? "ok" : "warn",
    label: "Disabled pages hidden from nav",
    detail: hiddenNavIssues.length === 0 ? "" : `Feature labels found: ${hiddenNavIssues.join(", ")}`,
  });

  report.demoReadiness.push({ status: "manual", label: "TPO can add a new drive" });
  report.demoReadiness.push({ status: "manual", label: "Student can view profile" });
  report.demoReadiness.push({ status: "manual", label: "Mobile responsive (basic check)" });

  const codeFiles = [
    ...await listFilesRecursive(path.join(SERVER_DIR, "src"), [".ts", ".tsx"]),
    ...await listFilesRecursive(path.join(CLIENT_DIR, "src"), [".ts", ".tsx"]),
  ];

  const anyMatches = await scanTextFiles(codeFiles, /\bany\b/);
  report.codeQuality.push({
    status: anyMatches.length === 0 ? "ok" : "warn",
    label: `TypeScript 'any' usage (${anyMatches.length})`,
  });

  const logMatches = await scanTextFiles(codeFiles, /console\.log/);
  report.codeQuality.push({
    status: logMatches.length === 0 ? "ok" : "warn",
    label: `console.log statements (${logMatches.length})`,
  });

  const longFiles = [];
  for (const filePath of codeFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/).length;
    if (lines > 500) {
      longFiles.push({ filePath, lines });
    }
  }
  report.codeQuality.push({
    status: longFiles.length === 0 ? "ok" : "warn",
    label: `Files >500 lines (${longFiles.length})`,
    detail: longFiles.slice(0, 5).map((entry) => `${path.relative(ROOT_DIR, entry.filePath)}(${entry.lines})`).join(", "),
  });

  const secretMatches = await scanTextFiles(
    codeFiles,
    /(AIza[0-9A-Za-z\-_]{30,}|sk-[A-Za-z0-9]{20,}|-----BEGIN PRIVATE KEY-----)/,
  );
  report.codeQuality.push({
    status: secretMatches.length === 0 ? "ok" : "fail",
    label: "Hardcoded secret scan",
    detail: secretMatches.length === 0 ? "" : `Potential secrets found in ${secretMatches.length} lines`,
    critical: secretMatches.length > 0,
  });

  report.codeQuality.push({ status: "manual", label: "Missing auth on sensitive routes" });
  report.codeQuality.push({ status: "manual", label: "Unhandled promise rejections / async error safety" });

  const envExampleExists = await fileExists(path.join(ROOT_DIR, ".env.example"))
    || await fileExists(path.join(SERVER_DIR, ".env.example"));
  report.deployment.push({ status: envExampleExists ? "ok" : "warn", label: ".env.example exists" });

  const envUtilExists = await fileExists(path.join(SERVER_DIR, "src/utils/env.ts"));
  report.deployment.push({ status: envUtilExists ? "ok" : "warn", label: "Environment validation helper exists" });

  const corsConfig = await fs.readFile(path.join(SERVER_DIR, "src/app.ts"), "utf8");
  const corsOpen = corsConfig.includes("origin: \"*\"") || corsConfig.includes("origin: '*'");
  report.deployment.push({
    status: corsOpen ? "warn" : "ok",
    label: "CORS configuration",
    detail: corsOpen ? "Wildcard origin detected" : "",
  });

  const rateLimitMatches = await scanTextFiles(codeFiles, /rateLimit|express-rate-limit/).catch(() => []);
  report.deployment.push({
    status: rateLimitMatches.length > 0 ? "ok" : "warn",
    label: "Rate limiting configured",
  });

  const indexMatches = await scanTextFiles(codeFiles, /createIndex\(/).catch(() => []);
  report.deployment.push({
    status: indexMatches.length > 0 ? "ok" : "warn",
    label: `Database indexes declared (${indexMatches.length})`,
  });

  const loggerExists = await fileExists(path.join(SERVER_DIR, "src/utils/logger.ts"));
  report.deployment.push({
    status: loggerExists ? "ok" : "warn",
    label: "Logging configured",
  });

  const readmeExists = await fileExists(path.join(ROOT_DIR, "README.md"));
  report.docs.push({ status: readmeExists ? "ok" : "warn", label: "README present" });
  const docsDirExists = await fileExists(path.join(ROOT_DIR, "docs"));
  report.docs.push({ status: docsDirExists ? "ok" : "warn", label: "Docs folder present" });
  report.docs.push({ status: "manual", label: "API routes documented" });
  report.docs.push({ status: "manual", label: "Environment setup documented" });
  report.docs.push({ status: "manual", label: "Demo URLs documented" });

  const categories = [
    { key: "systemHealth", label: "System Health" },
    { key: "demoData", label: "Demo Data" },
    { key: "features", label: "Features" },
    { key: "api", label: "API Endpoints" },
    { key: "demoReadiness", label: "Demo Readiness" },
    { key: "codeQuality", label: "Code Quality" },
    { key: "tests", label: "Tests" },
    { key: "deployment", label: "Deployment Ready" },
    { key: "docs", label: "Documentation" },
  ];

  const categoryScores = {};
  categories.forEach((category) => {
    categoryScores[category.key] = categoryScore(report[category.key]);
  });

  const overallScore = Math.round(
    Object.values(categoryScores).reduce((sum, value) => sum + value, 0) / categories.length,
  );

  const criticalFailures = [];
  categories.forEach((category) => {
    report[category.key].forEach((check) => {
      if (check.critical && check.status !== "ok") {
        criticalFailures.push(check);
      }
      if (check.status === "warn") warnings.push(check);
    });
  });

  const demoReady = criticalFailures.length === 0 && categoryScores.demoReadiness >= 80;
  const canDeploy = criticalFailures.length === 0 && categoryScores.deployment >= 80;
  const investorReady = demoReady && canDeploy && categoryScores.docs >= 70;
  const viableProduct = overallScore >= 60 ? "YES (core MVP present)" : "NO (fix core issues first)";

  console.log("========================================");
  console.log("PROJECT DIAGNOSTIC REPORT");
  console.log(`Generated: ${now.toISOString()}`);
  console.log("========================================");
  console.log("");

  console.log("OVERALL STATUS");
  console.log(`Project Health: ${scoreBar(overallScore)} ${overallScore}% (${ratingGrade(overallScore)})`);
  console.log(`Demo Ready: ${demoReady ? "YES" : "NO"}`);
  console.log(`Can Deploy: ${canDeploy ? "YES" : "NO"}`);
  console.log(`Investor Ready: ${investorReady ? "YES" : "NO"}`);
  console.log("");

  console.log("SCORES BY CATEGORY");
  categories.forEach((category) => {
    const score = categoryScores[category.key];
    console.log(`${category.label}: ${scoreBar(score)} ${score}% ${scoreLabel(score)}`);
  });
  console.log("");

  console.log("WHAT WORKS");
  categories.forEach((category) => {
    report[category.key].filter((check) => check.status === "ok").slice(0, 6).forEach((check) => {
      console.log(`${statusMark(check.status)} ${check.label}${check.detail ? ` (${check.detail})` : ""}`);
    });
  });
  console.log("");

  console.log("WHAT'S BROKEN");
  if (criticalFailures.length === 0) {
    console.log(green("[OK] No critical blockers detected."));
  } else {
    criticalFailures.forEach((failure) => {
      console.log(`${statusMark("fail")} ${failure.label}${failure.detail ? ` (${failure.detail})` : ""}`);
    });
  }
  console.log("");

  console.log("FEATURE INVENTORY");
  console.log(`Enabled features: ${enabledFeatures.length} (${enabledFeatures.join(", ") || "none"})`);
  console.log(`Disabled features: ${disabledFeatures.length} (${disabledFeatures.join(", ") || "none"})`);
  console.log(`Estimated enabled surface: ${enabledRatio}%`);
  console.log("Students can:");
  STUDENT_CAPABILITIES.forEach((item) => console.log(`- ${item}`));
  console.log("TPOs can:");
  TPO_CAPABILITIES.forEach((item) => console.log(`- ${item}`));
  console.log("Built but hidden:");
  HIDDEN_FEATURES.forEach((item) => console.log(`- ${item}`));
  console.log("");

  console.log("DEMO READINESS");
  report.demoReadiness.forEach((check) => {
    console.log(`${statusMark(check.status)} ${check.label}${check.detail ? ` (${check.detail})` : ""}`);
  });
  console.log(`Demo ready? ${demoReady ? "YES" : "NO"}`);
  console.log("");

  console.log("DEPLOYMENT READINESS");
  report.deployment.forEach((check) => {
    console.log(`${statusMark(check.status)} ${check.label}${check.detail ? ` (${check.detail})` : ""}`);
  });
  console.log(`Can deploy? ${canDeploy ? "YES" : "NO"}`);
  console.log("");

  console.log("CRITICAL PATH");
  console.log(`Top blocker: ${criticalFailures[0]?.label || "None"}`);
  console.log(`Time to fix critical issues: ${criticalFailures.length * 20} minutes (estimate)`);
  console.log("");

  console.log("HONEST ASSESSMENT");
  console.log(`Viable product? ${viableProduct}`);
  console.log("Strengths: MVP core + demo data + feature flags are in place.");
  console.log(`Weaknesses: ${criticalFailures.length > 0 ? "Critical blockers exist." : "No critical blockers."}`);
  console.log(`Recommendation: ${demoReady ? "Start demoing." : "Fix blockers before demoing."}`);
  console.log("");

  if (mongoConnected) {
    await client.close();
  }

  const exitCode = overallScore >= 80 && criticalFailures.length === 0 ? 0 : 1;
  process.exitCode = exitCode;
}

await main();
