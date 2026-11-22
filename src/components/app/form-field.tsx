"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type ControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean };

/** shadcn Field with a visible label, hint and error wired to the control by id. */
export function FormField({
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: string;
  children: (props: ControlProps) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <Field data-invalid={error ? true : undefined} className={cn("gap-1.5", className)}>
      <FieldLabel htmlFor={id} className="text-[13px]">
        {label}
        {optional && <span className="font-normal text-muted-foreground">({optional})</span>}
      </FieldLabel>
      {children({ id, "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <FieldDescription id={hintId} className="text-[13px] leading-6">
          {hint}
        </FieldDescription>
      )}
      {error && (
        <FieldError id={errId} className="text-[13px]">
          {error}
        </FieldError>
      )}
    </Field>
  );
}

/** shadcn Checkbox with its label and optional hint, laid out as a horizontal Field. */
export function CheckboxField({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  label: React.ReactNode;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal" className={cn("items-start gap-3", className)} data-disabled={disabled || undefined}>
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} disabled={disabled} className="mt-1 size-5" />
      <FieldContent>
        <FieldLabel htmlFor={id} className="text-[15px] font-normal leading-7">
          {label}
        </FieldLabel>
        {hint && <FieldDescription className="text-[13px] leading-6">{hint}</FieldDescription>}
      </FieldContent>
    </Field>
  );
}
