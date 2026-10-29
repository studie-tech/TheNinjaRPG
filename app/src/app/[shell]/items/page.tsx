"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  CircleDollarSign,
  CircleFadingArrowUp,
  Cookie,
  Gem,
  Merge,
  Shirt,
  Split,
  Undo2,
  Wrench,
  Zap,
} from "lucide-react";
import { startTransition, useRef, useState } from "react";
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
import {
  COST_EXTRA_ITEM_SLOT,
  IMG_EQUIP_SILHOUETTE,
  ITEM_LEVEL_CAP,
} from "@/drizzle/constants";
import type {
  Item,
  ItemSlot,
  UserItem,
  UserItemWithRelations,
  UserItemWithVariants,
} from "@/drizzle/schema";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import ContentImage from "@/layout/ContentImage";
import DurabilityBar from "@/layout/DurabilityBar";
import Image from "@/layout/Image";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { MergeAllStacksButton } from "@/layout/MergeAllStacksButton";
import Modal from "@/layout/Modal";
import NavTabs from "@/layout/NavTabs";
import { applyActiveVariant } from "@/libs/combat/util";
import { meetsEvolutionStatRequirements } from "@/libs/evolution";
import {
  byItemName,
  calcItemRepairCost,
  calcItemSellingPrice,
  calcMaxCookingItems,
  calcMaxEventItems,
  calcMaxItems,
  calcMaxMaterials,
  countsTowardInventoryStorage,
  getInventoryBucket,
  isEquippableUserItem,
  nonCombatConsume,
  partitionImbuementsForItemTransfer,
  showsItemLevelBadge,
  userItemActionBadges,
} from "@/libs/item";
import {
  finishItemConsumeRequest,
  getItemConsumeErrorMessage,
  getItemConsumeInput,
} from "@/libs/itemConsumption";
import { gearMissingMastery } from "@/libs/mastery";
import { calculateKitsToUse, getRepairKits, needsInventoryRepair } from "@/libs/repair";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import { showMutationToast, showRewardToast } from "@/libs/toast";
import { hasRequiredLevel, remainingXpToLevel } from "@/libs/train";
import { getVillageLoyaltyShopCost } from "@/libs/villageLoyalty";
import type { UserWithRelations } from "@/routers/profile";
import { useRequiredUserData } from "@/utils/UserContext";
import { displayCostType } from "@/validators/item";

/** Carried inventory, equipment loadouts, and item actions across capacity buckets. */
export default function MyItems() {
  // State
  const availableTabs = ["normal", "event", "materials", "cooking"];
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
    timeDiff,
  } = useRequiredUserData();
  const [activeTab, setActiveTab] = useState<(typeof availableTabs)[number]>("normal");
  const [isBuyItemSlotOpen, setIsBuyItemSlotOpen] = useState(false);
  const buyItemSlotInFlight = useRef(false);

  // tRPC utils
  const utils = api.useUtils();

  // Data from DB
  const {
    data: userItems,
    dataUpdatedAt,
    isPending: isLoadingItems,
    isFetching,
  } = api.item.getUserItemsWithVariants.useQuery(undefined, {
    enabled: !!userData,
    // Items are granted by many flows (quests, battles, queued jobs, other players' trades)
    // that cannot all invalidate this cache, so re-read the inventory on every visit.
    refetchOnMount: "always",
  });

  // A deadline must refresh the query timestamp even when the inventory rows are unchanged.
  // Render-time Date reads alone can be memoized by React Compiler.
  useRefreshAt(
    userItems?.flatMap((item) => [
      item.craftingFinishedAt,
      ...item.imbuements.map((imbuement) => imbuement.craftingFinishedAt),
    ]) ?? [],
    () => {
      void utils.item.getUserItemsWithVariants.invalidate();
    },
    timeDiff,
  );
  const inventoryTime = new Date(dataUpdatedAt - (timeDiff ?? 0));

  // Mutations
  const { mutate: buyItemSlot, isPending: isBuyingItemSlot } =
    api.blackmarket.buyItemSlot.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser(undefined, { revision, delta: data.userDelta });
          setIsBuyItemSlotOpen(false);
        }
      },
      onError: (error) => {
        showMutationToast({
          success: false,
          message: error.message,
          variant: "destructive",
        });
      },
      onSettled: () => {
        buyItemSlotInFlight.current = false;
      },
    });

  const { mutate: autoEquipOptimal, isPending: isAutoEquipping } =
    api.item.autoEquipOptimal.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            utils.item.getUserItems.invalidate(),
          ]);
        }
      },
    });

  const { mutate: mutateRepairAll, isPending: isRepairingAll } =
    repairAllWithKits.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            updateUser(data.userPatch, { revision, delta: data.userDelta }),
          ]);
        }
      },
    });

  const { mutate: mutateRepairAllRyo, isPending: isRepairingAllRyo } =
    api.item.repairAll.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            updateUser(data.userPatch, { revision, delta: data.userDelta }),
          ]);
        }
      },
    });

  const { mutate: unequipAllItems, isPending: isUnequippingAll } =
    api.item.unequipAllItems.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (!data.success) return;
        await Promise.all([
          utils.item.getUserItemsWithVariants.invalidate(),
          utils.item.getUserItems.invalidate(),
          updateUser(data.userPatch, { revision, delta: data.userDelta }),
          utils.item.getItemLoadouts.invalidate(),
        ]);
      },
      onError: (error) => {
        showMutationToast({
          success: false,
          message: error.message,
          variant: "destructive",
        });
      },
    });

  // Subtitle
  const availableItems = userItems
    ?.filter((ui) => isEquippableUserItem(ui, inventoryTime))
    .map((ui) => ({
      ...ui,
      imbuements: ui.imbuements.filter(
        (i) => !i.craftingFinishedAt || i.craftingFinishedAt < inventoryTime,
      ),
    }));
  const normalItems = availableItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "normal",
  );
  const eventItems = availableItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "event",
  );
  const materialsItems = availableItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "materials",
  );
  const cookingItems = availableItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "cooking",
  );

  // Capacity includes unfinished crafts even though they are absent from the
  // usable-item list. Share the storage rule with server-side capacity guards.
  const carriedItems = userItems?.filter(countsTowardInventoryStorage);
  const normalItemCount = carriedItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "normal",
  ).length;
  const eventItemCount = carriedItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "event",
  ).length;
  const materialsItemCount = carriedItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "materials",
  ).length;
  const cookingItemCount = carriedItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "cooking",
  ).length;

  // Calculate inventory limits
  const maxNormalItems = userData ? calcMaxItems(userData) : 0;
  const maxEventItems = userData ? calcMaxEventItems(userData) : 0;
  const maxMaterials = userData ? calcMaxMaterials(userData) : 0;
  const maxCookingItems = userData ? calcMaxCookingItems(userData) : 0;

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isLoadingItems) return <Loader explanation="Loading items" />;

  // Can afford removing
  const canAfford = userData.reputationPoints >= COST_EXTRA_ITEM_SLOT;

  // Calculate items needing repair and which kits will be used
  const itemsNeedingRepair = (userItems || []).filter(needsInventoryRepair);
  const repairKits = getRepairKits(userItems, userData ?? {});
  const isCrafter = userData.occupation === "CRAFTING";
  const totalRyoRepairCost = itemsNeedingRepair.reduce(
    (total, useritem) => total + calcItemRepairCost(useritem),
    0,
  );
  const canAffordRyoRepair = userData.money >= totalRyoRepairCost;
  const isRepairAllPending = isRepairingAll || isRepairingAllRyo;

  // Calculate which kits will be used (shared with item.useRepairAll)
  const repairKitCalculation = calculateKitsToUse(
    itemsNeedingRepair,
    repairKits,
    userItems,
  );

  const repairAllInfo = repairKitCalculation;
  const canRepairWithKits = repairKits.length > 0 && repairAllInfo.canRepairAll;

  return (
    <>
      <ContentBox
        title="Items"
        subtitle={
          activeTab === "normal"
            ? `${normalItemCount}/${maxNormalItems} slots`
            : activeTab === "event"
              ? `${eventItemCount}/${maxEventItems} slots`
              : activeTab === "materials"
                ? `${materialsItemCount}/${maxMaterials} slots`
                : `${cookingItemCount}/${maxCookingItems} slots`
        }
        padding={false}
        topRightContent={
          <div className="flex flex-row items-center gap-1">
            <NavTabs
              id="backpackSelection"
              current={activeTab}
              options={availableTabs}
              setValue={setActiveTab}
              itemClassName={() => "mr-1 last:mr-0"}
              className="text-xs sm:text-sm"
            />
            <Button
              animation="pulse"
              size="icon"
              aria-label="Purchase an extra item slot"
              aria-busy={isBuyingItemSlot}
              disabled={isBuyingItemSlot}
              loading={isBuyingItemSlot}
              onClick={() => setIsBuyItemSlotOpen(true)}
            >
              <CircleFadingArrowUp className="h-6 w-6" />
            </Button>
            <Dialog
              open={isBuyItemSlotOpen}
              onOpenChange={(open) => {
                if (!isBuyingItemSlot) setIsBuyItemSlotOpen(open);
              }}
            >
              <DialogContent
                aria-busy={isBuyingItemSlot}
                onEscapeKeyDown={(event) => {
                  if (isBuyingItemSlot) event.preventDefault();
                }}
                onInteractOutside={(event) => {
                  if (isBuyingItemSlot) event.preventDefault();
                }}
              >
                <DialogHeader>
                  <DialogTitle>Extra Item Slot</DialogTitle>
                  <DialogDescription>
                    Purchase an extra item slot for {COST_EXTRA_ITEM_SLOT} reputation
                    points. You currently have {userData.reputationPoints} reputation{" "}
                    {userData.reputationPoints === 1 ? "point" : "points"}.
                  </DialogDescription>
                </DialogHeader>
                <div className="min-h-8" aria-live="polite" aria-atomic="true">
                  {isBuyingItemSlot ? (
                    <Loader explanation="Purchasing" noPadding />
                  ) : canAfford ? (
                    <p>Are you sure you want to complete this purchase?</p>
                  ) : (
                    <p>
                      You need {COST_EXTRA_ITEM_SLOT - userData.reputationPoints} more
                      reputation points.
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    disabled={!canAfford || isBuyingItemSlot}
                    aria-busy={isBuyingItemSlot}
                    loading={isBuyingItemSlot}
                    onClick={() => {
                      if (!canAfford || buyItemSlotInFlight.current) return;
                      buyItemSlotInFlight.current = true;
                      buyItemSlot();
                    }}
                  >
                    {isBuyingItemSlot
                      ? "Purchasing"
                      : canAfford
                        ? `Purchase for ${COST_EXTRA_ITEM_SLOT} reps`
                        : `Need ${COST_EXTRA_ITEM_SLOT - userData.reputationPoints} more reps`}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={isBuyingItemSlot}
                    onClick={() => setIsBuyItemSlotOpen(false)}
                  >
                    Cancel
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      >
        {isFetching && <Loader explanation="Refreshing items" />}
        {/* Wait for the updated equipment state before accepting another toggle. */}
        <div className="@container" inert={isFetching}>
          {/* Keep equipment near its silhouette width while the backpack gains columns. */}
          <div className="grid @min-[600px]:grid-cols-[314px_minmax(0,1fr)]">
            <div className="min-w-0 p-3">
              <h2 className="font-bold text-2xl text-foreground">Equipped</h2>
              <div className="relative mx-auto w-full max-w-[290px]">
                <Character useritems={userItems} userData={userData} />
              </div>
            </div>
            <div className="bg-poppopover min-w-0 overflow-y-auto border-t-2 border-dashed p-3 @min-[600px]:max-h-[600px] @min-[600px]:border-t-0 @min-[600px]:border-l-2">
              <h2 className="mb-2 font-bold text-2xl text-foreground">Backpack</h2>
              <Backpack
                userData={userData}
                useritems={
                  activeTab === "normal"
                    ? normalItems?.filter((ui) => ui.equipped === "NONE")
                    : activeTab === "event"
                      ? eventItems?.filter((ui) => ui.equipped === "NONE")
                      : activeTab === "materials"
                        ? materialsItems?.filter((ui) => ui.equipped === "NONE")
                        : cookingItems?.filter((ui) => ui.equipped === "NONE")
                }
                allUserItems={userItems}
              />
            </div>
          </div>
        </div>
      </ContentBox>
      <div className="mt-1 flex w-full items-center gap-1">
        <div className="min-w-0 flex-1">
          <ItemLoadoutSelector size="small" compact />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Confirm
            title="Unequip all items"
            proceed_label={isUnequippingAll ? undefined : "Unequip all"}
            isValid={!isUnequippingAll}
            disabled={isUnequippingAll}
            button={
              <Button
                disabled={isUnequippingAll}
                aria-busy={isUnequippingAll}
                aria-label={
                  isUnequippingAll ? "Unequipping all items" : "Unequip all items"
                }
                hoverText="Unequip all items"
                variant="outline"
                size="sm"
                type="button"
                className="h-8 w-8 px-0 sm:w-auto sm:gap-1.5 sm:px-2"
              >
                <Undo2 className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {isUnequippingAll ? "Unequipping" : "Unequip"}
                </span>
              </Button>
            }
            onAccept={(e) => {
              e.preventDefault();
              unequipAllItems();
            }}
          >
            <p>
              Remove every equipped item from your character and clear equipment on your
              current item loadout. Your loadout slot selection stays the same.
            </p>
          </Confirm>
          <MergeAllStacksButton storedAtHome={false} compact />
          {itemsNeedingRepair.length > 0 && (repairKits.length > 0 || isCrafter) && (
            <Confirm
              title="Repair All Items"
              proceed_label={
                canRepairWithKits && !isRepairAllPending ? "Repair with Kits" : null
              }
              isValid={canRepairWithKits && !isRepairAllPending}
              disabled={isRepairAllPending}
              button={
                <Button
                  disabled={isRepairAllPending}
                  aria-busy={isRepairAllPending}
                  aria-label={
                    isRepairAllPending ? "Repairing all items" : "Repair all items"
                  }
                  hoverText="Repair all items"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 px-0 sm:w-auto sm:gap-1.5 sm:px-2"
                >
                  <Wrench className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {isRepairAllPending ? "Repairing" : "Repair"}
                  </span>
                </Button>
              }
              onAccept={(e) => {
                e.preventDefault();
                if (canRepairWithKits) {
                  mutateRepairAll();
                }
              }}
              footerExtra={
                isCrafter
                  ? ({ close }) => (
                      <Button
                        variant="default"
                        disabled={!canAffordRyoRepair || isRepairAllPending}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          mutateRepairAllRyo();
                          close();
                        }}
                      >
                        <CircleDollarSign className="mr-2 h-4 w-4" />
                        Repair with Ryo ({totalRyoRepairCost.toLocaleString()})
                      </Button>
                    )
                  : undefined
              }
            >
              <div className="space-y-3">
                {repairKits.length > 0 ? (
                  canRepairWithKits ? (
                    <>
                      <p>
                        You are about to repair all {itemsNeedingRepair.length} item
                        {itemsNeedingRepair.length !== 1 ? "s" : ""} using repair kits.
                      </p>
                      {repairAllInfo.kitsToUse.length > 0 && (
                        <div>
                          <p className="mb-2 font-semibold">Repair kits to be used:</p>
                          <div className="space-y-1">
                            {repairAllInfo.kitsToUse.map((kit) => (
                              <div
                                key={kit.repairItemId}
                                className="flex items-center justify-between text-sm"
                              >
                                <span>{kit.repairItemName}</span>
                                <span className="font-medium">x{kit.quantityUsed}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      <p className="mb-2 font-semibold text-red-600">
                        Not enough repair kits
                      </p>
                      <p className="text-muted-foreground text-sm">
                        You have {itemsNeedingRepair.length} damaged item
                        {itemsNeedingRepair.length !== 1 ? "s" : ""} that need
                        {itemsNeedingRepair.length === 1 ? "s" : ""}{" "}
                        {repairAllInfo.totalDurabilityNeeded} total durability, but you
                        don&apos;t have enough repair kits to repair all of them.
                      </p>
                    </div>
                  )
                ) : (
                  <p className="text-muted-foreground text-sm">
                    You don&apos;t have any repair kits. As a crafter, you can repair
                    with ryo instead.
                  </p>
                )}
                {isCrafter && (
                  <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                    <p className="font-semibold">Repair with ryo</p>
                    <p className="text-muted-foreground">
                      Total cost:{" "}
                      <span
                        className={
                          canAffordRyoRepair ? "text-green-600" : "text-red-600"
                        }
                      >
                        {totalRyoRepairCost.toLocaleString()} ryo
                      </span>
                      {!canAffordRyoRepair && (
                        <span className="ml-2">
                          (You have {userData.money.toLocaleString()} ryo)
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </Confirm>
          )}
          <Confirm
            title="Auto Equip"
            proceed_label={isAutoEquipping ? undefined : "Auto equip"}
            isValid={!isAutoEquipping}
            disabled={isAutoEquipping}
            button={
              <Button
                disabled={isAutoEquipping}
                aria-busy={isAutoEquipping}
                variant="default"
                size="sm"
                className="gap-1.5 px-2"
              >
                <Zap className="h-4 w-4" />
                {isAutoEquipping ? "Equipping" : "Auto equip"}
              </Button>
            }
            onAccept={(e) => {
              e.preventDefault();
              autoEquipOptimal();
            }}
          >
            <p>
              Equip the best available items from your backpack into your equipment
              slots?
            </p>
          </Confirm>
        </div>
      </div>
    </>
  );
}

/**
 * Repair Item Selection Modal Component
 */
type SetIsOpenType = React.Dispatch<React.SetStateAction<boolean>>;

interface RepairItemModalProps {
  isOpen: boolean;
  setIsOpen: SetIsOpenType;
  targetItem: UserItemWithRelations;
  repairItems: UserItemWithRelations[];
  onSelectRepairItem: (repairItemId: string, targetItemId: string) => void;
  isPending?: boolean;
}

function RepairItemSelectionModal({
  isOpen,
  setIsOpen,
  targetItem,
  repairItems,
  onSelectRepairItem,
  isPending = false,
}: RepairItemModalProps) {
  if (!isOpen || !targetItem) return null;

  return (
    <Modal
      title="Select Repair Item"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      isValid={false}
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-muted-foreground text-sm">
            Repairing: <strong>{targetItem.item.name}</strong>
          </p>
          <p className="text-muted-foreground text-sm">
            Durability: {targetItem.durability} / {targetItem.item.maxDurability}
          </p>
        </div>
        {repairItems.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You don&apos;t have any repair items in your inventory.
          </p>
        ) : (
          <div className="space-y-3">
            {repairItems.map((repairItem) => {
              const repairEffect = repairItem.item.effects.find(
                (e) => e.type === "repair",
              );
              const repairAmount = Math.floor(repairEffect?.power || 0);
              const newDurability = Math.min(
                targetItem.durability + repairAmount,
                targetItem.item.maxDurability,
              );
              const actualRepair = newDurability - targetItem.durability;
              return (
                <button
                  type="button"
                  key={repairItem.id}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${isPending ? "cursor-not-allowed bg-slate-50 opacity-50" : "cursor-pointer hover:bg-slate-100"}`}
                  disabled={isPending}
                  onClick={() => {
                    if (!isPending) {
                      onSelectRepairItem(repairItem.id, targetItem.id);
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    <ContentImage
                      image={repairItem.item.image}
                      alt={repairItem.item.name}
                      className="h-12 w-12"
                    />
                    <div className="flex-1">
                      <h4 className="font-semibold">{repairItem.item.name}</h4>
                      <p className="text-muted-foreground text-sm">
                        Quantity: {repairItem.quantity}
                      </p>
                    </div>
                    <div className="text-right">
                      {isPending ? (
                        <p className="font-medium text-muted-foreground text-sm">
                          Repairing
                        </p>
                      ) : (
                        <>
                          <p className="font-medium text-green-600 text-sm">
                            +{actualRepair} Durability
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {targetItem.durability} → {newDurability} /{" "}
                            {targetItem.item.maxDurability}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Shared Repair Modal Wrapper Component
 * Handles the repair item selection modal with mutation logic
 */
interface RepairModalWrapperProps {
  useritem: UserItemWithRelations | undefined;
  repairItems: UserItemWithRelations[];
  isRepairModalOpen: boolean;
  setIsRepairModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onRepairItem: (params: { repairItemId: string; targetItemId: string }) => void;
  isPending?: boolean;
}

function RepairModalWrapper({
  useritem,
  repairItems,
  isRepairModalOpen,
  setIsRepairModalOpen,
  onRepairItem,
  isPending = false,
}: RepairModalWrapperProps) {
  if (!useritem) return null;

  return (
    <RepairItemSelectionModal
      isOpen={isRepairModalOpen}
      setIsOpen={setIsRepairModalOpen}
      targetItem={useritem}
      repairItems={repairItems}
      onSelectRepairItem={(repairItemId, targetItemId) => {
        onRepairItem({
          repairItemId,
          targetItemId,
        });
      }}
      isPending={isPending}
    />
  );
}

/**
 * Shared per-item durability repair actions (kit + ryo).
 * Used by both Backpack and Character item-details modals.
 */
interface ItemDurabilityRepairActionsProps {
  useritem: UserItemWithRelations;
  userData: NonNullable<UserWithRelations>;
  repairItemsCount: number;
  onOpenRepairModal: () => void;
  onRepairWithRyo: (userItemId: string) => void;
  isRepairingWithRyo?: boolean;
}

function ItemDurabilityRepairActions({
  useritem,
  userData,
  repairItemsCount,
  onOpenRepairModal,
  onRepairWithRyo,
  isRepairingWithRyo = false,
}: ItemDurabilityRepairActionsProps) {
  if (
    useritem.item.itemType === "FURNITURE" ||
    useritem.durability >= useritem.item.maxDurability ||
    useritem.item.maxDurability <= 0
  ) {
    return null;
  }

  const isCrafter = userData.occupation === "CRAFTING";
  const ryoRepairCost = calcItemRepairCost(useritem);
  const canAffordItemRyoRepair = userData.money >= ryoRepairCost;

  return (
    <>
      <Button
        variant="outline"
        onClick={onOpenRepairModal}
        disabled={repairItemsCount === 0}
      >
        <Wrench className="mr-2 h-5 w-5" />
        Use Repair Item
      </Button>
      {isCrafter && (
        <Confirm
          title="Repair with Ryo"
          proceed_label={
            canAffordItemRyoRepair && !isRepairingWithRyo
              ? `Repair for ${ryoRepairCost.toLocaleString()} ryo`
              : null
          }
          isValid={canAffordItemRyoRepair && !isRepairingWithRyo}
          button={
            <Button variant="outline" disabled={isRepairingWithRyo}>
              <CircleDollarSign className="mr-2 h-5 w-5" />
              Repair with Ryo
            </Button>
          }
          onAccept={(e) => {
            e.preventDefault();
            onRepairWithRyo(useritem.id);
          }}
        >
          <p>
            Repair <strong>{useritem.item.name}</strong> for{" "}
            <strong>{ryoRepairCost.toLocaleString()} ryo</strong>?
            {!canAffordItemRyoRepair && (
              <span className="mt-2 block text-red-600">
                You only have {userData.money.toLocaleString()} ryo.
              </span>
            )}
          </p>
        </Confirm>
      )}
    </>
  );
}

/**
 * Backpack Screen
 */
interface BackpackProps {
  useritems: UserItemWithRelations[] | undefined;
  // Full carried inventory (all tabs + equipped slots). Used for variant-token
  // lookups so a token held in another tab or an equipped slot is still found.
  allUserItems: UserItemWithRelations[] | undefined;
  userData: NonNullable<UserWithRelations>;
}

const Backpack: React.FC<BackpackProps> = (props) => {
  // Destructure
  const { useritems, allUserItems, userData } = props;
  const { prepareUserUpdate, updateUser } = useRequiredUserData();

  // State
  const [useritem, setUserItem] = useState<UserItemWithRelations | undefined>(
    undefined,
  );
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isSplitDialogOpen, setIsSplitDialogOpen] = useState<boolean>(false);
  const [quantityToKeep, setQuantityToKeep] = useState<number>(Number.NaN);
  const [isRepairModalOpen, setIsRepairModalOpen] = useState<boolean>(false);
  const [variantItem, setVariantItem] = useState<UserItemWithVariants | undefined>(
    undefined,
  );

  // tRPC utility
  const utils = api.useUtils();

  // Handler for when mutations are settled
  const onSettled = () => {
    document.body.style.cursor = "default";
    setIsOpen(false);
    setUserItem(undefined);
  };

  // Mutations
  const { mutate: merge, isPending: isMerging } = api.item.mergeStacks.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await utils.item.getUserItemsWithVariants.invalidate();
    },
    onSettled,
  });

  const { mutate: consume, isPending: isConsuming } = api.item.consume.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, variables, revision) => {
      finishItemConsumeRequest(userData?.userId ?? "", variables.userItemId);
      if (data.success && "rewards" in data && data.rewards) {
        showRewardToast(
          data.notifications ?? [],
          data.rewards,
          data.message,
          false,
          undefined,
          undefined,
          data.cacheRewards,
          data.petRewards,
        );
      } else {
        let message = data.message || "Consume failed";
        if ("notifications" in data && data.notifications) {
          for (const notification of data.notifications || []) {
            message += `\n${notification}`;
          }
        }
        showMutationToast({ success: data.success, message });
      }
      if (data.success) {
        // The action is complete; keep reconciliation off the dialog's pending path.
        void Promise.allSettled([
          updateUser(data.userPatch, {
            revision,
            delta: data.userDelta,
            achievementProgress: data.achievementProgress,
          }),
          utils.item.getUserItemsWithVariants.invalidate(),
          utils.bloodline.getItemRolls.invalidate(),
          utils.raids.getUserRaidBuffs.invalidate(),
          ...("petRewards" in data && data.petRewards?.length
            ? [utils.pets.getPet.invalidate()]
            : []),
        ]);
      } else if (useritem?.item.itemType === "MEAL") {
        // A rejected snapshot must refresh the next modal's quantity and account state.
        await Promise.all([
          utils.profile.getUser.invalidate(),
          utils.item.getUserItemsWithVariants.invalidate(),
        ]);
      }
    },
    onError: (error) => {
      const message = getItemConsumeErrorMessage(error, useritem?.item);
      if (message) showMutationToast({ success: false, message });
    },
    onSettled,
  });

  const { mutate: sell, isPending: isSelling } = api.item.sellUserItem.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.item.getUserItemsWithVariants.invalidate(),
          utils.item.getUserItems.invalidate(),
        ]);
      }
    },
    onSettled,
  });

  const { mutate: equip, isPending: isEquipping } = api.item.toggleEquip.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void Promise.allSettled([
          utils.item.getUserItemsWithVariants.invalidate(),
          utils.item.getUserItems.invalidate(),
        ]);
      }
    },
    onSettled,
  });

  const { mutate: splitStack, isPending: isSplitting } =
    api.item.splitStack.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.item.getUserItemsWithVariants.invalidate();
          setIsSplitDialogOpen(false);
          setQuantityToKeep(Number.NaN);
        }
      },
      onSettled,
    });

  const { mutate: mutateRepairItem, isPending: isUsingRepairItem } =
    repairWithKit.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          setIsRepairModalOpen(false);
          setIsOpen(false);
          setUserItem(undefined);
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            updateUser(data.userPatch, { revision, delta: data.userDelta }),
          ]);
        }
      },
    });

  const { mutate: mutateRepairWithRyo, isPending: isRepairingWithRyo } =
    api.item.repair.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          onSettled();
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            updateUser(data.userPatch, { revision, delta: data.userDelta }),
          ]);
        }
      },
    });

  const { mutate: evolveItem, isPending: isEvolving } = api.item.evolveItem.useMutation(
    {
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            utils.item.getEvolutions.invalidate(),
            utils.item.getItemLoadouts.invalidate(),
          ]);
        }
      },
      onSettled,
    },
  );

  const { mutate: removeImbuement, isPending: isRemovingImbuement } =
    api.occupation.removeImbuement.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.item.getUserItemsWithVariants.invalidate();
        }
      },
      onSettled,
    });

  const { data: availableEvolutions } = api.item.getEvolutions.useQuery(
    { itemId: useritem?.itemId ?? "" },
    { enabled: !!useritem?.itemId && isOpen, staleTime: 5 * 60 * 1000 },
  );

  // Derived
  const structures = userData?.village?.structures;
  const isLoading =
    isMerging ||
    isConsuming ||
    isSelling ||
    isEquipping ||
    isSplitting ||
    isUsingRepairItem ||
    isEvolving ||
    isRemovingImbuement ||
    isRepairingWithRyo;
  const isMeal = useritem?.item.itemType === "MEAL";
  const canEatMeal = !isLoading && userData.status === "AWAKE" && !userData.battleId;
  const items = useritems
    ?.map((useritem) => ({
      ...applyActiveVariant(useritem as UserItemWithVariants),
      ...useritem,
    }))
    .sort(byItemName);
  const itemBadges = userItemActionBadges(useritems);
  const sellPrice = calcItemSellingPrice(userData, useritem, structures);
  const repairItems = getRepairKits(useritems, userData).map(
    ({ userItem }) => userItem,
  );

  // Split stack handler
  const handleSplitStack = () => {
    if (!useritem) return;
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

  return (
    <>
      {/* Match equipment's pixel sizing across theme and user font scales. */}
      <ActionSelector
        className="pt-3"
        gridClassNameOverwrite="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))]"
        items={items}
        counts={itemBadges.counts}
        levels={itemBadges.levels}
        selectedId={useritem?.id}
        showBgColor={false}
        showLabels={false}
        onClick={(id) => {
          // Restyles every tile and mounts the modal; kept off the tap's next paint.
          startTransition(() => {
            if (id === useritem?.id) {
              setUserItem(undefined);
              setIsOpen(false);
            } else {
              setUserItem(items?.find((item) => item.id === id));
              setIsOpen(true);
            }
          });
        }}
      />
      {isOpen && useritem && (
        <Modal
          title="Item Details"
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          isValid={false}
          isLoading={isMeal && isLoading}
          footerClassName={
            isMeal
              ? "flex-row items-center justify-between gap-2 sm:justify-between"
              : undefined
          }
          footerExtra={
            // Explain replacement when confirming a meal, keeping inventory controls compact.
            isMeal && (
              <Confirm
                title={`Eat ${useritem.item.name}?`}
                proceed_label="Eat meal"
                proceed_loading_label="Eating…"
                disabled={isLoading}
                confirmDisabled={!canEatMeal}
                isLoading={isConsuming}
                keepOpenOnAccept
                button={
                  <Button variant="info" disabled={isLoading}>
                    <Cookie className="mr-2 h-5 w-5" />
                    Eat meal
                  </Button>
                }
                onAccept={() =>
                  consume(getItemConsumeInput(userData?.userId ?? "", useritem))
                }
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
            )
          }
        >
          <div>
            {showsItemLevelBadge(useritem.item) && useritem.level < ITEM_LEVEL_CAP && (
              <p>
                - Need{" "}
                {remainingXpToLevel(useritem.item.xpToLevel, useritem.experience)} XP
                more to level
              </p>
            )}
          </div>
          <ItemWithEffects
            item={{
              ...applyActiveVariant(useritem as UserItemWithVariants),
              imbuements: useritem.imbuements.map((imbuement) => imbuement.item),
              curDurability: useritem.durability,
              level: useritem.level,
              experience: useritem.experience,
            }}
            key={useritem.id}
            showStatistic="item"
            showEvolutions
          />
          {!useritem.item.canBeImbued &&
            useritem.equipped === "NONE" &&
            useritem.imbuements.some(
              (imbuement) =>
                !imbuement.craftingFinishedAt ||
                new Date(imbuement.craftingFinishedAt) <= new Date(),
            ) && (
              <div className="mb-2 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-destructive text-sm">
                  Imbuing is disabled on this item. Remove imbuements to return the
                  crystals to your inventory.
                </p>
                {useritem.imbuements
                  .filter(
                    (imbuement) =>
                      !imbuement.craftingFinishedAt ||
                      new Date(imbuement.craftingFinishedAt) <= new Date(),
                  )
                  .map((imbuement) => (
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
                        Remove <b>{imbuement.item.name}</b> from{" "}
                        <b>{useritem.item.name}</b>? The crystal will be returned to
                        your inventory.
                      </p>
                    </Confirm>
                  ))}
              </div>
            )}
          {!isLoading && (
            <div className="flex flex-row flex-wrap items-center gap-2">
              {useritem.equipped === "NONE" &&
                useritem.item.itemType !== "FURNITURE" &&
                useritem.item.itemType !== "MEAL" && (
                  <Button
                    variant="info"
                    onClick={() => equip({ userItemId: useritem.id })}
                  >
                    <Shirt className="mr-2 h-5 w-5" />
                    Equip
                  </Button>
                )}
              {useritem.item.canStack && (
                <>
                  <Button
                    variant={isMeal ? "outline" : "info"}
                    onClick={() => merge({ itemId: useritem.itemId })}
                  >
                    <Merge className="mr-2 h-5 w-5" />
                    Merge Stacks
                  </Button>
                  {useritem.quantity > 1 && (
                    <Button
                      variant={isMeal ? "outline" : "info"}
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
              {!isMeal && nonCombatConsume(useritem.item, userData) && (
                <Button
                  variant="info"
                  disabled={isConsuming}
                  onClick={() =>
                    consume(getItemConsumeInput(userData?.userId ?? "", useritem))
                  }
                >
                  <Cookie className="mr-2 h-5 w-5" />
                  Consume
                </Button>
              )}
              <ItemDurabilityRepairActions
                useritem={useritem}
                userData={userData}
                repairItemsCount={repairItems.length}
                onOpenRepairModal={() => setIsRepairModalOpen(true)}
                onRepairWithRyo={(userItemId) => mutateRepairWithRyo({ userItemId })}
                isRepairingWithRyo={isRepairingWithRyo}
              />
              {((useritem as UserItemWithVariants).item.variants?.length ?? 0) > 0 && (
                <Button
                  variant="info"
                  onClick={() => {
                    const withVariants = useritem as UserItemWithVariants;
                    if (withVariants.item.variants?.length) {
                      setVariantItem(withVariants);
                    }
                  }}
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
                  userData.status === "AWAKE" &&
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
                    {userData.status !== "AWAKE" && (
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
              <div className="grow"></div>
              <Confirm
                title="Security Confirmation"
                proceed_label="Submit"
                button={
                  useritem.item.isEventItem || !useritem.item.inShop ? (
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
                Are you absolutely sure you wish to remove this item from your
                inventory?
              </Confirm>
            </div>
          )}
          {isMerging && <Loader explanation="Merging" />}
          {isConsuming && <Loader explanation="Using" />}
          {isSelling && <Loader explanation="Selling" />}
          {isEquipping && <Loader explanation="Equipping" />}
          {isEvolving && <Loader explanation="Evolving" />}
          {isRepairingWithRyo && <Loader explanation="Repairing" />}
        </Modal>
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
      <RepairModalWrapper
        useritem={useritem}
        repairItems={repairItems}
        isRepairModalOpen={isRepairModalOpen}
        setIsRepairModalOpen={setIsRepairModalOpen}
        onRepairItem={mutateRepairItem}
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
    </>
  );
};

/**
 * Character Equip Screen
 */
interface CharacterProps {
  useritems: UserItemWithRelations[] | undefined;
  userData: NonNullable<UserWithRelations>;
}

const Character: React.FC<CharacterProps> = (props) => {
  // Set state
  const { useritems, userData } = props;
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const [slot, setSlot] = useState<ItemSlot | undefined>(undefined);
  const [useritem, setUserItem] = useState<UserItemWithRelations | undefined>(
    undefined,
  );
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [showItemDetails, setShowItemDetails] = useState<boolean>(false);
  const [isRepairModalOpen, setIsRepairModalOpen] = useState<boolean>(false);
  const [variantItem, setVariantItem] = useState<UserItemWithVariants | undefined>(
    undefined,
  );

  // Battles unequip worn gear and hide weapons whose mastery gate is unmet; activated
  // skills count toward masteries as they do there
  const wearer = {
    ...userData,
    items: useritems ?? [],
  };
  const masteryWarning = (useritem: UserItemWithRelations) => {
    if (useritem.equipped === "NONE") return undefined;
    if (!hasRequiredSkill(useritem.item, wearer))
      return "Unusable in battle: activate the required skill";
    const missing = gearMissingMastery(useritem, wearer);
    if (!missing) return undefined;
    const current = Math.floor(missing.current).toLocaleString();
    return `Unusable in battle: requires ${missing.required.toLocaleString()} ${missing.label} (you have ${current})`;
  };
  const selectedMasteryWarning = useritem ? masteryWarning(useritem) : undefined;

  // Collapse UserItem and Item
  const items = useritems
    ?.map((useritem) => ({
      ...applyActiveVariant(useritem as UserItemWithVariants),
      ...useritem,
      masteryWarning: masteryWarning(useritem),
    }))
    .sort(byItemName);
  const itemBadges = userItemActionBadges(useritems);
  const equipped = items?.find((item) => item.equipped === slot);
  const repairItems = getRepairKits(useritems, userData).map(
    ({ userItem }) => userItem,
  );

  // tRPC utility
  const utils = api.useUtils();

  // Open modal for equipping
  const act = (slot: ItemSlot) => {
    setSlot(slot);
    const equippedItem = items?.find((it) => it.equipped === slot);
    if (equippedItem) {
      setUserItem(equippedItem);
      setShowItemDetails(true);
    } else {
      setIsOpen(true);
    }
  };

  // Mutations
  const { mutate: equip, isPending: isEquipping } = api.item.toggleEquip.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void Promise.allSettled([
          utils.item.getUserItemsWithVariants.invalidate(),
          utils.item.getUserItems.invalidate(),
        ]);
      }
    },
    onSettled: () => {
      document.body.style.cursor = "default";
      setIsOpen(false);
      setShowItemDetails(false);
      setUserItem(undefined);
    },
  });

  const { mutate: mutateRepairItem, isPending: isUsingRepairItem } =
    repairWithKit.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          setIsRepairModalOpen(false);
          setShowItemDetails(false);
          setUserItem(undefined);
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            updateUser(data.userPatch, { revision, delta: data.userDelta }),
          ]);
        }
      },
    });

  const { mutate: mutateRepairWithRyo, isPending: isRepairingWithRyo } =
    api.item.repair.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          setShowItemDetails(false);
          setUserItem(undefined);
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            updateUser(data.userPatch, { revision, delta: data.userDelta }),
          ]);
        }
      },
    });

  // Placement of equip boxes
  const l = "left-[10%] ";
  const r = "right-[10%] ";
  const t1 = "top-2";
  const t2 = "top-[20%]";
  const t3 = "top-[40%]";
  const t4 = "top-[60%]";
  const t5 = "top-[80%]";

  return (
    <div>
      <div className="flex flex-row items-center justify-center text-center">
        <Image
          className="w-full opacity-50"
          src={IMG_EQUIP_SILHOUETTE}
          alt="background"
          width={290}
          height={461}
        />
        <Equip slot={"HEAD"} act={act} txt="Head" pos={t1} items={items} />
        <Equip slot={"CHEST"} act={act} txt="Chest" pos={t2} items={items} />
        <Equip slot={"WAIST"} act={act} txt="Waist" pos={t3} items={items} />
        <Equip slot={"LEGS"} act={act} txt="Legs" pos={t4} items={items} />
        <Equip slot={"FEET"} act={act} txt="Feet" pos={t5} items={items} />
        <Equip slot={"KEYSTONE"} act={act} txt="Keystone" pos={l + t1} items={items} />
        <Equip slot={"THROWN"} act={act} txt="Thrown" pos={r + t1} items={items} />
        <Equip slot={"ITEM_1"} act={act} txt="Item" pos={l + t2} items={items} />
        <Equip slot={"ITEM_2"} act={act} txt="Item" pos={r + t2} items={items} />
        <Equip slot={"HAND_1"} act={act} txt="Hand" pos={l + t3} items={items} />
        <Equip slot={"HAND_2"} act={act} txt="Hand" pos={r + t3} items={items} />
        <Equip slot={"ITEM_3"} act={act} txt="Item" pos={l + t4} items={items} />
        <Equip slot={"ITEM_4"} act={act} txt="Item" pos={r + t4} items={items} />
        <Equip slot={"ITEM_5"} act={act} txt="Item" pos={l + t5} items={items} />
        <Equip slot={"ITEM_6"} act={act} txt="Item" pos={r + t5} items={items} />
        {isOpen && slot && (
          <Modal
            title="Select Item to Equip"
            isOpen={isOpen}
            setIsOpen={setIsOpen}
            isValid={false}
            proceed_label={equipped ? "Unequip" : undefined}
            onAccept={() => {
              if (equipped) {
                setUserItem(equipped);
                equip({ userItemId: equipped.id, slot: slot });
              }
            }}
          >
            {!isEquipping ? (
              <ActionSelector
                items={items?.filter(
                  (item) =>
                    item.itemType !== "FURNITURE" &&
                    item.itemType !== "MEAL" &&
                    slot?.includes(item.slot) &&
                    isEquippableUserItem(item),
                )}
                counts={itemBadges.counts}
                levels={itemBadges.levels}
                showBgColor={false}
                showLabels={false}
                greyedIds={items
                  ?.filter((item) => item.equipped !== "NONE")
                  .map((item) => item.id)}
                onClick={(id) => {
                  setUserItem(items?.find((item) => item.id === id));
                  equip({ userItemId: id, slot: slot });
                }}
              />
            ) : (
              <Loader explanation="Swapping" />
            )}
          </Modal>
        )}
        {showItemDetails && useritem && (
          <Modal
            title="Item Details"
            isOpen={showItemDetails}
            setIsOpen={setShowItemDetails}
            isValid={false}
          >
            <div>
              {showsItemLevelBadge(useritem.item) &&
                useritem.level < ITEM_LEVEL_CAP && (
                  <p>
                    - Need{" "}
                    {remainingXpToLevel(useritem.item.xpToLevel, useritem.experience)}{" "}
                    XP more to level
                  </p>
                )}
              {selectedMasteryWarning && (
                <p className="text-destructive text-sm">{selectedMasteryWarning}</p>
              )}
            </div>
            <ItemWithEffects
              item={{
                ...applyActiveVariant(useritem as UserItemWithVariants),
                imbuements: useritem.imbuements.map((imbuement) => imbuement.item),
                curDurability: useritem.durability,
                level: useritem.level,
                experience: useritem.experience,
              }}
              key={useritem.id}
              showStatistic="item"
            />
            {!isEquipping && !isUsingRepairItem && !isRepairingWithRyo && (
              <div className="mt-2 flex flex-row flex-wrap gap-1">
                <Button
                  variant="info"
                  onClick={() => {
                    if (slot) equip({ userItemId: useritem.id, slot });
                  }}
                  disabled={!slot}
                >
                  <Shirt className="mr-2 h-4 w-4" />
                  Unequip
                </Button>
                <ItemDurabilityRepairActions
                  useritem={useritem}
                  userData={userData}
                  repairItemsCount={repairItems.length}
                  onOpenRepairModal={() => setIsRepairModalOpen(true)}
                  onRepairWithRyo={(userItemId) => mutateRepairWithRyo({ userItemId })}
                  isRepairingWithRyo={isRepairingWithRyo}
                />
                {((useritem as UserItemWithVariants).item.variants?.length ?? 0) >
                  0 && (
                  <Button
                    variant="info"
                    onClick={() => {
                      const withVariants = useritem as UserItemWithVariants;
                      if (withVariants.item.variants?.length) {
                        setVariantItem(withVariants);
                      }
                    }}
                  >
                    Variants
                  </Button>
                )}
                <div className="grow"></div>
              </div>
            )}
            {(isEquipping || isUsingRepairItem || isRepairingWithRyo) && (
              <Loader
                explanation={`${isEquipping ? "Unequipping" : "Repairing"} ${useritem.item.name}`}
              />
            )}
          </Modal>
        )}
        {/* Repair Item Selection Modal */}
        <RepairModalWrapper
          useritem={useritem}
          repairItems={repairItems}
          isRepairModalOpen={isRepairModalOpen}
          setIsRepairModalOpen={setIsRepairModalOpen}
          onRepairItem={mutateRepairItem}
          isPending={isUsingRepairItem}
        />
        {/* Variant Modal */}
        {variantItem && (
          <ItemVariantModal
            userItem={variantItem}
            allUserItems={useritems}
            onClose={() => setVariantItem(undefined)}
          />
        )}
      </div>
    </div>
  );
};

/**
 * Equip on the Character Equip Screen
 */
interface EquipProps {
  txt: string;
  pos: string;
  slot: ItemSlot;
  items: (UserItem & Item & { masteryWarning?: string })[] | undefined;
  act: (slot: ItemSlot) => void;
}

const Equip: React.FC<EquipProps> = (props) => {
  const item = props.items?.find((item) => item.equipped === props.slot);
  return (
    <button
      type="button"
      className={`absolute ${props.pos} flex aspect-square w-1/5 shrink-0 grow-0 cursor-pointer flex-row items-center justify-center border-2 border-slate-500 border-dashed bg-slate-200 font-bold text-slate-950 text-xs sm:text-sm ${
        item ? "" : "opacity-50"
      } rounded-xl hover:border-black hover:bg-slate-400`}
      onClick={() => props.act(props.slot)}
    >
      {item ? (
        <div className="relative h-full w-full">
          <ContentImage
            image={item.image}
            hideBorder={true}
            alt={item.name}
            rarity={item.rarity}
            className=""
          />
          {/* Durability bar */}
          {item.maxDurability !== undefined &&
            item.durability !== undefined &&
            item.maxDurability > 0 &&
            typeof item.durability === "number" && (
              <DurabilityBar
                currentDurability={item.durability}
                maxDurability={item.maxDurability}
                position="top-right"
                size="medium"
              />
            )}
          {item.masteryWarning && (
            <div
              className="absolute top-0 left-0 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-red-600 bg-slate-300 text-red-600"
              title={item.masteryWarning}
            >
              <AlertTriangle className="h-4 w-4" aria-label={item.masteryWarning} />
            </div>
          )}
          {!showsItemLevelBadge(item) && item.quantity > 1 ? (
            <div className="absolute right-0 bottom-0 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-amber-300 bg-slate-300 font-bold text-black">
              {item.quantity}
            </div>
          ) : showsItemLevelBadge(item) ? (
            <div className="absolute bottom-0 left-0 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-red-600 bg-slate-300 font-bold text-black">
              {item.level}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="opacity-100">{props.txt}</p>
      )}
    </button>
  );
};

/**
 * Variant Modal for browsing, purchasing, and selecting item variants
 */
interface ItemVariantModalProps {
  userItem: UserItemWithVariants;
  allUserItems: UserItemWithRelations[] | undefined;
  onClose: () => void;
}

const ItemVariantModal: React.FC<ItemVariantModalProps> = ({
  userItem,
  allUserItems,
  onClose,
}) => {
  const utils = api.useUtils();
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const [isOpen, setIsOpen] = useState(true);
  const variants = userItem.item.variants ?? [];
  const { data: itemNames } = api.item.getAllNames.useQuery(undefined, {
    enabled: variants.some((variant) => Boolean(variant.requiredItemId)),
  });

  const { data: unlockedVariants } = api.item.getUserUnlockedVariants.useQuery({
    itemId: userItem.item.id,
  });
  // Until the unlock list resolves, unlockedIds is empty — gate locked actions on
  // this so an already-owned variant never briefly renders a Buy / Use Token button.
  const unlockStatusLoaded = unlockedVariants !== undefined;
  const unlockedIds = new Set(unlockedVariants?.map((u) => u.variantId) ?? []);

  // Match the server's carried, non-auctioned and finished-crafting checks.
  const variantTokens =
    allUserItems?.filter(
      (ui) =>
        isEquippableUserItem(ui) &&
        ui.item.effects.some((e) => e.type === "unlockitemvariant"),
    ) ?? [];

  const purchase = api.item.purchaseVariant.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      showMutationToast(result);
      if (result.success) {
        await Promise.all([
          utils.item.getUserUnlockedVariants.invalidate({ itemId: userItem.item.id }),
          updateUser(undefined, { revision, delta: result.userDelta }),
        ]);
      }
    },
  });

  const consumeToken = api.item.consumeVariantToken.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        setIsOpen(false);
        onClose();
        await Promise.all([
          utils.item.getUserUnlockedVariants.invalidate({ itemId: userItem.item.id }),
          utils.item.getUserItemsWithVariants.invalidate(),
        ]);
      }
    },
  });

  const select = api.item.selectVariant.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        await utils.item.getUserItemsWithVariants.invalidate();
        setIsOpen(false);
        onClose();
      }
    },
  });

  const activeVariantId = userItem.activeVariantId;

  const handleClose: React.Dispatch<React.SetStateAction<boolean>> = (value) => {
    const nextOpen = typeof value === "function" ? value(isOpen) : value;
    setIsOpen(nextOpen);
    if (!nextOpen) onClose();
  };

  return (
    <Modal
      title={`Variants — ${userItem.item.name}`}
      isOpen={isOpen}
      setIsOpen={handleClose}
      isValid={false}
    >
      <p className="mb-4 text-muted-foreground text-sm">
        Purchase and select a variant to change how this item appears.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* Base look */}
        <button
          type="button"
          className={`cursor-pointer rounded border p-2 ${!activeVariantId ? "ring-2 ring-primary" : ""}`}
          onClick={() => select.mutate({ userItemId: userItem.id, variantId: null })}
        >
          <Image
            src={userItem.item.image}
            alt="Base"
            width={80}
            height={80}
            className="mx-auto rounded"
          />
          <p className="mt-1 text-center font-medium text-xs">Base (Free)</p>
          {!activeVariantId && (
            <p className="text-center text-primary text-xs">Active</p>
          )}
        </button>

        {variants.map((v) => {
          const isUnlocked = unlockedIds.has(v.id);
          const isActive = activeVariantId === v.id;
          const needsToken = v.costType === "VARIANT_TOKEN";
          const matchingToken = variantTokens.find(
            (token) =>
              (!v.requiredItemId || token.item.id === v.requiredItemId) &&
              token.item.effects.some(
                (effect) =>
                  effect.type === "unlockitemvariant" &&
                  (!effect.variantId || effect.variantId === v.id),
              ),
          );
          const tokenActionLabel = matchingToken
            ? `Use ${matchingToken.item.name}`
            : `Need ${itemNames?.find((entry) => entry.id === v.requiredItemId)?.name ?? "compatible token"}`;
          // Preview the same discounted prestige amount guarded and charged by the server.
          const purchaseCost =
            v.costType === "VILLAGE_PRESTIGE" && userData
              ? getVillageLoyaltyShopCost(v.cost, userData)
              : v.cost;

          return (
            <div
              key={v.id}
              className={`rounded border p-2 ${isActive ? "ring-2 ring-primary" : ""} ${!isUnlocked ? "opacity-60" : "cursor-pointer"}`}
            >
              <Image
                src={v.image}
                alt={v.name}
                width={80}
                height={80}
                className="mx-auto rounded"
              />
              <p className="mt-1 text-center font-medium text-xs">{v.name}</p>
              {v.description && (
                <div
                  className="mt-0.5 text-center text-muted-foreground text-xs"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized server-side before storage
                  dangerouslySetInnerHTML={{ __html: v.description }}
                />
              )}

              {isUnlocked ? (
                isActive ? (
                  <p className="text-center text-primary text-xs">Active</p>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 w-full"
                    onClick={() =>
                      select.mutate({ userItemId: userItem.id, variantId: v.id })
                    }
                    disabled={select.isPending}
                  >
                    Select
                  </Button>
                )
              ) : !unlockStatusLoaded ? (
                <Button size="sm" variant="outline" className="mt-1 w-full" disabled>
                  …
                </Button>
              ) : needsToken ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 w-full"
                  disabled={!matchingToken || consumeToken.isPending}
                  onClick={() => {
                    const token = matchingToken;
                    if (token) {
                      consumeToken.mutate({
                        tokenUserItemId: token.id,
                        variantId: v.id,
                      });
                    }
                  }}
                >
                  <span className="min-w-0 truncate" title={tokenActionLabel}>
                    {tokenActionLabel}
                  </span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 w-full"
                  onClick={() => purchase.mutate({ variantId: v.id })}
                  disabled={purchase.isPending}
                >
                  {`Buy: ${purchaseCost.toLocaleString()} ${displayCostType(v.costType)}`}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

// Alias the procedure so its action name is not interpreted as a React hook.
const repairAllWithKits = api.item.useRepairAll;

// Alias the procedure so its action name is not interpreted as a React hook.
const repairWithKit = api.item.useRepairItem;
