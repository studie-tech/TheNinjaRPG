"use client";

import { GraduationCap } from "lucide-react";
import { useRef } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import LevelUpBtn from "@/layout/LevelUpBtn";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import DistributeStatsForm from "@/layout/StatsDistributionForm";
import { experienceAssignmentBlockMessage, levelUpBlockMessage } from "@/libs/profile";
import { showMutationToast } from "@/libs/toast";
import { isTutorialActive } from "@/libs/tutorial";
import { useRequiredUserData } from "@/utils/UserContext";

/** Render the profile experience screen independently of its route adapter. */
export function AssignExperienceScreen() {
  // State
  const { data: userData, updateUser, prepareUserUpdate } = useRequiredUserData();
  const utils = api.useUtils();
  const submissionInFlight = useRef(false);

  // Mutations
  const { mutateAsync: updateStats, isPending } = allocateExperience.useMutation({
    onMutate: () => ({ userRevision: prepareUserUpdate() }),
    onSuccess: async (result, _variables, context) => {
      showMutationToast(result);
      await updateUser(result, { revision: context?.userRevision });
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

  // Show component. Assigning and levelling are one motion, so a level the assigned
  // experience allows is offered at the top of the form.
  // Masteries and elements stay out of the tutorial: only combat stats count
  // towards a level, which is what its assignment lessons build up to.
  return (
    <div data-spotlight-panel="">
      <DistributeStatsForm
        leading={
          !levelUpBlockMessage(userData) && (
            <LevelReady nextLevel={userData.level + 1} />
          )
        }
        includeMasteries={!isTutorialActive(userData)}
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
    </div>
  );
}

/** The level the assigned experience has earned, offered above the allocation. */
const LevelReady: React.FC<{ nextLevel: number }> = ({ nextLevel }) => (
  // A row beside the button where the box is wide enough, stacked on a phone.
  <div className="@container mb-4">
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/60 bg-amber-100/60 p-3 @lg:flex-row @lg:items-center dark:bg-amber-900/20">
      <GraduationCap className="hidden h-8 w-8 shrink-0 text-amber-700 @lg:block dark:text-amber-400" />
      <div className="min-w-0 grow">
        <p className="font-bold">Level {nextLevel} is ready</p>
        <p className="text-muted-foreground">
          Your assigned experience covers the next level.
        </p>
      </div>
      <LevelUpBtn id="tutorial-level-up-experience" className="shrink-0 @lg:w-48" />
    </div>
  </div>
);

// Alias the procedure so its action name is not interpreted as a React hook.
const allocateExperience = api.profile.useUnusedExperiencePoints;
