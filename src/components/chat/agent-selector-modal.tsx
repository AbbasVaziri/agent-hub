"use client";

import { useMemo, useState } from "react";
import type { AgentDTO } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n-provider";
import { Dialog } from "../ui/dialog";
import { Input, Select } from "../ui/field";
import { Seal } from "../ui/seal";

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
    <Dialog open={open} onOpenChange={onOpenChange} title={t.agentSelector.title}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="agent-search">
          {t.agentSelector.search}
        </label>
        <Input id="agent-search" type="search" placeholder={t.agentSelector.search} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {roles.length > 0 && (
          <>
            <label className="sr-only" htmlFor="agent-role">
              {t.agents.role}
            </label>
            <Select id="agent-role" value={role} onChange={(e) => setRole(e.target.value)} className="sm:w-44">
              <option value="">{t.agentSelector.allRoles}</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </>
        )}
      </div>
      <ul className="mt-4 max-h-[50dvh] space-y-1 overflow-y-auto" role="listbox" aria-label={t.agentSelector.title}>
        {shown.length === 0 && <li className="py-6 text-[15px] text-muted">{t.agentSelector.empty}</li>}
        {shown.map((a) => {
          const current = a.id === currentId;
          return (
            <li key={a.id}>
              <button
                type="button"
                role="option"
                aria-selected={current}
                aria-label={`${a.name} · ${t.agents.modes[a.mode]}`}
                disabled={busy}
                onClick={() => onSelect(a.id)}
                className={cn("flex w-full items-start gap-3 rounded-[var(--radius-control)] px-3 py-3 text-start hover:bg-surface-2 active:bg-line", current && "bg-accent-soft")}
              >
                <Seal name={a.name} color={a.avatar} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{a.name}</span>
                    <span className="text-[12px] text-muted">{t.agents.modes[a.mode]}</span>
                    {current && <span className="text-[12px] font-medium text-accent">{t.agentSelector.current}</span>}
                  </span>
                  {(a.role || a.description) && (
                    <span className="mt-0.5 block text-[13px] leading-6 text-muted" dir="auto">
                      {[a.role, a.description].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
