"use client";

import { ListChecks } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ItemSlot } from "@/drizzle/constants";
import { MAX_BULK_SELL_ITEMS } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { useBulkSellItems } from "@/hooks/useBulkSellItems";
import { useCosmetics } from "@/hooks/useCosmetics";
import { useHomeStorageMove } from "@/hooks/useHomeStorageMove";
import { useItemActions } from "@/hooks/useItemActions";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { EquipmentPreview } from "@/layout/EquipmentPreview";
import { useHotkeyAssignment } from "@/layout/HotkeyControls";
import { BackpackList } from "@/layout/items/BackpackList";
import { BulkSellDialog, bulkSellSummary } from "@/layout/items/BulkSellDialog";
import { EquipmentFigure } from "@/layout/items/EquipmentFigure";
import { ItemContextMenu } from "@/layout/items/ItemContextMenu";
import { ItemInspector } from "@/layout/items/ItemInspector";
import { SlotPicker } from "@/layout/items/SlotPicker";
import { applyActiveVariant } from "@/libs/item";
import {
  bulkSellBlockReason,
  bulkSellTotals,
  dropTargetsFor,
  equipLimitReason,
  slotName,
  toggleRarityPick,
} from "@/libs/itemsPage";
import { gearMissingMastery } from "@/libs/mastery";
import { cn } from "@/libs/shadui";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import type { UserWithRelations } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";

/**
 * The Equipped figure beside the backpack, where a slot opens its picker and an item its
 * inspector. Wide containers show them side by side; narrow ones use Equipment and
 * Backpack tabs with panels in a bottom sheet. With a mouse or trackpad, backpack items can
 * be dragged onto fitting slots; every item opens a menu by right-click or long-press.
 * While the player can reach their home, the backpack column also switches to home storage,
 * where stacks are taken out one at a time or in Select mode.
 */
export function ItemsWorkspace({
  userData,
  userItems,
  bagItems,
  bag,
  backpackStatus,
  bagTabs,
  home,
}: ItemsWorkspaceProps) {
  const [opened, setOpened] = useState<{
    bag: string;
    view: ItemsView;
    storedAtHome?: boolean;
  }>({
    bag,
    view: { kind: "backpack" },
  });
  const { wardrobe } = useCosmetics();
  const [phoneTab, setPhoneTab] = useState("equipment");
  const [dragging, setDragging] = useState<UserItemWithRelations | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backpackRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const sellTriggerRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLButtonElement>(null);
  // Toggling an equip twice reverses it on the server, so one change is sent at a time.
  const equipInFlight = useRef(false);
  const hasFinePointer = useMediaQuery("(any-pointer: fine)");

  const { equip, merge, isEquipping } = useItemActions({
    useritem: undefined,
    onDone: () => {},
  });
  const equipOnce = (
    input: { userItemId: string; slot?: ItemSlot },
    onSettled?: () => void,
  ) => {
    if (equipInFlight.current) return;
    equipInFlight.current = true;
    // Released by this equip alone; other actions settling must not open the guard.
    equip(input, {
      onSettled: () => {
        equipInFlight.current = false;
        onSettled?.();
      },
    });
  };
  const {
    hotkeys,
    assign: assignHotkey,
    dialog: hotkeyDialog,
  } = useHotkeyAssignment(
    Object.fromEntries(userItems.map((ui) => [ui.itemId, ui.item.name])),
  );
  // Select mode ticks stacks for a bulk sale or storage move instead of opening them.
  const [isSelecting, setIsSelecting] = useState(false);
  const [tickedIds, setTickedIds] = useState<string[]>([]);
  const [reviewIds, setReviewIds] = useState<string[] | null>(null);
  const { sellMany, isSelling } = useBulkSellItems({
    onSold: (result) => {
      // Stacks that stayed remain selected so the player can see why and retry.
      const stayed = result.refused.map((entry) => entry.userItemId);
      setTickedIds((ids) => ids.filter((id) => stayed.includes(id)));
      if (stayed.length === 0) setIsSelecting(false);
    },
    onSettled: () => setReviewIds(null),
  });
  const isHome = home?.place === "home";
  const { moveItems, isMoving } = useHomeStorageMove({
    onMoved: (result) => {
      // A refused request moved nothing; stacks that stayed remain selected for a retry.
      if (!result.success) return;
      const stayed = result.refused.map((entry) => entry.userItemId);
      setTickedIds((ids) => ids.filter((id) => stayed.includes(id)));
      if (stayed.length === 0) setIsSelecting(false);
    },
  });
  // The backpack column lists the open bag or, at home, the open storage bucket.
  const listItems = isHome ? home.items : bagItems;
  // Selection permits either action; storing a farm seed does not require buying it back.
  const selectBlockReason = (ui: UserItemWithRelations) => {
    if (isHome) return null;
    const reason = bulkSellBlockReason(ui, userData.farmCurrency);
    return reason && home && !home.blockReason(ui.id, true) ? null : reason;
  };
  // Stacks sold elsewhere or in another bag leave the selection.
  const selectedItems = listItems.filter((ui) => tickedIds.includes(ui.id));
  const selectedIds = selectedItems.map((ui) => ui.id);
  const sellBlockedReason = selectedItems
    .map((ui) => {
      const reason = bulkSellBlockReason(ui, userData.farmCurrency);
      return reason ? `${applyActiveVariant(ui).name} ${reason}` : undefined;
    })
    .find(Boolean);
  // One request takes a limited number of stacks; a larger selection is trimmed first.
  const isOverLimit = selectedItems.length > MAX_BULK_SELL_ITEMS;
  const toggleTicked = (userItemId: string) =>
    setTickedIds((ids) =>
      ids.includes(userItemId)
        ? ids.filter((id) => id !== userItemId)
        : [...ids, userItemId],
    );
  const stopSelecting = () => {
    setIsSelecting(false);
    setTickedIds([]);
  };
  const switchPlace = (place: ItemsPlace) => {
    stopSelecting();
    home?.onPlaceChange(place);
  };

  // Equipment can be inspected from either list. Keep the opened storage side so a moved
  // stack closes its panel even when it appears in the other inventory immediately.
  const inspectable = [...userItems, ...(home?.items ?? [])];
  const openedView = opened.view;
  const inspected =
    opened.bag === bag && openedView.kind === "item"
      ? inspectable.find(
          (ui) =>
            ui.id === openedView.userItemId && ui.storedAtHome === opened.storedAtHome,
        )
      : undefined;
  const view: ItemsView =
    opened.bag !== bag || (openedView.kind === "item" && !inspected)
      ? { kind: "backpack" }
      : openedView;
  const hasPanel = view.kind !== "backpack";
  // Hidden items show only to content staff, as everywhere else items are listed.
  const choosable = canChangeContent(userData.role)
    ? userItems
    : userItems.filter((ui) => !ui.item.hidden);
  const choosableBag = canChangeContent(userData.role)
    ? listItems
    : listItems.filter((ui) => !ui.item.hidden);

  // Panels sit beside the figure when there is room, else in a bottom sheet above the
  // layout's own navigation.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setIsNarrow(entry.contentRect.width < 600);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const openView = (next: ItemsView, opener = document.activeElement) => {
    // Panel controls disappear on navigation; retain the equipment/card trigger.
    if (opener instanceof HTMLElement && !panelRef.current?.contains(opener)) {
      returnFocusRef.current = opener;
    }
    setOpened({
      bag,
      view: next,
      storedAtHome:
        next.kind === "item"
          ? inspectable.find((ui) => ui.id === next.userItemId)?.storedAtHome
          : undefined,
    });
  };
  const closeView = () => {
    setOpened({ bag, view: { kind: "backpack" } });
    // Inline panels restore focus after rendering; sheets wait until their focus scope closes.
    const target = returnFocusRef.current;
    if (!isNarrow && target?.isConnected) {
      requestAnimationFrame(() => target.focus());
    }
  };

  // Opening or reselecting a panel moves focus there so Escape and Tab work there.
  useEffect(() => {
    if (opened.view.kind === "backpack") return;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [opened]);

  // Battles unequip worn gear and hide weapons whose mastery gate is unmet; activated
  // skills count toward masteries as they do there.
  const wearer = { ...userData, items: userItems };
  const masteryWarning = (userItem: UserItemWithRelations) => {
    if (userItem.equipped === "NONE") return undefined;
    if (!hasRequiredSkill(userItem.item, wearer)) {
      return "Unusable in battle: activate the required skill";
    }
    const missing = gearMissingMastery(userItem, wearer);
    if (!missing) return undefined;
    const current = Math.floor(missing.current).toLocaleString();
    return `Unusable in battle: requires ${missing.required.toLocaleString()} ${missing.label} (you have ${current})`;
  };
  // The server refuses gear at its equip limit, and gear whose mastery is unmet once the
  // slot's current item is removed.
  const getBlockedReason = (userItem: UserItemWithRelations, slot: ItemSlot) => {
    const limit = equipLimitReason(userItem, userItems);
    if (limit) return limit;
    const missing = gearMissingMastery(userItem, {
      ...wearer,
      items: userItems.filter((ui) => ui.equipped !== slot),
    });
    return missing
      ? `Needs ${missing.required.toLocaleString()} ${missing.label}`
      : null;
  };

  const setHotkey = (userItem: UserItemWithRelations) =>
    assignHotkey({ id: userItem.itemId, name: userItem.item.name, kind: "item" });
  const withMenu = (userItem: UserItemWithRelations, trigger: React.ReactNode) => (
    <ItemContextMenu
      userItem={userItem}
      allUserItems={userItems}
      userData={userData}
      getBlockedReason={getBlockedReason}
      onInspect={(userItemId, trigger) =>
        openView({ kind: "item", userItemId }, trigger)
      }
      onEquip={(userItemId, slot) => equipOnce({ userItemId, slot })}
      onUnequip={(userItemId, slot) => equipOnce({ userItemId, slot })}
      onMerge={(target) => merge({ itemId: target.itemId })}
      onSetHotkey={setHotkey}
    >
      {trigger}
    </ItemContextMenu>
  );

  const panelTitle =
    view.kind === "slot"
      ? `${slotName(view.slot)} slot`
      : inspected
        ? applyActiveVariant(inspected).name
        : "Item";
  const panel = (
    <>
      {view.kind === "slot" && (
        <SlotPicker
          slot={view.slot}
          userItems={choosable}
          getBlockedReason={getBlockedReason}
          onEquip={(userItemId, slot) => equipOnce({ userItemId, slot })}
          onUnequip={(userItemId, slot) => equipOnce({ userItemId, slot })}
          onInspect={(userItemId) =>
            openView({ kind: "item", userItemId, slot: view.slot })
          }
          onShowInBackpack={() => {
            switchPlace("backpack");
            setPhoneTab("backpack");
            returnFocusRef.current = backpackRef.current;
            closeView();
          }}
          onClose={closeView}
          isPending={isEquipping}
        />
      )}
      {inspected && (
        <ItemInspector
          key={inspected.id}
          userItem={inspected}
          allUserItems={userItems}
          userData={userData}
          onClose={closeView}
          onEquip={equipOnce}
          equipSlot={view.kind === "item" ? view.slot : undefined}
          equipBlockedReason={
            view.kind === "item" && view.slot
              ? getBlockedReason(inspected, view.slot)
              : undefined
          }
          isEquipping={isEquipping}
          onSetHotkey={setHotkey}
          masteryWarning={masteryWarning(inspected)}
          homeMove={
            home &&
            inspected.equipped === "NONE" &&
            inspected.item.itemType !== "FURNITURE"
              ? {
                  blockedReason: home.blockReason(
                    inspected.id,
                    !inspected.storedAtHome,
                  ),
                  isMoving,
                  onMove: () => moveItems([inspected.id], !inspected.storedAtHome),
                }
              : undefined
          }
        />
      )}
    </>
  );

  return (
    <Tabs
      ref={rootRef}
      value={phoneTab}
      onValueChange={setPhoneTab}
      className="@container"
    >
      {hotkeyDialog}
      <TabsList
        aria-label="Items view"
        className="flex-nowrap gap-1.5 rounded-none bg-transparent px-3 pt-3 pb-0 @min-[600px]:hidden"
      >
        <PhoneTab value="equipment">Equipment</PhoneTab>
        <PhoneTab value="backpack">
          {isHome ? "Home" : "Backpack"} · {choosableBag.length}
        </PhoneTab>
      </TabsList>
      <div className="grid @min-[600px]:grid-cols-[314px_minmax(0,1fr)]">
        {/* Keep both panels mounted for the wide layout and durable opener refs. */}
        <TabsContent
          value="equipment"
          forceMount
          tabIndex={isNarrow ? 0 : -1}
          className={cn(
            "mt-0 min-w-0 p-3",
            phoneTab === "backpack" && "@max-[600px]:hidden",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold text-2xl text-foreground">Equipped</h2>
            <EquipmentPreview
              user={{
                ...userData,
                cosmeticSlots: wardrobe.data?.slots ?? userData.cosmeticSlots,
              }}
              items={userItems}
            />
          </div>
          <div className="relative mx-auto w-full max-w-[290px]">
            <EquipmentFigure
              cosmeticSlots={wardrobe.data?.slots}
              userItems={userItems}
              activeSlot={view.kind === "slot" ? view.slot : undefined}
              dropTargets={
                dragging ? dropTargetsFor(dragging, getBlockedReason) : undefined
              }
              masteryWarning={masteryWarning}
              hotkeys={hotkeys.byAction}
              onSlotClick={(slot) => openView({ kind: "slot", slot })}
              onDropItem={(userItemId, slot) => {
                setDragging(null);
                equipOnce({ userItemId, slot });
              }}
              wrapTile={(_slot, userItem, tile) =>
                userItem ? withMenu(userItem, tile) : tile
              }
            />
          </div>
        </TabsContent>
        <TabsContent
          ref={backpackRef}
          value="backpack"
          forceMount
          tabIndex={isNarrow ? 0 : -1}
          className={cn(
            "mt-0 min-w-0 overflow-y-auto border-t-2 border-dashed bg-card p-3 @min-[600px]:max-h-[600px] @min-[600px]:border-t-0 @min-[600px]:border-l-2",
            phoneTab === "equipment" && "@max-[600px]:hidden",
            hasPanel && !isNarrow && "@min-[600px]:hidden",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            {home ? (
              <>
                <h2 className="sr-only">{isHome ? "Home storage" : "Backpack"}</h2>
                <fieldset
                  aria-label="Show items in"
                  className="flex min-w-0 gap-0.5 rounded-lg bg-muted p-0.5"
                >
                  <PlaceButton
                    isPressed={!isHome}
                    onClick={() => switchPlace("backpack")}
                  >
                    Backpack
                  </PlaceButton>
                  <PlaceButton isPressed={isHome} onClick={() => switchPlace("home")}>
                    Home · {home.count}
                  </PlaceButton>
                </fieldset>
              </>
            ) : (
              <h2 className="font-bold text-2xl text-foreground">Backpack</h2>
            )}
            <div className="flex items-center gap-1">
              <Button
                ref={selectRef}
                variant={isSelecting ? "default" : "outline"}
                size="sm"
                aria-pressed={isSelecting}
                onClick={() => (isSelecting ? stopSelecting() : setIsSelecting(true))}
              >
                <ListChecks className="mr-1 h-4 w-4" aria-hidden />
                Select
              </Button>
              {isHome ? home.status : backpackStatus}
            </div>
          </div>
          {isHome ? (
            <div className="mt-1 mb-3">{home.bagTabs}</div>
          ) : (
            bagTabs && <div className="mt-1 mb-3">{bagTabs}</div>
          )}
          <BackpackList
            items={listItems}
            userData={userData}
            selectedId={inspected?.id}
            onSelect={(userItemId) => openView({ kind: "item", userItemId })}
            // Stored stacks are not worn from home storage.
            onDragItem={hasFinePointer && !isHome ? setDragging : undefined}
            wrapCard={isHome ? undefined : withMenu}
            selection={
              isSelecting
                ? {
                    ids: selectedIds,
                    onToggle: toggleTicked,
                    onPickRarity: (rarity, shown) =>
                      setTickedIds(
                        toggleRarityPick(shown, rarity, selectedIds, selectBlockReason),
                      ),
                    blockReason: selectBlockReason,
                  }
                : undefined
            }
          />
          {isSelecting && (
            <section
              aria-label="Selected items"
              className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-lg"
            >
              <p className="min-w-0 flex-1 text-sm">
                <b>{selectedItems.length} selected</b>
                {isOverLimit && (
                  <span className="block font-semibold text-destructive text-xs">
                    Select up to {MAX_BULK_SELL_ITEMS} at a time
                  </span>
                )}
                {!isHome && selectedItems.length > 0 && (
                  <span className="block text-muted-foreground text-xs">
                    {bulkSellSummary(
                      bulkSellTotals(
                        selectedItems,
                        userData,
                        userData.village?.structures,
                      ),
                    )}
                  </span>
                )}
              </p>
              <Button variant="outline" size="sm" onClick={stopSelecting}>
                Cancel
              </Button>
              {home && (
                <Button
                  variant={isHome ? "default" : "outline"}
                  size="sm"
                  disabled={selectedItems.length === 0 || isOverLimit || isMoving}
                  aria-busy={isMoving}
                  onClick={() => moveItems(selectedIds, !isHome)}
                >
                  {isHome ? "Take out" : "Store at home"}
                </Button>
              )}
              {!isHome && (
                <Button
                  ref={sellTriggerRef}
                  variant="destructive"
                  size="sm"
                  disabled={
                    selectedItems.length === 0 || isOverLimit || !!sellBlockedReason
                  }
                  hoverText={sellBlockedReason}
                  onClick={() => setReviewIds(selectedIds)}
                >
                  Sell / drop…
                </Button>
              )}
            </section>
          )}
          {reviewIds && (
            <BulkSellDialog
              items={bagItems.filter((ui) => reviewIds.includes(ui.id))}
              selectedIds={selectedIds}
              userData={userData}
              isSelling={isSelling}
              onToggle={toggleTicked}
              onConfirm={sellMany}
              onClose={() => setReviewIds(null)}
              onCloseAutoFocus={(event) => {
                // A completed sale removes the opener; Select remains available.
                const target = sellTriggerRef.current?.disabled
                  ? selectRef.current
                  : (sellTriggerRef.current ?? selectRef.current);
                if (target?.isConnected) {
                  event.preventDefault();
                  target.focus();
                }
              }}
            />
          )}
        </TabsContent>
        {hasPanel && !isNarrow && (
          <div
            ref={panelRef}
            data-items-panel
            className="col-start-2 row-start-1 max-h-[600px] min-w-0 overflow-y-auto border-l-2 border-dashed bg-card p-3"
          >
            {panel}
          </div>
        )}
      </div>
      {isNarrow && (
        <Sheet open={hasPanel} onOpenChange={(open) => !open && closeView()}>
          <SheetContent
            ref={panelRef}
            side="bottom"
            // The panels draw their own close button in their header.
            showCloseButton={false}
            className="max-h-[85dvh] rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none"
            // Focus the sheet itself so the close button does not open with a focus ring.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)?.focus();
            }}
            onCloseAutoFocus={(event) => {
              if (returnFocusRef.current?.isConnected) {
                event.preventDefault();
                returnFocusRef.current.focus();
              }
            }}
            // The sheet's strict containment would ignore the panel's height; keep it
            // content-sized up to the maximum.
            style={{ contain: "layout paint" }}
          >
            <SheetTitle className="sr-only">{panelTitle}</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </Tabs>
  );
}

/** One side of the Backpack | Home switch heading the backpack column. */
function PlaceButton({
  isPressed,
  onClick,
  children,
}: {
  isPressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={isPressed}
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-md px-3 font-bold text-base",
        isPressed
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Uses shared tab semantics and focus handling for the compact inventory view switcher. */
function PhoneTab({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="h-11 flex-1 rounded-lg bg-muted font-semibold text-foreground text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
    >
      {children}
    </TabsTrigger>
  );
}

/** What the side panel shows: the backpack, one slot's picker, or one item. */
export type ItemsView =
  | { kind: "backpack" }
  | { kind: "slot"; slot: ItemSlot }
  | { kind: "item"; userItemId: string; slot?: ItemSlot };

interface ItemsWorkspaceProps {
  userData: NonNullable<UserWithRelations>;
  /** Every carried, usable item across bags. */
  userItems: UserItemWithRelations[];
  /** Unequipped items of the selected bag. */
  bagItems: UserItemWithRelations[];
  /** The selected bag; panels opened in another bag close on a switch. */
  bag: string;
  /** Shown beside the Backpack heading: the bag's capacity and slot purchase. */
  backpackStatus?: React.ReactNode;
  /** Shown under the Backpack heading: the bag switcher. */
  bagTabs?: React.ReactNode;
  /** Home storage, offered while the player can reach their home. */
  home?: {
    /** Which list the backpack column shows. */
    place: ItemsPlace;
    onPlaceChange: (place: ItemsPlace) => void;
    /** Stored stacks of the open storage bucket. */
    items: UserItemWithRelations[];
    /** Every stored stack shown on the Items page. */
    count: number;
    /** Shown beside the switch at home: the bucket's capacity. */
    status?: React.ReactNode;
    /** Shown under the switch at home: the storage bucket switcher. */
    bagTabs: React.ReactNode;
    /** Why a stack cannot be stored (`toHome`) or taken out now, if it cannot. */
    blockReason: (userItemId: string, toHome: boolean) => string | null;
  };
}

/** Where the backpack column looks: the carried bags or home storage. */
export type ItemsPlace = "backpack" | "home";
