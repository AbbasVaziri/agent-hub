import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Development mail viewer. The route does not exist in production builds. */
export default async function OutboxPage() {
  if (env().NODE_ENV === "production") notFound();
  const mails = await db().select().from(schema.emailOutbox).orderBy(desc(schema.emailOutbox.createdAt)).limit(20);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-[20px] font-bold">Dev outbox</h1>
      <p className="mt-1 text-[14px] text-muted">Emails are stored here because SMTP_URL is not set.</p>
      {mails.length === 0 && <p className="mt-6 text-[15px]">No emails yet. Sign up or request a password reset to see one here.</p>}
      <ul className="mt-6 space-y-4">
        {mails.map((m) => (
          <li key={m.id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
            <p className="text-[13px] text-muted" dir="ltr">
              {m.to} · {m.createdAt.toISOString()}
            </p>
            <p className="mt-1 font-semibold">{m.subject}</p>
            <pre className="mt-3 whitespace-pre-wrap break-all text-[14px] leading-7" dir="auto">
              {m.body.split(/(https?:\/\/\S+)/).map((part, i) =>
                /^https?:\/\//.test(part) ? (
                  <a key={i} href={part} className="text-accent underline" dir="ltr">
                    {part}
                  </a>
                ) : (
                  part
                ),
              )}
            </pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
