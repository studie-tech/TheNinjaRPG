import { randomInt as secureRandomInt } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import {
  and,
  count,
  desc,
  eq,
  exists,
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
import { nanoid } from "nanoid";
import { after } from "next/server";
import superjson from "superjson";
import { z } from "zod";
import * as mapData from "@/data/hexasphere.json";
import type { BattleType, BattleUsageType } from "@/drizzle/constants";
import {
  AdjustableBasicActions,
  AutoBattleTypes,
  AutoCombatBattleTypes,
  BATTLE_ARENA_DAILY_LIMIT,
  BATTLE_ARENA_HEAL_COST,
  BattleTypes,
  COMBAT_BIOMES,
  type CombatBiome,
  CombatStatNames,
  DUNGEON_PARTY_SIZE,
  ELEMENTAL_MASTERY_BOOST,
  ELITE_JONIN_BRACKET,
  HUNTING_REQUIRED_EXP,
  IMG_AVATAR_DEFAULT,
  KAGE_DEFENSE_GRACE_MINUTES,
  KAGE_MIN_DAYS_IN_VILLAGE,
  KAGE_PRESTIGE_REQUIREMENT,
  MAP_RESERVED_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  MAX_PLAYER_LEVEL,
  ManualStartBattleTypes,
  MasteryNames,
  NonActionItemTypes,
  PoolTypes,
  PvpBattleTypes,
  QuestBattleTypes,
  RANKS_RESTRICTED_FROM_PVP,
  REGEN_SECONDS,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
  TERRITORY_WAR_TEAM_SIZE,
  VILLAGE_SYNDICATE_ID,
  WAKE_ISLAND_PVP_PROTECTION,
} from "@/drizzle/constants";
import type {
  AiProfile,
  BattleAction,
  GameSetting,
  Jutsu,
  RankedLoadout,
  UserQuest,
  Village,
  VillageAlliance,
} from "@/drizzle/schema";
import {
  battle,
  battleAction,
  battleHistory,
  bounty,
  dungeonRun,
  gameAsset,
  gameSetting,
  huntingProgress,
  huntingSession,
  item,
  jutsu,
  kageDefendedChallenges,
  mpvpBattleQueue,
  mpvpBattleUser,
  quest,
  questHistory,
  raidParticipation,
  rankedPvpQueue,
  sageMode,
  sector,
  territoryWar,
  tournament,
  tournamentMatch,
  trainingLog,
  userData,
  userItem,
  userJutsu,
  userPet,
  village,
  villageAlliance,
  war,
} from "@/drizzle/schema";
import { getReskinnedBloodline } from "@/libs/bloodline";
import { matchBloodrightSnapshot } from "@/libs/bloodright";
import {
  availableUserActions,
  getDefaultBasicActions,
  performBattleAction,
  stillInBattle,
} from "@/libs/combat/actions";
import { performAIaction } from "@/libs/combat/ai_v2";
import {
  COMBAT_LOBBY_SECONDS,
  RANKED_BLOODLINE_DAMAGE_TAG,
} from "@/libs/combat/constants";
import {
  createAction,
  saveUsage,
  updateBattle,
  updateClanLeaders,
  updateKage,
  updateRaidProgress,
  updateTournament,
  updateUser,
  updateVillageAnbuClan,
  updateWars,
} from "@/libs/combat/database";
import { getPreferredDamageElement } from "@/libs/combat/elementalDamage";
import { advanceEncounterWave, prepareEncounterWaves } from "@/libs/combat/encounters";
import { getBattleSpawnLocations, supportsNpcAllies } from "@/libs/combat/participants";
import { addPetsToBattle, petsAllowedInBattle } from "@/libs/combat/pets";
import {
  applyEffects,
  applySageModeAfterRoundTransition,
  checkFriendlyFire,
  consolidatePreBattleDamageModifiers,
  emptyPreBattleGearModifiers,
} from "@/libs/combat/process";
import { addQuestStartingEffects } from "@/libs/combat/questEffects";
import {
  mergeLoadoutParticipants,
  summonActionBlockedReason,
} from "@/libs/combat/summon";
import { realizeTag } from "@/libs/combat/tags";
import type {
  ActionEffect,
  BattleUserItem,
  BattleUserJutsu,
  BattleUserState,
  BattleWar,
  CombatQueryUser,
  CompleteBattle,
  ExtraState,
  GroundEffect,
  ProcessedItem,
  ProcessingBattleUser,
  UserEffect,
} from "@/libs/combat/types";
import { captureCombatCacheSnapshot } from "@/libs/combat/userCache";
import {
  alignBattle,
  applyPoolAdjustmentsToBase,
  calcBattleResult,
  getBattleClaimIds,
  getBattleGrid,
  getDefaultBattleSizes,
  getEffectiveMaxPool,
  getPoolKeys,
  getTurnControl,
  isEffectActive,
  maskBattle,
  mergeExtraState,
  reconcileLobbyPools,
  refreshMasteries,
  resetMasteriesToBase,
  rollInitiative,
} from "@/libs/combat/util";
import type { CoopEncounter } from "@/libs/coop";
import { dungeonBattleOutcome } from "@/libs/dungeon";
import { activeTrainedElement } from "@/libs/elementalMastery";
import { fetchDmgConfig } from "@/libs/gamesettings";
import { computeJutsuLoadoutCapAssignments } from "@/libs/jutsu";
import { resolveSelectableLoadout } from "@/libs/loadout";
import { effectiveMasteries, isWornGear, isWornGearDisabled } from "@/libs/mastery";
import {
  areWarObjectivesRevealed,
  getWarRelationship,
  getWarSide,
  isObjectiveWarActive,
  withMercenaryParticipation,
} from "@/libs/objectiveWar";
import { petExperienceGainSql } from "@/libs/pets/experience";
import {
  calcActiveUserRegen,
  calcCP,
  calcHP,
  calcLevelRequirements,
  calcMaxEnergy,
  calcSP,
  canAttackBracket,
  capUserStats,
  getEffectiveLevel,
  getExpBracket,
  manuallyAssignUserStats,
  scaleUserStats,
} from "@/libs/profile";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { getPvpBoost } from "@/libs/pvpExperience";
import {
  controlShownQuestLocationInformation,
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  mockAchievementHistoryEntries,
} from "@/libs/quest";
import { projectPartyTracker } from "@/libs/questParty";
import { getIsolatedPyramid, isBetweenPyramidBattles } from "@/libs/questRun";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import { rollStealthKeep } from "@/libs/stealth";
import { getTerritoryCompetitor } from "@/libs/territoryWar";
import type { GlobalMapData } from "@/libs/threejs/types";
import {
  getTimedRegenerationGain,
  getTimedRegenerationPeriods,
} from "@/libs/timedBuffs";
import { regenerationBuffs, titleCombatTag } from "@/libs/titles";
import { isActiveEventEntrant } from "@/libs/tournament/events";
import {
  applyMasteryTrainingGains,
  battleJutsuGateFailure,
  calcJutsuEquipLimit,
  settleQueuedTraining,
} from "@/libs/train";
import { calcIsInVillage, getBiomeFromGlobalTile } from "@/libs/travel";
import { fetchAiProfileById } from "@/routers/ai";
import { fetchSectorVillage } from "@/routers/village";
import { fetchActiveWars } from "@/routers/war";
import {
  fetchItemLoadouts,
  fetchUserItemsWithVariants,
  selectItemLoadout,
} from "@/server/api/routers/item";
import {
  fetchBloodlineJutsuReskins,
  fetchJutsuLoadouts,
  fetchUserJutsus,
  selectJutsuLoadout,
} from "@/server/api/routers/jutsu";
import { fetchUserSkills } from "@/server/api/routers/skillTree";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  activityCompletionExtras,
  completedQuestHistoryRelation,
} from "@/server/utils/achievementObjectives";
import { battleClaimRollbackStatus } from "@/server/utils/concurrency";
import { settleCookingExperience } from "@/server/utils/cooking";
import {
  elementalSnapshotConditions,
  masteryGainUpdates,
} from "@/server/utils/masteryProgression";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { resumeBracketImmunitySql } from "@/server/utils/objectiveWar";
import { notifyBattleDefenders } from "@/server/utils/push/combat";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import {
  commitQuestEntryBattle,
  fetchQuestEntryInventory,
  getQuestEntryCharges,
  questAttemptIsActive,
} from "@/server/utils/questEntry";
import { fetchSanninRankedPlayers } from "@/server/utils/ranked";
import {
  fetchActiveTerritoryWar,
  territoryWarBoostWindowsSql,
} from "@/server/utils/territoryWar";
import { hasDueTimedJob, settleDueTimedQueues } from "@/server/utils/userQueue";
import { extendWarParticipantSql, liftBracketImmunitySql } from "@/server/utils/war";
import { activeWarAllyWhere } from "@/server/utils/warAlly";
import { activeWarMercenaryWhere } from "@/server/utils/warMercenary";
import { findRelationship } from "@/utils/alliance";
import { getRandomElement } from "@/utils/array";
import { getKageEligibility } from "@/utils/kage";
import { fedItemLoadouts, fedJutsuLoadouts } from "@/utils/paypal";
import { canChangeContent } from "@/utils/permissions";
import { secondsFromDate, secondsFromNow, secondsPassed } from "@/utils/time";
import { canAccessStructure } from "@/utils/village";
import type { AssignableUserStats, ZodAllTags } from "@/validators/combat";
import {
  BarrierTag,
  IncreaseDamageGivenTag,
  performActionSchema,
  statSchema,
  toggleAutoCombatSchema,
} from "@/validators/combat";
import type { HuntingBattleState } from "@/validators/hunting";
import { sectorIdSchema } from "@/validators/travel";
import {
  fetchAchievementCatalogue,
  fetchUpdatedUser,
  fetchUser,
  type UserWithRelations,
} from "./profile";

// Debug flag when testing battle
const debug = false;

// Pusher instance
const pusher = getServerPusher();

export const combatRouter = createTRPCRouter({
  getBattle: protectedProcedure
    .meta({ mcp: { description: "Get current battle state" } })
    .input(z.object({ battleId: z.string().optional().nullable() }))
    .query(async ({ ctx, input }) => {
      // No battle ID
      if (!input.battleId) {
        return { battle: null, result: null };
      }

      // Initial battle version
      const actionRounds: number[] = [];

      // OUTER LOOP: Attempt to perform action untill success || error thrown
      // The primary purpose here is that if the battle version was already updated, we retry the user's action
      let attempts = 0;
      while (true) {
        try {
          // Increment attempts
          attempts += 1;

          // Distinguish between public and non-public user state
          const userBattle = await fetchBattle(ctx.drizzle, input.battleId);
          if (!userBattle) {
            return { battle: null, result: null };
          }

          const spawnedWave = advanceEncounterWave(
            userBattle,
            !!dungeonBattleOutcome(userBattle),
          );
          // Current state of battle
          const actId = userBattle.activeUserId;
          const activeUser = userBattle.usersState.find((u) => u.userId === actId);
          const hadActivity = userBattle.updatedAt > userBattle.roundStartAt;

          // Update the battle to the correct activeUserId & round. Default to current user
          const fetchedVersion = userBattle.version;
          const fetchedUpdatedAt = userBattle.updatedAt;
          const { progressRound, changedActor, actionRound, expiredEffects } =
            alignBattle(userBattle, actionRounds, ctx.userId);
          // A round can advance on this poll path too (idle turn timeout), not only via
          // performAction. Run the sage exhaustion transition here as well, or it stays
          // stranded until the next action. In-memory (no DB round-trip) and idempotent
          // (guarded on sageModeActivated); the persist below carries the change, and the
          // applyEffects call in the no-activity branch ticks any queued after-effects.
          if (progressRound) {
            applySageModeAfterRoundTransition(userBattle);
          }
          if (changedActor || spawnedWave) userBattle.version = userBattle.version + 1;
          advanceEncounterWave(userBattle, !!dungeonBattleOutcome(userBattle));

          if (!actionRounds.includes(actionRound)) {
            actionRounds.push(actionRound);
          }

          // Calculate if the battle is over for this user, and if so update user DB
          // Fetch game settings for multipliers
          let result = calcBattleResult(
            userBattle,
            ctx.userId,
            userBattle.extraState.settings,
          );

          // The state this poll actually settles on. applyEffects hands back a
          // clone rather than mutating in place, so everything downstream of it
          // -- the result, the reward writes, the response -- has to read from
          // that clone or it disagrees with what was just persisted.
          let settledBattle = userBattle;

          const battleOver = result && result.friendsLeft + result.targetsLeft === 0;
          // A settlement-only poll must persist leftBattle without ticking effects again.
          const shouldTickEffects = battleOver || progressRound || changedActor;
          const history: Parameters<typeof createAction>[2] = [];
          if (shouldTickEffects && !hadActivity && actId && activeUser) {
            const { newBattle, actionEffects } = applyEffects(userBattle, actId);
            advanceEncounterWave(newBattle, !!dungeonBattleOutcome(newBattle));
            settledBattle = newBattle;
            // Effects ticking on this poll can end the fight -- a lingering
            // damage tag finishing the last opponent -- so the result computed
            // above is stale here, and persisting it would store a decided
            // battle as an unfinished one nobody can ever act in again.
            // calcBattleResult only mutates when it returns a result, so
            // re-running it after a null costs nothing.
            result =
              result ??
              calcBattleResult(newBattle, ctx.userId, newBattle.extraState.settings);

            // Remove expired ground effects after applyEffects has processed them
            // This ensures summon despawning logic runs before effects are removed
            newBattle.groundEffects = newBattle.groundEffects.filter((e) => {
              if (e.rounds !== undefined && e.rounds <= 0) {
                if (e.type === "visual" && actionRounds.includes(e.createdRound)) {
                  return true;
                } else {
                  return false; // Remove expired effects
                }
              }
              return true; // Keep active effects
            });

            // Expiry and idle damage share one history key for this round/version.
            history.push({
              battleRound: actionRound,
              appliedEffects: [...expiredEffects, ...actionEffects],
              description: `${activeUser.username} stands and does nothing. `,
              battleVersion: fetchedVersion,
              actionId: "wait",
              userId: activeUser.userId,
            });
          } else if (expiredEffects.length) {
            history.push({
              battleRound: actionRound,
              appliedEffects: expiredEffects,
              description: "Battlefield effects expire.",
              battleVersion: fetchedVersion,
              actionId: "wait",
            });
          }

          if (result || progressRound || changedActor || spawnedWave) {
            // alignBattle stamps updatedAt on every call. A settlement-only save must
            // keep the fetched value: the next timeout poll reads updatedAt > roundStartAt
            // as "the actor already acted" and would skip the idle actor's effects tick.
            if (!shouldTickEffects) settledBattle.updatedAt = fetchedUpdatedAt;
            const claim = await updateBattle(
              ctx.drizzle,
              result,
              ctx.userId,
              settledBattle,
              fetchedVersion,
              pusher,
            );
            if (!claim && attempts < 3) continue;
            if (!claim) throw new Error("Battle version changed");
            const { finishBattle } = claim;
            const [logEntries] = await Promise.all([
              createAction(ctx.drizzle, settledBattle, history),
              finishBattle(),
              ...(result &&
              !settledBattle.extraState.dungeon &&
              !settledBattle.extraState.hunting
                ? [
                    updateUser(ctx.drizzle, pusher, settledBattle, result, ctx.userId),
                    // Polling settlement pays the same faction counters as an action.
                    updateVillageAnbuClan(
                      ctx.drizzle,
                      settledBattle,
                      result,
                      ctx.userId,
                    ),
                    updateWars(ctx.drizzle, pusher, settledBattle, result, ctx.userId),
                    updateKage(ctx.drizzle, settledBattle, result),
                    // Terminal event outcomes were committed with the battle version claim.
                    ...(claim.battleOver && settledBattle.extraState.tournamentGameId
                      ? []
                      : [
                          updateTournament(
                            ctx.drizzle,
                            settledBattle,
                            result,
                            ctx.userId,
                          ),
                        ]),
                    updateRaidProgress(ctx.drizzle, settledBattle, ctx.userId),
                  ]
                : []),
            ]);
            // Idle effects can land a killing blow here too. Announce only after
            // their log insert finishes so clients can refresh an earlier read.
            if (
              history.length &&
              settledBattle.usersState.filter((user) => !user.isAi).length > 1
            ) {
              notifyBattleLogs(pusher, settledBattle, logEntries, !!result);
            }
          }

          // Hide private state of non-session user
          const newMaskedBattle = maskBattle(settledBattle, ctx.userId);

          // Return the new battle + result state if applicable
          return { battle: newMaskedBattle, result: result };
        } catch (e) {
          // If any of the above fails, retry the whole procedure
          if (e instanceof Error) {
            try {
              e.message += ` (Attempt ${attempts})`;
            } catch (e) {
              console.error(e);
            }
          }
          console.log("ERROR: ", e);
          if (attempts > 2) throw e;
        }
      }
    }),
  getBattleEntries: protectedProcedure
    .meta({ mcp: { description: "Get battle action log entries" } })
    .input(
      z.object({
        battleId: z.string(),
        refreshKey: z.number().optional(),
        checkBattle: z.boolean().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        // Filter: "all" = no filter, "user" = only current user, "opponents" = exclude current user
        userFilter: z.enum(["all", "user", "opponents"]).optional(),
        // Whether to include basic actions (move, wait, etc.) in results
        showBasicActions: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? 30;
      const filter = input.userFilter ?? "all";
      const showBasicActions = input.showBasicActions ?? true;

      // Basic action IDs to filter out when showBasicActions is false
      const basicActionIds = [...AdjustableBasicActions, "flee", "wait"];

      // Build where conditions
      const conditions = [eq(battleAction.battleId, input.battleId)];
      if (filter === "user") {
        conditions.push(eq(battleAction.userId, ctx.userId));
      } else if (filter === "opponents") {
        conditions.push(ne(battleAction.userId, ctx.userId));
      }
      if (!showBasicActions) {
        conditions.push(notInArray(battleAction.actionId, basicActionIds));
      }

      const entries = await ctx.drizzle.query.battleAction.findMany({
        limit: limit,
        offset: input.offset ?? 0,
        where: and(...conditions),
        // Sort by round desc, then version desc for consistent ordering within rounds
        orderBy: [desc(battleAction.battleRound), desc(battleAction.battleVersion)],
      });
      return entries;
    }),
  getGraph: protectedProcedure
    .meta({ mcp: { description: "Get battle history graph data" } })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const attacker = alias(userData, "attacker");
      const defender = alias(userData, "defender");
      const isDirectFight = or(
        eq(battleHistory.attackedId, input.userId),
        eq(battleHistory.defenderId, input.userId),
      );
      // Every direct opponent can expose a top second-hop edge, even when their
      // own edge is below the display limit. Fetch the complete set as IDs only.
      const neighbors = await ctx.drizzle
        .selectDistinct({
          userId: sql<string>`case when ${battleHistory.attackedId} = ${input.userId}
            then ${battleHistory.defenderId} else ${battleHistory.attackedId} end`,
        })
        .from(battleHistory)
        .innerJoin(attacker, eq(battleHistory.attackedId, attacker.userId))
        .innerJoin(defender, eq(battleHistory.defenderId, defender.userId))
        .where(and(eq(battleHistory.battleType, "COMBAT"), isDirectFight));
      if (neighbors.length === 0) return [];
      // Constant ID ranges let MySQL use the participant indexes rather than
      // scanning unrelated history for membership in a subquery.
      const userIds = [
        ...new Set([input.userId, ...neighbors.map((row) => row.userId)]),
      ];
      return await ctx.drizzle
        .select({
          attackerId: battleHistory.attackedId,
          defenderId: battleHistory.defenderId,
          attackerUsername: attacker.username,
          defenderUsername: defender.username,
          attackerAvatar: attacker.avatar,
          defenderAvatar: defender.avatar,
          total: count(),
        })
        .from(battleHistory)
        .innerJoin(attacker, eq(battleHistory.attackedId, attacker.userId))
        .innerJoin(defender, eq(battleHistory.defenderId, defender.userId))
        .where(
          and(
            eq(battleHistory.battleType, "COMBAT"),
            or(
              inArray(battleHistory.attackedId, userIds),
              inArray(battleHistory.defenderId, userIds),
            ),
          ),
        )
        .groupBy(battleHistory.attackedId, battleHistory.defenderId)
        .orderBy(
          desc(count()),
          // Prefer direct fights when counts tie, then use stable endpoint ordering.
          desc(sql`case when ${isDirectFight} then 1 else 0 end`),
          battleHistory.attackedId,
          battleHistory.defenderId,
        )
        .limit(100);
    }),
  getBattleHistoryEntry: protectedProcedure
    .meta({ mcp: { description: "Get specific battle history entry" } })
    .input(z.object({ battleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.drizzle.query.battleHistory.findFirst({
        where: eq(battleHistory.battleId, input.battleId),
        with: {
          attacker: {
            columns: {
              username: true,
              userId: true,
              avatar: true,
              level: true,
              rank: true,
              isOutlaw: true,
              role: true,
              federalStatus: true,
            },
          },
          defender: {
            columns: {
              username: true,
              userId: true,
              avatar: true,
              level: true,
              rank: true,
              isOutlaw: true,
              role: true,
              federalStatus: true,
            },
          },
        },
      });
      return result ?? null;
    }),
  getBattleHistory: protectedProcedure
    .meta({ mcp: { description: "Get user battle history" } })
    .input(
      z.object({
        userId: z.string().optional(),
        secondsBack: z.number().nonnegative().optional(),
        combatTypes: z.array(z.enum(BattleTypes)).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z
          .object({ createdAt: z.date(), id: z.number().int().positive() })
          .nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = input.userId || ctx.userId;
      const results = await ctx.drizzle.query.battleHistory.findMany({
        where: and(
          or(
            eq(battleHistory.attackedId, userId),
            eq(battleHistory.defenderId, userId),
          ),
          input.secondsBack !== undefined
            ? gt(battleHistory.createdAt, secondsFromNow(-input.secondsBack))
            : undefined,
          input.cursor
            ? or(
                lt(battleHistory.createdAt, input.cursor.createdAt),
                and(
                  eq(battleHistory.createdAt, input.cursor.createdAt),
                  lt(battleHistory.id, input.cursor.id),
                ),
              )
            : undefined,
          ...(input.combatTypes
            ? [inArray(battleHistory.battleType, input.combatTypes)]
            : []),
        ),
        with: {
          attacker: { columns: { username: true, userId: true, avatar: true } },
          defender: { columns: { username: true, userId: true, avatar: true } },
        },
        orderBy: [desc(battleHistory.createdAt), desc(battleHistory.id)],
        limit: input.limit + 1,
      });
      const hasMore = results.length > input.limit;
      const data = results.slice(0, input.limit);
      const last = data.at(-1);
      return {
        data,
        nextCursor:
          hasMore && last ? { createdAt: last.createdAt, id: last.id } : undefined,
      };
    }),

  performAction: protectedProcedure
    .meta({ mcp: { description: "Perform action in battle" } })
    .use(ratelimitMiddleware)
    .input(performActionSchema)
    .mutation(async ({ ctx, input }) => {
      Sentry.profiler.startProfiler();
      if (debug) console.log("============ Performing action ============");

      // Short-form
      const suid = ctx.userId;
      const db = ctx.drizzle;
      const actionRounds: number[] = [];

      // OUTER LOOP: Attempt to perform action untill success || error thrown
      // The primary purpose here is that if the battle version was already updated, we retry the user's action
      while (true) {
        // Fetch battle from database
        const battle = await fetchBattle(db, input.battleId);
        if (!battle) return { updateClient: true };

        advanceEncounterWave(battle, !!dungeonBattleOutcome(battle));
        // Create the grid for the battle
        const grid = getBattleGrid(1, battle);

        // For kage battles, only allow one move per action. Same whenever any
        // still-fighting human is on auto combat — they are watching, so every
        // driving client (not just their own) must deliver one animated action
        // per poll instead of a whole exchange. Dead/fled/left players no
        // longer watch a live fight, so they stop capping the batch.
        const anyHumanOnAutoCombat = battle.usersState.some(
          (u) =>
            !u.isAi &&
            !u.isSummon &&
            u.isAutoCombat &&
            !u.leftBattle &&
            stillInBattle(u, battle.usersEffects),
        );
        const maxActions =
          AutoBattleTypes.includes(battle.battleType) || anyHumanOnAutoCombat ? 1 : 5;

        // Instantiate new state variables
        const history: {
          battleRound: number;
          appliedEffects: ActionEffect[];
          description: string;
          battleVersion: number;
          actionId?: string;
          userId?: string;
        }[] = [];

        // Actionless updates mutate the fetched object in place; retain its version for CAS.
        const fetchedVersion = battle.version;
        const originalRound = battle.round;
        const originalActiveUserId = battle.activeUserId;

        // Battle state to update during inner loop
        let newBattle: CompleteBattle = battle;
        let actionPerformed = false;
        let nActions = 0;

        // INNER LOOP: Keep updating battle state until all actions have been performed
        while (true) {
          // Update the battle to the correct activeUserId & round. Default to current user
          const {
            actor,
            actionRound,
            progressRound: progressedRoundBeforeAction,
            expiredEffects: expiredBeforeAction,
          } = alignBattle(newBattle, actionRounds, suid);
          if (progressedRoundBeforeAction) {
            applySageModeAfterRoundTransition(newBattle);
          }
          if (debug) {
            console.log(
              `============ 1. Actor: ${actor.username} - ${actor.userId} ============`,
            );
          }

          // Record all rounds for this endpoint call¨
          if (!actionRounds.includes(actionRound)) {
            actionRounds.push(actionRound);
          }

          // Only allow action if it is the users turn (a piloted summon is human-driven)
          const control = getTurnControl(actor, suid);
          const isUserTurn =
            !battle.extraState.tournamentAiOnly &&
            !battle.extraState.kageMatch?.ai &&
            control.isUserTurn;
          const isAITurn =
            !!battle.extraState.tournamentAiOnly ||
            !!battle.extraState.kageMatch?.ai ||
            control.isAITurn;
          if (!isUserTurn && !isAITurn) {
            return { notification: `Not your turn. Wait for ${actor.username}` };
          }

          // If userId, actionID, and position specified, perform user action
          const battleDescriptions: string[] = [];
          const actionEffects: ActionEffect[] = [...expiredBeforeAction];
          let performedActionId: string | undefined;
          let performedByUserId: string | undefined;
          if (
            !isAITurn &&
            isUserTurn &&
            input.longitude !== undefined &&
            input.latitude !== undefined &&
            input.actionId
          ) {
            /* PERFORM USER ACTION */
            // Build the action list for the acting entity: on a piloted-summon turn
            // that is the summon's own jutsu set; on the player's own turn actor.userId
            // equals suid, so behaviour is unchanged.
            const actions = availableUserActions(newBattle, actor.userId, true, true);
            const action = actions.find((a) => a.id === input.actionId);
            if (!action)
              return { notification: `Action not valid anymore. Try something else` };
            performedActionId = action.id;
            performedByUserId = actor.userId;
            if (AutoBattleTypes.includes(battle.battleType)) {
              throw serverError("FORBIDDEN", `Cheater`);
            }
            // Refuse a capped summon BEFORE performBattleAction, which spends
            // chakra/stamina/AP inside insertAction, so a blocked cast is free.
            const summonBlocked = summonActionBlockedReason(
              action,
              actor,
              newBattle.usersState,
              newBattle.usersEffects,
            );
            if (summonBlocked) {
              return { updateClient: false, notification: summonBlocked };
            }
            try {
              const newState = performBattleAction({
                battle: newBattle,
                action,
                grid,
                contextUserId: suid,
                actorId: actor.userId,
                longitude: input.longitude,
                latitude: input.latitude,
              });
              newBattle = newState.newBattle;
              actionPerformed = true;
              actionEffects.push(...newState.actionEffects);
              battleDescriptions.push(action.battleDescription);
            } catch (error) {
              let notification = "Unknown Error";
              if (error instanceof Error) notification = error.message;
              return { updateClient: false, notification };
            }
          } else if (isAITurn) {
            /* PERFORM AI ACTION */
            try {
              const aiState = performAIaction(newBattle, grid, actor.userId);
              newBattle = aiState.nextBattle;
              actionPerformed = true;
              actionEffects.push(...aiState.nextActionEffects);
              battleDescriptions.push(...aiState.aiDescriptions);
              performedActionId = aiState.nextActionId ?? performedActionId;
              performedByUserId = actor.userId;
              // console.log("STATE SPACE: ", aiState.searchSize);
            } catch (error) {
              let notification = "Unknown Error";
              if (error instanceof Error) notification = error.message;
              return { updateClient: false, notification };
            }
          }

          if (
            performedActionId &&
            newBattle.extraState.dungeon &&
            !actor.isAi &&
            !actor.isSummon
          )
            newBattle.extraState.dungeon.lastActionRound[actor.userId] = actionRound;
          // If no description, means no actions, just return now
          let description = battleDescriptions.join(". ");
          if (!description && actionPerformed && history.length === 0) {
            return { updateClient: false, notification: "No battle description" };
          }

          // Check if everybody finished their action, and if so, fast-forward the battle
          // (alignBattle removes masterless summons before it picks the next actor)
          const {
            actor: newActor,
            progressRound,
            orphanedSummons,
            expiredEffects,
          } = alignBattle(newBattle, actionRounds, suid);
          if (progressRound) {
            applySageModeAfterRoundTransition(newBattle);
          }
          actionEffects.push(...expiredEffects);
          // Tell players why a summon left the field, rather than having it
          // silently disappear once its summoner is dead/fled/gone.
          orphanedSummons.forEach((username) => {
            actionEffects.push({
              txt: `${username} vanishes without its summoner!`,
              color: "red",
            });
          });
          if (actionPerformed && progressRound) {
            const dot = description.endsWith(".");
            description += `${dot ? "" : ". "} It is now ${newActor.username}'s turn.`;
          }

          // Round expiry can change the battlefield without an action description.
          if (description || actionEffects.length) {
            history.push({
              battleRound: actionRound,
              appliedEffects: actionEffects,
              description: description || "Battlefield effects expire.",
              battleVersion: newBattle.version + nActions,
              actionId: performedActionId ?? "unknown",
              userId: performedByUserId ?? actor.userId,
            });
            nActions += 1;
          }

          advanceEncounterWave(newBattle, !!dungeonBattleOutcome(newBattle));
          // Calculate if the battle is over for this user, and if so update user DB
          const result = calcBattleResult(
            newBattle,
            suid,
            newBattle.extraState.settings,
          );

          // Check if we should let the inner-loop continue. Reuse getTurnControl
          // so "who acts autonomously" stays defined in exactly one place -- a
          // piloted summon is never auto-driven here for the same reason it is
          // not authorized as an AI turn at the top of the block.
          const { isAITurn: newIsAITurn } = getTurnControl(newActor, suid);
          if (
            newIsAITurn && // Continue new loop if the next actor acts autonomously
            nActions < maxActions && // and we haven't performed 5 actions yet
            !result && // and the battle is not over for the user
            (newActor.userId !== actor.userId || description) // and new actor, or successful attack
          ) {
            continue;
          }

          // If battle state didn't change, just return without updating battle
          // version. A battle that is already decided is the exception: it has
          // to be settled below even when nobody could act, or a player whose
          // last opponent is already dead keeps polling a fight that can never
          // end.
          if (
            !result &&
            !actionPerformed &&
            newBattle.round === originalRound &&
            newBattle.activeUserId === originalActiveUserId
          ) {
            return { notification: `Battle state was not changed` };
          }

          // Only keep visual tags that are newer than original round
          newBattle.groundEffects = newBattle.groundEffects.filter(
            (e) => e.type !== "visual" || e.createdRound >= originalRound,
          );

          /**
           * Claim the battle version before the parallel mutation phase
           */
          try {
            newBattle.version = newBattle.version + nActions;
            // updateBattle returns the authoritative battleOver — it covers raid
            // boss defeats where surviving teammates exist as friends, which the
            // simple friendsLeft + targetsLeft check would miss.
            const claim = await updateBattle(
              db,
              result,
              suid,
              newBattle,
              fetchedVersion,
              pusher,
            );
            if (!claim) return { updateClient: true };
            const { battleOver, finishBattle } = claim;
            const [logEntries, { updatedQuestIds }] = await Promise.all([
              createAction(db, newBattle, history),
              updateUser(db, pusher, newBattle, result, suid),
              ...(!newBattle.extraState.dungeon && !newBattle.extraState.hunting
                ? [
                    saveUsage(db, newBattle, result, suid),
                    updateKage(db, newBattle, result),
                    updateClanLeaders(db, newBattle, result, suid),
                    updateVillageAnbuClan(db, newBattle, result, suid),
                    updateWars(db, pusher, newBattle, result, suid),
                    // Terminal event outcomes were committed with the battle version claim.
                    ...(battleOver && newBattle.extraState.tournamentGameId
                      ? []
                      : [updateTournament(db, newBattle, result, suid)]),
                    result
                      ? updateRaidProgress(db, newBattle, suid)
                      : Promise.resolve(),
                  ]
                : []),
              finishBattle(),
            ]);
            const newMaskedBattle = maskBattle(newBattle, suid);

            // Notify after logs are persisted, including the terminal action.
            // Polling clients may have read the claimed state before its log insert.
            const nUsers = battle.usersState.filter((u) => !u.isAi).length;
            if (nUsers > 1) {
              notifyBattleLogs(pusher, newBattle, logEntries, !!result);
            }

            // Stop profiling. Flush after the response so the client is not
            // blocked; after() keeps the Vercel lambda alive via waitUntil.
            Sentry.profiler.stopProfiler();
            after(() => Sentry.flush(15000));

            // Return the new battle + result state if applicable
            return {
              result: result,
              updateClient: true,
              logEntries: logEntries,
              battleUpdate: newMaskedBattle,
              updatedQuestIds: updatedQuestIds,
            };
          } catch (e) {
            console.error("Error updating battle state:", e);
            return {
              notification: "Unable to update battle. Please try again.",
              updateClient: true,
            };
          }
        }
      }
    }),
  battleArenaHeal: protectedProcedure
    .meta({ mcp: { description: "Heal in battle arena for ryo" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.money < BATTLE_ARENA_HEAL_COST)
        return errorResponse("You don't have enough money");
      if (user.isBanned) return errorResponse("You are banned");
      if (user.status !== "AWAKE")
        return errorResponse("You must be awake to heal in the Battle Arena");
      // Mutate with guard
      const result = await ctx.drizzle
        .update(userData)
        .set({
          money: sql`${userData.money} - ${BATTLE_ARENA_HEAL_COST}`,
          curHealth: user.maxHealth,
          curStamina: user.maxStamina,
          curChakra: user.maxChakra,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            eq(userData.status, "AWAKE"),
            gte(userData.money, BATTLE_ARENA_HEAL_COST),
          ),
        );
      if (result.rowsAffected === 0) {
        return errorResponse("Error trying to heal and continue. Try again.");
      } else {
        return { success: true, message: "You've healed" };
      }
    }),
  startArenaBattle: protectedProcedure
    .meta({
      mcp: { description: "Start battle arena fight against AI" },
    })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        aiId: z.string(),
        stats: statSchema.nullish(),
        autoCombat: z.boolean().nullish(),
      }),
    )
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Get information
      const [{ user }, selectedAI] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          includeNotifications: false,
        }),
        ctx.drizzle.query.userData.findFirst({
          where: and(
            eq(userData.userId, input.aiId),
            eq(userData.isAi, true),
            eq(userData.isSummon, false),
            eq(userData.inArena, true),
          ),
        }),
      ]);
      // Check that user was found
      if (!user) return errorResponse("Attacking user not found");
      // Read the arena location after progression has settled the player's membership.
      const sectorVillage = await fetchSectorVillage(ctx.drizzle, user.sector);
      if (!sectorVillage) return errorResponse("Arena village not found");
      if (user.isBanned) return errorResponse("No arena while banned");
      if (!input.stats && user.dailyArenaFights >= BATTLE_ARENA_DAILY_LIMIT) {
        return errorResponse("Daily arena limit reached");
      }
      if (!(user.isOutlaw || canAccessStructure(user, "/battlearena", sectorVillage))) {
        return errorResponse("Must be in your allied village to go to arena");
      }
      // Determine battle background
      if (selectedAI) {
        return await initiateBattle(
          {
            sector: user.sector,
            userIds: [user.userId],
            targetIds: [selectedAI.userId],
            client: ctx.drizzle,
            targetStatDistribution: input.stats ?? undefined,
            biome: "default",
            // Callers that do not state a preference (e.g. MCP) fall back to
            // the player's stored default rather than silently to manual.
            autoCombatUserIds:
              (input.autoCombat ?? user.defaultAutoCombat) ? [user.userId] : undefined,
          },
          input.stats ? "TRAINING" : "ARENA",
        );
      } else {
        return { success: false, message: "No AI found" };
      }
    }),
  attackUser: protectedProcedure
    .meta({
      mcp: { description: "Attack another user to initiate combat" },
    })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        // Coordinate bounds are enforced here (zod), so no sector-map read is
        // needed to validate reachability: the target is another player, who can
        // only ever stand on a walkable, in-bounds tile.
        longitude: z
          .int()
          .min(0)
          .max(SECTOR_WIDTH - 1),
        latitude: z
          .int()
          .min(0)
          .max(SECTOR_HEIGHT - 1),
        sector: sectorIdSchema,
        userId: z.string(),
        asset: z.enum(COMBAT_BIOMES).optional(),
      }),
    )
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      return await initiateBattle(
        {
          longitude: input.longitude,
          latitude: input.latitude,
          sector: input.sector,
          userIds: [ctx.userId],
          targetIds: [input.userId],
          client: ctx.drizzle,
          biome: input.asset || "default",
        },
        "COMBAT",
      );
    }),
  updateCombatLoadout: protectedProcedure
    .meta({
      mcp: { description: "Update jutsu/item loadout in combat lobby" },
    })
    .input(
      z.object({
        battleId: z.string(),
        jutsuLoadoutId: z.string().optional(),
        itemLoadoutId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Queries
      const jId = input.jutsuLoadoutId;
      const iId = input.itemLoadoutId;
      const [
        data,
        userBattle,
        jutsuLoadouts,
        itemLoadouts,
        useritems,
        userjutsus,
        userSkills,
      ] = await Promise.all([
        fetchBattleEssentials(ctx.drizzle),
        fetchBattle(ctx.drizzle, input.battleId),
        fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
        fetchUserItemsWithVariants(ctx.drizzle, ctx.userId),
        fetchUserJutsus(ctx.drizzle, ctx.userId, undefined, { applyReskins: false }),
        fetchUserSkills(ctx.drizzle, ctx.userId),
      ]);

      // Derived
      const user = userBattle?.usersState.find((u) => u.userId === ctx.userId);

      // Guard
      if (!userBattle) return errorResponse("You are not in a battle");
      if (!user) return errorResponse("You are not in this battle");
      if (userBattle.extraState.tournamentAiOnly || userBattle.extraState.kageMatch?.ai)
        return errorResponse("AI match loadouts are frozen for this battle");
      if (user.iAmHere) return errorResponse("You are already marked as ready");
      if (userBattle.battleType !== "COMBAT" && userBattle.battleType !== "SPARRING") {
        return errorResponse("You can only update loadouts in the combat lobby");
      }
      if (new Date() > userBattle.roundStartAt) {
        return errorResponse("You can only update loadouts in the combat lobby");
      }
      if (!jId && !iId) {
        return errorResponse("No loadout IDs provided");
      }
      if (jId === user.jutsuLoadout && iId === user.itemLoadout) {
        return errorResponse("You already have this loadout selected");
      }

      // The battle copy carries this battle's mastery tags; gates start from stored values
      resetMasteriesToBase(user);
      // Rebuild title bonuses from this encounter's sources, independent of later rewards.
      const titles =
        userBattle.extraState.profileCacheSnapshots?.[user.controllerId]?.masterySources
          .titles;
      const bloodline = user.bloodlineId
        ? userBattle.extraState.bloodlines?.[user.bloodlineId]
        : null;
      const activatedSkills = userSkills.filter((us) => us.activated);
      // Skills may have been reset since battle initiation; loadout gates use the current build.
      user.activeSkillIds = activatedSkills.map((skill) => skill.skillId);
      const itemChanged = !!iId && user.itemLoadout !== iId;
      const jutsuChanged = !!jId && user.jutsuLoadout !== jId;
      // Validate both requested IDs before persisting either loadout.
      if (itemChanged && iId) {
        const selectable = resolveSelectableLoadout(
          itemLoadouts,
          iId,
          fedItemLoadouts(user),
        );
        if (!selectable.ok) return errorResponse(selectable.message);
      }
      if (jutsuChanged && jId) {
        const selectable = resolveSelectableLoadout(
          jutsuLoadouts,
          jId,
          fedJutsuLoadouts(user),
        );
        if (!selectable.ok) return errorResponse(selectable.message);
      }

      // Apply the item loadout first, then the jutsu loadout. selectItemLoadout mutates
      // `useritems` in place to the post-switch equipped state, and selectJutsuLoadout
      // validates each gated jutsu's required bloodline item against that same array.
      // Running them in parallel would validate jutsus against the pre-switch items,
      // re-equipping a gated jutsu after its required item is dropped, or wrongly
      // rejecting one the new item loadout has just equipped.
      const itemLoadoutResult =
        user.itemLoadout === iId || !iId
          ? { success: true, message: "Item loadout already selected" }
          : await selectItemLoadout(ctx.drizzle, iId, itemLoadouts, useritems, {
              ...user,
              bloodline,
              userSkills: activatedSkills,
              titles,
            });
      if (!itemLoadoutResult.success) return errorResponse(itemLoadoutResult.message);
      const gateMasteries = effectiveMasteries({
        ...user,
        bloodline,
        userSkills: activatedSkills,
        items: useritems,
        titles,
      });
      const village = user.villageId
        ? userBattle.extraState.villages?.[user.villageId]
        : null;
      const questData = userBattle.extraState.questData?.[user.controllerId];
      const aiProfile =
        user.aiProfileId && user.aiProfileId !== "Default"
          ? userBattle.extraState.aiProfiles?.[user.aiProfileId]
          : userBattle.extraState.aiProfiles?.Default;
      // The combatant as battle initiation sees it after the item switch.
      const gateUser = {
        ...user,
        bloodline: bloodline ?? null,
        village: village ?? null,
        userSkills: activatedSkills,
        items: useritems,
        aiProfile: aiProfile ?? null,
        questData: questData ?? [],
        titles,
      };
      // Skip jutsu combat would strip, plus hidden jutsu as the Jutsu page does, so
      // they neither fill equip slots nor persist as equipped.
      const validateLobbyJutsu = (jutsu: Jutsu) => {
        if (jutsu.hidden && !canChangeContent(user.role))
          return `${jutsu.name} is hidden`;
        return battleJutsuGateFailure(
          jutsu,
          gateUser,
          userBattle.battleType,
          gateMasteries,
        );
      };
      // Reapply the active jutsu loadout after changing items so newly satisfied
      // equipment or mastery requirements restore jutsu skipped by an earlier selection.
      const jutsuLoadoutIdToApply = jutsuChanged
        ? jId
        : itemChanged
          ? user.jutsuLoadout
          : undefined;
      const jutsuLoadoutResult = jutsuLoadoutIdToApply
        ? await selectJutsuLoadout(
            ctx.drizzle,
            jutsuLoadoutIdToApply,
            jutsuLoadouts,
            userjutsus,
            user,
            (jutsuIds) =>
              computeJutsuLoadoutCapAssignments({
                jutsuIds,
                userjutsus,
                maxEquip: calcJutsuEquipLimit(user),
                validateJutsu: ({ jutsu }) => validateLobbyJutsu(jutsu),
              }),
          )
        : { success: true, message: "Jutsu loadout already selected" };
      if (!jutsuLoadoutResult.success && jutsuChanged) {
        return errorResponse(jutsuLoadoutResult.message);
      }

      // An item-only switch can remove a required bloodline item or a mastery buff.
      // Revalidate stored equips too: battle filtering alone leaves invalid equips
      // consuming slots on the jutsu page after the fight.
      let invalidatedJutsuIds: string[] = [];
      if (
        itemChanged &&
        !("jutsus" in jutsuLoadoutResult) &&
        "items" in itemLoadoutResult
      ) {
        invalidatedJutsuIds = userjutsus
          .filter((owned) => owned.equipped && !!validateLobbyJutsu(owned.jutsu))
          .map((owned) => owned.jutsuId);
        if (invalidatedJutsuIds.length > 0) {
          await ctx.drizzle
            .update(userJutsu)
            .set({ equipped: false })
            .where(
              and(
                eq(userJutsu.userId, ctx.userId),
                inArray(userJutsu.jutsuId, invalidatedJutsuIds),
              ),
            );
        }
      }

      // Mutate
      userBattle.updatedAt = new Date();
      userBattle.version = userBattle.version + 1;

      // Build a user with updated loadout data for processing
      // We need to construct this from scratch with fresh data since user is BattleUserState
      const newJutsus =
        "jutsus" in jutsuLoadoutResult && jutsuLoadoutResult.jutsus
          ? jutsuLoadoutResult.jutsus.map((uj) => ({
              ...uj,
              lastUsedRound: -uj.jutsu.cooldown,
              originalCooldown: uj.jutsu.cooldown,
              origin: "user" as const,
            }))
          : undefined;

      const newItems =
        iId && "items" in itemLoadoutResult && itemLoadoutResult.items
          ? itemLoadoutResult.items.map((ui) => {
              return {
                ...ui,
                lastUsedRound: -ui.item.cooldown,
                originalCooldown: ui.item.cooldown,
              };
            })
          : undefined;

      // Split out user from current usersState & usersEffects
      const otherUserState = userBattle.usersState.filter(
        (u) => u.controllerId !== ctx.userId,
      );
      const preservedEffects = userBattle.usersEffects.filter(
        (e) =>
          e.creatorId === ctx.userId &&
          (e.fromType === "sageMode" ||
            e.fromType === "sageModeAfter" ||
            (e.timedBuffExpiresAt ?? 0) > Date.now()),
      );
      const otherUserEffects = userBattle.usersEffects.filter(
        (e) => e.creatorId !== ctx.userId,
      );

      // Reprocessing equipment must not regenerate pools or change turn order.
      // Direction determines friendly fire in RAID battles.
      const originalInitiative = user.initiative;
      const originalDirection = user.direction;
      const originalPools = {
        curHealth: user.curHealth,
        curChakra: user.curChakra,
        curStamina: user.curStamina,
      };

      // Hydrate jutsus and items from extraState if not using new loadouts
      // We reconstruct CombatQueryUser format from BattleUserState refs + extraState
      const now = new Date();
      const hydratedJutsus =
        newJutsus ??
        user.jutsus
          .filter((ref) => !invalidatedJutsuIds.includes(ref.jutsuId))
          .map((ref) => {
            const jutsu = userBattle.extraState.jutsus?.[ref.jutsuId];
            if (!jutsu) return null;
            // Add missing UserJutsu fields needed for CombatQueryUserJutsu
            return {
              ...ref,
              reskinId: ref.reskinId ?? null, // Ensure non-undefined
              jutsu,
              activeReskin: ref.reskinId
                ? (userBattle.extraState.jutsuReskins?.[ref.reskinId] ?? null)
                : null,
              userId: user.controllerId,
              createdAt: now,
              updatedAt: now,
              finishTraining: null,
            };
          })
          .filter((j): j is NonNullable<typeof j> => j !== null);

      const hydratedItems =
        newItems ??
        user.items
          .map((ref) => {
            const item = userBattle.extraState.items?.[ref.itemId];
            if (!item) return null;
            // Add missing UserItem fields needed for CombatQueryUserItem
            return {
              ...ref,
              item,
              imbuements: [],
              imbuementEffects: ref.imbuementEffects ?? [],
              userId: user.controllerId,
              createdAt: now,
              updatedAt: now,
              storedAtHome: false,
              homeX: null,
              homeY: null,
              homeRotation: 0,
              homeRoom: "main" as const,
              isInAuction: false,
              activeVariantId: ref.activeVariantId ?? null,
              variantBattleDescription: ref.variantBattleDescription ?? null,
              variantImage: ref.variantImage ?? null,
              variantName: ref.variantName ?? null,
              craftingFinishedAt: null,
            };
          })
          .filter((i): i is NonNullable<typeof i> => i !== null);

      // Build raw user for processing - hydrate from existing battle staticData and merge new data
      // We need to add back the village, bloodline, and aiProfile from extraState since CombatQueryUser requires them
      const equippedSageMode = user.sageModeId
        ? userBattle.extraState.sageModes?.[user.sageModeId]
        : null;
      // Build rawUserForProcessing from BattleUserState + extraState data
      // The jutsus/items are reconstructed from refs + static data with all required fields
      const rawUserForProcessing = {
        ...user,
        bloodline: bloodline ?? null,
        sageMode: equippedSageMode ?? null,
        jutsuLoadout: jId ?? user.jutsuLoadout,
        itemLoadout: iId ?? user.itemLoadout,
        jutsus: hydratedJutsus,
        items: hydratedItems,
        userSkills: activatedSkills,
        village: village ?? null,
        aiProfile: aiProfile ?? null,
        questData: questData ?? [],
        titles,
      };

      // Process only the single user
      const processed = await processUsersForBattle(ctx.drizzle, {
        users: [rawUserForProcessing],
        settings: data.settings,
        relations: data.relations,
        // Loadout changes retain the allegiance and contribution roles captured at initiation.
        wars: Object.values(userBattle.extraState.wars),
        villages: data.villages,
        defaultProfile: data.defaultProfile,
        battleType: userBattle.battleType,
        width: userBattle.width,
        height: userBattle.height,
        hide: false,
        isSummon: false,
      }).catch(handleSummonPreloadError);
      if (processed instanceof Error) return errorResponse(processed.message);
      const { userEffects, usersState, extraState } = processed;

      const completeUserEffects = [
        ...otherUserEffects,
        ...preservedEffects,
        ...userEffects,
      ];

      // Restore pools against the full effect list, including retained incoming effects.
      if (usersState[0]) {
        reconcileLobbyPools(usersState[0], originalPools, completeUserEffects);
        usersState[0].initiative = originalInitiative;
        usersState[0].direction = originalDirection;
        // Keep initiating-team reward eligibility across loadout reconstruction.
        usersState[0].isAggressor = user.isAggressor;
      }

      // Merge the user's state with the other user's state. Reprocessing also loads
      // the summon templates the new loadout needs; keep only those the battle does
      // not hold yet (templates are keyed by controllerId = their source AI id).
      const newParticipants = mergeLoadoutParticipants(otherUserState, usersState);
      userBattle.usersState = [...otherUserState, ...newParticipants];
      userBattle.usersEffects = completeUserEffects;
      refreshMasteries(userBattle.usersState, userBattle.usersEffects);

      // Merge every static lookup map the reprocessing produced (jutsus, items,
      // and the aiProfiles/bloodlines of newly loaded summon templates) so new
      // actions and summons resolve during battle.
      userBattle.extraState = userBattle.extraState || {};
      userBattle.extraState.preBattleGearModifiers =
        userBattle.extraState.preBattleGearModifiers || {};
      mergeExtraState(userBattle.extraState, extraState);
      const updatedBattleUserId = usersState[0]?.userId;
      if (updatedBattleUserId) {
        userBattle.extraState.preBattleGearModifiers[updatedBattleUserId] =
          extraState.preBattleGearModifiers?.[updatedBattleUserId] ??
          emptyPreBattleGearModifiers();
      }

      for (const participant of newParticipants) {
        participant.skillLockedJutsuIds =
          participant.activeSkillIds === undefined
            ? []
            : Object.values(userBattle.extraState.jutsus)
                .filter((jutsu) => !hasRequiredSkill(jutsu, participant))
                .map((jutsu) => jutsu.id);
      }

      // Mutate
      const result = await ctx.drizzle
        .update(battle)
        .set({
          usersState: userBattle.usersState,
          usersEffects: userBattle.usersEffects,
          extraState: userBattle.extraState,
          version: userBattle.version,
          createdAt: userBattle.createdAt,
          updatedAt: userBattle.updatedAt,
          roundStartAt: userBattle.roundStartAt,
        })
        .where(
          and(
            eq(battle.id, input.battleId),
            eq(battle.version, userBattle.version - 1),
          ),
        );

      if (result.rowsAffected > 0) {
        void pusher.trigger(userBattle.id, "event", {
          version: userBattle.version + 1,
        });
        return {
          success: true,
          message: [
            ...[itemLoadoutResult, jutsuLoadoutResult]
              .filter((loadout) => loadout.message.includes("Warnings:"))
              .map((loadout) => loadout.message),
            ...(invalidatedJutsuIds.length > 0
              ? ["Jutsu with unmet loadout requirements were unequipped"]
              : []),
          ].join(". "),
          battle: maskBattle(userBattle, ctx.userId),
        };
      } else {
        return { success: false, message: "Battle state could not be updated" };
      }
    }),
  iAmHere: protectedProcedure
    .meta({ mcp: { description: "Mark ready in combat lobby" } })
    .input(z.object({ battleId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Maximum number of retry attempts
      const MAX_RETRIES = 3;
      let attempts = 0;

      // Retry loop
      while (attempts < MAX_RETRIES) {
        attempts++;

        // Fetch
        const userBattle = await fetchBattle(ctx.drizzle, input.battleId);
        const user = userBattle?.usersState.find((u) => u.userId === ctx.userId);

        // Guard
        if (!userBattle) return { success: false, message: "You are not in a battle" };
        if (!user) return { success: false, message: "You are not in this battle" };
        if (new Date() > userBattle.roundStartAt) return { success: true, message: "" };

        // Check if user is already marked as here
        if (user.iAmHere)
          return {
            success: true,
            message: "",
            battle: maskBattle(userBattle, ctx.userId),
          };

        // Pre-Mutate
        user.iAmHere = true;
        userBattle.updatedAt = new Date();
        userBattle.version = userBattle.version + 1;
        const allHere = userBattle.usersState.every((u) => u.iAmHere);

        if (allHere) {
          userBattle.createdAt = new Date();
          userBattle.roundStartAt = new Date();
        }

        // Mutate
        const result = await ctx.drizzle
          .update(battle)
          .set({
            usersState: userBattle.usersState,
            version: userBattle.version,
            createdAt: userBattle.createdAt,
            updatedAt: userBattle.updatedAt,
            roundStartAt: userBattle.roundStartAt,
          })
          .where(
            and(
              eq(battle.id, input.battleId),
              eq(battle.version, userBattle.version - 1),
            ),
          );

        if (result.rowsAffected > 0) {
          void pusher.trigger(userBattle.id, "event", {
            version: userBattle.version + 1,
          });
          return {
            success: true,
            message: "",
            battle: maskBattle(userBattle, ctx.userId),
          };
        } else {
          // If we're on the last attempt, return failure
          if (attempts >= MAX_RETRIES) {
            return errorResponse("Someone else updated the battle state");
          }

          // Check if the battle version has actually changed
          const currentBattle = await fetchBattle(ctx.drizzle, input.battleId);
          if (!currentBattle || currentBattle.version === userBattle.version - 1) {
            // If the version hasn't changed or battle no longer exists, don't retry
            return { success: false, message: "Battle state could not be updated" };
          }
        }
      }
      return errorResponse("Failed to update battle state after multiple attempts");
    }),
  toggleAutoCombat: protectedProcedure
    .meta({
      mcp: {
        description: "Hand battle turns to own AI profile or take back control",
      },
    })
    .use(ratelimitMiddleware)
    .input(toggleAutoCombatSchema)
    .mutation(async ({ input, ctx }) => {
      // Maximum number of retry attempts
      const MAX_RETRIES = 3;
      let attempts = 0;

      // PvP handovers belong to this encounter; only PvE toggles update the
      // non-PvP default, after the battle change succeeds.
      const rememberPreference = async (battleType: BattleType) => {
        if (ManualStartBattleTypes.includes(battleType)) return;
        await ctx.drizzle
          .update(userData)
          .set({ defaultAutoCombat: input.enabled })
          .where(eq(userData.userId, ctx.userId));
      };

      // Retry loop
      while (attempts < MAX_RETRIES) {
        attempts++;

        // Fetch
        const userBattle = await fetchBattle(ctx.drizzle, input.battleId);
        const user = userBattle?.usersState.find((u) => u.userId === ctx.userId);

        // Scheduled defenses retain mutual consent; automatic battle types retain their AI rules.
        if (!userBattle) return errorResponse("You are not in a battle");
        if (!user) return errorResponse("You are not in this battle");
        if (user.isAi)
          return errorResponse("Only human players can toggle auto combat");
        if (userBattle.extraState.kageMatch)
          return errorResponse(
            "Scheduled title fights keep the combat mode agreed before the match",
          );
        if (
          userBattle.extraState.tournamentAiOnly ||
          AutoBattleTypes.includes(userBattle.battleType)
        ) {
          return errorResponse("This battle is always fought by your AI profile");
        }
        if (user.leftBattle || user.fledBattle || user.curHealth <= 0) {
          return errorResponse("You are no longer fighting in this battle");
        }

        // Check if user is already in the requested state. Nothing to guard
        // with a version here — the battle already reads the way the player
        // asked for, so their choice is safe to remember.
        if (!!user.isAutoCombat === input.enabled) {
          await rememberPreference(userBattle.battleType);
          return {
            success: true,
            message: "",
            battle: maskBattle(userBattle, ctx.userId),
          };
        }

        // Pre-Mutate. Piloted summons follow their master: while the master is
        // on auto combat the action panel is hidden, so a piloted summon would
        // otherwise have no driver at all and stall its turns to the timer.
        user.isAutoCombat = input.enabled;
        userBattle.usersState.forEach((u) => {
          if (u.isSummon && u.isPiloted && u.controllerId === ctx.userId) {
            u.isAutoCombat = input.enabled;
          }
        });
        userBattle.updatedAt = new Date();
        userBattle.version = userBattle.version + 1;

        // Mutate
        const result = await ctx.drizzle
          .update(battle)
          .set({
            usersState: userBattle.usersState,
            version: userBattle.version,
            updatedAt: userBattle.updatedAt,
          })
          .where(
            and(
              eq(battle.id, input.battleId),
              eq(battle.version, userBattle.version - 1),
            ),
          );

        if (result.rowsAffected > 0) {
          await rememberPreference(userBattle.battleType);
          void pusher.trigger(userBattle.id, "event", {
            version: userBattle.version + 1,
          });
          return {
            success: true,
            message: input.enabled
              ? "Your AI profile has taken over the battle"
              : "You have taken back control of the battle",
            battle: maskBattle(userBattle, ctx.userId),
          };
        }
        // Version conflict (e.g. an action resolved meanwhile) — refetch and retry
      }
      return errorResponse("Failed to update battle state after multiple attempts");
    }),
  startShrineBattle: protectedProcedure
    .meta({ mcp: { description: "Start battle at war shrine" } })
    .use(ratelimitMiddleware)
    .input(z.object({ sector: sectorIdSchema }))
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Get information (use fetchActiveWars to get village relations with sectors)
      const [{ user }, activeWars, sectorData, shrineAis, isHome] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWars(ctx.drizzle),
        ctx.drizzle.query.sector.findFirst({
          where: eq(sector.sector, input.sector),
          with: { village: true },
        }),
        ctx.drizzle.query.userData.findMany({
          where: and(eq(userData.isAi, true), eq(userData.inShrines, true)),
          columns: { userId: true },
        }),
        ctx.drizzle.query.village.findFirst({
          where: eq(village.sector, input.sector),
        }),
      ]);

      // Find the war the user is involved with
      // For SECTOR_WAR: check war.sector matches and user is attacker
      // For VILLAGE_WAR/WAR_RAID: check village sectors for attack OR defend scenarios
      const userWar = activeWars.find((w) => {
        if (w.status !== "ACTIVE") return false;
        const side = getWarSide(w, user?.villageId ?? null, user?.userId);
        const isUserOnAttackerSide = side === w.attackerVillageId;
        const isUserOnDefenderSide = side === w.defenderVillageId;

        if (w.rules) {
          return (
            !!side &&
            isObjectiveWarActive(w) &&
            areWarObjectivesRevealed(w, side) &&
            w.objectiveState?.objectives.some(
              (o) => o.sector === input.sector && o.villageId !== side && !o.destroyed,
            )
          );
        }
        if (w.type === "SECTOR_WAR") {
          // Sector wars use war.sector and only attackers can attack
          return w.sector === input.sector && isUserOnAttackerSide;
        }

        if (["VILLAGE_WAR", "WAR_RAID"].includes(w.type)) {
          const atDefenderVillage = w.defenderVillage?.sector === input.sector;
          const atAttackerVillage = w.attackerVillage?.sector === input.sector;

          // Attack scenarios: at enemy's village (reduce their shrine HP)
          const canAttack =
            (atDefenderVillage && isUserOnAttackerSide) ||
            (atAttackerVillage && isUserOnDefenderSide);

          // Defend scenarios: at own village when shrine is damaged (restore shrine HP)
          const canDefend =
            (atAttackerVillage &&
              isUserOnAttackerSide &&
              w.attackerShrineHp < w.attackerShrineMaxHp) ||
            (atDefenderVillage &&
              isUserOnDefenderSide &&
              w.defenderShrineHp < w.defenderShrineMaxHp);

          return canAttack || canDefend;
        }

        return false;
      });

      // Check if this is a Village War or Raid (allows attacking home sectors)
      const isVillageWarOrRaid =
        userWar?.type === "VILLAGE_WAR" || userWar?.type === "WAR_RAID";

      // Check that user was found
      if (!user) return errorResponse("User not found");
      if (user.isBanned) return errorResponse("Cannot attack shrine while banned");
      if (MAP_RESERVED_SECTORS.includes(input.sector) && !userWar?.rules) {
        return errorResponse("This sector is reserved and cannot be attacked");
      }
      // Home sectors can only be attacked during Village Wars or Raids
      if (isHome && !isVillageWarOrRaid) {
        return errorResponse("Cannot attack shrines in village home sectors");
      }
      if (!sectorData) return errorResponse("Sector data could not be found");
      if (user.sector !== input.sector)
        return errorResponse("Not in the correct sector");
      if (!userWar) return errorResponse("There is no active war for this sector");

      // Determine which village's shrine is being attacked
      // For Village Wars: if at defender's sector, attack defender; if at attacker's sector, attack attacker
      const shrineOwnerVillageId = userWar.rules
        ? userWar.objectiveState?.objectives.find((o) => o.sector === input.sector)
            ?.villageId
        : isVillageWarOrRaid && userWar.attackerVillage?.sector === input.sector
          ? userWar.attackerVillageId
          : userWar.defenderVillageId;

      // Determine AIs to defend the shrine
      const assignedAis = sectorData.village?.shrineSettings?.activeAiIds || [];
      const validAis = shrineAis.filter((ai) => assignedAis.includes(ai.userId));
      const targetIds =
        validAis.length > 0
          ? validAis.map((ai) => ai.userId)
          : ["MJMzOE67Cx2YP3NX8SAbh"];

      // Return battle
      return await initiateBattle(
        {
          sector: input.sector,
          userIds: [user.userId],
          targetIds: targetIds,
          forceDefenderVillageId: shrineOwnerVillageId,
          client: ctx.drizzle,
          biome: "default",
        },
        "SHRINE_WAR",
      );
    }),
  /**
   * List all ongoing battles, optionally filtered by battleType.
   * Defaults to RANKED_PVP if not specified.
   */
  listOngoingBattles: protectedProcedure
    .input(
      z.object({
        battleType: z.enum(BattleTypes).prefault("RANKED_PVP"),
        limit: z.number().min(1).max(100).prefault(20),
        offset: z.number().min(0).prefault(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const results = await ctx.drizzle.execute(
        sql`
          SELECT 
            Battle.id, Battle.battleType, Battle.createdAt, Battle.round, Battle.updatedAt,
            JSON_EXTRACT(Battle.usersState, '$[*].userId') as userIds,
            JSON_EXTRACT(Battle.usersState, '$[*].username') as usernames,
            JSON_EXTRACT(Battle.usersState, '$[*].avatar') as avatars
          FROM Battle
          LEFT JOIN UserRequest ON Battle.id = UserRequest.relatedId
            AND UserRequest.type = 'SPAR'
            AND UserRequest.status = 'ACCEPTED'
            AND UserRequest.relatedId IS NOT NULL
          WHERE Battle.battleType = ${input.battleType}
            AND (
              Battle.battleType NOT IN ('SPARRING', 'RANKED_SPARRING') OR 
              UserRequest.spectatable = true OR
              JSON_EXTRACT(Battle.extraState, '$.tournamentGameId') IS NOT NULL
            )
          ORDER BY Battle.createdAt DESC
          LIMIT ${input.limit} OFFSET ${input.offset}
        `,
      );

      // Type the raw results from drizzle execute
      interface RawBattleRow {
        id: string;
        battleType: BattleType;
        createdAt: Date;
        round: number;
        updatedAt: Date;
        userIds: string[] | null;
        usernames: string[] | null;
        avatars: string[] | null;
      }

      // Map the results to the expected format with proper type safety
      const filteredBattles = (results.rows as unknown as RawBattleRow[]).map((row) => {
        const users =
          row?.userIds?.map((userId, i) => ({
            userId: userId ?? null,
            username: row?.usernames?.[i] ?? null,
            avatar: row?.avatars?.[i] ?? null,
          })) ?? [];

        return {
          id: row.id,
          battleType: row.battleType,
          createdAt: row.createdAt,
          round: row.round,
          updatedAt: row.updatedAt,
          users,
        };
      });

      return filteredBattles;
    }),
});

/***********************************************
 * CONVENIENCE FUNCTIONS USED ON COMBAT ENDPOINTS
 ***********************************************/
/** Send only committed public log rows; oversized batches retain a small version notification. */
const notifyBattleLogs = (
  pusher: ReturnType<typeof getServerPusher>,
  battle: { id: string; version: number },
  logEntries: BattleAction[],
  finished: boolean,
) => {
  const state = { version: battle.version, ...(finished ? { finished: true } : {}) };
  const update = {
    ...state,
    logEntries: superjson.serialize(logEntries),
  };
  // Keep the Pusher-compatible event below its payload limit; never truncate a log.
  void pusher.trigger(
    battle.id,
    "event",
    logEntries.length === 0
      ? state
      : Buffer.byteLength(JSON.stringify(update)) <= 10_000
        ? update
        : { ...state, logEntries: null },
  );
};

export const fetchBattle = async (client: DrizzleClient, battleId: string) => {
  const result = await client.query.battle.findFirst({
    where: eq(battle.id, battleId),
  });
  if (!result) {
    return null;
  }
  return result as CompleteBattle;
};

/**
 * Preload combat relations and create a battle from independently cloned participants.
 * NPC allies are supported only in authored quest fights; repeated template IDs
 * create separate combatants, even when the same template appears on both teams.
 * Reject unavailable allies and teams exceeding spawn capacity before battle writes.
 * Allied copies do not increase enemy reward scaling.
 */
export const initiateBattle = async (
  info: {
    longitude?: number;
    latitude?: number;
    sector?: number;
    userIds: string[];
    targetIds: string[];
    /** NPC template IDs on the initiating team; repeated IDs request separate copies. */
    allyAiIds?: string[];
    client: DrizzleClient;
    /** Shared launch contract; each activity keeps its own progress and settlement policy. */
    coop?: CoopEncounter;
    /** Current rules, guarded session/allowance versions and rewards preloaded for settlement. */
    hunting?: HuntingBattleState;
    userStatDistribution?: AssignableUserStats;
    targetStatDistribution?: AssignableUserStats;
    scaleTarget?: boolean;
    forceLoadouts?: RankedLoadout[];
    forceDefenderVillageId?: string;
    biome?: CombatBiome;
    forceKeepPools?: boolean;
    /** Replace the initiating players' HP/CP/SP with this percentage of effective maxima. */
    givePools?: number;
    /** Full authored tags applied only to initiating human players, including the opening round. */
    startingEffects?: ZodAllTags[];
    /** Open run whose version, receipt and inventory are guarded at battle creation. */
    questAttempt?: UserQuest;
    /** Attribute battle progress to its owning objective instead of unrelated matching kills. */
    questBattleSource?: { questId: string; objectiveId: string };
    /** Camp identity and guardian snapshot used by combat's final strategic mutation phase. */
    warCamp?: import("@/drizzle/schema").WarCamp;
    territoryWar?: import("@/drizzle/schema").TerritoryWar;
    raidQuestId?: string;
    topPlayersLP?: number[];
    /** Reserved lobby/combat IDs used to reject participants after lobby deletion. */
    clanBattle?: { queueId: string; battleId: string };
    /** Human users whose turns should be driven by their own AI profile (auto combat) */
    autoCombatUserIds?: string[];
    /**
     * Start every initiating human whose stored defaultAutoCombat is on with auto
     * combat, read from the user rows initiateBattle already loads. For group
     * battles whose callers do not hold the members' settings.
     */
    autoCombatFromDefaults?: boolean;
    /** Stable event launch identity; participant claims require its WAITING recovery token. */
    tournamentGame?: { id: string; battleId: string; aiOnly: boolean };
    /** Scheduled receipt and tenure revalidated after preload; AI mode requires mutual consent. */
    kageMatch?: {
      id: string;
      villageId: string;
      kageId: string;
      tenure: string;
      battleId: string;
      ai: boolean;
      /** The viewed invitation and original appointment must still match at atomic launch. */
      instantRequest?: { id: string; scheduledAt: string };
    };
  },
  battleType: BattleType,
  scaleGains = 1,
) => {
  const { longitude, latitude, sector, userIds, targetIds, client } = info;
  const dungeonEncounter = info.coop?.kind === "dungeon" ? info.coop : undefined;
  const questEncounter = info.coop?.kind === "quest" ? info.coop : undefined;
  if (dungeonEncounter && userIds.length !== DUNGEON_PARTY_SIZE)
    return {
      success: false,
      message: `A dungeon requires ${DUNGEON_PARTY_SIZE} players`,
    };

  const allyAiIds = info.allyAiIds ?? [];
  if (allyAiIds.length > 0 && !supportsNpcAllies(battleType)) {
    return {
      success: false,
      message: "NPC allies are only supported in quest battles",
    };
  }

  // Pre-process loadouts if they exist
  const jutsusIds = [
    ...new Set(info.forceLoadouts?.flatMap((l) => l.loadout.jutsuIds) || []),
  ];
  const itemIds = [
    ...new Set([
      ...(info.forceLoadouts?.flatMap((l) => l.loadout.weaponIds) || []),
      ...(info.forceLoadouts?.flatMap((l) => l.loadout.consumableIds) || []),
    ]),
  ];

  const queryBattleUsers = () =>
    client.query.userData.findMany({
      extras: (table) => ({
        ...activityCompletionExtras(table.userId),
        territoryWarBoostWindows: territoryWarBoostWindowsSql(table).as(
          "territoryWarBoostWindows",
        ),
      }),
      with: {
        raidBuffs: true,
        titles: true,
        cookingJobs: true,
        bloodline: { with: { bloodrightTiers: true } },
        sageMode: true,
        village: {
          with: {
            structures: true,
            sectors: {
              columns: { sector: true, boostLockedUntil: true, shrineLevel: true },
            },
          },
        },
        loadout: { columns: { jutsuIds: true } },
        clan: true,
        anbuSquad: true,
        items: {
          with: {
            item: { with: { variants: true } },
            imbuements: {
              with: { item: true },
              where: (imbuements) => lt(imbuements.craftingFinishedAt, new Date()),
            },
          },
          where: (items) =>
            and(
              gt(items.quantity, 0),
              ne(items.equipped, "NONE"),
              eq(items.isInAuction, false),
              or(
                isNull(items.craftingFinishedAt),
                lt(items.craftingFinishedAt, new Date()),
              ),
            ),
          orderBy: (table, { desc }) => [desc(table.quantity)],
        },
        jutsus: {
          with: {
            jutsu: true,
            activeReskin: true,
          },
          where: (jutsus) => eq(jutsus.equipped, true),
          orderBy: (table, { desc }) => [desc(table.level)],
        },
        userSkills: {
          with: { skill: true },
          where: (userSkills) => eq(userSkills.activated, true),
        },
        userQuests: {
          where: or(
            and(isNull(questHistory.endAt), eq(questHistory.completed, 0)),
            eq(questHistory.questType, "achievement"),
          ),
          with: { quest: true },
        },
        completedQuests: completedQuestHistoryRelation,
        aiProfile: true,
        bounties: {
          columns: { id: true, status: true, amountRyo: true },
          where: eq(bounty.status, "OPEN"),
        },
        bountySignups: {
          columns: { id: true, bountyId: true },
        },
        // Queue entries come with the user, so participants without queues cost nothing.
        queue: { orderBy: (table, { asc }) => [asc(table.position)] },
      },
      where: inArray(userData.userId, [...userIds, ...allyAiIds, ...targetIds]),
    });

  // Use Promise.all to fetch all independent data in parallel
  const [
    territoryWarEvent,
    { defaultProfile, activeWars, settings, villages, relations, dmgConfig },
    assets,
    achievements,
    preloadedUsers,
    previousBattleResults,
    loadoutJutsus,
    loadoutItems,
    forceLoadoutItemProgression,
    injectableJutsus,
    raidQuest,
    sectorExclusiveRaids,
    raidParticipations,
    rankedTopPlayersLP,
    entryInventory,
    activeEventTournaments,
    pets,
    petJutsus,
  ] = await Promise.all([
    info.territoryWar ??
      (battleType === "COMBAT" && sector !== undefined
        ? fetchActiveTerritoryWar(client, sector)
        : null),
    // Essentials
    fetchBattleEssentials(client),
    // Fetch game assets (only battlefield ones to avoid row limit)
    client.query.gameAsset.findMany({
      where: and(eq(gameAsset.hidden, false), eq(gameAsset.onInitialBattleField, true)),
    }),
    // Fetch achievements
    fetchAchievementCatalogue(client),
    // Fetch user data
    queryBattleUsers(),
    PvpBattleTypes.includes(battleType) || battleType === "SHRINE_WAR"
      ? client
          .select({ count: sql`count(*)`.mapWith(Number) })
          .from(battleHistory)
          .where(
            and(
              or(
                and(
                  inArray(battleHistory.attackedId, userIds),
                  inArray(battleHistory.defenderId, targetIds),
                ),
                and(
                  inArray(battleHistory.attackedId, targetIds),
                  inArray(battleHistory.defenderId, userIds),
                ),
              ),
              gt(battleHistory.createdAt, secondsFromDate(-60 * 60, new Date())),
              // Exhibition history remains viewable without reducing ordinary PvP rewards.
              notExists(
                client
                  .select({ id: tournamentMatch.id })
                  .from(tournamentMatch)
                  .innerJoin(
                    tournament,
                    eq(tournament.id, tournamentMatch.tournamentId),
                  )
                  .where(
                    and(
                      eq(tournamentMatch.userId1, battleHistory.attackedId),
                      eq(tournamentMatch.battleId, battleHistory.battleId),
                      eq(tournament.type, "EVENT"),
                    ),
                  ),
              ),
            ),
          )
      : null,
    jutsusIds.length > 0
      ? client.query.jutsu.findMany({ where: inArray(jutsu.id, jutsusIds) })
      : [],
    itemIds.length > 0
      ? client.query.item.findMany({ where: inArray(item.id, itemIds) })
      : [],
    // Ownership progression for forced loadouts (includes unequipped copies).
    // Kept separate from user.items so unequipped rows are not treated as usable battle items.
    info.forceLoadouts && itemIds.length > 0
      ? client.query.userItem.findMany({
          where: and(
            or(inArray(userItem.userId, userIds), inArray(userItem.userId, targetIds)),
            inArray(userItem.itemId, itemIds),
            gt(userItem.quantity, 0),
            eq(userItem.isInAuction, false),
            or(
              isNull(userItem.craftingFinishedAt),
              lt(userItem.craftingFinishedAt, new Date()),
            ),
          ),
          columns: {
            id: true,
            userId: true,
            itemId: true,
            level: true,
            experience: true,
            activeVariantId: true,
            equipped: true,
          },
          with: {
            item: {
              columns: { id: true },
              with: { variants: true },
            },
          },
        })
      : [],
    // Fetch all jutsus that can be injected in battle
    client.query.jutsu.findMany({ where: eq(jutsu.injectableInBattle, true) }),
    // Fetch raid quest data for boss HP (if applicable)
    battleType === "RAID" && info.raidQuestId
      ? client.query.quest.findFirst({
          where: eq(quest.id, info.raidQuestId),
          columns: { raidBossCurrentHealth: true, raidBossMaxHealth: true },
        })
      : null,
    // Fetch exclusive raids for SHRINE_WAR battles (needed for raid activation when shrine is defeated)
    battleType === "SHRINE_WAR"
      ? client.query.quest.findMany({
          where: and(eq(quest.questType, "raid"), eq(quest.hidden, false)),
        })
      : [],
    // Preload these participants' battleCount guards for settlement.
    battleType === "RAID" && info.raidQuestId
      ? client.query.raidParticipation.findMany({
          where: and(
            eq(raidParticipation.questId, info.raidQuestId),
            inArray(raidParticipation.userId, [...new Set([...userIds, ...targetIds])]),
          ),
          columns: { userId: true, battleCount: true },
        })
      : [],
    battleType === "RANKED_PVP"
      ? (info.topPlayersLP ?? fetchSanninRankedPlayers(client))
      : [],
    info.questAttempt &&
    !info.questAttempt.entryPaid &&
    info.questAttempt.quest.content.entryItems?.length
      ? fetchQuestEntryInventory(client, info.questAttempt.userId)
      : [],
    // Open-world attacks must not pull waiting event entrants out of their ready checks
    battleType === "COMBAT"
      ? client.query.tournament.findMany({
          where: and(
            eq(tournament.type, "EVENT"),
            inArray(tournament.status, ["OPEN", "IN_PROGRESS"]),
          ),
          columns: { eventData: true },
          limit: 100,
        })
      : [],
    // Preload the bounded collection so parallel reads remain complete across selection swaps.
    petsAllowedInBattle(battleType)
      ? client.query.userPet.findMany({
          where: inArray(userPet.userId, [...userIds, ...targetIds]),
          with: { species: true },
        })
      : [],
    petsAllowedInBattle(battleType)
      ? client.query.jutsu.findMany({
          where: (table) =>
            and(
              eq(table.jutsuType, "PETS"),
              eq(table.hidden, false),
              exists(
                client
                  .select({ one: sql`1` })
                  .from(userPet)
                  .where(
                    and(
                      inArray(userPet.userId, [...userIds, ...targetIds]),
                      sql`JSON_CONTAINS(${userPet.jutsuIds}, JSON_QUOTE(${table.id}))`,
                    ),
                  ),
              ),
            ),
        })
      : [],
  ]);

  // Start due jutsu levels and crafts before the participants are read for the fight,
  // e.g. an offline opponent's queued jutsu level. Rare, so the participants are read
  // again after due settlement.
  let fetchedUsers = preloadedUsers;
  const queueOwners = fetchedUsers.filter(
    (user) => !user.isAi && hasDueTimedJob(user.queue),
  );
  if (queueOwners.length > 0) {
    try {
      await settleDueTimedQueues(client, queueOwners);
      // Dropped jobs also change balances, items and queue rows.
      fetchedUsers = await queryBattleUsers();
    } catch (error) {
      // The fight goes ahead; the queues settle on the next refresh.
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "battleQueueSettlement" },
      });
    }
  }

  const cookingOwners = fetchedUsers.filter(
    (user) =>
      !user.isAi && user.cookingJobs.some((job) => job.finishesAt <= new Date()),
  );
  if (cookingOwners.length) {
    try {
      await Promise.all(
        cookingOwners.map((user) =>
          settleCookingExperience(client, user.userId, user.cookingJobs),
        ),
      );
      fetchedUsers = await queryBattleUsers();
    } catch (error) {
      // Completion receipts remain retryable; Cooking XP does not block combat.
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "battleCookingSettlement" },
      });
    }
  }

  // Arena selection overlaps readiness, so recheck its rules on the fresh combat
  // participants. Shared AI templates are excluded from the final player claim.
  if (
    (battleType === "ARENA" || battleType === "TRAINING") &&
    targetIds.some((id) => {
      const target = fetchedUsers.find((user) => user.userId === id);
      return !target?.isAi || target.isSummon || !target.inArena;
    })
  ) {
    return errorResponse("No AI found");
  }

  // A newly adopted selection may not exist in the earlier collection snapshot.
  // Reject it before battle writes; the final participant CAS guards later swaps.
  if (
    petsAllowedInBattle(battleType) &&
    fetchedUsers.some(
      (user) =>
        !user.isAi &&
        user.activePetId &&
        !pets.some((pet) => pet.userId === user.userId && pet.id === user.activePetId),
    )
  ) {
    return {
      success: false,
      message: "A companion selection changed. Please try again.",
    };
  }

  const entryCharges = info.questAttempt
    ? getQuestEntryCharges(info.questAttempt, entryInventory)
    : [];
  if (!entryCharges)
    return {
      success: false,
      message: "You do not have the required entry items in your inventory.",
    };
  const hasEntryCharges = entryCharges.length > 0;
  // Consumed equipment/consumables must not contribute stats or remain usable in battle.
  for (const player of fetchedUsers.filter(
    (u) => u.userId === info.questAttempt?.userId,
  )) {
    player.items = player.items
      .map((row) => ({
        ...row,
        quantity:
          row.quantity -
          (entryCharges.find((charge) => charge.id === row.id)?.quantity ?? 0),
      }))
      .filter((row) => row.quantity > 0);
  }

  const profileCacheSnapshots = Object.fromEntries(
    fetchedUsers
      .filter((user) => !user.isAi && !user.isSummon)
      .map((user) => [user.userId, captureCombatCacheSnapshot(user)]),
  );

  // Hunting settlement writes the battle's item quantities and durability back.
  // Preserve the real equipment before combat processing mutates its snapshot.
  const huntingEquipment = info.hunting
    ? (
        fetchedUsers.find((user) => user.userId === info.hunting?.userId)?.items ?? []
      ).map(({ id, quantity, equipped, durability }) => ({
        id,
        quantity,
        equipped,
        durability,
      }))
    : [];

  // Personal team receipts and solo detachment must survive until the battle claim.
  // Capture before projection/training mutates the preloaded trackers in memory.
  const partyQuestSnapshots = fetchedUsers
    .filter(
      (user) =>
        !user.isAi &&
        (user.questPartyId ||
          user.questData?.some((tracker) =>
            tracker.goals.some((goal) => goal.partyEffectsApplied !== undefined),
          )),
    )
    .map(({ userId, updatedAt }) => ({ userId, updatedAt }));

  if (questEncounter) {
    const party = questEncounter;
    for (const participant of fetchedUsers.filter((user) =>
      userIds.includes(user.userId),
    )) {
      if (
        participant.questPartyId !== party.id ||
        participant.sector !== sector ||
        participant.longitude !== longitude ||
        participant.latitude !== latitude
      )
        return { success: false, message: "Quest team membership or location changed" };
      if (
        !participant.userQuests.some((entry) => entry.questId === party.quest.id) &&
        !participant.completedQuests.some((entry) => entry.questId === party.quest.id)
      )
        return { success: false, message: "A team member no longer has this quest" };
      const personal = participant.questData?.find(
        (entry) => entry.id === party.quest.id,
      );
      participant.questData = [
        ...(participant.questData ?? []).filter((entry) => entry.id !== party.quest.id),
        projectPartyTracker({ id: party.id, tracker: party.tracker }, personal),
      ];
      if (!participant.userQuests.some((entry) => entry.questId === party.quest.id))
        participant.userQuests.push({
          id: `party-${party.id}`,
          userId: participant.userId,
          questId: party.quest.id,
          questType: party.quest.questType,
          startedAt: new Date(party.tracker.startAt),
          endAt: null,
          completed: 0,
          previousCompletes: 0,
          previousAttempts: 0,
          periodCompletes: 0,
          periodStartAt: null,
          pendingRewardChoice: null,
          entryPaid: false,
          isolated: false,
          questVersion: null,
          quest: structuredClone(party.quest),
        });
    }
  }

  // Capture real awake recovery before combat normalizes stats or changes loadouts.
  const energyRegeneration = Object.fromEntries(
    fetchedUsers.map((user) => [
      user.userId,
      calcActiveUserRegen({ ...user, status: "AWAKE" }, settings, false),
    ]),
  );

  const energyRegenerationPeriods = Object.fromEntries(
    fetchedUsers.map((user) => [
      user.userId,
      getTimedRegenerationPeriods(
        energyRegeneration[user.userId] ?? 0,
        regenerationBuffs(user).filter((buff) => buff.expiresAt > user.regenAt),
      ),
    ]),
  );

  const energyCapacity = Object.fromEntries(
    fetchedUsers.map((user) => [user.userId, calcMaxEnergy(user)]),
  );

  // Settle authorized pre-combat training from the already loaded participant snapshots.
  // Battle claims commit these gains with status; ordinary partial claims retain earned training.
  // The same settlement as an account refresh (`settleQueuedTraining`), written back in
  // bulk with the battle claim below. Exhibitions also preserve real pool recovery here,
  // before loadout/stat normalization, since their settlement discards battle pools.
  const queuedTraining = fetchedUsers.flatMap((user) => {
    if (
      user.isAi ||
      (!info.tournamentGame &&
        user.queue.length === 0 &&
        !user.currentlyTrainingMastery &&
        !user.currentlyTrainingElement)
    )
      return [];
    const original = { ...user };
    const ticks = Math.max(0, Math.floor(secondsPassed(user.regenAt) / REGEN_SECONDS));
    const trainingUser = {
      ...user,
      // Existing training keeps its earned Energy when the next isolated floor starts.
      status: "AWAKE" as const,
      regeneration: calcActiveUserRegen(user, settings),
      maxEnergy: calcMaxEnergy(user),
    } as unknown as NonNullable<UserWithRelations>;
    const regenerationGain = (fromTick: number, toTick: number) =>
      getTimedRegenerationGain(
        calcActiveUserRegen(user, settings, false),
        regenerationBuffs(user),
        new Date(user.regenAt.getTime() + fromTick * REGEN_SECONDS * 1000),
        toTick - fromTick,
        REGEN_SECONDS,
      );
    const { energy, mastery } = settleQueuedTraining(
      trainingUser,
      user.queue,
      settings,
      ticks,
      new Date(),
      regenerationGain,
    );
    if (!energy && !mastery && !info.tournamentGame) return [];
    const amount = energy?.completed.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
    const minutes =
      mastery?.completed.reduce((sum, entry) => sum + entry.minutes, 0) ?? 0;
    if (energy) {
      for (const stat of CombatStatNames) user[stat] += energy.gains[stat] ?? 0;
      user.experience += amount;
      user.curEnergy = energy.curEnergy;
      user.energyQueueHead = energy.head;
    }
    if (mastery) {
      Object.assign(user, applyMasteryTrainingGains(user, mastery.gains));
      Object.assign(user, mastery.update);
      // Completion can make already worn Energy capacity gear eligible before loadouts change.
      energyCapacity[user.userId] = calcMaxEnergy(user);
    }
    const tasks = [
      ...(amount > 0 ? [{ task: "stats_trained" as const, increment: amount }] : []),
      ...(minutes > 0
        ? [{ task: "minutes_training" as const, increment: minutes }]
        : []),
    ];
    if (tasks.length > 0) {
      user.questData = filterQuestTrackersForDbPersist(
        getNewTrackers(user as unknown as NonNullable<UserWithRelations>, tasks)
          .trackers,
        user,
        true,
      );
    }
    return [
      {
        original,
        user,
        energy,
        mastery,
        amount,
        regen: regenerationGain(0, ticks),
        regenAt: secondsFromDate(ticks * REGEN_SECONDS, original.regenAt),
      },
    ];
  });

  // If we have forced loadouts, overwrite user items and jutsus appropriately
  if (info.forceLoadouts && info.forceLoadouts.length > 0) {
    // Prefer equipped copies, then highest level — includes unequipped ownership.
    const progressionQueues = new Map<
      string,
      (typeof forceLoadoutItemProgression)[number][]
    >();
    for (const row of forceLoadoutItemProgression) {
      const key = `${row.userId}:${row.itemId}`;
      const queue = progressionQueues.get(key) ?? [];
      queue.push(row);
      progressionQueues.set(key, queue);
    }
    for (const queue of progressionQueues.values()) {
      queue.sort((a, b) => {
        const aEquipped = a.equipped !== "NONE" ? 1 : 0;
        const bEquipped = b.equipped !== "NONE" ? 1 : 0;
        if (aEquipped !== bEquipped) return bEquipped - aEquipped;
        if (a.level !== b.level) return b.level - a.level;
        return b.experience - a.experience;
      });
    }

    for (const user of fetchedUsers) {
      const userLoadout = info.forceLoadouts.find((l) => l.userId === user.userId);
      if (userLoadout) {
        user.items = loadoutItems
          .filter((item) =>
            [userLoadout.loadout.weaponIds, userLoadout.loadout.consumableIds]
              .flat()
              .includes(item.id),
          )
          .map((item) => {
            const owned =
              progressionQueues.get(`${user.userId}:${item.id}`)?.shift() ?? null;
            return {
              // Synthetic id so battle-end quantity/durability writes never touch
              // real inventory rows; XP is credited via progressionRowId instead.
              id: nanoid(),
              progressionRowId: owned?.id ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
              userId: user.userId,
              itemId: item.id,
              quantity: 1,
              level: owned?.level ?? 1,
              experience: owned?.experience ?? 0,
              equipped: "ITEM_1" as const,
              item: { ...item, variants: owned?.item?.variants ?? [] },
              storedAtHome: false,
              homeX: null,
              homeY: null,
              homeRotation: 0,
              homeRoom: "main" as const,
              craftingFinishedAt: null,
              isInAuction: false,
              activeVariantId: owned?.activeVariantId ?? null,
              imbuements: [],
              dropChancePerc: 0,
              durability: 100,
            };
          });
        user.jutsus = loadoutJutsus
          .filter((jutsu) => userLoadout.loadout.jutsuIds.includes(jutsu.id))
          .map((jutsu) => ({
            id: nanoid(),
            createdAt: new Date(),
            updatedAt: new Date(),
            userId: user.userId,
            jutsuId: jutsu.id,
            level: 25,
            experience: 0,
            equipped: true,
            finishTraining: null,
            jutsu: jutsu,
            reskinId: null,
            activeReskin: null,
          }));
      }
    }
  }

  // Get background for the battle
  let background: CombatBiome = info.biome ?? "default";

  // If background is default and we have a sector, determine biome from the global tile
  if (background === "default" && sector !== undefined) {
    const map = mapData as unknown as GlobalMapData;
    const tile = map.tiles[sector];
    if (tile) {
      background = getBiomeFromGlobalTile(tile);
    }
  }

  // Allies must be NPC templates, never extra player accounts.
  if (allyAiIds.some((id) => !fetchedUsers.find((u) => u.userId === id)?.isAi)) {
    return { success: false, message: "One of the ally AIs is unavailable" };
  }

  // Clone each occurrence: one NPC template may appear repeatedly or on both teams.
  const users = [...userIds, ...allyAiIds, ...targetIds]
    .map((id) => structuredClone(fetchedUsers.find((u) => u.userId === id)))
    .filter((u): u is NonNullable<typeof u> => u !== undefined);

  if (
    dungeonEncounter &&
    (users.length !== userIds.length + targetIds.length ||
      users.slice(userIds.length).some((u) => !u.isAi))
  )
    return { success: false, message: "A dungeon enemy is unavailable" };

  // Recheck pre-existing shrine parties too: approval may have selected their sector later.
  if (battleType === "SHRINE_WAR" && !info.warCamp) {
    for (const activeWar of activeWars.filter((w) => w.rules)) {
      const objective = activeWar.objectiveState?.objectives.find(
        (o) => o.sector === info.sector,
      );
      if (!objective) continue;
      for (const attacker of users.filter(
        (u) => userIds.includes(u.userId) && !u.isAi,
      )) {
        const side = getWarSide(activeWar, attacker.villageId, attacker.userId);
        if (
          !side ||
          side === objective.villageId ||
          objective.destroyed ||
          !isObjectiveWarActive(activeWar) ||
          !areWarObjectivesRevealed(activeWar, side)
        )
          return {
            success: false,
            message:
              "This objective shrine is unavailable until active combat and completed espionage",
          };
      }
    }
  }

  const territoryCompetitors = Object.fromEntries(
    users
      .filter((user) => !user.isAi)
      .map((user) => [user.userId, getTerritoryCompetitor(user)]),
  );
  if (battleType === "TERRITORY_WAR") {
    if (
      !territoryWarEvent ||
      territoryWarEvent.resolvedAt ||
      territoryWarEvent.endsAt <= new Date() ||
      userIds.length < 1 ||
      userIds.length > TERRITORY_WAR_TEAM_SIZE ||
      targetIds.length !== 1 ||
      targetIds[0] !== territoryWarEvent.guardianId ||
      !info.clanBattle
    )
      return errorResponse("This Territory War is no longer available");
    const competitors = userIds.map((id) => territoryCompetitors[id]?.id);
    if (
      competitors.some((id) => !id || id !== competitors[0]) ||
      users.some(
        (user) =>
          !user.isAi &&
          (user.sector !== territoryWarEvent.sector ||
            user.status !== "QUEUED" ||
            user.isBanned),
      )
    )
      return errorResponse(
        "All teammates must represent the same village or faction and be queued in the event sector",
      );
  }

  // Hide some information from quests
  users.forEach((user) => {
    user.userQuests?.forEach((q) => {
      controlShownQuestLocationInformation(q.quest, user);
    });
  });
  // The ordered input keeps the initiating player first and each ally before the targets.
  const leftSideUserCount = [...userIds, ...allyAiIds].filter((id) =>
    fetchedUsers.some((u) => u.userId === id),
  ).length;

  // Ensure SageMode row is present when sageModeId is set (relation can be null if stale)
  const missingSageIds = [
    ...new Set(
      users
        .filter((u) => u.sageModeId && !u.sageMode)
        .map((u) => u.sageModeId as string),
    ),
  ];
  if (missingSageIds.length > 0) {
    const sageRows = await client.query.sageMode.findMany({
      where: inArray(sageMode.id, missingSageIds),
    });
    const byId = Object.fromEntries(sageRows.map((m) => [m.id, m]));
    for (const u of users) {
      if (!u.sageModeId || u.sageMode) continue;
      const row = byId[u.sageModeId];
      if (row) u.sageMode = row;
    }
  }

  // Check if the villageData is in a pvp enabled zone
  const sectorData = villages.find((v) => v.sector === sector);

  // Wake Island blanket PvP protection, toggled by WAKE_ISLAND_PVP_PROTECTION
  if (
    WAKE_ISLAND_PVP_PROTECTION &&
    sector === MAP_WAKE_ISLAND_SECTOR &&
    battleType === "COMBAT"
  ) {
    return { success: false, message: "Cannot attack players in Wake Island" };
  }

  // Registered event tournament entrants wait at Wake Island for their ready checks
  if (
    battleType === "COMBAT" &&
    users.some(
      (u) =>
        targetIds.includes(u.userId) &&
        !u.isAi &&
        activeEventTournaments.some(
          (t) => t.eventData && isActiveEventEntrant(t.eventData, u.userId),
        ),
    )
  ) {
    return {
      success: false,
      message:
        "This player is registered for an ongoing tournament and can't be attacked",
    };
  }

  if (sectorData?.pvpDisabled && battleType === "COMBAT") {
    // Check if any non-protected users are trying to attack protected village members
    const protectedVillageId = sectorData.id;
    const attackers = users.filter((u) => userIds.includes(u.userId) && !u.isAi);
    const defenders = users.filter((u) => targetIds.includes(u.userId) && !u.isAi);

    // Check if any defender is from the protected village
    const hasProtectedDefender = defenders.some(
      (user) => user.villageId === protectedVillageId,
    );

    // Check if any attacker is NOT from the protected village
    const hasNonProtectedAttacker = attackers.some(
      (user) => user.villageId !== protectedVillageId,
    );

    // Block if non-protected users are trying to attack protected village members
    if (hasProtectedDefender && hasNonProtectedAttacker) {
      return {
        success: false,
        message: "Cannot attack members of this protected village",
      };
    }
  }

  // Calculate battle width and height
  const gridSize = getDefaultBattleSizes(battleType, users[0]?.level ?? 0);

  {
    const leftCapacity = getBattleSpawnLocations(
      gridSize.width,
      gridSize.height,
      "left",
    ).length;
    const rightCapacity = getBattleSpawnLocations(
      gridSize.width,
      gridSize.height,
      "right",
    ).length;
    if (
      leftSideUserCount > leftCapacity ||
      (dungeonEncounter
        ? Math.max(...dungeonEncounter.waves.map((w) => w.aiIds.length))
        : users.length - leftSideUserCount) > rightCapacity
    ) {
      return { success: false, message: "Too many NPCs for this battlefield" };
    }
  }

  // Team bracket eligibility uses the initiating player; village and activity guards still apply to every member.
  const now = new Date();
  const nonAiTargets = users.filter((u) => targetIds.includes(u.userId) && !u.isAi);

  // AI rows are excluded from the battle-start claim below (one shared row backs
  // every fight against a given AI), so the update's location predicate no longer
  // verifies an AI target's position. Enforce the COMBAT proximity rule against
  // the fetched snapshot instead, mirroring the SQL predicate applied to players.
  if (battleType === "COMBAT") {
    const movedAiTarget = users.find(
      (u) =>
        u.isAi &&
        targetIds.includes(u.userId) &&
        ((sector !== undefined && u.sector !== sector) ||
          (longitude !== undefined && u.longitude !== longitude) ||
          (latitude !== undefined && u.latitude !== latitude)),
    );
    if (movedAiTarget) {
      return { success: false, message: "Attack failed, did the target move?" };
    }
  }

  // Loop through each user
  for (const i of users.keys()) {
    // Get the user
    const user = users[i];
    if (!user) return { success: false, message: "Could not find expected user" };

    if (info.kageMatch && userIds.includes(user.userId)) {
      const reason = getKageEligibility(user, info.kageMatch.villageId);
      if (reason) return { success: false, message: reason };
    }

    // If user is banned
    if (user.isBanned) return { success: false, message: `${user.username} is banned` };

    // Force defender village id
    if (info?.forceDefenderVillageId && targetIds.includes(user.userId)) {
      user.villageId = info.forceDefenderVillageId;
    }

    // Check if user is asleep
    const QUEUED_BATTLES = [
      "TERRITORY_WAR",
      "RANKED_PVP",
      "CLAN_BATTLE",
      "KAGE_PVP",
      "RAID",
    ];
    const isQueuedBattle = QUEUED_BATTLES.includes(battleType);
    const isAutoBattle = AutoBattleTypes.includes(battleType);
    const isShrineBattle = battleType === "SHRINE_WAR";

    // Scheduled title fights claim both participants directly from ordinary play.
    if (battleType === "KAGE_PVP") {
      if (!user.isAi && user.status !== "AWAKE")
        return {
          success: false,
          message: `${user.username} must be awake and free of other activities`,
        };
    } else if (!isAutoBattle && !user.isAi) {
      // For other battles, check if user status is appropriate (skip AI users)
      const isOk = isQueuedBattle
        ? user.status === "QUEUED"
        : isShrineBattle
          ? ["AWAKE", "QUEUED"].includes(user.status)
          : user.status === "AWAKE" ||
            (battleType === "QUEST" &&
              isBetweenPyramidBattles(user) &&
              info.questAttempt?.isolated &&
              getIsolatedPyramid(user)?.id === info.questAttempt.id &&
              info.questBattleSource?.questId === info.questAttempt.questId);
      if (!isOk) {
        return { success: false, message: `User ${user.username} is not awake` };
      }
    }

    // Rank restrictions
    if (battleType === "COMBAT") {
      if (userIds.includes(user.userId)) {
        if (RANKS_RESTRICTED_FROM_PVP.includes(user.rank)) {
          return { success: false, message: "Need to rank up to do PvP combat" };
        }
      } else {
        if (RANKS_RESTRICTED_FROM_PVP.includes(user.rank) && !user.isAi) {
          return { success: false, message: "Cannot attack students & genin" };
        }
      }
    }

    // XP Bracket restrictions — same bracket, higher, or one below; immunity lift and war exemptions
    if (battleType === "COMBAT" && userIds.includes(user.userId)) {
      // Elite bracket limits remain absolute before war-zone, war and immunity exemptions.
      const eliteMismatch =
        user.userId === userIds[0] &&
        nonAiTargets.find(
          (target) =>
            (user.rank === "ELITE JONIN" || target.rank === "ELITE JONIN") &&
            !canAttackBracket(
              getExpBracket(user.experience, user.rank),
              getExpBracket(target.experience, target.rank),
            ),
        );
      if (eliteMismatch)
        return {
          success: false,
          message: `Elite Jonin can only fight players in brackets ${ELITE_JONIN_BRACKET - 1} and ${ELITE_JONIN_BRACKET}.`,
        };
      // War-Torn sectors skip ordinary village and XP bracket restrictions.
      const isInWarTornSector = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
      if (!isInWarTornSector) {
        if (
          nonAiTargets.some((t) => getWarRelationship(activeWars, user, t) === "ALLY")
        )
          return errorResponse("Cannot attack a participant on your war side");
        // Guard 1: Cannot attack members of your own village
        const sameVillageTarget = nonAiTargets.find(
          (t) =>
            t.villageId !== null &&
            t.villageId === user.villageId &&
            getWarRelationship(activeWars, user, t) !== "ENEMY",
        );
        if (sameVillageTarget) {
          return {
            success: false,
            message: `Cannot attack ${sameVillageTarget.username} — they are in your village`,
          };
        }

        // Guard 2: Cannot attack members of allied villages
        const alliedTarget = nonAiTargets.find(
          (t) =>
            (getWarRelationship(activeWars, user, t) ??
              findRelationship(relations, user.villageId, t.villageId)?.status) ===
            "ALLY",
        );
        if (alliedTarget) {
          return {
            success: false,
            message: `Cannot attack ${alliedTarget.username} — their village is allied with yours`,
          };
        }

        // Guard 3: Bracket restrictions
        const attackerBracket = getExpBracket(user.experience, user.rank);

        // Collect targets more than one bracket below — protection is one-directional:
        // attackers may hit same bracket, higher, or one below (without exemption).
        // Lower-bracket players may freely attack higher-bracket players.
        // Academy/Genin remain blocked by the rank restrictions above.
        const crossBracketTargets =
          user.userId === userIds[0]
            ? nonAiTargets.filter(
                (t) =>
                  !canAttackBracket(
                    attackerBracket,
                    getExpBracket(t.experience, t.rank),
                  ),
              )
            : [];

        if (crossBracketTargets.length > 0) {
          const attackerIsWarParticipant = user.warParticipantUntil > now;

          // Each cross-bracket target needs its own exemption — check individually
          const blockedTarget = crossBracketTargets.find((t) => {
            // Guard 4 (allow): target's bracket immunity is lifted (they attacked recently)
            if (t.bracketImmunityLiftedUntil > now) return false;

            // Guard 5 (allow): both are active war participants on opposing sides.
            // Effective allegiance includes allied villages and exclusive mercenary appointments.
            const targetIsWarParticipant = t.warParticipantUntil > now;
            const atWar = getWarRelationship(activeWars, user, t) === "ENEMY";
            if (
              (attackerIsWarParticipant ||
                activeWars.some((w) =>
                  w.warMercenaries?.some((m) => m.userId === user.userId),
                )) &&
              (targetIsWarParticipant ||
                activeWars.some((w) =>
                  w.warMercenaries?.some((m) => m.userId === t.userId),
                )) &&
              atWar
            )
              return false;

            return true; // no exemption — this target is blocked
          });

          if (blockedTarget) {
            const targetBracket = getExpBracket(
              blockedTarget.experience,
              blockedTarget.rank,
            );
            return {
              success: false,
              message: `Cannot attack ${blockedTarget.username} — different combat bracket (${attackerBracket} vs ${targetBracket})`,
            };
          }
        }
      }
    }

    // Scale targets
    if (info?.scaleTarget && i >= leftSideUserCount && users[0]) {
      user.level = users[0].level;
      scaleUserStats(user, user.isAi ? "ai" : "player");
    }

    // Manually Assign Stats
    if (info?.targetStatDistribution && i >= leftSideUserCount) {
      manuallyAssignUserStats(user, info?.targetStatDistribution);
    }
    if (info?.userStatDistribution && userIds.includes(user.userId)) {
      manuallyAssignUserStats(user, info?.userStatDistribution);
    }

    // Apply caps to user stats. Ranked waives progression gates and plays everyone as an
    // ELITE JONIN, so its distributions cap at that rank rather than the player's own.
    const isRankedBattle =
      battleType === "RANKED_PVP" || battleType === "RANKED_SPARRING";
    capUserStats(user, isRankedBattle ? "ELITE JONIN" : user.rank);

    // Add achievements to users for tracking
    // Ensure userQuests and completedQuests are initialized for mockAchievementHistoryEntries
    if (!user.userQuests) user.userQuests = [];
    if (!user.completedQuests) user.completedQuests = [];
    const userForAchievements = {
      ...user,
      userQuests: user.userQuests,
      completedQuests: user.completedQuests,
    };
    user.userQuests.push(
      ...mockAchievementHistoryEntries(achievements, userForAchievements),
    );
  }

  // Check immunity on defenders
  if (
    battleType === "COMBAT" &&
    users
      .filter((u) => targetIds.includes(u.userId))
      .some((u) => u.immunityUntil > new Date())
  ) {
    return {
      success: false,
      message: "One of the targets is immune from combat.",
    };
  }

  // Get previous battles between these two users within last 60min
  // Friendly NPCs do not increase the reward for defeating the authored enemies.
  let rewardScaling = (scaleGains * (users.length - allyAiIds.length)) / 2;
  const repeatOpponentScaling =
    rewardScaling / ((previousBattleResults?.[0]?.count ?? 0) + 1);
  if (PvpBattleTypes.includes(battleType)) {
    rewardScaling = repeatOpponentScaling;
  }
  // Human shrine XP has diminishing returns without reducing strategic shrine rewards.
  const pvpExperienceScaling =
    battleType === "SHRINE_WAR" &&
    users.some((user) => !user.isAi && userIds.includes(user.userId)) &&
    users.some((user) => !user.isAi && targetIds.includes(user.userId))
      ? repeatOpponentScaling
      : undefined;

  // Share raw summon reads across the opening wave and ordered future waves.
  const summonTemplateCache = new Map<string, Promise<CombatQueryUser[]>>();

  // Create the users array to be inserted into the battle
  const processed = await processUsersForBattle(client, {
    users: dungeonEncounter
      ? users.slice(0, userIds.length + (dungeonEncounter.waves[0]?.aiIds.length ?? 0))
      : users,
    settings,
    relations,
    wars: activeWars,
    villages,
    defaultProfile,
    battleType,
    width: gridSize.width,
    height: gridSize.height,
    hide: false,
    leftSideUserIds: userIds,
    leftSideUserCount,
    isSummon: false,
    summonTemplateCache,
    petPreload: {
      pets,
      ownerRanks: Object.fromEntries(
        fetchedUsers
          .filter((user) => !user.isAi)
          .map((user) => [user.userId, user.rank]),
      ),
      abilitiesByOwner: Object.fromEntries(
        fetchedUsers
          .filter((user) => !user.isAi)
          .map((user) => [
            user.userId,
            {
              jutsus: petJutsus,
              skills: user.userSkills,
            },
          ]),
      ),
    },
  }).catch(handleSummonPreloadError);
  if (processed instanceof Error) return errorResponse(processed.message);
  const { userEffects, usersState, extraState, initialDurability, groundEffects } =
    processed;

  if (dungeonEncounter) {
    let offset = userIds.length + (dungeonEncounter.waves[0]?.aiIds.length ?? 0);
    const encounter = await prepareEncounterWaves(
      dungeonEncounter.waves,
      { usersState, userEffects, extraState },
      async (wave) => {
        const prepared = await processUsersForBattle(client, {
          users: users.slice(offset, offset + wave.aiIds.length),
          settings,
          relations,
          wars: activeWars,
          villages,
          defaultProfile,
          battleType,
          width: gridSize.width,
          height: gridSize.height,
          hide: false,
          leftSideUserCount: 0,
          isSummon: false,
          summonTemplateCache,
        });
        offset += wave.aiIds.length;
        return prepared;
      },
    ).catch(handleSummonPreloadError);
    if (encounter instanceof Error) return errorResponse(encounter.message);
    extraState.encounter = encounter;
    extraState.dungeon = {
      runId: dungeonEncounter.runId,
      runVersion: dungeonEncounter.runVersion,
      runState: dungeonEncounter.runState,
      totalFloors: dungeonEncounter.totalFloors,
      roomKind: dungeonEncounter.roomKind,
      expiresAt: dungeonEncounter.expiresAt,
      lastActionRound: Object.fromEntries(userIds.map((id) => [id, 0])),
    };
  }

  if (info.kageMatch) extraState.kageMatch = info.kageMatch;

  if (info.tournamentGame) {
    extraState.tournamentGameId = info.tournamentGame.id;
    extraState.tournamentAiOnly = info.tournamentGame.aiOnly;
  }

  // Hand requested users' turns to their own AI profile (auto combat). Gated on
  // AutoCombatBattleTypes so callers cannot enable it for unsupported battles.
  const autoCombatUserIds = [
    ...(info.autoCombatUserIds ?? []),
    ...(info.autoCombatFromDefaults
      ? users
          .filter((u) => !u.isAi && u.defaultAutoCombat && userIds.includes(u.userId))
          .map((u) => u.userId)
      : []),
  ];
  if (
    autoCombatUserIds.length &&
    (AutoCombatBattleTypes.includes(battleType) ||
      !!info.tournamentGame ||
      !!info.kageMatch?.ai)
  ) {
    usersState.forEach((user) => {
      if (
        !user.isAi &&
        !user.isSummon &&
        autoCombatUserIds.includes(user.controllerId)
      ) {
        user.isAutoCombat = true;
      }
    });
  }

  for (const user of usersState.filter(
    (u) => !u.isAi && userIds.includes(u.controllerId),
  )) {
    addQuestStartingEffects(
      user,
      userEffects,
      info.startingEffects ?? [],
      `quest-${info.questAttempt?.questId ?? "battle"}`,
    );
  }

  // Apply pool adjustments to base values for all users with pool effects at battle start
  usersState.forEach((user) => {
    const hasPoolEffects = userEffects.some(
      (e) =>
        e.targetId === user.userId &&
        (e.type === "increasemaxpools" || e.type === "decreasemaxpools") &&
        isEffectActive(e),
    );
    if (hasPoolEffects) {
      applyPoolAdjustmentsToBase(user, userEffects);
    }
  });

  if (info.givePools !== undefined) {
    for (const user of usersState.filter(
      (u) => !u.isAi && userIds.includes(u.controllerId),
    )) {
      user.curHealth =
        (getEffectiveMaxPool(user, userEffects, "Health") * info.givePools) / 100;
      user.curChakra =
        (getEffectiveMaxPool(user, userEffects, "Chakra") * info.givePools) / 100;
      user.curStamina =
        (getEffectiveMaxPool(user, userEffects, "Stamina") * info.givePools) / 100;
    }
  }

  // Mastery tags from the bloodline, skills and gear count from the first action
  refreshMasteries(usersState, userEffects);

  // Set attacker to be the agressor
  if (usersState[0]) usersState[0].isAggressor = true;

  // Handle RAID battle boss HP
  let raidInitialBossHp: number | undefined;
  if (battleType === "RAID" && info.raidQuestId && raidQuest) {
    // Fall back to max health if current health is null/undefined
    const raidBossCurrent =
      raidQuest.raidBossCurrentHealth ?? raidQuest.raidBossMaxHealth;
    if (raidBossCurrent !== undefined && raidBossCurrent !== null) {
      // Find the boss (the target AI) and set their HP to the raid's current boss HP
      const boss = usersState.find((u) => targetIds.includes(u.controllerId) && u.isAi);
      if (boss) {
        raidInitialBossHp = raidBossCurrent;
        // Set boss maxHealth first (use higher of AI max and raid max), then curHealth
        const raidMaxHp = raidQuest?.raidBossMaxHealth ?? boss.maxHealth;
        boss.maxHealth = Math.max(boss.maxHealth, raidMaxHp);
        boss.curHealth = Math.min(boss.maxHealth, raidBossCurrent);
        // Set chakra and stamina equal to max health for raid bosses
        boss.maxChakra = boss.maxHealth;
        boss.curChakra = boss.maxHealth;
        boss.maxStamina = boss.maxHealth;
        boss.curStamina = boss.maxHealth;
      }
    }
  }

  // Starting ground effects
  const groundAssets = assets.filter(
    (a) => a.onInitialBattleField && a.type === "STATIC",
  );
  for (let col = 0; col < gridSize.width; col++) {
    for (let row = 0; row < gridSize.height; row++) {
      // Ignore the spots where we placed users
      const foundUser = usersState.find(
        (u) => u.longitude === col && u.latitude === row,
      );
      if (!foundUser) {
        const rand = Math.random();
        if (rand < 0.1) {
          const asset = getRandomElement(groundAssets);
          if (asset) {
            const tag: GroundEffect = {
              ...BarrierTag.parse({
                power: 2,
                staticAssetPath: asset.id,
              }),
              id: `initial-${col}-${row}`,
              creatorId: "ground",
              actionId: "initial",
              createdRound: 0,
              level: 0,
              longitude: col,
              latitude: row,
              isNew: false,
              barrierAbsorb: 0,
              castThisRound: false,
            };
            groundEffects.push(tag);
          }
        }
      }
    }
  }

  // Figure out who starts in the battle
  const attackerFirst = !PvpBattleTypes.includes(battleType);
  const activeUser = usersState
    .sort((a, b) => b.initiative - a.initiative)
    .filter((u) => u.curHealth > 0);
  const activeUserId = attackerFirst ? users?.[0]?.userId : activeUser?.[0]?.userId;

  // When to start the battle
  const startTime = !PvpBattleTypes.includes(battleType)
    ? new Date()
    : secondsFromNow(COMBAT_LOBBY_SECONDS);

  // Insert battle entry into DB
  const battleId =
    info.coop?.battleId ??
    info.clanBattle?.battleId ??
    info.tournamentGame?.battleId ??
    info.kageMatch?.battleId ??
    nanoid();

  // Rows the status update below is expected to claim, used as the CAS guard
  const allParticipantIds = getBattleClaimIds({
    battleType,
    userIds,
    targetIds,
    participants: users,
  });
  const expectedRows = allParticipantIds.length;

  // Handle stealth breaking for combat
  // Defenders always have stealth broken (force break)
  // Attackers roll to keep stealth based on their stealth stat
  const stealthBreakUserIds: string[] = [];

  // Defenders always lose stealth
  if (!info.tournamentGame && !AutoBattleTypes.includes(battleType)) {
    stealthBreakUserIds.push(...targetIds);
  }

  // Attackers roll to see if they keep stealth
  for (const userId of userIds) {
    const user = users.find((u) => u.userId === userId);
    if (!info.tournamentGame && user?.stealthActive) {
      const keepStealth = rollStealthKeep(user.stealth);
      if (!keepStealth) {
        stealthBreakUserIds.push(userId);
      }
    }
  }

  // Identify COMBAT aggressors against preloaded human war enemies, including enemy war allies.
  // Stamp participation in the guarded battle-start update so the claim and timer are atomic.
  const warAggressorIds =
    battleType === "COMBAT"
      ? userIds.filter((uid) => {
          const attacker = users.find((u) => u.userId === uid);
          return (
            !!attacker &&
            !attacker.isAi &&
            nonAiTargets.some(
              (target) => getWarRelationship(activeWars, attacker, target) === "ENEMY",
            )
          );
        })
      : battleType === "SHRINE_WAR"
        ? userIds
        : [];

  // Initiating PvP or a shrine attack lifts the attacker's bracket immunity for the 30-minute
  // retaliation window, so anyone from any bracket can hit them back. Stamped here at attack initiation
  // (not battle end) so the window starts when the attack lands and abandoned/lost fights still expose
  // the aggressor. The window pauses while the aggressor is in combat.
  const combatTargetsRealPlayer =
    battleType === "COMBAT" &&
    targetIds.some((tid) => {
      const target = users.find((u) => u.userId === tid);
      return !!target && !target.isAi;
    });
  const bracketImmunityAggressorIds =
    combatTargetsRealPlayer || battleType === "SHRINE_WAR" ? userIds : [];

  const queuedParticipants = queuedTraining.filter((entry) =>
    allParticipantIds.includes(entry.user.userId),
  );
  const queueUpdate: Record<string, ReturnType<typeof sql>> = {};
  if (queuedParticipants.length) {
    const queueCase = (
      column: keyof typeof userData.$inferSelect,
      entries: typeof queuedParticipants,
      value: (entry: (typeof queuedParticipants)[number]) => unknown,
    ) =>
      sql`CASE ${sql.join(
        entries.map(
          (entry) =>
            sql`WHEN ${userData.userId} = ${entry.user.userId} THEN ${value(entry)}`,
        ),
        sql` `,
      )} ELSE ${userData[column]} END`;
    queueUpdate.questData = queueCase("questData", queuedParticipants, (entry) =>
      JSON.stringify(entry.user.questData),
    );
    queueUpdate.updatedAt = sql`CASE WHEN ${inArray(
      userData.userId,
      queuedParticipants.map((entry) => entry.user.userId),
    )} THEN GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt})) ELSE ${userData.updatedAt} END`;
    const energyParticipants = queuedParticipants.filter((entry) => entry.energy);
    const recoveryParticipants = info.tournamentGame
      ? queuedParticipants
      : energyParticipants;
    if (recoveryParticipants.length) {
      queueUpdate.curEnergy = queueCase(
        "curEnergy",
        recoveryParticipants,
        (entry) =>
          entry.energy?.curEnergy ??
          Math.min(
            entry.original.curEnergy + entry.regen,
            energyCapacity[entry.original.userId] ?? entry.original.maxEnergy,
          ),
      );
      for (const pool of PoolTypes) {
        const { cur, max } = getPoolKeys(pool);
        queueUpdate[cur] = queueCase(cur, recoveryParticipants, (entry) =>
          Math.min(entry.original[cur] + entry.regen, entry.original[max]),
        );
      }
      queueUpdate.regenAt = queueCase(
        "regenAt",
        recoveryParticipants,
        (entry) => entry.regenAt,
      );
    }
    if (energyParticipants.length) {
      // Advancing the head consumes the settled rows in this same statement.
      queueUpdate.energyQueueHead = queueCase(
        "energyQueueHead",
        energyParticipants,
        (entry) => entry.energy?.head,
      );
      queueUpdate.experience = queueCase(
        "experience",
        energyParticipants,
        (entry) => sql`${userData.experience} + ${entry.amount}`,
      );
      queueUpdate.petExperience = queueCase(
        "petExperience",
        energyParticipants,
        (entry) => petExperienceGainSql(entry.amount),
      );
      for (const stat of CombatStatNames) {
        queueUpdate[stat] = queueCase(
          stat,
          energyParticipants,
          (entry) => sql`${userData[stat]} + ${entry.energy?.gains[stat] ?? 0}`,
        );
      }
    }
    const masteryParticipants = queuedParticipants.filter((entry) => entry.mastery);
    if (masteryParticipants.length) {
      for (const column of [
        "masteryQueueHead",
        "elementalQueueHead",
        "currentlyTrainingElement",
        "elementalTrainingStartedAt",
        "elementalTrainingSpeed",
        "currentlyTrainingMastery",
        "masteryTrainingStartedAt",
        "trainingSpeed",
        "dailyTrainings",
      ] as const) {
        const participants = masteryParticipants.filter(
          (entry) => entry.mastery && column in entry.mastery.update,
        );
        if (!participants.length) continue;
        queueUpdate[column] = queueCase(
          column,
          participants,
          (entry) => entry.user[column],
        );
      }
      queueUpdate.elementalMastery = queueCase(
        "elementalMastery",
        masteryParticipants,
        (entry) => JSON.stringify(entry.user.elementalMastery),
      );
      for (const stat of MasteryNames) {
        queueUpdate[stat] = queueCase(
          stat,
          masteryParticipants,
          (entry) =>
            masteryGainUpdates(entry.mastery?.gains ?? {})[stat] ??
            sql`${userData[stat]}`,
        );
      }
    }
  }

  // Capture injectable jutsu availability for the controller's action prediction.
  for (const user of usersState) {
    user.skillLockedJutsuIds =
      user.activeSkillIds === undefined
        ? []
        : injectableJutsus
            .filter((jutsu) => !hasRequiredSkill(jutsu, user))
            .map((jutsu) => jutsu.id);
  }

  // Only a real payment creates a receipt; paid floors retain their preloaded receipt.
  if (info.questAttempt && hasEntryCharges) {
    const entry = extraState.userQuests[info.questAttempt.userId]?.find(
      (row) => row.questId === info.questAttempt?.questId,
    );
    if (entry) entry.entryPaid = true;
  }
  /**
   * Persist the preloaded battle and return the participant claim and any settled failure.
   * First payments, event launches and personal hunts await writes within their transaction session.
   * Other battles dispatch independent writes together and settle all siblings before cleanup.
   */
  const createBattle = async (client: DrizzleClient) => {
    const writes = [
      client.insert(battle).values({
        id: battleId,
        battleType: battleType,
        background: background,
        usersState: usersState,
        usersEffects: userEffects,
        groundEffects: groundEffects,
        width: gridSize.width,
        height: gridSize.height,
        extraState: {
          ...extraState,
          profileCacheSnapshots,
          pvpExperienceScaling,
          energyRewardEligible: (previousBattleResults?.[0]?.count ?? 0) === 0,
          energyRegeneration,
          energyRegenerationPeriods,
          energyCapacity,
          jutsus: {
            ...extraState.jutsus,
            ...Object.fromEntries(injectableJutsus.map((j) => [j.id, j])),
            [SAGE_MODE_ACTIVATION_JUTSU_ID]: SAGE_MODE_ACTIVATION_JUTSU,
          },
          dmgConfig: dmgConfig,
          settings: settings,
          initialDurability: initialDurability,
          hunting: info.hunting,
          questBattleSource: info.questBattleSource,
          warCamp: info.warCamp,
          territoryWar: territoryWarEvent
            ? {
                id: territoryWarEvent.id,
                sector: territoryWarEvent.sector,
                endsAt: territoryWarEvent.endsAt.toISOString(),
                competitors: territoryCompetitors,
              }
            : undefined,
          raidQuestId: info.raidQuestId,
          raidInitialBossHp: raidInitialBossHp,
          raidStartBattleCount: Object.fromEntries(
            raidParticipations.map((p) => [p.userId, p.battleCount]),
          ),
          sectorExclusiveRaids: sectorExclusiveRaids,
          topPlayersLP: rankedTopPlayersLP,
        },
        rewardScaling: rewardScaling,
        createdAt: startTime,
        updatedAt: startTime,
        roundStartAt: startTime,
        activeUserId: activeUserId,
        forceKeepPools: info.forceKeepPools ?? false,
      }),
      client.insert(battleHistory).values(
        userIds.flatMap((i) =>
          targetIds.map((t) => ({
            battleId,
            battleType: battleType,
            attackedId: i,
            defenderId: t,
            createdAt: new Date(),
          })),
        ),
      ),
      client
        .update(userData)
        .set({
          ...queueUpdate,
          status: "BATTLE",
          battleId: battleId,
          pvpFights:
            !info.tournamentGame && ["SPARRING", "COMBAT"].includes(battleType)
              ? sql`${userData.pvpFights} + 1`
              : sql`${userData.pvpFights}`,
          pveFights:
            !info.tournamentGame && !["SPARRING", "COMBAT"].includes(battleType)
              ? sql`${userData.pveFights} + 1`
              : sql`${userData.pveFights}`,
          immunityUntil:
            !info.tournamentGame &&
            ["SPARRING", "COMBAT", "SHRINE_WAR"].includes(battleType)
              ? sql`CASE WHEN ${inArray(userData.userId, userIds)} THEN NOW() ELSE ${userData.immunityUntil} END`
              : sql`immunityUntil`,
          // Break stealth when entering combat
          // Defenders (being attacked) always lose stealth
          // Attackers roll to keep stealth based on their stealth stat
          stealthActive:
            stealthBreakUserIds.length > 0
              ? sql`CASE WHEN ${inArray(userData.userId, stealthBreakUserIds)} THEN false ELSE ${userData.stealthActive} END`
              : sql`stealthActive`,
          stealthActivatedAt:
            stealthBreakUserIds.length > 0
              ? sql`CASE WHEN ${inArray(userData.userId, stealthBreakUserIds)} THEN NULL ELSE ${userData.stealthActivatedAt} END`
              : sql`stealthActivatedAt`,
          // Stamp war aggressors AND bracket-immunity aggressors in the same update so the WHERE guard
          // (status/sector match) gates both the battle entry and these timers atomically. GREATEST never
          // shortens an existing longer stamp; any leak on the rollback path is bounded (war ~2h, bracket
          // immunity ~30m) and fail-safe — a lingering bracket lift only makes the aggressor more attackable.
          ...(warAggressorIds.length > 0
            ? {
                warParticipantUntil: sql`CASE WHEN ${inArray(userData.userId, warAggressorIds)} THEN ${extendWarParticipantSql()} ELSE ${userData.warParticipantUntil} END`,
              }
            : {}),
          ...(bracketImmunityAggressorIds.length > 0
            ? {
                bracketImmunityLiftedUntil: sql`CASE WHEN ${inArray(userData.userId, bracketImmunityAggressorIds)} THEN ${liftBracketImmunitySql()} ELSE ${userData.bracketImmunityLiftedUntil} END`,
              }
            : {}),
          bracketImmunityPausedAt: sql`CASE WHEN ${userData.bracketImmunityLiftedUntil} > NOW(3) THEN NOW(3) ELSE NULL END`,
        })
        .where(
          and(
            // Exactly the rows the CAS guard counts (expectedRows), so the
            // predicate and the expected count derive from one source and cannot
            // drift apart. The list already excludes AI rows, so the shared AI
            // row is never even examined (or locked) by this update. Drizzle
            // compiles an empty list to FALSE, matching expectedRows === 0.
            inArray(userData.userId, allParticipantIds),
            // A companion swap during preload must not claim a battle with a stale active pet.
            ...(petsAllowedInBattle(battleType)
              ? fetchedUsers
                  .filter((user) => allParticipantIds.includes(user.userId))
                  .map((user) =>
                    or(
                      ne(userData.userId, user.userId),
                      and(
                        user.activePetId
                          ? eq(userData.activePetId, user.activePetId)
                          : isNull(userData.activePetId),
                        user.petTask
                          ? sql`JSON_CONTAINS(${userData.petTask}, ${JSON.stringify(user.petTask)})`
                          : isNull(userData.petTask),
                      ),
                    ),
                  )
              : []),
            ...(info.hunting
              ? [
                  eq(userData.status, "AWAKE"),
                  isNull(userData.battleId),
                  eq(userData.occupation, "HUNTER"),
                  eq(userData.sector, sector ?? -1),
                  gte(
                    userData.huntingExperience,
                    HUNTING_REQUIRED_EXP[info.hunting.contract.rank],
                  ),
                  ...huntingEquipment.map((snapshot) =>
                    exists(
                      client
                        .select({ one: sql`1` })
                        .from(userItem)
                        .where(
                          and(
                            eq(userItem.id, snapshot.id),
                            eq(userItem.userId, userData.userId),
                            eq(userItem.isInAuction, false),
                            eq(userItem.equipped, snapshot.equipped),
                            eq(userItem.quantity, snapshot.quantity),
                            eq(userItem.durability, snapshot.durability),
                          ),
                        ),
                    ),
                  ),
                  // A merge can hide equipment during the positive-only preload. Reject
                  // unpreloaded rows even if the merge has published before admission.
                  notExists(
                    client
                      .select({ one: sql`1` })
                      .from(userItem)
                      .where(
                        and(
                          eq(userItem.userId, userData.userId),
                          ne(userItem.equipped, "NONE"),
                          ne(userItem.quantity, 0),
                          eq(userItem.isInAuction, false),
                          or(
                            isNull(userItem.craftingFinishedAt),
                            lt(userItem.craftingFinishedAt, new Date()),
                          ),
                          notInArray(
                            userItem.id,
                            huntingEquipment.map((snapshot) => snapshot.id),
                          ),
                        ),
                      ),
                  ),
                ]
              : []),
            ...(info.tournamentGame
              ? [
                  eq(userData.status, "AWAKE"),
                  isNull(userData.battleId),
                  eq(userData.sector, MAP_WAKE_ISLAND_SECTOR),
                  exists(
                    client
                      .select({ one: sql`1` })
                      .from(tournamentMatch)
                      .where(
                        and(
                          eq(tournamentMatch.id, info.tournamentGame.id),
                          eq(tournamentMatch.battleId, battleId),
                          eq(tournamentMatch.state, "WAITING"),
                        ),
                      ),
                  ),
                ]
              : []),
            ...partyQuestSnapshots.map((snapshot) =>
              or(
                ne(userData.userId, snapshot.userId),
                eq(userData.updatedAt, snapshot.updatedAt),
              ),
            ),
            info.questAttempt
              ? questAttemptIsActive(
                  client,
                  info.questAttempt,
                  users.find((u) => u.userId === info.questAttempt?.userId)?.role ??
                    "USER",
                )
              : undefined,
            // Queue spending must match its preload even if movement or another claim raced us.
            ...queuedParticipants.map(({ original }) =>
              or(
                ne(userData.userId, original.userId),
                and(
                  eq(userData.updatedAt, original.updatedAt),
                  eq(userData.status, original.status),
                  eq(userData.sector, original.sector),
                  eq(userData.longitude, original.longitude),
                  eq(userData.latitude, original.latitude),
                  eq(userData.rank, original.rank),
                  ...MasteryNames.map((stat) => eq(userData[stat], original[stat])),
                  ...elementalSnapshotConditions(original),
                  sql`${userData.masteryRanks} = CAST(${JSON.stringify(original.masteryRanks)} AS JSON)`,
                  eq(userData.isBanned, original.isBanned),
                  eq(userData.isOutlaw, original.isOutlaw),
                  original.villageId
                    ? eq(userData.villageId, original.villageId)
                    : isNull(userData.villageId),
                ),
              ),
            ),
            // A refund or swap may finish after preload but before the participant status claim.
            or(
              ...users
                .filter((user) => allParticipantIds.includes(user.userId))
                .map(matchBloodrightSnapshot),
            ),
            // Never move an AI into a battle: its row is shared by everyone
            // fighting it, and the battle state clones it under a fresh id anyway.
            // Redundant with the claim list above, but kept so a drifting AI
            // classification fails the CAS guard instead of claiming a shared row.
            eq(userData.isAi, false),
            // The team roster and awake status must survive preload until the atomic claim.
            ...(questEncounter
              ? [
                  eq(userData.questPartyId, questEncounter.id),
                  eq(userData.status, "AWAKE"),
                ]
              : []),
            ...(info.kageMatch
              ? [
                  eq(userData.status, "AWAKE"),
                  eq(userData.villageId, info.kageMatch.villageId),
                  ...users
                    .filter((u) => userIds.includes(u.userId))
                    .map((u) =>
                      or(
                        ne(userData.userId, u.userId),
                        and(
                          isNull(userData.anbuId),
                          gte(userData.villagePrestige, KAGE_PRESTIGE_REQUIREMENT),
                          eq(userData.rank, u.rank),
                          eq(userData.isBanned, false),
                          eq(userData.isOutlaw, false),
                          lt(
                            userData.joinedVillageAt,
                            secondsFromNow(-KAGE_MIN_DAYS_IN_VILLAGE * 86400 + 1),
                          ),
                        ),
                      ),
                    ),
                ]
              : []),
            ...(info.territoryWar
              ? [
                  eq(userData.sector, info.territoryWar.sector),
                  eq(userData.isBanned, false),
                  exists(
                    client
                      .select({ one: sql`1` })
                      .from(territoryWar)
                      .where(
                        and(
                          eq(territoryWar.id, info.territoryWar.id),
                          isNull(territoryWar.resolvedAt),
                          gt(territoryWar.endsAt, new Date()),
                        ),
                      ),
                  ),
                  ...users
                    .filter((user) => !user.isAi)
                    .map((user) =>
                      or(
                        ne(userData.userId, user.userId),
                        and(
                          eq(userData.isOutlaw, user.isOutlaw),
                          user.clanId
                            ? eq(userData.clanId, user.clanId)
                            : isNull(userData.clanId),
                          user.villageId
                            ? eq(userData.villageId, user.villageId)
                            : isNull(userData.villageId),
                        ),
                      ),
                    ),
                ]
              : []),
            // Ranked participants are claimed straight from the queue, so require
            // QUEUED specifically: a player who just left the queue (now AWAKE)
            // must not be pulled into a ranked battle by a poll whose snapshot
            // predated their leave.
            ["CLAN_BATTLE", "TERRITORY_WAR"].includes(battleType) && info.clanBattle
              ? and(
                  eq(userData.status, "QUEUED"),
                  exists(
                    client
                      .select({ one: sql`1` })
                      .from(mpvpBattleUser)
                      .innerJoin(
                        mpvpBattleQueue,
                        eq(mpvpBattleUser.clanBattleId, mpvpBattleQueue.id),
                      )
                      .where(
                        and(
                          eq(mpvpBattleUser.userId, userData.userId),
                          eq(mpvpBattleQueue.id, info.clanBattle.queueId),
                          eq(mpvpBattleQueue.battleId, battleId),
                        ),
                      ),
                  ),
                )
              : battleType === "RANKED_PVP"
                ? and(
                    eq(userData.status, "QUEUED"),
                    exists(
                      client
                        .select({ one: sql`1` })
                        .from(rankedPvpQueue)
                        .where(
                          and(
                            eq(rankedPvpQueue.userId, userData.userId),
                            eq(rankedPvpQueue.hasClaimed, true),
                          ),
                        ),
                    ),
                  )
                : or(
                    eq(userData.status, "AWAKE"),
                    eq(userData.status, "QUEUED"),
                    info.questAttempt?.isolated &&
                      battleType === "QUEST" &&
                      info.questBattleSource?.questId === info.questAttempt.questId
                      ? and(
                          eq(userData.userId, info.questAttempt.userId),
                          eq(userData.status, "BATTLE"),
                          isNull(userData.battleId),
                        )
                      : undefined,
                  ),
            ...(dungeonEncounter
              ? [
                  eq(userData.status, "AWAKE"),
                  exists(
                    client
                      .select({ one: sql`1` })
                      .from(dungeonRun)
                      .where(
                        and(
                          eq(dungeonRun.id, dungeonEncounter.runId),
                          eq(dungeonRun.version, dungeonEncounter.runVersion),
                          eq(dungeonRun.battleId, battleId),
                          eq(dungeonRun.status, "FIGHTING"),
                          gt(dungeonRun.expiresAt, new Date()),
                        ),
                      ),
                  ),
                ]
              : []),
            // Team members must still occupy the original launch tile after combat preload.
            ...(battleType === "COMBAT" || questEncounter
              ? [
                  and(
                    ...(sector !== undefined ? [eq(userData.sector, sector)] : []),
                    ...(longitude !== undefined
                      ? [eq(userData.longitude, longitude)]
                      : []),
                    ...(latitude !== undefined
                      ? [eq(userData.latitude, latitude)]
                      : []),
                  ),
                ]
              : []),
          ),
        ),
      ...(battleType === "TOURNAMENT"
        ? [
            client
              .update(tournamentMatch)
              .set({ battleId })
              .where(
                or(
                  and(
                    inArray(tournamentMatch.userId1, userIds),
                    inArray(tournamentMatch.userId2, targetIds),
                  ),
                  and(
                    inArray(tournamentMatch.userId2, userIds),
                    inArray(tournamentMatch.userId1, targetIds),
                  ),
                ),
              ),
          ]
        : []),
    ] as const;
    if (hasEntryCharges || info.tournamentGame || info.kageMatch || info.hunting) {
      await writes[0];
      await writes[1];
      const claimedUsers = await writes[2];
      for (const write of writes.slice(3)) await write;
      return { claimedUsers, failed: undefined };
    }
    // Carry failures through training settlement and compensation after every sibling finishes.
    const results = await Promise.allSettled(writes);
    const failed = results.find((result) => result.status === "rejected");
    const claimedUsers = results[2];
    return {
      claimedUsers:
        claimedUsers.status === "fulfilled" ? claimedUsers.value : undefined,
      failed,
    };
  };
  const attempt = info.questAttempt;
  let result: Awaited<ReturnType<typeof createBattle>>;
  // Separate ticket stacks, a receipt and battle inserts must commit together on first payment.
  // Later and no-ticket floors use the existing participant claim and compensation path.
  if (attempt && hasEntryCharges) {
    const player = users.find((u) => u.userId === attempt.userId);
    const committed = await commitQuestEntryBattle({
      client,
      attempt,
      items: entryInventory,
      role: player?.role ?? "USER",
      createBattle,
      didClaim: (result) => result.claimedUsers?.rowsAffected === expectedRows,
    });
    if (!committed.success) return { success: false, message: committed.message };
    result = committed.result;
  } else if (info.kageMatch) {
    // The match receipt, battle and both participant claims commit together. A failed
    // preload or write consumes neither the slot nor a daily/weekly challenge allowance.
    // A single guarded UPDATE cannot also insert the battle/history; throwing on a
    // partial participant claim rolls back all writes instead of publishing half a fight.
    const m = info.kageMatch;
    const rejected = new Error("Kage defense admission changed");
    try {
      result = await retryOnDeadlock(() =>
        client.transaction(async (transaction) => {
          const tx = transaction as unknown as DrizzleClient;
          const launchAt = new Date();
          // Consume consent with the receipt and participant claims so a rejected
          // launch restores the invitation rather than publishing half a fight.
          const leader = await tx
            .update(village)
            .set({
              kageScheduleVersion: sql`${village.kageScheduleVersion} + 1`,
              ...(m.instantRequest?.id && {
                kageSchedule: sql`JSON_REMOVE(${village.kageSchedule}, '$.instantChallenge')`,
              }),
            })
            .where(
              and(
                eq(village.id, m.villageId),
                eq(village.kageId, m.kageId),
                eq(village.leaderUpdatedAt, new Date(m.tenure)),
                ...(m.instantRequest?.id
                  ? [
                      sql`JSON_UNQUOTE(JSON_EXTRACT(${village.kageSchedule}, '$.instantChallenge.id')) = ${m.instantRequest?.id}`,
                      sql`JSON_UNQUOTE(JSON_EXTRACT(${village.kageSchedule}, '$.instantChallenge.matchId')) = ${m.id}`,
                      sql`JSON_UNQUOTE(JSON_EXTRACT(${village.kageSchedule}, '$.instantChallenge.expiresAt')) > ${launchAt.toISOString()}`,
                      sql`JSON_UNQUOTE(JSON_EXTRACT(${village.kageSchedule}, '$.instantChallenge.ai')) = ${String(m.ai)}`,
                    ]
                  : []),
                notExists(
                  tx
                    .select({ id: war.id })
                    .from(war)
                    .where(
                      and(
                        eq(war.type, "VILLAGE_WAR"),
                        eq(war.status, "ACTIVE"),
                        or(
                          eq(war.attackerVillageId, m.villageId),
                          eq(war.defenderVillageId, m.villageId),
                        ),
                      ),
                    ),
                ),
              ),
            );
          if (leader.rowsAffected !== 1) throw rejected;
          const receipt = await tx
            .update(kageDefendedChallenges)
            .set({ status: "BATTLE", battleId, startedAt: launchAt })
            .where(
              and(
                eq(kageDefendedChallenges.id, m.id),
                eq(kageDefendedChallenges.status, "SCHEDULED"),
                eq(kageDefendedChallenges.kageId, m.kageId),
                eq(kageDefendedChallenges.tenure, new Date(m.tenure)),
                eq(kageDefendedChallenges.hospitalDeferred, false),
                ...(m.instantRequest?.id
                  ? [
                      eq(
                        kageDefendedChallenges.scheduledAt,
                        new Date(m.instantRequest.scheduledAt),
                      ),
                    ]
                  : [
                      isNotNull(kageDefendedChallenges.checkedInAt),
                      lte(kageDefendedChallenges.scheduledAt, launchAt),
                      gte(
                        kageDefendedChallenges.scheduledAt,
                        secondsFromDate(-KAGE_DEFENSE_GRACE_MINUTES * 60, launchAt),
                      ),
                    ]),
                m.ai
                  ? and(
                      eq(kageDefendedChallenges.aiRequested, true),
                      eq(kageDefendedChallenges.aiAccepted, true),
                    )
                  : or(
                      eq(kageDefendedChallenges.aiRequested, false),
                      eq(kageDefendedChallenges.aiAccepted, false),
                    ),
              ),
            );
          if (receipt.rowsAffected !== 1) throw rejected;
          const created = await createBattle(tx);
          if (created.claimedUsers?.rowsAffected !== expectedRows) throw rejected;
          return created;
        }),
      );
    } catch (error) {
      if (error === rejected)
        return {
          success: false,
          message: "Match admission changed. Refresh the schedule and try again.",
        };
      throw error;
    }
  } else if (info.hunting) {
    // The session reservation, battle/history inserts and guarded character claim must
    // commit together. The character claim also settles queued training and recovery;
    // a single CAS cannot cover those rows or undo them after a partial admission.
    const meta = info.hunting;
    const rejected = new Error("Hunting admission changed");
    try {
      result = await retryOnDeadlock(() =>
        client.transaction(async (tx) => {
          // Reserve only while the accepted session and allowance remain unchanged.
          const session = await tx
            .update(huntingSession)
            .set({ battleId, version: sql`${huntingSession.version} + 1` })
            .where(
              and(
                eq(huntingSession.userId, meta.userId),
                eq(huntingSession.id, meta.sessionId),
                eq(huntingSession.version, meta.sessionVersion),
                isNull(huntingSession.battleId),
                eq(huntingSession.contractId, meta.contract.id),
                eq(huntingSession.sector, sector ?? -1),
                eq(huntingSession.habitatId, meta.habitatId),
                sql`EXISTS (SELECT 1 FROM ${huntingProgress} WHERE ${huntingProgress.userId} = ${meta.userId} AND ${huntingProgress.contractId} = ${meta.contract.id} AND ${huntingProgress.version} = ${meta.progressVersion})`,
              ),
            );
          if (session.rowsAffected !== 1) throw rejected;
          const created = await createBattle(tx as unknown as DrizzleClient);
          if (created.claimedUsers?.rowsAffected !== expectedRows) throw rejected;
          return created;
        }),
      );
    } catch (error) {
      if (error === rejected)
        return {
          success: false,
          message: "Your hunting session changed. Refresh the board and try again.",
        };
      throw error;
    }
  } else if (info.tournamentGame) {
    // Battle/history inserts and both user claims must commit together. A single-row
    // CAS cannot hide a staged battle from recovery or roll back partial claims'
    // training and pool recovery; status compensation cannot undo those writes.
    const rejected = new Error("Tournament participant claim failed");
    try {
      result = await retryOnDeadlock(() =>
        client.transaction(async (tx) => {
          const created = await createBattle(tx as unknown as DrizzleClient);
          if (created.claimedUsers?.rowsAffected !== expectedRows) throw rejected;
          return created;
        }),
      );
    } catch (error) {
      if (error === rejected)
        return { success: false, message: "Attack failed, did the target move?" };
      throw error;
    }
  } else {
    result = await createBattle(client);
  }

  if (
    queuedParticipants.some(
      (entry) => entry.energy?.completed.length || entry.mastery?.completed.length,
    )
  ) {
    // A partial multi-participant claim still legitimately settles the rows it claimed.
    const claimedIds =
      result.claimedUsers?.rowsAffected === expectedRows
        ? allParticipantIds
        : (
            await client.query.userData.findMany({
              columns: { userId: true },
              where: eq(userData.battleId, battleId),
            })
          ).map((row) => row.userId);
    const claimed = queuedParticipants.filter((entry) =>
      claimedIds.includes(entry.user.userId),
    );
    const logs = claimed.flatMap((entry) => [
      ...(entry.energy?.completed ?? []).map((completed) => ({
        userId: entry.user.userId,
        stat: completed.stat,
        amount: completed.amount,
        speed: entry.original.trainingSpeed,
        trainingFinishedAt: new Date(),
      })),
      ...(entry.mastery?.completed ?? []).map((completed) => ({
        userId: entry.user.userId,
        stat: completed.stat,
        amount: completed.amount,
        speed: completed.speed,
        trainingFinishedAt: completed.finishedAt,
      })),
    ]);
    if (logs.length) {
      try {
        await client.insert(trainingLog).values(logs);
      } catch (error) {
        Sentry.captureException(error, { tags: { source: "energyTrainingQueueLog" } });
      }
    }
  }

  // Undo only this battle's claims and rows, including successful siblings of a failed write.
  if (result.failed || result.claimedUsers?.rowsAffected !== expectedRows) {
    await Promise.all([
      client
        .update(userData)
        .set({
          status: info.questAttempt?.isolated
            ? sql`CASE WHEN ${userData.userId} = ${info.questAttempt.userId} THEN 'BATTLE' ELSE ${battleClaimRollbackStatus(client, battleType)} END`
            : battleClaimRollbackStatus(client, battleType),
          bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
          bracketImmunityPausedAt: null,
          battleId: null,
        })
        .where(eq(userData.battleId, battleId)),
      client.delete(battle).where(eq(battle.id, battleId)),
      client.delete(battleHistory).where(eq(battleHistory.battleId, battleId)),
    ]);
    if (result.failed) throw result.failed.reason;
    return { success: false, message: "Attack failed, did the target move?" };
  }

  // Push websockets message to target
  notifyBattleDefenders(client, {
    battleId,
    battleType,
    initiatorIds: info.userIds,
    users,
  });
  const pusher = getServerPusher();

  // Keep human fighters on the sector map as combat markers so nearby players
  // can see who is fighting. AI templates are not sector-map entities and must
  // not be broadcast. Auto-battles stay off this broadcast.
  if (!AutoBattleTypes.includes(battleType)) {
    await Promise.all(
      users.map(async (user) => {
        await Promise.all([
          pusher.trigger(user.userId, "event", { type: "battle", battleId }),
          ...(!user.isAi
            ? [
                updateUserOnMap(pusher, user.sector, {
                  ...user,
                  status: "BATTLE",
                  battleId,
                }),
              ]
            : []),
        ]);
      }),
    );
  }

  // Return the battle
  return { success: true, message: "You have attacked", battleId };
};

const summonCycleCause = Symbol("summonCycle");

/** Expected content failures use the mutation response contract; other failures still propagate. */
const handleSummonPreloadError = (error: unknown) => {
  if (error instanceof Error && error.cause === summonCycleCause) return error;
  throw error;
};

/** Check recursive loads; references satisfied within a batch already terminate. */
const assertAcyclicSummons = (dependencies: Map<string, Set<string>>) => {
  const visited = new Set<string>();
  const path: string[] = [];
  const stack = new Map<string, number>();
  const visit = (id: string) => {
    const cycleStart = stack.get(id);
    if (cycleStart !== undefined) {
      throw new Error(
        `Cannot start battle: cyclic summon definitions (${[...path.slice(cycleStart), id].join(" → ")}). Please report this to staff.`,
        { cause: summonCycleCause },
      );
    }
    if (visited.has(id)) return;
    visited.add(id);
    stack.set(id, path.length);
    path.push(id);
    for (const target of dependencies.get(id) ?? []) visit(target);
    path.pop();
    stack.delete(id);
  };
  for (const id of dependencies.keys()) visit(id);
};

/**
 * Transform preloaded combat participants into battle state and shared static data.
 * An ordered `leftSideUserCount` takes precedence over ID-based team membership,
 * allowing copies of the same NPC template on opposite sides. Lobby and summon
 * callers may use `leftSideUserIds` instead. Spawn cells are allocated without reuse;
 * initiation validates capacity before calling this function.
 * Companion species summons join initiation's preload so their effect dispatch needs no reads.
 * Ranked players normalize to endgame levels; other Elite players retain earned milestone levels.
 * Recursive summon loads reject cycles; references satisfied by the same batch remain valid.
 *
 * @param client - Database client for participant processing that requires persisted state.
 * @param info - Preloaded users, combat relations, team boundary and battlefield dimensions.
 * @returns User and ground effects, combatant states, durability and static `extraState` data.
 */
export const processUsersForBattle = async (
  client: DrizzleClient,
  info: {
    users: CombatQueryUser[];
    settings: GameSetting[];
    relations: VillageAlliance[];
    wars: BattleWar[];
    villages: Village[];
    defaultProfile: AiProfile;
    battleType: BattleType;
    hide: boolean;
    leftSideUserIds?: string[];
    /** Ordered team boundary, allowing the same AI template on opposing teams. */
    leftSideUserCount?: number;
    isSummon: boolean;
    /** Raw rows shared only within one preparation; every transformation receives a clone. */
    summonTemplateCache?: Map<string, Promise<CombatQueryUser[]>>;
    width: number;
    height: number;
    petPreload?: Pick<
      Parameters<typeof addPetsToBattle>[0],
      "pets" | "ownerRanks" | "abilitiesByOwner"
    >;
  },
  summonDependencies = new Map<string, Set<string>>(),
) => {
  // Destructure
  const {
    users,
    settings,
    relations,
    battleType,
    hide,
    leftSideUserIds,
    leftSideUserCount,
    width,
    height,
  } = info;
  // Snapshot owner-specific variants before building battle state. Action processing
  // subsequently resolves cosmetics entirely from extraState, without database reads.
  const linkedJutsuReskins = await fetchBloodlineJutsuReskins(
    client,
    users
      .filter((user) => !user.isAi && user.bloodlineReskinId)
      .map((user) => user.userId),
  );
  for (const user of users) {
    user.jutsus = user.jutsus.map((owned) => ({
      ...owned,
      linkedReskin:
        linkedJutsuReskins.find(
          (row) =>
            row.userId === user.userId &&
            row.jutsu.reskinParentJutsuId === owned.jutsuId,
        )?.jutsu ?? null,
    }));
  }
  // Collect user effects here
  // Companion skills share the summon preload pipeline with character abilities.
  const allSummons: string[] = (info.petPreload?.pets ?? []).flatMap((pet) =>
    (pet.species?.effects ?? []).flatMap((effect) =>
      effect.type === "summon" ? [effect.aiId] : [],
    ),
  );
  const userEffects: UserEffect[] = [];
  const groundEffects: GroundEffect[] = [];
  const enemySkills: NonNullable<ExtraState["enemySkills"]> = {};
  const pendingSkillEffects: {
    creatorId: string;
    skillId: string;
    effects: UserEffect[];
    level: number;
  }[] = [];
  const takenLocations: { x: number; y: number }[] = [];
  const batchUserIds = new Set(users.map((user) => user.userId));

  // Loop through users and transform to ProcessingBattleUser
  const usersState: ProcessingBattleUser[] = users.map((inputUser, index) => {
    const dependencies = summonDependencies.get(inputUser.userId) ?? new Set<string>();
    const addSummon = (id: string) => {
      allSummons.push(id);
      // Self-summoning NPCs and references to this batch use its existing actors.
      // Only edges that actually recurse can prevent preloading from completing.
      if (!batchUserIds.has(id)) dependencies.add(id);
    };
    // Build the processing user object with all required fields
    const user: ProcessingBattleUser = {
      ...inputUser,
      // Freeze the choice before bloodline processing and later profile edits, including ranked battles.
      preferredDamageElement: getPreferredDamageElement(inputUser),
      // Set controllerID and mark this user as the original
      controllerId: inputUser.userId,
      enemySkillIds: [],
      userId: inputUser.isAi ? nanoid() : inputUser.userId,
      // The ordered boundary distinguishes duplicate templates on opposing teams.
      direction: (
        leftSideUserCount !== undefined
          ? index < leftSideUserCount
          : leftSideUserIds?.includes(inputUser.userId)
      )
        ? "left"
        : "right",
      // Set the updated at to now, so that action bar starts at 0
      updatedAt: new Date(),
      // If no village, set to syndicate
      villageId: inputUser.villageId || VILLAGE_SYNDICATE_ID,
      // Set all users to not be agressors by default
      isAggressor: false,
      // Initialize processing-specific fields (will be set below)
      highestGenerals: [],
      round: 0,
      iAmHere: false,
      originalLevel: inputUser.level,
      originalMoney: inputUser.money,
      originalLongitude: inputUser.longitude,
      originalLatitude: inputUser.latitude,
      actionPoints: 100,
      isOriginal: true,
      isSummon: info.isSummon,
      usedGenerals: { strength: 0, intelligence: 0, willpower: 0, speed: 0 },
      usedStats: {
        offence: 0,
        defence: 0,
      },
      leftBattle: false,
      fledBattle: false,
      moneyStolen: 0,
      allyVillage: false,
      usedActions: [],
      usedTagTypes: [],
      damageDealt: 0,
      enmity: 0,
      initiative: 0,
      basicActions: [],
      sageModeActivated: inputUser.sageModeActivated ?? false,
      sageModeActivatedRound: inputUser.sageModeActivatedRound ?? null,
      sageModeExpiresRound: inputUser.sageModeExpiresRound ?? null,
      sageModeUsedThisBattle: inputUser.sageModeUsedThisBattle ?? false,
      // Add default AI profile if not set
      aiProfile: inputUser.aiProfile ?? info.defaultProfile,
      // Compatibility fields for ReturnedUserState (populated later during conversion)
      relationIds: [],
      // Initialize jutsus and items (will be processed below)
      jutsus: inputUser.jutsus
        .filter((uj) => {
          if (!uj.jutsu) {
            console.error(`Jutsu not found for UserJutsu ${uj.id}`);
            return false;
          }
          return true;
        })
        .map((uj) => ({
          ...uj,
          lastUsedRound: -uj.jutsu.cooldown,
          originalCooldown: uj.jutsu.cooldown,
        })),
      items: inputUser.items
        .filter((ui) => {
          if (!ui.item) {
            console.error(`Item not found for UserItem ${ui.id}`);
            return false;
          }
          return true;
        })
        .map((ui) => ({
          ...ui,
          lastUsedRound: -ui.item.cooldown,
          originalCooldown: ui.item.cooldown,
        })),
    };

    // Add regen to pools. Pools are not updated "live" in the database, but rather are calculated on the frontend
    // Therefore we need to calculate the current pools here, before inserting the user into battle
    const baseRegen = calcActiveUserRegen(user, settings, false);
    const restored =
      inputUser.status === "BATTLE"
        ? 0
        : getTimedRegenerationGain(
            baseRegen,
            regenerationBuffs(inputUser),
            // Lobby reconstruction reads this timestamp from battle JSON.
            new Date(user.regenAt),
            Math.max(0, Math.floor(secondsPassed(user.regenAt) / REGEN_SECONDS)),
            REGEN_SECONDS,
          );
    user.curHealth = Math.min(user.curHealth + restored, user.maxHealth);
    user.curChakra = Math.min(user.curChakra + restored, user.maxChakra);
    user.curStamina = Math.min(user.curStamina + restored, user.maxStamina);

    // Reskin bloodline if needed
    if (user.bloodline && inputUser.activeReskin) {
      user.bloodline = getReskinnedBloodline(user.bloodline, inputUser.activeReskin);
    }

    // For kage challenges, set health/chakra/stamina to full
    if (["KAGE_AI", "KAGE_PVP"].includes(battleType)) {
      user.curHealth = user.maxHealth;
      user.curChakra = user.maxChakra;
      user.curStamina = user.maxStamina;
    }

    // Ranked players use the endgame level and pools regardless of their progression.
    if (
      (battleType === "RANKED_PVP" || battleType === "RANKED_SPARRING") &&
      !user.isAi
    ) {
      user.maxHealth = calcHP(MAX_PLAYER_LEVEL);
      user.maxChakra = calcCP(MAX_PLAYER_LEVEL);
      user.maxStamina = calcSP(MAX_PLAYER_LEVEL);
      user.curHealth = user.maxHealth;
      user.curChakra = user.maxChakra;
      user.curStamina = user.maxStamina;
      user.level = MAX_PLAYER_LEVEL;
      user.experience = calcLevelRequirements(MAX_PLAYER_LEVEL);
      user.rank = "ELITE JONIN";
      user.medicalExperience = 100000;
    }

    // Add highest generals to user
    const generals = {
      strength: user.strength,
      intelligence: user.intelligence,
      willpower: user.willpower,
      speed: user.speed,
    } as const;

    type generalKey = keyof typeof generals;

    if (user.preferredGeneral1 && user.preferredGeneral2) {
      // If both generals are already set, just use them
      user.highestGenerals = [
        user.preferredGeneral1.toLowerCase(),
        user.preferredGeneral2.toLowerCase(),
      ] as generalKey[];
    } else {
      // Sort generals by value
      const sortedStats = Object.entries(generals)
        .sort(([, a], [, b]) => b - a)
        .map(([stat]) => stat) as generalKey[];

      if (user.preferredGeneral1) {
        // If first general is set, find the highest from remaining
        const firstGenLower = user.preferredGeneral1.toLowerCase() as generalKey;
        const secondGeneral =
          sortedStats.find((stat) => stat !== firstGenLower) ?? sortedStats[0];
        user.highestGenerals = [firstGenLower, secondGeneral ?? firstGenLower];
      } else if (user.preferredGeneral2) {
        // If second general is set, find the highest from remaining
        const secondGenLower = user.preferredGeneral2.toLowerCase() as generalKey;
        const firstGeneral =
          sortedStats.find((stat) => stat !== secondGenLower) ?? sortedStats[0];
        user.highestGenerals = [firstGeneral ?? secondGenLower, secondGenLower];
      } else {
        // If no generals are set, take the two highest
        user.highestGenerals = sortedStats.slice(0, 2);
      }
    }

    // Update user level to the effective level if he had leveled up (to combat level-holding, as some things are scaled based on level)
    // Ranked battles keep their normalized level.
    if (battleType !== "RANKED_SPARRING" && battleType !== "RANKED_PVP") {
      user.level = getEffectiveLevel(user);
    }

    // Store original location
    user.originalLongitude = user.longitude;
    user.originalLatitude = user.latitude;

    // Default locaton
    if (hide) {
      user.longitude = 0;
      user.latitude = 0;
      user.curHealth = 0;
    } else if (leftSideUserCount !== undefined || leftSideUserIds?.length) {
      const available = getBattleSpawnLocations(width, height, user.direction).filter(
        (location) =>
          !takenLocations.some(
            (taken) => taken.x === location.x && taken.y === location.y,
          ),
      );
      const location = available.length
        ? available[secureRandomInt(available.length)]
        : undefined;
      if (!location) throw new Error("No free battle spawn locations");
      takenLocations.push(location);
      user.longitude = location.x;
      user.latitude = location.y;
    }

    if (
      (battleType === "COMBAT" || battleType === "SHRINE_WAR") &&
      info.wars.some((w) => w.warMercenaries?.some((m) => m.userId === user.userId))
    ) {
      user.isMasked = true;
      user.username = "Mercenary";
      user.avatar = IMG_AVATAR_DEFAULT;
      user.avatarLight = IMG_AVATAR_DEFAULT;
    }

    // Hide ANBU members who are being attacked (defenders)
    if (
      !user.isMasked &&
      user.anbuId &&
      user.anbuSquad &&
      battleType === "COMBAT" &&
      !leftSideUserIds?.includes(user.userId)
    ) {
      user.username = "ANBU Member";
      user.avatar = user.anbuSquad.image;
      user.avatarLight = user.anbuSquad.image;
    }

    // For ally village check later (and formerly for village wall defence bonus)
    const ownSector = user.sector === user.village?.sector;
    const inVillage = calcIsInVillage({ x: user.longitude, y: user.latitude });

    // Quest battles exclude PVP-only content, all other battles PVE-only content
    const isQuestBattle = QuestBattleTypes.includes(battleType);
    const fitsBattle = (usage: BattleUsageType) =>
      isQuestBattle ? usage !== "PVP" : usage !== "PVE";

    const requirementSkills = user.userSkills;
    user.activeSkillIds = inputUser.isAi
      ? undefined
      : requirementSkills
          .filter((skill) => skill.activated)
          .map((skill) => skill.skillId);
    // Furniture never enters battle, even when old inventory rows still have an
    // equipment slot or drop chance. Filter before mastery and jutsu item gates.
    user.items = user.items.filter(
      (ui) =>
        ui.item.itemType !== "FURNITURE" &&
        (user.isAi || hasRequiredSkill(ui.item, { userSkills: requirementSkills })),
    );

    // The mastery sources this battle applies; ranked battles skip bloodline and skills
    const isRankedBattle =
      battleType === "RANKED_PVP" || battleType === "RANKED_SPARRING";
    const wearer = {
      ...user,
      bloodline: isRankedBattle ? null : user.bloodline,
      userSkills: isRankedBattle ? [] : user.userSkills,
      titles: isRankedBattle ? [] : inputUser.titles,
      items: user.items.filter((ui) => fitsBattle(ui.item.battleUsageType)),
    };
    // Unequip worn gear that cannot work this battle before the jutsu filter and the
    // keystone read the equipped state; left equipped, it would lose durability for nothing.
    // Never saved, so repairing it or training the mastery restores it.
    user.items
      .filter(
        (ui) =>
          ui.equipped !== "NONE" &&
          isWornGear(ui.item) &&
          isWornGearDisabled(ui, wearer, isRankedBattle),
      )
      .forEach((ui) => {
        ui.equipped = "NONE";
      });
    const gateMasteries = effectiveMasteries(wearer);

    // Capture the unlocked element's passive once; action processing uses only battle state.
    const trainedElement = activeTrainedElement(user);
    if (trainedElement && !isRankedBattle) {
      const realized = realizeTag({
        tag: IncreaseDamageGivenTag.parse({
          power: ELEMENTAL_MASTERY_BOOST,
          elements: [trainedElement],
          target: "SELF",
        }) as UserEffect,
        user,
        actionId: "elemental-mastery",
        target: user,
        level: user.level,
      });
      realized.isNew = false;
      realized.castThisRound = false;
      realized.targetId = user.userId;
      realized.fromType = "elementalMastery";
      userEffects.push(realized);
    }

    // Ranked replaces unique bloodline effects with a uniform, sealable damage bonus.
    if (user.bloodline) {
      const effects = isRankedBattle
        ? user.isAi
          ? []
          : [{ ...RANKED_BLOODLINE_DAMAGE_TAG }]
        : (user.bloodline.effects ?? []);
      effects.forEach((effect: unknown) => {
        const realized = realizeTag({
          tag: effect as UserEffect,
          user,
          actionId: user.bloodline?.id ?? "initial",
          target: user,
          level: user.level,
        });
        realized.isNew = false;
        realized.castThisRound = false;
        realized.targetId = user.userId;
        realized.fromType = "bloodline";
        userEffects.push(realized);
      });
    }

    // Bloodright is preloaded at initiation and uses the same passive effect pipeline.
    for (const tier of inputUser.bloodline?.bloodrightTiers ?? []) {
      if (
        tier.pathType === "BLOODRIGHT" &&
        user.bloodright.some((entry) => entry.skillId === tier.id)
      ) {
        user.userSkills.push({
          id: tier.id,
          userId: user.userId,
          skillId: tier.id,
          activated: true,
          purchasedAt: new Date(),
          skill: tier,
        });
      }
    }

    // Add skill tree effects
    if (
      user.userSkills &&
      user.userSkills.length > 0 &&
      battleType !== "RANKED_PVP" &&
      battleType !== "RANKED_SPARRING"
    ) {
      user.userSkills.forEach(
        (userSkill: {
          skillId: string;
          skill: { target?: string; effects?: unknown[] };
        }) => {
          const skill = userSkill.skill;
          if (!skill?.effects || skill.effects.length === 0) return;

          // Self-targeted effects can be applied immediately
          if (!skill.target || skill.target === "SELF") {
            skill.effects.forEach((effect: unknown) => {
              const realized = realizeTag({
                tag: effect as UserEffect,
                user: user,
                actionId: userSkill.skillId,
                target: user,
                level: user.level,
              });
              realized.isNew = false;
              realized.castThisRound = false;
              realized.targetId = user.userId;
              realized.fromType = "skill";
              userEffects.push(realized);
            });
          } else if (skill.target === "ENEMIES") {
            user.enemySkillIds ??= [];
            user.enemySkillIds.push(userSkill.skillId);
            enemySkills[userSkill.skillId] = structuredClone(
              skill.effects,
            ) as NonNullable<ExtraState["enemySkills"]>[string];
            for (const effect of enemySkills[userSkill.skillId] ?? []) {
              if (effect.type === "summon") addSummon(effect.aiId);
            }
          } else if (skill.target === "ALLIES") {
            pendingSkillEffects.push({
              creatorId: user.userId,
              skillId: userSkill.skillId,
              effects: skill.effects as unknown as UserEffect[],
              level: user.level,
            });
          }
        },
      );
      user.userSkills = []; // Reset to avoid storing in battle table
    }

    if (!isRankedBattle) {
      for (const owned of inputUser.titles ?? []) {
        for (const effect of owned.effects) {
          if (effect.type !== "increasemastery") continue;
          const realized = realizeTag({
            tag: titleCombatTag(effect) as UserEffect,
            user,
            actionId: owned.titleId,
            target: user,
            level: 0,
          });
          realized.isNew = false;
          realized.castThisRound = false;
          realized.targetId = user.userId;
          // Clear cannot remove permanent ownership bonuses; reuse the protected skill source.
          realized.fromType = "skill";
          userEffects.push(realized);
        }
      }
    }
    // Ownership was resolved at initiation; actions only consume realized battle effects.
    delete user.titles;

    for (const buff of inputUser.raidBuffs ?? []) {
      if (buff.expiresAt <= new Date()) continue;
      for (const effect of buff.effects) {
        if (effect.type === "increaseregeneration") continue;
        const realized = realizeTag({
          tag: { ...effect, rounds: undefined, powerPerLevel: 0 } as UserEffect,
          user,
          actionId: buff.id,
          target: user,
          level: 0,
        });
        realized.isNew = false;
        realized.castThisRound = false;
        realized.targetId = user.userId;
        realized.fromType = "item";
        realized.timedBuffExpiresAt = buff.expiresAt.getTime();
        userEffects.push(realized);
      }
    }
    user.raidBuffs = undefined;

    // Add users effects to the battle
    if (user.effects.length > 0) {
      user.effects.forEach((effect: unknown) => {
        const realized = realizeTag({
          tag: effect as UserEffect,
          user: user,
          actionId: "initial",
          target: user,
          level: user.level,
        });
        realized.isNew = false;
        realized.castThisRound = false;
        realized.targetId = user.userId;
        realized.fromType = "bloodline";
        userEffects.push(realized);
      });
      user.effects = []; // Reset to avoid storing in battle table
    }

    // Filter and process jutsus - DO NOT apply reskins here, they are applied dynamically
    // in userJutsuToAction to ensure each user sees their own reskin.
    // user.userSkills was cleared for storage above; gates read the captured skills.
    const gateUser = { ...user, userSkills: requirementSkills };
    const processedJutsus = user.jutsus
      .map((userjutsu) => ({
        ...userjutsu,
        lastUsedRound: userjutsu.lastUsedRound,
        originalCooldown: userjutsu.originalCooldown,
      }))
      .filter((userjutsu) => {
        // Not if no jutsu
        if (!userjutsu.jutsu) {
          return false;
        }
        if (!fitsBattle(userjutsu.jutsu.battleUsageType)) {
          return false;
        }
        // Shared with the combat lobby so loadout switches never keep jutsu dropped here.
        if (
          battleJutsuGateFailure(userjutsu.jutsu, gateUser, battleType, gateMasteries)
        ) {
          return false;
        }
        // Add summons to list only for jutsus that survived every gate above
        const effects = userjutsu.jutsu.effects as UserEffect[];
        effects
          .filter((e) => e.type === "summon")
          .forEach((e) => {
            if ("aiId" in e) addSummon(e.aiId);
          });
        return true;
      });
    user.jutsus = processedJutsus;

    // Add basic actions to user for tracking cooldowns
    user.basicActions = Object.values(getDefaultBasicActions(user));

    // Sort if we have a loadout
    if (user?.loadout?.jutsuIds) {
      user.jutsus.sort((a, b) => {
        const aIndex = user?.loadout?.jutsuIds.indexOf(a.jutsuId) ?? -1;
        const bIndex = user?.loadout?.jutsuIds.indexOf(b.jutsuId) ?? -1;
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    }

    // Determine equipped keystone item name for quick display later
    const keystoneItem = user.items.find(
      (useritem) =>
        useritem.item &&
        useritem.item.itemType === "KEYSTONE" &&
        useritem.equipped === "KEYSTONE",
    );
    user.keystoneName = keystoneItem?.item.name ?? null;
    user.keystoneItem = keystoneItem?.item ?? null;

    // Add item effects
    const items: ProcessedItem[] = [];
    user.items
      .filter((ui) => {
        if (!ui.item) return false;
        if (!fitsBattle(ui.item.battleUsageType)) return false;
        // Always include equipment (ARMOR, ACCESSORY, KEYSTONE) and consumables (WEAPON, CONSUMABLE) as they need to be processed for effects
        if (
          ["ARMOR", "ACCESSORY", "KEYSTONE", "WEAPON", "CONSUMABLE"].includes(
            ui.item.itemType,
          )
        )
          return true;
        // For other items, include if they don't prevent battle usage or are droppable
        return !ui.item.preventBattleUsage || ui.dropChancePerc > 0;
      })
      .forEach((ui) => {
        // Add imbuement effects only when the item still allows imbuing
        // (legacy crystals on canBeImbued=false items stay in inventory but not combat).
        // Rows rebuilt from battle state carry them as imbuementEffects.
        const imbuementEffects = ui.item.canBeImbued
          ? (ui.imbuementEffects ??
            ui.imbuements?.flatMap(
              (imbuement) => imbuement.item.effects as UserEffect[],
            ) ??
            [])
          : [];
        // Imbuements belong to this user item, not to the shared item template in
        // extraState.items, so they are stored on the row rather than merged into it.
        ui.imbuementEffects = structuredClone(imbuementEffects);
        ui.imbuements = []; // Reset to avoid storing in battle table
        // Parse item
        const effects = [...(ui.item.effects as UserEffect[]), ...imbuementEffects];
        const itemType = ui.item.itemType;
        // Parse the effects
        effects
          .filter((e) => e.type === "summon")
          .forEach((e) => {
            if ("aiId" in e) addSummon(e.aiId);
          });
        // Add item effects to user
        if (
          itemType === "ARMOR" ||
          itemType === "ACCESSORY" ||
          itemType === "KEYSTONE"
        ) {
          // Add item effects to user (only if user has required bloodline)
          if (
            ui.item.effects &&
            ui.equipped !== "NONE" &&
            (!ui.item.bloodlineId || ui.item.bloodlineId === user.bloodlineId)
          ) {
            effects.forEach((effect) => {
              const realized = realizeTag({
                tag: effect,
                user: user,
                actionId: ui.itemId,
                target: user,
                // AI gear can never earn item XP; keep character-level scaling
                // for AI so boss/raid content is not silently nerfed to level 1.
                level: user.isAi ? user.level : ui.level,
              });
              realized.isNew = false;
              realized.fromType =
                itemType === "ACCESSORY"
                  ? "accessory"
                  : itemType === "KEYSTONE"
                    ? "keystone"
                    : "armor";
              realized.castThisRound = false;
              realized.targetId = user.userId;
              userEffects.push(realized);
            });
          }
        }
        // If droppable, action type, or equipment/consumable type (ARMOR/ACCESSORY/KEYSTONE/WEAPON/CONSUMABLE), keep in battle row (only if user has required bloodline)
        if (
          ui.dropChancePerc > 0 ||
          !NonActionItemTypes.includes(itemType) ||
          ["ARMOR", "ACCESSORY", "KEYSTONE", "WEAPON", "CONSUMABLE"].includes(itemType)
        ) {
          // Check bloodline requirement for weapons and other action items
          if (!ui.item.bloodlineId || ui.item.bloodlineId === user.bloodlineId) {
            items.push({
              ...ui,
              lastUsedRound: -ui.item.cooldown,
              originalCooldown: ui.item.cooldown,
            });
          }
        }
      });
    user.items = items;

    // Base values
    user.fledBattle = false;
    user.leftBattle = false;
    user.moneyStolen = 0;

    // Roll initiative
    user.initiative = rollInitiative(user, users, user.village?.sector);

    // Add relevant relations to usersState
    user.relations = relations.filter(
      (r) => r.villageIdA === user.villageId || r.villageIdB === user.villageId,
    );

    // Check if we are in ally village or not
    user.allyVillage = false;
    if (inVillage && !ownSector) {
      const sector = info.villages.find((v) => v.sector === user.sector);
      if (sector) {
        const relationship = findRelationship(relations, user.villageId, sector.id);
        if (relationship?.status === "ALLY") {
          user.allyVillage = true;
        }
      }
    }

    if (!user.isSummon && AutoBattleTypes.includes(info.battleType)) {
      user.curHealth = user.maxHealth;
      user.curChakra = user.maxChakra;
      user.curStamina = user.maxStamina;
      user.isAi = true;
      user.isOriginal = false;
    }

    summonDependencies.set(inputUser.userId, dependencies);
    return user;
  });

  assertAcyclicSummons(summonDependencies);

  const summonTemplateCache =
    info.summonTemplateCache ?? new Map<string, Promise<CombatQueryUser[]>>();

  // Track summon data to merge later
  let summonUsersState: BattleUserState[] = [];
  let summonExtraState: ExtraState | null = null;

  // If there are any summonAIs defined, then add them to usersState, but disable them.
  // Match on controllerId: processed users carry their DB userId in controllerId
  // (userId becomes a nanoid for AI), and allSummons holds DB aiIds — so this
  // skips templates already present instead of always re-fetching them.
  const summonsToProcess = [
    ...new Set(allSummons.filter((s) => !usersState.find((u) => u.controllerId === s))),
  ];
  if (summonsToProcess.length > 0) {
    const missingSummonIds = summonsToProcess.filter(
      (id) => !summonTemplateCache.has(id),
    );
    if (missingSummonIds.length > 0) {
      // Cache a real promise: awaiting a Drizzle thenable again would execute another query.
      const pending = (async () => {
        const rows = await client.query.userData.findMany({
          with: {
            bloodline: { with: { bloodrightTiers: true } },
            sageMode: true,
            village: true,
            items: {
              with: {
                item: { with: { variants: true } },
                imbuements: {
                  with: { item: true },
                  where: (imbuements) => lt(imbuements.craftingFinishedAt, new Date()),
                },
              },
              where: (items) => and(gt(items.quantity, 0), isNotNull(items.equipped)),
            },
            jutsus: {
              with: { jutsu: true },
              where: (jutsus) => eq(jutsus.equipped, true),
            },
            userSkills: {
              with: { skill: true },
            },
            aiProfile: true,
          },
          where: inArray(userData.userId, missingSummonIds),
        });
        return rows;
      })();
      for (const id of missingSummonIds) {
        summonTemplateCache.set(id, pending);
      }
    }
    // Preserve database row order within each cached batch, including its first use.
    const requestedSummonIds = new Set(summonsToProcess);
    const summons = structuredClone(
      (
        await Promise.all(
          new Set(summonsToProcess.map((id) => summonTemplateCache.get(id))),
        )
      ).flatMap(
        (rows) => rows?.filter((row) => requestedSummonIds.has(row.userId)) ?? [],
      ),
    );
    if (summons.length > 0) {
      const {
        userEffects: summonEffects,
        usersState: summonState,
        extraState: summonSD,
      } = await processUsersForBattle(
        client,
        {
          users: summons,
          summonTemplateCache,
          settings: info.settings,
          relations: info.relations,
          wars: info.wars,
          villages: info.villages,
          defaultProfile: info.defaultProfile,
          battleType: info.battleType,
          width: info.width,
          height: info.height,
          hide: true,
          isSummon: true,
        },
        summonDependencies,
      );
      summonState.forEach((u) => {
        u.iAmHere = true;
        u.isSummonTemplate = true; // mark hidden clone-source templates
      });
      userEffects.push(...summonEffects);
      summonUsersState = summonState;
      summonExtraState = summonSD;
    }
  }

  // Compute initial durability before conversion (needs item.item access)
  const initialDurability: Record<string, Record<string, number>> = {};
  usersState.forEach((user) => {
    initialDurability[user.userId] = {};
    const userDurability = initialDurability[user.userId];
    user.items.forEach(
      (item: { id: string; durability: number; item?: { maxDurability?: number } }) => {
        if (item.item?.maxDurability && item.item.maxDurability > 0 && userDurability) {
          userDurability[item.id] = item.durability;
        }
      },
    );
  });

  // Build extraState from all users
  const extraState: ExtraState = {
    jutsus: {},
    jutsuReskins: {},
    items: {},
    bloodlines: {},
    enemySkills,
    sageModes: {},
    villages: {},
    anbuSquads: {},
    keystoneItems: {},
    wars: {},
    aiProfiles: {},
    relations: {},
    clans: {},
    userQuests: {},
    completedQuests: {},
    questData: {},
    bounties: {},
    bountySignups: {},
  };

  // Add wars to extraState
  for (const w of info.wars) {
    if (!extraState.wars[w.id]) {
      extraState.wars[w.id] = w;
    }
  }

  // Add relations to extraState
  for (const r of info.relations) {
    if (!extraState.relations[r.id]) {
      extraState.relations[r.id] = r;
    }
  }

  // Add default AI profile
  extraState.aiProfiles.Default = info.defaultProfile;

  // Process each user to extract static data
  for (const user of usersState) {
    // Add jutsus
    for (const uj of user.jutsus) {
      if (uj.linkedReskin) extraState.jutsus[uj.linkedReskin.id] = uj.linkedReskin;
      if (uj.jutsu && !extraState.jutsus[uj.jutsuId]) {
        extraState.jutsus[uj.jutsuId] = uj.jutsu;
      }
      if (uj.activeReskin && !extraState.jutsuReskins[uj.activeReskin.id]) {
        extraState.jutsuReskins[uj.activeReskin.id] = uj.activeReskin;
      }
    }

    // Add items
    for (const ui of user.items) {
      if (ui.item && !extraState.items[ui.itemId]) {
        extraState.items[ui.itemId] = ui.item;
      }
    }

    // Add village
    if (user.village && user.villageId && !extraState.villages[user.villageId]) {
      extraState.villages[user.villageId] = user.village;
    }

    // Add anbuSquad
    if (user.anbuSquad && user.anbuId && !extraState.anbuSquads[user.anbuId]) {
      extraState.anbuSquads[user.anbuId] = user.anbuSquad;
    }

    // Add clan
    if (user.clan && user.clanId && !extraState.clans[user.clanId]) {
      extraState.clans[user.clanId] = user.clan;
    }

    // Add bloodline
    if (
      user.bloodline &&
      user.bloodlineId &&
      !extraState.bloodlines[user.bloodlineId]
    ) {
      extraState.bloodlines[user.bloodlineId] = user.bloodline;
    }

    // Add sage mode definition (user carries sageModeId + sageMasteryExperience on state)
    if (user.sageMode && user.sageModeId && !extraState.sageModes[user.sageModeId]) {
      extraState.sageModes[user.sageModeId] = user.sageMode;
    }

    // Add keystone item
    if (user.keystoneItem && !extraState.keystoneItems[user.keystoneItem.id]) {
      extraState.keystoneItems[user.keystoneItem.id] = user.keystoneItem;
    }

    // Add AI profile (keyed by profile id, not controllerId)
    if (user.aiProfile && !extraState.aiProfiles[user.aiProfile.id]) {
      extraState.aiProfiles[user.aiProfile.id] = user.aiProfile;
    }

    // Add userQuests (static - don't change during battle)
    if (user.userQuests && user.userQuests.length > 0) {
      extraState.userQuests[user.controllerId] = user.userQuests;
    }

    // Add completedQuests (static - don't change during battle)
    if (user.completedQuests && user.completedQuests.length > 0) {
      extraState.completedQuests[user.controllerId] = user.completedQuests;
    }

    // Add questData (quest progress trackers)
    if (user.questData && user.questData.length > 0) {
      extraState.questData[user.controllerId] = user.questData;
    }

    // Add bounties (static - don't change during battle)
    if (user.bounties && user.bounties.length > 0) {
      extraState.bounties[user.controllerId] = user.bounties;
    }

    // Add bountySignups (static - don't change during battle)
    if (user.bountySignups && user.bountySignups.length > 0) {
      extraState.bountySignups[user.controllerId] = user.bountySignups;
    }
  }

  // Convert each user to BattleUserState format with references
  const convertedUsersState: BattleUserState[] = usersState.map((user) => {
    // Get IDs for relations that apply to this user's village
    const relationIds = (user.relations ?? []).map((r: { id: string }) => r.id);

    // Convert jutsus to reference format
    const jutsusRef: BattleUserJutsu[] = user.jutsus.map((uj) => ({
      id: uj.id,
      jutsuId: uj.jutsuId,
      level: uj.level,
      experience: uj.experience,
      equipped: uj.equipped,
      origin: "user" as const,
      lastUsedRound: uj.lastUsedRound ?? -(uj.jutsu?.cooldown ?? 0),
      originalCooldown: uj.originalCooldown ?? uj.jutsu?.cooldown ?? 0,
      reskinId: uj.reskinId ?? null,
      linkedReskinId: uj.linkedReskin?.id ?? null,
    }));

    // Convert items to reference format
    const itemsRef: BattleUserItem[] = user.items.map((ui) => {
      // Pre-resolve variant fields if the user has an active variant
      let variantBattleDescription: string | null = null;
      let variantImage: string | null = null;
      let variantName: string | null = null;
      if (ui.activeVariantId && ui.item?.variants) {
        const activeVariant = ui.item.variants.find((v) => v.id === ui.activeVariantId);
        variantBattleDescription = activeVariant?.battleDescription ?? null;
        variantImage = activeVariant?.image ?? null;
        variantName = activeVariant?.name ?? null;
      }
      return {
        id: ui.id,
        itemId: ui.itemId,
        progressionRowId: ui.progressionRowId ?? null,
        quantity: ui.quantity,
        level: ui.level,
        experience: ui.experience,
        durability: ui.durability,
        equipped: ui.equipped,
        lastUsedRound: ui.lastUsedRound ?? -(ui.item?.cooldown ?? 0),
        originalCooldown: ui.originalCooldown ?? ui.item?.cooldown ?? 0,
        dropChancePerc: ui.dropChancePerc,
        imbuementEffects: ui.imbuementEffects ?? [],
        activeVariantId: ui.activeVariantId ?? null,
        variantBattleDescription,
        variantImage,
        variantName,
      };
    });

    // Destructure to remove full objects that should become references
    // These fields are either stored in extraState or not needed in BattleUserState
    const {
      jutsus: _jutsus,
      items: _items,
      village: _village,
      anbuSquad: _anbuSquad,
      clan: _clan,
      bloodline: _bloodline,
      sageMode: _sageMode,
      userSkills: _userSkills,
      relations: _relations,
      aiProfile,
      keystoneItem,
      // These are stored in extraState, not on the user
      userQuests: _userQuests,
      completedQuests: _completedQuests,
      questData: _questData,
      bounties: _bounties,
      bountySignups: _bountySignups,
      activeReskin: _activeReskin,
      cookingJobs: _cookingJobs,
      ...rest
    } = user;

    // Construct BattleUserState with slim references
    const battleUserState: BattleUserState = {
      ...rest,
      pvpBoostPercent: getPvpBoost(user, info.settings).totalPercent,
      jutsus: jutsusRef,
      items: itemsRef,
      relationIds,
      // Convert full CombatAction[] to slim BattleBasicAction[] (only tracking data)
      basicActions: user.basicActions.map((ba) => ({
        id: ba.id,
        lastUsedRound: ba.lastUsedRound ?? 0,
      })),
      aiProfileId: aiProfile?.id ?? "Default",
      keystoneItemId: keystoneItem?.id ?? null,
      keystoneName: keystoneItem?.name ?? null,
      isSummon: user.isSummon ?? false,
    };

    return battleUserState;
  });

  // Merge summon users and extraState if any
  if (summonUsersState.length > 0) {
    convertedUsersState.push(...summonUsersState);
  }
  mergeExtraState(extraState, summonExtraState);

  if (info.petPreload) {
    addPetsToBattle({
      ...info.petPreload,
      usersState: convertedUsersState,
      usersEffects: userEffects,
      groundEffects,
      extraState,
      battleType,
      width,
      height,
    });
  }

  // Apply ally passives after every participant, including companions, has been assigned a team.
  for (const pending of pendingSkillEffects) {
    const creator = convertedUsersState.find((u) => u.userId === pending.creatorId);
    if (!creator) continue;
    const targets = convertedUsersState.filter(
      (u) =>
        !u.isSummonTemplate && stillInBattle(u) && u.direction === creator.direction,
    );
    for (const target of targets) {
      for (const effect of pending.effects) {
        const realized = realizeTag({
          tag: structuredClone(effect),
          user: creator,
          actionId: pending.skillId,
          target,
          level: pending.level,
        });
        realized.isNew = false;
        realized.castThisRound = false;
        realized.targetId = target.userId;
        realized.fromType = "skill";
        if (checkFriendlyFire(realized, target, convertedUsersState)) {
          userEffects.push(realized);
        }
      }
    }
  }

  const userIds = convertedUsersState.map((u) => u.userId);
  const { preBattleGearModifiers, filteredEffects } =
    consolidatePreBattleDamageModifiers(userEffects, userIds);
  extraState.preBattleGearModifiers = preBattleGearModifiers;

  return {
    userEffects: filteredEffects,
    groundEffects,
    usersState: convertedUsersState,
    extraState,
    initialDurability,
  };
};

/**
 * Fetch the essentials for a battle
 * @param client - The drizzle client
 * @returns The essentials for a battle
 */
export const fetchBattleEssentials = async (client: DrizzleClient) => {
  const [
    defaultProfile,
    activeWars,
    settings,
    villages,
    relations,
    dmgConfig,
    pvpAverage,
  ] = await Promise.all([
    // Fetch default AI profile
    fetchAiProfileById(client, "Default"),
    // Fetch active wars
    client.query.war.findMany({
      where: eq(war.status, "ACTIVE"),
      with: {
        warMercenaries: { where: activeWarMercenaryWhere() },
        warAllies: { where: activeWarAllyWhere() },
        attackerVillage: { columns: { name: true, sector: true } },
        defenderVillage: { columns: { name: true, sector: true } },
      },
    }),
    // Fetch game settings
    client
      .select()
      .from(gameSetting)
      .where(
        or(
          inArray(gameSetting.name, [
            "battleExpMultiplier",
            "jutsuExpMultiplier",
            "itemExpMultiplier",
            "regenGainMultiplier",
            "trainingGainMultiplier",
          ]),
          like(gameSetting.name, "war-%-train"),
          like(gameSetting.name, "war-%-regen"),
        ),
      ),
    // Fetch villages
    client.select().from(village),
    // Fetch village alliances
    client.select().from(villageAlliance),
    // Fetch damage formula config
    fetchDmgConfig(client),
    fetchPvpExperienceAverage(client),
  ]);
  return {
    defaultProfile,
    activeWars: withMercenaryParticipation(activeWars),
    settings: [...settings, pvpAverage],
    villages,
    relations,
    dmgConfig,
  };
};
