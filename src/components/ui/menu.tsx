"use client";

import { DropdownMenu as M } from "radix-ui";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n-provider";

export function Menu({ trigger, children, align = "end" }: { trigger: React.ReactNode; children: React.ReactNode; align?: "start" | "end" }) {
  const { dir } = useI18n();
  return (
    <M.Root dir={dir}>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          align={align}
          sideOffset={4}
          className="z-50 min-w-48 rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[0_8px_24px_rgb(0_0_0/0.14)]"
        >
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({ onSelect, children, danger }: { onSelect: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <M.Item
      onSelect={onSelect}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 text-[14px] outline-none data-[highlighted]:bg-surface-2 sm:min-h-9",
        danger && "text-danger",
      )}
    >
      {children}
    </M.Item>
  );
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <M.Label className="px-3 py-1.5 text-[12px] text-muted">{children}</M.Label>;
