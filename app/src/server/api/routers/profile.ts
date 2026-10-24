import * as Sentry from "@sentry/nextjs";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { customAlphabet, nanoid } from "nanoid";
import { z } from "zod";
import type { CombatStatName, MasteryName } from "@/drizzle/constants";
import {
  ACTION_LOG_RELATED_MSG_MAX_LENGTH,
  ACTIVE_VOTING_SITES,
  ALLIANCEHALL_LAT,
  ALLIANCEHALL_LONG,
  BasicElementName,
  COST_CHANGE_USERNAME,
  CombatStatNames,
  getTavernColorChangeCost,
  getUserCaps,
  IMG_AVATAR_DEFAULT,
  KAGE_DEFENSE_REMINDER_HOURS,
  KAGE_MIN_PRESTIGE,
  KAGE_PRESTIGE_REQUIREMENT,
  MAX_ATTRIBUTES,
  MAX_SKILL_POINTS,
  MasteryNames,
  REGEN_SECONDS,
  SENSEI_MAX_STUDENT_LEVEL,
  SHRINE_BOOST_TYPES,
  SKILL_POINT_MAX_LEVEL,
  SKILL_POINT_MIN_LEVEL,
  STRONGEST_USERS_COUNT,
  shrineLobbyFreshAfter,
  TUTORIAL_STEPS_COUNT,
  UserRanks,
  UserRolesWithSkillTreeAccess,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import type {
  Bloodline,
  BloodlineReskin,
  Clan,
  Item,
  Quest,
  SageMode,
  UserData,
  UserItem,
  UserJutsu,
  UserQuest,
  UserQueue,
  UserTitle,
  UserVote,
  Village,
  VillageAlliance,
  VillageStructure,
} from "@/drizzle/schema";
import {
  abEvent,
  actionLog,
  battleHistory,
  contentProposal,
  farmPlot,
  gameSetting,
  historicalIp,
  item,
  jutsu,
  jutsuReskin,
  mpvpBattleQueue,
  notification,
  poll,
  quest,
  questHistory,
  questParty,
  raidParticipation,
  recruitmentRewards,
  sageMode,
  staffApplication,
  staffApplicationApproval,
  supportTicket,
  trainingLog,
  userAttribute,
  userBlackList,
  userData,
  userItem,
  userItemImbuement,
  userJutsu,
  userNindo,
  userPet,
  userPollVote,
  userQueue,
  userReport,
  userSkill,
  userVote,
  village,
  war,
} from "@/drizzle/schema";
import { getReskinnedBloodline } from "@/libs/bloodline";
import { bloodrightSwapRefund } from "@/libs/bloodright";
import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import { getWorldCyclePosition } from "@/libs/dayNight";
import { elementalGainRoom } from "@/libs/elementalMastery";
import { getGameSettingBoost } from "@/libs/gameSettingBoost";
import { getGameSetting, updateGameSetting } from "@/libs/gamesettings";
import { getLayoutExperimentAssignments } from "@/libs/layoutPreference";
import {
  effectiveMasteries,
  type MasterySources,
  type MasteryStatSource,
} from "@/libs/mastery";
import { allocateMasteryGains } from "@/libs/masteryProgression";
import type { NavBarDropdownLink } from "@/libs/menus";
import { moderateContent, validateUserUpdateReason } from "@/libs/moderator";
import { isQuestComplete } from "@/libs/objectives";
import { isNewOnlineRecord } from "@/libs/onlineRecord";
import { petExperienceGainSql } from "@/libs/pets/experience";
import { hasActiveGeneration } from "@/libs/pets/progression";
import {
  calcActiveUserRegen,
  calcCP,
  calcEnergy,
  calcHP,
  calcMaxEnergy,
  calcSP,
  canAssignExperience,
  clampStoredPools,
  experienceAssignmentBlockMessage,
  getAssignedCombatStatTotal,
  levelUpBlockMessage,
  scaleUserStats,
} from "@/libs/profile";
import { getServerPusher } from "@/libs/pusher";
import { boostPvpGain, getPvpBoost } from "@/libs/pvpExperience";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  getPublicQuestUser,
  getQuestMaxLevel,
  getQuestTargetSectorsToCheck,
  isAvailableUserQuests,
  mockAchievementHistoryEntries,
  questHasOverworldObjectives,
  snapQuestTargetsToReachable,
} from "@/libs/quest";
import { getIsolatedPyramid } from "@/libs/questRun";
import { hasEnergyQueue } from "@/libs/queue";
import {
  getRaidObjectiveData,
  isRaidListedForVillage,
  raidRewardBlockMessage,
} from "@/libs/raids";
import { createThumbnail } from "@/libs/replicate";
import { callDiscordContent } from "@/libs/socials";
import {
  getTimedRegeneration,
  getTimedRegenerationGain,
  type TimedBuff,
} from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";
import {
  applyMasteryTrainingGains,
  getReducedGainsDays,
  inferJutsuTrainingStartedAt,
  settleQueuedTraining,
} from "@/libs/train";
import { fetchSquad, removeFromSquad } from "@/routers/anbu";
import { fetchClan, removeFromClan } from "@/routers/clan";
import { fetchKageReplacement } from "@/routers/kage";
import { handleQuestConsequences, insertNextQuest } from "@/routers/quests";
import { fetchVillage, fetchVillages } from "@/routers/village";
import { deleteUser } from "@/server/api/routers/staff";
import { fetchEventNotices } from "@/server/api/routers/tournamentEvents";
import {
  baseServerResponse,
  cdnCachedProcedure,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { scopedRead } from "@/server/requestScope";
import {
  activityCompletionExtras,
  completedQuestHistoryRelation,
} from "@/server/utils/achievementObjectives";
import {
  adjustSeichiSilverAtomically,
  claimUserSnapshot,
} from "@/server/utils/concurrency";
import { settleCookingExperience } from "@/server/utils/cooking";
import { scheduleDiscordSync } from "@/server/utils/discord/sync";
import { setEmptyStringsToNulls } from "@/server/utils/emptyStrings";
import { hashIp } from "@/server/utils/ipHash";
import {
  elementalSnapshotConditions,
  masteryGainUpdates,
} from "@/server/utils/masteryProgression";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { resumeBracketImmunitySql } from "@/server/utils/objectiveWar";
import { buildDerivedUserRegenUpdate } from "@/server/utils/profileRegen";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import { hydrateQuestCollections } from "@/server/utils/questCollections";
import { fetchQuestDiscoverySummaryCandidates } from "@/server/utils/questDiscovery";
import {
  applyQuestParty,
  type LoadedQuestParty,
  questPartyRelations,
  synchronizeQuestParty,
} from "@/server/utils/questParty";
import {
  awardRecruitRankMilestonesSafely,
  fetchRecruitMilestoneSummary,
} from "@/server/utils/recruitment";
import {
  getUserRegenerationGain,
  userRegenerationGainSql,
} from "@/server/utils/regeneration";
import { retainSanctionIps } from "@/server/utils/sanctionTombstone";
import { fetchPublishedSectorMaps } from "@/server/utils/sectorMap";
import { displayTitleSql } from "@/server/utils/titleDisplay";
import {
  fetchJutsuQueueSummary,
  hasDueTimedJob,
  settleDueTimedQueues,
  settleJutsuTrainingQueue,
} from "@/server/utils/userQueue";
import { activeWarAllyWhere } from "@/server/utils/warAlly";
import { fetchMercenaryWarId } from "@/server/utils/warMercenary";
import { getRandomElement } from "@/utils/array";
import { calculateContentDiff } from "@/utils/diff";
import { getKageSetupDeadline } from "@/utils/kage";
import {
  canAwardExperience,
  canChangeContent,
  canChangeUserRolesTo,
  canDeleteUsers,
  canEditBloodline,
  canEditItems,
  canEditJutsus,
  canEditRank,
  canEditRankedLp,
  canEditSeichiSilver,
  canEditStaffAccountFlag,
  canEditUsername,
  canEditVillage,
  canInteractWithPolls,
  canModerateRoles,
  canOnlyEditSelf,
  canResetPetImageGeneration,
  canSeeIps,
  canSeeSecretData,
  getApprovalGroup,
} from "@/utils/permissions";
import { checkForBadWords } from "@/utils/profanity";
import sanitize from "@/utils/sanitize";
import {
  getTimeOfLastReset,
  isDifferentDay,
  secondsFromDate,
  secondsFromNow,
  secondsPassed,
} from "@/utils/time";
import { countBoostingShrines, getShrineBoost } from "@/utils/village";
import { insertAiSchema } from "@/validators/aiInput";
import { mutateContentSchema } from "@/validators/comments";
import { idSchema } from "@/validators/misc";
import { attributes, colors, skin_colors, usernameSchema } from "@/validators/register";
import {
  isReservedCustomTitle,
  RESERVED_CUSTOM_TITLE_MESSAGE,
} from "@/validators/reservedName";
import type { GetPublicUsersSchema } from "@/validators/user";
import {
  adjustSeichiSilverSchema,
  assignableMasteryNames,
  createAssignedExperienceSchema,
  getPublicUsersSchema,
  resetPetImageGenerationSchema,
  tavernColorChangeSchema,
  updateUserPreferencesSchema,
  updateUserSchema,
} from "@/validators/user";
import { userDeltaResponseSchema } from "@/validators/userCache";

const pusher = getServerPusher();

export const profileRouter = createTRPCRouter({
  getDashboard: protectedProcedure
    .meta({
      mcp: {
        description: "Get compact profile dashboard discovery and reward summaries",
      },
    })
    .query(async ({ ctx }) => {
      const [candidates, raidParticipations] = await Promise.all([
        fetchQuestDiscoverySummaryCandidates(ctx.drizzle, ctx.userId, {
          questTypes: [
            "event",
            "mission",
            "errand",
            "crime",
            "medical",
            "pvp",
            "war",
            "story",
            "battlepyramid",
          ],
        }),
        ctx.drizzle.query.raidParticipation.findMany({
          where: eq(raidParticipation.userId, ctx.userId),
          columns: {
            damageDealt: true,
            rewardsClaimed: true,
          },
          with: {
            quest: {
              columns: { id: true, name: true },
              with: {
                raidDamageThresholds: {
                  columns: { id: true, damageRequired: true },
                },
              },
            },
          },
        }),
      ]);

      // Participation history can outlive a deleted raid; only existing raids
      // can contribute dashboard progress or claimable rewards.
      const existingRaidParticipations = raidParticipations.filter(
        (participation) => participation.quest,
      );
      const raidRewards = existingRaidParticipations.flatMap((participation) => {
        const claimableCount = participation.quest.raidDamageThresholds.filter(
          (threshold) => !raidRewardBlockMessage(participation, threshold),
        ).length;
        if (claimableCount === 0) return [];
        return [
          {
            raidId: participation.quest.id,
            raidName: participation.quest.name,
            claimableCount,
          },
        ];
      });

      return {
        // Dashboard discovery shows published content even for staff who can play hidden quests.
        candidates: candidates.filter((candidate) => !candidate.hidden),
        raidProgress: existingRaidParticipations.map((participation) => ({
          raidId: participation.quest.id,
          damageDealt: participation.damageDealt,
        })),
        raidRewards,
      };
    }),
  getSidebarTimers: protectedProcedure.query(async ({ ctx }) => {
    const now = sql`NOW()`;
    const imbuedItem = alias(item, "imbuedItem");

    // The running training and the levels waiting behind it, each in one query.
    const fetchJutsuTimers = () =>
      Promise.all([
        ctx.drizzle
          .select({
            name: sql<string>`COALESCE(${jutsuReskin.name}, ${jutsu.name})`,
            level: userJutsu.level,
            jutsuRank: jutsu.jutsuRank,
            requiredRank: jutsu.requiredRank,
            finishTraining: userJutsu.finishTraining,
            senseiId: userData.senseiId,
            rank: userData.rank,
          })
          .from(userJutsu)
          .innerJoin(jutsu, eq(userJutsu.jutsuId, jutsu.id))
          .innerJoin(userData, eq(userJutsu.userId, userData.userId))
          .leftJoin(jutsuReskin, eq(userJutsu.reskinId, jutsuReskin.id))
          .where(
            and(eq(userJutsu.userId, ctx.userId), gt(userJutsu.finishTraining, now)),
          )
          .orderBy(asc(userJutsu.finishTraining))
          .limit(1),
        fetchJutsuQueueSummary(ctx.drizzle, ctx.userId),
      ]);
    let [[jutsuTrainingRows, waitingJutsu], craftingRows, imbuementRows] =
      await Promise.all([
        fetchJutsuTimers(),
        ctx.drizzle
          .select({
            itemName: item.name,
            craftingStartedAt: userItem.createdAt,
            craftingFinishedAt: userItem.craftingFinishedAt,
          })
          .from(userItem)
          .innerJoin(item, eq(userItem.itemId, item.id))
          .where(
            and(eq(userItem.userId, ctx.userId), gt(userItem.craftingFinishedAt, now)),
          )
          .orderBy(asc(userItem.craftingFinishedAt))
          .limit(1),
        ctx.drizzle
          .select({
            imbuedName: imbuedItem.name,
            targetName: item.name,
            craftingStartedAt: userItemImbuement.createdAt,
            craftingFinishedAt: userItemImbuement.craftingFinishedAt,
          })
          .from(userItemImbuement)
          .innerJoin(userItem, eq(userItemImbuement.userItemId, userItem.id))
          .innerJoin(item, eq(userItem.itemId, item.id))
          .innerJoin(imbuedItem, eq(userItemImbuement.imbuementItemId, imbuedItem.id))
          .where(
            and(
              eq(userItem.userId, ctx.userId),
              gt(userItemImbuement.craftingFinishedAt, now),
            ),
          )
          .orderBy(asc(userItemImbuement.craftingFinishedAt))
          .limit(1),
      ]);
    // A queued jutsu level whose turn has come only becomes `UserJutsu` training once
    // settled. The timers are polled on their own, so settle here too: the dashboard and
    // sidebar never show an idle gap between a finished level and the next queued one.
    // Only a due row costs more queries; then only the jutsu timers are read again.
    if (hasDueTimedJob(waitingJutsu)) {
      try {
        // Started levels and rescheduled ones both change what is shown.
        await settleJutsuTrainingQueue(ctx.drizzle, ctx.userId);
        [jutsuTrainingRows, waitingJutsu] = await fetchJutsuTimers();
      } catch (error) {
        // Show the queue as it is; the next poll or refresh settles it.
        Sentry.captureException(error, {
          level: "warning",
          tags: { source: "sidebarJutsuQueue" },
        });
      }
    }
    const nextQueuedJutsu = waitingJutsu[0];

    const jutsuTrainingRow = jutsuTrainingRows[0];
    const crafting = craftingRows[0];
    const jutsuTraining = jutsuTrainingRow?.finishTraining
      ? {
          name: jutsuTrainingRow.name,
          level: jutsuTrainingRow.level,
          trainingStartedAt: inferJutsuTrainingStartedAt(
            jutsuTrainingRow.finishTraining,
            {
              jutsuRank: jutsuTrainingRow.jutsuRank,
              requiredRank: jutsuTrainingRow.requiredRank,
            },
            jutsuTrainingRow.level,
            { senseiId: jutsuTrainingRow.senseiId, rank: jutsuTrainingRow.rank },
          ),
          finishTraining: jutsuTrainingRow.finishTraining,
        }
      : null;

    return {
      jutsuTraining,
      // Levels waiting behind the active jutsu training
      jutsuQueue: {
        count: waitingJutsu.length,
        next: nextQueuedJutsu
          ? {
              name: nextQueuedJutsu.name ?? "Removed jutsu",
              // The first waiting entry trains one level past what is owned now.
              level: (nextQueuedJutsu.ownedLevel ?? 0) + 1,
              startsAt: nextQueuedJutsu.startsAt,
            }
          : null,
      },
      crafting: crafting?.craftingFinishedAt
        ? { ...crafting, craftingFinishedAt: crafting.craftingFinishedAt }
        : null,
      imbuement: imbuementRows[0] ?? null,
    };
  }),
  // Update battle description setting
  updateBattleDescription: protectedProcedure
    .meta({
      mcp: { description: "Toggle battle description visibility" },
    })
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
  // Update tutorial step
  updateTutorialStep: protectedProcedure
    .meta({
      mcp: { description: "Update user's tutorial progress step" },
    })
    .input(z.object({ step: z.number() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Update the database
      await ctx.drizzle
        .update(userData)
        .set({ tutorialStep: input.step })
        .where(eq(userData.userId, ctx.userId));

      // AB Test success. Loaded events are only ever logged with an IP, so without one
      // there is no visit to attribute the success to.
      const ipHash =
        ctx.userIp && ctx.userIp !== "unknown" ? hashIp(ctx.userIp) : undefined;
      if (input.step === TUTORIAL_STEPS_COUNT && ipHash) {
        const experiments = getLayoutExperimentAssignments({
          abLemuReplacementVariant: ctx.abLemuReplacementVariant,
          wallpaperVariant: ctx.wallpaperVariant,
        });
        await Promise.all(
          experiments.map(async (experiment) => {
            const abLoadedEvent = await ctx.drizzle.query.abEvent.findFirst({
              where: and(
                eq(abEvent.ipHash, ipHash),
                eq(abEvent.experiment, experiment.experiment),
                eq(abEvent.event, "loaded"),
              ),
            });
            if (!abLoadedEvent) return;
            await ctx.drizzle
              .insert(abEvent)
              .values({
                id: nanoid(),
                userId: ctx.userId,
                experiment: experiment.experiment,
                variant: abLoadedEvent.variant,
                event: "success",
                source: abLoadedEvent.source,
                ipHash,
                userAgent: abLoadedEvent.userAgent,
              })
              .onDuplicateKeyUpdate({ set: { id: sql`id` } });
          }),
        );
      }

      // Return success response
      return {
        success: true,
        message: `Tutorial step updated to ${input.step}`,
        userPatch: { tutorialStep: input.step },
      };
    }),
  // Update user preferences
  updatePreferences: protectedProcedure
    .meta({ mcp: { description: "Update user game preferences" } })
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
  getBlacklist: protectedProcedure
    .meta({ mcp: { description: "Get user's blocked players list" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.userBlackList.findMany({
        where: eq(userBlackList.creatorUserId, ctx.userId),
        with: {
          target: { columns: { username: true, userId: true, avatar: true } },
        },
      });
    }),
  toggleBlacklistEntry: protectedProcedure
    .meta({
      mcp: { description: "Add or remove a player from blacklist" },
    })
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
  getAllAiNames: publicProcedure
    .meta({ mcp: { description: "Get list of all AI character names" } })
    .query(async ({ ctx }) => {
      return ctx.drizzle.query.userData.findMany({
        where: and(eq(userData.isAi, true), ne(userData.rank, "ELDER")),
        columns: {
          userId: true,
          username: true,
          level: true,
          avatar: true,
          isSummon: true,
          inArena: true,
          aiProfileId: true,
        },
        orderBy: asc(userData.level),
      });
    }),
  // Update user with new level
  levelUp: protectedProcedure
    .meta({
      mcp: {
        description: "Level up user when experience threshold met",
      },
    })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const recruiterData = alias(userData, "recruiter");
      const [snapshot, recruiter] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle
          .select({
            pvpExperience: recruiterData.pvpExperience,
            weeklyPvpKills: recruiterData.weeklyPvpKills,
            weeklyPvpKillsAt: recruiterData.weeklyPvpKillsAt,
            isAi: recruiterData.isAi,
          })
          .from(userData)
          .innerJoin(recruiterData, eq(userData.recruiterId, recruiterData.userId))
          .where(eq(userData.userId, ctx.userId))
          .then((rows) => rows[0]),
      ]);
      const {
        user,
        settings,
        requiresProgressionRefresh,
        publishedAchievementIds,
        progressionQuestCandidates,
        questBootstrap,
      } = snapshot;
      // Guard
      if (!user) return errorResponse("User not found");
      const block = levelUpBlockMessage(user);
      if (block) return errorResponse(block);
      // Mutate
      const newLevel = user.level + 1;
      const progressedUser = { ...user, level: newLevel };
      progressedUser.userQuests = progressionQuestCandidates.filter(
        (entry) =>
          isAvailableUserQuests({ ...entry.quest, ...entry }, progressedUser, true)
            .check,
      );
      const { trackers, consequences, notifications } = getNewTrackers(progressedUser, [
        { task: "user_level", value: newLevel },
      ]);
      // Chunin+ ranks get 1 skill point per level from SKILL_POINT_MIN_LEVEL–MAX.
      // The LEAST(..., MAX_SKILL_POINTS) in the SQL update caps the running total.
      const isChunin = UserRolesWithSkillTreeAccess.includes(user.rank);
      const skillPointsGain =
        isChunin &&
        newLevel >= SKILL_POINT_MIN_LEVEL &&
        newLevel <= SKILL_POINT_MAX_LEVEL
          ? 1
          : 0;

      const result = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        set: {
          level: newLevel,
          maxHealth: calcHP(newLevel),
          maxStamina: calcSP(newLevel),
          maxChakra: calcCP(newLevel),
          maxEnergy: calcEnergy(newLevel),
          questData: filterQuestTrackersForDbPersist(trackers, progressedUser),
          ...(skillPointsGain > 0
            ? {
                skillPoints: sql`LEAST(${userData.skillPoints} + 1, ${MAX_SKILL_POINTS})`,
              }
            : {}),
          ...(newLevel > SENSEI_MAX_STUDENT_LEVEL && user.senseiId
            ? { senseiId: null }
            : {}),
        },
        where: [
          eq(userData.level, user.level),
          eq(userData.rank, user.rank),
          eq(userData.skillPoints, user.skillPoints),
        ],
      });
      if (result.success && user.recruiterId) {
        const amount = Math.floor(
          boostPvpGain(
            10 * newLevel * newLevel * newLevel,
            getPvpBoost(recruiter ?? {}, settings).totalPercent,
          ),
        );
        await Promise.all([
          ctx.drizzle
            .update(userData)
            .set({ bank: sql`${userData.bank} + ${amount}` })
            .where(eq(userData.userId, user.recruiterId)),
          ctx.drizzle.insert(recruitmentRewards).values({
            id: nanoid(),
            userId: user.recruiterId,
            recruitedUserId: ctx.userId,
            amount: amount,
            type: "MONEY",
          }),
        ]);
      }
      // Return response
      if (!result.success) return errorResponse("Could not update level");
      const skillPointMessage =
        skillPointsGain > 0 ? ` and gained ${skillPointsGain} skill point!` : "";
      Object.assign(progressedUser, {
        maxHealth: calcHP(newLevel),
        maxStamina: calcSP(newLevel),
        maxChakra: calcCP(newLevel),
        skillPoints: Math.min(user.skillPoints + skillPointsGain, MAX_SKILL_POINTS),
        senseiId: newLevel > SENSEI_MAX_STUDENT_LEVEL ? null : user.senseiId,
        questData: trackers,
        updatedAt: result.claimedAt,
      });
      const needsBootstrap = BOOTSTRAP_QUEST_TYPES.some(
        (type) =>
          !user.userQuests.some((entry) => entry.quest.questType === type) &&
          canBootstrapQuestType(questBootstrap, type, newLevel),
      );
      const canProject =
        !requiresProgressionRefresh &&
        !needsBootstrap &&
        !notifications.length &&
        !consequences.some((entry) => entry.type !== "update_user") &&
        getQuestTargetSectorsToCheck(progressedUser, trackers).length === 0;
      return {
        ...(canProject
          ? getUserProgressionUpdate(progressedUser, publishedAchievementIds)
          : {}),
        success: true,
        message: `User leveled up to ${newLevel}${skillPointMessage}`,
      };
    }),
  // Get all information on logged in user
  getUser: protectedProcedure
    .meta({
      mcp: { description: "Get current user's full profile data" },
    })
    .query(async ({ ctx }) => {
      const now = new Date();
      const currentDayCycleStartedAt = new Date(getWorldCyclePosition(now).cycleStart);
      // Query
      const [
        updatedUser,
        readyFarmPlotsResult,
        waterableFarmPlotsResult,
        publishedAchievements,
        questInvitations,
        tournamentNotices,
      ] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          userIp: ctx.userIp,
          hideInformation: true,
          allowQuestPartySyncFallback: true,
          // forceRegen: true, // This should be disabled in prod to save on DB calls
        }),
        ctx.drizzle
          .select({ count: count() })
          .from(farmPlot)
          .where(
            and(
              eq(farmPlot.userId, ctx.userId),
              isNotNull(farmPlot.seedItemId),
              isNotNull(farmPlot.finishAt),
              lte(farmPlot.finishAt, now),
            ),
          ),
        ctx.drizzle
          .select({ count: count() })
          .from(farmPlot)
          .where(
            and(
              eq(farmPlot.userId, ctx.userId),
              isNotNull(farmPlot.seedItemId),
              isNotNull(farmPlot.finishAt),
              gt(farmPlot.finishAt, now),
              or(
                isNull(farmPlot.lastWateredAt),
                lt(farmPlot.lastWateredAt, currentDayCycleStartedAt),
              ),
            ),
          ),
        fetchPublishedAchievements(ctx.drizzle),
        ctx.drizzle.query.questParty.findMany({
          where: sql`JSON_CONTAINS(${questParty.invitedUserIds}, JSON_QUOTE(${ctx.userId}))`,
          with: { quest: true },
        }),
        fetchEventNotices(ctx.drizzle, ctx.userId),
      ]);
      const { user, settings, toastMessages, hasUnvotedPolls } = updatedUser;
      const readyFarmPlots = readyFarmPlotsResult[0]?.count ?? 0;
      const waterableFarmPlots = waterableFarmPlotsResult[0]?.count ?? 0;
      // Ship achievement progress on its own; the definitions come from the catalogue query
      const achievementProgress = user
        ? splitAchievementProgress(user, publishedAchievements)
        : [];
      // Figure out notifications
      const notifications: NavBarDropdownLink[] = [];
      // Ignore stale invitations for disabled or terminal teams, as the discovery page does.
      const invitations = questInvitations.filter(
        (party) =>
          party.quest?.teamEnabled &&
          !party.tracker.failed &&
          !isQuestComplete(party.quest, party.tracker),
      );
      // Keep team navigation available while a team-enabled quest is active and unfinished.
      const hasActiveTeamQuest = user?.userQuests.some((entry) => {
        const tracker = user.questData?.find((tracker) => tracker.id === entry.questId);
        return (
          entry.quest.teamEnabled &&
          !entry.endAt &&
          !entry.completed &&
          !!tracker &&
          !tracker.failed &&
          !isQuestComplete(entry.quest, tracker)
        );
      });
      if (hasActiveTeamQuest)
        notifications.push({
          href: "/questteams",
          name: invitations.length
            ? `Quest Teams: ${invitations.length} invitation${invitations.length === 1 ? "" : "s"}`
            : "Quest Teams",
          color: invitations.length ? "green" : "default",
          notificationCount: invitations.length,
          alwaysShow: true,
        });

      for (const notice of tournamentNotices)
        notifications.push({
          href: `/tournaments/${notice.tournamentId}`,
          name: `${notice.message}: ${notice.name}`,
          color: "green",
          notificationCount: 1,
          alwaysShow: true,
        });

      // Keep collection discoverable after disbanding, even before a reward choice exists.
      // Synthetic helpers keep closed receipts and must not advertise another payout.
      const completedTeamQuests =
        user?.userQuests.filter((entry) => {
          const tracker = user.questData?.find(
            (tracker) => tracker.id === entry.questId,
          );
          return (
            entry.quest.teamEnabled &&
            entry.id !== `party-${user.questPartyId}` &&
            !entry.endAt &&
            !entry.completed &&
            tracker &&
            !tracker.failed &&
            isQuestComplete(entry.quest, tracker)
          );
        }) ?? [];
      if (completedTeamQuests.length)
        notifications.push({
          href: "/profile?tab=dashboard#progress-heading",
          name: "Quest rewards waiting: open your Logbook",
          color: "green",
          alwaysShow: true,
          notificationCount: completedTeamQuests.length,
        });

      // Add any notifications from fetching user to toasts
      toastMessages.forEach((msg) => {
        notifications.push({ name: msg, color: "toast", href: "/profile" });
      });

      if (readyFarmPlots > 0) {
        notifications.push({
          href: "/farm",
          name:
            readyFarmPlots === 1
              ? "1 farm crop is ready to harvest"
              : `${readyFarmPlots} farm crops are ready to harvest`,
          color: "green",
        });
      }

      if (waterableFarmPlots > 0) {
        notifications.push({
          href: "/farm",
          name:
            waterableFarmPlots === 1
              ? "1 farm plant is ready to water"
              : `${waterableFarmPlots} farm plants are ready to water`,
          color: "blue",
        });
      }

      // Shrine notifications (use Set to avoid duplicate sectors)
      const userWithRelations = user as UserWithRelations;
      const shrineDefenseSectors = [
        ...new Set(
          userWithRelations?.shrineBattles
            ?.filter((b) => b.defenderEntityId === user?.villageId)
            .map((b) => b.sector)
            .filter(Boolean) ?? [],
        ),
      ];
      const shrineOffenseSectors = [
        ...new Set(
          userWithRelations?.shrineBattles
            ?.filter((b) => b.attackerEntityId === user?.villageId)
            .map((b) => b.sector)
            .filter(Boolean) ?? [],
        ),
      ];

      if (shrineDefenseSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `${shrineDefenseSectors.length > 1 ? "Shrines" : "Shrine"} under attack (${shrineDefenseSectors.length > 1 ? "Sectors" : "Sector"} ${shrineDefenseSectors.join(", ")})`,
          color: "red",
          alwaysShow: true,
        });
      }
      if (shrineOffenseSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `We are attacking ${shrineOffenseSectors.length > 1 ? "Shrines" : "Shrine"} (${shrineOffenseSectors.length > 1 ? "Sectors" : "Sector"} ${shrineOffenseSectors.join(", ")})`,
          color: "blue",
          alwaysShow: true,
        });
      }

      // Gather sectors under war attack for this user's village (use Set to avoid duplicate sectors)
      const warDefenseSectors = [
        ...new Set(
          userWithRelations?.activeWars
            ?.filter((w) => {
              const isDefender = w.defenderVillageId === user?.villageId;
              const isDefenderAlly = w.warAllies?.some(
                (a) =>
                  a.villageId === user?.villageId &&
                  a.supportVillageId === w.defenderVillageId,
              );
              return (isDefender || isDefenderAlly) && w.sector;
            })
            .map((w) => w.sector)
            .filter(Boolean) ?? [],
        ),
      ];

      const warOffenseSectors = [
        ...new Set(
          userWithRelations?.activeWars
            ?.filter((w) => {
              const isAttacker = w.attackerVillageId === user?.villageId;
              const isAttackerAlly = w.warAllies?.some(
                (a) =>
                  a.villageId === user?.villageId &&
                  a.supportVillageId === w.attackerVillageId,
              );
              return (isAttacker || isAttackerAlly) && w.sector;
            })
            .map((w) => w.sector)
            .filter(Boolean) ?? [],
        ),
      ];

      if (warDefenseSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `${warDefenseSectors.length > 1 ? "Sectors" : "Sector"} under attack (${warDefenseSectors.length > 1 ? "Sectors" : "Sector"} ${warDefenseSectors.join(", ")})`,
          color: "red",
          alwaysShow: true,
        });
      }
      if (warOffenseSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `We are attacking ${warOffenseSectors.length > 1 ? "Sectors" : "Sector"} (${warOffenseSectors.length > 1 ? "Sectors" : "Sector"} ${warOffenseSectors.join(", ")})`,
          color: "blue",
          alwaysShow: true,
        });
      }

      // Village war / raid notifications (VILLAGE_WAR and WAR_RAID have sector=0)
      const villageWars =
        userWithRelations?.activeWars?.filter(
          (w) =>
            (w.type === "VILLAGE_WAR" || w.type === "WAR_RAID") &&
            (w.attackerVillageId === user?.villageId ||
              w.defenderVillageId === user?.villageId ||
              w.warAllies?.some((a) => a.villageId === user?.villageId)),
        ) ?? [];
      for (const w of villageWars) {
        const isAttacker = w.attackerVillageId === user?.villageId;
        const isDefender = w.defenderVillageId === user?.villageId;
        const isAttackerAlly = w.warAllies?.some(
          (a) =>
            a.villageId === user?.villageId &&
            a.supportVillageId === w.attackerVillageId,
        );
        const defenderName = w.defenderVillage?.name ?? "another village";
        const attackerName = w.attackerVillage?.name ?? "another village";
        const label = isAttacker
          ? `At war: attacking ${defenderName}`
          : isDefender
            ? `At war: defending vs ${attackerName}`
            : isAttackerAlly
              ? `Supporting ${attackerName} attacking ${defenderName}`
              : `Supporting ${defenderName} defending vs ${attackerName}`;
        notifications.push({
          href: "/townhall",
          name: label,
          color: "red",
          alwaysShow: true,
        });
      }

      // Remind the incumbent for the whole publication window; missing it removes the title.
      const kageVillage = user?.village;
      const setupDeadline =
        user &&
        !user.isAi &&
        kageVillage?.type === "VILLAGE" &&
        kageVillage.kageId === user.userId
          ? getKageSetupDeadline(kageVillage)
          : null;
      if (setupDeadline) {
        const isPaused =
          kageVillage?.kageSchedule?.kageId === user?.userId &&
          !!kageVillage?.kageSchedule?.paused;
        const isUrgent =
          setupDeadline.getTime() - now.getTime() <=
          KAGE_DEFENSE_REMINDER_HOURS * 3600_000;
        notifications.push({
          href: "/townhall",
          name: isPaused
            ? "Kage defense schedule required: deadline paused during war"
            : `Publish your Kage defense schedule by ${setupDeadline.toISOString().slice(0, 16).replace("T", " ")} UTC or lose the Kage title`,
          color: isUrgent && !isPaused ? "red" : "blue",
          alwaysShow: true,
        });
      }

      // Raid notifications
      const openRaids =
        userWithRelations?.activeRaids?.filter((r) => r.raidType === "open") ?? [];
      const exclusiveRaids =
        userWithRelations?.activeRaids?.filter((r) => r.raidType === "exclusive") ?? [];

      // Group by sector to avoid duplicate sector mentions
      const openRaidSectors = [...new Set(openRaids.map((r) => r.sector))];
      const exclusiveRaidSectors = [...new Set(exclusiveRaids.map((r) => r.sector))];

      if (openRaidSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `Open ${openRaidSectors.length > 1 ? "Raids" : "Raid"} available (${openRaidSectors.length > 1 ? "Sectors" : "Sector"} ${openRaidSectors.join(", ")})`,
          color: "red",
          alwaysShow: true,
        });
      }

      if (exclusiveRaidSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `Village ${exclusiveRaidSectors.length > 1 ? "Raids" : "Raid"} active (${exclusiveRaidSectors.length > 1 ? "Sectors" : "Sector"} ${exclusiveRaidSectors.join(", ")})`,
          color: "red",
          alwaysShow: true,
        });
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
        if (user?.votes?.[site] !== true) {
          hasVoted = false;
        }
      });
      if (!hasVoted) {
        notifications.push({
          href: "/profile/recruit",
          name: `Vote for Us`,
          color: "hidden",
          notificationCount: 1,
        });
      }
      // Settings
      const trainingBoost = getGameSettingBoost("trainingGainMultiplier", settings);
      if (trainingBoost) {
        notifications.push({
          href: "/traininggrounds",
          name: `Global: ${trainingBoost.value}X gains | ${trainingBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
        });
      }
      const regenBoost = getGameSettingBoost("regenGainMultiplier", settings);
      if (regenBoost) {
        notifications.push({
          href: "/profile",
          name: `Global: ${regenBoost.value}X regen | ${regenBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
        });
      }
      const battleExpBoost = getGameSettingBoost("battleExpMultiplier", settings);
      if (battleExpBoost) {
        notifications.push({
          href: "/battlearena",
          name: `Global: ${battleExpBoost.value}X battle exp | ${battleExpBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
        });
      }
      const missionExpBoost = getGameSettingBoost("missionExpMultiplier", settings);
      if (missionExpBoost) {
        notifications.push({
          href: "/missionhall",
          name: `Global: ${missionExpBoost.value}X mission exp | ${missionExpBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
        });
      }
      const jutsuExpBoost = getGameSettingBoost("jutsuExpMultiplier", settings);
      if (jutsuExpBoost) {
        notifications.push({
          href: "/jutsus",
          name: `Global: ${jutsuExpBoost.value}X jutsu exp | ${jutsuExpBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
        });
      }
      const itemExpBoost = getGameSettingBoost("itemExpMultiplier", settings);
      if (itemExpBoost) {
        notifications.push({
          href: "/items",
          name: `Global: ${itemExpBoost.value}X item exp | ${itemExpBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
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
            name: `War: +${warRegenBoost.value}% regen | ${warRegenBoost.daysLeft} days`,
            color: "green",
            group: "Active boosts",
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
            name: `War: +${warTrainingBoost.value}% gains | ${warTrainingBoost.daysLeft} days`,
            color: "green",
            group: "Active boosts",
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

        // Shrine boosts
        const shrineBoosts = user.village?.shrineSettings?.activeBoosts;
        if (shrineBoosts) {
          const sectors = countBoostingShrines(user.village?.sectors);
          SHRINE_BOOST_TYPES.forEach((boostType) => {
            const boost = getShrineBoost(sectors, boostType, user.village) * 100;
            if (boost > 0) {
              notifications.push({
                href: "/shrine",
                name: `Shrine: +${boost}% ${boostType} gains`,
                color: "green",
                group: "Active boosts",
              });
            }
          });
        }

        // Get moderation, application and content review counts in parallel for staff.
        const approvalGroup = getApprovalGroup(user.role);
        const canReviewContent = canChangeContent(user.role);
        if (canModerateRoles.includes(user.role) || approvalGroup || canReviewContent) {
          const [reportCounts, ticketCounts, applicationCounts, reviewCounts] =
            await Promise.all([
              canModerateRoles.includes(user.role)
                ? ctx.drizzle
                    .select({ count: sql`count(*)`.mapWith(Number) })
                    .from(userReport)
                    .innerJoin(userData, eq(userData.userId, userReport.reportedUserId))
                    .where(inArray(userReport.status, ["UNVIEWED", "BAN_ESCALATED"]))
                : null,
              canModerateRoles.includes(user.role)
                ? ctx.drizzle
                    .select({ count: sql`count(*)`.mapWith(Number) })
                    .from(supportTicket)
                    .where(
                      inArray(supportTicket.status, [
                        "OPEN",
                        "IN_PROGRESS",
                        "WAITING_FOR_STAFF",
                      ]),
                    )
                : null,
              approvalGroup
                ? ctx.drizzle
                    .select({ count: sql`count(*)`.mapWith(Number) })
                    .from(staffApplication)
                    .leftJoin(
                      staffApplicationApproval,
                      and(
                        eq(staffApplication.id, staffApplicationApproval.applicationId),
                        eq(staffApplicationApproval.group, approvalGroup),
                        eq(staffApplicationApproval.approverUserId, user.userId),
                      ),
                    )
                    .where(
                      and(
                        eq(staffApplication.state, "PENDING"),
                        isNull(staffApplicationApproval.applicationId),
                      ),
                    )
                : null,
              canReviewContent
                ? ctx.drizzle
                    .select({ count: sql`count(*)`.mapWith(Number) })
                    .from(contentProposal)
                    .where(eq(contentProposal.status, "PENDING"))
                : null,
            ]);

          const userReports = reportCounts?.[0]?.count ?? 0;
          if (userReports > 0) {
            notifications.push({
              href: "/reports",
              name: `${userReports} waiting!`,
              color: "hidden",
              notificationCount: userReports,
            });
          }
          const userTickets = ticketCounts?.[0]?.count ?? 0;
          if (userTickets > 0) {
            notifications.push({
              href: "/support",
              name: `${userTickets} waiting!`,
              color: "hidden",
              notificationCount: userTickets,
            });
          }

          const adminAppCount = applicationCounts?.[0]?.count ?? 0;
          if (adminAppCount > 0) {
            notifications.push({
              href: "/manual/staff/applications",
              name: `Applications (${adminAppCount})`,
              color: "blue",
              notificationCount: adminAppCount,
            });
          }
          const reviewCount = reviewCounts?.[0]?.count ?? 0;
          if (reviewCount > 0) {
            notifications.push({
              href: "/manual/review",
              name: `Content review (${reviewCount})`,
              color: "green",
              notificationCount: reviewCount,
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
        // Check if user is trade banned
        if (user.isTradeBanned) {
          notifications.push({
            href: "/reports",
            name: "Trade Banned!",
            color: "red",
          });
        }
        // Unused experience points - only show if some stat or mastery can still take them
        if (user.earnedExperience > 0 && canAssignExperience(user)) {
          notifications.push({
            id: "tutorial-unassigned-stats",
            href: "/profile/experience",
            name: "Assign XP",
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
            color: "hidden",
            notificationCount: user.inboxNews,
          });
        }
        // Stuff in news
        if (user.unreadNews > 0) {
          notifications?.push({
            href: "/news",
            name: `${user.unreadNews} news`,
            color: "hidden",
            notificationCount: user.unreadNews,
          });
        }
        // Rank milestone rewards from recruits, counted when they were paid
        if (user.unreadRecruitRewards > 0) {
          notifications.push({
            href: "/profile/recruit",
            name: `Your recruits earned you ${user.unreadRecruitRewards} rank milestone ${user.unreadRecruitRewards === 1 ? "reward" : "rewards"}`,
            color: "toast",
          });
          await ctx.drizzle
            .update(userData)
            .set({
              unreadRecruitRewards: sql`GREATEST(${userData.unreadRecruitRewards} - ${user.unreadRecruitRewards}, 0)`,
            })
            .where(eq(userData.userId, ctx.userId));
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
        userData: user ? { ...user, pvpBoost: getPvpBoost(user, settings) } : user,
        achievementProgress: achievementProgress,
        notifications: notifications,
        serverTime: Date.now(),
        userAgent: ctx.userAgent,
      };
    }),
  // Get an AI
  getAi: protectedProcedure
    .meta({ mcp: { description: "Get AI character details by ID" } })
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
  create: protectedProcedure
    .meta({
      mcp: {
        description: "Create a new AI character (content editors)",
      },
    })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (canChangeContent(user.role)) {
        const id = nanoid();
        await ctx.drizzle.insert(userData).values({
          userId: id,
          username: `New AI - ${id}`,
          gender: "Unknown",
          avatar: IMG_AVATAR_DEFAULT,
          avatarLight: IMG_AVATAR_DEFAULT,
          villageId: null,
          approvedTos: true,
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
    .meta({
      mcp: {
        description: "Clone an existing AI character (content editors)",
      },
    })
    .input(idSchema)
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
    .meta({
      mcp: { description: "Delete an AI character (content editors)" },
    })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role))
        return errorResponse("Not allowed to delete AI");
      const [ai, habitats] = await Promise.all([
        fetchUser(ctx.drizzle, input.id),
        ctx.drizzle.query.huntingHabitat.findMany(),
      ]);
      if (habitats.some((h) => h.content.contracts.some((c) => c.aiId === input.id)))
        return errorResponse(
          "This AI is used by a hunting contract. Remove the target first.",
        );
      if (ai?.isAi) {
        const rejected = await deleteUser(ctx.drizzle, ai.userId);
        if (rejected) return rejected;
        await outdateProposalsFor(
          ctx.drizzle,
          "AI",
          [ai.userId],
          deletedReason("AI", ai.username, user.username),
        );
        return { success: true, message: `AI deleted` };
      } else {
        return { success: false, message: `Not allowed to delete AI` };
      }
    }),
  // Update user
  updateUser: protectedProcedure
    .meta({
      mcp: { description: "Update user profile data (content editors)" },
    })
    .input(z.object({ id: z.string(), data: updateUserSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [user, target, village, sageExists, villages] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, input.id),
          with: { jutsus: true, items: true },
        }),
        fetchVillage(ctx.drizzle, input.data?.villageId || VILLAGE_SYNDICATE_ID),
        input.data.sageModeId
          ? ctx.drizzle.query.sageMode.findFirst({
              where: eq(sageMode.id, input.data.sageModeId),
              columns: { id: true },
            })
          : Promise.resolve(null),
        fetchVillages(ctx.drizzle),
      ]);
      // Basic existence guards
      if (!village) return errorResponse("Village not found");
      if (!target) return errorResponse("User not found");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      // Roles that can only edit themselves
      if (canOnlyEditSelf(user.role) && user.userId !== target.userId) {
        return errorResponse("You can only edit your own profile");
      }

      // Prepare jutsu & item id arrays for permission checks and later DB update
      const oldJutsuIds = target.jutsus.map((j) => j.jutsuId);
      // Omitted ownership lists leave inventory untouched; an explicit [] clears it.
      const newJutsuIds = input.data.jutsus ?? oldJutsuIds;
      const oldItemIds = target.items.map((i) => i.itemId);
      const newItemIds = input.data.items ?? oldItemIds;

      // Guard attribute-by-attribute permissions
      const usernameChanged = input.data.username !== target.username;
      if (usernameChanged && !canEditUsername(user.role)) {
        return errorResponse("Not allowed to change username");
      }

      const bloodlineChanged = input.data.bloodlineId !== target.bloodlineId;
      if (bloodlineChanged && !canEditBloodline(user.role)) {
        return errorResponse("Not allowed to change bloodline");
      }
      const bloodlineReskinChanged =
        "bloodlineReskinId" in input.data &&
        input.data.bloodlineReskinId !== target.bloodlineReskinId;
      if (bloodlineReskinChanged && !canEditBloodline(user.role)) {
        return errorResponse("Not allowed to change bloodline reskin");
      }

      const sageModeChanged = input.data.sageModeId !== target.sageModeId;
      if (sageModeChanged && !canEditBloodline(user.role)) {
        return errorResponse("Not allowed to change sage mode");
      }
      if (sageModeChanged && input.data.sageModeId && !sageExists) {
        return errorResponse("Sage Mode not found");
      }

      const villageChanged = village.id !== target.villageId;
      if (villageChanged && !canEditVillage(user.role)) {
        return errorResponse("Not allowed to change village");
      }

      const rankChanged = input.data.rank !== target.rank;
      if (rankChanged && !canEditRank(user.role)) {
        return errorResponse("Not allowed to change rank");
      }

      const staffAccountChanged =
        input.data.staffAccount !== undefined &&
        input.data.staffAccount !== target.staffAccount;
      if (staffAccountChanged && !canEditStaffAccountFlag(user.role)) {
        return errorResponse("Not allowed to toggle staff account flag");
      }

      const rankedLpChanged =
        input.data.rankedLp !== undefined && input.data.rankedLp !== target.rankedLp;
      if (rankedLpChanged && !canEditRankedLp(user.role)) {
        return errorResponse("Not allowed to change ranked LP");
      }

      // Check permissions for jutsus/items before performing updates
      const jutsuChanged =
        newJutsuIds.slice().sort().join(",") !== oldJutsuIds.slice().sort().join(",");
      if (jutsuChanged && !canEditJutsus(user.role)) {
        return errorResponse("Not allowed to modify jutsus");
      }

      const itemChanged =
        newItemIds.slice().sort().join(",") !== oldItemIds.slice().sort().join(",");
      if (itemChanged && !canEditItems(user.role)) {
        return errorResponse("Not allowed to modify items");
      }

      // Role-change permissions (availableRoles) still apply below
      const roleChanged = input.data.role !== target.role;
      const availableRoles = canChangeUserRolesTo(user.role);
      if (roleChanged && !availableRoles.includes(target.role)) {
        return errorResponse(`Not allowed to change: ${target.role}`);
      }
      if (roleChanged && !availableRoles.includes(input.data.role)) {
        return errorResponse(`Only available roles: ${availableRoles.join(", ")}`);
      }
      // Block promoting USER to staff role - must go through application process
      // Demotions (to USER) are allowed without restrictions
      // CODING-ADMIN can bypass this restriction
      if (
        roleChanged &&
        input.data.role !== "USER" &&
        target.role === "USER" &&
        user.role !== "CODING-ADMIN"
      ) {
        return errorResponse(
          "Promotion of users to staff must go through the staff application process. See manual.",
        );
      }
      if (village.id !== target.villageId) {
        const clanName = target.isOutlaw ? "Faction" : "Clan";
        if (target.anbuId) return errorResponse("Leave ANBU first");
        if (target.clanId) return errorResponse(`Leave ${clanName} first`);
        if (target.status !== "AWAKE") return errorResponse("AWAKE to change village");
      }
      // Compute jutsu & item changes without writing so the AI check below can
      // reject the reason before any jutsu/item changes are applied.
      const contentChanges = await computeUserContentChanges({
        client: ctx.drizzle,
        oldJutsuIds,
        newJutsuIds,
        oldItemIds,
        newItemIds,
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
        .concat(contentChanges.jutsuChanges)
        .concat(contentChanges.itemChanges);
      // AI moderation of reason
      const aiCheck = await validateUserUpdateReason(
        diff.join(". "),
        input.data.reason,
      );
      if (!aiCheck.allowUpdate) {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [],
          relatedId: target.userId,
          relatedMsg: `Updated attempted. Reason rejected by AI: ${input.data.reason}`,
          relatedImage: target.avatarLight,
        });
        return errorResponse(aiCheck.comment);
      }

      // Update database
      await Promise.all([
        applyUserContentChanges({
          client: ctx.drizzle,
          userId: target.userId,
          deletedJutsuIds: contentChanges.deletedJutsuIds,
          deletedItemIds: contentChanges.deletedItemIds,
          insertedJutsuIds: contentChanges.insertedJutsuIds,
          insertedItemIds: contentChanges.insertedItemIds,
        }),
        ctx.drizzle
          .update(userData)
          .set({
            userId: target.userId,
            ...(usernameChanged ? { username: input.data.username } : {}),
            ...(bloodlineChanged
              ? {
                  ...bloodrightSwapRefund(input.data.bloodlineId),
                  bloodlineId: input.data.bloodlineId,
                }
              : {}),
            ...(villageChanged ? { villageId: input.data.villageId } : {}),
            ...(rankChanged ? { rank: input.data.rank } : {}),
            ...(bloodlineReskinChanged
              ? { bloodlineReskinId: input.data.bloodlineReskinId ?? null }
              : {}),
            ...(sageModeChanged ? { sageModeId: input.data.sageModeId } : {}),
            ...(staffAccountChanged ? { staffAccount: input.data.staffAccount } : {}),
            ...(rankedLpChanged ? { rankedLp: input.data.rankedLp } : {}),
            ...(roleChanged ? { role: input.data.role } : {}),
            ...(villageChanged
              ? {
                  isOutlaw: village.type === "OUTLAW",
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
      if (rankChanged && target.recruiterId) {
        await awardRecruitRankMilestonesSafely({
          client: ctx.drizzle,
          recruitUserId: target.userId,
          recruiterId: target.recruiterId,
          rank: input.data.rank,
        });
      }
      if (usernameChanged || villageChanged)
        scheduleDiscordSync(ctx.drizzle, target.userId);
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  // Update a AI
  updateAi: protectedProcedure
    .meta({
      mcp: { description: "Update AI character data (content editors)" },
    })
    .input(z.object({ id: z.string(), data: insertAiSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Set empty strings to null
      setEmptyStringsToNulls(input.data, userData);
      input.data.npcTitle = input.data.npcTitle ?? "";

      // Queries
      const newUsername = input.data.username;
      const [user, ai, villages, usernameTaken] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, input.id),
          with: { jutsus: true, items: true },
        }),
        fetchVillages(ctx.drizzle),
        newUsername
          ? ctx.drizzle.query.userData.findFirst({
              columns: { userId: true },
              where: and(
                eq(userData.username, newUsername),
                ne(userData.userId, input.id),
              ),
            })
          : undefined,
      ]);

      // Guards
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!ai) return errorResponse("AI not found");
      if (!ai.isAi) return errorResponse("Not an AI");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (usernameTaken) return errorResponse("Username already taken");
      if (
        input.data.npcTitle &&
        input.data.npcTitle !== ai.npcTitle &&
        isReservedCustomTitle(
          input.data.npcTitle,
          villages.map((v) => v.name),
        )
      ) {
        return errorResponse(RESERVED_CUSTOM_TITLE_MESSAGE);
      }

      // Update jutsus & items
      // Extract new item ids from ids-with-number array
      const itemIdWithChance = (input.data.items ?? []).flatMap((o) =>
        o.ids.map((id) => ({ id, chance: o.number })),
      );
      const newItemIds = itemIdWithChance.map((x) => x.id);

      const { jutsuChanges, itemChanges } = await updateUserContent({
        client: ctx.drizzle,
        userId: ai.userId,
        oldJutsuIds: ai.jutsus.map((j) => j.jutsuId),
        newJutsuIds: input.data.jutsus ?? [],
        oldItemIds: ai.items.map((j) => j.itemId),
        newItemIds,
      });
      delete input.data.jutsus;
      delete input.data.items;

      // Update input data based on level
      const newAi = { ...ai, ...input.data } as UserData;

      // Level-based stats / pools
      scaleEditedAi(ai, newAi);

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
        ...itemIdWithChance.map(({ id, chance }) =>
          ctx.drizzle
            .update(userItem)
            .set({ dropChancePerc: chance })
            .where(and(eq(userItem.userId, ai.userId), eq(userItem.itemId, id))),
        ),
      ]);
      await outdateProposalsFor(
        ctx.drizzle,
        "AI",
        [ai.userId],
        editedReason("AI", ai.username, user.username),
      );

      // Update discord channel
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, ai.username, diff, ai.avatar);
      }
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  // Get user attributes
  getUserAttributes: protectedProcedure
    .meta({ mcp: { description: "Get user's character attributes" } })
    .query(async ({ ctx }) => {
      return fetchAttributes(ctx.drizzle, ctx.userId);
    }),
  // Check if username exists in database already
  getUsername: publicProcedure
    .meta({ mcp: { description: "Check if a username is taken" } })
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
    .meta({
      mcp: { description: "Change user's username for reputation cost" },
    })
    .input(z.object({ username: usernameSchema }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target, moderationResult] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userData.findFirst({
          columns: { username: true },
          where: eq(userData.username, input.username),
        }),
        checkForBadWords(input.username),
      ]);
      // Guard
      if (user.username === input.username) {
        return errorResponse("Username is the same");
      }
      if (!moderationResult.success) return moderationResult;
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
        .where(
          and(
            eq(userData.userId, ctx.userId),
            eq(userData.username, user.username),
            eq(userData.reputationPoints, user.reputationPoints),
            gte(userData.reputationPoints, COST_CHANGE_USERNAME),
          ),
        );
      if (result.rowsAffected === 0) {
        return errorResponse("Your profile or reputation changed. Please try again");
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
        scheduleDiscordSync(ctx.drizzle, ctx.userId);
        return {
          success: true,
          message: "Username updated",
          userPatch: {
            username: input.username,
            reputationPoints: user.reputationPoints - COST_CHANGE_USERNAME,
          },
        };
      }
    }),
  updateTavernColor: protectedProcedure
    .meta({
      mcp: {
        description: "Change a controlled tavern username or title color",
      },
    })
    .input(tavernColorChangeSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const storedColor =
        input.target === "username" ? user.tavernUsernameColor : user.tavernTitleColor;
      const cost = getTavernColorChangeCost(input.color);

      if (user.isBanned) return errorResponse("You are banned");
      if (storedColor !== input.currentColor) {
        return errorResponse(
          "Could not update tavern color; your selection or reputation changed. Please try again",
        );
      }
      if (input.currentColor === input.color) {
        return errorResponse(`Tavern ${input.target} color is unchanged`);
      }
      if (cost > user.reputationPoints) {
        return errorResponse("Not enough reputation points");
      }

      const colorUpdate =
        input.target === "username"
          ? { tavernUsernameColor: input.color }
          : { tavernTitleColor: input.color };
      const result = await ctx.drizzle
        .update(userData)
        .set({
          ...colorUpdate,
          reputationPoints: sql`${userData.reputationPoints} - ${cost}`,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            eq(userData.isBanned, false),
            eq(
              input.target === "username"
                ? userData.tavernUsernameColor
                : userData.tavernTitleColor,
              input.currentColor,
            ),
            // FLOAT balances do not round-trip through exact SQL equality. The
            // floor and SQL debit preserve concurrent earnings and prevent overspending.
            gte(userData.reputationPoints, cost),
          ),
        );

      if (result.rowsAffected === 0) {
        return errorResponse(
          "Could not update tavern color; your selection or reputation changed. Please try again",
        );
      }

      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "user",
        changes: [
          `Tavern ${input.target} color changed from ${input.currentColor} to ${input.color} (-${cost} reputation)`,
        ],
        relatedId: ctx.userId,
        relatedMsg: `${user.username} changed their tavern ${input.target} color`,
        relatedImage: user.avatarLight,
      });
      return {
        success: true,
        userPatch: {
          ...colorUpdate,
        },
        userDelta: { reputationPoints: -cost },
        message: `Tavern ${input.target} color updated for ${cost} reputation points`,
      };
    }),
  // Use earned experience points for stats and elemental mastery
  useUnusedExperiencePoints: protectedProcedure
    .meta({ mcp: { description: "Assign earned experience to stats and elements" } })
    .input(createAssignedExperienceSchema().schema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
        with: {
          bloodline: true,
          items: {
            where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
            with: { item: true, imbuements: { with: { item: true } } },
          },
          titles: { with: { title: true } },
          userSkills: { where: eq(userSkill.activated, true), with: { skill: true } },
        },
      });
      if (!user) return errorResponse("User not found");
      const assignmentBlock = experienceAssignmentBlockMessage(user);
      if (assignmentBlock) return errorResponse(assignmentBlock);
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
      const hasElementAllocation = BasicElementName.some(
        (element) => Math.floor(input[element]) > 0,
      );
      if (hasElementAllocation && user.status !== "AWAKE") {
        return errorResponse("Must be awake to assign elemental experience");
      }
      // Mutate: points stop at the rank cap and only the points that land are spent. A
      // stat already stored above its cap keeps its value; it counts again after a rank-up.
      const { stats_cap, gens_cap } = getUserCaps(user.rank);
      // Unused XP is stored as whole points, unlike timed and combat mastery gains.
      const allocatedMastery = allocateMasteryGains(
        user,
        Object.fromEntries(
          assignableMasteryNames.map((stat) => [stat, Math.floor(input[stat])]),
        ),
      );
      const masteryGains = Object.fromEntries(
        assignableMasteryNames.map((stat) => [
          stat,
          Math.floor(allocatedMastery[stat] ?? 0),
        ]),
      );
      const assign = (current: number, points: number, cap: number) =>
        Math.max(current, Math.min(current + Math.floor(points), cap));
      const stats = {
        ninjutsuMastery: user.ninjutsuMastery + (masteryGains.ninjutsuMastery ?? 0),
        genjutsuMastery: user.genjutsuMastery + (masteryGains.genjutsuMastery ?? 0),
        taijutsuMastery: user.taijutsuMastery + (masteryGains.taijutsuMastery ?? 0),
        bukijutsuMastery: user.bukijutsuMastery + (masteryGains.bukijutsuMastery ?? 0),
        offence: assign(user.offence, input.offence, stats_cap),
        defence: assign(user.defence, input.defence, stats_cap),
        strength: assign(user.strength, input.strength, gens_cap),
        speed: assign(user.speed, input.speed, gens_cap),
        intelligence: assign(user.intelligence, input.intelligence, gens_cap),
        willpower: assign(user.willpower, input.willpower, gens_cap),
      };
      const combatSpent = Math.round(
        getAssignedCombatStatTotal(stats) - getAssignedCombatStatTotal(user),
      );
      let elementalSpent = 0;
      const elementalMastery = { ...user.elementalMastery };
      for (const element of BasicElementName) {
        const room = elementalGainRoom(user, element);
        // Whole unused-XP points can finish fractional room left by timed training.
        const points = Math.min(Math.floor(input[element]), Math.ceil(room));
        if (points <= 0) continue;
        elementalSpent += points;
        elementalMastery[element] =
          (elementalMastery[element] ?? 0) + Math.min(points, room);
      }
      const elementalUpdate = elementalSpent > 0 ? { elementalMastery } : {};
      const spent =
        combatSpent +
        assignableMasteryNames.reduce(
          (sum, name) => sum + stats[name] - user[name],
          0,
        ) +
        elementalSpent;
      if (spent <= 0) return errorResponse("Those stats are already capped");
      // Update
      const data = {
        ...stats,
        ...elementalUpdate,
        experience: user.experience + combatSpent,
        earnedExperience: Math.round(user.earnedExperience - spent),
      };
      const result = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        set: {
          ...stats,
          ...elementalUpdate,
          experience: sql`${userData.experience} + ${combatSpent}`,
          earnedExperience: sql`${userData.earnedExperience} - ${spent}`,
        },
        where: [
          ...(hasElementAllocation
            ? [...elementalSnapshotConditions(user), eq(userData.status, "AWAKE")]
            : []),
          eq(userData.rank, user.rank),
          sql`${userData.masteryRanks} = CAST(${JSON.stringify(user.masteryRanks)} AS JSON)`,
          ...[...CombatStatNames, ...MasteryNames].map((stat) =>
            eq(userData[stat], user[stat]),
          ),
          eq(userData.experience, user.experience),
          eq(userData.earnedExperience, user.earnedExperience),
          gte(userData.earnedExperience, spent),
        ],
      });
      if (!result.success) {
        return errorResponse("Stats changed while assigning points. Please try again");
      } else {
        return {
          success: true,
          message: "User stats updated",
          // A pending queue is settled by the profile refresh, including quest progress.
          ...(hasEnergyQueue(user)
            ? {}
            : {
                userPatch: {
                  ...data,
                  updatedAt: result.claimedAt,
                  effectiveMasteries: effectiveMasteries({ ...user, ...data }),
                  maxEnergy: calcMaxEnergy({ ...user, ...data }),
                },
              }),
        };
      }
    }),
  // Get nindo text of user
  getNindo: publicProcedure
    .meta({
      mcp: { description: "Get user's nindo (way of ninja) text" },
    })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const nindo = await ctx.drizzle.query.userNindo.findFirst({
        where: eq(userNindo.userId, input.userId),
      });
      return nindo ? nindo.content : "";
    }),
  // Update nindo
  updateNindo: protectedProcedure
    .meta({ mcp: { description: "Update user's nindo text" } })
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
    .meta({ mcp: { description: "Add a character attribute to user" } })
    .input(
      z.object({
        attribute: z.enum([...attributes, "Hair", "Skin", "Eyes"]),
        color: z.enum([...colors, ...skin_colors]).optional(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const existingAttributes = await fetchAttributes(ctx.drizzle, ctx.userId);
      // Construct the attribute name
      const name =
        ["Hair", "Skin", "Eyes"].includes(input.attribute) && input.color
          ? `${input.color} ${input.attribute}`
          : input.attribute;
      // Guards
      if (existingAttributes.length >= MAX_ATTRIBUTES) {
        return errorResponse(`Only ${MAX_ATTRIBUTES} attributes allowed`);
      }
      if (existingAttributes.some((attr) => attr.attribute === name)) {
        return errorResponse(`You already have the attribute "${name}"`);
      }
      // Mutate - use onDuplicateKeyUpdate to handle race conditions
      const result = await ctx.drizzle
        .insert(userAttribute)
        .values({
          id: nanoid(),
          userId: ctx.userId,
          attribute: name,
        })
        .onDuplicateKeyUpdate({ set: { id: sql`id` } });
      if (result.rowsAffected === 0) {
        return { success: false, message: "Failed to insert attribute" };
      } else {
        return { success: true, message: "Attribute inserted" };
      }
    }),
  // Delete attribute
  deleteAttribute: protectedProcedure
    .meta({
      mcp: { description: "Remove a character attribute from user" },
    })
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
    .meta({ mcp: { description: "Search users by username" } })
    .input(
      z.object({
        username: z.string().trim(),
        showYourself: z.boolean(),
        showAi: z.boolean(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.drizzle.query.userData.findMany({
        extras: (table) => ({
          displayTitle: displayTitleSql(table).as("displayTitle"),
        }),
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

          nRecruited: true,
          tavernMessages: true,
          tavernUsernameColor: true,
          tavernTitleColor: true,
        },
        with: {
          village: {
            columns: { name: true, hexColor: true, kageId: true },
          },
        },
        where: and(
          like(userData.username, `%${input.username}%`),
          eq(userData.approvedTos, true),
          ...(input.showAi ? [] : [eq(userData.isAi, false)]),
          ...(input.showYourself ? [] : [sql`${userData.userId} != ${ctx.userId}`]),
        ),
        orderBy: [sql`LENGTH(${userData.username}) asc`],
        limit: 5,
      });
    }),
  // Get public information on a user
  getPublicUser: publicProcedure
    .meta({ mcp: { description: "Get public profile info for a user" } })
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
          extras: (table) => ({
            displayTitle: displayTitleSql(table).as("displayTitle"),
          }),
          columns: {
            aiProfileId: true,
            avatar: true,
            avatarLight: true,
            bloodlineId: true,
            sageModeId: true,
            curChakra: true,
            curHealth: true,
            curStamina: true,

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
            pvpWins: true,
            pvpLosses: true,
            showPvpRecord: true,
            rank: true,
            rankedLp: true,
            reputationPoints: true,
            role: true,
            senseiId: true,
            status: true,
            userId: true,
            username: true,
            villageId: true,
            tavernMessages: true,
            staffAccount: true,
            bloodlineReskinId: true,
            bracketImmunityLiftedUntil: true,
            warParticipantUntil: true,
          },
          with: {
            village: true,
            bloodline: true,
            sageMode: true,
            nindo: true,
            clan: true,
            jutsus: { with: { jutsu: { columns: { id: true, name: true } } } },
            items: { with: { item: { columns: { id: true, name: true } } } },
            badges: { with: { badge: true } },
            activeReskin: true,
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
            battleHistory: {
              columns: {
                battleType: true,
                createdAt: true,
              },
              where: and(
                eq(battleHistory.attackedId, input.userId),
                notInArray(battleHistory.battleType, ["SPARRING", "COMBAT"]),
                gte(battleHistory.createdAt, getTimeOfLastReset()),
              ),
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
        // Editors submit these ownership lists with the full profile form.
        const canEditTarget = requester && !canOnlyEditSelf(requester.role);
        if (!canEditTarget || !canEditJutsus(requester.role)) {
          user.jutsus = [];
        }
        if (!canEditTarget || !canEditItems(requester.role)) {
          user.items = [];
        }
      }
      if (!requester || !canSeeIps(requester.role)) {
        user.lastIp = "hidden";
      }
      if (user.bloodline && user.activeReskin) {
        user.bloodline = getReskinnedBloodline(user.bloodline, user.activeReskin);
      }
      if (
        user.sageMode?.hidden &&
        !isSelf &&
        !(requester && canChangeContent(requester.role))
      ) {
        user.sageMode = null;
        user.sageModeId = null;
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
      // Hide PvP W/L unless the owner opted in, the viewer is the owner, or staff.
      // Null (not omit) so the public payload shape stays stable for clients.
      const canSeePvpRecord =
        isSelf ||
        user.showPvpRecord ||
        Boolean(requester && canSeeSecretData(requester.role));
      if (!canSeePvpRecord) {
        return { ...user, pvpWins: null, pvpLosses: null };
      }
      // Return
      return user;
    }),
  countOnlineUsers: publicProcedure
    .meta({
      mcp: { description: "Get count of currently online users" },
    })
    .query(async ({ ctx }) => {
      // Fetch
      const [current, daily, maxOnline] = await Promise.all([
        ctx.drizzle
          .select({ count: count() })
          .from(userData)
          .where(gte(userData.updatedAt, secondsFromNow(-1800))), // 30 minutes = 1800 seconds
        ctx.drizzle
          .select({ count: count() })
          .from(userData)
          .where(gte(userData.updatedAt, secondsFromNow(-3600 * 24))),
        getGameSetting(ctx.drizzle, "onlineUsers"),
      ]);
      // Derived
      const onlineNow = current?.[0]?.count ?? 0;
      const onlineDay = daily?.[0]?.count ?? 0;
      // Implausible jumps (e.g. a bulk write touching every row) never become the record.
      const newMax = isNewOnlineRecord(maxOnline.value, onlineNow);
      if (newMax) {
        await updateGameSetting(ctx.drizzle, "onlineUsers", onlineNow, new Date());
      }
      // Return
      return { onlineNow, onlineDay, maxOnline: newMax ? onlineNow : maxOnline.value };
    }),
  // Get public users
  getPublicUsers: publicProcedure
    .meta({
      mcp: { description: "Get paginated list of users with filters" },
    })
    .input(getPublicUsersSchema)
    .query(async ({ ctx, input }) => {
      return fetchPublicUsers({ client: ctx.drizzle, input, userId: ctx.userId });
    }),
  // The sidebar's top list, on nearly every page load. Kept apart from getPublicUsers,
  // whose rows carry real IPs for staff, so the CDN can serve it.
  getStrongestUsers: cdnCachedProcedure
    .meta({
      mcp: { description: "Get the users with the most ranked LP" },
    })
    .query(async ({ ctx }) => {
      return ctx.drizzle.query.userData.findMany({
        extras: (table) => ({
          displayTitle: displayTitleSql(table).as("displayTitle"),
        }),
        columns: { userId: true, username: true, avatarLight: true, rankedLp: true },
        where: eq(userData.isAi, false),
        orderBy: [desc(userData.rankedLp), desc(userData.experience)],
        limit: STRONGEST_USERS_COUNT,
      });
    }),

  // Get recruitment rewards for current user
  getRecruitmentRewards: protectedProcedure
    .meta({
      mcp: { description: "Get user's recruitment bonus history" },
    })
    .input(
      z.object({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ?? 0;
      const skip = currentCursor * input.limit;
      const results = await ctx.drizzle.query.recruitmentRewards.findMany({
        where: eq(recruitmentRewards.userId, ctx.userId),
        with: {
          recruitedUser: {
            columns: { userId: true, username: true, avatar: true },
          },
        },
        offset: skip,
        limit: input.limit,
        orderBy: desc(recruitmentRewards.createdAt),
      });
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return { data: results, nextCursor };
    }),
  // Rank milestone eligibility and payouts for the current user's recruits
  getRecruitMilestones: protectedProcedure
    .meta({
      mcp: { description: "Get rank milestone rewards status for user's recruits" },
    })
    .query(async ({ ctx }) => {
      return await fetchRecruitMilestoneSummary(ctx.drizzle, ctx.userId);
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
      // Guard. A running ban or silence does not block deletion: deleteUser leaves a
      // sanction tombstone that a new account inherits.
      if (ctx.userId !== input.userId && !canDeleteUsers(user.role)) {
        return errorResponse("You can't delete other users");
      }
      // Muate
      await ctx.drizzle
        .update(userData)
        .set({
          deletionAt: target.deletionAt ? null : new Date(Date.now() + 2 * 86400000),
        })
        .where(eq(userData.userId, input.userId));
      return { success: true, message: "Deletion timer toggled" };
    }),
  // Delete user
  confirmDeletion: protectedProcedure
    .meta({
      mcp: { description: "Confirm and execute account deletion" },
    })
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
      const rejected = await deleteUser(ctx.drizzle, input.userId);
      if (rejected) return rejected;
      return { success: true, message: "User deleted" };
    }),
  claimVotes: protectedProcedure
    .meta({ mcp: { description: "Claim reputation points for voting" } })
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
      // Only the request that flips `claimed` from false is credited, and the credit commits
      // together with that claim
      const claimed = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          const claim = await tx
            .update(userVote)
            .set({
              claimed: true,
              totalClaims: sql`${userVote.totalClaims} + 1`,
              secret: smallNanoid(),
            })
            .where(
              and(
                eq(userVote.userId, ctx.userId),
                eq(userVote.claimed, false),
                ...ACTIVE_VOTING_SITES.map((site) => eq(userVote[site], true)),
              ),
            );
          if (claim.rowsAffected !== 1) return false;
          const credit = await tx
            .update(userData)
            .set({
              reputationPoints: sql`${userData.reputationPoints} + 1`,
              reputationPointsTotal: sql`${userData.reputationPointsTotal} + 1`,
            })
            .where(eq(userData.userId, ctx.userId));
          if (credit.rowsAffected !== 1)
            throw new Error("Vote reward recipient not found");
          return true;
        }),
      );
      if (!claimed) {
        return errorResponse("Votes already claimed");
      }
      return {
        success: true,
        message: "Successfully claimed reputation points for voting",
      };
    }),
  /** Load support controls on demand without publishing generation leases. */
  getPetImageGenerationForStaff: protectedProcedure
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const [actor, pets] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userPet.findMany({
          where: eq(userPet.userId, input.id),
          columns: {
            id: true,
            name: true,
            generationStatus: true,
            generationAttempts: true,
          },
        }),
      ]);
      if (actor.isBanned || !canResetPetImageGeneration(actor.role)) return [];
      return pets;
    }),
  /** Restore a companion's current-rank allowance without replacing its accepted artwork. */
  resetPetImageGeneration: protectedProcedure
    .input(resetPetImageGenerationSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [actor, pet] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userPet.findFirst({
          where: and(eq(userPet.id, input.petId), eq(userPet.userId, input.userId)),
        }),
      ]);
      if (actor.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canResetPetImageGeneration(actor.role))
        return errorResponse(
          "You don't have permission to reset companion image attempts",
        );
      if (!pet) return errorResponse("Companion not found");
      const now = new Date();
      if (hasActiveGeneration(pet, now)) {
        return errorResponse(
          "This companion's image is still generating. Wait for it to finish before resetting attempts.",
        );
      }
      if (pet.generationAttempts === 0)
        return errorResponse("This companion has no image attempts to reset");
      // The revision guard prevents clearing a generation lease claimed after our read.
      const result = await ctx.drizzle
        .update(userPet)
        .set({
          generationAttempts: 0,
          generationStartedAt: null,
          generationToken: null,
          // Expired redraws retain usable art; unfinished evolutions remain retryable.
          generationStatus:
            pet.generationStatus === "GENERATING"
              ? pet.avatar && pet.artRank === pet.rank
                ? "READY"
                : "FAILED"
              : pet.generationStatus,
          revision: sql`${userPet.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(userPet.id, pet.id),
            eq(userPet.userId, input.userId),
            eq(userPet.revision, pet.revision),
          ),
        );
      if (result.rowsAffected !== 1)
        return errorResponse("The companion changed. Refresh and try again.");
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "user",
        relatedId: input.userId,
        relatedMsg: input.reason.slice(0, ACTION_LOG_RELATED_MSG_MAX_LENGTH),
        changes: [
          `Reset companion image attempts for ${pet.name} (${pet.id}) from ${pet.generationAttempts} to 0`,
        ],
        relatedImage: pet.avatar,
      });
      return {
        success: true,
        message: `${pet.name}'s image attempts have been reset.`,
      };
    }),
  // Read a user's Seichi Silver balance (staff only) — kept off the public profile
  // response so spendable-currency balances aren't exposed to every viewer.
  getSeichiSilverForStaff: protectedProcedure
    .meta({
      mcp: { description: "Get a user's Seichi Silver balance (staff)" },
    })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [actor, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userData.findFirst({
          columns: { seichiSilver: true },
          where: eq(userData.userId, input.userId),
        }),
      ]);
      if (!actor || actor.isBanned || !canEditSeichiSilver(actor.role)) return 0;
      return target?.seichiSilver ?? 0;
    }),
  // Adjust Seichi Silver for a user (staff only)
  adjustSeichiSilver: protectedProcedure
    .input(adjustSeichiSilverSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [actor, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      // Guards
      if (!actor || !target) return errorResponse("User not found");
      if (actor.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canEditSeichiSilver(actor.role)) {
        return errorResponse("You don't have permission to edit Seichi Silver");
      }
      // Early sufficiency check: gives the admin the precise "Insufficient"
      // message and keeps the AI moderator from seeing a negative projected
      // balance. The atomic CAS in adjustSeichiSilverAtomically remains the
      // authoritative floor against a concurrent earn/spend.
      if (input.delta < 0 && target.seichiSilver + input.delta < 0) {
        return errorResponse("Insufficient Seichi Silver");
      }
      // AI moderation of reason. Log the delta only — a concurrent adjustment
      // makes any pre-mutation before/after snapshot stale.
      const change = `Adjusted Seichi Silver by ${input.delta}`;
      const aiCheck = await validateUserUpdateReason(change, input.reason);
      if (!aiCheck.allowUpdate) {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [],
          relatedId: target.userId,
          relatedMsg: `Seichi Silver adjustment rejected by AI: ${input.reason}`.slice(
            0,
            ACTION_LOG_RELATED_MSG_MAX_LENGTH,
          ),
          relatedImage: target.avatarLight,
        });
        return errorResponse(aiCheck.comment);
      }
      // Mutation (atomic CAS) + audit
      const success = await adjustSeichiSilverAtomically({
        client: ctx.drizzle,
        userId: target.userId,
        delta: input.delta,
      });
      if (!success) return errorResponse("Insufficient Seichi Silver");
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "user",
        changes: [change],
        relatedId: target.userId,
        relatedMsg: input.reason.slice(0, ACTION_LOG_RELATED_MSG_MAX_LENGTH),
        relatedImage: target.avatarLight,
      });
      return { success: true, message: `Seichi Silver adjusted by ${input.delta}` };
    }),
  // Award experience to a user (staff only)
  awardExperience: protectedProcedure
    .input(
      z.object({
        targetUserId: z.string(),
        amount: z.number().min(1).max(100000),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [awarder, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.targetUserId),
      ]);

      // Guards
      if (!awarder || !target) {
        return errorResponse("User not found");
      }

      if (awarder.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canAwardExperience(awarder)) {
        return errorResponse("You don't have permission to award experience");
      }

      // Mutation
      const result = await ctx.drizzle
        .update(userData)
        .set({
          earnedExperience: sql`${userData.earnedExperience} + ${input.amount}`,
          petExperience: petExperienceGainSql(input.amount),
        })
        .where(eq(userData.userId, input.targetUserId));

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to award experience");
      }

      // Log the action
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "user",
        changes: [`Awarded ${input.amount} experience points`],
        relatedId: target.userId,
        relatedMsg: `Experience awarded to ${target.username}`,
        relatedImage: target.avatarLight,
      });

      return {
        success: true,
        userDelta:
          input.targetUserId === ctx.userId &&
          target.earnedExperience > 0 &&
          !hasEnergyQueue(target) &&
          Number.isInteger(input.amount)
            ? { earnedExperience: input.amount }
            : undefined,
        message: `Awarded ${input.amount} experience points to ${target.username}`,
      };
    }),
  // Award experience to all users (staff only)
  awardExperienceToAll: protectedProcedure
    .input(
      z.object({
        amount: z.number().min(1).max(100000),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const awarder = await fetchUser(ctx.drizzle, ctx.userId);

      // Guards
      if (awarder.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canAwardExperience(awarder)) {
        return errorResponse("You don't have permission to award experience");
      }

      // Mutation - update all users
      const result = await ctx.drizzle.update(userData).set({
        earnedExperience: sql`${userData.earnedExperience} + ${input.amount}`,
        petExperience: petExperienceGainSql(input.amount),
      });

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to award experience to users");
      }

      // Log the action
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "user",
        changes: [`Mass awarded ${input.amount} experience points to all users`],
        relatedId: null,
        relatedMsg: `Mass experience awarded`,
        relatedImage: awarder.avatarLight,
      });

      return {
        success: true,
        message: `Awarded ${input.amount} experience points to all users`,
        userDelta:
          hasEnergyQueue(awarder) ||
          awarder.earnedExperience <= 0 ||
          !Number.isInteger(input.amount)
            ? undefined
            : { earnedExperience: input.amount },
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
          .set({ content: sanitized })
          .where(eq(userNindo.userId, userId))
      : client.insert(userNindo).values({
          id: nanoid(),
          userId: userId,
          content: sanitized,
        }),
  ]);
  return { success: true, message: "Content updated" };
};

/**
 * Fetch a user by id
 * @param client - The database client
 * @param userId - The id of the user
 * @returns The user, never null or undefined
 * @throws A NOT_FOUND error if the user does not exist
 *
 * NOTE: This function is used across the codebase. Use fetchUpdatedUser
 * if more information is required on the user object, so that we keep this method "light"
 */
export const fetchUser = async (client: DrizzleClient, userId: string) => {
  const user = await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
  });
  if (!user) {
    throw serverError(
      "NOT_FOUND",
      `User not found: ${userId}. Please complete registration.`,
    );
  }
  return user;
};

/**
 * Compute human-readable jutsu/item diffs and the id sets to delete/insert.
 * Read-only, so callers can run moderation or other guards on the diff before
 * applying any content changes.
 */
export const computeUserContentChanges = async (props: {
  client: DrizzleClient;
  oldJutsuIds: string[];
  newJutsuIds: string[];
  oldItemIds: string[];
  newItemIds: string[];
}) => {
  const { client } = props;

  // The diff is positional (deep-object-diff walks array indices), so compare
  // and render in a canonical order — without mutating the caller's arrays.
  const oldJutsuIds = props.oldJutsuIds.slice().sort();
  const newJutsuIds = props.newJutsuIds.slice().sort();
  const oldItemIds = props.oldItemIds.slice().sort();
  const newItemIds = props.newItemIds.slice().sort();

  const changed =
    oldJutsuIds.join(",") !== newJutsuIds.join(",") ||
    oldItemIds.join(",") !== newItemIds.join(",");

  // difference arrays
  let jutsuChanges: string[] = [];
  let itemChanges: string[] = [];

  // Resolve names for the diff shown to users & the action log
  if (changed) {
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
  }

  return {
    jutsuChanges,
    itemChanges,
    deletedJutsuIds: changed
      ? oldJutsuIds.filter((id) => !newJutsuIds.includes(id))
      : [],
    deletedItemIds: changed ? oldItemIds.filter((id) => !newItemIds.includes(id)) : [],
    insertedJutsuIds: changed
      ? newJutsuIds.filter((id) => !oldJutsuIds.includes(id))
      : [],
    insertedItemIds: changed ? newItemIds.filter((id) => !oldItemIds.includes(id)) : [],
  };
};

/** Apply the delete/insert sets produced by computeUserContentChanges. */
export const applyUserContentChanges = async (props: {
  client: DrizzleClient;
  userId: string;
  deletedJutsuIds: string[];
  deletedItemIds: string[];
  insertedJutsuIds: string[];
  insertedItemIds: string[];
}) => {
  const {
    client,
    userId,
    deletedJutsuIds,
    deletedItemIds,
    insertedJutsuIds,
    insertedItemIds,
  } = props;
  await Promise.all([
    ...(deletedJutsuIds.length > 0
      ? [
          client
            .delete(userJutsu)
            .where(
              and(
                eq(userJutsu.userId, userId),
                inArray(userJutsu.jutsuId, deletedJutsuIds),
              ),
            ),
        ]
      : []),
    ...(deletedItemIds.length > 0
      ? [
          client
            .delete(userItem)
            .where(
              and(
                eq(userItem.userId, userId),
                inArray(userItem.itemId, deletedItemIds),
              ),
            ),
        ]
      : []),
    // Use onDuplicateKeyUpdate to handle race conditions
    ...(insertedJutsuIds.length > 0
      ? [
          client
            .insert(userJutsu)
            .values(
              insertedJutsuIds.map((jutsuId) => ({
                id: nanoid(),
                userId: userId,
                jutsuId: jutsuId,
                level: 1,
                equipped: true,
              })),
            )
            .onDuplicateKeyUpdate({ set: { id: sql`id` } }),
        ]
      : []),
    ...(insertedItemIds.length > 0
      ? [
          client.insert(userItem).values(
            insertedItemIds.map((itemId) => ({
              id: nanoid(),
              userId: userId,
              itemId: itemId,
              equipped: "CHEST" as const,
            })),
          ),
        ]
      : []),
  ]);
};

export const updateUserContent = async (props: {
  client: DrizzleClient;
  userId: string;
  oldJutsuIds: string[];
  newJutsuIds: string[];
  oldItemIds: string[];
  newItemIds: string[];
}) => {
  const { client, userId, ...idSets } = props;
  const changes = await computeUserContentChanges({ client, ...idSets });
  await applyUserContentChanges({
    client,
    userId,
    deletedJutsuIds: changes.deletedJutsuIds,
    deletedItemIds: changes.deletedItemIds,
    insertedJutsuIds: changes.insertedJutsuIds,
    insertedItemIds: changes.insertedItemIds,
  });
  return { jutsuChanges: changes.jutsuChanges, itemChanges: changes.itemChanges };
};

/**
 * Load user relations and settle passive regeneration when due or forceRegen=true.
 * A lost snapshot CAS discards the hydrated user; at most three hydration attempts are made.
 * Passive settlement is attempted once; losing its CAS only rehydrates the winning state.
 * Repeated concurrent changes produce a conflict instead of stale user data.
 */
export const fetchUpdatedUser = async (
  props: Parameters<typeof fetchUpdatedUserOnce>[0],
) => {
  const settlement = { startedQueuedJobs: 0, hasRejectedPassiveRegen: false };
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await fetchUpdatedUserOnce(props, settlement);
    if (result !== null) {
      // A rejected settlement still requires client reconciliation after a successful retry.
      if (attempt > 0) {
        result.requiresUserRefresh = true;
        result.requiresProgressionRefresh = true;
      }
      return result;
    }
  }
  throw serverError("CONFLICT", "User state changed concurrently; please try again");
};

/** One snapshot/regen pass; null requests full hydration after a lost snapshot CAS. */
const fetchUpdatedUserOnce = async (
  props: {
    client: DrizzleClient;
    userId: string;
    userIp?: string;
    forceRegen?: boolean;
    /** Client responses opt in; server callers need canonical locations for tracker persistence. */
    hideInformation?: boolean;
    /** Display reads may retain a loaded team snapshot; progression callers require synchronization. */
    allowQuestPartySyncFallback?: boolean;
    /** Server actions can omit display-only alerts while retaining all readiness settlement. */
    includeNotifications?: boolean;
  },
  settlement: { startedQueuedJobs: number; hasRejectedPassiveRegen: boolean },
) => {
  // Destructure
  const {
    client,
    userId,
    userIp,
    hideInformation = false,
    includeNotifications = true,
  } = props;
  let { forceRegen } = props;
  let hasQuestPartySyncFailure = false;
  // Partial mutation responses must reconcile automatic progression beyond passive pools.
  let requiresUserRefresh = Boolean(forceRegen);
  let requiresProgressionRefresh = false;
  const now = new Date();
  // Shrine battle lobbies past this age are effectively dead — attackers
  // had LOBBY_SECONDS to gather, then STALE_LOBBY_SECONDS to initiate; beyond
  // that, the periodic cleanup will delete the row. Filter in the notification
  // query so alerts clear the moment a lobby ages out, not up to a minute later
  // when the cron tick actually runs.
  const shrineLobbyStaleBefore = shrineLobbyFreshAfter(now);

  const queryUpdatedUser = () =>
    client.query.userData.findFirst({
      where: eq(userData.userId, userId),
      extras: (table) => ({
        ...activityCompletionExtras(table.userId),
        displayTitle: displayTitleSql(table).as("displayTitle"),
      }),
      with: {
        bloodline: true,
        questParty: { with: questPartyRelations },
        sageMode: true,
        activeReskin: true,
        clan: true,
        village: {
          with: {
            structures: true,
            relationshipA: true,
            relationshipB: true,
            sectors: {
              columns: { sector: true, boostLockedUntil: true, shrineLevel: true },
            },
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
        items: {
          where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
          with: {
            item: true,
            imbuements: { with: { item: true } },
          },
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
        completedQuests: completedQuestHistoryRelation,
        votes: true,
        titles: { with: { title: true } },
        userSkills: { where: eq(userSkill.activated, true), with: { skill: true } },
        cookingJobs: true,
        raidBuffs: true,
        // Every queue entry, in the same query: users without queues pay nothing extra.
        queue: { orderBy: asc(userQueue.position) },
      },
    });

  // Ensure we can fetch the user
  const [
    achievements,
    settings,
    fetchedUser,
    hasUnvotedPolls,
    allActiveWars,
    mercenaryWarId,
    activeShrineBattles,
    activeRaids,
    questBootstrap,
  ] = await Promise.all([
    fetchAchievementCatalogue(client),
    fetchAllGameSettings(client),
    queryUpdatedUser(),
    includeNotifications ? fetchHasUnvotedPolls(client, userId, now) : [],
    fetchAllActiveWars(client),
    fetchMercenaryWarId(client, userId),
    includeNotifications
      ? fetchActiveShrineLobbies(client, shrineLobbyStaleBefore)
      : [],
    includeNotifications ? fetchActiveRaids(client, now) : [],
    fetchQuestBootstrap(client, userId),
  ]);
  let user:
    | (NonNullable<typeof fetchedUser> & { regenerationWithoutTimedBuffs?: number })
    | undefined = fetchedUser;

  // Start timed jobs (jutsu levels, crafts) whose turn has come, backdated to when it
  // came. The in-memory check keeps every other request free of extra queries. When a
  // due queue was settled, the user is read again.
  if (user && hasDueTimedJob(user.queue, now)) {
    try {
      settlement.startedQueuedJobs += await settleDueTimedQueues(client, [user], now);
      // Drops refund resources and remove rows too; reconcile every due settlement.
      user = await queryUpdatedUser();
      requiresUserRefresh = true;
      requiresProgressionRefresh = true;
    } catch (error) {
      // The queues stay as they are and are settled on the next request.
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "settleUserQueues" },
      });
    }
  }

  if (user) {
    try {
      if (await settleCookingExperience(client, userId, user.cookingJobs, now)) {
        requiresUserRefresh = true;
        user = await queryUpdatedUser();
      }
    } catch (error) {
      // Keep the loaded profile usable; unclaimed receipts retry on the next refresh.
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "settleCookingExperience" },
      });
    }
  }

  // Reskin bloodline if needed
  if (user?.bloodline && user?.activeReskin) {
    user.bloodline = getReskinnedBloodline(user.bloodline, user.activeReskin);
  }

  const publishedAchievementIds = achievements
    .filter((entry) => !questHasOverworldObjectives(entry))
    .map((entry) => entry.id);
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

  let progressionQuestCandidates: NonNullable<typeof user>["userQuests"] = [];
  // Add in achievements (in-memory placeholders: `id === questId` until `QuestHistory` exists).
  if (user) {
    const orphanedIsolatedIds = user.userQuests
      .filter(
        (entry) => !entry.quest && entry.isolated && !entry.endAt && !entry.completed,
      )
      .map((entry) => entry.id);
    if (orphanedIsolatedIds.length > 0) {
      // Persist retirement so middleware and mutation CAS guards release deleted runs too.
      // A restored definition or a different live run must survive a stale profile read.
      await retryOnDeadlock(() =>
        client
          .update(questHistory)
          .set({ endAt: now })
          .where(
            and(
              inArray(questHistory.id, orphanedIsolatedIds),
              eq(questHistory.userId, userId),
              eq(questHistory.isolated, true),
              eq(questHistory.completed, 0),
              isNull(questHistory.endAt),
              notExists(
                client
                  .select({ one: sql`1` })
                  .from(quest)
                  .where(eq(quest.id, questHistory.questId)),
              ),
            ),
          ),
      );
      requiresUserRefresh = true;
      requiresProgressionRefresh = true;
    }
    // Deleted quests can leave history behind; progression candidates need live definitions.
    user.userQuests = user.userQuests.filter((entry) => entry.quest);
    user.userQuests.push(...mockAchievementHistoryEntries(achievements, user));
    progressionQuestCandidates = [...user.userQuests];
    // Retain paused/invalid run history so isolation and abandonment stay accessible.
    user.userQuests = user.userQuests.filter(
      (q) =>
        ((q.questType === "battlepyramid" || q.isolated) && !q.endAt && !q.completed) ||
        isAvailableUserQuests({ ...q.quest, ...q }, user, true).check,
    );
    // Retired or deleted content cannot leave a player between floors indefinitely.
    // Recheck persisted isolation with the status claim so a fresh run wins the race.
    if (user.status === "BATTLE" && !user.battleId && !getIsolatedPyramid(user)) {
      const regenerationUser = {
        regeneration: calcActiveUserRegen(user, settings, false),
        regenAt: user.regenAt,
        raidBuffs: user.raidBuffs,
        titles: user.titles,
      };
      const recovery = getUserRegenerationGain(regenerationUser, now);
      const maxEnergy = calcMaxEnergy(user);
      const energy = Math.min(maxEnergy, user.curEnergy + recovery);
      const claim = await claimUserSnapshot({
        client,
        userId,
        updatedAt: user.updatedAt,
        where: [
          eq(userData.status, "BATTLE"),
          isNull(userData.battleId),
          notExists(
            client
              .select({ one: sql`1` })
              .from(questHistory)
              .innerJoin(quest, eq(quest.id, questHistory.questId))
              .where(
                and(
                  eq(questHistory.userId, userId),
                  eq(questHistory.isolated, true),
                  eq(questHistory.completed, 0),
                  isNull(questHistory.endAt),
                ),
              ),
          ),
        ],
        set: {
          bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
          bracketImmunityPausedAt: null,
          status: "AWAKE",
          curEnergy: sql`LEAST(${maxEnergy}, ${userData.curEnergy} + ${userRegenerationGainSql(regenerationUser, userData.regenAt, now)})`,
          regenAt: now,
        },
      });
      requiresUserRefresh = true;
      requiresProgressionRefresh = true;
      if (claim.success) {
        // The resumed timer depends on the committed pause duration.
        const immunity = await client.query.userData.findFirst({
          columns: { bracketImmunityLiftedUntil: true, bracketImmunityPausedAt: true },
          where: eq(userData.userId, userId),
        });
        Object.assign(user, {
          status: "AWAKE",
          updatedAt: claim.claimedAt,
          regenAt: now,
          curEnergy: energy,
          ...immunity,
        });
      } else {
        return null;
      }
    }
  }

  // Recover abandoned reservations after allowing an in-flight team creation to finish.
  // Deleted content also releases its slot through the same character snapshot guard.
  if (
    user?.questPartyId &&
    ((!user.questParty && secondsPassed(user.updatedAt) > 60) ||
      (user.questParty && !user.questParty.quest))
  ) {
    const released = await claimUserSnapshot({
      client,
      userId: user.userId,
      updatedAt: user.updatedAt,
      where: [eq(userData.questPartyId, user.questPartyId)],
      set: { questPartyId: null },
    });
    if (released.success) {
      user.updatedAt = released.claimedAt;
      user.questPartyId = null;
      user.questParty = null;
    }
  }
  if (user?.questParty) {
    try {
      user.questParty = await synchronizeQuestParty(client, user.questParty);
    } catch (error) {
      if (!props.allowQuestPartySyncFallback) throw error;
      hasQuestPartySyncFailure = true;
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "synchronizeQuestParty" },
      });
    }
    applyQuestParty(user, user.questParty);
  }

  // Filter and attach active wars for enemy_village sector type resolution
  if (user?.villageId) {
    const userActiveWars = allActiveWars.filter(
      (w) =>
        (!mercenaryWarId || w.id === mercenaryWarId) &&
        (w.attackerVillageId === user.villageId ||
          w.defenderVillageId === user.villageId ||
          w.warAllies.some((a) => a.villageId === user.villageId)),
    );
    (user as NonNullable<UserWithRelations>).activeWars = userActiveWars;
  }

  // Filter and attach active shrine battles
  if (user?.villageId) {
    const userActiveShrineBattles = activeShrineBattles.filter(
      (b) =>
        b.defenderEntityId === user.villageId || b.attackerEntityId === user.villageId,
    );
    (user as NonNullable<UserWithRelations>).shrineBattles = userActiveShrineBattles;
  }

  // Filter and attach active raids
  if (user) {
    // Get village-owned sectors for exclusive raid filtering
    const ownedSectorNumbers = new Set(
      user.village?.sectors?.map((s) => s.sector) ?? [],
    );

    const attackerDefeatedShrineSectors = new Set(
      allActiveWars
        .filter(
          (w) =>
            w.type === "SECTOR_WAR" &&
            w.defenderShrineHp <= 0 &&
            (w.attackerVillageId === user.villageId ||
              w.warAllies.some(
                (ally) =>
                  ally.villageId === user.villageId &&
                  ally.supportVillageId === w.attackerVillageId,
              )),
        )
        .map((w) => w.sector),
    );
    const userActiveRaids = activeRaids
      .filter((raid) =>
        isRaidListedForVillage(
          raid,
          user.villageId,
          ownedSectorNumbers,
          attackerDefeatedShrineSectors,
          now,
        ),
      )
      .flatMap((raid) => {
        const raidData = getRaidObjectiveData(raid);
        return raidData
          ? [
              {
                id: raid.id,
                name: raid.name,
                description: raid.description,
                image: raid.image,
                sector: raidData.sector,
                raidType: raidData.raidType,
                raidEndsAt: raid.raidEndsAt,
              },
            ]
          : [];
      });

    (user as NonNullable<UserWithRelations>).activeRaids = userActiveRaids;
  }

  // Retain the stored base rate separately from the derived rate for accrued ticks.
  // Settle accrued pools when a regeneration bonus crosses a boundary, even inside the normal throttle.
  if (
    user &&
    regenerationBuffs(user).some(
      (buff) =>
        buff.effects.some((effect) => effect.type === "increaseregeneration") &&
        [buff.createdAt, buff.expiresAt].some(
          (date) => date > user.regenAt && date <= now,
        ),
    )
  )
    forceRegen = true;

  const storedRegeneration = user?.regeneration;
  let regenerationAfterExpulsion: number | undefined;
  let accruedBaseRegeneration = 0;
  if (user) {
    // Add bloodline, structure, etc.  regen to regeneration
    accruedBaseRegeneration = calcActiveUserRegen(user, settings, false);
    user.regenerationWithoutTimedBuffs = accruedBaseRegeneration;
    user.regeneration = getTimedRegeneration(
      accruedBaseRegeneration,
      regenerationBuffs(user),
    );
    user.maxEnergy = calcMaxEnergy(user);
  }

  if (user && hasQuestPartySyncFailure) {
    // Render the loaded snapshot with feedback, but defer bookkeeping that could persist
    // unsynchronized quest progress or run its effects. Mutating callers never opt into this path.
    const responseUser = hideInformation ? getPublicQuestUser(user) : user;
    const trackerResults: ReturnType<typeof getNewTrackers> = {
      trackers: user.questData ?? [],
      notifications: [],
      consequences: [],
      questIdsUpdated: [],
    };
    return {
      user: { ...responseUser, effectiveMasteries: effectiveMasteries(user) },
      settings,
      publishedAchievementIds,
      progressionQuestCandidates,
      questBootstrap,
      requiresProgressionRefresh: true,
      requiresUserRefresh: true,
      toastMessages: ["Quest team progress will update on your next request."],
      hasUnvotedPolls,
      trackerResults,
      startedQueuedJobs: settlement.startedQueuedJobs,
    };
  }

  // Surviving memberships are durable retry markers after failed expulsion cleanup.
  if (user?.isOutlaw) {
    const [squadData, clanData] = await Promise.all([
      user.anbuId ? fetchSquad(client, user.anbuId) : null,
      user.clanId && user.clan?.villageId !== user.villageId
        ? fetchClan(client, user.clanId)
        : null,
    ]);
    // Outlaws retain factions belonging to Syndicate, hideouts and strongholds.
    const needsClanCleanup = clanData?.village?.type === "VILLAGE";
    const [removedFromSquad] = await Promise.all([
      squadData ? removeFromSquad(client, squadData, user.userId) : false,
      needsClanCleanup
        ? removeFromClan(client, clanData, user, ["Turned outlaw"])
        : null,
    ]);
    if (removedFromSquad) {
      user.anbuId = null;
      user.anbuSquad = null;
    }
    if (needsClanCleanup) {
      user.clanId = null;
      user.clan = null;
      requiresUserRefresh = true;
      requiresProgressionRefresh = true;
    }
  }

  // Handle village prestige situations
  if (user) {
    // If prestige below 0, reset to 0 and move to outlaw faction
    if (
      !user.isOutlaw &&
      user.villagePrestige < 0 &&
      user.village?.type === "VILLAGE"
    ) {
      // Check if we need to remove the kage
      const needNewKage =
        user.villageId &&
        user.village?.kageId === user.userId &&
        user.villagePrestige < KAGE_MIN_PRESTIGE;
      // Run queries in parallel for speed
      const [syndicate, clanData, squadData, elder] = await Promise.all([
        client.query.village.findFirst({
          where: eq(village.type, "OUTLAW"),
          with: { structures: true },
        }),
        user.clanId ? fetchClan(client, user.clanId) : null,
        user.anbuId ? fetchSquad(client, user.anbuId) : null,
        needNewKage && user.villageId
          ? fetchKageReplacement(client, user.villageId, user.userId)
          : null,
      ]);
      if (syndicate) {
        const previousVillageId = user.villageId;
        // Membership and tenure change together only while the prestige/village snapshot matches.
        const kickUpdate = {
          villagePrestige: Math.abs(user.villagePrestige),
          villageId: syndicate.id,
          isOutlaw: true,
          joinedVillageAt: new Date(),
        };
        const expectedVillage = previousVillageId
          ? eq(userData.villageId, previousVillageId)
          : isNull(userData.villageId);
        const kickResult = await client
          .update(userData)
          .set(kickUpdate)
          .where(
            and(
              eq(userData.userId, user.userId),
              eq(userData.villagePrestige, user.villagePrestige),
              eq(userData.isOutlaw, false),
              expectedVillage,
            ),
          );
        if (kickResult.rowsAffected !== 1) return null;
        Object.assign(user, kickUpdate);
        if (storedRegeneration !== undefined) {
          // Keep accrued ticks at the member rate; future ticks use the new membership.
          user.regenerationWithoutTimedBuffs = calcActiveUserRegen(
            { ...user, regeneration: storedRegeneration, village: syndicate },
            settings,
            false,
          );
          regenerationAfterExpulsion = getTimedRegeneration(
            user.regenerationWithoutTimedBuffs,
            regenerationBuffs(user),
          );
        }
        forceRegen = true;
        requiresUserRefresh = true;
        requiresProgressionRefresh = true;
        void pusher.trigger(user.userId, "event", {
          type: "userMessage",
          message: "You have been kicked out of your village due to negative prestige",
          route: "/profile",
          routeText: "To Profile",
        });
        // Complete the guarded transition before starting related membership cleanup.
        await Promise.all([
          ...(user.anbuId && squadData
            ? [removeFromSquad(client, squadData, user.userId)]
            : []),
          ...(user.clanId && clanData
            ? [removeFromClan(client, clanData, user, ["Turned outlaw"])]
            : []),
          ...(needNewKage && elder && previousVillageId
            ? [
                client
                  .update(village)
                  .set({ kageId: elder.userId, leaderUpdatedAt: new Date() })
                  .where(eq(village.id, previousVillageId)),
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
              ]
            : []),
        ]);
      }
    }
  }

  // Ensure that we have tier & exam quests. These bootstraps only exist to hand the user their
  // next quest, and they run on every user fetch, so a transient database error here must not
  // fail the whole fetch; the next fetch retries the bootstrap.
  // They run in sequence, not in parallel: insertNextQuest mutates user.userQuests and
  // persists its own questData snapshot, so concurrent inserts overwrite each other.
  if (user) {
    for (const questType of BOOTSTRAP_QUEST_TYPES) {
      if (user.userQuests?.some((q) => q.quest.questType === questType)) continue;
      if (!canBootstrapQuestType(questBootstrap, questType, user.level)) continue;
      try {
        if (await insertNextQuest(client, user, questType)) {
          forceRegen = true;
          requiresUserRefresh = true;
          requiresProgressionRefresh = true;
        }
      } catch (e) {
        Sentry.captureException(e, {
          level: "warning",
          tags: { questBootstrap: questType },
        });
      }
    }
  }

  // Rewards, e.g. for activity streak
  const toastMessages: string[] = [];

  // If more than 5min since last user update, update the user with regen. We do not need this to be synchronous
  // and it is mostly done to keep user updated on the overview pages
  if (
    user &&
    !settlement.hasRejectedPassiveRegen &&
    ["AWAKE", "ASLEEP"].includes(user.status)
  ) {
    // Get activity rewards if any & update timers
    const now = new Date();
    const newDay = isDifferentDay(now, user.updatedAt);

    // Check if travel should be completed automatically
    if (user.status === "TRAVEL" && user.travelFinishAt && user.travelFinishAt <= now) {
      user.status = "AWAKE";
      user.travelFinishAt = null;
      forceRegen = true;
      requiresUserRefresh = true;
      requiresProgressionRefresh = true;
      toastMessages.push("You have arrived at your destination!");
    }

    // Figure out if we're running update
    const sinceUpdate = secondsPassed(user.updatedAt);
    const ticks = Math.max(0, Math.floor(secondsPassed(user.regenAt) / REGEN_SECONDS));
    // Queued Energy and mastery training, settled in memory from the loaded rows.
    const regenerationGain = (fromTick: number, toTick: number) =>
      getTimedRegenerationGain(
        accruedBaseRegeneration,
        regenerationBuffs(user),
        new Date(user.regenAt.getTime() + fromTick * REGEN_SECONDS * 1000),
        toTick - fromTick,
        REGEN_SECONDS,
      );
    const queued = settleQueuedTraining(
      user,
      user.queue,
      settings,
      ticks,
      now,
      regenerationGain,
    );
    const queuedTraining = queued.energy;
    const queuedMastery = queued.mastery;
    // A queue only bypasses the overview throttle when recovery or an entry can
    // advance, avoiding snapshot conflicts on repeated reads within one tick.
    const hasQueueProgress =
      queuedTraining && (ticks > 0 || queuedTraining.consumed > 0);
    if (hasQueueProgress || queuedMastery) requiresUserRefresh = true;
    const masteryTrainingSession = {
      currentlyTrainingMastery: user.currentlyTrainingMastery,
      masteryTrainingStartedAt: user.masteryTrainingStartedAt,
      currentlyTrainingElement: user.currentlyTrainingElement,
      elementalTrainingStartedAt: user.elementalTrainingStartedAt,
      masteryRanks: user.masteryRanks,
      elementalMastery: user.elementalMastery,
      bloodlineId: user.bloodlineId,
      primaryElement: user.primaryElement,
      secondaryElement: user.secondaryElement,
      ...Object.fromEntries(MasteryNames.map((stat) => [stat, user[stat]])),
    };
    if (
      newDay ||
      hasQueueProgress ||
      queuedMastery ||
      sinceUpdate > 300 || // Update user in database every 5 minutes only so as to reduce server load
      forceRegen || // Hard overwrite for e.g. debugging or simply ensuring updated user
      (user.villagePrestige < 0 && !user.isOutlaw) // To trigger getting kicked out of village
    ) {
      requiresUserRefresh = true;
      const originalUpdatedAt = user.updatedAt;
      const queuedTrainingSnapshot =
        queuedTraining || queuedMastery
          ? { ...user, questData: structuredClone(user.questData) }
          : null;
      const regen = regenerationGain(0, ticks);
      // These pools are integer columns; expose the same rounding MySQL persists.
      user.curHealth = Math.round(Math.min(user.curHealth + regen, user.maxHealth));
      user.curStamina = Math.round(Math.min(user.curStamina + regen, user.maxStamina));
      user.curChakra = Math.round(Math.min(user.curChakra + regen, user.maxChakra));
      user.curEnergy =
        queuedTraining?.curEnergy ?? Math.min(user.curEnergy + regen, user.maxEnergy);
      if (queuedTraining) {
        user.energyQueueHead = queuedTraining.head;
        const trained = queuedTraining.completed.reduce(
          (sum, entry) => sum + entry.amount,
          0,
        );
        for (const [stat, amount] of Object.entries(queuedTraining.gains)) {
          user[stat as CombatStatName] += amount;
        }
        user.experience = Math.round(user.experience + trained);
        if (trained > 0)
          user.questData = filterQuestTrackersForDbPersist(
            getNewTrackers(user, [{ task: "stats_trained", increment: trained }])
              .trackers,
            user,
          );
      }
      if (queuedMastery) {
        Object.assign(user, applyMasteryTrainingGains(user, queuedMastery.gains));
        Object.assign(user, queuedMastery.update);
        const minutes = queuedMastery.completed.reduce((sum, e) => sum + e.minutes, 0);
        if (minutes > 0)
          user.questData = filterQuestTrackersForDbPersist(
            getNewTrackers(user, [{ task: "minutes_training", increment: minutes }])
              .trackers,
            user,
          );
      }
      user.updatedAt = now;
      user.regenAt = secondsFromDate(ticks * REGEN_SECONDS, user.regenAt);

      // Ensure that the user has elements
      const rankId = UserRanks.indexOf(user.rank);
      if (rankId >= 1 && !user.primaryElement) {
        user.primaryElement = getRandomElement(BasicElementName) ?? null;
        requiresUserRefresh = true;
        requiresProgressionRefresh = true;
      }
      if (rankId >= 2 && !user.secondaryElement) {
        const available = BasicElementName.filter((e) => e !== user.primaryElement);
        user.secondaryElement = getRandomElement(available) ?? null;
        requiresUserRefresh = true;
        requiresProgressionRefresh = true;
      }
      // Update database (pools, questData, etc.; village columns only when includeVillageState)
      try {
        const persisted = await persistPassiveRegenToDb({
          client,
          userId,
          user,
          userIp,
          forceRegen: forceRegen ?? false,
          originalUpdatedAt,
          queuedTraining,
          onVillageStateChanged: () => {
            requiresProgressionRefresh = true;
          },
          queuedMastery: queuedMastery
            ? { ...queuedMastery, original: masteryTrainingSession }
            : null,
        });
        if (!persisted) {
          // Rebuild achievement placeholders, party projection and derived fields together.
          // Defer settlement to the next request; the winning state may have moved locations.
          settlement.hasRejectedPassiveRegen = true;
          return null;
        }
      } catch (error) {
        requiresProgressionRefresh = true;
        if (queuedTrainingSnapshot) Object.assign(user, queuedTrainingSnapshot);
        // Regen is background bookkeeping and is already applied to the returned
        // in-memory user, so a database blip here must not fail the query that
        // happened to trigger it. The next request persists it instead.
        Sentry.captureException(error, {
          level: "warning",
          tags: { source: "persistPassiveRegenToDb" },
        });
      }
    }
  }
  if (user) {
    // Completed mastery training can unlock Energy capacity bonuses on worn gear.
    user.maxEnergy = calcMaxEnergy(user);
    const trackerUser = await hydrateQuestCollections(client, user);
    // Get the latest quest trackers
    const trackerResults = getNewTrackers(
      trackerUser,
      [{ task: "any" }],
      undefined,
      undefined,
      undefined,
      // Combat settlement owns the preloaded personal tracker until it finishes.
      user.status !== "BATTLE",
    );

    // Destructure for local usage
    const { trackers, notifications, consequences } = trackerResults;

    // Quest targets (random rolls, village-relative or authored coordinates) may sit on
    // water or obstacles of the published sector map. Check new targets and recheck those in
    // the current sector so map edits cannot strand an active mission. Published maps use the
    // shared TTL cache; unchanged targets do not trigger another tracker write. This depends
    // on the sectors rolled above, so it cannot join an earlier Promise.all.
    const targetSectors = getQuestTargetSectorsToCheck(user, trackers, true);
    if (targetSectors.length > 0) {
      const sectorMaps = await fetchPublishedSectorMaps(client, targetSectors).catch(
        (error: unknown) => {
          // Retried on the next read; the unchecked target stays usable meanwhile.
          Sentry.captureException(error, {
            level: "warning",
            tags: { source: "snapQuestTargetsToReachable" },
          });
          return null;
        },
      );
      if (sectorMaps && snapQuestTargetsToReachable(user, trackers, sectorMaps)) {
        consequences.push({ type: "update_user", ids: ["location_update"] });
      }
    }

    if (consequences.length > 0) requiresUserRefresh = true;
    if (consequences.some((entry) => entry.type !== "update_user"))
      requiresProgressionRefresh = true;
    const fullTrackers = trackers;
    user.questData = filterQuestTrackersForDbPersist(trackers, user);

    // Handle any update on quest consequences
    const consequenceResult = await handleQuestConsequences(
      client,
      user,
      consequences,
      notifications,
      { claimConditions: [eq(userData.status, user.status)] },
    );
    toastMessages.push(...consequenceResult.notifications);
    if (!consequenceResult.claimed) requiresProgressionRefresh = true;

    user.questData = fullTrackers;

    // Mask response copies only: trackerResults is reused by server-side quest updates.
    const responseUser = hideInformation ? getPublicQuestUser(user) : user;
    return {
      user: {
        ...responseUser,
        regeneration: regenerationAfterExpulsion ?? responseUser.regeneration,
        effectiveMasteries: effectiveMasteries(user),
      },
      settings,
      publishedAchievementIds,
      progressionQuestCandidates,
      questBootstrap,
      requiresProgressionRefresh:
        requiresProgressionRefresh ||
        toastMessages.length > 0 ||
        Boolean(user?.unreadNotifications || user?.unreadRecruitRewards),
      toastMessages,
      hasUnvotedPolls,
      trackerResults,
      requiresUserRefresh: requiresUserRefresh || toastMessages.length > 0,
      /** Queued jutsu levels or crafts started by this refresh */
      startedQueuedJobs: settlement.startedQueuedJobs,
    };
  } else {
    return {
      user,
      settings,
      publishedAchievementIds,
      progressionQuestCandidates,
      questBootstrap,
      requiresProgressionRefresh:
        requiresProgressionRefresh || toastMessages.length > 0,
      toastMessages,
      hasUnvotedPolls,
      trackerResults: null,
      requiresUserRefresh: requiresUserRefresh || toastMessages.length > 0,
      startedQueuedJobs: settlement.startedQueuedJobs,
    };
  }
};

/** Writes passive regen fields to userData after refreshing any included village state. */
const persistPassiveRegenToDb = async ({
  client,
  userId,
  user,
  userIp,
  forceRegen,
  originalUpdatedAt,
  queuedTraining,
  onVillageStateChanged,
  queuedMastery,
}: {
  client: DrizzleClient;
  userId: string;
  user: NonNullable<UserWithRelations>;
  userIp?: string;
  forceRegen: boolean;
  originalUpdatedAt: Date;
  queuedTraining?: ReturnType<typeof settleQueuedTraining>["energy"];
  onVillageStateChanged?: () => void;
  queuedMastery?:
    | (NonNullable<ReturnType<typeof settleQueuedTraining>["mastery"]> & {
        original: Pick<
          UserData,
          | "currentlyTrainingMastery"
          | "masteryTrainingStartedAt"
          | "currentlyTrainingElement"
          | "elementalTrainingStartedAt"
          | "masteryRanks"
          | "elementalMastery"
          | "bloodlineId"
          | "primaryElement"
          | "secondaryElement"
        > &
          Partial<Record<MasteryName, number>>;
      })
    | null;
}) => {
  const includeVillageState = forceRegen || (user.villagePrestige < 0 && user.isOutlaw);

  // Persist history before appending: concurrent deletion either reads this IP or creates
  // a retained source in time for the append to preserve it before history is removed.
  const historicalIpPromise =
    userIp && user.lastIp !== userIp
      ? client
          .insert(historicalIp)
          .values({
            userId,
            ip: userIp,
            ipHash: hashIp(userIp),
          })
          .onDuplicateKeyUpdate({
            set: { usedAt: new Date(), ipHash: hashIp(userIp) },
          })
          .then(() => retainSanctionIps(client, userId, [userIp]))
      : Promise.resolve(null);

  const [freshVillageRow] = await Promise.all([
    includeVillageState
      ? client.query.userData.findFirst({
          where: eq(userData.userId, userId),
          columns: {
            villagePrestige: true,
            villageId: true,
            isOutlaw: true,
          },
        })
      : Promise.resolve(null),
    historicalIpPromise,
  ]);

  let userForRegenPersist = user;
  if (includeVillageState && freshVillageRow) {
    if (
      freshVillageRow.villageId !== user.villageId ||
      freshVillageRow.isOutlaw !== user.isOutlaw ||
      freshVillageRow.villagePrestige !== user.villagePrestige
    )
      onVillageStateChanged?.();
    userForRegenPersist = { ...user, ...freshVillageRow };
  }

  const derivedUserUpdate = buildDerivedUserRegenUpdate({
    user: userForRegenPersist,
    userIp,
    includeVillageState,
  });
  derivedUserUpdate.questData = filterQuestTrackersForDbPersist(
    userForRegenPersist.questData ?? [],
    userForRegenPersist,
  );

  if (queuedTraining) {
    derivedUserUpdate.energyQueueHead = queuedTraining.head;
    for (const stat of Object.keys(queuedTraining.gains)) {
      derivedUserUpdate[stat] = user[stat as CombatStatName];
    }
    derivedUserUpdate.experience = user.experience;
    derivedUserUpdate.petExperience = petExperienceGainSql(
      queuedTraining.completed.reduce((sum, entry) => sum + entry.amount, 0),
    );
  }

  if (queuedMastery) {
    Object.assign(derivedUserUpdate, queuedMastery.update);
    Object.assign(derivedUserUpdate, masteryGainUpdates(queuedMastery.gains));
    derivedUserUpdate.elementalMastery = user.elementalMastery;
  }

  // A delayed regeneration must not restore pools from before a heal or another user claim.
  // claimUserSnapshot advances updatedAt and writes the regeneration fields together.
  delete derivedUserUpdate.updatedAt;
  const claim = await claimUserSnapshot({
    client,
    userId,
    updatedAt: originalUpdatedAt,
    // Status transitions can occur without advancing the snapshot timestamp.
    where: [
      eq(userData.status, user.status),
      ...(queuedTraining
        ? [
            eq(userData.sector, user.sector),
            eq(userData.longitude, user.longitude),
            eq(userData.latitude, user.latitude),
            user.villageId === null
              ? isNull(userData.villageId)
              : eq(userData.villageId, user.villageId),
            eq(userData.isOutlaw, user.isOutlaw),
            eq(userData.isBanned, user.isBanned),
            eq(userData.rank, user.rank),
          ]
        : []),
      // The settled session must still be the one that was read.
      ...(queuedMastery
        ? [
            ...MasteryNames.map((stat) =>
              eq(userData[stat], queuedMastery.original[stat] ?? 0),
            ),
            ...elementalSnapshotConditions(queuedMastery.original),
            queuedMastery.original.currentlyTrainingElement
              ? eq(
                  userData.currentlyTrainingElement,
                  queuedMastery.original.currentlyTrainingElement,
                )
              : isNull(userData.currentlyTrainingElement),
            queuedMastery.original.elementalTrainingStartedAt
              ? eq(
                  userData.elementalTrainingStartedAt,
                  queuedMastery.original.elementalTrainingStartedAt,
                )
              : isNull(userData.elementalTrainingStartedAt),
            sql`${userData.masteryRanks} = CAST(${JSON.stringify(queuedMastery.original.masteryRanks)} AS JSON)`,
            queuedMastery.original.currentlyTrainingMastery
              ? eq(
                  userData.currentlyTrainingMastery,
                  queuedMastery.original.currentlyTrainingMastery,
                )
              : isNull(userData.currentlyTrainingMastery),
            queuedMastery.original.masteryTrainingStartedAt
              ? eq(
                  userData.masteryTrainingStartedAt,
                  queuedMastery.original.masteryTrainingStartedAt,
                )
              : isNull(userData.masteryTrainingStartedAt),
          ]
        : []),
    ],
    set: derivedUserUpdate,
  });
  if (claim.success) {
    user.updatedAt = claim.claimedAt;
    if (queuedTraining?.completed.length) {
      try {
        await client.insert(trainingLog).values(
          queuedTraining.completed.map((entry) => ({
            userId,
            stat: entry.stat,
            amount: entry.amount,
            speed: user.trainingSpeed,
            trainingFinishedAt: claim.claimedAt,
          })),
        );
      } catch (error) {
        Sentry.captureException(error, { tags: { source: "energyTrainingQueueLog" } });
      }
    }
    if (queuedMastery?.completed.length) {
      try {
        await client.insert(trainingLog).values(
          queuedMastery.completed.map((entry) => ({
            userId,
            stat: entry.stat,
            amount: entry.amount,
            speed: entry.speed,
            trainingFinishedAt: entry.finishedAt,
          })),
        );
      } catch (error) {
        Sentry.captureException(error, { tags: { source: "masteryTrainingQueueLog" } });
      }
    }
  }
  return claim.success;
};

/**
 * Global game state that `fetchUpdatedUser` needs on every call, memoized for the
 * duration of one HTTP request by {@link scopedRead}.
 *
 * None of these predicates mention a user, so a tRPC batch used to re-read the same
 * rows once per procedure - and `fetchUpdatedUser` is called by nearly every
 * procedure the busy pages mount. Sharing them collapses that fan-out to one read
 * each without changing what any caller sees: `scopedRead` hands out clones, so the
 * per-user rewriting that happens downstream (hiding quest locations, attaching the
 * user's own subset of wars/raids/lobbies) still operates on private copies.
 *
 * The lobby and raid cutoffs are evaluated against the first caller's `now`. Later
 * callers in the same request therefore inherit a cutoff that is milliseconds old,
 * which is well inside the minute-scale windows both filters describe.
 */
export const fetchAchievementCatalogue = (client: DrizzleClient) =>
  scopedRead("achievements", () =>
    client
      .select()
      .from(quest)
      .where(and(eq(quest.questType, "achievement"), eq(quest.hidden, false))),
  );

/**
 * The achievements whose definitions `quests.getAchievementCatalogue` publishes for the client to
 * cache, and therefore exactly the ones `profile.getUser` may send as progress alone.
 *
 * Both sides read this one list rather than re-deciding with a predicate: by the time `getUser`
 * runs, `fetchUpdatedUser` has rewritten the objectives on its own copy of these quests - trackers
 * write resolved coordinates back onto them, and location hiding rewrites them again - so a
 * predicate applied there and a predicate applied to the raw row can disagree, and a progress row
 * whose definition the catalogue withholds renders nothing at all.
 *
 * Inside a request scope the underlying read is memoized, so a caller that has already gone
 * through `fetchUpdatedUser` pays nothing for this.
 */
export const fetchPublishedAchievements = async (client: DrizzleClient) =>
  (await fetchAchievementCatalogue(client)).filter(
    (achievement) => !questHasOverworldObjectives(achievement),
  );

export const fetchAllGameSettings = (client: DrizzleClient) =>
  scopedRead("gameSettings", async () => {
    const [settings, average] = await Promise.all([
      client.select().from(gameSetting),
      fetchPvpExperienceAverage(client),
    ]);
    return [...settings, average];
  });

const fetchHasUnvotedPolls = (client: DrizzleClient, userId: string, now: Date) =>
  scopedRead(`unvotedPolls:${userId}`, () =>
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
          or(isNull(poll.endDate), gt(poll.endDate, now)),
          // User hasn't voted on this poll
          isNull(userPollVote.id),
        ),
      )
      .limit(1),
  );

/** All active wars, for enemy_village sector type resolution. */
const fetchAllActiveWars = (client: DrizzleClient) =>
  scopedRead("allActiveWars", () =>
    client.query.war.findMany({
      where: isNull(war.endedAt),
      columns: {
        id: true,
        type: true,
        status: true,
        defenderShrineHp: true,
        attackerVillageId: true,
        defenderVillageId: true,
        sector: true,
      },
      with: {
        attackerVillage: { columns: { id: true, name: true, sector: true } },
        defenderVillage: { columns: { id: true, name: true, sector: true } },
        warAllies: { where: activeWarAllyWhere() },
      },
    }),
  );

/** Shrine battle lobbies whose battle has not started and that are not yet stale. */
const fetchActiveShrineLobbies = (client: DrizzleClient, staleBefore: Date) =>
  scopedRead("activeShrineLobbies", () =>
    client.query.mpvpBattleQueue.findMany({
      where: and(
        eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
        isNull(mpvpBattleQueue.battleId),
        gt(mpvpBattleQueue.createdAt, staleBefore),
      ),
    }),
  );

/** All raids whose boss is still standing and whose window has not closed. */
const fetchActiveRaids = (client: DrizzleClient, now: Date) =>
  scopedRead("activeRaids", () =>
    client.query.quest.findMany({
      where: and(
        eq(quest.questType, "raid"),
        eq(quest.hidden, false),
        gte(quest.raidBossCurrentHealth, 1),
        or(isNull(quest.raidEndsAt), gte(quest.raidEndsAt, now)),
      ),
    }),
  );

/** A user's progress on one quest, without the static definition it belongs to. */
export type AchievementProgress = Omit<UserQuest, "quest">;

/** The quest types fetchUpdatedUser tries to start a user on when they hold none. */
const BOOTSTRAP_QUEST_TYPES = ["tier", "exam"] as const;

/**
 * What the tier/exam bootstrap needs before it can tell whether starting a quest is even
 * possible: every quest of those types, each carrying whether this user has a history row for it.
 *
 * Deliberately the same left join fetchUncompletedQuests itself performs — on questId and userId,
 * with `completed` selected — so the guard below can test `completed === null` and be reading the
 * identical condition rather than an argument that resembles it. Joining rather than reading the
 * two tables separately also keeps `QuestHistory.questType` out of it, which is denormalised from
 * the quest and can drift.
 *
 * It depends only on `userId`, so it belongs in fetchUpdatedUser's opening batch rather than
 * costing a round-trip of its own.
 */
export const fetchQuestBootstrap = (client: DrizzleClient, userId: string) =>
  scopedRead(`questBootstrap:${userId}`, () =>
    client
      .select({
        id: quest.id,
        questType: quest.questType,
        requiredLevel: quest.requiredLevel,
        maxLevel: quest.maxLevel,
        completed: questHistory.completed,
      })
      .from(quest)
      .leftJoin(
        questHistory,
        and(eq(questHistory.questId, quest.id), eq(questHistory.userId, userId)),
      )
      .where(inArray(quest.questType, [...BOOTSTRAP_QUEST_TYPES])),
  );

/**
 * Whether starting a quest of this type is even possible, from what fetchQuestBootstrap read.
 *
 * A strict subset of fetchUncompletedQuests' filters — quest type, level band, and that same
 * `isNull(completed)` on the join — so a `false` means that query is guaranteed to return nothing
 * and the round-trip buys nothing. Everything else it filters on (farming level, the date window,
 * quest rank, village, bloodline, sage requirements, hidden) is deliberately not checked here:
 * leaving a filter out can only let a call through that would have been skipped, never the
 * reverse. A `true` still goes to insertNextQuest, which remains the authority.
 */
export const canBootstrapQuestType = (
  candidates: Awaited<ReturnType<typeof fetchQuestBootstrap>>,
  questType: (typeof BOOTSTRAP_QUEST_TYPES)[number],
  level: number,
) =>
  candidates.some(
    (candidate) =>
      candidate.questType === questType &&
      candidate.completed === null &&
      candidate.requiredLevel <= level &&
      getQuestMaxLevel(candidate) >= level,
  );

/**
 * Move a user's achievement rows out of `user.userQuests` and return them without their `quest`.
 *
 * Achievements are global static content: every player is handed the same definitions, and
 * `mockAchievementHistoryEntries` attaches the whole `Quest` row - every objective with its
 * description, scene assets and reward spec - to a progress row that is otherwise a handful of
 * counters. Sending that from `profile.getUser` re-serialised, re-transferred and re-parsed tens
 * of kilobytes of unchanging catalogue JSON on every page load. The client joins the returned
 * progress against `quests.getAchievementCatalogue`, which it holds for the session.
 *
 * A row moves exactly when `published` carries its definition, which makes the two halves a
 * partition by construction: nothing is sent twice, and nothing is stranded as a progress row the
 * client cannot resolve. Everything else - a hidden achievement, one the overworld still needs,
 * an orphaned row whose quest was deleted - stays on the user object untouched.
 */
export const splitAchievementProgress = (
  user: NonNullable<UserWithRelations>,
  published: Quest[],
) => {
  const publishedIds = new Set(published.map((achievement) => achievement.id));
  const progress: AchievementProgress[] = [];
  user.userQuests = user.userQuests.filter((userQuest) => {
    if (!publishedIds.has(userQuest.questId)) return true;
    const { quest: _definition, ...rest } = userQuest;
    progress.push(rest);
    return false;
  });
  return progress;
};

export const fetchPublicUsers = async (info: {
  client: DrizzleClient;
  input: GetPublicUsersSchema;
  userId?: string | null;
  includeEffects?: boolean;
}) => {
  const { client, input, userId, includeEffects } = info;
  const currentCursor = input.cursor ? input.cursor : 0;
  const skip = currentCursor * input.limit;
  const getOrder = () => {
    switch (input.orderBy) {
      case "Online":
        return [desc(userData.updatedAt)];
      case "Strongest":
        return [desc(userData.level), desc(userData.experience)];
      case "Crafting":
        return [desc(userData.craftingExperience), desc(userData.experience)];
      case "Farming":
        return [desc(userData.farmingExperience), desc(userData.experience)];
      case "Medical":
        return [desc(userData.medicalExperience), desc(userData.experience)];
      case "PvP":
        // Rank by PvP XP, with character XP as the tie-breaker.
        return [desc(userData.pvpExperience), desc(userData.experience)];
      case "Ranked":
        return [desc(userData.rankedLp), desc(userData.experience)];
      case "Staff":
        return [desc(userData.tavernMessages)];
      case "Outlaws":
        return [desc(userData.villagePrestige)];
      case "Community":
        return [desc(userData.tavernMessages)];
      case "Dailies":
        return [
          desc(
            sql`${userData.dailyArenaFights} + ${userData.dailyMissions} + ${userData.dailyErrands}`,
          ),
          desc(userData.experience),
        ];
      case "Recruiters":
        // Most efficient: use denormalized counter maintained on userData
        return [desc(userData.nRecruited), desc(userData.experience)];
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
        ...(input.inArena !== undefined ? [eq(userData.inArena, !!input.inArena)] : []),
        ...(input.isEvent !== undefined ? [eq(userData.isEvent, !!input.isEvent)] : []),
        ...(input.isWarCamp !== undefined
          ? [eq(userData.isWarCamp, !!input.isWarCamp)]
          : []),
        ...(input.isSummon !== undefined
          ? [eq(userData.isSummon, !!input.isSummon)]
          : []),
        ...(input.inShrines !== undefined
          ? [eq(userData.inShrines, !!input.inShrines)]
          : []),
      ),
      columns: {
        avatar: true,
        avatar3d: true,
        avatarLight: true,
        experience: true,
        nRecruited: true,
        inArena: true,
        inShrines: true,
        isAi: true,
        isEvent: true,
        isWarCamp: true,
        isOutlaw: true,
        isSummon: true,
        lastIp: true,
        level: true,
        pvpExperience: true,
        rankedLp: true,
        rank: true,
        reputationPointsTotal: true,
        role: true,
        updatedAt: true,
        userId: true,
        username: true,
        villageId: true,
        craftingExperience: true,
        farmingExperience: true,
        medicalExperience: true,
        villagePrestige: true,
        tavernMessages: true,
        dailyArenaFights: true,
        dailyMissions: true,
        dailyErrands: true,
        effects: true,
      },
      // If AI, also include relations information
      with: {
        village: { columns: { name: true } },
        ...(input.isAi && includeEffects
          ? {
              jutsus: {
                columns: { level: true },
                with: {
                  jutsu: {
                    columns: {
                      name: true,
                      effects: true,
                    },
                  },
                },
              },
              items: {
                columns: {
                  itemId: true,
                },
                with: {
                  item: {
                    columns: {
                      effects: true,
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
    // Only the caller's role is read, to decide whether IPs may be seen. This runs
    // on most page loads (the online-players sidebar), so it selects that one column
    // rather than the whole ~90-column row.
    ...(userId
      ? [
          client.query.userData.findFirst({
            where: eq(userData.userId, userId),
            columns: { role: true },
          }),
        ]
      : [null]),
  ]);
  // Guard
  if (input.ip && (!user || !canSeeIps(user.role))) {
    throw serverError("FORBIDDEN", "You are not allowed to search IPs");
  }
  // Hide stuff
  users
    .filter((u) => !u.lastIp)
    .forEach((u) => {
      u.lastIp = "Proxied";
    });
  if (!user || !canSeeIps(user.role)) {
    users.forEach((u) => {
      u.lastIp = "hidden";
    });
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

/**
 * Scale an edited AI row to its level before it is saved. Changed combat stats are the
 * editor's focus weights and spread the whole AI budget; otherwise the stored experience
 * makes a save the identity at the same level and a proportional rescale on a level
 * change, and a new stats multiplier applies to the stored stats.
 */
export const scaleEditedAi = (stored: UserData, edited: UserData) => {
  const reweight = CombatStatNames.some((stat) => edited[stat] !== stored[stat]);
  if (!reweight && edited.statsMultiplier !== stored.statsMultiplier) {
    for (const stat of CombatStatNames) {
      edited[stat] = (stored[stat] / stored.statsMultiplier) * edited.statsMultiplier;
    }
  }
  scaleUserStats(edited, "ai", { reweight });
  // Battles keep scaled pools in memory, but the saved row must fit its smallint columns.
  clampStoredPools(edited);
};

export type UserWithRelations =
  | (UserData & {
      /** Derived regeneration before timed bonuses, retained for pending recovery ticks. */
      regenerationWithoutTimedBuffs?: number;
      displayTitle?: string;
      dungeonsCompleted?: number;
      raidsCompleted?: number;
      titles?: (UserTitle & { title?: import("@/drizzle/schema").Title })[];
      raidBuffs?: TimedBuff[];
      questParty?: LoadedQuestParty | null;
      pvpBoost?: ReturnType<typeof getPvpBoost>;
      effectiveMasteries?: MasteryStatSource;
      userSkills?: NonNullable<MasterySources["userSkills"]>;
      /** Every queue entry of the user, in queue order per kind */
      queue?: UserQueue[];
      bloodline?: Bloodline | null;
      sageMode?: SageMode | null;
      activeReskin?: BloodlineReskin | null;
      anbuSquad?: { name: string } | null;
      clan?: Clan | null;
      items: (UserItem & { item: Pick<Item, "id" | "itemType" | "maxDurability"> })[];
      village?:
        | (Village & {
            structures?: VillageStructure[];
            relationshipA?: VillageAlliance[];
            relationshipB?: VillageAlliance[];
            sectors?: { sector: number }[];
          })
        | null;
      loadout?: { jutsuIds: string[] } | null;
      userQuests: (UserQuest & { quest: Quest })[];
      completedQuests: {
        id: string;
        questId: string;
        completed: number;
        questType?: Quest["questType"];
        previousCompletes?: number;
      }[];
      votes?: UserVote | null;
      activeWars?: {
        status: string;
        id: string;
        type: string;
        attackerVillageId: string;
        defenderVillageId: string;
        sector: number;
        attackerVillage: { id: string; name: string; sector: number };
        defenderVillage: { id: string; name: string; sector: number };
        warAllies?: { villageId: string; supportVillageId: string }[];
      }[];
      shrineBattles?: {
        id: string;
        sector: number | null;
        attackerEntityId: string;
        defenderEntityId: string;
      }[];
      activeRaids?: {
        id: string;
        name: string;
        sector: number | null;
        description: string | null;
        image: string | null;
        raidEndsAt: Date | null;
        raidType: "open" | "exclusive";
      }[];
    })
  | undefined;

export type AiWithRelations = UserData & {
  jutsus: (UserJutsu & { jutsu: { id: string; name: string } })[];
  items: (UserItem & { item: { id: string; name: string } })[];
};

/** Project confirmed progression while keeping hidden quest targets and catalogue definitions private. */
export const getUserProgressionUpdate = (
  user: NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>["user"]>,
  publishedAchievementIds: readonly string[],
) => {
  const publicUser = getPublicQuestUser(user);
  const publishedIds = new Set(publishedAchievementIds);
  const achievementProgress: AchievementProgress[] = [];
  publicUser.userQuests = publicUser.userQuests.filter((entry) => {
    if (!publishedIds.has(entry.questId)) return true;
    const { quest: _definition, ...progress } = entry;
    achievementProgress.push(progress);
    return false;
  });
  return {
    achievementProgress,
    userPatch: {
      updatedAt: publicUser.updatedAt,
      regenAt: publicUser.regenAt,
      curHealth: publicUser.curHealth,
      curChakra: publicUser.curChakra,
      curStamina: publicUser.curStamina,
      curEnergy: publicUser.curEnergy,
      experience: publicUser.experience,
      earnedExperience: publicUser.earnedExperience,
      level: publicUser.level,
      rank: publicUser.rank,
      status: publicUser.status,
      battleId: publicUser.battleId,
      activeNpcQuestId: publicUser.activeNpcQuestId,
      senseiId: publicUser.senseiId,
      maxHealth: publicUser.maxHealth,
      maxChakra: publicUser.maxChakra,
      maxStamina: publicUser.maxStamina,
      regeneration: publicUser.regeneration,
      elementalMastery: publicUser.elementalMastery,
      activeTrainedElement: publicUser.activeTrainedElement,
      primaryElement: publicUser.primaryElement,
      secondaryElement: publicUser.secondaryElement,
      ...(publicUser.queue ? { queue: publicUser.queue } : {}),
      energyQueueHead: publicUser.energyQueueHead,
      energyQueueTail: publicUser.energyQueueTail,
      masteryQueueHead: publicUser.masteryQueueHead,
      elementalQueueHead: publicUser.elementalQueueHead,
      currentlyTrainingElement: publicUser.currentlyTrainingElement,
      elementalTrainingStartedAt: publicUser.elementalTrainingStartedAt,
      elementalTrainingSpeed: publicUser.elementalTrainingSpeed,
      trainingSpeed: publicUser.trainingSpeed,
      currentlyTrainingMastery: publicUser.currentlyTrainingMastery,
      masteryTrainingStartedAt: publicUser.masteryTrainingStartedAt,
      dailyTrainings: publicUser.dailyTrainings,
      dailyMissions: publicUser.dailyMissions,
      dailyErrands: publicUser.dailyErrands,
      dailyMedicalMissions: publicUser.dailyMedicalMissions,
      dailyWarMissions: publicUser.dailyWarMissions,
      dailyArenaFights: publicUser.dailyArenaFights,
      dailyPvpMissions: publicUser.dailyPvpMissions,
      dailySageActivations: publicUser.dailySageActivations,
      questFinishAt: publicUser.questFinishAt,
      skillPoints: publicUser.skillPoints,
      missionsD: publicUser.missionsD,
      missionsC: publicUser.missionsC,
      missionsB: publicUser.missionsB,
      missionsA: publicUser.missionsA,
      missionsS: publicUser.missionsS,
      missionsH: publicUser.missionsH,
      crimesD: publicUser.crimesD,
      crimesC: publicUser.crimesC,
      crimesB: publicUser.crimesB,
      crimesA: publicUser.crimesA,
      crimesS: publicUser.crimesS,
      crimesH: publicUser.crimesH,
      errands: publicUser.errands,
      pveFights: publicUser.pveFights,
      pvpFights: publicUser.pvpFights,
      pvpExperience: publicUser.pvpExperience,
      pvpStreak: publicUser.pvpStreak,
      offence: user.offence,
      defence: user.defence,
      strength: user.strength,
      speed: user.speed,
      intelligence: user.intelligence,
      willpower: user.willpower,
      ninjutsuMastery: user.ninjutsuMastery,
      genjutsuMastery: user.genjutsuMastery,
      taijutsuMastery: user.taijutsuMastery,
      bukijutsuMastery: user.bukijutsuMastery,
      bloodlineMastery: user.bloodlineMastery,
      sageMastery: user.sageMastery,

      questData: publicUser.questData,
      userQuests: publicUser.userQuests,
      completedQuests: publicUser.completedQuests,
      effectiveMasteries: effectiveMasteries(user),
      maxEnergy: calcMaxEnergy(user),
    },
  };
};
