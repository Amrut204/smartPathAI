import "dotenv/config";

import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";

const DEMO_TENANT_SLUG = "st-xaviers-demo";

const client = new MongoClient(MONGO_URI);

function buildAggregate(match) {
  return [
    { $match: { ...match, questions: { $type: "array" } } },
    {
      $project: {
        totalQ: { $size: "$questions" },
        properQ: {
          $size: {
            $filter: {
              input: "$questions",
              as: "q",
              cond: {
                $and: [
                  { $eq: [{ $type: "$$q.text" }, "string"] },
                  { $gt: [{ $strLenCP: { $trim: { input: "$$q.text" } } }, 0] },
                  { $eq: [{ $type: "$$q.options" }, "array"] },
                  { $gte: [{ $size: "$$q.options" }, 2] },
                  { $lte: [{ $size: "$$q.options" }, 8] },
                  { $isNumber: "$$q.correctIndex" },
                  { $gte: ["$$q.correctIndex", 0] },
                  { $lt: ["$$q.correctIndex", { $size: "$$q.options" }] },
                ],
              },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        tests: { $sum: 1 },
        totalQuestions: { $sum: "$totalQ" },
        properQuestions: { $sum: "$properQ" },
      },
    },
  ];
}

async function aggregateCounts(db, match) {
  const rows = await db.collection("mock_tests").aggregate(buildAggregate(match)).toArray();
  return rows[0] || { tests: 0, totalQuestions: 0, properQuestions: 0 };
}

async function main() {
  const timestamp = new Date().toISOString();
  await client.connect();
  const db = client.db(DB_NAME);

  const demoTenant = await db.collection("tenants").findOne(
    { slug: DEMO_TENANT_SLUG },
    { projection: { _id: 0, id: 1, name: 1, slug: 1 } },
  );

  const overall = await aggregateCounts(db, { is_active: true });

  const demo = demoTenant?.id
    ? await aggregateCounts(db, { is_active: true, tenant_id: demoTenant.id })
    : { tests: 0, totalQuestions: 0, properQuestions: 0 };

  console.log(JSON.stringify({
    timestamp,
    db: { name: DB_NAME },
    demoTenant: demoTenant || null,
    overallActiveMockTests: Number(overall.tests || 0),
    overallTotalQuestions: Number(overall.totalQuestions || 0),
    overallProperQuestions: Number(overall.properQuestions || 0),
    demoActiveMockTests: Number(demo.tests || 0),
    demoTotalQuestions: Number(demo.totalQuestions || 0),
    demoProperQuestions: Number(demo.properQuestions || 0),
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("COUNT_FAILED", err?.message || String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await client.close();
    } catch {
      // ignore
    }
  });

