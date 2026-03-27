import fs from "node:fs";
import path from "node:path";

import { MongoClient } from "mongodb";

const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "../docs/pilot-mvp");

function parseArgs(argv) {
  const args = {
    dryRun: false,
    limit: 0,
    reportPath: "",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length)) || 0;
    else if (arg.startsWith("--report-path=")) args.reportPath = arg.slice("--report-path=".length);
  }

  return args;
}

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenize(value) {
  return [...new Set(normalize(value).split(/\s+/).filter((token) => token.length >= 2))];
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

const TOPIC_PATTERNS = [
  { key: "sql", labels: ["sql", "joins", "mysql", "postgres", "database queries"] },
  { key: "dbms", labels: ["dbms", "database management", "normalization", "transaction", "acid"] },
  { key: "os", labels: ["operating system", "os", "deadlock", "paging", "cpu scheduling"] },
  { key: "networking", labels: ["network", "computer networks", "tcp", "udp", "osi", "routing"] },
  { key: "dsa", labels: ["dsa", "data structures", "algorithm", "array", "linked list", "tree", "graph", "dynamic programming"] },
  { key: "aptitude", labels: ["aptitude", "quant", "quantitative", "percentage", "ratio", "reasoning", "number system"] },
  { key: "verbal", labels: ["verbal", "grammar", "english", "reading comprehension", "sentence correction"] },
  { key: "python", labels: ["python", "pandas", "numpy"] },
  { key: "java", labels: ["java", "jvm", "spring"] },
  { key: "c programming", labels: ["c programming", "c language"] },
  { key: "oops", labels: ["oops", "oop", "object oriented", "inheritance", "polymorphism"] },
  { key: "data science", labels: ["data science", "machine learning", "statistics"] },
  { key: "cloud", labels: ["cloud", "aws", "azure", "gcp", "devops"] },
  { key: "interview preparation", labels: ["interview", "hr", "resume", "behavioral"] },
];

const BRANCH_PATTERNS = [
  { key: "computer science", labels: ["computer", "cse", "software", "dsa", "dbms", "sql", "os", "networking"] },
  { key: "information technology", labels: ["information technology", "it", "web", "cloud", "software"] },
  { key: "electronics", labels: ["electronics", "ece", "vlsi", "signals", "digital electronics", "analog electronics"] },
  { key: "electrical", labels: ["electrical", "eee", "power systems", "machines", "circuits"] },
  { key: "mechanical", labels: ["mechanical", "thermodynamics", "manufacturing", "som", "fluid mechanics"] },
  { key: "civil", labels: ["civil", "surveying", "geotechnical", "structure", "transportation engineering"] },
];

function inferTopics(haystack) {
  const hits = new Set();
  for (const pattern of TOPIC_PATTERNS) {
    if (pattern.labels.some((label) => haystack.includes(normalize(label)))) {
      hits.add(pattern.key);
    }
  }
  return [...hits];
}

function inferBranches(haystack) {
  const hits = new Set();
  for (const pattern of BRANCH_PATTERNS) {
    if (pattern.labels.some((label) => haystack.includes(normalize(label)))) {
      hits.add(pattern.key);
    }
  }
  return [...hits];
}

function inferQuality(resource) {
  let score = 0;
  if (String(resource.summaryShort ?? "").trim()) score += 2;
  if (String(resource.description ?? "").trim().length > 80) score += 1;
  if (Array.isArray(resource.keyTopics) && resource.keyTopics.length > 0) score += 1;
  if (resource.thumbnail_url || resource.thumbnailUrl) score += 1;
  if (Number(resource.duration_sec ?? resource.durationSec ?? 0) > 0) score += 1;
  if (String(resource.resource_type ?? resource.resourceType ?? "").toLowerCase() === "pdf") score += 1;
  if ((String(resource.one_page_triage_bucket ?? resource.onePageTriageBucket ?? "")).toLowerCase() === "review") score -= 1;
  if ((String(resource.one_page_triage_bucket ?? resource.onePageTriageBucket ?? "")).toLowerCase() === "hide") score -= 4;
  return Math.max(score, 0);
}

function confidenceBucket(topicHits, branchHits) {
  const total = topicHits.length + branchHits.length;
  if (total >= 4) return { confidence: "high", risk: "low" };
  if (total >= 2) return { confidence: "medium", risk: "medium" };
  return { confidence: "low", risk: "high" };
}

function buildResourceInference(resource) {
  const title = String(resource.title ?? "");
  const description = String(resource.description ?? "");
  const url = String(resource.url ?? "");
  const summaryShort = String(resource.summaryShort ?? resource.summary_short ?? "");
  const existingSearchIndex = resource.search_index && typeof resource.search_index === "object" ? resource.search_index : {};
  const existingKeyTopics = Array.isArray(existingSearchIndex.key_topics) ? existingSearchIndex.key_topics.map((v) => String(v)) : [];
  const existingKeywords = Array.isArray(existingSearchIndex.keywords) ? existingSearchIndex.keywords.map((v) => String(v)) : [];
  const haystack = normalize([title, description, url, summaryShort, ...existingKeyTopics, ...existingKeywords].join(" "));
  const inferredTopics = inferTopics(haystack);
  const inferredBranches = inferBranches(haystack);
  const qualityScore = inferQuality(resource);
  const confidence = confidenceBucket(inferredTopics, inferredBranches);

  const mergedKeyTopics = uniqueStrings([...existingKeyTopics, ...inferredTopics]);
  const mergedKeywords = uniqueStrings([...existingKeywords, ...inferredTopics, ...inferredBranches, ...tokenize(title).slice(0, 6)]);

  const updates = {};
  if (mergedKeyTopics.length > existingKeyTopics.length) updates["search_index.key_topics"] = mergedKeyTopics;
  if (mergedKeywords.length > existingKeywords.length) updates["search_index.keywords"] = mergedKeywords;
  updates["recommendation_backfill.v1"] = {
    updated_at: new Date().toISOString(),
    inferredTopics,
    inferredBranches,
    qualityScore,
    confidence: confidence.confidence,
    risk: confidence.risk,
    source: "backfill-recommendation-metadata",
  };

  return {
    id: String(resource.id),
    title,
    inferredTopics,
    inferredBranches,
    qualityScore,
    confidence: confidence.confidence,
    risk: confidence.risk,
    updates,
    changed: Object.keys(updates).length > 1 || Object.keys(updates)[0] !== "recommendation_backfill.v1",
  };
}

function buildMockInference(mockTest, companyMatchers, topicMatchers) {
  const title = String(mockTest.title ?? "");
  const haystack = normalize(title);
  const companyMatches = companyMatchers.filter((item) => haystack.includes(item.normalized));
  const topicMatches = topicMatchers.filter((item) => haystack.includes(item.normalized));

  const updates = {};
  let confidence = "low";
  let risk = "high";

  if (!mockTest.company_id && companyMatches.length === 1) {
    updates.company_id = companyMatches[0].id;
    confidence = "high";
    risk = "low";
  }

  if (!mockTest.topic_id && topicMatches.length === 1) {
    updates.topic_id = topicMatches[0].id;
    confidence = confidence === "high" ? "high" : "medium";
    risk = confidence === "high" ? "low" : "medium";
  }

  if ((!mockTest.difficulty || String(mockTest.difficulty).trim() === "") && /\b(advanced|hard)\b/i.test(title)) {
    updates.difficulty = "hard";
  } else if ((!mockTest.difficulty || String(mockTest.difficulty).trim() === "") && /\b(beginner|easy|starter)\b/i.test(title)) {
    updates.difficulty = "easy";
  }

  updates.recommendation_backfill = {
    updated_at: new Date().toISOString(),
    inferredCompanyNames: companyMatches.map((item) => item.name),
    inferredTopicNames: topicMatches.map((item) => item.name),
    confidence,
    risk,
    source: "backfill-recommendation-metadata",
  };

  return {
    id: String(mockTest.id),
    title,
    inferredCompanyNames: companyMatches.map((item) => item.name),
    inferredTopicNames: topicMatches.map((item) => item.name),
    confidence,
    risk,
    updates,
    changed: Object.keys(updates).some((key) => key !== "recommendation_backfill"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const [sharedResources, tenantResources, mockTests, companies, topics] = await Promise.all([
      db.collection("shared_resources").find({}, { projection: { _id: 0, id: 1, title: 1, description: 1, url: 1, summaryShort: 1, summary_short: 1, resource_type: 1, duration_sec: 1, search_index: 1, thumbnail_url: 1, one_page_triage_bucket: 1 } }).limit(args.limit || 5000).toArray(),
      db.collection("resources").find({}, { projection: { _id: 0, id: 1, title: 1, description: 1, url: 1, summaryShort: 1, summary_short: 1, resource_type: 1, duration_sec: 1, search_index: 1, thumbnail_url: 1, one_page_triage_bucket: 1, tenant_id: 1 } }).limit(args.limit || 5000).toArray(),
      db.collection("mock_tests").find({}, { projection: { _id: 0, id: 1, title: 1, company_id: 1, topic_id: 1, difficulty: 1, tenant_id: 1 } }).limit(args.limit || 5000).toArray(),
      db.collection("companies").find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
      db.collection("topics").find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
    ]);

    const companyMatchers = companies
      .map((company) => ({ id: String(company.id), name: String(company.name ?? ""), normalized: normalize(company.name) }))
      .filter((company) => company.normalized.length >= 4)
      .sort((left, right) => right.normalized.length - left.normalized.length);
    const topicMatchers = topics
      .map((topic) => ({ id: String(topic.id), name: String(topic.name ?? ""), normalized: normalize(topic.name) }))
      .filter((topic) => topic.normalized.length >= 3)
      .sort((left, right) => right.normalized.length - left.normalized.length);

    const resourceReports = [
      ...sharedResources.map((resource) => ({ collection: "shared_resources", tenantId: null, inference: buildResourceInference(resource) })),
      ...tenantResources.map((resource) => ({ collection: "resources", tenantId: String(resource.tenant_id ?? ""), inference: buildResourceInference(resource) })),
    ];

    const mockReports = mockTests.map((mockTest) => ({
      tenantId: String(mockTest.tenant_id ?? ""),
      inference: buildMockInference(mockTest, companyMatchers, topicMatchers),
    }));

    if (!args.dryRun) {
      for (const item of resourceReports.filter((entry) => entry.inference.changed)) {
        await db.collection(item.collection).updateOne(
          { id: item.inference.id },
          { $set: item.inference.updates },
        );
      }
      for (const item of mockReports.filter((entry) => entry.inference.changed)) {
        await db.collection("mock_tests").updateOne(
          { id: item.inference.id },
          { $set: item.inference.updates },
        );
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      dryRun: args.dryRun,
      summary: {
        sharedResourcesScanned: sharedResources.length,
        tenantResourcesScanned: tenantResources.length,
        mockTestsScanned: mockTests.length,
        resourcesUpdated: resourceReports.filter((item) => item.inference.changed).length,
        mocksUpdated: mockReports.filter((item) => item.inference.changed).length,
        unresolvedResources: resourceReports.filter((item) => item.inference.risk !== "low").length,
        unresolvedMocks: mockReports.filter((item) => item.inference.risk !== "low").length,
      },
      updatedResources: resourceReports.filter((item) => item.inference.changed).slice(0, 250).map((item) => ({
        collection: item.collection,
        id: item.inference.id,
        title: item.inference.title,
        confidence: item.inference.confidence,
        risk: item.inference.risk,
        inferredTopics: item.inference.inferredTopics,
        inferredBranches: item.inference.inferredBranches,
        qualityScore: item.inference.qualityScore,
        updatedFields: Object.keys(item.inference.updates),
      })),
      unresolvedResources: resourceReports.filter((item) => item.inference.risk !== "low").slice(0, 250).map((item) => ({
        collection: item.collection,
        id: item.inference.id,
        title: item.inference.title,
        confidence: item.inference.confidence,
        risk: item.inference.risk,
        inferredTopics: item.inference.inferredTopics,
        inferredBranches: item.inference.inferredBranches,
      })),
      updatedMockTests: mockReports.filter((item) => item.inference.changed).slice(0, 250).map((item) => ({
        id: item.inference.id,
        title: item.inference.title,
        confidence: item.inference.confidence,
        risk: item.inference.risk,
        inferredCompanyNames: item.inference.inferredCompanyNames,
        inferredTopicNames: item.inference.inferredTopicNames,
        updatedFields: Object.keys(item.inference.updates),
      })),
      unresolvedMockTests: mockReports.filter((item) => item.inference.risk !== "low").slice(0, 250).map((item) => ({
        id: item.inference.id,
        title: item.inference.title,
        confidence: item.inference.confidence,
        risk: item.inference.risk,
        inferredCompanyNames: item.inference.inferredCompanyNames,
        inferredTopicNames: item.inference.inferredTopicNames,
      })),
    };

    const reportDir = args.reportPath
      ? path.dirname(path.resolve(process.cwd(), args.reportPath))
      : DEFAULT_REPORT_DIR;
    fs.mkdirSync(reportDir, { recursive: true });
    const outputPath = args.reportPath
      ? path.resolve(process.cwd(), args.reportPath)
      : path.join(reportDir, `metadata-backfill-report-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

    console.log(JSON.stringify({
      ok: true,
      dryRun: args.dryRun,
      outputPath,
      summary: report.summary,
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
