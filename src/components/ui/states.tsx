import { cn } from "@/lib/utils";

export function EmptyState({ title, body, action, className }: { title: string; body: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("max-w-md py-10", className)}>
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="mt-2 text-[15px] leading-7 text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-danger/30 bg-danger-soft px-4 py-3 text-[15px] text-danger">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="min-h-11 font-medium underline underline-offset-4 sm:min-h-0">
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function Loading({ label, className }: { label: string; className?: string }) {
  return (
    <p role="status" className={cn("py-6 text-[15px] text-muted", className)}>
      {label}
    </p>
  );
}

export function SkeletonRows({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 rounded-[var(--radius-control)] bg-surface-2" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}
