import { expect, test } from "vitest";
import {
  canApproveApplications,
  canViewAllApplications,
  getApprovalGroup,
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

test("non-approval staff do not get application approval access", () => {
  expect(getApprovalGroup("CONTENT")).toBeNull();
  expect(getApprovalGroup("EVENT")).toBeNull();
  expect(getApprovalGroup("HEAD_MODERATOR")).toBeNull();
  expect(getApprovalGroup("MODERATOR")).toBeNull();
  expect(getApprovalGroup("JR_MODERATOR")).toBeNull();
  expect(canApproveApplications("CONTENT")).toBe(false);
  expect(canApproveApplications("EVENT")).toBe(false);
  expect(canApproveApplications("HEAD_MODERATOR")).toBe(false);
  expect(canApproveApplications("MODERATOR")).toBe(false);
  expect(canApproveApplications("JR_MODERATOR")).toBe(false);
  expect(canViewAllApplications("CONTENT")).toBe(false);
  expect(canViewAllApplications("EVENT")).toBe(false);
  expect(canViewAllApplications("HEAD_MODERATOR")).toBe(false);
  expect(canViewAllApplications("MODERATOR")).toBe(false);
  expect(canViewAllApplications("JR_MODERATOR")).toBe(false);
});
