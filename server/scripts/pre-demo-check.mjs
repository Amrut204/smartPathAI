import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const COLOR = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

const HEALTH_PATH = "/api/health/demo";
const TEST_REPORT_PATH = path.join(process.cwd(), ".tmp-pre-demo-jest-report.json");
const HEALTH_PROBE_PATH = path.join(process.cwd(), ".tmp-pre-demo-health-check.ts");
const TEST_LABEL_MAP = new Map([
  ["auto-logs in the demo TPO and sets both session cookies", "Demo TPO login"],
  ["auto-logs in the demo student and sets both session cookies", "Demo student login"],
  ["loads the TPO pilot dashboard with the expected seeded demo structure", "TPO dashboard"],
  ["returns the seeded student drives list with eligibility details", "Student eligibility"],
  ["starts and submits a mock test attempt against the seeded demo test catalog", "Mock test submission"],
  ["loads student dashboard metrics from the seeded demo tenant", "Student dashboard"],
]);

function green(text) {
  return `${COLOR.green}${text}${COLOR.reset}`;
}

function red(text) {
  return `${COLOR.red}${text}${COLOR.reset}`;
}

function yellow(text) {
  return `${COLOR.yellow}${text}${COLOR.reset}`;
}

function cyan(text) {
  return `${COLOR.cyan}${text}${COLOR.reset}`;
}

function heading() {
  console.log("========================================");
  console.log("PRE-DEMO VERIFICATION");
  console.log("========================================");
  console.log("");
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function summarizeOutput(output, limit = 8) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-limit);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function removeTestReport() {
  try {
    await fs.unlink(TEST_REPORT_PATH);
  } catch {
    // ignore missing temp file
  }
}

async function removeHealthProbe() {
  try {
    await fs.unlink(HEALTH_PROBE_PATH);
  } catch {
    // ignore missing temp file
  }
}

async function runPreDemoCheck() {
  const failures = [];
  const baseAppUrl = process.env.APP_URL || "https://yourapp.com";

  heading();

  console.log("[1/5] Backing up demo data...");
  const backupResult = await runCommand(npmCommand(), ["run", "backup:demo"]);
  if (backupResult.code !== 0) {
    failures.push("Demo backup failed.");
    console.log(red("✗ Demo backup failed"));
    summarizeOutput(`${backupResult.stdout}\n${backupResult.stderr}`).forEach((line) => {
      console.log(`  ${line}`);
    });
    return failures;
  }
  console.log(green("✓ Demo backup complete"));
  console.log("");

  console.log("[2/5] Resetting demo data...");
  const resetResult = await runCommand(
    npmCommand(),
    ["run", "seed:demo:reset"],
    { env: { SKIP_DEMO_BACKUP: "1" } },
  );
  if (resetResult.code !== 0) {
    failures.push("Demo data reset failed.");
    console.log(red("✗ Demo data reset failed"));
    summarizeOutput(`${resetResult.stdout}\n${resetResult.stderr}`).forEach((line) => {
      console.log(`  ${line}`);
    });
    console.log("");
    console.log(red("Attempting restore from latest backup..."));
    const restoreResult = await runCommand(npmCommand(), ["run", "restore:demo"]);
    if (restoreResult.code !== 0) {
      failures.push("Demo restore failed after reset failure.");
      summarizeOutput(`${restoreResult.stdout}\n${restoreResult.stderr}`).forEach((line) => {
        console.log(`  ${line}`);
      });
    } else {
      console.log(green("✓ Demo restored from backup"));
    }
    return failures;
  }
  console.log(green("✓ Demo data reset complete"));
  console.log("");

  console.log("[3/5] Checking demo health...");
  let healthBody = null;
  await fs.writeFile(
    HEALTH_PROBE_PATH,
    `import request from "supertest";
import app from "./src/app.ts";

const response = await request(app).get("${HEALTH_PATH}");
console.log(JSON.stringify({ statusCode: response.status, body: response.body }));`,
    "utf8",
  );
  const healthResult = await runCommand(
    npxCommand(),
    ["tsx", HEALTH_PROBE_PATH],
    { env: { NODE_ENV: "test" } },
  );
  await removeHealthProbe();

  try {
    if (healthResult.code !== 0) {
      throw new Error(summarizeOutput(`${healthResult.stdout}\n${healthResult.stderr}`).join(" | ") || "health probe process failed");
    }

    const jsonLine = healthResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => line.startsWith("{") && line.endsWith("}"));

    if (!jsonLine) {
      throw new Error("health probe did not return JSON");
    }

    const parsed = JSON.parse(jsonLine);
    const response = {
      ok: Number(parsed.statusCode) >= 200 && Number(parsed.statusCode) < 300,
      status: Number(parsed.statusCode),
    };
    const body = parsed.body ?? {};
    healthBody = body;

    if (!response.ok || body.status !== "healthy") {
      failures.push(`Demo health endpoint failed with status ${response.status}.`);
      console.log(red(`✗ Demo health check failed (${response.status})`));
    } else {
      const checks = body.checks ?? {};
      const details = body.details ?? {};
      console.log(`${checks.database ? green("✓") : red("✗")} Database: ${checks.database ? "OK" : "FAILED"}`);
      console.log(`${checks.demoTenant ? green("✓") : red("✗")} Demo tenant: ${checks.demoTenant ? `OK (${details.expectedTenantName ?? "St. Xavier's"})` : "FAILED"}`);
      console.log(`${checks.demoTPO ? green("✓") : red("✗")} TPO account: ${checks.demoTPO ? "OK" : "FAILED"}`);
      console.log(`${checks.demoStudents ? green("✓") : red("✗")} Students: ${checks.demoStudents ? `OK (${details.studentCount ?? 0} found)` : `FAILED (${details.studentCount ?? 0} found)`}`);
      console.log(`${checks.demoDrives ? green("✓") : red("✗")} Drives: ${checks.demoDrives ? `OK (${details.driveCount ?? 0} found)` : `FAILED (${details.driveCount ?? 0} found)`}`);
      console.log(`${checks.demoMockTests ? green("✓") : red("✗")} Mock tests: ${checks.demoMockTests ? `OK (${details.mockTestCount ?? 0} found)` : `FAILED (${details.mockTestCount ?? 0} found)`}`);
      console.log(`${checks.demoResources ? green("✓") : red("✗")} Resources: ${checks.demoResources ? `OK (${details.resourceCount ?? 0} found)` : `FAILED (${details.resourceCount ?? 0} found)`}`);

      for (const [key, passed] of Object.entries(checks)) {
        if (!passed) {
          failures.push(`Health check failed: ${key}`);
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`Unable to run demo health check: ${message}`);
    console.log(red("✗ Demo health check failed"));
    console.log(`  ${message}`);
  }
  console.log("");

  console.log("[4/5] Running automated tests...");
  await removeTestReport();
  const testResult = await runCommand(
    npmCommand(),
    ["run", "test:demo", "--", "--runInBand", "--json", `--outputFile=${TEST_REPORT_PATH}`],
    { env: { NODE_ENV: "test" } },
  );

  let assertionResults = [];
  try {
    const report = JSON.parse(await fs.readFile(TEST_REPORT_PATH, "utf8"));
    assertionResults = report.testResults?.flatMap((suite) => suite.assertionResults ?? []) ?? [];
  } catch {
    // fall through
  } finally {
    await removeTestReport();
  }

  if (assertionResults.length > 0) {
    for (const assertion of assertionResults) {
      const label = TEST_LABEL_MAP.get(assertion.title) ?? assertion.title;
      const passed = assertion.status === "passed";
      console.log(`${passed ? green("✓") : red("✗")} ${label}: ${passed ? "PASS" : "FAIL"}`);
      if (!passed) {
        failures.push(`Automated test failed: ${label}`);
      }
    }
  } else {
    if (testResult.code === 0) {
      console.log(green("✓ Demo test suite: PASS"));
    } else {
      console.log(red("✗ Demo test suite: FAIL"));
      failures.push("Automated tests failed.");
    }
  }

  if (testResult.code !== 0) {
    summarizeOutput(`${testResult.stdout}\n${testResult.stderr}`).forEach((line) => {
      console.log(`  ${line}`);
    });
    if (!failures.includes("Automated tests failed.")) {
      failures.push("Automated tests failed.");
    }
  }
  console.log("");

  console.log("[5/5] Final status...");
  console.log("========================================");
  if (failures.length === 0) {
    console.log(green("✓ DEMO READY - All checks passed"));
    console.log("========================================");
    console.log("");
    console.log("Demo URLs:");
    console.log(`TPO:     ${baseAppUrl.replace(/\/$/, "")}/demo/auto-login-tpo`);
    console.log(`Student: ${baseAppUrl.replace(/\/$/, "")}/demo/auto-login-student`);
    return failures;
  }

  console.log(red("✗ DEMO NOT READY - Fix issues below"));
  console.log("========================================");
  failures.forEach((failure) => console.log(red(`- ${failure}`)));
  return failures;
}

const failures = await runPreDemoCheck();
process.exitCode = failures.length === 0 ? 0 : 1;
