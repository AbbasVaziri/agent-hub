"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useI18n } from "./i18n-provider";

const noop = () => () => undefined;

export function ThemeSelect({ id }: { id?: string }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  // The stored theme is only known in the browser; render "system" on the server.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return (
    <NativeSelect id={id} value={mounted ? (theme ?? "system") : "system"} onChange={(e) => setTheme(e.target.value)}>
      <NativeSelectOption value="system">{t.theme.system}</NativeSelectOption>
      <NativeSelectOption value="light">{t.theme.light}</NativeSelectOption>
      <NativeSelectOption value="dark">{t.theme.dark}</NativeSelectOption>
    </NativeSelect>
  );
}

export function LanguageSelect({ id }: { id?: string }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <NativeSelect id={id} value={locale} onChange={(e) => setLocale(e.target.value as "fa" | "en")}>
      <NativeSelectOption value="fa">{t.language.fa}</NativeSelectOption>
      <NativeSelectOption value="en">{t.language.en}</NativeSelectOption>
    </NativeSelect>
  );
}
