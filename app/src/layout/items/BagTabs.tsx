"use client";

import { useEffect, useEffectEvent } from "react";
import { cn } from "@/libs/shadui";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

/** The inventory's bags with their item counts; the chosen bag is remembered. */
export function BagTabs({
  bags,
  active,
  onChange,
  storageKey = BAG_STORAGE_KEY,
}: BagTabsProps) {
  // Restore after mount or an inventory switch, preserving the server's first tab during hydration.
  // With no bag remembered, an empty first bag gives way to a card collection that has cards.
  const restore = useEffectEvent(() => {
    const stored =
      safeLocalStorageGetItem(storageKey) ??
      (bags.find((bag) => bag.value === active)?.count === 0 &&
      bags.find((bag) => bag.value === "cards")?.count
        ? "cards"
        : null);
    if (stored && stored !== active && bags.some((bag) => bag.value === stored)) {
      onChange(stored);
    }
  });
  useEffect(() => {
    restore();
  }, [storageKey]);

  // Empty bags stay out of the strip unless open or over their limit, so it fits one line.
  const shown = bags.filter(
    (bag) => bag.value === "all" || bag.count > 0 || bag.value === active || bag.over,
  );
  // The card collection has its own bag, so "all" names the rest when it is listed.
  const hasCards = shown.some((bag) => bag.value === "cards");

  return (
    <fieldset
      aria-label="Bags"
      // Bags wrap onto a second line rather than scroll, so every bag stays in view.
      className="flex min-w-0 max-w-full flex-wrap gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {shown.map((bag) => {
        const selected = bag.value === active;
        return (
          <button
            key={bag.value}
            type="button"
            aria-pressed={selected}
            data-over={bag.over ? "true" : undefined}
            onClick={() => {
              safeLocalStorageSetItem(storageKey, bag.value);
              onChange(bag.value);
            }}
            className={cn(
              "h-8 shrink-0 rounded-md px-3 text-sm pointer-coarse:h-[40px] pointer-coarse:text-base",
              selected
                ? "bg-background font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              bag.over && "text-destructive hover:text-destructive",
            )}
          >
            {bag.value === "all" && hasCards
              ? "Items"
              : (BAG_LABELS[bag.value] ?? bag.value)}{" "}
            · {bag.count}
            {bag.over && <span className="sr-only"> (over limit)</span>}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * Used and total slots of the open bag. Only purchases, home withdrawals and crafting
 * check the limit, so rewards and drops can push a bag past it. A view spanning several
 * bags names the bag whose figure it shows.
 */
export function BagCapacity({
  used,
  max,
  bag,
}: {
  used: number;
  max: number;
  /** The bag shown, when the open view spans several. */
  bag?: string;
}) {
  const over = used - max;
  const name = bag ? (BAG_LABELS[bag] ?? bag) : undefined;
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
        {name && `${name} `}
        {used} / {max}
      </span>
      <span className="sr-only">
        {name && `${name} bag: `}
        {over > 0
          ? `${used} of ${max} bag slots used, ${over} over the limit`
          : `${used} of ${max} bag slots used`}
      </span>
    </span>
  );
}

/** Storage key for the remembered inventory bag. */
const BAG_STORAGE_KEY = "backpackSelection";

const BAG_LABELS: Record<string, string> = {
  all: "All",
  normal: "Gear",
  event: "Event",
  materials: "Materials",
  cooking: "Cooking",
  cards: "Cards",
};

interface BagTabsProps {
  /** `over` marks a bag holding more than its limit. */
  bags: { value: string; count: number; over?: boolean }[];
  active: string;
  onChange: (bag: string) => void;
  /** Where the chosen bag is remembered; home storage keeps its own. */
  storageKey?: string;
}
