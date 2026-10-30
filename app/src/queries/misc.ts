/**
 * Database access for misc; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, gt, gte, inArray, like, lt, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { TRAINING_CAPTCHA_SOLVED_GRACE_MINUTES } from "@/drizzle/constants";
import {
  abEvent,
  captcha,
  conversation,
  gameAsset,
  notification,
  supportReview,
  userData,
  userRewards,
  visitorLog,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { hashIp } from "@/server/utils/ipHash";
import { DAY_S, secondsFromNow } from "@/utils/time";

/**
 * Fetches game assets from the database.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @returns A promise that resolves to an array of game assets, each containing the id, name, and image.
 */
export const fetchGameAssets = async (client: DrizzleClient, ids?: string[]) => {
  return await client.query.gameAsset.findMany({
    where: and(
      eq(gameAsset.hidden, false),
      ...(ids ? [inArray(gameAsset.id, ids)] : []),
    ),
    orderBy: [desc(gameAsset.name)],
  });
};

/** Build the `visitorLog` insert for `trackVisitor`, updating duplicate keys. */
export const insertVisitorLogForTrackVisitor = (
  client: Pick<DrizzleClient, "insert">,
  ip: string,
  input: { ref?: undefined | string; utmSource?: undefined | string },
  ctx: { userAgent: undefined | string },
) =>
  client
    .insert(visitorLog)
    .values({
      id: nanoid(),
      ipHash: hashIp(ip),
      ref: input.ref,
      utmSource: input.utmSource,
      userAgent: String(ctx.userAgent).slice(0, 180),
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `abEvent` insert for `trackVisitor`, updating duplicate keys. */
export const insertAbEventForTrackVisitor = (
  client: Pick<DrizzleClient, "insert">,
  experiment: { experiment: string; variant: string },
  input: { utmSource?: undefined | string },
  ip: string,
  ctx: { userAgent: undefined | string },
) =>
  client
    .insert(abEvent)
    .values({
      id: nanoid(),
      userId: null,
      experiment: experiment.experiment,
      variant: experiment.variant,
      event: "loaded",
      source: input.utmSource,
      ipHash: hashIp(ip),
      userAgent:
        typeof ctx.userAgent === "string" ? ctx.userAgent.slice(0, 180) : undefined,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `notification` insert for `submitNotification`. */
export const insertNotificationForSubmitNotification = (
  client: Pick<DrizzleClient, "insert">,
  sender: { userId: string },
  input: { content: string },
) =>
  client.insert(notification).values({
    userId: sender.userId,
    content: input.content,
  });

/** Build the `userData` update for `submitNotification`, setting `unreadNotifications`. */
export const updateUserDataForSubmitNotification = (
  client: Pick<DrizzleClient, "update">,
) => client.update(userData).set({ unreadNotifications: sql`unreadNotifications + 1` });

/** Build the `notification` listing for `getPreviousNotifications`. */
export const listNotificationForGetPreviousNotifications = (
  client: Pick<DrizzleClient, "query">,
  skip: number,
  input: { limit: number },
) =>
  client.query.notification.findMany({
    offset: skip,
    limit: input.limit,
    with: { user: true },
    orderBy: [desc(notification.createdAt)],
  });

/** Build the `conversation` lookup for `getGlobalTavernEnabled`, using predicates on `title`. */
export const findConversationForGetGlobalTavernEnabled = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.conversation.findFirst({
    where: eq(conversation.title, "Global"),
  });

/** Build the `conversation` update for `toggleGlobalTavern`, setting `isEnabled`, using predicates on `id`. */
export const updateConversationForToggleGlobalTavern = (
  client: Pick<DrizzleClient, "update">,
  input: { enabled: false | true },
  convo: { id: string },
) =>
  client
    .update(conversation)
    .set({ isEnabled: input.enabled })
    .where(eq(conversation.id, convo.id));

/** Build the `userData` listing for `awardReputation`, using predicates on `userId`. */
export const listUserDataForAwardReputation = (
  client: Pick<DrizzleClient, "query">,
  input: { userIds: string[] },
) =>
  client.query.userData.findMany({
    where: inArray(userData.userId, input.userIds),
  });

/** Build the `userRewards` insert for `awardReputation`. */
export const insertUserRewardsForAwardReputation = (
  client: Pick<DrizzleClient, "insert">,
  rewardsToInsert: Pick<
    import("@/drizzle/schema").UserRewards,
    "id" | "reason" | "receiverId" | "awardedById" | "reputationAmount" | "moneyAmount"
  >[],
) => client.insert(userRewards).values(rewardsToInsert);

/** Build the `userData` update for `awardReputation`, using predicates on `userId`. */
export const updateUserDataForAwardReputation = (
  client: Pick<DrizzleClient, "update">,
  input: {
    reputationAmount?: undefined | number;
    moneyAmount?: undefined | number;
    userIds: string[];
  },
) =>
  client
    .update(userData)
    .set({
      reputationPoints: sql`reputationPoints + ${input.reputationAmount || 0}`,
      reputationPointsTotal: sql`reputationPointsTotal + ${input.reputationAmount || 0}`,
      money: sql`money + ${input.moneyAmount || 0}`,
    })
    .where(inArray(userData.userId, input.userIds));

/** Build the user ID listing for usernames matching the search text. */
export const listUserIdsMatchingUsername = (
  client: Pick<DrizzleClient, "query">,
  search: string,
) =>
  client.query.userData.findMany({
    where: like(userData.username, `%${search}%`),
    columns: { userId: true },
  });

/**
 * Build the `userRewards` listing for `getAllAwards`, including predicates on
 * `reputationAmount`, `moneyAmount`, `createdAt`.
 */
export const listUserRewardsForGetAllAwards = (
  client: Pick<DrizzleClient, "query">,
  skip: number,
  limit: number,
  input: { rewardType: "money" | "all" | "both" | "reputation" },
  dayStart: undefined | Date,
  dayEnd: undefined | Date,
  receiverIds: string[],
  awardedByIds: string[],
) =>
  client.query.userRewards.findMany({
    offset: skip,
    limit: limit,
    with: {
      awardedBy: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
        },
      },
      receiver: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
        },
      },
    },
    where: and(
      // Reward type conditions
      ...(input.rewardType === "reputation"
        ? [gt(userRewards.reputationAmount, 0), eq(userRewards.moneyAmount, 0)]
        : []),
      ...(input.rewardType === "money"
        ? [gt(userRewards.moneyAmount, 0), eq(userRewards.reputationAmount, 0)]
        : []),
      ...(input.rewardType === "both"
        ? [gt(userRewards.reputationAmount, 0), gt(userRewards.moneyAmount, 0)]
        : []),
      // Date range conditions for a specific day (UTC)
      ...(dayStart && dayEnd
        ? [gte(userRewards.createdAt, dayStart), lt(userRewards.createdAt, dayEnd)]
        : []),
      // Username-derived id filters
      ...(receiverIds.length > 0 ? [inArray(userRewards.receiverId, receiverIds)] : []),
      ...(awardedByIds.length > 0
        ? [inArray(userRewards.awardedById, awardedByIds)]
        : []),
    ),
    orderBy: [desc(userRewards.createdAt)],
  });

/** Build the `supportReview` listing for `reviewSupportWithAI`, using predicates on `createdAt`. */
export const listSupportReviewForReviewSupportWithAI = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.supportReview.findMany({
    where: gte(supportReview.createdAt, secondsFromNow(-DAY_S)),
  });

/** Build the `supportReview` insert for `reviewSupportWithAI`. */
export const insertSupportReviewForReviewSupportWithAI = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: {
    apiRoute: string;
    chatHistory: any[];
    sentiment: "NEUTRAL" | "POSITIVE" | "NEGATIVE";
  },
) =>
  client.insert(supportReview).values({
    id: nanoid(),
    userId: ctx.userId,
    apiRoute: input.apiRoute,
    chatHistory: input.chatHistory,
    sentiment: input.sentiment,
  });

/**
 * Build the `captcha` lookup for `solvedCaptchaRecently`, selecting only `id`, using
 * predicates on `userId`, `success`, `createdAt`.
 */
export const findCaptchaForSolvedCaptchaRecently = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
  captchaNow: SQL<unknown>,
) =>
  client.query.captcha.findFirst({
    columns: { id: true },
    where: and(
      eq(captcha.userId, userId),
      eq(captcha.success, true),
      gt(
        captcha.createdAt,
        sql`${captchaNow} - INTERVAL ${TRAINING_CAPTCHA_SOLVED_GRACE_MINUTES} MINUTE`,
      ),
    ),
  });

/** Build the `captcha` lookup for `generateCaptcha`, using predicates on `userId` and `used`. */
export const findCaptchaForGenerateCaptcha = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.captcha.findFirst({
    where: and(eq(captcha.userId, userId), eq(captcha.used, false)),
  });

/** Build the `captcha` insert for `generateCaptcha`. */
export const insertCaptchaForGenerateCaptcha = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  value: string,
) => client.insert(captcha).values({ userId, value });

/**
 * Build the `captcha` update for `refreshCaptcha`, setting `used` and `success`, using
 * predicates on `userId` and `used`.
 */
export const updateCaptchaForRefreshCaptcha = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(captcha)
    .set({ used: true, success: false })
    .where(and(eq(captcha.userId, userId), eq(captcha.used, false)));

/** Build the `captcha` update for `validateCaptcha`, setting `used` and `success`, using predicates on `id`. */
export const updateCaptchaForValidateCaptcha = (
  client: Pick<DrizzleClient, "update">,
  success: false | true,
  captchaNow: SQL<unknown>,
  current: { id: number },
) =>
  client
    .update(captcha)
    .set({ used: true, success, ...(success ? { createdAt: captchaNow } : {}) })
    .where(eq(captcha.id, current.id));

/** Build the `captcha` count for `refreshCaptcha`. */
export const countCaptchaForRefreshCaptcha = (
  client: Pick<DrizzleClient, "$count">,
  userId: string,
  captchaNow: SQL<unknown>,
) =>
  client.$count(
    captcha,
    and(
      eq(captcha.userId, userId),
      gt(captcha.createdAt, sql`${captchaNow} - INTERVAL 1 MINUTE`),
    ),
  );

/** Build an atomic unread-notification increment for the selected recipients. */
export const incrementNotificationCounters = (
  client: Pick<DrizzleClient, "update">,
  userIds: string[],
) =>
  client
    .update(userData)
    .set({ unreadNotifications: sql`unreadNotifications + 1` })
    .where(inArray(userData.userId, userIds));
