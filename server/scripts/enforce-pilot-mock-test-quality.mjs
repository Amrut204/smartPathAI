import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
const REPORT_PATH = path.resolve(process.cwd(), "../analysis_output/pilot_mock_quality_report.json");

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || !argv.includes("--confirm");
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const rows = await db.collection("mock_tests").aggregate([
      {
        $project: {
          id: 1,
          title: 1,
          tenant_id: 1,
          is_active: 1,
          questionCount: { $size: { $ifNull: ["$questions", []] } },
        },
      },
      { $sort: { questionCount: 1, title: 1 } },
    ]).toArray();

    const disableCandidates = rows.filter((row) => Number(row.questionCount ?? 0) <= 5);
    const studentHiddenButActive = rows.filter((row) => {
      const count = Number(row.questionCount ?? 0);
      return count > 5 && count < 10 && Boolean(row.is_active);
    });

    if (!dryRun && disableCandidates.length > 0) {
      await db.collection("mock_tests").updateMany(
        { id: { $in: disableCandidates.map((row) => String(row.id)) } },
        { $set: { is_active: false, updated_at: new Date().toISOString() } },
      );
    }

    const report = {
      generatedAt: new Date().toISOString(),
      dryRun,
      totalTests: rows.length,
      disableCandidateCount: disableCandidates.length,
      studentHiddenButActiveCount: studentHiddenButActive.length,
      disableCandidates: disableCandidates.map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ""),
        tenantId: row.tenant_id ? String(row.tenant_id) : null,
        isActive: Boolean(row.is_active),
        questionCount: Number(row.questionCount ?? 0),
      })),
      studentHiddenButActive: studentHiddenButActive.map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ""),
        tenantId: row.tenant_id ? String(row.tenant_id) : null,
        isActive: Boolean(row.is_active),
        questionCount: Number(row.questionCount ?? 0),
      })),
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
