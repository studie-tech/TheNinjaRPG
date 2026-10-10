"use client";

import { useRef } from "react";
import { api } from "@/app/_trpc/client";
import { ElementalMastery } from "@/layout/ElementalMastery";
import Loader from "@/layout/Loader";
import DistributeStatsForm from "@/layout/StatsDistributionForm";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

export default function AssignExperience() {
  // State
  const { data: userData, updateUser, prepareUserUpdate } = useRequiredUserData();
  const utils = api.useUtils();
  const submissionInFlight = useRef(false);

  // Mutations
  const { mutateAsync: updateStats, isPending } =
    api.profile.useUnusedExperiencePoints.useMutation({
      onMutate: () => ({ userRevision: prepareUserUpdate() }),
      onSuccess: async (result, _variables, context) => {
        showMutationToast(result);
        if (result.success)
          await updateUser(result.userPatch, { revision: context?.userRevision });
        else await utils.profile.getUser.invalidate();
      },
      onError: async () => {
        await utils.profile.getUser.invalidate();
      },
    });

  const submitStats = async (data: Parameters<typeof updateStats>[0]) => {
    if (submissionInFlight.current) return;

    submissionInFlight.current = true;
    try {
      await updateStats(data);
    } catch {
      // The shared tRPC error handler reports failures; retain the current draft.
    } finally {
      submissionInFlight.current = false;
    }
  };

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Show component
  return (
    <>
      <DistributeStatsForm
        includeMasteries
        id="tutorial-unassigned-stats-contentbox"
        userData={userData}
        onAccept={submitStats}
        availableStats={userData.earnedExperience}
        title="Assign Experience Points"
        subtitle={`You have ${userData.earnedExperience.toLocaleString()} unused experience points`}
        defaultBackHref="/profile"
        isPending={isPending}
        pendingLabel="Assigning"
      />
      <ElementalMastery mode="experience" />
    </>
  );
}
