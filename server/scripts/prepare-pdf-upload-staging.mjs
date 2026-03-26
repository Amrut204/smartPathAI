import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const DEFAULT_OUTPUT_FOLDER = "upload_staging";
const DEFAULT_EXCLUDED_DIRS = new Set([
  "analysis",
  "upload_staging",
  "scrapedData",
  "node_modules",
  ".git",
]);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    materialRoot: "",
    outputFolder: DEFAULT_OUTPUT_FOLDER,
    mode: "copy",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--material-root=")) {
      args.materialRoot = arg.slice("--material-root=".length);
    } else if (arg.startsWith("--output-folder=")) {
      args.outputFolder = arg.slice("--output-folder=".length);
    } else if (arg.startsWith("--mode=")) {
      args.mode = arg.slice("--mode=".length);
    }
  }

  if (!["copy", "move"].includes(args.mode)) {
    throw new Error(`Invalid mode '${args.mode}'. Use copy or move.`);
  }

  return args;
}

function resolveMaterialRoot(customRoot) {
  if (customRoot) return path.resolve(process.cwd(), customRoot);

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(scriptDir, "../../material"),
    path.resolve(process.cwd(), "../material"),
    path.resolve(process.cwd(), "material"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? candidates[0];
}

function toPosixRelative(filePath, basePath) {
  return path.relative(basePath, filePath).split(path.sep).join("/");
}

function slugify(value) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return normalized || "untitled";
}

function classifyTopic(relativePath) {
  const text = relativePath.toLowerCase();

  const rules = [
    { key: "profit_loss", regex: /(profit|loss|discount|markup|mark[- ]?down)/i },
    { key: "time_work", regex: /(time.*work|pipes|cistern|work.*time)/i },
    { key: "percentages", regex: /(percentage|percent|ratio|proportion)/i },
    { key: "number_system", regex: /(number.system|hcf|lcm|simplification|surds)/i },
    { key: "probability_permutation", regex: /(probability|permutation|combination)/i },
    { key: "data_structures_algorithms", regex: /(dsa|algorithm|array|graph|tree|linked.?list|stack|queue|dp)/i },
    { key: "operating_systems", regex: /(operating.system|\\bos\\b|process|thread|deadlock|scheduling)/i },
    { key: "dbms_sql", regex: /(dbms|database|sql|normalization|transaction)/i },
    { key: "computer_networks", regex: /(computer.network|networking|tcp|udp|osi|ip|subnet)/i },
    { key: "verbal_ability", regex: /(verbal|grammar|vocabulary|synonym|antonym|reading.comprehension)/i },
    { key: "logical_reasoning", regex: /(reasoning|puzzle|seating|blood.relation|coding.decoding)/i },
    { key: "mock_test", regex: /(mock|test.series|practice.test|placement.paper)/i },
    { key: "company_specific", regex: /(accenture|infosys|tcs|wipro|cognizant|capgemini|ibm|amazon|microsoft)/i },
  ];

  for (const rule of rules) {
    if (rule.regex.test(text)) return rule.key;
  }

  return "general_aptitude";
}

function collectPdfFiles(rootPath, excludedDirNames) {
  const results = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (excludedDirNames.has(entry.name)) continue;
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".pdf")) continue;
      results.push(absolutePath);
    }
  }

  walk(rootPath);
  return results.sort((a, b) => a.localeCompare(b));
}

function sha1File(filePath) {
  const hash = createHash("sha1");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function buildCsv(rows) {
  const header = [
    "topic",
    "source",
    "original_relative_path",
    "staged_relative_path",
    "sha1",
    "size_bytes",
    "action",
  ];

  const escapeCell = (value) => {
    const text = String(value ?? "");
    if (!text.includes(",") && !text.includes("\"") && !text.includes("\n")) return text;
    return `"${text.replace(/"/g, "\"\"")}"`;
  };

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([
      row.topic,
      row.source,
      row.originalRelativePath,
      row.stagedRelativePath,
      row.sha1,
      row.sizeBytes,
      row.action,
    ].map(escapeCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const materialRoot = resolveMaterialRoot(args.materialRoot);
  const outputRoot = path.join(materialRoot, args.outputFolder);

  if (!fs.existsSync(materialRoot)) {
    throw new Error(`Material root not found: ${materialRoot}`);
  }

  const pdfFiles = collectPdfFiles(materialRoot, DEFAULT_EXCLUDED_DIRS);
  const seenByHash = new Map();
  const manifestRows = [];

  let copied = 0;
  let moved = 0;
  let duplicateSkipped = 0;
  let alreadyExists = 0;

  for (const absolutePath of pdfFiles) {
    const relativePath = toPosixRelative(absolutePath, materialRoot);
    const relativeParts = relativePath.split("/");
    const sourceName = relativeParts[0] || "unknown_source";
    const baseName = path.basename(relativePath, ".pdf");
    const topic = classifyTopic(relativePath);
    const sourceSlug = slugify(sourceName);
    const titleSlug = slugify(baseName);
    const fileStat = fs.statSync(absolutePath);
    const sha1 = sha1File(absolutePath);
    const shortHash = sha1.slice(0, 10);

    const stagedFileName = `${topic}__${sourceSlug}__${titleSlug}__${shortHash}.pdf`;
    const stagedDir = path.join(outputRoot, topic);
    const stagedAbsolutePath = path.join(stagedDir, stagedFileName);
    const stagedRelativePath = toPosixRelative(stagedAbsolutePath, materialRoot);

    if (seenByHash.has(sha1)) {
      duplicateSkipped += 1;
      manifestRows.push({
        topic,
        source: sourceSlug,
        originalRelativePath: relativePath,
        stagedRelativePath: seenByHash.get(sha1),
        sha1,
        sizeBytes: fileStat.size,
        action: "duplicate_skipped",
      });
      continue;
    }

    const destinationExists = fs.existsSync(stagedAbsolutePath);
    if (!args.dryRun) {
      fs.mkdirSync(stagedDir, { recursive: true });
      if (!destinationExists) {
        if (args.mode === "move") {
          fs.renameSync(absolutePath, stagedAbsolutePath);
          moved += 1;
        } else {
          fs.copyFileSync(absolutePath, stagedAbsolutePath);
          copied += 1;
        }
      } else {
        alreadyExists += 1;
      }
    } else if (destinationExists) {
      alreadyExists += 1;
    } else if (args.mode === "move") {
      moved += 1;
    } else {
      copied += 1;
    }

    seenByHash.set(sha1, stagedRelativePath);
    manifestRows.push({
      topic,
      source: sourceSlug,
      originalRelativePath: relativePath,
      stagedRelativePath,
      sha1,
      sizeBytes: fileStat.size,
      action: destinationExists ? "already_exists" : (args.mode === "move" ? "moved" : "copied"),
    });
  }

  if (!args.dryRun) {
    fs.mkdirSync(outputRoot, { recursive: true });
    const manifestJsonPath = path.join(outputRoot, "manifest.json");
    const manifestCsvPath = path.join(outputRoot, "manifest.csv");
    fs.writeFileSync(manifestJsonPath, `${JSON.stringify(manifestRows, null, 2)}\n`, "utf8");
    fs.writeFileSync(manifestCsvPath, buildCsv(manifestRows), "utf8");
  }

  console.log("PDF upload staging preparation complete");
  console.log(`Mode: ${args.dryRun ? "DRY_RUN" : "WRITE"} (${args.mode.toUpperCase()})`);
  console.log(`Material root: ${materialRoot}`);
  console.log(`Output folder: ${outputRoot}`);
  console.log(`PDF files scanned: ${pdfFiles.length}`);
  console.log(`Files ${args.mode === "move" ? "moved" : "copied"}: ${args.dryRun ? (args.mode === "move" ? moved : copied) : (args.mode === "move" ? moved : copied)}`);
  console.log(`Duplicates skipped by hash: ${duplicateSkipped}`);
  console.log(`Already existed in staging: ${alreadyExists}`);
  console.log(`Unique staged files: ${seenByHash.size}`);
  if (args.dryRun) {
    console.log("Dry run completed. Re-run without --dry-run to write files and manifest.");
  } else {
    console.log("Manifest files written: upload_staging/manifest.json and upload_staging/manifest.csv");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

