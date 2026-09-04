import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
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
      const registered = await mutateLivePushUser(
        ctx.drizzle,
        ctx.userId,
        async (lockedClient) => {
          // PlanetScale advances its transaction session token with each response, so no
          // two statements inside the transaction may share the same prior session.
          await lockedClient
            .insert(userDevice)
            .values({
              id: nanoid(),
              userId: ctx.userId,
              token: input.token,
              platform: input.platform,
              appVersion: input.appVersion,
              locale: input.locale,
              widgetToken,
              createdAt: now,
              lastSeenAt: now,
            })
            .onDuplicateKeyUpdate({
              set: {
                userId: ctx.userId,
                platform: input.platform,
                appVersion: input.appVersion,
                locale: input.locale,
                widgetToken,
                lastSeenAt: now,
              },
            });
          const others = await lockedClient
            .select({ id: userDevice.id })
            .from(userDevice)
            .where(
              and(eq(userDevice.userId, ctx.userId), ne(userDevice.token, input.token)),
            )
            .orderBy(desc(userDevice.lastSeenAt));
          // One slot is spoken for by the device above, hence the cap less one.
          await evictExcessDevices(lockedClient, others);
        },
      );
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
      const updated = await mutateLivePushUser(
        ctx.drizzle,
        ctx.userId,
        async (lockedClient) => {
          await lockedClient
            .insert(userPushPreference)
            .values({
              id: nanoid(),
              userId: ctx.userId,
              category: input.category,
              enabled: input.enabled,
              updatedAt,
            })
            .onDuplicateKeyUpdate({
              set: { enabled: input.enabled, updatedAt },
            });
        },
      );
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
      const registered = await mutateLivePushUser(
        ctx.drizzle,
        ctx.userId,
        async (lockedClient) => {
          await lockedClient
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
        },
      );
      if (!registered) return errorResponse("Character no longer exists");
      return { success: true, message: "Activity registered" };
    }),

  /** Called when this device ends an activity locally, without touching another device. */
  endActivity: protectedProcedure
    .input(endActivitySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const ended = await mutateLivePushUser(
        ctx.drizzle,
        ctx.userId,
        async (lockedClient) => {
          await lockedClient
            .delete(userLiveActivity)
            .where(
              and(
                eq(userLiveActivity.userId, ctx.userId),
                eq(userLiveActivity.activityId, input.activityId),
              ),
            );
        },
      );
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
 * Serialize identity-scoped push writes with account retirement and reject a stale Clerk
 * session after its character is gone. Statements stay sequential because PlanetScale's
 * transaction driver obtains the next session token from the preceding response.
 *
 * Locks only this player's rows. Retirement and staff renames both take the same
 * `UserData` row for update before they touch anything, so holding it here is what makes
 * those mutually exclusive with this write; the alias row closes the same race for an id
 * that has no player row yet. None of these writes touch the ownership graph, so the
 * global store mutex is not theirs to take -- doing so would queue every app launch,
 * preference toggle and hospital countdown behind every purchase in the game.
 */
const mutateLivePushUser = async (
  client: DrizzleClient,
  userId: string,
  mutation: (lockedClient: DrizzleClient) => Promise<void>,
): Promise<boolean> =>
  await client.transaction(async (tx) => {
    const lockedClient = tx as unknown as DrizzleClient;
    const [liveUser] = await lockedClient
      .select({ userId: userData.userId })
      .from(userData)
      .where(eq(userData.userId, userId))
      .for("update");
    const [retiredIdentity] = await lockedClient
      .select({ oldUserId: storeUserIdAlias.oldUserId })
      .from(storeUserIdAlias)
      .where(eq(storeUserIdAlias.oldUserId, userId))
      .for("update");
    if (!liveUser || retiredIdentity) return false;
    await mutation(lockedClient);
    return true;
  });

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
