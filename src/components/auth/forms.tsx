"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@/lib/auth/client";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { useI18n } from "../i18n-provider";

const isDev = process.env.NODE_ENV !== "production";

function DevOutboxNote() {
  const { t } = useI18n();
  if (!isDev) return null;
  return (
    <p className="mt-6 border-t border-line pt-4 text-[13px] leading-6 text-muted">
      {t.auth.devOutbox}{" "}
      <Link className="underline underline-offset-4" href="/dev/outbox">
        {t.auth.openOutbox}
      </Link>
    </p>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-[14px] text-danger">
      {message}
    </p>
  );
}

export function SignInForm() {
  const { t } = useI18n();
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/chat";
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await authClient.signIn.email({ email: v.email, password: v.password });
    if (res.error) {
      if (res.error.status === 403) {
        router.push(`/verify-email?email=${encodeURIComponent(v.email)}`);
        return;
      }
      setError(res.error.status === 401 ? t.auth.invalidCredentials : t.common.errorGeneric);
      return;
    }
    router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/chat");
    router.refresh();
  });

  return (
    <>
      <h1 className="text-[26px] font-bold">{t.auth.signInTitle}</h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <Field label={t.auth.email} error={form.formState.errors.email && t.auth.email}>
          {(a) => <Input {...a} type="email" autoComplete="email" dir="ltr" placeholder="email@example.com" {...form.register("email")} />}
        </Field>
        <Field label={t.auth.password}>
          {(a) => <Input {...a} type="password" autoComplete="current-password" dir="ltr" {...form.register("password")} />}
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t.common.loading : t.auth.signIn}
        </Button>
      </form>
      <div className="mt-6 space-y-2 text-[14px]">
        <p>
          <Link className="underline underline-offset-4" href="/forgot-password">
            {t.auth.forgot}
          </Link>
        </p>
        <p className="text-muted">
          {t.auth.noAccount}{" "}
          <Link className="text-ink underline underline-offset-4" href="/sign-up">
            {t.auth.signUp}
          </Link>
        </p>
      </div>
      <DevOutboxNote />
    </>
  );
}

export function SignUpForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({ name: z.string().trim().min(1).max(80), email: z.string().email(), password: z.string().min(10).max(128) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const errs = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const res = await authClient.signUp.email({ name: v.name, email: v.email, password: v.password, callbackURL: "/chat" });
    if (res.error) {
      setError(/exist/i.test(res.error.message ?? "") || res.error.status === 422 ? t.auth.emailTaken : t.common.errorGeneric);
      return;
    }
    if (res.data && "token" in res.data && res.data.token) {
      router.replace("/chat");
      router.refresh();
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(v.email)}`);
  });

  return (
    <>
      <h1 className="text-[26px] font-bold">{t.auth.signUpTitle}</h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <Field label={t.auth.name} error={errs.name && t.auth.name}>
          {(a) => <Input {...a} autoComplete="name" placeholder={t.auth.name} {...form.register("name")} />}
        </Field>
        <Field label={t.auth.email} error={errs.email && t.auth.email}>
          {(a) => <Input {...a} type="email" autoComplete="email" dir="ltr" placeholder="email@example.com" {...form.register("email")} />}
        </Field>
        <Field label={t.auth.password} hint={t.auth.passwordHint} error={errs.password && t.auth.passwordHint}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" dir="ltr" {...form.register("password")} />}
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t.common.loading : t.auth.signUp}
        </Button>
      </form>
      <p className="mt-6 text-[14px] text-muted">
        {t.auth.haveAccount}{" "}
        <Link className="text-ink underline underline-offset-4" href="/sign-in">
          {t.auth.signIn}
        </Link>
      </p>
      <DevOutboxNote />
    </>
  );
}

export function VerifyEmailNotice() {
  const { t, f } = useI18n();
  const email = useSearchParams().get("email") ?? "";
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const resend = async () => {
    setState("sending");
    const res = await authClient.sendVerificationEmail({ email, callbackURL: "/chat" });
    setState(res.error ? "error" : "sent");
  };
  return (
    <>
      <h1 className="text-[26px] font-bold">{t.auth.verifyTitle}</h1>
      <p className="mt-4 text-[15px] leading-7 text-muted">{f(t.auth.verifyBody, { email: email || "…" })}</p>
      {email && (
        <Button className="mt-6" onClick={resend} disabled={state === "sending" || state === "sent"}>
          {state === "sent" ? t.auth.verifyResent : t.auth.verifyResend}
        </Button>
      )}
      {state === "error" && <p className="mt-3 text-[14px] text-danger">{t.common.errorGeneric}</p>}
      <p className="mt-6 text-[14px]">
        <Link className="underline underline-offset-4" href="/sign-in">
          {t.auth.signIn}
        </Link>
      </p>
      <DevOutboxNote />
    </>
  );
}

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const schema = z.object({ email: z.string().email() });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const onSubmit = form.handleSubmit(async (v) => {
    await authClient.requestPasswordReset({ email: v.email, redirectTo: "/reset-password" });
    setSent(true);
  });
  return (
    <>
      <h1 className="text-[26px] font-bold">{t.auth.forgotTitle}</h1>
      {sent ? (
        <p role="status" className="mt-6 text-[15px] leading-7">
          {t.auth.resetSent}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <Field label={t.auth.email} error={form.formState.errors.email && t.auth.email}>
            {(a) => <Input {...a} type="email" autoComplete="email" dir="ltr" placeholder="email@example.com" {...form.register("email")} />}
          </Field>
          <Button type="submit" variant="primary" className="w-full" disabled={form.formState.isSubmitting}>
            {t.auth.sendReset}
          </Button>
        </form>
      )}
      <p className="mt-6 text-[14px]">
        <Link className="underline underline-offset-4" href="/sign-in">
          {t.auth.signIn}
        </Link>
      </p>
      <DevOutboxNote />
    </>
  );
}

export function ResetPasswordForm() {
  const { t } = useI18n();
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"idle" | "done" | "error">(params.get("error") ? "error" : "idle");
  const schema = z.object({ password: z.string().min(10).max(128) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const onSubmit = form.handleSubmit(async (v) => {
    if (!token) return setState("error");
    const res = await authClient.resetPassword({ newPassword: v.password, token });
    setState(res.error ? "error" : "done");
  });
  return (
    <>
      <h1 className="text-[26px] font-bold">{t.auth.resetTitle}</h1>
      {state === "done" ? (
        <p role="status" className="mt-6 text-[15px]">
          {t.auth.resetDone}
        </p>
      ) : state === "error" || !token ? (
        <p role="alert" className="mt-6 text-[15px] text-danger">
          {t.auth.resetInvalid}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <Field label={t.auth.newPassword} hint={t.auth.passwordHint} error={form.formState.errors.password && t.auth.passwordHint}>
            {(a) => <Input {...a} type="password" autoComplete="new-password" dir="ltr" {...form.register("password")} />}
          </Field>
          <Button type="submit" variant="primary" className="w-full" disabled={form.formState.isSubmitting}>
            {t.auth.setPassword}
          </Button>
        </form>
      )}
      <p className="mt-6 text-[14px]">
        <Link className="underline underline-offset-4" href="/sign-in">
          {t.auth.signIn}
        </Link>
      </p>
    </>
  );
}
