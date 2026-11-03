"use client";

import { useEffect, useEffectEvent } from "react";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import { cn } from "@/libs/shadui";

/** Storage key shared with the bag choice players already have saved. */
const BAG_STORAGE_KEY = "backpackSelection";

const BAG_LABELS: Record<string, string> = {
  normal: "Gear",
  event: "Event",
  materials: "Materials",
  cooking: "Cooking",
};

interface BagTabsProps {
  bags: { value: string; count: number }[];
  active: string;
  onChange: (bag: string) => void;
}

/** The inventory's bags with their item counts; the chosen bag is remembered. */
export function BagTabs({ bags, active, onChange }: BagTabsProps) {
  // Read after mount so server and client render the same first tab.
  const restore = useEffectEvent(() => {
    const stored = safeLocalStorageGetItem(BAG_STORAGE_KEY);
    if (stored && stored !== active && bags.some((bag) => bag.value === stored)) {
      onChange(stored);
    }
  });
  useEffect(() => {
    restore();
  }, []);

  return (
    <div role="tablist" aria-label="Bags" className="flex flex-wrap gap-x-1">
      {bags.map((bag) => {
        const selected = bag.value === active;
        return (
          <button
            key={bag.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              safeLocalStorageSetItem(BAG_STORAGE_KEY, bag.value);
              onChange(bag.value);
            }}
            className={cn(
              "min-h-9 border-b-[3px] px-2 text-sm",
              selected
                ? "border-primary font-bold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {BAG_LABELS[bag.value] ?? bag.value} · {bag.count}
          </button>
        );
      })}
    </div>
  );
}
