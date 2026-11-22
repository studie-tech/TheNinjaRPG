"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * A challenge setting with its hint below the label. Ids are per instance, since the
 * arena's rail and phone sheet and every tavern message can show the same setting.
 */
export function OptionCheckbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 text-sm">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label htmlFor={id}>
        {label}
        {hint && <span className="text-muted-foreground block text-xs">{hint}</span>}
      </label>
    </div>
  );
}
