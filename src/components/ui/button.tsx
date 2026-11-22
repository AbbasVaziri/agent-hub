import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

// Primary actions are ink on paper; the turquoise accent is reserved for send and the active agent (DESIGN.md).
const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium transition-colors disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary: "bg-ink text-paper hover:bg-ink/85 active:bg-ink/75",
        secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-line",
        ghost: "text-ink hover:bg-surface-2 active:bg-line",
        danger: "border border-danger/40 bg-surface text-danger hover:bg-danger-soft active:bg-danger-soft/70",
        accent: "bg-accent text-accent-ink hover:bg-accent/85 active:bg-accent/75",
      },
      size: {
        md: "h-11 px-4 sm:h-10",
        sm: "h-11 px-3 sm:h-8 text-[13px]",
        icon: "h-11 w-11 sm:h-9 sm:w-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn(button({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

export { button as buttonClass };
