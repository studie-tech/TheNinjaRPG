import { SKILL_TREE_MAX_TIER } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  hiddenVisibilityField,
  useContentEditContext,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { tagTypes } from "@/validators/combat";

interface SkillTreeFilteringProps {
  state: SkillTreeFilteringState;
  isBloodright?: boolean;
}

const SKILL_TREE_FILTERING_SCHEMA = defineFilteringSchema({
  fields: [
    { id: "name", label: "Name", type: "text", defaultValue: "" },
    {
      id: "effect",
      label: "Effects",
      type: "multi-select",
      defaultValue: [],
      options: tagTypes.map((ef) => ({ value: ef, label: ef })),
    },
    {
      id: "tier",
      label: "Tier",
      type: "single-select",
      noneOption: { value: "ANY", label: "ANY" },
      defaultValue: "ANY",
      emptyValues: ["ANY"],
      options: Array.from({ length: SKILL_TREE_MAX_TIER }, (_, i) => ({
        value: (i + 1).toString(),
        label: `Tier ${i + 1}`,
      })),
      normalizeForFilter: (v: string) => (v === "ANY" ? null : Number(v)),
    },
    {
      id: "costSkillPoints",
      label: "Skill Points Cost",
      visibleIf: (ctx) =>
        !(ctx as { isBloodright?: boolean } | undefined)?.isBloodright,
      type: "single-select",
      noneOption: { value: "ANY", label: "ANY" },
      defaultValue: "ANY",
      emptyValues: ["ANY"],
      options: [1, 2, 3, 4, 5, 10, 15, 20].map((c) => ({
        value: c.toString(),
        label: `${c} points`,
      })),
      normalizeForFilter: (v: string) => (v === "ANY" ? null : Number(v)),
    },
    hiddenVisibilityField(false),
  ] as const,
});

const SkillTreeFiltering: React.FC<SkillTreeFilteringProps> = (props) => {
  const context = { ...useContentEditContext(), isBloodright: props.isBloodright };
  return (
    <ContentFiltering
      schema={SKILL_TREE_FILTERING_SCHEMA}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-skill"
    />
  );
};

export default SkillTreeFiltering;

export const getFilter = (state: SkillTreeFilteringState) =>
  buildFilter(state.cf, SKILL_TREE_FILTERING_SCHEMA);

export const useFiltering = () => {
  const cf = useContentFiltering(SKILL_TREE_FILTERING_SCHEMA);
  return {
    ...cf.values,
    cf,
  };
};

export type SkillTreeFilteringState = ReturnType<typeof useFiltering>;
