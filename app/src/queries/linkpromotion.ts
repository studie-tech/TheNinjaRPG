/**
 * Database access for linkpromotion; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { UserRole } from "@/drizzle/constants";
import { linkPromotion, userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { canReviewLinkPromotions } from "@/utils/permissions";

/** Build the `linkPromotion` listing for `getLinkPromotions`, using predicates on `reviewed` and `userId`. */
export const listLinkPromotionForGetLinkPromotions = (
  client: Pick<DrizzleClient, "query">,
  user: {
    role: UserRole;
  },
  input: { userId: string; limit: number },
  skip: number,
) =>
  client.query.linkPromotion.findMany({
    where: canReviewLinkPromotions(user.role)
      ? eq(linkPromotion.reviewed, false)
      : eq(linkPromotion.userId, input.userId),
    with: {
      user: {
        columns: { userId: true, username: true, avatar: true },
      },
      reviewer: {
        columns: { userId: true, username: true, avatar: true },
      },
    },
    offset: skip,
    limit: input.limit,
    orderBy: desc(linkPromotion.createdAt),
  });

/** Build the `linkPromotion` lookup for `submitLinkPromotion`, using predicates on `url`. */
export const findLinkPromotionForSubmitLinkPromotion = (
  client: Pick<DrizzleClient, "query">,
  input: { url: string },
) =>
  client.query.linkPromotion.findFirst({
    where: eq(linkPromotion.url, input.url),
  });

/** Build the `linkPromotion` insert for `submitLinkPromotion`. */
export const insertLinkPromotionForSubmitLinkPromotion = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { url: string },
) =>
  client.insert(linkPromotion).values({
    id: nanoid(),
    userId: ctx.userId,
    url: input.url,
    points: 0,
    reviewed: false,
  });

/** Build the `linkPromotion` lookup for `reviewLinkPromotion`, using predicates on `id`. */
export const findLinkPromotionForReviewLinkPromotion = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.linkPromotion.findFirst({
    where: eq(linkPromotion.id, input.id),
  });

/** Build the `linkPromotion` review claim, guarded on the link not being reviewed yet. */
export const updateLinkPromotionForReviewLinkPromotion = (
  client: Pick<DrizzleClient, "update">,
  input: { points: number; id: string },
  ctx: { userId: string },
) =>
  client
    .update(linkPromotion)
    .set({
      points: input.points,
      reviewed: true,
      reviewedBy: ctx.userId,
      reviewedAt: new Date(),
    })
    .where(and(eq(linkPromotion.id, input.id), eq(linkPromotion.reviewed, false)));

/**
 * Build the `userData` update for `reviewLinkPromotion`, setting `reputationPoints`
 * and `reputationPointsTotal`, using predicates on `userId`.
 */
export const updateUserDataForReviewLinkPromotion = (
  client: Pick<DrizzleClient, "update">,
  input: { points: number },
  promotion: { userId: string },
) =>
  client
    .update(userData)
    .set({
      reputationPoints: sql`${userData.reputationPoints} + ${input.points}`,
      reputationPointsTotal: sql`${userData.reputationPointsTotal} + ${input.points}`,
    })
    .where(eq(userData.userId, promotion.userId));
