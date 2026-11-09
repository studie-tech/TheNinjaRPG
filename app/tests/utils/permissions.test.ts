import { expect, test } from "bun:test";
import type { BanState, UserRole } from "@/drizzle/constants";
import { BanStates, UserRoles } from "@/drizzle/constants";
import type { UserData, UserReport } from "@/drizzle/schema";
import {
  canApproveApplications,
  canAwardReputation,
  canChangeContent,
  canClearReport,
  canDeleteConceptArt,
  canDeletePollOptions,
  canEditSeichiSilver,
  canManageRewards,
  canModerateReports,
  canModifyCombatSettings,
  canModifyEventGains,
  canRemoveBloodlineFromPool,
  canSuggestContent,
  canViewAllApplications,
  getApprovalGroup,
  getConversationComposeRestriction,
  getMessagingRestriction,
  isRestrictedToSelf,
  isSiteOwnerAccount,
  RESTRICTED_STAFF_CONVERSATION_MESSAGE,
  RESTRICTED_SUPPORT_TICKET_REPLY_MESSAGE,
} from "@/utils/permissions";

test("approval groups are assigned to the correct admin roles", () => {
  expect(getApprovalGroup("CODER")).toBeNull();
  expect(getApprovalGroup("CODING-ADMIN")).toBe("CODING-ADMIN");
  expect(getApprovalGroup("CONTENT-ADMIN")).toBe("CONTENT-ADMIN");
  expect(getApprovalGroup("EVENT-ADMIN")).toBe("EVENT-ADMIN");
  expect(getApprovalGroup("MODERATOR-ADMIN")).toBe("MODERATOR-ADMIN");
  expect(getApprovalGroup("OWNER")).toBe("CODING-ADMIN");
});

test("approval admins can approve and view staff applications", () => {
  expect(canApproveApplications("CODER")).toBe(false);
  expect(canApproveApplications("CODING-ADMIN")).toBe(true);
  expect(canApproveApplications("CONTENT-ADMIN")).toBe(true);
  expect(canApproveApplications("EVENT-ADMIN")).toBe(true);
  expect(canApproveApplications("MODERATOR-ADMIN")).toBe(true);
  expect(canApproveApplications("OWNER")).toBe(true);
  expect(canViewAllApplications("CODER")).toBe(false);
  expect(canViewAllApplications("CODING-ADMIN")).toBe(true);
  expect(canViewAllApplications("CONTENT-ADMIN")).toBe(true);
  expect(canViewAllApplications("EVENT-ADMIN")).toBe(true);
  expect(canViewAllApplications("MODERATOR-ADMIN")).toBe(true);
  expect(canViewAllApplications("OWNER")).toBe(true);
});

test("head leads may view all applications but cannot approve", () => {
  expect(canViewAllApplications("HEAD_CONTENT")).toBe(true);
  expect(canViewAllApplications("HEAD_BALANCE")).toBe(true);
  expect(canViewAllApplications("HEAD_EVENT")).toBe(true);
  expect(canViewAllApplications("HEAD_MODERATOR")).toBe(true);
  expect(canApproveApplications("HEAD_CONTENT")).toBe(false);
  expect(canApproveApplications("HEAD_BALANCE")).toBe(false);
  expect(canApproveApplications("HEAD_EVENT")).toBe(false);
  expect(canApproveApplications("HEAD_MODERATOR")).toBe(false);
});

test("concept art delete permission is owner and admin roles only", () => {
  expect(canDeleteConceptArt("USER")).toBe(false);
  expect(canDeleteConceptArt("OWNER")).toBe(true);
  expect(canDeleteConceptArt("CODING-ADMIN")).toBe(true);
  expect(canDeleteConceptArt("CONTENT-ADMIN")).toBe(true);
  expect(canDeleteConceptArt("EVENT-ADMIN")).toBe(true);
  expect(canDeleteConceptArt("MODERATOR-ADMIN")).toBe(true);
  expect(canDeleteConceptArt("HEAD_MODERATOR")).toBe(true);
  expect(canDeleteConceptArt("MODERATOR")).toBe(false);
});

test("moderators can delete poll options, regular users cannot", () => {
  expect(canDeletePollOptions("MODERATOR")).toBe(true);
  expect(canDeletePollOptions("HEAD_MODERATOR")).toBe(true);
  expect(canDeletePollOptions("MODERATOR-ADMIN")).toBe(true);
  expect(canDeletePollOptions("CONTENT")).toBe(true);
  expect(canDeletePollOptions("USER")).toBe(false);
  expect(canDeletePollOptions("CODER")).toBe(false);
});

test("non-approval staff do not get application approval access", () => {
  expect(getApprovalGroup("CONTENT")).toBeNull();
  expect(getApprovalGroup("BALANCE")).toBeNull();
  expect(getApprovalGroup("HEAD_CONTENT")).toBeNull();
  expect(getApprovalGroup("HEAD_BALANCE")).toBeNull();
  expect(getApprovalGroup("EVENT")).toBeNull();
  expect(getApprovalGroup("HEAD_EVENT")).toBeNull();
  expect(getApprovalGroup("HEAD_MODERATOR")).toBeNull();
  expect(getApprovalGroup("MODERATOR")).toBeNull();
  expect(getApprovalGroup("JR_MODERATOR")).toBeNull();
  expect(canApproveApplications("CONTENT")).toBe(false);
  expect(canApproveApplications("BALANCE")).toBe(false);
  expect(canApproveApplications("HEAD_CONTENT")).toBe(false);
  expect(canApproveApplications("HEAD_BALANCE")).toBe(false);
  expect(canApproveApplications("EVENT")).toBe(false);
  expect(canApproveApplications("HEAD_EVENT")).toBe(false);
  expect(canApproveApplications("HEAD_MODERATOR")).toBe(false);
  expect(canApproveApplications("MODERATOR")).toBe(false);
  expect(canApproveApplications("JR_MODERATOR")).toBe(false);
  expect(canViewAllApplications("CONTENT")).toBe(false);
  expect(canViewAllApplications("BALANCE")).toBe(false);
  expect(canViewAllApplications("EVENT")).toBe(false);
  expect(canViewAllApplications("MODERATOR")).toBe(false);
  expect(canViewAllApplications("JR_MODERATOR")).toBe(false);
});

test("combat settings use balance/content permissions instead of event gain permissions", () => {
  for (const role of UserRoles) {
    expect(canModifyCombatSettings(role)).toBe(canChangeContent(role));
  }

  expect(canModifyEventGains("CODER")).toBe(false);
  expect(canModifyEventGains("EVENT")).toBe(false);
  expect(canModifyEventGains("HEAD_EVENT")).toBe(false);
  expect(canModifyCombatSettings("CODER")).toBe(true);
  expect(canModifyCombatSettings("EVENT")).toBe(true);
  expect(canModifyCombatSettings("HEAD_EVENT")).toBe(true);
});

test("content editors can manage reward sources without reputation authoring access", () => {
  const allowed: readonly UserRole[] = [
    "CONTENT",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "HEAD_CONTENT",
    "HEAD_EVENT",
    "OWNER",
  ];
  for (const role of UserRoles) {
    expect(canManageRewards(role)).toBe(allowed.includes(role));
  }
  expect(canAwardReputation("CONTENT")).toBe(false);
});

test("seichi silver + bloodline-pool admin actions gate to their own admin role set", () => {
  const allowed = [
    "CONTENT-ADMIN",
    "OWNER",
    "CODING-ADMIN",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
  ] as const satisfies readonly UserRole[];
  const denied = [
    "USER",
    "CONTENT",
    "BALANCE",
    "EVENT",
    "CODER",
    "HEAD_CONTENT",
    "HEAD_BALANCE",
    "HEAD_EVENT",
  ] as const satisfies readonly UserRole[];
  for (const role of allowed) {
    expect(canEditSeichiSilver(role)).toBe(true);
    expect(canRemoveBloodlineFromPool(role)).toBe(true);
  }
  for (const role of denied) {
    expect(canEditSeichiSilver(role)).toBe(false);
    expect(canRemoveBloodlineFromPool(role)).toBe(false);
  }
});

test("moderation roles cannot suggest content while other staff retain access", () => {
  const denied: UserRole[] = [
    "USER",
    "MODERATOR",
    "MODERATOR-ADMIN",
    "HEAD_MODERATOR",
    "JR_MODERATOR",
  ];
  for (const role of UserRoles) {
    expect(canSuggestContent(role)).toBe(!denied.includes(role));
  }
  expect(canSuggestContent(undefined)).toBe(false);
  expect(canSuggestContent(null)).toBe(false);
});

test("trade bans can be managed and cleared by the roles that impose them", () => {
  const report = {
    reportedUserId: "target",
    status: "TRADE_BAN_ACTIVATED",
    banEnd: new Date(Date.now() + 86_400_000),
  } as UserReport;
  const allowed: UserRole[] = [
    "MODERATOR",
    "HEAD_MODERATOR",
    "MODERATOR-ADMIN",
    "OWNER",
    "CODING-ADMIN",
  ];
  for (const role of UserRoles) {
    const staff = { userId: "staff", role } as UserData;
    expect(canModerateReports(staff, report)).toBe(allowed.includes(role));
    expect(canClearReport(staff, report)).toBe(allowed.includes(role));
    // Self-moderation stays forbidden even for otherwise authorized staff.
    const target = { userId: "target", role } as UserData;
    expect(canModerateReports(target, report)).toBe(false);
    expect(canClearReport(target, report)).toBe(false);
  }
});

test("report moderation follows the role table for every report state", () => {
  const reportAdmins = ["MODERATOR-ADMIN", "OWNER", "CODING-ADMIN"];
  const expected: Record<BanState, string[]> = {
    UNVIEWED: [
      ...reportAdmins,
      "CONTENT-ADMIN",
      "EVENT-ADMIN",
      "HEAD_MODERATOR",
      "MODERATOR",
      "JR_MODERATOR",
    ],
    OFFICIAL_WARNING: [...reportAdmins, "MODERATOR"],
    BAN_ACTIVATED: [...reportAdmins, "HEAD_MODERATOR"],
    BAN_ESCALATED: [...reportAdmins, "HEAD_MODERATOR"],
    TRADE_BAN_ACTIVATED: [...reportAdmins, "HEAD_MODERATOR", "MODERATOR"],
    SILENCE_ACTIVATED: [...reportAdmins, "HEAD_MODERATOR", "MODERATOR"],
    SILENCE_ESCALATED: [...reportAdmins, "HEAD_MODERATOR"],
    TIMEOUT_ACTIVATED: [
      ...reportAdmins,
      "CONTENT-ADMIN",
      "EVENT-ADMIN",
      "HEAD_MODERATOR",
      "MODERATOR",
    ],
    REPORT_CLEARED: [],
  };
  for (const status of BanStates) {
    const report = { status, reportedUserId: "reported" } as UserReport;
    const allowed = UserRoles.filter((role) =>
      canModerateReports({ role, userId: "moderator" } as UserData, report),
    );
    expect([...allowed].sort()).toEqual([...expected[status]].sort() as UserRole[]);
    expect(
      canModerateReports({ role: "OWNER", userId: "reported" } as UserData, report),
    ).toBe(false);
  }
});

test("conversation compose restriction lets banned users reply to their own ticket only", () => {
  const free = { userId: "me", isBanned: false, isSilenced: false, level: 50 };
  const banned = { ...free, isBanned: true };
  const lowLevel = { ...free, level: 1 };
  const staffConvo = { sendRestriction: null, isStaffAvailable: true };
  const publicConvo = { sendRestriction: null, isStaffAvailable: false };
  const compose = getConversationComposeRestriction;

  expect(compose(free, staffConvo, null)).toBeNull();
  expect(compose(free, { sendRestriction: "Closed" }, null)).toBe("Closed");
  expect(compose(banned, { sendRestriction: "Closed" }, "me")).toBe("Closed");
  expect(compose(undefined, { sendRestriction: "Closed" }, null)).toBe("Closed");
  expect(compose(undefined, staffConvo, null)).toBeNull();
  expect(compose(banned, undefined, null)).toBe(getMessagingRestriction(banned));
  expect(compose(banned, publicConvo, "me")).toBe(getMessagingRestriction(banned));
  expect(compose(lowLevel, staffConvo, "me")).toBe(getMessagingRestriction(lowLevel));
  expect(compose(banned, staffConvo, "me")).toBeNull();
  expect(compose(banned, staffConvo, "other")).toBe(
    RESTRICTED_SUPPORT_TICKET_REPLY_MESSAGE,
  );
  expect(compose(banned, staffConvo, null)).toBe(RESTRICTED_STAFF_CONVERSATION_MESSAGE);
});

test("isSiteOwnerAccount matches only the owner's exact username", () => {
  expect(isSiteOwnerAccount({ username: "Terriator" })).toBe(true);
  for (const username of ["terriator", "Terriator2", " Terriator", "Terr"]) {
    expect(isSiteOwnerAccount({ username })).toBe(false);
  }
});

test("isRestrictedToSelf limits self-only editors to their own account", () => {
  expect(isRestrictedToSelf("CONTENT", "me", "other")).toBe(true);
  expect(isRestrictedToSelf("CONTENT", "me", "me")).toBe(false);
  expect(isRestrictedToSelf("CONTENT", undefined, "other")).toBe(true);
  expect(isRestrictedToSelf("CONTENT-ADMIN", "me", "other")).toBe(false);
  expect(isRestrictedToSelf("USER", "me", "other")).toBe(false);
});
