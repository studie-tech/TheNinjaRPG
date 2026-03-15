import * as Sentry from "@sentry/nextjs";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  hasUserMiddleware,
  protectedProcedure,
  ratelimitMiddleware,
  serverError,
} from "@/api/trpc";
import * as mapData from "@/data/hexasphere.json";
import type { BattleType } from "@/drizzle/constants";
import {
  AutoBattleTypes,
  BATTLE_ARENA_DAILY_LIMIT,
  BattleTypes,
  type CombatBiome,
  DURABILITY_USABILITY_THR,
  GeneralTypes,
  HEXTILE_BIOMES,
  ID_ANIMATION_HEAL,
  ID_ANIMATION_HIT,
  ID_ANIMATION_SMOKE,
  ID_SFX_CLEANSE,
  ID_SFX_CLEAR,
  ID_SFX_HEAL,
  ID_SFX_HIT,
  ID_SFX_MOVE,
  ID_SFX_SMOKE,
  MAP_RESERVED_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  NonActionItemTypes,
  PvpBattleTypes,
  QuestBattleTypes,
  RANKS_RESTRICTED_FROM_PVP,
  REGEN_SECONDS,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
  StatTypes,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import type {
  AiProfile,
  GameSetting,
  RankedLoadout,
  Village,
  VillageAlliance,
} from "@/drizzle/schema";
import {
  battle,
  battleAction,
  battleHistory,
  bounty,
  gameAsset,
  gameSetting,
  item,
  jutsu,
  quest,
  questHistory,
  raidParticipation,
  sector,
  tournamentMatch,
  userData,
  village,
  villageAlliance,
  war,
} from "@/drizzle/schema";
import { getReskinnedBloodline } from "@/libs/bloodline";
import {
  availableUserActions,
  getDefaultBasicActions,
  performBattleAction,
  stillInBattle,
} from "@/libs/combat/actions";
import { performAIaction } from "@/libs/combat/ai_v2";
import {
  COMBAT_BORDER_BOTTOM,
  COMBAT_BORDER_LEFT,
  COMBAT_BORDER_RIGHT,
  COMBAT_BORDER_TOP,
  COMBAT_LOBBY_SECONDS,
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
import { applyEffects, checkFriendlyFire } from "@/libs/combat/process";
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
import {
  alignBattle,
  applyPoolAdjustmentsToBase,
  calcBattleResult,
  getBattleGrid,
  getDefaultBattleSizes,
  isEffectActive,
  maskBattle,
  maskBattleDynamic,
  rollInitiative,
} from "@/libs/combat/util";
import { fetchDmgConfig } from "@/libs/gamesettings";
import {
  calcActiveUserRegen,
  calcCP,
  calcHP,
  calcLevel,
  calcLevelRequirements,
  calcSP,
  capUserStats,
  manuallyAssignUserStats,
  scaleUserStats,
} from "@/libs/profile";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import {
  controlShownQuestLocationInformation,
  mockAchievementHistoryEntries,
} from "@/libs/quest";
import { toDefenceStat, toOffenceStat } from "@/libs/stats";
import { rollStealthKeep } from "@/libs/stealth";
import type { GlobalMapData } from "@/libs/threejs/types";
import { canTrainJutsu, checkJutsuItems } from "@/libs/train";
import { calcIsInVillage, getBiomeFromGlobalTile } from "@/libs/travel";
import { findWarsWithUser } from "@/libs/war";
import { fetchAiProfileById } from "@/routers/ai";
import { fetchSectorVillage } from "@/routers/village";
import { fetchActiveWars } from "@/routers/war";
import {
  fetchItemLoadouts,
  fetchUserItems,
  selectItemLoadout,
} from "@/server/api/routers/item";
import {
  fetchJutsuLoadouts,
  fetchUserJutsus,
  selectJutsuLoadout,
} from "@/server/api/routers/jutsu";
import { fetchUserSkills } from "@/server/api/routers/skillTree";
import type { DrizzleClient } from "@/server/db";
import { findRelationship } from "@/utils/alliance";
import { getRandomElement } from "@/utils/array";
import { randomInt } from "@/utils/math";
import { secondsFromDate, secondsFromNow, secondsPassed } from "@/utils/time";
import { canAccessStructure, getStrucBoost } from "@/utils/village";
import type { StatSchemaType } from "@/validators/combat";
import {
  BarrierTag,
  DecreaseDamageTakenTag,
  performActionSchema,
  statSchema,
} from "@/validators/combat";
import { fetchUpdatedUser, fetchUser } from "./profile";

// Debug flag when testing battle
const debug = false;

// Pusher instance
const pusher = getServerPusher();

export const combatRouter = createTRPCRouter({
  getBattle: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get current battle state" } })
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

          // Current state of battle
          const actId = userBattle.activeUserId;
          const activeUser = userBattle.usersState.find((u) => u.userId === actId);
          const hadActivity = userBattle.updatedAt > userBattle.roundStartAt;

          // Update the battle to the correct activeUserId & round. Default to current user
          const fetchedVersion = userBattle.version;
          const { progressRound, changedActor, actionRound } = alignBattle(
            userBattle,
            actionRounds,
            ctx.userId,
          );
          if (changedActor) userBattle.version = userBattle.version + 1;

          if (!actionRounds.includes(actionRound)) {
            actionRounds.push(actionRound);
          }

          // Calculate if the battle is over for this user, and if so update user DB
          // Fetch game settings for multipliers
          const result = calcBattleResult(
            userBattle,
            ctx.userId,
            userBattle.extraState.settings,
          );

          // Check if the battle is over, or state was updated
          const battleOver = result && result.friendsLeft + result.targetsLeft === 0;
          if (battleOver || progressRound || changedActor) {
            if (!hadActivity && actId && activeUser) {
              const { newBattle, actionEffects } = applyEffects(userBattle, actId);

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

              await Promise.all([
                updateBattle(
                  ctx.drizzle,
                  result,
                  ctx.userId,
                  newBattle,
                  fetchedVersion,
                ),
                createAction(ctx.drizzle, newBattle, [
                  {
                    battleRound: actionRound,
                    appliedEffects: actionEffects,
                    description: `${activeUser.username} stands and does nothing. `,
                    battleVersion: fetchedVersion,
                    actionId: "wait",
                    userId: activeUser.userId,
                  },
                ]),
              ]);
            } else {
              await updateBattle(
                ctx.drizzle,
                result,
                ctx.userId,
                userBattle,
                fetchedVersion,
              );
            }
          }

          // Update user
          if (result) {
            await Promise.all([
              updateUser(ctx.drizzle, pusher, userBattle, result, ctx.userId),
              updateWars(ctx.drizzle, pusher, userBattle, result, ctx.userId),
              updateKage(ctx.drizzle, userBattle, result), // no ctx.userId needed
              updateRaidProgress(ctx.drizzle, userBattle, ctx.userId),
            ]);
          }

          // Hide private state of non-session user
          const newMaskedBattle = maskBattle(userBattle, ctx.userId);

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
    .meta({ mcp: { enabled: true, description: "Get battle action log entries" } })
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
      const basicActionIds = [
        "basicAttack",
        "basicHeal",
        "move",
        "cleanse",
        "clear",
        "flee",
        "wait",
      ];

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
    .meta({ mcp: { enabled: true, description: "Get battle history graph data" } })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const attacker = alias(userData, "attacker");
      const defender = alias(userData, "defender");
      const results = await ctx.drizzle
        .select({
          attackerId: battleHistory.attackedId,
          defenderId: battleHistory.defenderId,
          attackerUsername: attacker.username,
          defenderUsername: defender.username,
          attackerAvatar: attacker.avatar,
          defenderAvatar: defender.avatar,
          total: sql<number>`COUNT(*)`,
        })
        .from(battleHistory)
        .innerJoin(attacker, eq(battleHistory.attackedId, attacker.userId))
        .innerJoin(defender, eq(battleHistory.defenderId, defender.userId))
        .where(
          and(
            eq(battleHistory.battleType, "COMBAT"),
            or(
              eq(battleHistory.attackedId, input.userId),
              eq(battleHistory.defenderId, input.userId),
            ),
          ),
        )
        .groupBy(battleHistory.attackedId, battleHistory.defenderId);
      const userIds = results
        .flatMap((x) => [x.attackerId, x.defenderId])
        .filter((x) => x !== input.userId);
      if (userIds.length > 0) {
        const level2 = await ctx.drizzle
          .select({
            attackerId: battleHistory.attackedId,
            defenderId: battleHistory.defenderId,
            attackerUsername: attacker.username,
            defenderUsername: defender.username,
            attackerAvatar: attacker.avatar,
            defenderAvatar: defender.avatar,
            total: sql<number>`COUNT(*)`,
          })
          .from(battleHistory)
          .innerJoin(attacker, eq(battleHistory.attackedId, attacker.userId))
          .innerJoin(defender, eq(battleHistory.defenderId, defender.userId))
          .where(
            and(
              eq(battleHistory.battleType, "COMBAT"),
              or(
                and(
                  inArray(battleHistory.attackedId, userIds),
                  ne(battleHistory.defenderId, input.userId),
                ),
                and(
                  inArray(battleHistory.defenderId, userIds),
                  ne(battleHistory.attackedId, input.userId),
                ),
              ),
            ),
          )
          .groupBy(battleHistory.attackedId, battleHistory.defenderId);
        if (level2) results.push(...level2);
      }

      // Filter the results to only include the top 50 edges
      const topFights = results.sort((a, b) => b.total - a.total).slice(0, 100);

      return topFights;
    }),
  getBattleHistoryEntry: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get specific battle history entry" } })
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
    .meta({ mcp: { enabled: true, description: "Get user battle history" } })
    .input(
      z.object({
        userId: z.string().optional(),
        secondsBack: z.number().optional(),
        combatTypes: z.array(z.enum(BattleTypes)).optional(),
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
          ...(input.secondsBack
            ? [gt(battleHistory.createdAt, secondsFromNow(-3600 * 3))]
            : []),
          ...(input.combatTypes
            ? [inArray(battleHistory.battleType, input.combatTypes)]
            : []),
        ),
        with: {
          attacker: { columns: { username: true, userId: true, avatar: true } },
          defender: { columns: { username: true, userId: true, avatar: true } },
        },
        orderBy: [desc(battleHistory.createdAt)],
      });
      return results;
    }),

  performAction: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Perform action in battle" } })
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
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

        // Create the grid for the battle
        const grid = getBattleGrid(1, battle);

        // For kage battles, only allow one move per action
        const maxActions = AutoBattleTypes.includes(battle.battleType) ? 1 : 5;

        // Instantiate new state variables
        const history: {
          battleRound: number;
          appliedEffects: ActionEffect[];
          description: string;
          battleVersion: number;
          actionId?: string;
          userId?: string;
        }[] = [];

        // Remember original values for round & activeUserId
        const originalRound = battle.round;
        const originalActiveUserId = battle.activeUserId;

        // Battle state to update during inner loop
        let newBattle: CompleteBattle = battle;
        let actionPerformed = false;
        let nActions = 0;

        // INNER LOOP: Keep updating battle state until all actions have been performed
        while (true) {
          // Update the battle to the correct activeUserId & round. Default to current user
          const { actor, actionRound } = alignBattle(newBattle, actionRounds, suid);
          if (debug) {
            console.log(
              `============ 1. Actor: ${actor.username} - ${actor.userId} ============`,
            );
          }

          // Record all rounds for this endpoint call¨
          if (!actionRounds.includes(actionRound)) {
            actionRounds.push(actionRound);
          }

          // Only allow action if it is the users turn
          const isUserTurn = !actor.isAi && actor.controllerId === suid;
          const isAITurn = actor.isAi;
          if (!isUserTurn && !isAITurn) {
            return { notification: `Not your turn. Wait for ${actor.username}` };
          }

          // If userId, actionID, and position specified, perform user action
          const battleDescriptions: string[] = [];
          const actionEffects: ActionEffect[] = [];
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
            const actions = availableUserActions(newBattle, suid, true, true);
            const action = actions.find((a) => a.id === input.actionId);
            if (!action)
              return { notification: `Action not valid anymore. Try something else` };
            performedActionId = action.id;
            performedByUserId = actor.userId;
            if (AutoBattleTypes.includes(battle.battleType)) {
              throw serverError("FORBIDDEN", `Cheater`);
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

          // If no description, means no actions, just return now
          let description = battleDescriptions.join(". ");
          if (!description && actionPerformed && history.length === 0) {
            return { updateClient: false, notification: "No battle description" };
          }

          // Check if everybody finished their action, and if so, fast-forward the battle
          const { actor: newActor, progressRound } = alignBattle(
            newBattle,
            actionRounds,
            suid,
          );
          if (actionPerformed && progressRound) {
            const dot = description.endsWith(".");
            description += `${dot ? "" : ". "} It is now ${newActor.username}'s turn.`;
          }

          // Add history entry for what happened during this round
          if (description) {
            history.push({
              battleRound: actionRound,
              appliedEffects: actionEffects,
              description: description,
              battleVersion: newBattle.version + nActions,
              actionId: performedActionId ?? "unknown",
              userId: performedByUserId ?? actor.userId,
            });
            nActions += 1;
          }

          // Calculate if the battle is over for this user, and if so update user DB
          const result = calcBattleResult(
            newBattle,
            suid,
            newBattle.extraState.settings,
          );

          // Check if we should let the inner-loop continue
          if (
            newActor.isAi && // Continue new loop if it's an AI
            nActions < maxActions && // and we haven't performed 5 actions yet
            !result && // and the battle is not over for the user
            (newActor.userId !== actor.userId || description) // and new actor, or successful attack
          ) {
            continue;
          }

          // If battle state didn't change, just return without updating battle version
          if (
            !actionPerformed &&
            newBattle.round === originalRound &&
            newBattle.activeUserId === originalActiveUserId
          ) {
            return { notification: `Battle state was not changed` };
          }

          // Optimistic update for all other users before we process request. Also increment version
          const battleOver = result && result.friendsLeft + result.targetsLeft === 0;

          // Only keep visual tags that are newer than original round
          newBattle.groundEffects = newBattle.groundEffects.filter(
            (e) => e.type !== "visual" || e.createdRound >= originalRound,
          );

          /**
           * DATABASE UPDATES in parallel transaction
           */
          try {
            newBattle.version = newBattle.version + nActions;
            await updateBattle(db, result, suid, newBattle, battle.version);
            const [logEntries, { updatedQuestIds }] = await Promise.all([
              createAction(db, newBattle, history),
              updateUser(db, pusher, newBattle, result, suid),
              saveUsage(db, newBattle, result, suid),
              updateKage(db, newBattle, result),
              updateClanLeaders(db, newBattle, result, suid),
              updateVillageAnbuClan(db, newBattle, result, suid),
              updateWars(db, pusher, newBattle, result, suid),
              updateTournament(db, newBattle, result, suid),
              result ? updateRaidProgress(db, newBattle, suid) : Promise.resolve(),
            ]);
            // Return dynamic battle update (excludes extraState for efficiency)
            // Frontend should merge this with existing extraState
            const newMaskedBattle = maskBattleDynamic(newBattle, suid);

            // Ping users on websocket
            if (!battleOver) {
              // Only push websocket data if there is more than one non-AI in battle
              const nUsers = battle.usersState.filter((u) => !u.isAi).length;
              if (nUsers > 1) {
                void pusher.trigger(battle.id, "event", {
                  version: battle.version + 1,
                });
              }
            }

            // Stop profiling
            Sentry.profiler.stopProfiler();
            await Sentry.flush(15000);

            // Return the new battle + result state if applicable
            // Note: battleUpdate excludes extraState - frontend merges with existing
            return {
              result: result,
              updateClient: true,
              logEntries: logEntries,
              battleUpdate: newMaskedBattle,
              updatedQuestIds: updatedQuestIds,
            };
          } catch (_e) {
            return {
              notification: `Seems like the battle was out of sync with server, please try again`,
            };
          }
        }
      }
    }),
  battleArenaHeal: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Heal in battle arena for ryo" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.money < 500) return errorResponse("You don't have enough money");
      if (user.isBanned) return errorResponse("You are banned");
      // Mutate with guard
      const result = await ctx.drizzle
        .update(userData)
        .set({
          money: user.money - 500,
          curHealth: user.maxHealth,
          curStamina: user.maxStamina,
          curChakra: user.maxChakra,
        })
        .where(and(eq(userData.userId, ctx.userId), gte(userData.money, 500)));
      if (result.rowsAffected === 0) {
        return errorResponse("Error trying to heal and continue. Try again.");
      } else {
        return { success: true, message: "You've healed" };
      }
    }),
  startArenaBattle: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Start battle arena fight against AI" },
    })
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(z.object({ aiId: z.string(), stats: statSchema.nullish() }))
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Get information
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const [selectedAI, sectorVillage] = await Promise.all([
        ctx.drizzle.query.userData.findFirst({
          where: and(
            eq(userData.userId, input.aiId),
            eq(userData.isAi, true),
            eq(userData.isSummon, false),
            eq(userData.inArena, true),
          ),
        }),
        fetchSectorVillage(ctx.drizzle, user?.sector ?? -1),
      ]);
      // Check that user was found
      if (!user) return errorResponse("Attacking user not found");
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
          },
          input.stats ? "TRAINING" : "ARENA",
        );
      } else {
        return { success: false, message: "No AI found" };
      }
    }),
  attackUser: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Attack another user to initiate combat" },
    })
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(
      z.object({
        longitude: z
          .int()
          .min(0)
          .max(SECTOR_WIDTH - 1),
        latitude: z
          .int()
          .min(0)
          .max(SECTOR_HEIGHT - 1),
        sector: z.int(),
        userId: z.string(),
        asset: z.enum(HEXTILE_BIOMES).optional(),
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
      mcp: { enabled: true, description: "Update jutsu/item loadout in combat lobby" },
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
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        fetchUserSkills(ctx.drizzle, ctx.userId),
      ]);

      // Derived
      const user = userBattle?.usersState.find((u) => u.userId === ctx.userId);

      // Guard
      if (!userBattle) return errorResponse("You are not in a battle");
      if (!user) return errorResponse("You are not in this battle");
      if (user.iAmHere) return errorResponse("You are already marked as ready");
      if (userBattle.battleType !== "COMBAT") {
        return errorResponse("You can only update loadouts in combat");
      }
      if (!jId && !iId) {
        return errorResponse("No loadout IDs provided");
      }
      if (jId === user.jutsuLoadout && iId === user.itemLoadout) {
        return errorResponse("You already have this loadout selected");
      }

      // Mutate to update loadouts
      const [jutsuLoadoutResult, itemLoadoutResult] = await Promise.all([
        user.jutsuLoadout === jId || !jId
          ? { success: true, message: "Jutsu loadout already selected" }
          : selectJutsuLoadout(ctx.drizzle, jId, jutsuLoadouts, userjutsus, user),
        user.itemLoadout === iId || !iId
          ? { success: true, message: "Item loadout already selected" }
          : selectItemLoadout(ctx.drizzle, iId, itemLoadouts, useritems, user),
      ]);

      // Mutate
      userBattle.updatedAt = new Date();
      userBattle.version = userBattle.version + 1;

      // Build a user with updated loadout data for processing
      // We need to construct this from scratch with fresh data since user is BattleUserState
      const newJutsus =
        jId && "jutsus" in jutsuLoadoutResult && jutsuLoadoutResult.jutsus
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
      const otherUserEffects = userBattle.usersEffects.filter(
        (e) => e.creatorId !== ctx.userId,
      );

      // Preserve original initiative and direction to avoid changing them when updating loadouts
      // Direction is important for RAID battles where friendly fire is determined by direction
      const originalInitiative = user.initiative;
      const originalDirection = user.direction;

      // Hydrate jutsus and items from extraState if not using new loadouts
      // We reconstruct CombatQueryUser format from BattleUserState refs + extraState
      const now = new Date();
      const hydratedJutsus =
        newJutsus ??
        user.jutsus
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
              userId: user.controllerId,
              createdAt: now,
              updatedAt: now,
              storedAtHome: false,
              isInAuction: false,
              craftingFinishedAt: null,
            };
          })
          .filter((i): i is NonNullable<typeof i> => i !== null);

      // Build raw user for processing - hydrate from existing battle staticData and merge new data
      // We need to add back the village, bloodline, and aiProfile from extraState since CombatQueryUser requires them
      const village = user.villageId
        ? userBattle.extraState.villages?.[user.villageId]
        : null;
      const bloodline = user.bloodlineId
        ? userBattle.extraState.bloodlines?.[user.bloodlineId]
        : null;
      const questData = userBattle.extraState.questData?.[user.controllerId];
      const aiProfile =
        user.aiProfileId && user.aiProfileId !== "Default"
          ? userBattle.extraState.aiProfiles?.[user.aiProfileId]
          : userBattle.extraState.aiProfiles?.Default;
      // Build rawUserForProcessing from BattleUserState + extraState data
      // The jutsus/items are reconstructed from refs + static data with all required fields
      const rawUserForProcessing = {
        ...user,
        bloodline: bloodline ?? null,
        jutsuLoadout: jId ?? user.jutsuLoadout,
        itemLoadout: iId ?? user.itemLoadout,
        jutsus: hydratedJutsus,
        items: hydratedItems,
        userSkills: userSkills.filter((us) => us.activated),
        village: village ?? null,
        aiProfile: aiProfile ?? null,
        questData: questData ?? [],
      };

      // Process only the single user
      const { userEffects, usersState, extraState } = await processUsersForBattle(
        ctx.drizzle,
        {
          users: [rawUserForProcessing],
          settings: data.settings,
          relations: data.relations,
          wars: data.activeWars,
          villages: data.villages,
          defaultProfile: data.defaultProfile,
          battleType: userBattle.battleType,
          width: userBattle.width,
          height: userBattle.height,
          hide: false,
          isSummon: false,
        },
      );

      // Restore original initiative and direction
      if (usersState[0]) {
        usersState[0].initiative = originalInitiative;
        usersState[0].direction = originalDirection;
      }

      // Merge the user's state with the other user's state
      userBattle.usersState = [...otherUserState, ...usersState];
      userBattle.usersEffects = [...otherUserEffects, ...userEffects];

      // Merge extraState: add new jutsus/items from the updated loadout to existing extraState
      // This ensures new jutsus/items can be looked up by ID during battle
      // Defensively initialize extraState and its nested maps to avoid undefined errors
      userBattle.extraState = userBattle.extraState || {};
      userBattle.extraState.jutsus = userBattle.extraState.jutsus || {};
      userBattle.extraState.jutsuReskins = userBattle.extraState.jutsuReskins || {};
      userBattle.extraState.items = userBattle.extraState.items || {};
      Object.assign(userBattle.extraState.jutsus, extraState.jutsus);
      Object.assign(userBattle.extraState.jutsuReskins, extraState.jutsuReskins);
      Object.assign(userBattle.extraState.items, extraState.items);

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
          message: "",
          battle: maskBattle(userBattle, ctx.userId),
        };
      } else {
        return { success: false, message: "Battle state could not be updated" };
      }
    }),
  iAmHere: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Mark ready in combat lobby" } })
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
  startShrineBattle: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start battle at war shrine" } })
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(z.object({ sector: z.int() }))
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

      // Helper to check if user is on attacker side (including allies)
      const isUserOnAttackerSide = (w: (typeof activeWars)[number]) =>
        w.attackerVillageId === user?.villageId ||
        w.warAllies?.some(
          (ally) =>
            ally.villageId === user?.villageId &&
            ally.supportVillageId === w.attackerVillageId,
        );

      // Helper to check if user is on defender side (including allies)
      const isUserOnDefenderSide = (w: (typeof activeWars)[number]) =>
        w.defenderVillageId === user?.villageId ||
        w.warAllies?.some(
          (ally) =>
            ally.villageId === user?.villageId &&
            ally.supportVillageId === w.defenderVillageId,
        );

      // Find the war the user is involved with
      // For SECTOR_WAR: check war.sector matches and user is attacker
      // For VILLAGE_WAR/WAR_RAID: check village sectors for attack OR defend scenarios
      const userWar = activeWars.find((w) => {
        if (w.status !== "ACTIVE") return false;

        if (w.type === "SECTOR_WAR") {
          // Sector wars use war.sector and only attackers can attack
          return w.sector === input.sector && isUserOnAttackerSide(w);
        }

        if (["VILLAGE_WAR", "WAR_RAID"].includes(w.type)) {
          const atDefenderVillage = w.defenderVillage?.sector === input.sector;
          const atAttackerVillage = w.attackerVillage?.sector === input.sector;

          // Attack scenarios: at enemy's village (reduce their shrine HP)
          const canAttack =
            (atDefenderVillage && isUserOnAttackerSide(w)) ||
            (atAttackerVillage && isUserOnDefenderSide(w));

          // Defend scenarios: at own village when shrine is damaged (restore shrine HP)
          const canDefend =
            (atAttackerVillage &&
              isUserOnAttackerSide(w) &&
              w.attackerShrineHp < w.attackerShrineMaxHp) ||
            (atDefenderVillage &&
              isUserOnDefenderSide(w) &&
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
      if (MAP_RESERVED_SECTORS.includes(input.sector)) {
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
      const shrineOwnerVillageId =
        isVillageWarOrRaid && userWar.attackerVillage?.sector === input.sector
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
              UserRequest.spectatable = true
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
export const fetchBattle = async (client: DrizzleClient, battleId: string) => {
  const result = await client.query.battle.findFirst({
    where: eq(battle.id, battleId),
  });
  if (!result) {
    return null;
  }
  return result as CompleteBattle;
};

export const initiateBattle = async (
  info: {
    longitude?: number;
    latitude?: number;
    sector?: number;
    userIds: string[];
    targetIds: string[];
    client: DrizzleClient;
    userStatDistribution?: StatSchemaType;
    targetStatDistribution?: StatSchemaType;
    scaleTarget?: boolean;
    forceLoadouts?: RankedLoadout[];
    forceDefenderVillageId?: string;
    biome?: CombatBiome;
    forceKeepPools?: boolean;
    raidQuestId?: string;
  },
  battleType: BattleType,
  scaleGains = 1,
) => {
  const { longitude, latitude, sector, userIds, targetIds, client } = info;

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

  // Use Promise.all to fetch all independent data in parallel
  const [
    { defaultProfile, activeWars, settings, villages, relations, dmgConfig },
    assets,
    achievements,
    fetchedUsers,
    previousBattleResults,
    loadoutJutsus,
    loadoutItems,
    injectableJutsus,
    raidQuest,
    sectorExclusiveRaids,
    raidParticipations,
  ] = await Promise.all([
    // Essentials
    fetchBattleEssentials(client),
    // Fetch game assets (only battlefield ones to avoid row limit)
    client.query.gameAsset.findMany({
      where: and(eq(gameAsset.hidden, false), eq(gameAsset.onInitialBattleField, true)),
    }),
    // Fetch achievements
    client
      .select()
      .from(quest)
      .where(and(eq(quest.questType, "achievement"), eq(quest.hidden, false))),
    // Fetch user data
    client.query.userData.findMany({
      with: {
        bloodline: true,
        village: { with: { structures: true, sectors: { columns: { sector: true } } } },
        loadout: { columns: { jutsuIds: true } },
        clan: true,
        anbuSquad: true,
        items: {
          with: {
            item: true,
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
        completedQuests: {
          columns: { id: true, questId: true, completed: true },
          where: gte(questHistory.completed, 1),
        },
        aiProfile: true,
        bounties: {
          columns: { id: true, status: true, amountRyo: true },
          where: eq(bounty.status, "OPEN"),
        },
        bountySignups: {
          columns: { id: true, bountyId: true },
        },
      },
      where: or(inArray(userData.userId, userIds), inArray(userData.userId, targetIds)),
    }),
    PvpBattleTypes.includes(battleType)
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
                  inArray(battleHistory.attackedId, userIds),
                  inArray(battleHistory.defenderId, targetIds),
                ),
              ),
              gt(battleHistory.createdAt, secondsFromDate(-60 * 60, new Date())),
            ),
          )
      : null,
    jutsusIds.length > 0
      ? client.query.jutsu.findMany({ where: inArray(jutsu.id, jutsusIds) })
      : [],
    itemIds.length > 0
      ? client.query.item.findMany({ where: inArray(item.id, itemIds) })
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
    // Fetch raid participation records for battleCount guard (if applicable)
    battleType === "RAID" && info.raidQuestId
      ? client.query.raidParticipation.findMany({
          where: eq(raidParticipation.questId, info.raidQuestId),
          columns: { userId: true, battleCount: true },
        })
      : [],
  ]);

  // If we have forced loadouts, overwrite user items and jutsus appropriately
  if (info.forceLoadouts && info.forceLoadouts.length > 0) {
    for (const user of fetchedUsers) {
      const userLoadout = info.forceLoadouts.find((l) => l.userId === user.userId);
      if (userLoadout) {
        user.items = loadoutItems
          .filter((item) =>
            [userLoadout.loadout.weaponIds, userLoadout.loadout.consumableIds]
              .flat()
              .includes(item.id),
          )
          .map((item) => ({
            id: nanoid(),
            createdAt: new Date(),
            updatedAt: new Date(),
            userId: user.userId,
            itemId: item.id,
            quantity: 1,
            equipped: "ITEM_1" as const,
            item: item,
            storedAtHome: false,
            craftingFinishedAt: null,
            isInAuction: false,
            imbuements: [],
            dropChancePerc: 0,
            durability: 100,
          }));
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

  // Create the users array to be inserted in battle. We do it like this in case some of the targetIds are entered multiple times
  const users = [...userIds, ...targetIds]
    .map((id) => structuredClone(fetchedUsers.find((u) => u.userId === id)))
    .filter((u): u is NonNullable<typeof u> => u !== undefined);

  // Hide some information from quests
  users.forEach((user) => {
    user.userQuests?.forEach((q) => {
      controlShownQuestLocationInformation(q.quest, user);
    });
  });
  // Place attackers first
  users.sort((a) => (userIds.includes(a.userId) ? -1 : 1));

  // Check if the villageData is in a pvp enabled zone
  const sectorData = villages.find((v) => v.sector === sector);

  // Special check for Wake Island - always block if sector is 222
  if (sector === MAP_WAKE_ISLAND_SECTOR && battleType === "COMBAT") {
    return { success: false, message: "Cannot attack players in Wake Island" };
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

  // Loop through each user
  for (const i of users.keys()) {
    // Get the user
    const user = users[i];
    if (!user) return { success: false, message: "Could not find expected user" };

    // If user is banned
    if (user.isBanned) return { success: false, message: `${user.username} is banned` };

    // Force defender village id
    if (info?.forceDefenderVillageId && targetIds.includes(user.userId)) {
      user.villageId = info.forceDefenderVillageId;
    }

    // Check if user is asleep
    const QUEUED_BATTLES = ["RANKED_PVP", "CLAN_BATTLE", "KAGE_PVP", "RAID"];
    const isQueuedBattle = QUEUED_BATTLES.includes(battleType);
    const isAutoBattle = AutoBattleTypes.includes(battleType);
    const isShrineBattle = battleType === "SHRINE_WAR";

    // Special handling for KAGE_PVP battles
    if (battleType === "KAGE_PVP") {
      // For KAGE_PVP: challenger should be KAGE_QUEUED, kage should be AWAKE
      if (userIds.includes(user.userId) && user.status !== "KAGE_QUEUED") {
        return {
          success: false,
          message: `Challenger ${user.username} is not in kage queue`,
        };
      }
      if (targetIds.includes(user.userId) && user.status !== "AWAKE") {
        return { success: false, message: `Kage ${user.username} is not awake` };
      }
    } else if (!isAutoBattle && !user.isAi) {
      // For other battles, check if user status is appropriate (skip AI users)
      const isOk = isQueuedBattle
        ? user.status === "QUEUED"
        : isShrineBattle
          ? ["AWAKE", "QUEUED"].includes(user.status)
          : user.status === "AWAKE";
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

    // Level restrictions - prevent attacking users more than 15 levels under or above (skip if in war-torn sector or at war)
    if (battleType === "COMBAT" && userIds.includes(user.userId)) {
      const isInWarTornSector = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
      if (!isInWarTornSector) {
        const attackerLevel = calcLevel(user.experience);

        // Check for non-compliant targets without creating copies
        const nonCompliantTarget = users.find(
          (u) =>
            targetIds.includes(u.userId) &&
            !u.isAi &&
            Math.abs(attackerLevel - calcLevel(u.experience)) > 15,
        );

        if (nonCompliantTarget) {
          // Check if attacker and target are at war - if so, bypass level restriction
          const areAtWar =
            findWarsWithUser(
              activeWars,
              activeWars,
              nonCompliantTarget.villageId,
              user.villageId,
            ).length > 0;

          if (!areAtWar) {
            const targetLevel = calcLevel(nonCompliantTarget.experience);
            const levelDifference = attackerLevel - targetLevel;

            if (levelDifference > 15) {
              return {
                success: false,
                message: `Cannot attack ${nonCompliantTarget.username} - they are more than 15 levels below you (${levelDifference} level difference)`,
              };
            }

            if (levelDifference < -15) {
              return {
                success: false,
                message: `Cannot attack ${nonCompliantTarget.username} - they are more than 15 levels above you (${Math.abs(levelDifference)} level difference)`,
              };
            }
          }
        }
      }
    }

    // Scale targets
    if (info?.scaleTarget && targetIds.includes(user.userId) && users[0]) {
      user.level = users[0].level;
      scaleUserStats(user);
    }

    // Manually Assign Stats
    if (info?.targetStatDistribution && targetIds.includes(user.userId)) {
      manuallyAssignUserStats(user, info?.targetStatDistribution);
    }
    if (info?.userStatDistribution && userIds.includes(user.userId)) {
      manuallyAssignUserStats(user, info?.userStatDistribution);
    }

    // Apply caps to user stats
    capUserStats(user);

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
  let rewardScaling = (scaleGains * users.length) / 2;
  if (PvpBattleTypes.includes(battleType) && previousBattleResults) {
    const previousBattles = previousBattleResults?.[0]?.count || 0;
    if (previousBattles > 0) {
      rewardScaling = rewardScaling / (previousBattles + 1);
    }
  }

  // Create the users array to be inserted into the battle
  const { userEffects, usersState, extraState, initialDurability } =
    await processUsersForBattle(client, {
      users,
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
      isSummon: false,
    });

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
  const groundEffects: GroundEffect[] = [];
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
  const battleId = nanoid();

  // Figure out all textures used by items/jutsus effects (in appearAnimation, disappearAnimation, staticAnimation) for all users
  // Collect all unique texture and sfx asset paths from item and jutsu effects for all users
  const textureAssets = [
    ...users.flatMap((u) =>
      u.items.flatMap((i) =>
        (i.item?.effects ?? []).flatMap((e) => [
          e.appearAnimation,
          e.disappearAnimation,
          e.staticAnimation,
          e.staticAssetPath,
        ]),
      ),
    ),
    ...users.flatMap((u) =>
      u.jutsus.flatMap((j) =>
        (j.jutsu?.effects ?? []).flatMap((e) => [
          e.appearAnimation,
          e.disappearAnimation,
          e.staticAnimation,
          e.staticAssetPath,
        ]),
      ),
    ),
    // Include staticAssetPath from ground effects (barriers, etc.)
    ...groundEffects.map((e) => e.staticAssetPath),
  ]
    .filter((asset): asset is string => !!asset)
    .concat([ID_ANIMATION_SMOKE, ID_ANIMATION_HIT, ID_ANIMATION_HEAL]);

  const sfxAssets = [
    ...users.flatMap((u) =>
      u.items.flatMap((i) =>
        (i.item?.effects ?? []).flatMap((e) => [e.appearSfx, e.disappearSfx]),
      ),
    ),
    ...users.flatMap((u) =>
      u.jutsus.flatMap((j) =>
        (j.jutsu?.effects ?? []).flatMap((e) => [e.appearSfx, e.disappearSfx]),
      ),
    ),
  ]
    .filter((asset): asset is string => !!asset)
    .concat([
      ID_SFX_SMOKE,
      ID_SFX_HIT,
      ID_SFX_HEAL,
      ID_SFX_MOVE,
      ID_SFX_CLEANSE,
      ID_SFX_CLEAR,
    ]);

  // Calculate expected rows for user status update
  // For auto battles (KAGE_AI, CLAN_CHALLENGE), only the attacker userIds are updated
  // For other battles, all participants (userIds + targetIds) should be updated
  // Use Set to deduplicate - the database UPDATE affects unique rows by userId
  const allParticipantIds = [
    ...new Set(
      AutoBattleTypes.includes(battleType) ? userIds : [...userIds, ...targetIds],
    ),
  ];
  const expectedRows = allParticipantIds.length;

  // Handle stealth breaking for combat
  // Defenders always have stealth broken (force break)
  // Attackers roll to keep stealth based on their stealth stat
  const stealthBreakUserIds: string[] = [];

  // Defenders always lose stealth
  if (!AutoBattleTypes.includes(battleType)) {
    stealthBreakUserIds.push(...targetIds);
  }

  // Attackers roll to see if they keep stealth
  for (const userId of userIds) {
    const user = users.find((u) => u.userId === userId);
    if (user?.stealthActive) {
      const keepStealth = rollStealthKeep(user.stealth);
      if (!keepStealth) {
        stealthBreakUserIds.push(userId);
      }
    }
  }

  // Run battle creation and user status updates in parallel for performance
  const [, , userResult] = await Promise.all([
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
        jutsus: {
          ...extraState.jutsus,
          ...Object.fromEntries(injectableJutsus.map((j) => [j.id, j])),
        },
        dmgConfig: dmgConfig,
        settings: settings,
        textureAssets: textureAssets,
        sfxAssets: sfxAssets,
        initialDurability: initialDurability,
        raidQuestId: info.raidQuestId,
        raidInitialBossHp: raidInitialBossHp,
        raidStartBattleCount: Object.fromEntries(
          raidParticipations.map((p) => [p.userId, p.battleCount]),
        ),
        sectorExclusiveRaids: sectorExclusiveRaids,
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
        status: sql`CASE WHEN isAi = false THEN "BATTLE" ELSE "AWAKE" END`,
        battleId: sql`CASE WHEN isAi = false THEN ${battleId} ELSE NULL END`,
        pvpActivity: ["COMBAT"].includes(battleType)
          ? sql`${userData.pvpActivity} + 1`
          : sql`${userData.pvpActivity}`,
        pvpFights: ["SPARRING", "COMBAT"].includes(battleType)
          ? sql`${userData.pvpFights} + 1`
          : sql`${userData.pvpFights}`,
        pveFights: !["SPARRING", "COMBAT"].includes(battleType)
          ? sql`${userData.pveFights} + 1`
          : sql`${userData.pveFights}`,
        immunityUntil: ["SPARRING", "COMBAT"].includes(battleType)
          ? sql`CASE WHEN ${inArray(userData.userId, userIds)} THEN NOW() ELSE ${userData.immunityUntil} END`
          : sql`immunityUntil`,
        // Break stealth when entering combat
        // Defenders (being attacked) always lose stealth
        // Attackers roll to keep stealth based on their stealth stat
        stealthActive:
          stealthBreakUserIds.length > 0
            ? sql`CASE WHEN userId IN (${stealthBreakUserIds.map((id) => `"${id}"`).join(", ")}) THEN false ELSE stealthActive END`
            : sql`stealthActive`,
        stealthActivatedAt:
          stealthBreakUserIds.length > 0
            ? sql`CASE WHEN userId IN (${stealthBreakUserIds.map((id) => `"${id}"`).join(", ")}) THEN NULL ELSE stealthActivatedAt END`
            : sql`stealthActivatedAt`,
      })
      .where(
        and(
          or(
            inArray(userData.userId, userIds),
            ...(!AutoBattleTypes.includes(battleType)
              ? [inArray(userData.userId, targetIds)]
              : []),
          ),
          or(
            eq(userData.status, "AWAKE"),
            eq(userData.status, "QUEUED"),
            eq(userData.status, "KAGE_QUEUED"),
          ),
          ...(battleType === "COMBAT"
            ? [
                and(
                  ...(sector !== undefined ? [eq(userData.sector, sector)] : []),
                  ...(longitude !== undefined
                    ? [eq(userData.longitude, longitude)]
                    : []),
                  ...(latitude !== undefined ? [eq(userData.latitude, latitude)] : []),
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
  ]);

  // Check if expected number of users were updated - if not, rollback
  if (userResult.rowsAffected !== expectedRows) {
    await Promise.all([
      client
        .update(userData)
        .set({ status: "AWAKE", battleId: null })
        .where(eq(userData.battleId, battleId)),
      client.delete(battle).where(eq(battle.id, battleId)),
      client.delete(battleHistory).where(eq(battleHistory.battleId, battleId)),
    ]);
    return { success: false, message: "Attack failed, did the target move?" };
  }

  // Push websockets message to target
  const pusher = getServerPusher();

  // Hide users on map when in combat
  if (!AutoBattleTypes.includes(battleType)) {
    await Promise.all(
      users.map(async (user) => {
        await Promise.all([
          pusher.trigger(user.userId, "event", { type: "battle", battleId }),
          updateUserOnMap(pusher, user.sector, { ...user, sector: -1 }),
        ]);
      }),
    );
  }

  // Return the battle
  return { success: true, message: "You have attacked", battleId };
};

/**
 * Processes the users for a battle.
 *
 * @param users - An array of user objects from the database with combat relations.
 * @param hide - A boolean indicating whether to hide user on map. Defaults to `false`.
 * @returns An object containing the processed user effects, updated user states, and static data.
 *
 * This function takes CombatQueryUser objects and transforms them into BattleUserState,
 * extracting static data (jutsus, items, villages, quests, bounties, etc.) into extraState.
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
    isSummon: boolean;
    width: number;
    height: number;
  },
) => {
  // Destructure
  const {
    users,
    settings,
    relations,
    battleType,
    hide,
    leftSideUserIds,
    wars,
    width,
    height,
  } = info;
  // Collect user effects here
  const allSummons: string[] = [];
  const userEffects: UserEffect[] = [];
  const pendingSkillEffects: {
    creatorId: string;
    creatorVillageId: string | null;
    skillId: string;
    effects: UserEffect[];
    level: number;
    target: "ALLIES" | "ENEMIES";
  }[] = [];
  const takenLocations: { x: number; y: number }[] = [];

  // Loop through users and transform to ProcessingBattleUser
  const usersState: ProcessingBattleUser[] = users.map((inputUser) => {
    // Build the processing user object with all required fields
    const user: ProcessingBattleUser = {
      ...inputUser,
      // Set controllerID and mark this user as the original
      controllerId: inputUser.userId,
      userId: inputUser.isAi ? nanoid() : inputUser.userId,
      // Set direction based on team membership (leftSideUserIds determines left team)
      direction: leftSideUserIds?.includes(inputUser.userId) ? "left" : "right",
      // Set the updated at to now, so that action bar starts at 0
      updatedAt: new Date(),
      // If no village, set to syndicate
      villageId: inputUser.villageId || VILLAGE_SYNDICATE_ID,
      // Set all users to not be agressors by default
      isAggressor: false,
      // Initialize processing-specific fields (will be set below)
      highestOffence: "ninjutsuOffence",
      highestDefence: "ninjutsuDefence",
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
        ninjutsuOffence: 0,
        genjutsuOffence: 0,
        taijutsuOffence: 0,
        bukijutsuOffence: 0,
        ninjutsuDefence: 0,
        genjutsuDefence: 0,
        taijutsuDefence: 0,
        bukijutsuDefence: 0,
      },
      leftBattle: false,
      fledBattle: false,
      moneyStolen: 0,
      allyVillage: false,
      usedActions: [],
      initiative: 0,
      basicActions: [],
      // Add default AI profile if not set
      aiProfile: inputUser.aiProfile ?? info.defaultProfile,
      // Compatibility fields for ReturnedUserState (populated later during conversion)
      relationIds: [],
      warIds: [],
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
    const regen = calcActiveUserRegen(user, settings);
    const restored = (regen * secondsPassed(user.regenAt)) / REGEN_SECONDS;
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

    // For ranked battles, set level to 100 and normalize stats (skip for AI opponents)
    if (
      (battleType === "RANKED_PVP" || battleType === "RANKED_SPARRING") &&
      !user.isAi
    ) {
      user.maxHealth = calcHP(100);
      user.maxChakra = calcSP(100);
      user.maxStamina = calcCP(100);
      user.curHealth = user.maxHealth;
      user.curChakra = user.maxChakra;
      user.curStamina = user.maxStamina;
      user.level = 100;
      user.experience = calcLevelRequirements(100);
      user.rank = "ELITE JONIN";
      user.medicalExperience = 100000;
    }

    // Add highest offence name to user
    const offences = {
      ninjutsuOffence: user.ninjutsuOffence,
      genjutsuOffence: user.genjutsuOffence,
      taijutsuOffence: user.taijutsuOffence,
      bukijutsuOffence: user.bukijutsuOffence,
    };
    type offenceKey = keyof typeof offences;
    // If preferredStat is "Highest" or not set, calculate the actual highest stat
    if (!user.preferredStat || user.preferredStat === "Highest") {
      user.highestOffence = Object.keys(offences).reduce((prev, cur) =>
        offences[prev as offenceKey] > offences[cur as offenceKey] ? prev : cur,
      ) as offenceKey;
    } else {
      user.highestOffence = toOffenceStat(user.preferredStat);
    }

    // Add highest defence name to user
    const defences = {
      ninjutsuDefence: user.ninjutsuDefence,
      genjutsuDefence: user.genjutsuDefence,
      taijutsuDefence: user.taijutsuDefence,
      bukijutsuDefence: user.bukijutsuDefence,
    };
    type defenceKey = keyof typeof defences;
    // If preferredStat is "Highest" or not set, calculate the actual highest stat
    if (!user.preferredStat || user.preferredStat === "Highest") {
      user.highestDefence = Object.keys(defences).reduce((prev, cur) =>
        defences[prev as defenceKey] > defences[cur as defenceKey] ? prev : cur,
      ) as defenceKey;
    } else {
      user.highestDefence = toDefenceStat(user.preferredStat);
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
    // Skip for ranked battles as they have their level set to 100 in initiateBattle
    if (battleType !== "RANKED_SPARRING" && battleType !== "RANKED_PVP") {
      user.level = calcLevel(user.experience);
    }

    // Half the width of the battlefield
    const halfWidth = Math.floor(width / 2);

    // Convenience function for assigning location of user
    const assignLocation = (min: number, max: number) => {
      let x = randomInt(min + COMBAT_BORDER_LEFT, max - COMBAT_BORDER_RIGHT);
      let y = randomInt(1 + COMBAT_BORDER_BOTTOM, height - COMBAT_BORDER_TOP - 1);
      do {
        x = randomInt(min + COMBAT_BORDER_LEFT, max - COMBAT_BORDER_RIGHT);
        y = randomInt(1 + COMBAT_BORDER_BOTTOM, height - COMBAT_BORDER_TOP - 1);
      } while (takenLocations.some((l) => l.x === x && l.y === y));
      takenLocations.push({ x, y });
      return { x, y };
    };

    // Store original location
    user.originalLongitude = user.longitude;
    user.originalLatitude = user.latitude;

    // Default locaton
    if (hide) {
      user.longitude = 0;
      user.latitude = 0;
      user.curHealth = 0;
    } else if (leftSideUserIds && leftSideUserIds.length > 0) {
      if (leftSideUserIds?.includes(user.userId)) {
        const { x, y } = assignLocation(1, halfWidth);
        user.longitude = x;
        user.latitude = y;
      } else {
        const { x, y } = assignLocation(halfWidth + 1, width - 3);
        user.longitude = x;
        user.latitude = y;
      }
    }

    // Hide ANBU members who are being attacked (defenders)
    if (
      user.anbuId &&
      user.anbuSquad &&
      battleType === "COMBAT" &&
      !leftSideUserIds?.includes(user.userId)
    ) {
      user.username = "ANBU Member";
      user.avatar = user.anbuSquad.image;
      user.avatarLight = user.anbuSquad.image;
    }

    // If in own village, add defence bonus
    const ownSector = user.sector === user.village?.sector;
    const inVillage = calcIsInVillage({ x: user.longitude, y: user.latitude });
    const excludedBattleTypes = ["ARENA", "RANKED_PVP", "SPARRING", "RANKED_SPARRING"];
    if (ownSector && inVillage && !excludedBattleTypes.includes(battleType)) {
      const boost = getStrucBoost("villageDefencePerLvl", user.village?.structures);
      const effect = DecreaseDamageTakenTag.parse({
        target: "SELF",
        statTypes: StatTypes,
        generalTypes: GeneralTypes,
        type: "decreasedamagetaken",
        power: boost,
        rounds: undefined,
      }) as unknown as UserEffect;
      const realized = realizeTag({
        tag: effect,
        user: user,
        actionId: "initial",
        target: user,
        level: user.level,
      });
      realized.isNew = false;
      realized.castThisRound = false;
      realized.targetId = user.userId;
      realized.fromType = "village";
      userEffects.push(realized);
    }

    // Add bloodline efects
    if (
      user.bloodline?.effects &&
      battleType !== "RANKED_PVP" &&
      battleType !== "RANKED_SPARRING"
    ) {
      user.bloodline.effects.forEach((effect: unknown) => {
        const realized = realizeTag({
          tag: effect as UserEffect,
          user: user,
          actionId: user?.bloodline?.id ?? "initial",
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
          } else if (skill.target === "ALLIES" || skill.target === "ENEMIES") {
            pendingSkillEffects.push({
              creatorId: user.userId,
              creatorVillageId: user.villageId,
              skillId: userSkill.skillId,
              effects: skill.effects as unknown as UserEffect[],
              level: user.level,
              target: skill.target,
            });
          }
        },
      );
      user.userSkills = []; // Reset to avoid storing in battle table
    }

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

    // Set jutsus updatedAt to now (we use it for determining usage cooldowns)
    const isQuestBattle = QuestBattleTypes.includes(battleType);
    // Filter and process jutsus - DO NOT apply reskins here, they are applied dynamically
    // in userJutsuToAction to ensure each user sees their own reskin
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
        // Filter by battleUsageType
        // If quest battle, exclude PVP-only jutsus
        if (isQuestBattle && userjutsu.jutsu.battleUsageType === "PVP") {
          return false;
        }
        // If non-quest battle, exclude PVE-only jutsus
        if (!isQuestBattle && userjutsu.jutsu.battleUsageType === "PVE") {
          return false;
        }
        // Not if cannot train jutsu
        if (battleType !== "RANKED_PVP" && battleType !== "RANKED_SPARRING") {
          if (!checkJutsuItems(userjutsu.jutsu, user.items) && !user.isAi) {
            return false;
          }
          // Provide defaults for optional fields required by canTrainJutsu
          const userForCheck = {
            ...user,
            userQuests: user.userQuests ?? [],
            completedQuests: user.completedQuests ?? [],
          };
          if (!canTrainJutsu(userjutsu.jutsu, userForCheck) && !user.isAi) {
            return false;
          }
        }
        // Add summons to list
        const effects = userjutsu.jutsu.effects as UserEffect[];
        effects
          .filter((e) => e.type === "summon")
          .forEach((e) => {
            if ("aiId" in e) allSummons.push(e.aiId);
          });
        // Not if not the right bloodline
        return (
          userjutsu.jutsu.bloodlineId === "" ||
          user.isAi ||
          user.bloodlineId === userjutsu.jutsu.bloodlineId
        );
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
        // Filter by battleUsageType
        // If quest battle, exclude PVP-only items
        if (isQuestBattle && ui.item.battleUsageType === "PVP") {
          return false;
        }
        // If non-quest battle, exclude PVE-only items
        if (!isQuestBattle && ui.item.battleUsageType === "PVE") {
          return false;
        }
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
        // Add any imbuement effects to the item effects
        const imbuementEffects = ui.imbuements?.flatMap(
          (imbuement) => imbuement.item.effects as UserEffect[],
        );
        // Parse item
        const effects = [...(ui.item.effects as UserEffect[]), ...imbuementEffects];
        const itemType = ui.item.itemType;
        ui.item.effects = effects;
        ui.imbuements = []; // Reset to avoid storing in battle table
        // Parse the effects
        effects
          .filter((e) => e.type === "summon")
          .forEach((e) => {
            if ("aiId" in e) allSummons.push(e.aiId);
          });
        // Add item effects to user
        if (
          itemType === "ARMOR" ||
          itemType === "ACCESSORY" ||
          itemType === "KEYSTONE"
        ) {
          if (ui.item.effects && ui.equipped !== "NONE") {
            const currentDurability = Math.min(ui.durability, ui.item.maxDurability);
            if (currentDurability <= DURABILITY_USABILITY_THR) {
              ui.equipped = "NONE" as const;
            } else {
              // Add item effects to user (only if user has required bloodline)
              if (!ui.item.bloodlineId || ui.item.bloodlineId === user.bloodlineId) {
                effects.forEach((effect) => {
                  const realized = realizeTag({
                    tag: effect,
                    user: user,
                    actionId: ui.itemId,
                    target: user,
                    level: user.level,
                  });
                  realized.isNew = false;
                  realized.fromType = "armor";
                  realized.castThisRound = false;
                  realized.targetId = user.userId;
                  userEffects.push(realized);
                });
              }
            }
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

    // Add relevant wars to usersState
    user.wars = wars.filter(
      (w) =>
        w.attackerVillageId === user.villageId ||
        w.defenderVillageId === user.villageId ||
        w.warAllies.find((wa) => wa.villageId === user.villageId),
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

    if (AutoBattleTypes.includes(info.battleType)) {
      user.curHealth = user.maxHealth;
      user.curChakra = user.maxChakra;
      user.curStamina = user.maxStamina;
      user.isAi = true;
      user.isOriginal = false;
    }

    return user;
  });

  // Track summon data to merge later
  let summonUsersState: BattleUserState[] = [];
  let summonExtraState: ExtraState | null = null;

  // If there are any summonAIs defined, then add them to usersState, but disable them
  const summonsToProcess = [
    ...new Set(allSummons.filter((s) => !usersState.find((u) => u.userId === s))),
  ];
  if (summonsToProcess.length > 0) {
    const summons = await client.query.userData.findMany({
      with: {
        bloodline: true,
        village: true,
        items: {
          with: {
            item: true,
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
      where: inArray(userData.userId, summonsToProcess),
    });
    if (summons.length > 0) {
      const {
        userEffects: summonEffects,
        usersState: summonState,
        extraState: summonSD,
      } = await processUsersForBattle(client, {
        users: summons,
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
      });
      summonState.forEach((u) => {
        u.iAmHere = true;
      });
      userEffects.push(...summonEffects);
      summonUsersState = summonState;
      summonExtraState = summonSD;
    }
  }

  // Apply any pending skill tree effects that target allies/enemies now that usersState exists
  if (pendingSkillEffects.length > 0) {
    for (const pending of pendingSkillEffects) {
      const creator = usersState.find((u) => u.userId === pending.creatorId);
      if (!creator) continue;
      const targets = usersState.filter((u) => stillInBattle(u));
      for (const target of targets) {
        for (const effect of pending.effects) {
          const realized = realizeTag({
            tag: effect,
            user: creator,
            actionId: pending.skillId,
            target,
            level: pending.level,
          });
          realized.isNew = false;
          realized.castThisRound = false;
          realized.targetId = target.userId;
          realized.fromType = "skill";
          if (checkFriendlyFire(realized, target, usersState)) {
            userEffects.push(realized);
          }
        }
      }
    }
  }

  // Apply decreasedamagetaken to all users in ranked PvP battles
  if (battleType === "RANKED_PVP" || battleType === "RANKED_SPARRING") {
    for (const user of usersState) {
      const effect = DecreaseDamageTakenTag.parse({
        target: "SELF",
        statTypes: StatTypes,
        generalTypes: GeneralTypes,
        type: "decreasedamagetaken",
        power: 150,
        calculation: "static",
        rounds: undefined,
      }) as unknown as UserEffect;
      const realized = realizeTag({
        tag: effect,
        user: user,
        actionId: "ranked_pvp",
        target: user,
        level: user.level,
      });
      realized.isNew = false;
      realized.castThisRound = false;
      realized.targetId = user.userId;
      realized.fromType = "ranked";
      userEffects.push(realized);
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

    // Get IDs for wars that apply to this user's village
    const warIds = (user.wars ?? []).map((w: { id: string }) => w.id);

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
    }));

    // Convert items to reference format
    const itemsRef: BattleUserItem[] = user.items.map((ui) => ({
      id: ui.id,
      itemId: ui.itemId,
      quantity: ui.quantity,
      durability: ui.durability,
      equipped: ui.equipped,
      lastUsedRound: ui.lastUsedRound ?? -(ui.item?.cooldown ?? 0),
      originalCooldown: ui.originalCooldown ?? ui.item?.cooldown ?? 0,
      dropChancePerc: ui.dropChancePerc,
    }));

    // Destructure to remove full objects that should become references
    // These fields are either stored in extraState or not needed in BattleUserState
    const {
      jutsus: _jutsus,
      items: _items,
      village: _village,
      anbuSquad: _anbuSquad,
      clan: _clan,
      bloodline: _bloodline,
      userSkills: _userSkills,
      relations: _relations,
      wars: _wars,
      aiProfile,
      keystoneItem,
      // These are stored in extraState, not on the user
      userQuests: _userQuests,
      completedQuests: _completedQuests,
      questData: _questData,
      bounties: _bounties,
      bountySignups: _bountySignups,
      activeReskin: _activeReskin,
      ...rest
    } = user;

    // Construct BattleUserState with slim references
    const battleUserState: BattleUserState = {
      ...rest,
      jutsus: jutsusRef,
      items: itemsRef,
      relationIds,
      warIds,
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
  if (summonExtraState) {
    Object.assign(extraState.jutsus, summonExtraState.jutsus);
    Object.assign(extraState.jutsuReskins, summonExtraState.jutsuReskins);
    Object.assign(extraState.items, summonExtraState.items);
    Object.assign(extraState.bloodlines, summonExtraState.bloodlines);
    Object.assign(extraState.villages, summonExtraState.villages);
    Object.assign(extraState.anbuSquads, summonExtraState.anbuSquads);
    Object.assign(extraState.keystoneItems, summonExtraState.keystoneItems);
    Object.assign(extraState.wars, summonExtraState.wars);
    Object.assign(extraState.aiProfiles, summonExtraState.aiProfiles);
    Object.assign(extraState.relations, summonExtraState.relations);
    Object.assign(extraState.clans, summonExtraState.clans);
  }

  return {
    userEffects,
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
  const [defaultProfile, activeWars, settings, villages, relations, dmgConfig] =
    await Promise.all([
      // Fetch default AI profile
      fetchAiProfileById(client, "Default"),
      // Fetch active wars
      client.query.war.findMany({
        where: eq(war.status, "ACTIVE"),
        with: {
          warAllies: true,
          attackerVillage: { columns: { name: true, sector: true } },
          defenderVillage: { columns: { name: true, sector: true } },
        },
      }),
      // Fetch game settings
      client
        .select()
        .from(gameSetting)
        .where(
          inArray(gameSetting.name, ["battleExpMultiplier", "regenGainMultiplier"]),
        ),
      // Fetch villages
      client.select().from(village),
      // Fetch village alliances
      client.select().from(villageAlliance),
      // Fetch damage formula config
      fetchDmgConfig(client),
    ]);
  return { defaultProfile, activeWars, settings, villages, relations, dmgConfig };
};
