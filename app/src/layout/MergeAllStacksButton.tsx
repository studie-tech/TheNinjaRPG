"use client";

import { Merge } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { getInventoryQuantities } from "@/deltas/item";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import Confirm from "@/layout/Confirm";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserInfo } from "@/utils/UserContext";

interface MergeAllStacksButtonProps {
  storedAtHome: boolean;
  compact?: boolean;
  /** Item types the merge would change, shown on the label when known. */
  count?: number;
  onMerged?: () => void;
}

/** Confirm stack consolidation and reconcile both inventory views, including partial failures. */
export const MergeAllStacksButton: React.FC<MergeAllStacksButtonProps> = ({
  storedAtHome,
  compact = false,
  count,
  onMerged,
}) => {
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const { prepareInventoryUpdate, updateInventory, invalidateInventory } =
    useInventoryCacheUpdate();

  const { mutate: mergeAllStacks, isPending } = api.item.mergeAllStacks.useMutation({
    onMutate: () => ({
      inventory: prepareInventoryUpdate(),
      user: prepareUserUpdate(),
    }),
    onSuccess: async (data, _input, snapshot) => {
      showMutationToast(data);
      if (data.userRecovery) await updateUser(data, { revision: snapshot.user });
      // Partial failures can already have changed stacks and require authoritative recovery.
      await updateInventory(
        data.success
          ? (rows) => getInventoryQuantities(rows, data.inventoryChanges)
          : undefined,
        snapshot.inventory,
      );
      if (data.success) {
        onMerged?.();
      }
    },
    onError: async (error) => {
      // Report the failure before recovery reads so slow requests cannot delay feedback.
      showMutationToast({
        success: false,
        message: error.message,
        variant: "destructive",
      });
      await invalidateInventory();
    },
  });

  return (
    <Confirm
      title="Merge all stacks"
      proceed_label="Merge all stacks"
      disabled={isPending}
      button={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={compact ? "h-8 w-8 px-0 sm:w-auto sm:gap-1.5 sm:px-2" : "gap-1.5"}
          aria-label={isPending ? "Merging all stacks" : "Merge all stacks"}
          hoverText="Merge all stacks"
          disabled={isPending}
          aria-busy={isPending}
        >
          <Merge className="h-4 w-4" />
          <span className={compact ? "hidden sm:inline" : undefined}>
            {isPending
              ? "Merging..."
              : `${compact ? "Merge" : "Merge stacks"}${count ? ` (${count})` : ""}`}
          </span>
        </Button>
      }
      onAccept={(e) => {
        e.preventDefault();
        mergeAllStacks({ storedAtHome });
      }}
    >
      <p>
        {storedAtHome
          ? "Consolidate stackable items in your home storage (stored items, materials, and cooking) into the fewest possible stacks. Carried inventory is not affected. This cannot be automatically undone."
          : "Consolidate stackable items in your carried inventory (backpack and equipped slots) into the fewest possible stacks. Home storage is not affected. This cannot be automatically undone."}
      </p>
    </Confirm>
  );
};
