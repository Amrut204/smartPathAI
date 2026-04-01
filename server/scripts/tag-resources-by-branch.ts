import "dotenv/config";

import { closeMongoConnection, getMongoDb } from "../src/utils/mongodb.js";
import { BRANCH_PREP_TRACKS, matchesBranchPrepTrackTag, type CanonicalBranchCode } from "../src/config/branch-prep.config.js";
import { BRANCH_PACK_DEFINITIONS, TARGET_ROLE_KEYWORDS } from "../src/config/branch-content.config.js";

function normalizeText(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildHaystack(doc: Record<string, unknown>) {
  const searchIndex = doc.search_index && typeof doc.search_index === "object" ? doc.search_index as Record<string, unknown> : {};
  return normalizeText([
    doc.title,
    doc.description,
    doc.url,
    doc.source_pdf,
    searchIndex.search_text,
    searchIndex.summary_short,
    ...(Array.isArray(searchIndex.keywords) ? searchIndex.keywords : []),
    ...(Array.isArray(searchIndex.key_topics) ? searchIndex.key_topics : []),
  ].filter(Boolean).join(" "));
}

function inferBranchRelevance(haystack: string) {
  const matches = new Set<CanonicalBranchCode>();
  for (const track of Object.values(BRANCH_PREP_TRACKS)) {
    const branch = track.branch as CanonicalBranchCode;
    if (matchesBranchPrepTrackTag(track.label, branch) && haystack.includes(normalizeText(track.label))) {
      matches.add(branch);
      continue;
    }

    if (track.focusAreas.some((area) => haystack.includes(normalizeText(area.topicName)))) {
      matches.add(branch);
    }
  }
  return [...matches];
}

function inferCareerTracks(haystack: string) {
  const values = new Set<string>();
  if (TARGET_ROLE_KEYWORDS.software.some((keyword) => haystack.includes(normalizeText(keyword)))) values.add("Software Engineer");
  if (TARGET_ROLE_KEYWORDS.analyst.some((keyword) => haystack.includes(normalizeText(keyword)))) values.add("Analyst");
  if (TARGET_ROLE_KEYWORDS.graduate_engineer_trainee.some((keyword) => haystack.includes(normalizeText(keyword)))) values.add("Graduate Engineer Trainee");
  return [...values];
}

function inferPackLabels(haystack: string, branches: CanonicalBranchCode[]) {
  return BRANCH_PACK_DEFINITIONS
    .filter((pack) => branches.includes(pack.branch) && pack.keywords.some((keyword) => haystack.includes(normalizeText(keyword))))
    .map((pack) => pack.title);
}

async function processCollection(collectionName: "resources" | "shared_resources", dryRun: boolean) {
  const db = await getMongoDb();
  const rows = await db.collection(collectionName).find(
    { is_active: true },
    { projection: { _id: 0, id: 1, title: 1, description: 1, url: 1, source_pdf: 1, search_index: 1, branch_relevance: 1, career_tracks: 1, content_pack_labels: 1 } },
  ).toArray();

  let updated = 0;

  for (const row of rows) {
    const haystack = buildHaystack(row as Record<string, unknown>);
    const branchRelevance = inferBranchRelevance(haystack);
    const careerTracks = inferCareerTracks(haystack);
    const contentPackLabels = inferPackLabels(haystack, branchRelevance);

    const previousBranchRelevance = Array.isArray(row.branch_relevance) ? row.branch_relevance.map((value) => String(value)) : [];
    const previousCareerTracks = Array.isArray(row.career_tracks) ? row.career_tracks.map((value) => String(value)) : [];
    const previousContentPackLabels = Array.isArray(row.content_pack_labels) ? row.content_pack_labels.map((value) => String(value)) : [];

    const changed = JSON.stringify(previousBranchRelevance) !== JSON.stringify(branchRelevance)
      || JSON.stringify(previousCareerTracks) !== JSON.stringify(careerTracks)
      || JSON.stringify(previousContentPackLabels) !== JSON.stringify(contentPackLabels);

    if (!changed) continue;
    updated += 1;

    if (!dryRun) {
      await db.collection(collectionName).updateOne(
        { id: row.id },
        {
          $set: {
            branch_relevance: branchRelevance,
            career_tracks: careerTracks,
            content_pack_labels: contentPackLabels,
            updated_at: new Date().toISOString(),
          },
        },
      );
    }
  }

  return {
    collectionName,
    total: rows.length,
    updated,
    dryRun,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const [tenantResources, sharedResources] = await Promise.all([
    processCollection("resources", dryRun),
    processCollection("shared_resources", dryRun),
  ]);

  console.log(JSON.stringify({ tenantResources, sharedResources }, null, 2));
}

main()
  .catch((error) => {
    console.error("Failed to tag resources by branch.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoConnection();
  });
