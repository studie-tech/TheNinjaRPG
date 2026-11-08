/**
 * Database access for push; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type LiveActivityKind,
  PUSH_TOKEN_STALE_DAYS,
  type PushCategory,
  type PushPlatform,
} from "@/drizzle/constants";
import {
  storeUserIdAlias,
  userData,
  userDevice,
  userJutsu,
  userLiveActivity,
  userPushPreference,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { DAY_S, secondsFromDate } from "@/utils/time";

/**
 * A device that has not checked in for a season is almost certainly uninstalled. Every
 * reader applies this, so a count cannot promise a delivery the fan-out would skip.
 */
const freshDeviceWhere = (now = new Date()) =>
  gte(userDevice.lastSeenAt, secondsFromDate(-PUSH_TOKEN_STALE_DAYS * DAY_S, now));

/**
 * Build the `userDevice` lookup for `GET`, selecting row fields `userId`, using
 * predicates on `widgetToken` and `lastSeenAt`.
 */
export const findUserDeviceForGET = (
  client: Pick<DrizzleClient, "query">,
  token: string,
) =>
  client.query.userDevice.findFirst({
    columns: { userId: true },
    where: and(eq(userDevice.widgetToken, token), freshDeviceWhere()),
    with: {
      user: {
        columns: {
          username: true,
          avatar: true,
          rank: true,
          level: true,
          curHealth: true,
          maxHealth: true,
          curChakra: true,
          maxChakra: true,
          curStamina: true,
          maxStamina: true,
          unreadNotifications: true,
        },
        with: { village: { columns: { name: true } } },
      },
    },
  });

/** Build the `userDevice` insert for `registerDevice`, updating duplicate keys. */
export const insertUserDeviceForRegisterDevice = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: {
    token: string;
    platform: PushPlatform;
    appVersion?: string | undefined;
    locale?: string | undefined;
  },
  widgetToken: string,
  now: Date,
) =>
  client
    .insert(userDevice)
    .values({
      id: nanoid(),
      userId: ctx.userId,
      token: input.token,
      platform: input.platform,
      appVersion: input.appVersion ?? null,
      locale: input.locale ?? null,
      widgetToken,
      createdAt: now,
      lastSeenAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        userId: ctx.userId,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        locale: input.locale ?? null,
        widgetToken,
        lastSeenAt: now,
      },
    });

/** Build the `userDevice` selection for `registerDevice`, using predicates on `userId` and `token`. */
export const selectUserDeviceForRegisterDevice = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  input: { token: string },
) =>
  client
    .select({ id: userDevice.id })
    .from(userDevice)
    .where(and(eq(userDevice.userId, ctx.userId), ne(userDevice.token, input.token)))
    .orderBy(desc(userDevice.lastSeenAt));

/** Build the `userDevice` deletion for `unregisterDevice`, using predicates on `token` and `widgetToken`. */
export const deleteUserDeviceForUnregisterDevice = (
  client: Pick<DrizzleClient, "delete">,
  input: { token: string; widgetToken: string },
) =>
  client
    .delete(userDevice)
    .where(
      and(
        eq(userDevice.token, input.token),
        eq(userDevice.widgetToken, input.widgetToken),
      ),
    );

/** Build the `userPushPreference` selection for `getPreferences`, using predicates on `userId`. */
export const selectUserPushPreferenceForGetPreferences = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({
      category: userPushPreference.category,
      enabled: userPushPreference.enabled,
    })
    .from(userPushPreference)
    .where(eq(userPushPreference.userId, ctx.userId));

/** Build the `userDevice` selection for `getPreferences`, using predicates on `userId` and `lastSeenAt`. */
export const selectUserDeviceForGetPreferences = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({ id: userDevice.id })
    .from(userDevice)
    .where(and(eq(userDevice.userId, ctx.userId), freshDeviceWhere()));

/** Build the `userPushPreference` insert for `setPreference`, updating duplicate keys. */
export const insertUserPushPreferenceForSetPreference = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: {
    category: PushCategory;
    enabled: false | true;
  },
  updatedAt: Date,
) =>
  client
    .insert(userPushPreference)
    .values({
      id: nanoid(),
      userId: ctx.userId,
      category: input.category,
      enabled: input.enabled,
      updatedAt,
    })
    .onDuplicateKeyUpdate({ set: { enabled: input.enabled, updatedAt } });

/** Build the `userLiveActivity` insert for `registerActivity`, updating duplicate keys. */
export const insertUserLiveActivityForRegisterActivity = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: {
    activityId: string;
    kind: LiveActivityKind;
    pushToken: string;
    endsAt: Date;
  },
  createdAt: Date,
) =>
  client
    .insert(userLiveActivity)
    .values({
      id: nanoid(),
      userId: ctx.userId,
      activityId: input.activityId,
      kind: input.kind,
      pushToken: input.pushToken,
      endsAt: input.endsAt,
      createdAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        activityId: input.activityId,
        pushToken: input.pushToken,
        endsAt: input.endsAt,
        createdAt,
      },
    });

/** Build the `userLiveActivity` deletion for `endActivity`, using predicates on `userId` and `activityId`. */
export const deleteUserLiveActivityForEndActivity = (
  client: Pick<DrizzleClient, "delete">,
  ctx: { userId: string },
  input: { activityId: string },
) =>
  client
    .delete(userLiveActivity)
    .where(
      and(
        eq(userLiveActivity.userId, ctx.userId),
        eq(userLiveActivity.activityId, input.activityId),
      ),
    );

/** Build the `storeUserIdAlias` lookup for `isLivePushUser`, selecting only `oldUserId`, using predicates on `oldUserId`. */
export const findStoreUserIdAliasForIsLivePushUser = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.storeUserIdAlias.findFirst({
    columns: { oldUserId: true },
    where: eq(storeUserIdAlias.oldUserId, userId),
  });

/** Build the `userDevice` deletion for `evictExcessDevices`, using predicates on `id`. */
export const deleteUserDeviceForEvictExcessDevices = (
  client: Pick<DrizzleClient, "delete">,
  excess: string[],
) => client.delete(userDevice).where(inArray(userDevice.id, excess));

/** Build the `userDevice` selection for `sendPushToUsers`, using predicates on `userId` and `lastSeenAt`. */
export const selectUserDeviceForSendPushToUsers = (
  client: Pick<DrizzleClient, "select">,
  recipients: string[],
) =>
  client
    .select({
      userId: userDevice.userId,
      token: userDevice.token,
      platform: userDevice.platform,
    })
    .from(userDevice)
    .where(and(inArray(userDevice.userId, recipients), freshDeviceWhere()));

/** Build the `userPushPreference` selection for `sendPushToUsers`, using predicates on `userId`, `category`, `enabled`. */
export const selectUserPushPreferenceForSendPushToUsers = (
  client: Pick<DrizzleClient, "select">,
  recipients: string[],
  message: {
    category: PushCategory;
  },
) =>
  client
    .select({ userId: userPushPreference.userId })
    .from(userPushPreference)
    .where(
      and(
        inArray(userPushPreference.userId, recipients),
        eq(userPushPreference.category, message.category),
        eq(userPushPreference.enabled, false),
      ),
    );

/** Build the `userDevice` deletion for `pruneExpiredTokens`, using predicates on `token`. */
export const deleteUserDeviceForPruneExpiredTokens = (
  client: Pick<DrizzleClient, "delete">,
  tokens: string[],
) => client.delete(userDevice).where(inArray(userDevice.token, tokens));

/** Build the `userLiveActivity` selection for `pushActivityUpdate`, using predicates on `userId` and `kind`. */
export const selectUserLiveActivityForPushActivityUpdate = (
  client: Pick<DrizzleClient, "select">,
  recipients: string[],
  kind: "war" | "training" | "hospital",
) =>
  client
    .select({ token: userLiveActivity.pushToken })
    .from(userLiveActivity)
    .where(
      and(
        inArray(userLiveActivity.userId, recipients),
        eq(userLiveActivity.kind, kind),
      ),
    );

/** Build the `userLiveActivity` deletion for `pushActivityUpdate`, using predicates on `pushToken`. */
export const deleteUserLiveActivityForPushActivityUpdate = (
  client: Pick<DrizzleClient, "delete">,
  gone: string[],
) => client.delete(userLiveActivity).where(inArray(userLiveActivity.pushToken, gone));

/** Build the `userDevice` distinct selection for `deliverDueTimedPushes`, using predicates on `lastSeenAt`. */
export const selectDistinctUserDeviceForDeliverDueTimedPushes = (
  client: Pick<DrizzleClient, "selectDistinct">,
  now: Date,
) =>
  client
    .selectDistinct({ userId: userDevice.userId })
    .from(userDevice)
    .where(freshDeviceWhere(now));

/** Build the `userData` listing for `deliverDueTimedPushes`, using predicates on `userId`, `isAi`, `finishTraining`. */
export const listUserDataForDeliverDueTimedPushes = (
  client: Pick<DrizzleClient, "query">,
  userIds: string[],
  offset: number,
  now: Date,
  LOOKBACK_SECONDS: number,
) =>
  client.query.userData.findMany({
    where: and(
      inArray(userData.userId, userIds.slice(offset, offset + 200)),
      eq(userData.isAi, false),
    ),
    with: {
      village: { with: { structures: true } },
      jutsus: {
        columns: { id: true, finishTraining: true },
        where: and(
          isNotNull(userJutsu.finishTraining),
          lte(userJutsu.finishTraining, now),
          gte(userJutsu.finishTraining, secondsFromDate(-LOOKBACK_SECONDS, now)),
        ),
      },
    },
  });

/**
 * Build the `userDevice` distinct selection for `notifyWarVillages`, using predicates
 * on `villageId`, `isAi`, `lastSeenAt`.
 */
export const selectDistinctUserDeviceForNotifyWarVillages = (
  client: Pick<DrizzleClient, "selectDistinct">,
  villages: string[],
) =>
  client
    .selectDistinct({ userId: userData.userId })
    .from(userDevice)
    .innerJoin(userData, eq(userData.userId, userDevice.userId))
    .where(
      and(
        inArray(userData.villageId, villages),
        eq(userData.isAi, false),
        freshDeviceWhere(),
      ),
    );
