import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/api/trpc";
import {
  PUSH_CATEGORIES,
  PUSH_MAX_DEVICES_PER_USER,
  PUSH_TOKEN_STALE_DAYS,
  type PushCategory,
} from "@/drizzle/constants";
import {
  storeUserIdAlias,
  userData,
  userDevice,
  userLiveActivity,
  userPushPreference,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { deliveryTest, isPushEnabled, sendPushToUsers } from "@/server/utils/push";
import { secondsFromNow } from "@/utils/time";
import {
  endActivitySchema,
  registerActivitySchema,
  registerDeviceSchema,
  setPushPreferenceSchema,
  unregisterDeviceSchema,
} from "@/validators/push";

export const pushRouter = createTRPCRouter({
  /**
   * Bind a device token to the signed-in account. The token is the unique key, so a phone
   * that signs into a second account moves rather than duplicating, and a re-register
   * from the same account is just a heartbeat.
   */
  registerDevice: protectedProcedure
    .input(registerDeviceSchema)
    .output(baseServerResponse.extend({ widgetToken: z.string().nullish() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      // Rotated on every registration, so a device that changes hands cannot keep reading
      // the previous account's status.
      const widgetToken = nanoid(32);
      const deviceId = nanoid();
      const inserted = await ctx.drizzle.execute(
        sql`INSERT INTO ${userDevice} (id, userId, token, platform, appVersion, locale, widgetToken, createdAt, lastSeenAt)
            SELECT ${deviceId}, ${ctx.userId}, ${input.token}, ${input.platform}, ${input.appVersion ?? null}, ${input.locale ?? null}, ${widgetToken}, ${now}, ${now}
            WHERE ${livePushUser(ctx.userId)}
            ON DUPLICATE KEY UPDATE userId = ${ctx.userId}, platform = ${input.platform}, appVersion = ${input.appVersion ?? null}, locale = ${input.locale ?? null}, widgetToken = ${widgetToken}, lastSeenAt = ${now}`,
      );
      const registered =
        Number(inserted.rowsAffected ?? 0) > 0 ||
        (await isLivePushUser(ctx.drizzle, ctx.userId));
      if (registered) {
        // Scoped to this player, so it needs no guard of its own: the row it would evict
        // is one this account owns, and a retirement purges the lot regardless.
        const others = await ctx.drizzle
          .select({ id: userDevice.id })
          .from(userDevice)
          .where(
            and(eq(userDevice.userId, ctx.userId), ne(userDevice.token, input.token)),
          )
          .orderBy(desc(userDevice.lastSeenAt));
        // One slot is spoken for by the device above, hence the cap less one.
        await evictExcessDevices(ctx.drizzle, others);
      }
      if (!registered) {
        return {
          success: false,
          message: "Character no longer exists",
          widgetToken: null,
        };
      }
      return {
        success: true,
        message: "Device registered for notifications",
        widgetToken,
      };
    }),

  /**
   * Called on sign-out so the next player on this phone does not inherit the alerts.
   *
   * Public on purpose: by the time the app knows it is signed out, Clerk has already
   * cleared the session, so a protected procedure would be rejected by both the client
   * guard and the server at exactly the moment it is needed, leaving the device bound to
   * the previous account. Authority comes from the device token plus the rotating widget
   * credential minted by the last successful bind. Requiring both also makes an old
   * account's late cleanup harmless after a new account has rebound the same OS token.
   * Listed in PUBLIC_MUTATIONS.
   */
  unregisterDevice: publicProcedure
    .input(unregisterDeviceSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .delete(userDevice)
        .where(
          and(
            eq(userDevice.token, input.token),
            eq(userDevice.widgetToken, input.widgetToken),
          ),
        );
      return { success: true, message: "Device unregistered" };
    }),

  /**
   * Every category, with the player's choice applied. Only opt-outs are stored, so a
   * category with no row reads as enabled.
   */
  getPreferences: protectedProcedure
    .output(
      z.object({
        pushEnabled: z.boolean(),
        categories: z.array(
          z.object({ category: z.enum(PUSH_CATEGORIES), enabled: z.boolean() }),
        ),
        deviceCount: z.number(),
      }),
    )
    .query(async ({ ctx }) => {
      const [preferences, devices] = await Promise.all([
        ctx.drizzle
          .select({
            category: userPushPreference.category,
            enabled: userPushPreference.enabled,
          })
          .from(userPushPreference)
          .where(eq(userPushPreference.userId, ctx.userId)),
        ctx.drizzle
          .select({ id: userDevice.id })
          .from(userDevice)
          .where(
            and(
              eq(userDevice.userId, ctx.userId),
              // Same window sendPushToUsers uses, so the count cannot promise a delivery
              // the fan-out would skip.
              gte(
                userDevice.lastSeenAt,
                secondsFromNow(-PUSH_TOKEN_STALE_DAYS * 86400),
              ),
            ),
          ),
      ]);
      const stored = new Map<PushCategory, boolean>(
        preferences.map((row) => [row.category, row.enabled]),
      );
      return {
        pushEnabled: isPushEnabled(),
        categories: PUSH_CATEGORIES.map((category) => ({
          category,
          enabled: stored.get(category) ?? true,
        })),
        deviceCount: devices.length,
      };
    }),

  setPreference: protectedProcedure
    .input(setPushPreferenceSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const updatedAt = new Date();
      const written = await ctx.drizzle.execute(
        sql`INSERT INTO ${userPushPreference} (id, userId, category, enabled, updatedAt)
            SELECT ${nanoid()}, ${ctx.userId}, ${input.category}, ${input.enabled}, ${updatedAt}
            WHERE ${livePushUser(ctx.userId)}
            ON DUPLICATE KEY UPDATE enabled = ${input.enabled}, updatedAt = ${updatedAt}`,
      );
      const updated =
        Number(written.rowsAffected ?? 0) > 0 ||
        (await isLivePushUser(ctx.drizzle, ctx.userId));
      if (!updated) return errorResponse("Character no longer exists");
      return {
        success: true,
        message: `${input.category} notifications ${input.enabled ? "enabled" : "disabled"}`,
      };
    }),

  /**
   * Record a Live Activity the device just started, so the server can push updates to it.
   * Re-registering the same activity refreshes its token, while another device gets a row
   * of its own.
   */
  registerActivity: protectedProcedure
    .input(registerActivitySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const createdAt = new Date();
      const written = await ctx.drizzle.execute(
        sql`INSERT INTO ${userLiveActivity} (id, userId, activityId, kind, pushToken, endsAt, createdAt)
            SELECT ${nanoid()}, ${ctx.userId}, ${input.activityId}, ${input.kind}, ${input.pushToken}, ${input.endsAt}, ${createdAt}
            WHERE ${livePushUser(ctx.userId)}
            ON DUPLICATE KEY UPDATE activityId = ${input.activityId}, pushToken = ${input.pushToken}, endsAt = ${input.endsAt}, createdAt = ${createdAt}`,
      );
      const registered =
        Number(written.rowsAffected ?? 0) > 0 ||
        (await isLivePushUser(ctx.drizzle, ctx.userId));
      if (!registered) return errorResponse("Character no longer exists");
      return { success: true, message: "Activity registered" };
    }),

  /** Called when this device ends an activity locally, without touching another device. */
  endActivity: protectedProcedure
    .input(endActivitySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Guarded in the statement like the writes above, rather than read-then-delete. A
      // rename migrates this row to the new id, and an end arriving for the identity being
      // renamed away must be refused rather than delete a row that has already moved --
      // otherwise the countdown the player still has on screen loses its server row.
      const removed = await ctx.drizzle
        .delete(userLiveActivity)
        .where(
          and(
            eq(userLiveActivity.userId, ctx.userId),
            eq(userLiveActivity.activityId, input.activityId),
            livePushUser(ctx.userId),
          ),
        );
      const ended =
        Number(removed.rowsAffected ?? 0) > 0 ||
        (await isLivePushUser(ctx.drizzle, ctx.userId));
      if (!ended) return errorResponse("Character no longer exists");
      return { success: true, message: "Activity ended" };
    }),

  /** Send a test alert to the player's own devices, so they can confirm delivery. */
  sendTest: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    if (!isPushEnabled()) return errorResponse("Push is not configured on this server");
    const summary = await sendPushToUsers(ctx.drizzle, [ctx.userId], deliveryTest());
    if (summary.sent === 0) {
      return errorResponse(
        "No device received the test. Check that notifications are allowed for TheNinja-RPG.",
      );
    }
    return {
      success: true,
      message: `Test sent to ${summary.sent} device${summary.sent === 1 ? "" : "s"}`,
    };
  }),
});

/**
 * The guard every identity-scoped push write carries, as part of its own statement.
 *
 * These three writes are the one place in this router that drops to a raw statement, and
 * only because the builder cannot attach a condition to an INSERT: the guard has to be
 * evaluated by the same statement that writes, or there is a window between them. The
 * guarded DELETE below needs no such thing, since a WHERE is just a WHERE.
 *
 * A write must not outlive the account it names. `retireStoreUserId` lays the tombstone
 * down before it purges, so a write either sees the tombstone and does nothing, or landed
 * before it and is removed by the purge that follows. Testing this inside the statement is
 * what makes that true without a lock: the check and the write commit together, so there
 * is no window between them for a retirement to slip through.
 */
const livePushUser = (userId: string) =>
  sql`EXISTS (SELECT 1 FROM ${userData} WHERE userId = ${userId}) AND NOT EXISTS (SELECT 1 FROM ${storeUserIdAlias} WHERE oldUserId = ${userId})`;

/**
 * Why a guarded write matched nothing. Only worth asking once one has, since an upsert
 * that changed a timestamp always reports a row.
 */
const isLivePushUser = async (
  client: DrizzleClient,
  userId: string,
): Promise<boolean> => {
  const [liveUser, retiredIdentity] = await Promise.all([
    client.query.userData.findFirst({
      columns: { userId: true },
      where: eq(userData.userId, userId),
    }),
    client.query.storeUserIdAlias.findFirst({
      columns: { oldUserId: true },
      where: eq(storeUserIdAlias.oldUserId, userId),
    }),
  ]);
  return !!liveUser && !retiredIdentity;
};

/**
 * Keep the newest devices and drop the rest. Without this a player who reinstalls
 * repeatedly accumulates dead tokens that every fan-out then has to try.
 */
const evictExcessDevices = async (client: DrizzleClient, others: { id: string }[]) => {
  // `others` excludes the device that just registered, so the cap it is measured against
  // is one lower: that device holds the first slot and is never a candidate here.
  const excess = others.slice(PUSH_MAX_DEVICES_PER_USER - 1).map((device) => device.id);
  if (excess.length === 0) return;
  await client.delete(userDevice).where(inArray(userDevice.id, excess));
};
