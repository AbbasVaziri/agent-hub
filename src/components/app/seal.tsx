import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** The agent seal: the identity motif from DESIGN.md, built on shadcn Avatar with a square shape. */
export function Seal({ name, color, size = "md", className }: { name: string; color: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  const dims = { sm: "size-6 text-[12px]", md: "size-8 text-sm", lg: "size-11 text-lg" }[size];
  return (
    <Avatar aria-hidden="true" className={cn("rounded-sm", dims, className)}>
      <AvatarFallback className="rounded-sm font-bold text-primary-foreground" style={{ background: `var(--seal-${color}, var(--seal-slate))` }}>
        {letter}
      </AvatarFallback>
    </Avatar>
  );
}
