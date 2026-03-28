import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.join(__dirname, "question_generation", "review", "approved_master.json");

function parseArgs(argv) {
  const args = {
    dryRun: false,
    input: DEFAULT_INPUT,
    status: "approved",
    reviewer: "codex_review_gate",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--input=")) args.input = path.resolve(process.cwd(), arg.slice("--input=".length));
    else if (arg.startsWith("--status=")) args.status = arg.slice("--status=".length);
    else if (arg.startsWith("--reviewer=")) args.reviewer = arg.slice("--reviewer=".length);
  }

  return args;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hashKey(question) {
  return [
    String(question.topic ?? "").toLowerCase(),
    String(question.difficulty ?? "medium").toLowerCase(),
    normalizeText(question.questionText ?? question.question).toLowerCase(),
    (Array.isArray(question.options) ? question.options : Object.values(question.options ?? {}))
      .map((option) => normalizeText(option).toLowerCase())
      .join("|"),
  ].join("||");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(await fs.readFile(args.input, "utf8"));
  const sets = Array.isArray(raw.sets) ? raw.sets : [];

  const hashes = [];
  for (const set of sets) {
    const topic = String(set.topic ?? "");
    const difficulty = String(set.difficulty ?? "medium").toLowerCase();
    for (const question of Array.isArray(set.questions) ? set.questions : []) {
      hashes.push(hashKey({ ...question, topic, difficulty }));
    }
  }

  const uniqueHashes = [...new Set(hashes)];
  const client = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
  await client.connect();

  try {
    const db = client.db(process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev");
    const questionBank = db.collection("question_bank_items");
    const now = new Date().toISOString();

    const matched = await questionBank.countDocuments({ questionHash: { $in: uniqueHashes } });
    let modified = 0;

    if (!args.dryRun && uniqueHashes.length > 0) {
      const result = await questionBank.updateMany(
        { questionHash: { $in: uniqueHashes } },
        {
          $set: {
            status: args.status,
            reviewed_by: args.reviewer,
            reviewed_at: now,
            review_notes: "Approved by generated-question review gate.",
            updated_at: now,
          },
        },
      );
      modified = Number(result.modifiedCount ?? 0);
    }

    console.log(JSON.stringify({
      mode: args.dryRun ? "DRY_RUN" : "WRITE",
      input: args.input,
      approvedQuestionHashes: uniqueHashes.length,
      matchedQuestions: matched,
      modifiedQuestions: modified,
      promotedStatus: args.status,
      reviewer: args.reviewer,
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
