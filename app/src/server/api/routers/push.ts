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
import { userDevice, userLiveActivity, userPushPreference } from "@/drizzle/schema";
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
      // The eviction snapshot rides alongside the upsert rather than waiting for it. It
      // deliberately excludes this device by token, so it does not matter whether the
      // upsert has landed yet -- the row for the phone registering right now is the one
      // device guaranteed to survive, being the most recently seen.
      const [, others] = await Promise.all([
        ctx.drizzle
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
          }),
        ctx.drizzle
          .select({ id: userDevice.id })
          .from(userDevice)
          .where(
            and(eq(userDevice.userId, ctx.userId), ne(userDevice.token, input.token)),
          )
          .orderBy(desc(userDevice.lastSeenAt)),
      ]);
      // One slot is spoken for by the device above, hence the cap less one.
      await evictExcessDevices(ctx.drizzle, others);
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
   * the previous account. Authority comes from holding the device token, which only that
   * device has, and the worst an attacker with a stolen token achieves is stopping
   * notifications to a phone that recovers them by reopening the app. Listed in
   * PUBLIC_MUTATIONS.
   */
  unregisterDevice: publicProcedure
    .input(unregisterDeviceSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle.delete(userDevice).where(eq(userDevice.token, input.token));
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
      await ctx.drizzle
        .insert(userPushPreference)
        .values({
          id: nanoid(),
          userId: ctx.userId,
          category: input.category,
          enabled: input.enabled,
          updatedAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: { enabled: input.enabled, updatedAt: new Date() },
        });
      return {
        success: true,
        message: `${input.category} notifications ${input.enabled ? "enabled" : "disabled"}`,
      };
    }),

  /**
   * Record a Live Activity the device just started, so the server can push updates to it.
   * One per kind per player: a second hospital countdown would only replace the first on
   * screen, so re-registering rebinds rather than accumulating dead tokens.
   */
  registerActivity: protectedProcedure
    .input(registerActivitySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .insert(userLiveActivity)
        .values({
          id: nanoid(),
          userId: ctx.userId,
          activityId: input.activityId,
          kind: input.kind,
          pushToken: input.pushToken,
          endsAt: input.endsAt,
          createdAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: {
            activityId: input.activityId,
            pushToken: input.pushToken,
            endsAt: input.endsAt,
            createdAt: new Date(),
          },
        });
      return { success: true, message: "Activity registered" };
    }),

  /** Called when the device ends an activity locally, so we stop pushing to a dead token. */
  endActivity: protectedProcedure
    .input(endActivitySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .delete(userLiveActivity)
        .where(
          and(
            eq(userLiveActivity.userId, ctx.userId),
            eq(userLiveActivity.kind, input.kind),
          ),
        );
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
