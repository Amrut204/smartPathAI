import process from "node:process";
import { MongoClient } from "mongodb";

function parseFlag(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const mongoUri = String(process.env.MONGODB_URI ?? "").trim();
  const dbName = String(process.env.MONGODB_DB_NAME ?? "").trim();
  const tenantSlug = parseFlag("tenant-slug", "apex-demo");
  const dryRun = hasFlag("dry-run");

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required.");
  }
  if (!dbName) {
    throw new Error("MONGODB_DB_NAME is required.");
  }

  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const tenant = await db.collection("tenants").findOne(
      { slug: tenantSlug },
      { projection: { _id: 0, id: 1, slug: 1, name: 1 } },
    );

    if (!tenant) {
      throw new Error(`Tenant with slug "${tenantSlug}" was not found in ${dbName}.`);
    }

    const tenantId = String(tenant.id);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const report = {
      dryRun,
      dbName,
      tenant: {
        id: tenantId,
        slug: String(tenant.slug ?? ""),
        name: String(tenant.name ?? ""),
      },
      collections: [],
      totalDocumentsMatched: 0,
      totalDocumentsDeleted: 0,
    };

    for (const { name } of collections) {
      if (!name) continue;

      if (name === "tenants") {
        const matched = await db.collection(name).countDocuments({ id: tenantId });
        if (!matched) continue;

        let deleted = 0;
        if (!dryRun) {
          const result = await db.collection(name).deleteMany({ id: tenantId });
          deleted = Number(result.deletedCount ?? 0);
        }

        report.collections.push({
          name,
          field: "id",
          matched,
          deleted,
        });
        report.totalDocumentsMatched += matched;
        report.totalDocumentsDeleted += deleted;
        continue;
      }

      const matched = await db.collection(name).countDocuments({ tenant_id: tenantId });
      if (!matched) continue;

      let deleted = 0;
      if (!dryRun) {
        const result = await db.collection(name).deleteMany({ tenant_id: tenantId });
        deleted = Number(result.deletedCount ?? 0);
      }

      report.collections.push({
        name,
        field: "tenant_id",
        matched,
        deleted,
      });
      report.totalDocumentsMatched += matched;
      report.totalDocumentsDeleted += deleted;
    }

    const remainingTenants = await db.collection("tenants").find(
      {},
      { projection: { _id: 0, id: 1, slug: 1, name: 1 } },
    ).toArray();

    report.remainingTenants = remainingTenants.map((row) => ({
      id: String(row.id ?? ""),
      slug: String(row.slug ?? ""),
      name: String(row.name ?? ""),
    }));

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
