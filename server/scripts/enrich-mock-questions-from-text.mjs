import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MongoClient } from "mongodb";

const IMPORT_SOURCE = "material_analysis_v1";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    tenantSlug: "apex",
    tenantId: "",
    materialDir: "",
    ocrDir: "",
    minQuestions: 5,
    limit: 0,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--tenant-slug=")) args.tenantSlug = arg.slice("--tenant-slug=".length);
    else if (arg.startsWith("--tenant-id=")) args.tenantId = arg.slice("--tenant-id=".length);
    else if (arg.startsWith("--material-dir=")) args.materialDir = arg.slice("--material-dir=".length);
    else if (arg.startsWith("--ocr-dir=")) args.ocrDir = arg.slice("--ocr-dir=".length);
    else if (arg.startsWith("--min-questions=")) args.minQuestions = Math.max(1, Number(arg.slice("--min-questions=".length)) || 5);
    else if (arg.startsWith("--limit=")) args.limit = Math.max(0, Number(arg.slice("--limit=".length)) || 0);
  }

  return args;
}

function normalizeLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

function isQuestionStart(line, nextLine = "") {
  const numbered = /^(?:q(?:uestion)?\s*)?\d{1,3}\s*[\).:-]\s+.+/i.test(line);
  if (numbered) return true;

  if (line.endsWith("?")) {
    const hasOptionSoon = /^(?:\(?[A-Da-d]\)?[\).:-]|\d{1,2}[\).:-])\s+/.test(nextLine);
    return hasOptionSoon;
  }

  return false;
}

function cleanQuestionPrefix(line) {
  return line.replace(/^(?:q(?:uestion)?\s*)?\d{1,3}\s*[\).:-]\s*/i, "").trim();
}

function parseOption(line) {
  const matched = line.match(/^(?:\(?([A-Da-d])\)?[\).:-]|\d{1,2}[\).:-])\s+(.+)$/);
  if (!matched) return null;
  return matched[2].trim();
}

function findLocalAnswer(blockLines) {
  for (const line of blockLines) {
    const m = line.match(/\banswer\s*[:\-]?\s*([A-Da-d])\b/i);
    if (m) return m[1].toUpperCase();
  }
  return "";
}

function parseQuestionsFromText(content, maxQuestions = 40) {
  const lines = normalizeLines(content);
  const questions = [];

  let i = 0;
  while (i < lines.length && questions.length < maxQuestions) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : "";

    if (!isQuestionStart(line, nextLine)) {
      i += 1;
      continue;
    }

    let questionText = cleanQuestionPrefix(line);
    const blockLines = [line];
    const options = [];

    i += 1;

    while (i < lines.length) {
      const current = lines[i];
      const future = i + 1 < lines.length ? lines[i + 1] : "";

      if (isQuestionStart(current, future) && options.length >= 2) {
        break;
      }

      const parsedOption = parseOption(current);
      if (parsedOption !== null) {
        options.push(parsedOption);
        blockLines.push(current);
        i += 1;

        while (i < lines.length) {
          const continuation = lines[i];
          if (isQuestionStart(continuation, i + 1 < lines.length ? lines[i + 1] : "")) break;
          if (parseOption(continuation) !== null) break;
          if (/^\banswer\b/i.test(continuation)) break;

          if (continuation.length < 300 && options.length > 0) {
            options[options.length - 1] = `${options[options.length - 1]} ${continuation}`.trim();
            blockLines.push(continuation);
            i += 1;
            continue;
          }
          break;
        }
        continue;
      }

      if (options.length === 0 && current.length < 260) {
        questionText = `${questionText} ${current}`.trim();
        blockLines.push(current);
        i += 1;
        continue;
      }

      blockLines.push(current);
      i += 1;
    }

    const uniqueOptions = Array.from(new Set(options.map((opt) => opt.trim()).filter(Boolean))).slice(0, 4);
    if (uniqueOptions.length < 2 || questionText.length < 8) {
      continue;
    }

    const localAnswer = findLocalAnswer(blockLines);
    let correctIndex = 0;
    if (localAnswer) {
      const idx = localAnswer.charCodeAt(0) - 65;
      if (idx >= 0 && idx < uniqueOptions.length) correctIndex = idx;
    }

    questions.push({
      text: questionText,
      options: uniqueOptions,
      correctIndex,
      explanation: "Auto-extracted from text source. Verify correctness before final use.",
    });
  }

  return questions;
}

function listTxtInDirectory(dirPath) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".txt"))
    .map((name) => path.join(dirPath, name));
}

function findTextCandidates(materialRoot, sourcePdf, ocrRoot = "") {
  const absPdf = path.join(materialRoot, sourcePdf);
  const pdfDir = path.dirname(absPdf);
  const baseNoExt = path.basename(absPdf, path.extname(absPdf));
  const candidates = [];

  const directTxt = path.join(pdfDir, `${baseNoExt}.txt`);
  if (fs.existsSync(directTxt)) candidates.push(directTxt);

  listTxtInDirectory(pdfDir).forEach((p) => candidates.push(p));

  const testsSubdir = path.join(pdfDir, "TESTS");
  listTxtInDirectory(testsSubdir).forEach((p) => candidates.push(p));

  if (ocrRoot) {
    const relTxt = sourcePdf.replace(/\.pdf$/i, ".txt");
    const ocrMapped = path.join(ocrRoot, relTxt);
    if (fs.existsSync(ocrMapped)) candidates.push(ocrMapped);
  }

  return Array.from(new Set(candidates));
}

function isPlaceholder(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return true;
  if (questions.length !== 1) return false;

  const first = questions[0];
  if (!first || typeof first !== "object") return true;
  const text = String(first.text ?? "").toLowerCase();
  const explanation = String(first.explanation ?? "").toLowerCase();

  return text.startsWith("placeholder question for") || explanation.includes("auto-generated placeholder");
}

async function resolveTenant(db, args) {
  if (args.tenantId) {
    const byId = await db.collection("tenants").findOne({ id: args.tenantId }, { projection: { _id: 0, id: 1, slug: 1 } });
    if (byId) return byId;
  }

  if (args.tenantSlug) {
    const bySlug = await db.collection("tenants").findOne({ slug: args.tenantSlug }, { projection: { _id: 0, id: 1, slug: 1 } });
    if (bySlug) return bySlug;
  }

  return db.collection("tenants").findOne({}, { projection: { _id: 0, id: 1, slug: 1 } });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const materialRoot = args.materialDir
    ? path.resolve(process.cwd(), args.materialDir)
    : path.resolve(scriptDir, "../../material");
  const ocrRoot = args.ocrDir ? path.resolve(process.cwd(), args.ocrDir) : "";

  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";

  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const tenant = await resolveTenant(db, args);
    if (!tenant) {
      throw new Error("No tenant found.");
    }

    const tenantId = String(tenant.id);
    const filter = {
      tenant_id: tenantId,
      import_source: IMPORT_SOURCE,
      source_pdf: { $exists: true, $type: "string" },
    };

    const docs = await db.collection("mock_tests").find(
      filter,
      { projection: { _id: 0, id: 1, title: 1, source_pdf: 1, questions: 1 } },
    ).toArray();

    const candidates = docs.filter((doc) => isPlaceholder(doc.questions));
    const scoped = args.limit > 0 ? candidates.slice(0, args.limit) : candidates;

    let updated = 0;
    let skippedNoText = 0;
    let skippedLowQuality = 0;
    let parsedFromText = 0;

    const reportRows = [];
    for (const doc of scoped) {
      const sourcePdf = String(doc.source_pdf);
      const textCandidates = findTextCandidates(materialRoot, sourcePdf, ocrRoot);

      let best = { count: 0, filePath: "", questions: [] };

      for (const txtPath of textCandidates) {
        const content = fs.readFileSync(txtPath, "utf8");
        const extracted = parseQuestionsFromText(content, 40);
        if (extracted.length > best.count) {
          best = {
            count: extracted.length,
            filePath: txtPath,
            questions: extracted,
          };
        }
      }

      if (textCandidates.length === 0) {
        skippedNoText += 1;
        reportRows.push({
          testId: String(doc.id),
          title: String(doc.title ?? ""),
          sourcePdf,
          status: "skipped_no_text_file",
          questionsExtracted: 0,
          textFile: "",
        });
        continue;
      }

      if (best.count < args.minQuestions) {
        skippedLowQuality += 1;
        reportRows.push({
          testId: String(doc.id),
          title: String(doc.title ?? ""),
          sourcePdf,
          status: "skipped_low_extraction",
          questionsExtracted: best.count,
          textFile: best.filePath,
        });
        continue;
      }

      const relativeTextFile = path
        .relative(materialRoot, best.filePath)
        .split(path.sep)
        .join("/");

      if (!args.dryRun) {
        await db.collection("mock_tests").updateOne(
          { id: String(doc.id), tenant_id: tenantId },
          {
            $set: {
              questions: best.questions,
              question_source: "text_extracted_v1",
              question_text_file: relativeTextFile,
              updated_at: new Date().toISOString(),
            },
          },
        );
      }

      parsedFromText += 1;
      updated += 1;
      reportRows.push({
        testId: String(doc.id),
        title: String(doc.title ?? ""),
        sourcePdf,
        status: args.dryRun ? "would_update" : "updated",
        questionsExtracted: best.count,
        textFile: best.filePath,
      });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.dryRun ? "dry_run" : "write",
      tenantId,
      totalImportedMockTests: docs.length,
      placeholderCandidates: candidates.length,
      processed: scoped.length,
      updated,
      parsedFromText,
      skippedNoText,
      skippedLowQuality,
      minQuestions: args.minQuestions,
      rows: reportRows,
    };

    const reportPath = path.resolve(scriptDir, "../../material/analysis/mock_question_enrichment_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    console.log("Mock question enrichment complete");
    console.log(`Mode: ${args.dryRun ? "DRY RUN" : "WRITE"}`);
    console.log(`Tenant: ${tenantId}`);
    console.log(`Total imported tests: ${docs.length}`);
    console.log(`Placeholder candidates: ${candidates.length}`);
    console.log(`Processed: ${scoped.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped (no text): ${skippedNoText}`);
    console.log(`Skipped (low extraction): ${skippedLowQuality}`);
    console.log(`Report: ${reportPath}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Enrichment failed:", error);
  process.exitCode = 1;
});

