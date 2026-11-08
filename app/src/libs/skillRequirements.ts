/** A use requirement refers to an activated SkillTree entry, independent of its effects. */
export type SkillRequirement = { requiredSkillId?: string | null };

export type SkillRequirementUser = {
  activeSkillIds?: string[];
  userSkills?: { skillId?: string; activated?: boolean }[];
};

export const hasRequiredSkill = (
  content: SkillRequirement,
  user: SkillRequirementUser,
): boolean =>
  !content.requiredSkillId ||
  !!user.activeSkillIds?.includes(content.requiredSkillId) ||
  !!user.userSkills?.some(
    (owned) => owned.skillId === content.requiredSkillId && owned.activated === true,
  );

/** Hide skills whose own entry or containing folder is hidden unless hidden content is requested. */
export const isSkillVisible = (
  skill: { hidden: boolean; folder: { hidden: boolean } | null },
  includeHidden: boolean,
) => includeHidden || (!skill.hidden && !skill.folder?.hidden);
