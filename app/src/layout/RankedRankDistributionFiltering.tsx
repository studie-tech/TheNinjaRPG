"use client";

import { MAX_PLAYER_LEVEL } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  minCountField,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface RankedRankDistributionFilteringProps {
  state: RankedRankDistributionFilteringState;
}

const RANKED_RANK_DISTRIBUTION_FILTERING_SCHEMA = defineFilteringSchema({
  fields: [
    minCountField,
    {
      id: "minLevel",
      label: "Min Level",
      type: "number",
      defaultValue: undefined,
      min: 1,
      max: MAX_PLAYER_LEVEL,
    },
    {
      id: "maxLevel",
      label: "Max Level",
      type: "number",
      defaultValue: undefined,
      min: 1,
      max: MAX_PLAYER_LEVEL,
    },
  ] as const,
});

const RankedRankDistributionFiltering: React.FC<
  RankedRankDistributionFilteringProps
> = (props) => {
  return (
    <ContentFiltering
      schema={RANKED_RANK_DISTRIBUTION_FILTERING_SCHEMA}
      state={props.state.cf}
      triggerButtonId="filter-ranked-rank-dist"
    />
  );
};

export default RankedRankDistributionFiltering;

export const getFilter = (state: RankedRankDistributionFilteringState) =>
  buildFilter(state.cf, RANKED_RANK_DISTRIBUTION_FILTERING_SCHEMA);

export const useFiltering = () => {
  const cf = useContentFiltering(RANKED_RANK_DISTRIBUTION_FILTERING_SCHEMA);
  return {
    ...cf.values,
    cf,
  };
};

export type RankedRankDistributionFilteringState = ReturnType<typeof useFiltering>;
