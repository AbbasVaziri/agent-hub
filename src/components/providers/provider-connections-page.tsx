"use client";

import { Fragment, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "@/lib/client/api";
import type { ProviderDTO } from "@/lib/contracts";
import { can } from "@/lib/workspaces/permissions";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n-provider";
import { useSession } from "../shell/session-context";
import { Button } from "@/components/ui/button";
import { AppDialog } from "../app/app-dialog";
import { CheckboxField, FormField } from "@/components/app/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmptyState, ErrorState, SkeletonRows } from "../app/states";
import { toast } from "sonner";

type PType = ProviderDTO["providerType"];
const TYPES: PType[] = ["openai", "anthropic", "openrouter", "ollama", "openai_compatible"];
const NEEDS_URL: Record<PType, boolean> = { openai: false, anthropic: false, openrouter: false, ollama: true, openai_compatible: true };
const NEEDS_KEY: Record<PType, boolean> = { openai: true, anthropic: true, openrouter: true, ollama: false, openai_compatible: false };
const URL_PLACEHOLDER: Record<PType, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://127.0.0.1:11434/v1",
  openai_compatible: "https://example.com/v1",
};

type TestResult = { ok: boolean; error?: string; count?: number } | null;

function ConnectionForm({ initial, onDone }: { initial: ProviderDTO | null; onDone: () => void }) {
  const { t, f, num } = useI18n();
  const qc = useQueryClient();
  const [type, setType] = useState<PType>(initial?.providerType ?? "openai");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [defaultModel, setDefaultModel] = useState(initial?.defaultModel ?? "");
  const [manual, setManual] = useState((initial?.models ?? []).filter((m) => m.manual).map((m) => m.id).join(", "));
  const [discovered, setDiscovered] = useState<string[]>((initial?.models ?? []).map((m) => m.id));
  const [test, setTest] = useState<TestResult>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [priceIn, setPriceIn] = useState(initial?.pricing ? String(initial.pricing.inputPerMTok) : "");
  const [priceOut, setPriceOut] = useState(initial?.pricing ? String(initial.pricing.outputPerMTok) : "");

  const manualIds = manual
    .split(/[,،\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const modelOptions = [...new Set([...discovered, ...manualIds])];

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      if (initial && !apiKey && baseUrl === (initial.baseUrl ?? "")) {
        const r = await api<{ ok: boolean; error?: string; modelCount?: number; connection: ProviderDTO }>(`/api/providers/${initial.id}/test`, { method: "POST" });
        setDiscovered(r.connection.models.map((m) => m.id));
        setTest({ ok: r.ok, error: r.error, count: r.modelCount });
        void qc.invalidateQueries({ queryKey: ["providers"] });
      } else {
        const r = await api<{ ok: boolean; error?: string; models?: Array<{ id: string }> }>("/api/providers/test-draft", {
          body: { providerType: type, baseUrl: baseUrl || null, apiKey: apiKey || null },
        });
        if (r.models) setDiscovered(r.models.map((m) => m.id));
        setTest({ ok: r.ok, error: r.error, count: r.models?.length });
      }
    } catch (e) {
      setTest({ ok: false, error: e instanceof ApiRequestError ? e.message : t.common.errorGeneric });
    } finally {
      setTesting(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const pricing = priceIn !== "" && priceOut !== "" ? { inputPerMTok: Number(priceIn), outputPerMTok: Number(priceOut) } : null;
      const common = { label, baseUrl: baseUrl || null, defaultModel: defaultModel || null, manualModels: manualIds, pricing };
      if (initial) {
        const body: Record<string, unknown> = { ...common };
        if (apiKey) body.apiKey = apiKey;
        else if (clearKey) body.apiKey = null;
        await api(`/api/providers/${initial.id}`, { method: "PATCH", body });
      } else {
        const created = await api<ProviderDTO>("/api/providers", { body: { ...common, providerType: type, apiKey: apiKey || null } });
        // Fill the model list right away; a failure here is shown on the card, not blocking.
        if (created.models.length === 0) await api(`/api/providers/${created.id}/test`, { method: "POST" }).catch(() => undefined);
      }
      void qc.invalidateQueries({ queryKey: ["providers"] });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.common.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <FormField label={t.providers.type}>
        {(a) => (
          <NativeSelect {...a} value={type} onChange={(e) => setType(e.target.value as PType)} disabled={!!initial}>
            {TYPES.map((x) => (
              <NativeSelectOption key={x} value={x}>
                {t.providers.types[x]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField label={t.providers.label}>{(a) => <Input {...a} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} dir="auto" placeholder={t.providers.types[type]} />}</FormField>
      <FormField label={t.providers.baseUrl} optional={NEEDS_URL[type] ? undefined : t.common.optional} hint={type === "ollama" ? t.providers.privateHint : undefined}>
        {(a) => <Input {...a} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} dir="ltr" inputMode="url" placeholder={URL_PLACEHOLDER[type]} />}
      </FormField>
      <FormField
        label={t.providers.apiKey}
        optional={NEEDS_KEY[type] ? undefined : t.common.optional}
        hint={initial ? (initial.hasApiKey ? f(t.providers.apiKeySaved, { hint: initial.apiKeyHint ?? "••••" }) : t.providers.apiKeyNone) : undefined}
      >
        {(a) => <Input {...a} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} dir="ltr" placeholder="sk-…" />}
      </FormField>
      {initial?.hasApiKey && !apiKey && (
        <CheckboxField label={t.providers.clearKey} checked={clearKey} onCheckedChange={setClearKey} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={runTest} disabled={testing}>
          {testing ? t.providers.testing : t.providers.test}
        </Button>
        {test && (
          <p role="status" className={cn("text-[14px]", test.ok ? "text-foreground" : "text-destructive")}>
            {test.ok ? f(t.providers.testOk, { count: num(test.count ?? 0) }) : test.error}
          </p>
        )}
      </div>

      <FormField label={t.providers.manualModels} optional={t.common.optional} hint={t.providers.manualModelsHelp}>
        {(a) => <Input {...a} value={manual} onChange={(e) => setManual(e.target.value)} dir="ltr" placeholder="model-id-1, model-id-2" />}
      </FormField>
      <FormField label={t.providers.defaultModel} optional={t.common.optional}>
        {(a) => (
          <NativeSelect {...a} value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} dir="ltr">
            <NativeSelectOption value="">{t.common.none}</NativeSelectOption>
            {modelOptions.map((m) => (
              <NativeSelectOption key={m} value={m}>
                {m}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>

      <FieldSet className="gap-3">
        <FieldLegend variant="label" className="text-[13px]">
          {t.providers.pricing} <span className="font-normal text-muted-foreground">({t.common.optional})</span>
        </FieldLegend>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t.providers.priceIn}>{(a) => <Input {...a} type="number" min={0} step="0.01" dir="ltr" value={priceIn} onChange={(e) => setPriceIn(e.target.value)} />}</FormField>
          <FormField label={t.providers.priceOut}>{(a) => <Input {...a} type="number" min={0} step="0.01" dir="ltr" value={priceOut} onChange={(e) => setPriceOut(e.target.value)} />}</FormField>
        </div>
      </FieldSet>

      {error && (
        <Alert variant="destructive" className="bg-destructive-soft">
          <AlertDescription className="text-[14px]">{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onDone}>{t.common.cancel}</Button>
        <Button type="submit" variant="default" disabled={saving || !label.trim()}>
          {saving ? t.common.saving : t.common.save}
        </Button>
      </div>
    </form>
  );
}

export function ProviderConnectionsPage() {
  const { t, f, date, num } = useI18n();
  const session = useSession();
  const qc = useQueryClient();
  const manage = can(session.role, "providers.manage");
  const [editing, setEditing] = useState<ProviderDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProviderDTO | null>(null);
  const q = useQuery({ queryKey: ["providers"], queryFn: () => api<{ items: ProviderDTO[] }>("/api/providers").then((r) => r.items) });

  const refresh = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean; error?: string; modelCount?: number }>(`/api/providers/${id}/models`, { method: "POST" }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["providers"] });
      r.ok ? toast.success(f(t.providers.testOk, { count: num(r.modelCount ?? 0) })) : toast.error(r.error ?? t.common.errorGeneric);
    },
    onError: () => toast.error(t.common.errorGeneric),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/providers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: () => toast.error(t.common.errorGeneric),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold">{t.providers.title}</h1>
          <p className="mt-1 max-w-xl text-[15px] leading-7 text-muted-foreground">{t.providers.intro}</p>
        </div>
        {manage && (
          <Button variant="default" onClick={() => setEditing("new")}>
            {t.providers.add}
          </Button>
        )}
      </div>
      {!manage && <p className="mt-3 text-[14px] text-muted-foreground">{t.providers.viewOnly}</p>}

      <div className="mt-8">
        {q.isPending && <SkeletonRows rows={3} label={t.common.loading} />}
        {q.isError && <ErrorState message={t.providers.loadError} onRetry={() => q.refetch()} retryLabel={t.common.retry} />}
        {q.isSuccess && q.data.length === 0 && (
          <EmptyState title={t.providers.emptyTitle} body={t.providers.emptyBody} action={manage ? <Button variant="default" onClick={() => setEditing("new")}>{t.providers.add}</Button> : undefined} />
        )}
        {q.isSuccess && q.data.length > 0 && (
          <ItemGroup className="rounded-lg border bg-card">
            {q.data.map((p, idx) => (
              <Fragment key={p.id}>
                {idx > 0 && <ItemSeparator />}
                <Item className="flex-col items-stretch sm:flex-row sm:items-start">
                  <ItemContent>
                    <ItemTitle className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-[16px]" dir="auto">
                        {p.label}
                      </span>
                      <span className="text-[13px] font-normal text-muted-foreground">{t.providers.types[p.providerType]}</span>
                    </ItemTitle>
                    <ItemDescription className="text-[13px]">
                      <span className={cn("font-medium", p.lastTestStatus === "failed" && "text-destructive", p.lastTestStatus === "ok" && "text-foreground")}>
                        {t.providers.status[p.lastTestStatus]}
                      </span>
                      {p.lastTestedAt && ` · ${f(t.providers.lastTested, { time: date(p.lastTestedAt) })}`}
                      {` · ${f(t.providers.models, { count: num(p.models.length) })}`}
                      {p.hasApiKey && <span dir="ltr">{` · ${p.apiKeyHint}`}</span>}
                    </ItemDescription>
                    {p.lastTestError && <p className="text-[13px] text-destructive">{p.lastTestError}</p>}
                    {p.defaultModel && (
                      <p className="text-[13px] text-muted-foreground">
                        {t.providers.defaultModel}: <span dir="ltr">{p.defaultModel}</span>
                      </p>
                    )}
                  </ItemContent>
                  {manage && (
                    <ItemActions className="flex-wrap">
                      <Button variant="outline" size="sm" onClick={() => refresh.mutate(p.id)} disabled={refresh.isPending}>
                        {t.providers.refresh}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                        {t.common.edit}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setDeleting(p)}>
                        {t.common.delete}
                      </Button>
                    </ItemActions>
                  )}
                </Item>
              </Fragment>
            ))}
          </ItemGroup>
        )}
      </div>

      <AppDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === "new" ? t.providers.addTitle : t.providers.editTitle}>
        {editing !== null && <ConnectionForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </AppDialog>
      <AppDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={t.common.delete} description={f(t.providers.deleteConfirm, { name: deleting?.label ?? "" })}>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)}>{t.common.cancel}</Button>
          <Button variant="destructive" onClick={() => deleting && remove.mutate(deleting.id)} disabled={remove.isPending}>
            {t.common.delete}
          </Button>
        </div>
      </AppDialog>
    </div>
  );
}
