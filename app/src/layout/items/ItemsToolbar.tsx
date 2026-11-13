"use client";

import { CircleDollarSign, Undo2, Wrench, Zap } from "lucide-react";
import { useId, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { UserItemWithRelations } from "@/drizzle/schema";
import Confirm from "@/layout/Confirm";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import { MergeAllStacksButton } from "@/layout/MergeAllStacksButton";
import { countMergeableStackTypes } from "@/libs/item";
import { calcRepairAllCost, calculateKitsToUse, getRepairKits } from "@/libs/repair";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { fedItemLoadouts } from "@/utils/paypal";
import { useRequiredUserInfo } from "@/utils/UserContext";

/**
 * The item loadout selector and whole-inventory actions: unequip all, merge all stacks,
 * repair all (with kits, or ryo for crafters) and auto equip, each behind its confirmation.
 * Repair all leads while gear is damaged and repairable here, otherwise auto equip. Merge
 * stacks sits beside it, at every width, while carried stacks can be merged; phones open the
 * other actions with ⋯.
 */
export function ItemsToolbar({ userData, userItems }: ItemsToolbarProps) {
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const utils = api.useUtils();
  // Phones show the secondary actions on request; wider screens always show them.
  const [showMore, setShowMore] = useState(false);
  const moreActionsId = useId();

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
        if (data.userRecovery && !data.success) void updateUser(data, { revision });
        if (data.success) {
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            updateUser(data, { revision }),
          ]);
        }
      },
    });

  const { mutate: mutateRepairAllRyo, isPending: isRepairingAllRyo } =
    api.item.repairAll.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.userRecovery && !data.success) void updateUser(data, { revision });
        if (data.success) {
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            updateUser(data, { revision }),
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
          updateUser(data, { revision }),
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

  // Calculate items needing repair and which kits will be used
  const { itemsNeedingRepair, totalCost: totalRyoRepairCost } =
    calcRepairAllCost(userItems);
  const repairKits = getRepairKits(userItems, userData);
  const isCrafter = userData.occupation === "CRAFTING";
  const canAffordRyoRepair = userData.money >= totalRyoRepairCost;
  const isRepairAllPending = isRepairingAll || isRepairingAllRyo;

  // Calculate which kits will be used (shared with item.useRepairAll)
  const repairKitCalculation = calculateKitsToUse(itemsNeedingRepair, repairKits);

  const canRepairWithKits = repairKits.length > 0 && repairKitCalculation.canRepairAll;
  // The selector renders nothing for a single loadout; drop its label with it.
  const hasLoadouts = fedItemLoadouts(userData) > 1;
  const canRepairAll =
    itemsNeedingRepair.length > 0 && (repairKits.length > 0 || isCrafter);
  // Carried item types the merge would change; the button hides while stacks are packed.
  const mergeableStackTypes = countMergeableStackTypes(
    userItems ?? [],
    false,
    new Date(),
  );

  // Distinct keys keep an open confirmation from changing actions after a refresh.
  const autoEquipAction = (
    <Confirm
      key="auto-equip"
      title="Auto Equip"
      proceed_label={isAutoEquipping ? undefined : "Auto equip"}
      isValid={!isAutoEquipping}
      disabled={isAutoEquipping}
      button={
        <Button
          disabled={isAutoEquipping}
          aria-busy={isAutoEquipping}
          variant={canRepairAll ? "outline" : "default"}
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
        Equip the best available items from your backpack into your equipment slots?
      </p>
    </Confirm>
  );
  const repairAllAction = (
    <Confirm
      key="repair-all"
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
          aria-label={isRepairAllPending ? "Repairing all items" : "Repair all items"}
          hoverText="Repair all items"
          variant="default"
          size="sm"
          className="gap-1.5"
        >
          <Wrench className="h-4 w-4" />
          {isRepairAllPending
            ? "Repairing"
            : `Repair all (${itemsNeedingRepair.length})`}
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
              {repairKitCalculation.kitsToUse.length > 0 && (
                <div>
                  <p className="mb-2 font-semibold">Repair kits to be used:</p>
                  <div className="space-y-1">
                    {repairKitCalculation.kitsToUse.map((kit) => (
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
              <p className="mb-2 font-semibold text-red-600">Not enough repair kits</p>
              <p className="text-muted-foreground text-sm">
                You have {itemsNeedingRepair.length} damaged item
                {itemsNeedingRepair.length !== 1 ? "s" : ""} that need
                {itemsNeedingRepair.length === 1 ? "s" : ""}{" "}
                {repairKitCalculation.totalDurabilityNeeded} total durability, but you
                don&apos;t have enough repair kits to repair all of them.
              </p>
            </div>
          )
        ) : (
          <p className="text-muted-foreground text-sm">
            You don&apos;t have any repair kits. As a crafter, you can repair with ryo
            instead.
          </p>
        )}
        {isCrafter && (
          <div className="rounded-lg border bg-muted/50 p-3 text-sm">
            <p className="font-semibold">Repair with ryo</p>
            <p className="text-muted-foreground">
              Total cost:{" "}
              <span className={canAffordRyoRepair ? "text-green-600" : "text-red-600"}>
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
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
      {hasLoadouts && (
        <div className="flex min-w-[12rem] flex-1 items-center gap-2">
          <span className="font-bold text-muted-foreground text-xs uppercase tracking-wide">
            Loadout
          </span>
          <div className="flex min-w-0 max-w-[16rem] flex-1">
            <ItemLoadoutSelector variant="dropdown" renamable />
          </div>
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {canRepairAll ? repairAllAction : autoEquipAction}
        {mergeableStackTypes > 0 && (
          <MergeAllStacksButton storedAtHome={false} count={mergeableStackTypes} />
        )}
        <Button
          variant="outline"
          size="sm"
          className="sm:hidden"
          aria-expanded={showMore}
          aria-controls={moreActionsId}
          aria-label="More item actions"
          onClick={() => setShowMore((open) => !open)}
        >
          ⋯
        </Button>
        <div
          id={moreActionsId}
          className={cn(
            "flex flex-wrap items-center gap-2",
            !showMore && "max-sm:hidden",
          )}
        >
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
                className="gap-1.5"
              >
                <Undo2 className="h-4 w-4" />
                {isUnequippingAll ? "Unequipping" : "Unequip all"}
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
          {canRepairAll && autoEquipAction}
        </div>
      </div>
    </div>
  );
}

// Alias the procedure so its action name is not interpreted as a React hook. Optional
// access lets the module load where tests replace the client without this router.
const repairAllWithKits = api.item?.useRepairAll;

interface ItemsToolbarProps {
  userData: NonNullable<UserWithRelations>;
  /** Every carried item, for repair costs and kits. */
  userItems: UserItemWithRelations[] | undefined;
}
