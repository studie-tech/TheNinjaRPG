"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { COST_SKILL_RESET } from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import Countdown from "@/layout/Countdown";
import Loader from "@/layout/Loader";
import { freeResetNote } from "@/libs/skillReset";
import { showMutationToast } from "@/libs/toast";
import { isStaffMember } from "@/utils/permissions";
import { getFirstOfNextMonth } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Reset skills component
 */
export const ResetSkills: React.FC = () => {
  // State
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const utils = api.useUtils();

  // Get reset info
  const { data: resetInfo } = api.skillTree.getResetInfo.useQuery();

  // Mutations
  const { mutate: resetSkills, isPending } = api.skillTree.resetSkillPoints.useMutation(
    {
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _input, revision) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            updateUser(data, { revision, delta: data.userDelta }),
            utils.skillTree.getUserSkills.invalidate(),
            utils.skillTree.getResetInfo.invalidate(),
          ]);
        }
      },
    },
  );

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading user" />;

  // Guards
  const isFree = resetInfo?.isFree;
  const canAffordPaid = userData.reputationPoints >= COST_SKILL_RESET;
  const canAfford = Boolean(isFree) || canAffordPaid;

  // Skill resets renew monthly
  const skillResetResetTime = getFirstOfNextMonth();

  return (
    <div className="space-y-4 p-4">
      {/* Skill Reset Timer */}
      {resetInfo && !resetInfo.isFree && (
        <div className="mb-4 rounded-lg bg-slate-100 p-4 dark:bg-slate-800">
          <div className="space-y-2 text-center">
            <p className="text-muted-foreground text-sm">
              You have used {resetInfo.freeResetsUsed} shared Skills / Bloodright resets
              this month.
              {resetInfo.freeResetsRemaining === 0 &&
                " You must wait for monthly reset or pay reputation points."}
            </p>
            <p className="font-semibold text-lg">
              Next free skill reset available:{" "}
              <Countdown targetDate={skillResetResetTime} />
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2 pb-4">
        <p className="text-muted-foreground text-sm">
          This will reset all your skill tree investments and refund all spent skill
          points.
        </p>
      </div>

      <Confirm
        title="Confirm Skill Reset"
        button={
          <Button
            id="reset-skills"
            type="submit"
            className="w-full"
            disabled={!canAfford || isPending}
            variant={canAfford ? "default" : "destructive"}
          >
            {isPending ? (
              <Loader size={5} />
            ) : isFree ? (
              `Reset Skills (${freeResetNote(
                isStaffMember(userData),
                resetInfo?.freeResetsRemaining ?? 0,
                "free shared resets",
              )})`
            ) : canAffordPaid ? (
              `Reset Skills for ${COST_SKILL_RESET} Reps`
            ) : (
              `Need ${COST_SKILL_RESET - userData.reputationPoints} More Reps`
            )}
          </Button>
        }
        onAccept={(e) => {
          e.preventDefault();
          resetSkills();
        }}
      >
        This will reset all your skill tree investments and refund all spent skill
        points
        {isFree
          ? isStaffMember(userData)
            ? " (Free for staff member)"
            : " (Free shared monthly reset)"
          : ` for ${COST_SKILL_RESET} reputation points`}
        . This action cannot be undone. Are you sure you want to continue?
      </Confirm>
    </div>
  );
};
