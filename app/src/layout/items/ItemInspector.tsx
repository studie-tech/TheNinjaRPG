"use client";

import {
  ArrowDownToLine,
  CircleDollarSign,
  CircleFadingArrowUp,
  Cookie,
  Gem,
  House,
  Merge,
  Shirt,
  Split,
  X,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import type { ItemSlot } from "@/drizzle/constants";
import { ITEM_LEVEL_CAP, NonActionItemTypes } from "@/drizzle/constants";
import type { UserItemWithRelations, UserItemWithVariants } from "@/drizzle/schema";
import { useItemActions } from "@/hooks/useItemActions";
import Confirm from "@/layout/Confirm";
import ContentImage from "@/layout/ContentImage";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { rarityLabel, rarityTextClass, slotLabel } from "@/layout/items/ItemCard";
import {
  ItemDurabilityRepairActions,
  RepairItemSelectionModal,
} from "@/layout/items/ItemRepair";
import { ItemVariantModal } from "@/layout/items/ItemVariantModal";
import { MakeCosmetic } from "@/layout/items/MakeCosmetic";
import Loader from "@/layout/Loader";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { meetsEvolutionStatRequirements } from "@/libs/evolution";
import {
  applyActiveVariant,
  calcItemSellingPrice,
  nonCombatConsume,
  partitionImbuementsForItemTransfer,
  showsItemLevelBadge,
  userItemDisplay,
} from "@/libs/item";
import { getItemConsumeInput } from "@/libs/itemConsumption";
import { fittingSlots, slotName } from "@/libs/itemsPage";
import { hasRequiredLevel } from "@/libs/rank";
import { getRepairKits } from "@/libs/repair";
import { cn } from "@/libs/shadui";
import { remainingXpToLevel } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { parseHtml } from "@/utils/parse";

/**
 * Everything about one carried item and every action on it: effects and level, equip or
 * unequip, stacks, meals and consumables, repair, variants, evolution, imbuements and
 * selling. Each action keeps its confirmation; a finished action closes the inspector.
 * A stack in home storage shows its details and can only be taken out.
 */
export function ItemInspector({
  userItem: useritem,
  allUserItems,
  userData,
  onClose,
  onEquip,
  equipSlot,
  equipBlockedReason,
  isEquipping,
  onSetHotkey,
  masteryWarning,
  homeMove,
}: ItemInspectorProps) {
  const [isSplitDialogOpen, setIsSplitDialogOpen] = useState<boolean>(false);
  const [quantityToKeep, setQuantityToKeep] = useState<number>(Number.NaN);
  const [isRepairModalOpen, setIsRepairModalOpen] = useState<boolean>(false);
  const [variantItem, setVariantItem] = useState<UserItemWithVariants | undefined>(
    undefined,
  );

  const {
    merge,
    consume,
    sell,
    splitStack,
    repairWithKit: mutateRepairItem,
    repairWithRyo: mutateRepairWithRyo,
    evolve: evolveItem,
    removeImbuement,
    isPending,
    isMerging,
    isConsuming,
    isSelling,
    isEvolving,
    isSplitting,
    isUsingRepairItem,
    isRepairingWithRyo,
  } = useItemActions({
    useritem,
    onDone: () => {
      setIsSplitDialogOpen(false);
      setQuantityToKeep(Number.NaN);
      setIsRepairModalOpen(false);
      onClose();
    },
  });

  const { data: wardrobe } = api.cosmetic.get.useQuery();
  const selectedCosmetic = wardrobe?.slots.find(
    (entry) => entry.slot === useritem.equipped,
  );
  const { data: availableEvolutions } = api.item.getEvolutions.useQuery(
    { itemId: useritem.itemId },
    { staleTime: 5 * 60 * 1000 },
  );

  const isLoading = isPending || isEquipping;
  const isStored = useritem.storedAtHome;

  // Derived
  const structures = userData?.village?.structures;
  const isDropOnly = useritem.item.isEventItem || !useritem.item.inShop;
  const stackLabel =
    useritem.quantity > 1
      ? `${useritem.quantity}x ${useritem.item.name}`
      : useritem.item.name;
  const isMeal = useritem.item.itemType === "MEAL";
  const canEatMeal =
    !isLoading && canAttemptAwakeAction(userData) && !userData.battleId;
  const sellPrice = calcItemSellingPrice(userData, useritem, structures);
  const repairKits = getRepairKits(allUserItems, userData);
  const equippedIn = useritem.equipped === "NONE" ? null : useritem.equipped;
  // Battle keys fire only for equipped items.
  const canSetHotkey =
    !!onSetHotkey &&
    !!equippedIn &&
    useritem.quantity > 0 &&
    !NonActionItemTypes.includes(useritem.item.itemType);

  // Split stack handler
  const handleSplitStack = () => {
    const quantity = quantityToKeep;
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity >= useritem.quantity ||
      !useritem.item.canStack
    ) {
      return;
    }
    splitStack({ userItemId: useritem.id, quantityToKeep: quantity });
  };
  const look = applyActiveVariant(useritem as UserItemWithVariants);
  const canEquip =
    (equipSlot ? useritem.equipped !== equipSlot : useritem.equipped === "NONE") &&
    (equipSlot
      ? fittingSlots(useritem.item).includes(equipSlot)
      : fittingSlots(useritem.item).length > 0);
  const canConsume = !isMeal && nonCombatConsume(useritem.item, userData);
  const hasVariants =
    ((useritem as UserItemWithVariants).item.variants?.length ?? 0) > 0;
  const durabilityPercent =
    useritem.item.maxDurability > 0
      ? Math.round((useritem.durability / useritem.item.maxDurability) * 100)
      : null;
  const hasMoreActions =
    fittingSlots(useritem.item).length > 0 ||
    useritem.item.canStack ||
    hasVariants ||
    (availableEvolutions?.length ?? 0) > 0;

  return (
    <section
      aria-label={look.name}
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        // Escape inside a confirmation or dialog opened from here belongs to that dialog.
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.currentTarget.contains(event.target as Node)
        ) {
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Button variant="link" className="h-9 px-0" onClick={onClose}>
          ← Back
        </Button>
        <div className="grow" />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close inspector"
          className="h-9 w-9"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="flex items-start gap-3">
        <span className="relative h-16 w-16 shrink-0">
          <ContentImage
            image={look.image}
            alt={look.name}
            rarity={useritem.item.rarity}
            className="h-16 w-16"
          />
          {showsItemLevelBadge(useritem.item) && (
            <span className="absolute -bottom-1 -left-1 rounded-md border-2 border-red-600 bg-background px-1 font-bold text-[10px] text-foreground">
              Lv {useritem.level}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-foreground text-lg">{look.name}</h2>
          <p
            className={cn("text-sm font-medium", rarityTextClass[useritem.item.rarity])}
          >
            {rarityLabel[useritem.item.rarity]} {useritem.item.itemType.toLowerCase()}
            {useritem.item.slot !== "NONE" && ` · fits ${slotLabel(useritem)}`}
            {useritem.quantity > 1 && ` · ×${useritem.quantity}`}
          </p>
          {equippedIn && (
            <p className="text-muted-foreground text-sm">
              Equipped in {slotName(equippedIn)}
            </p>
          )}
          {isStored && (
            <p className="text-muted-foreground text-sm">In your home storage</p>
          )}
          {masteryWarning && (
            <p className="text-destructive text-sm">{masteryWarning}</p>
          )}
        </div>
      </div>
      {look.description && (
        <div data-reading-text className="text-muted-foreground text-sm">
          {parseHtml(look.description)}
        </div>
      )}
      <div className="text-sm">
        {showsItemLevelBadge(useritem.item) && useritem.level < ITEM_LEVEL_CAP && (
          <p>
            - Need {remainingXpToLevel(useritem.item.xpToLevel, useritem.experience)} XP
            more to level
          </p>
        )}
      </div>
      {!isLoading && !isStored && (
        <>
          <div className="flex flex-row flex-wrap items-center gap-2">
            {canEquip && (
              <Button
                disabled={!!equipBlockedReason}
                onClick={() =>
                  onEquip(
                    { userItemId: useritem.id, ...(equipSlot && { slot: equipSlot }) },
                    onClose,
                  )
                }
              >
                <Shirt className="mr-2 h-5 w-5" />
                {equipSlot ? `Equip in ${slotName(equipSlot)}` : "Equip"}
              </Button>
            )}
            {equippedIn && (
              <Button
                onClick={() =>
                  onEquip({ userItemId: useritem.id, slot: equippedIn }, onClose)
                }
              >
                <Shirt className="mr-2 h-5 w-5" />
                Unequip
              </Button>
            )}
            {isMeal && (
              <Confirm
                title={`Eat ${useritem.item.name}?`}
                proceed_label="Eat meal"
                proceed_loading_label="Eating…"
                disabled={isLoading}
                confirmDisabled={!canEatMeal}
                isLoading={isConsuming}
                keepOpenOnAccept
                button={
                  <Button disabled={isLoading}>
                    <Cookie className="mr-2 h-5 w-5" />
                    Eat meal
                  </Button>
                }
                onAccept={() => consume(getItemConsumeInput(userData.userId, useritem))}
              >
                <p>
                  Eat one <b>{useritem.item.name}</b>? Its effect lasts{" "}
                  {useritem.item.mealDurationSeconds} seconds.
                </p>
                <p className="text-muted-foreground text-sm">
                  Eating the same meal extends its duration; another meal replaces it.
                  You must be awake and out of combat.
                </p>
              </Confirm>
            )}
            {canConsume && (
              <Button
                disabled={isConsuming}
                onClick={() => consume(getItemConsumeInput(userData.userId, useritem))}
              >
                <Cookie className="mr-2 h-5 w-5" />
                Consume
              </Button>
            )}
            {canSetHotkey && (
              <Button
                variant="outline"
                className="not-any-pointer-fine:hidden"
                onClick={() => onSetHotkey?.(useritem)}
              >
                Set hotkey
              </Button>
            )}
          </div>
          {canEquip && equipBlockedReason && (
            <p className="text-destructive text-sm">{equipBlockedReason}</p>
          )}
          {durabilityPercent !== null && (
            <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold">Durability {durabilityPercent}%</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      durabilityPercent < 50 ? "bg-orange-600" : "bg-lime-600",
                    )}
                    style={{ width: `${durabilityPercent}%` }}
                  />
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <ItemDurabilityRepairActions
                  useritem={useritem}
                  userData={userData}
                  repairItemsCount={repairKits.length}
                  onOpenRepairModal={() => setIsRepairModalOpen(true)}
                  onRepairWithRyo={(userItemId) => mutateRepairWithRyo({ userItemId })}
                  isRepairingWithRyo={isRepairingWithRyo}
                />
              </div>
            </div>
          )}
          {hasMoreActions && (
            <div className="flex flex-row flex-wrap items-center gap-2">
              {useritem.item.canStack && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => merge({ itemId: useritem.itemId })}
                  >
                    <Merge className="mr-2 h-5 w-5" />
                    Merge Stacks
                  </Button>
                  {useritem.quantity > 1 && useritem.equipped === "NONE" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsSplitDialogOpen(true);
                        setQuantityToKeep(Number.NaN);
                      }}
                    >
                      <Split className="mr-2 h-5 w-5" />
                      Split Stack
                    </Button>
                  )}
                </>
              )}
              {selectedCosmetic && (
                <p className="text-sm">
                  Cosmetic appearance ·{" "}
                  {selectedCosmetic.variant?.name ?? selectedCosmetic.item?.name}
                </p>
              )}
              <MakeCosmetic userItem={useritem} />
              {hasVariants && (
                <Button
                  variant="outline"
                  onClick={() => setVariantItem(useritem as UserItemWithVariants)}
                >
                  Variants
                </Button>
              )}
              {availableEvolutions?.map((evo) => {
                const isStillCrafting =
                  !!useritem.craftingFinishedAt &&
                  useritem.craftingFinishedAt > new Date();
                const { remove: imbuementsLost } = partitionImbuementsForItemTransfer(
                  useritem.imbuements,
                  evo,
                );
                const canEvolve =
                  canAttemptAwakeAction(userData) &&
                  useritem.level >= ITEM_LEVEL_CAP &&
                  useritem.quantity === 1 &&
                  !useritem.isInAuction &&
                  !isStillCrafting &&
                  meetsEvolutionStatRequirements(evo, userData) &&
                  hasRequiredLevel(userData.level, evo.requiredLevel) &&
                  (!evo.bloodlineId || evo.bloodlineId === userData.bloodlineId);
                return (
                  <Confirm
                    key={evo.id}
                    title={`Evolve to ${evo.name}`}
                    confirmDisabled={!canEvolve}
                    button={
                      <Button
                        id={`evolve-${evo.id}`}
                        variant="secondary"
                        disabled={isLoading}
                      >
                        <CircleFadingArrowUp className="mr-2 h-5 w-5" />
                        Evolve
                      </Button>
                    }
                    onAccept={(e) => {
                      e.preventDefault();
                      if (!canEvolve) return;
                      evolveItem({
                        userItemId: useritem.id,
                        evolutionItemId: evo.id,
                      });
                    }}
                  >
                    <p>
                      Evolve <b>{useritem.item.name}</b> into <b>{evo.name}</b>?
                    </p>
                    <p className="mt-2 text-muted-foreground text-sm">
                      This replaces your current item. The evolved item starts at level
                      1 and can be leveled to {ITEM_LEVEL_CAP} through PvP. Durability
                      is capped to the new item&apos;s max.
                    </p>
                    {imbuementsLost.length > 0 && (
                      <p className="text-destructive text-sm">
                        Warning: the following imbuement
                        {imbuementsLost.length === 1 ? "" : "s"} cannot transfer to this
                        evolution and will be removed:{" "}
                        <b>
                          {imbuementsLost
                            .map((imb) => imb.item?.name ?? "Unknown crystal")
                            .join(", ")}
                        </b>
                      </p>
                    )}
                    {!canAttemptAwakeAction(userData) && (
                      <p className="text-destructive text-sm">
                        Must be awake to evolve an item (current:{" "}
                        {userData.status.toLowerCase()}).
                      </p>
                    )}
                    {useritem.level < ITEM_LEVEL_CAP && (
                      <p className="text-destructive text-sm">
                        Required Item Level: <b>{ITEM_LEVEL_CAP}</b> (current:{" "}
                        {useritem.level})
                      </p>
                    )}
                    {useritem.quantity !== 1 && (
                      <p className="text-destructive text-sm">
                        Split the stack to a single item before evolving.
                      </p>
                    )}
                    {isStillCrafting && (
                      <p className="text-destructive text-sm">
                        Cannot evolve an item that is still crafting.
                      </p>
                    )}
                    {evo.requiredLevel > 1 && (
                      <p className="text-sm">
                        Required Character Level: <b>{evo.requiredLevel}</b>
                      </p>
                    )}
                  </Confirm>
                );
              })}
            </div>
          )}
        </>
      )}
      {!isStored &&
        !useritem.item.canBeImbued &&
        useritem.equipped === "NONE" &&
        useritem.imbuements.length > 0 && (
          <div className="mb-2 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-destructive text-sm">
              Imbuing is disabled on this item. Remove imbuements to return the crystals
              to your inventory.
            </p>
            {useritem.imbuements.map((imbuement) => (
              <Confirm
                key={imbuement.id}
                title="Remove Imbuement"
                proceed_label="Remove & Return Crystal"
                button={
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isLoading}
                    className="w-full justify-start"
                  >
                    <Gem className="mr-2 h-4 w-4" />
                    Remove {imbuement.item.name}
                  </Button>
                }
                onAccept={(e) => {
                  e.preventDefault();
                  removeImbuement({ userItemImbuementId: imbuement.id });
                }}
              >
                <p>
                  Remove <b>{imbuement.item.name}</b> from <b>{useritem.item.name}</b>?
                  The crystal will be returned to your inventory.
                </p>
              </Confirm>
            ))}
          </div>
        )}
      {homeMove && !isLoading && (
        <div className="flex flex-col gap-1">
          <Button
            variant="outline"
            className="self-start"
            disabled={!!homeMove.blockedReason || homeMove.isMoving}
            aria-busy={homeMove.isMoving}
            onClick={homeMove.onMove}
          >
            <House className="mr-2 h-5 w-5" aria-hidden />
            {homeMove.isMoving
              ? isStored
                ? "Taking out"
                : "Storing"
              : isStored
                ? "Take out"
                : "Store at home"}
          </Button>
          {homeMove.blockedReason && (
            <p className="text-muted-foreground text-sm">{homeMove.blockedReason}</p>
          )}
        </div>
      )}
      {isMerging && <Loader explanation="Merging" />}
      {isConsuming && <Loader explanation="Using" />}
      {isSelling && <Loader explanation="Selling" />}
      {isEquipping && <Loader explanation="Equipping" />}
      {isEvolving && <Loader explanation="Evolving" />}
      {isRepairingWithRyo && <Loader explanation="Repairing" />}
      {/* The full stats show straight away; the header above already carries the name and art. */}
      <section aria-label="Details" className="rounded-lg border bg-card">
        <h3 className="px-3 pt-2 font-semibold text-sm">Details</h3>
        <div className="p-2">
          <ItemWithEffects
            item={userItemDisplay(useritem, {
              ...applyActiveVariant(useritem as UserItemWithVariants),
              // The header above already shows the description.
              description: "",
            })}
            key={useritem.id}
            showStatistic="item"
            showEvolutions
            hideTitle
            hideImage
            hideDates
          />
        </div>
      </section>
      {!isLoading && !isStored && (
        <div className="flex items-center gap-2 border-t pt-3">
          <span className="flex-1 text-muted-foreground text-xs">
            Asks for a security confirmation
          </span>
          <Confirm
            title={isDropOnly ? "Drop item?" : "Sell item?"}
            tone="destructive"
            proceed_label={
              isDropOnly
                ? "Drop item"
                : `Sell for ${Math.floor(sellPrice).toLocaleString()} ryo`
            }
            proceed_loading_label={isDropOnly ? "Dropping" : "Selling"}
            isLoading={isSelling}
            button={
              isDropOnly ? (
                <Button id="sell" variant="destructive">
                  <ArrowDownToLine className="mr-2 h-5 w-5" />
                  Drop Item
                </Button>
              ) : (
                <Button id="sell" variant="destructive">
                  <CircleDollarSign className="mr-2 h-5 w-5" />
                  Sell Item [{Math.floor(sellPrice)} ryo]
                </Button>
              )
            }
            onAccept={() => sell({ userItemId: useritem.id })}
          >
            {isDropOnly
              ? `Drop ${stackLabel}? It is removed from your inventory and cannot be recovered.`
              : `Sell ${stackLabel} for ${Math.floor(sellPrice).toLocaleString()} ryo? This cannot be undone.`}
          </Confirm>
        </div>
      )}
      {isSplitDialogOpen && useritem && (
        <Dialog open={isSplitDialogOpen} onOpenChange={setIsSplitDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Split Stack</DialogTitle>
              <DialogDescription>
                How many items do you want to keep in this stack? The rest will be moved
                to a new stack.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="quantity">Quantity to Keep</Label>
              <NumberInput
                id="quantity"
                min="1"
                max={useritem.quantity - 1}
                value={quantityToKeep}
                onValueChange={setQuantityToKeep}
                placeholder={`1-${useritem.quantity - 1}`}
                className="mt-2"
              />
              <p className="mt-2 text-muted-foreground text-sm">
                Current stack: {useritem.quantity} items
              </p>
              {Number.isInteger(quantityToKeep) && quantityToKeep > 0 && (
                <p className="mt-1 text-muted-foreground text-sm">
                  New stack will have: {useritem.quantity - quantityToKeep} items
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsSplitDialogOpen(false);
                  setQuantityToKeep(Number.NaN);
                }}
                disabled={isSplitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSplitStack}
                disabled={
                  isSplitting ||
                  !quantityToKeep ||
                  !Number.isInteger(quantityToKeep) ||
                  quantityToKeep < 1 ||
                  quantityToKeep >= useritem.quantity
                }
              >
                {isSplitting ? "Splitting" : "Split Stack"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {/* Repair Item Selection Modal */}
      <RepairItemSelectionModal
        targetItem={useritem}
        repairKits={repairKits}
        isOpen={isRepairModalOpen}
        setIsOpen={setIsRepairModalOpen}
        onSelectRepairItem={(repairItemId, targetItemId) => {
          mutateRepairItem({ repairItemId, targetItemId });
        }}
        isPending={isUsingRepairItem}
      />
      {/* Variant Modal */}
      {variantItem && (
        <ItemVariantModal
          userItem={variantItem}
          allUserItems={allUserItems}
          onClose={() => setVariantItem(undefined)}
        />
      )}
    </section>
  );
}

interface ItemInspectorProps {
  userItem: UserItemWithRelations;
  /** Every carried item, for repair kits and variant tokens held elsewhere. */
  allUserItems: UserItemWithRelations[] | undefined;
  userData: NonNullable<UserWithRelations>;
  onClose: () => void;
  /** Uses the workspace guard so panel changes cannot repeat an in-flight toggle. */
  onEquip: (
    input: { userItemId: string; slot?: ItemSlot },
    onSettled: () => void,
  ) => void;
  /** The picker slot this item was inspected from, retained for equipping or moving. */
  equipSlot?: ItemSlot;
  /** The picker's current restriction on equipping into that slot. */
  equipBlockedReason?: string | null;
  isEquipping: boolean;
  /** Opens battle-key assignment; offered on devices with a keyboard. */
  onSetHotkey?: (userItem: UserItemWithRelations) => void;
  /** Why the item does not work in battle while equipped, if it does not. */
  masteryWarning?: string;
  /** Storing in or taking out of home storage, offered while the player can reach it. */
  homeMove?: {
    /** Why the stack cannot move now, such as a full bucket. */
    blockedReason: string | null;
    isMoving: boolean;
    onMove: () => void;
  };
}
