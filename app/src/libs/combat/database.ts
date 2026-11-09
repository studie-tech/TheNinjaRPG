import { and, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { buildCombatProfileUpdate, canCacheCombatCompletion } from "@/deltas/combat";
import type { BattleType } from "@/drizzle/constants";
import {
  ELITE_JONIN_JUTSU_ADVANCED_XP_TO_LEVEL,
  ELITE_JONIN_JUTSU_LEVEL_CAP,
  ELITE_JONIN_JUTSU_XP_TO_LEVEL,
  ENERGY_PVP_LOSS_REWARD,
  ENERGY_PVP_WIN_REWARD,
  ITEM_XP_TO_LEVEL,
  JUTSU_TRAIN_LEVEL_CAP,
  JUTSU_XP_TO_LEVEL,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  MPVP_QUEUE_BATTLE_TYPES,
  REGEN_SECONDS,
  SPARRING_BATTLE_TYPES,
  VILLAGE_WAR_TYPES,
  WAR_SHRINE_CAPTURE_WARHEALTH_DMG,
  WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL,
} from "@/drizzle/constants";
import { type Battle, userData, userJutsu, war } from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/actions";
import {
  ITEM_BROKEN_NOTICE,
  ITEM_DURABILITY_CRITICAL_NOTICE,
  ITEM_DURABILITY_NOTICE,
} from "@/libs/combat/constants";
import { settleObjectiveWarCombat } from "@/libs/combat/objectiveWar";
import { areBattleAllies, hasHumanOpponent } from "@/libs/combat/participants";
import type { CombatQuestTrackerTask } from "@/libs/combat/quests";
import {
  buildCombatTrackerTasks,
  calcBattleResult,
  didKageChallengerWin,
  didUserTakeKageSeat,
  getBattleTeamWars,
  getKageChallengeParticipants,
  getOpposingBattleWars,
  hydrateUserForQuests,
  isPvpEnergyRewardBattle,
} from "@/libs/combat/settlement";
import type {
  ActionEffect,
  BattleUserState,
  BattleWar,
  CombatResult,
  CompleteBattle,
} from "@/libs/combat/types";
import { getItem, getJutsu } from "@/libs/combat/util";
import { claimVillageMissionPvpKills } from "@/libs/combat/villageMission";
import { getPvpFarmActivityReductionSeconds } from "@/libs/farming";
import { getJutsuMaxLevel } from "@/libs/jutsuProgression";
import { isQuestComplete } from "@/libs/objectives";
import { getWarSide } from "@/libs/objectiveWar";
import {
  broadcastRaidAvailability,
  type PusherClient,
  updateUserOnMap,
} from "@/libs/pusher";
import { boostPvpGain } from "@/libs/pvpExperience";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { getPublicQuestUser } from "@/libs/quest/projection";
import { getIsolatedPyramid } from "@/libs/questRun";
import {
  getRaidChatConversationId,
  prepareExclusiveRaidActivation,
} from "@/libs/raids";
import { battleItemExp, battleJutsuExp } from "@/libs/train";
import { incrementAnbuPoints } from "@/queries/anbu";
import type { DataBattleAction } from "@/queries/combat";
import {
  deleteBattleIfVersionMatches,
  deleteMpvpBattleQueueForFinishBattle,
  deleteMpvpBattleUserForFinishBattle,
  deleteUserItemImbuementForUpdateKage,
  executeRowsForUpdateUser,
  findQuestForUpdateRaidProgress,
  insertBattleActionForCreateAction,
  insertBattleActionForCreateAction2,
  insertDataBattleActionForSaveUsage,
  insertLogBattleLengthsForFinishBattle,
  insertNotificationForUpdateRaidProgress,
  insertRaidParticipationForUpdateRaidProgress,
  insertUserItemForUpdateUser,
  insertWarKillForUpdateWars,
  selectMpvpBattleQueueForCreateAction,
  updateAnbuSquadForUpdateVillageAnbuClan,
  updateBattleForUpdateBattleState,
  updateBountyForUpdateUser,
  updateClanForUpdateClanLeaders,
  updateClanForUpdateVillageAnbuClan,
  updateKageDefendedChallengesForCompleteKageDefense,
  updateQuestForUpdateRaidProgress,
  updateQuestForUpdateWars,
  updateRaidParticipationForUpdateRaidProgress,
  updateTournamentMatchForUpdateTournament,
  updateTournamentMatchForUpdateTournament2,
  updateUserDataForFinishBattle,
  updateUserDataForUpdateUser,
  updateUserDataForUpdateUser2,
  updateUserItemForUpdateKage,
  updateUserItemForUpdateUser,
  updateUserItemForUpdateUser2,
  updateVillageForUpdateClanLeaders,
  updateVillageForUpdateKage,
  updateWarForRecoverWarShrine,
  updateWarForRecoverWarShrine2,
  updateWarForRecoverWarShrine3,
  updateWarForUpdateWars,
  updateWarHealthForUpdateWars,
} from "@/queries/combat";
import { reduceActiveFarmPlotTimers } from "@/queries/farming";
import { deleteUserItemsWithPositiveQuantity } from "@/queries/item";
import { incrementNotificationCounters } from "@/queries/misc";
import { incrementVillageTokens } from "@/queries/village";
import { warRaidCombatGuard } from "@/queries/war";
import type { UserWithRelations } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { rewardClanBattleVictory } from "@/server/utils/clanBattle";
import { settleDungeonBattle } from "@/server/utils/dungeon";
import { settleHuntingBattle } from "@/server/utils/hunting";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { purgeRaidChatMembership } from "@/server/utils/raidChat";
import {
  settleTerritoryWarCombat,
  territoryWarAwards,
} from "@/server/utils/territoryWar";
import {
  applyVillageMissionShrineDamage,
  recordVillageMissionProgress,
} from "@/server/utils/villageMission";

/**
 * A raid is "boss defeated" when the boss AI exists in the battle and no
 * remaining boss AI is still in fighting condition. Summons don't count as
 * the boss; teammates' AI summons must not block the defeat condition.
 */
const isRaidBossDefeated = (battle: CompleteBattle) =>
  battle.battleType === "RAID" &&
  battle.usersState.some((u) => u.isAi && !u.isSummon) &&
  battle.usersState.every((u) => !u.isAi || u.isSummon || !stillInBattle(u));

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
    result.villageMissionPvpKills = claimVillageMissionPvpKills(
      newBattle,
      userId,
      result,
    );
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
    humanFighters.every((u) => !stillInBattle(u));
  const territoryGuardianEnded =
    !!result &&
    newBattle.battleType === "TERRITORY_WAR" &&
    // A guardian encounter ends for the whole roster on either side's defeat.
    (newBattle.usersState
      .filter((u) => u.isAi && !u.isSummon)
      .every((u) => !stillInBattle(u)) ||
      humanFighters.every((u) => !stillInBattle(u)));
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
  const humanTeammates = raidEnded ? humanFighters : [];
  const humanUserIds = humanTeammates.map((u) => u.userId);
  const needsHospital = (teammate: BattleUserState) =>
    !newBattle.forceKeepPools && teammate.curHealth <= 0;

  // Only the successful version claim may proceed to rewards and cleanup.
  // Ordinary settlement writes are not atomic with this claim; failures can leave partial settlement.
  if (battleOver) {
    const deleteBattle = (database: DrizzleClient) =>
      deleteBattleIfVersionMatches(database, newBattle, fetchedVersion);
    const deleted = await retryOnDeadlock(() =>
      newBattle.extraState.tournamentGameId ||
      newBattle.extraState.kageMatch ||
      territoryWarAwards(newBattle).length > 0
        ? client.transaction(async (database) => {
            const deleted = await deleteBattle(database);
            // The version DELETE and match UPDATE must commit together: a single-row CAS
            // cannot prevent recovery treating a deleted battle as an interrupted launch.
            if (deleted.rowsAffected === 1) {
              // MySQL cannot DELETE Battle while INSERTing a missing receipt/score and
              // UPDATEing the event/rewards. Only eligible awards need that transaction;
              // scoreless encounters use a single guarded DELETE. Retrying the
              // claim after rollback preserves credit without delivering it twice.
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
    const updateBattleState = (database: DrizzleClient) =>
      updateBattleForUpdateBattleState(database, newBattle, fetchedVersion);
    const updated = await retryOnDeadlock(() =>
      result && territoryWarAwards(newBattle).length > 0
        ? client.transaction(async (database) => {
            const updated = await updateBattleState(database);
            // A decided PvP win must score before the opponent collects their result.
            // MySQL cannot UPDATE Battle and INSERT missing receipt/score rows in one
            // statement. The version claim and receipt make whole-transaction retries safe.
            if (updated.rowsAffected === 1)
              await settleTerritoryWarCombat(database, newBattle);
            return updated;
          })
        : updateBattleState(client),
    );
    if (updated.rowsAffected === 0) {
      return null;
    }
  }

  const finishBattle = async () => {
    if (battleOver) {
      await Promise.all([
        ...(user && other
          ? [insertLogBattleLengthsForFinishBattle(client, newBattle, user, other)]
          : []),
        // Clean up battle users in parallel - safe since they only read from mpvpBattleQueue
        ...(MPVP_QUEUE_BATTLE_TYPES.includes(newBattle.battleType)
          ? [deleteMpvpBattleUserForFinishBattle(client, newBattle)]
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
            const released = await updateUserDataForFinishBattle(
              client,
              combatEnergyRecoverySql,
              newBattle,
              teammate,
              needsHospital(teammate),
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
      if (MPVP_QUEUE_BATTLE_TYPES.includes(newBattle.battleType)) {
        await deleteMpvpBattleQueueForFinishBattle(client, newBattle);
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
            if (needsHospital(teammate)) return;
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
      await insertDataBattleActionForSaveUsage(client, uniqueData);
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
      selectMpvpBattleQueueForCreateAction(client, entry, newBattle),
    );
    await insertBattleActionForCreateAction(client, selections);
    return actions;
  }
  await insertBattleActionForCreateAction2(client, actions);
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
  const won = didKageChallengerWin(participants.challenger, participants.kage);
  await updateKageDefendedChallengesForCompleteKageDefense(
    client,
    won,
    curBattle,
    match,
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
  // Only care about scheduled Kage battles between members of the same village
  if (!result) return;
  const match = curBattle.extraState.kageMatch;
  if (!match) return;
  const participants = getKageChallengeParticipants(curBattle);
  if (!participants) return;
  const { challenger, kage } = participants;

  const challengerDidWin = didKageChallengerWin(challenger, kage);

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
    // Move the hat only if the challenger actually wins. CAS on the kage this
    // battle defeated: a delayed second finalization of an old battle must not
    // re-seat its challenger over a kage legitimately installed in the meantime.
    ...(challengerDidWin
      ? [updateVillageForUpdateKage(client, challenger, match)]
      : []),

    ...(deleteItems.length > 0
      ? [
          deleteUserItemsWithPositiveQuantity(client, deleteItems),
          deleteUserItemImbuementForUpdateKage(client, deleteItems),
        ]
      : []),

    // The quantity guard skips rows a stack merge has claimed or already folded away, so this
    // absolute snapshot write can never resurrect a merge tombstone or stomp a claim.
    ...(updateItems.length > 0
      ? updateItems.map((ui) => updateUserItemForUpdateKage(client, ui))
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
    updateClanForUpdateClanLeaders(client, {
      userId: user.userId,
      clanId: user.clanId,
    }),
    updateVillageForUpdateClanLeaders(client, user),
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
        !user.isAi && getWarSide(w, userVillageId) === killerSideVillageId;
      // Insert war kill for tracking purposes
      // Use per-war shrine HP change for village wars/raids (includes level diff adjustment)
      // For sector wars, use the total accumulated shrineChangeHp value
      let logShrineHpChange = 0;
      if (VILLAGE_WAR_TYPES.includes(w.type)) {
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
          insertWarKillForUpdateWars(
            client,
            w,
            user,
            warResult,
            logShrineHpChange,
            result,
          ),
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
              await updateWarForUpdateWars(client, result, w);
            }
          }),
        );
      }

      // For village wars and raids, handle shrine HP + war health damage/heal atomically
      // This prevents race conditions where multiple concurrent battles could all detect the same threshold crossing
      // Skip if we've already scheduled an update for this war (prevents double-counting when multiple targets share a war)
      // Use the per-war shrine HP changes (separate for attacker and defender shrines)
      const shrineChanges = result.villageWarShrineInfo[w.id];
      if (
        hasShrineChange(shrineChanges) &&
        VILLAGE_WAR_TYPES.includes(w.type) &&
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
              const villageName = shrineVillageName(w, shrineType);

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
            await Promise.all([
              processShrine("attacker", shrineChanges.attacker),
              processShrine("defender", shrineChanges.defender),
            ]);
          })(),
        );
      }

      // Update war health if we're in a village war or raid
      // Skip if we've already scheduled an update for this war (prevents double-counting when multiple targets share a war)
      if (
        result.warHealthChange !== 0 &&
        VILLAGE_WAR_TYPES.includes(w.type) &&
        !processedWarHealthIds.has(w.id)
      ) {
        processedWarHealthIds.add(w.id);
        const side =
          killerSideVillageId === w.attackerVillageId ? "attacker" : "defender";
        otherPromises.push(
          updateWarHealthForUpdateWars(client, shrineColumnsBySide[side], result, w),
        );
      }
    });
  });

  // Handle SHRINE_WAR defend scenarios where user and AI share same villageId
  // In these cases, both teams have the same faction, so warResults is empty
  // but villageWarShrineInfo may still have data from `calcWarDamage`
  if (curBattle.battleType === "SHRINE_WAR") {
    const userWars = getBattleTeamWars(curBattle, user).map(({ war }) => war);
    for (const warId of Object.keys(result.villageWarShrineInfo)) {
      // Skip if already processed through warResults
      if (processedShrineWarIds.has(warId)) continue;

      const shrineChanges = result.villageWarShrineInfo[warId];
      if (!hasShrineChange(shrineChanges)) continue;

      // Find the war from user's wars
      const w = userWars.find((war) => war.id === warId);
      if (!w || w.rules || !VILLAGE_WAR_TYPES.includes(w.type)) continue;

      processedShrineWarIds.add(warId);

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

  // Prepare raid activations using pre-loaded data (no DB fetch)
  const preloadedRaids = curBattle.extraState.sectorExclusiveRaids ?? [];
  const sectorsToNotify: number[] = [];

  for (const sector of sectorsWithDefeatedShrine) {
    const activation = prepareExclusiveRaidActivation(preloadedRaids, sector);
    if (activation.activated) {
      sectorsToNotify.push(sector);
      // Add mutation promises to otherPromises
      for (const m of activation.mutations) {
        otherPromises.push(updateQuestForUpdateWars(client, m));
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

/** Whether a battle recorded any shrine change on this war. */
const hasShrineChange = (
  changes: CombatResult["villageWarShrineInfo"][string] | undefined,
): changes is CombatResult["villageWarShrineInfo"][string] =>
  !!changes && (changes.attacker !== 0 || changes.defender !== 0);

/** Display name of the village holding one side of a war. */
const shrineVillageName = (w: BattleWar, side: keyof typeof shrineColumnsBySide) =>
  side === "attacker"
    ? (w.attackerVillage?.name ?? "Attacker")
    : (w.defenderVillage?.name ?? "Defender");

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
  const recaptureResult = await updateWarForRecoverWarShrine(
    client,
    columns,
    recoveredHp,
    activeWar,
    status,
    hp,
    change,
    maxHp,
  );

  if (recaptureResult.rowsAffected > 0) {
    await updateWarForRecoverWarShrine2(client, columns, activeWar);
    const villageName = shrineVillageName(w, side);
    notifications.push(
      `${villageName}'s shrine recaptured! ${villageName} gained ${WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL} war HP!`,
    );
  } else {
    // Active shrines and recovery below the threshold still receive HP, without a reward.
    await updateWarForRecoverWarShrine3(client, columns, recoveredHp, activeWar);
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
    await updateTournamentMatchForUpdateTournament(client, result, user, target, {
      extraState: { tournamentGameId: curBattle.extraState.tournamentGameId },
      id: curBattle.id,
    });
    return;
  }
  // Guards
  if (!user) return;
  if (!target) return;
  if (!result) return;
  if (curBattle.battleType !== "TOURNAMENT") return;
  await updateTournamentMatchForUpdateTournament2(
    client,
    result,
    user,
    target,
    curBattle,
  );
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
      ? [incrementVillageTokens(client, result.villageTokens, user.villageId)]
      : []),
    ...(user.anbuId && result.pvpStreak > 0
      ? [updateAnbuSquadForUpdateVillageAnbuClan(client, { anbuId: user.anbuId })]
      : []),
    ...(user.anbuId && result.anbuPoints > 0
      ? [incrementAnbuPoints(client, result.anbuPoints, user.anbuId)]
      : []),
    ...(user.clanId && result.clanPoints > 0
      ? [updateClanForUpdateVillageAnbuClan(client, result, { clanId: user.clanId })]
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

  // Calculate total damage dealt to the boss this battle, capped by the damage the
  // attackers were actually credited with so that an HP loss not caused by them
  // (e.g. an AI give-up or forfeit) can never be counted as raid damage
  const hpLost = Math.max(0, raidInitialBossHp - Math.max(0, boss.curHealth));
  const attackerDamage = attackers.reduce((sum, u) => sum + (u.damageDealt ?? 0), 0);
  const totalDamage = Math.min(hpLost, attackerDamage);

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
      await insertRaidParticipationForUpdateRaidProgress(
        client,
        raidQuestId,
        userId,
        userDamage,
      );
      claimed = true;
    } catch (error) {
      if (!isMysqlDuplicateKeyError(error)) throw error;
    }
  } else {
    const updateResult = await updateRaidParticipationForUpdateRaidProgress(
      client,
      userDamage,
      raidQuestId,
      userId,
      startBattleCount,
    );
    claimed = updateResult.rowsAffected === 1;
  }

  if (!claimed) {
    return;
  }

  // Shared raid HP is not itself idempotent, so it runs only after the claim.
  // Parallelizing this with the claim would double-decrement on a duplicate call.
  await updateQuestForUpdateRaidProgress(client, userDamage, raidQuestId);

  // Read committed global HP. A successful claim already means this user is a
  // participant, so we do not scan RaidParticipation.
  const updatedQuest = await findQuestForUpdateRaidProgress(client, raidQuestId);

  const bossDefeated = (updatedQuest?.raidBossCurrentHealth ?? 0) <= 0;
  if (!bossDefeated) {
    return;
  }

  // Notify only after the post-decrement read, and only this acting user.
  // Doing this beside the HP write would announce a kill from a stale HP
  // snapshot, or insert a second inbox row if the claim gate were skipped.
  const raidName = updatedQuest?.name ?? "the raid";
  await Promise.all([
    insertNotificationForUpdateRaidProgress(client, userId, raidName),
    incrementNotificationCounters(client, [userId]),
  ]);
};

/**
 * Settlement writes of one action or poll tick, spread into the caller's single mutation
 * phase. Each is a no-op without a result; hunting and dungeon payouts settle in
 * updateBattle. Keeps updateUser first so callers can read its quest updates. Each player
 * settles once: calcBattleResult returns null after their leftBattle flag is saved.
 * @param battleOver - from the version claim, which already committed terminal event outcomes
 */
export const settlementWrites = (
  client: DrizzleClient,
  pusher: PusherClient,
  battle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
  battleOver: boolean,
): [ReturnType<typeof updateUser>, ...Promise<unknown>[]] => [
  updateUser(client, pusher, battle, result, userId),
  ...(!battle.extraState.dungeon && !battle.extraState.hunting
    ? [
        saveUsage(client, battle, result, userId),
        updateClanLeaders(client, battle, result, userId),
        updateKage(client, battle, result),
        updateVillageAnbuClan(client, battle, result, userId),
        updateWars(client, pusher, battle, result, userId),
        ...(battleOver && battle.extraState.tournamentGameId
          ? []
          : [updateTournament(client, battle, result, userId)]),
        ...(result ? [updateRaidProgress(client, battle, userId)] : []),
      ]
    : []),
];

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
    await updateUserDataForUpdateUser(
      client,
      settledAt,
      combatEnergyRecoverySql,
      curBattle,
      userId,
    );
    void updateUserOnMap(pusher, user.sector, {
      ...user,
      longitude: user.originalLongitude,
      latitude: user.originalLatitude,
    });
    return { updatedQuestIds };
  }
  if (result && user) {
    const isInWarTornSector = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
    const facedHuman = hasHumanOpponent(curBattle.usersState, user);
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
      facedHuman,
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
    const trackerTasks: CombatQuestTrackerTask[] = [];

    // Update quest tracker with battle result. pvp_kills is emitted on every COMBAT win; the
    // War-torn/Territory War (pvp quests) and active-war gating is applied per quest in getNewTrackers.
    const winTask = WIN_TRACKER_TASKS[curBattle.battleType];
    if (result.didWin > 0 && winTask)
      trackerTasks.push({ task: winTask, increment: 1 });

    // Shared opponent credit follows the battle team, excluding summons and allies.
    const trackerEvents = [
      ...curBattle.usersState
        .filter((u) => !u.isSummon && !areBattleAllies(u, user))
        .flatMap((u) => [
          // Defeat opponent with outcome; gated per quest type in getNewTrackers (pvp → war-torn/Territory War
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
      // Finishing the creator's last form counts as defeating the creator's own account.
      ...(curBattle.extraState.creatorTrial
        ? [
            {
              task: "defeat_opponents" as const,
              contentId: curBattle.extraState.creatorTrial.creatorId,
              text: result.outcome,
              warFoe: false,
            },
          ]
        : []),
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
    const isIsolated = !!getIsolatedPyramid(hydratedUser);
    if (isIsolated) result.curHealth = Math.max(1, result.curHealth);
    // Tracker processing mutates the preloaded objects, so retain contribution receipts first.
    const previousPartyContributions = new Map(
      hydratedUser.questData.map((tracker) => [
        tracker.id,
        JSON.stringify(tracker.party?.contributions),
      ]),
    );
    const { trackers, notifications, questIdsUpdated, consequences } = getNewTrackers(
      hydratedUser,
      trackerTasks,
      {
        battleId: curBattle.id,
        inWarTornSector: isInWarTornSector,
        inTerritoryWar:
          curBattle.battleType === "COMBAT" &&
          facedHuman &&
          curBattle.extraState.territoryWar !== undefined,
        isWarParticipant: isWarBattleParticipant,
        questBattleSource: curBattle.extraState.questBattleSource,
        questTeamStillFighting: curBattle.usersState.some(
          (teammate) =>
            teammate.controllerId !== user.controllerId &&
            !teammate.isAi &&
            !teammate.leftBattle &&
            !teammate.fledBattle &&
            stillInBattle(teammate) &&
            areBattleAllies(teammate, user),
        ),
      },
    );
    updatedQuestIds.push(...questIdsUpdated);
    // The battle omits unrelated achievement definitions, but owns their preloaded progress.
    const updatedQuestData = filterQuestTrackersForDbPersist(
      trackers,
      hydratedUser as NonNullable<UserWithRelations>,
      true,
    );
    // Add notifications to combatResult
    result.notifications.push(...notifications);

    // Apply durability penalty for dying in war-torn sector (reduce 50 durability from all equipped gear)
    // This must be done BEFORE durability warnings so warnings see the true final durability
    const deleteItems = user.items.filter((ui) => ui.quantity <= 0).map((i) => i.id);
    const updateItems = user.items.filter((ui) => ui.quantity > 0);
    if (isInWarTornSector && result.didWin === 0 && result.outcome === "Lost") {
      applyWarTornDurabilityPenalty(curBattle, updateItems);
    }
    result.notifications.push(...durabilityNotifications(curBattle, user));

    // A kage cannot also be an elder, so only the winning challenger loses ELDER
    const tookKageSeat = didUserTakeKageSeat(curBattle, userId);

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
    const jutsuXpGroups = groupJutsuXp(curBattle, user);
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
    // If new prestige goes below 0, set allyVillage to false
    if (user.villagePrestige + result.villagePrestige < 0) {
      user.allyVillage = false;
    }

    if (curBattle.battleType === "RANKED_PVP" && result.didWin) {
      result.seichiSilver += rankedSeichiBonus(user);
    }

    const baseline = curBattle.extraState.profileCacheSnapshots?.[userId];
    const capacity = curBattle.extraState.energyCapacity?.[userId];
    const regeneration = curBattle.extraState.energyRegeneration?.[userId];
    // Party contributions need synchronization, passive completions can award progression,
    // and completed team-enabled quests change reward navigation even after detachment.
    const hasUnprojectedQuestProgress = trackers.some(
      (tracker) =>
        (!!tracker.party &&
          previousPartyContributions.get(tracker.id) !==
            JSON.stringify(tracker.party.contributions)) ||
        (questIdsUpdated.includes(tracker.id) &&
          (!!tracker.party ||
            hydratedUser.userQuests.some(
              (entry) =>
                entry.questId === tracker.id &&
                (["tier", "daily", "achievement"].includes(entry.quest.questType) ||
                  (entry.quest.teamEnabled && isQuestComplete(entry.quest, tracker))),
            ))),
    );
    const canProjectProfileUpdate =
      !!baseline &&
      capacity !== undefined &&
      regeneration !== undefined &&
      canCacheCombatCompletion(curBattle, result, userId) &&
      consequences.length === 0 &&
      !hasUnprojectedQuestProgress &&
      iExp === 0 &&
      user.items.every((item) => !item.progressionRowId) &&
      result.droppedItems.length === 0;
    // Use one timestamp for persisted recovery and its compact completion response.
    const settledAt = new Date();
    let userSettlementCommitted = false;
    let itemSettlementCommitted = true;
    const rewardPetId = curBattle.extraState.petIdsByOwner?.[userId];
    const petExperience = Math.max(
      0,
      Math.round(result.experience) + Math.round(result.earnedExperience),
    );
    const confirmPetReward =
      !!rewardPetId && petExperience > 0 && canProjectProfileUpdate;
    let petRewardConfirmed = !rewardPetId || petExperience === 0;
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
        ? [() => updateBountyForUpdateUser(client, userId, result)]
        : []),
      // Delete items
      ...(deleteItems.length > 0
        ? [
            () =>
              deleteUserItemsWithPositiveQuantity(client, deleteItems).then((saved) => {
                if (saved.rowsAffected !== deleteItems.length)
                  itemSettlementCommitted = false;
              }),
            () => deleteUserItemImbuementForUpdateKage(client, deleteItems),
          ]
        : []),
      // Persist all surviving items in one request. The owner and quantity guards skip
      // transferred rows, merge claims and tombstones; settlement cannot resurrect them.
      ...(updateItems.length > 0
        ? [
            () =>
              updateUserItemForUpdateUser(
                client,
                updateItems,
                settlingHunt,
                userId,
              ).then((saved) => {
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
              executeRowsForUpdateUser(client, jExp, xpToLevel, user, cap, ids);
          })
        : []),
      // Item experience & level from PvP (equipped items only; per-item xpToLevel)
      ...(iExp > 0
        ? [...groupEquippedItemXp(curBattle, user).entries()].map(
            ([xpToLevel, ids]) =>
              () =>
                updateUserItemForUpdateUser2(
                  client,

                  xpToLevel,
                  iExp,
                  user,
                  ids,
                ),
          )
        : []),
      // Update user data
      async () => {
        const save = (confirmPet: boolean) =>
          updateUserDataForUpdateUser2(
            client,
            combatEnergyRecoverySql,
            curBattle,
            userId,
            result,
            settledAt,
            facedHuman,
            user,
            updatedQuestData,
            tookKageSeat,
            isIsolated,
            confirmPet,
          );
        let saved = await save(confirmPetReward);
        if (confirmPetReward) {
          petRewardConfirmed = saved.rowsAffected === 1;
          // Changed pet eligibility must not discard the player's battle rewards.
          // The fallback retains the battle-ID guard and runs in this mutation phase.
          if (!petRewardConfirmed) saved = await save(false);
        }
        userSettlementCommitted = saved.rowsAffected === 1;
      },
      // Handle dropped items transfer if present on result. Currently only AI have droppable items, so no need to delete from loser
      ...(result.droppedItems.length > 0
        ? [() => insertUserItemForUpdateUser(client, result, user)]
        : []),
    ];
    if (settlingHunt) {
      // The HTTP driver shares one transaction session; await each factory before starting the next.
      for (const write of settlementWrites) await write();
      if (!userSettlementCommitted || !itemSettlementCommitted)
        throw new Error("Hunting character or inventory changed during settlement");
    } else await Promise.all(settlementWrites.map((write) => write()));
    if (
      canProjectProfileUpdate &&
      userSettlementCommitted &&
      itemSettlementCommitted &&
      petRewardConfirmed
    ) {
      const publicUser = getPublicQuestUser({
        ...hydratedUser,
        // Only loaded definitions can project private targets; retain their display-only trackers.
        questData: trackers,
      } as NonNullable<UserWithRelations>);
      result.profileUpdate = buildCombatProfileUpdate({
        battle: curBattle,
        result,
        user,
        baseline,
        capacity,
        regeneration,
        settledAt,
        questData: publicUser.questData,
        removedQuestIds: hydratedUser.userQuests
          .filter((entry) => !trackers.some((tracker) => tracker.id === entry.questId))
          .map((entry) => entry.questId),
        rewardPetId,
        petExperience,
        isIsolated,
      });
    }
    // Update map status
    if (result.curHealth > 0 || SPARRING_BATTLE_TYPES.includes(curBattle.battleType)) {
      void updateUserOnMap(pusher, user.sector, {
        ...user,
        longitude: user.originalLongitude,
        latitude: user.originalLatitude,
      });
    }
  }
  return { updatedQuestIds };
};

/** The win counter each battle type advances. */
const WIN_TRACKER_TASKS: Partial<Record<BattleType, CombatQuestTrackerTask["task"]>> = {
  COMBAT: "pvp_kills",
  ARENA: "arena_kills",
  RANDOM_ENCOUNTER: "random_encounter_wins",
  SPARRING: "spars_won",
};

/** Charge the war-torn death penalty to equipped, durable non-consumables. */
const applyWarTornDurabilityPenalty = (
  battle: CompleteBattle,
  items: BattleUserState["items"],
) => {
  items.forEach((ui) => {
    const item = getItem(battle, ui.itemId);
    // Only reduce durability for equipped items (not "NONE") that are not consumables
    if (
      ui.equipped !== "NONE" &&
      item?.itemType !== "CONSUMABLE" &&
      item?.maxDurability &&
      item.maxDurability > 0
    ) {
      // Reduce durability by 50, ensuring it doesn't go below 0
      ui.durability = Math.max(0, ui.durability - 50);
    }
  });
};

/** Percent-based low durability warnings (<=50% and <=25%) and broken-item notices. */
const durabilityNotifications = (battle: CompleteBattle, user: BattleUserState) => {
  const notifications: string[] = [];
  const userInitialDurability = battle.extraState.initialDurability?.[user.userId];
  if (!userInitialDurability) return notifications;
  user.items.forEach((battleItem) => {
    const item = getItem(battle, battleItem.itemId);
    if (item?.maxDurability && item.maxDurability > 0) {
      const initial = userInitialDurability[battleItem.id];
      const final = battleItem.durability;
      const max = item.maxDurability;
      if (initial === undefined) return;
      const initialPct = Math.round((initial / max) * 100);
      const finalPct = Math.round((final / max) * 100);
      // Broken: now at 0
      if (initial > 0 && final <= 0) {
        notifications.push(
          `${item.name} ${ITEM_BROKEN_NOTICE} and cannot be used until repaired!`,
        );
      } else if (
        // Urgent warning: crossed down to <=25%
        initialPct > 25 &&
        finalPct <= 25 &&
        final > 0
      ) {
        notifications.push(
          `${item.name} ${ITEM_DURABILITY_CRITICAL_NOTICE} at ${finalPct}%! Repair it soon to prevent it from breaking!`,
        );
      } else if (
        // Regular warning: crossed down to <=50% (but still above 25%)
        initialPct > 50 &&
        finalPct <= 50 &&
        finalPct > 25 &&
        final > 0
      ) {
        notifications.push(
          `${item.name} ${ITEM_DURABILITY_NOTICE} ${finalPct}%. Consider repairing it soon!`,
        );
      }
    }
  });
  return notifications;
};

/** Group a user's used jutsu by progression cap from the preloaded definitions. */
const groupJutsuXp = (battle: CompleteBattle, user: BattleUserState) => {
  const jUsage = user.usedActions.filter((a) => a.type === "jutsu").map((a) => a.id);
  const groups = new Map<number, string[]>();
  for (const id of new Set(jUsage)) {
    const definition = getJutsu(battle, id);
    if (!definition) continue;
    const cap = getJutsuMaxLevel(definition);
    const ids = groups.get(cap) ?? [];
    ids.push(id);
    groups.set(cap, ids);
  }
  return groups;
};

/**
 * Group equipped items by their definition's xpToLevel for batched updates.
 * Forced-loadout entries are synthetic rows; XP is credited to the real
 * UserItem row they were seeded from (progressionRowId).
 */
const groupEquippedItemXp = (battle: CompleteBattle, user: BattleUserState) => {
  const groups = new Map<number, Set<string>>();
  for (const ui of user.items) {
    if (ui.equipped === "NONE" || ui.quantity <= 0) continue;
    const rowId = ui.progressionRowId ?? ui.id;
    const def = getItem(battle, ui.itemId);
    const xpToLevel = def?.xpToLevel ?? ITEM_XP_TO_LEVEL;
    const ids = groups.get(xpToLevel) ?? new Set<string>();
    ids.add(rowId);
    groups.set(xpToLevel, ids);
  }
  return groups;
};

/**
 * Seichi silver for ranked milestones: one per third consecutive win and one per third
 * total win, from the rankedStreak and rankedWins loaded at battle initiation.
 */
const rankedSeichiBonus = (user: BattleUserState) => {
  const newStreak = user.rankedStreak + 1;
  const newWins = user.rankedWins + 1;
  return (
    (newStreak > 0 && newStreak % 3 === 0 ? 1 : 0) +
    (newWins > 0 && newWins % 3 === 0 ? 1 : 0)
  );
};

/**
 * Build Energy recovery from the persisted balance/clock so repeated releases cannot replay it.
 * Fractional ticks preserve Energy across short fights while other pools stay frozen.
 */
export const combatEnergyRecoverySql = (
  snapshot?: CompleteBattle,
  userId?: string,
  reward = 0,
  settledAt?: Date,
) => {
  const regeneration =
    (userId ? snapshot?.extraState.energyRegeneration?.[userId] : undefined) ??
    userData.regeneration;
  // Without a captured capacity for this user (no snapshot, e.g. the cleaner's orphan
  // release or an expired dungeon whose battle is gone), cap at the larger of
  // maxEnergy and the stored balance so Energy is never erased.
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
