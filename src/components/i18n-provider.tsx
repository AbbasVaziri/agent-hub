"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format, MESSAGES, type Locale, type Messages } from "@/lib/i18n/messages";

type Ctx = {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: Messages;
  f: typeof format;
  setLocale: (l: Locale) => void;
  num: (n: number, opts?: Intl.NumberFormatOptions) => string;
  date: (d: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
  relative: (d: string | Date) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const intlLocale = locale === "fa" ? "fa-IR" : "en-GB";
  const setLocale = useCallback(
    (l: Locale) => {
      document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = l;
      document.documentElement.dir = l === "fa" ? "rtl" : "ltr";
      void fetch("/api/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: l }) }).catch(() => undefined);
      router.refresh();
    },
    [router],
  );
  const value = useMemo<Ctx>(() => {
    const nf = new Intl.NumberFormat(intlLocale);
    const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
    return {
      locale,
      dir: locale === "fa" ? "rtl" : "ltr",
      t: MESSAGES[locale],
      f: format,
      setLocale,
      num: (n, opts) => (opts ? new Intl.NumberFormat(intlLocale, opts).format(n) : nf.format(n)),
      date: (d, opts) =>
        new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", opts ?? { dateStyle: "medium", timeStyle: "short" }).format(new Date(d)),
      relative: (d) => {
        const diff = (new Date(d).getTime() - Date.now()) / 1000;
        const abs = Math.abs(diff);
        if (abs < 60) return rtf.format(Math.round(diff), "second");
        if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
        if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
        return rtf.format(Math.round(diff / 86400), "day");
      },
    };
  }, [locale, intlLocale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
