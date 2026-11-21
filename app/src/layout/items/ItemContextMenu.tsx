"use client";

import type React from "react";
import { useRef } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ItemSlot } from "@/drizzle/constants";
import { NonActionItemTypes } from "@/drizzle/constants";
import type { UserItemWithRelations, UserItemWithVariants } from "@/drizzle/schema";
import Link from "@/layout/Link";
import { hasFinePointer } from "@/libs/combat/hotkeys";
import {
  applyActiveVariant,
  isDropOnlyItem,
  isUnsellableCard,
  nonCombatConsume,
} from "@/libs/item";
import { fittingSlots, slotName } from "@/libs/itemsPage";
import {
  auctionListingHref,
  canListAtAuction,
  cardSale,
  hasOtherStack,
  isEarnedKessenPack,
  isKessenGood,
  surplusCopiesLabel,
} from "@/libs/kessen/cardSale";
import { isKessenPackId } from "@/libs/kessen/packs";
import { needsInventoryRepair } from "@/libs/repair";
import type { UserWithRelations } from "@/routers/profile";

/**
 * Right-click (and long-press on touch screens) actions for an item. Quick actions run
 * directly; actions with their own dialog or confirmation open the inspector.
 */
export function ItemContextMenu({
  userItem,
  allUserItems,
  userData,
  getBlockedReason,
  onInspect,
  onEquip,
  onUnequip,
  onMerge,
  onSetHotkey,
  children,
}: ItemContextMenuProps) {
  const openedAt = useRef(0);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const pendingAction = useRef<
    | { kind: "inspect"; userItemId: string }
    | { kind: "hotkey"; userItem: UserItemWithRelations }
    | null
  >(null);
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) openedAt.current = Date.now();
      }}
    >
      <ContextMenuTrigger
        ref={triggerRef}
        className="contents"
        onClickCapture={(event) => {
          if (Date.now() - openedAt.current < LONG_PRESS_CLICK_MS) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        // Touch screens get finger-sized entries.
        className="pointer-coarse:[&_[role=menuitem]]:min-h-[40px] pointer-coarse:[&_[role=menuitem]]:text-base"
        onCloseAutoFocus={(event) => {
          const action = pendingAction.current;
          if (!action) return;
          // Open after the menu releases its focus trap so the destination can take focus.
          event.preventDefault();
          pendingAction.current = null;
          const trigger = triggerRef.current?.querySelector("button") ?? null;
          if (action.kind === "inspect") {
            onInspect(action.userItemId, trigger);
          } else {
            // The capture dialog remembers the mounted equipment button as its opener.
            trigger?.focus();
            onSetHotkey?.(action.userItem);
          }
        }}
      >
        <ItemMenuEntries
          userItem={userItem}
          allUserItems={allUserItems}
          userData={userData}
          getBlockedReason={getBlockedReason}
          onInspect={(userItemId) => {
            pendingAction.current = { kind: "inspect", userItemId };
          }}
          onEquip={onEquip}
          onUnequip={onUnequip}
          onMerge={onMerge}
          onSetHotkey={
            onSetHotkey
              ? (userItem) => {
                  pendingAction.current = { kind: "hotkey", userItem };
                }
              : undefined
          }
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Offers equipped or backpack actions, sending operations with dialogs to the inspector. */
function ItemMenuEntries({
  userItem,
  allUserItems,
  userData,
  getBlockedReason,
  onInspect,
  onEquip,
  onUnequip,
  onMerge,
  onSetHotkey,
}: Omit<ItemContextMenuProps, "children">) {
  const { item } = userItem;
  const look = applyActiveVariant(userItem);
  const inspect = () => onInspect(userItem.id);
  const equippedIn = userItem.equipped === "NONE" ? null : userItem.equipped;
  // Battle keys fire only for equipped items.
  const canSetHotkey =
    !!onSetHotkey &&
    !!equippedIn &&
    hasFinePointer() &&
    userItem.quantity > 0 &&
    !NonActionItemTypes.includes(item.itemType);
  const hotkeyEntry = canSetHotkey && (
    <ContextMenuItem onSelect={() => onSetHotkey?.(userItem)}>
      Set hotkey…
    </ContextMenuItem>
  );
  const repairEntry = needsInventoryRepair(userItem) && (
    <ContextMenuItem onSelect={inspect}>Repair…</ContextMenuItem>
  );

  if (equippedIn) {
    return (
      <>
        <ContextMenuLabel>{look.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => onUnequip(userItem.id, equippedIn)}>
          Unequip
        </ContextMenuItem>
        <ContextMenuItem onSelect={inspect}>Inspect</ContextMenuItem>
        {hotkeyEntry}
        {repairEntry}
      </>
    );
  }

  const slots = fittingSlots(item);
  const isMeal = item.itemType === "MEAL";
  const canConsume = !isMeal && nonCombatConsume(item, userData);
  const hasVariants =
    ((userItem as UserItemWithVariants).item.variants?.length ?? 0) > 0;
  const drops = isDropOnlyItem(item);
  // Cards sell only surplus copies and keep their separated surplus stacks apart; packs
  // merge only with another stack.
  const sale = cardSale(userItem, allUserItems);
  const isKessen = isKessenGood(item);
  const canMerge =
    item.canStack &&
    item.itemType !== "CARD" &&
    (!isKessen || hasOtherStack(userItem, allUserItems));
  const canSplit = item.canStack && userItem.quantity > 1 && item.itemType !== "CARD";
  const sellEntry =
    sale?.kind === "unsellable" ? (
      item.cardData?.kind === "LEADER" ? (
        <ContextMenuItem disabled>Leaders are never sold</ContextMenuItem>
      ) : canListAtAuction(userItem) ? (
        <ContextMenuItem asChild>
          <Link href={auctionListingHref(userItem.id)}>List at auction…</Link>
        </ContextMenuItem>
      ) : (
        <ContextMenuItem disabled>Not sold to the shop · auction only</ContextMenuItem>
      )
    ) : isUnsellableCard(item) ? (
      <ContextMenuItem disabled>Cannot be sold</ContextMenuItem>
    ) : isEarnedKessenPack(item) ? (
      <ContextMenuItem disabled>Earned pack · open it instead</ContextMenuItem>
    ) : sale?.kind === "listed" ? (
      <ContextMenuItem disabled>Listed at auction</ContextMenuItem>
    ) : sale?.kind === "kept" ? (
      <ContextMenuItem disabled>
        {sale.surplusElsewhere ? "Deck copies · not for sale" : "No surplus to sell"}
      </ContextMenuItem>
    ) : (
      <ContextMenuItem variant="destructive" onSelect={inspect}>
        {sale
          ? `Sell ${surplusCopiesLabel(sale.kind === "mixed" ? sale.surplus : sale.copies)}…`
          : drops
            ? "Drop…"
            : "Sell…"}
      </ContextMenuItem>
    );
  return (
    <>
      <ContextMenuLabel>
        {look.name}
        {userItem.quantity > 1 ? ` ×${userItem.quantity}` : ""}
      </ContextMenuLabel>
      <ContextMenuItem onSelect={inspect}>Inspect</ContextMenuItem>
      {slots.length > 0 && (
        <>
          <ContextMenuSeparator />
          <ContextMenuLabel>Equip in</ContextMenuLabel>
          {slots.map((slot) => {
            const reason = getBlockedReason(userItem, slot);
            const occupied = allUserItems.some((ui) => ui.equipped === slot);
            return (
              <ContextMenuItem
                key={slot}
                disabled={!!reason}
                title={reason ?? undefined}
                onSelect={() => onEquip(userItem.id, slot)}
              >
                {slotName(slot)} · {occupied ? "swap" : "empty"}
              </ContextMenuItem>
            );
          })}
        </>
      )}
      {hotkeyEntry}
      {(isMeal || canConsume) && (
        <ContextMenuItem onSelect={inspect}>
          {isMeal ? "Eat meal…" : isKessenPackId(item.id) ? "Open pack…" : "Consume…"}
        </ContextMenuItem>
      )}
      {(canMerge || canSplit || hasVariants || repairEntry) && <ContextMenuSeparator />}
      {canMerge && (
        <ContextMenuItem onSelect={() => onMerge(userItem)}>
          Merge stacks
        </ContextMenuItem>
      )}
      {canSplit && <ContextMenuItem onSelect={inspect}>Split stack…</ContextMenuItem>}
      {hasVariants && <ContextMenuItem onSelect={inspect}>Variants…</ContextMenuItem>}
      {repairEntry}
      <ContextMenuSeparator />
      {sellEntry}
      {sale && sale.kind !== "unsellable" && canListAtAuction(userItem) && (
        <ContextMenuItem asChild>
          <Link href={auctionListingHref(userItem.id)}>List at auction…</Link>
        </ContextMenuItem>
      )}
    </>
  );
}

/** A click right after the menu opened is the end of a long press, not a selection. */
const LONG_PRESS_CLICK_MS = 700;

interface ItemContextMenuProps {
  userItem: UserItemWithRelations;
  /** Every carried item, to tell empty slots from ones an equip would swap. */
  allUserItems: UserItemWithRelations[];
  userData: NonNullable<UserWithRelations>;
  getBlockedReason: (userItem: UserItemWithRelations, slot: ItemSlot) => string | null;
  /** The mounted card or equipment button remains the inspector's focus return target. */
  onInspect: (userItemId: string, trigger?: HTMLButtonElement | null) => void;
  onEquip: (userItemId: string, slot: ItemSlot) => void;
  onUnequip: (userItemId: string, slot: ItemSlot) => void;
  onMerge: (userItem: UserItemWithRelations) => void;
  onSetHotkey?: (userItem: UserItemWithRelations) => void;
  children: React.ReactNode;
}
