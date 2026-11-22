"use client";

import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n-provider";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { t, dir } = useI18n();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <D.Content
          dir={dir}
          className={cn(
            // Dialogs float above the page, so they carry the one real shadow in the system.
            "fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[0_12px_40px_rgb(0_0_0/0.18)] sm:inset-auto sm:left-1/2 sm:top-[12vh] sm:w-[min(560px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:rounded-[var(--radius-panel)]",
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-[17px] font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-[14px] leading-6 text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="-m-2 inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-surface-2 hover:text-ink" aria-label={t.common.close}>
              <X className="h-5 w-5" aria-hidden="true" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
