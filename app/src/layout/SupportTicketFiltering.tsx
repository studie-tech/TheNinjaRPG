import { api } from "@/app/_trpc/client";
import {
  SupportTicketCategories,
  type SupportTicketCategory,
  SupportTicketPriorities,
  type SupportTicketPriority,
  type SupportTicketStatus,
  SupportTicketStatuses,
} from "@/drizzle/constants";
import {
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { useUserData } from "@/utils/UserContext";

interface SupportTicketFilteringProps {
  state: SupportTicketFilteringState;
}

const makeSupportSchema = (
  staff: { userId: string; username: string }[],
  isStaff: boolean,
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
          { value: "None", label: "None" },
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
        options: [
          { value: "None", label: "None" },
          { value: "me", label: "Me" },
        ],
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

const SupportTicketFiltering: React.FC<SupportTicketFilteringProps> = (props) => {
  const { data: userData } = useUserData();
  const isStaff = Boolean(
    userData?.role && ["ADMIN", "MODERATOR", "SUPPORTER"].includes(userData.role),
  );
  const { data } = api.profile.getPublicUsers.useQuery(
    { orderBy: "Staff", isAi: false, limit: 50 },
    { enabled: isStaff },
  );
  const staff = (data?.data || []).map((u) => ({
    userId: u.userId,
    username: u.username,
  }));
  const schema = makeSupportSchema(staff, isStaff);
  return (
    <ContentFiltering
      schema={schema}
      state={props.state.cf}
      triggerButtonId="filter-support-tickets"
    />
  );
};

export default SupportTicketFiltering;

// Strongly-typed filter payload to satisfy consumers
interface SupportTicketFilter {
  search?: string;
  status?: SupportTicketStatus[];
  category?: SupportTicketCategory[];
  priority?: SupportTicketPriority[];
  assignedToUserId?: string;
  createdByUserId?: string;
  isPublic?: boolean;
}

export const getFilter = (state: SupportTicketFilteringState): SupportTicketFilter => {
  const { debounced } = state.cf;
  const createdByUserId = debounced.createdByUserId as string | undefined;
  const assignedToUserId = debounced.assignedToUserId as string | undefined;
  return {
    search:
      debounced.search && debounced.search.length > 0 ? debounced.search : undefined,
    status:
      Array.isArray(debounced.status) && debounced.status.length > 0
        ? debounced.status
        : undefined,
    category:
      Array.isArray(debounced.category) && debounced.category.length > 0
        ? debounced.category
        : undefined,
    priority:
      Array.isArray(debounced.priority) && debounced.priority.length > 0
        ? debounced.priority
        : undefined,
    assignedToUserId:
      assignedToUserId && assignedToUserId !== "None" ? assignedToUserId : undefined,
    createdByUserId:
      createdByUserId === "me"
        ? "CURRENT_USER"
        : createdByUserId && createdByUserId !== "None"
          ? createdByUserId
          : undefined,
    isPublic: typeof debounced.isPublic === "boolean" ? debounced.isPublic : undefined,
  };
};

export const useFiltering = () => {
  const { data: userData } = useUserData();
  const isStaff = Boolean(
    userData?.role && ["ADMIN", "MODERATOR", "SUPPORTER"].includes(userData.role),
  );
  const { data } = api.profile.getPublicUsers.useQuery(
    { orderBy: "Staff", isAi: false, limit: 50 },
    { enabled: isStaff },
  );
  const staff = (data?.data || []).map((u) => ({
    userId: u.userId,
    username: u.username,
  }));
  const cf = useContentFiltering(makeSupportSchema(staff, isStaff));
  return {
    ...cf.values,
    cf,
    setSearch: cf.setters.search,
    setStatus: cf.setters.status,
    setCategory: cf.setters.category,
    setPriority: cf.setters.priority,
    setAssignedToUserId: cf.setters.assignedToUserId,
    setCreatedByUserId: cf.setters.createdByUserId,
    setIsPublic: cf.setters.isPublic,
  };
};

export type SupportTicketFilteringState = ReturnType<typeof useFiltering>;
