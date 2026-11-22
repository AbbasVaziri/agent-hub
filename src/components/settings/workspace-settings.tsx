"use client";

import { useRouter } from "next/navigation";
import { FieldSet } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "@/lib/client/api";
import { can, type Role } from "@/lib/workspaces/permissions";
import { useI18n } from "../i18n-provider";
import { useSession } from "../shell/session-context";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/app/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmptyState, ErrorState, SkeletonRows } from "../app/states";
import { toast } from "sonner";

type Tab = "general" | "members" | "usage" | "security";
type Workspace = { id: string; name: string; slug: string; isPersonal: boolean; monthlyBudgetUsd: number | null; role: Role };
type Member = { id: string; userId: string; name: string; email: string; role: Role; joinedAt: string };
type Invitation = { id: string; email: string; role: Role; expiresAt: string };
type Usage = {
  days: number;
  totals: { requests: number; inputTokens: number; outputTokens: number; estimatedCost: number };
  byModel: Array<{ model: string; providerType: string | null; requests: number; inputTokens: number; outputTokens: number; estimatedCost: number }>;
  byDay: Array<{ day: string; estimatedCost: number; tokens: number }>;
  byAgent: Array<{ agentId: string | null; name: string | null; requests: number; estimatedCost: number }>;
  month: { estimatedCost: number; budgetUsd: number };
};
type AuditRow = { id: string; action: string; actorName: string | null; targetType: string | null; createdAt: string };

export function WorkspaceSettings() {
  const { t } = useI18n();
  const session = useSession();
  const [tab, setTab] = useState<Tab>("general");
  const tabs: Tab[] = ["general", "members", ...(can(session.role, "usage.view") ? (["usage", "security"] as Tab[]) : [])];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="text-[26px] font-bold">{t.settings.title}</h1>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-6 gap-6">
        <TabsList variant="line" aria-label={t.settings.title} className="w-full justify-start overflow-x-auto border-b">
          {tabs.map((x) => (
            <TabsTrigger key={x} value={x} className="min-h-11 flex-none px-3 text-[14px]">
              {t.settings.tabs[x]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <GeneralTab />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab />
        </TabsContent>
        <TabsContent value="usage">
          <UsageTab />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralTab() {
  const { t } = useI18n();
  const session = useSession();
  const q = useQuery({ queryKey: ["workspace", session.workspaceId], queryFn: () => api<Workspace>(`/api/workspaces/${session.workspaceId}`) });
  if (q.isPending) return <SkeletonRows rows={2} label={t.common.loading} />;
  if (q.isError) return <ErrorState message={t.common.errorGeneric} onRetry={() => q.refetch()} retryLabel={t.common.retry} />;
  return <GeneralForm key={q.data.id} ws={q.data} />;
}

function GeneralForm({ ws }: { ws: Workspace }) {
  const { t } = useI18n();
  const session = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState(ws.name);
  const [budget, setBudget] = useState(ws.monthlyBudgetUsd === null ? "" : String(ws.monthlyBudgetUsd));
  const [confirm, setConfirm] = useState("");
  const editable = can(session.role, "workspace.update");

  const save = useMutation({
    mutationFn: () => api(`/api/workspaces/${session.workspaceId}`, { method: "PATCH", body: { name, monthlyBudgetUsd: budget === "" ? null : Number(budget) } }),
    onSuccess: () => {
      toast(t.common.saved);
      void qc.invalidateQueries({ queryKey: ["workspace"] });
      router.refresh();
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : t.common.errorGeneric),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/workspaces/${session.workspaceId}`, { method: "DELETE", body: { confirmName: confirm } }),
    onSuccess: () => {
      qc.clear();
      router.replace("/chat");
      router.refresh();
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : t.common.errorGeneric),
  });

  return (
    <div className="max-w-xl space-y-10">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <FieldSet disabled={!editable} className="gap-5">
          <FormField label={t.settings.name}>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} dir="auto" />}</FormField>
          <FormField label={t.settings.budget} hint={t.settings.budgetHelp} optional={t.common.optional}>
            {(a) => <Input {...a} type="number" min={0} step="1" dir="ltr" value={budget} onChange={(e) => setBudget(e.target.value)} />}
          </FormField>
        </FieldSet>
        {editable && (
          <Button type="submit" variant="default" disabled={save.isPending || !name.trim()}>
            {save.isPending ? t.common.saving : t.common.save}
          </Button>
        )}
      </form>

      {can(session.role, "workspace.delete") && (
        <section aria-labelledby="del-ws" className="border-t border-border pt-6">
          <h2 id="del-ws" className="text-[17px] font-semibold text-destructive">
            {t.settings.deleteTitle}
          </h2>
          {ws.isPersonal ? (
            <p className="mt-2 text-[14px] text-muted-foreground">{t.settings.personalNote}</p>
          ) : (
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                del.mutate();
              }}
            >
              <p className="text-[14px] leading-6 text-muted-foreground">{t.settings.deleteBody}</p>
              <FormField label={t.settings.name}>{(a) => <Input {...a} value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="auto" placeholder={ws.name} />}</FormField>
              <Button type="submit" variant="destructive" disabled={confirm !== ws.name || del.isPending}>
                {t.settings.deleteAction}
              </Button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}

function MembersTab() {
  const { t, date } = useI18n();
  const session = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const ws = session.workspaceId;
  const manage = can(session.role, "members.manage");
  const members = useQuery({ queryKey: ["members", ws], queryFn: () => api<{ items: Member[] }>(`/api/workspaces/${ws}/members`).then((r) => r.items) });
  const invites = useQuery({ queryKey: ["invites", ws], queryFn: () => api<{ items: Invitation[] }>(`/api/workspaces/${ws}/invitations`).then((r) => r.items), enabled: manage });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const onErr = (e: unknown) => toast.error(e instanceof ApiRequestError ? e.message : t.common.errorGeneric);

  const invite = useMutation({
    mutationFn: () => api(`/api/workspaces/${ws}/invitations`, { body: { email, role } }),
    onSuccess: () => {
      setEmail("");
      toast(t.settings.inviteSent);
      void qc.invalidateQueries({ queryKey: ["invites", ws] });
    },
    onError: onErr,
  });
  const changeRole = useMutation({
    mutationFn: (v: { id: string; role: Role }) => api(`/api/workspaces/${ws}/members/${v.id}`, { method: "PATCH", body: { role: v.role } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["members", ws] }),
    onError: onErr,
  });
  const removeMember = useMutation({
    mutationFn: (m: Member) => api(`/api/workspaces/${ws}/members/${m.id}`, { method: "DELETE" }),
    onSuccess: (_d, m) => {
      if (m.userId === session.me.id) {
        qc.clear();
        router.replace("/chat");
        router.refresh();
      } else void qc.invalidateQueries({ queryKey: ["members", ws] });
    },
    onError: onErr,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/workspaces/${ws}/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["invites", ws] }),
    onError: onErr,
  });

  return (
    <div className="space-y-10">
      {manage && (
        <form
          className="flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (email) invite.mutate();
          }}
        >
          <FormField label={t.settings.inviteEmail} className="flex-1">
            {(a) => <Input {...a} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />}
          </FormField>
          <FormField label={t.settings.inviteRole} className="sm:w-36">
            {(a) => (
              <NativeSelect {...a} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(["admin", "member", "viewer"] as Role[]).map((r) => (
                  <NativeSelectOption key={r} value={r}>
                    {t.settings.roles[r]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <Button type="submit" variant="default" disabled={!email || invite.isPending}>
            {t.settings.invite}
          </Button>
        </form>
      )}

      <section aria-labelledby="members-h">
        <h2 id="members-h" className="text-[17px] font-semibold">
          {t.settings.members}
        </h2>
        {members.isPending && <SkeletonRows rows={2} label={t.common.loading} />}
        {members.isError && <ErrorState message={t.common.errorGeneric} onRetry={() => members.refetch()} retryLabel={t.common.retry} />}
        <ItemGroup className="mt-3 rounded-lg border">
          {members.data?.map((m, idx) => (
            <Fragment key={m.id}>
              {idx > 0 && <ItemSeparator />}
              <Item className="flex-col items-stretch sm:flex-row sm:items-center">
                <ItemContent>
                  <ItemTitle dir="auto">{m.name}</ItemTitle>
                  <ItemDescription className="text-[13px]" dir="ltr">
                    {m.email}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="flex-wrap">
                  {manage && m.role !== "owner" && m.userId !== session.me.id ? (
                    <>
                      <Label htmlFor={`role-${m.id}`} className="sr-only">
                        {t.settings.inviteRole}
                      </Label>
                      <NativeSelect id={`role-${m.id}`} className="sm:w-32" value={m.role} onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value as Role })}>
                        {(["admin", "member", "viewer"] as Role[]).map((r) => (
                          <NativeSelectOption key={r} value={r}>
                            {t.settings.roles[r]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <Button size="sm" variant="destructive" onClick={() => removeMember.mutate(m)}>
                        {t.settings.remove}
                      </Button>
                    </>
                  ) : (
                    <span className="text-[14px] text-muted-foreground">{t.settings.roles[m.role]}</span>
                  )}
                  {m.userId === session.me.id && m.role !== "owner" && (
                    <Button variant="outline" size="sm" onClick={() => removeMember.mutate(m)}>
                      {t.settings.leave}
                    </Button>
                  )}
                </ItemActions>
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      </section>

      {manage && (invites.data?.length ?? 0) > 0 && (
        <section aria-labelledby="inv-h">
          <h2 id="inv-h" className="text-[17px] font-semibold">
            {t.settings.pending}
          </h2>
          <ItemGroup className="mt-3 rounded-lg border">
            {invites.data!.map((i, idx) => (
              <Fragment key={i.id}>
                {idx > 0 && <ItemSeparator />}
                <Item size="sm">
                  <ItemContent>
                    <ItemTitle dir="ltr">{i.email}</ItemTitle>
                    <ItemDescription className="text-[13px]">
                      {t.settings.roles[i.role]} · {date(i.expiresAt, { dateStyle: "medium" })}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button variant="outline" size="sm" onClick={() => revoke.mutate(i.id)}>
                      {t.settings.revoke}
                    </Button>
                  </ItemActions>
                </Item>
              </Fragment>
            ))}
          </ItemGroup>
        </section>
      )}
    </div>
  );
}

function UsageTab() {
  const { t, f, num } = useI18n();
  const q = useQuery({ queryKey: ["usage", 30], queryFn: () => api<Usage>("/api/usage?days=30") });
  const usd = (n: number) => num(n, { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 4 : 2 });
  if (q.isPending) return <SkeletonRows rows={3} label={t.common.loading} />;
  if (q.isError) return <ErrorState message={t.common.errorGeneric} onRetry={() => q.refetch()} retryLabel={t.common.retry} />;
  const u = q.data;
  const monthShare = u.month.budgetUsd > 0 ? Math.min(1, u.month.estimatedCost / u.month.budgetUsd) : 0;
  const maxDay = Math.max(...u.byDay.map((d) => d.estimatedCost), 0);

  return (
    <div className="space-y-8">
      <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground">{t.settings.usageEstimate}</p>
      <section aria-labelledby="month-h">
        <h2 id="month-h" className="text-[15px] font-semibold">
          {f(t.settings.month, { spent: usd(u.month.estimatedCost), budget: num(u.month.budgetUsd) })}
        </h2>
        <Progress
          value={monthShare * 100}
          aria-label={t.settings.budget}
          className="mt-2 max-w-md bg-muted"
          indicatorClassName={monthShare >= 0.9 ? "bg-destructive" : "bg-primary"}
        />
      </section>

      {u.totals.requests === 0 ? (
        <EmptyState title={f(t.settings.usageTitle, { days: num(u.days) })} body={t.settings.noUsage} />
      ) : (
        <>
          <section aria-labelledby="totals-h">
            <h2 id="totals-h" className="text-[17px] font-semibold">
              {f(t.settings.usageTitle, { days: num(u.days) })}
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {[
                [t.settings.requests, num(u.totals.requests)],
                [t.settings.inputTokens, num(u.totals.inputTokens)],
                [t.settings.outputTokens, num(u.totals.outputTokens)],
                [t.settings.cost, usd(u.totals.estimatedCost)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[13px] text-muted-foreground">{k}</dt>
                  <dd className="text-[20px] font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="day-h">
            <h2 id="day-h" className="text-[15px] font-semibold">
              {t.settings.perDay}
            </h2>
            <ul className="mt-3 space-y-1.5">
              {u.byDay.map((d) => (
                <li key={d.day} className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-3 text-[13px]">
                  <span className="text-muted-foreground" dir="ltr">
                    {d.day}
                  </span>
                  <Progress value={maxDay ? (d.estimatedCost / maxDay) * 100 : 0} aria-label={d.day} className="h-3 rounded-sm bg-muted" indicatorClassName="rounded-sm bg-primary/70" />
                  <span className="text-end">{usd(d.estimatedCost)}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <UsageTable
              title={t.settings.byModel}
              rows={u.byModel.map((m) => ({ key: m.model, label: m.model, ltr: true, requests: m.requests, cost: m.estimatedCost }))}
              usd={usd}
            />
            <UsageTable
              title={t.settings.byAgent}
              rows={u.byAgent.map((a) => ({ key: a.agentId ?? "none", label: a.name ?? t.chat.agentRemoved, ltr: false, requests: a.requests, cost: a.estimatedCost }))}
              usd={usd}
            />
          </div>
        </>
      )}
    </div>
  );
}

function UsageTable({ title, rows, usd }: { title: string; rows: Array<{ key: string; label: string; ltr: boolean; requests: number; cost: number }>; usd: (n: number) => string }) {
  const { t, num } = useI18n();
  return (
    <section>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <Table className="mt-3 text-[14px]">
        <TableHeader>
          <TableRow className="text-[13px]">
            <TableHead className="text-start">{title}</TableHead>
            <TableHead className="text-end">{t.settings.requests}</TableHead>
            <TableHead className="text-end">{t.settings.cost}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="text-start" dir={r.ltr ? "ltr" : "auto"}>
                {r.label}
              </TableCell>
              <TableCell className="text-end">{num(r.requests)}</TableCell>
              <TableCell className="text-end">{usd(r.cost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function SecurityTab() {
  const { t, date } = useI18n();
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api<{ items: AuditRow[] }>("/api/audit?limit=50").then((r) => r.items) });
  if (q.isPending) return <SkeletonRows rows={4} label={t.common.loading} />;
  if (q.isError) return <ErrorState message={t.settings.noAccess} />;
  return (
    <section>
      <h2 className="text-[17px] font-semibold">{t.settings.auditTitle}</h2>
      {q.data.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted-foreground">{t.settings.auditEmpty}</p>
      ) : (
        <ItemGroup className="mt-3 rounded-lg border">
          {q.data.map((r, idx) => (
            <Fragment key={r.id}>
              {idx > 0 && <ItemSeparator />}
              <Item size="sm" className="flex-wrap">
                <ItemContent className="flex-row flex-wrap items-center gap-x-4">
                  <ItemTitle className="font-mono text-[13px]" dir="ltr">
                    {r.action}
                  </ItemTitle>
                  <ItemDescription>{r.actorName ?? ""}</ItemDescription>
                </ItemContent>
                <ItemActions className="text-[13px] text-muted-foreground">{date(r.createdAt)}</ItemActions>
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      )}
    </section>
  );
}
