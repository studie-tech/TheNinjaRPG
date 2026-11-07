"use client";

import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  minCountField,
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
      minCountField,
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
  };
};

export type RankedLoadoutFilteringState = ReturnType<typeof useFiltering>;
