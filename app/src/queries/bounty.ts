/**
 * Database access for bounty; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  actionLog,
  bounty,
  bountyContribution,
  bountySignup,
  userData,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Public card of a user shown on a bounty. */
const bountyUserColumns = {
  username: true,
  avatar: true,
  level: true,
  rank: true,
  isOutlaw: true,
  villageId: true,
} as const;

/** Build the `bounty` listing for `board`, using predicates on `status` and `collectedAt`. */
export const listBountyForBoard = (
  client: Pick<DrizzleClient, "query">,
  input: { status: "all" | "EXPIRED" | "CANCELLED" | "OPEN" | "CLAIMED" },
  limit: number,
  offset: number,
) =>
  client.query.bounty.findMany({
    where:
      input.status === "all"
        ? undefined
        : input.status === "OPEN"
          ? // Hide completed bounties (CLAIMED and collected)
            or(
              eq(bounty.status, "OPEN"),
              and(eq(bounty.status, "CLAIMED"), isNull(bounty.collectedAt)),
            )
          : eq(bounty.status, input.status),
    columns: {
      id: true,
      amountRyo: true,
      createdAt: true,
      status: true,
      collectedAt: true,
      claimedAt: true,
      targetUserId: true,
      claimedByUserId: true,
      creatorUserId: true,
    },
    with: {
      target: {
        columns: bountyUserColumns,
      },
      hunters: {
        columns: {
          hunterUserId: true,
        },
        with: {
          hunter: {
            columns: bountyUserColumns,
          },
        },
      },
      creator: {
        columns: bountyUserColumns,
      },
      claimedBy: {
        columns: bountyUserColumns,
      },
    },
    orderBy: desc(bounty.createdAt),
    limit,
    offset,
  });

/** Build the `bounty` lookup for `create`, using predicates on `targetUserId` and `status`. */
export const findBountyForCreate = (
  client: Pick<DrizzleClient, "query">,
  targetUserId: string,
) =>
  client.query.bounty.findFirst({
    where: and(eq(bounty.targetUserId, targetUserId), eq(bounty.status, "OPEN")),
  });

/** Build the `bounty` insert for `create`. */
export const insertBountyForCreate = (
  client: Pick<DrizzleClient, "insert">,
  bountyId: string,
  targetUserId: string,
  ctx: { userId: string },
  amountRyo: number,
) =>
  client.insert(bounty).values({
    id: bountyId,
    targetUserId,
    creatorUserId: ctx.userId,
    amountRyo,
    originalAmountRyo: amountRyo,
    status: "OPEN",
    createdAt: new Date(),
  });

/** Build a bounty contribution insert with a generated ID and creation timestamp. */
export const insertBountyContribution = (
  client: Pick<DrizzleClient, "insert">,
  bountyId: string,
  userId: string,
  amountRyo: number,
  id = nanoid(),
) =>
  client.insert(bountyContribution).values({
    id,
    bountyId,
    contributorUserId: userId,
    amountRyo,
    createdAt: new Date(),
  });

/** Build a bounty lookup by ID. */
export const findBountyById = (
  client: Pick<DrizzleClient, "query">,
  bountyId: string,
) =>
  client.query.bounty.findFirst({
    where: eq(bounty.id, bountyId),
  });

/** Build the `bounty` lookup for `signup`, with the target's id and village. */
export const findBountyForSignup = (
  client: Pick<DrizzleClient, "query">,
  bountyId: string,
) =>
  client.query.bounty.findFirst({
    where: eq(bounty.id, bountyId),
    with: { target: { columns: { userId: true, villageId: true } } },
  });

/** Build the `bountySignup` listing for `signup`, using predicates on `bountyId`. */
export const listBountySignupForSignup = (
  client: Pick<DrizzleClient, "query">,
  bountyId: string,
) =>
  client.query.bountySignup.findMany({
    where: eq(bountySignup.bountyId, bountyId),
  });

/** Build the `bountySignup` lookup for `signup`, using predicates on `hunterUserId`. */
export const findBountySignupForSignup = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.bountySignup.findFirst({
    where: eq(bountySignup.hunterUserId, ctx.userId),
  });

/** Build the `bountySignup` insert for `signup`. */
export const insertBountySignupForSignup = (
  client: Pick<DrizzleClient, "insert">,
  bountyId: string,
  ctx: { userId: string },
) =>
  client.insert(bountySignup).values({
    id: nanoid(),
    bountyId,
    hunterUserId: ctx.userId,
    createdAt: new Date(),
  });

/** Build the `bountySignup` deletion for `stopTracking`, using predicates on `id`. */
export const deleteBountySignupForStopTracking = (
  client: Pick<DrizzleClient, "delete">,
  claim: { id: string },
) => client.delete(bountySignup).where(eq(bountySignup.id, claim.id));

/** Build the signup lookup for one bounty and hunter. */
export const findBountySignup = (
  client: Pick<DrizzleClient, "query">,
  bountyId: string,
  userId: string,
) =>
  client.query.bountySignup.findFirst({
    where: and(
      eq(bountySignup.bountyId, bountyId),
      eq(bountySignup.hunterUserId, userId),
    ),
  });

/** Build the `bounty` collection claim, guarded on the claiming hunter and an uncollected payout. */
export const updateBountyForCollect = (
  client: Pick<DrizzleClient, "update">,
  bountyId: string,
  userId: string,
) =>
  client
    .update(bounty)
    .set({ collectedAt: new Date() })
    .where(
      and(
        eq(bounty.id, bountyId),
        eq(bounty.claimedByUserId, userId),
        eq(bounty.status, "CLAIMED"),
        isNull(bounty.collectedAt),
      ),
    );

/** Build deletion of all hunter signups for a bounty. */
export const deleteBountySignups = (
  client: Pick<DrizzleClient, "delete">,
  bountyId: string,
) => client.delete(bountySignup).where(eq(bountySignup.bountyId, bountyId));

/** Build the `bounty` update for `addMoney`, raising `amountRyo` only while the bounty is OPEN. */
export const updateBountyForAddMoney = (
  client: Pick<DrizzleClient, "update">,
  input: { amountRyo: number; bountyId: string },
) =>
  client
    .update(bounty)
    .set({ amountRyo: sql`${bounty.amountRyo} + ${input.amountRyo}` })
    .where(and(eq(bounty.id, input.bountyId), eq(bounty.status, "OPEN")));

/** Build the contribution listing for a bounty. */
export const listBountyContributions = (
  client: Pick<DrizzleClient, "query">,
  bountyId: string,
) =>
  client.query.bountyContribution.findMany({
    where: eq(bountyContribution.bountyId, bountyId),
  });

/** Build the `bounty` update for `retract`, setting `status`, using predicates on `id`, `creatorUserId`, `status`. */
export const updateBountyForRetract = (
  client: Pick<DrizzleClient, "update">,
  input: { bountyId: string },
  ctx: { userId: string },
) =>
  client
    .update(bounty)
    .set({ status: "CANCELLED" })
    .where(
      and(
        eq(bounty.id, input.bountyId),
        eq(bounty.creatorUserId, ctx.userId),
        eq(bounty.status, "OPEN"),
      ),
    );

/**
 * Execute one contribution's refund: credit the contributor and zero the row in one
 * statement, so a failure afterwards loses nothing and a rerun pays nothing. It credits the
 * amount the caller read and guards on it because a multi-table UPDATE does not order its
 * assignments. A contributor deleted since has nobody to pay, so their row still drains.
 */
export const refundBountyContribution = (
  client: Pick<DrizzleClient, "execute">,
  contribution: { id: string; amountRyo: number },
) =>
  client.execute(sql`
      UPDATE ${bountyContribution}
      LEFT JOIN ${userData} ON ${userData.userId} = ${bountyContribution.contributorUserId}
      SET ${userData.money} = ${userData.money} + ${contribution.amountRyo},
          ${bountyContribution.amountRyo} = 0
      WHERE ${bountyContribution.id} = ${contribution.id}
        AND ${bountyContribution.amountRyo} = ${contribution.amountRyo}
        AND ${bountyContribution.amountRyo} > 0
    `);

/** Build deletion of one bounty contribution by ID. */
export const deleteBountyContribution = (
  client: Pick<DrizzleClient, "delete">,
  contributionId: string,
) => client.delete(bountyContribution).where(eq(bountyContribution.id, contributionId));

/** Build the `bounty` lookup for `removeAllTrackers`, using predicates on `id`. */
export const findBountyForRemoveAllTrackers = (
  client: Pick<DrizzleClient, "query">,
  input: { bountyId: string },
) =>
  client.query.bounty.findFirst({
    where: eq(bounty.id, input.bountyId),
    with: { hunters: { columns: { id: true } } },
  });

/** Build the `actionLog` insert for `removeAllTrackers`. */
export const insertActionLogForRemoveAllTrackers = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  hunterCount: number,
  input: { bountyId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bounty",
    changes: [`Removed ${hunterCount} hunters from bounty tracking`],
    relatedId: input.bountyId,
    relatedMsg: `Staff removed all trackers from bounty: ${hunterCount} hunters removed`,
  });

/** Build the `bountySignup` listing for `getTrackedBounties`, using predicates on `hunterUserId`. */
export const listBountySignupForGetTrackedBounties = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.bountySignup.findMany({
    where: eq(bountySignup.hunterUserId, ctx.userId),
    with: {
      bounty: {
        columns: {
          id: true,
          status: true,
          amountRyo: true,
          collectedAt: true,
          claimedAt: true,
        },
        with: {
          target: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
              avatarLight: true,
              sector: true,
            },
          },
        },
      },
    },
  });

/** Build the `bounty` listing for `bountyExpire`, using predicates on `status` and `createdAt`. */
export const listBountyForBountyExpire = (
  client: Pick<DrizzleClient, "query">,
  oneWeekAgo: Date,
) =>
  client.query.bounty.findMany({
    where: and(eq(bounty.status, "OPEN"), lt(bounty.createdAt, oneWeekAgo)),
    with: {
      hunters: true,
    },
  });

/**
 * Build the listing of closed bounties whose refund stopped partway. CLAIMED bounties are
 * excluded: their contributions funded the payout and keep their rows.
 */
export const listBountyForRefundResume = (
  client: Pick<DrizzleClient, "selectDistinct">,
) =>
  client
    .selectDistinct({ id: bounty.id })
    .from(bounty)
    .innerJoin(bountyContribution, eq(bountyContribution.bountyId, bounty.id))
    .where(inArray(bounty.status, ["EXPIRED", "CANCELLED"]));

/** Build the `bounty` update for `bountyExpire`, setting `status`, guarded on the bounty still being OPEN. */
export const updateBountyForBountyExpire = (
  client: Pick<DrizzleClient, "update">,
  expiredBounty: { id: string },
) =>
  client
    .update(bounty)
    .set({ status: "EXPIRED" })
    .where(and(eq(bounty.id, expiredBounty.id), eq(bounty.status, "OPEN")));
