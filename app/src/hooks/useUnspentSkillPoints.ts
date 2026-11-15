import { api } from "@/app/_trpc/client";
import { SKILL_TREE_REQUIRED_RANK } from "@/drizzle/constants";
import { hasRequiredRank } from "@/libs/rank";
import { useUserDataSelector } from "@/utils/UserContext";

/**
 * Skill points the player has earned but not activated on the skill tree. Zero below the
 * skill tree rank and until the activated skills have loaded. Purchases and resets
 * invalidate the skills query, so the count follows them.
 */
export const useUnspentSkillPoints = () => {
  const { data: skillPoints } = useUserDataSelector((user) =>
    hasRequiredRank(user.rank, SKILL_TREE_REQUIRED_RANK) ? user.skillPoints : null,
  );
  const enabled = typeof skillPoints === "number";
  const { data: userSkills } = api.skillTree.getUserSkills.useQuery(undefined, {
    enabled,
    staleTime: 300_000,
  });
  if (!enabled || !userSkills) return 0;
  return Math.max(0, skillPoints - userSkills.usedSkillPoints);
};
