"use client";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { COST_RESET_STATS } from "@/drizzle/constants";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import Loader from "@/layout/Loader";
import DistributeStatsForm from "@/layout/StatsDistributionForm";
import {
  getAssignedCombatStatTotal,
  getRedistributableStatTotal,
} from "@/libs/profile";
import { showMutationToast } from "@/libs/toast";
import { round } from "@/utils/math";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import type { StatSchemaType } from "@/validators/combat";

/**
 * Reset stats component
 */
export const ResetStats: React.FC = () => {
  // State
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const submissionFlight = useSingleFlight();

  // Mutations
  const { mutateAsync: updateStats, isPending } =
    api.blackmarket.updateStats.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _input, revision) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser(data, { revision, delta: data.userDelta }).catch(
            () => undefined,
          );
        }
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const submitStatRedistribution = async (data: StatSchemaType) => {
    await submissionFlight.run(true, async () => {
      try {
        await updateStats(data);
      } catch {
        // The mutation's onError handler displays the actionable error to the user.
      }
    });
  };

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading user" />;

  // Redistribution budget: the same total the server checks against
  const totalStats = getRedistributableStatTotal(userData);
  const unplaceable = getAssignedCombatStatTotal(userData) - totalStats;

  const cost = canChangeContent(userData.role) ? 0 : COST_RESET_STATS;
  const canAfford = userData.reputationPoints >= cost;

  // Show component
  return (
    <div className="flex flex-col gap-3">
      <p>
        Redistribute all your stats ({round(totalStats)} total points). This will cost{" "}
        {cost} reputation points.
      </p>
      {unplaceable > 0 && (
        <p className="font-bold text-orange-500">
          Your stored stats exceed your rank&apos;s redistribution capacity by{" "}
          {round(unplaceable).toLocaleString()} points. Resetting is unavailable until
          your rank caps can hold all your points. Your stored stats are preserved.
        </p>
      )}
      {!canAfford && (
        <p className="font-bold text-red-500">
          You need {cost - userData.reputationPoints} more reputation points to reset
          your stats.
        </p>
      )}
      {canAfford && unplaceable === 0 && (
        <DistributeStatsForm
          userData={userData}
          availableStats={round(totalStats)}
          onAccept={submitStatRedistribution}
          forceUseAll={true}
          isRedistribution={true}
          showWrapper={false}
          isPending={isPending}
          pendingLabel="Redistributing"
        />
      )}
    </div>
  );
};
