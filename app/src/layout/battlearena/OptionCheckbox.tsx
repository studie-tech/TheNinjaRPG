"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/libs/shadui";

/**
 * A challenge setting with its hint below the label. Ids are per instance, since the
 * arena's rail and phone sheet and every tavern message can show the same setting.
 */
export function OptionCheckbox({
  checked,
  onChange,
  label,
  hint,
  className,
  hintClassName,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  /** Overrides the row's type size, for panels with their own scale. */
  className?: string;
  hintClassName?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2 text-sm", className)}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label htmlFor={id}>
        {label}
        {hint && (
          <span className={cn("text-muted-foreground block text-xs", hintClassName)}>
            {hint}
          </span>
        )}
      </label>
    </div>
  );
}
