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
  monthlySkillResets,
  user,
}: {
  updatedUserRequiresUserRefresh: boolean;
  isFreeReset: boolean;
  monthlySkillResets: {
    month: string;
    count: number;
  };
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
    monthlySkillResets,
    effectiveMasteries: effectiveMasteries({ ...user, userSkills: [] }),
  },
});
