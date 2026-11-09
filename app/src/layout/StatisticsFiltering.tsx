"use client";

import type React from "react";
import { useState } from "react";
import { BattleTypes } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { getLocalDateStringMonthsAgo } from "@/utils/time";

/** Built once per mount, so the default start date follows the day the page opened. */
const makeStatisticsFilteringSchema = () =>
  defineFilteringSchema({
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
      schema={state.schema}
      state={state.cf}
      triggerButtonId="filter-statistics"
    />
  );
};

export default StatisticsFiltering;

export const getFilter = (state: StatisticsFilteringState) =>
  buildFilter(state.cf, state.schema);

export const useFiltering = () => {
  const [schema] = useState(makeStatisticsFilteringSchema);
  const cf = useContentFiltering(schema);
  return {
    ...cf.values,
    cf,
    schema,
  };
};

export type StatisticsFilteringState = ReturnType<typeof useFiltering>;
