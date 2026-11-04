"use client";

import { CircleDollarSign, Wrench } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import type { UserItemWithRelations } from "@/drizzle/schema";
import Confirm from "@/layout/Confirm";
import ContentImage from "@/layout/ContentImage";
import Modal from "@/layout/Modal";
import { calcItemRepairCost } from "@/libs/item";
import type { UserWithRelations } from "@/routers/profile";

/** Lets players choose a repair kit with a durability preview and pending-state guard. */
export function RepairItemSelectionModal({
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

/** Offers repair-kit selection and crafter ryo repair with cost and affordability checks. */
export function ItemDurabilityRepairActions({
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

type SetIsOpenType = React.Dispatch<React.SetStateAction<boolean>>;

interface RepairItemModalProps {
  isOpen: boolean;
  setIsOpen: SetIsOpenType;
  targetItem: UserItemWithRelations;
  repairItems: UserItemWithRelations[];
  onSelectRepairItem: (repairItemId: string, targetItemId: string) => void;
  isPending?: boolean;
}

interface ItemDurabilityRepairActionsProps {
  useritem: UserItemWithRelations;
  userData: NonNullable<UserWithRelations>;
  repairItemsCount: number;
  onOpenRepairModal: () => void;
  onRepairWithRyo: (userItemId: string) => void;
  isRepairingWithRyo?: boolean;
}
