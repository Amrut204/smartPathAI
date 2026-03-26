import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import { getEnvVar } from "./env.js";

const DEFAULT_DB_NAME = "campusdrive_dev";
const DEFAULT_QUERY_MAX_TIME_MS = 5000;

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;
let cachedWrappedDb: Db | null = null;

function wrapCollection(collection: Collection<Document>): Collection<Document> {
  return new Proxy(collection, {
    get(target, prop, receiver) {
      if (prop === "find") {
        return (...args: any[]) => {
          const cursor = (target as any).find(...args);
          cursor?.maxTimeMS?.(DEFAULT_QUERY_MAX_TIME_MS);
          return cursor;
        };
      }

      if (prop === "aggregate") {
        return (pipeline?: Document[], options?: any) => {
          const cursor = (target as any).aggregate(pipeline, { ...(options ?? {}), maxTimeMS: DEFAULT_QUERY_MAX_TIME_MS });
          cursor?.maxTimeMS?.(DEFAULT_QUERY_MAX_TIME_MS);
          return cursor;
        };
      }

      if (prop === "findOne") {
        return (filter?: any, options?: any) =>
          (target as any).findOne(filter, { ...(options ?? {}), maxTimeMS: DEFAULT_QUERY_MAX_TIME_MS });
      }

      if (prop === "countDocuments") {
        return (filter?: any, options?: any) =>
          (target as any).countDocuments(filter ?? {}, { ...(options ?? {}), maxTimeMS: DEFAULT_QUERY_MAX_TIME_MS });
      }

      if (prop === "distinct") {
        return (key: string, filter?: any, options?: any) =>
          (target as any).distinct(key, filter ?? {}, { ...(options ?? {}), maxTimeMS: DEFAULT_QUERY_MAX_TIME_MS });
      }

      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

function wrapDb(db: Db): Db {
  return new Proxy(db as Db, {
    get(target, prop, receiver) {
      if (prop === "collection") {
        return (name: string, options?: any) => wrapCollection((target as any).collection(name, options));
      }

      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export async function getMongoDb(): Promise<Db> {
  if (cachedWrappedDb) {
    return cachedWrappedDb;
  }

  const uri = getEnvVar("MONGODB_URI");
  const dbName = process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME;

  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    await cachedClient.connect();
  }

  cachedDb = cachedClient.db(dbName);
  cachedWrappedDb = wrapDb(cachedDb);
  return cachedWrappedDb;
}

export async function closeMongoConnection(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
  }

  cachedClient = null;
  cachedDb = null;
  cachedWrappedDb = null;
}
