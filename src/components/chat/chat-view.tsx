"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, Copy, MoreHorizontal, RotateCcw, ShieldQuestion, Square } from "lucide-react";
import { api, ApiRequestError } from "@/lib/client/api";
import type { AgentDTO, ConversationDTO, MessageDTO, ProviderDTO, TimelineItem } from "@/lib/contracts";
import { can } from "@/lib/workspaces/permissions";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n-provider";
import { useSession } from "../shell/session-context";
import { conversationsKey } from "../shell/conversation-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { AppDialog } from "../app/app-dialog";
import { FormField } from "@/components/app/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Seal } from "../app/seal";
import { EmptyState, ErrorState, Loading } from "../app/states";
import { toast } from "sonner";
import { AgentSelectorModal } from "./agent-selector-modal";
import { Markdown } from "./markdown";
import { useChatStream, type LiveItem } from "./use-chat-stream";

type ToolInfo = { name: string; label: { fa: string; en: string } };
type Timeline = { items: TimelineItem[]; activeRun: { id: string; status: string } | null };

type Row =
  | { kind: "message"; key: string; id: string; role: "user" | "assistant" | "system"; content: string; status: MessageDTO["status"]; agentId: string | null; errorMessage?: string; at?: string }
  | { kind: "tool"; key: string; name: string; status: string; agentId: string | null }
  | { kind: "delegation"; key: string; agentId: string; status: string }
  | { kind: "handoff"; key: string; fromAgentId: string | null; toAgentId: string; summary: string; manual: boolean }
  | { kind: "approval"; key: string; id: string; toolName: string; agentId: string | null; status: string }
  | { kind: "reasoning"; key: string; text: string };

function useAgents() {
  return useQuery({ queryKey: ["agents"], queryFn: () => api<{ items: AgentDTO[] }>("/api/agents").then((r) => r.items) });
}

export function ChatView({ conversationId: initialId }: { conversationId: string | null }) {
  const { t, f, locale } = useI18n();
  const session = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState(initialId);
  const pendingFirst = useRef<string | null>(null);
  const [draftAgentId, setDraftAgentId] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const agentsQ = useAgents();
  const providersQ = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<{ items: ProviderDTO[] }>("/api/providers").then((r) => r.items),
    enabled: can(session.role, "providers.view"),
  });
  const toolsQ = useQuery({ queryKey: ["tools"], queryFn: () => api<{ items: ToolInfo[] }>("/api/tools").then((r) => r.items), staleTime: Infinity });
  const convQ = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api<ConversationDTO>(`/api/conversations/${conversationId}`),
    enabled: !!conversationId,
  });
  const timelineQ = useQuery({
    queryKey: ["timeline", conversationId],
    queryFn: () => api<Timeline>(`/api/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
  });

  const stream = useChatStream(conversationId, {
    onSettled: async () => {
      await Promise.all([qc.refetchQueries({ queryKey: ["timeline", conversationId] }), qc.invalidateQueries({ queryKey: ["conversation", conversationId] })]);
      void qc.invalidateQueries({ queryKey: conversationsKey });
      stream.reset();
      setHidden(new Set());
    },
  });

  // A refreshed page re-attaches to a reply that is still being generated.
  const activeRunId = timelineQ.data?.activeRun?.id;
  useEffect(() => {
    if (activeRunId && !stream.busy && stream.runId !== activeRunId) void stream.attach(activeRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId]);

  // First message of a new conversation: start once the hook has switched to the new id.
  useEffect(() => {
    const content = pendingFirst.current;
    if (conversationId && content) {
      pendingFirst.current = null;
      void stream.start({ conversationId, content });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const agents = agentsQ.data ?? [];
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const eligible = agents.filter((a) => a.isActive && a.mode !== "subagent").sort((a, b) => Number(b.mode === "primary") - Number(a.mode === "primary"));
  const conv = convQ.data;
  const activeAgentId = conv ? conv.activeAgentId : (draftAgentId ?? eligible[0]?.id ?? null);
  const activeAgent = activeAgentId ? agentById.get(activeAgentId) : undefined;
  const canWrite = conv ? conv.canWrite : can(session.role, "conversations.create");
  const toolLabel = (name: string) => toolsQ.data?.find((x) => x.name === name)?.label[locale] ?? name;
  const agentName = (id: string | null) => (id ? (agentById.get(id)?.name ?? t.chat.agentRemoved) : "");

  const rows: Row[] = useMemo(() => {
    const liveIds = new Set(stream.items.filter((i) => i.kind === "message").map((i) => i.id));
    const out: Row[] = [];
    const items = timelineQ.data?.items ?? [];
    // Tool runs finish after their reply row is created, so place them just before that reply.
    const toolsByRun = new Map<string, Row[]>();
    for (const it of items) {
      if (it.kind !== "tool" || it.runId === stream.runId) continue;
      const list = toolsByRun.get(it.runId) ?? [];
      list.push({ kind: "tool", key: it.id, name: it.toolName, status: it.status, agentId: null });
      toolsByRun.set(it.runId, list);
    }
    for (const it of items) {
      if (it.kind === "message") {
        const m = it.message;
        if (liveIds.has(m.id) || hidden.has(m.id)) continue;
        if (m.role === "assistant" && m.runId && toolsByRun.has(m.runId)) {
          out.push(...toolsByRun.get(m.runId)!);
          toolsByRun.delete(m.runId);
        }
        // A lead agent that only handed off leaves an empty reply; the divider says what happened.
        if (m.role === "assistant" && m.status === "completed" && !m.content.trim()) continue;
        out.push({ kind: "message", key: m.id, ...m, at: m.createdAt });
      } else if (it.kind === "tool") {
        continue;
      } else if (it.kind === "handoff") {
        if (it.runId && it.runId === stream.runId) continue;
        out.push({ kind: "handoff", key: it.id, fromAgentId: it.fromAgentId, toAgentId: it.toAgentId, summary: it.summary, manual: it.mode === "manual" });
      } else if (it.kind === "approval") {
        if (it.runId === stream.runId || it.status === "pending") continue;
      }
    }
    for (const rest of toolsByRun.values()) out.push(...rest);
    const live: Row[] = stream.items.filter((i) => !(i.kind === "message" && i.role === "assistant" && i.status === "completed" && !i.content.trim())).map((i: LiveItem): Row => {
      switch (i.kind) {
        case "message":
          return { kind: "message", key: i.id, id: i.id, role: i.role, content: i.content, status: i.status, agentId: i.agentId, errorMessage: i.errorMessage };
        case "tool":
          return { kind: "tool", key: i.id, name: i.name, status: i.status, agentId: i.agentId };
        case "delegation":
          return { kind: "delegation", key: i.id, agentId: i.agentId, status: i.status };
        case "handoff":
          return { kind: "handoff", key: i.id, fromAgentId: i.fromAgentId, toAgentId: i.toAgentId, summary: i.summary, manual: false };
        case "approval":
          return { kind: "approval", key: i.id, id: i.id, toolName: i.toolName, agentId: i.agentId, status: i.status };
        case "reasoning":
          return { kind: "reasoning", key: i.id, text: i.text };
      }
    });
    return [...out, ...live];
  }, [timelineQ.data, stream.items, stream.runId, hidden]);

  const lastAssistant = [...rows].reverse().find((r) => r.kind === "message" && r.role === "assistant") as Extract<Row, { kind: "message" }> | undefined;
  const lastUser = [...rows].reverse().find((r) => r.kind === "message" && r.role === "user") as Extract<Row, { kind: "message" }> | undefined;

  const send = async (content: string) => {
    if (conversationId) return stream.start({ conversationId, content });
    if (!activeAgentId) return;
    try {
      const created = await api<ConversationDTO>("/api/conversations", { body: { agentId: activeAgentId } });
      qc.setQueryData(["conversation", created.id], created);
      qc.setQueryData(["timeline", created.id], { items: [], activeRun: null } satisfies Timeline);
      window.history.replaceState(null, "", `/chat/${created.id}`);
      pendingFirst.current = content;
      setConversationId(created.id);
      void qc.invalidateQueries({ queryKey: conversationsKey });
    } catch {
      toast.error(t.common.errorGeneric);
    }
  };

  const retry = () => {
    if (!conversationId || !lastUser || lastUser.id.startsWith("local-")) return;
    if (lastAssistant && (lastAssistant.status === "failed" || lastAssistant.status === "cancelled")) setHidden(new Set([lastAssistant.id]));
    void stream.start({ conversationId, content: lastUser.content, retryOfMessageId: lastUser.id, optimisticUser: false });
  };

  const switchAgent = useMutation({
    mutationFn: (agentId: string) => api<ConversationDTO>(`/api/conversations/${conversationId}/agent`, { method: "PUT", body: { agentId } }),
    onSuccess: (c) => {
      qc.setQueryData(["conversation", c.id], c);
      void qc.invalidateQueries({ queryKey: ["timeline", c.id] });
      setSelectorOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : t.common.errorGeneric),
  });

  // Empty and error states for the whole view.
  if (agentsQ.isPending || (conversationId && (convQ.isPending || timelineQ.isPending))) return <Loading className="px-6" label={t.common.loading} />;
  if (convQ.isError) {
    const nf = convQ.error instanceof ApiRequestError && convQ.error.status === 404;
    return (
      <div className="px-4 py-10 sm:px-8">
        <EmptyState
          title={nf ? t.chat.notFound : t.chat.loadError}
          body=""
          action={
            <Link href="/chat" className={buttonVariants({ variant: "outline" })}>
              {t.chat.newChat}
            </Link>
          }
        />
      </div>
    );
  }
  if (agentsQ.isError || timelineQ.isError) {
    return (
      <div className="px-4 py-10 sm:px-8">
        <ErrorState message={t.chat.loadError} onRetry={() => (agentsQ.refetch(), timelineQ.refetch())} retryLabel={t.common.retry} />
      </div>
    );
  }
  if (!conversationId && eligible.length === 0) {
    const noProviders = providersQ.isSuccess && providersQ.data.length === 0;
    return (
      <div className="px-4 py-10 sm:px-10">
        {noProviders && can(session.role, "providers.manage") ? (
          <EmptyState
            title={t.chat.noProviderTitle}
            body={t.chat.noProviderBody}
            action={
              <Link href="/providers" className={buttonVariants()}>
                {t.chat.addProvider}
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={t.chat.noAgentTitle}
            body={t.chat.noAgentBody}
            action={
              can(session.role, "agents.create") ? (
                <Link href="/agents/new" className={buttonVariants()}>
                  {t.chat.createAgent}
                </Link>
              ) : undefined
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-dvh">
      <ChatHeader
        conv={conv ?? null}
        agent={activeAgent}
        canWrite={canWrite}
        onPickAgent={() => setSelectorOpen(true)}
        providers={providersQ.data ?? []}
        onDeleted={() => {
          void qc.invalidateQueries({ queryKey: conversationsKey });
          router.push("/chat");
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto" id="chat-scroll">
        <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-6 sm:px-6">
          {rows.length === 0 && activeAgent && (
            <div className="pb-6 pt-10">
              <h1 className="text-[22px] font-bold" dir="auto">
                {f(t.chat.startTitle, { agent: activeAgent.name })}
              </h1>
              <p className="mt-2 max-w-lg text-[15px] leading-7 text-muted-foreground">{t.chat.startBody}</p>
            </div>
          )}
          <ol className="space-y-5">
            {rows.map((r) => (
              <li key={r.key}>
                <RowView
                  row={r}
                  agentName={agentName}
                  agentColor={(id) => (id ? agentById.get(id)?.avatar : undefined) ?? "slate"}
                  toolLabel={toolLabel}
                  isLastAssistant={lastAssistant?.key === r.key}
                  canRetry={canWrite && !stream.busy}
                  onRetry={retry}
                />
              </li>
            ))}
          </ol>
          {stream.status === "reconnecting" && (
            <p role="status" className="mt-4 text-[14px] text-muted-foreground">
              {t.chat.reconnecting}
            </p>
          )}
          {stream.error && !rows.some((r) => r.kind === "message" && r.status === "failed") && stream.error.code !== "NETWORK" && (
            <div className="mt-4">
              <ErrorState message={stream.error.message || t.common.errorGeneric} />
            </div>
          )}
          <AutoScroll dep={rows} />
        </div>
      </div>

      {canWrite ? (
        <Composer
          disabled={!activeAgent}
          busy={stream.busy}
          stopping={stream.status === "stopping"}
          canStop={!!stream.runId}
          onSend={send}
          onStop={stream.stop}
        />
      ) : (
        <p className="border-t border-border px-4 py-4 text-center text-[14px] text-muted-foreground">{t.chat.readOnly}</p>
      )}

      <AgentSelectorModal
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        agents={agents}
        currentId={activeAgentId}
        busy={switchAgent.isPending}
        onSelect={(id) => {
          if (!conversationId) {
            setDraftAgentId(id);
            setSelectorOpen(false);
          } else switchAgent.mutate(id);
        }}
      />
    </div>
  );
}

function AutoScroll({ dep }: { dep: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = document.getElementById("chat-scroll");
    if (!scroller) return;
    // Follow the stream only while the reader is near the bottom.
    const near = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
    if (near) ref.current?.scrollIntoView({ block: "end" });
  }, [dep]);
  return <div ref={ref} />;
}

function ChatHeader({
  conv,
  agent,
  canWrite,
  onPickAgent,
  providers,
  onDeleted,
}: {
  conv: ConversationDTO | null;
  agent: AgentDTO | undefined;
  canWrite: boolean;
  onPickAgent: () => void;
  providers: ProviderDTO[];
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [title, setTitle] = useState(conv?.title ?? "");

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<ConversationDTO>(`/api/conversations/${conv!.id}`, { method: "PATCH", body }),
    onSuccess: (c) => {
      qc.setQueryData(["conversation", c.id], c);
      void qc.invalidateQueries({ queryKey: conversationsKey });
    },
    onError: () => toast.error(t.common.errorGeneric),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/conversations/${conv!.id}`, { method: "DELETE" }),
    onSuccess: onDeleted,
    onError: () => toast.error(t.common.errorGeneric),
  });

  const modelValue = conv?.providerConnectionId ? `${conv.providerConnectionId}::${conv.model ?? ""}` : "";
  const agentConn = providers.find((p) => p.id === agent?.providerConnectionId);
  const agentModel = agent?.model || agentConn?.defaultModel;

  return (
    <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-5">
      <Button
        variant="ghost"
        onClick={onPickAgent}
        disabled={!canWrite}
        className="px-2 disabled:opacity-100"
        aria-label={`${t.chat.changeAgent}: ${agent?.name ?? t.chat.pickAgent}`}
      >
        {agent ? <Seal name={agent.name} color={agent.avatar} size="sm" /> : null}
        <span className="text-[15px] font-semibold">{agent?.name ?? t.chat.pickAgent}</span>
        {canWrite && <span className="text-[13px] font-normal text-muted-foreground">{t.chat.changeAgent}</span>}
      </Button>

      {conv && canWrite && providers.length > 0 && (
        <div className="min-w-0">
          <Label htmlFor="model-select" className="sr-only">
            {t.agents.model}
          </Label>
          <NativeSelect
            id="model-select"
            className="h-11 max-w-[15rem] text-[13px] sm:h-9"
            value={modelValue}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) patch.mutate({ providerConnectionId: null, model: null });
              else {
                const [providerConnectionId, model] = v.split("::");
                patch.mutate({ providerConnectionId, model: model || null });
              }
            }}
          >
            <NativeSelectOption value="">{`${t.agents.modelDefault}${agentModel ? ` (${agentModel})` : ""}`}</NativeSelectOption>
            {providers.map((p) => (
              <NativeSelectOptGroup key={p.id} label={p.label}>
                {p.models.map((m) => (
                  <NativeSelectOption key={m.id} value={`${p.id}::${m.id}`}>
                    {m.label ?? m.id}
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
            ))}
          </NativeSelect>
        </div>
      )}

      <div className="ms-auto flex items-center gap-1">
        {conv?.visibility === "workspace" && <span className="text-[13px] text-muted-foreground">{t.chat.shared}</span>}
        {conv && canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`${t.chat.rename}, ${t.chat.share}, ${t.chat.deleteChat}`}>
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem
                className="min-h-11 sm:min-h-8"
                onSelect={() => {
                  setTitle(conv.title);
                  setRenameOpen(true);
                }}
              >
                {t.chat.rename}
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11 sm:min-h-8" onSelect={() => patch.mutate({ visibility: conv.visibility === "workspace" ? "private" : "workspace" })}>
                {conv.visibility === "workspace" ? t.chat.unshare : t.chat.share}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" className="min-h-11 sm:min-h-8" onSelect={() => setDeleteOpen(true)}>
                {t.chat.deleteChat}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <AppDialog open={renameOpen} onOpenChange={setRenameOpen} title={t.chat.rename}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) patch.mutate({ title }, { onSuccess: () => setRenameOpen(false) });
          }}
        >
          <FormField label={t.chat.rename}>{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} dir="auto" autoFocus />}</FormField>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRenameOpen(false)}>{t.common.cancel}</Button>
            <Button type="submit" variant="default" disabled={patch.isPending || !title.trim()}>
              {t.common.save}
            </Button>
          </div>
        </form>
      </AppDialog>
      <AppDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t.chat.deleteChat} description={t.common.confirmDelete}>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
          <Button variant="destructive" onClick={() => del.mutate()} disabled={del.isPending}>
            {t.common.delete}
          </Button>
        </div>
      </AppDialog>
    </header>
  );
}

function RowView({
  row,
  agentName,
  agentColor,
  toolLabel,
  isLastAssistant,
  canRetry,
  onRetry,
}: {
  row: Row;
  agentName: (id: string | null) => string;
  agentColor: (id: string | null) => string;
  toolLabel: (n: string) => string;
  isLastAssistant: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const { t, f } = useI18n();
  switch (row.kind) {
    case "message":
      return <MessageView row={row} agentName={agentName} agentColor={agentColor} isLastAssistant={isLastAssistant} canRetry={canRetry} onRetry={onRetry} />;
    case "tool": {
      const name = toolLabel(row.name);
      const text =
        row.status === "completed"
          ? f(t.chat.toolDone, { tool: name })
          : row.status === "failed"
            ? f(t.chat.toolFailed, { tool: name })
            : row.status === "rejected"
              ? f(t.chat.toolRejected, { tool: name })
              : row.status === "waiting_for_approval" || row.status === "pending_approval"
                ? f(t.chat.toolWaiting, { tool: name })
                : f(t.chat.toolRunning, { tool: name });
      return (
        <p className={cn("text-[13px]", row.status === "failed" || row.status === "rejected" ? "text-destructive" : "text-muted-foreground")} role="status">
          {text}
        </p>
      );
    }
    case "delegation": {
      const text = row.status === "running" ? t.chat.delegating : row.status === "completed" ? t.chat.delegationDone : t.chat.delegationFailed;
      return (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
          <Seal name={agentName(row.agentId)} color={agentColor(row.agentId)} size="sm" />
          {f(text, { agent: agentName(row.agentId) })}
        </p>
      );
    }
    case "handoff":
      return (
        <div className="flex items-center gap-3 py-1" role="separator" aria-label={f(row.manual ? t.chat.manualSwitch : t.chat.handoff, { agent: agentName(row.toAgentId) })}>
          <Separator className="flex-1 bg-input" />
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Seal name={agentName(row.toAgentId)} color={agentColor(row.toAgentId)} size="sm" />
            {f(row.manual ? t.chat.manualSwitch : t.chat.handoff, { agent: agentName(row.toAgentId) })}
          </span>
          <Separator className="flex-1 bg-input" />
        </div>
      );
    case "approval":
      return <ApprovalCard row={row} agentName={agentName} toolLabel={toolLabel} />;
    case "reasoning":
      return (
        <Collapsible className="text-[13px] text-muted-foreground">
          <CollapsibleTrigger asChild>
            <Button variant="link" className="h-11 p-0 text-[13px] text-muted-foreground sm:h-auto sm:h-auto">
              {t.chat.reasoning}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="whitespace-pre-wrap leading-6" dir="auto">
              {row.text}
            </p>
          </CollapsibleContent>
        </Collapsible>
      );
  }
}

function MessageView({
  row,
  agentName,
  agentColor,
  isLastAssistant,
  canRetry,
  onRetry,
}: {
  row: Extract<Row, { kind: "message" }>;
  agentName: (id: string | null) => string;
  agentColor: (id: string | null) => string;
  isLastAssistant: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const isUser = row.role === "user";
  const streaming = row.status === "streaming";
  const copy = () =>
    void navigator.clipboard.writeText(row.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  if (isUser) {
    return (
      <Card className="gap-1 rounded-lg border-0 px-4 py-3 shadow-none">
        <p className="text-[12px] font-medium text-muted-foreground">{t.chat.you}</p>
        <p className="whitespace-pre-wrap text-[16px] leading-[1.85]" dir="auto">
          {row.content}
        </p>
        {row.status === "failed" && (
          <p role="alert" className="mt-2 text-[13px] text-destructive">
            {t.common.errorGeneric}
          </p>
        )}
      </Card>
    );
  }

  return (
    <article className={cn("group", row.status === "completed" && "animate-settle")} aria-busy={streaming}>
      <header className="mb-1.5 flex items-center gap-2">
        <Seal name={agentName(row.agentId)} color={agentColor(row.agentId)} size="sm" />
        <span className="text-[13px] font-semibold">{agentName(row.agentId)}</span>
      </header>
      {row.content ? (
        <div className={cn(streaming && "streaming")}>
          <Markdown text={row.content} />
        </div>
      ) : streaming ? (
        <p className="caret text-[15px] text-muted-foreground" aria-label={t.common.loading} />
      ) : null}
      {row.status === "failed" && (
        <p role="alert" className="mt-2 text-[14px] text-destructive">
          {row.errorMessage || t.chat.failed}
        </p>
      )}
      {row.status === "cancelled" && <p className="mt-2 text-[13px] text-muted-foreground">{t.chat.stopped}</p>}
      {!streaming && (
        <div className="mt-1 flex gap-1">
          {row.content && (
            <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={copied ? t.common.copied : t.chat.copyMessage} className="text-muted-foreground">
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </Button>
          )}
          {isLastAssistant && canRetry && (
            <Button variant="ghost" size="icon-sm" onClick={onRetry} aria-label={t.chat.retryMessage} className="text-muted-foreground">
              <RotateCcw aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function ApprovalCard({ row, agentName, toolLabel }: { row: Extract<Row, { kind: "approval" }>; agentName: (id: string | null) => string; toolLabel: (n: string) => string }) {
  const { t, f } = useI18n();
  const [busy, setBusy] = useState(false);
  const decide = async (d: "approve" | "reject") => {
    setBusy(true);
    try {
      await api(`/api/approvals/${row.id}/${d}`, { method: "POST" });
    } catch (e) {
      toast.error(e instanceof ApiRequestError ? e.message : t.common.errorGeneric);
    } finally {
      setBusy(false);
    }
  };
  if (row.status !== "pending") {
    return <p className="text-[13px] text-muted-foreground">{row.status === "expired" ? t.chat.approvalExpired : f(row.status === "approved" ? t.chat.toolDone : t.chat.toolRejected, { tool: toolLabel(row.toolName) })}</p>;
  }
  return (
    <Alert role="alertdialog" aria-labelledby={`ap-${row.id}`} className="border-input bg-card">
      <ShieldQuestion aria-hidden="true" />
      <AlertTitle id={`ap-${row.id}`} className="text-[15px]">
        {f(t.chat.approvalTitle, { agent: agentName(row.agentId), tool: toolLabel(row.toolName) })}
      </AlertTitle>
      <AlertDescription className="text-[14px]">{t.chat.approvalBody}</AlertDescription>
      <div className="col-start-2 mt-3 flex gap-2">
        <Button variant="default" onClick={() => decide("approve")} disabled={busy}>
          {t.chat.approve}
        </Button>
        <Button variant="outline" onClick={() => decide("reject")} disabled={busy}>
          {t.chat.reject}
        </Button>
      </div>
    </Alert>
  );
}

function Composer({
  disabled,
  busy,
  stopping,
  canStop,
  onSend,
  onStop,
}: {
  disabled: boolean;
  busy: boolean;
  stopping: boolean;
  canStop: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);
  const submit = () => {
    const v = text.trim();
    if (!v || busy || disabled) return;
    onSend(v);
    setText("");
  };
  return (
    <div className="border-t border-border bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      <form
        className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-input bg-card p-2 focus-within:border-foreground/40"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Label htmlFor="composer" className="sr-only">
          {t.chat.placeholder}
        </Label>
        <Textarea
          id="composer"
          ref={ref}
          rows={1}
          dir="auto"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t.chat.placeholder}
          className="max-h-[220px] min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-[16px] leading-7 shadow-none focus-visible:ring-0 md:text-[16px] dark:bg-transparent"
        />
        {busy ? (
          <Button size="icon" className="size-11 shrink-0" onClick={onStop} disabled={!canStop || stopping} aria-label={stopping ? t.chat.stopping : t.chat.stop}>
            <Square fill="currentColor" aria-hidden="true" />
          </Button>
        ) : (
          <Button type="submit" variant="brand" size="icon" className="size-11 shrink-0" disabled={disabled || !text.trim()} aria-label={t.chat.send}>
            <ArrowUp className="size-5" aria-hidden="true" />
          </Button>
        )}
      </form>
    </div>
  );
}
