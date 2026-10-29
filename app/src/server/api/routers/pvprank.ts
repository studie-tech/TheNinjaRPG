import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  RANKED_ENTRY_COST,
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_PVP_STATS,
  RANKED_REQUIRED_RANK,
  RANKED_SANNIN_TOP_PLAYERS,
} from "@/drizzle/constants";
import { collapseRewards, postProcessRewards } from "@/libs/quest";
import {
  getRankedRadius,
  getRankedRank,
  validateItemLoadout,
  validateJutsuLoadout,
} from "@/libs/ranked_pvp";
import { hasRequiredRank } from "@/libs/train";
import { listJutsuByIds } from "@/queries/jutsu";
import { fetchUser, wakeQueuedUser } from "@/queries/profile";
import {
  countRankedPvpQueueForGetRankedQueueCount,
  deleteRankedPvpQueueForCheckRankedPvpMatches,
  deleteRankedPvpQueueForDeleteUserRankedQueueRow,
  deleteRankedPvpQueueForQueueForRankedPvp,
  deleteRankedSeasonForDeleteSeason,
  deleteRankedUserRewardsForDeleteSeason,
  executeResultForQueueForRankedPvp,
  fetchAllSeasons,
  fetchCurrentSeason,
  fetchUserRankedQueue,
  findRankedLoadoutByUserId,
  findRankedSeasonById,
  findSeasonRewardUserSnapshot,
  findUserDataForLeaveRankedPvpQueue,
  insertLogQueueLengthsForCheckRankedPvpMatches,
  insertLogRankedPicksForCheckRankedPvpMatches,
  insertRankedLoadoutForGetRankedLoadout,
  insertRankedPvpQueueForQueueForRankedPvp,
  insertRankedSeasonForCreateSeason,
  insertRankedUserRewardsForEndRankedSeason,
  listItemForUpdateRankedLoadout,
  listRankedPvpQueueForCheckRankedPvpMatches,
  listUserDataForEndRankedSeason,
  selectRankedPvpQueueForGetRankedPvpQueue,
  selectRankedUserRewardsForGetUnclaimedUserSeasonRewards,
  updateRankedLoadoutForUpdateRankedLoadout,
  updateRankedSeasonForEndRankedSeason,
  updateRankedSeasonForUpdateSeason,
  updateRankedUserRewardsForClaimSeasonRewards,
  updateUserDataForEndRankedSeason,
  updateUserDataForEnterRankedSeason,
  updateUserDataForGetRankedPvpQueue,
} from "@/queries/pvprank";
import { initiateBattle } from "@/routers/combat";
import {
  fetchUpdatedUser,
  getUserProgressionUpdate,
} from "@/server/api/routers/profile";
import { updateRewards } from "@/server/api/routers/quests";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import {
  cleanRankedProhibitedSelections,
  fetchSanninRankedPlayers,
} from "@/server/utils/ranked";
import { validateTitleRewardIds } from "@/server/utils/titleRewards";
import { canAwardReputation, canChangeContent } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/string";
import { secondsPassed } from "@/utils/time";
import { idSchema } from "@/validators/misc";
import {
  rankedLoadoutSchema,
  rankedQueueResponseSchema,
  rankedSeasonSchema,
} from "@/validators/pvpRank";
import { MASTERY_EXPERIENCE_FIELDS } from "@/validators/rewards";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const pvpRankRouter = createTRPCRouter({
  // Get the user's season rewards
  getUnclaimedUserSeasonRewards: protectedProcedure
    .meta({
      mcp: { description: "Get unclaimed ranked season rewards" },
    })
    .query(async ({ ctx }) => {
      return await getUnclaimedUserSeasonRewards(ctx.drizzle, ctx.userId);
    }),

  // Claim the user's season rewards
  claimSeasonRewards: protectedProcedure
    .meta({ mcp: { description: "Claim ranked season rewards" } })
    .mutation(async ({ ctx }) => {
      // Fetch unclaimed rewards for the user
      const [rewards, user] = await Promise.all([
        getUnclaimedUserSeasonRewards(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!user) {
        return errorResponse("User not found");
      }
      if (rewards.length === 0) {
        return errorResponse("No unclaimed season rewards");
      }
      const rewardIds = rewards.map((reward) => reward.id);
      const claimResult = await updateRankedUserRewardsForClaimSeasonRewards(
        ctx.drizzle,
        ctx,
        rewardIds,
      );
      if (claimResult.rowsAffected !== rewardIds.length) {
        return errorResponse("Season rewards already claimed");
      }
      // Collect rewards from each entry
      const collapsedRewards = collapseRewards(
        rewards
          .map((r) => r.seasonRewards)
          .filter((r): r is NonNullable<typeof r> => r !== undefined && r !== null),
      );
      const processedRewards = postProcessRewards(collapsedRewards, user);
      const granted = await updateRewards({
        client: ctx.drizzle,
        user,
        rewards: processedRewards,
        reason: "RANKED_REWARDS",
      });

      // Content and membership rewards change derived relations; ordinary numeric payouts
      // only confirm their saved counters, including SQL-capped gains and live pet eligibility.
      const needsRelations =
        processedRewards.reward_rank !== "NONE" ||
        processedRewards.reward_village_membership !== "NONE" ||
        granted.titles.length > 0 ||
        granted.badges.length > 0 ||
        granted.sageModes.length > 0 ||
        processedRewards.reward_clanpoints !== 0 ||
        processedRewards.reward_anbupoints !== 0 ||
        processedRewards.reward_war_damage !== 0 ||
        processedRewards.reward_war_healing !== 0 ||
        MASTERY_EXPERIENCE_FIELDS.some(
          (field) => (processedRewards[field] ?? 0) !== 0,
        ) ||
        (processedRewards.reward_mastery_rank != null &&
          processedRewards.reward_mastery_rank !== "NONE");
      const hydrated = needsRelations
        ? await fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId })
        : undefined;
      const counters = await findSeasonRewardUserSnapshot(ctx.drizzle, ctx.userId);
      const progression = hydrated?.user
        ? getUserProgressionUpdate(hydrated.user, hydrated.publishedAchievementIds)
        : undefined;
      return {
        success: true,
        message: "Season rewards claimed successfully",
        userDelta: {},
        achievementProgress: progression?.achievementProgress,
        userPatch: hydrated?.user
          ? {
              ...counters,
              ...progression?.userPatch,
              village: hydrated.user.village,
              villageId: hydrated.user.villageId,
              isOutlaw: hydrated.user.isOutlaw,
              joinedVillageAt: hydrated.user.joinedVillageAt,
              clan: hydrated.user.clan,
              anbuSquad: hydrated.user.anbuSquad,
              titles: hydrated.user.titles,
              displayTitle: hydrated.user.displayTitle,
              sageModeId: hydrated.user.sageModeId,
              sageMode: hydrated.user.sageMode,
            }
          : counters
            ? {
                ...counters,
                village: counters.village ?? undefined,
              }
            : undefined,
        rewards: {
          ...processedRewards,
          reward_titles: granted.titles.map((entry) => entry.name),
        },
      };
    }),

  // Get all ranked seasons
  getSeasons: protectedProcedure
    .meta({ mcp: { description: "Get all ranked PvP seasons" } })
    .query(async ({ ctx }) => {
      const seasons = await fetchAllSeasons(ctx.drizzle);
      return seasons;
    }),

  // Get a specific season
  getSeason: protectedProcedure
    .meta({ mcp: { description: "Get a specific ranked season" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const season = await findRankedSeasonById(ctx.drizzle, input.id);
      if (!season) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Season not found" });
      }
      return season;
    }),

  // Get the current season
  getCurrentSeason: protectedProcedure
    .meta({
      mcp: { description: "Get the current active ranked season" },
    })
    .query(async ({ ctx }) => {
      return await fetchCurrentSeason(ctx.drizzle);
    }),

  // Get the current season
  getCurrentTopPlayers: protectedProcedure
    .meta({
      mcp: {
        description: "Get LP values of the top Legend players used for Sannin rank",
      },
    })
    .query(async ({ ctx }) => {
      return await fetchSanninRankedPlayers(ctx.drizzle);
    }),

  // Create a new season
  createSeason: protectedProcedure
    .input(rankedSeasonSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, currentSeason, titleError] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchCurrentSeason(ctx.drizzle),
        validateTitleRewardIds(ctx.drizzle, input),
      ]);
      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("You don't have permission to create ranked seasons");
      }
      if (currentSeason) {
        return errorResponse("A season is already active");
      }
      if (titleError) return errorResponse(titleError);
      // Server-side enforcement: reset reward_reputation to 0 in all division rewards if user lacks permission
      const seasonData = { ...input };
      if (!canAwardReputation(user.role)) {
        seasonData.rewards = seasonData.rewards.map((divisionReward) => ({
          ...divisionReward,
          rewards: {
            ...divisionReward.rewards,
            reward_reputation: 0,
          },
        }));
      }
      // insert new season
      const id = nanoid();
      await insertRankedSeasonForCreateSeason(ctx.drizzle, id, seasonData);

      return { success: true, message: "Season created successfully" };
    }),

  // Update an existing season
  updateSeason: protectedProcedure
    .input(idSchema.extend(rankedSeasonSchema.shape))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, currentSeason, existingSeason, titleError] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchCurrentSeason(ctx.drizzle),
        findRankedSeasonById(ctx.drizzle, input.id),
        validateTitleRewardIds(ctx.drizzle, input),
      ]);
      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("You don't have permission to update ranked seasons");
      }
      if (!existingSeason) {
        return errorResponse("Season not found");
      }
      if (currentSeason && currentSeason.id !== input.id) {
        const now = new Date();
        const resultActive = input.endDate >= now;
        if (resultActive) {
          return errorResponse("Another season is active, cannot update this season");
        }
      }
      if (titleError) return errorResponse(titleError);
      // Server-side enforcement: preserve existing reward_reputation in all division rewards if user lacks permission
      const { id, ...data } = input;
      if (!canAwardReputation(user.role)) {
        data.rewards = data.rewards.map((divisionReward) => {
          // Find existing division reward by division name to preserve its reputation value
          const existingDivisionReward = existingSeason.rewards.find(
            (r) => r.division === divisionReward.division,
          );
          const existingReputation =
            existingDivisionReward?.rewards?.reward_reputation ?? 0;
          return {
            ...divisionReward,
            rewards: {
              ...divisionReward.rewards,
              reward_reputation: existingReputation,
            },
          };
        });
      }
      // update season
      await updateRankedSeasonForUpdateSeason(ctx.drizzle, data, id);
      return { success: true, message: "Season updated successfully" };
    }),

  // Delete a season
  deleteSeason: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("You don't have permission to delete ranked seasons");
      }
      // delete season
      await Promise.all([
        deleteRankedSeasonForDeleteSeason(ctx.drizzle, input),
        deleteRankedUserRewardsForDeleteSeason(ctx.drizzle, input),
      ]);
      return { success: true, message: "Season deleted successfully" };
    }),

  // End a season manually
  endSeason: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user & permission guard
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) {
        return errorResponse("You don't have permission to end ranked seasons");
      }
      // Verify season exists & not already ended
      const season = await findRankedSeasonById(ctx.drizzle, input.id);
      if (!season) {
        return errorResponse("Season not found");
      }
      if (season.ended) {
        return errorResponse("Season already ended");
      }

      // Perform season ending logic
      await endRankedSeason(ctx.drizzle, season.id);

      return { success: true, message: "Season ended successfully" };
    }),

  // Get the ranked loadout
  getRankedLoadout: protectedProcedure
    .meta({ mcp: { description: "Get user's ranked PvP loadout" } })
    .query(async ({ ctx }) => {
      let loadout = await findRankedLoadoutByUserId(ctx.drizzle, ctx.userId);
      if (!loadout) {
        loadout = {
          id: nanoid(),
          userId: ctx.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          loadout: {
            jutsuIds: [],
            weaponIds: [],
            consumableIds: [],
            favoriteJutsuIds: [],
            favoriteWeaponIds: [],
            favoriteConsumableIds: [],
          },
        };
        await insertRankedLoadoutForGetRankedLoadout(ctx.drizzle, loadout);
        return loadout;
      }
      return (await cleanRankedProhibitedSelections(ctx.drizzle, loadout)).loadout;
    }),

  // Get the ranked PvP queue
  getRankedPvpQueue: protectedProcedure
    .meta({ mcp: { description: "Get user's ranked PvP queue status" } })
    .query(async ({ ctx }) => {
      // Query
      const [user, queueEntry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserRankedQueue(ctx.drizzle, ctx.userId),
      ]);
      // Reconcile stale rows without deleting a join that claimed QUEUED after this read.
      if (user.status !== "QUEUED" && queueEntry) {
        await deleteUserRankedQueueRow(ctx.drizzle, ctx.userId, true);
      } else if (user.status === "QUEUED" && !queueEntry) {
        await retryOnDeadlock(() =>
          updateUserDataForGetRankedPvpQueue(ctx.drizzle, ctx),
        );
      }
      // Get the queue count
      const queueCount = await selectRankedPvpQueueForGetRankedPvpQueue(
        ctx.drizzle,
      ).then((result) => result[0]?.count ?? 0);

      return {
        inQueue: !!queueEntry,
        createdAt: queueEntry?.queueStartTime,
        queueCount,
      };
    }),

  // Lightweight live queue size for site-wide notifications (no state cleanup)
  getRankedQueueCount: protectedProcedure
    .meta({
      mcp: { description: "Get number of players in ranked PvP queue" },
    })
    .query(({ ctx }) => countRankedPvpQueueForGetRankedQueueCount(ctx.drizzle)),

  // Update the ranked loadout
  updateRankedLoadout: protectedProcedure
    .meta({ mcp: { description: "Update user's ranked PvP loadout" } })
    .input(rankedLoadoutSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Duplicate ids would otherwise fail the existence checks below
      const loadout = {
        ...input,
        jutsuIds: [...new Set(input.jutsuIds)],
        weaponIds: [...new Set(input.weaponIds)],
        consumableIds: [...new Set(input.consumableIds)],
      };
      // Query all relevant information
      const itemIds = [...new Set([...loadout.weaponIds, ...loadout.consumableIds])];
      const [items, jutsus, currentLoadout] = await Promise.all([
        itemIds.length > 0 ? listItemForUpdateRankedLoadout(ctx.drizzle, itemIds) : [],
        loadout.jutsuIds.length > 0
          ? listJutsuByIds(ctx.drizzle, loadout.jutsuIds)
          : [],
        findRankedLoadoutByUserId(ctx.drizzle, ctx.userId),
      ]);
      // Guard & ensure that all the items & jutsus exist and are of correct type
      if (!currentLoadout) {
        return errorResponse("No ranked loadout found");
      }
      if (items.length !== itemIds.length) {
        return errorResponse("Some items not found or not available in shop");
      }
      if (jutsus.length !== loadout.jutsuIds.length) {
        return errorResponse("Some jutsus not found or not available in shop");
      }
      // Check loadout
      const jutsuCheck = validateJutsuLoadout(jutsus);
      const itemCheck = validateItemLoadout(items);
      if (!jutsuCheck.check || !itemCheck.check) {
        return errorResponse(jutsuCheck.message || itemCheck.message);
      }
      // Run mutation
      await updateRankedLoadoutForUpdateRankedLoadout(
        ctx.drizzle,
        loadout,
        currentLoadout,
      );
      // Return success
      return { success: true, message: "Ranked loadout updated successfully" };
    }),

  // Enter the ranked season
  enterRankedSeason: protectedProcedure
    .meta({ mcp: { description: "Enter the current ranked season" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!hasRequiredRank(user.rank, RANKED_REQUIRED_RANK)) {
        return errorResponse(
          `You need to be a ${capitalizeFirstLetter(RANKED_REQUIRED_RANK)} to enter the ranked season`,
        );
      }
      if (user.rankedLp > 0) {
        return errorResponse("You have already entered the ranked season");
      }
      if (user.villagePrestige < RANKED_ENTRY_COST) {
        return errorResponse(
          `You need to have ${RANKED_ENTRY_COST} village prestige to enter the ranked season`,
        );
      }
      // Mutation
      const result = await updateUserDataForEnterRankedSeason(ctx.drizzle, ctx);
      if (result.rowsAffected !== 1)
        return errorResponse(
          "Your ranked entry or village prestige changed. Reload and try again.",
        );
      return {
        success: true,
        message: "Ranked season entered successfully",
        userPatch: { rankedLp: 150 },
        userDelta: { villagePrestige: -RANKED_ENTRY_COST },
      };
    }),

  // Queue for ranked PVP battle
  queueForRankedPvp: protectedProcedure
    .meta({
      mcp: { description: "Join the ranked PvP matchmaking queue" },
    })
    .output(rankedQueueResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const [existingQueue, user, currentLoadout, currentSeason] = await Promise.all([
        fetchUserRankedQueue(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
        findRankedLoadoutByUserId(ctx.drizzle, ctx.userId),
        fetchCurrentSeason(ctx.drizzle),
      ]);
      // Guard
      if (existingQueue) {
        return errorResponse("Already in queue");
      }
      if (user.status !== "AWAKE") return errorResponse("Need to be awake to queue");
      if (!hasRequiredRank(user.rank, RANKED_REQUIRED_RANK)) {
        return errorResponse(
          `You need to be a ${capitalizeFirstLetter(RANKED_REQUIRED_RANK)} to queue`,
        );
      }
      if (user.rankedLp < 1) {
        return errorResponse(
          "You need to have entered into the ranked season before you can queue",
        );
      }

      // Check if current season is paused
      if (currentSeason?.paused) {
        return errorResponse("Ranked season is currently paused");
      }

      // Strip selections ranked no longer allows (skill-gated, PVE jutsu, bloodline items,
      // deleted or unshoppable entries)
      // before validating the remaining loadout.
      let removedJutsuIds: string[] = [];
      let removedItemIds: string[] = [];
      if (currentLoadout) {
        const cleaned = await cleanRankedProhibitedSelections(
          ctx.drizzle,
          currentLoadout,
        );
        removedJutsuIds = cleaned.removedJutsuIds;
        removedItemIds = cleaned.removedItemIds;

        // Check loadout
        const jutsuCheck = validateJutsuLoadout(cleaned.jutsus);
        const itemCheck = validateItemLoadout(cleaned.items);
        if (!jutsuCheck.check || !itemCheck.check) {
          return errorResponse(jutsuCheck.message || itemCheck.message);
        }
      }

      // Publish an unclaimed row, then atomically acquire QUEUED and mark its owner.
      // Unclaimed rows cannot match or prevent clan cleanup from releasing a user.
      const queueId = nanoid();
      await insertRankedPvpQueueForQueueForRankedPvp(ctx.drizzle, queueId, ctx, user);
      let hasClaimedQueue = false;
      try {
        // Drizzle's MySQL update builder cannot JOIN and SET both tables. As with
        // purchase delivery, one parameterized UPDATE makes ownership durable with
        // the status claim. Removing this exact provisional row makes the claim fail.
        const result = await retryOnDeadlock(() =>
          executeResultForQueueForRankedPvp(ctx.drizzle, user, queueId),
        );
        hasClaimedQueue = result.rowsAffected > 0;
      } finally {
        // A lost response may follow a committed claim. Delete only this request's
        // unclaimed row, preserving both an ambiguous success and another winning join.
        if (!hasClaimedQueue) {
          await retryOnDeadlock(() =>
            deleteRankedPvpQueueForQueueForRankedPvp(ctx.drizzle, queueId),
          );
        }
      }
      if (!hasClaimedQueue) return errorResponse("Need to be awake to queue");
      return {
        success: true,
        message:
          removedJutsuIds.length > 0 || removedItemIds.length > 0
            ? "Ranked loadout updated because some selections are not allowed in ranked. Queued with the remaining loadout."
            : "Queued for ranked PvP",
        removedJutsuIds: removedJutsuIds.length > 0 ? removedJutsuIds : undefined,
        removedItemIds: removedItemIds.length > 0 ? removedItemIds : undefined,
      };
    }),

  // Leave the ranked PvP queue
  leaveRankedPvpQueue: protectedProcedure
    .meta({
      mcp: { description: "Leave the ranked PvP matchmaking queue" },
    })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.status !== "QUEUED") {
        return errorResponse("Not in the queue");
      }
      // Mutation. Capture the CAS result: if a concurrent match claimed us into a
      // battle between the guard read above and this update, the QUEUED-guarded
      // status update matches no rows.
      const [, leaveResult] = await Promise.all([
        deleteUserRankedQueueRow(ctx.drizzle, ctx.userId),
        // Guard on QUEUED so a concurrent match that already claimed us into a
        // battle (status BATTLE) is not clobbered back to AWAKE.
        wakeQueuedUser(ctx.drizzle, ctx.userId),
      ]);
      // No row matched: status changed between the guard read and this update.
      // That can mean a concurrent match claimed us into a battle, OR a failed
      // match rolled us back to AWAKE. The queue row is already deleted, so we are
      // out of the queue either way; re-read battleId (cold path) to report
      // accurately rather than assume a battle.
      if (leaveResult.rowsAffected === 0) {
        const current = await findUserDataForLeaveRankedPvpQueue(ctx.drizzle, ctx);
        if (current?.battleId) {
          return errorResponse("You've been matched into a ranked battle");
        }
      }
      return { success: true, message: "Left ranked PvP queue" };
    }),

  // Check for ranked PvP matches
  checkRankedPvpMatches: protectedProcedure
    .meta({
      mcp: { description: "Check for available ranked PvP matches" },
    })
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx }) => {
      // Get all queued players
      const [queuedPlayers, topPlayersLP] = await Promise.all([
        listRankedPvpQueueForCheckRankedPvpMatches(ctx.drizzle),
        fetchSanninRankedPlayers(ctx.drizzle),
      ]);

      const userEntry = queuedPlayers.find((p) => p.userId === ctx.userId);
      // Guards
      if (!userEntry) {
        return { success: false, message: "", battleId: undefined };
      }
      // If we hold a queue row but are no longer QUEUED, the row is stale — e.g.
      // a crash between a successful match start and the queue cleanup left it
      // behind and our battle has since ended. Remove it and stop: otherwise
      // inQueue stays true (the client keeps polling) and the lost-claim restore
      // below would re-QUEUE us into unwanted matches.
      if (userEntry.user?.status !== "QUEUED") {
        await deleteUserRankedQueueRow(ctx.drizzle, ctx.userId, true);
        return { success: false, message: "", battleId: undefined };
      }
      // Derived
      const secondsInQueue = secondsPassed(userEntry.queueStartTime);
      const rankedRank = getRankedRank(userEntry.rankedLp, topPlayersLP);
      const lpRadius = getRankedRadius(secondsInQueue);
      const opponentEntry = queuedPlayers.find((opponent) => {
        if (opponent.userId === ctx.userId) return false;
        // Skip opponents that are no longer QUEUED: a crash between a successful
        // match and the queue-row delete can leave a BATTLE player with a
        // lingering queue row. This filter, with the QUEUED-only claim in
        // initiateBattle, keeps such a stale row from being matched (our own
        // stale row is removed by the caller-status guard above).
        if (opponent.user?.status !== "QUEUED") return false;
        return Math.abs(opponent.rankedLp - userEntry.rankedLp) <= lpRadius;
      });
      // Guard
      if (!opponentEntry) {
        return { success: false, message: "", battleId: undefined };
      }
      if (!userEntry.user.rankedLoadout || !opponentEntry.user.rankedLoadout) {
        return { success: false, message: "No loadout found", battleId: undefined };
      }
      const [userEffective, opponentEffective] = await Promise.all([
        cleanRankedProhibitedSelections(ctx.drizzle, userEntry.user.rankedLoadout),
        cleanRankedProhibitedSelections(ctx.drizzle, opponentEntry.user.rankedLoadout),
      ]);
      // The atomic claim is inside initiateBattle: it transitions both
      // participants QUEUED -> BATTLE in one guarded UPDATE and rolls back
      // (resetting only the rows it touched to AWAKE) if it cannot claim both.
      // That userData status-CAS — not the queue table — is the single-winner
      // mutex, so we call it first and gate all cleanup on its success.
      const result = await initiateBattle(
        {
          userIds: [userEntry.userId],
          targetIds: [opponentEntry.userId],
          client: ctx.drizzle,
          biome: "arena",
          targetStatDistribution: RANKED_PVP_STATS,
          userStatDistribution: RANKED_PVP_STATS,
          forceLoadouts: [userEffective.loadout, opponentEffective.loadout],
          topPlayersLP,
        },
        "RANKED_PVP",
      );

      if (result.success && result.battleId) {
        const rankedPickRows = [
          ...userEffective.loadout.loadout.jutsuIds.map((jutsuId) => ({
            type: "jutsu" as const,
            contentId: jutsuId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
          ...userEffective.loadout.loadout.weaponIds.map((weaponId) => ({
            type: "item" as const,
            contentId: weaponId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
          ...userEffective.loadout.loadout.consumableIds.map((consumableId) => ({
            type: "consumable" as const,
            contentId: consumableId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
          ...opponentEffective.loadout.loadout.jutsuIds.map((jutsuId) => ({
            type: "jutsu" as const,
            contentId: jutsuId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
          ...opponentEffective.loadout.loadout.weaponIds.map((weaponId) => ({
            type: "item" as const,
            contentId: weaponId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
          ...opponentEffective.loadout.loadout.consumableIds.map((consumableId) => ({
            type: "consumable" as const,
            contentId: consumableId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
        ];
        const postMatchTasks: PromiseLike<unknown>[] = [
          deleteRankedPvpQueueForCheckRankedPvpMatches(ctx.drizzle, ctx, opponentEntry),
          insertLogQueueLengthsForCheckRankedPvpMatches(
            ctx.drizzle,
            rankedRank,
            secondsInQueue,
          ),
        ];
        if (rankedPickRows.length > 0) {
          postMatchTasks.push(
            insertLogRankedPicksForCheckRankedPvpMatches(ctx.drizzle, rankedPickRows),
          );
        }
        // Winner path only: remove both players from the queue and write match
        // logs. Gating these on success stops a losing poll from deleting queue
        // rows it never matched.
        await Promise.all(postMatchTasks);
        return { success: true, message: "Match found!", battleId: result.battleId };
      }

      // Lost the claim (opponent taken first, the caller already left, or both
      // already gone). Ranked rollback in initiateBattle restores any
      // temporarily claimed queue rows, so the next 5s poll can rematch.
      return { success: false, message: "", battleId: undefined };
    }),
});

/**
 * Delete a user's ranked PvP queue rows, either for an intentional leave or stale cleanup.
 * Cleanup rechecks status in the DELETE: a provisional row's owner can claim QUEUED
 * after the caller's read. Intentional leaves still remove rows while the user is QUEUED.
 * A crash before claiming can leave an inert unclaimed row; it owns no status and the
 * cleaner expires it without blocking a later join for the same account.
 * @param client - The Drizzle client
 * @param userId - The user's ID
 * @param onlyIfNotQueued - Preserve rows whose owner currently holds QUEUED status.
 */
export const deleteUserRankedQueueRow = (
  client: DrizzleClient,
  userId: string,
  onlyIfNotQueued = false,
) =>
  retryOnDeadlock(() =>
    deleteRankedPvpQueueForDeleteUserRankedQueueRow(client, userId, onlyIfNotQueued),
  );

/**
 * Get the unclaimed season rewards for a user
 * @param client - The Drizzle client
 * @param userId - The user's ID
 * @returns The unclaimed season rewards
 */
export const getUnclaimedUserSeasonRewards = async (
  client: DrizzleClient,
  userId: string,
) => {
  const joinedResults = await selectRankedUserRewardsForGetUnclaimedUserSeasonRewards(
    client,
    userId,
  );
  return joinedResults.map((row) => {
    const divisionRewards = row.seasonRewards.find(
      (d) => d.division === row.division,
    )?.rewards;
    return { ...row, seasonRewards: divisionRewards };
  });
};

/**
 * End a ranked season
 * @param client - The Drizzle client
 * @param seasonId - The ID of the season to end
 */
export const endRankedSeason = async (client: DrizzleClient, seasonId: string) => {
  // Fetch users with LP > 0 and the season to end (validate again in case caller skipped)
  const [users, season] = await Promise.all([
    listUserDataForEndRankedSeason(client),
    findRankedSeasonById(client, seasonId),
  ]);

  if (!season) {
    throw new Error("Season not found");
  }
  if (season.ended) {
    return;
  }

  // Determine top players LP for "Sannin" rank calculation
  // Sannin is only the top 10 players who have reached Legend rank (900+ LP)
  const legendPlayers = users.filter((u) => u.rankedLp >= RANKED_LEGEND_LP_REQUIREMENT);
  const topPlayersLP = legendPlayers
    .slice(0, RANKED_SANNIN_TOP_PLAYERS)
    .map((u) => u.rankedLp);

  // Prepare reward rows
  const rewardRows = users.map((user) => ({
    id: nanoid(),
    userId: user.userId,
    seasonId: season.id,
    division: getRankedRank(user.rankedLp, topPlayersLP),
  }));

  // Execute database updates in parallel (no explicit transaction)
  await Promise.all([
    // Reset LP for everyone
    updateUserDataForEndRankedSeason(client),
    // Mark season as ended
    updateRankedSeasonForEndRankedSeason(client, season),
    // Insert rewards rows if any
    rewardRows.length > 0
      ? insertRankedUserRewardsForEndRankedSeason(client, rewardRows)
      : null,
  ]);
};
