import { COST_SKILL_RESET } from "@/drizzle/constants";
import { effectiveMasteries } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";

import type { fetchUpdatedUser } from "@/routers/profile";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { UserCachePatch } from "@/validators/userCache";

/**
 * Combine confirmed progression with activated skills and recompute their mastery and energy
 * limits.
 */
export const getPurchaseSkillUserUpdate = ({
  progressionUserPatch,
  activatedSkills,
  user,
}: {
  progressionUserPatch: UserCachePatch | undefined;
  activatedSkills: NonNullable<NonNullable<UserWithRelations>["userSkills"]>;
  user: NonNullable<NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>>["user"]>;
}) => ({
  userPatch: {
    ...progressionUserPatch,
    userSkills: activatedSkills,
    effectiveMasteries: effectiveMasteries({
      ...user,
      userSkills: activatedSkills,
    }),
    maxEnergy: calcMaxEnergy({ ...user, userSkills: activatedSkills }),
  },
});

/**
 * Clear skills, recompute derived limits and record the applicable monthly reset count. Debit
 * reputation for paid resets only when the profile is settled.
 */
export const getResetSkillPointsUserUpdate = ({
  updatedUserRequiresUserRefresh,
  isFreeReset,
  resetState,
  isStaffFreeReset,
  user,
}: {
  updatedUserRequiresUserRefresh: boolean;
  isFreeReset: boolean;
  resetState: {
    month: string;
    count: number;
  };
  isStaffFreeReset: boolean;
  user: NonNullable<NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>>["user"]>;
}) => ({
  userDelta: updatedUserRequiresUserRefresh
    ? undefined
    : isFreeReset
      ? {}
      : { reputationPoints: -COST_SKILL_RESET },
  userPatch: {
    maxEnergy: calcMaxEnergy({ ...user, userSkills: [] }),
    userSkills: [],
    monthlySkillResets: {
      ...resetState,
      count: resetState.count + (isStaffFreeReset ? 0 : 1),
    },
    effectiveMasteries: effectiveMasteries({ ...user, userSkills: [] }),
  },
});
