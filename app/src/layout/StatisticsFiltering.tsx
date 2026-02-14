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

interface StatisticsFilteringProps {
  state: StatisticsFilteringState;
}

const makeSchema = () => {
  const now = new Date();
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(now.getMonth() - 1);
  return defineFilteringSchema({
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
        defaultValue: oneMonthAgo.toISOString().slice(0, 10),
      },
      {
        id: "endDate",
        label: "End Date",
        type: "date",
        defaultValue: now.toISOString().slice(0, 10),
      },
    ] as const,
  });
};

const StatisticsFiltering: React.FC<StatisticsFilteringProps> = ({ state }) => {
  return (
    <ContentFiltering
      schema={makeSchema()}
      state={state.cf}
      triggerButtonId="filter-statistics"
    />
  );
};

export default StatisticsFiltering;

export const getFilter = (state: StatisticsFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
    setBattleType: cf.setters.battleType,
    setStartDate: cf.setters.startDate, // yyyy-mm-dd
    setEndDate: cf.setters.endDate, // yyyy-mm-dd
  };
};

export type StatisticsFilteringState = ReturnType<typeof useFiltering>;
