"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/libs/shadui";

/** A label over its control, with optional help text below so every control starts level. */
export function Field({
  id,
  label,
  help,
  className,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help && (
        <p id={`${id}-help`} className="text-muted-foreground text-[11px]">
          {help}
        </p>
      )}
    </div>
  );
}

export function EnumField<T extends string>({
  id,
  label,
  value,
  values,
  labels,
  help,
  ariaLabel,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  values: readonly T[];
  labels?: Partial<Record<T, string>>;
  help?: string;
  /** Accessible name where the visible label repeats on the page. */
  ariaLabel?: string;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Field id={id} label={label} help={help}>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next as T)}
      >
        <SelectTrigger
          id={id}
          className={TOUCH_FIELD}
          aria-label={ariaLabel}
          aria-describedby={help ? `${id}-help` : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((option) => (
            <SelectItem key={option} value={option}>
              {labels?.[option] ?? option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Touch-sized controls: 40 px tall with 16 px text, so phones do not zoom on focus. */
export const TOUCH_FIELD = "pointer-coarse:h-[40px] pointer-coarse:text-[16px]";
