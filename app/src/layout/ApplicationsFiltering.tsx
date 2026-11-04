"use client";

import {
  StaffApplicationStates,
  StaffApplicationTargetRoles,
} from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface ApplicationsFilteringProps {
  state: ApplicationsFilteringState;
}

// Single-source schema for applications
const makeApplicationsFilteringSchema = () =>
  defineFilteringSchema({
    fields: [
      {
        id: "username",
        label: "Username",
        type: "text",
        defaultValue: "",
      },
      {
        id: "state",
        label: "State",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: toOptions(StaffApplicationStates),
      },
      {
        id: "targetRole",
        label: "Target Role",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: toOptions(StaffApplicationTargetRoles),
      },
      {
        id: "onlyMine",
        label: "Only My Applications",
        type: "tri-state",
        defaultValue: undefined,
        // Treat true as onlyMine, false as not-only-mine filter (omit), undefined => omit
        normalizeForFilter: (v: boolean | undefined) => (v ? true : undefined),
      },
    ] as const,
  });

const ApplicationsFiltering: React.FC<ApplicationsFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={makeApplicationsFilteringSchema()}
      state={props.state.cf}
      triggerButtonId="filter-applications"
    />
  );
};

export default ApplicationsFiltering;

export const getApplicationsFilter = (state: ApplicationsFilteringState) =>
  buildFilter(state.cf, makeApplicationsFilteringSchema());

export const useApplicationsFiltering = () => {
  const cf = useContentFiltering(makeApplicationsFilteringSchema());
  return {
    ...cf.values,
    cf,
  };
};

export type ApplicationsFilteringState = ReturnType<typeof useApplicationsFiltering>;
