import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/libs/shadui";

export type OptionType = {
  label: string;
  value: string;
};

interface MultiSelectProps {
  options: OptionType[];
  selected: string[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
  className?: string;
  isDirty?: boolean;
  allowAddNew?: boolean;
  onAddNewOption?: (newOption: OptionType) => void;
  placeholder?: string;
}

function MultiSelect({
  options,
  selected,
  onChange,
  className,
  isDirty,
  allowAddNew,
  onAddNewOption,
  placeholder,
  ...props
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [newItemInput, setNewItemInput] = React.useState("");

  const handleUnselect = (item: string) => {
    onChange(selected.filter((i) => i !== item));
  };

  const addNewItem = () => {
    if (
      newItemInput.trim() &&
      !options.find((opt) => opt.value === newItemInput.trim())
    ) {
      const newOption = { label: newItemInput.trim(), value: newItemInput.trim() };
      onAddNewOption?.(newOption);
      onChange([...selected, newItemInput.trim()]);
      setNewItemInput("");
    }
  };

  const sortedSelected = selected.sort((a, b) => {
    const aOption = options.find((o) => o.value === a);
    const bOption = options.find((o) => o.value === b);
    return aOption?.label.localeCompare(bOption?.label ?? "") ?? 0;
  });

  return (
    <Popover open={open} onOpenChange={setOpen} {...props}>
      <PopoverTrigger asChild>
        <div
          role="combobox"
          aria-expanded={open}
          tabIndex={0}
          className={cn(
            "flex h-max w-full cursor-pointer items-center justify-between rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            isDirty ? "border-orange-300" : "border-input",
          )}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(!open);
            }
          }}
        >
          <div className="flex flex-wrap gap-1">
            {sortedSelected.length > 0 ? (
              sortedSelected.map((item, i) => {
                const option = options.find((o) => o.value === item);
                return (
                  <Badge
                    variant="secondary"
                    key={`${item}-${i}`}
                    className="mr-1 mb-1"
                    onClick={() => handleUnselect(item)}
                  >
                    {option?.label ?? item}
                    <button
                      type="button"
                      className="ml-1 rounded-full outline-hidden ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={() => handleUnselect(item)}
                      aria-label={`Remove ${option?.label ?? item}`}
                    >
                      <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                  </Badge>
                );
              })
            ) : (
              <span className="text-muted-foreground">
                {placeholder || "Select options..."}
              </span>
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command className={className}>
          <CommandInput placeholder="Search ..." />
          <CommandEmpty>No items found.</CommandEmpty>
          <CommandGroup className="max-h-64 overflow-auto">
            {options.map((option, i) => (
              <CommandItem
                key={`${option.value}-${i}`}
                value={option.label}
                keywords={[option.label]}
                onSelect={() => {
                  onChange(
                    selected.includes(option.value)
                      ? selected.filter((item) => item !== option.value)
                      : [...selected, option.value],
                  );
                  setOpen(true);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    selected.includes(option.value) ? "opacity-100" : "opacity-0",
                  )}
                />
                {option.label}
              </CommandItem>
            ))}
          </CommandGroup>
          {allowAddNew && (
            <div className="border-t p-2">
              <div className="flex items-center space-x-2">
                <Input
                  placeholder="Add new option..."
                  value={newItemInput}
                  onChange={(e) => setNewItemInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addNewItem();
                    }
                  }}
                  className="h-8"
                />
                <Button
                  size="sm"
                  onClick={addNewItem}
                  disabled={!newItemInput.trim()}
                  className="h-8 w-8 p-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { MultiSelect };
