"use client";
import { Gem } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Input } from "@/components/ui/input";
import {
  BLOODLINE_SWAP_FREE_DAYS,
  COST_SWAP_BLOODLINE,
  DIAMOND_BLOODLINE_RANKS,
} from "@/drizzle/constants";
import type { Bloodline } from "@/drizzle/schema";
import { ActionSelector } from "@/layout/CombatActions";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { RepPurchaseConfirmModal } from "@/layout/RepPurchaseConfirmModal";
import {
  getDiamondRestoreBloodlineId,
  getFreeBloodlineSwaps,
  hasDiamondBloodlineSwaps,
} from "@/libs/bloodline";
import { showMutationToast } from "@/libs/toast";
import { getUserFederalStatus } from "@/utils/paypal";
import { DAY_S, secondsFromDate } from "@/utils/time";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/**
 * Swap bloodline: owned bloodlines for everyone, plus any D–A bloodline for Diamond
 * supporters, reverted when Diamond support ends.
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
    bloodlineId: u.bloodlineId,
    diamondBloodlineActive: u.diamondBloodlineActive,
    preDiamondBloodlineId: u.preDiamondBloodlineId,
  }));
  const [bloodline, setBloodline] = useState<Bloodline | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [diamondLine, setDiamondLine] = useState<Bloodline | undefined>(undefined);
  const [isDiamondOpen, setIsDiamondOpen] = useState<boolean>(false);
  const [diamondSearch, setDiamondSearch] = useState("");
  const utils = api.useUtils();
  const isDiamond = !!userData && hasDiamondBloodlineSwaps(userData);

  // Fetch data
  const { data: bloodlines, isFetching } =
    api.bloodline.getUserHistoricBloodlines.useQuery(undefined);
  const { data: swapInfo } = api.bloodline.getSwapInfo.useQuery(undefined, {
    enabled: !!userData,
  });
  const { data: diamondLines, isPending: isLoadingDiamondLines } =
    api.bloodline.getDiamondSwapBloodlines.useQuery(undefined, {
      enabled: isDiamond,
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
          utils.bloodright.get.invalidate(),
        ]);
      },
      onSettled: () => {
        setIsOpen(false);
      },
    });
  const { mutate: diamondSwap, isPending: isDiamondSwapping } =
    api.bloodline.swapDiamondBloodline.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _input, revision) => {
        showMutationToast(data);
        await Promise.all([
          updateUser(data, { revision }),
          utils.bloodright.get.invalidate(),
        ]);
      },
      onSettled: () => {
        setIsDiamondOpen(false);
        setDiamondLine(undefined);
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
  // The bloodline a Diamond supporter returns to when Diamond support ends.
  const restoreId =
    bloodlines &&
    getDiamondRestoreBloodlineId(
      userData,
      bloodlines.map((line) => line.id),
    );
  const restoreName = !bloodlines
    ? "your previous bloodline"
    : restoreId
      ? (bloodlines?.find((line) => line.id === restoreId)?.name ??
        diamondLines?.find((line) => line.id === restoreId)?.name ??
        "your previous bloodline")
      : "no bloodline";
  const search = diamondSearch.trim().toLowerCase();
  const visibleDiamondLines = diamondLines?.filter(
    (line) =>
      line.id !== userData.bloodlineId &&
      (!search || line.name.toLowerCase().includes(search)),
  );

  // Show component
  return (
    <div className="mt-2 space-y-2">
      {isDiamond && (
        <section
          aria-labelledby="diamond-bloodline-swaps"
          className="space-y-3 rounded-lg border border-cyan-500/60 bg-cyan-50/60 p-3 dark:bg-cyan-950/20"
        >
          <h3
            id="diamond-bloodline-swaps"
            className="flex items-center gap-2 font-semibold"
          >
            <Gem className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            Diamond bloodlines
          </h3>
          <p className="text-muted-foreground text-sm">
            Switch to any released {DIAMOND_BLOODLINE_RANKS.join(", ")} rank bloodline
            available to your village for free, as often as you like, while your Diamond
            support is active. These bloodlines are not added to your history, and when
            Diamond support ends you return to{" "}
            <span className="font-semibold text-foreground">{restoreName}</span>.
          </p>
          <Input
            aria-label="Search Diamond bloodlines"
            placeholder="Search bloodlines"
            value={diamondSearch}
            onChange={(e) => setDiamondSearch(e.target.value)}
          />
          {isLoadingDiamondLines && <Loader explanation="Loading bloodlines" />}
          {visibleDiamondLines &&
            DIAMOND_BLOODLINE_RANKS.map((rank) => {
              const lines = visibleDiamondLines.filter((line) => line.rank === rank);
              if (lines.length === 0) return null;
              return (
                <div key={rank}>
                  <p className="mb-1 font-semibold text-sm">
                    {rank} rank{" "}
                    <span className="font-normal text-muted-foreground">
                      ({lines.length})
                    </span>
                  </p>
                  <ActionSelector
                    items={lines}
                    showBgColor={false}
                    showLabels={true}
                    selectedId={diamondLine?.id}
                    onClick={(id) => {
                      if (id === diamondLine?.id) {
                        setDiamondLine(undefined);
                        setIsDiamondOpen(false);
                      } else {
                        setDiamondLine(lines.find((line) => line.id === id));
                        setIsDiamondOpen(true);
                      }
                    }}
                  />
                </div>
              );
            })}
          {visibleDiamondLines?.length === 0 && (
            <p className="text-sm">
              {search
                ? "No bloodlines match your search."
                : "No other bloodlines are available to your village."}
            </p>
          )}
        </section>
      )}
      {isDiamond && <h3 className="pt-2 font-semibold">Your bloodline history</h3>}
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
          {isDiamond
            ? "No bloodlines in your history yet."
            : "You do not have any bloodlines available to swap to."}{" "}
          Go{" "}
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
      <RepPurchaseConfirmModal
        item={diamondLine}
        cost={0}
        reputationPoints={userData.reputationPoints}
        verb="Swap"
        isFree={true}
        isPending={isDiamondSwapping}
        pendingLabel="Swapping"
        isOpen={isDiamondOpen}
        setIsOpen={setIsDiamondOpen}
        note={
          bloodlines?.some((line) => line.id === diamondLine?.id)
            ? "You own this bloodline, so you keep it when Diamond support ends."
            : `This bloodline is not added to your history and is replaced by ${restoreName} when Diamond support ends.`
        }
        onBuy={(item) => diamondSwap({ bloodlineId: item.id })}
      />
    </div>
  );
};
