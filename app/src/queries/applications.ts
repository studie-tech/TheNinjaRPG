/**
 * Database access for applications; authorization and transaction scopes stay in callers.
 */
import type { SQL } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import type {
  StaffApplicationState,
  StaffApplicationTargetRole,
  StaffApprovalGroup,
  UserRole,
} from "@/drizzle/constants";
import { staffApplication } from "@/drizzle/schema";
import { userSummaryColumns } from "@/queries/userColumns";
import type { DrizzleClient } from "@/server/db";

/**
 * Load the first application matching the optional user ID, application ID and
 * status filters, including applicant and approval details; no match yields undefined.
 */
export const fetchApplication = async (info: {
  client: DrizzleClient;
  userId?: string;
  applicationId?: string;
  status?: StaffApplicationState;
}) => {
  const { client, userId, applicationId, status } = info;
  return await client.query.staffApplication.findFirst({
    where: and(
      ...(userId ? [eq(staffApplication.applicantUserId, userId)] : []),
      ...(applicationId ? [eq(staffApplication.id, applicationId)] : []),
      ...(status ? [eq(staffApplication.state, status)] : []),
    ),
    with: staffApplicationRelations,
  });
};

import { desc, inArray, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { staffApplicationApproval, userData } from "@/drizzle/schema";

/** Build the `staffApplication` insert for `create`. */
export const insertStaffApplicationForCreate = (
  client: Pick<DrizzleClient, "insert">,
  appid: string,
  user: { userId: string },
  input: {
    targetRole: StaffApplicationTargetRole;
    motivation: string;
  },
  convoId: string,
) =>
  client.insert(staffApplication).values({
    id: appid,
    applicantUserId: user.userId,
    targetRole: input.targetRole,
    state: "PENDING",
    conversationId: convoId,
    motivation: input.motivation,
  });

/** Build the `userData` selection for `list`, using predicates on `username`. */
export const selectUserDataForList = (
  client: Pick<DrizzleClient, "select">,
  input: { username: string },
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(like(userData.username, `%${input.username}%`))
    .limit(10);

/** Build the `staffApplication` listing for `list`, using predicates on `applicantUserId`. */
export const listStaffApplicationForList = (
  client: Pick<DrizzleClient, "query">,
  baseConds: SQL<unknown>[],
  input: { username?: undefined | string },
  usernameIds: string[],
  limit: number,
  skip: number,
) =>
  client.query.staffApplication.findMany({
    where: and(
      ...baseConds,
      ...(input.username
        ? [inArray(staffApplication.applicantUserId, usernameIds)]
        : []),
    ),
    with: staffApplicationRelations,
    orderBy: [desc(staffApplication.createdAt)],
    limit,
    offset: skip,
  });

/** Applicant card and approval details loaded with every staff application read. */
const staffApplicationRelations = {
  applicant: {
    columns: userSummaryColumns,
    with: { village: { columns: { name: true } } },
  },
  approvals: {
    with: {
      approver: { columns: { userId: true, username: true, avatar: true } },
    },
  },
} as const;

/** Build the `staffApplication` lookup for `delete`, using predicates on `id`. */
export const findStaffApplicationForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.staffApplication.findFirst({
    where: eq(staffApplication.id, input.id),
  });

/** Build the `staffApplication` deletion for `delete`, using predicates on `id`. */
export const deleteStaffApplicationForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(staffApplication).where(eq(staffApplication.id, input.id));

/** Build the `staffApplicationApproval` insert for `approve`, updating duplicate keys. */
export const insertStaffApplicationApprovalForApprove = (
  client: Pick<DrizzleClient, "insert">,
  app: { id: string },
  user: { userId: string },
  approvalGroup: StaffApprovalGroup,
) =>
  client
    .insert(staffApplicationApproval)
    .values({
      id: nanoid(),
      applicationId: app.id,
      approverUserId: user.userId,
      group: approvalGroup,
      state: "APPROVED",
    })
    .onDuplicateKeyUpdate({
      set: {
        state: "APPROVED",
        approverUserId: user.userId,
        group: approvalGroup,
      },
    });

/** Build the `staffApplicationApproval` listing for `approve`, using predicates on `applicationId`. */
export const listStaffApplicationApprovalForApprove = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.staffApplicationApproval.findMany({
    where: eq(staffApplicationApproval.applicationId, input.id),
  });

/** Build the `userData` update for `approve`, setting `role`, using predicates on `userId`. */
export const updateUserDataForApprove = (
  client: Pick<DrizzleClient, "update">,
  app: {
    targetRole: UserRole;
    applicantUserId: string;
  },
) =>
  client
    .update(userData)
    .set({ role: app.targetRole })
    .where(eq(userData.userId, app.applicantUserId));

/** Build the `staffApplication` update for `approve`, setting `state` and `updatedAt`, using predicates on `id`. */
export const updateStaffApplicationForApprove = (
  client: Pick<DrizzleClient, "update">,
  app: { id: string },
) =>
  client
    .update(staffApplication)
    .set({ state: "APPROVED", updatedAt: new Date() })
    .where(eq(staffApplication.id, app.id));

/** Build the `staffApplication` update for `approve`, setting `state` and `updatedAt`, using predicates on `id`. */
export const updateStaffApplicationForApprove2 = (
  client: Pick<DrizzleClient, "update">,
  app: { id: string },
) =>
  client
    .update(staffApplication)
    .set({ state: "PENDING", updatedAt: new Date() })
    .where(eq(staffApplication.id, app.id));

/** Build the `staffApplicationApproval` insert for `reject`, updating duplicate keys. */
export const insertStaffApplicationApprovalForReject = (
  client: Pick<DrizzleClient, "insert">,
  app: { id: string },
  user: { userId: string },
  rejectionGroup: StaffApprovalGroup,
) =>
  client
    .insert(staffApplicationApproval)
    .values({
      id: nanoid(),
      applicationId: app.id,
      approverUserId: user.userId,
      group: rejectionGroup,
      state: "REJECTED",
    })
    .onDuplicateKeyUpdate({
      set: {
        state: "REJECTED",
        approverUserId: user.userId,
        group: rejectionGroup,
      },
    });

/** Build the `staffApplication` update for `reject`, setting `state` and `updatedAt`, using predicates on `id`. */
export const updateStaffApplicationForReject = (
  client: Pick<DrizzleClient, "update">,
  app: { id: string },
) =>
  client
    .update(staffApplication)
    .set({ state: "REJECTED", updatedAt: new Date() })
    .where(eq(staffApplication.id, app.id));
