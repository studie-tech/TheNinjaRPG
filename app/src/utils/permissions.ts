import { UserRoles } from "@/drizzle/constants";
import type { UserData, UserRank, UserReport } from "@/drizzle/schema";
import type { UserRole } from "@/drizzle/constants";
import type { SupportTicket } from "@/drizzle/schema";
import { SUPPORT_TICKET_STATUS_TRANSITIONS } from "@/drizzle/constants";
import type { SupportTicketStatus } from "@/drizzle/constants";
import type { User2Conversation, Conversation } from "@/drizzle/schema";

export const canChangeContent = (role: UserRole) => {
  return [
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "CONTENT-ADMIN",
    "CODER",
  ].includes(role);
};

export const canTakeKage = (role: UserRole) => {
  return [
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "CODING-ADMIN",
    "MODERATOR",
    "HEAD_MODERATOR",
    "MODERATOR-ADMIN",
    "CONTENT-ADMIN",
    "CODER",
  ].includes(role);
};

export const canModerateReskin = (role: UserRole) => {
  return role !== "USER";
};

export const canControlBackups = (role: UserRole) => {
  return ["CODING-ADMIN", "CONTENT-ADMIN", "EVENT-ADMIN"].includes(role);
};

// Recruitment analytics visibility (admins only)
export const canViewRecruitmentAnalytics = (role: UserRole) => {
  return role !== "USER";
};

// Revenue analytics visibility (coding admin only)
export const canViewRevenueAnalytics = (role: UserRole) => {
  return ["CODING-ADMIN", "CONTENT-ADMIN"].includes(role);
};

export const canPlayHiddenQuests = (role: UserRole) => {
  return ["CONTENT", "EVENT", "CONTENT-ADMIN", "EVENT-ADMIN"].includes(role);
};

export const canSubmitNotification = (role: UserRole) => {
  return [
    "CODER",
    "CONTENT",
    "EVENT",
    "HEAD_MODERATOR",
    "MODERATOR",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
  ].includes(role);
};

export const canPostAsAi = (role: UserRole) => {
  return ["EVENT", "CODING-ADMIN", "CONTENT-ADMIN", "EVENT-ADMIN"].includes(role);
};

export const canTransferJutsu = (user?: UserData) => {
  if (!user) return false;
  return user.role !== "USER" || user.staffAccount;
};

export const canUseMonitoringTests = (role: UserRole) => {
  return ["CODING-ADMIN"].includes(role);
};

export const canModifyEventGains = (role: UserRole) => {
  return ["CODING-ADMIN", "CONTENT-ADMIN", "EVENT-ADMIN", "CONTENT"].includes(role);
};

export const canEnableGlobalTavern = (role: UserRole) => {
  return ["CODING-ADMIN", "CONTENT-ADMIN", "EVENT-ADMIN", "MODERATOR-ADMIN"].includes(role);
};

export const canChangeDefaultAiProfile = (role: UserRole) => {
  return ["CODING-ADMIN", "CONTENT-ADMIN", "EVENT-ADMIN"].includes(role);
};

export const canAdministrateWars = (role: UserRole) => {
  return ["CODING-ADMIN", "CONTENT-ADMIN", "CONTENT", "EVENT", "EVENT-ADMIN"].includes(
    role,
  );
};

export const canChangeUserRolesTo = (role: UserRole): UserRole[] => {
  if (role === "CODING-ADMIN") {
    return Array.from(UserRoles);
  } else if (role === "CONTENT-ADMIN") {
    return ["USER", "CONTENT", "CONTENT-ADMIN"];
  } else if (role === "EVENT-ADMIN") {
    return ["USER", "EVENT", "EVENT-ADMIN"];
  } else if (role === "MODERATOR-ADMIN") {
    return ["USER", "HEAD_MODERATOR", "MODERATOR", "JR_MODERATOR"];
  } else if (role === "HEAD_MODERATOR") {
    return ["USER", "MODERATOR", "JR_MODERATOR"];
  } else if (role === "CONTENT") {
    return ["CONTENT"];
  } else if (role === "EVENT") {
    return ["EVENT"];
  } else if (role === "CODER") {
    return ["CODER"];
  }
  return [];
};

export const canSwapVillage = (role: UserRole) => {
  return role !== "USER";
};

export const canUnstuckVillage = (role: UserRole) => {
  return role !== "USER";
};

export const canSwapBloodline = (role: UserRole) => {
  return !!role; // Allow all roles to swap bloodline
};

export const canSeeSecretData = (role: UserRole) => {
  return [
    "JR_MODERATOR",
    "MODERATOR",
    "HEAD_MODERATOR",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
  ].includes(role);
};

export const canSeeIps = (role: UserRole) => {
  return ["HEAD_MODERATOR", "CODING-ADMIN", "MODERATOR-ADMIN"].includes(role);
};

export const canSeeActivityEvents = (role: UserRole) => {
  return role !== "USER";
};

export const canRestoreActivityStreak = (role: UserRole) => {
  return role !== "USER";
};

export const canModifyUserBadges = (role: UserRole) => {
  return [
    "CODING-ADMIN",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "EVENT",
    "CONTENT",
    "MODERATOR-ADMIN",
    "HEAD_MODERATOR",
    "MODERATOR",
  ].includes(role);
};

export const canDeleteUsers = (role: UserRole) => {
  return ["MODERATOR-ADMIN", "CODING-ADMIN", "HEAD_MODERATOR"].includes(role);
};

export const canModerateRoles: UserRole[] = [
  "JR_MODERATOR",
  "MODERATOR",
  "HEAD_MODERATOR",
  "MODERATOR-ADMIN",
  "CODING-ADMIN",
] as const;
export const canModerate = (role: UserRole) => {
  return canModerateRoles.includes(role);
};

export const canCreateNews = (role: UserRole) => {
  return role !== "USER";
};

export const canSeeReport = (user: UserData, report: UserReport) => {
  return (
    report.reporterUserId === user.userId ||
    report.reportedUserId === user.userId ||
    canModerateRoles.includes(user.role)
  );
};

export const canPostReportComment = (report: UserReport) => {
  return ["UNVIEWED", "BAN_ESCALATED"].includes(report.status);
};

export const canModerateReports = (user: UserData, report: UserReport) => {
  return (
    report.reportedUserId !== user.userId &&
    ((user.role === "MODERATOR-ADMIN" && report.status === "UNVIEWED") ||
      (user.role === "CODING-ADMIN" && report.status === "UNVIEWED") ||
      (user.role === "MODERATOR" && report.status === "UNVIEWED") ||
      (user.role === "HEAD_MODERATOR" && report.status === "UNVIEWED") ||
      (user.role === "JR_MODERATOR" && report.status === "UNVIEWED") ||
      (user.role === "MODERATOR-ADMIN" && report.status === "OFFICIAL_WARNING") ||
      (user.role === "MODERATOR-ADMIN" && report.status === "BAN_ACTIVATED") ||
      (user.role === "MODERATOR-ADMIN" && report.status === "BAN_ESCALATED") ||
      (user.role === "MODERATOR-ADMIN" && report.status === "SILENCE_ACTIVATED") ||
      (user.role === "MODERATOR-ADMIN" && report.status === "SILENCE_ESCALATED") ||
      (user.role === "CODING-ADMIN" && report.status === "OFFICIAL_WARNING") ||
      (user.role === "CODING-ADMIN" && report.status === "BAN_ACTIVATED") ||
      (user.role === "CODING-ADMIN" && report.status === "BAN_ESCALATED") ||
      (user.role === "CODING-ADMIN" && report.status === "SILENCE_ACTIVATED") ||
      (user.role === "CODING-ADMIN" && report.status === "SILENCE_ESCALATED") ||
      (user.role === "HEAD_MODERATOR" && report.status === "BAN_ACTIVATED") ||
      (user.role === "HEAD_MODERATOR" && report.status === "BAN_ESCALATED") ||
      (user.role === "HEAD_MODERATOR" && report.status === "SILENCE_ACTIVATED") ||
      (user.role === "HEAD_MODERATOR" && report.status === "SILENCE_ESCALATED") ||
      (user.role === "MODERATOR" && report.status === "OFFICIAL_WARNING") ||
      (user.role === "MODERATOR" && report.status === "SILENCE_ACTIVATED"))
  );
};

export const canBanUsers = (user: UserData) => {
  return ["MODERATOR-ADMIN", "HEAD_MODERATOR", "MODERATOR", "CODING-ADMIN"].includes(
    user.role,
  );
};

export const canSilenceUsers = (user: UserData) => {
  return [
    "MODERATOR-ADMIN",
    "HEAD_MODERATOR",
    "MODERATOR",
    "JR_MODERATOR",
    "CODING-ADMIN",
  ].includes(user.role);
};

export const canWarnUsers = (user: UserData) => {
  return [
    "MODERATOR-ADMIN",
    "HEAD_MODERATOR",
    "MODERATOR",
    "JR_MODERATOR",
    "CODING-ADMIN",
  ].includes(user.role);
};

export const canDeleteComment = (user: UserData, commentAuthorId: string) => {
  return (
    ["MODERATOR", "HEAD_MODERATOR", "CODING-ADMIN", "MODERATOR-ADMIN"].includes(
      user.role,
    ) || user.userId === commentAuthorId
  );
};

export const canEscalateBan = (user: UserData, report: UserReport) => {
  return (
    !report.adminResolved &&
    !canModerateReports(user, report) &&
    report.status === "BAN_ACTIVATED" &&
    report.banEnd &&
    report.banEnd > new Date()
  );
};

export const canClearReport = (user: UserData, report: UserReport) => {
  return (
    // Moderators
    canModerateReports(user, report) ||
    // Users with finished bans
    (report.status === "BAN_ACTIVATED" &&
      report.banEnd &&
      report.banEnd <= new Date() &&
      report.reportedUserId === user.userId)
  );
};

export const canClearUserNindo = (user: UserData) => {
  return ["MODERATOR", "HEAD_MODERATOR", "CODING-ADMIN", "MODERATOR-ADMIN"].includes(
    user.role,
  );
};

export const canEditPublicUser = (user: UserData) => {
  return [
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "MODERATOR-ADMIN",
    "CODER",
  ].includes(user.role);
};

export const canAwardReputation = (role: UserRole) => {
  return ["MODERATOR-ADMIN", "CODING-ADMIN", "CONTENT-ADMIN", "EVENT-ADMIN"].includes(
    role,
  );
};

export const canReviewLinkPromotions = (role: UserRole) => {
  return ["CODING-ADMIN"].includes(role);
};

export const canEditClans = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "CONTENT",
    "EVENT-ADMIN",
    "CODER",
  ].includes(role);
};

export const canAddNonCustomPollOptions = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "EVENT-ADMIN",
    "EVENT",
    "CONTENT",
  ].includes(role);
};

export const canCreatePolls = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "EVENT-ADMIN",
    "EVENT",
    "CONTENT",
  ].includes(role);
};

export const canEditPolls = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "EVENT-ADMIN",
    "EVENT",
    "CONTENT",
  ].includes(role);
};

export const canClosePolls = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "EVENT-ADMIN",
    "EVENT",
    "CONTENT",
  ].includes(role);
};

export const canDeletePollOptions = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "EVENT-ADMIN",
    "EVENT",
    "CONTENT",
  ].includes(role);
};

export const canViewFullBattleLog = (role: UserRole) => {
  return [
    "CODER",
    "CONTENT",
    "EVENT",
    "CODING-ADMIN",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
  ].includes(role);
};

export const canCloneUser = (role: UserRole) => {
  return ["CODING-ADMIN", "CONTENT-ADMIN", "EVENT-ADMIN"].includes(role);
};

export const canInteractWithPolls = (rank: UserRank) => {
  return rank !== "STUDENT";
};

export const canClearSectors = (role: UserRole) => {
  return ["CODING-ADMIN", "CONTENT-ADMIN", "CONTENT", "EVENT", "EVENT-ADMIN"].includes(
    role,
  );
};

export const canDeleteReferral = (role: UserRole) => {
  return ["HEAD_MODERATOR", "MODERATOR-ADMIN", "CODING-ADMIN"].includes(role);
};
// Staff applications
export const canDeleteStaffApplication = (role: UserRole) => {
  return role === "CODING-ADMIN";
};

export const canUnequipAllUsers = (user: UserData) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
  ].includes(user.role);
};

export const canEditUsername = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "HEAD_MODERATOR",
    "MODERATOR",
    "CODER",
  ].includes(role);
};

export const canEditCustomTitle = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "CODER",
  ].includes(role);
};

export const canEditBloodline = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "CODER",
  ].includes(role);
};

export const canEditVillage = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "CODER",
  ].includes(role);
};

export const canEditRank = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "CODER",
  ].includes(role);
};

export const canEditJutsus = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "CODER",
  ].includes(role);
};

export const canEditItems = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "CODER",
  ].includes(role);
};

export const canEditQuests = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "CODER",
  ].includes(role);
};

export const canEditStarterQuests = (role: UserRole) => {
  return ["CODING-ADMIN"].includes(role);
};

export const canEditStaffAccountFlag = (role: UserRole) => {
  return (
    role === "CODING-ADMIN" ||
    role === "CONTENT-ADMIN" ||
    role === "EVENT-ADMIN" ||
    role === "MODERATOR-ADMIN"
  );
};

export const canEditRankedLp = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "CODING-ADMIN",
    "CONTENT",
    "EVENT",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "CODER",
  ].includes(role);
};

export const canSeeHiddenBountyInfo = (role: UserRole) => {
  return role !== "USER";
};

export const canReskinFreely = (role: UserRole) => {
  return [
    "CODER",
    "CONTENT",
    "EVENT",
    "HEAD_MODERATOR",
    "MODERATOR",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "CONTENT-ADMIN",
  ].includes(role);
};

/**
 * SUPPORT SYSTEM PERMISSIONS
 */
export const canViewSupportTicket = (
  ticket: SupportTicket,
  userId: string,
  userRole: UserRole,
) => {
  if (ticket.createdByUserId === userId) return true;
  if (ticket.isPublic) return true;
  if (userRole !== "USER") return true;
  if (ticket.assignedToUserId === userId) return true;
  return false;
};

export const canEditSupportTicket = (
  ticket: SupportTicket,
  userId: string,
  userRole: UserRole,
) => {
  if (userRole !== "USER") return true;
  if (ticket.assignedToUserId === userId) return true;
  if (
    ticket.createdByUserId === userId &&
    (ticket.status === "OPEN" || ticket.status === "WAITING_FOR_USER")
  )
    return true;
  return false;
};

export const canDeleteSupportTicket = (
  ticket: SupportTicket,
  userId: string,
  userRole: UserRole,
) => {
  if (userRole !== "USER") return true;
  if (ticket.createdByUserId === userId) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return ticket.createdAt > dayAgo && !ticket.assignedToUserId;
  }
  return false;
};

export const canAssignSupportTicket = (userRole: UserRole) => {
  return userRole !== "USER";
};

export function canEscalateToGithub(userRole: UserRole): boolean {
  return userRole.includes("ADMIN") || userRole.includes("CONTENT");
}

export const canMergeSupportTickets = (userRole: UserRole) => {
  return userRole !== "USER";
};

export const canViewSupportStatistics = (userRole: UserRole) => {
  return userRole !== "USER";
};

export function canViewStaffOnlyComments(userRole: UserRole): boolean {
  return userRole !== "USER";
}

export function canTransitionStatus(
  fromStatus: SupportTicketStatus,
  toStatus: SupportTicketStatus,
): boolean {
  const allowedTransitions = SUPPORT_TICKET_STATUS_TRANSITIONS[fromStatus] || [];
  return allowedTransitions.includes(toStatus);
}

export const canViewConversation = (
  conversation: Conversation & { users: User2Conversation[] },
  userId: string,
  userRole: UserRole,
) => {
  const isPublic = conversation.isPublic;
  const inConversation = conversation.users.some((u) => u.userId === userId);
  const isStaffAvailable = conversation.isStaffAvailable;
  if (isPublic || inConversation) return true;
  if (isStaffAvailable && userRole !== "USER") return true;
  return false;
};

export const canEditCannedResponses = (userRole: UserRole) => {
  return userRole !== "USER";
};

export const canAwardExperience = (user: UserData) => {
  return ["CODING-ADMIN", "CODER"].includes(user.role);
};

export const canRollPrimaryElement = (user: UserData) => {
  return !["STUDENT", "NONE"].includes(user.rank);
};

export const canRollSecondaryElement = (user: UserData) => {
  return !["STUDENT", "GENIN", "NONE"].includes(user.rank);
};
