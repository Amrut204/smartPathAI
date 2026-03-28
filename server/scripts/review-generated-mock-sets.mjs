import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, "question_generation", "raw");
const REVIEW_DIR = path.join(__dirname, "question_generation", "review");

const NOISE_PATTERNS = [
  /consult club/i,
  /page \d+/i,
  /questions and answers/i,
  /join .*whatsapp/i,
  /join .*telegram/i,
  /next\s*-/i,
  /official whatsapp/i,
  /official telegram/i,
  /\bclick here\b/i,
  /copyright/i,
];

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasNoise(text) {
  return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function isValidQuestionShape(question) {
  const text = normalizeText(question.questionText ?? question.question);
  const options = Array.isArray(question.options)
    ? question.options
    : Object.values(question.options ?? {});
  return text.length > 0 && options.length === 4;
}

function reviewQuestion(question) {
  const text = normalizeText(question.questionText ?? question.question);
  const options = (Array.isArray(question.options) ? question.options : Object.values(question.options ?? {}))
    .map((option) => normalizeText(option));
  const explanation = normalizeText(question.explanation ?? question.solution);
  const combined = [text, ...options, explanation].join(" ");

  const reasons = [];
  if (!text || text.length < 20) reasons.push("question_too_short");
  if (text.length > 420) reasons.push("question_too_long");
  if (options.length !== 4) reasons.push("invalid_option_count");
  if (options.some((option) => option.length < 1)) reasons.push("empty_option");
  if (options.some((option) => option.length > 180)) reasons.push("option_too_long");
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) reasons.push("duplicate_options");
  if (!explanation || explanation.length < 15) reasons.push("explanation_too_short");
  if (hasNoise(combined)) reasons.push("noise_pattern");
  if (/ðŸ|â|Â/.test(combined)) reasons.push("encoding_artifacts");

  return {
    usable: reasons.length === 0,
    reasons,
    normalized: {
      ...question,
      questionText: text,
      options,
      explanation,
    },
  };
}

async function getJsonFiles(rootDir) {
  const providers = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const provider of providers) {
    if (!provider.isDirectory()) continue;
    const providerDir = path.join(rootDir, provider.name);
    const entries = await fs.readdir(providerDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(path.join(providerDir, entry.name));
      }
    }
  }
  return files.sort();
}

function classifyFile(stats) {
  const usableRatio = stats.totalQuestions === 0 ? 0 : stats.usableQuestions / stats.totalQuestions;
  const noisyRatio = stats.totalQuestions === 0 ? 1 : stats.noisyQuestions / stats.totalQuestions;

  if (usableRatio >= 0.8 && noisyRatio <= 0.12) return "approved";
  if (usableRatio >= 0.55 && noisyRatio <= 0.35) return "review";
  return "rejected";
}

async function main() {
  const files = await getJsonFiles(RAW_DIR);
  await fs.mkdir(REVIEW_DIR, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
    approvedFiles: 0,
    reviewFiles: 0,
    rejectedFiles: 0,
    files: [],
  };

  const approvedMaster = [];
  const reviewQueue = [];
  const rejected = [];

  for (const filePath of files) {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    const provider = String(raw.provider ?? path.basename(path.dirname(filePath)));
    const model = String(raw.model ?? "unknown");
    const topic = String(raw.topic ?? "Unknown Topic");
    const questions = Array.isArray(raw.questions)
      ? raw.questions
      : Array.isArray(raw.parsed?.questions)
        ? raw.parsed.questions
        : [];

    const reviewed = questions.filter(isValidQuestionShape).map(reviewQuestion);
    const usableQuestions = reviewed.filter((item) => item.usable).map((item) => item.normalized);
    const noisyQuestions = reviewed.filter((item) => item.reasons.includes("noise_pattern") || item.reasons.includes("encoding_artifacts")).length;

    const reasonCounts = {};
    for (const item of reviewed) {
      for (const reason of item.reasons) {
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      }
    }

    const stats = {
      filePath: path.relative(path.join(__dirname, ".."), filePath).replace(/\\/g, "/"),
      provider,
      model,
      topic,
      totalQuestions: questions.length,
      validShapeQuestions: reviewed.length,
      usableQuestions: usableQuestions.length,
      noisyQuestions,
      rejectedQuestions: reviewed.length - usableQuestions.length,
      usableRatio: Number((questions.length ? usableQuestions.length / questions.length : 0).toFixed(3)),
      noisyRatio: Number((questions.length ? noisyQuestions / questions.length : 0).toFixed(3)),
      topFailureReasons: Object.entries(reasonCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
    };

    const status = classifyFile(stats);
    stats.status = status;
    report.files.push(stats);

    if (status === "approved") {
      report.approvedFiles += 1;
      approvedMaster.push({
        provider,
        model,
        topic,
        subject: raw.subject ?? "aptitude",
        category: raw.category ?? "general",
        difficulty: raw.difficulty ?? "medium",
        generatedAt: raw.generatedAt ?? new Date().toISOString(),
        cost: raw.cost ?? { inr: 0 },
        questions: usableQuestions,
      });
    } else if (status === "review") {
      report.reviewFiles += 1;
      reviewQueue.push({
        ...stats,
        sampleRejected: reviewed
          .filter((item) => !item.usable)
          .slice(0, 3)
          .map((item) => ({
            questionText: item.normalized.questionText.slice(0, 200),
            reasons: item.reasons,
          })),
      });
    } else {
      report.rejectedFiles += 1;
      rejected.push({
        ...stats,
        sampleRejected: reviewed
          .filter((item) => !item.usable)
          .slice(0, 3)
          .map((item) => ({
            questionText: item.normalized.questionText.slice(0, 200),
            reasons: item.reasons,
          })),
      });
    }
  }

  await fs.writeFile(path.join(REVIEW_DIR, "file_review_report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(REVIEW_DIR, "approved_master.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sets: approvedMaster }, null, 2));
  await fs.writeFile(path.join(REVIEW_DIR, "review_queue.json"), JSON.stringify({ generatedAt: new Date().toISOString(), files: reviewQueue }, null, 2));
  await fs.writeFile(path.join(REVIEW_DIR, "rejected_files.json"), JSON.stringify({ generatedAt: new Date().toISOString(), files: rejected }, null, 2));

  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    totalFiles: report.totalFiles,
    approvedFiles: report.approvedFiles,
    reviewFiles: report.reviewFiles,
    rejectedFiles: report.rejectedFiles,
    approvedMaster: path.join(REVIEW_DIR, "approved_master.json"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
