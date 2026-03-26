/**
 * Study Guide Review CLI
 *
 * Quality review and management of generated study guides.
 *
 * Usage:
 *   node --env-file=.env scripts/review-study-guides.mjs --stats
 *   node --env-file=.env scripts/review-study-guides.mjs --list-pending
 *   node --env-file=.env scripts/review-study-guides.mjs --approve <guideId> --score 85
 *   node --env-file=.env scripts/review-study-guides.mjs --reject <guideId> --notes "Low quality"
 *   node --env-file=.env scripts/review-study-guides.mjs --auto-review --threshold=60
 *   node --env-file=.env scripts/review-study-guides.mjs --publish-all-reviewed
 */
import "dotenv/config";
import { MongoClient } from "mongodb";

const args = process.argv.slice(2);

function getFlag(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) {
    const eq = args.find((a) => a.startsWith(`--${name}=`));
    return eq ? eq.split("=")[1] : null;
  }
  return args[idx + 1] || "true";
}

const action = args.find((a) => a.startsWith("--"))?.replace("--", "").split("=")[0];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error("ERROR: MONGODB_URI not set"); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  const dbName = process.env.MONGODB_DB_NAME || "campusdrive_dev";
  const db = client.db(dbName);
  const guides = db.collection("study_guides");
  const costs = db.collection("study_guide_cost_log");

  try {
    switch (action) {
      case "stats": {
        const total = await guides.countDocuments();
        const statusCounts = await guides.aggregate([
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]).toArray();
        const categoryCounts = await guides.aggregate([
          { $group: { _id: "$category", count: { $sum: 1 } } },
        ]).toArray();
        const costData = await costs.aggregate([
          { $group: { _id: null, total: { $sum: "$estimated_cost_usd" }, count: { $sum: 1 } } },
        ]).toArray();

        console.log("\n=== Study Guide Statistics ===");
        console.log(`Total guides: ${total}`);
        console.log("\nBy status:");
        for (const s of statusCounts) console.log(`  ${s._id}: ${s.count}`);
        console.log("\nBy category:");
        for (const c of categoryCounts) console.log(`  ${c._id}: ${c.count}`);
        if (costData[0]) {
          console.log(`\nTotal generation cost: $${costData[0].total.toFixed(4)} (~₹${(costData[0].total * 84).toFixed(2)})`);
          console.log(`Average cost/guide: $${(costData[0].total / costData[0].count).toFixed(5)}`);
        }

        // Quality score distribution for reviewed guides
        const reviewed = await guides.find(
          { quality_score: { $ne: null } },
          { projection: { quality_score: 1 } },
        ).toArray();
        if (reviewed.length > 0) {
          const scores = reviewed.map((g) => g.quality_score);
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          const min = Math.min(...scores);
          const max = Math.max(...scores);
          console.log(`\nQuality scores (${reviewed.length} reviewed):`);
          console.log(`  Average: ${avg.toFixed(1)}`);
          console.log(`  Min: ${min}, Max: ${max}`);
        }

        // Word count stats
        const wordStats = await guides.aggregate([
          { $group: { _id: null, avg: { $avg: "$word_count" }, min: { $min: "$word_count" }, max: { $max: "$word_count" } } },
        ]).toArray();
        if (wordStats[0]) {
          console.log(`\nWord count: avg=${Math.round(wordStats[0].avg)}, min=${wordStats[0].min}, max=${wordStats[0].max}`);
        }

        console.log();
        break;
      }

      case "list-pending":
      case "list": {
        const statusFilter = getFlag("status") || "review";
        const pending = await guides.find(
          { status: statusFilter },
          { projection: { _id: 0, id: 1, topic_name: 1, category: 1, difficulty: 1, word_count: 1, quality_score: 1, created_at: 1 } },
        ).sort({ created_at: -1 }).limit(50).toArray();

        console.log(`\n=== Guides with status: ${statusFilter} (${pending.length}) ===\n`);
        for (const g of pending) {
          const qs = g.quality_score != null ? `score=${g.quality_score}` : "unscored";
          console.log(`  [${g.id.slice(0, 8)}] ${g.topic_name} (${g.category}, ${g.difficulty}, ${g.word_count}w, ${qs})`);
        }
        if (pending.length === 0) console.log("  No guides found.");
        console.log();
        break;
      }

      case "approve": {
        const guideId = getFlag("approve");
        const score = Number(getFlag("score") || 80);
        if (!guideId) { console.error("Usage: --approve <guideId> --score <0-100>"); process.exit(1); }

        const now = new Date().toISOString();
        const result = await guides.updateOne(
          { id: guideId },
          {
            $set: {
              status: "published",
              quality_score: score,
              reviewed_by: "cli-reviewer",
              reviewed_at: now,
              published_at: now,
              updated_at: now,
            },
          },
        );

        if (result.matchedCount === 0) {
          console.error(`Guide not found: ${guideId}`);
        } else {
          console.log(`✓ Approved and published: ${guideId} (score: ${score})`);
        }
        break;
      }

      case "reject": {
        const guideId = getFlag("reject");
        const notes = getFlag("notes") || "Rejected via CLI review";
        if (!guideId) { console.error("Usage: --reject <guideId> --notes 'reason'"); process.exit(1); }

        const now = new Date().toISOString();
        const result = await guides.updateOne(
          { id: guideId },
          {
            $set: {
              status: "archived",
              review_notes: notes,
              reviewed_by: "cli-reviewer",
              reviewed_at: now,
              updated_at: now,
            },
          },
        );

        if (result.matchedCount === 0) {
          console.error(`Guide not found: ${guideId}`);
        } else {
          console.log(`✓ Rejected and archived: ${guideId}`);
        }
        break;
      }

      case "auto-review": {
        const threshold = Number(getFlag("threshold") || getFlag("auto-review") || 60);
        console.log(`\n=== Auto-Review (threshold: ${threshold}) ===\n`);

        const pending = await guides.find(
          { status: "review" },
          { projection: { _id: 0, id: 1, topic_name: 1, sections: 1, word_count: 1, key_concepts: 1, practice_questions: 1, placement_tips: 1 } },
        ).toArray();

        let approved = 0;
        let flagged = 0;

        for (const g of pending) {
          // Calculate auto quality score
          let score = 0;
          score += Math.min(30, (g.sections?.length || 0) * 5);
          if (g.word_count >= 500) score += 10;
          if (g.word_count >= 1000) score += 10;
          if (g.word_count >= 1500) score += 5;
          score += Math.min(20, (g.practice_questions?.length || 0) * 4);
          score += Math.min(15, (g.key_concepts?.length || 0) * 3);
          score += Math.min(10, (g.placement_tips?.length || 0) * 2);
          score = Math.min(100, score);

          const now = new Date().toISOString();

          if (score >= threshold) {
            await guides.updateOne(
              { id: g.id },
              {
                $set: {
                  status: "published",
                  quality_score: score,
                  reviewed_by: "auto-review",
                  reviewed_at: now,
                  published_at: now,
                  updated_at: now,
                },
              },
            );
            console.log(`  ✓ Published: ${g.topic_name} (score: ${score})`);
            approved++;
          } else {
            await guides.updateOne(
              { id: g.id },
              {
                $set: {
                  quality_score: score,
                  review_notes: `Auto-review score ${score} below threshold ${threshold}`,
                  updated_at: now,
                },
              },
            );
            console.log(`  ⚠ Flagged: ${g.topic_name} (score: ${score})`);
            flagged++;
          }
        }

        console.log(`\nAuto-reviewed ${pending.length} guides: ${approved} published, ${flagged} flagged.\n`);
        break;
      }

      case "publish-all-reviewed": {
        const now = new Date().toISOString();
        const result = await guides.updateMany(
          { status: "review", quality_score: { $gte: 60 } },
          { $set: { status: "published", published_at: now, updated_at: now } },
        );
        console.log(`Published ${result.modifiedCount} reviewed guides.`);
        break;
      }

      default:
        console.log("Usage:");
        console.log("  --stats                          Show statistics");
        console.log("  --list-pending                   List guides pending review");
        console.log("  --list --status=published        List guides by status");
        console.log("  --approve <id> --score <0-100>   Approve and publish");
        console.log("  --reject <id> --notes 'reason'   Reject and archive");
        console.log("  --auto-review --threshold=60     Auto-approve above threshold");
        console.log("  --publish-all-reviewed           Publish all with score >= 60");
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
