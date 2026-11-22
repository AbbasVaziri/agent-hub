"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n-provider";

/** shadcn Dialog with a title, optional description and a translated close button. */
export function AppDialog({
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} closeLabel={t.common.close} className={cn("max-h-[90dvh] overflow-y-auto bg-card sm:max-w-xl", className)}>
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="text-[17px]">{title}</DialogTitle>
          <DialogDescription className={cn("text-[14px] leading-6", !description && "sr-only")}>{description ?? title}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
