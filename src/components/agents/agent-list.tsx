"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { AgentDTO, ProviderDTO } from "@/lib/contracts";
import { can } from "@/lib/workspaces/permissions";
import { useI18n } from "../i18n-provider";
import { useSession } from "../shell/session-context";
import { buttonClass } from "../ui/button";
import { Seal } from "../ui/seal";
import { EmptyState, ErrorState, SkeletonRows } from "../ui/states";

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
          <p className="mt-1 max-w-xl text-[15px] leading-7 text-muted">{t.agents.intro}</p>
        </div>
        {canCreate && (
          <Link href="/agents/new" className={buttonClass({ variant: "primary" })}>
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
                <Link href="/agents/new" className={buttonClass({ variant: "primary" })}>
                  {t.agents.createAction}
                </Link>
              ) : undefined
            }
          />
        )}
        {q.isSuccess && q.data.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {q.data.map((a) => (
              <li key={a.id}>
                <Link href={`/agents/${a.id}`} className="flex items-start gap-4 px-2 py-4 hover:bg-surface-2">
                  <Seal name={a.name} color={a.avatar} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-[16px] font-semibold" dir="auto">
                        {a.name}
                      </span>
                      <span className="text-[13px] text-muted">{t.agents.modes[a.mode]}</span>
                      {!a.isActive && <span className="text-[13px] font-medium text-danger">{t.agents.inactive}</span>}
                    </span>
                    {(a.role || a.description) && (
                      <span className="mt-1 block text-[14px] leading-6 text-muted" dir="auto">
                        {[a.role, a.description].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="hidden shrink-0 text-end text-[13px] text-muted sm:block">
                    <span className="block" dir="ltr">
                      {a.model || (a.providerConnectionId ? t.agents.modelDefault : "")}
                    </span>
                    <span className="block">{connName(a.providerConnectionId ?? null)}</span>
                    <span className="block">{relative(a.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
