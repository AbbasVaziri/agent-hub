"use client";

import { useSyncExternalStore } from "react";
import { Select } from "./ui/field";
import { useI18n } from "./i18n-provider";

type Theme = "light" | "dark" | "system";

// Theme is a per-device convenience, so it lives in localStorage rather than the account.
const listeners = new Set<() => void>();
function read(): Theme {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}
function write(v: Theme) {
  try {
    if (v === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", v);
  } catch {
    /* storage unavailable */
  }
  if (v === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = v;
  listeners.forEach((l) => l());
}

export function ThemeSelect({ id }: { id?: string }) {
  const { t } = useI18n();
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  return (
    <Select id={id} value={theme} onChange={(e) => write(e.target.value as Theme)}>
      <option value="system">{t.theme.system}</option>
      <option value="light">{t.theme.light}</option>
      <option value="dark">{t.theme.dark}</option>
    </Select>
  );
}

export function LanguageSelect({ id }: { id?: string }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <Select id={id} value={locale} onChange={(e) => setLocale(e.target.value as "fa" | "en")}>
      <option value="fa">{t.language.fa}</option>
      <option value="en">{t.language.en}</option>
    </Select>
  );
}
