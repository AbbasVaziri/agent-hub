"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { api } from "@/lib/client/api";
import type { AgentDTO, ProviderDTO } from "@/lib/contracts";
import { can } from "@/lib/workspaces/permissions";
import { useI18n } from "../i18n-provider";
import { useSession } from "../shell/session-context";
import { buttonVariants } from "@/components/ui/button";
import { Seal } from "../app/seal";
import { EmptyState, ErrorState, SkeletonRows } from "../app/states";

export function AgentList() {
  const { t, relative } = useI18n();
  const session = useSession();
  const q = useQuery({ queryKey: ["agents"], queryFn: () => api<{ items: AgentDTO[] }>("/api/agents").then((r) => r.items) });
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<{ items: ProviderDTO[] }>("/api/providers").then((r) => r.items),
    enabled: can(session.role, "providers.view"),
  });
  const connName = (id: string | null) => providers.data?.find((p) => p.id === id)?.label;
  const canCreate = can(session.role, "agents.create");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold">{t.agents.title}</h1>
          <p className="mt-1 max-w-xl text-[15px] leading-7 text-muted-foreground">{t.agents.intro}</p>
        </div>
        {canCreate && (
          <Link href="/agents/new" className={buttonVariants()}>
            {t.agents.new}
          </Link>
        )}
      </div>

      <div className="mt-8">
        {q.isPending && <SkeletonRows rows={4} label={t.common.loading} />}
        {q.isError && <ErrorState message={t.agents.loadError} onRetry={() => q.refetch()} retryLabel={t.common.retry} />}
        {q.isSuccess && q.data.length === 0 && (
          <EmptyState
            title={t.agents.emptyTitle}
            body={t.agents.emptyBody}
            action={
              canCreate ? (
                <Link href="/agents/new" className={buttonVariants()}>
                  {t.agents.createAction}
                </Link>
              ) : undefined
            }
          />
        )}
        {q.isSuccess && q.data.length > 0 && (
          <ItemGroup className="rounded-lg border bg-card">
            {q.data.map((a, idx) => (
              <Fragment key={a.id}>
                {idx > 0 && <ItemSeparator />}
                <Item asChild className="hover:bg-muted">
                  <Link href={`/agents/${a.id}`}>
                    <ItemMedia>
                      <Seal name={a.name} color={a.avatar} size="lg" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="flex flex-wrap items-baseline gap-x-3">
                        <span className="text-[16px]" dir="auto">
                          {a.name}
                        </span>
                        <span className="text-[13px] font-normal text-muted-foreground">{t.agents.modes[a.mode]}</span>
                        {!a.isActive && <span className="text-[13px] text-destructive">{t.agents.inactive}</span>}
                      </ItemTitle>
                      {(a.role || a.description) && (
                        <ItemDescription className="text-[14px] leading-6" dir="auto">
                          {[a.role, a.description].filter(Boolean).join(" · ")}
                        </ItemDescription>
                      )}
                    </ItemContent>
                    <ItemActions className="hidden flex-col items-end gap-0 text-end text-[13px] text-muted-foreground sm:flex">
                      <span dir="ltr">{a.model || (a.providerConnectionId ? t.agents.modelDefault : "")}</span>
                      <span>{connName(a.providerConnectionId ?? null)}</span>
                      <span>{relative(a.updatedAt)}</span>
                    </ItemActions>
                  </Link>
                </Item>
              </Fragment>
            ))}
          </ItemGroup>
        )}
      </div>
    </div>
  );
}
