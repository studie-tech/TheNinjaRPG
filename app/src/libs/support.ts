import type {
  FederalStatus,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  UserRank,
  UserRole,
} from "@/drizzle/constants";
import { IMG_AVATAR_DEFAULT, SUPPORT_TICKET_COLORS } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";

/**
 * Annonymize user information
 * @param user
 * @param viewerRole
 * @returns
 */
export const anonymizeStaffInfo = (
  user: {
    userId: string;
    username: string;
    avatar: string | null;
    role: UserRole;
    level: number;
    rank: UserRank;
    isOutlaw: boolean;
    federalStatus: FederalStatus;
  },
  viewer: UserData,
) => {
  if (viewer.role === "USER" && user.role !== "USER") {
    return {
      userId: user.userId,
      username: "Staff Member",
      avatar: IMG_AVATAR_DEFAULT,
      role: "USER" as const,
      level: 1,
      rank: "STUDENT" as const,
      isOutlaw: false,
      federalStatus: "NONE" as const,
    };
  }
  return user;
};

// Helper function to get priority color
export const getPriorityColor = (priority: SupportTicketPriority) => {
  return SUPPORT_TICKET_COLORS.PRIORITY[priority] || "bg-gray-100 text-gray-800";
};

// Helper function to get category color
export const getCategoryColor = (category: SupportTicketCategory) => {
  return SUPPORT_TICKET_COLORS.CATEGORY[category] || "bg-gray-100 text-gray-800";
};

// Helper function to get status color
export const getStatusColor = (status: SupportTicketStatus) => {
  return SUPPORT_TICKET_COLORS.STATUS[status] || "bg-gray-100 text-gray-800";
};

export { formatTimeAgo } from "@/utils/time";
