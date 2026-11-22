import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { AppError } from "../api/errors";

/**
 * Fixed-window counter in Postgres. One atomic upsert per check, so it holds
 * across multiple app instances without Redis.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<{ remaining: number }> {
  const result = await db().execute<{ count: number }>(sql`
    insert into rate_limit_buckets (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limit_buckets.window_start < now() - make_interval(secs => ${windowSeconds})
                   then 1 else rate_limit_buckets.count + 1 end,
      window_start = case when rate_limit_buckets.window_start < now() - make_interval(secs => ${windowSeconds})
                   then now() else rate_limit_buckets.window_start end
    returning count
  `);
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > limit) {
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", { retryAfterSeconds: windowSeconds });
  }
  return { remaining: limit - count };
}
