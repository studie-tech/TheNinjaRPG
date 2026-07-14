import { Dices, Scissors, Sparkles } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  COST_SWAP_SAGE_MODE,
  PITY_SAGE_MODE_ROLLS,
  PITY_SYSTEM_ENABLED,
  REMOVAL_COST,
  ROLL_CHANCE_PERCENTAGE,
  SAGE_MODE_SWAP_FREE_DAYS,
} from "@/drizzle/constants";
import type { SageMode } from "@/drizzle/schema";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { getSageModePityRolls } from "@/libs/sageMode";
import { showMutationToast } from "@/libs/toast";
import { getUserFederalStatus } from "@/utils/paypal";
import { DAY_S, secondsFromDate, secondsFromNow } from "@/utils/time";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Show the user's current sage mode and let them remove it.
 */
interface CurrentSageModeProps {
  sageModeId: string;
  initialBreak?: boolean;
}

export const CurrentSageMode: React.FC<CurrentSageModeProps> = (props) => {
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();
  const { data, isFetching } = api.sageMode.get.useQuery({ id: props.sageModeId }, {});

  const { mutate: remove, isPending: isRemoving } =
    api.sageMode.removeSageMode.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          await utils.profile.getUser.invalidate();
        }
      },
    });

  return (
    <ContentBox
      title="Sage Mode"
      subtitle="Your awakened sage mode"
      initialBreak={props.initialBreak}
    >
      {(isFetching || isRemoving) && <Loader explanation="Loading sage mode" />}
      {!isFetching && data && userData && (
        <>
          <ItemWithEffects item={data} key={data.id} />
          <Confirm2
            title="Sage Mode Removal"
            proceed_label="Remove Sage Mode"
            isValid={!isFetching}
            button={
              <Button id="check" className="w-full">
                <Scissors className="mr-2 h-6 w-6" />
                Remove Sage Mode
              </Button>
            }
            onAccept={(e) => {
              e.preventDefault();
              remove();
            }}
          >
            <p>
              Abandon your current sage mode. This is <b>free</b> if you awakened it
              naturally; otherwise it costs <b>{REMOVAL_COST} reputation points</b>.
            </p>
          </Confirm2>
        </>
      )}
    </ContentBox>
  );
};

/**
 * Swap the user's sage mode to any they have previously owned.
 */
export const SwapSageMode: React.FC = () => {
  const { data: userData } = useRequiredUserData();
  const [sageMode, setSageMode] = useState<SageMode | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const utils = api.useUtils();

  const { data: sageModes, isFetching } =
    api.sageMode.getUserHistoricSageModes.useQuery(undefined);
  const { data: swapInfo } = api.sageMode.getSwapInfo.useQuery(undefined, {
    enabled: !!userData,
  });

  const { mutate: swap, isPending: isSwapping } = api.sageMode.swapSageMode.useMutation(
    {
      onSuccess: async (data) => {
        showMutationToast(data);
        await Promise.all([
          utils.profile.getUser.invalidate(),
          utils.sageMode.getSwapInfo.invalidate(),
        ]);
      },
      onSettled: () => {
        document.body.style.cursor = "default";
        setIsOpen(false);
      },
    },
  );

  if (!userData) {
    return <Loader explanation="Loading profile page..." />;
  }

  const federalStatus = getUserFederalStatus(userData);
  const hasFreeSwapEligibility = federalStatus === "SILVER" || federalStatus === "GOLD";
  const hasFreeSwapAvailable = swapInfo?.isFree ?? false;

  const getFreeSwapResetTime = () => {
    if (
      !swapInfo?.recentSwaps ||
      swapInfo.recentSwaps.length === 0 ||
      !hasFreeSwapEligibility
    )
      return null;
    const oldestFreeSwap = swapInfo.recentSwaps.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )[0];
    if (!oldestFreeSwap) return null;
    const resetDate = secondsFromDate(
      SAGE_MODE_SWAP_FREE_DAYS * DAY_S,
      new Date(oldestFreeSwap.createdAt),
    );
    const now = new Date();
    const secondsUntilReset = Math.floor((resetDate.getTime() - now.getTime()) / 1000);
    return secondsFromNow(secondsUntilReset);
  };

  const freeSwapResetTime = getFreeSwapResetTime();

  const hasAvailableSwaps = sageModes && sageModes.length > 0;
  const isDisabled = !hasAvailableSwaps;
  const isFreeSwap = hasFreeSwapAvailable;
  const canAfford = isFreeSwap || userData.reputationPoints >= COST_SWAP_SAGE_MODE;

  return (
    <div className="mt-2 space-y-2">
      {hasFreeSwapEligibility && swapInfo && !swapInfo.isFree && freeSwapResetTime && (
        <div className="mb-4 rounded-lg bg-slate-100 p-4 dark:bg-slate-800">
          <div className="space-y-2 text-center">
            <p className="text-muted-foreground text-sm">
              You have used your free sage mode swap. You must wait for the{" "}
              {SAGE_MODE_SWAP_FREE_DAYS}-day reset or pay reputation points.
            </p>
            <p className="font-semibold text-lg">
              Next free sage mode swap available:{" "}
              <Countdown targetDate={freeSwapResetTime} />
            </p>
          </div>
        </div>
      )}
      {!isDisabled && !isFetching && sageModes && (
        <ActionSelector
          items={sageModes}
          showBgColor={false}
          showLabels={true}
          onClick={(id) => {
            if (id === sageMode?.id) {
              setSageMode(undefined);
              setIsOpen(false);
            } else {
              setSageMode(sageModes?.find((s) => s.id === id));
              setIsOpen(true);
            }
          }}
        />
      )}
      {isFetching && <Loader explanation="Loading sage modes" />}
      {isDisabled && (
        <div>
          You do not have any sage modes available to swap to. Earn additional sage
          modes through items and quests to build your history.
        </div>
      )}
      <Modal2
        title="Confirm Swap"
        proceed_label={
          isSwapping
            ? undefined
            : isFreeSwap
              ? "Swap for free"
              : canAfford
                ? `Swap for ${COST_SWAP_SAGE_MODE} reps`
                : `Need ${COST_SWAP_SAGE_MODE - userData.reputationPoints} reps`
        }
        isOpen={isOpen && !!sageMode}
        setIsOpen={setIsOpen}
        isValid={false}
        onAccept={() => {
          if (canAfford && sageMode) {
            swap({ sageModeId: sageMode.id });
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
        {sageMode && !isSwapping && (
          <ItemWithEffects item={sageMode} key={sageMode.id} />
        )}
        {isSwapping && sageMode && (
          <Loader explanation={`Swapping to ${sageMode.name}`} />
        )}
      </Modal2>
    </div>
  );
};

/**
 * Show the user's item-based sage mode rolls and let them claim earned pity rolls.
 * Self-hides when the user has no item rolls.
 */
export const SageModePityRolls: React.FC = () => {
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();

  const { data: prevRolls, isPending: isPendingRolls } =
    api.sageMode.getItemRolls.useQuery(undefined, { enabled: !!userData });

  const { mutate: pityRoll, isPending: isClaiming } = api.sageMode.pityRoll.useMutation(
    {
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.sageMode.getItemRolls.invalidate();
        }
      },
    },
  );

  if (isPendingRolls) return <Loader explanation="Loading previous rolls" />;
  if (!prevRolls || prevRolls.length === 0) return null;

  const itemRolls = prevRolls.map((entry) => {
    const availablePity = getSageModePityRolls(entry);
    // Mirror the FULL server guard (sageMode.ts pityRoll): pity is only claimable when
    // the user has no equipped mode. Sage mode is single-slot and — unlike bloodline —
    // item rolls can still accrue after one is equipped, so this check is load-bearing,
    // not decorative. Without it the button shows for a claim the server will reject.
    const canClaim =
      PITY_SYSTEM_ENABLED &&
      availablePity > 0 &&
      !entry.sageModeId &&
      !!entry.goal &&
      !userData?.sageModeId;
    return {
      ...entry,
      pityButton: (
        <div className="text-center">
          {canClaim && entry.goal ? (
            <Button
              hoverText={`Claim a guaranteed ${entry.goal}-rank sage mode`}
              onClick={() => pityRoll({ rank: entry.goal })}
              disabled={isClaiming}
            >
              <Dices className="h-6 w-6" />
            </Button>
          ) : (
            "N/A"
          )}
          {entry.pityRolls > 0 && <div className="italic">{entry.pityRolls} used</div>}
        </div>
      ),
    };
  });

  type PrevRoll = ArrayElement<typeof itemRolls>;
  const columns: ColumnDefinitionType<PrevRoll, keyof PrevRoll>[] = [
    { key: "goal", header: "Rank", type: "string" },
    { key: "updatedAt", header: "Last Roll", type: "date" },
    { key: "used", header: "#Rolls", type: "string" },
    { key: "pityButton", header: "Pity Rolls", type: "jsx" },
  ];

  return (
    <ContentBox
      title="Sage Mode Rolls"
      subtitle="Overview of your item-based rolls"
      initialBreak={true}
      padding={false}
    >
      <Table data={itemRolls} columns={columns} />
      <p className="p-3 text-xs italic">
        Once you have rolled {PITY_SAGE_MODE_ROLLS} times for a given rank of sage mode
        using items, you earn 1 guaranteed roll of that rank.
      </p>
    </ContentBox>
  );
};

/**
 * Let the user meditate to attempt a one-time natural sage mode roll.
 */
export const RollSageMode: React.FC<{
  refetch: (() => Promise<unknown>) | (() => void);
}> = ({ refetch }) => {
  const utils = api.useUtils();
  const { mutate: roll, isPending: isRolling } = api.sageMode.roll.useMutation({
    onSuccess: async (data) => {
      await refetch();
      showMutationToast({ ...data, title: "Sage Mode Roll" });
      if (data.success) {
        await utils.profile.getUser.invalidate();
      }
    },
  });
  return (
    <Confirm2
      title="Awaken Sage Mode"
      proceed_label={isRolling ? undefined : "Meditate"}
      isValid={!isRolling}
      button={
        <Button id="roll-sage" className="w-full">
          <Sparkles className="mr-2 h-6 w-6" />
          Meditate to Awaken Sage
        </Button>
      }
      onAccept={(e) => {
        e.preventDefault();
        roll();
      }}
    >
      <p>Meditating channels natural energy. Odds of awakening a sage mode:</p>
      <SageRollOdds />
      <p className="mt-2 italic">You may attempt this only once.</p>
    </Confirm2>
  );
};

/**
 * Display the natural sage mode roll odds, mirroring RollBloodline's presentation.
 */
const SageRollOdds: React.FC = () => (
  <ul className="pt-3 pl-5">
    <li>S-Ranked: {ROLL_CHANCE_PERCENTAGE.S * 100}%</li>
    <li>A-Ranked: {ROLL_CHANCE_PERCENTAGE.A * 100}%</li>
    <li>B-Ranked: {ROLL_CHANCE_PERCENTAGE.B * 100}%</li>
    <li>C-Ranked: {ROLL_CHANCE_PERCENTAGE.C * 100}%</li>
  </ul>
);
