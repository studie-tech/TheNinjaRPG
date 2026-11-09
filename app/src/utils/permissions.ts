import type {
  BanState,
  QuestType,
  StaffApprovalGroup,
  SupportTicketStatus,
  UserRole,
} from "@/drizzle/constants";
import {
  ABANDONABLE_QUEST_TYPES,
  CREATOR_USERNAME,
  isStaffApprovalGroup,
  MESSAGING_MIN_LEVEL,
  messagingLevelMessage,
  SUPPORT_TICKET_STATUS_TRANSITIONS,
  UserRoles,
} from "@/drizzle/constants";
import type {
  Conversation,
  SupportTicket,
  User2Conversation,
  UserData,
  UserRank,
  UserReport,
} from "@/drizzle/schema";

// Annotated rather than `as const` so `.includes` accepts any role.
const SENIOR_ADMIN_ROLES: readonly UserRole[] = [
  "OWNER",
  "CODING-ADMIN",
  "CONTENT-ADMIN",
  "EVENT-ADMIN",
];
const ADMIN_ROLES: readonly UserRole[] = [...SENIOR_ADMIN_ROLES, "MODERATOR-ADMIN"];
const ADMIN_AND_HEAD_MODERATOR_ROLES: readonly UserRole[] = [
  ...ADMIN_ROLES,
  "HEAD_MODERATOR",
];
const CONTENT_TEAM_ROLES: readonly UserRole[] = [
  "CONTENT",
  "BALANCE",
  "HEAD_CONTENT",
  "HEAD_BALANCE",
];
const EVENT_TEAM_ROLES: readonly UserRole[] = ["EVENT", "HEAD_EVENT"];
const WAR_MANAGER_ROLES: readonly UserRole[] = [
  ...SENIOR_ADMIN_ROLES,
  ...CONTENT_TEAM_ROLES,
  ...EVENT_TEAM_ROLES,
];
const CONTENT_MANAGER_ROLES: readonly UserRole[] = [
  ...ADMIN_ROLES,
  ...CONTENT_TEAM_ROLES,
  ...EVENT_TEAM_ROLES,
];
const CONTENT_EDITOR_ROLES: readonly UserRole[] = [...CONTENT_MANAGER_ROLES, "CODER"];
const SENIOR_STAFF_ROLES: readonly UserRole[] = [
  ...CONTENT_EDITOR_ROLES,
  "HEAD_MODERATOR",
  "MODERATOR",
];

/** Moderation always rests with these three; each report state adds its own reviewers. */
const REPORT_ADMIN_ROLES: readonly UserRole[] = [
  "MODERATOR-ADMIN",
  "OWNER",
  "CODING-ADMIN",
];
const REPORT_MODERATORS: Record<BanState, readonly UserRole[]> = {
  UNVIEWED: [
    ...REPORT_ADMIN_ROLES,
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "HEAD_MODERATOR",
    "MODERATOR",
    "JR_MODERATOR",
  ],
  OFFICIAL_WARNING: [...REPORT_ADMIN_ROLES, "MODERATOR"],
  BAN_ACTIVATED: [...REPORT_ADMIN_ROLES, "HEAD_MODERATOR"],
  BAN_ESCALATED: [...REPORT_ADMIN_ROLES, "HEAD_MODERATOR"],
  // Moderators must retain access to clear trade bans after the initial decision.
  TRADE_BAN_ACTIVATED: [...REPORT_ADMIN_ROLES, "HEAD_MODERATOR", "MODERATOR"],
  SILENCE_ACTIVATED: [...REPORT_ADMIN_ROLES, "HEAD_MODERATOR", "MODERATOR"],
  SILENCE_ESCALATED: [...REPORT_ADMIN_ROLES, "HEAD_MODERATOR"],
  TIMEOUT_ACTIVATED: [
    ...REPORT_ADMIN_ROLES,
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "HEAD_MODERATOR",
    "MODERATOR",
  ],
  REPORT_CLEARED: [],
};

export const canChangeContent = (role: UserRole) => CONTENT_EDITOR_ROLES.includes(role);

export const isStaffMember = (user: Pick<UserData, "staffAccount">) => {
  return user.staffAccount;
};

export const isStaffRole = (role?: UserRole | null) => {
  return !!role && role !== "USER";
};

/**
 * Allow non-moderation staff to suggest content using the shared staff eligibility rule.
 * Missing roles and ordinary players cannot submit suggestions.
 */
export const canSuggestContent = (role?: UserRole | null) => {
  return canAccessHiddenSkillTree(role);
};

export const canAccessHiddenSkillTree = (role?: UserRole | null) => {
  return (
    isStaffRole(role) &&
    !["MODERATOR", "MODERATOR-ADMIN", "HEAD_MODERATOR", "JR_MODERATOR"].includes(
      role ?? "USER",
    )
  );
};

export const canMarkAdminResolved = (role: UserRole) =>
  ADMIN_AND_HEAD_MODERATOR_ROLES.includes(role);

export const canTakeKage = (role: UserRole) => SENIOR_STAFF_ROLES.includes(role);

export const canModerateReskin = (role: UserRole) => {
  return isStaffRole(role);
};

export const canControlBackups = (role: UserRole) => SENIOR_ADMIN_ROLES.includes(role);

// Recruitment analytics visibility (any staff role)
export const canViewRecruitmentAnalytics = (role: UserRole) => {
  return isStaffRole(role);
};

// Revenue analytics visibility (owner, coding and content admins)
export const canViewRevenueAnalytics = (role: UserRole) => {
  return ["OWNER", "CODING-ADMIN", "CONTENT-ADMIN"].includes(role);
};

export const canPlayHiddenQuests = (role: UserRole) => {
  return [
    "CONTENT",
    "BALANCE",
    "HEAD_CONTENT",
    "HEAD_BALANCE",
    "EVENT",
    "HEAD_EVENT",
    "CODER",
    "OWNER",
    "CODING-ADMIN",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
  ].includes(role);
};

/** Regular players abandon only the listed quest types; every other role abandons any. */
export const canAbandonQuestType = (role: UserRole, questType: QuestType) =>
  role !== "USER" ||
  (ABANDONABLE_QUEST_TYPES as readonly QuestType[]).includes(questType);

export const canSubmitNotification = (role: UserRole) =>
  SENIOR_STAFF_ROLES.includes(role);

export const canPostAsAi = (role: UserRole) => {
  return [
    "EVENT",
    "HEAD_EVENT",
    "OWNER",
    "CODING-ADMIN",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
  ].includes(role);
};

export const canTransferJutsu = (user?: UserData) => {
  if (!user) return false;
  return user.role !== "USER" || user.staffAccount;
};

/**
 * The site owner's own account, matched by username: no role grant confers its powers
 * (delisting any ryo offer before its freeze ends, renaming user ids).
 */
export const isSiteOwnerAccount = (user: Pick<UserData, "username">) =>
  user.username === CREATOR_USERNAME;

export const canUseMonitoringTests = (role: UserRole) => {
  return ["OWNER"].includes(role);
};

export const canModifyEventGains = (role: UserRole) => {
  return [
    "OWNER",
    "CODING-ADMIN",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "CONTENT",
    "BALANCE",
    "HEAD_CONTENT",
    "HEAD_BALANCE",
  ].includes(role);
};

/**
 * Combat formula settings are balance/content controls, not event gain controls.
 */
export const canModifyCombatSettings = (role: UserRole) => {
  return canChangeContent(role);
};

export const canEnableGlobalTavern = (role: UserRole) => ADMIN_ROLES.includes(role);

export const canChangeDefaultAiProfile = (role: UserRole) =>
  SENIOR_ADMIN_ROLES.includes(role);

export const canAdministrateWars = (role: UserRole) => WAR_MANAGER_ROLES.includes(role);

/** Staff roles are granted through the staff application; this role may promote players directly. */
export const canPromoteUsersToStaff = (role: UserRole) => role === "CODING-ADMIN";

export const canChangeUserRolesTo = (role: UserRole): UserRole[] => {
  if (role === "OWNER") {
    return Array.from(UserRoles);
  } else if (role === "CODING-ADMIN") {
    return ["USER", "CODER", "CODING-ADMIN"];
  } else if (role === "CONTENT-ADMIN") {
    return [
      "USER",
      "CONTENT",
      "BALANCE",
      "HEAD_CONTENT",
      "HEAD_BALANCE",
      "CONTENT-ADMIN",
    ];
  } else if (role === "EVENT-ADMIN") {
    return ["USER", "EVENT", "HEAD_EVENT", "EVENT-ADMIN"];
  } else if (role === "MODERATOR-ADMIN") {
    return ["USER", "HEAD_MODERATOR", "MODERATOR", "JR_MODERATOR"];
  } else if (role === "HEAD_MODERATOR") {
    return ["USER", "MODERATOR", "JR_MODERATOR"];
  } else if (role === "HEAD_CONTENT" || role === "HEAD_BALANCE") {
    return ["USER", "CONTENT", "BALANCE"];
  } else if (role === "CONTENT") {
    return ["CONTENT"];
  } else if (role === "BALANCE") {
    return ["BALANCE"];
  } else if (role === "HEAD_EVENT") {
    return ["USER", "EVENT"];
  } else if (role === "EVENT") {
    return ["EVENT"];
  } else if (role === "CODER") {
    return ["CODER"];
  }
  return [];
};

export const canSwapVillage = (role: UserRole) => {
  return isStaffRole(role);
};

export const canUnstuckVillage = (role: UserRole) => {
  return isStaffRole(role);
};

/** Staff can restore image attempts when a companion generation needs support. */
export const canResetPetImageGeneration = (role: UserRole) => isStaffRole(role);

export const canSeeSecretData = (role: UserRole) => {
  return [
    "CONTENT",
    "BALANCE",
    "HEAD_CONTENT",
    "HEAD_BALANCE",
    "JR_MODERATOR",
    "MODERATOR",
    "HEAD_MODERATOR",
    "OWNER",
    "CODING-ADMIN",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
  ].includes(role);
};

export const canSeeIps = (role: UserRole) => {
  return ["HEAD_MODERATOR", "OWNER", "CODING-ADMIN", "MODERATOR-ADMIN"].includes(role);
};

export const canSeeActivityEvents = (role: UserRole) => {
  return isStaffRole(role);
};

export const canModifyUserBadges = (role: UserRole) => {
  return [
    "OWNER",
    "CODING-ADMIN",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "EVENT",
    "HEAD_EVENT",
    "CONTENT",
    "BALANCE",
    "HEAD_CONTENT",
    "HEAD_BALANCE",
    "MODERATOR-ADMIN",
    "HEAD_MODERATOR",
    "MODERATOR",
  ].includes(role);
};

export const canDeleteUsers = (role: UserRole) => {
  return ["MODERATOR-ADMIN", "OWNER", "HEAD_MODERATOR"].includes(role);
};

export const canModerateRoles: UserRole[] = [
  "JR_MODERATOR",
  "MODERATOR",
  "HEAD_MODERATOR",
  "MODERATOR-ADMIN",
  "OWNER",
  "CODING-ADMIN",
  "CONTENT-ADMIN",
  "EVENT-ADMIN",
];
export const canModerate = (role: UserRole) => {
  return canModerateRoles.includes(role);
};

/** Look up Discord links, their history and abuse flags. */
export const canViewDiscordLinks = (role: UserRole) => canModerate(role);

/** Remove another character's Discord link and resync its Discord state. */
export const canManageDiscordLinks = (role: UserRole) => {
  return [
    "MODERATOR",
    "HEAD_MODERATOR",
    "MODERATOR-ADMIN",
    "OWNER",
    "CODING-ADMIN",
  ].includes(role);
};

export const canCreateNews = (role: UserRole) => {
  return isStaffRole(role);
};

export const canSeeReport = (user: UserData, report: UserReport) => {
  if (report.reporterUserId === user.userId || report.reportedUserId === user.userId)
    return true;
  if (canTimeoutUsers(user))
    return report.status === "UNVIEWED" || report.status === "TIMEOUT_ACTIVATED";
  return canModerate(user.role);
};

export const canPostReportComment = (report: UserReport) => {
  return ["UNVIEWED", "BAN_ESCALATED"].includes(report.status);
};

export const canModerateReports = (user: UserData, report: UserReport) => {
  return (
    report.reportedUserId !== user.userId &&
    REPORT_MODERATORS[report.status].includes(user.role)
  );
};

export const canBanUsers = (user: UserData) => {
  return [
    "MODERATOR-ADMIN",
    "HEAD_MODERATOR",
    "MODERATOR",
    "OWNER",
    "CODING-ADMIN",
  ].includes(user.role);
};

export const canSilenceUsers = (user: UserData) => {
  return [
    "MODERATOR-ADMIN",
    "HEAD_MODERATOR",
    "MODERATOR",
    "JR_MODERATOR",
    "OWNER",
    "CODING-ADMIN",
  ].includes(user.role);
};

/** Timeout: timed silence. Usable by CONTENT-ADMIN and EVENT-ADMIN only. */
export const canTimeoutUsers = (user: UserData) => {
  return ["CONTENT-ADMIN", "EVENT-ADMIN"].includes(user.role);
};

export const canWarnUsers = (user: UserData) => {
  return [
    "MODERATOR-ADMIN",
    "HEAD_MODERATOR",
    "MODERATOR",
    "JR_MODERATOR",
    "OWNER",
    "CODING-ADMIN",
  ].includes(user.role);
};

export const canDeleteComment = (user: UserData, commentAuthorId: string) => {
  return (
    [
      "MODERATOR",
      "HEAD_MODERATOR",
      "OWNER",
      "CODING-ADMIN",
      "MODERATOR-ADMIN",
      "CONTENT-ADMIN",
      "EVENT-ADMIN",
    ].includes(user.role) || user.userId === commentAuthorId
  );
};

export const canDeleteConceptArt = (role: UserRole) =>
  ADMIN_AND_HEAD_MODERATOR_ROLES.includes(role);

/** Returns a restriction message if the user is banned or silenced, otherwise null. */
export const getBanOrSilenceRestriction = (
  user: Pick<UserData, "isBanned" | "isSilenced">,
): string | null => {
  if (user.isBanned) return "You are banned";
  if (user.isSilenced) return "You are silenced";
  return null;
};

/** Returns a restriction message if the user cannot use messaging, otherwise null. */
export const getMessagingRestriction = (
  user: Pick<UserData, "isBanned" | "isSilenced" | "level">,
): string | null => {
  const banOrSilence = getBanOrSilenceRestriction(user);
  if (banOrSilence) return banOrSilence;
  if ((user.level ?? 0) < MESSAGING_MIN_LEVEL) return messagingLevelMessage;
  return null;
};

export const RESTRICTED_SUPPORT_TICKET_REPLY_MESSAGE =
  "You can only reply to support tickets you created while banned or silenced";

export const RESTRICTED_STAFF_CONVERSATION_MESSAGE =
  "You cannot participate in this conversation while banned or silenced";

/**
 * Banned/silenced users may only reply to support tickets they created.
 * Staff applications and other people's tickets are not allowed.
 * Returns false unless the user is banned or silenced — callers must not
 * treat this as a general compose permission for unrestricted users.
 */
export const canReplyToStaffConversationWhileRestricted = (
  user: Pick<UserData, "userId" | "isBanned" | "isSilenced">,
  supportTicketCreatedByUserId: string | null | undefined,
): boolean => {
  if (!user.isBanned && !user.isSilenced) return false;
  if (!supportTicketCreatedByUserId) return false;
  return supportTicketCreatedByUserId === user.userId;
};

/**
 * Why a user cannot post in a conversation, or null when they can. The server enforces
 * this on every post; the client reads it to choose between the composer and its message.
 */
export const getConversationComposeRestriction = (
  user:
    | Pick<UserData, "userId" | "isBanned" | "isSilenced" | "level">
    | null
    | undefined,
  convo:
    | { sendRestriction?: string | null; isStaffAvailable?: boolean }
    | null
    | undefined,
  supportTicketCreatedByUserId: string | null | undefined,
): string | null => {
  if (convo?.sendRestriction) return convo.sendRestriction;
  const messagingRestriction = user ? getMessagingRestriction(user) : null;
  if (!user || !messagingRestriction) return messagingRestriction;
  // Only banned/silenced users may post in staff conversations (own help tickets).
  // Other restrictions (e.g. level gate) are never bypassed.
  if ((!user.isBanned && !user.isSilenced) || !convo?.isStaffAvailable) {
    return messagingRestriction;
  }
  if (canReplyToStaffConversationWhileRestricted(user, supportTicketCreatedByUserId)) {
    return null;
  }
  return supportTicketCreatedByUserId
    ? RESTRICTED_SUPPORT_TICKET_REPLY_MESSAGE
    : RESTRICTED_STAFF_CONVERSATION_MESSAGE;
};

export const canEscalateBan = (user: UserData, report: UserReport) => {
  return (
    report.reportedUserId === user.userId &&
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
  return ["MODERATOR", "HEAD_MODERATOR", "OWNER", "MODERATOR-ADMIN"].includes(
    user.role,
  );
};

export const canOnlyEditSelf = (userRole: UserRole) => {
  return ["CONTENT", "BALANCE", "EVENT", "CODER"].includes(userRole);
};

/** Whether a role limited to editing itself is acting on someone else. */
export const isRestrictedToSelf = (
  role: UserRole,
  actorId: string | undefined,
  targetId: string,
) => canOnlyEditSelf(role) && actorId !== targetId;

export const canAwardReputation = (role: UserRole) => ADMIN_ROLES.includes(role);

export const canReviewLinkPromotions = (role: UserRole) => {
  return ["OWNER"].includes(role);
};

export const canEditClans = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "OWNER",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "CONTENT",
    "BALANCE",
    "HEAD_CONTENT",
    "HEAD_BALANCE",
    "EVENT-ADMIN",
    "CODER",
  ].includes(role);
};

export const canAddNonCustomPollOptions = (role: UserRole) =>
  CONTENT_MANAGER_ROLES.includes(role);

export const canCreatePolls = (role: UserRole) => CONTENT_MANAGER_ROLES.includes(role);

export const canEditPolls = (role: UserRole) => CONTENT_MANAGER_ROLES.includes(role);

export const canClosePolls = (role: UserRole) => CONTENT_MANAGER_ROLES.includes(role);

export const canDeletePollOptions = (role: UserRole) => {
  return [
    "CONTENT-ADMIN",
    "OWNER",
    "CODING-ADMIN",
    "MODERATOR-ADMIN",
    "EVENT-ADMIN",
    "EVENT",
    "HEAD_EVENT",
    "CONTENT",
    "BALANCE",
    "HEAD_CONTENT",
    "HEAD_BALANCE",
    "HEAD_MODERATOR",
    "MODERATOR",
  ].includes(role);
};

export const canViewFullBattleLog = (role: UserRole) =>
  SENIOR_STAFF_ROLES.includes(role);

export const canViewOtherUsersBattleLogs = (role: UserRole) =>
  ADMIN_AND_HEAD_MODERATOR_ROLES.includes(role);

export const canCloneUser = (role: UserRole) => SENIOR_ADMIN_ROLES.includes(role);

export const canInteractWithPolls = (rank: UserRank) => {
  return rank !== "STUDENT";
};

export const canClearSectors = (role: UserRole) => WAR_MANAGER_ROLES.includes(role);

export const canDeleteReferral = (role: UserRole) => {
  return ["HEAD_MODERATOR", "MODERATOR-ADMIN", "OWNER"].includes(role);
};
// Staff applications
export const canDeleteStaffApplication = (role: UserRole) => {
  return role === "OWNER";
};

export const canViewAllApplications = (role: UserRole) => {
  if (getApprovalGroup(role) !== null) return true;
  return ["HEAD_CONTENT", "HEAD_BALANCE", "HEAD_EVENT", "HEAD_MODERATOR"].includes(
    role,
  );
};

export const canApproveApplications = (role: UserRole) => {
  return getApprovalGroup(role) !== null;
};

/**
 * Helper to get the approval group for a user role.
 * OWNER approvals are recorded under CODING-ADMIN so they count toward the
 * coding approval lane.
 */
export const getApprovalGroup = (role: UserRole): StaffApprovalGroup | null => {
  if (role === "OWNER") return "CODING-ADMIN";
  return isStaffApprovalGroup(role) ? role : null;
};

export const canUnequipAllUsers = (user: UserData) =>
  CONTENT_MANAGER_ROLES.includes(user.role);

export const canEditUsername = (role: UserRole) => SENIOR_STAFF_ROLES.includes(role);

export const canEditBloodline = (role: UserRole) => CONTENT_EDITOR_ROLES.includes(role);

export const canEditVillage = (role: UserRole) => CONTENT_EDITOR_ROLES.includes(role);

export const canEditRank = (role: UserRole) => CONTENT_EDITOR_ROLES.includes(role);

export const canEditJutsus = (role: UserRole) => CONTENT_EDITOR_ROLES.includes(role);

export const canEditItems = (role: UserRole) => CONTENT_EDITOR_ROLES.includes(role);

export const canEditQuests = (role: UserRole) => CONTENT_EDITOR_ROLES.includes(role);

export const canEditStarterQuests = (role: UserRole) => {
  return ["OWNER", "CONTENT-ADMIN"].includes(role);
};

export const canEditStaffAccountFlag = (role: UserRole) => ADMIN_ROLES.includes(role);

export const canEditRankedLp = (role: UserRole) => ADMIN_ROLES.includes(role);

export const canEditSeichiSilver = (role: UserRole) => ADMIN_ROLES.includes(role);

export const canRemoveBloodlineFromPool = (role: UserRole) =>
  ADMIN_ROLES.includes(role);

export const canSeeHiddenBountyInfo = (role: UserRole) => {
  return isStaffRole(role);
};

export const canReskinFreely = (role: UserRole) => {
  return [
    "CODER",
    "CONTENT",
    "BALANCE",
    "HEAD_CONTENT",
    "HEAD_BALANCE",
    "EVENT",
    "HEAD_EVENT",
    "HEAD_MODERATOR",
    "MODERATOR",
    "OWNER",
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
  if (isStaffRole(userRole)) return true;
  if (ticket.assignedToUserId === userId) return true;
  return false;
};

export const canEditSupportTicket = (
  ticket: SupportTicket,
  userId: string,
  userRole: UserRole,
) => {
  if (isStaffRole(userRole)) return true;
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
  if (isStaffRole(userRole)) return true;
  if (ticket.createdByUserId === userId) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return ticket.createdAt > dayAgo && !ticket.assignedToUserId;
  }
  return false;
};

export const canAssignSupportTicket = (userRole?: UserRole | null) => {
  return isStaffRole(userRole);
};

export function canEscalateToGithub(userRole?: UserRole | null): boolean {
  if (!userRole) return false;
  return [
    "OWNER",
    "CODER",
    "CONTENT",
    "BALANCE",
    "HEAD_CONTENT",
    "HEAD_BALANCE",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "CODING-ADMIN",
  ].includes(userRole);
}

export const canViewSupportStatistics = (userRole?: UserRole | null) => {
  return isStaffRole(userRole);
};

export function canViewStaffOnlyComments(userRole?: UserRole | null): boolean {
  return isStaffRole(userRole);
}

export function canTransitionStatus(
  fromStatus: SupportTicketStatus,
  toStatus: SupportTicketStatus,
): boolean {
  const allowedTransitions = SUPPORT_TICKET_STATUS_TRANSITIONS[fromStatus] || [];
  return allowedTransitions.includes(toStatus);
}

export const canViewConversation = (
  conversation: Conversation & {
    users: User2Conversation[];
    supportTicketCreatorId?: string | null;
  },
  userId: string,
  userRole: UserRole,
) => {
  const isPublic = conversation.isPublic;
  const inConversation = conversation.users.some((u) => u.userId === userId);
  const isStaffAvailable = conversation.isStaffAvailable;
  const isTicketCreator = conversation.supportTicketCreatorId === userId;
  if (isPublic || inConversation || isTicketCreator) return true;
  if (isStaffAvailable && isStaffRole(userRole)) return true;
  return false;
};

export const canEditCannedResponses = (userRole?: UserRole | null) => {
  return isStaffRole(userRole);
};

export const canAwardExperience = (user: UserData) => {
  return ["OWNER", "CODING-ADMIN"].includes(user.role);
};

export const canRollPrimaryElement = (user: UserData) => {
  return !["STUDENT", "NONE"].includes(user.rank);
};

export const canRollSecondaryElement = (user: UserData) => {
  return !["STUDENT", "GENIN", "NONE"].includes(user.rank);
};

/** Allow content editors, content/event leadership and OWNER to maintain reward sources. */
export const canManageRewards = (role: UserRole) =>
  [
    "CONTENT",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "HEAD_CONTENT",
    "HEAD_EVENT",
    "OWNER",
  ].includes(role);

/** Tournament operations are restricted to content, event and coding staff. */
export const canManageTournaments = (role: UserRole) =>
  [
    "CONTENT",
    "BALANCE",
    "HEAD_BALANCE",
    "HEAD_CONTENT",
    "CONTENT-ADMIN",
    "EVENT",
    "HEAD_EVENT",
    "EVENT-ADMIN",
    "CODER",
    "CODING-ADMIN",
    "OWNER",
  ].includes(role);

/** The owner and content administrators manage real-money prices and paid rewards. */
export const canManageStore = (role?: UserRole) =>
  role === "OWNER" || role === "CONTENT-ADMIN";
