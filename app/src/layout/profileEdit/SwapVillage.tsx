"use client";

import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { COST_SWAP_VILLAGE } from "@/drizzle/constants";
import type { Village } from "@/drizzle/schema";
import { ActionSelector } from "@/layout/CombatActions";
import Loader from "@/layout/Loader";
import { RepPurchaseConfirmModal } from "@/layout/RepPurchaseConfirmModal";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/**
 * Swap village
 */
export const SwapVillage: React.FC = () => {
  // State
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({ reputationPoints: u.reputationPoints }));
  const _utils = api.useUtils();
  const [village, setVillage] = useState<Village | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  // Fetch data
  const { data, isFetching } = api.village.getAll.useQuery(undefined, {
    enabled: !!userData,
    placeholderData: (previousData) => previousData,
  });
  const villages = data
    ?.filter((village) => ["VILLAGE", "OUTLAW"].includes(village.type))
    .map((village) => ({
      ...village,
      image: village.villageLogo,
    }));

  // Mutations
  const { mutate: swap, isPending: isSwapping } = api.village.swapVillage.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.success || data.userRecovery) await updateUser(data, { revision });
    },
    onSettled: () => {
      setIsOpen(false);
    },
  });

  // Only show if we have userData
  if (!userData) {
    return <Loader explanation="Loading profile page..." />;
  }

  // Show component
  return (
    <div className="mt-2">
      {!isFetching && (
        <ActionSelector
          items={villages?.map((v) => ({ ...v, type: "village" }))}
          showBgColor={false}
          showLabels={true}
          onClick={(id) => {
            if (id === village?.id) {
              setVillage(undefined);
              setIsOpen(false);
            } else {
              setVillage(villages?.find((village) => village.id === id));
              setIsOpen(true);
            }
          }}
        />
      )}
      {isFetching && <Loader explanation="Loading villages" />}
      <RepPurchaseConfirmModal
        item={village}
        cost={COST_SWAP_VILLAGE}
        reputationPoints={userData.reputationPoints}
        verb="Swap"
        isPending={isSwapping}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        onBuy={(item) => swap({ villageId: item.id })}
      />
    </div>
  );
};
