"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { type ComponentProps, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Select one catalog ID with searchable labels, closing the popover on selection.
 * Values remain stable IDs; an empty value can represent the caller's reset option.
 * Trigger attributes let FormControl connect field errors and focus to the button.
 * `searchLabel` names the search box, by default after `label`, and `emptyText` replaces
 * the no-results message.
 */
export function SearchSelect({
  label,
  value,
  options,
  placeholder,
  disabled,
  searchLabel = `Search ${label.toLowerCase()}`,
  emptyText = "No matches found.",
  onChange,
  ...triggerProps
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
  searchLabel?: string;
  emptyText?: string;
  onChange: (value: string) => void;
} & Pick<
  ComponentProps<typeof Button>,
  "id" | "aria-invalid" | "aria-describedby" | "ref"
>) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // Saving or losing edit access must not leave a picker open when editing resumes.
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <Popover open={disabled ? false : open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          {...triggerProps}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open && !disabled}
          disabled={disabled}
          className="w-full min-w-0 justify-between"
        >
          <span className="truncate">
            {options.find((option) => option.value === value)?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        {/* Reserve the popover's borders so search stays visible as results scroll. */}
        <Command
          label={searchLabel}
          className="max-h-[calc(var(--radix-popover-content-available-height)-2px)]"
        >
          <CommandInput placeholder={`${searchLabel}...`} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value || "all"}
                  keywords={[option.label]}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                  {value === option.value && <Check className="ml-auto size-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
