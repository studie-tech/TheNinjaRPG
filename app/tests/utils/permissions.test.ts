import { expect, test } from "vitest";
import type { UserRole } from "@/drizzle/constants";
import { UserRoles } from "@/drizzle/constants";
import {
  canApproveApplications,
  canDeleteConceptArt,
  canEditSeichiSilver,
  canModifyCombatSettings,
  canModifyEventGains,
  canRemoveBloodlineFromPool,
  canViewAllApplications,
  getApprovalGroup,
} from "@/utils/permissions";

const combatSettingsRoles = [
  "OWNER",
  "CODING-ADMIN",
  "CONTENT-ADMIN",
  "EVENT-ADMIN",
  "MODERATOR-ADMIN",
  "HEAD_CONTENT",
  "HEAD_BALANCE",
  "CONTENT",
  "BALANCE",
  "HEAD_EVENT",
  "EVENT",
  "CODER",
] as const satisfies readonly UserRole[];

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
  const expectedRoles = new Set<UserRole>(combatSettingsRoles);
  for (const role of UserRoles) {
    expect(canModifyCombatSettings(role)).toBe(expectedRoles.has(role));
  }

  expect(canModifyEventGains("CODER")).toBe(false);
  expect(canModifyEventGains("EVENT")).toBe(false);
  expect(canModifyEventGains("HEAD_EVENT")).toBe(false);
  expect(canModifyCombatSettings("CODER")).toBe(true);
  expect(canModifyCombatSettings("EVENT")).toBe(true);
  expect(canModifyCombatSettings("HEAD_EVENT")).toBe(true);
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
