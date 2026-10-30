"use client";

import { useRef } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import DistributeStatsForm from "@/layout/StatsDistributionForm";
import { experienceAssignmentBlockMessage } from "@/libs/profile";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

export default function AssignExperience() {
  // State
  const { data: userData, updateUser, prepareUserUpdate } = useRequiredUserData();
  const utils = api.useUtils();
  const submissionInFlight = useRef(false);

  // Mutations
  const { mutateAsync: updateStats, isPending } = allocateExperience.useMutation({
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
    if (submissionInFlight.current) return false;

    submissionInFlight.current = true;
    return (
      updateStats(data)
        .then((result) => result.success)
        // The shared tRPC error handler reports failures; retain the current draft.
        .catch(() => false)
        .finally(() => {
          submissionInFlight.current = false;
        })
    );
  };

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  const assignmentBlock = experienceAssignmentBlockMessage(userData);
  if (assignmentBlock)
    return (
      <ContentBox
        title="Elite Jonin progression"
        subtitle="Academy milestones"
        defaultBackHref="/profile"
      >
        <p>{assignmentBlock}</p>
        <Link href="/academy" className="underline">
          View milestones at the academy
        </Link>
      </ContentBox>
    );

  // Show component
  return (
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
  );
}

// Alias the procedure so its action name is not interpreted as a React hook.
const allocateExperience = api.profile.useUnusedExperiencePoints;
