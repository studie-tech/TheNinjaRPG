"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import { ItemCard } from "@/layout/items/ItemCard";
import {
  BACKPACK_SORTS,
  type BackpackFilter,
  type BackpackSort,
  backpackFilterChips,
  filterBackpack,
  sortBackpack,
} from "@/libs/itemsPage";
import { cn } from "@/libs/shadui";
import type { UserWithRelations } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";

interface BackpackListProps {
  items: UserItemWithRelations[];
  userData: Pick<NonNullable<UserWithRelations>, "userId" | "role">;
  selectedId: string | undefined;
  onSelect: (userItemId: string) => void;
  /** Called with the item a drag starts on, and with null when it ends. */
  onDragItem?: (userItem: UserItemWithRelations | null) => void;
  /** Wraps each card, e.g. in a context menu. */
  wrapCard?: (
    userItem: UserItemWithRelations,
    card: React.ReactNode,
  ) => React.ReactNode;
}

/**
 * The carried items of one bag with name search, type chips and a sort order. Sort and chip
 * are remembered per player; hidden items show only to content staff.
 */
export function BackpackList({
  items,
  userData,
  selectedId,
  onSelect,
  onDragItem,
  wrapCard,
}: BackpackListProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useLocalStorage<BackpackSort>(
    `items:sort:${userData.userId}`,
    "rarity",
  );
  const [storedType, setStoredType] = useLocalStorage<BackpackFilter["type"]>(
    `items:filter:${userData.userId}`,
    "ALL",
  );
  const visible = canChangeContent(userData.role)
    ? items
    : items.filter((ui) => !ui.item.hidden);
  const chips = backpackFilterChips(visible);
  // A chip remembered from another bag falls back to everything in this one.
  const type = chips.some((chip) => chip.value === storedType) ? storedType : "ALL";
  const shown = sortBackpack(
    filterBackpack(visible, { query, type }),
    BACKPACK_SORTS.some((option) => option.value === sort) ? sort : "rarity",
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-background px-2 text-muted-foreground">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Search items</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-full min-w-0 flex-1 bg-transparent text-foreground text-sm outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as BackpackSort)}
            className="h-9 rounded-md border bg-background px-1.5 text-foreground text-sm"
          >
            {BACKPACK_SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const isActive = chip.value === type;
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => setStoredType(chip.value)}
              className={cn(
                "h-8 rounded-full border px-2.5 text-xs",
                isActive
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : "bg-background hover:bg-muted",
                chip.value === "NEEDS_REPAIR" &&
                  !isActive &&
                  "border-orange-300 text-orange-800 dark:text-orange-300",
              )}
            >
              {chip.label} <span className="opacity-70">{chip.count}</span>
            </button>
          );
        })}
      </div>
      <ul
        aria-label="Backpack items"
        className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2"
      >
        {shown.map((userItem) => {
          const card = (
            <ItemCard
              userItem={userItem}
              isSelected={userItem.id === selectedId}
              onSelect={onSelect}
              onDragStart={onDragItem}
              onDragEnd={onDragItem ? () => onDragItem(null) : undefined}
            />
          );
          return (
            <li key={userItem.id}>{wrapCard ? wrapCard(userItem, card) : card}</li>
          );
        })}
      </ul>
      {shown.length === 0 && (
        <p className="py-6 text-center text-muted-foreground text-sm">
          {visible.length === 0 ? "Nothing in this bag" : "No items match"}
        </p>
      )}
    </div>
  );
}
