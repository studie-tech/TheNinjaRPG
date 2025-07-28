import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MultiSelect } from "@/components/ui/multi-select";
import { Filter } from "lucide-react";
import { TriStateToggle } from "@/components/control/Toggle";
import { useUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import {
  SupportTicketCategories,
  SupportTicketPriorities,
  SupportTicketStatuses,
  type SupportTicketStatus,
  type SupportTicketPriority,
  type SupportTicketCategory,
} from "@/drizzle/constants";

// Search schema for name field
const searchSchema = z.object({
  search: z.string().optional(),
});

type SearchSchema = z.infer<typeof searchSchema>;

interface SupportTicketFilteringProps {
  state: SupportTicketFilteringState;
}

const SupportTicketFiltering: React.FC<SupportTicketFilteringProps> = (props) => {
  // Global state
  const { data: userData } = useUserData();

  // Destructure the state
  const {
    search,
    status,
    category,
    priority,
    isPublic,
    assignedToUserId,
    createdByUserId,
    setSearch,
    setStatus,
    setCategory,
    setPriority,
    setIsPublic,
    setAssignedToUserId,
    setCreatedByUserId,
  } = props.state;

  // Determine if user is staff
  const isStaff =
    userData?.role && ["ADMIN", "MODERATOR", "SUPPORTER"].includes(userData.role);

  // Get available staff for assignment filter
  const { data } = api.profile.getPublicUsers.useQuery(
    { orderBy: "Staff", isAi: false, limit: 50 },
    { enabled: isStaff },
  );
  const availableStaff = data?.data || [];

  // Search form
  const form = useForm<SearchSchema>({
    resolver: zodResolver(searchSchema),
    defaultValues: { search },
  });
  const watchSearch = useWatch({
    control: form.control,
    name: "search",
    defaultValue: "",
  });

  // Update the search state with debounce
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setSearch(watchSearch || "");
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [watchSearch, setSearch]);

  // Count applied filters
  const getAppliedFiltersCount = () => {
    let count = 0;
    if (search && search.trim() !== "") count++;
    if (status.length > 0) count += status.length;
    if (category.length > 0) count += category.length;
    if (priority.length > 0) count += priority.length;
    if (assignedToUserId !== "None") count++;
    if (createdByUserId !== "None") count++;
    if (isPublic !== undefined) count++;
    return count;
  };

  const appliedFiltersCount = getAppliedFiltersCount();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id="filter-support-tickets" className="relative">
          <Filter className="sm:mr-2 h-6 w-6 hover:text-orange-500" />
          <p className="hidden sm:block">Filter</p>
          {appliedFiltersCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-orange-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
              {appliedFiltersCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="min-w-96">
        <div className="grid grid-cols-2 gap-1 gap-x-3">
          {/* Search */}
          <div className="col-span-2">
            <Form {...form}>
              <Label htmlFor="search">Search</Label>
              <FormField
                control={form.control}
                name="search"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        id="search"
                        placeholder="Search tickets by title or description"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>

          {/* Status */}
          <div>
            <Label htmlFor="status">Status</Label>
            <MultiSelect
              selected={status}
              options={SupportTicketStatuses.map((status) => ({
                value: status,
                label: status.replace("_", " "),
              }))}
              onChange={(value) => setStatus(value as SupportTicketStatus[])}
            />
          </div>

          {/* Category */}
          <div>
            <Label htmlFor="category">Category</Label>
            <MultiSelect
              selected={category}
              options={SupportTicketCategories.map((category) => ({
                value: category,
                label: category.replace("_", " "),
              }))}
              onChange={(value) => setCategory(value as SupportTicketCategory[])}
            />
          </div>

          {/* Priority */}
          <div>
            <Label htmlFor="priority">Priority</Label>
            <MultiSelect
              selected={priority}
              options={SupportTicketPriorities.map((priority) => ({
                value: priority,
                label: priority,
              }))}
              onChange={(value) => setPriority(value as SupportTicketPriority[])}
            />
          </div>

          {/* Assigned To (Staff Only) */}
          {isStaff && (
            <div>
              <Select onValueChange={setAssignedToUserId}>
                <Label htmlFor="assignedTo">Assigned To</Label>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      assignedToUserId === "None"
                        ? "None"
                        : availableStaff?.find((s) => s.userId === assignedToUserId)
                            ?.username || "None"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem key="None" value="None">
                    None
                  </SelectItem>
                  <SelectItem key="unassigned" value="unassigned">
                    Unassigned
                  </SelectItem>
                  {availableStaff
                    ?.sort((a, b) => a.username.localeCompare(b.username))
                    .map((staff) => (
                      <SelectItem key={staff.userId} value={staff.userId}>
                        {staff.username}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Created By (Staff Only) */}
          {isStaff && (
            <div>
              <Select onValueChange={setCreatedByUserId}>
                <Label htmlFor="createdBy">Created By</Label>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem key="None" value="None">
                    None
                  </SelectItem>
                  <SelectItem key="me" value="me">
                    Me
                  </SelectItem>
                  {/* Could add more options here if needed */}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Public Status */}
          <div className="mt-1">
            <Label htmlFor="toggle-public">Public Status</Label>
            <TriStateToggle
              verticalLayout
              id="toggle-public"
              value={isPublic}
              setShowActive={setIsPublic}
              labelActive="Public Only"
              labelInactive="Private Only"
              labelAll="All Tickets"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SupportTicketFiltering;

/** tRPC filter to be used on api.support.getTickets */
export const getFilter = (state: SupportTicketFilteringState) => {
  return {
    search: state.search || undefined,
    status: state.status.length > 0 ? state.status : undefined,
    category: state.category.length > 0 ? state.category : undefined,
    priority: state.priority.length > 0 ? state.priority : undefined,
    assignedToUserId:
      state.assignedToUserId === "None"
        ? undefined
        : state.assignedToUserId === "unassigned"
          ? null
          : state.assignedToUserId || undefined,
    createdByUserId:
      state.createdByUserId === "None"
        ? undefined
        : state.createdByUserId === "me"
          ? "CURRENT_USER" // Special flag that will be replaced with actual userId in the API
          : state.createdByUserId || undefined,
    isPublic: state.isPublic,
  };
};

/** State for the Support Ticket Filtering component */
export const useFiltering = () => {
  // State variables
  const [search, setSearch] = useState<string>("");
  const [status, setStatus] = useState<SupportTicketStatus[]>([
    "OPEN",
    "IN_PROGRESS",
    "WAITING_FOR_STAFF",
  ]);
  const [category, setCategory] = useState<SupportTicketCategory[]>([]);
  const [priority, setPriority] = useState<SupportTicketPriority[]>([]);
  const [assignedToUserId, setAssignedToUserId] = useState<string>("None");
  const [createdByUserId, setCreatedByUserId] = useState<string>("None");
  const [isPublic, setIsPublic] = useState<boolean | undefined>(undefined);

  // Return all
  return {
    search,
    status,
    category,
    priority,
    assignedToUserId,
    createdByUserId,
    isPublic,
    setSearch,
    setStatus,
    setCategory,
    setPriority,
    setAssignedToUserId,
    setCreatedByUserId,
    setIsPublic,
  };
};

/** State type */
export type SupportTicketFilteringState = ReturnType<typeof useFiltering>;
