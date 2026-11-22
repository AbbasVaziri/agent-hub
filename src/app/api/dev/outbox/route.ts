import { desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/env";

/** Development only: read messages that would have been emailed. Disabled in production. */
export async function GET(req: NextRequest) {
  if (env().NODE_ENV === "production") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  const to = req.nextUrl.searchParams.get("to");
  const q = db().select().from(schema.emailOutbox).orderBy(desc(schema.emailOutbox.createdAt)).limit(20);
  const rows = to ? await q.where(eq(schema.emailOutbox.to, to)) : await q;
  return NextResponse.json({ items: rows });
}
