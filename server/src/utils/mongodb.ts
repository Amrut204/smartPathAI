import { MongoClient, type Db } from "mongodb";
import { getEnvVar } from "./env.js";

const DEFAULT_DB_NAME = "campusdrive_dev";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getMongoDb(): Promise<Db> {
  if (cachedDb) {
    return cachedDb;
  }

  const uri = getEnvVar("MONGODB_URI");
  const dbName = process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME;

  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    await cachedClient.connect();
  }

  cachedDb = cachedClient.db(dbName);
  return cachedDb;
}
