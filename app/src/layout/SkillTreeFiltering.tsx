import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import { effectFilters } from "@/validators/combat";

interface SkillTreeFilteringProps {
  state: SkillTreeFilteringState;
}

const makeSkillTreeSchema = () =>
  defineFilteringSchema({
    fields: [
      { id: "name", label: "Name", type: "text", defaultValue: "" },
      {
        id: "effect",
        label: "Effects",
        type: "multi-select",
        defaultValue: [],
        options: effectFilters.map((ef) => ({ value: ef, label: ef })),
      },
      {
        id: "tier",
        label: "Tier",
        type: "single-select",
        noneOption: { value: "ANY", label: "ANY" },
        defaultValue: "ANY",
        emptyValues: ["ANY"],
        options: Array.from({ length: 10 }, (_, i) => ({
          value: (i + 1).toString(),
          label: `Tier ${i + 1}`,
        })),
        normalizeForFilter: (v: string) => (v === "ANY" ? null : Number(v)),
      },
      {
        id: "costSkillPoints",
        label: "Skill Points Cost",
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
      {
        id: "hidden",
        label: "Visibility",
        type: "tri-state",
        defaultValue: false,
        visibleIf: (ctx) =>
          Boolean((ctx as { canEdit?: boolean } | undefined)?.canEdit),
        triStateLabels: {
          labelActive: "Hidden",
          labelInactive: "Visible",
          labelAll: "All Visibility",
        },
      },
    ] as const,
  });

const SkillTreeFiltering: React.FC<SkillTreeFilteringProps> = (props) => {
  const { data: userData } = useUserData();
  const context = { canEdit: Boolean(userData && canChangeContent(userData.role)) };
  return (
    <ContentFiltering
      schema={makeSkillTreeSchema()}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-skill"
    />
  );
};

export default SkillTreeFiltering;

export const getFilter = (state: SkillTreeFilteringState) =>
  buildFilter(state.cf, makeSkillTreeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSkillTreeSchema());
  return {
    ...cf.values,
    cf,
    setName: cf.setters.name,
    setEffect: cf.setters.effect,
    setTier: cf.setters.tier as React.Dispatch<React.SetStateAction<number | "ANY">>,
    setCostSkillPoints: cf.setters.costSkillPoints as React.Dispatch<
      React.SetStateAction<number | "ANY">
    >,
    setHidden: cf.setters.hidden,
  };
};

export type SkillTreeFilteringState = ReturnType<typeof useFiltering>;
