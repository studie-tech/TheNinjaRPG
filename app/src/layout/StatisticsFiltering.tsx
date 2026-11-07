"use client";

import type React from "react";
import { BattleTypes } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { getLocalDateStringMonthsAgo } from "@/utils/time";

const statisticsFilteringSchema = defineFilteringSchema({
  fields: [
    {
      id: "battleType",
      label: "Battle Type",
      type: "single-select",
      defaultValue: "None",
      includeNone: true,
      emptyValues: ["None"],
      options: [{ value: "None", label: "All" }, ...toOptions(BattleTypes)],
    },
    {
      id: "startDate",
      label: "Start Date",
      type: "date",
      defaultValue: getLocalDateStringMonthsAgo(1),
    },
    {
      id: "endDate",
      label: "End Date",
      type: "date",
      defaultValue: "",
    },
  ] as const,
});

interface StatisticsFilteringProps {
  state: StatisticsFilteringState;
}

const StatisticsFiltering: React.FC<StatisticsFilteringProps> = ({ state }) => {
  return (
    <ContentFiltering
      schema={statisticsFilteringSchema}
      state={state.cf}
      triggerButtonId="filter-statistics"
    />
  );
};

export default StatisticsFiltering;

export const getFilter = (state: StatisticsFilteringState) =>
  buildFilter(state.cf, statisticsFilteringSchema);

export const useFiltering = () => {
  const cf = useContentFiltering(statisticsFilteringSchema);
  return {
    ...cf.values,
    cf,
  };
};

export type StatisticsFilteringState = ReturnType<typeof useFiltering>;
