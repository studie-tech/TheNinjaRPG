/** Return the IDs of skills which currently contribute to player progression. */
export const getActivatedSkillIds = (
  userSkills: ReadonlyArray<{ skillId: string; activated: boolean }>,
): Set<string> =>
  new Set(userSkills.filter((skill) => skill.activated).map((skill) => skill.skillId));

/** Pure content-eligibility check shared by battle and non-battle callers. */
export const meetsRequiredSkill = (
  requiredSkillId: string | null,
  activatedSkillIds: ReadonlySet<string>,
  isAi = false,
): boolean =>
  isAi || requiredSkillId === null || activatedSkillIds.has(requiredSkillId);

/**
 * Skill-gate status for UI that may render before `getUserSkills` resolves.
 * Pass `activatedSkillIds = null` while the skills query is still pending/errored
 * so callers do not treat an empty set as "player has no skills".
 */
export type RequiredSkillStatus = "pending" | "met" | "unmet";

export const getRequiredSkillStatus = (
  requiredSkillId: string | null,
  activatedSkillIds: ReadonlySet<string> | null,
  isAi = false,
): RequiredSkillStatus => {
  if (isAi || requiredSkillId === null) return "met";
  if (activatedSkillIds === null) return "pending";
  return activatedSkillIds.has(requiredSkillId) ? "met" : "unmet";
};
