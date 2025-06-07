import { z } from "zod";
import { nanoid, customAlphabet } from "nanoid";
import { count, eq, ne, sql, gte, and, or, like, asc, desc, isNull } from "drizzle-orm";
import { inArray, notInArray } from "drizzle-orm";
import {
  secondsPassed,
  secondsFromNow,
  getTimeOfLastReset,
  isDifferentDay,
} from "@/utils/time";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { serverError, baseServerResponse, errorResponse } from "../trpc";
import {
  actionLog,
  bankTransfers,
  battleHistory,
  gameSetting,
  item,
  jutsu,
  notification,
  poll,
  quest,
  questHistory,
  userAttribute,
  userBlackList,
  userData,
  userItem,
  userJutsu,
  userNindo,
  userPollVote,
  userReport,
  userVote,
  historicalIp,
  village,
  userActivityEvent,
} from "@/drizzle/schema";
import { canSeeSecretData, canDeleteUsers, canSeeIps } from "@/utils/permissions";
import { canChangeContent, canModerateRoles } from "@/utils/permissions";
import { canInteractWithPolls } from "@/utils/permissions";
import { canEditPublicUser } from "@/utils/permissions";
import { usernameSchema } from "@/validators/register";
import { insertNextQuest } from "@/routers/quests";
import { fetchClan, removeFromClan } from "@/routers/clan";
import { fetchVillage } from "@/routers/village";
import { getNewTrackers } from "@/libs/quest";
import { mockAchievementHistoryEntries } from "@/libs/quest";
import { mutateContentSchema } from "@/validators/comments";
import { attributes } from "@/validators/register";
import { colors, skin_colors } from "@/validators/register";
import { callDiscordContent } from "@/libs/discord";
import { scaleUserStats } from "@/libs/profile";
import { insertAiSchema } from "@/drizzle/schema";
import { calcLevelRequirements } from "@/libs/profile";
import { activityStreakRewards } from "@/libs/profile";
import { calcHP, calcSP, calcCP } from "@/libs/profile";
import { COST_CHANGE_USERNAME } from "@/drizzle/constants";
import { MAX_ATTRIBUTES } from "@/drizzle/constants";
import { REGEN_SECONDS } from "@/drizzle/constants";
import { createStatSchema } from "@/libs/combat/types";
import { isAvailableUserQuests } from "@/libs/quest";
import {
  getGameSettingBoost,
  getGameSetting,
  updateGameSetting,
} from "@/libs/gamesettings";
import { updateUserSchema } from "@/validators/user";
import { updateUserPreferencesSchema } from "@/validators/user";
import { canChangeUserRole } from "@/utils/permissions";
import { UserRanks, BasicElementName } from "@/drizzle/constants";
import { getRandomElement } from "@/utils/array";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import { capUserStats } from "@/libs/profile";
import { calcActiveUserRegen } from "@/libs/profile";
import { getServerPusher } from "@/libs/pusher";
import { RYO_CAP } from "@/drizzle/constants";
import { USER_CAPS } from "@/drizzle/constants";
import { getReducedGainsDays } from "@/libs/train";
import { calculateContentDiff } from "@/utils/diff";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { ACTIVE_VOTING_SITES } from "@/drizzle/constants";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { KAGE_MIN_PRESTIGE } from "@/drizzle/constants";
import { KAGE_PRESTIGE_REQUIREMENT } from "@/drizzle/constants";
import { ALLIANCEHALL_LONG, ALLIANCEHALL_LAT } from "@/libs/travel/constants";
import { hideQuestInformation } from "@/libs/quest";
import { getPublicUsersSchema } from "@/validators/user";
import { createThumbnail } from "@/libs/replicate";
import sanitize from "@/utils/sanitize";
import { deleteUser } from "@/server/api/routers/staff";
import { moderateContent } from "@/libs/moderator";
import { fetchKageReplacement } from "@/routers/kage";
import { validateUserUpdateReason } from "@/libs/moderator";
import type { UserVote } from "@/drizzle/schema";
import type { GetPublicUsersSchema } from "@/validators/user";
import type { UserJutsu, UserItem } from "@/drizzle/schema";
import type { UserData, Bloodline } from "@/drizzle/schema";
import type { Village, VillageAlliance, VillageStructure } from "@/drizzle/schema";
import type { UserQuest, Clan, Quest } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { NavBarDropdownLink } from "@/libs/menus";

const pusher = getServerPusher();

export const profileRouter = createTRPCRouter({
  // Update battle description setting
  updateBattleDescription: protectedProcedure
    .input(z.object({ showBattleDescription: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({ showBattleDescription: input.showBattleDescription })
        .where(eq(userData.userId, ctx.userId));
      // Potential errors
      if (result.rowsAffected === 0) {
        return errorResponse("Could not update battle description setting");
      }
      // Information
      return {
        success: true,
        message: `Battle descriptions ${input.showBattleDescription ? "enabled" : "disabled"}`,
      };
    }),
  // Toggle audio setting
  toggleAudio: protectedProcedure
    .output(
      baseServerResponse.extend({
        data: z.object({ audioOn: z.boolean() }).optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Get current user data
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
        columns: { audioOn: true },
      });
      // Guard
      if (!user) return errorResponse("User not found");
      // Derived
      const newAudioState = !user.audioOn;
      // Update the database
      await ctx.drizzle
        .update(userData)
        .set({ audioOn: newAudioState })
        .where(eq(userData.userId, ctx.userId));
      // Return success response
      return {
        success: true,
        message: `Audio ${newAudioState ? "enabled" : "disabled"}`,
        data: { audioOn: newAudioState },
      };
    }),
  // Update tutorial step
  updateTutorialStep: protectedProcedure
    .input(z.object({ step: z.number() }))
    .output(
      baseServerResponse.extend({
        data: z.object({ tutorialStep: z.number() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Update the database
      await ctx.drizzle
        .update(userData)
        .set({ tutorialStep: input.step })
        .where(eq(userData.userId, ctx.userId));

      // Return success response
      return {
        success: true,
        message: `Tutorial step updated to ${input.step}`,
        data: { tutorialStep: input.step },
      };
    }),
  // Update user preferences
  updatePreferences: protectedProcedure
    .input(updateUserPreferencesSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.drizzle
        .update(userData)
        .set(input)
        .where(eq(userData.userId, ctx.userId));
      return {
        success: result.rowsAffected > 0,
        message:
          result.rowsAffected > 0
            ? "Updated preferences"
            : "Failed to update preferences",
      };
    }),
  // Get user blacklist
  getBlacklist: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.userBlackList.findMany({
      where: eq(userBlackList.creatorUserId, ctx.userId),
      with: {
        target: { columns: { username: true, userId: true, avatar: true } },
      },
    });
  }),
  toggleBlacklistEntry: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [entry, target] = await Promise.all([
        ctx.drizzle.query.userBlackList.findFirst({
          where: and(
            eq(userBlackList.creatorUserId, ctx.userId),
            eq(userBlackList.targetUserId, input.userId),
          ),
        }),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, input.userId),
        }),
      ]);
      // Guard
      if (!target) return errorResponse("User not found");
      if (ctx.userId === input.userId) return errorResponse("Not yourself");
      // Derived
      const targetName = target.username;
      // Mutate
      if (!entry) {
        const result = await ctx.drizzle.insert(userBlackList).values({
          creatorUserId: ctx.userId,
          targetUserId: input.userId,
        });
        if (result.rowsAffected === 0) {
          return { success: false, message: `Failed to add ${targetName}` };
        } else {
          return { success: true, message: `Added ${targetName} to blacklist` };
        }
      } else {
        await ctx.drizzle.delete(userBlackList).where(eq(userBlackList.id, entry.id));
        return { success: true, message: `Removed ${targetName} from blacklist` };
      }
    }),
  // Get all AI names
  getAllAiNames: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.userData.findMany({
      where: and(eq(userData.isAi, true), ne(userData.rank, "ELDER")),
      columns: {
        userId: true,
        username: true,
        level: true,
        avatar: true,
        isSummon: true,
        inArena: true,
      },
      orderBy: asc(userData.level),
    });
  }),
  // Update user with new level
  levelUp: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    // Query
    const { user } = await fetchUpdatedUser({
      client: ctx.drizzle,
      userId: ctx.userId,
    });
    // Guard
    if (!user) return errorResponse("User not found");
    const expRequired = calcLevelRequirements(user.level) - user.experience;
    const lvlCap = USER_CAPS[user.rank].LVL_CAP;
    if (user.level >= lvlCap) return errorResponse("User at max level for this rank!");
    if (expRequired > 0) return errorResponse("No enough experience for level");
    // Mutate
    const newLevel = user.level + 1;
    const { trackers } = getNewTrackers(user, [
      { task: "user_level", value: newLevel },
    ]);
    const result = await ctx.drizzle
      .update(userData)
      .set({
        level: newLevel,
        maxHealth: calcHP(newLevel),
        maxStamina: calcSP(newLevel),
        maxChakra: calcCP(newLevel),
        questData: trackers,
      })
      .where(and(eq(userData.userId, ctx.userId), eq(userData.level, user.level)));
    if (result.rowsAffected > 0 && user.recruiterId) {
      const amount = newLevel * 10;
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({ bank: sql`${userData.bank} + ${amount}` })
          .where(eq(userData.userId, user.recruiterId)),
        ctx.drizzle.insert(bankTransfers).values({
          senderId: ctx.userId,
          receiverId: user.recruiterId,
          amount: amount,
          type: "recruiter",
        }),
      ]);
    }
    // Return response
    if (result.rowsAffected === 0) return errorResponse("Could not update level");
    return { success: true, message: `User leveled up to ${newLevel}` };
  }),
  // Get all information on logged in user
  getUser: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const { user, settings, rewards, hasUnvotedPolls } = await fetchUpdatedUser({
      client: ctx.drizzle,
      userId: ctx.userId,
      userIp: ctx.userIp,
      // forceRegen: true, // This should be disabled in prod to save on DB calls
    });
    // Figure out notifications
    const notifications: NavBarDropdownLink[] = [];
    if (rewards) {
      if (rewards.money > 0) {
        notifications.push({
          href: "/profile",
          name: `Activity streak reward: ${rewards.money} ryo`,
          color: "toast",
        });
      }
      if (rewards.reputationPoints > 0) {
        notifications.push({
          href: "/profile",
          name: `Activity streak reward: ${rewards.reputationPoints} reputation points`,
          color: "toast",
        });
      }
    }
    // Add notification for unvoted polls
    if (
      user &&
      hasUnvotedPolls &&
      hasUnvotedPolls.length > 0 &&
      canInteractWithPolls(user.rank)
    ) {
      notifications.push({
        href: "/manual/polls",
        name: "Unvoted Polls",
        color: "blue",
      });
    }
    // Add a voting link
    let hasVoted = true;
    ACTIVE_VOTING_SITES.forEach((site) => {
      if (!user?.votes || user.votes[site] !== true) {
        hasVoted = false;
      }
    });
    if (!hasVoted) {
      notifications.push({
        href: "/profile/recruit",
        name: `Vote for Us`,
        color: "green",
      });
    }
    // Settings
    const trainingBoost = getGameSettingBoost("trainingGainMultiplier", settings);
    if (trainingBoost) {
      notifications.push({
        href: "/traininggrounds",
        name: `${trainingBoost.value}X gains | ${trainingBoost.daysLeft} days`,
        color: "green",
      });
    }
    const regenBoost = getGameSettingBoost("regenGainMultiplier", settings);
    if (regenBoost) {
      notifications.push({
        href: "/profile",
        name: `${regenBoost.value}X regen | ${regenBoost.daysLeft} days`,
        color: "green",
      });
    }
    // User specific
    if (user) {
      // War-time regen boost
      const warRegenName = `war-${user.village?.id}-regen`;
      const warRegenSetting = settings.find((s) => s.name === warRegenName);
      const warRegenBoost = getGameSettingBoost(warRegenName, settings);
      if (warRegenBoost) {
        notifications.push({
          href: "/profile",
          name: `+${warRegenBoost.value}% regen | ${warRegenBoost.daysLeft} days`,
          color: "green",
        });
      }
      if (!warRegenSetting) {
        await ctx.drizzle.insert(gameSetting).values({
          id: nanoid(),
          name: warRegenName,
          value: 0,
          time: new Date(),
        });
      }

      // War-time training boost
      const warTrainingName = `war-${user.village?.id}-train`;
      const warTrainingSetting = settings.find((s) => s.name === warTrainingName);
      const warTrainingBoost = getGameSettingBoost(warTrainingName, settings);
      if (warTrainingBoost) {
        notifications.push({
          href: "/profile",
          name: `+${warTrainingBoost.value}% gains | ${warTrainingBoost.daysLeft} days`,
          color: "green",
        });
      }
      if (!warTrainingSetting) {
        await ctx.drizzle.insert(gameSetting).values({
          id: nanoid(),
          name: warTrainingName,
          value: 0,
          time: new Date(),
        });
      }

      // Get number of un-resolved user reports
      if (canModerateRoles.includes(user.role)) {
        const reportCounts = await ctx.drizzle
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(userReport)
          .innerJoin(userData, eq(userData.userId, userReport.reportedUserId))
          .where(inArray(userReport.status, ["UNVIEWED", "BAN_ESCALATED"]));
        const userReports = reportCounts?.[0]?.count ?? 0;
        if (userReports > 0) {
          notifications.push({
            href: "/reports",
            name: `${userReports} waiting!`,
            color: "blue",
          });
        }
      }
      // Check if user is banned
      if (user.isBanned) {
        notifications.push({
          href: "/reports",
          name: "Banned!",
          color: "red",
        });
      }
      // Unused experience points
      if (user.earnedExperience > 0) {
        notifications.push({
          href: "/profile/experience",
          name: "Unassigned Stats",
          color: "blue",
        });
      }
      // Check if reduced gains
      const reducedDays = getReducedGainsDays(user);
      if (reducedDays > 0) {
        notifications.push({
          href: "/village",
          name: `Slowed ${Math.ceil(reducedDays)} days`,
          color: "red",
        });
      }
      // Add deletion timer to notifications
      if (user?.deletionAt) {
        notifications?.push({
          href: "/profile",
          name: "Being deleted",
          color: "red",
        });
      }
      // Is in combat
      if (user.status === "BATTLE") {
        notifications?.push({
          href: "/combat",
          name: "In combat",
          color: "red",
        });
      }
      // Is in hospital
      if (user.status === "HOSPITALIZED") {
        notifications?.push({
          href: "/hospital",
          name: "In hospital",
          color: "red",
        });
      }
      // Stuff in inbox
      if (user.inboxNews > 0) {
        notifications?.push({
          href: "/inbox",
          name: `${user.inboxNews} messages`,
          color: "green",
        });
      }
      // Stuff in news
      if (user.unreadNews > 0) {
        notifications?.push({
          href: "/news",
          name: `${user.unreadNews} news`,
          color: "green",
        });
      }
      if (user.unreadNotifications > 0) {
        const [unread] = await Promise.all([
          ctx.drizzle.query.notification.findMany({
            limit: user.unreadNotifications,
            orderBy: desc(notification.createdAt),
          }),
          ctx.drizzle
            .update(userData)
            .set({ unreadNotifications: 0 })
            .where(eq(userData.userId, ctx.userId)),
        ]);
        unread?.forEach((n) => {
          notifications?.push({
            href: "/news",
            name: n.content,
            color: "toast",
          });
        });
      }
    }
    return {
      userData: user,
      notifications: notifications,
      serverTime: Date.now(),
      userAgent: ctx.userAgent,
    };
  }),
  // Get an AI
  getAi: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: and(eq(userData.userId, input.userId), eq(userData.isAi, true)),
        with: { jutsus: { with: { jutsu: true } }, items: { with: { item: true } } },
      });
      // Filter off entries that do not exist
      if (user) {
        user.jutsus = user.jutsus.filter((j) => j.jutsu);
        user.items = user.items.filter((i) => i.item);
      }
      // Return user
      return user ?? null;
    }),
  // Create new AI
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await ctx.drizzle.insert(userData).values({
        userId: id,
        username: `New AI - ${id}`,
        gender: "Unknown",
        avatar: IMG_AVATAR_DEFAULT,
        avatarLight: IMG_AVATAR_DEFAULT,
        villageId: null,
        approvedTos: 1,
        sector: 0,
        level: 100,
        isAi: true,
      });
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create AI` };
    }
  }),
  // Clone an existing AI
  cloneAi: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, aiData, jutsuData, itemData, nindoData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, input.id),
        }),
        ctx.drizzle.query.userJutsu.findMany({
          where: eq(userJutsu.userId, input.id),
        }),
        ctx.drizzle.query.userItem.findMany({ where: eq(userItem.userId, input.id) }),
        ctx.drizzle.query.userNindo.findFirst({
          where: eq(userNindo.userId, input.id),
        }),
      ]);
      // Guard
      if (!aiData) return errorResponse("AI not found");
      if (!aiData.isAi) return errorResponse("Not an AI");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");

      // Create new AI with copied data
      aiData.userId = nanoid();
      aiData.username = `${aiData.username} - copy`;
      aiData.createdAt = new Date();
      aiData.updatedAt = new Date();
      // Run all inserts at once
      await Promise.all([
        ctx.drizzle.insert(userData).values(aiData),
        ...(jutsuData.length > 0
          ? [
              ctx.drizzle.insert(userJutsu).values(
                jutsuData.map((jutsu) => ({
                  id: nanoid(),
                  userId: aiData.userId,
                  jutsuId: jutsu.jutsuId,
                  level: jutsu.level,
                })),
              ),
            ]
          : []),
        ...(itemData.length > 0
          ? [
              ctx.drizzle.insert(userItem).values(
                itemData.map((item) => ({
                  id: nanoid(),
                  userId: aiData.userId,
                  itemId: item.itemId,
                  quantity: item.quantity,
                })),
              ),
            ]
          : []),
        ...(nindoData ? [ctx.drizzle.insert(userNindo).values(nindoData)] : []),
      ]);

      return { success: true, message: aiData.userId };
    }),
  // Delete a AI
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const ai = await fetchUser(ctx.drizzle, input.id);
      if (ai && ai.isAi && canChangeContent(user.role)) {
        await deleteUser(ctx.drizzle, ai.userId);
        return { success: true, message: `AI deleted` };
      } else {
        return { success: false, message: `Not allowed to delete AI` };
      }
    }),
  // Update user
  updateUser: protectedProcedure
    .input(z.object({ id: z.string(), data: updateUserSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [user, target, village] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, input.id),
          with: { jutsus: true, items: true },
        }),
        fetchVillage(ctx.drizzle, input.data?.villageId || VILLAGE_SYNDICATE_ID),
      ]);
      // Guards
      const availableRoles = canChangeUserRole(user.role);
      if (!canEditPublicUser(user)) {
        return errorResponse("You cannot edit public users");
      }
      if (!village) return errorResponse("Village not found");
      if (!target) return errorResponse("User not found");
      if (!availableRoles) return errorResponse("Not allowed");
      if (!availableRoles.includes(target.role)) {
        return errorResponse(`Not allowed to change: ${target.role}`);
      }
      if (!availableRoles.includes(input.data.role)) {
        return errorResponse(`Only available roles: ${availableRoles.join(", ")}`);
      }
      if (village.id !== target.villageId) {
        const clanName = target.isOutlaw ? "Faction" : "Clan";
        if (target.anbuId) return errorResponse("Leave ANBU first");
        if (target.clanId) return errorResponse(`Leave ${clanName} first`);
        if (target.status !== "AWAKE") return errorResponse("AWAKE to change village");
      }
      // Update jutsus & items
      const { jutsuChanges, itemChanges } = await updateUserContent({
        client: ctx.drizzle,
        userId: target.userId,
        oldJutsuIds: target.jutsus.map((j) => j.jutsuId),
        newJutsuIds: input.data.jutsus ?? [],
        oldItemIds: target.items.map((j) => j.itemId),
        newItemIds: input.data.items ?? [],
      });
      // Calculate diff
      delete input.data.jutsus;
      delete input.data.items;
      const diff = calculateContentDiff(
        Object.fromEntries(
          Object.entries(target).filter(([k]) => Object.keys(input.data).includes(k)),
        ),
        input.data,
      )
        .concat(jutsuChanges)
        .concat(itemChanges);
      // AI moderation of reason
      const aiCheck = await validateUserUpdateReason(
        diff.join(". "),
        input.data.reason,
      );
      if (!aiCheck.allowUpdate) {
        return errorResponse(aiCheck.comment);
      }
      // Update database
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({
            ...input.data,
            ...(village.id !== user.villageId
              ? {
                  isOutlaw: village.type === "OUTLAW" ? true : false,
                  sector: village.sector,
                  longitude: ALLIANCEHALL_LONG,
                  latitude: ALLIANCEHALL_LAT,
                }
              : {}),
          })
          .where(eq(userData.userId, target.userId)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: diff,
          relatedId: target.userId,
          relatedMsg: input.data.reason,
          relatedImage: target.avatarLight,
        }),
      ]);
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  // Update a AI
  updateAi: protectedProcedure
    .input(z.object({ id: z.string(), data: insertAiSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Set empty strings to null
      setEmptyStringsToNulls(input.data);
      input.data.customTitle = input.data.customTitle ?? "";

      // Queries
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const ai = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, input.id),
        with: { jutsus: true, items: true },
      });

      // Guards
      if (!ai) return errorResponse("AI not found");
      if (!ai.isAi) return errorResponse("Not an AI");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");

      // Update jutsus & items
      const { jutsuChanges, itemChanges } = await updateUserContent({
        client: ctx.drizzle,
        userId: ai.userId,
        oldJutsuIds: ai.jutsus.map((j) => j.jutsuId),
        newJutsuIds: input.data.jutsus ?? [],
        oldItemIds: ai.items.map((j) => j.itemId),
        newItemIds: input.data.items ?? [],
      });
      delete input.data.jutsus;
      delete input.data.items;

      // Update input data based on level
      const newAi = { ...ai, ...input.data } as UserData;

      // Level-based stats / pools
      scaleUserStats(newAi);

      // Calculate diff
      const oldContent = Object.fromEntries(
        Object.entries(ai).filter(([k]) => Object.keys(input.data).includes(k)),
      );
      const newContent = Object.fromEntries(
        Object.entries(newAi).filter(([k]) => Object.keys(input.data).includes(k)),
      );
      const diff = calculateContentDiff(oldContent, newContent)
        .concat(jutsuChanges)
        .concat(itemChanges);

      // Update database
      await Promise.all([
        ctx.drizzle.update(userData).set(newAi).where(eq(userData.userId, input.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "ai",
          changes: diff,
          relatedId: ai.userId,
          relatedMsg: `Update: ${ai.username}`,
          relatedImage: ai.avatar,
        }),
      ]);

      // Update discord channel
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, ai.username, diff, ai.avatar);
      }
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  // Get user attributes
  getUserAttributes: protectedProcedure.query(async ({ ctx }) => {
    return fetchAttributes(ctx.drizzle, ctx.userId);
  }),
  // Check if username exists in database already
  getUsername: publicProcedure
    .input(
      z.object({
        username: z.string().trim(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const username = await ctx.drizzle.query.userData.findFirst({
        columns: { username: true, userId: true },
        where: eq(userData.username, input.username),
      });
      return username || null;
    }),
  // Update username
  updateUsername: protectedProcedure
    .input(z.object({ username: usernameSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userData.findFirst({
          columns: { username: true },
          where: eq(userData.username, input.username),
        }),
      ]);
      // Guard
      if (user.username === input.username) {
        return errorResponse("Username is the same");
      }
      if (user.reputationPoints < COST_CHANGE_USERNAME) {
        return errorResponse("Not enough reputation points");
      }
      if (user.isBanned) return errorResponse("You are banned");
      if (target) return errorResponse("Username already taken");
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({
          username: input.username,
          reputationPoints: sql`reputationPoints - ${COST_CHANGE_USERNAME}`,
        })
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [`Username changed from ${user.username} to ${input.username}`],
          relatedId: ctx.userId,
          relatedMsg: `Update: ${user.username} -> ${input.username}`,
          relatedImage: user.avatarLight,
        });
        return { success: true, message: "Username updated" };
      }
    }),
  // Use earned experience points for stats
  useUnusedExperiencePoints: protectedProcedure
    .input(createStatSchema(0, 0))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            ninjutsuOffence: z.number(),
            taijutsuOffence: z.number(),
            genjutsuOffence: z.number(),
            bukijutsuOffence: z.number(),
            ninjutsuDefence: z.number(),
            taijutsuDefence: z.number(),
            genjutsuDefence: z.number(),
            bukijutsuDefence: z.number(),
            strength: z.number(),
            speed: z.number(),
            intelligence: z.number(),
            willpower: z.number(),
            experience: z.number(),
            earnedExperience: z.number(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Derived
      const inputSum = Object.values(input).reduce(
        (a, b) => Math.floor(a) + Math.floor(b),
        0,
      );
      // Guard
      if (inputSum <= 0) return errorResponse("No stats to assign");
      if (user.earnedExperience <= 0) return errorResponse("No experience left");
      if (inputSum > user.earnedExperience) {
        return errorResponse("Trying to assign more stats than available");
      }
      // Mutate & cap
      user.ninjutsuOffence += Math.floor(input.ninjutsuOffence);
      user.taijutsuOffence += Math.floor(input.taijutsuOffence);
      user.genjutsuOffence += Math.floor(input.genjutsuOffence);
      user.bukijutsuOffence += Math.floor(input.bukijutsuOffence);
      user.ninjutsuDefence += Math.floor(input.ninjutsuDefence);
      user.taijutsuDefence += Math.floor(input.taijutsuDefence);
      user.genjutsuDefence += Math.floor(input.genjutsuDefence);
      user.bukijutsuDefence += Math.floor(input.bukijutsuDefence);
      user.strength += Math.floor(input.strength);
      user.speed += Math.floor(input.speed);
      user.intelligence += Math.floor(input.intelligence);
      user.willpower += Math.floor(input.willpower);
      capUserStats(user);
      // Update
      const data = {
        ninjutsuOffence: user.ninjutsuOffence,
        taijutsuOffence: user.taijutsuOffence,
        genjutsuOffence: user.genjutsuOffence,
        bukijutsuOffence: user.bukijutsuOffence,
        ninjutsuDefence: user.ninjutsuDefence,
        taijutsuDefence: user.taijutsuDefence,
        genjutsuDefence: user.genjutsuDefence,
        bukijutsuDefence: user.bukijutsuDefence,
        strength: user.strength,
        speed: user.speed,
        intelligence: user.intelligence,
        willpower: user.willpower,
        experience: user.experience + inputSum,
        earnedExperience: user.earnedExperience - inputSum,
      };
      const result = await ctx.drizzle
        .update(userData)
        .set(data)
        .where(
          and(
            eq(userData.userId, ctx.userId),
            gte(userData.earnedExperience, inputSum),
          ),
        );
      if (result.rowsAffected === 0) {
        return errorResponse("Could not update user");
      } else {
        return { success: true, message: "User stats updated", data };
      }
    }),
  // Get nindo text of user
  getNindo: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const nindo = await ctx.drizzle.query.userNindo.findFirst({
        where: eq(userNindo.userId, input.userId),
      });
      return nindo ? nindo.content : "";
    }),
  // Update nindo
  updateNindo: protectedProcedure
    .input(mutateContentSchema.extend({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isSilenced) return errorResponse("You are silenced");
      if (ctx.userId !== input.userId && !canSeeSecretData(user.role)) {
        return errorResponse("You can't change for other users");
      }
      // Mutate
      return updateNindo(ctx.drizzle, input.userId, input.content, "userNindo");
    }),
  // Insert attribute
  insertAttribute: protectedProcedure
    .input(
      z.object({
        attribute: z.enum([...attributes, "Hair", "Skin", "Eyes"]),
        color: z.enum([...colors, ...skin_colors]).optional(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const attributes = await fetchAttributes(ctx.drizzle, ctx.userId);
      if (attributes.length >= MAX_ATTRIBUTES) {
        return { success: false, message: `Only ${MAX_ATTRIBUTES} attributes allowed` };
      }
      const name =
        ["Hair", "Skin", "Eyes"].includes(input.attribute) && input.color
          ? `${input.color} ${input.attribute}`
          : input.attribute;
      const result = await ctx.drizzle.insert(userAttribute).values({
        id: nanoid(),
        userId: ctx.userId,
        attribute: name,
      });
      if (result.rowsAffected === 0) {
        return { success: false, message: "Failed to insert attribute" };
      } else {
        return { success: true, message: "Attribute inserted" };
      }
    }),
  // Delete attribute
  deleteAttribute: protectedProcedure
    .input(z.object({ attribute: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.drizzle
        .delete(userAttribute)
        .where(
          and(
            eq(userAttribute.attribute, input.attribute),
            eq(userAttribute.userId, ctx.userId),
          ),
        );
      if (result.rowsAffected === 0) {
        return { success: false, message: "Failed to delete attribute" };
      } else {
        return { success: true, message: "Attribute deleted" };
      }
    }),
  // Return list of 5 most similar users in database
  searchUsers: protectedProcedure
    .input(
      z.object({
        username: z.string().trim(),
        showYourself: z.boolean(),
        showAi: z.boolean(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.drizzle.query.userData.findMany({
        columns: {
          userId: true,
          username: true,
          avatar: true,
          rank: true,
          isOutlaw: true,
          level: true,
          role: true,
          federalStatus: true,
          isAi: true,
        },
        where: and(
          like(userData.username, `%${input.username}%`),
          eq(userData.approvedTos, 1),
          ...(input.showAi ? [] : [eq(userData.isAi, false)]),
          ...(input.showYourself ? [] : [sql`${userData.userId} != ${ctx.userId}`]),
        ),
        orderBy: [sql`LENGTH(${userData.username}) asc`],
        limit: 5,
      });
    }),
  getUserDailyPveBattleCount: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      //Query
      const result = ctx.drizzle.query.battleHistory.findMany({
        where: and(
          eq(battleHistory.attackedId, input.userId),
          notInArray(battleHistory.battleType, ["SPARRING", "COMBAT"]),
          gte(battleHistory.createdAt, getTimeOfLastReset()),
        ),
      });
      return (await result).length;
    }),
  // Get public information on a user
  getPublicUser: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [requester, user] = await Promise.all([
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId ?? ""),
          columns: { role: true },
        }),
        ctx.drizzle.query.userData.findFirst({
          where: and(eq(userData.userId, input.userId)),
          columns: {
            aiProfileId: true,
            avatar: true,
            avatarLight: true,
            bloodlineId: true,
            curChakra: true,
            curHealth: true,
            curStamina: true,
            customTitle: true,
            deletionAt: true,
            earnedExperience: true,
            experience: true,
            federalStatus: true,
            gender: true,
            isAi: true,
            isBanned: true,
            isSilenced: true,
            isOutlaw: true,
            lastIp: true,
            level: true,
            maxChakra: true,
            maxHealth: true,
            maxStamina: true,
            movedTooFastCount: true,
            pveFights: true,
            rank: true,
            reputationPoints: true,
            role: true,
            senseiId: true,
            status: true,
            userId: true,
            username: true,
            villageId: true,
            tavernMessages: true,
          },
          with: {
            village: true,
            bloodline: true,
            nindo: true,
            clan: true,
            jutsus: { with: { jutsu: { columns: { id: true, name: true } } } },
            items: { with: { item: { columns: { id: true, name: true } } } },
            badges: { with: { badge: true } },
            recruitedUsers: {
              columns: {
                userId: true,
                username: true,
                level: true,
                rank: true,
                isOutlaw: true,
                avatar: true,
              },
            },
            students: {
              columns: {
                userId: true,
                username: true,
                level: true,
                rank: true,
                isOutlaw: true,
                avatar: true,
              },
            },
            sensei: {
              columns: {
                userId: true,
                username: true,
              },
            },
            anbuSquad: {
              columns: {
                name: true,
              },
            },
          },
        }),
      ]);
      // Guard
      if (!user) return null;
      // Hide secrets
      const isSelf = ctx.userId === user.userId;
      if (!isSelf && (!requester || !canSeeSecretData(requester.role))) {
        user.earnedExperience = 8008;
        user.isBanned = false;
        user.aiProfileId = null;
      }
      if (!isSelf && requester?.role === "USER") {
        user.jutsus = [];
        user.items = [];
      }
      if (!requester || !canSeeIps(requester.role)) {
        user.lastIp = "hidden";
      }
      // Filter off entries that do not exist
      user.jutsus = user.jutsus.filter((j) => j.jutsu);
      user.items = user.items.filter((i) => i.item);
      // If no avatarLight version, create one
      if (!user.avatarLight && user.avatar) {
        const thumbnail = await createThumbnail(user.avatar);
        await ctx.drizzle
          .update(userData)
          .set({ avatarLight: thumbnail })
          .where(eq(userData.userId, user.userId));
      }
      // Return
      return user;
    }),
  countOnlineUsers: publicProcedure.query(async ({ ctx }) => {
    // Fetch
    const [current, daily, maxOnline] = await Promise.all([
      ctx.drizzle
        .select({ count: count() })
        .from(userData)
        .where(gte(userData.updatedAt, secondsFromNow(-300))),
      ctx.drizzle
        .select({ count: count() })
        .from(userData)
        .where(gte(userData.updatedAt, secondsFromNow(-3600 * 24))),
      getGameSetting(ctx.drizzle, "onlineUsers"),
    ]);
    // Derived
    const onlineNow = current?.[0]?.count ?? 0;
    const onlineDay = daily?.[0]?.count ?? 0;
    const newMax = maxOnline.value < onlineNow;
    if (newMax) {
      await updateGameSetting(ctx.drizzle, "onlineUsers", onlineNow, new Date());
    }
    // Return
    return { onlineNow, onlineDay, maxOnline: newMax ? onlineNow : maxOnline.value };
  }),
  // Get public users
  getPublicUsers: publicProcedure
    .input(getPublicUsersSchema)
    .query(async ({ ctx, input }) => {
      return fetchPublicUsers(ctx.drizzle, input, ctx.userId);
    }),
  // Toggle deletion of user
  toggleDeletionTimer: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      // Guard
      if (target.isBanned || target.isSilenced) {
        return errorResponse("User has to serve the ban/silence first");
      }
      if (ctx.userId !== input.userId && !canDeleteUsers(user.role)) {
        return errorResponse("You can't delete other users");
      }
      // Muate
      await ctx.drizzle
        .update(userData)
        .set({
          deletionAt: target.deletionAt
            ? null
            : new Date(new Date().getTime() + 2 * 86400000),
        })
        .where(eq(userData.userId, input.userId));
      return { success: true, message: "Deletion timer toggled" };
    }),
  // Delete user
  confirmDeletion: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      // Guard
      if (!target.deletionAt || target.deletionAt > new Date()) {
        return errorResponse("Deletion timer not passed yet");
      }
      if (target.isBanned || target.isSilenced) {
        return errorResponse("You have to serve your ban first");
      }
      if (ctx.userId !== input.userId && !canSeeSecretData(user.role)) {
        return errorResponse("You can't delete other users");
      }
      if (target.anbuId) {
        return errorResponse("Please leave ANBU first.");
      }
      if (target.clanId) {
        return errorResponse("Please leave clan or faction first.");
      }
      // Mutate
      await deleteUser(ctx.drizzle, input.userId);
      return { success: true, message: "User deleted" };
    }),
  claimVotes: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Get user's vote record
      const userVoteRecord = await ctx.drizzle.query.userVote.findFirst({
        where: eq(userVote.userId, ctx.userId),
      });
      // Guard
      if (!userVoteRecord) {
        return errorResponse("No vote record found");
      }
      const completedVotes = ACTIVE_VOTING_SITES.every((site) => userVoteRecord[site]);
      if (!completedVotes) {
        return errorResponse("Not all votes are completed");
      }
      if (userVoteRecord.claimed) {
        return errorResponse("Votes already claimed");
      }
      // Update user's reputation points and mark votes as claimed
      const smallNanoid = customAlphabet(
        "1234567890abcdefghijklmnopqrstuvwxyzABCDEF",
        8,
      );
      const result = await ctx.drizzle
        .update(userVote)
        .set({
          claimed: true,
          totalClaims: sql`${userVote.totalClaims} + 1`,
          secret: smallNanoid(),
        })
        .where(eq(userVote.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return errorResponse("Failed to update user vote record");
      }
      await ctx.drizzle
        .update(userData)
        .set({
          reputationPoints: sql`${userData.reputationPoints} + 1`,
          reputationPointsTotal: sql`${userData.reputationPointsTotal} + 1`,
        })
        .where(eq(userData.userId, ctx.userId));

      return {
        success: true,
        message: "Successfully claimed reputation points for voting",
      };
    }),
});

export const updateNindo = async (
  client: DrizzleClient,
  userId: string,
  content: string,
  type: "userNindo" | "clanOrder" | "anbuOrder" | "kageOrder",
) => {
  const nindo = await client.query.userNindo.findFirst({
    where: eq(userNindo.userId, userId),
  });
  const sanitized = sanitize(content);
  await Promise.all([
    moderateContent(client, {
      content: sanitized,
      userId: userId,
      relationType: type,
      relationId: userId,
    }),
    nindo
      ? client
          .update(userNindo)
          .set({ content: content })
          .where(eq(userNindo.userId, userId))
      : client.insert(userNindo).values({
          id: nanoid(),
          userId: userId,
          content: content,
        }),
  ]);
  return { success: true, message: "Content updated" };
};

/**
 * Fetch a user by id
 * @param client - The database client
 * @param userId - The id of the user
 * @returns The user
 *
 * NOTE: This function is used across the codebase. Use fetchUpdatedUser
 * if more information is required on the user object, so that we keep this method "light"
 */
export const fetchUser = async (client: DrizzleClient, userId: string) => {
  const user = await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
  });
  if (!user) {
    throw new Error(`fetchUser: User not found: ${userId}`);
  }
  return user;
};

export const updateUserContent = async (props: {
  client: DrizzleClient;
  userId: string;
  oldJutsuIds: string[];
  newJutsuIds: string[];
  oldItemIds: string[];
  newItemIds: string[];
}) => {
  // Destructure
  const { client, userId, oldJutsuIds, newJutsuIds, oldItemIds, newItemIds } = props;

  // Store any new jutsus
  const newJ = oldJutsuIds.sort().join(",") !== newJutsuIds.sort().join(",");
  const newI = oldItemIds.sort().join(",") !== newItemIds.sort().join(",");

  // difference arrays
  let jutsuChanges: string[] = [];
  let itemChanges: string[] = [];

  // If jutsus are different, then update with jutsu names for diff calculation only
  if (newJ || newI) {
    const [jutsuData, itemData] = await Promise.all([
      client.query.jutsu.findMany({
        where: inArray(jutsu.id, oldJutsuIds.concat(newJutsuIds).concat(["non-empty"])),
        columns: { id: true, name: true },
      }),
      client.query.item.findMany({
        where: inArray(item.id, oldItemIds.concat(newItemIds).concat(["non-empty"])),
        columns: { id: true, name: true },
      }),
    ]);
    jutsuChanges = calculateContentDiff(
      { jutsus: oldJutsuIds.map((id) => jutsuData.find((j) => j.id === id)?.name) },
      { jutsus: newJutsuIds.map((id) => jutsuData.find((j) => j.id === id)?.name) },
    );
    itemChanges = calculateContentDiff(
      { items: oldItemIds.map((id) => itemData.find((j) => j.id === id)?.name) },
      { items: newItemIds.map((id) => itemData.find((j) => j.id === id)?.name) },
    );

    // Updated content
    const deletedJ = oldJutsuIds.filter((id) => !newJutsuIds.includes(id));
    const deletedI = oldItemIds.filter((id) => !newItemIds.includes(id));
    const insertedJ = newJutsuIds.filter((id) => !oldJutsuIds.includes(id));
    const insertedI = newItemIds.filter((id) => !oldItemIds.includes(id));

    // Run updates
    await Promise.all([
      ...(deletedJ.length > 0
        ? [
            client
              .delete(userJutsu)
              .where(
                and(eq(userJutsu.userId, userId), inArray(userJutsu.jutsuId, deletedJ)),
              ),
          ]
        : []),
      ...(deletedI.length > 0
        ? [
            client
              .delete(userItem)
              .where(
                and(eq(userItem.userId, userId), inArray(userItem.itemId, deletedI)),
              ),
          ]
        : []),
      ...(insertedJ.length > 0
        ? [
            client.insert(userJutsu).values(
              insertedJ.map((jutsuId) => ({
                id: nanoid(),
                userId: userId,
                jutsuId: jutsuId,
                level: 1,
                equipped: 1,
              })),
            ),
          ]
        : []),
      ...(insertedI.length > 0
        ? [
            client.insert(userItem).values(
              insertedI.map((itemId) => ({
                id: nanoid(),
                userId: userId,
                itemId: itemId,
                equipped: "CHEST" as const,
              })),
            ),
          ]
        : []),
    ]);
  }

  return { jutsuChanges, itemChanges };
};

/**
 * Fetch user with bloodline & village relations. Occasionally updates the user with regeneration
 * of pools, or optionally forces regeneration with forceRegen=true
 */
export const fetchUpdatedUser = async (props: {
  client: DrizzleClient;
  userId: string;
  userIp?: string;
  forceRegen?: boolean;
}) => {
  // Destructure
  const { client, userId, userIp } = props;
  let { forceRegen } = props;
  const now = new Date();

  // Ensure we can fetch the user
  const [achievements, settings, user, hasUnvotedPolls] = await Promise.all([
    client
      .select()
      .from(quest)
      .where(and(eq(quest.questType, "achievement"), eq(quest.hidden, false))),
    client.select().from(gameSetting),
    client.query.userData.findFirst({
      where: eq(userData.userId, userId),
      with: {
        bloodline: true,
        clan: true,
        village: {
          with: {
            structures: true,
            relationshipA: true,
            relationshipB: true,
          },
        },
        anbuSquad: {
          columns: { name: true },
        },
        loadout: {
          columns: { jutsuIds: true },
        },
        promotions: {
          limit: 1,
        },
        userQuests: {
          where: or(
            and(isNull(questHistory.endAt), eq(questHistory.completed, 0)),
            eq(questHistory.questType, "achievement"),
          ),
          with: {
            quest: true,
          },
          orderBy: sql`FIELD(${questHistory.questType}, 'daily', 'tier') ASC`,
        },
        completedQuests: {
          columns: { id: true, questId: true, completed: true },
          where: gte(questHistory.completed, 1),
        },
        votes: true,
      },
    }),
    client
      .select({ id: poll.id })
      .from(poll)
      .leftJoin(
        userPollVote,
        and(eq(userPollVote.pollId, poll.id), eq(userPollVote.userId, userId)),
      )
      .where(
        and(
          eq(poll.isActive, true),
          // Either endDate is null or endDate is in the future
          or(isNull(poll.endDate), sql`${poll.endDate} > ${now}`),
          // User hasn't voted on this poll
          isNull(userPollVote.id),
        ),
      )
      .limit(1),
  ]);

  // Add votes entry if it doesn't exist
  if (user && !user.votes) {
    const smallNanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyzABCDEF", 8);
    await client.insert(userVote).values({
      id: nanoid(),
      userId: user.userId,
      lastVoteAt: new Date(),
      secret: smallNanoid(),
    });
  }

  // Add in achievements
  if (user) {
    user.userQuests.push(...mockAchievementHistoryEntries(achievements, user));
    user.userQuests = user.userQuests
      .filter((q) => q.quest)
      .filter((q) => isAvailableUserQuests({ ...q.quest, ...q }, user).check);
  }

  // Hide information relating to quests
  user?.userQuests.forEach((q) => {
    hideQuestInformation(q.quest, user);
  });

  if (user) {
    // Add bloodline, structure, etc.  regen to regeneration
    user.regeneration = calcActiveUserRegen(user, settings);
  }

  // Handle village prestige situations
  if (user) {
    // If prestige below 0, reset to 0 and move to outlaw faction
    if (user.villagePrestige < 0 && user.village?.type === "VILLAGE") {
      const syndicate = await client.query.village.findFirst({
        where: eq(village.type, "OUTLAW"),
      });
      if (syndicate) {
        user.villagePrestige = -user.villagePrestige;
        user.villageId = syndicate.id;
        user.isOutlaw = true;
        if (user.clanId) {
          const clanData = await fetchClan(client, user.clanId);
          if (clanData) {
            await removeFromClan(client, clanData, user, ["Turned outlaw"]);
          }
        }
        void pusher.trigger(user.userId, "event", {
          type: "userMessage",
          message: "You have been kicked out of your village due to negative prestige",
          route: "/profile",
          routeText: "To Profile",
        });
        forceRegen = true;
      }
    }
    // If user is kage & village prestige less than threshold, remove from kage
    if (
      user.villageId &&
      user.village?.kageId === user.userId &&
      user.villagePrestige < KAGE_MIN_PRESTIGE
    ) {
      const elder = await fetchKageReplacement(client, user.villageId, user.userId);
      if (elder) {
        await Promise.all([
          client
            .update(village)
            .set({ kageId: elder.userId, leaderUpdatedAt: new Date() })
            .where(eq(village.id, user.villageId)),
          client
            .update(userData)
            .set({ villagePrestige: KAGE_PRESTIGE_REQUIREMENT })
            .where(eq(userData.userId, user.userId)),
          pusher.trigger(user.userId, "event", {
            type: "userMessage",
            message: `Your prestige dropped below ${KAGE_MIN_PRESTIGE} and you are no longer kage`,
            route: "/profile",
            routeText: "To Profile",
          }),
        ]);
      }
    }
  }

  // Rewards, e.g. for activity streak
  let rewards: ReturnType<typeof activityStreakRewards> | undefined;

  // If more than 5min since last user update, update the user with regen. We do not need this to be synchronous
  // and it is mostly done to keep user updated on the overview pages
  if (user && ["AWAKE", "ASLEEP"].includes(user.status)) {
    // Get activity rewards if any & update timers
    const now = new Date();
    const newDay = isDifferentDay(now, user.updatedAt);
    const withinThreshold = secondsPassed(user.updatedAt) < 36 * 3600;
    // Figure out if we're running update
    const sinceUpdate = secondsPassed(user.updatedAt);
    if (
      newDay ||
      sinceUpdate > 300 || // Update user in database every 5 minutes only so as to reduce server load
      forceRegen || // Hard overwrite for e.g. debugging or simply ensuring updated user
      (user.villagePrestige < 0 && !user.isOutlaw) // To trigger getting kicked out of village
    ) {
      const regen = (user.regeneration * secondsPassed(user.regenAt)) / REGEN_SECONDS;
      user.curHealth = Math.min(user.curHealth + regen, user.maxHealth);
      user.curStamina = Math.min(user.curStamina + regen, user.maxStamina);
      user.curChakra = Math.min(user.curChakra + regen, user.maxChakra);
      // Get activity rewards if any & update timers
      if (newDay) {
        user.activityStreak = withinThreshold ? user.activityStreak + 1 : 1;
        rewards = activityStreakRewards(user.activityStreak);
        if (rewards.money > 0) user.money += rewards.money;
        if (rewards.reputationPoints > 0) {
          user.reputationPoints += rewards.reputationPoints;
          user.reputationPointsTotal += rewards.reputationPoints;
        }
      }
      user.updatedAt = now;
      user.regenAt = now;

      // Ensure that we have a tier quest
      let questTier = user.userQuests?.find((q) => q.quest.questType === "tier");
      if (!questTier) {
        questTier = await insertNextQuest(client, user, "tier");
        if (questTier) {
          user.userQuests.push(questTier);
        }
      }
      // Ensure that we have an exam quest
      let questExam = user.userQuests?.find((q) => q.quest.questType === "exam");
      if (!questExam) {
        questExam = await insertNextQuest(client, user, "exam");
        if (questExam) {
          user.userQuests.push(questExam);
        }
      }
      // Ensure that the user has elements
      const rankId = UserRanks.findIndex((r) => r === user.rank);
      if (rankId >= 1 && !user.primaryElement) {
        user.primaryElement = getRandomElement(BasicElementName) ?? null;
      }
      if (rankId >= 2 && !user.secondaryElement) {
        const available = BasicElementName.filter((e) => e !== user.primaryElement);
        user.secondaryElement = getRandomElement(available) ?? null;
      }
      // Update database
      await Promise.all([
        client
          .update(userData)
          .set({
            curHealth: user.curHealth,
            curStamina: user.curStamina,
            curChakra: user.curChakra,
            updatedAt: user.updatedAt,
            regenAt: user.regenAt,
            questData: user.questData,
            activityStreak: user.activityStreak,
            money: user.money > RYO_CAP ? RYO_CAP : user.money,
            bank: user.bank > RYO_CAP ? RYO_CAP : user.bank,
            primaryElement: user.primaryElement,
            secondaryElement: user.secondaryElement,
            reputationPoints: user.reputationPoints,
            reputationPointsTotal: user.reputationPointsTotal,
            villagePrestige: user.villagePrestige,
            villageId: user.villageId,
            isOutlaw: user.isOutlaw,
            ...(userIp ? { lastIp: userIp } : {}),
          })
          .where(eq(userData.userId, userId)),
        ...(newDay
          ? [
              client.insert(userActivityEvent).values({
                userId: userId,
                streak: user.activityStreak,
              }),
            ]
          : []),
        ...(userIp && user.lastIp !== userIp
          ? [
              client
                .insert(historicalIp)
                .values({
                  userId: userId,
                  ip: userIp,
                })
                .onDuplicateKeyUpdate({
                  set: { usedAt: new Date() },
                }),
            ]
          : []),
      ]);
    }
  }
  if (user) {
    const { trackers } = getNewTrackers(user, [{ task: "any" }]);
    user.questData = trackers;
  }
  return { user, settings, rewards, hasUnvotedPolls };
};

export const fetchPublicUsers = async (
  client: DrizzleClient,
  input: GetPublicUsersSchema,
  userId?: string | null,
) => {
  const currentCursor = input.cursor ? input.cursor : 0;
  const skip = currentCursor * input.limit;
  const getOrder = () => {
    switch (input.orderBy) {
      case "Online":
        return [desc(userData.updatedAt)];
      case "Strongest":
        return [desc(userData.level), desc(userData.experience)];
      case "PvP":
        return [desc(userData.pvpStreak), desc(userData.experience)];
      case "Staff":
        return [desc(userData.tavernMessages)];
      case "Outlaws":
        return [desc(userData.villagePrestige)];
      case "Community":
        return [desc(userData.tavernMessages)];
      case "Dailies":
        return [
          desc(sql`${userData.dailyArenaFights} + ${userData.dailyMissions} + ${userData.dailyErrands}`),
          desc(userData.experience),
        ];
    }
  };
  const [users, user] = await Promise.all([
    client.query.userData.findMany({
      where: and(
        eq(userData.isAi, input.isAi),
        ...(input.username !== undefined
          ? [like(userData.username, `%${input.username}%`)]
          : []),
        ...(input.bloodline !== undefined
          ? [eq(userData.bloodlineId, input.bloodline)]
          : []),
        ...(input.ip ? [like(userData.lastIp, `%${input.ip}%`)] : []),
        ...(input.village !== undefined ? [eq(userData.villageId, input.village)] : []),
        ...(input.recruiterId ? [eq(userData.recruiterId, input.recruiterId)] : []),
        ...(input.orderBy === "Staff" ? [notInArray(userData.role, ["USER"])] : []),
        ...(input.orderBy === "Outlaws" ? [eq(userData.isOutlaw, true)] : []),
        ...(input.isAi ? [eq(userData.isAi, true)] : []),
        ...(input.inArena && input.isAi
          ? [eq(userData.inArena, true)]
          : [eq(userData.inArena, false)]),
        ...(input.isEvent && input.isAi
          ? [eq(userData.isEvent, true)]
          : [eq(userData.isEvent, false)]),
        ...(input.isSummon && input.isAi
          ? [eq(userData.isSummon, true)]
          : [eq(userData.isSummon, false)]),
      ),
      columns: {
        avatar: true,
        avatar3d: true,
        avatarLight: true,
        experience: true,
        inArena: true,
        isAi: true,
        isEvent: true,
        isOutlaw: true,
        isSummon: true,
        lastIp: true,
        level: true,
        pvpStreak: true,
        rank: true,
        reputationPointsTotal: true,
        role: true,
        updatedAt: true,
        userId: true,
        username: true,
        villagePrestige: true,
        tavernMessages: true,
        dailyArenaFights: true,
        dailyMissions: true,
        dailyErrands: true,
      },
      // If AI, also include relations information
      with: {
        village: { columns: { name: true } },
        ...(input.isAi
          ? {
              jutsus: {
                columns: {
                  level: true,
                },
                with: {
                  jutsu: {
                    columns: {
                      name: true,
                    },
                  },
                },
              },
            }
          : {}),
      },
      offset: skip,
      limit: input.limit,
      orderBy: getOrder(),
    }),
    ...(userId
      ? [
          client.query.userData.findFirst({
            where: eq(userData.userId, userId),
          }),
        ]
      : [null]),
  ]);
  // Guard
  if (input.ip && (!user || !canSeeIps(user.role))) {
    throw serverError("FORBIDDEN", "You are not allowed to search IPs");
  }
  // Hide stuff
  users.filter((u) => !u.lastIp).forEach((u) => (u.lastIp = "Proxied"));
  if (!user || !canSeeIps(user.role)) {
    users.forEach((u) => (u.lastIp = "hidden"));
  }
  // Return
  const nextCursor = users.length < input.limit ? null : currentCursor + 1;
  return {
    data: users,
    nextCursor: nextCursor,
  };
};
export type FetchedPublicUsers = Awaited<ReturnType<typeof fetchPublicUsers>>;

export const fetchAttributes = async (client: DrizzleClient, userId: string) => {
  return await client.query.userAttribute.findMany({
    where: eq(userAttribute.userId, userId),
  });
};

export type UserWithRelations =
  | (UserData & {
      bloodline?: Bloodline | null;
      anbuSquad?: { name: string } | null;
      clan?: Clan | null;
      village?:
        | (Village & {
            structures?: VillageStructure[];
            relationshipA?: VillageAlliance[];
            relationshipB?: VillageAlliance[];
          })
        | null;
      loadout?: { jutsuIds: string[] } | null;
      userQuests: (UserQuest & { quest: Quest })[];
      completedQuests: { id: string; questId: string; completed: number }[];
      votes?: UserVote | null;
    })
  | undefined;

export type AiWithRelations = UserData & {
  jutsus: (UserJutsu & { jutsu: { id: string; name: string } })[];
  items: (UserItem & { item: { id: string; name: string } })[];
};
