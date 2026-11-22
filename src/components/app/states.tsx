import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function EmptyState({ title, body, action, className }: { title: string; body: string; action?: React.ReactNode; className?: string }) {
  return (
    // Left-aligned (start-aligned) rather than centred: empty states read as the first line of the page.
    <Empty className={cn("items-start p-0 py-10 text-start md:p-0 md:py-10", className)}>
      <EmptyHeader className="items-start text-start">
        <EmptyTitle className="text-[17px]">{title}</EmptyTitle>
        {body && <EmptyDescription className="text-[15px] leading-7">{body}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent className="items-start">{action}</EmptyContent>}
    </Empty>
  );
}

export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <Alert variant="destructive" className="bg-destructive-soft">
      <AlertCircle aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center gap-3 text-[15px]">
        <span>{message}</span>
        {onRetry && (
          <Button variant="link" className="h-auto sm:h-auto p-0 text-destructive" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function Loading({ label, className }: { label: string; className?: string }) {
  return (
    <p role="status" className={cn("flex items-center gap-2 py-6 text-[15px] text-muted-foreground", className)}>
      <Spinner aria-hidden="true" />
      {label}
    </p>
  );
}

export function SkeletonRows({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}
