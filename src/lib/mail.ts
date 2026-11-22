import { db, schema } from "./db/client";
import { env } from "./env";
import { log } from "./logger";

type Mail = { to: string; subject: string; text: string };

let transporterPromise: Promise<{ sendMail(m: { from: string; to: string; subject: string; text: string }): Promise<unknown> }> | null = null;

export async function sendMail(mail: Mail): Promise<void> {
  const e = env();
  if (e.SMTP_URL) {
    transporterPromise ??= import("nodemailer").then((m) => m.default.createTransport(e.SMTP_URL));
    const t = await transporterPromise;
    await t.sendMail({ from: e.MAIL_FROM, ...mail });
    return;
  }
  if (e.NODE_ENV === "production") {
    log.error("SMTP_URL is not configured; email not sent", { subject: mail.subject });
    throw new Error("Email delivery is not configured");
  }
  // Development and tests: keep the message in the outbox table so the link can be opened locally.
  await db().insert(schema.emailOutbox).values({ to: mail.to, subject: mail.subject, body: mail.text });
  log.info("Email stored in dev outbox", { to: mail.to, subject: mail.subject });
}
