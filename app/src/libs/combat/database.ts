import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import type { BattleDataEntryType, BattleTypes } from "@/drizzle/constants";
import {
  ELITE_JONIN_JUTSU_ADVANCED_XP_TO_LEVEL,
  ELITE_JONIN_JUTSU_LEVEL_CAP,
  ELITE_JONIN_JUTSU_XP_TO_LEVEL,
  ENERGY_PVP_LOSS_REWARD,
  ENERGY_PVP_WIN_REWARD,
  HOSPITAL_LAT,
  HOSPITAL_LONG,
  ITEM_LEVEL_CAP,
  ITEM_XP_TO_LEVEL,
  JUTSU_TRAIN_LEVEL_CAP,
  JUTSU_XP_TO_LEVEL,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  REGEN_SECONDS,
  STEALTH_POST_COMBAT_COOLDOWN_SECONDS,
  VILLAGE_SYNDICATE_ID,
  WAR_RECAPTURE_THRESHOLD,
  WAR_SHRINE_CAPTURE_WARHEALTH_DMG,
  WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL,
} from "@/drizzle/constants";
import type { Battle } from "@/drizzle/schema";
import {
  anbuSquad,
  battle,
  battleAction,
  bounty,
  clan,
  dataBattleAction,
  kageDefendedChallenges,
  logBattleLengths,
  mpvpBattleQueue,
  mpvpBattleUser,
  notification,
  quest,
  raidParticipation,
  tournamentMatch,
  userData,
  userItem,
  userItemImbuement,
  userJutsu,
  village,
  war,
  warKill,
} from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/actions";
import { settleObjectiveWarCombat } from "@/libs/combat/objectiveWar";
import { areBattleAllies } from "@/libs/combat/participants";
import type {
  ActionEffect,
  BattleWar,
  CombatResult,
  CompleteBattle,
} from "@/libs/combat/types";
import {
  canCacheCombatCompletion,
  combatCacheDerived,
  combatCacheEnergy,
  combatCacheIntegerDelta,
  combatCacheItems,
} from "@/libs/combat/userCache";
import {
  buildCombatTrackerTasks,
  calcBattleResult,
  didKageChallengerWin,
  didUserTakeKageSeat,
  getBattleTeamWars,
  getItem,
  getJutsu,
  getKageChallengeParticipants,
  getOpposingBattleWars,
  getVillage,
  hydrateUserForQuests,
  isPvpEnergyRewardBattle,
} from "@/libs/combat/util";
import { claimVillageMissionCombatEvents } from "@/libs/combat/villageMission";
import { getPvpFarmActivityReductionSeconds } from "@/libs/farming";
import { getJutsuMaxLevel } from "@/libs/jutsuProgression";
import { allocateMasteryGains } from "@/libs/masteryProgression";
import { petExperienceGainSql } from "@/libs/pets/experience";
import type { PusherClient } from "@/libs/pusher";
import { broadcastRaidAvailability, updateUserOnMap } from "@/libs/pusher";
import { boostPvpGain } from "@/libs/pvpExperience";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  getPublicQuestUser,
} from "@/libs/quest";
import { getIsolatedPyramid } from "@/libs/questRun";
import {
  getRaidChatConversationId,
  prepareExclusiveRaidActivation,
} from "@/libs/raids";
import { battleItemExp, battleJutsuExp } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { rewardClanBattleVictory } from "@/server/utils/clanBattle";
import { settleDungeonBattle } from "@/server/utils/dungeon";
import { reduceActiveFarmPlotTimers } from "@/server/utils/farming";
import { settleHuntingBattle } from "@/server/utils/hunting";
import { masteryGainUpdates } from "@/server/utils/masteryProgression";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { resumeBracketImmunitySql } from "@/server/utils/objectiveWar";
import { purgeRaidChatMembership } from "@/server/utils/raidChat";
import { settleTerritoryWarCombat } from "@/server/utils/territoryWar";
import {
  applyVillageMissionShrineDamage,
  recordVillageMissionProgress,
} from "@/server/utils/villageMission";
import { warRaidCombatGuard } from "@/server/utils/war";
import { periodStart } from "@/utils/time";

type DataBattleAction = {
  type: (typeof BattleDataEntryType)[number];
  contentId: string;
  battleType: (typeof BattleTypes)[number];
  battleWon: number;
  relatedBloodlineId?: string;
};

/**
 * A raid is "boss defeated" when the boss AI exists in the battle and no
 * remaining boss AI is still in fighting condition. Summons don't count as
 * the boss; teammates' AI summons must not block the defeat condition.
 */
const isRaidBossDefeated = (battle: CompleteBattle) =>
  battle.battleType === "RAID" &&
  battle.usersState.some((u) => u.isAi && !u.isSummon) &&
  battle.usersState.every(
    (u) => !u.isAi || u.isSummon || !stillInBattle(u, battle.usersEffects),
  );

/**
 * Claim the battle version; return cleanup to run alongside independent reward writes.
 * A terminal event claim also commits its match outcome before recovery can observe deletion.
 * Personal hunts settle rewards and recovery inside their version claim; ordinary callers skip them.
 * Battle-length analytics select an opposing non-summon combatant.
 */
export const updateBattle = async (
  client: DrizzleClient,
  result: CombatResult | null,
  userId: string,
  newBattle: CompleteBattle,
  fetchedVersion: number,
  pusher?: PusherClient,
) => {
  if (newBattle.extraState.hunting && result) {
    if (!pusher) throw new Error("Hunting settlement requires combat transport");
    const settled = await settleHuntingBattle(
      client,
      newBattle,
      result,
      fetchedVersion,
      (tx, playerBattle, playerResult) =>
        updateUser(tx, pusher, playerBattle, playerResult, userId, true),
    );
    return settled ? { battleOver: true, finishBattle: async () => {} } : null;
  }
  // A dungeon result transitions and restores the entire party before any ordinary combat payout.
  if (newBattle.extraState.dungeon && result) {
    const settled = await settleDungeonBattle(client, newBattle, fetchedVersion);
    return settled
      ? {
          battleOver: true,
          finishBattle: async () => {
            if (pusher)
              await Promise.all(
                (newBattle.extraState.dungeon?.runState.memberIds ?? []).map((id) =>
                  pusher.trigger(id, "event", {
                    type: "battleEnded",
                    dungeonRunId: newBattle.extraState.dungeon?.runId,
                  }),
                ),
              );
          },
        }
      : null;
  }
  if (result) {
    result.villageMissionPvpKills =
      claimVillageMissionCombatEvents(newBattle, userId, result).pvp_kills ?? 0;
  }
  // Calculations
  // raidBossDefeated: the boss specifically died (kill).
  // raidTeamWiped: every human in this raid is out of stillInBattle while the
  // boss is still alive. `result.friendsLeft` is keyed on the per-user
  // `leftBattle` flag which is only set when each user's own action triggers
  // calcBattleResult, so a teammate killed by boss AoE on someone else's turn
  // is not yet counted. Checking stillInBattle directly catches the wipe in
  // the same tick.
  // raidEnded: raid is over for ANY reason on this battle — boss kill OR full team wipe.
  const raidBossDefeated = !!result && isRaidBossDefeated(newBattle);
  const humanFighters = newBattle.usersState.filter((u) => !u.isAi && !u.isSummon);
  const raidTeamWiped =
    !!result &&
    newBattle.battleType === "RAID" &&
    humanFighters.length > 0 &&
    humanFighters.every((u) => !stillInBattle(u, newBattle.usersEffects));
  const territoryGuardianEnded =
    !!result &&
    newBattle.battleType === "TERRITORY_WAR" &&
    (newBattle.usersState
      .filter((u) => u.isAi && !u.isSummon)
      .every((u) => !stillInBattle(u, newBattle.usersEffects)) ||
      humanFighters.every((u) => !stillInBattle(u, newBattle.usersEffects)));
  const battleOver =
    !!result &&
    (result.friendsLeft + result.targetsLeft === 0 ||
      raidBossDefeated ||
      raidTeamWiped ||
      territoryGuardianEnded);
  const raidEnded =
    battleOver && ["RAID", "TERRITORY_WAR"].includes(newBattle.battleType);

  // Get user and other user
  const user = newBattle.usersState.find((u) => u.userId === userId && !u.isSummon);
  const other = newBattle.usersState.find(
    (u) => u.userId !== userId && !u.isSummon && user && !areBattleAllies(u, user),
  );

  // Non-summon humans in this raid battle. Used to purge raid-chat memberships
  // on any raid battle-over (boss kill OR team wipe) and to release/notify
  // teammates when the raid boss is defeated.
  const humanTeammates = raidEnded
    ? newBattle.usersState.filter((u) => !u.isAi && !u.isSummon)
    : [];
  const humanUserIds = humanTeammates.map((u) => u.userId);

  // Only the successful version claim may proceed to rewards and cleanup.
  // Ordinary settlement writes are not atomic with this claim; failures can leave partial settlement.
  if (battleOver) {
    const deleteBattle = (database: DrizzleClient) =>
      database
        .delete(battle)
        .where(and(eq(battle.id, newBattle.id), eq(battle.version, fetchedVersion)));
    const deleted = await retryOnDeadlock(() =>
      newBattle.extraState.tournamentGameId ||
      newBattle.extraState.kageMatch ||
      newBattle.extraState.territoryWar
        ? client.transaction(async (tx) => {
            const database = tx as unknown as DrizzleClient;
            const deleted = await deleteBattle(database);
            // The version DELETE and match UPDATE must commit together: a single-row CAS
            // cannot prevent recovery treating a deleted battle as an interrupted launch.
            if (deleted.rowsAffected === 1) {
              // DELETE and event receipt/score must commit together: a multi-table UPDATE
              // cannot delete the battle and upsert competitor scores. Otherwise a failed
              // reward write would permanently lose a terminal fight's strategic credit.
              if (newBattle.extraState.territoryWar)
                await settleTerritoryWarCombat(database, newBattle);
              if (newBattle.extraState.tournamentGameId)
                await updateTournament(database, newBattle, result, userId);
              if (newBattle.extraState.kageMatch)
                await completeKageDefense(database, newBattle);
            }
            return deleted;
          })
        : deleteBattle(client),
    );
    if (deleted.rowsAffected === 0) {
      return null;
    }
  } else {
    newBattle.version = Math.max(newBattle.version, fetchedVersion + 1);
    const result = await retryOnDeadlock(() =>
      client
        .update(battle)
        .set({
          version: newBattle.version,
          createdAt: newBattle.createdAt,
          updatedAt: newBattle.updatedAt,
          usersState: newBattle.usersState,
          usersEffects: newBattle.usersEffects,
          groundEffects: newBattle.groundEffects,
          // Keep revealed action definitions available after a summon despawns.
          // Update only this subtree within the same version-guarded write.
          ...(newBattle.extraState.revealedActions
            ? {
                extraState: sql`JSON_SET(${battle.extraState}, '$.revealedActions', CAST(${JSON.stringify(newBattle.extraState.revealedActions)} AS JSON))`,
              }
            : {}),
          ...(newBattle.extraState.dungeon ? { extraState: newBattle.extraState } : {}),
          activeUserId: newBattle.activeUserId,
          roundStartAt: newBattle.roundStartAt,
          round: newBattle.round,
        })
        .where(and(eq(battle.id, newBattle.id), eq(battle.version, fetchedVersion))),
    );
    if (result.rowsAffected === 0) {
      return null;
    }
  }

  const finishBattle = async () => {
    if (battleOver) {
      await Promise.all([
        ...(user && other
          ? [
              client
                .insert(logBattleLengths)
                .values({
                  battleType: newBattle.battleType,
                  winnerLevel: user?.level ?? 0,
                  loserLevel: other?.level ?? 0,
                  rounds: newBattle.round,
                  count: 1,
                })
                .onDuplicateKeyUpdate({
                  set: { count: sql`${logBattleLengths.count} + 1` },
                }),
            ]
          : []),
        // Clean up battle users in parallel - safe since they only read from mpvpBattleQueue
        ...(["RAID", "SHRINE_WAR", "TERRITORY_WAR"].includes(newBattle.battleType)
          ? [
              client
                .delete(mpvpBattleUser)
                .where(
                  inArray(
                    mpvpBattleUser.clanBattleId,
                    client
                      .select({ id: mpvpBattleQueue.id })
                      .from(mpvpBattleQueue)
                      .where(eq(mpvpBattleQueue.battleId, newBattle.id)),
                  ),
                ),
            ]
          : []),
        // Purge raid-chat memberships on any raid battle-over (boss kill OR team
        // wipe). The conversation ID is stable across raid resets, so stale
        // memberships would let former participants read the next team's private
        // channel.
        ...(raidEnded && newBattle.extraState.raidQuestId && humanUserIds.length > 0
          ? [
              purgeRaidChatMembership(
                client,
                getRaidChatConversationId(newBattle.extraState.raidQuestId),
                humanUserIds,
              ),
            ]
          : []),
        // When a raid ends (boss defeated OR team wipe), release all non-acting
        // teammates from BATTLE status. updateUser only handles the acting player,
        // so teammates would be stuck pointing at a deleted battle row otherwise —
        // readyToQueue hard-blocks BATTLE status and would lock them out.
        // Mirror the pool sync (curHealth/curStamina/curChakra) the acting user gets so
        // teammates who took damage don't revert to pre-battle pool values on release.
        // Mirror the HOSPITALIZED handling from updateUser: teammates whose curHealth
        // dropped to 0 from boss AoE must be sent to the hospital, not released as AWAKE.
        ...(raidBossDefeated || raidTeamWiped || territoryGuardianEnded
          ? humanTeammates
          : []
        )
          .filter((u) => u.userId !== userId)
          .map(async (teammate) => {
            const sendToHospital = !newBattle.forceKeepPools && teammate.curHealth <= 0;
            const released = await client
              .update(userData)
              .set({
                bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
                bracketImmunityPausedAt: null,
                battleId: null,
                updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))`,
                curEnergy: combatEnergyRecoverySql(newBattle, teammate.userId),
                // Only Energy recovers in combat; reset the shared clock for other pools.
                regenAt: sql`NOW(3)`,
                curHealth: teammate.curHealth,
                curStamina: teammate.curStamina,
                curChakra: teammate.curChakra,
                stealthActive: false,
                stealthActivatedAt: null,
                stealthCooldownAt: sql`NOW() + INTERVAL ${STEALTH_POST_COMBAT_COOLDOWN_SECONDS} SECOND`,
                ...(sendToHospital
                  ? {
                      status: "HOSPITALIZED",
                      longitude: HOSPITAL_LONG,
                      latitude: HOSPITAL_LAT,
                      sector: teammate.allyVillage
                        ? teammate.sector
                        : getVillage(newBattle, teammate.villageId)?.sector,
                    }
                  : { status: "AWAKE" }),
              })
              .where(
                and(
                  eq(userData.userId, teammate.userId),
                  eq(userData.battleId, newBattle.id),
                ),
              );
            // Raid deletion prevents teammates from polling their own settlement.
            // The battle claim and guarded release exclude stale or prior claims.
            if (raidBossDefeated && released.rowsAffected > 0) {
              // Result calculation marks departure; preserve the cleanup snapshot.
              const teammateResult = calcBattleResult(
                structuredClone(newBattle),
                teammate.userId,
                newBattle.extraState.settings,
              );
              await updateVillageAnbuClan(
                client,
                newBattle,
                teammateResult,
                teammate.userId,
              );
            }
          }),
      ]);

      // Delete queue entries AFTER the Promise.all to ensure mpvpBattleUser
      // subquery has completed (it references mpvpBattleQueue)
      if (["RAID", "SHRINE_WAR", "TERRITORY_WAR"].includes(newBattle.battleType)) {
        await client
          .delete(mpvpBattleQueue)
          .where(eq(mpvpBattleQueue.battleId, newBattle.id));
      }

      // Notify the sector that surviving raid teammates are back on the map.
      // Mirrors the `result.curHealth > 0` gate in updateUser so other clients
      // see them transition out of BATTLE without waiting for the next poll.
      // Skip teammates who already fled: their DB UPDATE above no-ops via the
      // battleId guard, so broadcasting here would overwrite their actual
      // sector/coords in other clients' map views with stale battle data.
      if (pusher && (raidBossDefeated || territoryGuardianEnded)) {
        humanTeammates
          .filter((u) => u.userId !== userId && !u.fledBattle)
          .forEach((teammate) => {
            const sendToHospital = !newBattle.forceKeepPools && teammate.curHealth <= 0;
            if (sendToHospital) return;
            void updateUserOnMap(pusher, teammate.sector, {
              ...teammate,
              longitude: teammate.originalLongitude,
              latitude: teammate.originalLatitude,
              status: "AWAKE",
              battleId: null,
            });
          });
      }

      // Nudge each human teammate's user channel so any open /combat tab
      // invalidates getBattle/getUser immediately on raid end. Without this the
      // acting user (and any teammate not the one who pressed an action) keeps
      // showing the old battle map and `Status: BATTLE` until the next poll.
      if (pusher && raidEnded) {
        humanTeammates
          .filter((u) => !u.fledBattle)
          .forEach((teammate) => {
            void pusher.trigger(teammate.userId, "event", { type: "battleEnded" });
          });
      }
    }
    if (result?.didWin && newBattle.battleType === "CLAN_BATTLE" && user?.clanId) {
      await rewardClanBattleVictory(client, newBattle.id, user.clanId);
    }
  };
  return { battleOver, finishBattle };
};

/**
 * Insert battle actions and NPC template usage for analytics.
 * NPC allies inherit their team's outcome; opposing NPCs reverse Won/Lost while
 * preserving Fled. Deduplicate by content and outcome so a template on both teams
 * retains both win/loss records.
 */
export const saveUsage = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  // Dungeon completion owns its progression; event exhibitions never train the loadout.
  if (curBattle.extraState.dungeon || curBattle.extraState.tournamentGameId) return;
  const user = curBattle.usersState.find((user) => user.userId === userId);
  const battleType = curBattle.battleType;
  if (result && user) {
    // Bloodline ID of user (lookup from extraState for full data if needed)
    const relatedBloodlineId = user.bloodlineId ?? undefined;
    // Get state, lost: 0, won: 1, flee: 2
    const outcome = result.outcome;
    const battleWon = outcome === "Won" ? 1 : outcome === "Fled" ? 2 : 0;
    const oppositeOutcome =
      outcome === "Won" ? "Lost" : outcome === "Lost" ? "Won" : "Fled";
    const oppositeBattleWon =
      oppositeOutcome === "Won" ? 1 : oppositeOutcome === "Fled" ? 2 : 0;
    // Basic actions from this user
    const data: DataBattleAction[] = [];
    user.usedActions?.forEach((action) => {
      data.push({
        type: action.type,
        contentId: action.id,
        battleType,
        battleWon,
        relatedBloodlineId,
      });
    });
    // Bloodline actions from this user
    if (relatedBloodlineId) {
      data.push({
        type: "bloodline",
        contentId: relatedBloodlineId,
        battleType,
        battleWon,
      });
    }
    // If battle is over, check for any AIs in the battle, and add these as well to the statistics
    curBattle.usersState
      .filter((u) => u.isAi && !u.isSummon)
      .forEach((ai) => {
        data.push({
          type: "ai",
          contentId: ai.controllerId,
          battleType,
          battleWon: areBattleAllies(ai, user) ? battleWon : oppositeBattleWon,
        });
      });
    // Keep one usage per content and outcome, including templates on both teams.
    const uniqueData = data.reduce((a, c) => {
      if (
        !a.find(
          (d) =>
            d.type === c.type &&
            d.contentId === c.contentId &&
            d.battleWon === c.battleWon,
        )
      ) {
        return a.concat([c]);
      } else {
        return a;
      }
    }, [] as DataBattleAction[]);
    // Upsert dataBattleActions
    if (uniqueData.length > 0) {
      await client
        .insert(dataBattleAction)
        // MySQL UNIQUE indexes treat NULL values as distinct. Normalize the
        // absent bloodline dimension so repeated AI/bloodline aggregates hit
        // the existing row and increment it atomically.
        .values(
          uniqueData.map((entry) => ({
            ...entry,
            relatedBloodlineId: entry.relatedBloodlineId ?? "",
          })),
        )
        .onDuplicateKeyUpdate({
          set: {
            count: sql`${dataBattleAction.count} + 1`,
            updatedAt: new Date(),
          },
        });
    }
  }
};

/**
 * Persist action history in one write and return its payload in descending version order.
 * Clan logs require a live lobby in the same statement, preventing late inserts after
 * deletion. The returned payload is unchanged even when that lobby no longer exists.
 */
export const createAction = async (
  client: DrizzleClient,
  newBattle: Battle,
  history: {
    battleRound: number;
    appliedEffects: ActionEffect[];
    description: string;
    battleVersion: number;
    actionId?: string;
    userId?: string;
  }[],
) => {
  if (history.length === 0) {
    return [];
  }
  const actions = history
    .sort((a, b) => b.battleVersion - a.battleVersion)
    .map((entry) => {
      return {
        id: nanoid(),
        battleId: newBattle.id,
        battleVersion: entry.battleVersion,
        battleRound: entry.battleRound,
        createdAt: new Date(),
        updatedAt: new Date(),
        actionId: entry.actionId ?? "unknown",
        userId: entry.userId ?? "unknown",
        description: entry.description,
        appliedEffects: entry.appliedEffects,
      };
    });
  if (newBattle.battleType === "CLAN_BATTLE") {
    // INSERT ... SELECT shares the lobby row with deletion for the duration of
    // the statement. A delayed action cannot recreate a deleted combat log;
    // UNION ALL batches every guarded selection into the same round trip.
    const selections = actions.map((entry) =>
      client
        .select({
          id: sql<string>`${entry.id}`.as("id"),
          createdAt: sql<Date>`${entry.createdAt}`.as("createdAt"),
          updatedAt: sql<Date>`${entry.updatedAt}`.as("updatedAt"),
          battleId: sql<string>`${entry.battleId}`.as("battleId"),
          battleVersion: sql<number>`${entry.battleVersion}`.as("battleVersion"),
          battleRound: sql<number>`${entry.battleRound}`.as("battleRound"),
          actionId: sql<string>`${entry.actionId}`.as("actionId"),
          userId: sql<string>`${entry.userId}`.as("userId"),
          description: sql<string>`${entry.description}`.as("description"),
          appliedEffects: sql<
            ActionEffect[]
          >`CAST(${JSON.stringify(entry.appliedEffects)} AS JSON)`.as("appliedEffects"),
        })
        .from(mpvpBattleQueue)
        .where(
          and(
            eq(mpvpBattleQueue.battleId, newBattle.id),
            eq(mpvpBattleQueue.battleType, "CLAN_BATTLE"),
          ),
        )
        .$dynamic(),
    );
    await client
      .insert(battleAction)
      .select(selections.reduce((combined, next) => combined.unionAll(next)))
      .onDuplicateKeyUpdate({ set: { id: sql`${battleAction.id}` } });
    return actions;
  }
  await client
    .insert(battleAction)
    .values(actions)
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  return actions;
};

/** Commit the scheduled match receipt with battle deletion, before orphan recovery can see it. */
const completeKageDefense = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
) => {
  const match = curBattle.extraState.kageMatch;
  const participants = getKageChallengeParticipants(curBattle);
  if (!match || !participants) return;
  const won = didKageChallengerWin(
    participants.challenger,
    participants.kage,
    curBattle.usersEffects,
  );
  await client
    .update(kageDefendedChallenges)
    .set({
      status: "COMPLETED",
      didWin: won ? 1 : 0,
      rounds: curBattle.round,
      resolvedAt: new Date(),
      outcome: won ? "Challenger won the title fight" : "Kage defended the title",
    })
    .where(
      and(
        eq(kageDefendedChallenges.id, match.id),
        eq(kageDefendedChallenges.status, "BATTLE"),
        eq(kageDefendedChallenges.battleId, curBattle.id),
      ),
    );
};

/**
 * Record the title-fight result and move leadership only from the defeated tenure.
 * Uses the preloaded participants; the terminal battle claim gates settlement upstream.
 */
export const updateKage = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
) => {
  // Only care about Kage battles between members of the same village
  if (!result) return;
  const participants = getKageChallengeParticipants(curBattle);
  if (!participants) return;
  const { challenger, kage } = participants;
  const defenderId = curBattle.extraState.kageMatch?.kageId ?? kage.userId;

  const challengerDidWin = didKageChallengerWin(
    challenger,
    kage,
    curBattle.usersEffects,
  );

  // Lost items for both sides
  const deleteItems = [
    ...kage.items.filter((ui) => ui.quantity <= 0).map((i) => i.id),
    ...challenger.items.filter((ui) => ui.quantity <= 0).map((i) => i.id),
  ];

  const updateItems = [
    ...kage.items.filter((ui) => ui.quantity > 0),
    ...challenger.items.filter((ui) => ui.quantity > 0),
  ];

  await Promise.all([
    // Scheduled fights finish their original queue row with the terminal battle claim.
    // Fights admitted before scheduling still need a completed receipt; battleId
    // makes those retries idempotent without recreating a scheduled queue entry.
    ...(!curBattle.extraState.kageMatch
      ? [
          client
            .insert(kageDefendedChallenges)
            .values({
              id: nanoid(),
              battleId: curBattle.id,
              villageId: challenger.villageId,
              userId: challenger.userId,
              kageId: defenderId,
              status: "COMPLETED",
              notBefore: curBattle.createdAt,
              startedAt: curBattle.createdAt,
              resolvedAt: new Date(),
              outcome: challengerDidWin
                ? "Challenger won the title fight"
                : "Kage defended the title",
              didWin: challengerDidWin ? 1 : 0,
              rounds: curBattle.round,
            })
            .onDuplicateKeyUpdate({ set: { id: sql`id` } }),
        ]
      : []),

    // Move the hat only if the challenger actually wins. CAS on the kage this
    // battle defeated: a delayed second finalization of an old battle must not
    // re-seat its challenger over a kage legitimately installed in the meantime.
    ...(challengerDidWin
      ? [
          client
            .update(village)
            .set({
              kageId: challenger.userId,
              leaderUpdatedAt: new Date(),
              kageSchedule: null,
            })
            .where(
              and(
                eq(village.id, challenger.villageId),
                eq(village.kageId, defenderId),
                ...(curBattle.extraState.kageMatch
                  ? [
                      eq(
                        village.leaderUpdatedAt,
                        new Date(curBattle.extraState.kageMatch.tenure),
                      ),
                    ]
                  : []),
              ),
            ),
        ]
      : []),

    ...(deleteItems.length > 0
      ? [
          client
            .delete(userItem)
            .where(and(inArray(userItem.id, deleteItems), gt(userItem.quantity, 0))),
          client
            .delete(userItemImbuement)
            .where(inArray(userItemImbuement.userItemId, deleteItems)),
        ]
      : []),

    // The quantity guard skips rows a stack merge has claimed or already folded away, so this
    // absolute snapshot write can never resurrect a merge tombstone or stomp a claim.
    ...(updateItems.length > 0
      ? updateItems.map((ui) =>
          client
            .update(userItem)
            .set({ quantity: ui.quantity })
            .where(and(eq(userItem.id, ui.id), gt(userItem.quantity, 0))),
        )
      : []),
  ]);
};

export const updateClanLeaders = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  // Fetch
  const user = curBattle.usersState.find((u) => u.userId === userId);
  const leader = curBattle.usersState.find((u) => u.userId !== userId && !u.isSummon);
  // Guards
  if (!result) return;
  if (curBattle.battleType !== "CLAN_CHALLENGE") return;
  if (!user?.clanId || !leader?.clanId) return;
  if (user.clanId !== leader.clanId) return;
  if (!user.isAggressor) return;
  if (!result.didWin) return;
  // Apply
  await Promise.all([
    client
      .update(clan)
      .set({
        leaderId: user.userId,
        coLeader1: sql`CASE WHEN ${clan.coLeader1} = ${user.userId} THEN NULL ELSE ${clan.coLeader1} END`,
        coLeader2: sql`CASE WHEN ${clan.coLeader2} = ${user.userId} THEN NULL ELSE ${clan.coLeader2} END`,
        coLeader3: sql`CASE WHEN ${clan.coLeader3} = ${user.userId} THEN NULL ELSE ${clan.coLeader3} END`,
      })
      .where(eq(clan.id, user.clanId)),
    client
      .update(village)
      .set({ kageId: user.userId })
      .where(
        and(
          eq(village.id, user.villageId ?? VILLAGE_SYNDICATE_ID),
          or(eq(village.type, "HIDEOUT"), eq(village.type, "STRONGHOLD")),
        ),
      ),
  ]);
};

/**
 * Persist team-attributed war kills and shrine/war health from preloaded state.
 * Siege mission credit requires the acting village's participation on that war side.
 */
export const updateWars = async (
  client: DrizzleClient,
  pusher: PusherClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  // Exhibition results cannot advance wars or their rewards.
  if (curBattle.extraState.tournamentGameId) return;
  // Fetch user
  const user = curBattle.usersState.find((u) => u.userId === userId && !u.isSummon);
  const userVillageId = user?.villageId;
  // Guard
  if (!user) return;
  if (!userVillageId) return;
  if (!result) return;
  // Skip war updates if kill happened in war-torn sector
  if (user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR) return;
  // Team faction context is entirely preloaded; teammates are never war victims.
  const warResults = curBattle.usersState
    .filter((target) => !target.isSummon && !areBattleAllies(target, user))
    .map((target) => ({ target, wars: getOpposingBattleWars(curBattle, user, target) }))
    .filter((entry) => entry.wars.length > 0);

  // Run all war updates in parallel
  // Note: War kill inserts, war health updates, and all shrine updates run in parallel
  // Village war/raid shrine updates use atomic conditional WHERE clauses to safely handle townhall damage/heal
  const shrineUpdatePromises: Promise<unknown>[] = [];
  const otherPromises: Promise<unknown>[] = [];
  // Track which wars have already had updates scheduled to prevent multiple applications
  // when multiple targets share the same war (the changes in result are already accumulated across all targets)
  const processedShrineWarIds = new Set<string>();
  const processedWarHealthIds = new Set<string>();
  // Track sectors where SECTOR_WAR shrine HP crossed to 0 (for exclusive raid activation)
  const sectorsWithDefeatedShrine = new Set<number>();

  warResults.forEach((warResult) => {
    warResult.wars.forEach(({ war: w, sideVillageId: killerSideVillageId }) => {
      if (w.rules) return;
      // Village missions belong to a participating village, even when battle
      // teammates from unrelated factions share the team's war/shrine credit.
      const canCreditVillageMission =
        !user.isAi &&
        (userVillageId === killerSideVillageId ||
          w.warAllies.some(
            (ally) =>
              ally.villageId === userVillageId &&
              ally.supportVillageId === killerSideVillageId,
          ));
      // Insert war kill for tracking purposes
      // Use per-war shrine HP change for village wars/raids (includes level diff adjustment)
      // For sector wars, use the total accumulated shrineChangeHp value
      let logShrineHpChange = 0;
      if (["VILLAGE_WAR", "WAR_RAID"].includes(w.type)) {
        // Use the already-computed villageWarShrineInfo which includes:
        // 1. The correct shrine change constants
        // 2. Level difference adjustment (reduced to ±1 when STREAK_LEVEL_DIFF exceeded)
        // Note: villageWarShrineInfo is NOT scaled by rewardScaling (shrine damage is a war mechanic)
        // Combine attacker and defender changes for logging purposes
        const shrineInfo = result.villageWarShrineInfo[w.id];
        logShrineHpChange = shrineInfo ? shrineInfo.attacker + shrineInfo.defender : 0;
      } else {
        logShrineHpChange = result.shrineChangeHp;
      }
      if (result.didWin) {
        otherPromises.push(
          client.insert(warKill).values({
            id: nanoid(),
            warId: w.id,
            killerId: user.userId,
            victimId: warResult.target.userId,
            killerVillageId: user.villageId || "unknown",
            victimVillageId: warResult.target.villageId || "unknown",
            sector: user.sector,
            shrineHpChange: logShrineHpChange,
            townhallHpChange: result.warHealthChange,
            killedAt: new Date(),
          }),
        );
      }

      // Update shrine HP in war table for sector wars only (no townhall damage for sector wars)
      // Sector wars only use defenderShrineHp (the sector's shrine)
      // Skip if we've already scheduled an update for this war (prevents double-counting when multiple targets share a war)
      if (
        result.shrineChangeHp !== 0 &&
        w.type === "SECTOR_WAR" &&
        !processedShrineWarIds.has(w.id)
      ) {
        processedShrineWarIds.add(w.id);

        // Check if shrine HP will cross to 0 (for exclusive raid activation)
        // Only trigger if shrine was > 0 and will become <= 0
        const currentShrineHp = w.defenderShrineHp ?? 0;
        const newShrineHp = Math.max(0, currentShrineHp + result.shrineChangeHp);
        if (currentShrineHp > 0 && newShrineHp <= 0) {
          sectorsWithDefeatedShrine.add(w.sector);
        }

        const shouldCreditMission =
          killerSideVillageId === w.attackerVillageId && canCreditVillageMission;
        otherPromises.push(
          retryOnDeadlock(async () => {
            if (result.shrineChangeHp < 0) {
              await applyVillageMissionShrineDamage(
                client,
                shouldCreditMission ? userVillageId : null,
                userId,
                w.id,
                "defenderShrineHp",
                -result.shrineChangeHp,
              );
            } else {
              await client
                .update(war)
                .set({
                  defenderShrineHp: sql`GREATEST(LEAST(defenderShrineHp + ${result.shrineChangeHp}, defenderShrineMaxHp), 0)`,
                })
                .where(
                  and(eq(war.id, w.id), isNull(war.endedAt), warRaidCombatGuard()),
                );
            }
          }),
        );
      }

      // For village wars and raids, handle shrine HP + war health damage/heal atomically
      // This prevents race conditions where multiple concurrent battles could all detect the same threshold crossing
      // Skip if we've already scheduled an update for this war (prevents double-counting when multiple targets share a war)
      // Use the per-war shrine HP changes (separate for attacker and defender shrines)
      const shrineChanges = result.villageWarShrineInfo[w.id];
      const hasAttackerChange = shrineChanges?.attacker !== 0;
      const hasDefenderChange = shrineChanges?.defender !== 0;
      if (
        (hasAttackerChange || hasDefenderChange) &&
        ["VILLAGE_WAR", "WAR_RAID"].includes(w.type) &&
        !processedShrineWarIds.has(w.id)
      ) {
        processedShrineWarIds.add(w.id);
        // Create an async function that handles the shrine updates and war health damage/heal atomically
        shrineUpdatePromises.push(
          (async () => {
            // Helper to process a shrine (attack or defend)
            const processShrine = async (
              shrineType: "attacker" | "defender",
              change: number,
            ) => {
              if (change === 0) return;

              const { hp: hpCol } = shrineColumnsBySide[shrineType];
              const villageName =
                shrineType === "attacker"
                  ? (w.attackerVillage?.name ?? "Attacker")
                  : (w.defenderVillage?.name ?? "Defender");

              if (change < 0) {
                const ownerVillageId =
                  shrineType === "attacker" ? w.attackerVillageId : w.defenderVillageId;
                const shouldCreditMission =
                  killerSideVillageId !== ownerVillageId && canCreditVillageMission;
                const captured = await retryOnDeadlock(() =>
                  applyVillageMissionShrineDamage(
                    client,
                    shouldCreditMission ? userVillageId : null,
                    userId,
                    w.id,
                    hpCol,
                    -change,
                    true,
                  ),
                );
                if (captured) {
                  result.notifications.push(
                    `${villageName}'s shrine captured! ${villageName} lost ${WAR_SHRINE_CAPTURE_WARHEALTH_DMG} war HP!`,
                  );
                }
              } else {
                await recoverWarShrine(
                  client,
                  w,
                  shrineType,
                  change,
                  result.notifications,
                );
              }
            };

            // Process both shrines
            if (shrineChanges) {
              await Promise.all([
                processShrine("attacker", shrineChanges.attacker),
                processShrine("defender", shrineChanges.defender),
              ]);
            }
          })(),
        );
      }

      // Update war health if we're in a village war or raid
      // Skip if we've already scheduled an update for this war (prevents double-counting when multiple targets share a war)
      if (
        result.warHealthChange !== 0 &&
        ["VILLAGE_WAR", "WAR_RAID"].includes(w.type) &&
        !processedWarHealthIds.has(w.id)
      ) {
        processedWarHealthIds.add(w.id);
        if (killerSideVillageId === w.attackerVillageId) {
          otherPromises.push(
            client
              .update(war)
              .set({
                attackerWarHealth: sql`GREATEST(LEAST(attackerWarHealth + ${result.warHealthChange}, attackerWarHealthMax), 0)`,
              })
              .where(and(eq(war.id, w.id), isNull(war.endedAt), warRaidCombatGuard())),
          );
        } else {
          otherPromises.push(
            client
              .update(war)
              .set({
                defenderWarHealth: sql`GREATEST(LEAST(defenderWarHealth + ${result.warHealthChange}, defenderWarHealthMax), 0)`,
              })
              .where(and(eq(war.id, w.id), isNull(war.endedAt), warRaidCombatGuard())),
          );
        }
      }
    });
  });

  // Handle SHRINE_WAR defend scenarios where user and AI share same villageId
  // In these cases, both teams have the same faction, so warResults is empty
  // but villageWarShrineInfo may still have data from the defend scenario handler in util.ts
  if (curBattle.battleType === "SHRINE_WAR") {
    const userWars = getBattleTeamWars(curBattle, user).map(({ war }) => war);
    for (const warId of Object.keys(result.villageWarShrineInfo)) {
      // Skip if already processed through warResults
      if (processedShrineWarIds.has(warId)) continue;

      const shrineChanges = result.villageWarShrineInfo[warId];
      const hasAttackerChange = shrineChanges?.attacker !== 0;
      const hasDefenderChange = shrineChanges?.defender !== 0;

      if (!hasAttackerChange && !hasDefenderChange) continue;

      // Find the war from user's wars
      const w = userWars.find((war) => war.id === warId);
      if (!w || w.rules || !["VILLAGE_WAR", "WAR_RAID"].includes(w.type)) continue;

      processedShrineWarIds.add(warId);

      if (shrineChanges) {
        shrineUpdatePromises.push(
          Promise.all([
            recoverWarShrine(
              client,
              w,
              "attacker",
              shrineChanges.attacker,
              result.notifications,
            ),
            recoverWarShrine(
              client,
              w,
              "defender",
              shrineChanges.defender,
              result.notifications,
            ),
          ]),
        );
      }
    }
  }

  // Prepare raid activations using pre-loaded data (no DB fetch)
  const preloadedRaids = curBattle.extraState.sectorExclusiveRaids ?? [];
  const sectorsToNotify: number[] = [];

  for (const sector of sectorsWithDefeatedShrine) {
    const activation = prepareExclusiveRaidActivation(preloadedRaids, sector);
    if (activation.activated) {
      sectorsToNotify.push(sector);
      // Add mutation promises to otherPromises
      for (const m of activation.mutations) {
        otherPromises.push(
          client
            .update(quest)
            .set({
              raidEndsAt: m.raidEndsAt,
              raidCaptureDeadline: m.raidCaptureDeadline,
              raidGracePeriodEnd: null,
              raidBossCurrentHealth: m.raidBossCurrentHealth,
            })
            .where(eq(quest.id, m.raidId)),
        );
      }
    }
  }

  // Run all promises in parallel - shrine updates are processed independently to avoid race conditions
  await Promise.all([
    ...otherPromises,
    ...shrineUpdatePromises,
    settleObjectiveWarCombat(client, curBattle, result, user),
  ]);

  // Broadcast pusher notifications after mutations complete
  await Promise.all(
    sectorsToNotify.map((sector) => broadcastRaidAvailability(pusher, sector)),
  );
};

const shrineColumnsBySide = {
  attacker: {
    hp: "attackerShrineHp",
    maxHp: "attackerShrineMaxHp",
    status: "attackerShrineStatus",
    warHealth: "attackerWarHealth",
    warHealthMax: "attackerWarHealthMax",
  },
  defender: {
    hp: "defenderShrineHp",
    maxHp: "defenderShrineMaxHp",
    status: "defenderShrineStatus",
    warHealth: "defenderWarHealth",
    warHealthMax: "defenderWarHealthMax",
  },
} as const;

/** Recover shrine HP and award recapture healing only to the battle that claims it. */
const recoverWarShrine = async (
  client: DrizzleClient,
  w: BattleWar,
  side: keyof typeof shrineColumnsBySide,
  change: number,
  notifications: CombatResult["notifications"],
) => {
  if (change <= 0) return;

  const columns = shrineColumnsBySide[side];
  const hp = war[columns.hp];
  const maxHp = war[columns.maxHp];
  const status = war[columns.status];
  const recoveredHp = sql`LEAST(${hp} + ${change}, ${maxHp})`;
  const activeWar = and(eq(war.id, w.id), isNull(war.endedAt), warRaidCombatGuard());

  // Claim CAPTURED -> ACTIVE atomically using current HP, rather than the battle snapshot.
  const recaptureResult = await client
    .update(war)
    .set({ [columns.hp]: recoveredHp, [columns.status]: "ACTIVE" })
    .where(
      and(
        activeWar,
        eq(status, "CAPTURED"),
        sql`${hp} + ${change} > ${maxHp} * ${WAR_RECAPTURE_THRESHOLD}`,
      ),
    );

  if (recaptureResult.rowsAffected > 0) {
    await client
      .update(war)
      .set({
        [columns.warHealth]: sql`LEAST(${war[columns.warHealth]} + ${WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL}, ${war[columns.warHealthMax]})`,
      })
      .where(activeWar);
    const villageName =
      side === "attacker"
        ? (w.attackerVillage?.name ?? "Attacker")
        : (w.defenderVillage?.name ?? "Defender");
    notifications.push(
      `${villageName}'s shrine recaptured! ${villageName} gained ${WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL} war HP!`,
    );
  } else {
    // Active shrines and recovery below the threshold still receive HP, without a reward.
    await client
      .update(war)
      .set({ [columns.hp]: recoveredHp })
      .where(activeWar);
  }
};

/**
 * Record event outcomes once through their WAITING token, including draws, or settle
 * ordinary tournament matches. Terminal events call this inside the battle claim;
 * earlier player settlements may record the same outcome without deleting the battle.
 */
export const updateTournament = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  // Fetch
  const user = curBattle.usersState.find((u) => u.userId === userId && !u.isSummon);
  const target = curBattle.usersState.find((u) => u.userId !== userId && !u.isSummon);
  // Event games use sparring rules and record one durable outcome, including draws.
  if (curBattle.extraState.tournamentGameId && user && target && result) {
    await client
      .update(tournamentMatch)
      .set({
        state: "PLAYED",
        winnerId:
          result.outcome === "Draw"
            ? null
            : result.didWin
              ? user.userId
              : target.userId,
      })
      .where(
        and(
          eq(tournamentMatch.id, curBattle.extraState.tournamentGameId),
          eq(tournamentMatch.battleId, curBattle.id),
          eq(tournamentMatch.state, "WAITING"),
        ),
      );
    return;
  }
  // Guards
  if (!user) return;
  if (!target) return;
  if (!result) return;
  if (curBattle.battleType !== "TOURNAMENT") return;
  await client
    .update(tournamentMatch)
    .set({ winnerId: result.didWin ? user.userId : target.userId })
    .where(eq(tournamentMatch.battleId, curBattle.id));
};

/**
 * Apply a winning participant's calculated village, ANBU and clan counters.
 * The caller must own the battle-version claim; raid teammates also require a
 * successful guarded release. SQL increments preserve concurrent faction grants.
 */
export const updateVillageAnbuClan = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  // Event rewards are deferred to tournament completion, independent of faction rewards.
  if (curBattle.extraState.tournamentGameId) return;
  // Fetch
  const user = curBattle.usersState.find((u) => u.userId === userId);
  // Guards
  if (!user?.villageId) return;
  if (!result?.didWin) return;
  // Mutate
  await Promise.all([
    ...(result.villageTokens > 0
      ? [
          client
            .update(village)
            .set({ tokens: sql`tokens + ${result.villageTokens}` })
            .where(eq(village.id, user.villageId)),
        ]
      : []),
    ...(user.anbuId && result.pvpStreak > 0
      ? [
          client
            .update(anbuSquad)
            .set({ pvpActivity: sql`${anbuSquad.pvpActivity} + 1` })
            .where(eq(anbuSquad.id, user.anbuId)),
        ]
      : []),
    ...(user.anbuId && result.anbuPoints > 0
      ? [
          client
            .update(anbuSquad)
            .set({ points: sql`${anbuSquad.points} + ${result.anbuPoints}` })
            .where(eq(anbuSquad.id, user.anbuId)),
        ]
      : []),
    ...(user.clanId && result.clanPoints > 0
      ? [
          client
            .update(clan)
            .set({
              pvpActivity: sql`${clan.pvpActivity} + 1`,
              points: sql`${clan.points} + ${result.clanPoints}`,
              activityPoints: sql`${clan.activityPoints} + ${result.clanPoints}`,
            })
            .where(eq(clan.id, user.clanId)),
        ]
      : []),
  ]);
};

/**
 * Update raid boss progress and participation records after a RAID battle ends.
 * Handles boss HP reduction, damage tracking per player, and defeat notifications.
 *
 * Protection against duplicate processing:
 * 1. Each user deducts only their share of damage (totalDamage / numAttackers)
 * 2. battleCount is the optimistic lock: first battle inserts, later battles
 *    UPDATE only while battleCount still equals the start-of-battle value
 * 3. A duplicate unique key or a missed battleCount UPDATE skips HP and inbox writes
 * 4. This ensures each user's damage is only counted once, regardless of how
 *    many times their endpoint is called
 */
export const updateRaidProgress = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  userId: string,
) => {
  // Guard: Only process RAID battles with a raid quest ID
  if (curBattle.battleType !== "RAID" || !curBattle.extraState.raidQuestId) {
    return;
  }

  const raidQuestId = curBattle.extraState.raidQuestId;
  const raidInitialBossHp = curBattle.extraState.raidInitialBossHp ?? 0;

  // Find the boss in the battle state (exclude summons, which also have isAi=true)
  const boss = curBattle.usersState.find((u) => u.isAi && !u.isSummon);

  // Find this user in the battle
  const user = curBattle.usersState.find(
    (u) => u.userId === userId && !u.isAi && !u.isSummon,
  );

  // Get all human players (attackers) for damage distribution calculation
  const attackers = curBattle.usersState.filter((u) => !u.isAi && !u.isSummon);

  if (!boss || !user || raidInitialBossHp <= 0 || attackers.length === 0) {
    return;
  }

  // Calculate total damage dealt to the boss this battle
  const totalDamage = Math.max(0, raidInitialBossHp - Math.max(0, boss.curHealth));

  // Only record damage if it's positive
  if (totalDamage <= 0) {
    return;
  }

  // Calculate this user's share of damage (equal distribution)
  const userDamage = Math.floor(totalDamage / attackers.length);
  if (userDamage <= 0) {
    return;
  }

  // Get the battleCount at the start of this battle (0 if user hasn't participated before)
  const startBattleCount = curBattle.extraState.raidStartBattleCount?.[userId] ?? 0;

  // Claim this battle's damage for this user. `battleCount` is the optimistic
  // lock. ON DUPLICATE KEY UPDATE (IF() or `id = id`) still reports
  // rowsAffected > 0 on MySQL when the row is only found, so a retry would
  // decrement shared HP and notify again. First participation is a plain
  // insert: a duplicate unique key is a lost claim. Later battles UPDATE
  // only while battleCount still equals the start-of-battle value.
  let claimed = false;
  if (startBattleCount === 0) {
    try {
      await client.insert(raidParticipation).values({
        id: nanoid(),
        questId: raidQuestId,
        userId: userId,
        damageDealt: userDamage,
        battleCount: 1,
        rewardsClaimed: [],
      });
      claimed = true;
    } catch (error) {
      if (!isMysqlDuplicateKeyError(error)) throw error;
    }
  } else {
    const updateResult = await client
      .update(raidParticipation)
      .set({
        damageDealt: sql`${raidParticipation.damageDealt} + ${userDamage}`,
        battleCount: sql`${raidParticipation.battleCount} + 1`,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(raidParticipation.questId, raidQuestId),
          eq(raidParticipation.userId, userId),
          eq(raidParticipation.battleCount, startBattleCount),
        ),
      );
    claimed = updateResult.rowsAffected === 1;
  }

  if (!claimed) {
    return;
  }

  // Shared raid HP is not itself idempotent, so it runs only after the claim.
  // Parallelizing this with the claim would double-decrement on a duplicate call.
  await client
    .update(quest)
    .set({
      raidBossCurrentHealth: sql`GREATEST(0, ${quest.raidBossCurrentHealth} - ${userDamage})`,
    })
    .where(and(eq(quest.id, raidQuestId), eq(quest.questType, "raid")));

  // Read committed global HP. A successful claim already means this user is a
  // participant, so we do not scan RaidParticipation.
  const updatedQuest = await client.query.quest.findFirst({
    where: eq(quest.id, raidQuestId),
    columns: { raidBossCurrentHealth: true, name: true },
  });

  const bossDefeated = (updatedQuest?.raidBossCurrentHealth ?? 0) <= 0;
  if (!bossDefeated) {
    return;
  }

  // Notify only after the post-decrement read, and only this acting user.
  // Doing this beside the HP write would announce a kill from a stale HP
  // snapshot, or insert a second inbox row if the claim gate were skipped.
  const raidName = updatedQuest?.name ?? "the raid";
  await Promise.all([
    client.insert(notification).values([
      {
        userId,
        content: `The boss in ${raidName} has been defeated! Check if you've earned any rewards.`,
      },
    ]),
    client
      .update(userData)
      .set({ unreadNotifications: sql`unreadNotifications + 1` })
      .where(eq(userData.userId, userId)),
  ]);
};

/**
 * Single-statement battle XP grant for item ownership leveling:
 * rows at/over the level-up threshold gain a level and reset XP to 0, all other
 * rows gain `gain` XP. One atomic UPDATE keeps level and XP writes together.
 * The threshold must be independent of level. MySQL applies SET assignments
 * left to right, so `level` must be assigned
 * before `experience` to read the pre-update XP value.
 */
const xpGainOrLevelUpSet = (
  table: { level: AnyMySqlColumn; experience: AnyMySqlColumn },
  xpToLevel: number,
  gain: number,
) => {
  const threshold = xpToLevel - gain;
  return {
    level: sql`${table.level} + (${table.experience} >= ${threshold})`,
    experience: sql`IF(${table.experience} >= ${threshold}, 0, ${table.experience} + ${gain})`,
  };
};

/**
 * Persist player recovery and progression from the preloaded combat result.
 * Hunting calls may set settlingHunt only inside settleHuntingBattle's transaction;
 * ordinary action/poll callbacks skip those rewards to prevent a second settlement.
 */
export const updateUser = async (
  client: DrizzleClient,
  pusher: PusherClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
  settlingHunt = false,
) => {
  const updatedQuestIds: string[] = [];
  if (curBattle.extraState.hunting && !settlingHunt) return { updatedQuestIds };
  // Party settlement restores every member together, bypassing single-player combat rewards.
  if (curBattle.extraState.dungeon) return { updatedQuestIds };
  const user = curBattle.usersState.find((u) => u.userId === userId);
  if (result && user && curBattle.extraState.tournamentGameId) {
    // Event battles are exhibition matches: preserve inventory, pools, progression,
    // immunity and every ordinary combat statistic. Only release this battle's claim.
    const settledAt = new Date();
    await client
      .update(userData)
      .set({
        status: "AWAKE",
        bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
        bracketImmunityPausedAt: null,
        battleId: null,
        regenAt: settledAt,
        curEnergy: combatEnergyRecoverySql(curBattle, userId, 0, settledAt),
        updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))`,
      })
      .where(and(eq(userData.userId, userId), eq(userData.battleId, curBattle.id)));
    void updateUserOnMap(pusher, user.sector, {
      ...user,
      longitude: user.originalLongitude,
      latitude: user.originalLatitude,
    });
    return { updatedQuestIds };
  }
  if (result && user) {
    const isInWarTornSector = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
    const hasHumanOpponent = curBattle.usersState.some(
      (candidate) =>
        candidate.userId !== userId &&
        candidate.direction !== user.direction &&
        !candidate.isAi &&
        !candidate.isSummon,
    );
    result.energyReward =
      isPvpEnergyRewardBattle(curBattle, userId) &&
      curBattle.extraState.energyRewardEligible === true &&
      (result.outcome === "Won" || result.outcome === "Lost")
        ? result.didWin
          ? ENERGY_PVP_WIN_REWARD
          : ENERGY_PVP_LOSS_REWARD
        : 0;
    const farmActivityReductionSeconds = getPvpFarmActivityReductionSeconds(
      curBattle.battleType,
      result.outcome,
      hasHumanOpponent,
    );
    const farmActivityAt = new Date();

    // War quest credit follows both combat teams' preloaded faction participation.
    // War-torn kills remain outside persistent war state.
    const isOpposingWarFoe = (target: (typeof curBattle.usersState)[number]) =>
      !isInWarTornSector && getOpposingBattleWars(curBattle, user, target).length > 0;
    // Battle-global war participation (outcome-independent): gates the per-battle pvp_kills
    // counter for war quests. Per-opponent `warFoe` (below) gates defeat_opponents so a non-war
    // target isn't credited just because a war foe shared the battle.
    const isWarBattleParticipant = curBattle.usersState.some(isOpposingWarFoe);

    // Accumulate all tracker tasks into a single array for one getNewTrackers call
    const trackerTasks: Parameters<typeof getNewTrackers>[1] = [];

    // Update quest tracker with battle result. pvp_kills is emitted on every COMBAT win; the
    // war-torn (pvp quests) / active-war (war quests) gating is applied per quest in getNewTrackers.
    if (result.didWin > 0) {
      if (curBattle.battleType === "COMBAT") {
        trackerTasks.push({ task: "pvp_kills", increment: 1 });
      }
      if (curBattle.battleType === "ARENA") {
        trackerTasks.push({ task: "arena_kills", increment: 1 });
      }
      if (curBattle.battleType === "RANDOM_ENCOUNTER") {
        trackerTasks.push({ task: "random_encounter_wins", increment: 1 });
      }
      if (curBattle.battleType === "SPARRING") {
        trackerTasks.push({ task: "spars_won", increment: 1 });
      }
    }

    // Shared opponent credit follows the battle team, excluding summons and allies.
    const trackerEvents = [
      ...curBattle.usersState
        .filter((u) => !u.isSummon && !areBattleAllies(u, user))
        .flatMap((u) => [
          // Defeat opponent with outcome; gated per quest type in getNewTrackers (pvp → war-torn
          // sector, war → this opponent being an active-war foe).
          {
            task: "defeat_opponents" as const,
            contentId: u.controllerId,
            text: result.outcome,
            warFoe: isOpposingWarFoe(u),
          },
          // Start battle with outcome
          {
            task: "start_battle" as const,
            contentId: u.controllerId,
            text: result.outcome,
          },
        ]),
      // Winning random encounter
      ...(curBattle.battleType === "RANDOM_ENCOUNTER"
        ? [
            {
              task: "win_encounter_at_location" as const,
              contentId: user.userId,
              text: result.outcome,
            },
          ]
        : []),
    ];
    trackerTasks.push(...trackerEvents);

    // Combat objective trackers: creatures hunted, combat item/jutsu/tag usage, and
    // damage dealt — all derived from pre-loaded battle state (no extra fetch), folded into
    // the single getNewTrackers call below.
    trackerTasks.push(...buildCombatTrackerTasks(curBattle, user, result));
    if (curBattle.extraState.hunting && result.outcome === "Won")
      trackerTasks.push({
        task: "hunting_experience_gained",
        increment: curBattle.extraState.hunting.contract.experience,
      });

    // Single call to getNewTrackers with all tasks
    const hydratedUser = hydrateUserForQuests(curBattle, user);
    // An isolated defeat stays in the run so its authored checkpoint remains playable.
    if (getIsolatedPyramid(hydratedUser))
      result.curHealth = Math.max(1, result.curHealth);
    const previouslyDoneGoals = new Set(
      hydratedUser.questData.flatMap((tracker) =>
        tracker.goals
          .filter((goal) => goal.done)
          .map((goal) => `${tracker.id}:${goal.id}`),
      ),
    );
    const { trackers, notifications, questIdsUpdated, consequences } = getNewTrackers(
      hydratedUser,
      trackerTasks,
      {
        battleId: curBattle.id,
        inWarTornSector: isInWarTornSector,
        isWarParticipant: isWarBattleParticipant,
        questBattleSource: curBattle.extraState.questBattleSource,
        questTeamStillFighting: curBattle.usersState.some(
          (teammate) =>
            teammate.controllerId !== user.controllerId &&
            !teammate.isAi &&
            !teammate.leftBattle &&
            !teammate.fledBattle &&
            stillInBattle(teammate, curBattle.usersEffects) &&
            areBattleAllies(teammate, user),
        ),
      },
    );
    updatedQuestIds.push(...questIdsUpdated);
    const updatedQuestData = filterQuestTrackersForDbPersist(
      trackers,
      hydratedUser as NonNullable<UserWithRelations>,
    );
    // Add notifications to combatResult
    result.notifications.push(...notifications);

    // Apply durability penalty for dying in war-torn sector (reduce 50 durability from all equipped gear)
    // This must be done BEFORE durability warnings so warnings see the true final durability
    const deleteItems = user.items.filter((ui) => ui.quantity <= 0).map((i) => i.id);
    const updateItems = user.items.filter((ui) => ui.quantity > 0);
    if (isInWarTornSector && result.didWin === 0 && result.outcome === "Lost") {
      updateItems.forEach((ui) => {
        const item = getItem(curBattle, ui.itemId);
        // Only reduce durability for equipped items (not "NONE") that are not consumables
        if (
          ui.equipped !== "NONE" &&
          item?.itemType !== "CONSUMABLE" &&
          item?.maxDurability &&
          item.maxDurability > 0
        ) {
          // Reduce durability by 50, ensuring it doesn't go below 0
          const currentDurability = ui.durability ?? item.maxDurability;
          ui.durability = Math.max(0, currentDurability - 50);
        }
      });
    }

    // Check for low durability warnings (percent-based: <=50% and <=25%) and for broken items
    const initialDurability = curBattle.extraState.initialDurability;
    if (initialDurability?.[userId]) {
      const userInitialDurability = initialDurability[userId];
      user.items.forEach((battleItem) => {
        const item = getItem(curBattle, battleItem.itemId);
        if (item?.maxDurability && item.maxDurability > 0) {
          const initial = userInitialDurability[battleItem.id];
          const final = battleItem.durability;
          const max = item.maxDurability;
          if (initial === undefined) return;
          const initialPct = Math.round((initial / max) * 100);
          const finalPct = Math.round((final / max) * 100);
          // Broken: now at 0
          if (initial > 0 && final <= 0) {
            result.notifications.push(
              `${item.name} has broken and cannot be used until repaired!`,
            );
          } else if (
            // Urgent warning: crossed down to <=25%
            initialPct > 25 &&
            finalPct <= 25 &&
            final > 0
          ) {
            result.notifications.push(
              `${item.name} durability is critically low at ${finalPct}%! Repair it soon to prevent it from breaking!`,
            );
          } else if (
            // Regular warning: crossed down to <=50% (but still above 25%)
            initialPct > 50 &&
            finalPct <= 50 &&
            finalPct > 25 &&
            final > 0
          ) {
            result.notifications.push(
              `${item.name} durability is now ${finalPct}%. Consider repairing it soon!`,
            );
          }
        }
      });
    }

    // A kage cannot also be an elder, so only the winning challenger loses ELDER
    const tookKageSeat = didUserTakeKageSeat(curBattle, userId);

    // Any jutsus to be updated
    const jUsage = user.usedActions.filter((a) => a.type === "jutsu").map((a) => a.id);
    const jUnique = [...new Set(jUsage)];
    const jExp = Math.floor(
      boostPvpGain(
        battleJutsuExp(
          curBattle.battleType,
          result.eloDiff,
          curBattle.extraState.settings,
        ),
        user.pvpBoostPercent ?? 0,
      ),
    );
    // Definitions are already preloaded in battle state; group by progression cap.
    const jutsuXpGroups = new Map<number, string[]>();
    for (const id of jUnique) {
      const definition = getJutsu(curBattle, id);
      if (!definition) continue;
      const cap = getJutsuMaxLevel(definition);
      const ids = jutsuXpGroups.get(cap) ?? [];
      ids.push(id);
      jutsuXpGroups.set(cap, ids);
    }
    // Equipped items gain XP from eligible PvP battles (win vs loss amounts + event multiplier)
    const iExp = Math.floor(
      boostPvpGain(
        battleItemExp(
          curBattle.battleType,
          result.didWin > 0,
          curBattle.extraState.settings,
        ),
        user.pvpBoostPercent ?? 0,
      ),
    );
    // Group equipped items by their definition's xpToLevel for batched updates.
    // Forced-loadout entries are synthetic rows; XP is credited to the real
    // UserItem row they were seeded from (progressionRowId).
    const equippedXpGroups = new Map<number, Set<string>>();
    if (iExp > 0) {
      for (const ui of user.items) {
        if (ui.equipped === "NONE" || ui.quantity <= 0) continue;
        const rowId = ui.progressionRowId ?? ui.id;
        const def = getItem(curBattle, ui.itemId);
        const xpToLevel = def?.xpToLevel ?? ITEM_XP_TO_LEVEL;
        const ids = equippedXpGroups.get(xpToLevel) ?? new Set<string>();
        ids.add(rowId);
        equippedXpGroups.set(xpToLevel, ids);
      }
    }
    // If new prestige goes below 0, set allyVillage to false
    if (user.villagePrestige + result.villagePrestige < 0) {
      user.allyVillage = false;
    }

    // Check for ranked win streak reward (every 3 wins) and total wins reward (every 3 wins)
    // Use the user's rankedStreak and rankedWins from battle state (loaded at battle initiation)
    let streakSeichiSilverBonus = 0;
    if (curBattle.battleType === "RANKED_PVP" && result.didWin) {
      // Check win streak reward (every 3 consecutive wins)
      const newStreak = user.rankedStreak + 1;
      if (newStreak > 0 && newStreak % 3 === 0) {
        streakSeichiSilverBonus += 1;
      }
      // Check total wins reward (every 3 total wins)
      const newWins = user.rankedWins + 1;
      if (newWins > 0 && newWins % 3 === 0) {
        streakSeichiSilverBonus += 1;
      }
      if (streakSeichiSilverBonus > 0) {
        result.seichiSilver += streakSeichiSilverBonus;
      }
    }

    // Use one timestamp for persisted recovery and its compact completion response.
    const settledAt = new Date();
    let userSettlementCommitted = false;
    let itemSettlementCommitted = true;
    // Defer execution so a hunting transaction never overlaps requests on its session.
    const settlementWrites: (() => PromiseLike<unknown>)[] = [
      ...(!user.isAi
        ? [
            () =>
              recordVillageMissionProgress(client, user.villageId, userId, {
                pvp_kills: result.villageMissionPvpKills ?? 0,
              }),
          ]
        : []),
      ...(farmActivityReductionSeconds > 0
        ? [
            () =>
              reduceActiveFarmPlotTimers(
                client,
                userId,
                farmActivityReductionSeconds,
                farmActivityAt,
              ).then((farmResult) => {
                if (farmResult.rowsAffected > 0) {
                  const reductionLabel = result.didWin
                    ? "1 minute 30 seconds"
                    : "1 minute";
                  result.notifications.push(
                    `PvP activity reduced active crop growth times by ${reductionLabel}.`,
                  );
                }
              }),
          ]
        : []),
      // Update bounties
      ...(result.bountiesClaimed.length > 0
        ? [
            () =>
              client
                .update(bounty)
                .set({
                  status: "CLAIMED",
                  claimedAt: new Date(),
                  claimedByUserId: userId,
                })
                .where(
                  and(
                    inArray(
                      bounty.id,
                      result.bountiesClaimed.map((b) => b.bountyId),
                    ),
                    eq(bounty.status, "OPEN"),
                  ),
                ),
          ]
        : []),
      // Delete items
      ...(deleteItems.length > 0
        ? [
            () =>
              client
                .delete(userItem)
                .where(and(inArray(userItem.id, deleteItems), gt(userItem.quantity, 0)))
                .then((saved) => {
                  if (saved.rowsAffected !== deleteItems.length)
                    itemSettlementCommitted = false;
                }),
            () =>
              client
                .delete(userItemImbuement)
                .where(inArray(userItemImbuement.userItemId, deleteItems)),
          ]
        : []),
      // Persist all surviving items in one request. The owner and quantity guards skip
      // transferred rows, merge claims and tombstones; settlement cannot resurrect them.
      ...(updateItems.length > 0
        ? [
            () =>
              client
                .update(userItem)
                .set({
                  quantity: sql`CASE ${userItem.id} ${sql.join(
                    updateItems.map((ui) => sql`WHEN ${ui.id} THEN ${ui.quantity}`),
                    sql` `,
                  )} ELSE ${userItem.quantity} END`,
                  durability: sql`CASE ${userItem.id} ${sql.join(
                    updateItems.map((ui) => sql`WHEN ${ui.id} THEN ${ui.durability}`),
                    sql` `,
                  )} ELSE ${userItem.durability} END`,
                  // Hunting requires a changed-row acknowledgement even for unchanged carried items.
                  ...(settlingHunt
                    ? {
                        updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userItem.updatedAt}))`,
                      }
                    : {}),
                })
                .where(
                  and(
                    eq(userItem.userId, userId),
                    inArray(
                      userItem.id,
                      updateItems.map((ui) => ui.id),
                    ),
                    gt(userItem.quantity, 0),
                  ),
                )
                .then((saved) => {
                  // Every expected row must acknowledge before hunting rewards can commit
                  // or the completion response can safely replace the profile cache.
                  if (saved.rowsAffected !== updateItems.length)
                    itemSettlementCommitted = false;
                }),
          ]
        : []),
      // Jutsu experience & level from experience
      ...(jExp > 0
        ? [...jutsuXpGroups.entries()].map(([cap, ids]) => {
            const xpToLevel =
              cap === ELITE_JONIN_JUTSU_LEVEL_CAP
                ? sql`IF(${userJutsu.level} < ${JUTSU_TRAIN_LEVEL_CAP}, ${ELITE_JONIN_JUTSU_XP_TO_LEVEL}, ${ELITE_JONIN_JUTSU_ADVANCED_XP_TO_LEVEL})`
                : sql`${JUTSU_XP_TO_LEVEL}`;
            // Drizzle orders SET by schema columns (level first). This single-table
            // statement must reset XP using the old level before changing that level.
            // With a positive gain, only a level-up leaves experience at zero.
            return () =>
              client.execute(sql`
              UPDATE ${userJutsu}
              SET ${userJutsu.experience} = IF(${userJutsu.experience} + ${jExp} >= ${xpToLevel}, 0, ${userJutsu.experience} + ${jExp}),
                  ${userJutsu.level} = ${userJutsu.level} + (${userJutsu.experience} = 0)
              WHERE ${userJutsu.userId} = ${user.userId}
                AND ${userJutsu.level} < ${cap}
                AND ${inArray(userJutsu.jutsuId, ids)}
            `);
          })
        : []),
      // Item experience & level from PvP (equipped items only; per-item xpToLevel)
      ...(iExp > 0
        ? [...equippedXpGroups.entries()].map(
            ([xpToLevel, ids]) =>
              () =>
                client
                  .update(userItem)
                  .set(xpGainOrLevelUpSet(userItem, xpToLevel, iExp))
                  .where(
                    and(
                      eq(userItem.userId, user.userId),
                      lt(userItem.level, ITEM_LEVEL_CAP),
                      inArray(userItem.id, [...ids]),
                    ),
                  ),
          )
        : []),
      // Update user data
      () =>
        client
          .update(userData)
          .set({
            // Settlement invalidates delayed passive-regeneration snapshots.
            updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))`,
            curEnergy: combatEnergyRecoverySql(
              curBattle,
              userId,
              result.energyReward,
              settledAt,
            ),
            experience: sql`experience + ${result.experience}`,
            earnedExperience: sql`earnedExperience + ${result.earnedExperience}`,
            petExperience: petExperienceGainSql(
              Math.round(result.experience) + Math.round(result.earnedExperience),
              curBattle.extraState.petIdsByOwner?.[userId] ?? null,
            ),
            ...(curBattle.extraState.hunting && result.outcome === "Won"
              ? {
                  huntingExperience: sql`${userData.huntingExperience} + ${curBattle.extraState.hunting.contract.experience}`,
                }
              : {}),
            pvpStreak: result.pvpStreak,
            ...(curBattle.battleType === "COMBAT" && hasHumanOpponent
              ? {
                  pvpWins: sql`${userData.pvpWins} + ${result.outcome === "Won" ? 1 : 0}`,
                  pvpLosses: sql`${userData.pvpLosses} + ${result.outcome === "Lost" || result.outcome === "Fled" ? 1 : 0}`,
                }
              : {}),
            pvpExperience: sql`${userData.pvpExperience} + ${result.pvpExperience ?? 0}`,
            ...((result.weeklyPvpKills ?? 0) > 0
              ? {
                  weeklyPvpKills: sql`CASE WHEN ${userData.weeklyPvpKillsAt} >= ${periodStart("weekly", settledAt)} THEN ${userData.weeklyPvpKills} ELSE 0 END + ${result.weeklyPvpKills ?? 0}`,
                  weeklyPvpKillsAt: settledAt,
                }
              : {}),
            ...(curBattle.battleType !== "RANKED_PVP" &&
            curBattle.battleType !== "SPARRING" &&
            curBattle.battleType !== "RANKED_SPARRING"
              ? {
                  curHealth: result.curHealth,
                  curStamina: result.curStamina,
                  curChakra: result.curChakra,
                }
              : {}),
            strength: sql`strength + ${result.strength}`,
            intelligence: sql`intelligence + ${result.intelligence}`,
            willpower: sql`willpower + ${result.willpower}`,
            speed: sql`speed + ${result.speed}`,
            money: result.money ? sql`money + ${result.money}` : sql`money`,
            seichiSilver: result.seichiSilver
              ? sql`seichiSilver + ${result.seichiSilver}`
              : sql`seichiSilver`,
            // Preserve stored over-cap entitlement; concurrent gains cannot exceed the cap.
            ...masteryGainUpdates(result.masteryGains ?? {}),
            offence: sql`offence + ${result.offence}`,
            defence: sql`defence + ${result.defence}`,
            villagePrestige: sql`villagePrestige + ${result.villagePrestige}`,
            dailyArenaFights: sql`dailyArenaFights + ${curBattle.battleType === "ARENA" ? 1 : 0}`,
            dailySageActivations: sql`dailySageActivations + ${user.sageModeUsedThisBattle ? 1 : 0}`,
            questData: updatedQuestData,
            bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
            bracketImmunityPausedAt: null,
            battleId: null,
            // Only Energy recovers in combat; reset the shared clock for other pools.
            regenAt: settledAt,
            // War participation is stamped when starting a war action; winning an unrelated
            // battle or defending against an attack must not start or extend that window.
            ...(curBattle.battleType === "RANKED_PVP"
              ? {
                  rankedLp: sql`GREATEST(rankedLp + ${result.lpDiff}, 0)`,
                  rankedStreak: result.didWin ? sql`${userData.rankedStreak} + 1` : 0,
                  rankedWins: sql`rankedWins + ${result.didWin ? 1 : 0}`,
                  rankedBattles: sql`rankedBattles + 1`,
                }
              : {}),
            ...(tookKageSeat
              ? {
                  rank: sql`CASE WHEN ${userData.rank} = 'ELDER' THEN 'JONIN' ELSE ${userData.rank} END`,
                }
              : {}),
            ...(!getIsolatedPyramid(hydratedUser) &&
            !curBattle.forceKeepPools &&
            result.curHealth <= 0 &&
            !["SPARRING", "RANKED_PVP", "RANKED_SPARRING"].includes(
              curBattle.battleType,
            )
              ? {
                  status: "HOSPITALIZED",
                  longitude: HOSPITAL_LONG,
                  latitude: HOSPITAL_LAT,
                  sector: user.allyVillage
                    ? user.sector
                    : getVillage(curBattle, user.villageId)?.sector,
                  immunityUntil:
                    curBattle.battleType === "COMBAT"
                      ? sql`NOW() + INTERVAL 1 MINUTE`
                      : sql`immunityUntil`,
                }
              : { status: getIsolatedPyramid(hydratedUser) ? "BATTLE" : "AWAKE" }),
            // Deactivate stealth and set cooldown after leaving combat (20 seconds)
            stealthActive: false,
            stealthActivatedAt: null,
            stealthCooldownAt: new Date(
              Math.floor(settledAt.getTime() / 1000) * 1000 +
                STEALTH_POST_COMBAT_COOLDOWN_SECONDS * 1000,
            ),
          })
          .where(and(eq(userData.userId, userId), eq(userData.battleId, curBattle.id)))
          .then((saved) => {
            userSettlementCommitted = saved.rowsAffected === 1;
          }),
      // Handle dropped items transfer if present on result. Currently only AI have droppable items, so no need to delete from loser
      ...(result.droppedItems.length > 0
        ? [
            () =>
              client.insert(userItem).values(
                result.droppedItems.map((d) => ({
                  id: nanoid(),
                  userId: user.userId,
                  itemId: d.itemId,
                  equipped: "NONE" as const,
                })),
              ),
          ]
        : []),
    ];
    if (settlingHunt) {
      // The HTTP driver shares one transaction session; await each factory before starting the next.
      for (const write of settlementWrites) await write();
      if (!userSettlementCommitted || !itemSettlementCommitted)
        throw new Error("Hunting character or inventory changed during settlement");
    } else await Promise.all(settlementWrites.map((write) => write()));
    const baseline = curBattle.extraState.profileCacheSnapshots?.[userId];
    const capacity = curBattle.extraState.energyCapacity?.[userId];
    const regeneration = curBattle.extraState.energyRegeneration?.[userId];
    const newlyDoneGoal = trackers.some((tracker) =>
      tracker.goals.some(
        (goal) => goal.done && !previouslyDoneGoals.has(`${tracker.id}:${goal.id}`),
      ),
    );
    if (
      userSettlementCommitted &&
      itemSettlementCommitted &&
      baseline &&
      capacity !== undefined &&
      regeneration !== undefined &&
      canCacheCombatCompletion(curBattle, result, userId) &&
      consequences.length === 0 &&
      !newlyDoneGoal &&
      iExp === 0 &&
      user.items.every((item) => !item.progressionRowId) &&
      result.droppedItems.length === 0
    ) {
      const publicUser = getPublicQuestUser({
        ...hydratedUser,
        questData: trackers,
      } as NonNullable<UserWithRelations>);
      const { masterySources: _privateSources, ...cacheBaseline } = baseline;
      const settledItems = combatCacheItems(baseline, user.items);
      const userDelta = {
        ...combatCacheIntegerDelta(baseline, result),
        offence: result.offence,
        defence: result.defence,
        strength: result.strength,
        intelligence: result.intelligence,
        willpower: result.willpower,
        speed: result.speed,
        dailyArenaFights: curBattle.battleType === "ARENA" ? 1 : 0,
        dailySageActivations: user.sageModeUsedThisBattle ? 1 : 0,
        ...allocateMasteryGains({ ...user, ...baseline }, result.masteryGains ?? {}),
      };
      result.profileUpdate = {
        userId,
        battleId: curBattle.id,
        baseline: cacheBaseline,
        userDelta,
        userPatch: {
          status: getIsolatedPyramid(hydratedUser) ? "BATTLE" : "AWAKE",
          curHealth: Math.round(result.curHealth),
          curStamina: Math.round(result.curStamina),
          curChakra: Math.round(result.curChakra),
          curEnergy: combatCacheEnergy(
            baseline,
            capacity,
            regeneration,
            settledAt,
            result.energyReward ?? 0,
            curBattle.extraState.energyRegenerationPeriods?.[userId],
          ),
          regenAt: settledAt,
          stealthCooldownAt: new Date(
            Math.floor(settledAt.getTime() / 1000) * 1000 +
              STEALTH_POST_COMBAT_COOLDOWN_SECONDS * 1000,
          ),
          pvpStreak: result.pvpStreak,
          questData: publicUser.questData,
          pveFights: baseline.pveFights + 1,
          ...combatCacheDerived(baseline, settledItems, userDelta),
        },
        items: settledItems,
      };
    }
    // Update map status
    if (
      result.curHealth > 0 ||
      ["SPARRING", "RANKED_SPARRING"].includes(curBattle.battleType)
    ) {
      void updateUserOnMap(pusher, user.sector, {
        ...user,
        longitude: user.originalLongitude,
        latitude: user.originalLatitude,
      });
    }
  }
  return { updatedQuestIds };
};

// Use the persisted balance/clock so delayed or repeated releases cannot replay recovery.
// Fractional ticks preserve Energy across short fights while other pools stay frozen.
export const combatEnergyRecoverySql = (
  snapshot?: CompleteBattle,
  userId?: string,
  reward = 0,
  settledAt?: Date,
) => {
  const regeneration =
    (userId ? snapshot?.extraState.energyRegeneration?.[userId] : undefined) ??
    userData.regeneration;
  // Legacy or orphaned battles lack gear metadata; do not erase stored Energy.
  const capacity =
    (userId ? snapshot?.extraState.energyCapacity?.[userId] : undefined) ??
    sql`GREATEST(${userData.maxEnergy}, ${userData.curEnergy})`;
  const recoveryAt = settledAt ?? sql`NOW(3)`;
  const periods =
    (userId ? snapshot?.extraState.energyRegenerationPeriods?.[userId] : undefined) ??
    [];
  const bonus = periods.length
    ? sql.join(
        periods.map((period) => {
          const start = sql.param(new Date(period.startsAt), userData.regenAt);
          const end = sql.param(new Date(period.endsAt), userData.regenAt);
          return sql`${period.bonus} * GREATEST(0, TIMESTAMPDIFF(MICROSECOND, GREATEST(${userData.regenAt}, ${start}), LEAST(${recoveryAt}, ${end}))) / ${REGEN_SECONDS * 1_000_000}`;
        }),
        sql` + `,
      )
    : sql`0`;
  return sql`LEAST(${capacity}, ${userData.curEnergy} + ${reward} + ${bonus} + GREATEST(0, ${regeneration}) * GREATEST(0, TIMESTAMPDIFF(MICROSECOND, ${userData.regenAt}, ${recoveryAt})) / ${REGEN_SECONDS * 1_000_000})`;
};
