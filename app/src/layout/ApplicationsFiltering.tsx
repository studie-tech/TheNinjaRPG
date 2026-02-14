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
import { canViewAllApplications } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

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
        filterKey: "username",
      },
      {
        id: "state",
        label: "State",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: toOptions(StaffApplicationStates),
        filterKey: "state",
        normalizeForFilter: (v: string) => (v === "None" ? undefined : v),
      },
      {
        id: "targetRole",
        label: "Target Role",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: toOptions(["None", ...StaffApplicationTargetRoles] as const),
        filterKey: "targetRole",
        normalizeForFilter: (v: string) => (v === "None" ? undefined : v),
      },
      {
        id: "onlyMine",
        label: "Only My Applications",
        type: "tri-state",
        defaultValue: undefined,
        filterKey: "onlyMine",
        // Treat true as onlyMine, false as not-only-mine filter (omit), undefined => omit
        normalizeForFilter: (v: boolean | undefined) => (v ? true : undefined),
      },
    ] as const,
  });

const ApplicationsFiltering: React.FC<ApplicationsFilteringProps> = (props) => {
  const { data: userData } = useUserData();
  const canViewAll = userData?.role ? canViewAllApplications(userData.role) : false;
  const context = { role: userData?.role, canViewAll };
  return (
    <ContentFiltering
      schema={makeApplicationsFilteringSchema()}
      state={props.state.cf}
      context={context}
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
    setUsername: cf.setters.username,
    setState: cf.setters.state,
    setTargetRole: cf.setters.targetRole,
    setOnlyMine: cf.setters.onlyMine,
  };
};

export type ApplicationsFilteringState = ReturnType<typeof useApplicationsFiltering>;
