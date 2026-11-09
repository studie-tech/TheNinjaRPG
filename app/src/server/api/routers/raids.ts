import { nanoid } from "nanoid";
import { z } from "zod";
import { getUserProgressionUpdate } from "@/deltas/profile";
import { getRewardUserUpdate } from "@/deltas/quests";
import {
  confirmRaidBattleUpdate,
  getJoinRaidQueueUserUpdate,
  getRaidQueueExpectedUpdate,
  getRaidQueueWakeUserUpdate,
  getRaidSnapshotUpdate,
  raidQueueWakeUpdate,
} from "@/deltas/raids";
import {
  RAID_BATTLE_LOBBY_SECONDS,
  RAID_BATTLE_MAX_USERS_PER_TEAM,
  RAID_CLAIMING_TIMEOUT_MS,
  RAID_MAX_CONCURRENT_TEAMS,
} from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import { getWarSide } from "@/libs/objectiveWar";
import { getServerPusher, updateRaidTeamsOnSector } from "@/libs/pusher";
import { postProcessRewards } from "@/libs/quest/rewards";
import {
  createBattleClaimId,
  getRaidChatConversationId,
  getRaidObjectiveData,
  isBattleClaimId,
  isRaidListedForVillage,
  raidCaptureClosedMessage,
  raidRewardBlockMessage,
  validateRaidIsActive,
} from "@/libs/raids";
import { fetchActionUser } from "@/queries/actionReadiness";
import {
  deleteBattleQueueMemberById,
  deleteBattleQueueMembersForTeam,
  fetchActiveUserMpvpBattles,
} from "@/queries/clan";
import { insertConversationMember } from "@/queries/comments";
import {
  fetchAllGameSettings,
  fetchUser,
  queueAwakeUser,
  wakeQueuedUser,
} from "@/queries/profile";
import { deleteRankedQueueForUser } from "@/queries/pvprank";
import { fetchQuest } from "@/queries/quests";
import {
  claimBattleQueue,
  clearQueueBattleId,
  deleteEmptyQueueById,
  deleteMpvpBattleQueueForCheckAndCleanupExpiredRaid,
  deleteMpvpBattleQueueForReadyToQueue,
  deleteMpvpBattleQueueForRollbackStartRaidBattle,
  deleteMpvpBattleUserForCheckAndCleanupExpiredRaid,
  deleteMpvpBattleUserForReadyToQueue,
  deleteMpvpBattleUserForRollbackJoinRaidQueue,
  deleteRaidDamageThresholdForDeleteDamageThreshold,
  deleteUnclaimedBattleQueue,
  executeInsertResultForJoinRaidQueue,
  fetchRaidJoinUser,
  fetchRaidListUser,
  findMpvpBattleQueueForJoinRaidQueue,
  findMpvpBattleQueueForJoinRaidQueue2,
  findMpvpBattleQueueForStartRaidBattle,
  findMpvpBattleUserForGetUserRaidQueue,
  findMpvpBattleUserForLeaveRaidQueue,
  findMpvpBattleUserForReadyToQueue,
  findQuestForCheckAndCleanupExpiredRaid,
  findQuestForGetRaidDetails,
  findQuestForGetUserRaidQueue,
  findRaidDamageThresholdForClaimDamageReward,
  findRaidParticipationForGetRaidDetails,
  findSectorForJoinRaidQueue,
  findUser2conversationForGetRaidDetails,
  findWarForJoinRaidQueue,
  insertConversationForEnsureRaidChatConversation,
  insertMpvpBattleUserForJoinRaidQueue,
  insertRaidDamageThresholdForCreateDamageThreshold,
  insertUserRaidBuffForClaimDamageReward,
  listMpvpBattleQueueForCheckAndCleanupExpiredRaid,
  listMpvpBattleQueueForGetActiveRaidTeams,
  listQuestForCleanupExpiredExclusiveRaids,
  listQuestForGetAvailableRaids,
  listQuestForGetCompletedRaids,
  listQueueMembers,
  listRaidDamageThresholdForGetRaidDetails,
  listRaidParticipationForGetRaidLeaderboard,
  listUserRaidBuffForGetUserRaidBuffs,
  listWarForGetAvailableRaids,
  purgeAllRaidChatMembershipsForUser,
  releaseBattleQueueClaim,
  setQueueBattleId,
  updateMpvpBattleQueueForReadyToQueue,
  updateMpvpBattleQueueForStartRaidBattle,
  updateRaidDamageThresholdForUpdateDamageThreshold,
  updateRaidParticipationForClaimDamageReward,
  updateUserDataForCheckAndCleanupExpiredRaid,
  updateUserDataForReadyToQueue,
  updateUserDataForReadyToQueue2,
  updateUserDataForRollbackStartRaidBattle,
  updateUserRequestForReadyToQueue,
  updateUserRequestForReadyToQueue2,
} from "@/queries/raids";
import { deleteSectorByNumber } from "@/queries/village";
import { initiateBattle } from "@/routers/combat";
import { fetchUpdatedUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { deferPushToUsers } from "@/server/utils/push/defer";
import { raidBattleStarted } from "@/server/utils/push/messages";
import { updateRewards } from "@/server/utils/questRewards";
import { purgeRaidChatMembership } from "@/server/utils/raidChat";
import { notifyRankedQueueChanged } from "@/server/utils/rankedQueue";
import { validateTitleRewardIds } from "@/server/utils/titleRewards";
import { canChangeContent } from "@/utils/permissions";
import { secondsFromDate } from "@/utils/time";
import { AllTags, SuperRefinePassiveEffects } from "@/validators/combat";
import type { RaidObjectiveType } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { userDeltaResponseSchema } from "@/validators/userCache";

const damageThresholdFields = {
  damageRequired: z.number().min(1),
  rewards: ObjectiveReward,
  // Effects become passive user buffs at battle start, so they carry no tile.
  effects: z.array(AllTags).superRefine(SuperRefinePassiveEffects).prefault([]),
  effectDurationMinutes: z.number().min(1).max(10080).prefault(60),
};

export const raidsRouter = createTRPCRouter({
  /**
   * Get completed raids (ended or boss defeated) for viewing history and claiming rewards
   */
  getCompletedRaids: protectedProcedure
    .meta({
      mcp: {
        description: "Get completed raids for history and rewards",
      },
    })
    .input(z.object({ limit: z.number().min(1).max(50).prefault(20) }).nullish())
    .query(async ({ ctx, input }) => {
      // Derived
      const now = new Date();
      const limit = input?.limit ?? 20;

      // Query - fetch raids that have ended (time expired or boss defeated)
      const completedRaids = await listQuestForGetCompletedRaids(
        ctx.drizzle,
        now,
        ctx,
        limit,
      );

      return {
        raids: completedRaids.map((raid) => {
          const raidData = getRaidObjectiveData(raid);
          const bossDefeated = (raid.raidBossCurrentHealth ?? 0) <= 0;
          const timeExpired = raid.raidEndsAt ? raid.raidEndsAt < now : false;

          return {
            ...toRaidSummary(raid, raidData),
            userParticipation: raid.raidParticipations[0] ?? null,
            // Completion status
            completionStatus: bossDefeated ? "boss_defeated" : "time_expired",
            bossDefeated,
            timeExpired,
          };
        }),
      };
    }),

  /**
   * Get available raids for the user
   */
  getAvailableRaids: protectedProcedure
    .meta({
      mcp: {
        description: "Get available raids for current user",
      },
    })
    .input(z.object({ sector: z.number().optional() }).nullish())
    .query(async ({ ctx, input }) => {
      // Query - slim user + cleanup, raids, and shrine-down sector wars in one hop
      const [user, , raids, activeSectorWars] = await Promise.all([
        fetchRaidListUser(ctx.drizzle, ctx.userId),
        cleanupExpiredExclusiveRaids(ctx.drizzle),
        listQuestForGetAvailableRaids(ctx.drizzle, ctx),
        // Always fetched so this stays in the same round-trip as the user row.
        // Users without a village never match the attacker/ally filter below.
        listWarForGetAvailableRaids(ctx.drizzle, input),
      ]);

      // Guard
      if (!user) return { raids: [] };

      // Derived
      const now = new Date();
      const ownedSectorNumbers = new Set(
        user.village?.sectors?.map((s) => s.sector) ?? [],
      );
      // Sectors where user's village is attacker (or ally of attacker) and shrine is defeated
      const attackerDefeatedShrineSectors = new Set(
        activeSectorWars
          .filter((w) => getWarSide(w, user.villageId) === w.attackerVillageId)
          .map((w) => w.sector),
      );

      const filteredRaids = raids.filter((raid) =>
        isRaidListedForVillage(
          raid,
          user.villageId,
          ownedSectorNumbers,
          attackerDefeatedShrineSectors,
          now,
        ),
      );

      // Filter by sector if provided
      const sectorFilteredRaids =
        input?.sector !== undefined
          ? filteredRaids.filter((raid) => {
              const raidData = getRaidObjectiveData(raid);
              return raidData?.sector === input.sector;
            })
          : filteredRaids;

      return {
        raids: sectorFilteredRaids.map((raid) => {
          const raidData = getRaidObjectiveData(raid);
          return {
            ...toRaidSummary(raid, raidData),
            raidCaptureDeadline: raid.raidCaptureDeadline,
            raidGracePeriodEnd: raid.raidGracePeriodEnd,
            userParticipation: raid.raidParticipations[0] ?? null,
          };
        }),
      };
    }),

  /**
   * Get detailed info about a specific raid
   */
  getRaidDetails: protectedProcedure
    .meta({
      mcp: { description: "Get details for a specific raid" },
    })
    .input(z.object({ questId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query - parallel fetch (single round-trip). chatMembership is the
      // user's user2conversation row for the raid chat — the chat ID is only
      // exposed to members so non-team users cannot eavesdrop on or post to
      // raid coordination via the public conversation endpoints.
      const raidChatConversationId = getRaidChatConversationId(input.questId);
      const [raid, participation, thresholds, chatMembership] = await Promise.all([
        findQuestForGetRaidDetails(ctx.drizzle, input),
        findRaidParticipationForGetRaidDetails(ctx.drizzle, input, ctx),
        listRaidDamageThresholdForGetRaidDetails(ctx.drizzle, input),
        findUser2conversationForGetRaidDetails(
          ctx.drizzle,
          raidChatConversationId,
          ctx,
        ),
      ]);

      // Guard
      if (!raid) {
        return { raid: null, participation: null, thresholds: [] };
      }

      // Derived
      const raidData = getRaidObjectiveData(raid);

      return {
        raid: {
          ...toRaidSummary(raid, raidData),
          raidChatConversationId: chatMembership ? raidChatConversationId : null,
        },
        participation,
        thresholds,
      };
    }),

  /**
   * Get the raid leaderboard
   */
  getRaidLeaderboard: protectedProcedure
    .meta({
      mcp: { description: "Get raid damage leaderboard" },
    })
    .input(
      z.object({
        questId: z.string(),
        limit: z.number().min(1).max(100).prefault(50),
        cursor: z.number().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Derived
      const offset = input.cursor ?? 0;

      // Query
      const participations = await listRaidParticipationForGetRaidLeaderboard(
        ctx.drizzle,
        input,
        offset,
      );

      // Derived
      let nextCursor: typeof input.cursor;
      if (participations.length > input.limit) {
        participations.pop();
        nextCursor = offset + input.limit;
      }

      return {
        participations: participations.map((p, i) => ({
          rank: offset + i + 1,
          ...p,
        })),
        nextCursor,
      };
    }),

  /**
   * Get user's current raid queue status
   */
  getUserRaidQueue: protectedProcedure
    .meta({
      mcp: {
        description: "Get user's current raid queue status",
      },
    })
    .query(async ({ ctx }) => {
      // Query
      const queue = await findMpvpBattleUserForGetUserRaidQueue(ctx.drizzle, ctx);

      // Guard
      if (queue?.clanBattle?.battleType !== "RAID_BATTLE") {
        return { inQueue: false, queue: null, isClaiming: false };
      }

      // Auto-cleanup if the raid has expired - user would be stuck otherwise
      // Fetch quest explicitly here since attackerEntityId is only a quest ID for RAID_BATTLE entries
      const raid = await findQuestForGetUserRaidQueue(ctx.drizzle, queue);
      if (!raid) {
        void checkAndCleanupExpiredRaid(ctx.drizzle, queue.clanBattle.attackerEntityId);
        return { inQueue: false, queue: null, isClaiming: false };
      }
      const now = new Date();
      const raidExpired =
        (raid.raidEndsAt && raid.raidEndsAt < now) ||
        (raid.raidBossCurrentHealth ?? 1) <= 0;
      if (raidExpired) {
        void checkAndCleanupExpiredRaid(ctx.drizzle, queue.clanBattle.attackerEntityId);
        return { inQueue: false, queue: null, isClaiming: false };
      }

      // Allow teams in "claiming-" state to be visible (they're stuck during battle initialization)
      const isClaimingState = isBattleClaimId(queue.clanBattle.battleId);
      if (queue.clanBattle.battleId !== null && !isClaimingState) {
        return { inQueue: false, queue: null, isClaiming: false };
      }

      return {
        inQueue: true,
        isClaiming: isClaimingState,
        queue: {
          id: queue.clanBattle.id,
          questId: queue.clanBattle.attackerEntityId,
          createdAt: queue.clanBattle.createdAt,
          members: queue.clanBattle.queue,
        },
      };
    }),

  /**
   * Get user's active raid buffs
   */
  getUserRaidBuffs: protectedProcedure
    .meta({
      mcp: { description: "Get user's active raid buffs" },
    })
    .query(async ({ ctx }) => {
      // Derived
      const now = new Date();

      // Query
      const buffs = await listUserRaidBuffForGetUserRaidBuffs(ctx.drizzle, ctx, now);

      return { buffs };
    }),

  /**
   * Get damage thresholds for a quest (admin use)
   */
  getQuestThresholds: protectedProcedure
    .meta({
      mcp: { description: "Get damage thresholds for a raid" },
    })
    .input(z.object({ questId: z.string() }))
    .query(async ({ ctx, input }) => {
      const thresholds = await listRaidDamageThresholdForGetRaidDetails(
        ctx.drizzle,
        input,
      );
      return { thresholds };
    }),

  /**
   * Create a new damage threshold
   */
  createDamageThreshold: protectedProcedure
    .use(ratelimitMiddleware)
    .input(
      z.object({
        ...damageThresholdFields,
        questId: z.string(),
        sortOrder: z.number().min(0).max(255).prefault(0),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query - parallel fetch
      const [user, questData, titleError] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findQuestForGetRaidDetails(ctx.drizzle, input),
        validateTitleRewardIds(ctx.drizzle, input.rewards),
      ]);

      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("Not authorized to create damage thresholds");
      }
      if (!questData) {
        return errorResponse("Raid quest not found");
      }

      if (titleError) return errorResponse(titleError);
      // Mutation
      await insertRaidDamageThresholdForCreateDamageThreshold(ctx.drizzle, input);

      return { success: true, message: "Damage threshold created" };
    }),

  /**
   * Update an existing damage threshold
   */
  updateDamageThreshold: protectedProcedure
    .use(ratelimitMiddleware)
    .input(
      z.object({
        ...damageThresholdFields,
        thresholdId: z.string(),
        sortOrder: z.number().min(0).max(255),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, titleError] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        validateTitleRewardIds(ctx.drizzle, input.rewards),
      ]);

      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("Not authorized to update damage thresholds");
      }

      if (titleError) return errorResponse(titleError);
      // Mutation
      const result = await updateRaidDamageThresholdForUpdateDamageThreshold(
        ctx.drizzle,
        input,
      );

      // Guard
      if (result.rowsAffected === 0) {
        return errorResponse("Threshold not found");
      }

      return { success: true, message: "Damage threshold updated" };
    }),

  /**
   * Delete a damage threshold
   */
  deleteDamageThreshold: protectedProcedure
    .use(ratelimitMiddleware)
    .input(z.object({ thresholdId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("Not authorized to delete damage thresholds");
      }

      // Mutation
      await deleteRaidDamageThresholdForDeleteDamageThreshold(ctx.drizzle, input);

      return { success: true, message: "Damage threshold deleted" };
    }),

  /**
   * Get active raid teams for a specific raid
   */
  getActiveRaidTeams: protectedProcedure
    .meta({
      mcp: { description: "Get active teams for a raid" },
    })
    .input(z.object({ questId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query - include teams in "claiming-" state (stuck during battle initialization)
      const teams = await listMpvpBattleQueueForGetActiveRaidTeams(ctx.drizzle, input);

      // Derived
      return {
        teams: teams.map((team) => {
          const isClaiming = isBattleClaimId(team.battleId);
          return {
            id: team.id,
            createdAt: team.createdAt,
            isClaiming,
            members: team.queue.map((m) => ({
              slot: m.slot,
              visibleId: m.userId,
              username: m.user.username,
              avatar: m.user.avatar,
            })),
            // Don't allow joining teams that are in claiming state
            canJoin: !isClaiming && team.queue.length < RAID_BATTLE_MAX_USERS_PER_TEAM,
          };
        }),
        maxTeams: RAID_MAX_CONCURRENT_TEAMS,
      };
    }),

  /**
   * Ready to queue - resets user status to AWAKE and clears any stuck queue entries
   * so they can join a raid queue cleanly
   */
  readyToQueue: protectedProcedure
    .use(ratelimitMiddleware)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      let [user, queueEntry, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        findMpvpBattleUserForReadyToQueue(ctx.drizzle, ctx),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(user, settings);
      // Validation does not change the profile; reconcile only a mismatched activity status.
      const initialStatus = user.status;
      const reject = (message: string) => ({
        ...errorResponse(message),
        ...getRaidQueueExpectedUpdate({ userStatus: initialStatus }),
      });
      if (user.status !== "QUEUED" && readiness.error) return reject(readiness.error);
      if (!readiness.error) user = readiness.user;
      const bannedReady = guardNotBannedFromRaids(user, "queue for raids");
      if (bannedReady) return bannedReady;
      if (user.status === "HOSPITALIZED") {
        return reject("You cannot ready up while hospitalized");
      }
      if (user.status === "BATTLE") {
        return reject("You cannot ready up while in an active battle");
      }
      if (user.status === "TRAVEL") {
        return reject("You cannot ready up while traveling");
      }
      if (user.status === "ASLEEP") {
        return reject("You cannot ready up while sleeping");
      }
      if (
        user.status === "QUEUED" &&
        queueEntry?.clanBattle?.battleType !== "RAID_BATTLE"
      ) {
        return reject(
          "You are in another battle queue. Please leave it before readying for a raid.",
        );
      }
      const userId = user.userId;
      // CAS: only transition from the status we read to avoid racing concurrent requests.
      let confirmedAwake = false;
      if (user.status !== "AWAKE") {
        const updateResult = await updateUserDataForReadyToQueue(ctx.drizzle, userId, {
          status: user.status,
        });
        if (updateResult.rowsAffected === 0) {
          return errorResponse(
            "Failed to update status - your status may have changed",
          );
        }
        confirmedAwake = true;
      } else {
        // Already AWAKE: guard against clearing an active travel that hasn't finished yet.
        const isTraveling = user.travelFinishAt && user.travelFinishAt > new Date();
        if (isTraveling) {
          return errorResponse("You cannot ready up while traveling");
        }
        // A no-op for an already awake actor can report zero; recovery changes status
        // and must confirm its guarded claim before cleanup or wake-up feedback.
        const result = await updateUserDataForReadyToQueue2(
          ctx.drizzle,
          userId,
          readiness,
        );
        confirmedAwake = result.rowsAffected === 1;
        if (readiness.notice && !confirmedAwake) {
          return errorResponse(
            "Failed to update status - your status may have changed",
          );
        }
      }
      // Step 1: remove user from team + other independent cleanups in parallel.
      // mpvpBattleUser must be deleted before the NOT EXISTS team-cleanup check in step 2.
      // If the cleared queue entry was a raid, also drop the user's raid chat
      // membership so they lose access to that team's coordination chat.
      const clearedRaidChatConversationId =
        queueEntry?.clanBattle?.battleType === "RAID_BATTLE"
          ? getRaidChatConversationId(queueEntry.clanBattle.attackerEntityId)
          : null;
      await Promise.all([
        // Only delete the exact mpvpBattleUser row we read — no broad userId fallback
        ...(queueEntry
          ? [deleteMpvpBattleUserForReadyToQueue(ctx.drizzle, userId, queueEntry)]
          : []),
        ...(clearedRaidChatConversationId
          ? [
              purgeRaidChatMembership(
                ctx.drizzle,
                clearedRaidChatConversationId,
                userId,
              ),
            ]
          : []),
        // Clear ranked PVP queue — being in it sets status to QUEUED which blocks raid joining
        deleteRankedQueueForUser(ctx.drizzle, userId).then(async (result) => {
          await notifyRankedQueueChanged(result.rowsAffected);
        }),
        // Cancel spar requests the user sent
        updateUserRequestForReadyToQueue(ctx.drizzle, userId),
        // Reject spar requests the user received
        updateUserRequestForReadyToQueue2(ctx.drizzle, userId),
      ]);
      // Step 2: team cleanup — safe to run after mpvpBattleUser row is gone.
      // DELETE fires only when team is now empty (NOT EXISTS).
      // UPDATE resets only stale claiming states (mirrors startRaidBattle staleness check).
      if (queueEntry) {
        await Promise.all([
          deleteMpvpBattleQueueForReadyToQueue(ctx.drizzle, queueEntry),
          updateMpvpBattleQueueForReadyToQueue(ctx.drizzle, queueEntry),
        ]);
      }
      // Pusher - notify sector so other team members see the roster update in real-time
      const teamSector = queueEntry?.clanBattle?.sector;
      if (teamSector !== null && teamSector !== undefined) {
        const pusher = getServerPusher();
        void updateRaidTeamsOnSector(pusher, teamSector);
      }
      return actionReadinessResponse(
        {
          success: true,
          message: confirmedAwake
            ? "You are ready to queue!"
            : "Ready status checked; refresh your current activity if needed.",
          ...getRaidQueueWakeUserUpdate({ confirmedAwake }),
        },
        confirmedAwake ? readiness : undefined,
        ctx.drizzle,
      );
    }),

  /**
   * Join or create a raid team queue
   */
  joinRaidQueue: protectedProcedure
    .meta({
      mcp: { description: "Join or create a raid team queue" },
    })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        questId: z.string(),
        teamId: z.string().optional(), // If provided, join existing team
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query - parallel fetch all required data upfront
      let [user, raid, teamData, existingQueueEntries, settings] = await Promise.all([
        fetchRaidJoinUser(ctx.drizzle, ctx.userId),
        findQuestForGetRaidDetails(ctx.drizzle, input),
        // Fetch team if joining existing, otherwise skip
        input.teamId
          ? findMpvpBattleQueueForJoinRaidQueue(ctx.drizzle, {
              teamId: input.teamId,
              questId: input.questId,
            })
          : Promise.resolve(null),
        // Check if user is already in any active battle queue
        fetchActiveUserMpvpBattles(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);

      // Guard - basic validations
      if (!user) return errorResponse("User not found");
      const readiness = prepareActionReadiness(user, settings);
      // Rejections before admission leave profile data untouched unless its status is stale.
      const initialStatus = user.status;
      const reject = (message: string) => ({
        ...errorResponse(message),
        ...getRaidQueueExpectedUpdate({ userStatus: initialStatus }),
      });
      if (readiness.error) return reject(readiness.error);
      user = readiness.user;
      const bannedJoin = guardNotBannedFromRaids(user, "queue for raids");
      if (bannedJoin) return bannedJoin;
      if (!raid) return reject("Raid not found");
      if (existingQueueEntries.length > 0) {
        return reject("Already in a battle queue");
      }

      // Guard - raid active state
      const now = new Date();
      const raidValidation = validateRaidIsActive(raid, now);
      if (!raidValidation.isValid) {
        if (raidValidation.reason === "ended") {
          await checkAndCleanupExpiredRaid(ctx.drizzle, raid.id);
          return errorResponse(raidValidation.error);
        }
        return reject(raidValidation.error);
      }

      // Derived - raid data from objective
      const raidData = getRaidObjectiveData(raid);
      if (!raidData) {
        return reject("This raid is not properly configured (invalid objective)");
      }

      // Guard - user must be in the raid's sector to join
      if (raidData.sector !== null && user.sector !== raidData.sector) {
        return reject(`You must travel to sector ${raidData.sector} to join this raid`);
      }

      // Guard - exclusive raid eligibility (sector check required)
      if (raidData.isExclusive) {
        if (!user.villageId) {
          return reject("You must be in a village to join exclusive raids");
        }
        if (raidData.sector === null) {
          return reject("This exclusive raid is not properly configured");
        }

        // Check capture deadline and grace period
        const captureClosed = raidCaptureClosedMessage(raid, now);
        if (captureClosed) return reject(captureClosed);

        // Check sector ownership OR attacker in sector war with defeated shrine
        const [sectorOwnership, sectorWar] = await Promise.all([
          findSectorForJoinRaidQueue(ctx.drizzle, raidData, {
            villageId: user.villageId,
          }),
          // Fetch sector war with defeated shrine (if any)
          findWarForJoinRaidQueue(ctx.drizzle, raidData),
        ]);

        // Check if user's village is attacker or ally supporting the attacker
        const isAttackerOrAlly =
          sectorWar &&
          getWarSide(sectorWar, user.villageId) === sectorWar.attackerVillageId;

        if (!sectorOwnership && !isAttackerOrAlly) {
          return reject("Your village does not control this sector");
        }
      }

      // Guard - team validation using pre-fetched data
      let teamId = input.teamId;
      let createdNewTeam = false;

      if (teamId) {
        // Guard - validate pre-fetched team
        if (!teamData) {
          return reject("Team not found or battle already started");
        }
        if (teamData.queue.length >= RAID_BATTLE_MAX_USERS_PER_TEAM) {
          return reject("Team is full");
        }
      } else {
        // Mutation - create new team with atomic count guard
        // Uses INSERT ... SELECT to atomically check team count and insert only if under limit
        teamId = nanoid();
        const insertResult = await executeInsertResultForJoinRaidQueue(
          ctx.drizzle,
          teamId,
          input,
          raidData,
        );

        // Guard - check if insert succeeded
        if (insertResult.rowsAffected === 0) {
          return reject(
            "Maximum number of raid teams reached. Please join an existing team.",
          );
        }
        createdNewTeam = true;
      }

      // Mutation - update user status with guard
      const statusResult = await queueAwakeUser(ctx.drizzle, ctx, readiness);

      if (statusResult.rowsAffected === 0) {
        // Rollback - clean up newly created team if status update fails
        if (createdNewTeam) {
          await deleteUnclaimedBattleQueue(ctx.drizzle, teamId);
        }
        return errorResponse("Failed to update status - you may already be in a queue");
      }

      // Derived - find available slot
      let availableSlot: number | undefined;

      if (createdNewTeam) {
        // For new teams, we know slot 0 is available (we just created it)
        availableSlot = 0;
      } else {
        // For existing teams, re-fetch to get fresh state (handle race conditions)
        const freshTeam = await findMpvpBattleQueueForJoinRaidQueue2(
          ctx.drizzle,
          teamId,
        );

        // Guard - team still exists
        if (!freshTeam) {
          const wake = await wakeQueuedUser(ctx.drizzle, ctx.userId);
          return actionReadinessResponse(
            errorResponse("Team is no longer available"),
            readiness,
            ctx.drizzle,
            wake.rowsAffected > 0 ? { status: "AWAKE" } : null,
          );
        }

        const usedSlots = freshTeam.queue.map((u) => u.slot);
        availableSlot = [0, 1, 2].find((s) => !usedSlots.includes(s));

        // Guard - slot available
        if (availableSlot === undefined) {
          const wake = await wakeQueuedUser(ctx.drizzle, ctx.userId);
          return actionReadinessResponse(
            errorResponse("Team is full"),
            readiness,
            ctx.drizzle,
            wake.rowsAffected > 0 ? { status: "AWAKE" } : null,
          );
        }
      }

      // Mutation - insert user into queue and ensure chat conversation in parallel.
      // ensureRaidChatConversation targets different tables (conversation,
      // user2conversation) and has no data dependency on the mpvpBattleUser
      // insert, so we run them concurrently to avoid a sequential round-trip.
      const [userInsertResult, chatResult] = await Promise.allSettled([
        insertMpvpBattleUserForJoinRaidQueue(ctx.drizzle, teamId, ctx, availableSlot),
        ensureRaidChatConversation(ctx.drizzle, raid, ctx.userId),
      ]);

      if (userInsertResult.status === "rejected" || chatResult.status === "rejected") {
        const wake = await rollbackJoinRaidQueue({
          client: ctx.drizzle,
          userId: ctx.userId,
          teamId,
          raidQuestId: input.questId,
          deleteTeam: createdNewTeam,
          deleteUserRow: userInsertResult.status === "fulfilled",
        });
        return actionReadinessResponse(
          errorResponse("Failed to join raid - please try again"),
          readiness,
          ctx.drizzle,
          wake.rowsAffected > 0 ? { status: "AWAKE" } : null,
        );
      }

      // Pusher - notify sector about team changes
      const pusher = getServerPusher();
      void updateRaidTeamsOnSector(pusher, raidData.sector);

      return actionReadinessResponse(
        {
          success: true,
          message: "Joined raid queue",
          teamId,
          ...getJoinRaidQueueUserUpdate(),
        },
        readiness,
        ctx.drizzle,
      );
    }),

  /**
   * Leave raid queue
   */
  leaveRaidQueue: protectedProcedure
    .meta({ mcp: { description: "Leave the raid queue" } })
    .use(ratelimitMiddleware)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query - parallel fetch user and queue entry
      const [snapshot, queueEntry] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        findMpvpBattleUserForLeaveRaidQueue(ctx.drizzle, ctx),
      ]);

      const { user } = snapshot;
      const initialUpdate = getRaidSnapshotUpdate(snapshot);
      const reject = (message: string) => ({
        ...errorResponse(message),
        ...initialUpdate,
      });
      // Guard
      if (!user) return reject("User not found");
      if (!queueEntry) return reject("You are not in a queue");
      if (!queueEntry.clanBattle) {
        // Queue entry exists but clan battle was deleted - clean up orphaned entry.
        // The deterministic raid-chat conversation id is not recoverable from
        // here (the parent queue row holding attackerEntityId is gone), so purge
        // every raid-chat membership row this user owns to drop access to any
        // stale conversation that survived a prior raid reset.
        const [, wake] = await Promise.all([
          deleteBattleQueueMemberById(ctx.drizzle, queueEntry.id),
          wakeQueuedUser(ctx.drizzle, ctx.userId),
          purgeAllRaidChatMembershipsForUser(ctx.drizzle, ctx.userId),
        ]);
        return {
          success: true,
          message: "Left the queue",
          ...raidQueueWakeUpdate(initialUpdate, wake.rowsAffected === 1),
        };
      }
      if (queueEntry.clanBattle.battleType !== "RAID_BATTLE") {
        return reject("You are not in a raid queue");
      }
      // Allow leaving if not in a real battle (claiming state is allowed)
      const isClaimingState = isBattleClaimId(queueEntry.clanBattle.battleId);
      if (queueEntry.clanBattle.battleId !== null && !isClaimingState) {
        return reject("Battle has already started");
      }

      // Store sector before operations for Pusher notification
      const teamSector = queueEntry.clanBattle.sector;
      const raidQuestId = queueEntry.clanBattle.attackerEntityId;
      const raidChatConversationId = getRaidChatConversationId(raidQuestId);

      // Mutation - delete queue entry, update user status, drop chat
      // membership, and cleanup claiming ID in parallel.
      const [, wake] = await Promise.all([
        deleteBattleQueueMemberById(ctx.drizzle, queueEntry.id),
        wakeQueuedUser(ctx.drizzle, ctx.userId),
        purgeRaidChatMembership(ctx.drizzle, raidChatConversationId, ctx.userId),
        // Clean up claiming ID if present
        isClaimingState
          ? clearQueueBattleId(ctx.drizzle, queueEntry.clanBattleId)
          : Promise.resolve(),
      ]);

      // Mutation - clean up the team if it is now empty
      await deleteEmptyQueueById(ctx.drizzle, queueEntry.clanBattleId);

      // Pusher - notify sector about team changes
      const pusher = getServerPusher();
      void updateRaidTeamsOnSector(pusher, teamSector);

      return {
        success: true,
        message: "Left raid queue",
        ...raidQueueWakeUpdate(initialUpdate, wake.rowsAffected === 1),
      };
    }),

  /**
   * Start a raid battle
   */
  startRaidBattle: protectedProcedure
    .meta({
      mcp: { description: "Start a raid battle with the team" },
    })
    .use(ratelimitMiddleware)
    .input(z.object({ teamId: z.string() }))
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Query - parallel fetch user and team
      const [snapshot, team] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        findMpvpBattleQueueForStartRaidBattle(ctx.drizzle, input),
      ]);

      const { user } = snapshot;
      const initialUpdate = getRaidSnapshotUpdate(snapshot);
      const reject = (message: string) => ({
        ...errorResponse(message),
        ...initialUpdate,
      });
      // Guard - basic validations
      if (!user) return reject("User not found");
      const bannedStart = guardNotBannedFromRaids(user, "start raid battles");
      if (bannedStart) return { ...bannedStart, ...initialUpdate };
      if (!team) return reject("Team not found");

      // Check battleId state - handle stale claiming states or already started battles
      if (team.battleId !== null) {
        const isStaleClaimingState =
          isBattleClaimId(team.battleId) &&
          team.createdAt.getTime() < Date.now() - RAID_CLAIMING_TIMEOUT_MS;

        if (isStaleClaimingState) {
          // Reset the stale claiming state
          await updateMpvpBattleQueueForStartRaidBattle(ctx.drizzle, input);
          // Notify other users that the team is available again
          const pusher = getServerPusher();
          void updateRaidTeamsOnSector(pusher, team.sector);
        } else {
          return reject("Battle already started or being claimed");
        }
      }

      const userInTeam = team.queue.find((m) => m.userId === ctx.userId);
      if (!userInTeam) {
        return reject("You are not in this team");
      }

      // Guard - lobby time check (with 2 second buffer for network latency)
      const lobbyTimeElapsed = secondsFromDate(
        RAID_BATTLE_LOBBY_SECONDS,
        team.createdAt,
      );
      const LOBBY_BUFFER_MS = 2000;
      if (
        Date.now() < lobbyTimeElapsed.getTime() - LOBBY_BUFFER_MS &&
        team.queue.length < RAID_BATTLE_MAX_USERS_PER_TEAM
      ) {
        return reject("Please wait for the lobby timer or full team");
      }

      // Query - get raid quest data
      const raid = await fetchQuest(ctx.drizzle, team.attackerEntityId);

      // Guard - raid validations
      if (!raid) return reject("Raid quest not found");

      const raidData = getRaidObjectiveData(raid);
      if (!raidData?.firstAiId) {
        return reject("Raid boss AI not configured");
      }

      const now = new Date();
      const raidValidation = validateRaidIsActive(raid, now);
      if (!raidValidation.isValid) {
        if (raidValidation.reason === "ended") {
          await checkAndCleanupExpiredRaid(ctx.drizzle, raid.id);
          return errorResponse(raidValidation.error);
        }
        return reject(raidValidation.error);
      }

      // Mutation - claim the battle atomically
      const claimId = createBattleClaimId(nanoid());
      const claimResult = await claimBattleQueue(ctx.drizzle, claimId, input.teamId);

      if (claimResult.rowsAffected === 0) {
        return reject("Battle was already started by another player");
      }

      // Query - re-fetch current queue members after claim for fresh state
      const currentQueueMembers = await listQueueMembers(ctx.drizzle, input.teamId);

      // Guard - members validation after claim
      if (currentQueueMembers.length === 0) {
        await clearQueueBattleId(ctx.drizzle, input.teamId);
        return reject("No team members available to start battle");
      }

      const isStillMember = currentQueueMembers.some((m) => m.userId === ctx.userId);
      if (!isStillMember) {
        await releaseBattleQueueClaim(ctx.drizzle, input.teamId, claimId);
        return reject("You are no longer in this team");
      }

      // Derived
      const attackerUserIds = currentQueueMembers.map((m) => m.userId);

      // Mutation - initiate battle
      try {
        const result = await initiateBattle(
          {
            userIds: attackerUserIds,
            cacheUserId: ctx.userId,
            client: ctx.drizzle,
            targetIds: [raidData.firstAiId],
            raidQuestId: raid.id,
            autoCombatFromDefaults: true,
            givePools: raidData.objective.givePools,
            startingEffects: [
              ...(raidData.objective.applyBuffs ?? []),
              ...(raidData.objective.applyDebuffs ?? []),
            ],
          },
          "RAID",
        );

        if (result.success && result.battleId) {
          // Mutation - update with real battle ID
          await setQueueBattleId(ctx.drizzle, result.battleId, input.teamId);

          // Pusher - notify sector about team changes (battle started)
          const pusher = getServerPusher();
          void updateRaidTeamsOnSector(pusher, team.sector);
          deferPushToUsers(
            ctx.drizzle,
            attackerUserIds.filter((id) => id !== ctx.userId),
            raidBattleStarted(result.battleId),
          );

          return {
            success: true,
            message: "Raid battle started",
            battleId: result.battleId,
            ...confirmRaidBattleUpdate(initialUpdate, result),
          };
        } else {
          await rollbackStartRaidBattle({
            client: ctx.drizzle,
            teamId: input.teamId,
            claimId,
            attackerUserIds,
            raidId: raid.id,
          });

          return {
            ...errorResponse(result.message ?? "Failed to start battle"),
            ...confirmRaidBattleUpdate(initialUpdate, {}),
          };
        }
      } catch (err) {
        await rollbackStartRaidBattle({
          client: ctx.drizzle,
          teamId: input.teamId,
          claimId,
          attackerUserIds,
          raidId: raid.id,
        });

        throw err;
      }
    }),

  /**
   * Claim damage threshold rewards
   */
  claimDamageReward: protectedProcedure
    .meta({
      mcp: {
        description: "Claim raid damage threshold rewards",
      },
    })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        questId: z.string(),
        thresholdId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query - parallel fetch user, participation, and threshold
      const [snapshot, participation, threshold] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        findRaidParticipationForGetRaidDetails(ctx.drizzle, input, ctx),
        findRaidDamageThresholdForClaimDamageReward(ctx.drizzle, input),
      ]);

      const { user } = snapshot;
      // Expected rejections can return progression already settled by the opening read.
      const reject = (message: string) => ({
        ...errorResponse(message),
        ...getRaidSnapshotUpdate(snapshot),
      });
      // Guard
      if (!user) return reject("User not found");
      if (!participation) return reject("You have not participated in this raid");
      if (!threshold) return reject("Threshold not found");
      const block = raidRewardBlockMessage(participation, threshold);
      if (block) {
        // Another claim can pay rewards outside the opening progression snapshot.
        if (participation.rewardsClaimed.includes(threshold.id))
          return { ...errorResponse(block), userDelta: undefined };
        return reject(block);
      }

      // Derived
      const rewards = threshold.rewards;

      // Mutation - atomically claim reward with JSON_CONTAINS guard to prevent double-claim
      const claimResult = await updateRaidParticipationForClaimDamageReward(
        ctx.drizzle,
        input,
        participation,
      );

      // Guard - claim result
      if (claimResult.rowsAffected === 0) {
        return {
          ...errorResponse("You have already claimed this reward"),
          userDelta: undefined,
        };
      }

      // Derived - post-process rewards to convert item format
      const processedRewards = postProcessRewards(rewards, user);

      // Mutation - grant all reward types
      // Note: We intentionally do NOT roll back the claim on failure because updateRewards is not atomic.
      // If we rolled back, a retry could double-grant rewards that succeeded before the failure.
      // Keeping the claim marked prevents double-grants; partial failures can be investigated manually.
      const granted = await updateRewards({
        client: ctx.drizzle,
        user,
        rewards: processedRewards,
        reason: "RAID",
      });

      const { items, jutsus, bloodlines, sageModes, badges, titles } = granted;
      // Grant combat effects as raid buff if present
      if (threshold.effects && threshold.effects.length > 0) {
        const expiresAt = new Date(
          Date.now() + threshold.effectDurationMinutes * 60 * 1000,
        );

        await insertUserRaidBuffForClaimDamageReward(
          ctx.drizzle,
          ctx,
          input,
          threshold,
          expiresAt,
        );
      }

      // Payout already resolved these names; preserve configured item order and quantities.
      const displayRewards = {
        ...processedRewards,
        reward_items: processedRewards.reward_items.map(
          (id) => items.find((i) => i.id === id)?.name ?? id,
        ),
        reward_jutsus: jutsus.map((j) => j.name),
        reward_bloodlines: bloodlines.map((b) => b.name),
        reward_sage_modes: sageModes.map((s) => s.name),
        reward_badges: badges.map((b) => b.name),
        reward_titles: titles.map((t) => t.name),
      };

      return {
        success: true,
        message: "Raid Reward Claimed",
        rewards: displayRewards,
        ...getRewardUserUpdate({
          rewards: processedRewards,
          requiresRelations:
            snapshot.requiresProgressionRefresh || (threshold.effects?.length ?? 0) > 0,
          progression: () =>
            getUserProgressionUpdate(user, snapshot.publishedAchievementIds),
        }),
      };
    }),
});

/**
 * Handle expired exclusive raids - return sectors to neutral if raid timed out without boss defeat.
 *
 * For exclusive raids: if the raid ends (raidEndsAt passed) and boss is NOT defeated (health > 0),
 * the village failed to complete the raid and loses the sector.
 *
 * This function is idempotent and safe to call multiple times - it only affects
 * raids that have actually expired and have sectors that still need cleanup.
 *
 * @param client - The drizzle database client
 */
export const cleanupExpiredExclusiveRaids = async (client: DrizzleClient) => {
  const now = new Date();

  // Find all expired exclusive raids where boss is not defeated
  const expiredExclusiveRaids = await listQuestForCleanupExpiredExclusiveRaids(
    client,
    now,
  );

  // Collect sector numbers to clean up
  const sectorsToClean = expiredExclusiveRaids
    .map((raid) => {
      const objective = raid.content?.objectives?.[0];
      if (objective?.task === "exclusive_raid") {
        const raidSector = (objective as RaidObjectiveType).sector;
        if (raidSector !== null && raidSector !== undefined) {
          return raidSector;
        }
      }
      return null;
    })
    .filter((s): s is number => s !== null);

  // Delete all sectors in parallel
  await Promise.all(
    sectorsToClean.map((sectorNum) => deleteSectorByNumber(client, sectorNum)),
  );
};

/**
 * Check if a specific raid has expired and handle cleanup if needed.
 * This is a lightweight check for a single raid, useful when a user
 * tries to interact with a specific raid.
 *
 * @param client - The drizzle database client
 * @param raidId - The quest ID of the raid to check
 */
export const checkAndCleanupExpiredRaid = async (
  client: DrizzleClient,
  raidId: string,
) => {
  const now = new Date();

  // Match both time-expired and boss-defeated raids
  const raid = await findQuestForCheckAndCleanupExpiredRaid(client, raidId, now);

  if (!raid) return;

  // Clean up only queued/claiming teams — skip teams already in an active battle
  const queuedTeams = await listMpvpBattleQueueForCheckAndCleanupExpiredRaid(
    client,
    raidId,
  );

  if (queuedTeams.length > 0) {
    const teamIds = queuedTeams.map((t) => t.id);
    const userIds = queuedTeams.flatMap((t) => t.queue.map((u) => u.userId));
    const raidChatConversationId = getRaidChatConversationId(raidId);

    await Promise.all([
      deleteMpvpBattleUserForCheckAndCleanupExpiredRaid(client, teamIds),
      deleteMpvpBattleQueueForCheckAndCleanupExpiredRaid(client, raidId),
      // Drop chat memberships for all queued users on this raid so they lose
      // access once cleanup yanks them out of the queue.
      purgeRaidChatMembership(client, raidChatConversationId, userIds),
      ...(userIds.length > 0
        ? [updateUserDataForCheckAndCleanupExpiredRaid(client, userIds)]
        : []),
    ]);
  }

  // Sector cleanup only for time-expired exclusive raids where boss was not defeated
  const timeExpired = raid.raidEndsAt && raid.raidEndsAt < now;
  const bossDefeated = (raid.raidBossCurrentHealth ?? 1) <= 0;
  if (timeExpired && !bossDefeated) {
    const objective = raid.content?.objectives?.[0];
    if (objective?.task === "exclusive_raid") {
      const raidSector = (objective as RaidObjectiveType).sector;
      if (raidSector !== null && raidSector !== undefined) {
        // Delete sector - returns it to neutral ownership (syndicate)
        await deleteSectorByNumber(client, raidSector);
      }
    }
  }
};

const rollbackJoinRaidQueue = async ({
  client,
  userId,
  teamId,
  raidQuestId,
  deleteTeam,
  deleteUserRow,
}: {
  client: DrizzleClient;
  userId: string;
  teamId: string;
  raidQuestId: string;
  deleteTeam: boolean;
  deleteUserRow: boolean;
}) => {
  // Delete our user row, drop chat membership, and reset status first, so the
  // team-empty check below sees the row we may have inserted as already gone.
  const raidChatConversationId = getRaidChatConversationId(raidQuestId);
  const [wake] = await Promise.all([
    wakeQueuedUser(client, userId),
    ...(deleteUserRow
      ? [deleteMpvpBattleUserForRollbackJoinRaidQueue(client, userId, teamId)]
      : []),
    purgeRaidChatMembership(client, raidChatConversationId, userId),
  ]);
  // A concurrent joiner may have inserted into mpvpBattleUser before this rollback
  // fired; the team is deleted only if no member references it.
  if (deleteTeam) await deleteEmptyQueueById(client, teamId);
  return wake;
};

/**
 * Centralized ban-policy guard for raid participation endpoints.
 * Returns an errorResponse when the user is banned, or null to continue.
 * Keeps the policy in one place so future changes (ban-expiry, silenced
 * users, etc.) only need to be made here.
 */
const guardNotBannedFromRaids = (user: { isBanned: boolean }, action: string) => {
  if (user.isBanned) {
    return errorResponse(`You are banned and cannot ${action}`);
  }
  return null;
};

const rollbackStartRaidBattle = async ({
  client,
  teamId,
  claimId,
  attackerUserIds,
  raidId,
}: {
  client: DrizzleClient;
  teamId: string;
  claimId: string;
  attackerUserIds: string[];
  raidId: string;
}) => {
  // Release claim, reset statuses, drop queue rows, and purge chat memberships
  // for every attacker so a failed battle start doesn't leave anyone with
  // lingering access to the stable raid-chat conversation across raid resets.
  // The parent mpvpBattleQueue row is deleted (gated on the claim ID) so a
  // failed start doesn't leave a phantom empty team behind in getActiveRaidTeams.
  const raidChatConversationId = getRaidChatConversationId(raidId);
  await Promise.all([
    deleteMpvpBattleQueueForRollbackStartRaidBattle(client, teamId, claimId),
    updateUserDataForRollbackStartRaidBattle(client, attackerUserIds),
    deleteBattleQueueMembersForTeam(client, teamId),
    purgeRaidChatMembership(client, raidChatConversationId, attackerUserIds),
  ]);
};

const ensureRaidChatConversation = async (
  client: DrizzleClient,
  raid: { id: string; name: string },
  userId: string,
) => {
  const conversationId = getRaidChatConversationId(raid.id);
  // Chat is scoped to the raid team via user2conversation membership rows
  // (isPublic: false), so canViewConversation falls through to the
  // inConversation branch and only joined users can read or post.
  // PlanetScale doesn't enforce FKs, so user2conversation does not need to
  // wait for the conversation row — both upserts are idempotent and target
  // different tables, so run them in parallel to halve the latency.
  await Promise.all([
    insertConversationForEnsureRaidChatConversation(
      client,
      conversationId,
      raid,
      userId,
    ),
    insertConversationMember(client, conversationId, userId),
  ]);

  return conversationId;
};

/** Fields every raid listing shares; callers add their own participation or schedule. */
const toRaidSummary = (
  raid: Pick<
    Quest,
    | "id"
    | "name"
    | "description"
    | "image"
    | "raidBossMaxHealth"
    | "raidBossCurrentHealth"
    | "raidEndsAt"
  >,
  raidData: ReturnType<typeof getRaidObjectiveData>,
) => ({
  id: raid.id,
  name: raid.name,
  description: raid.description,
  image: raid.image,
  raidType: raidData?.raidType ?? null,
  raidBossMaxHealth: raid.raidBossMaxHealth,
  raidBossCurrentHealth: raid.raidBossCurrentHealth,
  raidEndsAt: raid.raidEndsAt,
  raidSector: raidData?.sector ?? null,
});
