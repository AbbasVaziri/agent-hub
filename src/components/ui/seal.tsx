import { cn } from "@/lib/utils";

/** The agent seal: the identity motif from DESIGN.md. Honest placeholder instead of generated avatars. */
export function Seal({ name, color, size = "md", className }: { name: string; color: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  const dims = { sm: "h-6 w-6 text-[12px]", md: "h-8 w-8 text-sm", lg: "h-11 w-11 text-lg" }[size];
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-[var(--radius-seal)] font-bold text-paper", dims, className)}
      style={{ background: `var(--seal-${color}, var(--seal-slate))` }}
    >
      {letter}
    </span>
  );
}
