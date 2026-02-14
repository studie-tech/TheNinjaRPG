"use client";

import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface RankedRankDistributionFilteringProps {
  state: RankedRankDistributionFilteringState;
}

const makeSchema = () =>
  defineFilteringSchema({
    fields: [
      {
        id: "minCount",
        label: "Minimum Count",
        type: "number",
        defaultValue: undefined,
        normalizeForFilter: (v) => (v !== undefined && v >= 1 ? v : undefined),
      },
      { id: "minLevel", label: "Min Level", type: "number", defaultValue: undefined },
      { id: "maxLevel", label: "Max Level", type: "number", defaultValue: undefined },
    ] as const,
  });

const RankedRankDistributionFiltering: React.FC<
  RankedRankDistributionFilteringProps
> = (props) => {
  return (
    <ContentFiltering
      schema={makeSchema()}
      state={props.state.cf}
      triggerButtonId="filter-ranked-rank-dist"
    />
  );
};

export default RankedRankDistributionFiltering;

export const getFilter = (state: RankedRankDistributionFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
    setMinCount: cf.setters.minCount,
    setMinLevel: cf.setters.minLevel,
    setMaxLevel: cf.setters.maxLevel,
  };
};

export type RankedRankDistributionFilteringState = ReturnType<typeof useFiltering>;
