import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { sendMail } from "../mail";
import { createPersonalWorkspace } from "../workspaces/service";
import { audit } from "../audit";

function build() {
  const e = env();
  return betterAuth({
    appName: "Agent Hub",
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.APP_URL],
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    user: {
      fields: { image: "avatarUrl" },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          const { assertCanDeleteAccount } = await import("../workspaces/service");
          await assertCanDeleteAccount(user.id);
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: e.APP_URL.startsWith("https://"),
      database: { generateId: () => crypto.randomUUID() },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: e.REQUIRE_EMAIL_VERIFICATION,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "بازیابی رمز عبور / Reset your password",
          text: `برای انتخاب رمز تازه این پیوند را باز کنید (یک ساعت اعتبار دارد):\n${url}\n\nOpen this link to choose a new password (valid for one hour):\n${url}`,
        });
      },
      onPasswordReset: async ({ user }) => {
        await audit({ workspaceId: null, actorUserId: user.id, action: "auth.password_reset" });
      },
    },
    emailVerification: {
      sendOnSignUp: e.REQUIRE_EMAIL_VERIFICATION,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "تأیید ایمیل / Verify your email",
          text: `برای تأیید ایمیل این پیوند را باز کنید:\n${url}\n\nOpen this link to verify your email:\n${url}`,
        });
      },
      afterEmailVerification: async (user) => {
        await db().update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, user.id));
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await createPersonalWorkspace({ id: user.id, name: user.name });
            await audit({ workspaceId: null, actorUserId: user.id, action: "auth.registered" });
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof build>;
const g = globalThis as unknown as { __agentHubAuth?: Auth };

export function auth(): Auth {
  g.__agentHubAuth ??= build();
  return g.__agentHubAuth;
}
