"use client";

import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface RankedLoadoutFilteringProps {
  state: RankedLoadoutFilteringState;
}

const makeSchema = () =>
  defineFilteringSchema({
    fields: [
      {
        id: "types",
        label: "Types",
        type: "multi-select",
        defaultValue: ["jutsu", "item", "consumable"],
        options: [
          { value: "jutsu", label: "Jutsu" },
          { value: "item", label: "Item" },
          { value: "consumable", label: "Consumable" },
        ],
      },
      {
        id: "name",
        label: "Name",
        type: "text",
        defaultValue: "",
        normalizeForFilter: (v: string) => v.trim(),
      },
      {
        id: "minCount",
        label: "Minimum Count",
        type: "number",
        defaultValue: undefined,
        normalizeForFilter: (v) => (v !== undefined && v >= 1 ? v : undefined),
      },
    ] as const,
  });

const RankedLoadoutFiltering: React.FC<RankedLoadoutFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={makeSchema()}
      state={props.state.cf}
      triggerButtonId="filter-ranked-loadout"
    />
  );
};

export default RankedLoadoutFiltering;

export const getFilter = (state: RankedLoadoutFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
    setTypes: cf.setters.types,
    setName: cf.setters.name,
    setMinCount: cf.setters.minCount,
  };
};

export type RankedLoadoutFilteringState = ReturnType<typeof useFiltering>;
