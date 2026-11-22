"use client";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto max-w-md px-4 py-20">
      <h1 className="text-[22px] font-bold">{t.errors.crashTitle}</h1>
      <Button variant="outline" className="mt-6" onClick={reset}>
        {t.common.retry}
      </Button>
    </main>
  );
}
