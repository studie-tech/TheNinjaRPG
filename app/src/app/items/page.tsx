"use client";

import {
  ArrowDownToLine,
  CircleDollarSign,
  CircleFadingArrowUp,
  Cookie,
  Merge,
  Shirt,
  Split,
  Wrench,
  Zap,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COST_EXTRA_ITEM_SLOT, IMG_EQUIP_SILHOUETTE } from "@/drizzle/constants";
import type { Item, ItemSlot, UserItem, UserItemWithRelations } from "@/drizzle/schema";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import ContentImage from "@/layout/ContentImage";
import DurabilityBar from "@/layout/DurabilityBar";
import Image from "@/layout/Image";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import NavTabs from "@/layout/NavTabs";
import {
  calcItemSellingPrice,
  calcMaxEventItems,
  calcMaxItems,
  calcMaxMaterials,
  nonCombatConsume,
} from "@/libs/item";
import { calculateKitsToUse, getRepairKits } from "@/libs/repair";
import { showMutationToast, showRewardToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { useRequiredUserData } from "@/utils/UserContext";

export default function MyItems() {
  // State
  const availableTabs = ["normal", "event", "materials"];
  const { data: userData } = useRequiredUserData();
  const [activeTab, setActiveTab] = useState<(typeof availableTabs)[number]>("normal");

  // tRPC utils
  const utils = api.useUtils();

  // Data from DB
  useRequiredUserData();
  const { data: userItems, isFetching } = api.item.getUserItems.useQuery(undefined, {
    enabled: !!userData,
  });

  // Mutations
  const { mutate: buyItemSlot, isPending } = api.blackmarket.buyItemSlot.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
      }
    },
  });

  const { mutate: autoEquipOptimal, isPending: isAutoEquipping } =
    api.item.autoEquipOptimal.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.item.getUserItems.invalidate();
        }
      },
    });

  const { mutate: mutateRepairAll, isPending: isRepairingAll } =
    api.item.useRepairAll.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.item.getUserItems.invalidate();
          await utils.profile.getUser.invalidate();
        }
      },
    });

  // Subtitle
  const availableItems = userItems
    ?.filter((ui) => !ui.storedAtHome)
    .filter((ui) => !ui.craftingFinishedAt || ui.craftingFinishedAt < new Date())
    .filter((ui) => !ui.isInAuction)
    .map((ui) => ({
      ...ui,
      imbuements: ui.imbuements.filter(
        (i) => !i.craftingFinishedAt || i.craftingFinishedAt < new Date(),
      ),
    }));
  const normalItems = availableItems?.filter(
    (ui) => !ui.item.isEventItem && ui.item.itemType !== "MATERIAL",
  );
  const eventItems = availableItems?.filter(
    (ui) => ui.item.isEventItem && ui.item.itemType !== "MATERIAL",
  );
  const materialsItems = availableItems?.filter(
    (ui) => ui.item.itemType === "MATERIAL",
  );

  // Calculate inventory limits
  const maxNormalItems = userData ? calcMaxItems(userData) : 0;
  const maxEventItems = userData ? calcMaxEventItems(userData) : 0;
  const maxMaterials = userData ? calcMaxMaterials(userData) : 0;

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isFetching) return <Loader explanation="Loading items" />;

  // Can afford removing
  const canAfford =
    userData.reputationPoints && userData.reputationPoints >= COST_EXTRA_ITEM_SLOT;

  // Calculate items needing repair and which kits will be used
  const itemsNeedingRepair = (userItems || []).filter(
    (useritem) =>
      useritem.durability < useritem.item.maxDurability &&
      useritem.item.maxDurability > 0,
  );
  const repairKits = getRepairKits(userItems);

  // Calculate which kits will be used (same algorithm as backend)
  const repairKitCalculation = calculateKitsToUse(
    itemsNeedingRepair,
    repairKits,
    userItems,
  );

  const repairAllInfo = repairKitCalculation;

  return (
    <>
      <ContentBox
        title="Item Management"
        subtitle={
          activeTab === "normal"
            ? `Normal Inventory ${normalItems?.length}/${maxNormalItems}`
            : activeTab === "event"
              ? `Event Inventory ${eventItems?.length}/${maxEventItems}`
              : `Materials Inventory ${materialsItems?.length}/${maxMaterials}`
        }
        padding={false}
        topRightContent={
          <div className="flex flex-row gap-2">
            <NavTabs
              id="backpackSelection"
              current={activeTab}
              options={availableTabs}
              setValue={setActiveTab}
            />
            <Confirm2
              title="Extra Item Slot"
              proceed_label={
                canAfford
                  ? `Purchase for ${COST_EXTRA_ITEM_SLOT} reps`
                  : `Need ${userData.reputationPoints - COST_EXTRA_ITEM_SLOT} more reps`
              }
              isValid={!isPending}
              button={
                <Button animation="pulse">
                  <CircleFadingArrowUp className="h-6 w-6" />
                </Button>
              }
              onAccept={(e) => {
                e.preventDefault();
                if (canAfford) buyItemSlot();
              }}
            >
              <p>
                You are about to purchase an extra item slot for {COST_EXTRA_ITEM_SLOT}{" "}
                reputation points. You currently have {userData.reputationPoints}{" "}
                points. Are you sure?
              </p>
            </Confirm2>
          </div>
        }
      >
        <div className="flex flex-col">
          <div className="flex flex-col sm:flex-row">
            <div className="w-full basis-1/2 p-3">
              <h2 className="font-bold text-2xl text-foreground">Equipped</h2>
              <div className="relative">
                <Character useritems={userItems} />
              </div>
            </div>
            <div className="max-h-full basis-1/2 overflow-y-scroll border-t-2 border-dashed bg-poppopover p-3 sm:max-h-[600px] sm:border-t-0 sm:border-l-2">
              <h2 className="font-bold text-2xl text-foreground">Backpack</h2>
              <Backpack
                userData={userData}
                useritems={
                  activeTab === "normal"
                    ? normalItems?.filter((ui) => ui.equipped === "NONE")
                    : activeTab === "event"
                      ? eventItems?.filter((ui) => ui.equipped === "NONE")
                      : materialsItems?.filter((ui) => ui.equipped === "NONE")
                }
              />
            </div>
          </div>
        </div>
      </ContentBox>
      <div className="mt-1 flex w-full items-center justify-between">
        <div>
          <ItemLoadoutSelector />
        </div>
        <div className="flex gap-2">
          {itemsNeedingRepair.length > 0 && repairKits.length > 0 && (
            <Confirm2
              title="Repair All Items"
              proceed_label={
                repairAllInfo.canRepairAll
                  ? isRepairingAll
                    ? undefined
                    : "Repair All"
                  : undefined
              }
              isValid={repairAllInfo.canRepairAll && !isRepairingAll}
              button={
                <Button disabled={isRepairingAll} variant="outline">
                  <Wrench className="mr-2 h-4 w-4" />
                  {isRepairingAll ? "Repairing..." : "Repair All"}
                </Button>
              }
              onAccept={(e) => {
                e.preventDefault();
                if (repairAllInfo.canRepairAll) {
                  mutateRepairAll();
                }
              }}
            >
              <div className="space-y-3">
                {repairAllInfo.canRepairAll ? (
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
                      {itemsNeedingRepair.length !== 1 ? "s" : ""} that need{" "}
                      {repairAllInfo.totalDurabilityNeeded} total durability, but you
                      don&apos;t have enough repair kits to repair all of them.
                    </p>
                  </div>
                )}
              </div>
            </Confirm2>
          )}
          <Confirm2
            title="Auto Equip"
            isValid={!isPending}
            button={
              <Button disabled={isAutoEquipping} variant="default">
                <Zap className="mr-2 h-4 w-4" />
                {isAutoEquipping ? "Auto Equipping..." : "Auto Equip"}
              </Button>
            }
            onAccept={(e) => {
              e.preventDefault();
              autoEquipOptimal();
            }}
          >
            <p>
              You are about to auto-equip your items. This will equip unequipped items
              in the best possible way. Are you sure?
            </p>
          </Confirm2>
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
    <Modal2
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
                          Repairing...
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
    </Modal2>
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
 * Backpack Screen
 */
interface BackpackProps {
  useritems: UserItemWithRelations[] | undefined;
  userData: NonNullable<UserWithRelations>;
}

const Backpack: React.FC<BackpackProps> = (props) => {
  // Destructure
  const { useritems, userData } = props;

  // State
  const [useritem, setUserItem] = useState<UserItemWithRelations | undefined>(
    undefined,
  );
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isSplitDialogOpen, setIsSplitDialogOpen] = useState<boolean>(false);
  const [quantityToKeep, setQuantityToKeep] = useState<string>("");
  const [isRepairModalOpen, setIsRepairModalOpen] = useState<boolean>(false);

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
      if (data.success) {
        await utils.item.getUserItems.invalidate();
      }
    },
    onSettled,
  });

  const { mutate: consume, isPending: isConsuming } = api.item.consume.useMutation({
    onSuccess: async (data) => {
      if (data.success && "rewards" in data && data.rewards) {
        showRewardToast(data.notifications, data.rewards, data.message, false);
      } else {
        let message = data.message || "Consume failed";
        if ("notifications" in data && data.notifications) {
          for (const notification of data.notifications || []) {
            message += `\n${notification}`;
          }
        }
        showMutationToast({ success: true, message });
      }
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.item.getUserItems.invalidate();
        await utils.bloodline.getItemRolls.invalidate();
      }
    },
    onSettled,
  });

  const { mutate: sell, isPending: isSelling } = api.item.sellUserItem.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.item.getUserItems.invalidate();
      }
    },
    onSettled,
  });

  const { mutate: equip, isPending: isEquipping } = api.item.toggleEquip.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.item.getUserItems.invalidate();
      }
    },
    onSettled,
  });

  const { mutate: splitStack, isPending: isSplitting } =
    api.item.splitStack.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.item.getUserItems.invalidate();
          setIsSplitDialogOpen(false);
          setQuantityToKeep("");
        }
      },
      onSettled,
    });

  const { mutate: mutateRepairItem, isPending: isUsingRepairItem } =
    api.item.useRepairItem.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          setIsRepairModalOpen(false);
          await utils.item.getUserItems.invalidate();
          await utils.profile.getUser.invalidate();
        }
      },
    });

  // Derived
  const structures = userData?.village?.structures;
  const isLoading =
    isMerging ||
    isConsuming ||
    isSelling ||
    isEquipping ||
    isSplitting ||
    isUsingRepairItem;
  const items = useritems?.map((useritem) => ({
    ...useritem.item,
    ...useritem,
  }));
  const sellPrice = calcItemSellingPrice(userData, useritem, structures);
  const repairItems = (useritems || []).filter(
    (userItem: UserItemWithRelations) =>
      userItem.item?.effects?.some((e: { type: string }) => e.type === "repair") &&
      userItem.quantity > 0 &&
      (!userItem.craftingFinishedAt || userItem.craftingFinishedAt < new Date()),
  );

  // Split stack handler
  const handleSplitStack = () => {
    if (!useritem) return;
    const quantity = parseInt(quantityToKeep, 10);
    if (
      Number.isNaN(quantity) ||
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
      <ActionSelector
        className="grid-cols-6 pt-3 sm:grid-cols-4 md:grid-cols-4"
        items={items}
        counts={items}
        selectedId={useritem?.id}
        showBgColor={false}
        showLabels={false}
        onClick={(id) => {
          if (id === useritem?.id) {
            setUserItem(undefined);
            setIsOpen(false);
          } else {
            setUserItem(items?.find((item) => item.id === id));
            setIsOpen(true);
          }
        }}
      />
      {isOpen && useritem && (
        <Modal2
          title="Item Details"
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          isValid={false}
        >
          <ItemWithEffects
            item={{
              ...useritem.item,
              imbuements: useritem.imbuements.map((imbuement) => imbuement.item),
              curDurability: useritem.durability,
            }}
            key={useritem.id}
            showStatistic="item"
          />
          {!isLoading && (
            <div className="flex flex-row gap-1">
              {useritem.equipped === "NONE" && (
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
                    variant="info"
                    onClick={() => merge({ itemId: useritem.itemId })}
                  >
                    <Merge className="mr-2 h-5 w-5" />
                    Merge Stacks
                  </Button>
                  {useritem.quantity > 1 && (
                    <Button
                      variant="info"
                      onClick={() => {
                        setIsSplitDialogOpen(true);
                        setQuantityToKeep("");
                      }}
                    >
                      <Split className="mr-2 h-5 w-5" />
                      Split Stack
                    </Button>
                  )}
                </>
              )}
              {nonCombatConsume(useritem.item, userData) && (
                <Button
                  variant="info"
                  onClick={() => consume({ userItemId: useritem.id })}
                >
                  <Cookie className="mr-2 h-5 w-5" />
                  Consume
                </Button>
              )}
              {useritem.durability < useritem.item.maxDurability &&
                useritem.item.maxDurability > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setIsRepairModalOpen(true)}
                    disabled={repairItems.length === 0}
                  >
                    <Wrench className="mr-2 h-5 w-5" />
                    Use Repair Item
                  </Button>
                )}
              <div className="grow"></div>
              <Confirm2
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
              </Confirm2>
            </div>
          )}
          {isMerging && <Loader explanation={`Merging ${useritem.item.name} stacks`} />}
          {isConsuming && <Loader explanation={`Using ${useritem.item.name}`} />}
          {isSelling && <Loader explanation={`Selling ${useritem.item.name}`} />}
          {isEquipping && <Loader explanation={`Equipping ${useritem.item.name}`} />}
        </Modal2>
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
              <Input
                id="quantity"
                type="number"
                min="1"
                max={useritem.quantity - 1}
                value={quantityToKeep}
                onChange={(e) => setQuantityToKeep(e.target.value)}
                placeholder={`1-${useritem.quantity - 1}`}
                className="mt-2"
              />
              <p className="mt-2 text-muted-foreground text-sm">
                Current stack: {useritem.quantity} items
              </p>
              {quantityToKeep && !Number.isNaN(parseInt(quantityToKeep, 10)) && (
                <p className="mt-1 text-muted-foreground text-sm">
                  New stack will have:{" "}
                  {useritem.quantity - parseInt(quantityToKeep, 10)} items
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsSplitDialogOpen(false);
                  setQuantityToKeep("");
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
                  Number.isNaN(parseInt(quantityToKeep, 10)) ||
                  parseInt(quantityToKeep, 10) < 1 ||
                  parseInt(quantityToKeep, 10) >= useritem.quantity
                }
              >
                {isSplitting ? "Splitting..." : "Split Stack"}
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
    </>
  );
};

/**
 * Character Equip Screen
 */
interface CharacterProps {
  useritems: UserItemWithRelations[] | undefined;
}

const Character: React.FC<CharacterProps> = (props) => {
  // Set state
  const { useritems } = props;
  const [slot, setSlot] = useState<ItemSlot | undefined>(undefined);
  const [useritem, setUserItem] = useState<UserItemWithRelations | undefined>(
    undefined,
  );
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [showItemDetails, setShowItemDetails] = useState<boolean>(false);
  const [isRepairModalOpen, setIsRepairModalOpen] = useState<boolean>(false);

  // The item on the current slot

  // Collapse UserItem and Item
  const items = useritems?.map((useritem) => ({
    ...useritem.item,
    ...useritem,
  }));
  const equipped = items?.find((item) => item.equipped === slot);
  const repairItems = (useritems || []).filter(
    (userItem: UserItemWithRelations) =>
      userItem.item?.effects?.some((e: { type: string }) => e.type === "repair") &&
      userItem.quantity > 0 &&
      (!userItem.craftingFinishedAt || userItem.craftingFinishedAt < new Date()),
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
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.item.getUserItems.invalidate();
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
    api.item.useRepairItem.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          setIsRepairModalOpen(false);
          await utils.item.getUserItems.invalidate();
          await utils.profile.getUser.invalidate();
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
          <Modal2
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
                items={items?.filter((item) => slot?.includes(item.slot))}
                counts={items}
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
              <Loader explanation={`Swapping ${useritem?.item.name}`} />
            )}
          </Modal2>
        )}
        {showItemDetails && useritem && (
          <Modal2
            title="Item Details"
            isOpen={showItemDetails}
            setIsOpen={setShowItemDetails}
            isValid={false}
          >
            <ItemWithEffects
              item={{
                ...useritem.item,
                imbuements: useritem.imbuements.map((imbuement) => imbuement.item),
                curDurability: useritem.durability,
              }}
              key={useritem.id}
              showStatistic="item"
            />
            {!isEquipping && !isUsingRepairItem && (
              <div className="mt-2 flex flex-row gap-1">
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
                {useritem.durability < useritem.item.maxDurability &&
                  useritem.item.maxDurability > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => setIsRepairModalOpen(true)}
                      disabled={repairItems.length === 0}
                    >
                      <Wrench className="mr-2 h-4 w-4" />
                      Use Repair Item
                    </Button>
                  )}
                <div className="grow"></div>
              </div>
            )}
            {(isEquipping || isUsingRepairItem) && (
              <Loader
                explanation={`${isEquipping ? "Unequipping" : "Repairing"} ${useritem.item.name}`}
              />
            )}
          </Modal2>
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
  items: (UserItem & Item)[] | undefined;
  act: (slot: ItemSlot) => void;
}

const Equip: React.FC<EquipProps> = (props) => {
  const item = props.items?.find((item) => item.equipped === props.slot);
  return (
    <button
      type="button"
      className={`absolute ${props.pos} flex aspect-square w-1/5 shrink-0 grow-0 cursor-pointer flex-row items-center justify-center border-2 border-slate-500 border-dashed bg-slate-200 font-bold text-slate-950 text-xl md:w-1/4 lg:w-1/5 ${
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
          {item.quantity > 1 && (
            <div className="absolute right-0 bottom-0 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-amber-300 bg-slate-300 font-bold text-black">
              {item.quantity}
            </div>
          )}
        </div>
      ) : (
        <p className="opacity-100">{props.txt}</p>
      )}
    </button>
  );
};
