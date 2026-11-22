"use client";

import { Label } from "@/components/ui/label";
import { useI18n } from "../i18n-provider";
import { LanguageSelect, ThemeSelect } from "../theme-select";

/** Sign-in pages: a narrow sheet on paper. The product name is set as text (no generated logo). */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <span className="text-[17px] font-bold tracking-tight">{t.brand}</span>
        <div className="flex gap-2">
          <Label className="sr-only" htmlFor="auth-lang">
            {t.language.label}
          </Label>
          <div className="w-28">
            <LanguageSelect id="auth-lang" />
          </div>
          <Label className="sr-only" htmlFor="auth-theme">
            {t.theme.label}
          </Label>
          <div className="w-32">
            <ThemeSelect id="auth-theme" />
          </div>
        </div>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-6 sm:pt-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
