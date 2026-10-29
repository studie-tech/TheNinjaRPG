import path from "node:path";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import TextToSVG from "text-to-svg";
import { z } from "zod";
import {
  DMG_SETTING_NAMES,
  Sentiment,
  TRAINING_CAPTCHA_REFRESHES_PER_MINUTE,
} from "@/drizzle/constants";
import {
  captchaAnswerMatches,
  randomCaptchaValue,
  showTrainingCapcha,
} from "@/libs/captcha";
import { getGameSettingBoost } from "@/libs/gameSettingBoost";
import { fetchDmgConfig, getGameSetting, updateGameSetting } from "@/libs/gamesettings";
import { getLayoutExperimentAssignments } from "@/libs/layoutPreference";
import { calcActiveUserRegen } from "@/libs/profile";
import { hasEnergyQueue } from "@/libs/queue";
import { fetchBloodlineCacheUser } from "@/queries/bloodline";
import {
  deleteEmailReminderForDeleteEmailReminder,
  fetchEmailReminder,
  findUserEmailReminder,
  updateEmailReminderForToggleEmailReminder,
} from "@/queries/emailReminder";
import { findGameSettingByName } from "@/queries/gamesettings";
import {
  acknowledgeAnnouncements,
  countCaptchaForRefreshCaptcha,
  fetchGameAssets,
  findAnnouncementReceipt,
  findCaptchaForGenerateCaptcha,
  findCaptchaForSolvedCaptchaRecently,
  findConversationForGetGlobalTavernEnabled,
  insertAbEventForTrackVisitor,
  insertCaptchaForGenerateCaptcha,
  insertNotificationForSubmitNotification,
  insertSupportReviewForReviewSupportWithAI,
  insertUserRewardsForAwardReputation,
  insertVisitorLogForTrackVisitor,
  listNotificationForGetPreviousNotifications,
  listSupportReviewForReviewSupportWithAI,
  listUserDataForAwardReputation,
  listUserIdsMatchingUsername,
  listUserRewardsForGetAllAwards,
  updateCaptchaForRefreshCaptcha,
  updateCaptchaForValidateCaptcha,
  updateConversationForToggleGlobalTavern,
  updateUserDataForAwardReputation,
  updateUserDataForSubmitNotification,
} from "@/queries/misc";
import {
  fetchAllGameSettings,
  fetchUser,
  listNotificationForGetUser,
} from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  canAwardReputation,
  canEnableGlobalTavern,
  canModifyCombatSettings,
  canModifyEventGains,
  canSubmitNotification,
} from "@/utils/permissions";
import { secondsFromNow } from "@/utils/time";
import { trackVisitorSchema } from "@/validators/analytics";
import { confSchema } from "@/validators/combat";
import { changeSettingSchema } from "@/validators/misc";
import { awardSchema, awardsFilteringSchema } from "@/validators/reputation";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const miscRouter = createTRPCRouter({
  trackVisitor: publicProcedure
    .meta({ mcp: { description: "Track visitor for analytics" } })
    .input(trackVisitorSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Only track if not logged in
      if (ctx.userId) return { success: true, message: "Already logged in" };
      const ip = ctx.userIp ?? "unknown";
      if (ip === "unknown") return { success: false, message: "No IP detected" };

      const experiments = getLayoutExperimentAssignments({
        abLemuReplacementVariant: ctx.abLemuReplacementVariant,
        wallpaperVariant:
          input.wallpaperVariant === ctx.wallpaperVariant
            ? ctx.wallpaperVariant
            : undefined,
      });

      // Insert new visitor and log AB test loaded events (if applicable) in parallel
      await Promise.all([
        insertVisitorLogForTrackVisitor(ctx.drizzle, ip, input, ctx),
        ...experiments.map((experiment) =>
          insertAbEventForTrackVisitor(ctx.drizzle, experiment, input, ip, ctx),
        ),
      ]);
      return { success: true, message: "Visitor tracked" };
    }),
  getAllGameAssetNames: publicProcedure
    .meta({ mcp: { description: "Get all game asset names" } })
    .input(z.object({ ids: z.array(z.string()) }).nullish())
    .query(async ({ ctx, input }) => {
      return await fetchGameAssets(ctx.drizzle, input?.ids);
    }),
  getCaptcha: protectedProcedure
    .meta({ mcp: { description: "Get captcha for verification" } })
    .use(ratelimitMiddleware)
    .query(async ({ ctx }) => {
      return await generateCaptcha(ctx.drizzle, ctx.userId);
    }),
  refreshCaptcha: protectedProcedure
    .meta({ mcp: { description: "Replace the pending captcha with a new one" } })
    .use(ratelimitMiddleware)
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      return await refreshCaptcha(ctx.drizzle, ctx.userId);
    }),
  verifyCaptcha: protectedProcedure
    .meta({ mcp: { description: "Answer the pending training captcha" } })
    .use(ratelimitMiddleware)
    .input(z.object({ guess: z.string().trim().min(1).max(20) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // A correct answer starts the grace window that every training action checks
      if (await validateCaptcha(ctx.drizzle, ctx.userId, input.guess)) {
        return { success: true, message: "Verified" };
      }
      return errorResponse("That wasn't right, try this new one");
    }),
  submitNotification: protectedProcedure
    .input(z.object({ content: z.string().min(2).max(10000), senderId: z.string() }))
    .output(
      userDeltaResponseSchema.extend({ announcements: z.array(z.string()).optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query data
      const [user, sender] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.senderId),
      ]);
      // Guards
      if (!canSubmitNotification(user.role)) return errorResponse("Not allowed");
      if (user.userId !== sender.userId && !sender.isAi) {
        return errorResponse("You or an AI must be marked as sender");
      }
      // Update database
      const [result] = await Promise.all([
        insertNotificationForSubmitNotification(ctx.drizzle, sender, input),
        updateUserDataForSubmitNotification(ctx.drizzle),
      ]);
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could insert notificaiton in db" };
      } else {
        const receipt = await findAnnouncementReceipt(ctx.drizzle, ctx.userId).catch(
          () => undefined,
        );
        const count = receipt?.unreadNotifications ?? 0;
        const unread =
          count > 0
            ? await listNotificationForGetUser(ctx.drizzle, {
                unreadNotifications: count,
              }).catch(() => undefined)
            : undefined;
        // A failed optional read leaves the announcement available to canonical hydration.
        const acknowledged = unread
          ? await acknowledgeAnnouncements(ctx.drizzle, ctx.userId, count)
          : undefined;
        return {
          success: true,
          message: "Notification sent",
          ...(acknowledged?.rowsAffected && unread
            ? {
                userPatch: { unreadNotifications: 0 },
                announcements: unread.map((entry) => entry.content),
              }
            : {}),
        };
      }
    }),
  getPreviousNotifications: protectedProcedure
    .meta({
      mcp: { description: "Get paginated notifications history" },
    })
    .input(
      z.object({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const results = await listNotificationForGetPreviousNotifications(
        ctx.drizzle,
        skip,
        input,
      );
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  getSetting: publicProcedure
    .meta({ mcp: { description: "Get a game setting by name" } })
    .input(z.object({ name: z.string() }))
    .query(async ({ ctx, input }) => {
      const setting = await findGameSettingByName(ctx.drizzle, input.name);
      return setting ?? null;
    }),
  getGlobalTavernEnabled: publicProcedure
    .meta({ mcp: { description: "Check if global tavern is enabled" } })
    .query(async ({ ctx }) => {
      const convo = await findConversationForGetGlobalTavernEnabled(ctx.drizzle);
      // Default to enabled if conversation not found
      return convo?.isEnabled ?? true;
    }),
  toggleGlobalTavern: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, convo] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findConversationForGetGlobalTavernEnabled(ctx.drizzle),
      ]);
      // Guards
      if (!canEnableGlobalTavern(user.role)) return errorResponse("Not allowed");
      if (!convo) return errorResponse("Global conversation not found");
      // Update the Global conversation's isEnabled field
      await updateConversationForToggleGlobalTavern(ctx.drizzle, input, convo);
      return {
        success: true,
        message: `Global tavern ${input.enabled ? "enabled" : "disabled"}`,
      };
    }),
  getActivePlayers24h: publicProcedure
    .meta({
      mcp: { description: "Get active players in last 24 hours" },
    })
    .output(z.number())
    .query(async ({ ctx }) => {
      const setting = await getGameSetting(ctx.drizzle, "hourly-active-players");
      return setting.value;
    }),
  setEventGameSetting: protectedProcedure
    .input(changeSettingSchema)
    .output(
      userDeltaResponseSchema.extend({
        boostNavigation: z
          .object({
            href: z.string(),
            label: z.string(),
            notice: z
              .object({
                href: z.string(),
                name: z.string(),
                color: z.literal("green"),
                group: z.literal("Active boosts"),
              })
              .nullable(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, settings] = await Promise.all([
        fetchBloodlineCacheUser(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      if (!user) return errorResponse("User not found");
      // Guards
      if (!canModifyEventGains(user.role)) return errorResponse("Not allowed");
      // Update
      const setting = {
        name: input.setting,
        value: parseInt(input.multiplier, 10),
        time: secondsFromNow(input.days * 24 * 3600),
      };
      await updateGameSetting(ctx.drizzle, setting.name, setting.value, setting.time);
      const changedSettings = [
        ...settings.filter((entry) => entry.name !== setting.name),
        { ...setting, id: "" },
      ];
      const boost = getGameSettingBoost(setting.name, changedSettings);
      const [href, label] = {
        trainingGainMultiplier: ["/traininggrounds", "gains"],
        regenGainMultiplier: ["/profile", "regen"],
        battleExpMultiplier: ["/battlearena", "battle exp"],
        missionExpMultiplier: ["/missionhall", "mission exp"],
        jutsuExpMultiplier: ["/jutsus", "jutsu exp"],
        itemExpMultiplier: ["/items", "item exp"],
      }[input.setting] as [string, string];
      return {
        success: true,
        message: `Setting set to: ${input.multiplier}X`,
        userPatch:
          input.setting === "regenGainMultiplier"
            ? {
                regeneration: calcActiveUserRegen(user, changedSettings),
                regenerationWithoutTimedBuffs: calcActiveUserRegen(
                  user,
                  changedSettings,
                  false,
                ),
              }
            : {},
        boostNavigation: {
          href,
          label,
          notice: boost
            ? {
                href,
                name: `Global: ${boost.value}X ${label} | ${boost.daysLeft} days`,
                color: "green" as const,
                group: "Active boosts" as const,
              }
            : null,
        },
      };
    }),
  getDmgConfig: publicProcedure
    .meta({
      mcp: { description: "Get the current damage formula config" },
    })
    .query(async ({ ctx }) => {
      return await fetchDmgConfig(ctx.drizzle);
    }),
  setDmgConfig: protectedProcedure
    .input(confSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guards
      if (!canModifyCombatSettings(user.role)) return errorResponse("Not allowed");
      // Update all DMG settings in parallel
      const nameToValue: Record<string, number> = {
        DMG_STATS_SCALING: input.stats_scaling,
        DMG_BASE_HITS: input.base_hits,
        DMG_CURVE: input.curve,
        DMG_AMPLITUDE: input.amplitude,
        DMG_EP_NORMALIZATION: input.ep_normalization,
        DMG_GEN_WEIGHT: input.gen_weight,
        DMG_ADVANTAGE_MIN: input.advantage_min,
        DMG_ADVANTAGE_MAX: input.advantage_max,
      };
      await Promise.all(
        DMG_SETTING_NAMES.map((name) =>
          updateGameSetting(ctx.drizzle, name, nameToValue[name] ?? 0, new Date()),
        ),
      );
      return { success: true, message: "Damage config updated" };
    }),
  awardReputation: protectedProcedure
    .input(awardSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch admin user
      const admin = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard checks section
      if (!canAwardReputation(admin.role)) {
        return errorResponse("Not authorized to award points");
      }

      // Fetch all target users in a single query
      const users = await listUserDataForAwardReputation(ctx.drizzle, input);

      // Check if any users are missing
      if (users.length !== input.userIds.length) {
        return errorResponse("One or more users not found");
      }

      // Create rewards records for all users
      const rewardsToInsert = users.map((user) => ({
        id: nanoid(),
        awardedById: admin.userId,
        receiverId: user.userId,
        reputationAmount: input.reputationAmount || 0,
        moneyAmount: input.moneyAmount || 0,
        reason: input.reason,
      }));

      // Execute both operations in parallel
      const [, credited] = await Promise.all([
        // Batch insert all rewards
        insertUserRewardsForAwardReputation(ctx.drizzle, rewardsToInsert),

        // Update all users in a single query
        updateUserDataForAwardReputation(ctx.drizzle, input),
      ]);

      return {
        success: true,
        // Reputation changes advance quest and achievement objectives on the next profile fetch.
        userDelta:
          !input.reputationAmount &&
          input.userIds.includes(ctx.userId) &&
          !hasEnergyQueue(admin) &&
          credited.rowsAffected === users.length &&
          Number.isInteger(input.moneyAmount ?? 0)
            ? { money: input.moneyAmount ?? 0 }
            : undefined,
        message: `Rewards awarded successfully to ${users.length} user(s)`,
      };
    }),

  getAllAwards: publicProcedure
    .meta({ mcp: { description: "Get all reputation awards" } })
    .input(
      awardsFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input?.cursor ? input.cursor : 0;
      const limit = input?.limit ? input.limit : 100;
      const skip = currentCursor * limit;

      // Resolve username filters to userId arrays (done upfront to keep main query simple)
      const [receiverIds, awardedByIds] = await Promise.all([
        input.awardedTo
          ? listUserIdsMatchingUsername(ctx.drizzle, input.awardedTo).then((rows) =>
              rows.map((r) => r.userId),
            )
          : Promise.resolve<string[]>([]),
        input.awardedBy
          ? listUserIdsMatchingUsername(ctx.drizzle, input.awardedBy).then((rows) =>
              rows.map((r) => r.userId),
            )
          : Promise.resolve<string[]>([]),
      ]);

      // Compute date range for a given day if provided (UTC day)
      const dayStart = input.date ? new Date(input.date) : undefined;
      const dayEnd = dayStart ? new Date(dayStart) : undefined;
      if (dayEnd) dayEnd.setDate(dayEnd.getDate() + 1);

      const results = await listUserRewardsForGetAllAwards(
        ctx.drizzle,
        skip,
        limit,
        input,
        dayStart,
        dayEnd,
        receiverIds,
        awardedByIds,
      );

      const nextCursor = results.length < limit ? null : currentCursor + 1;
      return { data: results, nextCursor: nextCursor };
    }),

  getPersonalEmailReminder: protectedProcedure
    .meta({ mcp: { description: "Get user's email reminder settings" } })
    .query(async ({ ctx }) => {
      const reminder = await findUserEmailReminder(ctx.drizzle, ctx);
      return reminder ?? null;
    }),

  getEmailReminder: publicProcedure
    .meta({ mcp: { description: "Get email reminder by secret" } })
    .input(z.object({ email: z.email(), secret: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchEmailReminder(ctx.drizzle, input.email, input.secret);
      return result ?? null;
    }),

  toggleEmailReminder: publicProcedure
    .meta({ mcp: { description: "Toggle email reminder on/off" } })
    .input(
      z.object({
        email: z.email(),
        secret: z.string(),
        disabled: z.boolean(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Find the email reminder
      const reminder = await fetchEmailReminder(ctx.drizzle, input.email, input.secret);

      if (!reminder) {
        return errorResponse("Email reminder not found");
      }

      // Update the disabled status
      const result = await updateEmailReminderForToggleEmailReminder(
        ctx.drizzle,
        input,
      );

      if (result.rowsAffected === 0) {
        return { success: false, message: "Failed to update email reminder" };
      }

      return {
        success: true,
        message: `Email reminders ${input.disabled ? "disabled" : "enabled"} successfully`,
      };
    }),

  deleteEmailReminder: publicProcedure
    .meta({ mcp: { description: "Delete email reminder" } })
    .input(
      z.object({
        email: z.email(),
        secret: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Find the email reminder
      const reminder = await fetchEmailReminder(ctx.drizzle, input.email, input.secret);

      if (!reminder) {
        return errorResponse("Email reminder not found");
      }

      // Delete the email reminder
      const result = await deleteEmailReminderForDeleteEmailReminder(
        ctx.drizzle,
        input,
      );

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to delete email reminder");
      }

      return {
        success: true,
        message: "Email reminder deleted successfully",
      };
    }),

  reviewSupportWithAI: protectedProcedure
    .meta({ mcp: { description: "Submit AI support chat review" } })
    .input(
      z.object({
        apiRoute: z.string(),
        chatHistory: z.array(z.any()),
        sentiment: z.enum(Sentiment),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const reviewsToday = await listSupportReviewForReviewSupportWithAI(ctx.drizzle);
      // Guard
      if (reviewsToday.length >= 5) {
        return errorResponse(
          "You have reached the maximum number of reviews for today",
        );
      }
      // Insert
      await insertSupportReviewForReviewSupportWithAI(ctx.drizzle, ctx, input);
      return { success: true, message: "Review submitted" };
    }),
});

/**
 * `Captcha.createdAt` stores its event time one day ahead (the column default), which the
 * cleaner's 30-day expiry is measured against; comparisons and refreshes keep that offset.
 */
const captchaNow = sql`CURRENT_TIMESTAMP(3) + INTERVAL 1 DAY`;

/**
 * Whether the user solved a captcha within `TRAINING_CAPTCHA_SOLVED_GRACE_MINUTES`.
 */
export const solvedCaptchaRecently = async (client: DrizzleClient, userId: string) => {
  const solved = await findCaptchaForSolvedCaptchaRecently(client, userId, captchaNow);
  return Boolean(solved);
};

/**
 * Generate the user's pending captcha image, reusing an unanswered one. Returns no image
 * while a recent solve still covers training, so the page hides the challenge.
 */
export const generateCaptcha = async (client: DrizzleClient, userId: string) => {
  // Fetch
  const [current, recentlySolved] = await Promise.all([
    findCaptchaForGenerateCaptcha(client, userId),
    solvedCaptchaRecently(client, userId),
  ]);
  if (recentlySolved) return { svg: null };
  // Value to guess
  const value = current?.value ?? randomCaptchaValue();
  const svg = renderCaptchaSvg(value);
  // Insert into database
  if (!current) {
    // Create a new captcha
    await insertCaptchaForGenerateCaptcha(client, userId, value);
  }
  // Return svg & hash
  return { svg };
};

/**
 * Render a captcha value as dark glyphs on a light card, spaced one per slot, so it stays
 * high-contrast on the dark game UI.
 */
const renderCaptchaSvg = (value: string) => {
  const textToSVG = TextToSVG.loadSync(path.resolve("./fonts/OpenSans.ttf"));
  const [fontSize, slot, padding, height] = [48, 44, 16, 72];
  const width = 2 * padding + slot * value.length;
  const glyphs = [...value].map((char, i) =>
    textToSVG.getPath(char, {
      x: padding + slot * i + slot / 2,
      y: height / 2,
      fontSize,
      anchor: "center middle",
      attributes: { fill: "#111111" },
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="8" fill="#ffffff"/>${glyphs.join("")}</svg>`;
};

/**
 * Replace the user's pending captcha with a new one, consuming the old one as failed.
 * At most `TRAINING_CAPTCHA_REFRESHES_PER_MINUTE` captchas are created per minute.
 */
export const refreshCaptcha = async (client: DrizzleClient, userId: string) => {
  // Query
  const recent = await countCaptchaForRefreshCaptcha(client, userId, captchaNow);
  // Guard
  if (recent >= TRAINING_CAPTCHA_REFRESHES_PER_MINUTE) {
    return errorResponse("Too many new captchas, wait a minute and try again");
  }
  // Mutate
  await updateCaptchaForRefreshCaptcha(client, userId);
  await generateCaptcha(client, userId);
  return { success: true, message: "New captcha generated" };
};

/**
 * Validate a guess against the user's pending captcha and consume it. A correct answer
 * restamps the row with the solve time, which starts the training grace window.
 */
export const validateCaptcha = async (
  client: DrizzleClient,
  userId: string,
  guess: string,
) => {
  // Fetch
  const current = await findCaptchaForGenerateCaptcha(client, userId);
  // Check
  if (current) {
    const success = captchaAnswerMatches(current.value, guess);
    await updateCaptchaForValidateCaptcha(client, success, captchaNow, current);
    return success;
  }
  return false;
};

/**
 * Why a stat, Energy queue or mastery training action is blocked by the captcha, or null.
 * The count rule in `showTrainingCapcha` decides when to ask; a solve then covers every
 * training action for the grace window, since Energy actions do not advance the count.
 */
export const trainingCaptchaMessage = async (
  client: DrizzleClient,
  user: Parameters<typeof showTrainingCapcha>[0] & { userId: string },
  guess: string | undefined,
) => {
  if (!showTrainingCapcha(user)) return null;
  if (await solvedCaptchaRecently(client, user.userId)) return null;
  if (!guess) return "Captcha required";
  if (!(await validateCaptcha(client, user.userId, guess))) return "Invalid captcha";
  return null;
};
