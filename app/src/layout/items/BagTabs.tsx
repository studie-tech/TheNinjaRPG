"use client";

import { useEffect, useEffectEvent } from "react";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import { cn } from "@/libs/shadui";

/** Storage key shared with the bag choice players already have saved. */
const BAG_STORAGE_KEY = "backpackSelection";

const BAG_LABELS: Record<string, string> = {
  all: "All",
  normal: "Gear",
  event: "Event",
  materials: "Materials",
  cooking: "Cooking",
};

interface BagTabsProps {
  /** `over` marks a bag holding more than its limit. */
  bags: { value: string; count: number; over?: boolean }[];
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
    <fieldset
      aria-label="Bags"
      className="flex min-w-0 max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5"
    >
      {bags.map((bag) => {
        const selected = bag.value === active;
        return (
          <button
            key={bag.value}
            type="button"
            aria-pressed={selected}
            data-over={bag.over ? "true" : undefined}
            onClick={() => {
              safeLocalStorageSetItem(BAG_STORAGE_KEY, bag.value);
              onChange(bag.value);
            }}
            className={cn(
              "h-8 shrink-0 rounded-md px-3 text-sm",
              selected
                ? "bg-background font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              bag.over && "text-destructive hover:text-destructive",
            )}
          >
            {BAG_LABELS[bag.value] ?? bag.value} · {bag.count}
            {bag.over && <span className="sr-only"> (over limit)</span>}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * Used and total slots of the open bag. Only purchases, home withdrawals and crafting
 * check the limit, so rewards and drops can push a bag past it.
 */
export function BagCapacity({ used, max }: { used: number; max: number }) {
  const over = used - max;
  return (
    <span
      title={
        over > 0
          ? "Rewards and drops can go past the limit. Until you are back under it, you cannot buy items or take them out of your home."
          : undefined
      }
      data-over={over > 0 ? "true" : undefined}
      className={cn(
        "font-semibold text-sm tabular-nums",
        over > 0 ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <span aria-hidden="true">
        {used} / {max}
      </span>
      <span className="sr-only">
        {over > 0
          ? `${used} of ${max} bag slots used, ${over} over the limit`
          : `${used} of ${max} bag slots used`}
      </span>
    </span>
  );
}
