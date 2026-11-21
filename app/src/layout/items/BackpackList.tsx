"use client";

import { Search } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { ItemRarity } from "@/drizzle/constants";
import { ItemRarities } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import { ItemCard, rarityLabel } from "@/layout/items/ItemCard";
import type { BackpackFilter, BackpackSort } from "@/libs/itemsPage";
import {
  BACKPACK_SORTS,
  backpackFilterChips,
  filterBackpack,
  sortBackpack,
} from "@/libs/itemsPage";
import { isKessenGood } from "@/libs/kessen/cardSale";
import { cn } from "@/libs/shadui";
import type { UserWithRelations } from "@/routers/profile";
import { canChangeContent, getContentRole } from "@/utils/permissions";

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
  tagFor,
  selection,
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
  const visible = canChangeContent(getContentRole(userData))
    ? items
    : items.filter((ui) => !ui.item.hidden);
  const chips = backpackFilterChips(visible);
  // A bag of a single item type, such as the card collection, needs no type chips.
  const showChips = chips.length > 2;
  // A chip remembered from another bag falls back to everything in this one.
  const type = chips.some((chip) => chip.value === storedType) ? storedType : "ALL";
  // Card names and type lines need wider tiles than gear.
  const isCardBag = visible.length > 0 && visible.every((ui) => isKessenGood(ui.item));
  const shown = sortBackpack(
    filterBackpack(visible, { query, type }),
    BACKPACK_SORTS.some((option) => option.value === sort) ? sort : "rarity",
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-background px-2 text-muted-foreground pointer-coarse:h-[40px]">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Search items</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-full min-w-0 flex-1 bg-transparent text-foreground text-sm outline-none pointer-coarse:text-[16px]"
          />
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as BackpackSort)}
            className="h-9 rounded-md border bg-background px-1.5 text-foreground text-sm pointer-coarse:h-[40px] pointer-coarse:text-[16px]"
          >
            {BACKPACK_SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {showChips && (
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
                  "h-8 rounded-full border px-2.5 text-xs pointer-coarse:h-[40px] pointer-coarse:px-3 pointer-coarse:text-[11px]",
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
      )}
      {selection && (
        <fieldset
          aria-label="Quick select"
          className="flex flex-wrap gap-1.5 pointer-coarse:gap-2"
        >
          {ItemRarities.filter((rarity) =>
            shown.some((userItem) => userItem.item.rarity === rarity),
          ).map((rarity) => (
            <button
              key={rarity}
              type="button"
              onClick={() => selection.onPickRarity(rarity, shown)}
              className="h-8 rounded-full border border-dashed bg-background px-2.5 text-[11px] hover:bg-muted pointer-coarse:h-[40px] pointer-coarse:px-3.5"
            >
              All {rarityLabel[rarity]}
            </button>
          ))}
        </fieldset>
      )}
      <ul
        aria-label="Backpack items"
        className={cn(
          "grid gap-2",
          isCardBag
            ? "grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]"
            : "grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]",
        )}
      >
        {shown.map((userItem) => {
          if (selection) {
            return (
              <li key={userItem.id}>
                <ItemCard
                  userItem={userItem}
                  isSelected={false}
                  onSelect={selection.onToggle}
                  isTicked={selection.ids.includes(userItem.id)}
                  blockReason={selection.blockReason(userItem)}
                  tag={tagFor?.(userItem)}
                />
              </li>
            );
          }
          const card = (
            <ItemCard
              userItem={userItem}
              isSelected={userItem.id === selectedId}
              onSelect={onSelect}
              onDragStart={onDragItem}
              onDragEnd={onDragItem ? () => onDragItem(null) : undefined}
              tag={tagFor?.(userItem)}
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

interface BackpackListProps {
  items: UserItemWithRelations[];
  userData: Pick<NonNullable<UserWithRelations>, "userId" | "role" | "playsAsPlayer">;
  selectedId: string | undefined;
  onSelect: (userItemId: string) => void;
  /** Called with the item a drag starts on, and with null when it ends. */
  onDragItem?: (userItem: UserItemWithRelations | null) => void;
  /** Wraps each card, e.g. in a context menu. */
  wrapCard?: (
    userItem: UserItemWithRelations,
    card: React.ReactNode,
  ) => React.ReactNode;
  /** A short note on a tile, such as the surplus a card stack holds. */
  tagFor?: (userItem: UserItemWithRelations) => string | undefined;
  /** Select mode: cards tick instead of opening, without menus or dragging. */
  selection?: {
    ids: string[];
    onToggle: (userItemId: string) => void;
    /** Ticks or unticks every sellable item of a rarity among the items shown. */
    onPickRarity: (rarity: ItemRarity, shown: UserItemWithRelations[]) => void;
    blockReason: (userItem: UserItemWithRelations) => string | null;
  };
}
