"use client";

import { api } from "@/app/_trpc/client";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";

/**
 * Splits a stack before part of it is sold: `keepOnStack` leaves the copies to sell on the
 * stack, so the sale keeps its id, and moves the rest to a new stack. The split itself is
 * a step of the sale, so it shows no toast of its own; `refreshInventory` reads both
 * inventory views again once the sale settles, since the sold-stack patch cannot know
 * the new stack.
 */
export const useSplitBeforeSale = () => {
  const { invalidateInventory } = useInventoryCacheUpdate();
  const { mutateAsync, isPending } = api.item.splitStack.useMutation();
  return {
    keepOnStack: (userItemId: string, quantityToKeep: number) =>
      mutateAsync({ userItemId, quantityToKeep }).catch((error: unknown) => ({
        success: false,
        message: error instanceof Error ? error.message : "Could not split the stack",
      })),
    isSplitting: isPending,
    refreshInventory: invalidateInventory,
  };
};
