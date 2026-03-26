import { randomUUID } from "node:crypto";

import { RiskAssessmentService } from "../services/risk-assessment.service.js";
import { getMongoDb } from "../utils/mongodb.js";
import { logger } from "../utils/logger.js";

async function sendEmail(params: { tenantId: string; to: string; subject: string; body: string }) {
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail || apiKey.includes("<")) {
    logger.warn("Resend not configured, skipping daily risk email dispatch", {
      context: { tenantId: params.tenantId, to: params.to },
    });
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [params.to],
      subject: params.subject,
      text: params.body,
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    logger.warn("Resend email failed", {
      context: { tenantId: params.tenantId, to: params.to, error: payload },
    });
  }
}

async function buildDigest(tenantId: string) {
  const db = await getMongoDb();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  const [todayHistory, yesterdayHistory, scores, students, users] = await Promise.all([
    db.collection("risk_history").find(
      { tenant_id: tenantId, date: todayIso },
      { projection: { _id: 0, student_id: 1, risk_score: 1, category: 1 } },
    ).toArray(),
    db.collection("risk_history").find(
      { tenant_id: tenantId, date: yesterdayIso },
      { projection: { _id: 0, student_id: 1, risk_score: 1, category: 1 } },
    ).toArray(),
    db.collection("risk_scores").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, student_id: 1, risk_score: 1, category: 1 } },
    ).toArray(),
    db.collection("students").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, user_id: 1, branch: 1 } },
    ).toArray(),
    db.collection("users").find(
      { tenant_id: tenantId },
      { projection: { _id: 0, id: 1, full_name: 1, role: 1, email: 1, is_active: 1 } },
    ).toArray(),
  ]);

  const studentMap = new Map(students.map((student) => [String(student.id), student]));
  const userMap = new Map(users.map((user) => [String(user.id), user]));
  const yesterdayMap = new Map(yesterdayHistory.map((row) => [String(row.student_id), Number(row.risk_score ?? 0)]));

  const highRisk = scores.filter((row) => String(row.category) === "HIGH_RISK");
  const highRiskStudents = highRisk
    .sort((a, b) => Number(b.risk_score ?? 0) - Number(a.risk_score ?? 0))
    .slice(0, 5)
    .map((row) => {
      const student = studentMap.get(String(row.student_id));
      const user = student ? userMap.get(String(student.user_id)) : null;
      return {
        name: String(user?.full_name ?? "Student"),
        branch: String(student?.branch ?? ""),
        score: Number(row.risk_score ?? 0),
        previous: Number(yesterdayMap.get(String(row.student_id)) ?? 0),
      };
    });

  const increased = todayHistory.filter((row) => {
    const prev = Number(yesterdayMap.get(String(row.student_id)) ?? row.risk_score ?? 0);
    return Number(row.risk_score ?? 0) - prev >= 10;
  }).slice(0, 5);

  const increasedNames = increased.map((row) => {
    const student = studentMap.get(String(row.student_id));
    const user = student ? userMap.get(String(student.user_id)) : null;
    return String(user?.full_name ?? "Student");
  });

  const tpoRecipients = users
    .filter((user) => (user.role === "tpo" || user.role === "admin") && user.is_active && user.email)
    .map((user) => String(user.email));

  const summary = {
    total: scores.length,
    high: scores.filter((row) => String(row.category) === "HIGH_RISK").length,
    medium: scores.filter((row) => String(row.category) === "MEDIUM_RISK").length,
    low: scores.filter((row) => String(row.category) === "LOW_RISK").length,
  };

  const bodyLines = [
    `Daily Risk Report - ${summary.high} students need attention`,
    "",
    `HIGH RISK (${summary.high} students):`,
    ...highRiskStudents.map((student) =>
      `- ${student.name} (${student.branch}) - Risk ${student.score}${student.previous ? ` (was ${student.previous})` : ""}`,
    ),
    "",
    `MEDIUM RISK (${summary.medium} students):`,
    "View dashboard for full list.",
    "",
    "Quick actions:",
    "[View Dashboard] [Contact High Risk Students]",
  ];

  if (increasedNames.length > 0) {
    bodyLines.splice(6, 0, "Recent increases:");
    increasedNames.forEach((name) => bodyLines.splice(7, 0, `- ${name}`));
    bodyLines.splice(7 + increasedNames.length, 0, "");
  }

  return {
    summary,
    recipients: tpoRecipients,
    subject: `Daily Risk Report - ${summary.high} students need attention`,
    body: bodyLines.join("\n"),
  };
}

async function runDailyRiskCheck() {
  const db = await getMongoDb();
  const tenants = await db.collection("tenants").find(
    { is_active: true },
    { projection: { _id: 0, id: 1 } },
  ).toArray();

  const tenantIds = tenants.length > 0
    ? tenants.map((tenant) => String(tenant.id))
    : [...new Set((await db.collection("students").find({}, { projection: { tenant_id: 1 } }).toArray()).map((row) => String(row.tenant_id)))];

  for (const tenantId of tenantIds) {
    try {
      await RiskAssessmentService.refreshRiskScores(tenantId);
      const digest = await buildDigest(tenantId);

      await db.collection("risk_alerts").insertOne({
        id: randomUUID(),
        tenant_id: tenantId,
        title: "Daily risk digest",
        summary: digest.summary,
        created_at: new Date().toISOString(),
      });

      for (const recipient of digest.recipients) {
        await sendEmail({
          tenantId,
          to: recipient,
          subject: digest.subject,
          body: digest.body,
        });
      }
    } catch (error) {
      logger.warn("Daily risk check failed", {
        context: {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

function scheduleNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const delay = Math.max(1000, next.getTime() - now.getTime());

  const timer = setTimeout(async () => {
    await runDailyRiskCheck();
    scheduleNextRun();
  }, delay);
  timer.unref?.();
}

export function scheduleDailyRiskCheck() {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.DISABLE_RISK_JOB === "true") return;
  scheduleNextRun();
}
