import type React from "react";
import { SKILL_TREE_MAX_TIER } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  minCountField,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { tagTypes } from "@/validators/combat";

interface SkillTreeBalanceFilteringProps {
  state: SkillTreeBalanceFilteringState;
}

/** Skill usage filters; multi-select values are strings, so tiers convert back to numbers. */
const SKILL_TREE_BALANCE_FILTERING_SCHEMA = defineFilteringSchema({
  fields: [
    minCountField,
    {
      id: "skillEffects",
      label: "Skill Effects",
      type: "multi-select",
      defaultValue: [],
      options: tagTypes.map((effect) => ({ value: effect, label: effect })),
    },
    {
      id: "tiers",
      label: "Skill Tiers",
      type: "multi-select",
      defaultValue: [],
      options: Array.from({ length: SKILL_TREE_MAX_TIER }, (_, i) => ({
        value: (i + 1).toString(),
        label: `Tier ${i + 1}`,
      })),
      normalizeForFilter: (tiers: string[]) => tiers.map(Number),
    },
  ] as const,
});

const SkillTreeBalanceFiltering: React.FC<SkillTreeBalanceFilteringProps> = (props) => (
  <ContentFiltering
    schema={SKILL_TREE_BALANCE_FILTERING_SCHEMA}
    state={props.state.cf}
    triggerButtonId="filter-skill-tree-balance"
  />
);

export default SkillTreeBalanceFiltering;

export const getFilter = (state: SkillTreeBalanceFilteringState) =>
  buildFilter(state.cf, SKILL_TREE_BALANCE_FILTERING_SCHEMA);

export const useFiltering = () => {
  const cf = useContentFiltering(SKILL_TREE_BALANCE_FILTERING_SCHEMA);
  return {
    ...cf.values,
    cf,
  };
};

export type SkillTreeBalanceFilteringState = ReturnType<typeof useFiltering>;
