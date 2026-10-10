import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { QuestType, UserRole } from "@/drizzle/constants";
import {
  ENERGY_QUEST_REWARDS,
  FARM_ACTIVITY_REWARD_TIME_REDUCTION_SECONDS,
  IMG_AVATAR_DEFAULT,
  LetterRanks,
  MAX_SKILL_POINTS,
  MasteryNames,
  MEDNIN_EXP_CAP,
  NPC_ONLY_QUEST_TYPES,
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
import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import { getFarmingLevel, qualifiesForFarmActivityReward } from "@/libs/farming";
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
  getExperienceTrackerTasks,
  getMissionHallSettings,
  getNewTrackers,
  getPublicQuestUser,
  getReward,
  getUncheckedQuestTargetSectors,
  getUserQuests,
  isAvailableUserQuests,
  isQuestRankAllowed,
  isWarMissionAvailable,
  postProcessRewards,
  questAlreadyActiveBlockMessage,
  questDailyQuota,
  questTypeConcurrentBlockMessage,
  questUiAccessBlockMessage,
  rollObjectiveAttackers,
  verifyQuestContentForSave,
} from "@/libs/quest";
import { hasEnergyQueue } from "@/libs/queue";
import {
  getUnavailableRewardCards,
  REWARD_CHOICE_AMOUNT_LABELS,
  REWARD_CHOICE_PENDING_MESSAGE,
  REWARD_CHOICE_READY_MESSAGE,
  type RewardChoiceOwnership,
  rewardFromChoiceCards,
  validateRewardPicks,
  verifyRewardChoiceForSave,
} from "@/libs/rewardChoice";
import { getSageMasteryDisplayRank, sageRanksAtOrBelow } from "@/libs/sageMode";
import { callDiscordContent } from "@/libs/socials";
import { availableQuestLetterRanks, availableRanks } from "@/libs/train";
import { initiateBattle } from "@/routers/combat";
import { fetchUserItems } from "@/routers/item";
import type { UserWithRelations } from "@/routers/profile";
import {
  fetchPublishedAchievements,
  fetchUpdatedUser,
  fetchUser,
  getUserProgressionUpdate,
} from "@/routers/profile";
import { deleteRequests } from "@/routers/sensei";
import { fetchSectorVillage } from "@/routers/village";
import { fetchActiveWars } from "@/routers/war";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { setEmptyStringsToNulls } from "@/server/utils/emptyStrings";
import { reduceActiveFarmPlotTimers } from "@/server/utils/farming";
import {
  masteryGainUpdates,
  masteryRankUpdate,
} from "@/server/utils/masteryProgression";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { hydrateQuestCollections } from "@/server/utils/questCollections";
import { fetchQuestDiscoveryCandidates } from "@/server/utils/questDiscovery";
import { awardRecruitRankMilestonesSafely } from "@/server/utils/recruitment";
import { extendWarParticipantSql } from "@/server/utils/war";
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
import { canAccessStructure } from "@/utils/village";
import { idSchema } from "@/validators/misc";
import type { AllObjectivesType, QuestTrackerType } from "@/validators/objectives";
import { QuestTracker, QuestValidator } from "@/validators/objectives";
import { questFilteringSchema } from "@/validators/quest";
import {
  ClaimRewardChoiceSchema,
  MASTERY_EXPERIENCE_FIELDS,
  type PendingRewardChoice,
  PendingRewardChoiceSchema,
  PostProcessedRewardSchema,
  type RewardChoiceAmountField,
  type RewardChoiceCard,
  type RewardChoiceDisplay,
  RewardChoiceDisplaySchema,
} from "@/validators/rewards";
import type { QuestCounterFieldName } from "@/validators/user";
import { getQuestCounterFieldName } from "@/validators/user";
import type { UserDelta } from "@/validators/userCache";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const questsRouter = createTRPCRouter({
  getAllNames: publicProcedure
    .meta({ mcp: { description: "Get all quest names and IDs" } })
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
      mcp: { description: "Get paginated list of quests with filters" },
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
  getAchievementCatalogue: protectedProcedure
    .meta({
      mcp: { description: "Get the static achievement definitions" },
    })
    .query(async ({ ctx }) => {
      // Achievement definitions are the same for every player and change only when staff edit
      // content, so `profile.getUser` sends progress alone and the client holds these instead of
      // re-downloading them on every page load.
      return await fetchPublishedAchievements(ctx.drizzle);
    }),
  get: publicProcedure
    .meta({ mcp: { description: "Get a single quest by ID" } })
    .input(idSchema)
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
        fetchQuestDiscoveryCandidates(ctx.drizzle, ctx.userId, {
          questTypes: ["event"],
          villageId: input.villageId ?? undefined,
          level: input.level ?? 0,
          ranks: input.rank,
        }),
      ]);
      if (!user) return [];
      events.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      return events.filter((e) => isAvailableUserQuests(e, user, true).check);
    }),
  missionHall: protectedProcedure
    .meta({
      mcp: { description: "Get available missions from mission hall" },
    })
    .input(z.object({ villageId: z.string(), level: z.number() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [{ user }, missions, activeWars] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchQuestDiscoveryCandidates(ctx.drizzle, ctx.userId, {
          questTypes: ["mission", "errand", "crime", "medical", "pvp", "war"],
          villageId: input.villageId,
          level: input.level,
        }),
        fetchActiveWars(ctx.drizzle, input.villageId),
      ]);
      if (!user) return [];
      const villageInWar = isWarMissionAvailable({
        questType: "war",
        villageId: user.villageId,
        dailyWarMissions: user.dailyWarMissions,
        activeWars,
      });
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
      mcp: { description: "Get quests filtered by type and level" },
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
        fetchQuestDiscoveryCandidates(ctx.drizzle, ctx.userId, {
          questTypes: [input.questType],
          level: input.level,
        }),
      ]);
      if (!user) return [];
      quests.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      return quests.filter((e) => isAvailableUserQuests(e, user, true).check);
    }),
  startRandom: protectedProcedure
    .meta({ mcp: { description: "Start a random mission or errand" } })
    .input(
      z.object({
        type: z.enum(["errand", "mission", "crime", "medical", "pvp"]),
        rank: z.enum(LetterRanks),
        userLevel: z.number(),
        userSector: z.number(),
        userVillageId: z.string().nullish(),
      }),
    )
    .output(userDeltaResponseSchema)
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
            historyPendingRewardChoice: questHistory.pendingRewardChoice,
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
              lte(quest.requiredFarmingLevel, getFarmingLevel(user.farmingExperience)),
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

      const quota = questDailyQuota(input.type, user);
      if ((isErrand || isMedical || isPvp) && quota && quota.current >= quota.limit) {
        const label = isErrand
          ? "errand"
          : isMedical
            ? "medical mission"
            : "PvP mission";
        return errorResponse(
          `You have reached your daily ${label} limit of ${quota.limit}. Please try again tomorrow.`,
        );
      }

      // Check if user is allowed to perform this rank
      if (
        !isQuestRankAllowed(
          { questType: input.type, questRank: input.rank },
          user,
          "random_assignment",
        )
      ) {
        return errorResponse(`Rank ${input.rank} not allowed`);
      }

      // Confirm user does not have any current active missions/crimes/errands/medical/pvp
      const concurrentBlock = questTypeConcurrentBlockMessage(
        { questType: input.type, name: "Assignment" },
        user,
      );
      if (concurrentBlock) return errorResponse(concurrentBlock);
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
              pendingRewardChoice: result.historyPendingRewardChoice,
            }
          : null;

      // Insert quest entry
      const [assignment] = await Promise.all([
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
      const dailyCounter = isErrand
        ? "dailyErrands"
        : isMedical
          ? "dailyMedicalMissions"
          : isPvp
            ? "dailyPvpMissions"
            : "dailyMissions";
      user[dailyCounter] += 1;
      return {
        success: true,
        message: `Quest started: ${result.name}${rankInfo}`,
        ...(assignment.userCacheEligible &&
        !updatedUser.requiresProgressionRefresh &&
        getUncheckedQuestTargetSectors(user, user.questData ?? []).length === 0
          ? getUserProgressionUpdate(user, updatedUser.publishedAchievementIds)
          : {}),
      };
    }),
  startQuest: protectedProcedure
    .meta({ mcp: { description: "Start a specific quest by ID" } })
    .input(z.object({ questId: z.string(), userSector: z.number() }))
    .output(userDeltaResponseSchema)
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

      const { userCacheEligible, ...result } = await assignQuestToUser({
        client: ctx.drizzle,
        user,
        quest: questData,
        source: "ui",
        sectorVillage,
        prevAttempt,
      });
      return {
        ...result,
        ...(result.success &&
        userCacheEligible === true &&
        !updatedUser.requiresProgressionRefresh &&
        questData.questType !== "war" &&
        getUncheckedQuestTargetSectors(user, user.questData ?? []).length === 0
          ? getUserProgressionUpdate(user, updatedUser.publishedAchievementIds)
          : {}),
      };
    }),
  abandon: protectedProcedure
    .meta({ mcp: { description: "Abandon an active quest" } })
    .input(idSchema)
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
          "mastery",
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
    .meta({ mcp: { description: "Get user's quest history" } })
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
      mcp: { description: "Update quest content (content editors)" },
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
        const rewardChoiceCheck = verifyRewardChoiceForSave(input.data.content);
        if (!rewardChoiceCheck.check) {
          return errorResponse(rewardChoiceCheck.message);
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
        await outdateProposalsFor(
          ctx.drizzle,
          "QUEST",
          [entry.id],
          editedReason("QUEST", entry.name, user.username),
        );
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
      mcp: { description: "Create a new quest (content editors)" },
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
      mcp: { description: "Clone an existing quest (content editors)" },
    })
    .input(idSchema)
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
    .meta({ mcp: { description: "Delete a quest (content editors)" } })
    .input(idSchema)
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
        await outdateProposalsFor(
          ctx.drizzle,
          "QUEST",
          [entry.id],
          deletedReason("QUEST", entry.name, user.username),
        );
        return { success: true, message: `Quest deleted` };
      } else {
        return { success: false, message: `Not allowed to delete quest` };
      }
    }),
  checkRewards: protectedProcedure
    .meta({ mcp: { description: "Check and claim quest rewards" } })
    .input(z.object({ questId: z.string(), nextObjectiveId: z.string().optional() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Resolved path: questHistory CAS → snapshot claim → updateRewards (SQL deltas on userdata).
      const [
        {
          user,
          toastMessages,
          settings,
          requiresProgressionRefresh,
          publishedAchievementIds,
          progressionQuestCandidates,
        },
        questHistoryPrefetch,
      ] = await Promise.all([
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
      const {
        rewards,
        trackers,
        userQuest,
        resolved,
        notifications,
        consequences,
        rewardChoice,
      } = getReward(user, input.questId, input.nextObjectiveId, settings);

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
        rewardChoice,
      });

      if (claim.outcome === "already_completed") {
        const claimedQuest = user.userQuests.find((q) => q.questId === input.questId);
        return {
          success: true,
          message: "Quest already completed",
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
          rewardChoicePending: false,
        };
      }
      if (claim.outcome === "not_found") {
        return errorResponse("Quest not found or not active");
      }
      if (claim.outcome === "state_changed") {
        return errorResponse("Quest state changed, please try again");
      }
      if (claim.outcome === "choice_pending") {
        return {
          ...errorResponse(REWARD_CHOICE_PENDING_MESSAGE),
          rewardChoicePending: true,
        };
      }

      // Handle immidiate consequences first
      const finalNotifications = [...toastMessages, ...claim.postNotifications];
      if (claim.rewardChoicePending) {
        finalNotifications.push(REWARD_CHOICE_READY_MESSAGE);
      }

      const refreshedTrackers = getNewTrackers(user, [{ task: "any" }]);
      user.questData = refreshedTrackers.trackers;
      // XP is already included in the accepted progression snapshot.
      const { earnedExperience: _earnedExperience, ...balanceDelta } =
        claim.userDelta ?? {};
      const projectedQuestIds = new Set(user.userQuests.map((entry) => entry.questId));
      const cacheUpdate =
        !requiresProgressionRefresh &&
        claim.userCacheEligible &&
        // Newly eligible achievements need getUser to hydrate their trackers.
        !progressionQuestCandidates.some(
          (entry) =>
            entry.quest.questType === "achievement" &&
            !projectedQuestIds.has(entry.questId) &&
            isAvailableUserQuests({ ...entry.quest, ...entry }, user, true).check,
        ) &&
        refreshedTrackers.consequences.length === 0 &&
        claim.userDelta !== undefined &&
        getUncheckedQuestTargetSectors(user, user.questData ?? []).length === 0
          ? getUserProgressionUpdate(user, publishedAchievementIds)
          : undefined;
      // Energy payouts advance the DB version in SQL; preserve the cached stamp
      // until the next authoritative read can supply its new value.
      const { updatedAt: _updatedAt, ...userPatch } = cacheUpdate?.userPatch ?? {};
      return {
        success: true,
        message: "Quest progress updated",
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
        rewardChoicePending: claim.rewardChoicePending,
        ...(cacheUpdate
          ? {
              ...cacheUpdate,
              userPatch,
              userDelta: balanceDelta,
            }
          : {}),
      };
    }),
  getPendingRewardChoices: protectedProcedure
    .meta({
      mcp: { description: "List quest reward choices waiting for the player to pick" },
    })
    .output(z.array(RewardChoiceDisplaySchema))
    .query(async ({ ctx }) => {
      const [user, rows] = await Promise.all([
        ctx.drizzle.query.userData.findFirst({
          columns: { userId: true, sageModeId: true },
          where: eq(userData.userId, ctx.userId),
        }),
        ctx.drizzle.query.questHistory.findMany({
          columns: { questId: true, pendingRewardChoice: true },
          where: and(
            eq(questHistory.userId, ctx.userId),
            isNotNull(questHistory.pendingRewardChoice),
          ),
          with: { quest: { columns: { name: true } } },
        }),
      ]);
      if (!user) return [];
      return await resolveRewardChoiceDisplays(ctx.drizzle, user, rows);
    }),
  claimRewardChoice: protectedProcedure
    .meta({ mcp: { description: "Pick and claim rewards from a quest reward choice" } })
    .input(ClaimRewardChoiceSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, history] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.questHistory.findFirst({
          columns: { id: true, pendingRewardChoice: true },
          where: and(
            eq(questHistory.userId, ctx.userId),
            eq(questHistory.questId, input.questId),
          ),
          with: { quest: { columns: { name: true } } },
        }),
      ]);
      // Guards
      if (user.isBanned) {
        return errorResponse("You are banned and cannot perform this action");
      }
      const offer = PendingRewardChoiceSchema.safeParse(history?.pendingRewardChoice);
      if (!history || !offer.success) {
        return errorResponse("No reward choice is waiting for this quest");
      }
      if (offer.data.id !== input.choiceId) {
        return errorResponse("This reward choice is no longer available");
      }
      // Refuse picks that would grant nothing (owned content, a second sage mode) while the
      // offer is still stored, so the player can choose again.
      const ownership = await fetchRewardChoiceOwnership(
        ctx.drizzle,
        user,
        offer.data.cards,
      );
      const unavailable = getUnavailableRewardCards(offer.data.cards, ownership);
      const picks = validateRewardPicks(offer.data, input.cardIds, unavailable);
      if (!picks.success) return errorResponse(picks.message);
      // Consume exactly the offer that was validated; a parallel claim or a newer offer
      // leaves zero rows affected, so the picked rewards are granted at most once.
      const consumed = await ctx.drizzle
        .update(questHistory)
        .set({ pendingRewardChoice: null })
        .where(
          and(
            eq(questHistory.id, history.id),
            eq(questHistory.userId, ctx.userId),
            sql`JSON_UNQUOTE(JSON_EXTRACT(${questHistory.pendingRewardChoice}, '$.id')) = ${offer.data.id}`,
          ),
        );
      if (consumed.rowsAffected === 0) {
        return errorResponse("This reward choice was already claimed");
      }
      const questName = history.quest?.name ?? "quest";
      const rewards = postProcessRewards(rewardFromChoiceCards(picks.cards));
      // Nothing on the offer can be granted any more: clearing it unblocks the next completion.
      if (picks.cards.length === 0) {
        return {
          success: true,
          message: `You already have every reward offered by ${questName}`,
          rewards,
          badges: [],
          userDelta: hasEnergyQueue(user) ? undefined : {},
        };
      }
      // Picked profession experience advances other quests' objectives, as at completion.
      const trackersSaved = await advanceRewardChoiceTrackers(
        ctx.drizzle,
        ctx.userId,
        rewards,
      );
      if (!trackersSaved) {
        // Hand the offer back (unless something newer took its place) so a retry can claim it.
        await ctx.drizzle
          .update(questHistory)
          .set({ pendingRewardChoice: offer.data })
          .where(
            and(
              eq(questHistory.id, history.id),
              eq(questHistory.userId, ctx.userId),
              isNull(questHistory.pendingRewardChoice),
            ),
          );
        return errorResponse("Your character changed while claiming, please try again");
      }
      // Mutations. Scalars are SQL increments and a pick never carries rank or village, so the
      // payout leaves questData to the snapshot claim above instead of writing back this read.
      const { items, jutsus, bloodlines, badges, sageModes } = await updateRewards({
        client: ctx.drizzle,
        user,
        rewards,
        reason: "QUEST",
        persistQuestData: false,
      });
      rewards.reward_items = items.map((i) => i.name);
      rewards.reward_jutsus = jutsus.map((i) => i.name);
      rewards.reward_bloodlines = bloodlines.map((i) => i.name);
      rewards.reward_sage_modes = sageModes.map((i) => i.name);
      rewards.reward_badges = badges.map((i) => i.name);
      return {
        success: true,
        message: `Claimed rewards from ${questName}`,
        rewards,
        badges,
        userDelta: hasEnergyQueue(user) ? undefined : getRewardUserDelta(rewards),
      };
    }),
  checkLocationQuest: protectedProcedure
    .meta({
      mcp: {
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
        { rollObjectiveAttackers: true },
      );

      user.questData = fullTrackers;
      const responseUser = getPublicQuestUser(user);

      // Return information
      return {
        success: true,
        notifications: finalNotification,
        questData: responseUser.questData ?? [],
        questIdsUpdated,
        updateAt: new Date(),
      };
    }),
  getUserQuests: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Check if user has permission to view quests
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // The profile editor enables this query only for roles that pass the same check, so a
      // caller without it is a tab still showing another account than the session it now
      // sends, or a direct call. Return no quests, as reports.get does for a report the
      // caller cannot read: nothing is disclosed, and the staff-only panel renders empty
      // rather than erroring.
      if (!canEditQuests(user.role)) return [];
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
    .meta({ mcp: { description: "Retry a quest battle after failure" } })
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
/** Drop one quest's tracker so a restarted/reassigned quest always starts fresh. */
const removeQuestTrackerByQuestId = (
  trackers: QuestTrackerType[] | null | undefined,
  questId: string,
) => (trackers ?? []).filter((tracker) => tracker.id !== questId);

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
  questFinishedAt?: Date;
  // Fully-hydrated user (with quest relations) passed ONLY by callers that want gathering drops
  // to advance the herbs_gathered tracker. Explicit opt-in — the herbs branch below no longer
  // sniffs `"userQuests" in user`, so a future caller cannot silently start incrementing it.
  questUser?: NonNullable<UserWithRelations>;
  // Extra userData columns folded into the single UPDATE below, so a caller that must also patch
  // this user's row on the reward-claim path (e.g. release an NPC-mission slot) does it in the
  // same round-trip instead of a trailing sequential write. Values may be raw scalars or `sql`
  // expressions and win over the reward keys on any name clash.
  postClaimUserDataPatch?: Record<string, unknown>;
  // Quest this payout terminally completes, if any. The herbs fold below recomputes trackers
  // from `questUser`, whose in-memory history row still reads active (the completion CAS only
  // touched the DB), so without this it would rebuild a tracker the caller just dropped.
  dropTrackerForQuestId?: string;
  // Write `user.questData` back (default). A caller that did not claim the user snapshot passes
  // false so its possibly stale read cannot overwrite trackers another request committed.
  persistQuestData?: boolean;
}) => {
  // Destructure
  const {
    client,
    user,
    rewards,
    questCounterField,
    questFinishedAt,
    reason,
    questUser,
    postClaimUserDataPatch,
    dropTrackerForQuestId,
    persistQuestData = true,
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
    const persisted = filterQuestTrackersForDbPersist(trackers, questUser);
    user.questData = dropTrackerForQuestId
      ? removeQuestTrackerByQuestId(persisted, dropTrackerForQuestId)
      : persisted;
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

  const masteryGains = Object.fromEntries(
    MasteryNames.map((stat, index) => [
      stat,
      rewards[MASTERY_EXPERIENCE_FIELDS[index]!] ?? 0,
    ]),
  );
  const updatedUserData: Record<string, unknown> = {
    ...masteryGainUpdates(masteryGains),
    ...(rewards.reward_mastery_stat &&
    rewards.reward_mastery_stat !== "None" &&
    rewards.reward_mastery_rank &&
    rewards.reward_mastery_rank !== "NONE"
      ? {
          masteryRanks: masteryRankUpdate(
            rewards.reward_mastery_stat,
            rewards.reward_mastery_rank,
          ),
        }
      : {}),
    ...(persistQuestData ? { questData: user.questData } : {}),
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
    // Only written when granted: echoing the read values back would revert a promotion or
    // village change another request committed after this caller loaded `user`.
    ...(getNewRank ? { rank: rewards.reward_rank } : {}),
    ...(getNewVillage && villageData ? { villageId: villageData.id } : {}),
    ...(rolledSageMode
      ? { sageModeId: sql`COALESCE(${userData.sageModeId}, ${rolledSageMode.id})` }
      : {}),
  };
  if (questCounterField) {
    updatedUserData.questFinishAt = questFinishedAt ?? new Date();
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
  // A rank reward is a promotion: record the recruiter's rank milestones once it has landed.
  if (getNewRank && user.recruiterId) {
    await awardRecruitRankMilestonesSafely({
      client,
      recruitUserId: user.userId,
      recruiterId: user.recruiterId,
      rank: rewards.reward_rank,
    });
  }
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
        ...(type === "daily"
          ? []
          : [lte(quest.requiredFarmingLevel, getFarmingLevel(user.farmingExperience))]),
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

/** Ceiling on the repeated tracker-removal passes per batch; a stuck-loop guard, not a bound. */
const QUEST_RESET_MAX_TRACKER_PASSES = 50;

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
  // One pass over the selector for both branches: the LEFT JOIN already tells us who lacks a
  // QuestHistory row, so splitting the rows in JS costs one extra column instead of a second
  // round-trip that re-scans the same users.
  const candidates = await client
    .select({ userId: userData.userId, historyId: questHistory.id })
    .from(userData)
    .leftJoin(
      questHistory,
      and(eq(questHistory.userId, userData.userId), eq(questHistory.questId, quest.id)),
    )
    .where(updateSelector);
  const missingHistory = candidates.filter((row) => row.historyId === null);
  if (missingHistory.length > 0) {
    // Idempotent through the unique (userId, questId) key, so a deadlock victim can rerun.
    await retryOnDeadlock(() =>
      client
        .insert(questHistory)
        .values(
          missingHistory.map((row) => ({
            id: nanoid(),
            userId: row.userId,
            questId: quest.id,
            questType: quest.questType,
          })),
        )
        .onDuplicateKeyUpdate({
          set: { completed: 0, endAt: null, startedAt: new Date() },
        }),
    );
  }
  // Users to update for (including those we just inserted for)
  if (candidates.length > 0) {
    // One statement over every eligible user held hundreds of QuestHistory row locks
    // while ordinary quest traffic wrote the same table through its unique key, and the
    // daily reset lost the resulting lock cycle. Bounded batches run sequentially so the
    // reset never contends with itself either, and share one timestamp so a batch that
    // has to be retried still stamps what the rest of the reset did.
    const startedAt = new Date();
    // Bound as a parameter, never interpolated: `quest` here is the row argument, not the table.
    const questId = quest.id;
    // Path of this quest's tracker inside the questData array, e.g. `$[2].id`. JSON_SEARCH
    // matches with LIKE semantics, so the id must be escaped first — nanoid ids contain `_`,
    // which would otherwise match any single character and drop the wrong tracker.
    const trackerPath = sql`JSON_UNQUOTE(JSON_SEARCH(
      ${userData.questData},
      'one',
      REPLACE(REPLACE(REPLACE(${questId}, '#', '##'), '%', '#%'), '_', '#_'),
      '#',
      '$[*].id'
    ))`;
    // A user with several QuestHistory rows for this quest fans the LEFT JOIN out; dedupe so a
    // batch still covers QUEST_RESET_BATCH_SIZE distinct users.
    const batches = chunkArray(
      [...new Set(candidates.map((row) => row.userId))],
      QUEST_RESET_BATCH_SIZE,
    );
    for (const batchUserIds of batches) {
      // Drop the tracker before reopening the history row, never in parallel with it: between
      // the two the quest would be active carrying last run's fully-done tracker, which
      // getReward reads as resolved and pays out again. Removing it in SQL rather than
      // read-modify-write also preserves progress a concurrent request recorded for another
      // quest. JSON_SEARCH 'one' drops a single tracker and questData is not guaranteed to hold
      // only one per quest, so repeat until a pass changes nothing; each pass shrinks the
      // array, making the cap a guard against a wedged cron rather than a real bound.
      // Each statement runs alone and is guarded by its WHERE, so a deadlock victim (the
      // reset shares midnight with other crons writing every UserData row) simply reruns.
      let cleared = false;
      for (let pass = 0; pass < QUEST_RESET_MAX_TRACKER_PASSES; pass++) {
        const removed = await retryOnDeadlock(() =>
          client
            .update(userData)
            .set({
              questData: sql`JSON_REMOVE(
                ${userData.questData},
                TRIM(TRAILING '.id' FROM ${trackerPath})
              )`,
            })
            .where(
              and(
                inArray(userData.userId, batchUserIds),
                sql`${trackerPath} IS NOT NULL`,
              ),
            ),
        );
        if (removed.rowsAffected === 0) {
          cleared = true;
          break;
        }
      }

      // Only a pass that found nothing left proves every tracker is gone. Reopening on an
      // exhausted cap would hand this batch the state the removal exists to prevent: an active
      // quest still carrying last run's completed goals. Leave them shut instead; each pass has
      // shortened the arrays, so the next run finishes the job.
      if (!cleared) continue;

      await retryOnDeadlock(() =>
        client
          .update(questHistory)
          .set({ completed: 0, endAt: null, startedAt })
          .where(
            and(
              inArray(questHistory.userId, batchUserIds),
              eq(questHistory.questId, questId),
            ),
          ),
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
    const field = Object.keys(updateField)[0] as
      | "dailyMedicalMissions"
      | "dailyPvpMissions"
      | "dailyWarMissions"
      | "dailyMissions";
    user[field] += 1;
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
  "mastery",
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
 * Global Anbu HQ, adminbuilding) via {@link questUiAccessBlockMessage}, which
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
}): Promise<{ success: boolean; message: string; userCacheEligible?: boolean }> => {
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
  if (!isQuestRankAllowed(questData, user)) {
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
  const activeBlock = questAlreadyActiveBlockMessage(questData, user);
  if (activeBlock) return errorResponse(activeBlock);

  // UI-only structure/occupation/rank guards
  if (source === "ui") {
    const guard = questUiAccessBlockMessage(questData, user, sectorVillage ?? null);
    if (guard) return errorResponse(guard);
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
    if (
      !isWarMissionAvailable({
        questType: "war",
        villageId: user.villageId,
        dailyWarMissions: user.dailyWarMissions,
        activeWars: warList,
      })
    ) {
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
  let assignment: Awaited<ReturnType<typeof upsertQuestEntry>>;
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
    assignment = await upsertQuestEntry(
      client,
      user,
      questData,
      source,
      prevAttempt ?? null,
    );
  } else {
    [assignment] = await Promise.all([
      upsertQuestEntry(client, user, questData, source, prevAttempt ?? null),
      incrementDailyQuestCounter(client, user, questData.questType),
    ]);
  }
  return {
    success: true,
    message: `Quest started: ${questData.name}`,
    userCacheEligible: assignment.userCacheEligible,
  };
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
  // Restarting a quest must discard any stale tracker from prior attempts before recomputing.
  // An attempt that is still open is being re-entered, not restarted — a `start_quest`
  // objective consequence can name a quest the player is part way through — so keep its tracker.
  // A genuine restart always arrives with the row closed: completed, or ended by the daily reset
  // or abandon.
  const isOpenAttempt = !!entry && entry.completed === 0 && entry.endAt === null;
  if (!isOpenAttempt) {
    user.questData = removeQuestTrackerByQuestId(user.questData, quest.id);
  }
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
      pendingRewardChoice: null,
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
  user.userQuests = [
    ...user.userQuests.filter((row) => row.questId !== quest.id),
    { ...entry, quest },
  ];
  const trackerUser = await hydrateQuestCollections(client, user);
  const { trackers, consequences, notifications } = getNewTrackers(trackerUser, [
    { task: "any" },
  ]);
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
  user.questData = trackers;
  user.completedQuests = user.completedQuests.filter((row) => row.questId !== quest.id);
  // Instant objectives may become done before a later pass can recover their side effects.
  return {
    entry,
    userCacheEligible: consequences.length === 0 && notifications.length === 0,
  };
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
    return { ...logEntry.entry, quest: nextQuest };
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
  wroteRewardChoice: boolean,
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
      // The offer belongs to the reverted completion; the retry stores a fresh one.
      ...(wroteRewardChoice ? { pendingRewardChoice: null } : {}),
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
    return (await Promise.all(prepTasks)).some(Boolean);
  }
  return false;
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
      /** The completion stored a reward-choice offer the player still has to pick from. */
      rewardChoicePending: boolean;
      userDelta: UserDelta | undefined;
      userCacheEligible: boolean;
    }
  /** Resolved completion lost the CAS and the row is already completed (idempotent re-claim). */
  | { outcome: "already_completed" }
  /** Resolved completion lost the CAS and no quest history row exists. */
  | { outcome: "not_found" }
  /** Completion CAS or snapshot claim failed; caller should ask the user to retry. */
  | { outcome: "state_changed" }
  /** An earlier completion's reward choice is still unpicked, so this one cannot store its own. */
  | { outcome: "choice_pending" };

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
   * Offer of a resolved "choose" quest. It is written by the completion CAS itself, which also
   * refuses to overwrite an unpicked offer, so a completion and its offer land together.
   */
  rewardChoice?: PendingRewardChoice | null;
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
  const rewardChoice = resolved ? (info.rewardChoice ?? null) : null;
  const userDelta = getRewardUserDelta(rewards, 0, true);
  // Consequences can start battles or change inventory/quest relations outside this snapshot.
  const userCacheEligible =
    consequences.every((entry) => entry.type === "update_user") &&
    !(resolved && userQuest?.quest.questType === "achievement") &&
    !(resolved && info.existingHistory === null);

  user.questData = filterQuestTrackersForDbPersist(trackers, user);
  // Once a quest resolves, remove its tracker so replayed assignments cannot inherit done goals.
  if (resolved && userQuest) {
    user.questData = removeQuestTrackerByQuestId(user.questData, userQuest.questId);
  }

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
        ...(rewardChoice ? { pendingRewardChoice: rewardChoice } : {}),
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
          ...(rewardChoice ? [isNull(questHistory.pendingRewardChoice)] : []),
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
      if (rewardChoice && historyRow.pendingRewardChoice) {
        return { outcome: "choice_pending" };
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
        !!rewardChoice,
      );
    }
    return { outcome: "state_changed" };
  }

  // Sensei rewards
  const hasSensei = user.senseiId && user.rank === "GENIN";
  const isMission = userQuest?.quest.questType === "mission";
  const senseiId = hasSensei && isMission ? user.senseiId : null;

  const changedQuestAssignments = await runCheckRewardsPrepInParallel(
    client,
    user,
    resolved,
    userQuest,
  );

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
  const energyReward =
    resolved && userQuest ? (ENERGY_QUEST_REWARDS[userQuest.quest.questType] ?? 0) : 0;
  const energyPatch =
    energyReward > 0
      ? {
          maxEnergy: user.maxEnergy,
          curEnergy: sql`LEAST(${user.maxEnergy}, ${userData.curEnergy} + ${energyReward})`,
          // Invalidate passive-regeneration snapshots taken between the claim and payout.
          updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))`,
        }
      : undefined;
  const mergedUserDataPatch =
    slotClearPatch || energyPatch || info.postClaimUserDataPatch
      ? { ...slotClearPatch, ...energyPatch, ...info.postClaimUserDataPatch }
      : undefined;

  const farmRewardAt = new Date();
  const shouldReduceFarmTimers =
    resolved &&
    !!userQuest &&
    qualifiesForFarmActivityReward(
      userQuest.quest.questType,
      userQuest.quest.questRank,
    );
  const reduceFarmTimers = () =>
    reduceActiveFarmPlotTimers(
      client,
      userId,
      FARM_ACTIVITY_REWARD_TIME_REDUCTION_SECONDS,
      farmRewardAt,
    );

  const rewardPromise = updateRewards({
    client,
    user,
    rewards,
    questCounterField,
    questFinishedAt: farmRewardAt,
    reason: "QUEST",
    // Opt in to the herbs_gathered tracker: this is the gathering-claim path and `user`
    // here is the fully-hydrated row (with quest relations).
    questUser: user,
    postClaimUserDataPatch: mergedUserDataPatch,
    dropTrackerForQuestId: resolved ? userQuest?.questId : undefined,
  });

  // Update database. Chain the farm bonus after payout so a failed reward write cannot still
  // shorten crop timers and the established completion/snapshot/payout ordering is preserved.
  const [rewardResult, farmRewardResult] = await Promise.all([
    rewardPromise,
    shouldReduceFarmTimers
      ? rewardPromise.then(reduceFarmTimers)
      : Promise.resolve(null),
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
  const { items, jutsus, bloodlines, badges, sageModes } = rewardResult;
  if (userDelta) {
    user.money += userDelta.money ?? 0;
    user.seichiSilver += userDelta.seichiSilver ?? 0;
    user.earnedExperience += userDelta.earnedExperience ?? 0;
    user.reputationPoints += userDelta.reputationPoints ?? 0;
    user.reputationPointsTotal += rewards.reward_reputation;
    user.villagePrestige += rewards.reward_prestige;
  }
  if (resolved && userQuest && completedEndAt) {
    const entry = user.userQuests.find((entry) => entry.questId === userQuest.questId);
    if (entry) {
      entry.completed = 1;
      entry.endAt = completedEndAt;
      entry.previousCompletes = (entry.previousCompletes ?? 0) + 1;
      entry.pendingRewardChoice = rewardChoice;
      const retryDelay = userQuest.quest.retryDelay ?? "none";
      if (retryDelay !== "none") {
        const start = periodStart(retryDelay, completedEndAt);
        entry.periodCompletes =
          !entry.periodStartAt || entry.periodStartAt < start
            ? 1
            : (entry.periodCompletes ?? 0) + 1;
        entry.periodStartAt = start;
      }
    }
    user.completedQuests = [
      ...user.completedQuests.filter((entry) => entry.questId !== userQuest.questId),
      { id: entry?.id ?? userQuest.id, questId: userQuest.questId, completed: 1 },
    ];
    if (user.activeNpcQuestId === userQuest.questId) user.activeNpcQuestId = null;
  }
  // getUser's relation query keeps active attempts and achievement history only.
  // A repeatable finished mission must leave this projection before recomputing trackers.
  user.userQuests = user.userQuests.filter(
    (entry) =>
      entry.quest.questType === "achievement" ||
      (entry.completed === 0 && entry.endAt === null),
  );
  if (questCounterField) user[questCounterField] += 1;
  if (questCounterField) user.questFinishAt = farmRewardAt;
  if (energyReward > 0)
    user.curEnergy = Math.min(user.maxEnergy, user.curEnergy + energyReward);

  if (energyReward > 0) {
    postNotifications.push(`Energy reward: ${energyReward} (restored up to capacity).`);
  }

  if (farmRewardResult && farmRewardResult.rowsAffected > 0) {
    postNotifications.push("Active crop growth times reduced by 1 minute.");
  }

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
    rewardChoicePending: !!rewardChoice,
    userDelta,
    userCacheEligible:
      userCacheEligible &&
      !changedQuestAssignments &&
      !(farmRewardResult && farmRewardResult.rowsAffected > 0),
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
                allyAiIds: opponent.allyAiIds,
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
 * submissions serialize on `userData.updatedAt` before reward payout. With `rollObjectiveAttackers`
 * (used by `checkLocationQuest`), active objectives with attackers may start a random encounter.
 */
export const handleQuestConsequences = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  consequences: QuestConsequence[],
  notifications: string[],
  options?: {
    alwaysClaimUserState?: boolean;
    /** Roll the active objectives' ambush attackers; only the travel movement check sets it. */
    rollObjectiveAttackers?: boolean;
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
  // Objective attackers ambush a player who is out travelling, so they are rolled only for the
  // movement check (checkLocationQuest) of an awake player. Page loads (getUser), reward claims
  // and battle retries must never start a random encounter on their own.
  if (!opponent && options?.rollObjectiveAttackers && user.status === "AWAKE") {
    opponent = rollObjectiveAttackers(getActiveObjectives(user), user.sector);
    if (opponent) notifications.push("You have been attacked!");
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

/**
 * SQL predicates shared by mission-hall and uncompleted-quest fetches: exact
 * `requiredSageModeId` (or unset) and minimum `requiredSageRank` (or unset).
 *
 * @param user - Equipped mode and mastery experience from the questing player.
 */
export const sageQuestFilters = (
  user: Pick<UserData, "sageModeId" | "sageMasteryExperience">,
) => [
  or(
    isNull(quest.requiredSageModeId),
    eq(quest.requiredSageModeId, user.sageModeId ?? ""),
  ),
  or(
    isNull(quest.requiredSageRank),
    inArray(
      quest.requiredSageRank,
      sageRanksAtOrBelow(
        getSageMasteryDisplayRank(user.sageMasteryExperience, !!user.sageModeId),
      ),
    ),
  ),
];

/**
 * Resolves pending reward-choice offers for display: one query per referenced content type,
 * run together. Offers that no longer parse are skipped rather than failing the list.
 */
export const resolveRewardChoiceDisplays = async (
  client: DrizzleClient,
  user: Pick<UserData, "userId" | "sageModeId">,
  rows: {
    questId: string;
    pendingRewardChoice: unknown;
    quest: { name: string } | null;
  }[],
): Promise<RewardChoiceDisplay[]> => {
  const offers = rows.flatMap((row) => {
    const parsed = PendingRewardChoiceSchema.safeParse(row.pendingRewardChoice);
    return parsed.success
      ? [
          {
            questId: row.questId,
            questName: row.quest?.name ?? "Quest",
            ...parsed.data,
          },
        ]
      : [];
  });
  const idsFor = (field: RewardChoiceCard["field"]) => [
    ...new Set(
      offers.flatMap((offer) =>
        offer.cards.flatMap((card) =>
          card.field === field && card.contentId ? [card.contentId] : [],
        ),
      ),
    ),
  ];
  const itemIds = idsFor("reward_items");
  const jutsuIds = idsFor("reward_jutsus");
  const bloodlineIds = idsFor("reward_bloodlines");
  const sageModeIds = idsFor("reward_sage_modes");
  const badgeIds = idsFor("reward_badges");
  const [items, jutsus, bloodlines, sageModes, badges, ownership] = await Promise.all([
    itemIds.length > 0
      ? client
          .select({
            id: item.id,
            name: item.name,
            image: item.image,
            rarity: item.rarity,
            description: item.description,
          })
          .from(item)
          .where(inArray(item.id, itemIds))
      : [],
    jutsuIds.length > 0
      ? client
          .select({
            id: jutsu.id,
            name: jutsu.name,
            image: jutsu.image,
            rarity: jutsu.jutsuRank,
            description: jutsu.description,
          })
          .from(jutsu)
          .where(inArray(jutsu.id, jutsuIds))
      : [],
    bloodlineIds.length > 0
      ? client
          .select({
            id: bloodline.id,
            name: bloodline.name,
            image: bloodline.image,
            rarity: bloodline.rank,
            description: bloodline.description,
          })
          .from(bloodline)
          .where(inArray(bloodline.id, bloodlineIds))
      : [],
    sageModeIds.length > 0
      ? client
          .select({
            id: sageMode.id,
            name: sageMode.name,
            image: sageMode.image,
            description: sageMode.description,
          })
          .from(sageMode)
          .where(inArray(sageMode.id, sageModeIds))
      : [],
    badgeIds.length > 0
      ? client
          .select({
            id: badge.id,
            name: badge.name,
            image: badge.image,
            description: badge.description,
          })
          .from(badge)
          .where(inArray(badge.id, badgeIds))
      : [],
    fetchRewardChoiceOwnership(
      client,
      user,
      offers.flatMap((offer) => offer.cards),
    ),
  ]);
  const content = new Map<
    string,
    { name: string; image: string; rarity: string | null; description: string }
  >();
  const register = (
    field: RewardChoiceCard["field"],
    entries: {
      id: string;
      name: string;
      image: string;
      description: string;
      rarity?: string;
    }[],
  ) => {
    for (const entry of entries) {
      content.set(`${field}:${entry.id}`, { ...entry, rarity: entry.rarity ?? null });
    }
  };
  register("reward_items", items);
  register("reward_jutsus", jutsus);
  register("reward_bloodlines", bloodlines);
  register("reward_sage_modes", sageModes);
  register("reward_badges", badges);

  return offers.map((offer) => {
    const unavailable = getUnavailableRewardCards(offer.cards, ownership);
    return {
      questId: offer.questId,
      questName: offer.questName,
      choiceId: offer.id,
      pickCount: offer.pickCount,
      cards: offer.cards.map((card) => {
        const unavailableReason = unavailable.get(card.id) ?? null;
        if (!card.contentId) {
          const field = card.field as RewardChoiceAmountField;
          return {
            ...card,
            name: REWARD_CHOICE_AMOUNT_LABELS[field] ?? card.field,
            image: null,
            rarity: null,
            description: null,
            unavailableReason,
          };
        }
        const resolved = content.get(`${card.field}:${card.contentId}`);
        return {
          ...card,
          name: resolved?.name ?? "Unknown reward",
          image: resolved?.image ?? null,
          rarity: resolved?.rarity ?? null,
          description: resolved?.description ?? null,
          unavailableReason,
        };
      }),
    };
  });
};

/**
 * Which of the offered jutsus, bloodlines, badges and sage modes the player already holds, using
 * the same ownership tables `updateRewards` checks before granting them.
 */
export const fetchRewardChoiceOwnership = async (
  client: DrizzleClient,
  user: Pick<UserData, "userId" | "sageModeId">,
  cards: RewardChoiceCard[],
): Promise<RewardChoiceOwnership> => {
  const idsFor = (field: RewardChoiceCard["field"]) => [
    ...new Set(
      cards.flatMap((card) =>
        card.field === field && card.contentId ? [card.contentId] : [],
      ),
    ),
  ];
  const jutsuIds = idsFor("reward_jutsus");
  const bloodlineIds = idsFor("reward_bloodlines");
  const badgeIds = idsFor("reward_badges");
  const sageModeIds = idsFor("reward_sage_modes");
  const [jutsus, bloodlines, badges, sageModes] = await Promise.all([
    jutsuIds.length > 0
      ? client
          .select({ id: userJutsu.jutsuId })
          .from(userJutsu)
          .where(
            and(
              eq(userJutsu.userId, user.userId),
              inArray(userJutsu.jutsuId, jutsuIds),
            ),
          )
      : [],
    bloodlineIds.length > 0
      ? client
          .select({ id: bloodlineRolls.bloodlineId })
          .from(bloodlineRolls)
          .where(
            and(
              eq(bloodlineRolls.userId, user.userId),
              inArray(bloodlineRolls.bloodlineId, bloodlineIds),
            ),
          )
      : [],
    badgeIds.length > 0
      ? client
          .select({ id: userBadge.badgeId })
          .from(userBadge)
          .where(
            and(
              eq(userBadge.userId, user.userId),
              inArray(userBadge.badgeId, badgeIds),
            ),
          )
      : [],
    sageModeIds.length > 0 && !user.sageModeId
      ? client
          .select({ id: sageModeRolls.sageModeId })
          .from(sageModeRolls)
          .where(
            and(
              eq(sageModeRolls.userId, user.userId),
              inArray(sageModeRolls.sageModeId, sageModeIds),
            ),
          )
      : [],
  ]);
  const toSet = (rows: { id: string | null }[]) =>
    new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
  return {
    jutsuIds: toSet(jutsus),
    bloodlineIds: toSet(bloodlines),
    badgeIds: toSet(badges),
    sageModeIds: toSet(sageModes),
    hasSageMode: !!user.sageModeId,
  };
};

/**
 * Emits the `*_experience_gained` increments for profession experience granted by a reward
 * choice pick, which the completion could not emit because the experience was still a card.
 * Uses the completion's pattern: a fresh user read, then `claimUserSnapshot` on its `updatedAt`
 * so a tracker write committed meanwhile is never overwritten. Returns false when the snapshot
 * moved and nothing was written.
 */
export const advanceRewardChoiceTrackers = async (
  client: DrizzleClient,
  userId: string,
  rewards: GetRewardResult,
) => {
  if (getExperienceTrackerTasks(rewards).length === 0) return true;
  const { user } = await fetchUpdatedUser({ client, userId });
  if (!user) return false;
  return await claimRewardChoiceTrackers(client, user, rewards);
};

/** Snapshot-claimed tracker write of `advanceRewardChoiceTrackers` for an already-read user. */
export const claimRewardChoiceTrackers = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  rewards: GetRewardResult,
) => {
  const tasks = getExperienceTrackerTasks(rewards);
  const taskNames = new Set<string>(tasks.map((entry) => entry.task));
  const advancesObjective = user.userQuests.some((userQuest) =>
    userQuest.quest?.content.objectives.some((objective) =>
      taskNames.has(objective.task),
    ),
  );
  // No quest listens for this experience: the payout's SQL increments need no snapshot.
  if (!advancesObjective) return true;
  const { trackers } = getNewTrackers(user, tasks);
  const claim = await claimUserSnapshot({
    client,
    userId: user.userId,
    updatedAt: user.updatedAt,
    set: { questData: filterQuestTrackersForDbPersist(trackers, user) },
  });
  return claim.success;
};

/** Scalar rewards compose with other accepted cache updates; relation changes need reconciliation. */
export const getRewardUserDelta = (
  rewards: GetRewardResult,
  reputationCost = 0,
  hasQuestSnapshot = false,
): UserDelta | undefined => {
  if (
    // Integer columns round SQL payouts; fractional atomic increments need reconciliation.
    [rewards.reward_money, rewards.reward_seichi_silver, rewards.reward_exp].some(
      (amount) => !Number.isInteger(amount),
    ) ||
    (!hasQuestSnapshot && rewards.reward_reputation !== 0) ||
    rewards.reward_prestige < 0 ||
    rewards.reward_rank !== "NONE" ||
    rewards.reward_village_membership !== "NONE" ||
    rewards.reward_items.length > 0 ||
    rewards.reward_jutsus.length > 0 ||
    rewards.reward_bloodlines.length > 0 ||
    rewards.reward_sage_modes.length > 0 ||
    rewards.reward_badges.length > 0 ||
    rewards.reward_hunter_items ||
    rewards.reward_gathering_items ||
    rewards.reward_clanpoints !== 0 ||
    rewards.reward_anbupoints !== 0 ||
    rewards.reward_tokens !== 0 ||
    rewards.reward_war_damage !== 0 ||
    rewards.reward_war_healing !== 0 ||
    rewards.reward_medical_experience !== 0 ||
    rewards.reward_hunting_experience !== 0 ||
    rewards.reward_crafting_experience !== 0 ||
    rewards.reward_gathering_experience !== 0 ||
    MASTERY_EXPERIENCE_FIELDS.some((field) => (rewards[field] ?? 0) > 0) ||
    (rewards.reward_mastery_rank && rewards.reward_mastery_rank !== "NONE") ||
    rewards.reward_sage_mastery_experience !== 0 ||
    rewards.reward_skillpoints !== 0
  ) {
    // Content grants, profession milestones and shared relations change derived profile data.
    return undefined;
  }
  return {
    money: rewards.reward_money,
    seichiSilver: rewards.reward_seichi_silver,
    earnedExperience: rewards.reward_exp,
    reputationPoints: rewards.reward_reputation - reputationCost,
    reputationPointsTotal: rewards.reward_reputation,
    villagePrestige: rewards.reward_prestige,
  };
};
