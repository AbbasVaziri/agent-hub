"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { api } from "@/lib/client/api";
import { useI18n } from "../i18n-provider";
import { useSession } from "../shell/session-context";
import { LanguageSelect, ThemeSelect } from "../theme-select";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/app/form-field";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function AccountPage() {
  const { t } = useI18n();
  const session = useSession();
  const router = useRouter();
  const [name, setName] = useState(session.me.name);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/me", { method: "PATCH", body: { name } });
      toast(t.common.saved);
      router.refresh();
    } catch {
      toast.error(t.common.errorGeneric);
    }
  };
  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setDeleteError(null);
    const res = await authClient.deleteUser({ password });
    setBusy(false);
    if (res.error) {
      setDeleteError(res.error.message ?? t.common.errorGeneric);
      return;
    }
    router.replace("/sign-in");
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-8">
      <h1 className="text-[26px] font-bold">{t.account.title}</h1>
      <form onSubmit={saveName} className="mt-8 space-y-5">
        <h2 className="text-[17px] font-semibold">{t.account.profile}</h2>
        <FormField label={t.auth.name}>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} dir="auto" />}</FormField>
        <FormField label={t.auth.email}>{(a) => <Input {...a} value={session.me.email} readOnly dir="ltr" />}</FormField>
        <Button type="submit" variant="default" disabled={!name.trim()}>
          {t.common.save}
        </Button>
      </form>

      <div className="mt-10 grid gap-5 border-t border-border pt-6 sm:grid-cols-2">
        <FormField label={t.language.label}>{(a) => <LanguageSelect id={a.id} />}</FormField>
        <FormField label={t.theme.label}>{(a) => <ThemeSelect id={a.id} />}</FormField>
      </div>

      <form onSubmit={deleteAccount} className="mt-10 space-y-3 border-t border-border pt-6">
        <h2 className="text-[17px] font-semibold text-destructive">{t.account.deleteTitle}</h2>
        <p className="text-[14px] leading-6 text-muted-foreground">{t.account.deleteBody}</p>
        <FormField label={t.account.deleteConfirm} error={deleteError ?? undefined}>
          {(a) => <Input {...a} type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </FormField>
        <Button type="submit" variant="destructive" disabled={!password || busy}>
          {t.account.deleteAction}
        </Button>
      </form>
    </div>
  );
}
