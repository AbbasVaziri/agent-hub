"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { ConversationDTO } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useI18n } from "../i18n-provider";
import { ErrorState, SkeletonRows } from "../app/states";

export const conversationsKey = ["conversations"] as const;

export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const { t, relative } = useI18n();
  const path = usePathname();
  const q = useInfiniteQuery({
    queryKey: conversationsKey,
    queryFn: ({ pageParam }) => api<{ items: ConversationDTO[]; nextCursor: string | null }>(`/api/conversations?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby="history-heading">
      <div className="flex items-center justify-between px-3 pb-2">
        <h2 id="history-heading" className="text-[13px] font-medium text-muted-foreground">
          {t.chat.history}
        </h2>
        <Button asChild variant="ghost" size="sm" className="-me-2 px-2 text-[13px]">
          <Link href="/chat" onClick={onNavigate}>
            {t.chat.newChat}
          </Link>
        </Button>
      </div>
      {q.isPending && <SkeletonRows rows={5} label={t.common.loading} />}
      {q.isError && <ErrorState message={t.chat.historyError} onRetry={() => q.refetch()} retryLabel={t.common.retry} />}
      {q.isSuccess && items.length === 0 && <p className="px-3 text-[14px] leading-6 text-muted-foreground">{t.chat.emptyHistory}</p>}
      <ul className="space-y-0.5">
        {items.map((c) => {
          const href = `/chat/${c.id}`;
          const active = path === href;
          return (
            <li key={c.id}>
              <Button
                asChild
                variant="ghost"
                className={cn("h-auto sm:h-auto w-full flex-col items-stretch gap-0 px-3 py-2 text-start font-normal", active && "bg-muted font-semibold")}
              >
                <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}>
                <span className="block truncate text-[14px]" dir="auto">
                  {c.title || t.chat.untitled}
                </span>
                <span className="block text-[12px] font-normal text-muted-foreground">
                  {relative(c.updatedAt)}
                  {c.visibility === "workspace" && ` · ${t.chat.shared}`}
                </span>
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
      {q.hasNextPage && (
        <Button variant="link" size="sm" onClick={() => q.fetchNextPage()} className="mt-2 px-3 text-[13px] text-muted-foreground">
          {t.chat.loadOlder}
        </Button>
      )}
    </section>
  );
}
