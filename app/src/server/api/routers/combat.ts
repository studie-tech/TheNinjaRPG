import { randomInt as secureRandomInt } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { eq, ne, notInArray, or, SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import superjson from "superjson";
import { z } from "zod";
import * as mapData from "@/data/hexasphere.json";
import {
  getActionRecoveryActivity,
  getActionRecoveryUpdate,
} from "@/deltas/actionReadiness";
import {
  buildCombatStateUpdate,
  type CombatStateUpdate,
  captureCombatCacheSnapshot,
  captureCombatStateUpdate,
  getArenaHealUserUpdate,
  getAutoCombatPreferencePatch,
  getCombatAdmissionUserUpdate,
} from "@/deltas/combat";
import {
  AdjustableBasicActions,
  AutoBattleTypes,
  AutoCombatBattleTypes,
  BATTLE_ARENA_DAILY_LIMIT,
  BATTLE_ARENA_HEAL_COST,
  type BattleType,
  BattleTypes,
  type BattleUsageType,
  BossFightBattleTypes,
  COMBAT_BIOMES,
  type CombatBiome,
  CREATOR_TRIAL_FIRST_FORM,
  DEFAULT_PARTY_PLAYERS,
  DUNGEON_SOLO_PETS,
  ELEMENTAL_MASTERY_BOOST,
  IMG_AVATAR_DEFAULT,
  MAP_RESERVED_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  MAX_PLAYER_LEVEL,
  NonActionItemTypes,
  PoolTypes,
  PvpBattleTypes,
  RANKS_RESTRICTED_FROM_PVP,
  RankedBattleTypes,
  REGEN_SECONDS,
  TERRITORY_WAR_TEAM_SIZE,
  VILLAGE_PROTECTOR_AI_ID,
  VILLAGE_SYNDICATE_ID,
  WAKE_ISLAND_PVP_PROTECTION,
} from "@/drizzle/constants";
import {
  type AiProfile,
  type AiTransformation,
  type BattleAction,
  battleAction,
  battleHistory,
  type GameSetting,
  type Item,
  type Jutsu,
  type RankedLoadout,
  type TerritoryWar,
  type UserData,
  type UserQuest,
  userData,
  type Village,
  type VillageAlliance,
  type WarCamp,
} from "@/drizzle/schema";
import { actionStatusMessage } from "@/libs/actionReadiness";
import { getActivityBonuses } from "@/libs/activityBonuses";
import { getReskinnedBloodline } from "@/libs/bloodline";
import {
  availableUserActions,
  getDefaultBasicActions,
  performBattleAction,
  stillInBattle,
} from "@/libs/combat/actions";
import { performAIaction } from "@/libs/combat/ai_v2";
import { withBossForms } from "@/libs/combat/bossFight";
import { compactBattleCatalogs } from "@/libs/combat/catalog";
import {
  COMBAT_LOBBY_SECONDS,
  RANKED_BLOODLINE_DAMAGE_TAG,
} from "@/libs/combat/constants";
import { type CreatorTrialState, isCreator } from "@/libs/combat/creatorTrial";
import {
  consolidatePreBattleDamageModifiers,
  emptyPreBattleGearModifiers,
} from "@/libs/combat/damagePipeline";
import { createAction, settlementWrites, updateBattle } from "@/libs/combat/database";
import { getPreferredDamageElement } from "@/libs/combat/elementalDamage";
import { advanceEncounterWave, prepareEncounterWaves } from "@/libs/combat/encounters";
import {
  applyForcedLoadouts,
  buildQueuedTrainingLogs,
  getAttackRestriction,
  projectQuestParty,
  rollStartingGroundEffects,
  settleQueuedBattleTraining,
} from "@/libs/combat/initiation";
import { BATTLE_LOG_PAGE_SIZE } from "@/libs/combat/log";
import { maskBattle } from "@/libs/combat/masking";
import { refreshMasteries, resetMasteriesToBase } from "@/libs/combat/mastery";
import {
  fitsBattleUsage,
  getBattleSpawnLocations,
  supportsNpcAllies,
} from "@/libs/combat/participants";
import { addPetsToBattle, petsAllowedInBattle } from "@/libs/combat/pets";
import { createCombatPlaybackRecorder } from "@/libs/combat/playback";
import { applyEffects, checkFriendlyFire } from "@/libs/combat/process";
import { addQuestStartingEffects } from "@/libs/combat/questEffects";
import { filterCombatQuests } from "@/libs/combat/quests";
import { calcBattleResult } from "@/libs/combat/settlement";
import {
  mergeLoadoutParticipants,
  summonActionBlockedReason,
} from "@/libs/combat/summon";
import { realizePassiveEffect } from "@/libs/combat/tags";
import { alignBattle, getTurnControl } from "@/libs/combat/turn";
import type {
  ActionEffect,
  BattleUserItem,
  BattleUserJutsu,
  BattleUserState,
  BattleWar,
  CombatQueryUser,
  CombatQueryVillage,
  CompleteBattle,
  ExtraState,
  GroundEffect,
  ProcessedItem,
  ProcessingBattleUser,
  ReturnedBattle,
  UserEffect,
} from "@/libs/combat/types";
import {
  createEmptyExtraState,
  getBattleClaimIds,
  getBattleGrid,
  getBattleSize,
  getEffectiveMaxPool,
  getHighestGenerals,
  getPoolKeys,
  inertUserItemColumns,
  mergeExtraState,
  reconcileLobbyPools,
  rollInitiative,
  syncPoolAdjustments,
} from "@/libs/combat/util";
import type { CoopEncounter } from "@/libs/coop";
import { dungeonBattleOutcome, dungeonRequirements } from "@/libs/dungeon";
import { activeTrainedElement } from "@/libs/elementalMastery";
import {
  buildJutsuEquipCaps,
  compareByLoadoutOrder,
  computeJutsuLoadoutCapAssignments,
} from "@/libs/jutsu";
import { battleJutsuGateFailure, calcJutsuEquipLimit } from "@/libs/jutsuRequirements";
import { resolveSelectableLoadout } from "@/libs/loadout";
import {
  anonymousSpriteAppearance,
  resolveSpriteAppearance,
  resolveSpriteEquipment,
  withSpriteEquipment,
} from "@/libs/lpc/appearance";
import { effectiveMasteries, isWornGear, isWornGearDisabled } from "@/libs/mastery";
import {
  areWarObjectivesRevealed,
  findShrineAttackWar,
  getWarRelationship,
  getWarSide,
  isObjectiveWarActive,
  isWarMercenary,
} from "@/libs/objectiveWar";
import { canUsePet } from "@/libs/pets/progression";
import {
  calcActiveUserRegen,
  calcCP,
  calcHP,
  calcLevelRequirements,
  calcMaxEnergy,
  calcSP,
  capUserStats,
  getEffectiveLevel,
  manuallyAssignUserStats,
  scaleUserStats,
} from "@/libs/profile";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { getPvpBoost } from "@/libs/pvpExperience";
import {
  controlShownQuestLocationInformation,
  mockAchievementHistoryEntries,
} from "@/libs/quest/projection";
import { getIsolatedPyramid, isBetweenPyramidBattles } from "@/libs/questRun";
import { hasTrainingInProgress } from "@/libs/queue";
import type { GlobalMapData } from "@/libs/sector-map/world-types";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import { snapshotSpriteAnimations } from "@/libs/spriteAnimations";
import { rollStealthKeep } from "@/libs/stealth";
import { getTerritoryCompetitor } from "@/libs/territoryWar";
import {
  getTimedRegenerationGain,
  getTimedRegenerationPeriods,
} from "@/libs/timedBuffs";
import { regenerationBuffs, titleCombatTag } from "@/libs/titles";
import { isActiveEventEntrant } from "@/libs/tournament/events";
import { getBiomeFromTileType } from "@/libs/travel";
import { isTutorialGuidedBattle } from "@/libs/tutorial";
import { fetchActionUser } from "@/queries/actionReadiness";
import { listAiTransformations } from "@/queries/ai";
import {
  buildQueuedTrainingClaim,
  deleteBattleById,
  deleteBattleHistoryByBattleId,
  executeResultsForListOngoingBattles,
  fetchBattle,
  fetchBattleEssentials,
  findBattleHistoryForGetBattleHistoryEntry,
  findQuestForInitiateBattle,
  findUserDataForStartArenaBattle,
  insertBattleForCreateBattle,
  insertBattleHistoryForCreateBattle,
  insertTrainingLogForInitiateBattle,
  listBattleActionForGetBattleEntries,
  listBattleHistoryForGetBattleHistory,
  listGameAssetForInitiateBattle,
  listJutsuForInitiateBattle2,
  listJutsuForInitiateBattle3,
  listRaidParticipationForInitiateBattle,
  listTournamentForInitiateBattle,
  listUserDataForInitiateBattle,
  listUserDataForProcessUsersForBattle,
  listUserDataForQueryBattleUsers,
  listUserDataForStartShrineBattle,
  listUserItemForInitiateBattle,
  listUserPetForInitiateBattle,
  selectBattleHistoryForGetGraph,
  selectBattleHistoryForInitiateBattle,
  selectDistinctBattleHistoryForGetGraph,
  updateBattleForIAmHere,
  updateBattleForToggleAutoCombat,
  updateBattleForUpdateCombatLoadout,
  updateHuntingSessionForInitiateBattle,
  updateKageDefendedChallengesForInitiateBattle,
  updateTournamentMatchForCreateBattle,
  updateUserDataForBattleArenaHeal,
  updateUserDataForCreateBattle,
  updateUserDataForInitiateBattle,
  updateUserDataForRememberPreference,
  updateUserJutsuForUpdateCombatLoadout,
  updateVillageForInitiateBattle,
} from "@/queries/combat";
import { nextSnapshotSql } from "@/queries/concurrency";
import { fetchItemLoadouts, listItemsByIds } from "@/queries/item";
import {
  fetchBloodlineJutsuReskins,
  fetchJutsuLoadouts,
  listJutsuByIds,
} from "@/queries/jutsu";
import { fetchAchievementCatalogue, fetchAllGameSettings } from "@/queries/profile";
import { fetchQuestEntryInventory, listVisibleRaidQuests } from "@/queries/quests";
import { findSectorWithVillage } from "@/queries/shrine";
import { fetchUserSkills } from "@/queries/skillTree";
import { fetchActiveTerritoryWar } from "@/queries/territoryWar";
import { fetchSectorVillage, findVillageBySector } from "@/queries/village";
import { fetchActiveWars } from "@/routers/war";
import {
  fetchUserItemsWithVariants,
  selectItemLoadout,
} from "@/server/api/routers/item";
import { fetchUserJutsus, selectJutsuLoadout } from "@/server/api/routers/jutsu";
import {
  createTRPCRouter,
  deferredRatelimitMiddleware,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  type ActionReadiness,
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { commitBattleAdmission } from "@/server/utils/battleAdmission";
import { combatCompletionStore } from "@/server/utils/combatCompletion";
import { settleCookingExperience } from "@/server/utils/cooking";
import {
  commitDungeonEntryBattle,
  fetchDungeonEntryData,
  getDungeonEntryCharges,
} from "@/server/utils/dungeonEntry";
import { notifyBattleDefenders } from "@/server/utils/push/combat";
import {
  commitQuestEntryBattle,
  getQuestEntryCharges,
} from "@/server/utils/questEntry";
import { fetchSanninRankedPlayers } from "@/server/utils/ranked";
import { hasDueTimedJob, settleDueTimedQueues } from "@/server/utils/userQueue";
import { findRelationship } from "@/utils/alliance";
import { getKageEligibility } from "@/utils/kage";
import { fedItemLoadouts, fedJutsuLoadouts } from "@/utils/paypal";
import { canChangeContent } from "@/utils/permissions";
import { regenTicksSince, secondsFromNow } from "@/utils/time";
import { canAccessStructure } from "@/utils/village";
import type { BaseServerResponse } from "@/validators/base";
import {
  type AssignableUserStats,
  IncreaseDamageGivenTag,
  isActivityBonus,
  statSchema,
  type ZodAllTags,
} from "@/validators/combat";
import type { HuntingBattleState } from "@/validators/hunting";
import type { JutsuEquipLimit } from "@/validators/jutsuEquipLimit";
import {
  sectorIdSchema,
  sectorLatitudeSchema,
  sectorLongitudeSchema,
} from "@/validators/travel";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";
import { userDeltaResponseSchema } from "@/validators/userCache";
import { fetchUpdatedUser } from "./profile";

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

      // Rounds this poll has acted in
      const actionRounds: number[] = [];

      // Re-read and retry when another request claimed the battle version first
      let attempts = 0;
      while (true) {
        // Increment attempts
        attempts += 1;

        // Distinguish between public and non-public user state
        const userBattle = await fetchBattle(ctx.drizzle, input.battleId);
        if (!userBattle) {
          return (
            (await combatCompletionStore().recover(ctx.userId, input.battleId)) ?? {
              battle: null,
              result: null,
            }
          );
        }
        const stateBaseline = captureCombatStateUpdate(userBattle);

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
        if (changedActor || spawnedWave) userBattle.version = userBattle.version + 1;
        advanceEncounterWave(userBattle, !!dungeonBattleOutcome(userBattle));

        if (!actionRounds.includes(actionRound)) {
          actionRounds.push(actionRound);
        }

        // Calculate if the battle is over for this user, and if so update user DB
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
            ...settlementWrites(
              ctx.drizzle,
              pusher,
              settledBattle,
              result,
              ctx.userId,
              claim.battleOver,
            ),
          ]);
          // Idle effects can land a killing blow here too. Announce only after
          // their log insert finishes so clients can refresh an earlier read.
          if (history.length) {
            notifyBattleLogs(
              pusher,
              settledBattle,
              logEntries,
              !!result,
              result ? undefined : buildCombatStateUpdate(stateBaseline, settledBattle),
            );
          }
        }

        // Hide private state of non-session user
        const newMaskedBattle = maskBattle(settledBattle, ctx.userId);

        // Cache only the settled, viewer-masked response; recovery never reruns reward writes.
        await combatCompletionStore().save(ctx.userId, newMaskedBattle, result);

        // Return the new battle + result state if applicable
        return { battle: newMaskedBattle, result: result };
      }
    }),
  getBattleEntries: protectedProcedure
    .meta({ mcp: { description: "Get battle action log entries" } })
    .input(
      z.object({
        battleId: z.string(),
        // Client cache keys only: a new battle version or the arrival of the result
        // re-reads the settled log.
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
      const limit = input.limit ?? BATTLE_LOG_PAGE_SIZE;
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

      const entries = await listBattleActionForGetBattleEntries(
        ctx.drizzle,
        limit,
        input,
        conditions,
      );
      return entries;
    }),
  getGraph: protectedProcedure
    .meta({ mcp: { description: "Get battle history graph data" } })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const isDirectFight = or(
        eq(battleHistory.attackedId, input.userId),
        eq(battleHistory.defenderId, input.userId),
      );
      // Every direct opponent can expose a top second-hop edge, even when their
      // own edge is below the display limit. Fetch the complete set as IDs only.
      const neighbors = await selectDistinctBattleHistoryForGetGraph(
        ctx.drizzle,
        input,
        isDirectFight,
      );
      if (neighbors.length === 0) return [];
      // Constant ID ranges let MySQL use the participant indexes rather than
      // scanning unrelated history for membership in a subquery.
      const userIds = [
        ...new Set([input.userId, ...neighbors.map((row) => row.userId)]),
      ];
      return await selectBattleHistoryForGetGraph(ctx.drizzle, userIds, isDirectFight);
    }),
  getBattleHistoryEntry: protectedProcedure
    .meta({ mcp: { description: "Get specific battle history entry" } })
    .input(z.object({ battleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await findBattleHistoryForGetBattleHistoryEntry(
        ctx.drizzle,
        input,
      );
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
      const results = await listBattleHistoryForGetBattleHistory(
        ctx.drizzle,
        userId,
        input,
      );
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
    .use(deferredRatelimitMiddleware)
    .input(
      z.object({
        battleId: z.string(),
        actionId: z.string().optional(),
        longitude: z.number().optional(),
        latitude: z.number().optional(),
        version: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Battle version from getBattle; required when actionId is provided",
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Short-form
      const suid = ctx.userId;
      const db = ctx.drizzle;
      const actionRounds: number[] = [];

      // Fetch battle from database
      const [battle] = await Promise.all([
        fetchBattle(db, input.battleId),
        ctx.waitForRateLimit(),
      ]);
      if (!battle) {
        // A terminal recovery response reuses this action request; it performs no game processing or writes.
        const completed = await combatCompletionStore().recover(suid, input.battleId);
        return completed
          ? {
              updateClient: true,
              battleUpdate: completed.battle,
              result: completed.result,
              logEntries: [],
              updatedQuestIds: [],
            }
          : { updateClient: true };
      }
      // Manual choices belong to the displayed snapshot, including requests from older tabs.
      if (input.actionId !== undefined && input.version !== battle.version) {
        return {
          updateClient: true,
          notification:
            input.version === undefined
              ? "Reload the page before choosing a battle action."
              : "Battle state changed. Choose your action again.",
        };
      }
      const stateBaseline = captureCombatStateUpdate(battle);
      advanceEncounterWave(battle, !!dungeonBattleOutcome(battle));
      // Create the grid for the battle
      const grid = getBattleGrid(1, battle);

      // Instantiate new state variables
      const history: Parameters<typeof createAction>[2] = [];

      // Actionless updates mutate the fetched object in place; retain its version for CAS.
      const fetchedVersion = battle.version;
      const originalRound = battle.round;
      const originalActiveUserId = battle.activeUserId;

      // Battle state to update during inner loop
      let newBattle: CompleteBattle = battle;
      let actionPerformed = false;
      let nActions = 0;
      const playback = createCombatPlaybackRecorder(battle);

      // INNER LOOP: Keep updating battle state until all actions have been performed
      while (true) {
        // Update the battle to the correct activeUserId & round. Default to current user
        const {
          actor,
          actionRound,
          expiredEffects: expiredBeforeAction,
        } = alignBattle(newBattle, actionRounds, suid);
        // Record all rounds for this endpoint call
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
          );
          if (summonBlocked) {
            return { updateClient: false, notification: summonBlocked };
          }
          try {
            const newState = performBattleAction({
              battle: newBattle,
              action,
              grid,
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
          playback.record(
            newBattle,
            newBattle.version + nActions,
            performedByUserId ?? actor.userId,
            actionEffects,
          );
          nActions += 1;
        }

        const spawnedWave = advanceEncounterWave(
          newBattle,
          !!dungeonBattleOutcome(newBattle),
        );
        // A transformation is its own beat on the field: it gets a replay step, and the
        // new form's first action waits for the next request, after the field has caught up.
        const transformedForm = spawnedWave
          ? newBattle.usersState.find(
              (u) => u.transformation && !u.leftBattle && stillInBattle(u),
            )
          : undefined;
        if (transformedForm) {
          history.push({
            battleRound: actionRound,
            appliedEffects: [],
            description: transformedForm.transformation?.log ?? "",
            battleVersion: newBattle.version + nActions,
            actionId: "unknown",
            userId: transformedForm.userId,
          });
          playback.record(
            newBattle,
            newBattle.version + nActions,
            transformedForm.userId,
            [],
          );
          nActions += 1;
        }
        // Calculate if the battle is over for this user, and if so update user DB
        const result = calcBattleResult(newBattle, suid, newBattle.extraState.settings);

        // Check if we should let the inner-loop continue. Reuse getTurnControl
        // so "who acts autonomously" stays defined in exactly one place -- a
        // piloted summon is never auto-driven here for the same reason it is
        // not authorized as an AI turn at the top of the block.
        const { isAITurn: newIsAITurn } = getTurnControl(newActor, suid);
        // Recheck after actions: a hidden animated summon template may now be
        // alive. Auto combat is watched and can be taken back at any moment, so it
        // resolves one action at a time. The actor replays a batch from its steps,
        // but other humans only receive the latest state, so each event must reach
        // them before another action overwrites it; departed participants do
        // not cap the batch.
        const fighting = newBattle.usersState.filter(
          (u) => !u.leftBattle && stillInBattle(u),
        );
        const humans = fighting.filter((u) => !u.isAi && !u.isSummon);
        const needsActionPlayback =
          humans.some((u) => u.isAutoCombat) ||
          (humans.length > 1 &&
            fighting.some((u) => Object.keys(u.spriteAnimations ?? {}).length > 0));
        const maxActions =
          AutoBattleTypes.includes(newBattle.battleType) || needsActionPlayback ? 1 : 5;
        if (
          newIsAITurn && // Continue new loop if the next actor acts autonomously
          !transformedForm && // and no new form is arriving on the field
          nActions < maxActions && // and we haven't reached the playback cap
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
          // An automatic tick can arrive after control returns to the player.
          // Reconcile its snapshot quietly so the client stops driving that turn.
          if (input.actionId === undefined) {
            return {
              updateClient: true,
              battleUpdate: maskBattle(newBattle, suid),
              result: null,
              logEntries: [],
              updatedQuestIds: [],
            };
          }
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
          // A version conflict is not retried: the client refetches and acts again.
          if (!claim)
            return {
              updateClient: true,
              ...(input.actionId !== undefined
                ? { notification: "Battle state changed. Choose your action again." }
                : {}),
            };
          const { battleOver, finishBattle } = claim;
          const [logEntries, { updatedQuestIds }] = await Promise.all([
            createAction(db, newBattle, history),
            ...settlementWrites(db, pusher, newBattle, result, suid, battleOver),
            finishBattle(),
          ]);
          const newMaskedBattle: ReturnedBattle = {
            ...maskBattle(newBattle, suid),
            playback: playback.steps,
          };

          await combatCompletionStore().save(suid, newMaskedBattle, result);

          // Notify after logs are persisted, including the terminal action.
          // Polling clients may have read the claimed state before its log insert.
          notifyBattleLogs(
            pusher,
            newBattle,
            logEntries,
            !!result,
            result ? undefined : buildCombatStateUpdate(stateBaseline, newBattle),
          );

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
    }),
  battleArenaHeal: protectedProcedure
    .meta({ mcp: { description: "Heal in battle arena for ryo" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const [initial, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(initial, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      // Guard
      if (user.money < BATTLE_ARENA_HEAL_COST)
        return errorResponse("You don't have enough money");
      if (user.isBanned) return errorResponse("You are banned");
      // Mutate with guard
      const result = await updateUserDataForBattleArenaHeal(
        ctx.drizzle,
        user,
        ctx,
        readiness,
      );
      if (result.rowsAffected === 0) {
        return errorResponse("Error trying to heal and continue. Try again.");
      } else {
        return actionReadinessResponse(
          { success: true, message: "You've healed", ...getArenaHealUserUpdate(user) },
          readiness,
          ctx.drizzle,
        );
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
        originSocketId: z.string().max(128).optional(),
      }),
    )
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Get information
      const [{ user, requiresProgressionRefresh }, selectedAI] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          includeNotifications: false,
        }),
        findUserDataForStartArenaBattle(ctx.drizzle, input),
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
            actionUserId: ctx.userId,
            requiresUserRefresh: requiresProgressionRefresh,
            originSocketId: input.originSocketId,
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
        return errorResponse("No AI found");
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
        longitude: sectorLongitudeSchema,
        latitude: sectorLatitudeSchema,
        sector: sectorIdSchema,
        userId: z.string(),
        asset: z.enum(COMBAT_BIOMES).optional(),
        originSocketId: z.string().max(128).optional(),
      }),
    )
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      return await initiateBattle(
        {
          longitude: input.longitude,
          latitude: input.latitude,
          sector: input.sector,
          userIds: [ctx.userId],
          targetIds: [input.userId],
          client: ctx.drizzle,
          actionUserId: ctx.userId,
          originSocketId: input.originSocketId,
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
      if (
        (userBattle.battleType !== "COMBAT" && userBattle.battleType !== "SPARRING") ||
        new Date() > userBattle.roundStartAt
      ) {
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
        ? (userBattle.extraState.villages?.[user.villageId] as CombatQueryVillage)
        : null;
      const questData = userBattle.extraState.questData?.[user.controllerId];
      const aiProfile =
        user.aiProfileId && user.aiProfileId !== "Default"
          ? userBattle.extraState.aiProfiles?.[user.aiProfileId]
          : userBattle.extraState.aiProfiles?.Default;
      // Relations battle state keeps apart, rebuilt from extraState and fresh skills.
      const combatant = {
        ...user,
        bloodline: bloodline ?? null,
        village: village ?? null,
        userSkills: activatedSkills,
        aiProfile: aiProfile ?? null,
        questData: questData ?? [],
        titles,
      };
      // The combatant as battle initiation sees it after the item switch.
      const gateUser = { ...combatant, items: useritems };
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
                caps: buildJutsuEquipCaps(
                  data.jutsuEquipLimits,
                  userBattle.battleType === "RANKED_PVP" ? "ranked" : "unranked",
                ),
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
          await updateUserJutsuForUpdateCombatLoadout(
            ctx.drizzle,
            ctx,
            invalidatedJutsuIds,
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
      // We reconstruct CombatQueryUser format from BattleUserState refs + extraState.
      // Compact catalog rows hold everything the gates below read; catalog.test.ts
      // holds them to the result full rows give.
      const now = new Date();
      const hydratedJutsus =
        newJutsus ?? hydrateBattleJutsus(userBattle, user, invalidatedJutsuIds, now);
      const hydratedItems = newItems ?? hydrateBattleItems(userBattle, user, now);

      // Build raw user for processing - hydrate from existing battle staticData and merge new data
      // We need to add back the village, bloodline, and aiProfile from extraState since CombatQueryUser requires them
      const equippedSageMode = user.sageModeId
        ? userBattle.extraState.sageModes?.[user.sageModeId]
        : null;
      // Build rawUserForProcessing from BattleUserState + extraState data
      // The jutsus/items are reconstructed from refs + static data with all required fields
      const rawUserForProcessing = {
        ...combatant,
        sageMode: equippedSageMode ?? null,
        jutsuLoadout: jId ?? user.jutsuLoadout,
        itemLoadout: iId ?? user.itemLoadout,
        jutsus: hydratedJutsus,
        items: hydratedItems,
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
        questIds: userBattle.extraState.questBattleSource
          ? [userBattle.extraState.questBattleSource.questId]
          : [],
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
      userBattle.extraState.preBattleGearModifiers =
        userBattle.extraState.preBattleGearModifiers || {};
      mergeExtraState(userBattle.extraState, compactBattleCatalogs(extraState));
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
      const result = await updateBattleForUpdateCombatLoadout(
        ctx.drizzle,
        userBattle,
        input,
      );

      if (result.rowsAffected > 0) {
        announceLobbyChange(userBattle);
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
        return errorResponse("Battle state could not be updated");
      }
    }),
  iAmHere: protectedProcedure
    .meta({ mcp: { description: "Mark ready in combat lobby" } })
    .input(z.object({ battleId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Maximum number of retry attempts
      const MAX_RETRIES = 3;
      let attempts = 0;
      let userBattle = await fetchBattle(ctx.drizzle, input.battleId);

      // Retry loop
      while (attempts < MAX_RETRIES) {
        attempts++;

        const user = userBattle?.usersState.find((u) => u.userId === ctx.userId);

        // Guard
        if (!userBattle) return errorResponse("You are not in a battle");
        if (!user) return errorResponse("You are not in this battle");
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
        const result = await updateBattleForIAmHere(ctx.drizzle, userBattle, input);

        if (result.rowsAffected > 0) {
          announceLobbyChange(userBattle);
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
            return errorResponse("Battle state could not be updated");
          }
          // Retry against the conflict snapshot, rechecking all lobby guards.
          userBattle = currentBattle;
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
    .input(z.object({ battleId: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      // Maximum number of retry attempts
      const MAX_RETRIES = 3;
      let attempts = 0;

      // PvP handovers belong to this encounter; only PvE toggles update the
      // non-PvP default, after the battle change succeeds.
      const rememberPreference = async (battleType: BattleType) => {
        const patch = getAutoCombatPreferencePatch(battleType, input.enabled);
        if ("defaultAutoCombat" in patch)
          await updateUserDataForRememberPreference(ctx.drizzle, input, ctx);
        return patch;
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
          const userPatch = await rememberPreference(userBattle.battleType);
          return {
            success: true,
            userPatch,
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
        const result = await updateBattleForToggleAutoCombat(
          ctx.drizzle,
          userBattle,
          input,
        );

        if (result.rowsAffected > 0) {
          const userPatch = await rememberPreference(userBattle.battleType);
          announceLobbyChange(userBattle);
          return {
            success: true,
            userPatch,
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
    .input(
      z.object({
        sector: sectorIdSchema,
        originSocketId: z.string().max(128).optional(),
      }),
    )
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Get information (use fetchActiveWars to get village relations with sectors)
      const [
        { user, requiresProgressionRefresh },
        activeWars,
        sectorData,
        shrineAis,
        isHome,
      ] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWars(ctx.drizzle),
        findSectorWithVillage(ctx.drizzle, input.sector),
        listUserDataForStartShrineBattle(ctx.drizzle),
        findVillageBySector(ctx.drizzle, input.sector),
      ]);

      // Check that user was found
      if (!user) return errorResponse("User not found");

      // Find the war the user is involved with
      const userWar = findShrineAttackWar(
        activeWars,
        user.villageId,
        user.userId,
        input.sector,
        { allowDefend: true },
      );

      // Check if this is a Village War or Raid (allows attacking home sectors)
      const isVillageWarOrRaid =
        userWar?.type === "VILLAGE_WAR" || userWar?.type === "WAR_RAID";

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
          : [VILLAGE_PROTECTOR_AI_ID];

      // Return battle
      return await initiateBattle(
        {
          sector: input.sector,
          userIds: [user.userId],
          targetIds: targetIds,
          forceDefenderVillageId: shrineOwnerVillageId,
          client: ctx.drizzle,
          actionUserId: ctx.userId,
          requiresUserRefresh: requiresProgressionRefresh,
          originSocketId: input.originSocketId,
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
      // Event launch tokens precede their battles. Use that link for visibility so
      // polling never reads the large extraState catalog, even on non-sparring tabs.
      const results = await executeResultsForListOngoingBattles(ctx.drizzle, input);

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
        summons: boolean[] | null;
        departures: boolean[] | null;
      }

      // Map the results to the expected format with proper type safety
      const filteredBattles = (results.rows as unknown as RawBattleRow[]).map((row) => {
        // Summons and fallen boss forms stay in usersState but are not current fighters.
        // JSON paths skip missing keys, so a shorter array no longer lines up by index.
        const flags = (values: boolean[] | null) =>
          values?.length === row?.userIds?.length ? values : undefined;
        const summons = flags(row.summons);
        const departures = flags(row.departures);
        const users =
          row?.userIds?.flatMap((userId, i) =>
            summons?.[i] || departures?.[i]
              ? []
              : [
                  {
                    userId: userId ?? null,
                    username: row?.usernames?.[i] ?? null,
                    avatar: row?.avatars?.[i] ?? null,
                  },
                ],
          ) ?? [];

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
/**
 * Send committed public changes to everyone on the battle's channel, solo fights included,
 * since Colosseum spectators follow them; oversized payloads retain log or version recovery
 * signals.
 */
const notifyBattleLogs = (
  pusher: ReturnType<typeof getServerPusher>,
  battle: { id: string; version: number },
  logEntries: BattleAction[],
  finished: boolean,
  stateUpdate?: CombatStateUpdate,
) => {
  const state = { version: battle.version, ...(finished ? { finished: true } : {}) };
  const update = {
    ...state,
    ...(logEntries.length ? { logEntries: superjson.serialize(logEntries) } : {}),
  };
  const withState = {
    ...update,
    ...(stateUpdate ? { stateUpdate: superjson.serialize(stateUpdate) } : {}),
  };
  // Keep the Pusher-compatible event below its payload limit; never truncate a log.
  void pusher.trigger(
    battle.id,
    "event",
    Buffer.byteLength(JSON.stringify(withState)) <= 10_000
      ? withState
      : Buffer.byteLength(JSON.stringify(update)) <= 10_000
        ? update
        : { ...state, logEntries: null },
  );
};

/** Rebuild a combatant's jutsu rows from its battle refs and the battle's static data. */
const hydrateBattleJutsus = (
  battle: CompleteBattle,
  user: BattleUserState,
  excludedJutsuIds: string[],
  now: Date,
) =>
  user.jutsus
    .filter((ref) => !excludedJutsuIds.includes(ref.jutsuId))
    .map((ref) => {
      const jutsu = battle.extraState.jutsus?.[ref.jutsuId] as Jutsu | undefined;
      if (!jutsu) return null;
      // Add missing UserJutsu fields needed for CombatQueryUserJutsu
      return {
        ...ref,
        reskinId: ref.reskinId ?? null, // Ensure non-undefined
        jutsu,
        activeReskin: ref.reskinId
          ? (battle.extraState.jutsuReskins?.[ref.reskinId] ?? null)
          : null,
        userId: user.controllerId,
        createdAt: now,
        updatedAt: now,
        trainingStartedAt: null,
        finishTraining: null,
      };
    })
    .filter((j): j is NonNullable<typeof j> => j !== null);

/** Rebuild a combatant's item rows from its battle refs and the battle's static data. */
const hydrateBattleItems = (battle: CompleteBattle, user: BattleUserState, now: Date) =>
  user.items
    .map((ref) => {
      const item = battle.extraState.items?.[ref.itemId] as Item | undefined;
      if (!item) return null;
      // Add missing UserItem fields needed for CombatQueryUserItem
      return {
        ...ref,
        ...inertUserItemColumns(user.controllerId, now),
        item,
        imbuements: [],
        imbuementEffects: ref.imbuementEffects ?? [],
        activeVariantId: ref.activeVariantId ?? null,
        variantBattleDescription: ref.variantBattleDescription ?? null,
        variantImage: ref.variantImage ?? null,
        variantName: ref.variantName ?? null,
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);

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
    /** Session actor whose bounded admission update may be returned to the caller. */
    cacheUserId?: string;
    /** Explicit actor eligible for recovery, prepared from the existing participant preload. */
    actionUserId?: string;
    /** The initiating tab reconciles its mutation response; other tabs still receive admission. */
    originSocketId?: string;
    /** A caller plan opts this actor into recovery; admission revalidates the fresh snapshot. */
    actionReadiness?: ActionReadiness;
    /** Prior hydration can settle effects outside the bounded battle admission projection. */
    requiresUserRefresh?: boolean;
    /** Shared launch contract; each activity keeps its own progress and settlement policy. */
    coop?: CoopEncounter;
    /** Current rules, guarded session/allowance versions and rewards preloaded for settlement. */
    hunting?: HuntingBattleState;
    userStatDistribution?: AssignableUserStats;
    targetStatDistribution?: AssignableUserStats;
    scaleTarget?: boolean;
    forceLoadouts?: RankedLoadout[];
    /** Shared rules snapshot used for ranked loadout cleanup and battle admission. */
    jutsuEquipLimits?: JutsuEquipLimit[];
    forceDefenderVillageId?: string;
    biome?: CombatBiome;
    forceKeepPools?: boolean;
    /** Replace the initiating players' HP/CP/SP with this percentage of effective maxima. */
    givePools?: number;
    /** Full authored tags applied only to initiating human players, including the opening round. */
    startingEffects?: ZodAllTags[];
    /** Open run whose version, receipt and inventory are guarded at battle creation. */
    questAttempt?: UserQuest;
    /** Every boss link, once read: each lone enemy then fights with its later forms. */
    aiTransformations?: AiTransformation[];
    /** The attacked creator, whom a win credits and whose name the first form takes. */
    creatorTrial?: CreatorTrialState;
    /** Attribute battle progress to its owning objective instead of unrelated matching kills. */
    questBattleSource?: { questId: string; objectiveId: string };
    /** Camp identity and guardian snapshot used by combat's final strategic mutation phase. */
    warCamp?: WarCamp;
    /** Guardian lobby's event; preload political identities and guard its live window at admission. */
    territoryWar?: TerritoryWar;
    raidQuestId?: string;
    /** Live raid roster reservation checked when combat claims the participants. */
    raidQueueClaim?: { teamId: string; claimId: string };
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
): Promise<
  BaseServerResponse & {
    battleId?: string;
    requiresUserRefresh?: boolean;
    userPatch?: UserCachePatch;
    userDelta?: UserDelta;
  }
> => {
  const { longitude, latitude, sector, userIds, client } = info;
  const dungeonEncounter = info.coop?.kind === "dungeon" ? info.coop : undefined;
  const questEncounter = info.coop?.kind === "quest" ? info.coop : undefined;
  const allyAiIds = info.allyAiIds ?? [];
  // Bosses fight alone, and only in battle types that carry their forms. See `withBossForms`.
  const canBeBoss = BossFightBattleTypes.includes(battleType) && !allyAiIds.length;
  const authoredFight = { targetIds: info.targetIds, waves: dungeonEncounter?.waves };
  const bossFight =
    canBeBoss && info.aiTransformations
      ? withBossForms(authoredFight, info.aiTransformations)
      : authoredFight;
  const { targetIds, waves: encounterWaves } = bossFight;
  if (dungeonEncounter) {
    const { content, runState } = dungeonEncounter;
    const capacity = runState.pets ? 1 : (content.maxPlayers ?? DEFAULT_PARTY_PLAYERS);
    const roster = new Set(userIds);
    if (
      roster.size !== userIds.length ||
      roster.size < 1 ||
      roster.size > capacity ||
      roster.size !== runState.memberIds.length ||
      runState.memberIds.some((id) => !roster.has(id))
    ) {
      return errorResponse("The dungeon roster changed or exceeds the player limit.");
    }
  }

  if (allyAiIds.length > 0 && !supportsNpcAllies(battleType)) {
    return errorResponse("NPC allies are only supported in quest battles");
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
    listUserDataForQueryBattleUsers(client, userIds, allyAiIds, targetIds);

  // Use Promise.all to fetch all independent data in parallel
  const [
    territoryWarEvent,
    {
      defaultProfile,
      activeWars,
      settings,
      villages,
      relations,
      dmgConfig,
      sharedCooldowns,
      jutsuEquipLimits,
    },
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
    dungeonEntryData,
    aiTransformations,
  ] = await Promise.all([
    info.territoryWar ??
      (battleType === "COMBAT" && sector !== undefined
        ? fetchActiveTerritoryWar(client, sector)
        : null),
    // Essentials
    fetchBattleEssentials(client, info.jutsuEquipLimits),
    // Fetch game assets (only battlefield ones to avoid row limit)
    listGameAssetForInitiateBattle(client),
    // Fetch achievements
    fetchAchievementCatalogue(client),
    // Fetch user data
    queryBattleUsers(),
    PvpBattleTypes.includes(battleType) || battleType === "SHRINE_WAR"
      ? selectBattleHistoryForInitiateBattle(client, userIds, targetIds)
      : null,
    jutsusIds.length > 0 ? listJutsuByIds(client, jutsusIds) : [],
    itemIds.length > 0 ? listItemsByIds(client, itemIds) : [],
    // Ownership progression for forced loadouts (includes unequipped copies).
    // Kept separate from user.items so unequipped rows are not treated as usable battle items.
    info.forceLoadouts && itemIds.length > 0
      ? listUserItemForInitiateBattle(client, userIds, targetIds, itemIds)
      : [],
    // Fetch all jutsus that can be injected in battle
    listJutsuForInitiateBattle2(client),
    // Fetch raid quest data for boss HP (if applicable)
    battleType === "RAID" && info.raidQuestId
      ? findQuestForInitiateBattle(client, { raidQuestId: info.raidQuestId })
      : null,
    // Fetch exclusive raids for SHRINE_WAR battles (needed for raid activation when shrine is defeated)
    battleType === "SHRINE_WAR" ? listVisibleRaidQuests(client) : [],
    // Preload these participants' battleCount guards for settlement.
    battleType === "RAID" && info.raidQuestId
      ? listRaidParticipationForInitiateBattle(
          client,
          { raidQuestId: info.raidQuestId },
          userIds,
          targetIds,
        )
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
    battleType === "COMBAT" ? listTournamentForInitiateBattle(client) : [],
    // Preload the bounded collection so parallel reads remain complete across selection swaps.
    petsAllowedInBattle(battleType)
      ? listUserPetForInitiateBattle(client, userIds, targetIds)
      : [],
    petsAllowedInBattle(battleType)
      ? listJutsuForInitiateBattle3(client, userIds, targetIds)
      : [],
    dungeonEncounter && !dungeonEncounter.runState.entryPaidAt
      ? fetchDungeonEntryData(client, userIds)
      : null,
    // A lone enemy or a dungeon wave may open a boss, as may a lone attack on the creator.
    !info.aiTransformations &&
    ((canBeBoss && (!!dungeonEncounter || targetIds.length === 1)) ||
      (battleType === "COMBAT" && targetIds.length === 1))
      ? listAiTransformations(client)
      : null,
  ]);

  // A fight with the creator never reaches their account: an open-world attack, or quest
  // content naming them, opens the trial against their stand-in forms. An attack stays bound
  // to their position, as any attack is; quest fights keep their type and objective credit.
  const creator =
    battleType === "COMBAT" ||
    battleType === "QUEST" ||
    battleType === "RANDOM_ENCOUNTER"
      ? preloadedUsers.find(
          (user) =>
            targetIds.includes(user.userId) &&
            !userIds.includes(user.userId) &&
            isCreator(user),
        )
      : undefined;
  if (creator) {
    if (
      battleType === "COMBAT" &&
      (creator.sector !== sector ||
        creator.longitude !== longitude ||
        creator.latitude !== latitude)
    )
      return errorResponse("Attack failed, did the target move?");
    return await initiateBattle(
      {
        ...info,
        targetIds: [CREATOR_TRIAL_FIRST_FORM],
        creatorTrial: { creatorId: creator.userId, username: creator.username },
        aiTransformations: aiTransformations ?? undefined,
      },
      battleType === "COMBAT" ? "OVERWORLD" : battleType,
      scaleGains,
    );
  }

  // A boss's later forms join the fight, so start over to read them with the rest.
  if (
    canBeBoss &&
    aiTransformations &&
    withBossForms(bossFight, aiTransformations) !== bossFight
  ) {
    return await initiateBattle({ ...info, aiTransformations }, battleType, scaleGains);
  }
  if (info.creatorTrial && !encounterWaves) {
    return { success: false, message: "The trial is unavailable" };
  }

  // Start due jutsu levels and crafts before the participants are read for the fight,
  // e.g. an offline opponent's queued jutsu level. Rare, so the participants are read
  // again after due settlement.
  let fetchedUsers = preloadedUsers;
  const queueOwners = fetchedUsers.filter(
    (user) => !user.isAi && hasDueTimedJob(user.queue),
  );
  // Settlement can change resources and receipts outside the combat cache projection,
  // including partial writes before an optional settlement failure.
  let requiresUserRefresh =
    queueOwners.length > 0 ||
    !!info.requiresUserRefresh ||
    !!info.actionReadiness?.userRecovery?.requiresUserRefresh;
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
    requiresUserRefresh = true;
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
  // Only a boss's opening form was selected; its later forms need no arena listing.
  if (
    (battleType === "ARENA" || battleType === "TRAINING") &&
    (encounterWaves?.[0]?.aiIds ?? targetIds).some((id) => {
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
    return errorResponse("A companion selection changed. Please try again.");
  }

  if (dungeonEncounter?.runState.pets) {
    const owner = fetchedUsers.find((user) => user.userId === userIds[0]);
    const chosen = dungeonEncounter.runState.pets;
    if (
      !owner ||
      chosen.length !== DUNGEON_SOLO_PETS ||
      new Set(chosen.map((pet) => pet.id)).size !== DUNGEON_SOLO_PETS ||
      chosen.some((selected) => {
        const pet = pets.find(
          (pet) => pet.id === selected.id && pet.userId === owner.userId,
        );
        return (
          !pet?.species ||
          pet.generationStatus !== "READY" ||
          owner.petTask?.petId === pet.id ||
          !canUsePet(pet, owner)
        );
      })
    )
      return errorResponse(
        "Your selected dungeon companions must be fully generated, battle-ready and free of tasks.",
      );
  }
  // Consumed tickets must not contribute equipment stats to the first floor.
  if (dungeonEntryData && dungeonEncounter) {
    const requirements = dungeonRequirements(dungeonEncounter.content);
    for (const owner of fetchedUsers.filter((user) => userIds.includes(user.userId))) {
      const charges = getDungeonEntryCharges(
        requirements,
        dungeonEntryData.inventory.filter((row) => row.userId === owner.userId),
      );
      if (!charges)
        return errorResponse(
          `${owner.username} does not have the required dungeon entry items.`,
        );
      requiresUserRefresh ||= charges.length > 0;
      owner.items = owner.items
        .map((row) => ({
          ...row,
          quantity:
            row.quantity -
            (charges.find((charge) => charge.id === row.id)?.quantity ?? 0),
        }))
        .filter((row) => row.quantity > 0);
    }
  }

  const entryCharges = info.questAttempt
    ? getQuestEntryCharges(info.questAttempt, entryInventory)
    : [];
  if (!entryCharges)
    return errorResponse("You do not have the required entry items in your inventory.");
  const hasEntryCharges = entryCharges.length > 0;
  // Entry receipts and consumed equipment extend beyond the bounded combat cache patch.
  requiresUserRefresh ||= hasEntryCharges;
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

  const cacheActor = fetchedUsers.find(
    (user) =>
      user.userId ===
        (info.cacheUserId ??
          info.actionUserId ??
          info.actionReadiness?.initial.userId) &&
      !user.isAi &&
      !user.isSummon,
  );

  const participantsWithTraining = new Set(
    fetchedUsers
      .filter((user) => !user.isAi && !user.isSummon && hasTrainingInProgress(user))
      .map((user) => user.userId),
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
    const failure = projectQuestParty(
      fetchedUsers.filter((user) => userIds.includes(user.userId)),
      questEncounter,
      { sector, longitude, latitude },
    );
    if (failure) return errorResponse(failure);
  }

  // Recovery is explicit to the requesting actor; opponents and scheduled participants retain strict status checks.
  const actionActorId = info.actionUserId ?? info.actionReadiness?.initial.userId;
  const actionActor =
    actionActorId && [...userIds, ...targetIds].includes(actionActorId)
      ? fetchedUsers.find((user) => user.userId === actionActorId && !user.isAi)
      : undefined;
  const actionReadiness =
    actionActor && ["AWAKE", "ASLEEP", "HOSPITALIZED"].includes(actionActor.status)
      ? prepareActionReadiness(
          { ...actionActor, maxEnergy: calcMaxEnergy(actionActor) },
          settings,
        )
      : undefined;
  if (actionReadiness?.error) return errorResponse(actionReadiness.error);

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
  const queuedTraining = settleQueuedBattleTraining(
    fetchedUsers,
    settings,
    energyCapacity,
    !!info.tournamentGame,
  );

  if (actionActor && actionReadiness?.notice) {
    // Queue settlement owns spent Energy; recovery must not refund training completed in this admission.
    const queued = queuedTraining.find(
      (entry) => entry.user.userId === actionActor.userId,
    );
    if (queued?.energy) actionReadiness.set.curEnergy = queued.energy.curEnergy;
    if (queued && actionReadiness.initial.status === "HOSPITALIZED") {
      // Hospital recovery preserves the queue gains committed by the participant claim.
      if (queued.energy || info.tournamentGame) {
        for (const pool of PoolTypes) {
          const { cur, max } = getPoolKeys(pool);
          actionActor[cur] = Math.round(
            Math.min(queued.original[cur] + queued.regen, queued.original[max]),
          );
        }
      }
      Object.assign(actionActor, actionReadiness.set);
      actionActor.maxEnergy = calcMaxEnergy(actionActor);
      actionReadiness.set.maxEnergy = actionActor.maxEnergy;
      actionReadiness.user = { ...actionActor };
      actionReadiness.userRecovery = getActionRecoveryUpdate(
        actionReadiness.initial,
        actionReadiness.user,
        [
          ...Object.keys(actionReadiness.set),
          ...Object.keys(queued.mastery?.update ?? {}),
          ...(queued.amount > 0 ? ["petExperience"] : []),
        ] as (keyof UserData)[],
        settings,
        actionActor.regenAt,
      );
    } else {
      Object.assign(actionActor, actionReadiness.user);
    }
  }

  // Settlement starts from committed recovery before combat normalizes stats or loadouts.
  const profileCacheSnapshots = Object.fromEntries(
    fetchedUsers
      .filter((user) => !user.isAi && !user.isSummon)
      .map((user) => [
        user.userId,
        {
          ...captureCombatCacheSnapshot(user),
          hadTrainingQueue: participantsWithTraining.has(user.userId),
        },
      ]),
  );

  // Completed training can unlock worn gear; capture yield before combat mutates its sources.
  if (info.hunting) {
    const hunter = fetchedUsers.find((user) => user.userId === info.hunting?.userId);
    info.hunting.huntingBonusQuantity = hunter
      ? getActivityBonuses(hunter).huntingBonusQuantity
      : 0;
  }

  // If we have forced loadouts, overwrite user items and jutsus appropriately
  if (info.forceLoadouts && info.forceLoadouts.length > 0) {
    applyForcedLoadouts(
      fetchedUsers,
      info.forceLoadouts,
      loadoutItems,
      loadoutJutsus,
      forceLoadoutItemProgression,
    );
  }

  // Get background for the battle
  let background: CombatBiome = info.biome ?? "default";

  // If background is default and we have a sector, determine biome from the global tile
  if (background === "default" && sector !== undefined) {
    const map = mapData as unknown as GlobalMapData;
    const tile = map.tiles[sector];
    if (tile) {
      background = getBiomeFromTileType(tile.t);
    }
  }

  // Allies must be NPC templates, never extra player accounts.
  if (allyAiIds.some((id) => !fetchedUsers.find((u) => u.userId === id)?.isAi)) {
    return errorResponse("One of the ally AIs is unavailable");
  }

  // Clone each occurrence: one NPC template may appear repeatedly or on both teams.
  const users = [...userIds, ...allyAiIds, ...targetIds]
    .map((id) => structuredClone(fetchedUsers.find((u) => u.userId === id)))
    .filter((u): u is NonNullable<typeof u> => u !== undefined);

  if (
    encounterWaves &&
    (users.length !== userIds.length + targetIds.length ||
      users.slice(userIds.length).some((u) => !u.isAi))
  )
    return errorResponse(
      dungeonEncounter ? "A dungeon enemy is unavailable" : "The trial is unavailable",
    );

  // The trial opens against the creator themself; only later forms carry a machine's name.
  const openingForm = info.creatorTrial && users[userIds.length];
  if (openingForm && info.creatorTrial)
    openingForm.username = info.creatorTrial.username;

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
          return errorResponse(
            "This objective shrine is unavailable until active combat and completed espionage",
          );
      }
    }
  }

  // Political identity is independent of battle teams and stays fixed through result collection.
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

  // Check if the villageData is in a pvp enabled zone
  const sectorData = villages.find((v) => v.sector === sector);

  // Wake Island blanket PvP protection, toggled by WAKE_ISLAND_PVP_PROTECTION
  if (
    WAKE_ISLAND_PVP_PROTECTION &&
    sector === MAP_WAKE_ISLAND_SECTOR &&
    battleType === "COMBAT"
  ) {
    return errorResponse("Cannot attack players in Wake Island");
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
    return errorResponse(
      "This player is registered for an ongoing tournament and can't be attacked",
    );
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
      return errorResponse("Cannot attack members of this protected village");
    }
  }

  // Calculate battle width and height
  const rightSideUserCount = encounterWaves
    ? Math.max(...encounterWaves.map((wave) => wave.aiIds.length))
    : users.length - leftSideUserCount;
  const gridSize = getBattleSize(
    battleType,
    users[0]?.level ?? 0,
    leftSideUserCount,
    rightSideUserCount,
    !!info.coop || !!info.raidQuestId,
  );
  if (!gridSize) return errorResponse("Too many NPCs for this battlefield");

  // Team bracket eligibility uses the initiating player; village and activity guards still apply to every member.
  const now = new Date();
  const nonAiTargets = users.filter((u) => targetIds.includes(u.userId) && !u.isAi);

  // AI rows are excluded from the battle-start claim below (one shared row backs
  // every fight against a given AI), so the update's location predicate does not
  // verify an AI target's position. Enforce the COMBAT proximity rule against
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
      return errorResponse("Attack failed, did the target move?");
    }
  }

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

  // Loop through each user
  for (const i of users.keys()) {
    // Get the user
    const user = users[i];
    if (!user) return errorResponse("Could not find expected user");

    if (info.kageMatch && userIds.includes(user.userId)) {
      const reason = getKageEligibility(user, info.kageMatch.villageId);
      if (reason) return errorResponse(reason);
    }

    // If user is banned
    if (user.isBanned) return errorResponse(`${user.username} is banned`);

    // Force defender village id
    if (info.forceDefenderVillageId && targetIds.includes(user.userId)) {
      user.villageId = info.forceDefenderVillageId;
    }

    // Check if user is asleep
    // Scheduled title fights claim both participants directly from ordinary play.
    if (battleType === "KAGE_PVP") {
      if (!user.isAi && user.status !== "AWAKE")
        return errorResponse(
          `${user.username} must be awake and free of other activities`,
        );
    } else if (!isAutoBattle && !user.isAi) {
      // For other battles, check if user status is appropriate (skip AI users)
      const isOk = dungeonEncounter
        ? user.status === "QUEUED"
        : isQueuedBattle
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
        return errorResponse(
          actionStatusMessage(
            user.status,
            userIds.includes(user.userId) ? "You" : user.username,
          ),
        );
      }
    }

    // Rank restrictions
    if (battleType === "COMBAT") {
      if (userIds.includes(user.userId)) {
        if (RANKS_RESTRICTED_FROM_PVP.includes(user.rank)) {
          return errorResponse("Need to rank up to do PvP combat");
        }
      } else {
        if (RANKS_RESTRICTED_FROM_PVP.includes(user.rank) && !user.isAi) {
          return errorResponse("Cannot attack students & genin");
        }
      }
    }

    // XP Bracket restrictions — same bracket, higher, or one below; immunity lift and war exemptions
    if (battleType === "COMBAT" && userIds.includes(user.userId)) {
      const restriction = getAttackRestriction({
        user,
        isLeadAttacker: user.userId === userIds[0],
        targets: nonAiTargets,
        activeWars,
        relations,
        now,
      });
      if (restriction) return errorResponse(restriction);
    }

    // Scale targets
    if (info.scaleTarget && i >= leftSideUserCount && users[0]) {
      user.level = users[0].level;
      scaleUserStats(user, user.isAi ? "ai" : "player");
    }

    // Manually Assign Stats
    if (info.targetStatDistribution && i >= leftSideUserCount) {
      manuallyAssignUserStats(user, info.targetStatDistribution);
    }
    if (info.userStatDistribution && userIds.includes(user.userId)) {
      manuallyAssignUserStats(user, info.userStatDistribution);
    }

    // Apply caps to user stats. Ranked waives progression gates and plays everyone as an
    // ELITE JONIN, so its distributions cap at that rank rather than the player's own.
    const isRankedBattle = RankedBattleTypes.includes(battleType);
    capUserStats(user, isRankedBattle ? "ELITE JONIN" : user.rank);

    // Add achievements to users for tracking
    user.userQuests.push(...mockAchievementHistoryEntries(achievements, user));
  }

  // Check immunity on defenders
  if (
    battleType === "COMBAT" &&
    users
      .filter((u) => targetIds.includes(u.userId))
      .some((u) => u.immunityUntil > new Date())
  ) {
    return errorResponse("One of the targets is immune from combat.");
  }

  // Repeat PvP fights within 60 minutes divide reward scaling (and human shrine-war XP)
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
    users: encounterWaves
      ? users.slice(0, userIds.length + (encounterWaves[0]?.aiIds.length ?? 0))
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
    questIds: [
      info.questBattleSource?.questId,
      info.questAttempt?.questId,
      questEncounter?.quest.id,
    ].filter((id): id is string => !!id),
    summonTemplateCache,
    petPreload: {
      pets,
      selectedPetIdsByOwner: dungeonEncounter?.runState.pets
        ? { [userIds[0]!]: dungeonEncounter.runState.pets.map((pet) => pet.id) }
        : undefined,
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

  if (
    dungeonEncounter?.runState.pets &&
    usersState.filter((user) => user.petId && user.controllerId === userIds[0])
      .length !== DUNGEON_SOLO_PETS
  )
    return errorResponse(
      "Both selected dungeon companions must be able to join the battlefield.",
    );
  if (encounterWaves) {
    let offset = userIds.length + (encounterWaves[0]?.aiIds.length ?? 0);
    const encounter = await prepareEncounterWaves(
      encounterWaves,
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
  }
  if (info.creatorTrial) extraState.creatorTrial = info.creatorTrial;
  if (dungeonEncounter) {
    extraState.dungeon = {
      runId: dungeonEncounter.runId,
      runVersion: dungeonEncounter.runVersion,
      runState: {
        ...dungeonEncounter.runState,
        battlePublished: true,
        ...(dungeonEntryData ? { entryPaidAt: Date.now() } : {}),
      },
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
  // The tutorial's fights teach manual control, so a player still in the
  // tutorial fights them by hand whatever their stored default or the caller says.
  const tutorialGuidedUserIds = users
    .filter((u) =>
      isTutorialGuidedBattle(u, {
        opponentIds: info.targetIds,
        questId: info.questBattleSource?.questId,
      }),
    )
    .map((u) => u.userId);
  const autoCombatUserIds = [
    ...(info.autoCombatUserIds ?? []),
    ...(info.autoCombatFromDefaults
      ? users
          .filter((u) => !u.isAi && u.defaultAutoCombat && userIds.includes(u.userId))
          .map((u) => u.userId)
      : []),
  ].filter((userId) => !tutorialGuidedUserIds.includes(userId));
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
  syncPoolAdjustments(usersState, userEffects);

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
        const raidMaxHp = raidQuest.raidBossMaxHealth ?? boss.maxHealth;
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
  groundEffects.push(...rollStartingGroundEffects(assets, gridSize, usersState));

  // Figure out who starts in the battle
  const attackerFirst = !PvpBattleTypes.includes(battleType);
  const activeUser = usersState
    .sort((a, b) => b.initiative - a.initiative)
    .filter((u) => u.curHealth > 0);
  const activeUserId = attackerFirst ? users[0]?.userId : activeUser[0]?.userId;

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
  const queueUpdate = buildQueuedTrainingClaim(
    queuedParticipants,
    energyCapacity,
    !!info.tournamentGame,
  );

  if (actionReadiness?.notice && actionActor) {
    // The existing participant claim commits recovery together with BATTLE; no standalone wake can overwrite it.
    for (const [key, value] of Object.entries(actionReadiness.set)) {
      if (key === "status") continue;
      const column = userData[key as keyof UserData];
      const fallback = queueUpdate[key] ?? column;
      queueUpdate[key] =
        sql`CASE WHEN ${userData.userId} = ${actionActor.userId} THEN ${value instanceof SQL ? value : sql.param(value, column)} ELSE ${fallback} END`;
    }
    queueUpdate.updatedAt = sql`CASE WHEN ${userData.userId} = ${actionActor.userId} THEN ${nextSnapshotSql(userData.updatedAt)} ELSE ${queueUpdate.updatedAt ?? userData.updatedAt} END`;
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
  const equipCaps = buildJutsuEquipCaps(
    jutsuEquipLimits,
    RankedBattleTypes.includes(battleType) ? "ranked" : "unranked",
  );
  for (const participant of usersState) {
    if (participant.isAi) continue;
    const selected = participant.jutsus.filter((entry) => entry.equipped);
    const accepted = computeJutsuLoadoutCapAssignments({
      caps: equipCaps,
      jutsuIds: selected.map((entry) => entry.jutsuId),
      userjutsus: selected.flatMap((entry) => {
        // Catalogs stay complete until the battle row is written.
        const definition = extraState.jutsus[entry.jutsuId] as Jutsu | undefined;
        return definition ? [{ jutsuId: entry.jutsuId, jutsu: definition }] : [];
      }),
      maxEquip: selected.length,
    }).equipIds;
    participant.jutsus = participant.jutsus.filter(
      (entry) => !entry.equipped || accepted.includes(entry.jutsuId),
    );
  }
  /**
   * Persist the preloaded battle and return the participant claim and any settled failure.
   * Dungeon floors, first payments, event launches and hunts await their transaction's writes.
   * Other battles dispatch independent writes together and settle all siblings before cleanup.
   */
  const createBattle = async (client: DrizzleClient) => {
    const writes = [
      insertBattleForCreateBattle(
        client,
        battleId,
        battleType,
        background,
        usersState,
        userEffects,
        groundEffects,
        gridSize,
        extraState,
        profileCacheSnapshots,
        pvpExperienceScaling,
        previousBattleResults,
        energyRegeneration,
        energyRegenerationPeriods,
        energyCapacity,
        injectableJutsus,
        dmgConfig,
        sharedCooldowns,
        settings,
        initialDurability,
        info,
        territoryWarEvent,
        territoryCompetitors,
        raidInitialBossHp,
        raidParticipations,
        sectorExclusiveRaids,
        rankedTopPlayersLP,
        rewardScaling,
        startTime,
        activeUserId,
      ),
      insertBattleHistoryForCreateBattle(
        client,
        userIds,
        targetIds,
        battleId,
        battleType,
      ),
      updateUserDataForCreateBattle(
        client,
        queueUpdate,
        battleId,
        { ...info, actionReadiness },
        battleType,
        userIds,
        stealthBreakUserIds,
        warAggressorIds,
        bracketImmunityAggressorIds,
        allParticipantIds,
        fetchedUsers,
        sector,
        huntingEquipment,
        partyQuestSnapshots,
        users,
        queuedParticipants,
        questEncounter,
        dungeonEncounter,
        longitude,
        latitude,
      ),
      ...(battleType === "TOURNAMENT"
        ? [updateTournamentMatchForCreateBattle(client, battleId, userIds, targetIds)]
        : []),
    ] as const;
    if (
      hasEntryCharges ||
      dungeonEncounter ||
      info.tournamentGame ||
      info.kageMatch ||
      info.hunting
    ) {
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
  const claimedEveryone = (created: Awaited<ReturnType<typeof createBattle>>) =>
    created.claimedUsers?.rowsAffected === expectedRows;
  const attempt = info.questAttempt;
  let result: Awaited<ReturnType<typeof createBattle>>;
  // Every dungeon floor commits its playable battle with the publication/recovery fence.
  // First entry additionally commits all ticket stacks and its attempt receipt in that commit.
  if (dungeonEncounter && extraState.dungeon) {
    const committed = await commitDungeonEntryBattle({
      client,
      data: dungeonEntryData,
      runId: dungeonEncounter.runId,
      dungeonId: dungeonEncounter.dungeonId,
      battleId,
      version: dungeonEncounter.runVersion,
      state: extraState.dungeon.runState,
      content: dungeonEncounter.content,
      users: fetchedUsers.filter((user) => userIds.includes(user.userId)),
      createBattle,
      didClaim: (result) => !result.failed && claimedEveryone(result),
    });
    if (!committed.success) return errorResponse(committed.message);
    result = committed.result;
  } else if (attempt && hasEntryCharges) {
    const player = users.find((u) => u.userId === attempt.userId);
    const committed = await commitQuestEntryBattle({
      client,
      attempt,
      items: entryInventory,
      role: player?.role ?? "USER",
      createBattle,
      didClaim: claimedEveryone,
    });
    if (!committed.success) return errorResponse(committed.message);
    result = committed.result;
  } else if (info.kageMatch) {
    // The match receipt, battle and both participant claims commit together. A failed
    // preload or write consumes neither the slot nor a daily/weekly challenge allowance.
    // A single guarded UPDATE cannot also insert the battle/history; throwing on a
    // partial participant claim rolls back all writes instead of publishing half a fight.
    const m = info.kageMatch;
    const changed = "Match admission changed. Refresh the schedule and try again.";
    const committed = await commitBattleAdmission({
      client,
      createBattle,
      didClaim: claimedEveryone,
      claimFailedMessage: changed,
      admit: async (tx, reject) => {
        const launchAt = new Date();
        // Consume consent with the receipt and participant claims so a rejected
        // launch restores the invitation rather than publishing half a fight.
        const leader = await updateVillageForInitiateBattle(tx, m, launchAt);
        if (leader.rowsAffected !== 1) reject(changed);
        const receipt = await updateKageDefendedChallengesForInitiateBattle(
          tx,
          battleId,
          launchAt,
          m,
        );
        if (receipt.rowsAffected !== 1) reject(changed);
      },
    });
    if (!committed.success) return errorResponse(committed.message);
    result = committed.result;
  } else if (info.hunting) {
    // The session reservation, battle/history inserts and guarded character claim must
    // commit together. The character claim also settles queued training and recovery;
    // a single CAS cannot cover those rows or undo them after a partial admission.
    const meta = info.hunting;
    const changed = "Your hunting session changed. Refresh the board and try again.";
    const committed = await commitBattleAdmission({
      client,
      createBattle,
      didClaim: claimedEveryone,
      claimFailedMessage: changed,
      admit: async (tx, reject) => {
        // Reserve only while the accepted session and allowance remain unchanged.
        const session = await updateHuntingSessionForInitiateBattle(
          tx,
          battleId,
          meta,
          sector,
        );
        if (session.rowsAffected !== 1) reject(changed);
      },
    });
    if (!committed.success) return errorResponse(committed.message);
    result = committed.result;
  } else if (info.tournamentGame) {
    // Battle/history inserts and both user claims must commit together. A single-row
    // CAS cannot hide a staged battle from recovery or roll back partial claims'
    // training and pool recovery; status compensation cannot undo those writes.
    const committed = await commitBattleAdmission({
      client,
      createBattle,
      didClaim: claimedEveryone,
      claimFailedMessage: "Attack failed, did the target move?",
    });
    if (!committed.success) return errorResponse(committed.message);
    result = committed.result;
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
        : (await listUserDataForInitiateBattle(client, battleId)).map(
            (row) => row.userId,
          );
    const claimed = queuedParticipants.filter((entry) =>
      claimedIds.includes(entry.user.userId),
    );
    const logs = buildQueuedTrainingLogs(claimed);
    if (logs.length) {
      try {
        await insertTrainingLogForInitiateBattle(client, logs);
      } catch (error) {
        Sentry.captureException(error, { tags: { source: "energyTrainingQueueLog" } });
      }
    }
  }

  // Undo only this battle's claims and rows, including successful siblings of a failed write.
  if (result.failed || result.claimedUsers?.rowsAffected !== expectedRows) {
    const recoveryActorId = actionReadiness?.userRecovery?.userId;
    // A separate actor receipt proves recovery committed and compensation still owns its activity.
    const [actorCompensation] = await Promise.all([
      updateUserDataForInitiateBattle(
        client,
        info,
        battleType,
        battleId,
        recoveryActorId ? eq(userData.userId, recoveryActorId) : undefined,
      ),
      recoveryActorId
        ? updateUserDataForInitiateBattle(
            client,
            info,
            battleType,
            battleId,
            ne(userData.userId, recoveryActorId),
          )
        : undefined,
      deleteBattleById(client, battleId),
      deleteBattleHistoryByBattleId(client, battleId),
    ]);
    if (result.failed) throw result.failed.reason;
    const failure = errorResponse("Attack failed, did the target move?");
    if (!recoveryActorId || !actionReadiness) return failure;
    if (actorCompensation.rowsAffected !== 1) {
      // Neither an aggregate claim nor a lost compensation guard proves the actor recovered.
      return {
        ...failure,
        userRecovery: { userId: recoveryActorId, requiresUserRefresh: true },
      };
    }
    const isolatedActor =
      info.questAttempt?.isolated && info.questAttempt.userId === recoveryActorId;
    const activity =
      !isolatedActor &&
      (battleType === "RANKED_PVP" ||
        (battleType === "TERRITORY_WAR" && info.clanBattle))
        ? null
        : getActionRecoveryActivity(actionReadiness.user, {
            status: isolatedActor ? "BATTLE" : "AWAKE",
            battleId: null,
          });
    return actionReadinessResponse(
      failure,
      {
        ...actionReadiness,
        // Participant claims publish training history and can settle fields beyond recovery.
        trainingLogs: [],
        userRecovery: { userId: recoveryActorId, requiresUserRefresh: true },
      },
      client,
      activity,
    );
  }

  if (actionReadiness?.userRecovery) {
    actionReadiness.userRecovery.activity = getActionRecoveryActivity(
      actionReadiness.user,
      { status: "BATTLE", battleId },
    );
  }
  try {
    // Push websockets message to target
    notifyBattleDefenders(client, {
      battleId,
      battleType,
      initiatorIds: info.userIds,
      users,
    });
    // Keep human fighters on the sector map as combat markers so nearby players
    // can see who is fighting. AI templates are not sector-map entities and must
    // not be broadcast. Auto-battles stay off this broadcast.
    if (!AutoBattleTypes.includes(battleType)) {
      await Promise.all(
        users.map(async (user) => {
          await Promise.all([
            pusher.trigger(user.userId, "event", {
              type: "battle",
              battleId,
              // Match push recipients; initiating fighters stay silent across their tabs.
              isDefender: !user.isAi && !info.userIds.includes(user.userId),
              ...(user.userId === actionActorId && info.originSocketId
                ? { originSocketId: info.originSocketId }
                : {}),
              ...(user.userId === actionActorId && actionReadiness?.userRecovery
                ? { userRecovery: superjson.serialize(actionReadiness.userRecovery) }
                : {}),
            }),
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
  } catch (error) {
    // The dungeon battle and its entry payment are committed. Polling restores navigation
    // when publication fails; compensation must never erase this paid, playable battle.
    if (!dungeonEncounter) throw error;
    Sentry.captureException(error, { tags: { source: "dungeonBattlePublication" } });
  }

  const userUpdate = getCombatAdmissionUserUpdate({
    cacheActor,
    requiresUserRefresh,
    allParticipantIds,
    queuedParticipants,
    battleType,
    warAggressorIds,
    bracketImmunityAggressorIds,
    now,
    battleId,
    stealthBreakUserIds,
    isTournament: !!info.tournamentGame,
    hasRecoveryProjection: !!actionReadiness?.userRecovery?.userPatch,
    recoveredEnergy:
      typeof actionReadiness?.set.curEnergy === "number"
        ? actionReadiness.set.curEnergy
        : undefined,
    isAttacker: userIds.includes(cacheActor?.userId ?? ""),
  });
  return actionReadinessResponse(
    {
      success: true,
      message: "You have attacked",
      battleId,
      requiresUserRefresh,
      ...userUpdate,
    },
    // Participant settlement publishes training history; recovery only ends the hospital activity here.
    actionReadiness ? { ...actionReadiness, trainingLogs: [] } : undefined,
    client,
    actionReadiness?.userRecovery?.activity,
  );
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
 * Animation relations become rendering-only snapshots; reprocessed combatants keep
 * their existing snapshots so live assignment edits cannot change an ongoing battle.
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
    /** Owning attempts must remain available even when authored as achievements. */
    questIds?: string[];
    /** Raw rows shared only within one preparation; every transformation receives a clone. */
    summonTemplateCache?: Map<string, Promise<CombatQueryUser[]>>;
    width: number;
    height: number;
    petPreload?: Pick<
      Parameters<typeof addPetsToBattle>[0],
      "pets" | "ownerRanks" | "abilitiesByOwner" | "selectedPetIdsByOwner"
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
  const isRankedBattle = RankedBattleTypes.includes(battleType);
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
      spriteAnimations: inputUser.spriteAnimationBindings
        ? snapshotSpriteAnimations(inputUser.spriteAnimationBindings)
        : (inputUser.spriteAnimations ?? {}),
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
            regenTicksSince(user.regenAt),
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
    if (isRankedBattle && !user.isAi) {
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
    user.highestGenerals = getHighestGenerals(user);

    // Fight at the XP-derived effective level, not the stored level, since some things scale
    // with level. This raises level holders and, by design, lags a user who just leveled up.
    // Ranked battles keep their normalized level.
    if (!isRankedBattle) {
      user.level = getEffectiveLevel(user);
    }

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
      isWarMercenary(info.wars, user.userId)
    ) {
      user.isMasked = true;
      user.username = "Mercenary";
      user.spriteAppearance = anonymousSpriteAppearance();
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
      user.spriteAppearance = anonymousSpriteAppearance(true);
      user.avatar = user.anbuSquad.image;
      user.avatarLight = user.anbuSquad.image;
    }

    // For ally village check later
    const ownSector = user.sector === user.village?.sector;

    const fitsBattle = (usage: BattleUsageType) => fitsBattleUsage(battleType, usage);

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
      userEffects.push(
        realizePassiveEffect({
          tag: IncreaseDamageGivenTag.parse({
            power: ELEMENTAL_MASTERY_BOOST,
            elements: [trainedElement],
            target: "SELF",
          }) as UserEffect,
          user,
          actionId: "elemental-mastery",
          level: user.level,
          fromType: "elementalMastery",
        }),
      );
    }

    // Ranked replaces unique bloodline effects with a uniform, sealable damage bonus.
    if (user.bloodline) {
      const effects = isRankedBattle
        ? user.isAi
          ? []
          : [{ ...RANKED_BLOODLINE_DAMAGE_TAG }]
        : (user.bloodline.effects ?? []).filter((effect) => !isActivityBonus(effect));
      effects.forEach((effect: unknown) => {
        userEffects.push(
          realizePassiveEffect({
            tag: effect as UserEffect,
            user,
            actionId: user.bloodline?.id ?? "initial",
            level: user.level,
            fromType: "bloodline",
          }),
        );
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
    if (user.userSkills && user.userSkills.length > 0 && !isRankedBattle) {
      user.userSkills.forEach(
        (userSkill: {
          skillId: string;
          skill: { target?: string; effects?: unknown[] };
        }) => {
          const skill = {
            ...userSkill.skill,
            effects: (userSkill.skill.effects as UserEffect[] | undefined)?.filter(
              (effect) => !isActivityBonus(effect),
            ),
          };
          if (!skill?.effects || skill.effects.length === 0) return;

          // Self-targeted effects can be applied immediately
          if (!skill.target || skill.target === "SELF") {
            skill.effects.forEach((effect: unknown) => {
              userEffects.push(
                realizePassiveEffect({
                  tag: effect as UserEffect,
                  user: user,
                  actionId: userSkill.skillId,
                  level: user.level,
                  fromType: "skill",
                }),
              );
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
          userEffects.push(
            realizePassiveEffect({
              tag: titleCombatTag(effect) as UserEffect,
              user,
              actionId: owned.titleId,
              level: 0,
              // Clear cannot remove permanent ownership bonuses; reuse the protected skill source.
              fromType: "skill",
            }),
          );
        }
      }
    }
    // Ownership was resolved at initiation; actions only consume realized battle effects.
    delete user.titles;

    for (const buff of inputUser.raidBuffs ?? []) {
      if (buff.expiresAt <= new Date()) continue;
      for (const effect of buff.effects) {
        if (effect.type === "increaseregeneration") continue;
        const realized = realizePassiveEffect({
          tag: { ...effect, rounds: undefined, powerPerLevel: 0 } as UserEffect,
          user,
          actionId: buff.id,
          level: 0,
          fromType: "item",
        });
        realized.timedBuffExpiresAt = buff.expiresAt.getTime();
        userEffects.push(realized);
      }
    }
    user.raidBuffs = undefined;

    // Add users effects to the battle
    if (user.effects.length > 0) {
      user.effects.forEach((effect: unknown) => {
        userEffects.push(
          realizePassiveEffect({
            tag: effect as UserEffect,
            user: user,
            actionId: "initial",
            level: user.level,
            fromType: "bloodline",
          }),
        );
      });
      user.effects = []; // Reset to avoid storing in battle table
    }

    // Filter and process jutsus - DO NOT apply reskins here, they are applied dynamically
    // in userJutsuToAction to ensure each user sees their own reskin.
    // user.userSkills was cleared for storage above; gates read the captured skills.
    const gateUser = { ...user, userSkills: requirementSkills };
    const processedJutsus = user.jutsus.filter((userjutsu) => {
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
      user.jutsus.sort(compareByLoadoutOrder(user.loadout.jutsuIds));
    }

    // Determine equipped keystone item name for quick display later
    const keystoneItem = user.items.find(
      (useritem) =>
        useritem.item.itemType === "KEYSTONE" && useritem.equipped === "KEYSTONE",
    );
    user.keystoneName = keystoneItem?.item.name ?? null;
    user.keystoneItem = keystoneItem?.item ?? null;

    // Add item effects
    const items: ProcessedItem[] = [];
    user.items
      .filter((ui) => {
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
        const effects = [
          ...(ui.item.effects as UserEffect[]),
          ...imbuementEffects,
        ].filter((effect) => !isActivityBonus(effect));
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
            ui.equipped !== "NONE" &&
            (!ui.item.bloodlineId || ui.item.bloodlineId === user.bloodlineId)
          ) {
            effects.forEach((effect) => {
              userEffects.push(
                realizePassiveEffect({
                  tag: effect,
                  user: user,
                  actionId: ui.itemId,
                  // AI gear can never earn item XP; keep character-level scaling
                  // for AI so boss/raid content is not silently nerfed to level 1.
                  level: user.isAi ? user.level : ui.level,
                  fromType:
                    itemType === "ACCESSORY"
                      ? "accessory"
                      : itemType === "KEYSTONE"
                        ? "keystone"
                        : "armor",
                }),
              );
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

    // Roll initiative
    user.initiative = rollInitiative(user, users, user.village?.sector);

    // Add relevant relations to usersState
    user.relations = relations.filter(
      (r) => r.villageIdA === user.villageId || r.villageIdB === user.villageId,
    );

    // Check if we are in ally village or not
    if (!ownSector) {
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
    // Capture visual inputs during initiation/loadout processing, never during performAction.
    if (!inputUser.isAi && !user.isMasked && user.username !== "ANBU Member") {
      user.spriteBaseAppearance ??= resolveSpriteAppearance({
        ...inputUser,
        items: [],
      });
      user.spriteEquipment = resolveSpriteEquipment(user.items);
      user.spriteAppearance = withSpriteEquipment(
        user.spriteBaseAppearance,
        Object.values(user.spriteEquipment),
      );
    }
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
        const rows = await listUserDataForProcessUsersForBattle(
          client,
          missingSummonIds,
        );
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
  const initialDurability = Object.fromEntries(
    usersState.map((user) => [
      user.userId,
      Object.fromEntries(
        user.items
          .filter((ui) => ui.item.maxDurability > 0)
          .map((ui) => [ui.id, ui.durability]),
      ),
    ]),
  );

  // Build extraState from all users
  const extraState: ExtraState = {
    ...createEmptyExtraState(),
    enemySkills,
    wars: Object.fromEntries(info.wars.map((w) => [w.id, w])),
    relations: Object.fromEntries(info.relations.map((r) => [r.id, r])),
  };

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
      extraState.userQuests[user.controllerId] = filterCombatQuests(user.userQuests, [
        ...(info.questIds ?? []),
        ...(user.questData ?? [])
          .filter((tracker) => tracker.party)
          .map((tracker) => tracker.id),
      ]);
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
      lastUsedRound: uj.lastUsedRound,
      originalCooldown: uj.originalCooldown,
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
        lastUsedRound: ui.lastUsedRound,
        originalCooldown: ui.originalCooldown,
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
      spriteAnimationBindings: _spriteAnimationBindings,
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
        const realized = realizePassiveEffect({
          tag: structuredClone(effect),
          user: creator,
          actionId: pending.skillId,
          level: pending.level,
          targetId: target.userId,
          fromType: "skill",
        });
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
 * Tell a battle's clients a lobby change landed. The announced version is one past the
 * saved one so every client, the requester included, refetches getBattle.
 */
const announceLobbyChange = (userBattle: { id: string; version: number }) => {
  void pusher.trigger(userBattle.id, "event", { version: userBattle.version + 1 });
};
