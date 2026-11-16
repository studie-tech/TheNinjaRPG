import type { RouterOutputs } from "@/app/_trpc/client";
import { COST_SKILL_RESET } from "@/drizzle/constants";
import { effectiveMasteries } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import type { fetchUserSkills } from "@/queries/skillTree";
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

/**
 * Describe the purchased or activated row for the owner's skill views. A purchase that loses
 * its insert race to a concurrent request keeps the generated id until the next read.
 */
export const getPurchasedSkill = ({
  existingUserSkill,
  skill,
  userSkillId,
  userId,
  purchasedAt,
}: {
  existingUserSkill: PurchasedSkill | undefined;
  skill: PurchasedSkill["skill"];
  userSkillId: string;
  userId: string;
  purchasedAt: Date;
}): PurchasedSkill =>
  existingUserSkill
    ? { ...existingUserSkill, activated: true }
    : {
        id: userSkillId,
        userId,
        skillId: skill.id,
        purchasedAt,
        activated: true,
        skill,
      };

/** Activate a confirmed purchase in the owner's skills; an already active skill requires a read. */
export const getPurchasedUserSkills = (
  current: RouterOutputs["skillTree"]["getUserSkills"],
  purchase: PurchasedSkill | undefined,
): RouterOutputs["skillTree"]["getUserSkills"] | undefined => {
  if (!purchase || current.activatedSkillIds.includes(purchase.skillId)) return;
  const isOwned = current.skills.some((entry) => entry.skillId === purchase.skillId);
  return {
    skills: isOwned
      ? current.skills.map((entry) =>
          entry.skillId === purchase.skillId ? purchase : entry,
        )
      : [...current.skills, purchase],
    activatedSkillIds: [...current.activatedSkillIds, purchase.skillId],
    activatedSkillCount: current.activatedSkillCount + 1,
    usedSkillPoints: current.usedSkillPoints + purchase.skill.costSkillPoints,
  };
};

/**
 * Count a confirmed activation in its folder's progress. Totals stay unchanged because a
 * special skill is owned before it can be activated; an unlisted folder requires a read.
 */
export const getPurchasedFolderStats = (
  current: RouterOutputs["skillTree"]["getFolderStats"],
  purchase: PurchasedSkill | undefined,
): RouterOutputs["skillTree"]["getFolderStats"] | undefined => {
  const folderId = purchase?.skill.folderId ?? "";
  if (!purchase || !current.some((entry) => entry.folderId === folderId)) return;
  return current.map((entry) =>
    entry.folderId === folderId
      ? { ...entry, ownedSkills: entry.ownedSkills + 1 }
      : entry,
  );
};

type PurchasedSkill = Awaited<ReturnType<typeof fetchUserSkills>>[number];
