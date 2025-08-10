import * as React from "react";
import { cn } from "src/libs/shadui";

import { Check, X, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

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

  return (
    <Popover open={open} onOpenChange={setOpen} {...props}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between h-max",
            isDirty ? "border-orange-300" : "border-input",
          )}
          onClick={() => setOpen(!open)}
        >
          <div className="flex gap-1 flex-wrap">
            {selected.length > 0 ? (
              selected.map((item, i) => {
                const option = options.find((o) => o.value === item);
                return (
                  <Badge
                    variant="secondary"
                    key={`${item}-${i}`}
                    className="mr-1 mb-1"
                    onClick={() => handleUnselect(item)}
                  >
                    {option?.label ?? item}
                    <div
                      className="ml-1 ring-offset-background rounded-full outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleUnselect(item);
                        }
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={() => handleUnselect(item)}
                    >
                      <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </div>
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
        </Button>
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
            <div className="p-2 border-t">
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
