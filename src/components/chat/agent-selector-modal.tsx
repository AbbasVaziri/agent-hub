"use client";

import { useMemo, useState } from "react";
import type { AgentDTO } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { useI18n } from "../i18n-provider";
import { AppDialog } from "../app/app-dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Seal } from "../app/seal";

export function AgentSelectorModal({
  open,
  onOpenChange,
  agents,
  currentId,
  onSelect,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agents: AgentDTO[];
  currentId: string | null;
  onSelect: (id: string) => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  // Subagents and switched-off agents cannot lead a conversation, so they are not offered.
  const eligible = useMemo(() => agents.filter((a) => a.isActive && a.mode !== "subagent"), [agents]);
  const roles = useMemo(() => [...new Set(eligible.map((a) => a.role).filter(Boolean))], [eligible]);
  const shown = eligible.filter((a) => {
    const q = query.trim().toLowerCase();
    const matchQ = !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
    return matchQ && (!role || a.role === role);
  });

  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title={t.agentSelector.title}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Label className="sr-only" htmlFor="agent-search">
          {t.agentSelector.search}
        </Label>
        <Input id="agent-search" type="search" placeholder={t.agentSelector.search} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {roles.length > 0 && (
          <>
            <Label className="sr-only" htmlFor="agent-role">
              {t.agents.role}
            </Label>
            <NativeSelect id="agent-role" value={role} onChange={(e) => setRole(e.target.value)} className="sm:w-44">
              <NativeSelectOption value="">{t.agentSelector.allRoles}</NativeSelectOption>
              {roles.map((r) => (
                <NativeSelectOption key={r} value={r}>
                  {r}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </>
        )}
      </div>
      <ul className="mt-4 max-h-[50dvh] space-y-1 overflow-y-auto" role="listbox" aria-label={t.agentSelector.title}>
        {shown.length === 0 && <li className="py-6 text-[15px] text-muted-foreground">{t.agentSelector.empty}</li>}
        {shown.map((a) => {
          const current = a.id === currentId;
          return (
            <li key={a.id}>
              <Item
                asChild
                size="sm"
                className={cn("w-full cursor-pointer text-start hover:bg-muted active:bg-border", current && "bg-brand-soft hover:bg-brand-soft")}
              >
                <button type="button" role="option" aria-selected={current} aria-label={`${a.name} · ${t.agents.modes[a.mode]}`} disabled={busy} onClick={() => onSelect(a.id)}>
                  <ItemMedia>
                    <Seal name={a.name} color={a.avatar} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="flex items-center gap-2">
                      <span className="truncate">{a.name}</span>
                      <span className="text-[12px] font-normal text-muted-foreground">{t.agents.modes[a.mode]}</span>
                      {current && <span className="text-[12px] text-brand">{t.agentSelector.current}</span>}
                    </ItemTitle>
                    {(a.role || a.description) && (
                      <ItemDescription className="text-[13px] leading-6" dir="auto">
                        {[a.role, a.description].filter(Boolean).join(" · ")}
                      </ItemDescription>
                    )}
                  </ItemContent>
                </button>
              </Item>
            </li>
          );
        })}
      </ul>
    </AppDialog>
  );
}
