"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Direction } from "radix-ui";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "./i18n-provider";
import type { Locale } from "@/lib/i18n/messages";
import { ApiRequestError } from "@/lib/client/api";

export function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: (count, err) => !(err instanceof ApiRequestError && err.status < 500) && count < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const dir = locale === "fa" ? "rtl" : "ltr";
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      {/* Radix primitives behind shadcn read the reading direction from here. */}
      <Direction.Provider dir={dir}>
        <QueryClientProvider client={client}>
          <I18nProvider locale={locale}>
            {children}
            <Toaster position="bottom-center" dir={dir} />
          </I18nProvider>
        </QueryClientProvider>
      </Direction.Provider>
    </ThemeProvider>
  );
}
