"use client";

import {
  ArrowDownToLine,
  CircleDollarSign,
  CircleFadingArrowUp,
  Cookie,
  Gavel,
  Gem,
  House,
  Merge,
  PackageOpen,
  Shirt,
  Split,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useRef, useState } from "react";
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
import { useSplitBeforeSale } from "@/hooks/useSplitBeforeSale";
import Confirm from "@/layout/Confirm";
import ContentImage from "@/layout/ContentImage";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { itemCardDisplay } from "@/layout/items/cardDisplay";
import {
  cardKindLabel,
  rarityLabel,
  rarityTextClass,
  slotLabel,
} from "@/layout/items/ItemCard";
import {
  ItemDurabilityRepairActions,
  RepairItemSelectionModal,
} from "@/layout/items/ItemRepair";
import { ItemVariantModal } from "@/layout/items/ItemVariantModal";
import { MakeCosmetic } from "@/layout/items/MakeCosmetic";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { meetsEvolutionStatRequirements } from "@/libs/evolution";
import {
  applyActiveVariant,
  calcItemSellingPrice,
  cosmeticSlotsForItem,
  isDropOnlyItem,
  isUnsellableCard,
  nonCombatConsume,
  partitionImbuementsForItemTransfer,
  showsItemLevelBadge,
  userItemDisplay,
} from "@/libs/item";
import { getItemConsumeInput } from "@/libs/itemConsumption";
import { fittingSlots, slotName } from "@/libs/itemsPage";
import {
  auctionListingHref,
  canListAtAuction,
  cardSale,
  hasOtherStack,
  isEarnedKessenPack,
  isKessenGood,
  surplusCopiesLabel,
  surplusStackOf,
} from "@/libs/kessen/cardSale";
import { isKessenPackId } from "@/libs/kessen/packs";
import { hasRequiredLevel } from "@/libs/rank";
import { getRepairKits } from "@/libs/repair";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { remainingXpToLevel } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { parseHtml } from "@/utils/parse";
import type { CardPackReveal } from "@/validators/weightedCache";

// The Kessen card face and its stylesheet load only when a card is inspected.
const CardFace = dynamic(
  () => import("@/layout/kessen/CardFace").then((mod) => mod.CardFace),
  { ssr: false },
);

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
  onPackReveal,
  onInspectStack,
}: ItemInspectorProps) {
  const [isSplitDialogOpen, setIsSplitDialogOpen] = useState<boolean>(false);
  const [quantityToKeep, setQuantityToKeep] = useState<number>(Number.NaN);
  const [isRepairModalOpen, setIsRepairModalOpen] = useState<boolean>(false);
  const [variantItem, setVariantItem] = useState<UserItemWithVariants | undefined>(
    undefined,
  );

  // Separating card surplus keeps the inspector on the stack of deck copies.
  const keepOpenAfterSplit = useRef(false);
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
    onPackReveal,
    onDone: () => {
      setIsSplitDialogOpen(false);
      setQuantityToKeep(Number.NaN);
      setIsRepairModalOpen(false);
      if (keepOpenAfterSplit.current) {
        keepOpenAfterSplit.current = false;
        return;
      }
      onClose();
    },
  });
  // Selling part of a stack splits the rest off first, so the sale keeps this stack's id.
  const {
    keepOnStack,
    isSplitting: isSplittingOff,
    refreshInventory,
  } = useSplitBeforeSale();
  const sellCopies = async (quantity: number) => {
    if (quantity < useritem.quantity) {
      const result = await keepOnStack(useritem.id, quantity);
      if (!result.success) {
        showMutationToast({ ...result, variant: "destructive" });
        return;
      }
    }
    sell(
      { userItemId: useritem.id },
      // The split-off stack is not in the cached inventory yet.
      quantity < useritem.quantity
        ? { onSettled: () => void refreshInventory() }
        : undefined,
    );
  };

  const { data: wardrobe } = api.cosmetic.get.useQuery();
  const selectedCosmetic = wardrobe?.slots.find(
    (entry) => entry.slot === useritem.equipped,
  );
  const { data: availableEvolutions } = api.item.getEvolutions.useQuery(
    { itemId: useritem.itemId },
    { staleTime: 5 * 60 * 1000 },
  );

  const isLoading = isPending || isEquipping || isSplittingOff;
  const isStored = useritem.storedAtHome;

  // Derived
  const structures = userData?.village?.structures;
  const isDropOnly = isDropOnlyItem(useritem.item);
  // Cards and card packs skip equipment controls; cards sell only their surplus copies.
  const isCard = useritem.item.itemType === "CARD";
  const isPack = isKessenPackId(useritem.itemId);
  const isKessen = isKessenGood(useritem.item);
  const isEarnedPack = isEarnedKessenPack(useritem.item);
  const sale = cardSale(useritem, allUserItems ?? []);
  const unsellableReason = isUnsellableCard(useritem.item)
    ? sale?.kind === "unsellable"
      ? sale.detail
      : "cannot be sold or traded"
    : null;
  const canSell =
    !unsellableReason && (!sale || sale.kind === "surplus" || sale.kind === "mixed");
  // How many copies a sale removes: a card stack's surplus, else the whole stack.
  const sellQuantity = sale?.kind === "mixed" ? sale.surplus : useritem.quantity;
  const surplusStack =
    sale?.kind === "kept" && sale.surplusElsewhere
      ? surplusStackOf(useritem, allUserItems ?? [])
      : undefined;
  const cardFace = isCard ? itemCardDisplay(useritem.item) : null;
  const stackLabel =
    sale?.kind === "surplus" || sale?.kind === "mixed"
      ? `${surplusCopiesLabel(sellQuantity)} of ${useritem.item.name}`
      : useritem.quantity > 1
        ? `${useritem.quantity}x ${useritem.item.name}`
        : useritem.item.name;
  const isMeal = useritem.item.itemType === "MEAL";
  const canEatMeal =
    !isLoading && canAttemptAwakeAction(userData) && !userData.battleId;
  const sellPrice = calcItemSellingPrice(
    userData,
    { ...useritem, quantity: sellQuantity },
    structures,
  );
  const packPrice = calcItemSellingPrice(
    userData,
    { ...useritem, quantity: 1 },
    structures,
  );
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
    useritem.item.maxDurability > 0 && !isKessen
      ? Math.round((useritem.durability / useritem.item.maxDurability) * 100)
      : null;
  // Card stacks stay apart once their surplus is separated; packs merge with another stack.
  const canMerge =
    useritem.item.canStack &&
    !isCard &&
    (!isKessen || hasOtherStack(useritem, allUserItems ?? []));
  // Card stacks split only to separate their surplus, offered with the sale below.
  const canSplit =
    useritem.item.canStack &&
    useritem.quantity > 1 &&
    useritem.equipped === "NONE" &&
    !isCard;
  const hasMoreActions =
    cosmeticSlotsForItem(useritem.item).length > 0 ||
    canMerge ||
    canSplit ||
    hasVariants ||
    (availableEvolutions?.length ?? 0) > 0;
  // The card face already carries the flavor line the description repeats.
  const flavor = cardFace?.flavor?.trim();
  const showDescription =
    !!look.description && !(flavor && look.description.includes(flavor));

  return (
    <section
      aria-label={look.name}
      // Touch screens get finger-sized buttons.
      className="flex flex-col gap-3 pointer-coarse:[&_:is(button,a)]:min-h-[40px]"
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
        {cardFace ? (
          // Short landscape screens take a smaller face so the actions show on open.
          <span className={cn("aspect-[5/7] w-[136px] shrink-0", SHORT_SCREEN.face)}>
            <CardFace card={cardFace} renderSize={136} priority className="w-full" />
          </span>
        ) : (
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
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-foreground text-lg">{look.name}</h2>
          <p
            className={cn("text-sm font-medium", rarityTextClass[useritem.item.rarity])}
          >
            {rarityLabel[useritem.item.rarity]}{" "}
            {isCard
              ? cardKindLabel(useritem).toLowerCase()
              : isPack
                ? "card pack"
                : useritem.item.itemType.toLowerCase()}
            {useritem.item.cardData?.variant === "FORBIDDEN" && " · Forbidden"}
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
      {showDescription && (
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
                {isPack ? (
                  <>
                    <PackageOpen className="mr-2 h-5 w-5" aria-hidden />
                    Open pack
                  </>
                ) : (
                  <>
                    <Cookie className="mr-2 h-5 w-5" />
                    Consume
                  </>
                )}
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
              {canMerge && (
                <Button
                  variant="outline"
                  onClick={() => merge({ itemId: useritem.itemId })}
                >
                  <Merge className="mr-2 h-5 w-5" />
                  Merge stacks
                </Button>
              )}
              {canSplit && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsSplitDialogOpen(true);
                    setQuantityToKeep(Number.NaN);
                  }}
                >
                  <Split className="mr-2 h-5 w-5" />
                  Split stack…
                </Button>
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
      {isSplitting && !isSplitDialogOpen && <Loader explanation="Separating" />}
      {isEquipping && <Loader explanation="Equipping" />}
      {isEvolving && <Loader explanation="Evolving" />}
      {isRepairingWithRyo && <Loader explanation="Repairing" />}
      {/* The full stats show straight away; the header above already carries the name and art. */}
      <section
        aria-label="Details"
        className={cn("rounded-lg border bg-card", SHORT_SCREEN.after)}
      >
        <h3 className="px-3 pt-2 font-semibold text-sm">Details</h3>
        <div className="p-2">
          <ItemWithEffects
            item={userItemDisplay(useritem, {
              ...applyActiveVariant(useritem as UserItemWithVariants),
              // The header above already shows the description.
              description: "",
            })}
            key={useritem.id}
            showStatistic={isKessen ? undefined : "item"}
            showEvolutions
            hideTitle
            hideImage
            hideDates
          />
        </div>
      </section>
      {!isLoading &&
        !isStored &&
        !canSell &&
        !isEarnedPack &&
        (unsellableReason || sale) && (
          <div className="flex flex-col gap-2 border-t pt-3 text-muted-foreground text-sm">
            {unsellableReason ? (
              <>
                <p>
                  {useritem.item.name} {unsellableReason}.
                </p>
                {useritem.item.cardData?.kind !== "LEADER" &&
                  canListAtAuction(useritem) && (
                    <Button asChild variant="outline" className="self-start">
                      <Link href={auctionListingHref(useritem.id)}>
                        <Gavel className="mr-2 h-5 w-5" aria-hidden />
                        List at auction…
                      </Link>
                    </Button>
                  )}
              </>
            ) : sale?.kind === "listed" ? (
              <p>This stack is listed in the auction house.</p>
            ) : sale?.kind === "kept" ? (
              sale.surplusElsewhere ? (
                <>
                  <p>
                    These are your deck copies: a deck holds up to {sale.limit}. Your
                    other {surplusCopiesLabel(sale.owned - sale.limit)} are in their own
                    stack.
                  </p>
                  {surplusStack && onInspectStack && (
                    <Button
                      variant="outline"
                      className="self-start"
                      onClick={() => onInspectStack(surplusStack.id)}
                    >
                      Open surplus stack
                    </Button>
                  )}
                </>
              ) : (
                <p>
                  No surplus copy to sell: you own {sale.owned}, and a deck can hold up
                  to {sale.limit}. Copies beyond {sale.limit} can be sold.
                </p>
              )
            ) : null}
          </div>
        )}
      {!isLoading && !isStored && isEarnedPack && (
        <p className="border-t pt-3 text-muted-foreground text-sm">
          {`${useritem.item.name} cannot be ${useritem.item.canBeTraded ? "sold or dropped" : "sold, traded or dropped"}; open it for its cards.`}
        </p>
      )}
      {!isLoading && !isStored && canSell && !isEarnedPack && (
        <div className="flex flex-col gap-2 border-t pt-3">
          {sale?.kind === "mixed" && (
            <p className="text-muted-foreground text-sm">
              {surplusCopiesLabel(sale.surplus)} of this stack{" "}
              {sale.surplus === 1 ? "is" : "are"} beyond the copy limit; the {sale.keep}{" "}
              deck {sale.keep === 1 ? "copy stays" : "copies stay"} in your collection.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {isPack && useritem.quantity > 1 && (
              <SellConfirm
                title="Sell a pack?"
                buttonLabel={`Sell 1 pack · ${Math.floor(packPrice).toLocaleString()} ryo`}
                proceedLabel={`Sell for ${Math.floor(packPrice).toLocaleString()} ryo`}
                isSecondary
                isSelling={isSelling}
                onAccept={() => void sellCopies(1)}
              >
                Sell 1 {useritem.item.name} for {Math.floor(packPrice).toLocaleString()}{" "}
                ryo? This cannot be undone.
              </SellConfirm>
            )}
            {isDropOnly ? (
              <SellConfirm
                id="sell"
                title="Drop item?"
                buttonLabel="Drop Item"
                proceedLabel="Drop item"
                isDrop
                isSelling={isSelling}
                onAccept={() => sell({ userItemId: useritem.id })}
              >
                Drop {stackLabel}? It is removed from your inventory and cannot be
                recovered.
              </SellConfirm>
            ) : (
              <SellConfirm
                id="sell"
                title={sale ? "Sell surplus?" : isPack ? "Sell packs?" : "Sell item?"}
                buttonLabel={
                  sale
                    ? `Sell ${surplusCopiesLabel(sellQuantity)} · ${Math.floor(sellPrice).toLocaleString()} ryo`
                    : isPack
                      ? `Sell ${useritem.quantity === 1 ? "pack" : `all ${useritem.quantity} packs`} · ${Math.floor(sellPrice).toLocaleString()} ryo`
                      : `Sell Item [${Math.floor(sellPrice)} ryo]`
                }
                proceedLabel={`Sell for ${Math.floor(sellPrice).toLocaleString()} ryo`}
                // Opening a pack is its main action; selling sits beside it.
                isSecondary={isPack}
                isSelling={isSelling}
                onAccept={() => void sellCopies(sellQuantity)}
              >
                {sale
                  ? `Sell ${stackLabel} for ${Math.floor(sellPrice).toLocaleString()} ryo? The copies your decks can use stay in your collection. This cannot be undone.`
                  : `Sell ${stackLabel} for ${Math.floor(sellPrice).toLocaleString()} ryo? This cannot be undone.`}
              </SellConfirm>
            )}
            {sale?.kind === "mixed" && (
              <Button
                variant="outline"
                disabled={isSplitting}
                aria-busy={isSplitting}
                onClick={() => {
                  keepOpenAfterSplit.current = true;
                  splitStack({ userItemId: useritem.id, quantityToKeep: sale.keep });
                }}
              >
                <Split className="mr-2 h-5 w-5" aria-hidden />
                {isSplitting ? "Separating" : "Separate surplus"}
              </Button>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {isDropOnly ? "Dropping" : "Selling"} asks for a confirmation
          </span>
        </div>
      )}
      {/* Tradeable cards also go to the auction house, deck copies included. */}
      {!isLoading &&
        !isStored &&
        sale &&
        sale.kind !== "unsellable" &&
        canListAtAuction(useritem) && (
          <Button asChild variant="outline" className="self-start">
            <Link href={auctionListingHref(useritem.id)}>
              <Gavel className="mr-2 h-5 w-5" aria-hidden />
              List at auction…
            </Link>
          </Button>
        )}
      {isSplitDialogOpen && useritem && (
        <Dialog open={isSplitDialogOpen} onOpenChange={setIsSplitDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Split stack</DialogTitle>
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
                {isSplitting ? "Splitting" : "Split stack"}
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

/**
 * Short landscape screens (a phone on its side) open the inspector in a low sheet: a
 * smaller face, and the details after the actions, keep the actions in view on open.
 */
const SHORT_SCREEN = {
  face: "[@media(max-height:500px)_and_(orientation:landscape)]:w-[88px]",
  after: "[@media(max-height:500px)_and_(orientation:landscape)]:order-last",
};

/** A sell or drop button with its confirmation. */
function SellConfirm({
  title,
  buttonLabel,
  proceedLabel,
  isDrop = false,
  isSecondary = false,
  isSelling,
  onAccept,
  children,
  id,
}: {
  title: string;
  buttonLabel: string;
  proceedLabel: string;
  isDrop?: boolean;
  /** Outlined, for goods whose sale is not their main action. */
  isSecondary?: boolean;
  isSelling: boolean;
  onAccept: () => void;
  children: ReactNode;
  /** The main sale button keeps the `sell` id other screens and tests look up. */
  id?: string;
}) {
  const Icon = isDrop ? ArrowDownToLine : CircleDollarSign;
  return (
    <Confirm
      title={title}
      tone="destructive"
      proceed_label={proceedLabel}
      proceed_loading_label={isDrop ? "Dropping" : "Selling"}
      isLoading={isSelling}
      button={
        <Button id={id} variant={isSecondary ? "outline" : "destructive"}>
          <Icon className="mr-2 h-5 w-5" aria-hidden />
          {buttonLabel}
        </Button>
      }
      onAccept={onAccept}
    >
      {children}
    </Confirm>
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
  /** Shows the ceremony of an opened Kessen card pack, which outlives the inspector. */
  onPackReveal?: (reveal: CardPackReveal) => void;
  /** Opens another stack, such as the separated surplus of a card. */
  onInspectStack?: (userItemId: string) => void;
}
