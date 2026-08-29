import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { baseServerResponse, errorResponse, serverError } from "@/api/trpc";
import type { QuestType, UserRole } from "@/drizzle/constants";
import {
  ERRANDS_PER_DAY,
  IMG_AVATAR_DEFAULT,
  LetterRanks,
  MAX_SKILL_POINTS,
  MEDICAL_MISSIONS_PER_DAY,
  MEDNIN_EXP_CAP,
  NPC_ONLY_QUEST_TYPES,
  PVP_MISSIONS_PER_DAY,
  QUESTS_CONCURRENT_LIMIT,
  QuestTypes,
  SAGE_MASTERY_EXP_CAP,
  SENSEI_STUDENT_RYO_PER_MISSION,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STARTER_QUEST_ID,
  VILLAGE_SYNDICATE_ID,
  WAR_MISSIONS_PER_DAY,
} from "@/drizzle/constants";
import type { Quest, UserData } from "@/drizzle/schema";
import {
  actionLog,
  anbuSquad,
  badge,
  bankTransfers,
  bloodline,
  bloodlineRolls,
  clan,
  item,
  jutsu,
  overworldAiPlacement,
  overworldAiPlacementQuest,
  quest,
  questHistory,
  raidDamageThreshold,
  raidParticipation,
  recruitmentRewards,
  sageMode,
  sageModeRolls,
  userBadge,
  userData,
  userItem,
  userJutsu,
  userQuestAttempt,
  userRaidBuff,
  userRewards,
  village,
  war,
} from "@/drizzle/schema";
import { getGatheringItemDrops } from "@/libs/gathering";
import { getHuntingItemDrops } from "@/libs/hunting";
import {
  deriveOverworldOpponents,
  isSupportedOverworldBindingTask,
  validateFriendlyPlacementBindings,
} from "@/libs/overworldAi";
import type { GetRewardResult, QuestConsequence } from "@/libs/quest";
import {
  combineTrackerResults,
  controlShownQuestLocationInformation,
  fallbackQuestsFilter,
  filterQuestTrackersForDbPersist,
  getActiveObjectives,
  getMissionHallSettings,
  getNewTrackers,
  getReward,
  getUserQuests,
  isAvailableUserQuests,
  verifyQuestContentForSave,
} from "@/libs/quest";
import { sageQuestFilters } from "@/libs/sageMode";
import { callDiscordContent } from "@/libs/socials";
import { availableQuestLetterRanks, availableRanks } from "@/libs/train";
import { extendWarParticipantSql } from "@/libs/war";
import { initiateBattle } from "@/routers/combat";
import { fetchUserItems } from "@/routers/item";
import type { UserWithRelations } from "@/routers/profile";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { deleteRequests } from "@/routers/sensei";
import { fetchSectorVillage } from "@/routers/village";
import { fetchActiveWars } from "@/routers/war";
import type { DrizzleClient } from "@/server/db";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { chunkArray, getRandomElement } from "@/utils/array";
import { calculateContentDiff } from "@/utils/diff";
import {
  canAwardReputation,
  canChangeContent,
  canEditQuests,
  canEditStarterQuests,
  canOnlyEditSelf,
  canPlayHiddenQuests,
} from "@/utils/permissions";
import { periodStart, secondsFromNow } from "@/utils/time";
import type { QueryCondition } from "@/utils/typeutils";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import { canAccessStructure } from "@/utils/village";
import type { AllObjectivesType } from "@/validators/objectives";
import { QuestTracker, QuestValidator } from "@/validators/objectives";
import { questFilteringSchema } from "@/validators/quest";
import { PostProcessedRewardSchema } from "@/validators/rewards";
import type { QuestCounterFieldName } from "@/validators/user";
import { getQuestCounterFieldName } from "@/validators/user";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

export const questsRouter = createTRPCRouter({
  getAllNames: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all quest names and IDs" } })
    .query(async ({ ctx }) => {
      const [viewerRole, results] = await Promise.all([
        fetchViewerRole(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.quest.findMany({
          columns: { id: true, name: true, questType: true },
          orderBy: (table, { asc }) => [asc(table.name)],
        }),
      ]);
      return hideNpcOnlyQuestsFrom(viewerRole, results);
    }),
  getAll: publicProcedure
    .meta({
      mcp: { enabled: true, description: "Get paginated list of quests with filters" },
    })
    .input(
      questFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const [viewerRole, results] = await Promise.all([
        fetchViewerRole(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.quest.findMany({
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
            ...(input?.bloodline
              ? [eq(quest.requiredBloodlineId, input.bloodline)]
              : []),
            ...(input?.sageMode ? [eq(quest.requiredSageModeId, input.sageMode)] : []),
            ...(input?.userLevel
              ? [
                  gte(quest.maxLevel, input.userLevel),
                  lte(quest.requiredLevel, input.userLevel),
                ]
              : []),
            ...(input?.hidden !== undefined ? [eq(quest.hidden, !!input.hidden)] : []),
          ),
          offset: skip,
          limit: input.limit,
          ...(input?.questType === "tier" ? { orderBy: asc(quest.tierLevel) } : {}),
        }),
      ]);
      results.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      // Paginate on the raw page so a hidden NPC-only quest shortens a page rather than
      // truncating the infinite scroll early.
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: hideNpcOnlyQuestsFrom(viewerRole, results),
        nextCursor: nextCursor,
      };
    }),
  get: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get a single quest by ID" } })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [result, user] = await Promise.all([
        fetchQuest(ctx.drizzle, input.id),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId ?? ""),
        }),
      ]);
      if (!result) {
        return null;
      }
      if (
        isNpcOnlyQuestType(result.questType) &&
        !canChangeContent(user?.role ?? "USER")
      ) {
        return null;
      }
      controlShownQuestLocationInformation(result, user);
      return result;
    }),
  allianceBuilding: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get available event quests from alliance building",
      },
    })
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
      if (!user) return [];
      events.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      return events.filter((e) => isAvailableUserQuests(e, user, true).check);
    }),
  missionHall: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get available missions from mission hall" },
    })
    .input(z.object({ villageId: z.string(), level: z.number() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [{ user }, missions, activeWars] = await Promise.all([
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
              inArray(quest.questType, [
                "mission",
                "errand",
                "crime",
                "medical",
                "pvp",
                "war",
              ]),
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
        fetchActiveWars(ctx.drizzle, input.villageId),
      ]);
      if (!user) return [];
      const villageInWar = activeWars.length > 0;
      const filtered = missions.filter((e) => {
        if (e.questType === "war" && !villageInWar) return false;
        return isAvailableUserQuests(e, user, true).check;
      });
      filtered.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      return filtered;
    }),
  specificQuests: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get quests filtered by type and level" },
    })
    .input(z.object({ level: z.number(), questType: z.enum(QuestTypes) }))
    .query(async ({ ctx, input }) => {
      if (isNpcOnlyQuestType(input.questType)) {
        return [];
      }
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
      if (!user) return [];
      quests.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      return quests.filter((e) => isAvailableUserQuests(e, user, true).check);
    }),
  startRandom: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start a random mission or errand" } })
    .input(
      z.object({
        type: z.enum(["errand", "mission", "crime", "medical", "pvp"]),
        rank: z.enum(LetterRanks),
        userLevel: z.number(),
        userSector: z.number(),
        userVillageId: z.string().nullish(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user first
      const updatedUser = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const { user } = updatedUser;
      if (!user) return errorResponse("User does not exist");

      // Fetch remaining data in parallel
      const [sectorVillage, results] = await Promise.all([
        fetchSectorVillage(ctx.drizzle, input.userSector),
        // Random missions/crimes/errands/medical/pvp all resolve the candidate pool the same
        // way (same widened LEFT JOIN + filters); the quest type is already carried by the
        // `eq(quest.questType, input.type)` predicate, so no per-type query branch is needed.
        ctx.drizzle
          .select({
            ...getTableColumns(quest),
            previousAttempts: questHistory.previousAttempts,
            completed: questHistory.completed,
            periodCompletes: questHistory.periodCompletes,
            periodStartAt: questHistory.periodStartAt,
            // Extra history columns, aliased so they do NOT feed isAvailableUserQuests's flat
            // reads (esp. `previousCompletes`, which would change mission-hall availability).
            // Used only to reconstruct a prevEntry for upsertQuestEntry below, so it skips its
            // internal questHistory.findFirst on every random mission start.
            questHistoryId: questHistory.id,
            historyPreviousCompletes: questHistory.previousCompletes,
            historyStartedAt: questHistory.startedAt,
            historyEndAt: questHistory.endAt,
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
              or(isNull(quest.startsAt), lte(quest.startsAt, new Date().toISOString())),
              or(isNull(quest.endsAt), gte(quest.endsAt, new Date().toISOString())),
              or(
                isNull(quest.requiredVillage),
                eq(quest.requiredVillage, input.userVillageId ?? VILLAGE_SYNDICATE_ID),
              ),
              or(
                isNull(quest.requiredBloodlineId),
                eq(quest.requiredBloodlineId, user.bloodlineId ?? ""),
              ),
              ...sageQuestFilters(user),
            ),
          ),
      ]);
      // For certain quest types, we fallback to lower ranks if the user does not have the required rank
      const { rankInfo } = fallbackQuestsFilter(results, user, input.type);

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
      const isPvp = setting?.type === "pvp";
      // Guards
      if (!setting) return errorResponse("Setting not found");
      if (user.isBanned) return errorResponse("You are banned");

      // Check daily errand limit
      if (isErrand && user.dailyErrands >= ERRANDS_PER_DAY) {
        return errorResponse(
          `You have reached your daily errand limit of ${ERRANDS_PER_DAY} errands. Please try again tomorrow.`,
        );
      }

      // Check daily medical mission limit
      if (isMedical && user.dailyMedicalMissions >= MEDICAL_MISSIONS_PER_DAY) {
        return errorResponse(
          `You have reached your daily medical mission limit of ${MEDICAL_MISSIONS_PER_DAY} medical missions. Please try again tomorrow.`,
        );
      }

      // Check daily PvP mission limit
      if (isPvp && user.dailyPvpMissions >= PVP_MISSIONS_PER_DAY) {
        return errorResponse(
          `You have reached your daily PvP mission limit of ${PVP_MISSIONS_PER_DAY} PvP missions. Please try again tomorrow.`,
        );
      }

      // Check if user is allowed to perform this rank
      const ranks = availableQuestLetterRanks(user.rank);
      if (!ranks.includes(input.rank) && input.type === "mission") {
        return errorResponse(`Rank ${input.rank} not allowed`);
      }

      // Confirm user does not have any current active missions/crimes/errands/medical/pvp
      const current = user?.userQuests?.find(
        (q) =>
          ["mission", "crime", "errand", "medical", "pvp"].includes(
            q.quest.questType,
          ) && !q.endAt,
      );
      if (current) {
        return errorResponse(`Already active ${current.questType}`);
      }
      // Fetch quest
      const result = getRandomElement(
        results.filter((e) => isAvailableUserQuests(e, user).check),
      );
      if (!result) return errorResponse("No assignments at this level could be found");

      // Reuse the history row already loaded by the widened LEFT JOIN above so upsertQuestEntry
      // skips its own findFirst. A NULL join (never-attempted quest) → `null` → the idempotent
      // insert branch; a real row → the update branch keyed on the REAL questHistory id.
      const prevEntry =
        result.questHistoryId != null
          ? {
              id: result.questHistoryId,
              userId: user.userId,
              questId: result.id,
              questType: result.questType,
              startedAt: result.historyStartedAt ?? new Date(),
              endAt: result.historyEndAt,
              completed: result.completed ?? 0,
              previousCompletes: result.historyPreviousCompletes ?? 0,
              previousAttempts: result.previousAttempts ?? 0,
              periodCompletes: result.periodCompletes ?? 0,
              periodStartAt: result.periodStartAt,
            }
          : null;

      // Insert quest entry
      await Promise.all([
        upsertQuestEntry(ctx.drizzle, user, result, "random_assignment", prevEntry),
        ctx.drizzle
          .update(userData)
          .set(
            isErrand
              ? { dailyErrands: sql`${userData.dailyErrands} + 1` }
              : isMedical
                ? { dailyMedicalMissions: sql`${userData.dailyMedicalMissions} + 1` }
                : isPvp
                  ? { dailyPvpMissions: sql`${userData.dailyPvpMissions} + 1` }
                  : { dailyMissions: sql`${userData.dailyMissions} + 1` },
          )
          .where(eq(userData.userId, user.userId)),
      ]);
      return { success: true, message: `Quest started: ${result.name}${rankInfo}` };
    }),
  startQuest: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start a specific quest by ID" } })
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

      // Cheap pre-fetch guards (UI-only)
      const { user } = updatedUser;
      if (!user) return errorResponse("User does not exist");
      if (!questData) return errorResponse("Quest does not exist");
      if (user.sector !== input.userSector) return errorResponse("Sector mismatch");
      if (user.isBanned) return errorResponse("You are banned");

      return assignQuestToUser({
        client: ctx.drizzle,
        user,
        quest: questData,
        source: "ui",
        sectorVillage,
        prevAttempt,
      });
    }),
  abandon: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Abandon an active quest" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user) return errorResponse("User does not exist");
      const current = user?.userQuests?.find((q) => q.questId === input.id && !q.endAt);
      if (!current) {
        return { success: true, message: `Quest already abandoned` };
      }
      if (
        user.role === "USER" &&
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
          "pvp",
          "war",
          "overworld",
        ].includes(current.questType)
      ) {
        return errorResponse(`Cannot abandon ${current.questType} quest type.`);
      }
      // Derived
      const questData = filterQuestTrackersForDbPersist(
        user.questData?.filter((q) => q.id !== input.id) ?? [],
        user,
      );
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
            // If the abandoned quest held the single active-NPC-mission slot, free it in the same
            // write (questId-scoped so a concurrent grant of a different quest is never cleared).
            // Otherwise the slot stays stale and blocks the next overworld NPC interaction.
            activeNpcQuestId: sql`IF(${userData.activeNpcQuestId} = ${input.id}, NULL, ${userData.activeNpcQuestId})`,
          })
          .where(eq(userData.userId, ctx.userId)),
      ]);
      return { success: true, message: `Quest abandoned` };
    }),
  getQuestHistory: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user's quest history" } })
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
    .meta({
      mcp: { enabled: true, description: "Update quest content (content editors)" },
    })
    .input(z.object({ id: z.string(), data: QuestValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      setEmptyStringsToNulls(input.data, quest);
      // Query
      const [user, entry, tierQuests] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchQuest(ctx.drizzle, input.id),
        ctx.drizzle.select().from(quest).where(eq(quest.questType, "tier")),
      ]);
      // Guards
      if (user.isBanned) {
        return errorResponse("You are banned and cannot perform this action");
      }
      if (!entry) {
        return errorResponse("Quest not found");
      }
      if (input.data.questType === "tier") {
        if (!input.data.tierLevel) {
          return errorResponse("Tier quest must have a tier level");
        }
        const existingTierQuest = tierQuests.find(
          (tq) => tq.tierLevel === input.data.tierLevel && tq.id !== entry.id,
        );
        if (existingTierQuest) {
          return errorResponse(
            `Tier quest with level ${input.data.tierLevel} already exists: ${existingTierQuest.name}`,
          );
        }
      }
      if (
        [TUTORIAL_STARTER_QUEST_ID, TUTORIAL_GENIN_EXAM_QUEST_ID].includes(entry.id) &&
        input?.data?.hidden
      ) {
        return errorResponse("Cannot edit tutorial quest");
      }
      // Permission check
      if (entry && canChangeContent(user.role)) {
        const editingStarterQuest =
          entry.questType === "starter" || input.data.questType === "starter";
        if (editingStarterQuest && !canEditStarterQuests(user.role)) {
          return { success: false, message: `Not allowed to edit starter quests` };
        }
        // Validate objective content before updating, keyed off the INCOMING quest (not the
        // stored row): newly authored dialog branches must always route onward,
        // and full chain/reachability flow is checked when the quest is consecutive.
        const { check, message } = verifyQuestContentForSave(
          input.data.content.objectives,
          input.data.consecutiveObjectives,
        );
        if (!check) {
          return { success: false, message: `Objective flow invalid: ${message}` };
        }
        // Validate that either main quest has sceneCharacters or each objective has sceneCharacters
        const hasMainSceneCharacters = input.data.content.sceneCharacters.length > 0;
        const allObjectivesHaveSceneCharacters = input.data.content.objectives.every(
          (objective) =>
            objective.sceneCharacters && objective.sceneCharacters.length > 0,
        );
        if (
          !input.data.hidden &&
          !hasMainSceneCharacters &&
          !allObjectivesHaveSceneCharacters
        ) {
          return errorResponse(
            "Quest must have either main sceneCharacters set or all objectives must have sceneCharacters defined",
          );
        }
        // Prepare data for insertion into database
        const data = input.data;
        // Server-side enforcement: preserve existing reward_reputation if user lacks permission
        if (!canAwardReputation(user.role)) {
          data.content.reward.reward_reputation =
            entry.content.reward.reward_reputation;
          // Preserve by objective id; new objectives should not gain reputation
          const existingObjectivesById = new Map(
            entry.content.objectives.map((objective) => [objective.id, objective]),
          );
          data.content.objectives = data.content.objectives.map((objective) => {
            const existingObjective = existingObjectivesById.get(objective.id);
            return {
              ...objective,
              reward_reputation: existingObjective?.reward_reputation ?? 0,
            };
          });
        }
        // Check we only give ranks with exams
        let rankError = false;
        if (
          data.content.reward.reward_rank !== "NONE" &&
          !["starter", "exam"].includes(data.questType)
        ) {
          rankError = true;
        }
        data.content.objectives.forEach((objective) => {
          if (objective.reward_rank !== "NONE" && data.questType !== "exam") {
            rankError = true;
          }
        });
        if (rankError) {
          return {
            success: false,
            message: `Ranks rewards are only allowed with starter or exam quests`,
          };
        }
        const edgeError = await npcOnlyNewQuestEdgeError(ctx.drizzle, {
          questId: entry.id,
          questName: entry.name,
          currentType: entry.questType,
          nextType: data.questType,
          objectives: data.content.objectives,
        });
        if (edgeError) return errorResponse(edgeError);
        const preparedBindings = await prepareOverworldBindings(
          ctx.drizzle,
          data.content.objectives,
        );
        if (!preparedBindings.success) return errorResponse(preparedBindings.message);
        data.content.objectives = preparedBindings.objectives;
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
            { ...entry, ...input.data },
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
  create: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Create a new quest (content editors)" },
    })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
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
          gatheringRank: "NONE",
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
              reward_sage_mastery_experience: 0,
              reward_seichi_silver: 0,
              reward_money: 0,
              reward_clanpoints: 0,
              reward_anbupoints: 0,
              reward_exp: 0,
              reward_tokens: 0,
              reward_prestige: 0,
              reward_reputation: 0,
              reward_skillpoints: 0,
              reward_jutsus: [],
              reward_bloodlines: [],
              reward_sage_modes: [],
              reward_badges: [],
              reward_items: [],
              reward_rank: "NONE",
              reward_village_membership: "NONE",
              reward_hunter_items: false,
              reward_gathering_items: false,
              reward_hunter_items_ids: [],
              reward_gathering_items_ids: [],
              reward_war_damage: 0,
              reward_war_healing: 0,
            },
          },
        });
        return { success: true, message: id };
      } else {
        return { success: false, message: `Not allowed to create quest` };
      }
    }),
  clone: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Clone an existing quest (content editors)" },
    })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, questData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchQuest(ctx.drizzle, input.id),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
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
      // Server-side enforcement: zero out reward_reputation when cloning if user lacks permission
      if (!canAwardReputation(user.role)) {
        questData.content.reward.reward_reputation = 0;
        questData.content.objectives = questData.content.objectives.map(
          (objective) => ({
            ...objective,
            reward_reputation: 0,
          }),
        );
      }
      // Don't propagate content that would soft-lock or break flow (e.g. a terminal dialog branch).
      const { check, message } = verifyQuestContentForSave(
        questData.content.objectives,
        questData.consecutiveObjectives,
      );
      if (!check) {
        return errorResponse(`Objective flow invalid: ${message}`);
      }
      const edgeError = await npcOnlyNewQuestEdgeError(ctx.drizzle, {
        questId: questData.id,
        questName: questData.name,
        currentType: questData.questType,
        nextType: questData.questType,
        objectives: questData.content.objectives,
      });
      if (edgeError) return errorResponse(edgeError);
      const preparedBindings = await prepareOverworldBindings(
        ctx.drizzle,
        questData.content.objectives,
      );
      if (!preparedBindings.success) return errorResponse(preparedBindings.message);
      questData.content.objectives = preparedBindings.objectives;
      await ctx.drizzle.insert(quest).values(questData);

      return { success: true, message: questData.id };
    }),
  delete: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Delete a quest (content editors)" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchQuest(ctx.drizzle, input.id),
      ]);
      // Guards
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Quest not found");
      if ([TUTORIAL_STARTER_QUEST_ID, TUTORIAL_GENIN_EXAM_QUEST_ID].includes(entry.id))
        return errorResponse("Cannot delete tutorial quest");
      // Permission check
      if (entry && canChangeContent(user.role)) {
        await Promise.all([
          ctx.drizzle.delete(quest).where(eq(quest.id, input.id)),
          ctx.drizzle.delete(questHistory).where(eq(questHistory.questId, input.id)),
          ctx.drizzle
            .delete(raidParticipation)
            .where(eq(raidParticipation.questId, input.id)),
          ctx.drizzle
            .delete(raidDamageThreshold)
            .where(eq(raidDamageThreshold.questId, input.id)),
          ctx.drizzle.delete(userRaidBuff).where(eq(userRaidBuff.questId, input.id)),
          ctx.drizzle
            .delete(overworldAiPlacementQuest)
            .where(eq(overworldAiPlacementQuest.questId, input.id)),
          ctx.drizzle
            .delete(userQuestAttempt)
            .where(eq(userQuestAttempt.questId, input.id)),
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
    .meta({ mcp: { enabled: true, description: "Check and claim quest rewards" } })
    .input(z.object({ questId: z.string(), nextObjectiveId: z.string().optional() }))
    .output(
      z.union([
        // Error response
        z.object({
          success: z.literal(false),
          message: z.string(),
        }),
        // Success response
        z.object({
          success: z.literal(true),
          notifications: z.array(z.string()),
          rewards: PostProcessedRewardSchema,
          userQuest: z
            .object({
              questId: z.string(),
              quest: z.object({
                name: z.string(),
                successDescription: z.string().nullable(),
              }),
            })
            .nullable(),
          resolved: z.boolean(),
          badges: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              image: z.string(),
            }),
          ),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolved path: questHistory CAS → snapshot claim → updateRewards (SQL deltas on userdata).
      const [{ user, toastMessages, settings }, questHistoryPrefetch] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
          }),
          ctx.drizzle.query.questHistory.findFirst({
            where: and(
              eq(questHistory.questId, input.questId),
              eq(questHistory.userId, ctx.userId),
            ),
          }),
        ]);

      // Guards
      if (!user) {
        return errorResponse("User does not exist");
      }
      if (user.status !== "AWAKE") {
        return errorResponse("Must be awake to finish quests");
      }

      // Figure out if any finished quests & get rewards
      const { rewards, trackers, userQuest, resolved, notifications, consequences } =
        getReward(user, input.questId, input.nextObjectiveId, settings);

      // Persist completion before snapshot CAS so we cannot commit questData/updatedAt and then
      // lose the completion race; if snapshot claim fails, revert completion below. Shared with
      // the overworld friendly objective-target path so reward effects stay in one place.
      const claim = await commitQuestObjectiveRewards({
        client: ctx.drizzle,
        userId: ctx.userId,
        user,
        rewards,
        trackers,
        userQuest,
        resolved,
        notifications,
        consequences,
        existingHistory: questHistoryPrefetch ?? null,
      });

      if (claim.outcome === "already_completed") {
        const claimedQuest = user.userQuests.find((q) => q.questId === input.questId);
        return {
          success: true,
          notifications: [],
          rewards: PostProcessedRewardSchema.parse({}),
          userQuest: claimedQuest?.quest
            ? {
                questId: input.questId,
                quest: {
                  name: claimedQuest.quest.name,
                  successDescription: claimedQuest.quest.successDescription,
                },
              }
            : null,
          resolved: true,
          badges: [],
        };
      }
      if (claim.outcome === "not_found") {
        return errorResponse("Quest not found or not active");
      }
      if (claim.outcome === "state_changed") {
        return errorResponse("Quest state changed, please try again");
      }

      // Handle immidiate consequences first
      const finalNotifications = [...toastMessages, ...claim.postNotifications];

      return {
        success: true,
        notifications: finalNotifications,
        rewards: claim.rewards,
        userQuest: userQuest
          ? {
              questId: userQuest.questId,
              quest: {
                name: userQuest.quest.name,
                successDescription: userQuest.quest.successDescription,
              },
            }
          : null,
        resolved,
        badges: claim.badges,
      };
    }),
  checkLocationQuest: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Update quest progress for location-based objectives",
      },
    })
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
      // Fetch. boundPlacementStatus lets getNewTrackers distinguish deleted
      // (→ auto-fail) from deactivated (→ freeze/skip) placements. It depends
      // only on the user's bound objectives, not on useritems, so chain it off
      // the same user promise and fold it into the parallel batch rather than
      // paying a second sequential round-trip on this hot path.
      const userPromise = fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        hideInformation: false,
      });
      const [{ user, trackerResults }, useritems, boundPlacementStatus] =
        await Promise.all([
          userPromise,
          fetchUserItems(ctx.drizzle, ctx.userId),
          userPromise.then(({ user }) =>
            user
              ? fetchBoundPlacementStatus(ctx.drizzle, user)
              : new Map<string, boolean>(),
          ),
        ]);
      // Guard
      if (!user) {
        return { success: false, notifications: [] };
      }

      // Get updated quest information
      const updatedTrackerResults = getNewTrackers(
        { ...user, useritems },
        [
          { task: "move_to_location" },
          { task: "collect_item" },
          { task: "deliver_item" },
          { task: "defeat_opponents" },
        ],
        undefined,
        boundPlacementStatus,
      );

      // Combine and destructure for local usage
      const { trackers, notifications, consequences, questIdsUpdated } =
        combineTrackerResults(updatedTrackerResults, trackerResults);

      const fullTrackers = trackers;
      user.questData = filterQuestTrackersForDbPersist(trackers, user);

      // Handle consequences
      const { notifications: finalNotification } = await handleQuestConsequences(
        ctx.drizzle,
        user,
        consequences,
        notifications,
      );

      user.questData = fullTrackers;

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
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!user || !canEditQuests(user.role)) {
        return errorResponse("Not authorized to delete user quests");
      }
      if (!targetUser.user) {
        return errorResponse("Target user not found");
      }
      // Roles that can only edit themselves
      if (canOnlyEditSelf(user.role) && user.userId !== input.userId) {
        return errorResponse("You can only delete quests from your own profile");
      }
      // Derives
      const questData = filterQuestTrackersForDbPersist(
        targetUser.user.questData?.filter((q) => q.id !== input.questId) ?? [],
        targetUser.user,
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
    .meta({ mcp: { enabled: true, description: "Retry a quest battle after failure" } })
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
      if (!user) return errorResponse("User does not exist");
      // Get updated quest information with start_battle task and retry flag
      const { notifications, consequences } = getNewTrackers(user, [
        { task: "start_battle", text: "retry" },
      ]);
      // Handle consequences
      const { notifications: finalNotification } = await handleQuestConsequences(
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
/**
 * Callers must win an endpoint-specific idempotency / CAS claim before invoking
 * this helper. `updateRewards` itself does not provide replay protection.
 *
 * Money/XP-style scalars use SQL increments on `userData` columns so parallel grants compose;
 * village tokens and clan points already used this pattern.
 *
 * Sage: `reward_sage_modes` rolls and records a not-yet-owned mode only when the
 * player has no equipped `sageModeId`. Already-equipped players skip the grant so
 * a mode is not burned into history they can never wear.
 */
export const updateRewards = async (info: {
  client: DrizzleClient;
  user: UserData;
  reason: string;
  rewards: GetRewardResult;
  questCounterField?: QuestCounterFieldName;
  // Fully-hydrated user (with quest relations) passed ONLY by callers that want gathering drops
  // to advance the herbs_gathered tracker. Explicit opt-in — the herbs branch below no longer
  // sniffs `"userQuests" in user`, so a future caller cannot silently start incrementing it.
  questUser?: NonNullable<UserWithRelations>;
  // Extra userData columns folded into the single UPDATE below, so a caller that must also patch
  // this user's row on the reward-claim path (e.g. release an NPC-mission slot) does it in the
  // same round-trip instead of a trailing sequential write. Values may be raw scalars or `sql`
  // expressions and win over the reward keys on any name clash.
  postClaimUserDataPatch?: Record<string, unknown>;
}) => {
  // Destructure
  const {
    client,
    user,
    rewards,
    questCounterField,
    reason,
    questUser,
    postClaimUserDataPatch,
  } = info;
  // Check if we need to fetch war data
  const hasWarRewards =
    (rewards.reward_war_damage > 0 || rewards.reward_war_healing > 0) && user.villageId;

  // Count item occurrences before the query (rewards.reward_items may contain duplicates for quantity)
  const itemIdCounts = new Map<string, number>();
  for (const id of rewards.reward_items ?? []) {
    itemIdCounts.set(id, (itemIdCounts.get(id) ?? 0) + 1);
  }
  const uniqueItemIds = [...itemIdCounts.keys()];

  // Fetch names from the database
  const [
    villageData,
    hunterItems,
    gatheringItems,
    items,
    jutsus,
    bloodlines,
    badges,
    activeWars,
    sageModes,
  ] = await Promise.all([
    // Fetch villages if needed
    rewards.reward_village_membership !== "NONE"
      ? client
          .select({ id: village.id, name: village.name })
          .from(village)
          .where(eq(village.name, rewards.reward_village_membership))
          .then((v) => v[0])
      : undefined,
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
    // Fetch reward items with stacking info (use unique IDs to avoid duplicates in query)
    uniqueItemIds.length > 0
      ? client
          .select({
            id: item.id,
            name: item.name,
            rarity: item.rarity,
            canStack: item.canStack,
            stackSize: item.stackSize,
          })
          .from(item)
          .where(inArray(item.id, uniqueItemIds))
      : [],
    (rewards.reward_jutsus?.length ?? 0) > 0
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
    (rewards.reward_bloodlines?.length ?? 0) > 0
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
    (rewards.reward_badges?.length ?? 0) > 0
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
    // Fetch active wars if user has war rewards
    hasWarRewards && user.villageId
      ? fetchActiveWars(client, user.villageId)
      : undefined,
    // Fetch not-yet-owned candidate sage modes for reward_sage_modes (dedup at fetch)
    (rewards.reward_sage_modes?.length ?? 0) > 0
      ? client
          .select({ id: sageMode.id, name: sageMode.name })
          .from(sageMode)
          .leftJoin(
            sageModeRolls,
            and(
              eq(sageMode.id, sageModeRolls.sageModeId),
              eq(sageModeRolls.userId, user.userId),
            ),
          )
          .where(
            and(
              inArray(sageMode.id, rewards.reward_sage_modes),
              isNull(sageModeRolls.userId),
            ),
          )
      : [],
  ]);

  // If we are rewarding hunter items, only select based on hunter rank
  const droppedHunterItems = getHuntingItemDrops(
    user.huntingExperience,
    hunterItems || [],
    rewards.reward_hunter_items_ids,
  );
  const droppedGatheringItems = getGatheringItemDrops(
    user.gatheringExperience,
    gatheringItems || [],
    rewards.reward_gathering_items_ids,
  );

  // Expand reward items based on quantities, respecting stack sizes
  const expandedRewardItems: { id: string; name: string; quantity: number }[] = [];
  for (const itemData of items) {
    const count = itemIdCounts.get(itemData.id) ?? 1;
    if (itemData.canStack && itemData.stackSize > 1) {
      // For stackable items, insert with quantity respecting stackSize limits
      let remaining = count;
      while (remaining > 0) {
        const qty = Math.min(remaining, itemData.stackSize);
        expandedRewardItems.push({
          id: itemData.id,
          name: itemData.name,
          quantity: qty,
        });
        remaining -= qty;
      }
    } else {
      // For non-stackable items, insert multiple rows (one per item)
      for (let i = 0; i < count; i++) {
        expandedRewardItems.push({ id: itemData.id, name: itemData.name, quantity: 1 });
      }
    }
  }

  // Total items to insert (hunter and gathering items are always quantity 1)
  const itemsToInsert = [
    ...expandedRewardItems,
    ...(droppedHunterItems || []).map((i) => ({ id: i.id, name: i.name, quantity: 1 })),
    ...(droppedGatheringItems || []).map((i) => ({
      id: i.id,
      name: i.name,
      quantity: 1,
    })),
  ];

  // Fold the herbs-gathered tracker into this single questData write (avoids a second UPDATE in
  // the caller). Only the gathering-claim path drops gatherer items AND opts in via `questUser`;
  // every other caller drops nothing (or does not pass questUser), so this is skipped and their
  // questData write is unchanged. Tracker computation starts from `user.questData` (the
  // authoritative snapshot this function writes) so it stays correct even if `questUser` carries
  // a staler questData than the row being updated.
  if (droppedGatheringItems.length > 0 && questUser) {
    const { trackers } = getNewTrackers({ ...questUser, questData: user.questData }, [
      { task: "herbs_gathered", increment: droppedGatheringItems.length },
    ]);
    user.questData = filterQuestTrackersForDbPersist(trackers, questUser);
  }

  // Update userdata
  const getNewRank = rewards.reward_rank !== "NONE";
  const getNewVillage = rewards.reward_village_membership !== "NONE";

  // Cap medical experience at 4 million (atomic increment + cap in SQL so parallel reward grants stack).
  // Skillpoints and sage mastery similarly capped in SQL.

  // Roll ONE not-yet-owned candidate only when the player has no equipped mode.
  // Recording history without equipping would permanently burn that id (no swap path).
  // COALESCE still protects an empty-slot race from double-equipping.
  const rolledSageMode =
    !user.sageModeId && sageModes.length > 0 ? getRandomElement(sageModes) : undefined;

  const updatedUserData: Record<string, unknown> = {
    questData: user.questData,
    money: sql`${userData.money} + ${rewards.reward_money ?? 0}`,
    seichiSilver: sql`${userData.seichiSilver} + ${rewards.reward_seichi_silver ?? 0}`,
    earnedExperience: sql`${userData.earnedExperience} + ${rewards.reward_exp ?? 0}`,
    villagePrestige: sql`${userData.villagePrestige} + ${rewards.reward_prestige ?? 0}`,
    reputationPoints: sql`${userData.reputationPoints} + ${rewards.reward_reputation ?? 0}`,
    reputationPointsTotal: sql`${userData.reputationPointsTotal} + ${rewards.reward_reputation ?? 0}`,
    skillPoints: sql`LEAST(${userData.skillPoints} + ${rewards.reward_skillpoints ?? 0}, ${MAX_SKILL_POINTS})`,
    medicalExperience: sql`LEAST(${userData.medicalExperience} + ${rewards.reward_medical_experience ?? 0}, ${MEDNIN_EXP_CAP})`,
    huntingExperience: sql`${userData.huntingExperience} + ${rewards.reward_hunting_experience ?? 0}`,
    craftingExperience: sql`${userData.craftingExperience} + ${rewards.reward_crafting_experience ?? 0}`,
    gatheringExperience: sql`${userData.gatheringExperience} + ${rewards.reward_gathering_experience ?? 0}`,
    sageMasteryExperience: sql`LEAST(${userData.sageMasteryExperience} + ${rewards.reward_sage_mastery_experience ?? 0}, ${SAGE_MASTERY_EXP_CAP})`,
    rank: getNewRank ? rewards.reward_rank : user.rank,
    villageId: getNewVillage && villageData ? villageData.id : user.villageId,
    ...(rolledSageMode
      ? { sageModeId: sql`COALESCE(${userData.sageModeId}, ${rolledSageMode.id})` }
      : {}),
  };
  if (questCounterField) {
    updatedUserData.questFinishAt = new Date();
    updatedUserData[questCounterField] = sql`${userData[questCounterField]} + 1`;
  }
  // Fold any caller-supplied column patch into the same UPDATE (independent per-column, so it
  // does not disturb the atomic reward increments above).
  if (postClaimUserDataPatch) {
    Object.assign(updatedUserData, postClaimUserDataPatch);
  }

  // Recruitment logic
  const prestigeReward = Math.ceil(rewards.reward_prestige * 0.1);

  // Update database
  await Promise.all([
    // Update userdata
    client
      .update(userData)
      .set(updatedUserData)
      .where(eq(userData.userId, user.userId)),
    // If recruited by someone, check if we should reward prestige points
    ...(user.recruiterId && prestigeReward > 0
      ? [
          client
            .update(userData)
            .set({
              villagePrestige: sql`${userData.villagePrestige} + ${prestigeReward}`,
            })
            .where(eq(userData.userId, user.recruiterId)),
          client.insert(recruitmentRewards).values({
            id: nanoid(),
            userId: user.recruiterId,
            recruitedUserId: user.userId,
            amount: prestigeReward,
            type: "PRESTIGE",
          }),
        ]
      : []),
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
    // Update clan points and activity points
    rewards.reward_clanpoints > 0 && user.clanId
      ? client
          .update(clan)
          .set({
            points: sql`${clan.points} + ${rewards.reward_clanpoints}`,
            activityPoints: sql`${clan.activityPoints} + ${rewards.reward_clanpoints}`,
          })
          .where(eq(clan.id, user.clanId))
      : undefined,
    // Update anbu points
    rewards.reward_anbupoints > 0 && user.anbuId
      ? client
          .update(anbuSquad)
          .set({ points: sql`${anbuSquad.points} + ${rewards.reward_anbupoints}` })
          .where(eq(anbuSquad.id, user.anbuId))
      : undefined,
    // Insert items & jutsus - use onDuplicateKeyUpdate to handle race conditions
    ...[
      jutsus.length > 0 &&
        client
          .insert(userJutsu)
          .values(
            jutsus.map(({ id }) => ({
              id: nanoid(),
              userId: user.userId,
              jutsuId: id,
            })),
          )
          .onDuplicateKeyUpdate({ set: { id: sql`id` } }),
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
                pityRolls: 0,
              }) as const,
          ),
        ),
    ],
    // Record the not-yet-owned candidate into history (dedup for future quest grants);
    // it auto-equips below only when the player currently has no sage mode.
    rolledSageMode
      ? client.insert(sageModeRolls).values({
          id: nanoid(),
          userId: user.userId,
          type: "QUEST",
          sageModeId: rolledSageMode.id,
        })
      : undefined,
    // Insert items with quantity
    ...[
      itemsToInsert.length > 0 &&
        client.insert(userItem).values(
          itemsToInsert.map(({ id, quantity }) => ({
            id: nanoid(),
            userId: user.userId,
            itemId: id,
            quantity: quantity,
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
    // Handle war rewards (damage to enemy war health or healing to own war health)
    // Updates ALL active wars the user is involved in
    ...(() => {
      if (!activeWars || activeWars.length === 0) return [];
      // Find ALL applicable wars (VILLAGE_WAR or WAR_RAID)
      const applicableWars = activeWars.filter(
        (w) =>
          ["VILLAGE_WAR", "WAR_RAID"].includes(w.type) &&
          (w.attackerVillageId === user.villageId ||
            w.defenderVillageId === user.villageId ||
            w.warAllies.some((a) => a.villageId === user.villageId)),
      );
      if (applicableWars.length === 0) return [];

      const warUpdates: Promise<unknown>[] = [];

      // Process each war the user is involved in
      for (const activeWar of applicableWars) {
        // Determine if user is on attacker or defender side for this war
        const isOnAttackerSide =
          activeWar.attackerVillageId === user.villageId ||
          activeWar.warAllies.some(
            (a) =>
              a.villageId === user.villageId &&
              a.supportVillageId === activeWar.attackerVillageId,
          );

        // Apply war damage (damages opponent's war health)
        if (rewards.reward_war_damage > 0) {
          if (isOnAttackerSide) {
            // Attacker damages defender's war health
            warUpdates.push(
              client
                .update(war)
                .set({
                  defenderWarHealth: sql`GREATEST(defenderWarHealth - ${rewards.reward_war_damage}, 0)`,
                })
                .where(and(eq(war.id, activeWar.id), isNull(war.endedAt))),
            );
          } else {
            // Defender damages attacker's war health
            warUpdates.push(
              client
                .update(war)
                .set({
                  attackerWarHealth: sql`GREATEST(attackerWarHealth - ${rewards.reward_war_damage}, 0)`,
                })
                .where(and(eq(war.id, activeWar.id), isNull(war.endedAt))),
            );
          }
        }

        // Apply war healing (heals own side's war health)
        if (rewards.reward_war_healing > 0) {
          if (isOnAttackerSide) {
            // Attacker heals attacker's war health
            warUpdates.push(
              client
                .update(war)
                .set({
                  attackerWarHealth: sql`LEAST(attackerWarHealth + ${rewards.reward_war_healing}, attackerWarHealthMax)`,
                })
                .where(and(eq(war.id, activeWar.id), isNull(war.endedAt))),
            );
          } else {
            // Defender heals defender's war health
            warUpdates.push(
              client
                .update(war)
                .set({
                  defenderWarHealth: sql`LEAST(defenderWarHealth + ${rewards.reward_war_healing}, defenderWarHealthMax)`,
                })
                .where(and(eq(war.id, activeWar.id), isNull(war.endedAt))),
            );
          }
        }
      }

      return warUpdates;
    })(),
  ]);
  // Update rewards for readability. `droppedGatheringItems` is surfaced so the quest
  // claim caller (the only updateRewards caller with hydrated userQuests) can credit
  // the herbs_gathered tracker by the number of gathered drops.
  return {
    items: itemsToInsert,
    jutsus,
    bloodlines,
    badges,
    droppedGatheringItems,
    sageModes: rolledSageMode ? [rolledSageMode] : [],
  };
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

/** True when a quest type can only ever be acquired from its assigned overworld NPC. */
const isNpcOnlyQuestType = (questType: QuestType) =>
  (NPC_ONLY_QUEST_TYPES as readonly QuestType[]).includes(questType);

/**
 * Role of the (possibly signed-out) caller of a public content-browsing endpoint. Defaults to
 * "USER" so an unauthenticated visitor is redacted exactly like an ordinary player.
 */
const fetchViewerRole = async (
  client: DrizzleClient,
  userId: string | null | undefined,
) => {
  if (!userId) return "USER" as UserRole;
  const viewer = await client.query.userData.findFirst({
    columns: { role: true },
    where: eq(userData.userId, userId),
  });
  return viewer?.role ?? ("USER" as UserRole);
};

/**
 * Drops NPC-only quests from a content listing for anyone who cannot edit content. They are
 * unobtainable outside their assigned overworld NPC, so listing them in the manual would only
 * advertise content the player has no way to start.
 */
const hideNpcOnlyQuestsFrom = <T extends { questType: QuestType }>(
  viewerRole: UserRole,
  quests: T[],
) =>
  canChangeContent(viewerRole)
    ? quests
    : quests.filter((q) => !isNpcOnlyQuestType(q.questType));

/**
 * Quests whose stored objectives start `questId` through a new_quest consequence. Retyping a
 * quest to an NPC-only type while such a reference is live would strand the referring chain, so
 * the update endpoint rejects the retype until the reference is removed.
 */
const fetchQuestsStartingQuest = async (client: DrizzleClient, questId: string) =>
  client.query.quest.findMany({
    columns: { id: true, name: true },
    where: sql`JSON_CONTAINS(JSON_EXTRACT(${quest.content}, '$.objectives[*].newQuestIds[*]'), JSON_QUOTE(${questId})) = 1`,
  });

/**
 * Reason a quest save must be rejected because of a new_quest edge involving an NPC-only quest,
 * or null when it may proceed. Both directions matter:
 *
 * - Outbound: an objective may not start an NPC-only quest, which would hand out content the
 *   overworld-NPC gate is supposed to be the only source of.
 * - Inbound: a quest may not BECOME NPC-only while something still starts it. `create` always
 *   makes a mission, so retyping is the only way an NPC-only quest exists, and a stranded edge
 *   throws in `upsertQuestEntry` after the player's snapshot has already been committed — the
 *   objective is burnt, the chain dead, and a terminal objective completes with no reward.
 */
export const npcOnlyNewQuestEdgeError = async (
  client: DrizzleClient,
  args: {
    questId: string;
    questName: string;
    currentType: QuestType;
    nextType: QuestType;
    objectives: AllObjectivesType[];
  },
): Promise<string | null> => {
  const { questId, questName, currentType, nextType, objectives } = args;
  const becomingNpcOnly =
    isNpcOnlyQuestType(nextType) && !isNpcOnlyQuestType(currentType);
  const [outboundTargets, inboundStarters] = await Promise.all([
    fetchNpcOnlyNewQuestTargets(client, objectives),
    becomingNpcOnly ? fetchQuestsStartingQuest(client, questId) : Promise.resolve([]),
  ]);
  // Both queries read stored rows, which are stale for this quest itself: this save rewrites its
  // type AND its objectives. Judge every self-reference from the incoming state instead, so an
  // editor can always type their way back out of an edge rather than being locked out of the form.
  const startsItself = objectives.some(
    (objective) =>
      objective.task === "new_quest" &&
      "newQuestIds" in objective &&
      objective.newQuestIds.includes(questId),
  );
  const blockedTargets = outboundTargets.filter(
    (target) => target.id !== questId || isNpcOnlyQuestType(nextType),
  );
  if (blockedTargets.length > 0) {
    return `NPC-only quests cannot be started by a new_quest objective: ${blockedTargets
      .map((target) => target.name)
      .join(", ")}`;
  }
  const starterNames = inboundStarters
    .filter((starter) => starter.id !== questId)
    .map((starter) => starter.name);
  if (becomingNpcOnly && startsItself) starterNames.push(questName);
  if (starterNames.length > 0) {
    return `Cannot change this quest to ${nextType}: it is still started by a new_quest objective in ${[
      ...new Set(starterNames),
    ].join(", ")}. Remove those objectives first.`;
  }
  return null;
};

/** Resolve NPC-only quests referenced by new_quest objectives so content cannot author a bypass. */
const fetchNpcOnlyNewQuestTargets = async (
  client: DrizzleClient,
  objectives: AllObjectivesType[],
) => {
  const targetIds = [
    ...new Set(
      objectives.flatMap((objective) =>
        objective.task === "new_quest" && "newQuestIds" in objective
          ? objective.newQuestIds
          : [],
      ),
    ),
  ];
  if (targetIds.length === 0) return [];
  return client.query.quest.findMany({
    columns: { id: true, name: true },
    where: and(
      inArray(quest.id, targetIds),
      inArray(quest.questType, [...NPC_ONLY_QUEST_TYPES]),
    ),
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
  const now = new Date().toISOString();
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
        or(isNull(quest.startsAt), lte(quest.startsAt, now)),
        or(isNull(quest.endsAt), gte(quest.endsAt, now)),
        ...(availableLetters.length > 0
          ? [inArray(quest.questRank, availableLetters)]
          : [eq(quest.questRank, "D")]),
        isNull(questHistory.completed),
        or(
          isNull(quest.requiredVillage),
          eq(quest.requiredVillage, user.villageId ?? ""),
        ),
        or(
          isNull(quest.requiredBloodlineId),
          eq(quest.requiredBloodlineId, user.bloodlineId ?? ""),
        ),
        ...sageQuestFilters(user),
      ),
    )
    .orderBy((table) => [asc(table.Quest.requiredLevel), asc(table.Quest.tierLevel)]);
  return history
    .map((quest) => quest.Quest)
    .filter((q) => !q.hidden || canPlayHiddenQuests(user.role));
};

/** Row locks the bulk quest reset may hold in one statement. */
const QUEST_RESET_BATCH_SIZE = 100;

/** Upsert quest entries for all users by selector. NOTE: selector determined which users get updated/inserted entries */
export const upsertQuestEntries = async (
  client: DrizzleClient,
  quest: Quest,
  updateSelector: QueryCondition,
) => {
  if (isNpcOnlyQuestType(quest.questType)) {
    throw serverError(
      "PRECONDITION_FAILED",
      "Overworld quests cannot be assigned to users in bulk.",
    );
  }
  // Users to insert for
  const users = await client
    .select({ userId: userData.userId, username: userData.username })
    .from(userData)
    .leftJoin(
      questHistory,
      and(eq(questHistory.userId, userData.userId), eq(questHistory.questId, quest.id)),
    )
    .where(and(updateSelector, isNull(questHistory.id)));
  if (users.length > 0) {
    await client
      .insert(questHistory)
      .values(
        users.map((user) => ({
          id: nanoid(),
          userId: user.userId,
          questId: quest.id,
          questType: quest.questType,
        })),
      )
      .onDuplicateKeyUpdate({
        set: { completed: 0, endAt: null, startedAt: new Date() },
      });
  }
  // Users to update for (including those we just inserted for)
  const allUsers = await client
    .select({ userId: userData.userId })
    .from(userData)
    .where(updateSelector);
  if (allUsers.length > 0) {
    // One statement over every eligible user held hundreds of QuestHistory row locks
    // while ordinary quest traffic wrote the same table through its unique key, and the
    // daily reset lost the resulting lock cycle. Bounded batches run sequentially so the
    // reset never contends with itself either, and share one timestamp so a batch that
    // has to be retried still stamps what the rest of the reset did.
    const startedAt = new Date();
    const batches = chunkArray(
      allUsers.map((user) => user.userId),
      QUEST_RESET_BATCH_SIZE,
    );
    for (const batch of batches) {
      await client
        .update(questHistory)
        .set({ completed: 0, endAt: null, startedAt })
        .where(
          and(inArray(questHistory.userId, batch), eq(questHistory.questId, quest.id)),
        );
    }
  }
};

export const incrementDailyQuestCounter = async (
  client: DrizzleClient,
  user: UserData,
  questType: string,
) => {
  if (["mission", "crime", "medical", "pvp", "war"].includes(questType)) {
    const updateField =
      questType === "medical"
        ? { dailyMedicalMissions: sql`${userData.dailyMedicalMissions} + 1` }
        : questType === "pvp"
          ? { dailyPvpMissions: sql`${userData.dailyPvpMissions} + 1` }
          : questType === "war"
            ? { dailyWarMissions: sql`${userData.dailyWarMissions} + 1` }
            : { dailyMissions: sql`${userData.dailyMissions} + 1` };

    await client
      .update(userData)
      .set(updateField)
      .where(eq(userData.userId, user.userId));
  }
};

/**
 * Quest types that {@link assignQuestToUser} can start. Errand (and meta types like
 * achievement/tier) are intentionally excluded: errands are dispensed only via the
 * `startRandom` procedure, which enforces the daily errand cap this centralized path does
 * not. The overworld-NPC flow filters its pool to these so a mis-pooled type can never
 * reach assignQuestToUser, throw, and strand a player's NPC-quest claim.
 */
export const ASSIGNABLE_QUEST_TYPES: QuestType[] = [
  "story",
  "hunting",
  "gathering",
  "anbu",
  "event",
  "battlepyramid",
  "starter",
  "mission",
  "crime",
  "medical",
  "pvp",
  "war",
  "overworld",
];

/**
 * Quest types an overworld NPC must NOT grant. Their UI start path enforces an
 * occupation / squad-membership / structure-location prerequisite (HUNTER, GATHERING, anbuId,
 * Global Anbu HQ, adminbuilding) via {@link uiStructureAccessGuard}, which
 * {@link assignQuestToUser} only runs for `source === "ui"`. A player interacting with a friendly
 * NPC in the field can satisfy none of these, so pooling such a quest would hand its content to a
 * player who fails the gate the mission-hall path enforces.
 */
export const OVERWORLD_GATED_QUEST_TYPES: QuestType[] = [
  "story",
  "hunting",
  "gathering",
  "anbu",
  "event",
];

/** Quest types an overworld NPC pool may offer/grant: assignable minus the gated set above. */
export const OVERWORLD_ASSIGNABLE_QUEST_TYPES: QuestType[] =
  ASSIGNABLE_QUEST_TYPES.filter((type) => !OVERWORLD_GATED_QUEST_TYPES.includes(type));

/** Every path that creates or restarts a quest history row must declare its origin. */
export type QuestAcquisitionSource =
  | "ui"
  | "overworld_npc"
  | "random_assignment"
  | "system"
  | "quest_objective";

/**
 * Returns the user-facing reason a quest cannot start because its type has reached its concurrency
 * limit, or `null` when another quest of that type may be assigned.
 */
export const questTypeConcurrentBlockMessage = (
  quest: Pick<Quest, "questType" | "name">,
  user: NonNullable<UserWithRelations>,
): string | null => {
  /** Returns the user's unfinished quests for a specific quest type. */
  const activeOfType = (type: string) =>
    user.userQuests?.filter((q) => q.quest.questType === type && !q.endAt) ?? [];
  switch (quest.questType) {
    case "story":
    case "hunting":
    case "gathering":
    case "anbu":
    case "event": {
      const cur = activeOfType(quest.questType);
      if (cur.length >= QUESTS_CONCURRENT_LIMIT) {
        return `Already ${QUESTS_CONCURRENT_LIMIT} active ${quest.questType} quests; ${cur
          .map((c) => c.quest.name)
          .join(", ")}. Abandon one to start this quest.`;
      }
      return null;
    }
    case "battlepyramid": {
      if (activeOfType("battlepyramid").length >= 1) {
        return `Already in active battle pyramid. Abandon if you want to restart.`;
      }
      return null;
    }
    case "starter": {
      if (activeOfType("starter").length >= 1) {
        return `Already in active starter quest. Abandon if you want to restart.`;
      }
      return null;
    }
    case "war": {
      const blockers = ["mission", "crime", "errand", "medical", "pvp", "war"];
      const found = user.userQuests?.find(
        (q) => blockers.includes(q.quest.questType) && !q.endAt,
      );
      return found ? `Already have an active ${found.quest.questType}` : null;
    }
    case "mission":
    case "crime":
    case "medical":
    case "pvp": {
      const blockers = ["mission", "crime", "errand", "medical", "pvp"];
      const found = user.userQuests?.find(
        (q) => blockers.includes(q.quest.questType) && !q.endAt,
      );
      return found ? `Already active ${found.quest.questType}` : null;
    }
    default:
      return null;
  }
};

/**
 * Structure and occupation guards that only apply when a player starts a quest
 * through the UI (Mission Hall, Anbu page, etc.). NPC-initiated quests skip these.
 * Returns an errorResponse-shaped object on failure, or null to allow proceeding.
 */
const uiStructureAccessGuard = (
  quest: Quest,
  user: NonNullable<UserWithRelations>,
  sectorVillage: Awaited<ReturnType<typeof fetchSectorVillage>>,
): { success: false; message: string } | null => {
  if (quest.questType === "story") {
    if (!canAccessStructure(user, "/globalanbuhq", sectorVillage)) {
      return errorResponse("Must be in the Global Anbu HQ to start story quests");
    }
  } else if (quest.questType === "hunting") {
    if (user.occupation !== "HUNTER") {
      return errorResponse("You are not a hunter");
    }
  } else if (quest.questType === "gathering") {
    if (user.occupation !== "GATHERING") {
      return errorResponse("You are not a gatherer");
    }
  } else if (quest.questType === "anbu") {
    if (!canAccessStructure(user, "/anbu", sectorVillage)) {
      return errorResponse("Must be in the Anbu page to start anbu quests");
    }
    if (!user.anbuId) {
      return errorResponse("You are not in an anbu squad");
    }
  } else if (quest.questType === "event") {
    if (!canAccessStructure(user, "/adminbuilding", sectorVillage)) {
      return errorResponse("Must be in your allied village to start quest");
    }
  } else if (quest.questType === "war") {
    if (!user.villageId) {
      return errorResponse("You must be in a village to accept war missions");
    }
    if (!user.isOutlaw && !canAccessStructure(user, "/missionhall", sectorVillage)) {
      return errorResponse("Must be in your allied village to start quest");
    }
    if (user.dailyWarMissions >= WAR_MISSIONS_PER_DAY) {
      return errorResponse(
        `You have reached your daily war mission limit of ${WAR_MISSIONS_PER_DAY}`,
      );
    }
  } else if (["mission", "crime", "medical", "pvp"].includes(quest.questType)) {
    if (["mission", "crime"].includes(quest.questType) && quest.questRank !== "A") {
      return errorResponse(`Only A rank missions/crimes are allowed`);
    }
    if (!user.isOutlaw && !canAccessStructure(user, "/missionhall", sectorVillage)) {
      return errorResponse("Must be in your allied village to start quest");
    }
  }
  return null;
};

/**
 * Core quest-assignment orchestration shared by the UI (`startQuest`) and overworld
 * NPC interactions. Runs all source-agnostic guards (rank, availability, date window,
 * retry delay, already-on-quest, per-type concurrent limit, war daily-CAS), applies
 * UI-only structure/occupation guards when `source === "ui"`, then writes the quest
 * entry and increments the daily counter.
 */
export const assignQuestToUser = async (args: {
  client: DrizzleClient;
  user: NonNullable<UserWithRelations>;
  quest: Quest;
  source: "ui" | "overworld_npc";
  /** Required for NPC-only quests so their placement assignment can be verified server-side. */
  overworldPlacementId?: string;
  sectorVillage?: Awaited<ReturnType<typeof fetchSectorVillage>>;
  // Required: it feeds the availability / period-cap guards below and is threaded into
  // upsertQuestEntry to skip its findFirst round-trip. Both callers already fetch it.
  prevAttempt: Awaited<ReturnType<typeof fetchUserQuestByQuestId>>;
}): Promise<{ success: boolean; message: string }> => {
  const {
    client,
    user,
    quest: questData,
    source,
    sectorVillage,
    overworldPlacementId,
    prevAttempt,
  } = args;

  // NPC-only quests can never be acquired through the generic UI start endpoint.
  if (isNpcOnlyQuestType(questData.questType) && source !== "overworld_npc") {
    return errorResponse(
      "This quest can only be accepted from its assigned overworld NPC.",
    );
  }

  // Verify the concrete placement-to-quest relation instead of trusting a quest id supplied by
  // another internal caller. The overworld interaction route is the only caller that supplies a
  // placement id, and it has already validated that the player is standing at that active NPC.
  if (isNpcOnlyQuestType(questData.questType)) {
    if (!overworldPlacementId) {
      return errorResponse("This quest is not assigned to this overworld NPC.");
    }
    const placementQuest = await client.query.overworldAiPlacementQuest.findFirst({
      columns: { questId: true },
      where: and(
        eq(overworldAiPlacementQuest.placementId, overworldPlacementId),
        eq(overworldAiPlacementQuest.questId, questData.id),
      ),
    });
    if (!placementQuest) {
      return errorResponse("This quest is not assigned to this overworld NPC.");
    }
  }

  // Rank guard
  const ranks = availableQuestLetterRanks(user.rank);
  if (!ranks.includes(questData.questRank)) {
    return errorResponse(`Rank ${user.rank} not allowed`);
  }

  // Availability checks (uses userQuests + completedQuests on user)
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

  // Check if user is already on this quest
  const isAlreadyOnQuest = user.userQuests?.some(
    (q) => q.questId === questData.id && !q.endAt,
  );
  if (isAlreadyOnQuest) {
    return errorResponse(`You are already on this quest: ${questData.name}`);
  }

  // UI-only structure/occupation/rank guards
  if (source === "ui") {
    const guard = uiStructureAccessGuard(questData, user, sectorVillage ?? null);
    if (guard) return guard;
  }

  // Overworld NPC grants skip the UI structure/occupation gate (the player is in the field, not at
  // the gating structure), so a gated type must never reach here. The overworld pool filter already
  // excludes these types; this is the authoritative backstop for any future caller.
  if (
    source === "overworld_npc" &&
    OVERWORLD_GATED_QUEST_TYPES.includes(questData.questType)
  ) {
    return errorResponse("This quest type cannot be granted by an overworld NPC.");
  }

  // Reject unknown quest types before touching the DB (mirrors the original serverError throw)
  if (!ASSIGNABLE_QUEST_TYPES.includes(questData.questType)) {
    throw serverError(
      "PRECONDITION_FAILED",
      `Invalid quest type to start: ${questData.questType}`,
    );
  }

  // Per-type concurrent-limit guard (pure, no DB)
  const block = questTypeConcurrentBlockMessage(questData, user);
  if (block) return errorResponse(block);

  // War: fetch active wars (expensive; only after all cheap guards pass)
  if (questData.questType === "war") {
    if (!user.villageId) {
      return errorResponse("You must be in a village for war missions");
    }
    const warList = await fetchActiveWars(client, user.villageId);
    if (warList.length === 0) {
      return errorResponse("Your village is not in an active war");
    }
  }

  // Insert quest entry; for war quests guard the daily limit with a CAS counter update.
  // CAS runs first so that a user at the daily limit is rejected before any quest entry
  // is written. PlanetScale has no transactions, so this ordering means a crash between
  // the CAS success and the upsert burns one daily slot without delivering the quest
  // (acceptable), whereas the reverse order would deliver a quest when the limit is reached
  // (unacceptable — creates orphaned quest entries the user cannot access). The
  // warParticipantUntil stamp rides on the same guarded CAS update so it costs no extra
  // roundtrip; a crash before upsertQuestEntry then leaves a bounded (~2h) cross-bracket
  // stamp without a quest — the same fail-safe leak the equivalent merge in initiateBattle
  // accepts, and harmless since it only makes the user more attackable.
  if (questData.questType === "war") {
    const result = await client
      .update(userData)
      .set({
        dailyWarMissions: sql`${userData.dailyWarMissions} + 1`,
        warParticipantUntil: extendWarParticipantSql(),
      })
      .where(
        and(
          eq(userData.userId, user.userId),
          sql`${userData.dailyWarMissions} < ${WAR_MISSIONS_PER_DAY}`,
        ),
      );
    if (result.rowsAffected === 0) {
      return errorResponse(
        `You have reached your daily war mission limit of ${WAR_MISSIONS_PER_DAY}`,
      );
    }
    await upsertQuestEntry(client, user, questData, source, prevAttempt ?? null);
  } else {
    await Promise.all([
      upsertQuestEntry(client, user, questData, source, prevAttempt ?? null),
      incrementDailyQuestCounter(client, user, questData.questType),
    ]);
  }
  return { success: true, message: `Quest started: ${questData.name}` };
};

/**
 * Upsert quest entry for a single user.
 *
 * `prevEntry` lets a caller that already loaded this user's `questHistory` row (e.g. via
 * {@link fetchUserQuestByQuestId} in its opening `Promise.all`) hand it in so the initial
 * `findFirst` round-trip is skipped: `undefined` = not provided (fetch it here), a row or
 * `null` = already resolved (use as-is). Mirrors the `existingHistory` sentinel that
 * {@link commitQuestObjectiveRewards} uses. The insert branch is idempotent on the
 * `(userId, questId)` unique key, so a stale `null` that races a concurrent insert restarts
 * the existing row rather than throwing.
 */
export const upsertQuestEntry = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  quest: Quest,
  source: QuestAcquisitionSource,
  prevEntry?: Awaited<ReturnType<typeof fetchUserQuestByQuestId>> | null,
) => {
  if (isNpcOnlyQuestType(quest.questType) && source !== "overworld_npc") {
    throw serverError(
      "PRECONDITION_FAILED",
      "Overworld quests can only be accepted from their assigned NPC.",
    );
  }
  // Reuse the caller's pre-fetched history row when supplied; otherwise load it here.
  let entry =
    prevEntry !== undefined
      ? prevEntry
      : await client.query.questHistory.findFirst({
          where: and(
            eq(questHistory.questId, quest.id),
            eq(questHistory.userId, user.userId),
          ),
        });
  // Promises to be executed
  const promises: Promise<unknown>[] = [];
  // Check if the quest has already been started
  if (entry) {
    const startedAt = new Date();
    promises.push(
      client
        .update(questHistory)
        .set({
          startedAt,
          endAt: null,
          completed: 0,
          // Atomic increment so a concurrent restart of the same row can't lose a count to a
          // stale JS-side base; matches the insert branch's onDuplicateKeyUpdate below.
          previousAttempts: sql`${questHistory.previousAttempts} + 1`,
        })
        .where(eq(questHistory.id, entry.id)),
    );
    entry = {
      ...entry,
      startedAt,
      endAt: null,
      completed: 0,
      previousAttempts: entry.previousAttempts + 1,
    };
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
      periodCompletes: 0,
      periodStartAt: null,
    };
    // Idempotent on the (userId, questId) unique key: if a concurrent start (double-tap, or a
    // UI + overworld race, possibly past a stale `prevEntry`) already inserted the row, restart
    // it in place with the same mutation the update branch applies instead of throwing a
    // duplicate-key error. On the overworld path that throw would skip the caller's
    // clearActiveNpcQuest cleanup and strand the just-claimed NPC-mission slot.
    promises.push(
      client
        .insert(questHistory)
        .values(entry)
        .onDuplicateKeyUpdate({
          set: {
            startedAt: entry.startedAt,
            endAt: null,
            completed: 0,
            previousAttempts: sql`${questHistory.previousAttempts} + 1`,
          },
        }),
    );
  }
  // Get updated trackers and update user
  user.userQuests?.push({ ...entry, quest });
  const { trackers } = getNewTrackers(user, [{ task: "any" }]);
  promises.push(
    client
      .update(userData)
      .set({
        questData: filterQuestTrackersForDbPersist(trackers, user),
      })
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
    const logEntry = await upsertQuestEntry(client, user, nextQuest, "system");
    return { ...logEntry, quest: nextQuest };
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

type UserQuestFromGetReward = ReturnType<typeof getReward>["userQuest"];

/** Used by checkRewards when claimUserSnapshot fails after questHistory was marked completed. */
const revertQuestCompletionAfterFailedClaim = async (
  client: DrizzleClient,
  userId: string,
  questId: string,
  completedEndAt: Date,
  wrotePeriodCounter: boolean,
) => {
  await client
    .update(questHistory)
    .set({
      completed: 0,
      previousCompletes: sql`GREATEST(${questHistory.previousCompletes} - 1, 0)`,
      // Only roll back the period counter when the completion CAS actually incremented it (it
      // writes periodCompletes only for retryDelay !== "none"). Decrementing it otherwise would
      // corrupt a stale non-zero counter the failed completion never touched.
      ...(wrotePeriodCounter
        ? { periodCompletes: sql`GREATEST(${questHistory.periodCompletes} - 1, 0)` }
        : {}),
      endAt: null,
    })
    .where(
      and(
        eq(questHistory.questId, questId),
        eq(questHistory.userId, userId),
        eq(questHistory.completed, 1),
        eq(questHistory.endAt, completedEndAt),
      ),
    );
};

/** Tier quest bootstrap plus achievement log; tasks are independent and run together. */
const runCheckRewardsPrepInParallel = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  resolved: boolean,
  userQuest: UserQuestFromGetReward,
) => {
  const prepTasks: Promise<unknown>[] = [];
  const questTier = user.userQuests?.find((q) => q.quest.questType === "tier");
  if (!questTier) {
    prepTasks.push(insertNextQuest(client, user, "tier"));
  }
  if (resolved && userQuest?.quest.questType === "achievement") {
    if (!userQuest.quest.hidden || canPlayHiddenQuests(user.role)) {
      if (userQuest.quest.maxCompletes > 1) {
        prepTasks.push(upsertQuestEntry(client, user, userQuest.quest, "system"));
      }
    }
  }
  if (prepTasks.length > 0) {
    await Promise.all(prepTasks);
  }
};

type GetRewardTrackers = ReturnType<typeof getReward>["trackers"];

/**
 * Outcome of {@link commitQuestObjectiveRewards}. Side-effecting work (completion CAS,
 * snapshot claim, payout, sensei bonus, tier/achievement prep) lives in the helper; each
 * caller renders its own tRPC response from this discriminated result so the helper stays
 * a single source of truth for post-completion effects.
 */
type CommitQuestObjectiveRewardsResult =
  | {
      outcome: "claimed";
      /** Notifications produced by handleQuestConsequences (caller prepends its own prefix). */
      postNotifications: string[];
      /** Same GetRewardResult passed in, mutated with resolved reward names for display. */
      rewards: GetRewardResult;
      badges: { id: string; name: string; image: string }[];
    }
  /** Resolved completion lost the CAS and the row is already completed (idempotent re-claim). */
  | { outcome: "already_completed" }
  /** Resolved completion lost the CAS and no quest history row exists. */
  | { outcome: "not_found" }
  /** Completion CAS or snapshot claim failed; caller should ask the user to retry. */
  | { outcome: "state_changed" };

/**
 * Shared post-`getReward` reward-claim sequence used by both `checkRewards` and the
 * overworld friendly objective-target path. Encapsulates, in order:
 *   1. The completion compare-and-swap (when `resolved`): insert a `completed=0` history row
 *      if none exists, then atomically flip it to `completed=1` so a parallel claim cannot
 *      double-pay the quest-level reward.
 *   2. `handleQuestConsequences` with `alwaysClaimUserState`, reverting the completion if the
 *      snapshot claim is lost.
 *   3. Restoring the full trackers, the sensei +ryo mission bonus, the tier-bootstrap /
 *      repeatable-achievement re-arm prep, and `updateRewards` (run together).
 * Returns a discriminated outcome; the raw bytes of the reward names are mapped onto
 * `rewards` so callers can render them directly.
 */
export const commitQuestObjectiveRewards = async (info: {
  client: DrizzleClient;
  userId: string;
  user: NonNullable<UserWithRelations>;
  rewards: GetRewardResult;
  trackers: GetRewardTrackers;
  userQuest: UserQuestFromGetReward;
  resolved: boolean;
  notifications: string[];
  consequences: QuestConsequence[];
  /** Pre-fetched questHistory row for this quest, if the caller already loaded it. */
  existingHistory?: { completed: number } | null;
  /**
   * Extra userData columns for updateRewards to fold into its single UPDATE on the claim path.
   * Only applied when this commit actually reaches the reward payout (i.e. the completion CAS
   * won / a non-resolved advance was claimed), never on already_completed / not_found / state
   * changed, which return before updateRewards. Gate on `resolved` at the callsite if the patch
   * should only land on terminal completions.
   */
  postClaimUserDataPatch?: Record<string, unknown>;
}): Promise<CommitQuestObjectiveRewardsResult> => {
  const {
    client,
    userId,
    user,
    rewards,
    trackers,
    userQuest,
    resolved,
    notifications,
    consequences,
  } = info;

  user.questData = filterQuestTrackersForDbPersist(trackers, user);

  // Persist completion before snapshot CAS so we cannot commit questData/updatedAt and then
  // lose the completion race; if snapshot claim fails, revert completion below.
  let resolvedCompletionCommitted = false;
  // The exact endAt stamped by the completion CAS, reused to anchor the revert below.
  let completedEndAt: Date | null = null;
  // Whether the completion CAS wrote the period counter (only for retryDelay !== "none"); the
  // revert must mirror this so it doesn't roll back a counter that was never incremented.
  let periodCounterWritten = false;
  if (resolved) {
    // Achievements (and any quest shown only via mock rows) may have progress in questData
    // without a QuestHistory row yet — create one at claim time only.
    if (userQuest) {
      const existing =
        info.existingHistory !== undefined
          ? info.existingHistory
          : await fetchUserQuestByQuestId(client, userId, userQuest.questId);
      if (!existing) {
        // Must finish before the completion UPDATE below: that CAS requires an existing row with
        // completed=0. Running insert and update in parallel can let the UPDATE run first and
        // match zero rows.
        await client
          .insert(questHistory)
          .values({
            id: nanoid(),
            userId,
            questId: userQuest.questId,
            questType: userQuest.quest.questType,
            startedAt: new Date(),
            endAt: null,
            completed: 0,
            previousCompletes: 0,
            previousAttempts: 0,
          })
          .onDuplicateKeyUpdate({ set: { id: sql`id` } });
      }
    }

    const retryDelay = userQuest?.quest?.retryDelay ?? "none";
    completedEndAt = new Date();
    const cps =
      retryDelay === "none" ? undefined : periodStart(retryDelay, completedEndAt);
    periodCounterWritten = !!cps;

    const questCompletionResult = await client
      .update(questHistory)
      .set({
        completed: 1,
        previousCompletes: sql`${questHistory.previousCompletes} + 1`,
        endAt: completedEndAt,
        // Reset the period counter when this completion opens a new period, else increment.
        ...(cps
          ? {
              periodCompletes: sql`CASE WHEN ${questHistory.periodStartAt} IS NULL OR ${questHistory.periodStartAt} < ${cps} THEN 1 ELSE ${questHistory.periodCompletes} + 1 END`,
              periodStartAt: sql`CASE WHEN ${questHistory.periodStartAt} IS NULL OR ${questHistory.periodStartAt} < ${cps} THEN ${cps} ELSE ${questHistory.periodStartAt} END`,
            }
          : {}),
      })
      .where(
        and(
          eq(questHistory.questId, userQuest?.questId ?? ""),
          eq(questHistory.userId, userId),
          eq(questHistory.completed, 0),
        ),
      );

    if (questCompletionResult.rowsAffected === 0) {
      const historyRow = await fetchUserQuestByQuestId(
        client,
        userId,
        userQuest?.questId ?? "",
      );
      if (historyRow && historyRow.completed >= 1) {
        return { outcome: "already_completed" };
      }
      if (!historyRow) {
        return { outcome: "not_found" };
      }
      return { outcome: "state_changed" };
    }
    resolvedCompletionCommitted = true;
  }

  const { notifications: postNotifications, claimed } = await handleQuestConsequences(
    client,
    user,
    consequences,
    notifications,
    { alwaysClaimUserState: true },
  );

  if (!claimed) {
    if (resolvedCompletionCommitted && userQuest && completedEndAt) {
      await revertQuestCompletionAfterFailedClaim(
        client,
        userId,
        userQuest.questId,
        completedEndAt,
        periodCounterWritten,
      );
    }
    return { outcome: "state_changed" };
  }

  // Sensei rewards
  const hasSensei = user.senseiId && user.rank === "GENIN";
  const isMission = userQuest?.quest.questType === "mission";
  const senseiId = hasSensei && isMission ? user.senseiId : null;

  await runCheckRewardsPrepInParallel(client, user, resolved, userQuest);

  // If the quest is finished, we update additional fields on the userData model
  const questCounterField =
    (resolved &&
      getQuestCounterFieldName(
        userQuest?.quest.questType,
        userQuest?.quest.questRank,
      )) ||
    undefined;

  // On terminal completion, atomically free the single "active NPC mission" slot when it still
  // points to THIS quest, folded into updateRewards' own userData UPDATE (no extra round-trip).
  // Centralized here so every completion path closes the stale-slot window at the true point the
  // quest finalizes: `checkRewards` (which finalizes overworld `defeat_opponents` quests won in
  // combat — combat only advances the tracker, never the completion) as well as the overworld
  // friendly objective path. The IF preserves questId-scoping, so completing a non-NPC quest — or
  // a concurrent interaction at a different NPC — never clears a slot it does not own. Without
  // this, a `defeat_opponents` slot stayed stale until a later interaction self-healed it, which
  // a value-only self-heal could race into an ABA double-grant of a repeatable quest.
  const slotClearPatch =
    resolved && userQuest
      ? {
          activeNpcQuestId: sql`IF(${userData.activeNpcQuestId} = ${userQuest.questId}, NULL, ${userData.activeNpcQuestId})`,
        }
      : undefined;
  const mergedUserDataPatch =
    slotClearPatch || info.postClaimUserDataPatch
      ? { ...slotClearPatch, ...info.postClaimUserDataPatch }
      : undefined;

  // Update database
  const [{ items, jutsus, bloodlines, badges, sageModes }] = await Promise.all([
    // Update rewards
    updateRewards({
      client,
      user,
      rewards,
      questCounterField,
      reason: "QUEST",
      // Opt in to the herbs_gathered tracker: this is the gathering-claim path and `user`
      // here is the fully-hydrated row (with quest relations).
      questUser: user,
      postClaimUserDataPatch: mergedUserDataPatch,
    }),
    // Credit the sensei their per-mission ryo bonus
    ...(senseiId
      ? [
          client
            .update(userData)
            .set({
              money: sql`${userData.money} + ${SENSEI_STUDENT_RYO_PER_MISSION}`,
            })
            .where(eq(userData.userId, senseiId)),
          client.insert(bankTransfers).values({
            senderId: userId,
            receiverId: senseiId,
            amount: SENSEI_STUDENT_RYO_PER_MISSION,
            type: "sensei",
          }),
        ]
      : []),
  ]);

  // Restore the full (response) trackers only AFTER the DB write: updateRewards persists
  // user.questData, so during it user.questData must hold the filtered set, not the
  // in-memory-only mock achievement trackers that filterQuestTrackersForDbPersist strips.
  user.questData = trackers;

  // Update rewards for readability
  rewards.reward_items = items.map((i) => i.name);
  rewards.reward_jutsus = jutsus.map((i) => i.name);
  rewards.reward_bloodlines = bloodlines.map((i) => i.name);
  rewards.reward_sage_modes = sageModes.map((i) => i.name);
  rewards.reward_badges = badges.map((i) => i.name);

  return {
    outcome: "claimed",
    postNotifications,
    rewards,
    badges,
  };
};

/** DB writes after claimUserSnapshot succeeds inside handleQuestConsequences. */
const executeClaimedQuestConsequences = async ({
  client,
  user,
  claimedAt,
  notifications,
  startedQuestIds,
  endedQuestIds,
  collected,
  removedUserItemIds,
  opponent,
}: {
  client: DrizzleClient;
  user: NonNullable<UserWithRelations>;
  claimedAt: Date;
  notifications: string[];
  startedQuestIds: string[];
  endedQuestIds: string[];
  collected: QuestConsequence[];
  removedUserItemIds: string[];
  opponent: QuestConsequence | undefined;
}) => {
  user.updatedAt = claimedAt;
  const collectedItems = collected.flatMap(({ ids }) => ids);
  await Promise.all([
    ...(startedQuestIds.length > 0
      ? [
          (async () => {
            const quests = await client.query.quest.findMany({
              where: inArray(quest.id, startedQuestIds),
            });
            // Runs after the user snapshot is already committed, so a throw here would burn the
            // objective without starting the quest. An NPC-only target can only appear via a
            // content edit that stranded the edge, so skip it instead of failing the request.
            const startable = quests.filter((q) => !isNpcOnlyQuestType(q.questType));
            if (startable.length > 0) {
              notifications.push(
                `Started new quest: ${startable.map((q) => q.name).join(", ")}`,
              );
            }
            await Promise.all(
              startable.map((quest) =>
                upsertQuestEntry(client, user, quest, "quest_objective"),
              ),
            );
          })(),
        ]
      : []),
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
    ...(removedUserItemIds.length > 0
      ? [
          // The quantity guard refuses rows held by a stack-merge claim (negative quantity), so
          // this delete can never break an in-flight merge publish and duplicate the stack.
          client
            .delete(userItem)
            .where(
              and(inArray(userItem.id, removedUserItemIds), gt(userItem.quantity, 0)),
            ),
        ]
      : []),
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
                scaleTarget: !!opponent.scaleStats,
                biome: "default",
                forceKeepPools: opponent.forceKeepPools ?? false,
                // Honour the player's stored preference here too. Without it the
                // tutorial teaches auto combat in the arena and then hands the
                // player a manual quest fight, which reads as the setting having
                // stopped working. initiateBattle still gates on
                // AutoCombatBattleTypes, so a random encounter stays manual.
                autoCombatUserIds: user.defaultAutoCombat ? [user.userId] : undefined,
              },
              opponent.type === "random_encounter" ? "RANDOM_ENCOUNTER" : "QUEST",
              opponent.scaleGains ?? 1,
            );
          })()
        : Promise.resolve(),
    ],
  ]);
};

/**
 * Handles the consequences of a quest (items, battles, quest resets, etc.).
 *
 * With `alwaysClaimUserState` (used by `checkRewards`), always runs `claimUserSnapshot` so parallel
 * submissions serialize on `userData.updatedAt` before reward payout.
 */
export const handleQuestConsequences = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  consequences: QuestConsequence[],
  notifications: string[],
  options?: {
    alwaysClaimUserState?: boolean;
  },
) => {
  // Quests reset
  const resetQuests = consequences.filter(
    (c) => c.type === "reset_quest" && c.ids.length > 0,
  );
  // Quests ended
  const endedQuestIds = consequences
    .filter((c) => c.type === "fail_quest")
    .flatMap((c) => c.ids);
  // Quests started
  const startedQuestIds = consequences
    .filter((c) => c.type === "start_quest")
    .flatMap((c) => c.ids);
  // Items collected
  const collected = consequences.filter((c) => c.type === "add_item");
  // Items removed
  const removed = consequences.filter((c) => c.type === "remove_item");
  const removedUserItemIds = removed
    .flatMap((c) => c.ids)
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
          .flatMap((ai) => ai.ids);
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
  if (resetQuests.length > 0) {
    resetQuests.forEach((resetQuest) => {
      if (!user.questData) return;
      // If no text, which contains the objective id, then reset the entire quest
      if (!resetQuest.info) {
        user.questData = user.questData.filter((t) => !resetQuest.ids.includes(t.id));
      } else {
        const questId = resetQuest.ids[0]; // We only reset one quest at a time ever
        const quest = user.questData?.find((t) => t.id === questId);
        if (quest) {
          const objectiveIdsToRemove = [resetQuest.info];
          let goal = quest.goals.find((g) => g.id === resetQuest.info);
          while (goal?.selectedNextObjectiveId) {
            objectiveIdsToRemove.push(goal.selectedNextObjectiveId);
            goal = quest.goals.find((g) => g.id === goal?.selectedNextObjectiveId);
          }
          quest.goals = quest.goals.filter((g) => !objectiveIdsToRemove.includes(g.id));
        }
      }
    });
  }
  // Database updates
  const shouldClaimUserState =
    options?.alwaysClaimUserState ||
    notifications.length > 0 ||
    consequences.length > 0;

  if (shouldClaimUserState) {
    const claimResult = await claimUserSnapshot({
      client,
      userId: user.userId,
      updatedAt: user.updatedAt,
      set: {
        questData: filterQuestTrackersForDbPersist(user.questData ?? [], user),
      },
    });

    if (claimResult.success) {
      await executeClaimedQuestConsequences({
        client,
        user,
        claimedAt: claimResult.claimedAt,
        notifications,
        startedQuestIds,
        endedQuestIds,
        collected,
        removedUserItemIds,
        opponent,
      });

      return { notifications, claimed: true };
    }
  }
  return { notifications, claimed: !shouldClaimUserState };
};

/**
 * Returns the DB state of every overworld placement referenced by the user's active objectives.
 * Each map value is `true` for an active placement and `false` for a deactivated placement; a
 * referenced id absent from the map was deleted. Callers pass the map to `getNewTrackers`.
 * Cheap-path: if no active objectives carry a bound placement id the DB is not
 * queried and an empty map is returned.
 */
export const fetchBoundPlacementStatus = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
): Promise<Map<string, boolean>> => {
  // Collect distinct placement ids referenced by the user's active objectives.
  const boundIds = new Set<string>();
  for (const q of getUserQuests(user)) {
    for (const obj of q.content.objectives) {
      if (obj.overworldPlacementId && isSupportedOverworldBindingTask(obj.task)) {
        boundIds.add(obj.overworldPlacementId);
      }
    }
  }

  // Cheap-path: no bound objectives → nothing to verify.
  if (boundIds.size === 0) return new Map();

  // One query with NO isActive filter so we can distinguish deleted vs deactivated.
  const rows = await client.query.overworldAiPlacement.findMany({
    where: inArray(overworldAiPlacement.id, [...boundIds]),
    columns: { id: true, isActive: true },
  });

  return new Map(rows.map((row) => [row.id, row.isActive]));
};

/**
 * Resolve and validate all overworld bindings in one place for both update and clone. Defeat
 * objectives derive their opponent AI from the placement; friendly interactions must bind to a
 * FRIENDLY placement. Save-shape validation has already rejected unsupported task bindings.
 */
const prepareOverworldBindings = async (
  client: DrizzleClient,
  objectives: AllObjectivesType[],
): Promise<
  | { success: true; objectives: AllObjectivesType[] }
  | { success: false; message: string }
> => {
  const placementIds = [
    ...new Set(
      objectives
        .map((objective) => objective.overworldPlacementId)
        .filter((id): id is string => !!id),
    ),
  ];
  if (placementIds.length === 0) return { success: true, objectives };

  const placements = await client.query.overworldAiPlacement.findMany({
    columns: { id: true, aiTemplateUserId: true, interactionType: true },
    where: inArray(overworldAiPlacement.id, placementIds),
  });
  const { objectives: derived, missing } = deriveOverworldOpponents(
    objectives,
    new Map(placements.map((placement) => [placement.id, placement.aiTemplateUserId])),
  );
  if (missing.length > 0) {
    return {
      success: false,
      message: `Bound overworld placement not found: ${missing.join(", ")}`,
    };
  }
  const friendlyCheck = validateFriendlyPlacementBindings(
    derived,
    new Map(placements.map((placement) => [placement.id, placement])),
  );
  return friendlyCheck.check
    ? { success: true, objectives: derived }
    : { success: false, message: friendlyCheck.message };
};
