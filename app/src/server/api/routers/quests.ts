import * as Sentry from "@sentry/nextjs";
import { and, eq, gte, inArray, isNull, lte, ne, notExists, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  ENERGY_QUEST_REWARDS,
  FARM_ACTIVITY_REWARD_TIME_REDUCTION_SECONDS,
  getUserCaps,
  LetterRanks,
  MAX_SKILL_POINTS,
  MasteryNames,
  MEDNIN_EXP_CAP,
  NPC_ONLY_QUEST_TYPES,
  PET_TASK_MAX_MINUTES,
  PET_TASK_MIN_RANK,
  type QuestType,
  QuestTypes,
  REGEN_SECONDS,
  SAGE_MASTERY_EXP_CAP,
  SENSEI_STUDENT_RYO_PER_MISSION,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STARTER_QUEST_ID,
  type UserRole,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import {
  type Quest,
  quest,
  questHistory,
  type UserData,
  type UserPet,
  userData,
  userPet,
} from "@/drizzle/schema";
import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import {
  eliteJoninMilestoneBlockMessage,
  eliteJoninMilestoneUpdate,
} from "@/libs/eliteJonin";
import { qualifiesForFarmActivityReward } from "@/libs/farming";
import { getGatheringItemDrops } from "@/libs/gathering";
import { getHuntingItemDrops } from "@/libs/hunting";
import { isQuestPresentationOnlyChange } from "@/libs/mapLocations";
import { canRetryQuestBattle } from "@/libs/objectives";
import { getWarSide } from "@/libs/objectiveWar";
import {
  deriveOverworldOpponents,
  validateFriendlyPlacementBindings,
} from "@/libs/overworldAi";
import { petExperienceGainSql } from "@/libs/pets/experience";
import { isPetAppearanceReady } from "@/libs/pets/progression";
import {
  isPetTaskAttempt,
  isPetTaskContract,
  petTaskDispatchBlockMessage,
} from "@/libs/pets/tasks";
import { eliteJoninExamBlockMessage } from "@/libs/profile";
import { boostPvpGain, boostPvpRewards, getPvpBoost } from "@/libs/pvpExperience";
import {
  applyQuestResets,
  controlShownQuestLocationInformation,
  fallbackQuestsFilter,
  filterQuestTrackersForDbPersist,
  type GetRewardResult,
  getActiveObjectives,
  getExperienceTrackerTasks,
  getMissionHallSettings,
  getNewTrackers,
  getPublicQuestUser,
  getQuestTargetSectorsToCheck,
  getReward,
  isAvailableUserQuests,
  isQuestRankAllowed,
  isWarMissionAvailable,
  missionHallStartBlockedMessage,
  postProcessRewards,
  type QuestConsequence,
  questAlreadyActiveBlockMessage,
  questDailyLimitMessage,
  questDailyQuota,
  questTypeConcurrentBlockMessage,
  questUiAccessBlockMessage,
  rollObjectiveAttackers,
  snapQuestTargetsToReachable,
  verifyQuestContentForSave,
} from "@/libs/quest";
import {
  formatQuestEntryCost,
  getIsolatedPyramid,
  getQuestEntryRequirements,
  hasQuestContentChanged,
  ISOLATED_PYRAMID_MESSAGE,
  isBetweenPyramidBattles,
} from "@/libs/questRun";
import { hasEnergyQueue } from "@/libs/queue";
import {
  buildRewardChoiceCards,
  getUnavailableRewardCards,
  REWARD_CHOICE_AMOUNT_LABELS,
  REWARD_CHOICE_PENDING_MESSAGE,
  REWARD_CHOICE_READY_MESSAGE,
  rewardFromChoiceCards,
  validateRewardPicks,
  verifyRewardChoiceForSave,
} from "@/libs/rewardChoice";
import { collapseRewards } from "@/libs/rewards";
import { callDiscordContent } from "@/libs/socials";
import { availableQuestLetterRanks, availableRanks } from "@/libs/train";
import { villageMissionCompletionEvents } from "@/libs/villageMission";
import { incrementAnbuPoints } from "@/queries/anbu";
import { reduceActiveFarmPlotTimers } from "@/queries/farming";
import { deleteUserItemsWithPositiveQuantity } from "@/queries/item";
import {
  fetchUser,
  findOwnedUserPet,
  findUserById,
  incrementUserMoney,
  incrementUserVillagePrestige,
} from "@/queries/profile";
import {
  deleteOverworldAiPlacementQuestForDelete,
  deleteQuestForDelete,
  deleteQuestHistoryForDelete,
  deleteQuestHistoryForDeleteUserQuest,
  deleteRaidDamageThresholdForDelete,
  deleteRaidParticipationForDelete,
  deleteUserQuestAttemptForDelete,
  deleteUserRaidBuffForDelete,
  executeCancelledForCancelPetTask,
  executeDefinitionWriteForUpdate,
  executeResultForAbandon,
  executeResultForCommitQuestObjectiveRewards,
  fetchBoundPlacementStatus,
  fetchQuest,
  fetchQuestDiscoveryCandidates,
  fetchQuestEntryInventory,
  fetchQuestsStartingQuest,
  fetchRestrictedNewQuestTargets,
  fetchRewardChoiceOwnership,
  fetchUserQuestByQuestId,
  fetchViewerRole,
  findOverworldAiPlacementQuestForAssignQuestToUser,
  findQuestHistoryForCheckRewards,
  findQuestHistoryForClaimRewardChoice,
  findQuestHistoryForCollectPetTask,
  findQuestHistoryForUpsertQuestEntry,
  findUserDataForGet,
  findUserDataForGetPendingRewardChoices,
  findUserDataForGetPetTask,
  findUserPvpRewardState,
  insertActionLogForDelete,
  insertActionLogForDeleteUserQuest,
  insertActionLogForUpdate,
  insertBankTransfersForCommitQuestObjectiveRewards,
  insertBloodlineRollsForUpdateRewards,
  insertQuestForClone,
  insertQuestForCreate,
  insertQuestHistoryForCommitQuestObjectiveRewards,
  insertQuestHistoryForUpsertQuestEntries,
  insertQuestHistoryForUpsertQuestEntry,
  insertRecruitmentRewardsForUpdateRewards,
  insertSageModeRollsForUpdateRewards,
  insertUserBadgeForUpdateRewards,
  insertUserItemForExecuteClaimedQuestConsequences,
  insertUserItemForUpdateRewards,
  insertUserJutsuForUpdateRewards,
  insertUserRewardsForUpdateRewards,
  listItemForAssignQuestToUser,
  listOverworldAiPlacementForPrepareOverworldBindings,
  listQuestForGetAll,
  listQuestForGetAllNames,
  listQuestHistoryForGetPendingRewardChoices,
  listQuestHistoryForGetQuestHistory,
  listQuestHistoryForGetUserQuests,
  listQuestsByIds,
  listRewardPackageForUpdate,
  listUserItemForHandleQuestConsequences,
  listUserItemForSpecificQuests,
  revertQuestCompletionAfterFailedClaim,
  selectBadgeForResolveRewardChoiceDisplays,
  selectBadgeForUpdateRewards,
  selectBloodlineForResolveRewardChoiceDisplays,
  selectBloodlineForUpdateRewards,
  selectItemForResolveRewardChoiceDisplays,
  selectItemForUpdateRewards,
  selectItemForUpdateRewards2,
  selectItemForUpdateRewards3,
  selectJutsuForResolveRewardChoiceDisplays,
  selectJutsuForUpdateRewards,
  selectQuestForFetchUncompletedQuests,
  selectQuestForStartRandom,
  selectQuestForUpdate,
  selectQuestHistoryForWhere,
  selectQuestHistoryForWhere2,
  selectSageModeForResolveRewardChoiceDisplays,
  selectSageModeForUpdateRewards,
  selectTitleForResolveRewardChoiceDisplays,
  selectTitleForUpdateRewards,
  selectUserDataForUpsertQuestEntries,
  selectVillageForUpdateRewards,
  updateClanForUpdateRewards,
  updateQuestForUpdate,
  updateQuestHistoryForAbandon,
  updateQuestHistoryForClaimRewardChoice,
  updateQuestHistoryForClaimRewardChoice2,
  updateQuestHistoryForCommitQuestObjectiveRewards,
  updateQuestHistoryForExecuteClaimedQuestConsequences,
  updateQuestHistoryForUpdate,
  updateQuestHistoryForUpdate2,
  updateQuestHistoryForUpsertQuestEntries,
  updateQuestHistoryForUpsertQuestEntry,
  updateUserDataForAbandon,
  updateUserDataForClaimDailyQuestSlot,
  updateUserDataForUpdateRewards,
  updateUserDataForUpsertQuestEntries,
  updateUserDataForUpsertQuestEntry,
  updateUserQuestData,
  updateWarForUpdateRewards,
  updateWarForUpdateRewards2,
  updateWarForUpdateRewards3,
  updateWarForUpdateRewards4,
} from "@/queries/quests";
import { deleteRequests } from "@/queries/sensei";
import { fetchSectorVillage, incrementVillageTokens } from "@/queries/village";
import { initiateBattle } from "@/routers/combat";
import { fetchUserItems } from "@/routers/item";
import {
  fetchPublishedAchievements,
  fetchUpdatedUser,
  getUserProgressionUpdate,
  type UserWithRelations,
} from "@/routers/profile";
import { startQuestPartyEncounter } from "@/routers/questParty";
import { fetchActiveWars } from "@/routers/war";
import { validateQuestRewardPackages } from "@/server/api/routers/rewardPackages";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { claimUserSnapshot, getNextUserSnapshotAt } from "@/server/utils/concurrency";
import { setEmptyStringsToNulls } from "@/server/utils/emptyStrings";
import {
  fetchPublicQuestLocations,
  notifyMapLocationsChanged,
  validateQuestStructures,
} from "@/server/utils/mapLocations";
import {
  masteryGainUpdates,
  masteryRankUpdate,
} from "@/server/utils/masteryProgression";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import { hydrateQuestCollections } from "@/server/utils/questCollections";
import { getQuestEntryCharges, payQuestEntryAtStart } from "@/server/utils/questEntry";
import {
  publishQuestPartyProgress,
  resetQuestPartyProgress,
} from "@/server/utils/questParty";
import { awardRecruitRankMilestonesSafely } from "@/server/utils/recruitment";
import {
  getUserRegenerationGain,
  userRegenerationGainSql,
} from "@/server/utils/regeneration";
import { fetchPublishedSectorMaps } from "@/server/utils/sectorMap";
import { grantTitles } from "@/server/utils/titleGrants";
import { validateTitleRewardIds } from "@/server/utils/titleRewards";
import { recordVillageMissionProgress } from "@/server/utils/villageMission";
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
import {
  periodStart,
  secondsFromDate,
  secondsFromNow,
  secondsPassed,
} from "@/utils/time";
import type { QueryCondition } from "@/utils/typeutils";
import { canAccessStructure } from "@/utils/village";
import { publicMapLocationsSchema } from "@/validators/mapLocation";
import { idSchema } from "@/validators/misc";
import {
  type AllObjectivesType,
  QuestCompletionTasks,
  QuestTracker,
  type QuestTrackerType,
  QuestValidator,
} from "@/validators/objectives";
import { petSelectionSchema } from "@/validators/pets";
import {
  type PetTask,
  petTaskActionSchema,
  startPetTaskSchema,
} from "@/validators/petTasks";
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
import {
  getQuestCounterFieldName,
  type QuestCounterFieldName,
} from "@/validators/user";
import { type UserDelta, userDeltaResponseSchema } from "@/validators/userCache";

export const questsRouter = createTRPCRouter({
  /** Public scenery exposes neutral presentation, never quest steps or player progress. */
  getPublicLocations: publicProcedure
    .input(publicMapLocationsSchema)
    .query(({ ctx, input }) =>
      fetchPublicQuestLocations(ctx.drizzle, { revision: input?.revision }),
    ),
  getAllNames: publicProcedure
    .meta({ mcp: { description: "Get all quest names and IDs" } })
    .query(async ({ ctx }) => {
      const [viewerRole, results] = await Promise.all([
        fetchViewerRole(ctx.drizzle, ctx.userId),
        listQuestForGetAllNames(ctx.drizzle),
      ]);
      return hideRestrictedQuestsFrom(viewerRole, results);
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
        listQuestForGetAll(ctx.drizzle, input, skip),
      ]);
      results.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      // Paginate on the raw page so a hidden NPC-only quest shortens a page rather than
      // truncating the infinite scroll early.
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: hideRestrictedQuestsFrom(viewerRole, results),
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
        findUserDataForGet(ctx.drizzle, ctx),
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
        fetchActiveWars(ctx.drizzle, input.villageId, ctx.userId),
      ]);
      if (!user) return [];
      const villageInWar = isWarMissionAvailable({
        questType: "war",
        villageId: user.villageId,
        dailyWarMissions: user.dailyWarMissions,
        activeWars,
      });
      const filtered = missions.filter((e) => {
        if (e.questType === "mission" && e.questRank === "S") return false;
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
      if (isRestrictedQuestType(input.questType)) {
        return [];
      }
      // Query
      const [{ user }, quests, inventory] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchQuestDiscoveryCandidates(ctx.drizzle, ctx.userId, {
          questTypes: [input.questType],
          level: input.level,
        }),
        listUserItemForSpecificQuests(ctx.drizzle, ctx),
      ]);
      if (!user) return [];
      quests.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      return quests
        .filter((e) => isAvailableUserQuests(e, user, true).check)
        .map((entry) => ({
          ...entry,
          entryRequirements: getQuestEntryRequirements(entry.content).map(
            (required) => ({
              ...required,
              name:
                inventory.find((row) => row.itemId === required.itemId)?.item.name ??
                required.itemId,
              owned: inventory
                .filter((row) => row.itemId === required.itemId)
                .reduce((sum, row) => sum + row.quantity, 0),
            }),
          ),
        }));
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
      const [updatedUser, sectorVillage, results] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchSectorVillage(ctx.drizzle, input.userSector),
        // Random missions/crimes/errands/medical/pvp all resolve the candidate pool the same
        // way (same widened LEFT JOIN + filters); the quest type is already carried by the
        // `eq(quest.questType, input.type)` predicate, so no per-type query branch is needed.
        // Farming, bloodline and sage requirements are checked by isAvailableUserQuests
        // after the user refresh, so this query can run alongside it.
        selectQuestForStartRandom(ctx.drizzle, ctx, input),
      ]);
      const { user } = updatedUser;
      if (!user) return errorResponse("User does not exist");
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
      // Guards
      if (!setting) return errorResponse("Setting not found");
      if (user.isBanned) return errorResponse("You are banned");
      const asleepBlock = missionHallStartBlockedMessage(input.type, user.status);
      if (asleepBlock) return errorResponse(asleepBlock);

      const quota = questDailyQuota(input.type, user);
      if (quota && quota.current >= quota.limit) {
        return errorResponse(questDailyLimitMessage(input.type, quota.limit));
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
              entryPaid: result.historyEntryPaid ?? false,
              isolated: result.historyIsolated ?? false,
              questVersion: result.historyQuestVersion,
            }
          : null;

      // Reserve the slot before delivering a quest, including when another start races us.
      if (quota && !(await claimDailyQuestSlot(ctx.drizzle, user, input.type))) {
        return errorResponse(questDailyLimitMessage(input.type, quota.limit));
      }
      const assignment = await upsertQuestEntry(
        ctx.drizzle,
        user,
        result,
        "random_assignment",
        prevEntry,
      );
      return {
        success: true,
        message: `Quest started: ${result.name}${rankInfo}`,
        ...(assignment.userCacheEligible &&
        !updatedUser.requiresProgressionRefresh &&
        getQuestTargetSectorsToCheck(user, user.questData ?? []).length === 0
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
      const asleepBlock = missionHallStartBlockedMessage(
        questData.questType,
        user.status,
      );
      if (asleepBlock) return errorResponse(asleepBlock);

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
        questData.questType !== "war"
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
      if (user.petTask?.questId === input.id)
        return errorResponse(
          "Return your companion from the Tasks tab before abandoning this contract.",
        );
      if (user.questParty?.questId === input.id)
        return errorResponse("Leave your quest team before abandoning this quest");
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
          "special",
        ].includes(current.questType)
      ) {
        return errorResponse(`Cannot abandon ${current.questType} quest type.`);
      }
      if (
        user.status === "BATTLE" &&
        (user.battleId ||
          getIsolatedPyramid(user)?.id !== current.id ||
          !current.isolated)
      )
        return errorResponse(
          "Finish or flee your current battle before abandoning this run.",
        );
      // Derived
      const questData = filterQuestTrackersForDbPersist(
        user.questData?.filter((q) => q.id !== input.id) ?? [],
        user,
      );
      const managedRun =
        current.questType === "battlepyramid" ||
        current.questType === "hunting" ||
        current.questType === "gathering" ||
        current.isolated ||
        !!current.quest.content.entryItems?.length;
      if (managedRun) {
        const now = new Date();
        // Drizzle has no multi-table UPDATE builder. One joined write releases the run
        // and its account/NPC state together; a combat or snapshot race changes neither.
        const result = await retryOnDeadlock(() =>
          executeResultForAbandon(
            ctx.drizzle,
            user,
            now,
            questData,
            input,
            ctx,
            current,
          ),
        );
        // MySQL counts both changed tables, so a successful joined claim can affect two rows.
        if (result.rowsAffected === 0)
          return errorResponse(
            "The run changed or entered combat. Finish or flee the battle, then try again.",
          );
      } else {
        await Promise.all([
          updateQuestHistoryForAbandon(ctx.drizzle, current),
          updateUserDataForAbandon(ctx.drizzle, questData, input, ctx),
        ]);
      }
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
      const results = await listQuestHistoryForGetQuestHistory(
        ctx.drizzle,
        ctx,
        skip,
        input,
      );
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
      const [user, entry, tierQuests, packages, titleError, structureError] =
        await Promise.all([
          fetchUser(ctx.drizzle, ctx.userId),
          fetchQuest(ctx.drizzle, input.id),
          selectQuestForUpdate(ctx.drizzle),
          listRewardPackageForUpdate(ctx.drizzle),
          validateTitleRewardIds(ctx.drizzle, input.data.content),
          validateQuestStructures(ctx.drizzle, input.data),
        ]);
      // Guards
      if (titleError) return errorResponse(titleError);
      if (structureError) return errorResponse(structureError);
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
        // Shared Village Missions and concurrent war missions progress outside quest scenes.
        const isConcurrentWarMission =
          input.data.questType === "war" &&
          input.data.content.objectives.some(
            (objective) =>
              objective.task === "espionage" || objective.task === "sabotage",
          );
        const hasMainSceneCharacters = input.data.content.sceneCharacters.length > 0;
        const allObjectivesHaveSceneCharacters = input.data.content.objectives.every(
          (objective) =>
            objective.sceneCharacters && objective.sceneCharacters.length > 0,
        );
        if (
          !input.data.hidden &&
          input.data.questType !== "village_mission" &&
          !isConcurrentWarMission &&
          !hasMainSceneCharacters &&
          !allObjectivesHaveSceneCharacters
        ) {
          return errorResponse(
            "Quest must have either main sceneCharacters set or all objectives must have sceneCharacters defined",
          );
        }
        // Prepare data for insertion into database
        const data = input.data;
        const packageError = validateQuestRewardPackages(
          data.content,
          entry.content,
          packages,
          user.role,
        );
        if (packageError) return errorResponse(packageError);
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
        const rewardChoiceCheck = verifyRewardChoiceForSave(input.data.content);
        if (!rewardChoiceCheck.check) {
          return errorResponse(rewardChoiceCheck.message);
        }
        // Check we only give ranks with exams
        let rankError = false;
        if (
          collapseRewards([
            data.content.reward,
            ...(data.content.reward.reward_packages ?? []).map((pack) => pack.rewards),
          ]).reward_rank !== "NONE" &&
          !["starter", "exam"].includes(data.questType)
        ) {
          rankError = true;
        }
        data.content.objectives.forEach((objective) => {
          if (
            collapseRewards([
              objective,
              ...(objective.reward_packages ?? []).map((pack) => pack.rewards),
            ]).reward_rank !== "NONE" &&
            data.questType !== "exam"
          ) {
            rankError = true;
          }
        });
        if (rankError) {
          return {
            success: false,
            message: `Ranks rewards are only allowed with starter or exam quests`,
          };
        }
        const edgeError = await restrictedNewQuestEdgeError(ctx.drizzle, {
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

        const parsedPrevious = QuestValidator.safeParse(entry);
        const isPresentationOnlyChange =
          parsedPrevious.success &&
          isQuestPresentationOnlyChange(parsedPrevious.data, input.data);
        const updatedAt = new Date(Math.max(Date.now(), entry.updatedAt.getTime() + 1));
        // Publish presentation and accepted run versions together so another quest's
        // tracker persistence cannot discard a checkpoint during a split revision.
        // One guarded statement avoids a transaction; Drizzle has no multi-table UPDATE builder.
        // Gameplay edits use the ordinary builder and retain quest revision checks.
        const definitionWrite = isPresentationOnlyChange
          ? await retryOnDeadlock(() =>
              executeDefinitionWriteForUpdate(ctx.drizzle, entry, input, updatedAt),
            )
          : await updateQuestForUpdate(ctx.drizzle, input, updatedAt, entry);
        if (definitionWrite.rowsAffected === 0)
          return errorResponse("Quest changed while saving. Refresh and try again.");
        await Promise.all([
          // Village Missions retire personal attempts without granting completions
          // or reclassifying completed history as collective progress.
          data.questType === "village_mission"
            ? updateQuestHistoryForUpdate(ctx.drizzle, entry)
            : updateQuestHistoryForUpdate2(ctx.drizzle, input, entry, updatedAt),
          insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry),
        ]);
        await notifyMapLocationsChanged();
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
        await insertQuestForCreate(ctx.drizzle, id);
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
      const edgeError = await restrictedNewQuestEdgeError(ctx.drizzle, {
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
      await insertQuestForClone(ctx.drizzle, questData);
      await notifyMapLocationsChanged();

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
          deleteQuestForDelete(ctx.drizzle, input),
          deleteQuestHistoryForDelete(ctx.drizzle, input),
          deleteRaidParticipationForDelete(ctx.drizzle, input),
          deleteRaidDamageThresholdForDelete(ctx.drizzle, input),
          deleteUserRaidBuffForDelete(ctx.drizzle, input),
          deleteOverworldAiPlacementQuestForDelete(ctx.drizzle, input),
          deleteUserQuestAttemptForDelete(ctx.drizzle, input),
          insertActionLogForDelete(ctx.drizzle, ctx, entry),
        ]);
        await outdateProposalsFor(
          ctx.drizzle,
          "QUEST",
          [entry.id],
          deletedReason("QUEST", entry.name, user.username),
        );
        await notifyMapLocationsChanged();
        return { success: true, message: `Quest deleted` };
      } else {
        return { success: false, message: `Not allowed to delete quest` };
      }
    }),
  /** Return the accepted task even when its content disappeared, so cancellation stays available. */
  getPetTask: protectedProcedure
    .input(petSelectionSchema.optional())
    .query(async ({ ctx, input }) => {
      const owner = await findUserDataForGetPetTask(ctx.drizzle, ctx);
      if (!owner) throw serverError("NOT_FOUND", "User not found");
      const task = owner.petTask;
      const [contract, history] = await Promise.all([
        task ? fetchQuest(ctx.drizzle, task.questId) : undefined,
        task
          ? fetchUserQuestByQuestId(ctx.drizzle, ctx.userId, task.questId)
          : undefined,
      ]);
      const pet = owner.pets.find((entry) => entry.id === task?.petId);
      return {
        task,
        petName: pet?.name ?? "Companion",
        questName: contract?.name ?? "Unavailable contract",
        blockMessage: task
          ? petTaskReturnBlockMessage(owner, task, contract, history, pet)
          : null,
        dispatchBlockMessage: petTaskDispatchBlockMessage(
          owner,
          owner.pets.find((entry) => entry.id === input?.petId),
        ),
      };
    }),

  /** Accept the normal profession contract, then reserve one exact attempt and companion. */
  startPetTask: protectedProcedure
    .input(startPetTaskSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, contract, previous, pet] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId, forceRegen: true }),
        fetchQuest(ctx.drizzle, input.questId),
        fetchUserQuestByQuestId(ctx.drizzle, ctx.userId, input.questId),
        findOwnedUserPet(ctx.drizzle, input.petId, ctx.userId),
      ]);
      if (!user) return errorResponse("User not found");
      const blocked = petTaskDispatchBlockMessage(user, pet);
      if (blocked || !pet) return errorResponse(blocked ?? "Companion not found");
      if (!contract || !isPetTaskContract(contract))
        return errorResponse(
          "Content has not enabled companion tasks for this contract.",
        );
      const access = questUiAccessBlockMessage(contract, user, null);
      if (access) return errorResponse(access);
      if (!isQuestRankAllowed(contract, user))
        return errorResponse("Your rank cannot accept this contract.");
      const availability = isAvailableUserQuests(
        { ...contract, ...previous },
        user,
        true,
      );
      if (!availability.check) return errorResponse(availability.message);
      if (user.questParty?.questId === contract.id)
        return errorResponse("Leave the quest team before delegating this contract.");
      if (previous?.pendingRewardChoice)
        return errorResponse(
          "Choose this contract's waiting rewards in the Logbook before sending a companion.",
        );
      if (!previous || previous.completed || previous.endAt) {
        const assigned = await assignQuestToUser({
          client: ctx.drizzle,
          user,
          quest: contract,
          source: "pet_task",
          prevAttempt: previous,
        });
        if (!assigned.success) return assigned;
      }
      // Assignment may insert or reuse a row. Read its committed identity so concurrent
      // starts cannot reserve a fabricated ID or an older generation of the same contract.
      const history = await fetchUserQuestByQuestId(
        ctx.drizzle,
        ctx.userId,
        contract.id,
      );
      if (!history || history.completed || history.endAt || history.pendingRewardChoice)
        return errorResponse(
          "The contract changed. Refresh before sending your companion.",
        );
      if (history.questVersion?.getTime() !== contract.updatedAt.getTime())
        return errorResponse(
          "This accepted contract changed. Abandon and accept it again before sending your companion.",
        );
      const task: PetTask = {
        petId: pet.id,
        questHistoryId: history.id,
        questId: contract.id,
        startedAt: history.startedAt.getTime(),
        questVersion: contract.updatedAt.getTime(),
        finishesAt: secondsFromDate(contract.petTaskMinutes * 60, new Date()).getTime(),
      };
      const claim = await retryOnDeadlock(() =>
        claimUserSnapshot({
          client: ctx.drizzle,
          userId: ctx.userId,
          updatedAt: user.updatedAt,
          where: [
            isNull(userData.petTask),
            eq(userData.status, "AWAKE"),
            isNull(userData.battleId),
            eq(userData.isBanned, false),
            eq(userData.isAi, false),
            eq(
              userData.occupation,
              contract.questType === "hunting" ? "HUNTER" : "GATHERING",
            ),
            eq(userData.rank, user.rank),
            sql`EXISTS (SELECT 1 FROM ${userPet} WHERE ${userPet.id} = ${pet.id} AND ${userPet.userId} = ${ctx.userId} AND ${userPet.revision} = ${pet.revision})`,
            petTaskAttemptCondition(task, ctx.userId),
            petTaskContentCondition(task, user.role),
          ],
          set: {
            petTask: task,
            questData:
              user.questData?.filter((tracker) => tracker.id !== contract.id) ?? [],
          },
        }),
      );
      return claim.success
        ? { success: true, message: `${pet.name} left to complete ${contract.name}.` }
        : errorResponse(
            "The contract is accepted, but your character changed before dispatch. Refresh and send your companion again.",
          );
    }),

  /** Claim only the final configured reward through the normal quest completion guards. */
  collectPetTask: protectedProcedure
    .input(petTaskActionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [{ user, settings }, history, pet] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        findQuestHistoryForCollectPetTask(ctx.drizzle, input, ctx),
        findOwnedUserPet(ctx.drizzle, input.petId, ctx.userId),
      ]);
      if (!user) return errorResponse("User not found");
      const task = user.petTask;
      if (
        !task ||
        task.petId !== input.petId ||
        task.questHistoryId !== input.questHistoryId ||
        task.startedAt !== input.startedAt
      )
        return errorResponse("This companion task is no longer active.");
      const blocked = petTaskReturnBlockMessage(
        user,
        task,
        history?.quest,
        history,
        pet,
      );
      if (blocked || !history?.quest || !pet)
        return errorResponse(
          blocked ?? "Contract unavailable. Return your companion without rewards.",
        );
      // Admission was checked at dispatch. The profile projection can omit an accepted
      // attempt after a level change or expiry; its pinned receipt still owns the return.
      user.userQuests = [
        ...user.userQuests.filter((entry) => entry.questId !== task.questId),
        { ...history, quest: history.quest },
      ];
      const reward = getReward(
        user,
        task.questId,
        undefined,
        settings,
        undefined,
        true,
      );
      const claim = await commitQuestObjectiveRewards({
        client: ctx.drizzle,
        userId: ctx.userId,
        user,
        ...reward,
        existingHistory: history,
        petTask: task,
      });
      if (claim.outcome !== "claimed")
        return errorResponse(
          "Task state changed. Refresh and collect its results again.",
        );
      return {
        success: true,
        message: `${pet.name} returned from ${history.quest.name}.${claim.rewardChoicePending ? " Choose your rewards in the Logbook." : ""}`,
        rewards: claim.rewards,
        notifications: claim.postNotifications,
        rewardChoicePending: claim.rewardChoicePending,
      };
    }),

  /** Return safely without rewards, including deleted content and a missing/restarted attempt. */
  cancelPetTask: protectedProcedure
    .input(petTaskActionSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const owner = await findUserById(ctx.drizzle, ctx.userId);
      const task = owner?.petTask;
      if (
        !owner ||
        !task ||
        task.petId !== input.petId ||
        task.questHistoryId !== input.questHistoryId ||
        task.startedAt !== input.startedAt
      )
        return errorResponse("This companion task is no longer active.");
      const now = new Date();
      // A LEFT JOIN permits recovery after content/history deletion. The exact start
      // guard prevents cancellation from closing a restarted attempt in a reused row.
      const cancelled = await retryOnDeadlock(() =>
        executeCancelledForCancelPetTask(ctx.drizzle, task, owner, now, ctx),
      );
      return cancelled.rowsAffected > 0
        ? { success: true, message: "Your companion returned without task rewards." }
        : errorResponse(
            "Task state changed. Refresh and try returning your companion again.",
          );
    }),

  checkRewards: protectedProcedure
    .meta({ mcp: { description: "Check and claim quest rewards" } })
    .input(z.object({ questId: z.string(), nextObjectiveId: z.string().optional() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Reward payout follows the history/account claim; isolated runs publish both together.
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
        findQuestHistoryForCheckRewards(ctx.drizzle, input, ctx),
      ]);

      // Guards
      if (!user) {
        return errorResponse("User does not exist");
      }
      if (user.petTask?.questId === input.questId)
        return errorResponse(
          "Your companion is completing this contract. Collect its results from the companion Tasks tab.",
        );
      const isolatedRun = getIsolatedPyramid(user);
      if (
        user.status !== "AWAKE" &&
        !(isBetweenPyramidBattles(user) && isolatedRun?.questId === input.questId)
      ) {
        return errorResponse("Must be awake to finish quests");
      }
      if (
        user.questParty?.questId === input.questId &&
        input.nextObjectiveId &&
        user.questParty.leaderId !== ctx.userId
      )
        return errorResponse("The quest team leader chooses dialog branches");

      const activeAttempt =
        [...user.userQuests, ...progressionQuestCandidates].find(
          (entry) => entry.questId === input.questId && !entry.endAt,
        ) ??
        (questHistoryPrefetch?.quest &&
        !questHistoryPrefetch.endAt &&
        (!questHistoryPrefetch.completed ||
          questHistoryPrefetch.questType === "achievement")
          ? questHistoryPrefetch
          : undefined);
      if (
        activeAttempt &&
        (hasQuestContentChanged(activeAttempt) ||
          (activeAttempt.quest.hidden && !canPlayHiddenQuests(user.role)))
      )
        return errorResponse(
          activeAttempt.questType === "battlepyramid"
            ? "This Pyramid is paused or changed. Return to the Battle Arena to resume or abandon it."
            : "This quest is currently unavailable.",
        );

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

      // Share completion claims and reward effects with overworld objective interactions.
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
        ...(resolved && isolatedRun?.questId === input.questId
          ? {
              postClaimUserDataPatch: {
                // A delayed payout must not unlock a different run or a claimed battle.
                status: sql`CASE WHEN ${userData.battleId} IS NULL AND NOT EXISTS (SELECT 1 FROM ${questHistory} WHERE ${questHistory.userId} = ${ctx.userId} AND ${questHistory.isolated} = TRUE AND ${questHistory.completed} = 0 AND ${questHistory.endAt} IS NULL) THEN 'AWAKE' ELSE ${userData.status} END`,
              },
            }
          : {}),
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
        getQuestTargetSectorsToCheck(user, user.questData ?? []).length === 0
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
        findUserDataForGetPendingRewardChoices(ctx.drizzle, ctx),
        listQuestHistoryForGetPendingRewardChoices(ctx.drizzle, ctx),
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
        findQuestHistoryForClaimRewardChoice(ctx.drizzle, ctx, input),
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
      // Refuse unavailable picks (owned content, a second sage mode, ineligible promotion) while the
      // offer is still stored, so the player can choose again.
      const ownership = await fetchRewardChoiceOwnership(
        ctx.drizzle,
        user,
        offer.data.cards,
      );
      const unavailable = getUnavailableRewardCards(offer.data.cards, ownership);
      const picks = validateRewardPicks(offer.data, input.cardIds, unavailable);
      if (!picks.success) return errorResponse(picks.message);
      const pickedRewards = rewardFromChoiceCards(picks.cards);
      const examBlock =
        pickedRewards.reward_rank === "ELITE JONIN"
          ? eliteJoninExamBlockMessage(user)
          : null;
      if (examBlock) return errorResponse(examBlock);
      // Consume exactly the offer that was validated; a parallel claim or a newer offer
      // leaves zero rows affected, so the picked rewards are granted at most once.
      const consumed = await updateQuestHistoryForClaimRewardChoice(
        ctx.drizzle,
        history,
        ctx,
        offer,
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
        await updateQuestHistoryForClaimRewardChoice2(ctx.drizzle, offer, history, ctx);
        return errorResponse("Your character changed while claiming, please try again");
      }
      // Payout leaves questData to the snapshot claim above instead of writing back this read.
      // Package cards can also carry promotions and membership, handled by updateRewards.
      const { items, jutsus, bloodlines, badges, sageModes, titles } =
        await updateRewards({
          pvpBoostApplied: true,
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
      rewards.reward_titles = titles.map((i) => i.name);
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
        itemsChanged: z.boolean(),
        message: z.string().optional(),
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
        rejectIsolatedPyramid: true,
      });
      let inventoryRecovered = false;
      const [
        { user, trackerResults, craftingItemsChanged, isPyramidIsolated },
        useritems,
        boundPlacementStatus,
      ] = await Promise.all([
        userPromise,
        fetchUserItems(ctx.drizzle, ctx.userId, {
          canRecoverStaleMergeClaims: async () => Boolean((await userPromise).user),
          onStaleMergeClaimRecovery: () => {
            inventoryRecovered = true;
          },
        }),
        userPromise.then(({ user }) =>
          user
            ? fetchBoundPlacementStatus(ctx.drizzle, user)
            : new Map<string, boolean>(),
        ),
      ]);
      // Guard
      if (isPyramidIsolated) {
        return {
          ...errorResponse(ISOLATED_PYRAMID_MESSAGE),
          itemsChanged: false,
          notifications: [],
        };
      }
      if (!user) {
        return { success: false, itemsChanged: false, notifications: [] };
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
        undefined,
        true,
      );

      // fetchUpdatedUser already committed its consequences. Process only this
      // location pass, and keep one current tracker per quest to avoid duplicate items.
      const { trackers, consequences } = updatedTrackerResults;
      const notifications = [
        ...new Set([
          ...trackerResults.notifications,
          ...updatedTrackerResults.notifications,
        ]),
      ];
      const questIdsUpdated = [
        ...new Set([
          ...trackerResults.questIdsUpdated,
          ...updatedTrackerResults.questIdsUpdated,
        ]),
      ];

      const fullTrackers = trackers;
      user.questData = filterQuestTrackersForDbPersist(trackers, user);

      // Handle consequences
      const { notifications: finalNotification, battleAttempted } =
        await handleQuestConsequences(ctx.drizzle, user, consequences, notifications, {
          rollObjectiveAttackers: true,
        });

      user.questData = fullTrackers;
      const responseUser = getPublicQuestUser(user);

      // Return information
      return {
        success: true,
        // The profile refresh can settle crafts or item consequences before the location pass.
        // Conservatively refresh even if a concurrent snapshot claim skipped a write.
        itemsChanged:
          // Inventory reads can restore abandoned merge claims.
          inventoryRecovered ||
          craftingItemsChanged ||
          // Rolled objective ambushes are local to handleQuestConsequences.
          battleAttempted ||
          [...trackerResults.consequences, ...consequences].some(
            (consequence) =>
              ((consequence.type === "add_item" ||
                consequence.type === "remove_item") &&
                consequence.ids.length > 0) ||
              // Battle setup can settle newly due crafts as well as pay quest entry costs.
              consequence.type === "combat",
          ),
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
      const quests = await listQuestHistoryForGetUserQuests(ctx.drizzle, input);
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
        deleteQuestHistoryForDeleteUserQuest(ctx.drizzle, input),
        updateUserQuestData(ctx.drizzle, questData, input.userId),
        insertActionLogForDeleteUserQuest(ctx.drizzle, ctx, input, user),
      ]);
      return { success: true, message: "Quest deleted successfully" };
    }),
  retryBattle: protectedProcedure
    .meta({ mcp: { description: "Retry a quest battle after failure" } })
    .input(z.object({ questId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        hideInformation: false,
      });
      // Guard
      if (!user) return errorResponse("User does not exist");
      const tracker = user.questData?.find((t) => t.id === input.questId);
      if (!tracker?.goals.some((goal) => canRetryQuestBattle(goal))) {
        return errorResponse("There is no lost battle to retry in this quest");
      }
      if (
        user.status === "BATTLE" &&
        (!isBetweenPyramidBattles(user) ||
          getIsolatedPyramid(user)?.questId !== input.questId)
      )
        return errorResponse("Finish your current battle before retrying a quest");
      const activeAttempt = user.userQuests.find(
        (entry) => entry.questId === input.questId && !entry.endAt,
      );
      if (
        activeAttempt &&
        (hasQuestContentChanged(activeAttempt) ||
          (activeAttempt.quest.hidden && !canPlayHiddenQuests(user.role)))
      )
        return errorResponse(
          activeAttempt.questType === "battlepyramid"
            ? "This Pyramid is paused or changed. Return to the Battle Arena to resume or abandon it."
            : "This quest is currently unavailable.",
        );
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
 * Pet XP combines positive player XP and dedicated pet rewards in this same account update;
 * the shared SQL helper checks live pet eligibility without another database round trip.
 *
 * Sage: `reward_sage_modes` rolls and records a not-yet-owned mode only when the
 * player has no equipped `sageModeId`. Already-equipped players skip the grant so
 * a mode is not burned into history they can never wear.
 *
 * Titles retain their first acquisition snapshot and advance the account version to fence recovery.
 */
export const updateRewards = async (info: {
  /** Transaction sessions execute one statement at a time; ordinary callers keep parallel phases. */
  inTransaction?: boolean;
  client: DrizzleClient;
  user: UserData;
  reason: string;
  rewards: GetRewardResult;
  /** Skip for existing treasury transfers or rewards with their boost already applied. */
  pvpBoostApplied?: boolean;
  questCounterField?: QuestCounterFieldName;
  questFinishedAt?: Date;
  // Fully-hydrated user (with quest relations) passed ONLY by callers that want gathering drops
  // to advance the herbs_gathered tracker. Explicit opt-in — the herbs branch below no longer
  // sniffs `"userQuests" in user`, so a future caller cannot silently start incrementing it.
  questUser?: NonNullable<UserWithRelations>;
  /** Captured by the completed collection; ordinary rewards without a snapshot use base yield. */
  gatheringBonusQuantity?: number;
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
    inTransaction = false,
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
    pvpBoostApplied = false,
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
  const hasRecruiterPrestige = !!user.recruiterId && rewards.reward_prestige > 0;

  // Fetch names from the database
  const [
    pvpAverage,
    recruiter,
    villageData,
    hunterItems,
    gatheringItems,
    items,
    jutsus,
    bloodlines,
    badges,
    titles,
    activeWars,
    sageModes,
  ] = await runRewardTasks(inTransaction)([
    () =>
      hasRecruiterPrestige || (!pvpBoostApplied && (user.pvpExperience ?? 0) > 0)
        ? fetchPvpExperienceAverage(client)
        : undefined,
    () =>
      hasRecruiterPrestige && user.recruiterId
        ? findUserPvpRewardState(client, user.recruiterId)
        : undefined,
    () =>
      rewards.reward_village_membership !== "NONE"
        ? selectVillageForUpdateRewards(client, {
            reward_village_membership: rewards.reward_village_membership,
          }).then((v) => v[0])
        : undefined,
    () =>
      rewards.reward_hunter_items && user.occupation === "HUNTER"
        ? selectItemForUpdateRewards(client)
        : undefined,
    () =>
      rewards.reward_gathering_items && user.occupation === "GATHERING"
        ? selectItemForUpdateRewards2(client)
        : undefined,
    () =>
      uniqueItemIds.length > 0
        ? selectItemForUpdateRewards3(client, uniqueItemIds)
        : [],
    () =>
      (rewards.reward_jutsus?.length ?? 0) > 0
        ? selectJutsuForUpdateRewards(client, user, rewards)
        : [],
    () =>
      (rewards.reward_bloodlines?.length ?? 0) > 0
        ? selectBloodlineForUpdateRewards(client, user, rewards)
        : [],
    () =>
      (rewards.reward_badges?.length ?? 0) > 0
        ? selectBadgeForUpdateRewards(client, user, rewards)
        : [],
    () =>
      (rewards.reward_titles?.length ?? 0) > 0
        ? selectTitleForUpdateRewards(client, user, rewards)
        : [],
    () =>
      hasWarRewards && user.villageId
        ? fetchActiveWars(client, user.villageId, user.userId)
        : undefined,
    () =>
      (rewards.reward_sage_modes?.length ?? 0) > 0
        ? selectSageModeForUpdateRewards(client, user, rewards)
        : [],
  ]);

  if (!pvpBoostApplied) {
    // Keep the caller's payout object aligned with the amounts displayed in its response.
    boostPvpRewards(
      rewards,
      getPvpBoost(user, pvpAverage ? [pvpAverage] : []).totalPercent,
      true,
    );
  }

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
    info.gatheringBonusQuantity ?? 0,
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

  // Material drops are expanded per unit, preserving inventory stack limits.
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
    // Round each grant separately; player XP penalties must not offset dedicated pet XP.
    petExperience: petExperienceGainSql(
      Math.max(0, Math.round(rewards.reward_exp ?? 0)) +
        Math.round(rewards.reward_pet_experience ?? 0),
    ),
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
  const prestigeReward = Math.floor(
    boostPvpGain(
      Math.ceil(rewards.reward_prestige * 0.1),
      getPvpBoost(recruiter ?? {}, pvpAverage ? [pvpAverage] : []).totalPercent,
    ),
  );

  // Update database
  await runRewardTasks(inTransaction)([
    () => updateUserDataForUpdateRewards(client, updatedUserData, user),
    ...(user.recruiterId && prestigeReward > 0
      ? [
          incrementUserVillagePrestige(client, prestigeReward, user.recruiterId),
          insertRecruitmentRewardsForUpdateRewards(
            client,
            { recruiterId: user.recruiterId, userId: user.userId },
            prestigeReward,
          ),
        ]
      : []
    ).map((task) => () => task),
    () => (getNewRank ? deleteRequests(client, user.userId) : undefined),
    () =>
      rewards.reward_reputation > 0 &&
      insertUserRewardsForUpdateRewards(client, user, rewards, reason),
    () =>
      rewards.reward_tokens > 0 && user.villageId
        ? incrementVillageTokens(client, rewards.reward_tokens, user.villageId)
        : undefined,
    () =>
      rewards.reward_clanpoints > 0 && user.clanId
        ? updateClanForUpdateRewards(client, rewards, { clanId: user.clanId })
        : undefined,
    () =>
      rewards.reward_anbupoints > 0 && user.anbuId
        ? incrementAnbuPoints(client, rewards.reward_anbupoints, user.anbuId)
        : undefined,
    () => jutsus.length > 0 && insertUserJutsuForUpdateRewards(client, jutsus, user),
    () =>
      bloodlines.length > 0 &&
      insertBloodlineRollsForUpdateRewards(client, bloodlines, user),
    () =>
      rolledSageMode
        ? insertSageModeRollsForUpdateRewards(client, user, rolledSageMode)
        : undefined,
    () =>
      itemsToInsert.length > 0 &&
      insertUserItemForUpdateRewards(client, itemsToInsert, user),
    () => badges.length > 0 && insertUserBadgeForUpdateRewards(client, badges, user),
    () =>
      grantTitles(
        client,
        user.userId,
        titles.map((entry) => entry.id),
        inTransaction,
      ),
    ...(() => {
      if (!activeWars || activeWars.length === 0) return [];
      // Find ALL applicable wars (VILLAGE_WAR or WAR_RAID)
      const applicableWars = activeWars.filter(
        (w) =>
          ["VILLAGE_WAR", "WAR_RAID"].includes(w.type) &&
          !!getWarSide(w, user.villageId, user.userId),
      );
      if (applicableWars.length === 0) return [];

      const warUpdates: Promise<unknown>[] = [];

      // Process each war the user is involved in
      for (const activeWar of applicableWars) {
        // Determine if user is on attacker or defender side for this war
        const isOnAttackerSide =
          getWarSide(activeWar, user.villageId, user.userId) ===
          activeWar.attackerVillageId;

        // Apply war damage (damages opponent's war health)
        if (rewards.reward_war_damage > 0) {
          if (isOnAttackerSide) {
            // Attacker damages defender's war health
            warUpdates.push(updateWarForUpdateRewards(client, rewards, activeWar));
          } else {
            // Defender damages attacker's war health
            warUpdates.push(updateWarForUpdateRewards2(client, rewards, activeWar));
          }
        }

        // Apply war healing (heals own side's war health)
        if (rewards.reward_war_healing > 0) {
          if (isOnAttackerSide) {
            // Attacker heals attacker's war health
            warUpdates.push(updateWarForUpdateRewards3(client, rewards, activeWar));
          } else {
            // Defender heals defender's war health
            warUpdates.push(updateWarForUpdateRewards4(client, rewards, activeWar));
          }
        }
      }

      return warUpdates;
    })().map((task) => () => task),
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
    titles,
    jutsus,
    bloodlines,
    badges,
    droppedGatheringItems,
    sageModes: rolledSageMode ? [rolledSageMode] : [],
  };
};

/** True when a quest type can only ever be acquired from its assigned overworld NPC. */
const isNpcOnlyQuestType = (questType: QuestType) =>
  (NPC_ONLY_QUEST_TYPES as readonly QuestType[]).includes(questType);

/** These quests require their dedicated acquisition flow, including when linked by content. */
const isRestrictedQuestType = (questType: QuestType) =>
  isNpcOnlyQuestType(questType) || questType === "special";

/**
 * Hide quests with dedicated acquisition flows from public content listings.
 * Editors still need these entries to configure NPC assignments and item grants.
 */
const hideRestrictedQuestsFrom = <T extends { questType: QuestType }>(
  viewerRole: UserRole,
  quests: T[],
) =>
  canChangeContent(viewerRole)
    ? quests
    : quests.filter((q) => !isRestrictedQuestType(q.questType));

/**
 * Reason a quest save must be rejected because of a new_quest edge involving a restricted quest,
 * or null when it may proceed. Both directions matter:
 *
 * - Outbound: an objective may not bypass an NPC or item acquisition requirement.
 * - Inbound: a quest may not become restricted while another objective still starts it.
 *
 * Reject invalid links before saving content: a later assignment failure can follow a
 * committed objective snapshot, leaving the chain without its next quest or reward.
 */
export const restrictedNewQuestEdgeError = async (
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
  const becomingRestricted =
    isRestrictedQuestType(nextType) && nextType !== currentType;
  const [outboundTargets, inboundStarters] = await Promise.all([
    fetchRestrictedNewQuestTargets(client, objectives),
    becomingRestricted
      ? fetchQuestsStartingQuest(client, questId)
      : Promise.resolve([]),
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
    (target) => target.id !== questId || isRestrictedQuestType(nextType),
  );
  if (blockedTargets.length > 0) {
    return `NPC-only and item-only quests cannot be started by a new_quest objective: ${blockedTargets
      .map((target) => target.name)
      .join(", ")}`;
  }
  const starterNames = inboundStarters
    .filter((starter) => starter.id !== questId)
    .map((starter) => starter.name);
  if (becomingRestricted && startsItself) starterNames.push(questName);
  if (starterNames.length > 0) {
    return `Cannot change this quest to ${nextType}: it is still started by a new_quest objective in ${[
      ...new Set(starterNames),
    ].join(", ")}. Remove those objectives first.`;
  }
  return null;
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
  const history = await selectQuestForFetchUncompletedQuests(
    client,
    user,
    type,
    now,
    availableLetters,
  );
  return history
    .map((quest) => quest.Quest)
    .filter((q) => !q.hidden || canPlayHiddenQuests(user.role));
};

/** Row locks the bulk quest reset may hold in one statement. */
const QUEST_RESET_BATCH_SIZE = 100;

/** Ceiling on the repeated tracker-removal passes per batch; a stuck-loop guard, not a bound. */
const QUEST_RESET_MAX_TRACKER_PASSES = 50;

/**
 * Upsert quest entries for all users by selector. NOTE: selector determined which users get
 * updated/inserted entries.
 *
 * @param deadline - Optional epoch-ms cutoff checked before each batch. Once it has passed the
 *   remaining batches are left untouched so the caller can stop inside its time budget.
 * @returns `false` when the deadline stopped the reset before every batch ran, else `true`.
 */
export const upsertQuestEntries = async (
  client: DrizzleClient,
  quest: Quest,
  updateSelector: QueryCondition,
  deadline?: number,
) => {
  if (isRestrictedQuestType(quest.questType)) {
    throw serverError(
      "PRECONDITION_FAILED",
      quest.questType === "special"
        ? "Special quests can only be started by consuming an item."
        : "Overworld quests cannot be assigned to users in bulk.",
    );
  }
  // One pass over the selector for both branches: the LEFT JOIN already tells us who lacks a
  // QuestHistory row, so splitting the rows in JS costs one extra column instead of a second
  // round-trip that re-scans the same users.
  const candidates = await selectUserDataForUpsertQuestEntries(
    client,
    quest,
    updateSelector,
  );
  const missingHistory = candidates.filter((row) => row.historyId === null);
  if (missingHistory.length > 0) {
    // Idempotent through the unique (userId, questId) key, so a deadlock victim can rerun.
    await retryOnDeadlock(() =>
      insertQuestHistoryForUpsertQuestEntries(client, missingHistory, quest),
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
      if (deadline !== undefined && Date.now() >= deadline) return false;
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
          updateUserDataForUpsertQuestEntries(client, trackerPath, batchUserIds),
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
        updateQuestHistoryForUpsertQuestEntries(
          client,
          startedAt,
          batchUserIds,
          questId,
        ),
      );
    }
  }
  return true;
};

/** Reserve a daily assignment before delivery; SQL enforces the cap across stale callers. */
export const claimDailyQuestSlot = async (
  client: DrizzleClient,
  user: UserData,
  questType: string,
) => {
  const quota = questDailyQuota(questType, user);
  if (!quota) return true;
  const field =
    questType === "errand"
      ? "dailyErrands"
      : questType === "medical"
        ? "dailyMedicalMissions"
        : questType === "pvp"
          ? "dailyPvpMissions"
          : questType === "war"
            ? "dailyWarMissions"
            : "dailyMissions";
  const counter = userData[field];
  const result = await updateUserDataForClaimDailyQuestSlot(
    client,
    field,
    counter,
    questType,
    user,
    quota,
  );
  if (result.rowsAffected === 0) return false;
  user[field] += 1;
  return true;
};

/**
 * Quest types that {@link assignQuestToUser} can start. Errand (and meta types like
 * achievement/tier) are intentionally excluded: errands are dispensed only via the
 * `startRandom` procedure, which enforces the daily errand cap this centralized path does
 * not. The overworld-NPC flow filters its pool to these so a mis-pooled type can never
 * reach assignQuestToUser, throw, and strand a player's NPC-quest claim.
 */
export const ASSIGNABLE_QUEST_TYPES: QuestType[] = [
  "special",
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
 * Quest types excluded from overworld NPC pools. Special quests require item
 * consumption; the remaining types require occupation, squad or structure access
 * enforced by {@link questUiAccessBlockMessage} for UI and companion starts.
 * NPC starts cannot bypass those acquisition requirements.
 */
export const OVERWORLD_GATED_QUEST_TYPES: QuestType[] = [
  "special",
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
  | "item"
  | "ui"
  | "pet_task"
  | "overworld_npc"
  | "random_assignment"
  | "system"
  | "quest_objective";

/**
 * Start quests for UI, companion, NPC and item acquisition flows. Validate source,
 * rank, availability, dates, active attempts and applicable quotas before assignment;
 * UI and companion starts also enforce structure and occupation access.
 *
 * Item starts accept only Special quests and reuse the caller's receipt transaction,
 * which already owns the account and stack claim. The caller must roll back any
 * unsuccessful result so history, entry costs and the consumed item stay atomic.
 */
export const assignQuestToUser = async (args: {
  client: DrizzleClient;
  user: NonNullable<UserWithRelations>;
  quest: Quest;
  source: "ui" | "pet_task" | "overworld_npc" | "item";
  /** Reuse the item receipt's transaction; do not open another assignment transaction. */
  inTransaction?: boolean;
  /** Required for NPC-only quests so their placement assignment can be verified server-side. */
  overworldPlacementId?: string;
  sectorVillage?: Awaited<ReturnType<typeof fetchSectorVillage>>;
  // Feeds availability/period-cap guards and skips upsertQuestEntry's history query.
  // Callers resolve this row in their opening parallel preload.
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

  if (questData.questType === "special" && source !== "item")
    return errorResponse("Special quests can only be started by consuming an item.");
  if (source === "item" && (questData.questType !== "special" || !args.inTransaction))
    return errorResponse("This item cannot start that quest.");

  if (user.petTask?.questId === questData.id)
    return errorResponse(
      "Your companion is completing this contract. Return it before restarting.",
    );

  if (questData.questType === "hunting" && source !== "pet_task")
    return errorResponse(
      "New hunts are available on the Hunter contract board. Existing hunting quests can still be completed.",
    );

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
    const placementQuest = await findOverworldAiPlacementQuestForAssignQuestToUser(
      client,
      overworldPlacementId,
      questData,
    );
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
    { ...questData, ...prevAttempt, questType: questData.questType },
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

  // Companion assignments keep the same structure/occupation/rank guards as the UI.
  if (source === "ui" || source === "pet_task") {
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

  if (
    (questData.questType === "battlepyramid" || questData.content.entryItems?.length) &&
    user.status !== "AWAKE"
  )
    return errorResponse("You must be awake and outside combat to start this run.");

  // Per-type concurrent-limit guard (pure, no DB)
  const block = questTypeConcurrentBlockMessage(questData, user);
  if (block) return errorResponse(block);

  const quota = questDailyQuota(questData.questType, user);
  const dailyLimitMessage = quota
    ? questDailyLimitMessage(questData.questType, quota.limit)
    : "";
  if (quota && quota.current >= quota.limit) return errorResponse(dailyLimitMessage);

  // Entry items are checked and paid when the run starts, not at its first battle, so a
  // player without the items never holds a run they cannot fight. Re-entering an attempt
  // that is still open keeps its receipt; a fresh or restarted attempt pays again.
  let entryCharges: NonNullable<ReturnType<typeof getQuestEntryCharges>> = [];
  const entryRequirements = getQuestEntryRequirements(questData.content);
  if (entryRequirements.length > 0) {
    const reopensPaidAttempt =
      !!prevAttempt &&
      prevAttempt.completed === 0 &&
      prevAttempt.endAt === null &&
      prevAttempt.entryPaid;
    const charges = getQuestEntryCharges(
      { entryPaid: reopensPaidAttempt, quest: questData },
      await fetchQuestEntryInventory(client, user.userId),
    );
    if (!charges) {
      const names = await listItemForAssignQuestToUser(client, entryRequirements);
      const cost = formatQuestEntryCost(
        entryRequirements.map((required) => ({
          quantity: required.quantity,
          name: names.find((row) => row.id === required.itemId)?.name ?? "unknown item",
        })),
      );
      return errorResponse(`You need ${cost} in your inventory to enter.`);
    }
    entryCharges = charges;
  }

  // War: fetch active wars (expensive; only after all cheap guards pass)
  if (questData.questType === "war") {
    if (!user.villageId) {
      return errorResponse("You must be in a village for war missions");
    }
    const warList = await fetchActiveWars(client, user.villageId, user.userId);
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

  // Reserve daily slots before delivering quests with a guarded counter update.
  // CAS runs first so that a user at the daily limit is rejected before any quest entry
  // is written. This deliberately nontransactional flow means a crash between
  // the CAS success and the upsert burns one daily slot without delivering the quest
  // (acceptable), whereas the reverse order would deliver a quest when the limit is reached
  // (unacceptable — creates orphaned quest entries the user cannot access). The
  // warParticipantUntil stamp rides on the same guarded CAS update so it costs no extra
  // roundtrip; a crash before upsertQuestEntry then leaves a bounded (~2h) cross-bracket
  // stamp without a quest — the same fail-safe leak the equivalent merge in initiateBattle
  // accepts, and harmless since it only makes the user more attackable.
  let assignment: Awaited<ReturnType<typeof upsertQuestEntry>>;
  // Rolls back the claim, history and any debited stack when a ticket stack changed.
  const entryRejected = new Error("Quest entry rejected");
  const dailyLimitReached = new Error("Daily quest limit reached");
  if (source === "item") {
    // Reuse the receipt session rather than the entry-payment transactions below.
    // The caller rolls back the entire consumption if payment or assignment fails.
    assignment = await upsertQuestEntry(
      client,
      user,
      questData,
      source,
      prevAttempt ?? null,
      true,
    );
    if (entryCharges.length > 0) {
      if (
        !(await payQuestEntryAtStart({
          client,
          userId: user.userId,
          questId: questData.id,
          charges: entryCharges,
        }))
      )
        return errorResponse("Your entry items changed. Please try again.");
      assignment.entry = { ...assignment.entry, entryPaid: true };
      user.userQuests = user.userQuests.map((row) =>
        row.questId === questData.id ? { ...row, entryPaid: true } : row,
      );
    }
  } else if (questData.questType === "war" && entryCharges.length > 0) {
    // With entry items the slot, history row and item debit must commit together, so a
    // changed ticket stack refunds the daily slot instead of burning it.
    const paid = await retryOnDeadlock(() =>
      client.transaction(async (tx) => {
        const database = tx as unknown as DrizzleClient;
        // A rolled-back attempt must not leave its tracker changes on the caller's user.
        const warUser = { ...user };
        if (!(await claimDailyQuestSlot(database, warUser, questData.questType)))
          throw dailyLimitReached;
        const result = await upsertQuestEntry(
          database,
          warUser,
          questData,
          source,
          prevAttempt ?? null,
          true,
        );
        if (
          !(await payQuestEntryAtStart({
            client: database,
            userId: user.userId,
            questId: questData.id,
            charges: entryCharges,
          }))
        )
          throw entryRejected;
        result.entry = { ...result.entry, entryPaid: true };
        warUser.userQuests = warUser.userQuests.map((row) =>
          row.questId === questData.id ? { ...row, entryPaid: true } : row,
        );
        return { result, user: warUser };
      }),
    ).catch((error: unknown) => {
      if (error === dailyLimitReached) return undefined;
      if (error === entryRejected) return null;
      throw error;
    });
    if (paid === undefined) return errorResponse(dailyLimitMessage);
    if (paid === null)
      return errorResponse("Your entry items changed. Please try again.");
    Object.assign(user, paid.user);
    assignment = paid.result;
  } else if (questData.questType === "war") {
    if (!(await claimDailyQuestSlot(client, user, questData.questType))) {
      return errorResponse(dailyLimitMessage);
    }
    assignment = await upsertQuestEntry(
      client,
      user,
      questData,
      source,
      prevAttempt ?? null,
    );
  } else if (
    questData.questType === "battlepyramid" ||
    questData.content.entryItems?.length
  ) {
    // Publish the account claim and new history together: another request must not see
    // a fresh account stamp before the active Pyramid row. A joined UPDATE cannot insert
    // missing history or commit its tracker and initial recovery with that insertion.
    const assigned = await retryOnDeadlock(() =>
      client.transaction(async (tx) => {
        const database = tx as unknown as DrizzleClient;
        const claim = await claimUserSnapshot({
          client: database,
          userId: user.userId,
          updatedAt: user.updatedAt,
          where: [
            eq(userData.status, "AWAKE"),
            ...(questData.questType === "battlepyramid"
              ? [notExists(selectQuestHistoryForWhere(database, user))]
              : []),
          ],
        });
        if (!claim.success) return undefined;
        const claimedUser = { ...user, updatedAt: claim.claimedAt };
        if (!(await claimDailyQuestSlot(database, claimedUser, questData.questType)))
          throw dailyLimitReached;
        const result = await upsertQuestEntry(
          database,
          claimedUser,
          questData,
          source,
          prevAttempt ?? null,
          true,
        );
        if (
          entryCharges.length > 0 &&
          !(await payQuestEntryAtStart({
            client: database,
            userId: user.userId,
            questId: questData.id,
            charges: entryCharges,
          }))
        )
          throw entryRejected;
        if (entryCharges.length > 0) {
          result.entry = { ...result.entry, entryPaid: true };
          claimedUser.userQuests = claimedUser.userQuests.map((row) =>
            row.questId === questData.id ? { ...row, entryPaid: true } : row,
          );
        }
        return { result, user: claimedUser };
      }),
    ).catch((error: unknown) => {
      if (error === entryRejected) return null;
      if (error === dailyLimitReached) return false;
      throw error;
    });
    if (assigned === false) return errorResponse(dailyLimitMessage);
    if (assigned === null)
      return errorResponse("Your entry items changed. Please try again.");
    if (!assigned)
      return errorResponse(
        "Your account changed or another Pyramid started. Refresh and try again.",
      );
    Object.assign(user, assigned.user);
    assignment = assigned.result;
  } else {
    if (!(await claimDailyQuestSlot(client, user, questData.questType)))
      return errorResponse(dailyLimitMessage);
    assignment = await upsertQuestEntry(
      client,
      user,
      questData,
      source,
      prevAttempt ?? null,
    );
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
 *
 * @param inTransaction - The caller owns a PlanetScale session and awaits statements in order;
 * fresh isolated story grants open their own transaction when this is false.
 */
export const upsertQuestEntry = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  quest: Quest,
  source: QuestAcquisitionSource,
  prevEntry?: Awaited<ReturnType<typeof fetchUserQuestByQuestId>> | null,
  inTransaction = false,
): Promise<{
  entry: NonNullable<Awaited<ReturnType<typeof fetchUserQuestByQuestId>>>;
  userCacheEligible: boolean;
}> => {
  if (quest.questType === "special" && source !== "item") {
    throw serverError(
      "PRECONDITION_FAILED",
      "Special quests can only be started by consuming an item.",
    );
  }
  if (isNpcOnlyQuestType(quest.questType) && source !== "overworld_npc") {
    throw serverError(
      "PRECONDITION_FAILED",
      "Overworld quests can only be accepted from their assigned NPC.",
    );
  }
  if (
    quest.questType === "village_mission" ||
    (quest.questType === "mission" && quest.questRank === "S")
  ) {
    throw serverError(
      "PRECONDITION_FAILED",
      "Village Missions can only be selected by the Kage in the Town Hall",
    );
  }
  // Reuse the caller's pre-fetched history row when supplied; otherwise load it here.
  let entry =
    prevEntry !== undefined
      ? prevEntry
      : await findQuestHistoryForUpsertQuestEntry(client, quest, user);
  // Promises to be executed
  const promises: Promise<unknown>[] = [];
  const professionContract =
    quest.questType === "hunting" || quest.questType === "gathering";
  // A stale ordinary start can arrive after dispatch. Keep its tracker and reused
  // history row untouched while the live account receipt owns this contract.
  const noDelegatedAttempt = sql`NOT EXISTS (SELECT 1 FROM ${userData} WHERE ${userData.userId} = ${user.userId} AND JSON_UNQUOTE(JSON_EXTRACT(${userData.petTask}, '$.questId')) = ${quest.id})`;
  // Restarting a quest must discard any stale tracker from prior attempts before recomputing.
  // An attempt that is still open is being re-entered, not restarted — a `start_quest`
  // objective consequence can name a quest the player is part way through — so keep its tracker.
  // A genuine restart always arrives with the row closed: completed, or ended by the daily reset
  // or abandon.
  const isOpenAttempt = !!entry && entry.completed === 0 && entry.endAt === null;
  const settleRecovery =
    !isOpenAttempt && quest.content.isolated && !getIsolatedPyramid(user);
  // Story grants also enter through this helper. History may need insertion, so a joined
  // UPDATE cannot publish isolation and earned recovery together. Keep this transaction short;
  // the UI/NPC assignment already supplies a transaction and its claimed account snapshot.
  if (settleRecovery && !inTransaction) {
    const assigned = await retryOnDeadlock(() =>
      client.transaction(async (tx) => {
        const claimedUser = { ...user };
        const result = await upsertQuestEntry(
          tx as unknown as DrizzleClient,
          claimedUser,
          quest,
          source,
          entry ?? null,
          true,
        );
        return { result, user: claimedUser };
      }),
    );
    Object.assign(user, assigned.user);
    return assigned.result;
  }
  const ticks = settleRecovery
    ? Math.max(0, Math.floor(secondsPassed(user.regenAt) / REGEN_SECONDS))
    : 0;
  const regen = user.regeneration * ticks;
  // Energy shares regenAt, so preserve its earned recovery before advancing that clock too.
  const recovery = settleRecovery
    ? {
        curHealth: Math.round(Math.min(user.curHealth + regen, user.maxHealth)),
        curChakra: Math.round(Math.min(user.curChakra + regen, user.maxChakra)),
        curStamina: Math.round(Math.min(user.curStamina + regen, user.maxStamina)),
        curEnergy: Math.min(user.curEnergy + regen, user.maxEnergy),
        regenAt: secondsFromDate(ticks * REGEN_SECONDS, user.regenAt),
      }
    : {};
  // Use the persisted pools/clock: a competing account write must not replay recovery
  // or overwrite the pools after the story's quest tracker has already been claimed.
  const recoveryTicks = sql`FLOOR(GREATEST(0, TIMESTAMPDIFF(MICROSECOND, ${userData.regenAt}, ${new Date(Date.now())})) / ${REGEN_SECONDS * 1_000_000})`;
  const poolRecovery = sql`${user.regeneration} * ${recoveryTicks}`;
  const recoveryUpdate = settleRecovery
    ? {
        curHealth: sql`ROUND(LEAST(${userData.curHealth} + ${poolRecovery}, ${userData.maxHealth}))`,
        curChakra: sql`ROUND(LEAST(${userData.curChakra} + ${poolRecovery}, ${userData.maxChakra}))`,
        curStamina: sql`ROUND(LEAST(${userData.curStamina} + ${poolRecovery}, ${userData.maxStamina}))`,
        curEnergy: sql`LEAST(${userData.curEnergy} + ${poolRecovery}, ${user.maxEnergy})`,
        regenAt: sql`TIMESTAMPADD(SECOND, ${recoveryTicks} * ${REGEN_SECONDS}, ${userData.regenAt})`,
      }
    : {};
  if (!isOpenAttempt) {
    user.questData = removeQuestTrackerByQuestId(user.questData, quest.id);
  }
  // Check if the quest has already been started
  if (entry) {
    const startedAt = new Date();
    promises.push(
      updateQuestHistoryForUpsertQuestEntry(
        client,
        startedAt,
        isOpenAttempt,
        quest,
        entry,
        professionContract,
        noDelegatedAttempt,
      ),
    );
    entry = {
      ...entry,
      startedAt,
      endAt: null,
      completed: 0,
      previousAttempts: entry.previousAttempts + 1,
      ...(!isOpenAttempt
        ? {
            entryPaid: false,
            isolated: quest.content.isolated ?? false,
            questVersion: quest.updatedAt,
          }
        : {}),
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
      entryPaid: false,
      isolated: quest.content.isolated ?? false,
      questVersion: quest.updatedAt,
    };
    // Idempotent on the (userId, questId) unique key: if a concurrent start (double-tap, or a
    // UI + overworld race, possibly past a stale `prevEntry`) already inserted the row, restart
    // it in place with the same mutation the update branch applies instead of throwing a
    // duplicate-key error. On the overworld path that throw would skip the caller's
    // clearActiveNpcQuest cleanup and strand the just-claimed NPC-mission slot.
    const duplicateUpdates = {
      startedAt: entry.startedAt,
      endAt: null,
      completed: 0,
      previousAttempts: sql`${questHistory.previousAttempts} + 1`,
      entryPaid: false,
      isolated: quest.content.isolated ?? false,
      questVersion: quest.updatedAt,
    };
    promises.push(
      insertQuestHistoryForUpsertQuestEntry(
        client,
        entry,
        duplicateUpdates,
        professionContract,
        noDelegatedAttempt,
      ),
    );
  }
  // Get updated trackers and update user
  user.userQuests = [
    ...user.userQuests.filter((row) => row.questId !== quest.id),
    { ...entry, quest },
  ];
  if (entry.isolated) user.status = "BATTLE";
  const trackerUser = await hydrateQuestCollections(client, user, inTransaction);
  const { trackers, consequences, notifications } = getNewTrackers(trackerUser, [
    { task: "any" },
  ]);
  // Target sectors depend on the rolled trackers, so their cached map read follows
  // tracker creation and precedes the same write that publishes the quest attempt.
  const targetSectors = getQuestTargetSectorsToCheck(user, trackers, true);
  if (targetSectors.length > 0) {
    const maps = await fetchPublishedSectorMaps(client, targetSectors).catch(
      (error: unknown) => {
        Sentry.captureException(error, {
          level: "warning",
          tags: { source: "questAssignmentTargets" },
        });
        return null;
      },
    );
    if (maps) snapQuestTargetsToReachable(user, trackers, maps);
  }
  promises.push(
    updateUserDataForUpsertQuestEntry(
      client,
      trackers,
      user,
      recoveryUpdate,
      entry,
      professionContract,
      quest,
    ),
  );
  // Drizzle builders are lazy; await them in order on PlanetScale's shared transaction session.
  if (inTransaction) {
    for (const promise of promises) await promise;
  } else {
    await Promise.all(promises);
  }
  Object.assign(user, recovery);
  user.questData = trackers;
  user.completedQuests = user.completedQuests.filter((row) => row.questId !== quest.id);
  // A concurrent delegation may preserve a different tracker/attempt. Immediate
  // effects also require reconciliation beyond the tracker-only assignment write.
  let userCacheEligible =
    !professionContract &&
    consequences.every((entry) => entry.type === "update_user") &&
    notifications.length === 0;
  if (userCacheEligible) {
    // Consecutive goals can unlock effects only after the initial tracker pass.
    // Probe a copy so completion flags cannot consume effects before their handler runs.
    const reconciled = getNewTrackers(structuredClone({ ...trackerUser, ...user }), [
      { task: "any" },
    ]);
    userCacheEligible =
      reconciled.consequences.every((entry) => entry.type === "update_user") &&
      reconciled.notifications.length === 0 &&
      JSON.stringify(reconciled.trackers) === JSON.stringify(trackers);
  }
  return {
    entry,
    userCacheEligible,
  };
};

export const insertNextQuest = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  type: QuestType,
) => {
  const history = await fetchUncompletedQuests(client, user, type);
  const nextQuest = history?.[0];
  if (nextQuest && nextQuest.questType !== "hunting") {
    const logEntry = await upsertQuestEntry(client, user, nextQuest, "system");
    return { ...logEntry.entry, quest: nextQuest };
  }
  return undefined;
};

/** Start only the same open, versioned attempt that was accepted through normal quest assignment. */
const petTaskAttemptCondition = (task: PetTask, userId: string) =>
  sql`EXISTS (SELECT 1 FROM ${questHistory} WHERE ${and(
    eq(questHistory.userId, userId),
    eq(questHistory.id, task.questHistoryId),
    eq(questHistory.questId, task.questId),
    eq(questHistory.startedAt, new Date(task.startedAt)),
    eq(questHistory.questVersion, new Date(task.questVersion)),
    eq(questHistory.completed, 0),
    isNull(questHistory.endAt),
    isNull(questHistory.pendingRewardChoice),
  )})`;

/** Content changes invalidate pending results; cancellation always remains available. */
const petTaskContentCondition = (task: PetTask, role: UserRole) =>
  sql`EXISTS (SELECT 1 FROM ${quest} WHERE ${and(
    eq(quest.id, task.questId),
    eq(quest.updatedAt, new Date(task.questVersion)),
    inArray(quest.questType, ["hunting", "gathering"]),
    gte(quest.petTaskMinutes, 1),
    lte(quest.petTaskMinutes, PET_TASK_MAX_MINUTES),
    canPlayHiddenQuests(role) ? undefined : eq(quest.hidden, false),
  )})`;

/** Explain invalid or unfinished tasks without discarding the player's ability to return safely. */
const petTaskReturnBlockMessage = (
  owner: Pick<UserData, "isBanned" | "isAi" | "status" | "battleId" | "role">,
  task: PetTask,
  contract: Quest | null | undefined,
  history:
    | {
        id: string;
        questId: string;
        startedAt: Date;
        questVersion: Date | null;
        completed: number;
        endAt: Date | null;
      }
    | null
    | undefined,
  pet: UserPet | null | undefined,
) => {
  if (owner.isBanned || owner.isAi)
    return "This account cannot collect task rewards. Return your companion without rewards.";
  if (!pet || !isPetAppearanceReady(pet) || pet.rank < PET_TASK_MIN_RANK)
    return "This companion is unavailable. Return without rewards.";
  if (
    !contract ||
    !isPetTaskContract(contract) ||
    contract.updatedAt.getTime() !== task.questVersion ||
    (contract.hidden && !canPlayHiddenQuests(owner.role))
  )
    return "This contract changed or is unavailable. Return your companion without rewards.";
  if (
    !isPetTaskAttempt(task, history) ||
    !history ||
    history.completed ||
    history.endAt ||
    history.questVersion?.getTime() !== task.questVersion
  )
    return "This contract attempt changed. Return your companion without rewards.";
  if (owner.status !== "AWAKE" || owner.battleId)
    return "Wake up and finish combat before collecting task rewards.";
  if (task.finishesAt > Date.now())
    return "Your companion is still working on this task.";
  return null;
};

type UserQuestFromGetReward = ReturnType<typeof getReward>["userQuest"];

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
 *   1. The completion compare-and-swap (when `resolved`): insert history if needed, then
 *      claim its completion. Isolated runs combine this with the account snapshot claim.
 *   2. `handleQuestConsequences` with `alwaysClaimUserState`, reverting a separate completion
 *      CAS if its account snapshot claim loses.
 *   3. Restoring the full trackers, the sensei +ryo mission bonus, the tier-bootstrap /
 *      repeatable-achievement re-arm prep, and `updateRewards` (run together).
 * Milestone fields join the guarded account UPDATE so competing quests cannot grant the
 * same level. They are not delivered separately in the ordinary post-claim reward payout.
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
  /** Delegated attempts claim the owner receipt and history together before normal final rewards. */
  petTask?: PetTask;
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
  const petTask = info.petTask;
  const milestoneLevel = resolved ? rewards.reward_level : undefined;
  // Validate before claiming history or delivering any objective or completion rewards.
  if (
    (milestoneLevel &&
      (eliteJoninMilestoneBlockMessage(user, milestoneLevel) ||
        !(rewards.reward_stats && rewards.reward_stats > 0))) ||
    (rewards.reward_rank === "ELITE JONIN" && eliteJoninExamBlockMessage(user))
  )
    return { outcome: "state_changed" };
  const milestonePatch = milestoneLevel
    ? eliteJoninMilestoneUpdate(user, milestoneLevel, rewards.reward_stats ?? 0)
    : undefined;
  if (user.petTask && user.petTask.questId === userQuest?.questId && !petTask)
    return { outcome: "state_changed" };
  if (
    petTask &&
    (!user.petTask ||
      JSON.stringify(user.petTask) !== JSON.stringify(petTask) ||
      !isPetTaskAttempt(petTask, userQuest))
  )
    return { outcome: "state_changed" };
  if (userQuest?.id === `party-${user.questPartyId}`) {
    // Helpers keep their original completion receipt; this also covers bound NPC objectives.
    user.questData = trackers;
    const helperClaim = await handleQuestConsequences(
      client,
      user,
      consequences,
      notifications,
      { alwaysClaimUserState: true, partyTrackers: trackers },
    );
    return helperClaim.claimed
      ? {
          outcome: "claimed",
          postNotifications: helperClaim.notifications,
          rewards: PostProcessedRewardSchema.parse({}),
          badges: [],
          rewardChoicePending: false,
          userCacheEligible: false,
          userDelta: undefined,
        }
      : { outcome: "state_changed" };
  }
  // Collective tokens are paid only by villageMission.claim, never personal history.
  if (userQuest?.quest.questType === "village_mission") {
    return { outcome: "not_found" };
  }
  const rewardChoice = resolved ? (info.rewardChoice ?? null) : null;
  const isolatedRun = getIsolatedPyramid(user);
  // A loaded reward must still belong to playable content when its write claims.
  // Visibility-only saves keep history valid, but any in-flight claim retries on
  // their new version; authored edits require the versioned run to restart.
  const liveQuestCondition = userQuest
    ? petTask
      ? petTaskContentCondition(petTask, user.role)
      : sql`EXISTS (SELECT 1 FROM ${quest} WHERE ${and(
          eq(quest.id, userQuest.questId),
          ne(quest.questType, "village_mission"),
          canPlayHiddenQuests(user.role) ? undefined : eq(quest.hidden, false),
          userQuest.quest.questType === "battlepyramid" || userQuest.isolated
            ? eq(quest.updatedAt, userQuest.quest.updatedAt)
            : undefined,
        )})`
    : undefined;
  const senseiId =
    user.rank === "GENIN" && userQuest?.quest.questType === "mission"
      ? user.senseiId
      : null;
  const [sensei, pvpAverage] = await Promise.all([
    senseiId ? findUserPvpRewardState(client, senseiId) : undefined,
    senseiId ? fetchPvpExperienceAverage(client) : undefined,
  ]);
  const senseiReward = Math.floor(
    boostPvpGain(
      SENSEI_STUDENT_RYO_PER_MISSION,
      getPvpBoost(sensei ?? {}, pvpAverage ? [pvpAverage] : []).totalPercent,
    ),
  );
  if (milestonePatch) {
    // Evaluate level-driven trackers against pending progression, then commit them together.
    const progress = getNewTrackers(
      { ...user, ...milestonePatch, questData: trackers },
      [{ task: "user_level", value: milestonePatch.level }],
    );
    trackers.length = 0;
    trackers.push(...progress.trackers);
    consequences.push(...progress.consequences);
    notifications.push(...progress.notifications);
  }
  const userDelta = getRewardUserDelta(rewards, 0, true);
  // Consequences can start battles or change inventory/quest relations outside this snapshot.
  const userCacheEligible =
    // Progression changes pools/stats that ordinary reward deltas do not represent.
    !milestonePatch &&
    !rewards.reward_titles?.length &&
    consequences.every((entry) => entry.type === "update_user") &&
    // Terminal isolation release is conditional on the current run at payout time.
    !(resolved && isolatedRun) &&
    !(resolved && userQuest?.quest.questType === "achievement") &&
    !(resolved && info.existingHistory === null);

  const collectionObjectiveIds = new Set(
    userQuest?.quest.questType === "gathering"
      ? userQuest.quest.content.objectives
          .filter((objective) => objective.task === "collect_item")
          .map((objective) => objective.id)
      : [],
  );
  const collectionBonuses =
    trackers
      .find((tracker) => tracker.id === userQuest?.questId)
      ?.goals.filter((goal) => goal.done && collectionObjectiveIds.has(goal.id))
      .map((goal) => goal.gatheringBonusQuantity ?? 0) ?? [];
  // Read before completion removes the tracker. A payout spanning multiple
  // collections uses their lowest captured yield so every required collection earns it.
  const gatheringBonusQuantity = collectionBonuses.length
    ? Math.min(...collectionBonuses)
    : 0;
  user.questData = filterQuestTrackersForDbPersist(trackers, user);
  // Attached members retain terminal contributions and personal collected flags so a later
  // team sync can recover a failed publication. New assignments already clear old trackers.
  const shouldRetainPartyTracker =
    !!userQuest && user.questParty?.questId === userQuest.questId;
  if (resolved && userQuest && !shouldRetainPartyTracker) {
    user.questData = removeQuestTrackerByQuestId(user.questData, userQuest.questId);
  }

  // Isolated, delegated and achievement-counted completions publish history with the
  // account snapshot, keeping run receipts and completion credit behind the same claim.
  // Other completions retain their history CAS and revert it if the snapshot claim loses.
  let resolvedCompletionCommitted = false;
  let claimManagedCompletion: typeof claimUserSnapshot | undefined;
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
        await insertQuestHistoryForCommitQuestObjectiveRewards(client, userId, {
          questId: userQuest.questId,
          quest: { questType: userQuest.quest.questType },
        });
      }
    }

    const retryDelay = userQuest?.quest?.retryDelay ?? "none";
    completedEndAt = getNextUserSnapshotAt(user.updatedAt);
    const cps =
      retryDelay === "none" ? undefined : periodStart(retryDelay, completedEndAt);
    periodCounterWritten = !!cps;

    const completionConditions = and(
      eq(questHistory.questId, userQuest?.questId ?? ""),
      eq(questHistory.userId, userId),
      eq(questHistory.completed, 0),
      isNull(questHistory.endAt),
      liveQuestCondition,
      ...(rewardChoice || petTask ? [isNull(questHistory.pendingRewardChoice)] : []),
    );
    // History-derived completion achievements must never observe a completion that
    // can still be reverted after a lost account snapshot claim.
    const countedCompletion =
      userQuest && Object.hasOwn(QuestCompletionTasks, userQuest.quest.questType);
    const managedRun = petTask || countedCompletion ? userQuest : isolatedRun;
    if (managedRun) {
      const completedAt = completedEndAt;
      // Joined UPDATE assignment order is unspecified, so decide period rollover from
      // the loaded history and guard those values instead of rereading a changed column.
      const startsNewPeriod =
        cps && (!managedRun.periodStartAt || managedRun.periodStartAt < cps);
      claimManagedCompletion = async ({ set, where = [] }) => {
        // Drizzle has no joined UPDATE builder. This single guarded write closes the run
        // and removes its tracker atomically; no payout can precede a successful claim.
        const result = await retryOnDeadlock(() =>
          executeResultForCommitQuestObjectiveRewards(
            client,
            completedAt,
            set,
            petTask,
            rewardChoice,
            cps,
            startsNewPeriod,
            userId,
            user,
            managedRun,
            completionConditions,

            where,
          ),
        );
        return { success: result.rowsAffected > 0, claimedAt: completedAt };
      };
    } else {
      const questCompletionResult =
        await updateQuestHistoryForCommitQuestObjectiveRewards(
          client,
          completedEndAt,
          rewardChoice,
          cps,
          completionConditions,
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
  }

  const { notifications: postNotifications, claimed } = await handleQuestConsequences(
    client,
    user,
    consequences,
    notifications,
    {
      alwaysClaimUserState: true,
      claimUserState: claimManagedCompletion,
      partyTrackers: trackers,
      progressionUpdate: milestonePatch,
      // Unresolved objectives have no completion CAS; guard their payout at the snapshot claim.
      claimConditions: [
        liveQuestCondition,
        // Recheck earned progression and exam caps at the guarded account write.
        ...(milestonePatch || rewards.reward_rank === "ELITE JONIN"
          ? [
              eq(userData.level, user.level),
              eq(userData.rank, user.rank),
              ...(rewards.reward_rank === "ELITE JONIN"
                ? [
                    gte(userData.offence, getUserCaps("JONIN").stats_cap),
                    gte(userData.defence, getUserCaps("JONIN").stats_cap),
                    ...(
                      ["strength", "speed", "intelligence", "willpower"] as const
                    ).map((stat) => gte(userData[stat], getUserCaps("JONIN").gens_cap)),
                  ]
                : []),
            ]
          : []),
        ...(isolatedRun && !petTask
          ? [
              eq(userData.status, "BATTLE"),
              isNull(userData.battleId),
              isolatedRun.questId === userQuest?.questId ? undefined : sql`FALSE`,
            ]
          : []),
        ...(!resolved && userQuest && userQuest.quest.questType !== "achievement"
          ? [
              sql`EXISTS (SELECT 1 FROM ${questHistory} WHERE ${questHistory.questId} = ${userQuest.questId} AND ${questHistory.userId} = ${userId} AND ${questHistory.completed} = 0 AND ${questHistory.endAt} IS NULL)`,
            ]
          : []),
      ],
    },
  );

  if (!claimed) {
    if (claimManagedCompletion && userQuest) {
      const history = await fetchUserQuestByQuestId(client, userId, userQuest.questId);
      if (!history) return { outcome: "not_found" };
      if (history.completed >= 1) return { outcome: "already_completed" };
      if (rewardChoice && history.pendingRewardChoice)
        return { outcome: "choice_pending" };
    }
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
  if (petTask) user.petTask = null;
  if (milestonePatch) {
    postNotifications.push(
      `Milestone complete: level ${milestonePatch.level}, +${rewards.reward_stats} to each combat stat (up to rank caps).`,
    );
  }

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
  const releaseIsolation =
    resolved &&
    isolatedRun?.questId === userQuest?.questId &&
    !!info.postClaimUserDataPatch?.status;
  const releasedAt = new Date();
  const energyRecovery = releaseIsolation
    ? getUserRegenerationGain(user, releasedAt)
    : 0;
  const energyPatch =
    energyReward > 0 || releaseIsolation
      ? {
          maxEnergy: user.maxEnergy,
          curEnergy: sql`LEAST(${user.maxEnergy}, ${userData.curEnergy} + ${energyReward} + ${releaseIsolation ? userRegenerationGainSql(user, userData.regenAt, releasedAt) : sql`0`})`,
          ...(releaseIsolation ? { regenAt: releasedAt } : {}),
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
    pvpBoostApplied: true,
    client,
    user:
      petTask && userQuest
        ? {
            ...user,
            occupation:
              userQuest.quest.questType === "hunting" ? "HUNTER" : "GATHERING",
          }
        : user,
    rewards,
    questCounterField,
    questFinishedAt: farmRewardAt,
    reason: "QUEST",
    // Opt in to the herbs_gathered tracker: this is the gathering-claim path and `user`
    // here is the fully-hydrated row (with quest relations).
    questUser: user,
    gatheringBonusQuantity,
    postClaimUserDataPatch: mergedUserDataPatch,
    dropTrackerForQuestId:
      resolved && !shouldRetainPartyTracker ? userQuest?.questId : undefined,
  });

  // Update database. Chain the farm bonus after payout so a failed reward write cannot still
  // shorten crop timers and the established completion/snapshot/payout ordering is preserved.
  const [rewardResult, farmRewardResult] = await Promise.all([
    rewardPromise,
    shouldReduceFarmTimers
      ? rewardPromise.then(reduceFarmTimers)
      : Promise.resolve(null),
    resolved && userQuest
      ? rewardPromise.then(() =>
          recordVillageMissionProgress(
            client,
            user.villageId,
            userId,
            villageMissionCompletionEvents(userQuest.quest),
          ),
        )
      : Promise.resolve(),
    // Credit the sensei their per-mission ryo bonus
    ...(senseiId
      ? [
          incrementUserMoney(client, senseiReward, senseiId),
          insertBankTransfersForCommitQuestObjectiveRewards(
            client,
            userId,
            senseiId,
            senseiReward,
          ),
        ]
      : []),
  ]);
  const { items, jutsus, bloodlines, badges, sageModes, titles } = rewardResult;
  if (releaseIsolation) {
    user.status = "AWAKE";
    user.regenAt = releasedAt;
  }
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
      {
        id: entry?.id ?? userQuest.id,
        questId: userQuest.questId,
        completed: 1,
        questType: userQuest.quest.questType,
        previousCompletes:
          entry?.previousCompletes ?? (userQuest.previousCompletes ?? 0) + 1,
      },
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
  if (energyReward > 0 || releaseIsolation)
    user.curEnergy = Math.min(
      user.maxEnergy,
      user.curEnergy + energyReward + energyRecovery,
    );

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
  rewards.reward_titles = titles.map((i) => i.name);

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

/**
 * Apply consequences after handleQuestConsequences claims the user's snapshot.
 * Battle rejections join the existing notifications, leaving the claimed quest
 * state intact and exposing unavailable allies or insufficient spawn capacity.
 */
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
  // Combat preloads trackers without the live party relation; both carry receipt ownership.
  const partyQuestId =
    user.questParty?.questId ??
    user.questData?.find(
      (tracker) => tracker.party && tracker.party.id === user.questPartyId,
    )?.id;
  const closeQuests =
    endedQuestIds.length > 0
      ? updateQuestHistoryForExecuteClaimedQuestConsequences(
          client,
          endedQuestIds,
          user,
          partyQuestId,
        )
      : undefined;
  // Ending a run frees its Pyramid slot before a replacement can claim it. Completed
  // history may already be closed while the caller's quest projection is still open.
  if (startedQuestIds.length > 0) await closeQuests;
  await Promise.all([
    startedQuestIds.length === 0 ? closeQuests : undefined,
    ...(startedQuestIds.length > 0
      ? [
          (async () => {
            const quests = await listQuestsByIds(client, startedQuestIds);
            // Runs after the user snapshot is already committed, so a throw here would burn the
            // objective without starting the quest. Content edits or migrations can strand
            // edges to quests that cannot be personally assigned; skip those destinations.
            const startable = quests.filter(
              (q) =>
                // Managed runs must reach upsertQuestEntry's persisted recovery guards.
                (q.questType === "battlepyramid" ||
                  q.content.entryItems?.length ||
                  !user.userQuests.some(
                    (entry) =>
                      entry.questId === q.id &&
                      !entry.endAt &&
                      entry.id !== `party-${user.questPartyId}`,
                  )) &&
                q.questType !== "hunting" &&
                !isRestrictedQuestType(q.questType) &&
                q.questType !== "village_mission" &&
                !(q.questType === "mission" && q.questRank === "S"),
            );
            // Assignments share trackers. Isolated grants use their publication transaction
            // to claim the Pyramid slot before inserting history, even with a stale projection.
            for (const nextQuest of startable) {
              if (
                nextQuest.questType === "battlepyramid" &&
                nextQuest.content.isolated
              ) {
                const assigned = await retryOnDeadlock(() =>
                  client.transaction(async (tx) => {
                    const database = tx as unknown as DrizzleClient;
                    const claim = await claimUserSnapshot({
                      client: database,
                      userId: user.userId,
                      updatedAt: user.updatedAt,
                      where: [
                        inArray(userData.status, ["AWAKE", "BATTLE"]),
                        isNull(userData.battleId),
                        notExists(
                          selectQuestHistoryForWhere2(database, user, nextQuest),
                        ),
                      ],
                    });
                    if (!claim.success) return undefined;
                    const claimedUser = { ...user, updatedAt: claim.claimedAt };
                    await upsertQuestEntry(
                      database,
                      claimedUser,
                      nextQuest,
                      "quest_objective",
                      undefined,
                      true,
                    );
                    return claimedUser;
                  }),
                );
                if (!assigned) {
                  notifications.push(
                    `Could not start ${nextQuest.name}: your account changed or another Pyramid is active.`,
                  );
                  continue;
                }
                Object.assign(user, assigned);
              } else {
                await upsertQuestEntry(client, user, nextQuest, "quest_objective");
              }
              notifications.push(`Started new quest: ${nextQuest.name}`);
            }
          })(),
        ]
      : []),
    ...(collectedItems.length > 0
      ? [insertUserItemForExecuteClaimedQuestConsequences(client, collectedItems, user)]
      : []),
    ...(removedUserItemIds.length > 0
      ? [
          // The quantity guard refuses rows held by a stack-merge claim (negative quantity), so
          // this delete can never break an in-flight merge publish and duplicate the stack.
          deleteUserItemsWithPositiveQuantity(client, removedUserItemIds),
        ]
      : []),
    ...[
      opponent
        ? (async () => {
            if (user.questParty && opponent.questId === user.questParty.questId) {
              const result = await startQuestPartyEncounter({
                client,
                user,
                userId: user.userId,
                partyId: user.questParty.id,
                ambush: opponent,
              });
              if (!result.success) notifications.push(result.message);
              return;
            }
            const result = await initiateBattle(
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
                questBattleSource:
                  opponent.questId && opponent.objectiveId
                    ? { questId: opponent.questId, objectiveId: opponent.objectiveId }
                    : undefined,
                givePools: opponent.givePools,
                startingEffects: opponent.startingEffects,
                questAttempt: opponent.questId
                  ? user.userQuests.find(
                      (entry) =>
                        entry.questId === opponent.questId &&
                        !entry.endAt &&
                        (entry.questType === "battlepyramid" ||
                          !!entry.quest.content.entryItems?.length),
                    )
                  : undefined,
                // Honour the player's stored preference for quest fights and random
                // encounters (including hunting) alike; initiateBattle gates on
                // AutoCombatBattleTypes, which admits every non-PvP battle type.
                autoCombatUserIds: user.defaultAutoCombat ? [user.userId] : undefined,
              },
              opponent.type === "random_encounter" ? "RANDOM_ENCOUNTER" : "QUEST",
              opponent.scaleGains ?? 1,
            );
            if (!result.success) notifications.push(result.message);
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
    /** Isolated terminal runs claim history and the account in one joined statement. */
    claimUserState?: typeof claimUserSnapshot;
    partyTrackers?: QuestTrackerType[];
    /** Progression fields committed in the same CAS as the completed objectives. */
    progressionUpdate?: ReturnType<typeof eliteJoninMilestoneUpdate>;
    /** Conditions that must still hold when the reward/consequence snapshot is claimed. */
    claimConditions?: QueryCondition[];
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
  // Each delivery retires one owned row per distinct item ID, including missed receipts.
  const removedItemCounts = new Map<string, number>();
  for (const consequence of removed) {
    for (const id of new Set(consequence.ids)) {
      removedItemCounts.set(id, (removedItemCounts.get(id) ?? 0) + 1);
    }
  }
  const missingItemIds = [...removedItemCounts]
    .filter(
      ([id, count]) => user.items.filter((item) => item.itemId === id).length < count,
    )
    .map(([id]) => id);
  // Profile snapshots carry equipped items only; shared deliveries must also retire
  // unequipped quest copies. Read additional rows only when the snapshot lacks enough.
  const additionalItems =
    missingItemIds.length > 0
      ? await listUserItemForHandleQuestConsequences(client, user, missingItemIds)
      : [];
  const ownedItems = [...user.items, ...additionalItems];
  const removedUserItemIds = [...removedItemCounts].flatMap(([id, count]) =>
    [
      ...new Set(
        ownedItems.filter((item) => item.itemId === id).map((item) => item.id),
      ),
    ].slice(0, count),
  );
  // Opponents to attack
  let opponent = consequences.find((c) => c.type === "combat");
  // Objective attackers ambush a player who is out travelling, so they are rolled only for the
  // movement check (checkLocationQuest) of an awake player. Page loads (getUser), reward claims
  // and battle retries must never start a random encounter on their own.
  if (!opponent && options?.rollObjectiveAttackers && user.status === "AWAKE") {
    const partyObjectiveIds = new Set(
      user.questParty?.quest.content.objectives.map((objective) => objective.id) ?? [],
    );
    const objectives = getActiveObjectives(user).filter(
      (objective) =>
        !partyObjectiveIds.has(objective.id) ||
        user.questParty?.leaderId === user.userId,
    );
    opponent = rollObjectiveAttackers(
      objectives,
      user.sector,
      undefined,
      (objective) =>
        partyObjectiveIds.has(objective.id) ? user.questParty?.questId : undefined,
    );
    if (opponent) notifications.push("You have been attacked!");
  }
  // If quests were reset, update the user's quest data
  if (resetQuests.length > 0) {
    // Managed runs resume their authored checkpoint without waiting for a manual retry.
    user.questData = applyQuestResets(
      user.questData,
      resetQuests,
      (questId) =>
        !user.userQuests.some(
          (entry) =>
            entry.questId === questId &&
            !entry.endAt &&
            (entry.questType === "battlepyramid" ||
              !!entry.quest.content.isolated ||
              !!entry.quest.content.entryItems?.length),
        ),
    );
  }
  // Database updates
  const shouldClaimUserState =
    options?.alwaysClaimUserState ||
    notifications.length > 0 ||
    consequences.length > 0;

  if (shouldClaimUserState) {
    const claimResult = await (options?.claimUserState ?? claimUserSnapshot)({
      client,
      userId: user.userId,
      updatedAt: user.updatedAt,
      where: [
        ...(options?.claimConditions ?? []),
        ...(user.questParty ? [eq(userData.questPartyId, user.questParty.id)] : []),
      ],
      set: {
        ...options?.progressionUpdate,
        questData: filterQuestTrackersForDbPersist(user.questData ?? [], user),
      },
    });

    if (claimResult.success) {
      // Consequences may unlock a quest or start combat that needs the committed level.
      if (options?.progressionUpdate) Object.assign(user, options.progressionUpdate);
      try {
        if (
          resetQuests.some((reset) =>
            reset.ids.includes(user.questParty?.questId ?? ""),
          )
        )
          await resetQuestPartyProgress(client, user);
        await publishQuestPartyProgress(
          client,
          user,
          options?.partyTrackers ?? user.questData ?? [],
        );
      } catch (error) {
        // Personal progress is already guarded; defer shared reset/publication failures
        // so they cannot interrupt this claim's consequences or reward payout.
        Sentry.captureException(error, {
          level: "warning",
          tags: { source: "publishQuestPartyProgress" },
        });
        notifications.push("Quest team progress will update on your next request.");
      }
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

      return { notifications, claimed: true, battleAttempted: !!opponent };
    }
  }
  return { notifications, claimed: !shouldClaimUserState, battleAttempted: false };
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

  const placements = await listOverworldAiPlacementForPrepareOverworldBindings(
    client,
    placementIds,
  );
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
 * Resolves pending reward-choice offers for display: one query per referenced content type,
 * run together. Packages keep their original cards while child rewards supply lookup ids.
 * Offers that no longer parse are skipped rather than failing the list.
 */
export const resolveRewardChoiceDisplays = async (
  client: DrizzleClient,
  user: Pick<UserData, "userId" | "sageModeId" | "masteryRanks">,
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
  const expandedCards = offers.flatMap((offer) =>
    offer.cards.flatMap((card) =>
      card.rewards ? buildRewardChoiceCards(card.rewards) : [card],
    ),
  );
  const idsFor = (field: RewardChoiceCard["field"]) => [
    ...new Set(
      expandedCards.flatMap((card) =>
        card.field === field && card.contentId ? [card.contentId] : [],
      ),
    ),
  ];
  const itemIds = idsFor("reward_items");
  const jutsuIds = idsFor("reward_jutsus");
  const bloodlineIds = idsFor("reward_bloodlines");
  const sageModeIds = idsFor("reward_sage_modes");
  const badgeIds = idsFor("reward_badges");
  const titleIds = idsFor("reward_titles");
  const [items, jutsus, bloodlines, sageModes, badges, titles, ownership] =
    await Promise.all([
      itemIds.length > 0
        ? selectItemForResolveRewardChoiceDisplays(client, itemIds)
        : [],
      jutsuIds.length > 0
        ? selectJutsuForResolveRewardChoiceDisplays(client, jutsuIds)
        : [],
      bloodlineIds.length > 0
        ? selectBloodlineForResolveRewardChoiceDisplays(client, bloodlineIds)
        : [],
      sageModeIds.length > 0
        ? selectSageModeForResolveRewardChoiceDisplays(client, sageModeIds)
        : [],
      badgeIds.length > 0
        ? selectBadgeForResolveRewardChoiceDisplays(client, badgeIds)
        : [],
      titleIds.length
        ? selectTitleForResolveRewardChoiceDisplays(client, titleIds)
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
  register("reward_titles", titles);

  return offers.map((offer) => {
    const unavailable = getUnavailableRewardCards(offer.cards, ownership);
    return {
      questId: offer.questId,
      questName: offer.questName,
      choiceId: offer.id,
      pickCount: offer.pickCount,
      cards: offer.cards.map((card) => {
        const unavailableReason = unavailable.get(card.id) ?? null;
        if (card.field === "reward_package")
          return {
            ...card,
            name: card.packageName ?? "Reward Package",
            image: null,
            rarity: null,
            description: null,
            includedRewards: card.rewards
              ? describePackageRewards(card.rewards, content)
              : [],
            unavailableReason,
          };
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

/**
 * Scalar rewards compose with accepted cache updates; derived state needs reconciliation.
 * Pet XP needs a refresh because its committed amount depends on live SQL eligibility.
 */
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
    (rewards.reward_titles?.length ?? 0) > 0 ||
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
    (rewards.reward_pet_experience ?? 0) !== 0 ||
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

/** Describe complete bundle contents with resolved names and original item quantities/chances. */
const describePackageRewards = (
  reward: import("@/validators/rewards").ObjectiveRewardType,
  content: ReadonlyMap<string, { name: string }>,
) => {
  const entries = buildRewardChoiceCards(reward)
    .filter((card) => card.field !== "reward_items")
    .map((card) =>
      card.contentId
        ? (content.get(`${card.field}:${card.contentId}`)?.name ?? "Unknown reward")
        : `${card.amount.toLocaleString()} ${REWARD_CHOICE_AMOUNT_LABELS[card.field as RewardChoiceAmountField]}`,
    );
  for (const item of reward.reward_items)
    for (const id of item.ids)
      entries.push(
        `${item.quantity ?? 1} × ${content.get(`reward_items:${id}`)?.name ?? "Unknown item"} (${item.number}% chance)`,
      );
  if (reward.reward_rank !== "NONE") entries.push(`Rank: ${reward.reward_rank}`);
  if (reward.reward_village_membership !== "NONE")
    entries.push(`Village: ${reward.reward_village_membership}`);
  if (reward.reward_mastery_rank && reward.reward_mastery_rank !== "NONE")
    entries.push(`${reward.reward_mastery_stat}: ${reward.reward_mastery_rank}`);
  if (reward.reward_hunter_items) entries.push("Hunting material drops");
  if (reward.reward_gathering_items) entries.push("Gathering material drops");
  return entries;
};
/**
 * Run deferred reward queries or writes, retaining parallel phases for ordinary callers.
 * Transaction callers must pass unevaluated tasks: each statement starts after the previous
 * statement supplies the driver's next session token. Results preserve the input tuple order.
 */
export const runRewardTasks =
  (inTransaction: boolean) =>
  async <T extends readonly (() => unknown)[]>(
    tasks: readonly [...T],
  ): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> => {
    if (!inTransaction)
      return Promise.all(tasks.map((task) => task())) as Promise<{
        [K in keyof T]: Awaited<ReturnType<T[K]>>;
      }>;
    const results: unknown[] = [];
    for (const task of tasks) results.push(await task());
    return results as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
  };
