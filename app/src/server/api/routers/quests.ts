import { z } from "zod";
import { nanoid } from "nanoid";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { serverError, baseServerResponse, errorResponse } from "@/api/trpc";
import {
  secondsFromNow,
  secondsFromDate,
  getTimeLeftStr,
  secondsPassed,
  getDaysHoursMinutesSeconds,
  DAY_S,
  WEEK_S,
  MONTH_S,
} from "@/utils/time";
import { inArray, lte, isNull, sql, asc, gte } from "drizzle-orm";
import { like, eq, or, and, getTableColumns } from "drizzle-orm";
import {
  anbuSquad,
  item,
  jutsu,
  badge,
  bankTransfers,
  clan,
  bloodline,
  bloodlineRolls,
} from "@/drizzle/schema";
import { getHuntingItemDrops } from "@/libs/hunting";
import { getGatheringItemDrops } from "@/libs/gathering";
import { userJutsu, userItem, userData, userBadge } from "@/drizzle/schema";
import { quest, questHistory, actionLog, village, userRewards } from "@/drizzle/schema";
import { QuestValidator } from "@/validators/objectives";
import { fetchUser, fetchUpdatedUser } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";
import { canPlayHiddenQuests } from "@/utils/permissions";
import { callDiscordContent } from "@/libs/discord";
import { LetterRanks } from "@/drizzle/constants";
import { calculateContentDiff } from "@/utils/diff";
import { initiateBattle } from "@/routers/combat";
import { availableQuestLetterRanks, availableRanks } from "@/libs/train";
import { getNewTrackers, getReward, verifyQuestObjectiveFlow } from "@/libs/quest";
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
import { ERRANDS_PER_DAY, MEDICAL_MISSIONS_PER_DAY, MEDNIN_RANKS } from "@/drizzle/constants";
import { calcMedninRank } from "@/libs/hospital/hospital";
import { questFilteringSchema } from "@/validators/quest";
import type { QuestConsequence } from "@/libs/quest";
import {
  controlShownQuestLocationInformation,
  isAvailableUserQuests,
} from "@/libs/quest";
import { QuestTypes } from "@/drizzle/constants";
import { QuestTracker } from "@/validators/objectives";
import type { QuestCounterFieldName } from "@/validators/user";
import type { SQL } from "drizzle-orm";
import type { QuestType } from "@/drizzle/constants";
import type { UserData, Quest } from "@/drizzle/schema";
import type { UserWithRelations } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import type { GetRewardResult } from "@/libs/quest";
import { canEditQuests } from "@/utils/permissions";

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
      results.forEach((r) => controlShownQuestLocationInformation(r));
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
      controlShownQuestLocationInformation(result, user);
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
      events.forEach((r) => controlShownQuestLocationInformation(r));
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
              inArray(quest.questType, ["mission", "errand", "crime", "medical"]),
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
      missions.forEach((r) => controlShownQuestLocationInformation(r));
      return missions.filter((e) => isAvailableUserQuests(e, user, true).check);
    }),
  specificQuests: protectedProcedure
    .input(z.object({ level: z.number(), questType: z.enum(QuestTypes) }))
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
              eq(quest.questType, input.questType),
              lte(quest.requiredLevel, input.level ?? 0),
              gte(quest.maxLevel, input.level ?? 0),
            ),
          )
          .orderBy(asc(quest.name)),
      ]);
      if (!user) throw serverError("NOT_FOUND", "User not found");
      quests.forEach((r) => controlShownQuestLocationInformation(r));
      return quests.filter((e) => isAvailableUserQuests(e, user, true).check);
    }),
  startRandom: protectedProcedure
    .input(
      z.object({
        type: z.enum(["errand", "mission", "crime", "medical"]),
        rank: z.enum(LetterRanks),
        userLevel: z.number(),
        userSector: z.number(),
        userVillageId: z.string().nullish(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch all data in parallel
      const [updatedUser, sectorVillage, results] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSectorVillage(ctx.drizzle, input.userSector),
        input.type === "medical"
          ? ctx.drizzle
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
                  or(isNull(quest.startsAt), gte(quest.startsAt, new Date().toISOString())),
                  or(isNull(quest.endsAt), lte(quest.endsAt, new Date().toISOString())),
                  or(
                    isNull(quest.requiredVillage),
                    eq(quest.requiredVillage, input.userVillageId ?? VILLAGE_SYNDICATE_ID),
                  ),
                ),
              )
          : ctx.drizzle
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
                  or(isNull(quest.startsAt), gte(quest.startsAt, new Date().toISOString())),
                  or(isNull(quest.endsAt), lte(quest.endsAt, new Date().toISOString())),
                  or(
                    isNull(quest.requiredVillage),
                    eq(quest.requiredVillage, input.userVillageId ?? VILLAGE_SYNDICATE_ID),
                  ),
                ),
              ),
      ]);

      const { user } = updatedUser;
      if (!user) return errorResponse("User does not exist");
      
      // Calculate user's medical rank for filtering
      const userMedicalRank = calcMedninRank({
        medicalExperience: user.medicalExperience,
        rank: user.rank,
      });
      
      // For medical missions, try each rank individually in descending order
      let finalResults: Quest[] = [];
      let usedMedicalRank: string | null = null;
      if (input.type === "medical") {
        const userMedicalRankIndex = MEDNIN_RANKS.indexOf(userMedicalRank);
        let foundMissions = false;
        
        // Try each rank from user's rank down to NONE
        for (let i = userMedicalRankIndex; i >= 0; i--) {
          const currentRank = MEDNIN_RANKS[i];
          if (!currentRank) continue;
          
          // Filter results for this specific medical rank
          const rankResults = results.filter((e) => 
            !e.medicalRank || e.medicalRank === currentRank
          );
          
          // Filter for available quests
          const availableMissions = rankResults.filter((e) => isAvailableUserQuests(e, user).check);
          
          if (availableMissions.length > 0) {
            finalResults = availableMissions;
            usedMedicalRank = currentRank;
            foundMissions = true;
            break;
          }
        }
        
        if (!foundMissions) {
          finalResults = [];
        }
      } else {
        // Non-medical missions use the original logic
        finalResults = results;
      }
      // Additional guards
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
      const isMedical = setting?.type === "medical";
      // Guards
      if (!setting) return errorResponse("Setting not found");
      if (user.isBanned) return errorResponse("You are banned");
      
      // Check daily errand limit
      if (isErrand && user.dailyErrands >= ERRANDS_PER_DAY) {
        return errorResponse(`You have reached your daily errand limit of ${ERRANDS_PER_DAY} errands. Please try again tomorrow.`);
      }
      
      // Check daily medical mission limit
      if (isMedical && user.dailyMedicalMissions >= MEDICAL_MISSIONS_PER_DAY) {
        return errorResponse(`You have reached your daily medical mission limit of ${MEDICAL_MISSIONS_PER_DAY} medical missions. Please try again tomorrow.`);
      }

      // Check if user is allowed to perform this rank
      const ranks = availableQuestLetterRanks(user.rank);
      if (!ranks.includes(input.rank) && input.type === "mission") {
        return errorResponse(`Rank ${input.rank} not allowed`);
      }

      // Confirm user does not have any current active missions/crimes/errands/medical
      const current = user?.userQuests?.find(
        (q) =>
          ["mission", "crime", "errand", "medical"].includes(q.quest.questType) &&
          !q.endAt,
      );
      if (current) {
        return errorResponse(`Already active ${current.questType}`);
      }
      // Fetch quest
      const result = getRandomElement(
        finalResults || [],
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
              : isMedical
              ? { dailyMedicalMissions: sql`${userData.dailyMedicalMissions} + 1` }
              : { dailyMissions: sql`${userData.dailyMissions} + 1` },
          )
          .where(eq(userData.userId, user.userId)),
      ]);
      const rankInfo = input.type === "medical" && usedMedicalRank && usedMedicalRank !== userMedicalRank 
        ? ` (using ${usedMedicalRank} rank missions)` 
        : "";
      return { success: true, message: `Quest started: ${result.name}${rankInfo}` };
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

      // Check start and end dates
      if (questData.startsAt && questData.startsAt > new Date().toISOString()) {
        return errorResponse(`Quest starts in the future`);
      }
      if (questData.endsAt && questData.endsAt < new Date().toISOString()) {
        return errorResponse(`Quest has ended`);
      }

      // Check if it's too early wrt. retry-limits
      if (questData.retryDelay !== "none" && prevAttempt?.endAt) {
        let retryDate = new Date();
        const endedDate = prevAttempt.endAt;
        if (questData.retryDelay === "daily") {
          retryDate = secondsFromDate(DAY_S, endedDate);
        } else if (questData.retryDelay === "weekly") {
          retryDate = secondsFromDate(WEEK_S, endedDate);
        } else if (questData.retryDelay === "monthly") {
          retryDate = secondsFromDate(MONTH_S, endedDate);
        }
        if (retryDate > new Date()) {
          const msLeft = -secondsPassed(retryDate) * 1000;
          const timeLeft = getTimeLeftStr(...getDaysHoursMinutesSeconds(msLeft));
          return errorResponse(`You must wait ${timeLeft} to retry this quest`);
        }
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
      } else if (questData.questType === "hunting") {
        const current = user.userQuests?.filter(
          (q) => q.quest.questType === "hunting" && !q.endAt,
        );
        if (user.occupation !== "HUNTER") {
          return errorResponse("You are not a hunter");
        }
        if (current && current.length >= QUESTS_CONCURRENT_LIMIT) {
          return errorResponse(
            `Already ${QUESTS_CONCURRENT_LIMIT} active hunting quests; ${current
              .map((c) => c.quest.name)
              .join(", ")}. Abandon one to start this quest.`,
          );
        }
      } else if (questData.questType === "battlepyramid") {
        const current = user.userQuests?.filter(
          (q) => q.quest.questType === "battlepyramid" && !q.endAt,
        );
        if (current && current.length >= 1) {
          return errorResponse(
            `Already in active battle pyramid. Abandon if you want to restart.`,
          );
        }
      } else if (questData.questType === "gathering") {
        const current = user.userQuests?.filter(
          (q) => q.quest.questType === "gathering" && !q.endAt,
        );
        if (user.occupation !== "GATHERING") {
          return errorResponse("You are not a gatherer");
        }
        if (current && current.length >= QUESTS_CONCURRENT_LIMIT) {
          return errorResponse(
            `Already ${QUESTS_CONCURRENT_LIMIT} active gathering quests; ${current
              .map((c) => c.quest.name)
              .join(", ")}. Abandon one to start this quest.`,
          );
        }
      } else if (questData.questType === "anbu") {
        if (!canAccessStructure(user, "/anbu", sectorVillage)) {
          return errorResponse("Must be in the Anbu page to start anbu quests");
        }
        if (!user.anbuId) {
          return errorResponse("You are not in an anbu squad");
        }
        const current = user.userQuests?.filter(
          (q) => q.quest.questType === "anbu" && !q.endAt,
        );
        if (current && current.length >= QUESTS_CONCURRENT_LIMIT) {
          return errorResponse(
            `Already ${QUESTS_CONCURRENT_LIMIT} active anbu quests; ${current
              .map((c) => c.quest.name)
              .join(", ")}. Abandon one to start this quest.`,
          );
        }
      } else if (questData.questType === "event") {
        if (!canAccessStructure(user, "/adminbuilding", sectorVillage)) {
          return errorResponse("Must be in your allied village to start quest");
        }
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
      } else if (["mission", "crime", "medical"].includes(questData.questType)) {
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
          (q) =>
            ["mission", "crime", "errand", "medical"].includes(q.quest.questType) &&
            !q.endAt,
        );
        if (current) {
          return errorResponse(`Already active ${current.questType}`);
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
          questData.questType,
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
      if (
        ![
          "mission",
          "crime",
          "event",
          "errand",
          "story",
          "hunting",
          "gathering",
          "medical",
          "battlepyramid",
        ].includes(current.questType)
      ) {
        throw serverError("PRECONDITION_FAILED", `Cannot abandon ${current.questType}`);
      }
      // Derived
      const questData = user.questData?.filter((q) => q.id !== input.id);
      // Mutate
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
          .set({
            questFinishAt: new Date(),
            questData: questData,
          })
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
      // Query
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchQuest(ctx.drizzle, input.id),
      ]);
      // Guards
      if (entry && canChangeContent(user.role)) {
        // Validate objective flow before updating
        if (entry.consecutiveObjectives) {
          const { check, message } = verifyQuestObjectiveFlow(
            input.data.content.objectives,
          );
          if (!check) {
            return { success: false, message: `Objective flow invalid: ${message}` };
          }
        }
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
        questType: "mission",
        medicalRank: "NONE",
        huntingRank: "NONE",
        hidden: true,
        prerequisiteQuestId: "",
        content: {
          sceneBackground: "",
          sceneCharacters: [],
          objectives: [],
          reward: {
            reward_medical_experience: 0,
            reward_hunting_experience: 0,
            reward_crafting_experience: 0,
            reward_gathering_experience: 0,
            reward_seichi_silver: 0,
            reward_money: 0,
            reward_clanpoints: 0,
            reward_anbupoints: 0,
            reward_exp: 0,
            reward_tokens: 0,
            reward_prestige: 0,
            reward_reputation: 0,
            reward_jutsus: [],
            reward_bloodlines: [],
            reward_badges: [],
            reward_items: [],
            reward_rank: "NONE",
            reward_hunter_items: false,
            reward_gathering_items: false,
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
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "quest",
            changes: [`Deleted: ${entry.name}`],
            relatedId: entry.id,
            relatedMsg: `Delete: ${entry.name}`,
            relatedImage: entry.image,
          }),
        ]);
        return { success: true, message: `Quest deleted` };
      } else {
        return { success: false, message: `Not allowed to delete quest` };
      }
    }),
  checkRewards: protectedProcedure
    .input(z.object({ questId: z.string(), nextObjectiveId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { user, toastMessages } = await fetchUpdatedUser({
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
      const { rewards, trackers, userQuest, resolved, notifications, consequences } =
        getReward(user, input.questId, input.nextObjectiveId);
      user.questData = trackers;

      // Post-reward consequences
      const postNotifications = await handleQuestConsequences(
        ctx.drizzle,
        user,
        consequences,
        notifications,
      );

      // Handle immidiate consequences first
      const finalNotifications = [...toastMessages, ...postNotifications];

      // Achievements are only inserted once completed
      if (resolved && userQuest) {
        if (userQuest.quest.questType === "achievement") {
          if (!userQuest.quest.hidden || canPlayHiddenQuests(user.role)) {
            await upsertQuestEntry(ctx.drizzle, user, userQuest.quest);
          }
        }
      }

      // Sensei rewards
      const hasSensei = user.senseiId && user.rank === "GENIN";
      const isMission = userQuest?.quest.questType === "mission";
      const senseiId = hasSensei && isMission ? user.senseiId : null;

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
      const [{ items, jutsus, bloodlines, badges }] = await Promise.all([
        // Update rewards
        updateRewards({
          client: ctx.drizzle,
          user,
          rewards,
          questCounterField,
          reason: "QUEST",
        }),
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
      rewards.reward_bloodlines = bloodlines.map((i) => i.name);
      rewards.reward_badges = badges.map((i) => i.name);
      return {
        success: true,
        notifications: finalNotifications,
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
        questIdsUpdated: z.array(z.string()).optional(),
        updateAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Fetch
      const [{ user }, useritems] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          hideInformation: false,
        }),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!user) {
        throw serverError("PRECONDITION_FAILED", "User does not exist");
      }

      // Get updated quest information
      const { trackers, notifications, consequences, questIdsUpdated } = getNewTrackers(
        { ...user, useritems },
        [
          { task: "move_to_location" },
          { task: "collect_item" },
          { task: "deliver_item" },
          { task: "defeat_opponents" },
        ],
      );
      user.questData = trackers;

      // Handle consequences
      const finalNotification = await handleQuestConsequences(
        ctx.drizzle,
        user,
        consequences,
        notifications,
      );

      // Return information
      return {
        success: true,
        notifications: finalNotification,
        questData: user.questData,
        questIdsUpdated,
        updateAt: new Date(),
      };
    }),
  getUserQuests: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Check if user has permission to view quests
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Safety
      if (!canEditQuests(user.role)) {
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
      const [user, targetUser] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUpdatedUser({ client: ctx.drizzle, userId: input.userId }),
      ]);
      // Guard
      if (!user || !canEditQuests(user.role)) {
        return errorResponse("Not authorized to delete user quests");
      }
      if (!targetUser.user) {
        return errorResponse("Target user not found");
      }
      // Derives
      const questData = targetUser.user.questData?.filter(
        (q) => q.id !== input.questId,
      );
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
        ctx.drizzle
          .update(userData)
          .set({ questData })
          .where(eq(userData.userId, input.userId)),
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
  retryBattle: protectedProcedure
    .input(z.object({ questId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Fetch
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        hideInformation: false,
      });
      // Guard
      if (!user) {
        throw serverError("PRECONDITION_FAILED", "User does not exist");
      }
      // Get updated quest information with start_battle task and retry flag
      const { notifications, consequences } = getNewTrackers(user, [
        { task: "start_battle", text: "retry" },
      ]);
      // Handle consequences
      const finalNotification = await handleQuestConsequences(
        ctx.drizzle,
        user,
        consequences,
        notifications,
      );
      // Return information
      return { success: true, message: finalNotification.join("\n") };
    }),
});

/**
 * COMMON QUERIES WHICH ARE REUSED
 */
export const updateRewards = async (info: {
  client: DrizzleClient;
  user: UserData;
  reason: string;
  rewards: GetRewardResult;
  questCounterField?: QuestCounterFieldName;
}) => {
  // Destructure
  const { client, user, rewards, questCounterField, reason } = info;
  // Fetch names from the database
  const [hunterItems, gatheringItems, items, jutsus, bloodlines, badges] =
    await Promise.all([
      // Fetch hunter items if needed
      rewards.reward_hunter_items && user.occupation === "HUNTER"
        ? client
            .select({ id: item.id, name: item.name, rarity: item.rarity })
            .from(item)
            .where(eq(item.canBeHunted, true))
        : undefined,
      // Fetch gathering items if needed
      rewards.reward_gathering_items && user.occupation === "GATHERING"
        ? client
            .select({ id: item.id, name: item.name, rarity: item.rarity })
            .from(item)
            .where(eq(item.canBeGathered, true))
        : undefined,
      // Fetch names from the database
      rewards.reward_items.length > 0
        ? client
            .select({ id: item.id, name: item.name, rarity: item.rarity })
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
      rewards.reward_bloodlines.length > 0
        ? client
            .select({ id: bloodline.id, name: bloodline.name, rank: bloodline.rank })
            .from(bloodline)
            .leftJoin(
              bloodlineRolls,
              and(
                eq(bloodline.id, bloodlineRolls.bloodlineId),
                eq(bloodlineRolls.userId, user.userId),
              ),
            )
            .where(
              and(
                inArray(bloodline.id, rewards.reward_bloodlines),
                isNull(bloodlineRolls.userId),
              ),
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
    ]);

  // If we are rewarding hunter items, only select based on hunter rank
  const droppedHunterItems = getHuntingItemDrops(
    user.huntingExperience,
    hunterItems || [],
  );
  const droppedGatheringItems = getGatheringItemDrops(
    user.gatheringExperience,
    gatheringItems || [],
  );

  // Total items to insert
  const itemsToInsert = [
    ...items,
    ...(droppedHunterItems || []),
    ...(droppedGatheringItems || []),
  ];

  // Update userdata
  const getNewRank = rewards.reward_rank !== "NONE";
  const updatedUserData: Record<string, unknown> = {
    questData: user.questData,
    money: user.money + rewards.reward_money,
    seichiSilver: user.seichiSilver + rewards.reward_seichi_silver,
    earnedExperience: user.earnedExperience + rewards.reward_exp,
    villagePrestige: user.villagePrestige + rewards.reward_prestige,
    reputationPoints: user.reputationPoints + rewards.reward_reputation,
    reputationPointsTotal: user.reputationPointsTotal + rewards.reward_reputation,
    medicalExperience: user.medicalExperience + rewards.reward_medical_experience,
    huntingExperience: user.huntingExperience + rewards.reward_hunting_experience,
    craftingExperience: user.craftingExperience + rewards.reward_crafting_experience,
    gatheringExperience: user.gatheringExperience + rewards.reward_gathering_experience,
    rank: getNewRank ? rewards.reward_rank : user.rank,
  };
  if (questCounterField) {
    updatedUserData.questFinishAt = new Date();
    updatedUserData[questCounterField] = sql`${userData[questCounterField]} + 1`;
  }

  // Update database
  await Promise.all([
    // Update userdata
    client
      .update(userData)
      .set(updatedUserData)
      .where(eq(userData.userId, user.userId)),
    // If new rank, then delete sensei requests
    getNewRank ? deleteRequests(client, user.userId) : undefined,
    // If reputation points, store that
    rewards.reward_reputation > 0 &&
      client.insert(userRewards).values({
        id: nanoid(),
        awardedById: user.userId,
        receiverId: user.userId,
        reputationAmount: rewards.reward_reputation,
        reason: reason,
      }),
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
    // Update anbu points
    rewards.reward_anbupoints > 0 && user.anbuId
      ? client
          .update(anbuSquad)
          .set({ points: sql`${anbuSquad.points} + ${rewards.reward_anbupoints}` })
          .where(eq(anbuSquad.id, user.anbuId))
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
    // Insert bloodlines as bloodlineRolls
    ...[
      bloodlines.length > 0 &&
        client.insert(bloodlineRolls).values(
          bloodlines.map(
            ({ id, rank }) =>
              ({
                id: nanoid(),
                userId: user.userId,
                type: "QUEST",
                bloodlineId: id,
                goal: rank,
                used: 1,
              }) as const,
          ),
        ),
    ],
    // Insert items
    ...[
      itemsToInsert.length > 0 &&
        client.insert(userItem).values(
          itemsToInsert.map(({ id }) => ({
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
  return { items: itemsToInsert, jutsus, bloodlines, badges };
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
        gte(quest.maxLevel, user.level),
        lte(quest.requiredLevel, user.level),
        or(isNull(quest.startsAt), gte(quest.startsAt, new Date().toISOString())),
        or(isNull(quest.endsAt), lte(quest.endsAt, new Date().toISOString())),
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
  questType: string,
) => {
  if (["mission", "crime", "medical"].includes(questType)) {
    const updateField = questType === "medical" 
      ? { dailyMedicalMissions: sql`${userData.dailyMedicalMissions} + 1` }
      : { dailyMissions: sql`${userData.dailyMissions} + 1` };
    
    await client
      .update(userData)
      .set(updateField)
      .where(eq(userData.userId, user.userId));
  }
};

/** Upsert quest entry for a single user */
export const upsertQuestEntry = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  quest: Quest,
) => {
  // Fetch the current quest history entry
  let entry = await client.query.questHistory.findFirst({
    where: and(
      eq(questHistory.questId, quest.id),
      eq(questHistory.userId, user.userId),
    ),
  });
  // Promises to be executed
  const promises: Promise<unknown>[] = [];
  // Check if the quest has already been started
  if (entry) {
    const logUpdate = {
      startedAt: new Date(),
      endAt: null,
      completed: 0,
      previousAttempts: entry.previousAttempts + 1,
    };
    promises.push(
      client.update(questHistory).set(logUpdate).where(eq(questHistory.id, entry.id)),
    );
    entry = { ...entry, ...logUpdate };
  } else {
    entry = {
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
    promises.push(client.insert(questHistory).values(entry));
  }
  // Get updated trackers and update user
  user.userQuests?.push({ ...entry, quest });
  const { trackers } = getNewTrackers(user, [{ task: "any" }]);
  promises.push(
    client
      .update(userData)
      .set({ questData: trackers })
      .where(eq(userData.userId, user.userId)),
  );
  // Execute promises
  await Promise.all(promises);
  // Return the newest log entry
  return entry;
};

export const insertNextQuest = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
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

/**
 * Handles the consequences of a quest
 * @param client - The database client
 * @param user - The user
 * @param consequences - The consequences of the quest
 * @param notifications - The notifications to be sent to the user
 * @returns The (potentially updated) notifications
 */
export const handleQuestConsequences = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  consequences: QuestConsequence[],
  notifications: string[],
) => {
  // Quests reset
  const resetQuestIds = consequences
    .filter((c) => c.type === "reset_quest")
    .map((c) => c.ids)
    .flat();
  // Quests ended
  const endedQuestIds = consequences
    .filter((c) => c.type === "fail_quest")
    .map((c) => c.ids)
    .flat();
  // Quests started
  const startedQuestIds = consequences
    .filter((c) => c.type === "start_quest")
    .map((c) => c.ids)
    .flat();
  // Items collected
  const collected = consequences.filter((c) => c.type === "add_item");
  // Items removed
  const removed = consequences.filter((c) => c.type === "remove_item");
  const removedUserItemIds = removed
    .map((c) => c.ids)
    .flat()
    .map((id) => user.items.find((ui) => ui.itemId === id)?.id)
    .filter(Boolean) as string[];
  // Opponents to attack
  let opponent = consequences.find((c) => c.type === "combat");
  // If no opponent set, check if any objectives have attackers set
  const activeObjectives = getActiveObjectives(user);
  if (!opponent) {
    activeObjectives.forEach((objective) => {
      if ("attackers" in objective && objective.attackers.length > 0) {
        let opponents = objective.attackers
          .filter((ai) => Math.random() * 100 < ai.number)
          .map((ai) => ai.ids)
          .flat();
        // See if we should limit the number of attackers
        if (
          "attackers_max_per_battle" in objective &&
          objective.attackers_max_per_battle > 0 &&
          opponents.length > objective.attackers_max_per_battle
        ) {
          // Randomly shuffle attackers and slice
          opponents = opponents
            .sort(() => Math.random() - 0.5)
            .slice(0, objective.attackers_max_per_battle);
        }
        // If it's "encounter_at_location", then check sector
        let sectorCheck = true;
        if (objective.task === "win_encounter_at_location") {
          if (user.sector !== objective.sector) {
            sectorCheck = false;
          }
        }
        // If we have opponents, set the opponent
        if (opponents.length > 0 && sectorCheck) {
          opponent = {
            type: "random_encounter",
            ids: opponents,
            scaleStats: objective.attackers_scaled_to_user,
            scaleGains: objective.attackers_scale_gains,
          };
          notifications.push("You have been attacked!");
        }
      }
      if (opponent) return;
    });
  }
  // If quests were reset, update the user's quest data
  if (resetQuestIds.length > 0 && user.questData) {
    user.questData = user.questData.filter((t) => !resetQuestIds.includes(t.id));
  }
  // Database updates
  if (notifications.length > 0 || consequences.length > 0) {
    // First update user to see if someone already called this function
    const now = new Date();
    const result = await client
      .update(userData)
      .set({ questData: user.questData, updatedAt: now })
      .where(
        and(eq(userData.userId, user.userId), eq(userData.updatedAt, user.updatedAt)),
      );

    // If succeeded in updating user, also update other things
    if (result.rowsAffected > 0) {
      // Update user timestamp for any future updates
      user.updatedAt = now;
      const collectedItems = collected.map(({ ids }) => ids).flat();
      await Promise.all([
        // Update started quests if needed
        ...(startedQuestIds.length > 0
          ? [
              (async () => {
                const quests = await client.query.quest.findMany({
                  where: inArray(quest.id, startedQuestIds),
                });
                notifications.push(
                  `Started new quest: ${quests.map((q) => q.name).join(", ")}`,
                );
                await Promise.all(
                  quests.map((quest) => upsertQuestEntry(client, user, quest)),
                );
              })(),
            ]
          : []),
        // Update ended quests if needed
        ...(endedQuestIds.length > 0
          ? [
              client
                .update(questHistory)
                .set({ completed: 0, endAt: new Date() })
                .where(
                  and(
                    inArray(questHistory.questId, endedQuestIds),
                    eq(questHistory.userId, user.userId),
                  ),
                ),
            ]
          : []),
        // Update collected items
        ...(collectedItems.length > 0
          ? [
              client.insert(userItem).values(
                collectedItems.map(
                  (id) =>
                    ({
                      id: nanoid(),
                      userId: user.userId,
                      itemId: id,
                      quantity: 1,
                      equipped: "NONE",
                    }) as const,
                ),
              ),
            ]
          : []),
        // Update removed items
        ...(removedUserItemIds.length > 0
          ? [client.delete(userItem).where(inArray(userItem.id, removedUserItemIds))]
          : []),
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
                    targetIds: opponent.ids,
                    client: client,
                    scaleTarget: opponent.scaleStats ? true : false,
                    asset: "ground",
                    forceKeepPools: opponent.forceKeepPools ?? false,
                  },
                  opponent.type === "random_encounter" ? "RANDOM_ENCOUNTER" : "QUEST",
                  opponent.scaleGains ?? 1,
                );
              })()
            : Promise.resolve(),
        ],
      ]);
    }
  }
  return notifications;
};
