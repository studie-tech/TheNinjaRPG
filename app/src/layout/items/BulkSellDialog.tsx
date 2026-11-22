"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UserItemWithRelations } from "@/drizzle/schema";
import ContentImage from "@/layout/ContentImage";
import { rarityLabel, rarityTextClass } from "@/layout/items/ItemCard";
import { applyActiveVariant, calcItemSellingPrice, isDropOnlyItem } from "@/libs/item";
import { bulkSellTotals, warnedItems } from "@/libs/itemsPage";
import { surplusCopiesLabel } from "@/libs/kessen/cardSale";
import { cn } from "@/libs/shadui";
import type { UserWithRelations } from "@/routers/profile";

/**
 * The two confirmations of a bulk sell. The review lists every selected stack with its art,
 * name, quantity and what it gives; ticks there edit the selection. When a Rare or better
 * stack is still ticked, a second step shows only those, larger, before the final Confirm.
 */
export function BulkSellDialog({
  items,
  selectedIds,
  userData,
  isSelling,
  onToggle,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: BulkSellDialogProps) {
  const [rareIds, setRareIds] = useState<string[] | null>(null);
  const structures = userData.village?.structures;
  const ticked = items.filter((ui) => selectedIds.includes(ui.id));
  const warned = warnedItems(ticked);
  const totals = bulkSellTotals(ticked, userData, structures);
  const rows = groupCardStacks(
    rareIds ? items.filter((ui) => rareIds.includes(ui.id)) : items,
  );
  const isRareStep = rareIds !== null;
  const confirm = () => onConfirm(ticked.map((ui) => ui.id));
  // Cards and shop goods always sell; only selections with drop-only goods say "drop".
  const verb = items.some((ui) => isDropOnlyItem(ui.item)) ? "Sell or drop" : "Sell";
  const hasCards = items.some((ui) => ui.item.itemType === "CARD");
  const noun = items.every((ui) => ui.item.itemType === "CARD") ? "card stack" : "item";

  return (
    <Dialog open onOpenChange={(open) => !open && !isSelling && onClose()}>
      <DialogContent
        aria-busy={isSelling}
        closeDisabled={isSelling}
        onCloseAutoFocus={onCloseAutoFocus}
        className="flex max-h-[85dvh] flex-col gap-3 sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {isRareStep
              ? "These are Rare or better"
              : `${verb} ${ticked.length} ${noun}${ticked.length === 1 ? "" : "s"}`}
          </DialogTitle>
          <DialogDescription className={cn(isRareStep && "text-destructive")}>
            {isRareStep ? (
              <>
                <TriangleAlert className="mr-1 inline h-4 w-4" aria-hidden />
                They can't be bought back. Untick any you want to keep.
              </>
            ) : hasCards ? (
              "Only surplus copies are sold; your deck copies stay. Untick anything you want to keep."
            ) : (
              "Untick anything you want to keep."
            )}
          </DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1">
          {rows.map((stacks) => {
            const [first] = stacks;
            if (!first) return null;
            const tickedStacks = stacks.filter((ui) => selectedIds.includes(ui.id));
            const isTicked = tickedStacks.length === stacks.length;
            return (
              <BulkSellRow
                key={first.id}
                userItem={{
                  ...first,
                  quantity: stacks.reduce((sum, ui) => sum + ui.quantity, 0),
                }}
                price={stacks.reduce(
                  (sum, ui) => sum + calcItemSellingPrice(userData, ui, structures),
                  0,
                )}
                isTicked={isTicked}
                isLarge={isRareStep}
                disabled={isSelling}
                onToggle={() => {
                  if (isSelling) return;
                  // A card's stacks tick together: all off when all are ticked, else all on.
                  for (const ui of stacks) {
                    if (isTicked || !selectedIds.includes(ui.id)) onToggle(ui.id);
                  }
                }}
              />
            );
          })}
        </ul>
        <p className="font-semibold text-sm" aria-live="polite">
          {bulkSellSummary(totals)}
        </p>
        <DialogFooter className="gap-2 pointer-coarse:[&>button]:h-[40px] pointer-coarse:[&>button]:px-4 pointer-coarse:[&>button]:text-base">
          <Button
            variant="outline"
            disabled={isSelling}
            onClick={() => (isRareStep ? setRareIds(null) : onClose())}
          >
            Back
          </Button>
          {!isRareStep && warned.length > 0 ? (
            <Button
              disabled={ticked.length === 0 || isSelling}
              onClick={() => setRareIds(warned.map((ui) => ui.id))}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={ticked.length === 0 || isSelling}
              loading={isSelling}
              onClick={confirm}
            >
              {isRareStep ? "Confirm" : verb === "Sell" ? "Sell" : "Sell / drop"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One stack in a confirmation, with a tick that keeps it in the selection. */
function BulkSellRow({
  userItem,
  price,
  isTicked,
  isLarge,
  disabled,
  onToggle,
}: {
  userItem: UserItemWithRelations;
  price: number;
  isTicked: boolean;
  isLarge: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const look = applyActiveVariant(userItem);
  const id = `bulk-sell-${userItem.id}`;
  return (
    // The whole row toggles the tick: the box sits in its own label so it gets a
    // finger-sized target, and the art, name and price label the same box.
    <li
      aria-label={look.name}
      className={cn(
        "flex items-stretch rounded-lg border bg-card",
        !isTicked && "opacity-60",
      )}
    >
      <label
        htmlFor={id}
        className="flex shrink-0 cursor-pointer items-center pl-1.5 pr-1 pointer-coarse:min-w-[44px] pointer-coarse:justify-center pointer-coarse:px-0"
      >
        <Checkbox
          id={id}
          checked={isTicked}
          disabled={disabled}
          onCheckedChange={onToggle}
          aria-label={`Keep selling ${look.name}`}
          className="h-5 w-5 pointer-coarse:h-6 pointer-coarse:w-6"
        />
      </label>
      <label
        htmlFor={id}
        className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-1.5"
      >
        <span className={cn("relative shrink-0", isLarge ? "h-16 w-16" : "h-10 w-10")}>
          <ContentImage
            image={look.image}
            alt={look.name}
            rarity={userItem.item.rarity}
            className={isLarge ? "h-16 w-16" : "h-10 w-10"}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-sm">{look.name}</span>
          <span
            className={cn(
              "block text-xs font-medium",
              rarityTextClass[userItem.item.rarity],
            )}
          >
            {rarityLabel[userItem.item.rarity]}
            {userItem.item.itemType === "CARD"
              ? ` · ${surplusCopiesLabel(userItem.quantity)}`
              : userItem.quantity > 1 && ` · ×${userItem.quantity}`}
          </span>
        </span>
        <span className="shrink-0 font-semibold text-xs">
          {price > 0 ? `+${price.toLocaleString()} ryo` : "Drop"}
        </span>
      </label>
    </li>
  );
}

/**
 * Review rows: each card's surplus stacks (a split-off surplus beside the surplus left on
 * a deck stack) share one row, so a card is listed once; other items keep a row per stack.
 */
const groupCardStacks = (items: UserItemWithRelations[]) => {
  const rows: UserItemWithRelations[][] = [];
  const cardRows = new Map<string, UserItemWithRelations[]>();
  for (const ui of items) {
    if (ui.item.itemType !== "CARD") {
      rows.push([ui]);
      continue;
    }
    const row = cardRows.get(ui.itemId);
    if (row) {
      row.push(ui);
    } else {
      const next = [ui];
      cardRows.set(ui.itemId, next);
      rows.push(next);
    }
  }
  return rows;
};

/** "Sell for 3,400 ryo · Drop 3", leaving out the parts that do not apply. */
export const bulkSellSummary = (totals: ReturnType<typeof bulkSellTotals>) =>
  [
    totals.sellCount > 0 && `Sell for ${totals.ryo.toLocaleString()} ryo`,
    totals.dropCount > 0 && `Drop ${totals.dropCount}`,
  ]
    .filter(Boolean)
    .join(" · ") || "Nothing selected";

interface BulkSellDialogProps {
  /** Every stack the review opened with, ticked or not; card stacks hold only their surplus. */
  items: UserItemWithRelations[];
  selectedIds: string[];
  userData: NonNullable<UserWithRelations>;
  isSelling: boolean;
  onToggle: (userItemId: string) => void;
  onConfirm: (userItemIds: string[]) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}
