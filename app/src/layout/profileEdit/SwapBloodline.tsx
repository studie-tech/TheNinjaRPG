"use client";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { BLOODLINE_SWAP_FREE_DAYS, COST_SWAP_BLOODLINE } from "@/drizzle/constants";
import type { Bloodline } from "@/drizzle/schema";
import { ActionSelector } from "@/layout/CombatActions";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { RepPurchaseConfirmModal } from "@/layout/RepPurchaseConfirmModal";
import { getFreeBloodlineSwaps } from "@/libs/bloodline";
import { showMutationToast } from "@/libs/toast";
import { getUserFederalStatus } from "@/utils/paypal";
import { DAY_S, secondsFromDate } from "@/utils/time";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/**
 * Swap bloodline
 */
export const SwapBloodline: React.FC = () => {
  // State
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({
    reputationPoints: u.reputationPoints,
    staffAccount: u.staffAccount,
    federalStatus: u.federalStatus,
  }));
  const [bloodline, setBloodline] = useState<Bloodline | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const utils = api.useUtils();

  // Fetch data
  const { data: bloodlines, isFetching } =
    api.bloodline.getUserHistoricBloodlines.useQuery(undefined);
  const { data: swapInfo } = api.bloodline.getSwapInfo.useQuery(undefined, {
    enabled: !!userData,
  });

  // Mutations
  const { mutate: swap, isPending: isSwapping } =
    api.bloodline.swapBloodline.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _input, revision) => {
        showMutationToast(data);
        await Promise.all([
          updateUser(data, { revision }),
          utils.bloodline.getSwapInfo.invalidate(),
        ]);
      },
      onSettled: () => {
        setIsOpen(false);
      },
    });

  // Only show if we have userData
  if (!userData) {
    return <Loader explanation="Loading profile page..." />;
  }

  // Check for free swap eligibility
  const federalStatus = getUserFederalStatus(userData);
  const hasFreeSwapEligibility = getFreeBloodlineSwaps(federalStatus) > 0;
  const hasFreeSwapAvailable = swapInfo?.isFree ?? false;

  // Calculate when free swap resets (30 days from oldest free swap)
  const getFreeSwapResetTime = () => {
    if (
      !swapInfo?.recentSwaps ||
      swapInfo.recentSwaps.length === 0 ||
      !hasFreeSwapEligibility
    )
      return null;

    const oldestSwapTime = Math.min(
      ...swapInfo.recentSwaps.map((swap) => new Date(swap.createdAt).getTime()),
    );
    return secondsFromDate(BLOODLINE_SWAP_FREE_DAYS * DAY_S, new Date(oldestSwapTime));
  };

  const freeSwapResetTime = getFreeSwapResetTime();

  // Derived data
  const hasAvailableSwaps = bloodlines && bloodlines.length > 0;
  const isDisabled = !hasAvailableSwaps;
  const isFreeSwap = hasFreeSwapAvailable;

  // Show component
  return (
    <div className="mt-2 space-y-2">
      {/* Free Swap Timer */}
      {hasFreeSwapEligibility && swapInfo && !swapInfo.isFree && freeSwapResetTime && (
        <div className="mb-4 rounded-lg bg-slate-100 p-4 dark:bg-slate-800">
          <div className="space-y-2 text-center">
            <p className="text-muted-foreground text-sm">
              You have used your free bloodline swap. You must wait for the{" "}
              {BLOODLINE_SWAP_FREE_DAYS}-day reset or pay reputation points.
            </p>
            <p className="font-semibold text-lg">
              Next free bloodline swap available:{" "}
              <Countdown targetDate={freeSwapResetTime} />
            </p>
          </div>
        </div>
      )}
      {!isDisabled && !isFetching && bloodlines && (
        <ActionSelector
          items={bloodlines}
          showBgColor={false}
          showLabels={true}
          onClick={(id) => {
            if (id === bloodline?.id) {
              setBloodline(undefined);
              setIsOpen(false);
            } else {
              setBloodline(bloodlines?.find((b) => b.id === id));
              setIsOpen(true);
            }
          }}
        />
      )}
      {isFetching && <Loader explanation="Loading bloodlines" />}
      {isDisabled && (
        <div>
          You do not have any bloodlines available to swap to. Go{" "}
          <Link className="font-bold" href="/travel">
            travel
          </Link>{" "}
          to the wake island location, and get bloodlines in the science building to
          build your history.
        </div>
      )}
      <RepPurchaseConfirmModal
        item={bloodline}
        cost={COST_SWAP_BLOODLINE}
        reputationPoints={userData.reputationPoints}
        verb="Swap"
        isFree={isFreeSwap}
        isPending={isSwapping}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        onBuy={(item) => swap({ bloodlineId: item.id })}
      />
    </div>
  );
};
