import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getUserProgressionUpdate } from "@/deltas/profile";
import {
  getCancelPetTaskUserUpdate,
  getClaimedRewardChoiceUserUpdate,
  getCollectPetTaskUserUpdate,
  getQuestRewardProjectionUpdate,
  getQuestStartUserUpdate,
  getRetryBattleUserUpdate,
  getRewardUserDelta,
  getStartPetTaskUserUpdate,
  getUnchangedRewardChoiceUserUpdate,
} from "@/deltas/quests";
import {
  LetterRanks,
  MISSION_HALL_QUEST_TYPES,
  PET_TASK_MIN_RANK,
  type QuestType,
  QuestTypes,
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
import { actionPrerequisiteUser } from "@/libs/actionReadiness";
import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import { isQuestPresentationOnlyChange } from "@/libs/mapLocations";
import { canRetryQuestBattle } from "@/libs/objectives";
import {
  deriveOverworldOpponents,
  validateFriendlyPlacementBindings,
} from "@/libs/overworldAi";
import { isPetAppearanceReady } from "@/libs/pets/progression";
import {
  isPetTaskAttempt,
  isPetTaskContract,
  PET_TASK_IN_PROGRESS_MESSAGE,
  petTaskDispatchBlockMessage,
} from "@/libs/pets/tasks";
import { eliteJoninExamBlockMessage } from "@/libs/profile";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  getQuestTargetSectorsToCheck,
} from "@/libs/quest";
import { isAvailableUserQuests, listUpcomingQuests } from "@/libs/quest/availability";
import {
  filterMissionHallQuests,
  getMissionHallSettings,
  isQuestRankAllowed,
  isWarMissionAvailable,
  missionHallStartBlockedMessage,
  questDailyLimitMessage,
  questDailyQuota,
  questTypeConcurrentBlockMessage,
  questUiAccessBlockMessage,
} from "@/libs/quest/missionHall";
import {
  controlShownQuestLocationInformation,
  getPublicQuestUser,
} from "@/libs/quest/projection";
import {
  type GetRewardResult,
  getExperienceTrackerTasks,
  getReward,
  postProcessRewards,
} from "@/libs/quest/rewards";
import { verifyQuestContentForSave } from "@/libs/quest/validation";
import {
  getIsolatedPyramid,
  getQuestEntryStock,
  ISOLATED_PYRAMID_MESSAGE,
  isBetweenPyramidBattles,
  isManagedQuestRun,
  questAttemptBlockMessage,
} from "@/libs/questRun";
import { availableRanks } from "@/libs/rank";
import {
  buildRewardChoiceCards,
  getUnavailableRewardCards,
  REWARD_CHOICE_AMOUNT_LABELS,
  REWARD_CHOICE_PENDING_MESSAGE,
  REWARD_CHOICE_READY_MESSAGE,
  rewardChoiceContentIds,
  rewardFromChoiceCards,
  validateQuestRewardPackages,
  validateRewardPicks,
  verifyRewardChoiceForSave,
} from "@/libs/rewardChoice";
import { collapseRewards } from "@/libs/rewards";
import { callDiscordContent } from "@/libs/socials";
import { fetchActionUser } from "@/queries/actionReadiness";
import {
  fetchUser,
  fetchViewerRole,
  findOwnedUserPet,
  findUserById,
  invalidateAchievementCatalogue,
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
  fetchBoundPlacementStatus,
  fetchQuest,
  fetchQuestAvailabilityCandidates,
  fetchQuestDiscoveryCandidates,
  fetchQuestsStartingQuest,
  fetchRestrictedNewQuestTargets,
  fetchRewardChoiceOwnership,
  fetchUserQuestByQuestId,
  findQuestHistoryForCheckRewards,
  findQuestHistoryForClaimRewardChoice,
  findQuestHistoryForCollectPetTask,
  findUserDataForGet,
  findUserDataForGetPendingRewardChoices,
  findUserDataForGetPetTask,
  insertActionLogForDelete,
  insertActionLogForDeleteUserQuest,
  insertActionLogForUpdate,
  insertQuestForClone,
  insertQuestForCreate,
  listCarriedItemsForQuestEntry,
  listOverworldAiPlacementForPrepareOverworldBindings,
  listQuestForGetAll,
  listQuestForGetAllNames,
  listQuestHistoryForGetPendingRewardChoices,
  listQuestHistoryForGetQuestHistory,
  listQuestHistoryForGetUserQuests,
  listRewardPackageForUpdate,
  selectBadgeForResolveRewardChoiceDisplays,
  selectBloodlineForResolveRewardChoiceDisplays,
  selectItemForResolveRewardChoiceDisplays,
  selectJutsuForResolveRewardChoiceDisplays,
  selectQuestForStartRandom,
  selectQuestForUpdate,
  selectSageModeForResolveRewardChoiceDisplays,
  selectTitleForResolveRewardChoiceDisplays,
  updateQuestForUpdate,
  updateQuestHistoryForAbandon,
  updateQuestHistoryForClaimRewardChoice,
  updateQuestHistoryForClaimRewardChoice2,
  updateQuestHistoryForUpdate,
  updateQuestHistoryForUpdate2,
  updateUserDataForAbandon,
  updateUserQuestData,
} from "@/queries/quests";
import { fetchSectorVillage } from "@/queries/village";
import { fetchUserItems } from "@/routers/item";
import {
  fetchPublishedAchievements,
  fetchUpdatedUser,
  type UserWithRelations,
} from "@/routers/profile";
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
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { setEmptyStringsToNulls } from "@/server/utils/emptyStrings";
import {
  fetchPublicQuestLocations,
  notifyMapLocationsChanged,
  validateQuestStructures,
} from "@/server/utils/mapLocations";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { offsetPage } from "@/server/utils/pagination";
import { consumeUserAnnouncements } from "@/server/utils/profile";
import {
  assignQuestToUser,
  claimDailyQuestSlot,
  isNpcOnlyQuestType,
  isRestrictedQuestType,
  upsertQuestEntries,
  upsertQuestEntry,
} from "@/server/utils/questAssignment";
import {
  commitQuestObjectiveRewards,
  handleQuestConsequences,
  petTaskContentCondition,
} from "@/server/utils/questConsequences";
import { nameGrantedRewards, updateRewards } from "@/server/utils/questRewards";
import { validateTitleRewardIds } from "@/server/utils/titleRewards";
import { getRandomElement } from "@/utils/array";
import { calculateContentDiff } from "@/utils/diff";
import {
  canAbandonQuestType,
  canAwardReputation,
  canChangeContent,
  canEditQuests,
  canEditStarterQuests,
  canPlayHiddenQuests,
  isRestrictedToSelf,
} from "@/utils/permissions";
import { getNextUserSnapshotAt, secondsFromDate, secondsFromNow } from "@/utils/time";
import { canAccessStructure } from "@/utils/village";
import { inventoryQuantityChangeSchema } from "@/validators/inventory";
import { idSchema } from "@/validators/misc";
import {
  type AllObjectivesType,
  QuestTracker,
  QuestValidator,
} from "@/validators/objectives";
import { petSelectionSchema } from "@/validators/pets";
import { type PetTask, petTaskSchema } from "@/validators/petTasks";
import { questFilteringSchema } from "@/validators/quest";
import { rewardPayloads } from "@/validators/rewardPackages";
import {
  ClaimRewardChoiceSchema,
  hasPromotionRank,
  type ObjectiveRewardType,
  PendingRewardChoiceSchema,
  PostProcessedRewardSchema,
  type RewardChoiceAmountField,
  type RewardChoiceCard,
  type RewardChoiceDisplay,
  RewardChoiceDisplaySchema,
} from "@/validators/rewards";
import { userDeltaResponseSchema } from "@/validators/userCache";

/** The displayed attempt identity prevents a stale cancel or claim from affecting a later task. */
const petTaskActionSchema = petTaskSchema.pick({
  petId: true,
  questHistoryId: true,
  startedAt: true,
});

/** Dispatch accepts catalogue IDs only; occupation, duration and availability are server-owned. */
const startPetTaskSchema = petSelectionSchema.extend({
  questId: z.string().min(1).max(191),
});

export const questsRouter = createTRPCRouter({
  /** Public scenery exposes neutral presentation, never quest steps or player progress. */
  getPublicLocations: publicProcedure
    .input(
      z
        .object({
          revision: z.number().int().nonnegative().optional(),
          // Cache-only publication key; revision alone guards server-worker catalogue freshness.
          refreshKey: z.number().int().optional(),
        })
        .optional(),
    )
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
      const { skip, cursorAfter } = offsetPage(input);
      const [viewerRole, results] = await Promise.all([
        fetchViewerRole(ctx.drizzle, ctx.userId),
        listQuestForGetAll(ctx.drizzle, input, skip),
      ]);
      results.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      // Paginate on the raw page so a hidden NPC-only quest shortens a page rather than
      // truncating the infinite scroll early.
      const nextCursor = cursorAfter(results);
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
        villageId: z.string().nullish(),
        level: z.number().nullish(),
        rank: z.array(z.enum(LetterRanks)).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      const [user, events, inventory] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchQuestDiscoveryCandidates(ctx.drizzle, ctx.userId, {
          questTypes: ["event"],
          villageId: input.villageId ?? undefined,
          level: input.level ?? 0,
          ranks: input.rank,
        }),
        listCarriedItemsForQuestEntry(ctx.drizzle, ctx),
      ]);
      events.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      return events
        .filter((e) => isAvailableUserQuests(e, user, true).check)
        .map((entry) => ({
          ...entry,
          entryRequirements: getQuestEntryStock(entry.content, inventory),
        }));
    }),
  missionHall: protectedProcedure
    .meta({
      mcp: { description: "Get available missions from mission hall" },
    })
    .input(z.object({ villageId: z.string(), level: z.number() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [user, missions, activeWars] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchQuestAvailabilityCandidates(ctx.drizzle, ctx.userId, {
          questTypes: [...MISSION_HALL_QUEST_TYPES],
          villageId: input.villageId,
          level: input.level,
        }),
        fetchActiveWars(ctx.drizzle, input.villageId, ctx.userId),
      ]);
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
      const [user, quests, inventory] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchQuestDiscoveryCandidates(ctx.drizzle, ctx.userId, {
          questTypes: [input.questType],
          level: input.level,
        }),
        listCarriedItemsForQuestEntry(ctx.drizzle, ctx),
      ]);
      quests.forEach((r) => {
        controlShownQuestLocationInformation(r);
      });
      return quests
        .filter((e) => isAvailableUserQuests(e, user, true).check)
        .map((entry) => ({
          ...entry,
          entryRequirements: getQuestEntryStock(entry.content, inventory),
        }));
    }),
  upcomingQuests: protectedProcedure
    .meta({
      mcp: {
        description: "Get quests of a type the user still needs a level or mastery for",
      },
    })
    .input(z.object({ questType: z.enum(QuestTypes) }))
    .query(async ({ ctx, input }) => {
      if (isRestrictedQuestType(input.questType)) {
        return [];
      }
      // Query without the level cap so quests above the user's level are included
      const [user, quests] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchQuestAvailabilityCandidates(ctx.drizzle, ctx.userId, {
          questTypes: [input.questType],
        }),
      ]);
      if (!user) return [];
      return listUpcomingQuests(quests, user);
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
        // Older clients recover announcements through getUser rather than displaying response feedback.
        supportsAnnouncements: z.boolean().optional(),
      }),
    )
    .output(
      userDeltaResponseSchema.extend({
        inventoryChanges: z.array(inventoryQuantityChangeSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updatedUser, sectorVillage, results] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          includeAnnouncementsInResponse: input.supportsAnnouncements === true,
        }),
        fetchSectorVillage(ctx.drizzle, input.userSector),
        // Random missions/crimes/errands/medical/pvp all resolve the candidate pool the same
        // way (same LEFT JOIN + filters); the quest type is already carried by the
        // `eq(quest.questType, input.type)` predicate, so no per-type query branch is needed.
        // Farming, bloodline and sage requirements are checked by isAvailableUserQuests
        // after the user refresh, so this query can run alongside it.
        selectQuestForStartRandom(ctx.drizzle, ctx, input),
      ]);
      const { user: initialUser } = updatedUser;
      if (!initialUser) return errorResponse("User does not exist");
      const readiness = prepareActionReadiness(initialUser, updatedUser.settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const { rankInfo } = filterMissionHallQuests(results, user, input.type);

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

      // Reserve the slot before delivering a quest, including when another start races us.
      if (
        quota &&
        !(await claimDailyQuestSlot(ctx.drizzle, user, input.type, readiness))
      ) {
        return errorResponse(
          readiness.where
            ? "Your activity or daily quest quota changed. Please try again."
            : questDailyLimitMessage(input.type, quota.limit),
        );
      }
      const assignment = await upsertQuestEntry(
        ctx.drizzle,
        user,
        result,
        "random_assignment",
        // The LEFT JOIN already loaded this row; a null is the idempotent insert branch.
        result.history,
        false,
        quota ? undefined : readiness,
      );
      if (!assignment.recoveryCommitted)
        return errorResponse("Your activity changed. Please try again.");
      return actionReadinessResponse(
        {
          success: true,
          message: `Quest started: ${result.name}${rankInfo}`,
          ...(assignment.userCacheEligible && !updatedUser.requiresProgressionRefresh
            ? getQuestStartUserUpdate(
                user,
                updatedUser.publishedAchievementIds,
                await consumeUserAnnouncements(ctx.drizzle, user),
                [],
              )
            : {}),
        },
        readiness,
        ctx.drizzle,
      );
    }),
  startQuest: protectedProcedure
    .meta({ mcp: { description: "Start a specific quest by ID" } })
    .input(
      z.object({
        questId: z.string(),
        userSector: z.number(),
        supportsAnnouncements: z.boolean().optional(),
      }),
    )
    .output(
      userDeltaResponseSchema.extend({
        inventoryChanges: z.array(inventoryQuantityChangeSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const [updatedUser, sectorVillage, questData, prevAttempt] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true, // Force regeneration to ensure we have latest quest data
          includeAnnouncementsInResponse: input.supportsAnnouncements === true,
        }),
        fetchSectorVillage(ctx.drizzle, input.userSector),
        fetchQuest(ctx.drizzle, input.questId),
        fetchUserQuestByQuestId(ctx.drizzle, ctx.userId, input.questId),
      ]);

      // Cheap pre-fetch guards (UI-only)
      const { user: initialUser } = updatedUser;
      if (!initialUser) return errorResponse("User does not exist");
      if (!questData) return errorResponse("Quest does not exist");
      const requiresAwake =
        MISSION_HALL_QUEST_TYPES.includes(questData.questType) ||
        isManagedQuestRun(questData);
      const readiness = requiresAwake
        ? prepareActionReadiness(initialUser, updatedUser.settings)
        : undefined;
      if (readiness?.error) return errorResponse(readiness.error);
      const user = readiness?.user ?? initialUser;
      if (user.sector !== input.userSector) return errorResponse("Sector mismatch");
      if (user.isBanned) return errorResponse("You are banned");
      const asleepBlock = missionHallStartBlockedMessage(
        questData.questType,
        user.status,
      );
      if (asleepBlock) return errorResponse(asleepBlock);

      const { userCacheEligible, inventoryChanges, ...result } =
        await assignQuestToUser({
          client: ctx.drizzle,
          user,
          quest: questData,
          source: "ui",
          sectorVillage,
          prevAttempt,
          readiness,
        });
      return actionReadinessResponse(
        {
          ...result,
          ...(result.success &&
          userCacheEligible === true &&
          !updatedUser.requiresProgressionRefresh &&
          questData.questType !== "war"
            ? getQuestStartUserUpdate(
                user,
                updatedUser.publishedAchievementIds,
                await consumeUserAnnouncements(ctx.drizzle, user),
                inventoryChanges,
              )
            : {}),
        },
        result.success ? readiness : undefined,
        ctx.drizzle,
        result.success ? { status: user.status, battleId: user.battleId } : undefined,
      );
    }),
  abandon: protectedProcedure
    .meta({ mcp: { description: "Abandon an active quest" } })
    .input(idSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const snapshot = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const { user } = snapshot;
      if (!user) return errorResponse("User does not exist");
      const current = user.userQuests.find((q) => q.questId === input.id && !q.endAt);
      if (user.petTask?.questId === input.id)
        return errorResponse(
          "Return your companion from the Tasks tab before abandoning this contract.",
        );
      if (user.questParty?.questId === input.id)
        return errorResponse("Leave your quest team before abandoning this quest");
      if (!current) {
        return {
          success: true,
          message: `Quest already abandoned`,
          ...(snapshot.requiresProgressionRefresh === false
            ? getUserProgressionUpdate(user, snapshot.publishedAchievementIds)
            : {}),
        };
      }
      if (!canAbandonQuestType(user.role, current.questType)) {
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
      const trackers = user.questData?.filter((q) => q.id !== input.id) ?? [];
      const questData = filterQuestTrackersForDbPersist(trackers, user);
      // Hunting, gathering and isolated attempts also hold account state, so abandoning
      // them takes the same joined release as a managed run.
      const managedRun =
        isManagedQuestRun({
          questType: current.questType,
          content: current.quest.content,
        }) ||
        current.questType === "hunting" ||
        current.questType === "gathering" ||
        current.isolated;
      const now = new Date();
      if (managedRun) {
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
          updateQuestHistoryForAbandon(ctx.drizzle, current, now),
          updateUserDataForAbandon(ctx.drizzle, questData, input, ctx, now),
        ]);
      }
      const canProject =
        snapshot.requiresProgressionRefresh === false &&
        !current.quest.teamEnabled &&
        !["tier", "daily", "achievement"].includes(current.questType) &&
        !current.isolated;
      Object.assign(user, {
        questData: trackers,
        questFinishAt: now,
        ...(managedRun
          ? { updatedAt: getNextUserSnapshotAt(user.updatedAt, now) }
          : {}),
        ...(user.activeNpcQuestId === input.id ? { activeNpcQuestId: null } : {}),
        userQuests: user.userQuests.filter((entry) => entry.id !== current.id),
      });
      return {
        success: true,
        message: `Quest abandoned`,
        ...(canProject
          ? getUserProgressionUpdate(user, snapshot.publishedAchievementIds)
          : {}),
      };
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
      const { skip, cursorAfter } = offsetPage(input);
      const results = await listQuestHistoryForGetQuestHistory(
        ctx.drizzle,
        ctx,
        skip,
        input,
      );
      const nextCursor = cursorAfter(results);
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
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to edit quest");
      }
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
        data.content.reward.reward_reputation = entry.content.reward.reward_reputation;
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
      const rankError =
        (collapseRewards(rewardPayloads(data.content.reward)).reward_rank !== "NONE" &&
          !["starter", "exam"].includes(data.questType)) ||
        (data.questType !== "exam" &&
          data.content.objectives.some(
            (objective) =>
              collapseRewards(rewardPayloads(objective)).reward_rank !== "NONE",
          ));
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
      await invalidateAchievementCatalogue();
      await Promise.all([
        // Village Missions retire personal attempts without granting completions
        // or reclassifying completed history as collective progress.
        data.questType === "village_mission"
          ? updateQuestHistoryForUpdate(ctx.drizzle, entry)
          : updateQuestHistoryForUpdate2(ctx.drizzle, input, entry, updatedAt),
        insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry),
      ]);
      // Assign a quest that just became an event only once the edit has been saved;
      // re-saving does not repeat it, so a failed assignment needs a manual re-run.
      if (entry.questType !== "event" && input.data.questType === "event") {
        const roles = availableRanks(input.data.questRank);
        await upsertQuestEntries(
          ctx.drizzle,
          { ...entry, ...input.data, updatedAt },
          and(
            inArray(userData.rank, roles),
            gte(userData.updatedAt, secondsFromNow(-60 * 60 * 24 * 7)),
          ),
        );
      }
      await notifyMapLocationsChanged();
      await outdateProposalsFor(
        ctx.drizzle,
        "QUEST",
        [entry.id],
        editedReason("QUEST", entry.name, user.username),
      );
      await callDiscordContent(user.username, entry.name, diff, entry.image);
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
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
      await invalidateAchievementCatalogue();
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
      if (canChangeContent(user.role)) {
        // Shared invalidation must finish even when independent cleanup fails.
        const writes = await Promise.allSettled([
          deleteQuestForDelete(ctx.drizzle, input).then(invalidateAchievementCatalogue),
          deleteQuestHistoryForDelete(ctx.drizzle, input),
          deleteRaidParticipationForDelete(ctx.drizzle, input),
          deleteRaidDamageThresholdForDelete(ctx.drizzle, input),
          deleteUserRaidBuffForDelete(ctx.drizzle, input),
          deleteOverworldAiPlacementQuestForDelete(ctx.drizzle, input),
          deleteUserQuestAttemptForDelete(ctx.drizzle, input),
          insertActionLogForDelete(ctx.drizzle, ctx, entry),
        ]);
        const failed = writes.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
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
  /**
   * Return the accepted task and recovery-capable availability without changing activity.
   * Missing content still leaves cancellation available.
   */
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
          ? petTaskReturnBlockMessage(
              actionPrerequisiteUser(owner),
              task,
              contract,
              history,
              pet,
            )
          : null,
        dispatchBlockMessage: petTaskDispatchBlockMessage(
          actionPrerequisiteUser(owner),
          owner.pets.find((entry) => entry.id === input?.petId),
        ),
      };
    }),

  /** Accept the normal profession contract, then reserve one exact attempt and companion. */
  startPetTask: protectedProcedure
    .input(startPetTaskSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [snapshot, contract, previous, pet] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId, forceRegen: true }),
        fetchQuest(ctx.drizzle, input.questId),
        fetchUserQuestByQuestId(ctx.drizzle, ctx.userId, input.questId),
        findOwnedUserPet(ctx.drizzle, input.petId, ctx.userId),
      ]);
      const { user: initialUser } = snapshot;
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, snapshot.settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
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
          readiness,
          where: [
            isNull(userData.petTask),
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
      if (!claim.success)
        return errorResponse(
          "The contract is accepted, but your character changed before dispatch. Refresh and send your companion again.",
        );
      user.updatedAt = claim.claimedAt;
      user.petTask = task;
      user.questData =
        user.questData?.filter((tracker) => tracker.id !== contract.id) ?? [];
      user.userQuests = [
        ...user.userQuests.filter((entry) => entry.questId !== contract.id),
        { ...history, quest: contract },
      ];
      // Entry costs normally consume carried materials. Equipped entry rows alter
      // passive sources and require authoritative equipment reconciliation.
      const consumedWornItem = contract.content.entryItems?.some((cost) =>
        user.items.some((owned) => cost.ids.includes(owned.itemId)),
      );
      const projection =
        snapshot.requiresProgressionRefresh === false && !consumedWornItem
          ? getUserProgressionUpdate(user, snapshot.publishedAchievementIds)
          : undefined;
      return actionReadinessResponse(
        {
          success: true,
          message: `${pet.name} left to complete ${contract.name}.`,
          ...(projection
            ? {
                ...projection,
                ...getStartPetTaskUserUpdate({
                  projectionUserPatch: projection.userPatch,
                  task,
                }),
              }
            : {}),
        },
        readiness,
        ctx.drizzle,
      );
    }),

  /** Claim only the final configured reward through the normal quest completion guards. */
  collectPetTask: protectedProcedure
    .input(petTaskActionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [snapshot, history, pet] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        findQuestHistoryForCollectPetTask(ctx.drizzle, input, ctx),
        findOwnedUserPet(ctx.drizzle, input.petId, ctx.userId),
      ]);
      const { user: initialUser, settings } = snapshot;
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
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
        readiness,
      });
      if (claim.outcome !== "claimed")
        return errorResponse(
          "Task state changed. Refresh and collect its results again.",
        );
      // The claim owns its task/history changes; unsupported rounded and companion
      // grants retain canonical recovery through the existing reward delta contract.
      const scalarRewards = getRewardUserDelta(claim.rewards, 0, true);
      const canProjectRewards =
        snapshot.requiresProgressionRefresh === false &&
        claim.userCacheEligible &&
        scalarRewards !== undefined &&
        claim.rewards.reward_exp === 0;
      const refreshed = getNewTrackers(user, [{ task: "any" }]);
      user.questData = refreshed.trackers;
      const projectedIds = new Set(user.userQuests.map((entry) => entry.questId));
      const projection =
        canProjectRewards &&
        user.petTask === null &&
        refreshed.consequences.length === 0 &&
        !snapshot.progressionQuestCandidates.some(
          (entry) =>
            entry.quest.questType === "achievement" &&
            !projectedIds.has(entry.questId) &&
            isAvailableUserQuests({ ...entry.quest, ...entry }, user, true).check,
        ) &&
        getQuestTargetSectorsToCheck(user, user.questData ?? []).length === 0
          ? getUserProgressionUpdate(user, snapshot.publishedAchievementIds)
          : undefined;
      return actionReadinessResponse(
        {
          ...(projection
            ? {
                ...projection,
                ...getCollectPetTaskUserUpdate({
                  projectionUserPatch: projection.userPatch,
                  claimUserDelta: claim.userDelta,
                }),
              }
            : {}),
          success: true,
          message: `${pet.name} returned from ${history.quest.name}.${claim.rewardChoicePending ? " Choose your rewards in the Logbook." : ""}`,
          rewards: claim.rewards,
          notifications: claim.postNotifications,
          rewardChoicePending: claim.rewardChoicePending,
        },
        readiness,
        ctx.drizzle,
        claim.committedActivity,
      );
    }),

  /** Return safely without rewards, including deleted content and a missing/restarted attempt. */
  cancelPetTask: protectedProcedure
    .input(petTaskActionSchema)
    .output(userDeltaResponseSchema)
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
        ? {
            success: true,
            message: "Your companion returned without task rewards.",
            ...getCancelPetTaskUserUpdate({
              ownerUpdatedAt: owner.updatedAt,
              now,
              taskQuestHistoryId: task.questHistoryId,
              taskStartedAt: task.startedAt,
            }),
          }
        : errorResponse(
            "Task state changed. Refresh and try returning your companion again.",
          );
    }),

  checkRewards: protectedProcedure
    .meta({ mcp: { description: "Check and claim quest rewards" } })
    .input(z.object({ questId: z.string(), nextObjectiveId: z.string().optional() }))
    .output(
      userDeltaResponseSchema.extend({
        // Only a newly committed Genin graduation carries a conversion receipt.
        tutorialCompletionId: z.string().optional(),
        // Confirmed counters are optional; absent projections retain the full refetch path.
        questCacheUpdate: z
          .object({
            questId: z.string(),
            before: z.object({
              previousCompletes: z.number(),
              periodCompletes: z.number(),
              periodStartAt: z.date().nullable(),
            }),
            after: z.object({
              previousAttempts: z.number(),
              previousCompletes: z.number(),
              periodCompletes: z.number(),
              periodStartAt: z.date().nullable(),
            }),
            discoveryUnchanged: z.boolean(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Reward payout follows the history/account claim; isolated runs publish both together.
      const [
        {
          user: initialUser,
          toastMessages,
          settings,
          requiresProgressionRefresh,
          requiresUserRefresh,
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
      if (!initialUser) {
        return errorResponse("User does not exist");
      }
      const readiness =
        initialUser.status === "BATTLE"
          ? undefined
          : prepareActionReadiness(initialUser, settings);
      if (readiness?.error) return errorResponse(readiness.error);
      const user = readiness?.user ?? initialUser;
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
      const attemptBlock =
        activeAttempt && questAttemptBlockMessage(activeAttempt, user.role);
      if (attemptBlock) return errorResponse(attemptBlock);

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
        readiness,
        requiresDiscoveryRefresh: requiresUserRefresh,
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

      const finalNotifications = [...toastMessages, ...claim.postNotifications];
      if (claim.rewardChoicePending) {
        finalNotifications.push(REWARD_CHOICE_READY_MESSAGE);
      }

      const refreshedTrackers = getNewTrackers(user, [{ task: "any" }]);
      user.questData = refreshedTrackers.trackers;
      return actionReadinessResponse(
        {
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
          ...(resolved && userQuest?.questId === TUTORIAL_GENIN_EXAM_QUEST_ID
            ? { tutorialCompletionId: userQuest.id }
            : {}),
          rewardChoicePending: claim.rewardChoicePending,
          questCacheUpdate: claim.questCacheUpdate,
          ...getQuestRewardProjectionUpdate({
            user: user,
            requiresProgressionRefresh,
            userCacheEligible: claim.userCacheEligible,
            delta: claim.userDelta,
            consequences: refreshedTrackers.consequences,
            progressionQuestCandidates,
            publishedAchievementIds,
          }),
        },
        readiness,
        ctx.drizzle,
        claim.committedActivity,
      );
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
          ...getUnchangedRewardChoiceUserUpdate({ user }),
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
      const granted = await updateRewards({
        pvpBoostApplied: true,
        client: ctx.drizzle,
        user,
        rewards,
        reason: "QUEST",
        persistQuestData: false,
      });
      nameGrantedRewards(rewards, granted);
      return {
        success: true,
        message: `Claimed rewards from ${questName}`,
        rewards,
        badges: granted.badges,
        ...getClaimedRewardChoiceUserUpdate({ user, rewards }),
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
        inventoryChanges: z.array(inventoryQuantityChangeSchema).optional(),
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

      user.questData = filterQuestTrackersForDbPersist(trackers, user);

      // Handle consequences
      const {
        notifications: finalNotification,
        battleAttempted,
        inventoryChanges,
      } = await handleQuestConsequences(
        ctx.drizzle,
        user,
        consequences,
        notifications,
        {
          rollObjectiveAttackers: true,
        },
      );

      user.questData = trackers;
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
        inventoryChanges:
          !inventoryRecovered &&
          !craftingItemsChanged &&
          !battleAttempted &&
          trackerResults.consequences.every((entry) => entry.type === "update_user")
            ? inventoryChanges
            : undefined,
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
      if (!canEditQuests(user.role)) {
        return errorResponse("Not authorized to delete user quests");
      }
      if (!targetUser.user) {
        return errorResponse("Target user not found");
      }
      // Roles that can only edit themselves
      if (isRestrictedToSelf(user.role, user.userId, input.userId)) {
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
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const snapshot = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        hideInformation: false,
      });
      const { user: initialUser } = snapshot;
      // Guard
      if (!initialUser) return errorResponse("User does not exist");
      const readiness =
        initialUser.status === "BATTLE"
          ? undefined
          : prepareActionReadiness(initialUser, snapshot.settings);
      if (readiness?.error) return errorResponse(readiness.error);
      const user = readiness?.user ?? initialUser;
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
      const attemptBlock =
        activeAttempt && questAttemptBlockMessage(activeAttempt, user.role);
      if (attemptBlock) return errorResponse(attemptBlock);
      // Get updated quest information with start_battle task and retry flag
      const { trackers, notifications, consequences } = getNewTrackers(user, [
        { task: "start_battle", text: "retry" },
      ]);
      user.questData = trackers;
      // Handle consequences
      const {
        notifications: finalNotification,
        claimed,
        battleAttempted,
        battleUserUpdate,
        committedActivity,
      } = await handleQuestConsequences(
        ctx.drizzle,
        user,
        consequences,
        notifications,
        { readiness },
      );
      // Return information
      const canProject =
        claimed &&
        (!battleAttempted || battleUserUpdate) &&
        snapshot.requiresProgressionRefresh === false &&
        !user.questParty &&
        !user.queue?.length &&
        !user.currentlyTrainingMastery &&
        !user.currentlyTrainingElement &&
        consequences.every(
          (entry) => entry.type === "combat" || entry.type === "update_user",
        ) &&
        getQuestTargetSectorsToCheck(user, user.questData ?? []).length === 0;
      const committedBattlePatch = canProject ? battleUserUpdate?.userPatch : undefined;
      const projection =
        canProject && (!battleAttempted || committedBattlePatch)
          ? getUserProgressionUpdate(user, snapshot.publishedAchievementIds)
          : undefined;
      return actionReadinessResponse(
        {
          success: true,
          message: [...snapshot.toastMessages, ...finalNotification].join("\n"),
          ...(projection
            ? {
                ...projection,
                ...getRetryBattleUserUpdate({
                  projectionUserPatch: projection.userPatch,
                  committedBattlePatch,
                  battleAttempted,
                  battleUserUpdateUserDelta: battleUserUpdate?.userDelta,
                }),
              }
            : {}),
        },
        claimed ? readiness : undefined,
        ctx.drizzle,
        committedActivity,
      );
    }),
});

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
  if (task.finishesAt > Date.now()) return PET_TASK_IN_PROGRESS_MESSAGE;
  return null;
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
  const ambient = placements.filter(
    (placement) => placement.interactionType === "AMBIENT",
  );
  if (ambient.length > 0) {
    return {
      success: false,
      message: `Ambient overworld placements offer no interaction and cannot be bound: ${ambient.map((placement) => placement.id).join(", ")}`,
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
const resolveRewardChoiceDisplays = async (
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
  const idsFor = rewardChoiceContentIds(offers.flatMap((offer) => offer.cards));
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
const advanceRewardChoiceTrackers = async (
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

/** Describe complete bundle contents with resolved names and original item quantities/chances. */
const describePackageRewards = (
  reward: ObjectiveRewardType,
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
  if (hasPromotionRank(reward))
    entries.push(`${reward.reward_mastery_stat}: ${reward.reward_mastery_rank}`);
  if (reward.reward_hunter_items) entries.push("Hunting material drops");
  if (reward.reward_gathering_items) entries.push("Gathering material drops");
  return entries;
};
