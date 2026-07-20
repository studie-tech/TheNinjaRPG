"use client";

import { Merge } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Confirm2 from "@/layout/Confirm2";
import { showMutationToast } from "@/libs/toast";

interface MergeAllStacksButtonProps {
  storedAtHome: boolean;
  onMerged?: () => void;
}

export const MergeAllStacksButton: React.FC<MergeAllStacksButtonProps> = ({
  storedAtHome,
  onMerged,
}) => {
  const utils = api.useUtils();

  const { mutate: mergeAllStacks, isPending } = api.item.mergeAllStacks.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.item.getUserItemsWithVariants.invalidate(),
          utils.item.getUserItems.invalidate(),
        ]);
        onMerged?.();
      }
    },
    onError: (error) => {
      showMutationToast({
        success: false,
        message: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Confirm2
      title="Merge all stacks"
      proceed_label={isPending ? undefined : "Merge all stacks"}
      isValid={!isPending}
      button={
        <Button type="button" variant="outline" size="sm" disabled={isPending}>
          <Merge className="mr-2 h-4 w-4" />
          {isPending ? "Merging..." : "Merge all stacks"}
        </Button>
      }
      onAccept={(e) => {
        e.preventDefault();
        mergeAllStacks({ storedAtHome });
      }}
    >
      <p>
        {storedAtHome
          ? "Consolidate stackable items in your home storage (stored items and materials) into the fewest possible stacks. Carried inventory is not affected. This cannot be automatically undone."
          : "Consolidate stackable items in your carried inventory (backpack and equipped slots) into the fewest possible stacks. Home storage is not affected. This cannot be automatically undone."}
      </p>
    </Confirm2>
  );
};
