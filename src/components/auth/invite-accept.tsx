"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { useI18n } from "../i18n-provider";

export function InviteAccept({ token, signedIn }: { token: string; signedIn: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/invitations/accept", { body: { token } });
      router.replace("/chat");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t.common.errorGeneric);
      setBusy(false);
    }
  };
  return (
    <>
      <h1 className="text-[26px] font-bold">{t.invite.title}</h1>
      {signedIn ? (
        <>
          <Button variant="default" className="mt-8 w-full" onClick={accept} disabled={busy}>
            {t.invite.accept}
          </Button>
          {error && (
            <p role="alert" className="mt-4 text-[14px] text-destructive">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-4 text-[15px] leading-7 text-muted-foreground">{t.invite.signInFirst}</p>
          <Link href={`/sign-in?next=/invite/${token}`} className="mt-6 inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            {t.auth.signIn}
          </Link>
        </>
      )}
    </>
  );
}
