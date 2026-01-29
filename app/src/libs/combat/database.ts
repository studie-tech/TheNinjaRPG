import { nanoid } from "nanoid";
import { eq, and, or, sql, lt, gte, inArray, isNull } from "drizzle-orm";
import {
  HOSPITAL_LONG,
  HOSPITAL_LAT,
  STEALTH_POST_COMBAT_COOLDOWN_SECONDS,
} from "@/drizzle/constants";
import {
  battle,
  battleAction,
  logBattleLengths,
  notification,
  tournamentMatch,
  userData,
  userItem,
  userItemImbuement,
  userJutsu,
  mpvpBattleQueue,
  mpvpBattleUser,
  warKill,
  bounty,
  war,
  quest,
  raidParticipation,
} from "@/drizzle/schema";
import { kageDefendedChallenges, village, clan, anbuSquad } from "@/drizzle/schema";
import { dataBattleAction } from "@/drizzle/schema";
import { getNewTrackers } from "@/libs/quest";
import { battleJutsuExp } from "@/libs/train";
import { updateUserOnMap, broadcastRaidAvailability } from "@/libs/pusher";
import { prepareExclusiveRaidActivation } from "@/libs/raids";
import { JUTSU_XP_TO_LEVEL } from "@/drizzle/constants";
import { JUTSU_TRAIN_LEVEL_CAP } from "@/drizzle/constants";
import {
  VILLAGE_SYNDICATE_ID,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  WAR_SHRINE_CAPTURE_WARHEALTH_DMG,
  WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL,
  WAR_RECAPTURE_THRESHOLD,
} from "@/drizzle/constants";
import { findWarsWithUser } from "@/libs/war";
import {
  getWarsArray,
  getItem,
  getVillage,
  getUserQuestsFromBattle,
  hydrateUserForQuests,
} from "@/libs/combat/util";
import type { PusherClient } from "@/libs/pusher";
import type { BattleTypes, BattleDataEntryType } from "@/drizzle/constants";
import type { DrizzleClient } from "@/server/db";
import type { Battle } from "@/drizzle/schema";
import type { CombatResult } from "@/libs/combat/types";
import type { ActionEffect } from "@/libs/combat/types";
import type { CompleteBattle } from "@/libs/combat/types";

type DataBattleAction = {
  type: (typeof BattleDataEntryType)[number];
  contentId: string;
  battleType: (typeof BattleTypes)[number];
  battleWon: number;
  relatedBloodlineId?: string;
};

/**
 * Update the battle state with raw queries for speed
 */
export const updateBattle = async (
  client: DrizzleClient,
  result: CombatResult | null,
  userId: string,
  newBattle: CompleteBattle,
  fetchedVersion: number,
) => {
  // Calculations
  const battleOver = result && result.friendsLeft + result.targetsLeft === 0;

  // Get user and other user
  const user = newBattle.usersState.find((u) => u.userId === userId && !u.isSummon);
  const other = newBattle.usersState.find((u) => u.userId !== userId && !u.isSummon);

  // If user won and it's a clan battle, update the clan battle queue
  if (result?.didWin && newBattle.battleType === "CLAN_BATTLE") {
    if (user && other) {
      await client
        .update(mpvpBattleQueue)
        .set({ winnerId: result?.didWin ? user.clanId : other.clanId })
        .where(eq(mpvpBattleQueue.battleId, newBattle.id));
    }
  }

  // Update the battle, return undefined if the battle was updated by another process
  if (battleOver) {
    await Promise.all([
      client.delete(battle).where(eq(battle.id, newBattle.id)),
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
      // Clean up raid battle users - can run in parallel since it only reads from mpvpBattleQueue
      ...(newBattle.battleType === "RAID"
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
    ]);

    // Delete raid queue entries AFTER the Promise.all to ensure mpvpBattleUser
    // subquery has completed (it references mpvpBattleQueue)
    if (newBattle.battleType === "RAID") {
      await client
        .delete(mpvpBattleQueue)
        .where(eq(mpvpBattleQueue.battleId, newBattle.id));
    }
  } else {
    const result = await client
      .update(battle)
      .set({
        version: newBattle.version,
        createdAt: newBattle.createdAt,
        updatedAt: newBattle.updatedAt,
        usersState: newBattle.usersState,
        usersEffects: newBattle.usersEffects,
        groundEffects: newBattle.groundEffects,
        activeUserId: newBattle.activeUserId,
        roundStartAt: newBattle.roundStartAt,
        round: newBattle.round,
      })
      .where(and(eq(battle.id, newBattle.id), eq(battle.version, fetchedVersion)));
    if (result.rowsAffected === 0) {
      throw new Error(`Failure. Version: ${fetchedVersion}, Battle: ${newBattle.id}`);
    }
  }
};

/**
 * Insert battle actions for usage analytics
 */
export const saveUsage = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
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
      oppositeOutcome === "Won" ? 1 : oppositeOutcome === "Lost" ? 2 : 0;
    // Basic actions from this user
    const data: DataBattleAction[] = [];
    user.usedActions?.map((action) => {
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
      .map((ai) => {
        data.push({
          type: "ai",
          contentId: ai.controllerId,
          battleType,
          battleWon: ai.controllerId === userId ? battleWon : oppositeBattleWon,
        });
      });
    // Reduce data to only have unique type-contentId pairs
    const uniqueData = data.reduce((a, c) => {
      if (!a.find((d) => d.type === c.type && d.contentId === c.contentId)) {
        return a.concat([c]);
      } else {
        return a;
      }
    }, [] as DataBattleAction[]);
    // Upsert dataBattleActions
    if (uniqueData.length > 0) {
      await client
        .insert(dataBattleAction)
        .values(uniqueData)
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
 * Insert directly into the data model for speed (i.e. no SELECT subsequently)
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
  await client
    .insert(battleAction)
    .values(actions)
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  return actions;
};

export const updateKage = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
) => {
  // Only care about Kage battles
  if (!["KAGE_AI", "KAGE_PVP"].includes(curBattle.battleType)) return;
  if (!result) return;

  // In Kage challenges, the challenger is always the aggressor
  const challenger = curBattle.usersState.find((u) => u.isAggressor && !u.isSummon);
  const kage = curBattle.usersState.find((u) => !u.isAggressor && !u.isSummon);

  // Guards
  if (!challenger || !kage) return;
  if (!challenger.villageId || !kage.villageId) return;
  if (challenger.villageId !== kage.villageId) return;

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
    // Move the hat only if the challenger actually wins
    ...(result.didWin > 0
      ? [
          client
            .update(village)
            .set({ kageId: challenger.userId, leaderUpdatedAt: new Date() })
            .where(eq(village.id, challenger.villageId)),
        ]
      : []),

    ...(deleteItems.length > 0
      ? [
          client.delete(userItem).where(inArray(userItem.id, deleteItems)),
          client
            .delete(userItemImbuement)
            .where(inArray(userItemImbuement.userItemId, deleteItems)),
        ]
      : []),

    ...(updateItems.length > 0
      ? updateItems.map((ui) =>
          client
            .update(userItem)
            .set({ quantity: ui.quantity })
            .where(eq(userItem.id, ui.id)),
        )
      : []),

    client.insert(kageDefendedChallenges).values({
      id: nanoid(),
      villageId: challenger.villageId,
      userId: challenger.userId,
      kageId: kage.userId,
      didWin: result.didWin,
      rounds: curBattle.round,
    }),
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
  if (!user || !user.clanId || !leader || !leader.clanId) return;
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
          or(eq(village.type, "HIDEOUT"), eq(village.type, "TOWN")),
        ),
      ),
  ]);
};

export const updateWars = async (
  client: DrizzleClient,
  pusher: PusherClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  // Fetch user
  const user = curBattle.usersState.find((u) => u.userId === userId && !u.isSummon);
  const userVillageId = user?.villageId;
  // Guard
  if (!user) return;
  if (!user.villageId) return;
  if (!result) return;
  // Skip war updates if kill happened in war-torn sector
  if (user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR) return;
  // Get user's wars from static data
  const userWars = getWarsArray(curBattle, user);

  // Fetch target with whom the user is in a war
  const warResults = curBattle.usersState
    .filter((t) => t.userId !== userId)
    .filter((t) => !t.isSummon)
    .map((target) => {
      const targetWars = getWarsArray(curBattle, target);
      return {
        target,
        wars: findWarsWithUser(targetWars, userWars, target.villageId, userVillageId),
      };
    })
    .filter((wr) => wr.wars.length > 0);

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
    warResult.wars.forEach((w) => {
      const killerSideVillageId =
        w.attackerVillageId === user.villageId ||
        w.warAllies.some(
          (a) =>
            a.villageId === user.villageId &&
            a.supportVillageId === w.attackerVillageId,
        )
          ? w.attackerVillageId
          : w.defenderVillageId;

      // Insert war kill for tracking purposes
      // Use per-war shrine HP change for village wars/raids (includes level diff adjustment)
      // For sector wars, use the total accumulated shrineChangeHp value
      let logShrineHpChange = 0;
      if (["VILLAGE_WAR", "WAR_RAID"].includes(w.type)) {
        // Use the already-computed villageWarShrineInfo which includes:
        // 1. The correct shrine change constants
        // 2. Scaling by rewardScaling
        // 3. Level difference adjustment (reduced to ±1 when STREAK_LEVEL_DIFF exceeded)
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

        otherPromises.push(
          client
            .update(war)
            .set({
              defenderShrineHp: sql`GREATEST(LEAST(defenderShrineHp + ${result.shrineChangeHp}, defenderShrineMaxHp), 0)`,
            })
            .where(and(eq(war.id, w.id), isNull(war.endedAt))),
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

              const hpCol =
                shrineType === "attacker" ? "attackerShrineHp" : "defenderShrineHp";
              const maxHpCol =
                shrineType === "attacker"
                  ? "attackerShrineMaxHp"
                  : "defenderShrineMaxHp";
              const statusCol =
                shrineType === "attacker"
                  ? "attackerShrineStatus"
                  : "defenderShrineStatus";
              const warHealthCol =
                shrineType === "attacker" ? "attackerWarHealth" : "defenderWarHealth";
              const warHealthMaxCol =
                shrineType === "attacker"
                  ? "attackerWarHealthMax"
                  : "defenderWarHealthMax";
              const villageName =
                shrineType === "attacker"
                  ? (w.attackerVillage?.name ?? "Attacker")
                  : (w.defenderVillage?.name ?? "Defender");

              if (change < 0) {
                // Attacking: reduce shrine HP, apply war health damage if crossing to 0 and status changes
                // First, try to update only if status is ACTIVE and HP will cross to 0
                const captureResult = await client
                  .update(war)
                  .set({
                    [hpCol]: sql`GREATEST(${sql.raw(hpCol)} + ${change}, 0)`,
                    [statusCol]: "CAPTURED",
                  })
                  .where(
                    and(
                      eq(war.id, w.id),
                      isNull(war.endedAt),
                      sql`${sql.raw(statusCol)} = 'ACTIVE'`,
                      sql`${sql.raw(hpCol)} + ${change} <= 0`,
                    ),
                  );

                if (captureResult.rowsAffected > 0) {
                  // This battle caused the shrine to be captured (ACTIVE -> CAPTURED)
                  // Apply damage to the shrine owner's war health
                  await client
                    .update(war)
                    .set({
                      [warHealthCol]: sql`GREATEST(${sql.raw(warHealthCol)} - ${WAR_SHRINE_CAPTURE_WARHEALTH_DMG}, 0)`,
                    })
                    .where(and(eq(war.id, w.id), isNull(war.endedAt)));
                  result.notifications.push(
                    `${villageName}'s shrine captured! ${villageName} lost ${WAR_SHRINE_CAPTURE_WARHEALTH_DMG} war HP!`,
                  );
                } else {
                  // Didn't capture - either already CAPTURED or didn't cross threshold
                  // Still update shrine HP
                  await client
                    .update(war)
                    .set({
                      [hpCol]: sql`GREATEST(${sql.raw(hpCol)} + ${change}, 0)`,
                    })
                    .where(and(eq(war.id, w.id), isNull(war.endedAt)));
                }
              } else {
                // Defending/Recovering: increase shrine HP, apply war health heal if crossing recapture threshold
                // First, try to update only if status is CAPTURED and HP will cross above 25%
                const recaptureResult = await client
                  .update(war)
                  .set({
                    [hpCol]: sql`LEAST(${sql.raw(hpCol)} + ${change}, ${sql.raw(maxHpCol)})`,
                    [statusCol]: "ACTIVE",
                  })
                  .where(
                    and(
                      eq(war.id, w.id),
                      isNull(war.endedAt),
                      sql`${sql.raw(statusCol)} = 'CAPTURED'`,
                      sql`${sql.raw(hpCol)} + ${change} > ${sql.raw(maxHpCol)} * ${WAR_RECAPTURE_THRESHOLD}`,
                    ),
                  );

                if (recaptureResult.rowsAffected > 0) {
                  // This battle caused the shrine to be recaptured (CAPTURED -> ACTIVE)
                  // Apply heal to the shrine owner's war health
                  await client
                    .update(war)
                    .set({
                      [warHealthCol]: sql`LEAST(${sql.raw(warHealthCol)} + ${WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL}, ${sql.raw(warHealthMaxCol)})`,
                    })
                    .where(and(eq(war.id, w.id), isNull(war.endedAt)));
                  result.notifications.push(
                    `${villageName}'s shrine recaptured! ${villageName} gained ${WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL} war HP!`,
                  );
                } else {
                  // Didn't recapture - either already ACTIVE or didn't cross threshold
                  // Still update shrine HP
                  await client
                    .update(war)
                    .set({
                      [hpCol]: sql`LEAST(${sql.raw(hpCol)} + ${change}, ${sql.raw(maxHpCol)})`,
                    })
                    .where(and(eq(war.id, w.id), isNull(war.endedAt)));
                }
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
              .where(and(eq(war.id, w.id), isNull(war.endedAt))),
          );
        } else {
          otherPromises.push(
            client
              .update(war)
              .set({
                defenderWarHealth: sql`GREATEST(LEAST(defenderWarHealth + ${result.warHealthChange}, defenderWarHealthMax), 0)`,
              })
              .where(and(eq(war.id, w.id), isNull(war.endedAt))),
          );
        }
      }
    });
  });

  // Handle SHRINE_WAR defend scenarios where user and AI share same villageId
  // In these cases, findWarsWithUser returns no results, so warResults is empty
  // but villageWarShrineInfo may still have data from the defend scenario handler in util.ts
  if (curBattle.battleType === "SHRINE_WAR") {
    const userWars = getWarsArray(curBattle, user);
    for (const warId of Object.keys(result.villageWarShrineInfo)) {
      // Skip if already processed through warResults
      if (processedShrineWarIds.has(warId)) continue;

      const shrineChanges = result.villageWarShrineInfo[warId];
      const hasAttackerChange = shrineChanges?.attacker !== 0;
      const hasDefenderChange = shrineChanges?.defender !== 0;

      if (!hasAttackerChange && !hasDefenderChange) continue;

      // Find the war from user's wars
      const w = userWars.find((war) => war.id === warId);
      if (!w || !["VILLAGE_WAR", "WAR_RAID"].includes(w.type)) continue;

      processedShrineWarIds.add(warId);

      // Process shrine updates for this war
      shrineUpdatePromises.push(
        (async () => {
          const processShrine = async (
            shrineType: "attacker" | "defender",
            change: number,
          ) => {
            if (change === 0) return;

            const hpCol =
              shrineType === "attacker" ? "attackerShrineHp" : "defenderShrineHp";
            const maxHpCol =
              shrineType === "attacker" ? "attackerShrineMaxHp" : "defenderShrineMaxHp";
            const statusCol =
              shrineType === "attacker"
                ? "attackerShrineStatus"
                : "defenderShrineStatus";
            const warHealthCol =
              shrineType === "attacker" ? "attackerWarHealth" : "defenderWarHealth";
            const warHealthMaxCol =
              shrineType === "attacker"
                ? "attackerWarHealthMax"
                : "defenderWarHealthMax";
            const villageName =
              shrineType === "attacker"
                ? (w.attackerVillage?.name ?? "Attacker")
                : (w.defenderVillage?.name ?? "Defender");

            if (change > 0) {
              // Defending/Recovering: increase shrine HP, apply war health heal if crossing recapture threshold
              const recaptureResult = await client
                .update(war)
                .set({
                  [hpCol]: sql`LEAST(${sql.raw(hpCol)} + ${change}, ${sql.raw(maxHpCol)})`,
                  [statusCol]: "ACTIVE",
                })
                .where(
                  and(
                    eq(war.id, w.id),
                    isNull(war.endedAt),
                    sql`${sql.raw(statusCol)} = 'CAPTURED'`,
                    sql`${sql.raw(hpCol)} + ${change} > ${sql.raw(maxHpCol)} * ${WAR_RECAPTURE_THRESHOLD}`,
                  ),
                );

              if (recaptureResult.rowsAffected > 0) {
                // This battle caused the shrine to be recaptured (CAPTURED -> ACTIVE)
                await client
                  .update(war)
                  .set({
                    [warHealthCol]: sql`LEAST(${sql.raw(warHealthCol)} + ${WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL}, ${sql.raw(warHealthMaxCol)})`,
                  })
                  .where(and(eq(war.id, w.id), isNull(war.endedAt)));
                result.notifications.push(
                  `${villageName}'s shrine recaptured! ${villageName} gained ${WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL} war HP!`,
                );
              } else {
                // Didn't recapture - still update shrine HP
                await client
                  .update(war)
                  .set({
                    [hpCol]: sql`LEAST(${sql.raw(hpCol)} + ${change}, ${sql.raw(maxHpCol)})`,
                  })
                  .where(and(eq(war.id, w.id), isNull(war.endedAt)));
              }
            }
          };

          if (shrineChanges) {
            await Promise.all([
              processShrine("attacker", shrineChanges.attacker),
              processShrine("defender", shrineChanges.defender),
            ]);
          }
        })(),
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
  await Promise.all([...otherPromises, ...shrineUpdatePromises]);

  // Broadcast pusher notifications after mutations complete
  for (const sector of sectorsToNotify) {
    await broadcastRaidAvailability(pusher, sector);
  }
};

export const updateTournament = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  // Fetch
  const user = curBattle.usersState.find((u) => u.userId === userId && !u.isSummon);
  const target = curBattle.usersState.find((u) => u.userId !== userId && !u.isSummon);
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

export const updateVillageAnbuClan = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  // Fetch
  const user = curBattle.usersState.find((u) => u.userId === userId);
  // Guards
  if (!user || !user.villageId) return;
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
 * 2. battleCount is used as an optimistic lock - the upsert only succeeds if
 *    battleCount matches the value stored at battle start
 * 3. rowsAffected === 0 indicates a duplicate call - skip HP deduction
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

  // Step 1: Try to upsert participation record with battleCount guard
  // The IF conditions ensure the update only happens if battleCount matches startBattleCount
  // If battleCount has changed (another call already processed), values stay the same
  const upsertResult = await client
    .insert(raidParticipation)
    .values({
      id: nanoid(),
      questId: raidQuestId,
      userId: userId,
      damageDealt: userDamage,
      battleCount: 1,
      rewardsClaimed: [],
    })
    .onDuplicateKeyUpdate({
      set: {
        damageDealt: sql`IF(${raidParticipation.battleCount} = ${startBattleCount}, ${raidParticipation.damageDealt} + ${userDamage}, ${raidParticipation.damageDealt})`,
        battleCount: sql`IF(${raidParticipation.battleCount} = ${startBattleCount}, ${raidParticipation.battleCount} + 1, ${raidParticipation.battleCount})`,
        updatedAt: sql`IF(${raidParticipation.battleCount} = ${startBattleCount}, NOW(), ${raidParticipation.updatedAt})`,
      },
    });

  // Step 2: Check rowsAffected to see if the upsert actually changed data
  // rowsAffected = 1 (new insert) or 2 (update with changes) → proceed
  // rowsAffected = 0 (no changes because battleCount didn't match) → skip
  if (upsertResult.rowsAffected === 0) {
    return;
  }

  // Step 3: Deduct this user's share of damage from boss HP
  await client
    .update(quest)
    .set({
      raidBossCurrentHealth: sql`GREATEST(0, ${quest.raidBossCurrentHealth} - ${userDamage})`,
    })
    .where(and(eq(quest.id, raidQuestId), eq(quest.questType, "raid")));

  // Step 4: Fetch updated quest and participants in PARALLEL
  const [updatedQuest, participants] = await Promise.all([
    client.query.quest.findFirst({
      where: eq(quest.id, raidQuestId),
      columns: { raidBossCurrentHealth: true, name: true },
    }),
    client.query.raidParticipation.findMany({
      where: eq(raidParticipation.questId, raidQuestId),
      columns: { userId: true },
    }),
  ]);

  const bossDefeated = (updatedQuest?.raidBossCurrentHealth ?? 0) <= 0;
  if (!bossDefeated || participants.length === 0) {
    return;
  }

  // Step 5: Send notifications in PARALLEL
  const raidName = updatedQuest?.name ?? "the raid";

  // Only update the user this is being called for
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
 * Update the user with battle result using raw queries for speed
 */
export const updateUser = async (
  client: DrizzleClient,
  pusher: PusherClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  const updatedQuestIds: string[] = [];
  const user = curBattle.usersState.find((u) => u.userId === userId);
  if (result && user) {
    // Check if user has active PvP quests with pvp_kills or defeat_opponents objectives
    // Get user quests from extraState (static data that doesn't change during battle)
    const activeQuests = getUserQuestsFromBattle(curBattle, user.controllerId);
    const activePvpQuests = activeQuests.filter((q) => q.questType === "pvp");
    const hasPvpKillsInPvpQuest = activePvpQuests.some((uq) =>
      uq.quest.content.objectives.some((obj) => obj.task === "pvp_kills"),
    );
    const hasDefeatOpponentsInPvpQuest = activePvpQuests.some((uq) =>
      uq.quest.content.objectives.some((obj) => obj.task === "defeat_opponents"),
    );
    // Check if user has non-PvP quests with these objectives (should increment normally)
    const hasPvpKillsInNonPvpQuest = activeQuests
      .filter((q) => q.questType !== "pvp")
      .some((uq) =>
        uq.quest.content.objectives.some((obj) => obj.task === "pvp_kills"),
      );
    const hasDefeatOpponentsInNonPvpQuest = activeQuests
      .filter((q) => q.questType !== "pvp")
      .some((uq) =>
        uq.quest.content.objectives.some((obj) => obj.task === "defeat_opponents"),
      );
    const isInWarTornSector = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
    // Only increment pvp_kills if:
    // - User has non-PvP quest with that objective (increment normally), OR
    // - User has PvP quest with that objective AND is in war-torn sector
    const shouldIncrementPvpKills =
      hasPvpKillsInNonPvpQuest || (hasPvpKillsInPvpQuest && isInWarTornSector);
    // Only increment defeat_opponents if:
    // - User has non-PvP quest with that objective (increment normally), OR
    // - User has PvP quest with that objective AND is in war-torn sector
    const shouldIncrementDefeatOpponents =
      hasDefeatOpponentsInNonPvpQuest ||
      (hasDefeatOpponentsInPvpQuest && isInWarTornSector);

    // Accumulate all tracker tasks into a single array for one getNewTrackers call
    const trackerTasks: Parameters<typeof getNewTrackers>[1] = [];

    // Update quest tracker with battle result
    if (result.didWin > 0) {
      if (curBattle.battleType === "COMBAT" && shouldIncrementPvpKills) {
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

    // Add other tracker events
    const trackerEvents = [
      ...curBattle.usersState
        .filter((u) => u.userId !== userId)
        .map((u) => [
          // Defeat opponent with outcome - only if conditions are met
          ...(shouldIncrementDefeatOpponents
            ? [
                {
                  task: "defeat_opponents" as const,
                  contentId: u.controllerId,
                  text: result.outcome,
                },
              ]
            : []),
          // Start battle with outcome
          {
            task: "start_battle" as const,
            contentId: u.controllerId,
            text: result.outcome,
          },
        ])
        .flat(),
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

    // Single call to getNewTrackers with all tasks
    const hydratedUser = hydrateUserForQuests(curBattle, user);
    const { trackers, notifications, questIdsUpdated } = getNewTrackers(
      hydratedUser,
      trackerTasks,
    );
    updatedQuestIds.push(...questIdsUpdated);
    const updatedQuestData = trackers;
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
    if (initialDurability && initialDurability[userId]) {
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

    // Is it a kage challenge
    const isKageChallenge = ["KAGE_AI", "KAGE_PVP"].includes(curBattle.battleType);

    // Any jutsus to be updated
    const jUsage = user.usedActions.filter((a) => a.type === "jutsu").map((a) => a.id);
    const jUnique = [...new Set(jUsage)];
    const jExp = battleJutsuExp(
      curBattle.battleType,
      result.eloDiff,
      curBattle.extraState.settings,
    );
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

    // Update user & user items
    await Promise.all([
      // Update bounties
      ...(result.bountiesClaimed.length > 0
        ? [
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
            client.delete(userItem).where(inArray(userItem.id, deleteItems)),
            client
              .delete(userItemImbuement)
              .where(inArray(userItemImbuement.userItemId, deleteItems)),
          ]
        : []),
      // Update items quantity
      ...(updateItems.length > 0
        ? updateItems.map((ui) =>
            client
              .update(userItem)
              .set({ quantity: ui.quantity, durability: ui.durability })
              .where(eq(userItem.id, ui.id)),
          )
        : []),
      // Jutsu experience & level from experience
      ...(jUnique.length > 0 && jExp > 0
        ? [
            client
              .update(userJutsu)
              .set({ experience: sql`${userJutsu.experience} + ${jExp}` })
              .where(
                and(
                  eq(userJutsu.userId, user.userId),
                  lt(userJutsu.experience, JUTSU_XP_TO_LEVEL - jExp),
                  lt(userJutsu.level, JUTSU_TRAIN_LEVEL_CAP),
                  inArray(userJutsu.jutsuId, jUnique),
                ),
              ),
            client
              .update(userJutsu)
              .set({ level: sql`${userJutsu.level} + 1`, experience: 0 })
              .where(
                and(
                  eq(userJutsu.userId, user.userId),
                  lt(userJutsu.level, JUTSU_TRAIN_LEVEL_CAP),
                  gte(userJutsu.experience, JUTSU_XP_TO_LEVEL - jExp),
                  inArray(userJutsu.jutsuId, jUnique),
                ),
              ),
          ]
        : []),
      // Update user data
      client
        .update(userData)
        .set({
          experience: sql`experience + ${result.experience}`,
          earnedExperience: sql`earnedExperience + ${result.earnedExperience}`,
          pvpStreak: result.pvpStreak,
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
          ninjutsuOffence: sql`ninjutsuOffence + ${result.ninjutsuOffence}`,
          genjutsuOffence: sql`genjutsuOffence + ${result.genjutsuOffence}`,
          taijutsuOffence: sql`taijutsuOffence + ${result.taijutsuOffence}`,
          bukijutsuOffence: sql`bukijutsuOffence + ${result.bukijutsuOffence}`,
          ninjutsuDefence: sql`ninjutsuDefence + ${result.ninjutsuDefence}`,
          genjutsuDefence: sql`genjutsuDefence + ${result.genjutsuDefence}`,
          taijutsuDefence: sql`taijutsuDefence + ${result.taijutsuDefence}`,
          bukijutsuDefence: sql`bukijutsuDefence + ${result.bukijutsuDefence}`,
          villagePrestige: sql`villagePrestige + ${result.villagePrestige}`,
          dailyArenaFights: sql`dailyArenaFights + ${
            curBattle.battleType === "ARENA" ? 1 : 0
          }`,
          questData: updatedQuestData,
          battleId: null,
          regenAt: new Date(),
          ...(curBattle.battleType === "RANKED_PVP"
            ? {
                rankedLp: sql`GREATEST(rankedLp + ${result.lpDiff}, 0)`,
                rankedStreak: result.didWin ? sql`${userData.rankedStreak} + 1` : 0,
                rankedWins: sql`rankedWins + ${result.didWin ? 1 : 0}`,
                rankedBattles: sql`rankedBattles + 1`,
              }
            : {}),
          ...(isKageChallenge
            ? {
                rank: sql`CASE WHEN ${userData.rank} = 'ELDER' THEN 'JONIN' ELSE ${userData.rank} END`,
              }
            : {}),
          ...(!curBattle.forceKeepPools &&
          result.curHealth <= 0 &&
          !["SPARRING", "RANKED_PVP", "RANKED_SPARRING"].includes(curBattle.battleType)
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
            : { status: "AWAKE" }),
          // Deactivate stealth and set cooldown after leaving combat (20 seconds)
          stealthActive: false,
          stealthActivatedAt: null,
          stealthCooldownAt: sql`NOW() + INTERVAL ${STEALTH_POST_COMBAT_COOLDOWN_SECONDS} SECOND`,
        })
        .where(eq(userData.userId, userId)),
      // Handle dropped items transfer if present on result. Currently only AI have droppable items, so no need to delete from loser
      ...(result.droppedItems.length > 0
        ? [
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
    ]);
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
