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
