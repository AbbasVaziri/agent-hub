import Link from "next/link";
import { getMessages } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getMessages();
  return (
    <main className="mx-auto max-w-md px-4 py-20">
      <h1 className="text-[22px] font-bold">{t.errors.notFoundTitle}</h1>
      <p className="mt-2 text-[15px] leading-7 text-muted">{t.errors.notFoundBody}</p>
      <Link href="/chat" className="mt-6 inline-flex h-11 items-center rounded-[var(--radius-control)] bg-ink px-4 text-sm font-medium text-paper">
        {t.errors.goHome}
      </Link>
    </main>
  );
}
