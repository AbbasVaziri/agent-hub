import { describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { auth } from "@/lib/auth/auth";
import { listMemberships } from "@/lib/workspaces/service";

async function latestMail(to: string) {
  const [m] = await db().select().from(schema.emailOutbox).where(eq(schema.emailOutbox.to, to)).orderBy(desc(schema.emailOutbox.createdAt)).limit(1);
  return m;
}

const tokenFrom = (body: string) => /token=([^&\s]+)/.exec(body)?.[1] ?? "";

describe("authentication", () => {
  const email = `auth-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = "correct horse battery";

  it("registers, creates a personal workspace and sends a verification email", async () => {
    await auth().api.signUpEmail({ body: { name: "Parisa", email, password } });
    const [user] = await db().select().from(schema.users).where(eq(schema.users.email, email));
    expect(user.emailVerified).toBe(false);
    const ws = await listMemberships(user.id);
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ role: "owner", isPersonal: true });
    expect((await latestMail(email))?.subject).toContain("Verify");
    const [account] = await db().select().from(schema.authAccounts).where(eq(schema.authAccounts.userId, user.id));
    expect(account.password).not.toContain(password);
  });

  it("blocks sign-in until the email is verified", async () => {
    await expect(auth().api.signInEmail({ body: { email, password } })).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("verifies the email and then signs in with a session", async () => {
    const mail = await latestMail(email);
    await auth().api.verifyEmail({ query: { token: tokenFrom(mail.body) } });
    const [user] = await db().select().from(schema.users).where(eq(schema.users.email, email));
    expect(user.emailVerified).toBe(true);
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    const res = await auth().api.signInEmail({ body: { email, password } });
    expect(res.token).toBeTruthy();
  });

  it("rejects a wrong password", async () => {
    await expect(auth().api.signInEmail({ body: { email, password: "wrong password!!" } })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });

  it("resets the password through an emailed token and revokes old sessions", async () => {
    await auth().api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    const mail = await latestMail(email);
    expect(mail.subject).toContain("Reset");
    const token = /reset-password\/([^?\s]+)/.exec(mail.body)?.[1] ?? tokenFrom(mail.body);
    await auth().api.resetPassword({ body: { newPassword: "a brand new password", token } });
    const [user] = await db().select().from(schema.users).where(eq(schema.users.email, email));
    expect(await db().select().from(schema.authSessions).where(eq(schema.authSessions.userId, user.id))).toHaveLength(0);
    await expect(auth().api.signInEmail({ body: { email, password } })).rejects.toBeTruthy();
    expect((await auth().api.signInEmail({ body: { email, password: "a brand new password" } })).token).toBeTruthy();
  });
});
