import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "../env";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __agentHubPool?: Pool; __agentHubDb?: Db };

export function db(): Db {
  if (!globalForDb.__agentHubDb) {
    globalForDb.__agentHubPool = new Pool({ connectionString: env().DATABASE_URL, max: 10 });
    globalForDb.__agentHubDb = drizzle(globalForDb.__agentHubPool, { schema });
  }
  return globalForDb.__agentHubDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__agentHubPool?.end();
  globalForDb.__agentHubPool = undefined;
  globalForDb.__agentHubDb = undefined;
}

export { schema };
