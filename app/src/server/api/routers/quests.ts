import { z } from "zod";
import { nanoid } from "nanoid";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { serverError, baseServerResponse, errorResponse } from "@/api/trpc";
import { secondsFromNow } from "@/utils/time";
import { inArray, lte, isNull, sql, asc, gte } from "drizzle-orm";
import { like, eq, or, and, getTableColumns } from "drizzle-orm";
import { item, jutsu, badge, bankTransfers, clan } from "@/drizzle/schema";
import { userJutsu, userItem, userData, userBadge } from "@/drizzle/schema";
import { quest, questHistory, actionLog, village } from "@/drizzle/schema";
import { QuestValidator } from "@/validators/objectives";
import { fetchUser, fetchUpdatedUser } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";
import { canPlayHiddenQuests } from "@/utils/permissions";
import { callDiscordContent } from "@/libs/discord";
import { LetterRanks } from "@/drizzle/constants";
import { calculateContentDiff } from "@/utils/diff";
import { initiateBattle } from "@/routers/combat";
import { CollectItem } from "@/validators/objectives";
import { availableQuestLetterRanks, availableRanks } from "@/libs/train";
import { getNewTrackers, getReward } from "@/libs/quest";
import { getActiveObjectives } from "@/libs/quest";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import { getMissionHallSettings } from "@/libs/quest";
import { canAccessStructure } from "@/utils/village";
import { fetchSectorVillage } from "@/routers/village";
import { deleteRequests } from "@/routers/sensei";
import { getQuestCounterFieldName } from "@/validators/user";
import { getRandomElement } from "@/utils/array";
import { fetchUserItems } from "@/routers/item";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { SENSEI_STUDENT_RYO_PER_MISSION } from "@/drizzle/constants";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { QUESTS_CONCURRENT_LIMIT } from "@/drizzle/constants";
import { questFilteringSchema } from "@/validators/quest";
import { hideQuestInformation, isAvailableUserQuests } from "@/libs/quest";
import { QuestTracker } from "@/validators/objectives";
import type { QuestCounterFieldName } from "@/validators/user";
import type { ObjectiveRewardType } from "@/validators/objectives";
import type { SQL } from "drizzle-orm";
import type { QuestType } from "@/drizzle/constants";
import type { UserData, Quest } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { canEditPublicUser } from "@/utils/permissions";

export const questsRouter = createTRPCRouter({
  getAllNames: publicProcedure.query(async ({ ctx }) => {
    const results = await ctx.drizzle.query.quest.findMany({
      columns: { id: true, name: true },
    });
    return results;
  }),
  getAll: publicProcedure
    .input(
      questFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const results = await ctx.drizzle.query.quest.findMany({
        with: { village: true },
        where: and(
          ...(input?.name ? [like(quest.name, `%${input.name}%`)] : []),
          ...(input?.objectives && input.objectives.length > 0
            ? [
                or(
                  ...input.objectives.map(
                    (e) => sql`JSON_SEARCH(${quest.content},'one',${e}) IS NOT NULL`,
                  ),
                ),
              ]
            : []),
          ...(input?.questType ? [eq(quest.questType, input.questType)] : []),
          ...(input?.rank ? [eq(quest.questRank, input.rank)] : []),
          ...(input?.timeframe ? [eq(quest.timeFrame, input.timeframe)] : []),
          ...(input?.village ? [eq(quest.requiredVillage, input.village)] : []),
          ...(input?.userLevel
            ? [
                gte(quest.maxLevel, input.userLevel),
                lte(quest.requiredLevel, input.userLevel),
              ]
            : []),
          ...(input?.hidden !== undefined
            ? [eq(quest.hidden, input.hidden)]
            : [eq(quest.hidden, false)]),
        ),
        offset: skip,
        limit: input.limit,
      });
      results.forEach((r) => hideQuestInformation(r));
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [result, user] = await Promise.all([
        fetchQuest(ctx.drizzle, input.id),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId ?? ""),
        }),
      ]);
      if (!result) {
        throw serverError("NOT_FOUND", "Quest not found");
      }
      hideQuestInformation(result, user);
      return result;
    }),
  allianceBuilding: protectedProcedure
    .input(
      z.object({
        villageId: z.string().optional().nullish(),
        level: z.number().optional().nullish(),
        rank: z.array(z.enum(LetterRanks)).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      const [{ user }, events] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle
          .select({ ...getTableColumns(questHistory), ...getTableColumns(quest) })
          .from(quest)
          .leftJoin(
            questHistory,
            and(
              eq(quest.id, questHistory.questId),
              eq(questHistory.userId, ctx.userId),
            ),
          )
          .where(
            and(
              inArray(quest.questType, ["event"]),
              ...(input.villageId
                ? [
                    or(
                      isNull(quest.requiredVillage),
                      eq(
                        quest.requiredVillage,
                        input.villageId ?? VILLAGE_SYNDICATE_ID,
                      ),
                    ),
                  ]
                : []),
              ...(input.rank ? [inArray(quest.questRank, input.rank)] : []),
              // Always check level requirements for events
              lte(quest.requiredLevel, input.level ?? 0),
              gte(quest.maxLevel, input.level ?? 0),
            ),
          )
          .orderBy(asc(quest.name)),
      ]);
      if (!user) throw serverError("NOT_FOUND", "User not found");
      events.forEach((r) => hideQuestInformation(r));
      return events.filter((e) => isAvailableUserQuests(e, user, true).check);
    }),
  missionHall: protectedProcedure
    .input(z.object({ villageId: z.string(), level: z.number() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [{ user }, missions] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle
          .select({ ...getTableColumns(questHistory), ...getTableColumns(quest) })
          .from(quest)
          .leftJoin(
            questHistory,
            and(
              eq(quest.id, questHistory.questId),
              eq(questHistory.userId, ctx.userId),
            ),
          )
          .where(
            and(
              inArray(quest.questType, ["mission", "errand", "crime"]),
              ...(input.villageId
                ? [
                    or(
                      isNull(quest.requiredVillage),
                      eq(
                        quest.requiredVillage,
                        input.villageId ?? VILLAGE_SYNDICATE_ID,
                      ),
                    ),
                  ]
                : []),
              // Always check level requirements for events
              lte(quest.requiredLevel, input.level ?? 0),
              gte(quest.maxLevel, input.level ?? 0),
            ),
          )
          .orderBy(asc(quest.name)),
      ]);
      if (!user) throw serverError("NOT_FOUND", "User not found");
      missions.forEach((r) => hideQuestInformation(r));
      return missions.filter((e) => isAvailableUserQuests(e, user, true).check);
    }),
  storyQuests: protectedProcedure
    .input(z.object({ level: z.number() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [{ user }, quests] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle
          .select({ ...getTableColumns(questHistory), ...getTableColumns(quest) })
          .from(quest)
          .leftJoin(
            questHistory,
            and(
              eq(quest.id, questHistory.questId),
              eq(questHistory.userId, ctx.userId),
            ),
          )
          .where(
            and(
              eq(quest.questType, "story"),
              lte(quest.requiredLevel, input.level ?? 0),
              gte(quest.maxLevel, input.level ?? 0),
            ),
          )
          .orderBy(asc(quest.name)),
      ]);
      if (!user) throw serverError("NOT_FOUND", "User not found");
      quests.forEach((r) => hideQuestInformation(r));
      return quests.filter((e) => isAvailableUserQuests(e, user).check);
    }),
  startRandom: protectedProcedure
    .input(
      z.object({
        type: z.enum(["errand", "mission", "crime"]),
        rank: z.enum(LetterRanks),
        userLevel: z.number(),
        userSector: z.number(),
        userVillageId: z.string().nullish(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user
      const [updatedUser, sectorVillage, results] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSectorVillage(ctx.drizzle, input.userSector),
        ctx.drizzle
          .select({
            ...getTableColumns(quest),
            previousAttempts: questHistory.previousAttempts,
            completed: questHistory.completed,
          })
          .from(quest)
          .leftJoin(
            questHistory,
            and(
              eq(quest.id, questHistory.questId),
              eq(questHistory.userId, ctx.userId),
            ),
          )
          .where(
            and(
              eq(quest.questType, input.type),
              eq(quest.questRank, input.rank),
              lte(quest.requiredLevel, input.userLevel),
              gte(quest.maxLevel, input.userLevel),
              or(
                isNull(quest.requiredVillage),
                eq(quest.requiredVillage, input.userVillageId ?? VILLAGE_SYNDICATE_ID),
              ),
            ),
          ),
      ]);
      // Destructure user & guard
      const { user } = updatedUser;
      if (!user) return errorResponse("User does not exist");
      if (user.sector !== input.userSector) return errorResponse("Sector mismatch");
      if (user.level !== input.userLevel) {
        return errorResponse("User level does not match");
      }
      if (
        user.villageId !== input.userVillageId &&
        input.userVillageId !== VILLAGE_SYNDICATE_ID
      ) {
        return errorResponse("Village mismatch");
      }
      if (!user.isOutlaw && !canAccessStructure(user, "/missionhall", sectorVillage)) {
        return errorResponse("Must be in your allied village to start a quest");
      }
      // Fetch settings
      const setting = getMissionHallSettings(user.isOutlaw).find(
        (s) => s.type === input.type && s.rank === input.rank,
      );
      const isErrand = setting?.type === "errand";
      // Guards
      if (!setting) return errorResponse("Setting not found");
      if (user.isBanned) return errorResponse("You are banned");

      // Check if user is allowed to perform this rank
      const ranks = availableQuestLetterRanks(user.rank);
      if (!ranks.includes(input.rank) && input.type === "mission") {
        return errorResponse(`Rank ${input.rank} not allowed`);
      }
      // Confirm user does not have any current active missions/crimes/errands
      const current = user?.userQuests?.find(
        (q) => ["mission", "crime", "errand"].includes(q.quest.questType) && !q.endAt,
      );
      if (current) {
        return errorResponse(`Already active ${current.questType}`);
      }
      // CAP CHECK
      if (input.type === "mission" && (user.dailyMissions ?? 0) >= 30) {
        return errorResponse("You have reached the daily cap of 30 missions.");
      }
      // Fetch quest
      const result = getRandomElement(
        results.filter((e) => isAvailableUserQuests(e, user).check),
      );
      if (!result) return errorResponse("No assignments at this level could be found");

      // Insert quest entry
      await Promise.all([
        upsertQuestEntry(ctx.drizzle, user, result),
        ctx.drizzle
          .update(userData)
          .set(
            isErrand
              ? { dailyErrands: sql`${userData.dailyErrands} + 1` }
              : { dailyMissions: sql`${userData.dailyMissions} + 1` },
          )
          .where(eq(userData.userId, user.userId)),
      ]);
      return { success: true, message: `Quest started: ${result.name}` };
    }),
  startQuest: protectedProcedure
    .input(z.object({ questId: z.string(), userSector: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [updatedUser, sectorVillage, questData, prevAttempt] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true, // Force regeneration to ensure we have latest quest data
        }),
        fetchSectorVillage(ctx.drizzle, input.userSector),
        fetchQuest(ctx.drizzle, input.questId),
        fetchUserQuestByQuestId(ctx.drizzle, ctx.userId, input.questId),
      ]);

      // Guards
      const { user } = updatedUser;
      if (!user) return errorResponse("User does not exist");
      const ranks = availableQuestLetterRanks(user.rank);
      if (!questData) return errorResponse("Quest does not exist");
      if (user.sector !== input.userSector) return errorResponse("Sector mismatch");
      if (user.isBanned) return errorResponse("You are banned");
      if (!ranks.includes(questData.questRank)) {
        return errorResponse(`Rank ${user.rank} not allowed`);
      }
      // Availability checks
      const { check, message } = isAvailableUserQuests(
        { ...questData, ...prevAttempt },
        user,
      );
      if (!check) {
        return errorResponse(`Quest is not available for you: ${message}`);
      }

      // Check if user is already on this quest
      const isAlreadyOnQuest = user.userQuests?.some(
        (q) => q.questId === questData.id && !q.endAt,
      );
      if (isAlreadyOnQuest) {
        return errorResponse(`You are already on this quest: ${questData.name}`);
      }

      // Handle different quest types
      if (questData.questType === "story") {
        if (!canAccessStructure(user, "/globalanbuhq", sectorVillage)) {
          return errorResponse("Must be in the Global Anbu HQ to start story quests");
        }
        const current = user.userQuests?.filter(
          (q) => q.quest.questType === "story" && !q.endAt,
        );
        if (current && current.length >= QUESTS_CONCURRENT_LIMIT) {
          return errorResponse(
            `Already ${QUESTS_CONCURRENT_LIMIT} active story quests; ${current
              .map((c) => c.quest.name)
              .join(", ")}. Abandon one to start this quest.`,
          );
        }
      } else if (questData.questType === "event") {
        const current = user.userQuests?.filter(
          (q) => q.quest.questType === "event" && !q.endAt,
        );
        if (current && current.length >= QUESTS_CONCURRENT_LIMIT) {
          return errorResponse(
            `Already ${QUESTS_CONCURRENT_LIMIT} active event quests; ${current
              .map((c) => c.quest.name)
              .join(", ")}. Abandon one to start this quest.`,
          );
        }
        if (!canAccessStructure(user, "/adminbuilding", sectorVillage)) {
          return errorResponse("Must be in your allied village to start quest");
        }
        if (
          prevAttempt &&
          (prevAttempt.previousAttempts > 1 || prevAttempt.completed)
        ) {
          return errorResponse(`You have already attempted this quest`);
        }
      } else if (["mission", "crime"].includes(questData.questType)) {
        if (questData.questRank !== "A") {
          return errorResponse(`Only A rank missions/crimes are allowed`);
        }
        if (
          !user.isOutlaw &&
          !canAccessStructure(user, "/missionhall", sectorVillage)
        ) {
          return errorResponse("Must be in your allied village to start quest");
        }
        const current = user?.userQuests?.find(
          (q) => ["mission", "crime", "errand"].includes(q.quest.questType) && !q.endAt,
        );
        if (current) {
          return errorResponse(`Already active ${current.questType}`);
        }
        // CAP CHECK
        if (questData.questType === "mission" && (user.dailyMissions ?? 0) >= 30) {
          return errorResponse("You have reached the daily cap of 30 missions.");
        }
      } else {
        // Should not happen, record error and hard throw for monitoring
        throw serverError(
          "PRECONDITION_FAILED",
          `Invalid quest type to start: ${questData.questType}`,
        );
      }

      // Insert quest entry
      await Promise.all([
        upsertQuestEntry(ctx.drizzle, user, questData),
        incrementDailyQuestCounter(
          ctx.drizzle,
          user,
          ["mission", "crime"].includes(questData.questType),
        ),
      ]);
      return { success: true, message: `Quest started: ${questData.name}` };
    }),
  abandon: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user) {
        throw serverError("PRECONDITION_FAILED", "User does not exist");
      }
      const current = user?.userQuests?.find((q) => q.questId === input.id && !q.endAt);
      if (!current) {
        throw serverError("PRECONDITION_FAILED", `No active quest with id ${input.id}`);
      }
      if (!["mission", "crime", "event", "errand"].includes(current.questType)) {
        throw serverError("PRECONDITION_FAILED", `Cannot abandon ${current.questType}`);
      }
      await Promise.all([
        ctx.drizzle
          .update(questHistory)
          .set({ completed: 0, endAt: new Date() })
          .where(
            and(
              eq(questHistory.questId, input.id),
              eq(questHistory.userId, ctx.userId),
            ),
          ),
        ctx.drizzle
          .update(userData)
          .set({ questFinishAt: new Date() })
          .where(eq(userData.userId, ctx.userId)),
      ]);
      return { success: true, message: `Quest abandoned` };
    }),
  getQuestHistory: protectedProcedure
    .input(
      z.object({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const results = await ctx.drizzle.query.questHistory.findMany({
        where: eq(questHistory.userId, ctx.userId),
        with: {
          quest: true,
        },
        offset: skip,
        limit: input.limit,
      });
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: QuestValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      setEmptyStringsToNulls(input.data);
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const entry = await fetchQuest(ctx.drizzle, input.id);
      if (entry && canChangeContent(user.role)) {
        // Prepare data for insertion into database
        const data = input.data;
        // Check we only give ranks with exams
        if (data.content.reward.reward_rank !== "NONE" && data.questType !== "exam") {
          data.content.reward.reward_rank = "NONE";
        }
        data.content.objectives.forEach((objective) => {
          if (objective.reward_rank !== "NONE" && data.questType !== "exam") {
            objective.reward_rank = "NONE";
          }
        });
        // Calculate diff
        const diff = calculateContentDiff(entry, {
          id: entry.id,
          ...input.data,
        });
        // Check if quest is changed to be an event
        if (entry.questType !== "event" && input.data.questType === "event") {
          const roles = availableRanks(input.data.questRank);
          await upsertQuestEntries(
            ctx.drizzle,
            entry,
            and(
              inArray(userData.rank, roles),
              gte(userData.updatedAt, secondsFromNow(-60 * 60 * 24 * 7)),
            ),
          );
        }
        // Update database
        await Promise.all([
          ctx.drizzle.update(quest).set(input.data).where(eq(quest.id, entry.id)),
          ctx.drizzle
            .update(questHistory)
            .set({ questType: input.data.questType })
            .where(eq(questHistory.questId, entry.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "quest",
            changes: diff,
            relatedId: entry.id,
            relatedMsg: `Update: ${entry.name}`,
            relatedImage: entry.image,
          }),
        ]);
        if (process.env.NODE_ENV !== "development") {
          await callDiscordContent(user.username, entry.name, diff, entry.image);
        }
        return { success: true, message: `Data updated: ${diff.join(". ")}` };
      } else {
        return { success: false, message: `Not allowed to edit quest` };
      }
    }),
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await ctx.drizzle.insert(quest).values({
        id: id,
        name: `New Quest - ${id}`,
        image: IMG_AVATAR_DEFAULT,
        description: "",
        timeFrame: "all_time",
        questType: "mission",
        hidden: true,
        prerequisiteQuestId: "",
        content: {
          objectives: [],
          reward: {
            reward_money: 0,
            reward_clanpoints: 0,
            reward_exp: 0,
            reward_tokens: 0,
            reward_prestige: 0,
            reward_jutsus: [],
            reward_badges: [],
            reward_items: [],
            reward_rank: "NONE",
          },
        },
      });
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create quest` };
    }
  }),
  clone: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, questData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchQuest(ctx.drizzle, input.id),
      ]);
      // Guard
      if (!questData) {
        return errorResponse("Quest not found");
      }
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to clone quest");
      }
      // Clone quest
      questData.id = nanoid();
      questData.name = `${questData.name} - copy`;
      questData.createdAt = new Date();
      questData.updatedAt = new Date();
      await ctx.drizzle.insert(quest).values(questData);

      return { success: true, message: questData.id };
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const entry = await fetchQuest(ctx.drizzle, input.id);
      if (entry && canChangeContent(user.role)) {
        await Promise.all([
          ctx.drizzle.delete(quest).where(eq(quest.id, input.id)),
          ctx.drizzle.delete(questHistory).where(eq(questHistory.questId, input.id)),
        ]);
        return { success: true, message: `Quest deleted` };
      } else {
        return { success: false, message: `Not allowed to delete quest` };
      }
    }),
  checkRewards: protectedProcedure
    .input(z.object({ questId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user) {
        return errorResponse("User does not exist");
      }
      if (user.status !== "AWAKE") {
        return errorResponse("Must be awake to finish quests");
      }

      // Figure out if any finished quests & get rewards
      const { rewards, trackers, userQuest, resolved, successDescriptions } = getReward(
        user,
        input.questId,
      );
      user.questData = trackers;

      // Update user quest data
      if (resolved && userQuest) {
        // Achievements are only inserted once completed
        if (userQuest.quest.questType === "achievement") {
          if (!userQuest.quest.hidden || canPlayHiddenQuests(user.role)) {
            await upsertQuestEntry(ctx.drizzle, user, userQuest.quest);
          }
        } else {
          user.userQuests = user.userQuests.filter((q) => q.questId !== input.questId);
          const { trackers } = getNewTrackers(user, [{ task: "any" }]);
          user.questData = trackers;
        }
      }

      // Sensei rewards
      const hasSensei = user.senseiId && user.rank === "GENIN";
      const isMission = userQuest?.quest.questType === "mission";
      const senseiId = hasSensei && isMission ? user.senseiId : null;

      // Get potential items to delete
      const deleteItemIds =
        userQuest?.quest.content.objectives
          .filter(
            (o) =>
              o.task === "collect_item" && o.delete_on_complete && o.collect_item_id,
          )
          .map((o) => CollectItem.parse(o))
          .map((o) => o.collect_item_id!) ?? [];

      // New tier quest
      const questTier = user.userQuests?.find((q) => q.quest.questType === "tier");
      if (!questTier) {
        await insertNextQuest(ctx.drizzle, user, "tier");
      }

      // If the quest is finished, we update additional fields on the userData model
      const questCounterField =
        (resolved &&
          getQuestCounterFieldName(
            userQuest?.quest.questType,
            userQuest?.quest.questRank,
          )) ||
        undefined;

      // Update database
      const [{ items, jutsus, badges }] = await Promise.all([
        // Update rewards
        updateRewards(ctx.drizzle, user, rewards, deleteItemIds, questCounterField),
        // Update quest history
        resolved
          ? ctx.drizzle
              .update(questHistory)
              .set({
                completed: 1,
                previousCompletes: sql`${questHistory.previousCompletes} + 1`,
                endAt: new Date(),
              })
              .where(
                and(
                  eq(questHistory.questId, input.questId),
                  eq(questHistory.userId, ctx.userId),
                ),
              )
          : undefined,
        // Update sensei with 1000 ryo for missions
        ...(senseiId
          ? [
              ctx.drizzle
                .update(userData)
                .set({
                  money: sql`${userData.money} + ${SENSEI_STUDENT_RYO_PER_MISSION}`,
                })
                .where(eq(userData.userId, senseiId)),
              ctx.drizzle.insert(bankTransfers).values({
                senderId: ctx.userId,
                receiverId: senseiId,
                amount: 1000,
                type: "sensei",
              }),
            ]
          : []),
      ]);
      // Update rewards for readability
      rewards.reward_items = items.map((i) => i.name);
      rewards.reward_jutsus = jutsus.map((i) => i.name);
      rewards.reward_badges = badges.map((i) => i.name);
      return {
        success: true,
        successDescriptions,
        rewards,
        userQuest,
        resolved,
        badges,
      };
    }),
  checkLocationQuest: protectedProcedure
    .output(
      z.object({
        success: z.boolean(),
        notifications: z.array(z.string()),
        questData: z.array(QuestTracker).optional(),
        updateAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Fetch
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      // Guard
      if (!user) {
        throw serverError("PRECONDITION_FAILED", "User does not exist");
      }
      // Get updated quest information
      const { trackers, notifications, consequences } = getNewTrackers(user, [
        { task: "move_to_location" },
        { task: "collect_item" },
        { task: "defeat_opponents" },
      ]);
      user.questData = trackers;
      // Items collected & opponents to attack
      const collected = consequences.filter((c) => c.type === "item");
      let opponent = consequences.find((c) => c.type === "combat");
      // If no opponent set, check if any objectives have attackers set
      const activeObjectives = getActiveObjectives(user);
      if (!opponent) {
        activeObjectives.forEach((objective) => {
          if (objective.attackers.length > 0 && objective.attackers_chance > 0) {
            const random = Math.random();
            if (random * 100 < objective.attackers_chance) {
              const idx = Math.floor(Math.random() * objective.attackers.length);
              const randomOpponent = objective.attackers[idx]!;
              opponent = {
                type: "combat",
                id: randomOpponent,
                scaleStats: objective.attackers_scaled_to_user,
                scaleGains: objective.attackers_scale_gains,
              };
              notifications.push("You have been attacked!");
            }
          }
          if (opponent) return;
        });
      }
      // Database updates
      if (notifications.length > 0) {
        // First update user to see if someone already called this function
        const result = await ctx.drizzle
          .update(userData)
          .set({ questData: user.questData, updatedAt: new Date() })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              eq(userData.updatedAt, user.updatedAt),
            ),
          );
        // If succeeded in updating user, also update other things
        if (result.rowsAffected > 0) {
          await Promise.all([
            // Update collected items
            ...(collected.map(({ id }) =>
              ctx.drizzle.insert(userItem).values({
                id: nanoid(),
                userId: ctx.userId,
                itemId: id,
                quantity: 1,
                equipped: "NONE",
              }),
            ) || []),
            // Initiate battle if needed
            ...[
              opponent
                ? (async () => {
                    return initiateBattle(
                      {
                        longitude: user.longitude,
                        latitude: user.latitude,
                        sector: user.sector,
                        userIds: [user.userId],
                        targetIds: [opponent.id],
                        client: ctx.drizzle,
                        scaleTarget: opponent.scaleStats ? true : false,
                        asset: "ground",
                      },
                      "QUEST",
                      opponent.scaleGains ?? 1,
                    );
                  })()
                : Promise.resolve(),
            ],
          ]);
          return {
            success: true,
            notifications,
            questData: user.questData,
            updateAt: new Date(),
          };
        }
      }
      return { success: false, notifications };
    }),
  getUserQuests: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Check if user has permission to view quests
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Safety
      if (!canEditPublicUser(user)) {
        throw serverError("UNAUTHORIZED", "Not authorized to view user quests");
      }
      // Get all quests for the user
      const quests = await ctx.drizzle.query.questHistory.findMany({
        where: eq(questHistory.userId, input.userId),
        with: { quest: true },
        orderBy: [asc(questHistory.startedAt)],
      });
      return quests.filter((q) => q.quest);
    }),
  deleteUserQuest: protectedProcedure
    .input(z.object({ userId: z.string(), questId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!user || !canEditPublicUser(user)) {
        return errorResponse("Not authorized to delete user quests");
      }
      // Mutate
      await Promise.all([
        ctx.drizzle
          .delete(questHistory)
          .where(
            and(
              eq(questHistory.userId, input.userId),
              eq(questHistory.questId, input.questId),
            ),
          ),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [`Deleted quest ${input.questId}`],
          relatedId: input.userId,
          relatedMsg: `Deleted quest ${input.questId}`,
          relatedImage: user.avatarLight,
        }),
      ]);
      return { success: true, message: "Quest deleted successfully" };
    }),
});

/**
 * COMMON QUERIES WHICH ARE REUSED
 */

export const updateRewards = async (
  client: DrizzleClient,
  user: UserData,
  rewards: ObjectiveRewardType,
  deleteItemIds: string[] = [],
  questCounterField?: QuestCounterFieldName,
) => {
  // Fetch names from the database
  const [items, jutsus, badges, useritems] = await Promise.all([
    // Fetch names from the database
    rewards.reward_items.length > 0
      ? client
          .select({ id: item.id, name: item.name })
          .from(item)
          .where(inArray(item.id, rewards.reward_items))
      : [],
    rewards.reward_jutsus.length > 0
      ? client
          .select({ id: jutsu.id, name: jutsu.name })
          .from(jutsu)
          .leftJoin(
            userJutsu,
            and(eq(jutsu.id, userJutsu.jutsuId), eq(userJutsu.userId, user.userId)),
          )
          .where(
            and(inArray(jutsu.id, rewards.reward_jutsus), isNull(userJutsu.userId)),
          )
      : [],
    rewards.reward_badges.length > 0
      ? client
          .select({ id: badge.id, name: badge.name, image: badge.image })
          .from(badge)
          .leftJoin(
            userBadge,
            and(eq(badge.id, userBadge.badgeId), eq(userBadge.userId, user.userId)),
          )
          .where(
            and(inArray(badge.id, rewards.reward_badges), isNull(userBadge.userId)),
          )
      : [],
    deleteItemIds.length > 0 ? fetchUserItems(client, user.userId) : null,
  ]);

  // Update userdata
  const getNewRank = rewards.reward_rank !== "NONE";
  const updatedUserData: Record<string, unknown> = {
    questData: user.questData,
    money: user.money + rewards.reward_money,
    earnedExperience: user.earnedExperience + rewards.reward_exp,
    villagePrestige: user.villagePrestige + rewards.reward_prestige,
    rank: getNewRank ? rewards.reward_rank : user.rank,
  };
  if (questCounterField) {
    updatedUserData.questFinishAt = new Date();
    updatedUserData[questCounterField] = sql`${userData[questCounterField]} + 1`;
  }

  // Filter down the items to be deleted to only those the user has
  const deleteUserItemIds = deleteItemIds
    .filter((id) => useritems?.find((i) => i.itemId === id))
    .map((id) => useritems?.find((i) => i.itemId === id)?.id) as string[];

  // Update database
  await Promise.all([
    // Update userdata
    client
      .update(userData)
      .set(updatedUserData)
      .where(eq(userData.userId, user.userId)),
    // If new rank, then delete sensei requests
    getNewRank ? deleteRequests(client, user.userId) : undefined,
    // Update village tokens
    rewards.reward_tokens > 0 && user.villageId
      ? client
          .update(village)
          .set({ tokens: sql`${village.tokens} + ${rewards.reward_tokens}` })
          .where(eq(village.id, user.villageId))
      : undefined,
    // Update clan points
    rewards.reward_clanpoints > 0 && user.clanId
      ? client
          .update(clan)
          .set({ points: sql`${clan.points} + ${rewards.reward_clanpoints}` })
          .where(eq(clan.id, user.clanId))
      : undefined,
    // Delete quest items
    deleteUserItemIds.length > 0
      ? client
          .delete(userItem)
          .where(
            and(
              eq(userItem.userId, user.userId),
              inArray(userItem.id, deleteUserItemIds),
            ),
          )
      : undefined,
    // Insert items & jutsus
    ...[
      jutsus.length > 0 &&
        client.insert(userJutsu).values(
          jutsus.map(({ id }) => ({
            id: nanoid(),
            userId: user.userId,
            jutsuId: id,
          })),
        ),
    ],
    // Insert items
    ...[
      items.length > 0 &&
        client.insert(userItem).values(
          items.map(({ id }) => ({
            id: nanoid(),
            userId: user.userId,
            itemId: id,
          })),
        ),
    ],
    // Insert achievements/badges
    ...[
      badges.length > 0 &&
        client.insert(userBadge).values(
          badges.map(({ id }) => ({
            id: nanoid(),
            userId: user.userId,
            badgeId: id,
          })),
        ),
    ],
  ]);
  // Update rewards for readability
  return { items, jutsus, badges, useritems };
};

/**
 * Fetch a quest by id
 * @param client - The database client
 * @param id - The id of the quest
 * @returns The quest
 */
export const fetchQuest = async (client: DrizzleClient, id: string) => {
  return await client.query.quest.findFirst({
    where: eq(quest.id, id),
  });
};

/**
 * Fetch quest history for a user
 * @param client - The database client
 * @param userId - The id of the user
 * @returns The quest history
 */
export const fetchUserQuestHistory = async (client: DrizzleClient, userId: string) => {
  return await client.query.questHistory.findMany({
    columns: { id: true },
    where: eq(questHistory.userId, userId),
    with: { quest: { columns: { id: true, questType: true } } },
  });
};

/**
 * Fetch uncompleted quests for a user
 * @param client - The database client
 * @param user - The user
 * @param type - The type of quest
 * @returns The uncompleted quests
 */
export const fetchUncompletedQuests = async (
  client: DrizzleClient,
  user: UserData,
  type: QuestType,
) => {
  const availableLetters = availableQuestLetterRanks(user.rank);
  const history = await client
    .select()
    .from(quest)
    .leftJoin(
      questHistory,
      and(eq(quest.id, questHistory.questId), eq(questHistory.userId, user.userId)),
    )
    .where(
      and(
        eq(quest.questType, type),
        lte(quest.requiredLevel, user.level),
        gte(quest.maxLevel, user.level),
        lte(quest.requiredLevel, user.level),
        ...(availableLetters.length > 0
          ? [inArray(quest.questRank, availableLetters)]
          : [eq(quest.questRank, "D")]),
        isNull(questHistory.completed),
        or(
          isNull(quest.requiredVillage),
          eq(quest.requiredVillage, user.villageId ?? ""),
        ),
      ),
    )
    .orderBy((table) => [asc(table.Quest.requiredLevel), asc(table.Quest.tierLevel)]);
  return history.map((quest) => quest.Quest);
};

/** Upsert quest entries for all users by selector. NOTE: selector determined which users get updated/inserted entries */
export const upsertQuestEntries = async (
  client: DrizzleClient,
  quest: Quest,
  updateSelector: SQL<unknown> | undefined,
) => {
  // Users to insert for
  const users = await client
    .select({ userId: userData.userId })
    .from(userData)
    .innerJoin(
      questHistory,
      and(eq(questHistory.userId, userData.userId), eq(questHistory.questId, quest.id)),
    )
    .where(and(updateSelector, isNull(questHistory.id)));
  if (users.length > 0) {
    await client.insert(questHistory).values(
      users.map((user) => ({
        id: nanoid(),
        userId: user.userId,
        questId: quest.id,
        questType: quest.questType,
      })),
    );
  }
  // Users to update for (including those we just inserted for)
  const allUsers = await client
    .select({ userId: userData.userId })
    .from(userData)
    .where(updateSelector);
  if (allUsers.length > 0) {
    await client
      .update(questHistory)
      .set({ completed: 0, endAt: null, startedAt: new Date() })
      .where(
        and(
          inArray(
            questHistory.userId,
            allUsers.map((user) => user.userId),
          ),
          eq(questHistory.questId, quest.id),
        ),
      );
  }
};

export const incrementDailyQuestCounter = async (
  client: DrizzleClient,
  user: UserData,
  enabled: boolean,
) => {
  if (enabled) {
    if ((user.dailyMissions ?? 0) >= 30) return false;
    await client
      .update(userData)
      .set({ dailyMissions: sql`${userData.dailyMissions} + 1` })
      .where(eq(userData.userId, user.userId));
  }
};

/** Upsert quest entry for a single user */
export const upsertQuestEntry = async (
  client: DrizzleClient,
  user: UserData,
  quest: Quest,
) => {
  const current = await client.query.questHistory.findFirst({
    where: and(
      eq(questHistory.questId, quest.id),
      eq(questHistory.userId, user.userId),
    ),
  });
  if (current) {
    const logEntry = {
      startedAt: new Date(),
      endAt: null,
      completed: 0,
      previousAttempts: current.previousAttempts + 1,
    };
    await client
      .update(questHistory)
      .set(logEntry)
      .where(eq(questHistory.id, current.id));
    return { ...current, ...logEntry };
  } else {
    const logEntry = {
      id: nanoid(),
      userId: user.userId,
      questId: quest.id,
      questType: quest.questType,
      startedAt: new Date(),
      endAt: null,
      completed: 0,
      previousCompletes: 0,
      previousAttempts: 1,
    };
    await client.insert(questHistory).values(logEntry);
    return logEntry;
  }
};

export const insertNextQuest = async (
  client: DrizzleClient,
  user: UserData,
  type: QuestType,
) => {
  const history = await fetchUncompletedQuests(client, user, type);
  const nextQuest = history?.[0];
  if (nextQuest) {
    if (!nextQuest.hidden || canPlayHiddenQuests(user.role)) {
      const logEntry = await upsertQuestEntry(client, user, nextQuest);
      return { ...logEntry, quest: nextQuest };
    }
  }
  return undefined;
};

export const fetchUserQuestByQuestId = async (
  client: DrizzleClient,
  userId: string,
  questId: string,
) => {
  return await client.query.questHistory.findFirst({
    where: and(eq(questHistory.userId, userId), eq(questHistory.questId, questId)),
  });
};
