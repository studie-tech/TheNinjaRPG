import type React from "react";
import ItemWithEffects, { type ItemWithEffectsProps } from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";

/** Confirms spending reputation points on `item`; without enough points it only closes. */
export const RepPurchaseConfirmModal = <
  T extends ItemWithEffectsProps["item"] & { id: string },
>({
  item,
  cost,
  reputationPoints,
  verb,
  isFree,
  isPending,
  pendingLabel = "Purchasing",
  isOpen,
  setIsOpen,
  onBuy,
}: {
  item: T | undefined;
  cost: number;
  reputationPoints: number;
  verb: "Buy" | "Swap";
  isFree?: boolean;
  isPending: boolean;
  pendingLabel?: string;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onBuy: (item: T) => void;
}) => {
  const canAfford = isFree || reputationPoints >= cost;
  const proceedLabel = isFree
    ? `${verb} for free`
    : canAfford
      ? `${verb} for ${cost} reps`
      : `Need ${cost - reputationPoints} reps`;

  return (
    <Modal
      title="Confirm Purchase"
      proceed_label={isPending ? undefined : proceedLabel}
      isOpen={isOpen && !!item}
      setIsOpen={setIsOpen}
      isValid={false}
      onAccept={() => {
        if (canAfford && item) {
          onBuy(item);
        } else {
          setIsOpen(false);
        }
      }}
      confirmClassName={
        canAfford
          ? "bg-blue-600 text-white hover:bg-blue-700"
          : "bg-red-600 text-white hover:bg-red-700"
      }
    >
      {item && !isPending && <ItemWithEffects item={item} key={item.id} />}
      {item && isPending && <Loader explanation={pendingLabel} />}
    </Modal>
  );
};
