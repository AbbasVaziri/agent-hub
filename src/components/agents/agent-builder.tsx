"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { api, ApiRequestError } from "@/lib/client/api";
import { agentInputSchema, SEAL_COLORS, TONES, type AgentDTO, type ProviderDTO } from "@/lib/contracts";
import { can } from "@/lib/workspaces/permissions";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n-provider";
import { useSession } from "../shell/session-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { AppDialog } from "../app/app-dialog";
import { CheckboxField, FormField } from "@/components/app/form-field";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Seal } from "../app/seal";
import { EmptyState, ErrorState, Loading } from "../app/states";
import { toast } from "sonner";

type FormIn = z.input<typeof agentInputSchema>;
type FormOut = z.output<typeof agentInputSchema>;
type ToolInfo = { name: string; kind: "builtin" | "control"; label: { fa: string; en: string }; description: string };

// Schema defaults, with an empty name for the user to fill in.
const DEFAULTS: FormIn = { ...agentInputSchema.parse({ name: "x" }), name: "" };

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6">
      <Separator className="mb-6" />
      <h2 id={`${id}-h`} className="text-[17px] font-semibold">
        {title}
      </h2>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

export function AgentBuilder({ agentId }: { agentId: string | null }) {
  const { t, locale, f } = useI18n();
  const session = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const agentsQ = useQuery({ queryKey: ["agents"], queryFn: () => api<{ items: AgentDTO[] }>("/api/agents").then((r) => r.items) });
  const providersQ = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<{ items: ProviderDTO[] }>("/api/providers").then((r) => r.items),
    enabled: can(session.role, "providers.view"),
  });
  const toolsQ = useQuery({ queryKey: ["tools"], queryFn: () => api<{ items: ToolInfo[] }>("/api/tools").then((r) => r.items), staleTime: Infinity });
  const existing = agentId ? agentsQ.data?.find((a) => a.id === agentId) : undefined;
  const readOnly = agentId ? !existing?.canEdit : !can(session.role, "agents.create");

  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(agentInputSchema), defaultValues: DEFAULTS });
  useEffect(() => {
    if (existing) {
      const { id: _i, canEdit: _c, createdByUserId: _b, updatedAt: _u, ...values } = existing;
      form.reset(values);
    }
  }, [existing, form]);

  const mode = form.watch("mode");
  const providerId = form.watch("providerConnectionId");
  const provider = providersQ.data?.find((p) => p.id === providerId);
  const others = useMemo(() => (agentsQ.data ?? []).filter((a) => a.id !== agentId), [agentsQ.data, agentId]);
  const delegationCandidates = others.filter((a) => a.mode !== "primary");
  const handoffCandidates = others.filter((a) => a.mode !== "subagent");

  const save = useMutation({
    mutationFn: (v: FormOut) =>
      agentId ? api<AgentDTO>(`/api/agents/${agentId}`, { method: "PUT", body: v }) : api<AgentDTO>("/api/agents", { method: "POST", body: v }),
    onSuccess: (a) => {
      setServerError(null);
      void qc.invalidateQueries({ queryKey: ["agents"] });
      toast(agentId ? t.common.saved : t.agents.created);
      if (!agentId) router.replace(`/agents/${a.id}`);
    },
    onError: (e) => setServerError(e instanceof ApiRequestError ? e.message : t.common.errorGeneric),
  });
  const duplicate = useMutation({
    mutationFn: () => api<AgentDTO>(`/api/agents/${agentId}/duplicate`, { method: "POST" }),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: ["agents"] });
      router.push(`/agents/${a.id}`);
    },
    onError: () => toast.error(t.common.errorGeneric),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/agents/${agentId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agents"] });
      router.replace("/agents");
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : t.common.errorGeneric),
  });

  if (agentsQ.isPending) return <Loading className="px-8" label={t.common.loading} />;
  if (agentsQ.isError) return <div className="p-8"><ErrorState message={t.agents.loadError} onRetry={() => agentsQ.refetch()} retryLabel={t.common.retry} /></div>;
  if (agentId && !existing)
    return (
      <div className="px-8 py-10">
        <EmptyState title={t.agents.notFound} body="" action={<Link href="/agents" className={buttonVariants({ variant: "outline" })}>{t.common.back}</Link>} />
      </div>
    );

  const errs = form.formState.errors;
  const sections = [
    ["general", t.agents.sections.general],
    ["instructions", t.agents.sections.instructions],
    ["model", t.agents.sections.model],
    ["tools", t.agents.sections.tools],
    ...(mode !== "subagent" ? [["delegation", t.agents.sections.delegation], ["handoff", t.agents.sections.handoff]] : []),
    ["limits", t.agents.sections.limits],
  ] as Array<[string, string]>;

  const targetList = (field: "delegationTargets" | "handoffTargets", candidates: AgentDTO[]) => (
    <Controller
      control={form.control}
      name={field}
      render={({ field: c }) => {
        const value = c.value ?? [];
        return candidates.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">{t.agents.noTargets}</p>
        ) : (
          <FieldSet className="gap-3">
            <FieldLegend variant="label" className="text-[13px]">
              {field === "delegationTargets" ? t.agents.delegationTargets : t.agents.handoffTargets}
            </FieldLegend>
            {candidates.map((a) => (
              <CheckboxField
                key={a.id}
                disabled={readOnly}
                checked={value.includes(a.id)}
                onCheckedChange={(on) => c.onChange(on ? [...value, a.id] : value.filter((x) => x !== a.id))}
                label={
                  <span className="inline-flex items-center gap-2">
                    <Seal name={a.name} color={a.avatar} size="sm" />
                    <span dir="auto">{a.name}</span>
                    <span className="text-[13px] text-muted-foreground">{t.agents.modes[a.mode]}</span>
                  </span>
                }
              />
            ))}
          </FieldSet>
        );
      }}
    />
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Seal name={form.watch("name") || "?"} color={form.watch("avatar") ?? "firoozeh"} size="lg" />
          <h1 className="text-[24px] font-bold" dir="auto">
            {agentId ? existing?.name : t.agents.new}
          </h1>
        </div>
        {agentId && !readOnly && (
          <div className="flex gap-2">
            {can(session.role, "agents.create") && (
              <Button variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
                {t.agents.duplicate}
              </Button>
            )}
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              {t.common.delete}
            </Button>
          </div>
        )}
      </div>
      {readOnly && <p className="mt-3 text-[14px] text-muted-foreground">{t.agents.readOnly}</p>}

      <div className="mt-8 lg:grid lg:grid-cols-[11rem_1fr] lg:gap-10">
        <nav aria-label={t.agents.title} className="hidden lg:block">
          <ul className="sticky top-6 space-y-1 text-[14px]">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="max-w-2xl space-y-8" noValidate>
          <FieldSet disabled={readOnly} className="gap-8">
            <Section id="general" title={t.agents.sections.general}>
              <FormField label={t.agents.name} error={errs.name && t.agents.name}>
                {(a) => <Input {...a} dir="auto" maxLength={60} placeholder={t.agents.name} {...form.register("name")} />}
              </FormField>
              <FormField label={t.agents.description} optional={t.common.optional}>
                {(a) => <Input {...a} dir="auto" maxLength={300} {...form.register("description")} />}
              </FormField>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label={t.agents.role} optional={t.common.optional}>
                  {(a) => <Input {...a} dir="auto" maxLength={80} placeholder={t.agents.rolePlaceholder} {...form.register("role")} />}
                </FormField>
                <FormField label={t.agents.tone}>
                  {(a) => (
                    <NativeSelect {...a} {...form.register("tone")}>
                      {TONES.map((x) => (
                        <NativeSelectOption key={x} value={x}>
                          {t.agents.tones[x]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              </div>
              <FormField label={t.agents.personality} optional={t.common.optional}>
                {(a) => <Textarea {...a} dir="auto" rows={2} maxLength={500} {...form.register("personality")} />}
              </FormField>
              <FieldSet>
                <FieldLegend variant="label" className="text-[13px]">
                  {t.agents.seal}
                </FieldLegend>
                <Controller
                  control={form.control}
                  name="avatar"
                  render={({ field }) => (
                    <RadioGroup value={field.value} onValueChange={field.onChange} disabled={readOnly} className="flex flex-wrap gap-2">
                      {SEAL_COLORS.map((c) => (
                        <FieldLabel
                          key={c}
                          htmlFor={`seal-${c}`}
                          className="w-auto! cursor-pointer rounded-md border px-2.5 py-1.5 has-data-[state=checked]:border-foreground has-data-[state=checked]:font-semibold"
                        >
                          <RadioGroupItem id={`seal-${c}`} value={c} className="sr-only" />
                          <Seal name={form.watch("name") || "?"} color={c} size="sm" />
                          <span className="text-[13px]">{t.agents.sealColors[c]}</span>
                        </FieldLabel>
                      ))}
                    </RadioGroup>
                  )}
                />
              </FieldSet>
              <FieldSet>
                <FieldLegend variant="label" className="text-[13px]">
                  {t.agents.mode}
                </FieldLegend>
                <Controller
                  control={form.control}
                  name="mode"
                  render={({ field }) => (
                    <RadioGroup value={field.value} onValueChange={field.onChange} disabled={readOnly} className="gap-2">
                      {(["primary", "subagent", "all"] as const).map((m) => (
                        <FieldLabel key={m} htmlFor={`mode-${m}`} className="has-data-[state=checked]:border-foreground has-data-[state=checked]:bg-transparent">
                          <Field orientation="horizontal" className="items-start">
                            <RadioGroupItem id={`mode-${m}`} value={m} className="mt-1" />
                            <FieldContent>
                              <FieldTitle className="text-[15px]">{t.agents.modes[m]}</FieldTitle>
                              <FieldDescription className="text-[13px] leading-6">{t.agents.modeHelp[m]}</FieldDescription>
                            </FieldContent>
                          </Field>
                        </FieldLabel>
                      ))}
                    </RadioGroup>
                  )}
                />
              </FieldSet>
              <Controller
                control={form.control}
                name="isActive"
                render={({ field }) => <CheckboxField label={t.agents.isActive} checked={!!field.value} onCheckedChange={field.onChange} disabled={readOnly} />}
              />
            </Section>

            <Section id="instructions" title={t.agents.sections.instructions}>
              <FormField label={t.agents.instructions} hint={t.agents.instructionsHelp}>
                {(a) => <Textarea {...a} dir="auto" rows={10} maxLength={8000} className="font-[inherit]" {...form.register("instructions")} />}
              </FormField>
            </Section>

            <Section id="model" title={t.agents.sections.model}>
              {providersQ.data && providersQ.data.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">
                  {t.agents.noProviders}{" "}
                  {can(session.role, "providers.manage") && (
                    <Link href="/providers" className="text-foreground underline underline-offset-4">
                      {t.chat.addProvider}
                    </Link>
                  )}
                </p>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField label={t.agents.provider}>
                    {(a) => (
                      <Controller
                        control={form.control}
                        name="providerConnectionId"
                        render={({ field }) => (
                          <NativeSelect
                            {...a}
                            value={field.value ?? ""}
                            onChange={(e) => {
                              field.onChange(e.target.value || null);
                              form.setValue("model", null);
                            }}
                          >
                            <NativeSelectOption value="">{t.common.none}</NativeSelectOption>
                            {providersQ.data?.map((p) => (
                              <NativeSelectOption key={p.id} value={p.id}>
                                {p.label}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        )}
                      />
                    )}
                  </FormField>
                  <FormField label={t.agents.model}>
                    {(a) => (
                      <Controller
                        control={form.control}
                        name="model"
                        render={({ field }) => (
                          <NativeSelect {...a} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} disabled={!provider} dir="ltr">
                            <NativeSelectOption value="">{`${t.agents.modelDefault}${provider?.defaultModel ? ` (${provider.defaultModel})` : ""}`}</NativeSelectOption>
                            {provider?.models.map((m) => (
                              <NativeSelectOption key={m.id} value={m.id}>
                                {m.label ?? m.id}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        )}
                      />
                    )}
                  </FormField>
                </div>
              )}
            </Section>

            <Section id="tools" title={t.agents.sections.tools}>
              <Controller
                control={form.control}
                name="allowedTools"
                render={({ field }) => {
                  const value = field.value ?? [];
                  return (
                    <FieldSet className="gap-3">
                      <FieldLegend variant="label" className="text-[13px]">
                        {t.agents.tools}
                      </FieldLegend>
                      {(toolsQ.data ?? [])
                        .filter((x) => x.kind === "builtin")
                        .map((tool) => (
                          <CheckboxField
                            key={tool.name}
                            disabled={readOnly}
                            checked={value.includes(tool.name)}
                            onCheckedChange={(on) => field.onChange(on ? [...value, tool.name] : value.filter((x) => x !== tool.name))}
                            label={tool.label[locale]}
                            hint={tool.description}
                          />
                        ))}
                    </FieldSet>
                  );
                }}
              />
              <Controller
                control={form.control}
                name="requireApproval"
                render={({ field }) => <CheckboxField label={t.agents.requireApproval} checked={!!field.value} onCheckedChange={field.onChange} disabled={readOnly} />}
              />
            </Section>

            {mode !== "subagent" ? (
              <>
                <Section id="delegation" title={t.agents.sections.delegation}>
                  {targetList("delegationTargets", delegationCandidates)}
                </Section>
                <Section id="handoff" title={t.agents.sections.handoff}>
                  {targetList("handoffTargets", handoffCandidates)}
                </Section>
              </>
            ) : (
              <p className="text-[14px] text-muted-foreground">{t.agents.subagentNoTargets}</p>
            )}

            <Section id="limits" title={t.agents.sections.limits}>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label={t.agents.maxIterations} error={errs.maxIterations && "1–20"}>
                  {(a) => <Input {...a} type="number" min={1} max={20} dir="ltr" {...form.register("maxIterations", { valueAsNumber: true })} />}
                </FormField>
                <FormField label={t.agents.maxToolCalls} error={errs.maxToolCalls && "0–40"}>
                  {(a) => <Input {...a} type="number" min={0} max={40} dir="ltr" {...form.register("maxToolCalls", { valueAsNumber: true })} />}
                </FormField>
                <FormField label={t.agents.maxOutputTokens} error={errs.maxOutputTokens && "64–32000"}>
                  {(a) => <Input {...a} type="number" min={64} max={32000} dir="ltr" {...form.register("maxOutputTokens", { valueAsNumber: true })} />}
                </FormField>
                <FormField label={t.agents.maxEstimatedCost} error={errs.maxEstimatedCost && "0–10"}>
                  {(a) => <Input {...a} type="number" step="0.01" min={0} max={10} dir="ltr" {...form.register("maxEstimatedCost", { valueAsNumber: true })} />}
                </FormField>
                <FormField label={t.agents.timeoutSeconds} error={errs.timeoutMs && "5–600"}>
                  {(a) => (
                    <Controller
                      control={form.control}
                      name="timeoutMs"
                      render={({ field }) => (
                        <Input
                          {...a}
                          type="number"
                          min={5}
                          max={600}
                          dir="ltr"
                          value={Math.round((field.value ?? 120000) / 1000)}
                          onChange={(e) => field.onChange(Number(e.target.value) * 1000)}
                        />
                      )}
                    />
                  )}
                </FormField>
              </div>
            </Section>
          </FieldSet>

          {serverError && (
            <Alert variant="destructive" className="bg-destructive-soft">
              <AlertDescription className="text-[14px]">{serverError}</AlertDescription>
            </Alert>
          )}
          {!readOnly && (
            <div className={cn("sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-background px-4 py-3 sm:mx-0 sm:px-0")}>
              <Button type="submit" variant="default" disabled={save.isPending}>
                {save.isPending ? t.common.saving : agentId ? t.common.save : t.agents.createAction}
              </Button>
              <Link href="/agents" className={buttonVariants({ variant: "ghost" })}>
                {t.common.cancel}
              </Link>
            </div>
          )}
        </form>
      </div>

      <AppDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t.common.delete} description={f(t.agents.deleteConfirm, { name: existing?.name ?? "" })}>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {t.common.delete}
          </Button>
        </div>
      </AppDialog>
    </div>
  );
}
