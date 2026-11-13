import { useMemo } from "react";
import { api } from "@/app/_trpc/client";
import {
  SupportTicketCategories,
  SupportTicketPriorities,
  SupportTicketStatuses,
} from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { canViewStaffOnlyComments } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";

interface SupportTicketFilteringProps {
  state: SupportTicketFilteringState;
}

/** Staff options load after mount, and "Me" resolves to the viewer's own id. */
const makeSupportSchema = (
  staff: { userId: string; username: string }[],
  isStaff: boolean,
  userId: string | undefined,
) =>
  defineFilteringSchema({
    fields: [
      { id: "search", label: "Search", type: "text", defaultValue: "" },
      {
        id: "status",
        label: "Status",
        type: "multi-select",
        defaultValue: ["IN_PROGRESS", "OPEN", "WAITING_FOR_STAFF"],
        options: toOptions(SupportTicketStatuses),
      },
      {
        id: "category",
        label: "Category",
        type: "multi-select",
        defaultValue: [],
        options: toOptions(SupportTicketCategories),
      },
      {
        id: "priority",
        label: "Priority",
        type: "multi-select",
        defaultValue: [],
        options: toOptions(SupportTicketPriorities),
      },
      {
        id: "assignedToUserId",
        label: "Assigned To",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: [
          { value: "unassigned", label: "Unassigned" },
          ...staff.map((s) => ({ value: s.userId, label: s.username })),
        ],
        visibleIf: () => isStaff,
      },
      {
        id: "createdByUserId",
        label: "Created By",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: [{ value: "me", label: "Me" }],
        normalizeForFilter: (value) => (value === "me" ? userId : value),
        visibleIf: () => isStaff,
      },
      {
        id: "isPublic",
        label: "Public Status",
        type: "tri-state",
        defaultValue: undefined,
        triStateLabels: {
          labelActive: "Public Only",
          labelInactive: "Private Only",
          labelAll: "All Tickets",
        },
      },
    ] as const,
  });

const SupportTicketFiltering: React.FC<SupportTicketFilteringProps> = (props) => (
  <ContentFiltering
    schema={props.state.schema}
    state={props.state.cf}
    triggerButtonId="filter-support-tickets"
  />
);

export default SupportTicketFiltering;

export const getFilter = (state: SupportTicketFilteringState) =>
  buildFilter(state.cf, state.schema);

export const useFiltering = () => {
  const { data: userData } = useUserDataSelector((u) => ({
    role: u.role,
    userId: u.userId,
  }));
  const isStaff = Boolean(userData?.role && canViewStaffOnlyComments(userData.role));
  const userId = userData?.userId;
  const { data } = api.profile.getPublicUsers.useQuery(
    { orderBy: "Staff", isAi: false, limit: 50 },
    { enabled: isStaff },
  );
  const schema = useMemo(
    () =>
      makeSupportSchema(
        (data?.data || []).map((u) => ({ userId: u.userId, username: u.username })),
        isStaff,
        userId,
      ),
    [data, isStaff, userId],
  );
  const cf = useContentFiltering(schema);
  return {
    ...cf.values,
    cf,
    schema,
  };
};

export type SupportTicketFilteringState = ReturnType<typeof useFiltering>;
