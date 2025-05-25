import { nanoid } from "nanoid";
import { eq, and, or, sql, lt, gte, inArray } from "drizzle-orm";
import { HOSPITAL_LONG, HOSPITAL_LAT } from "@/libs/travel/constants";
import {
  battle,
  battleAction,
  tournamentMatch,
  userData,
  userItem,
  userJutsu,
  mpvpBattleQueue,
  villageStructure,
  warKill,
  war,
} from "@/drizzle/schema";
import { kageDefendedChallenges, village, clan, anbuSquad } from "@/drizzle/schema";
import { dataBattleAction } from "@/drizzle/schema";
import { getNewTrackers } from "@/libs/quest";
import { battleJutsuExp } from "@/libs/train";
import { updateUserOnMap } from "@/libs/pusher";
import { JUTSU_XP_TO_LEVEL } from "@/drizzle/constants";
import { JUTSU_TRAIN_LEVEL_CAP } from "@/drizzle/constants";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { KAGE_PRESTIGE_REQUIREMENT } from "@/drizzle/constants";
import { calculateLPChange } from "./ranked";
import { WAR_SHRINE_HP } from "@/drizzle/constants";
import { findWarsWithUser } from "@/libs/war";
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

  // If user won and it's a clan battle, update the clan battle queue
  if (result?.didWin && newBattle.battleType === "CLAN_BATTLE") {
    const user = newBattle.usersState.find((u) => u.userId === userId);
    const other = newBattle.usersState.find((u) => u.userId !== userId);
    if (user && other) {
      await client
        .update(mpvpBattleQueue)
        .set({ winnerId: result?.didWin ? user.clanId : other.clanId })
        .where(eq(mpvpBattleQueue.battleId, newBattle.id));
    }
  }

  // Update the battle, return undefined if the battle was updated by another process
  if (battleOver) {
    await client.delete(battle).where(eq(battle.id, newBattle.id));
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
    // Get state, lost: 0, won: 1, flee: 2
    const outcome = result.outcome;
    const battleWon = outcome === "Won" ? 1 : outcome === "Fled" ? 2 : 0;
    // Basic actions from this user
    const data: DataBattleAction[] = [];
    user.usedActions?.map((action) => {
      data.push({ type: action.type, contentId: action.id, battleType, battleWon });
    });
    // Bloodline actions from this user
    if (user.bloodline) {
      const bid = user.bloodline.id;
      data.push({ type: "bloodline", contentId: bid, battleType, battleWon });
    }
    // If battle is over, check for any AIs in the battle, and add these as well to the statistics
    curBattle.usersState
      .filter((u) => u.isAi && u.userId === u.controllerId)
      .map((ai) => {
        data.push({ type: "ai", contentId: ai.userId, battleType, battleWon });
      });
    // Reduce data to only have unique type-contentId pairs
    const uniqueData = data.reduce((a, c) => {
      if (!a.find((d) => d.type === c.type && d.contentId === c.contentId)) {
        return a.concat([c]);
      } else {
        return a;
      }
    }, [] as DataBattleAction[]);
    if (uniqueData.length > 0) {
      await client.insert(dataBattleAction).values(uniqueData);
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
  }[],
) => {
  if (history.length > 0) {
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
          description: entry.description,
          appliedEffects: entry.appliedEffects,
        };
      });
    await client
      .insert(battleAction)
      .values(actions)
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
    return actions;
  }
};

export const updateKage = async (
  client: DrizzleClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  // Fetch
  const user = curBattle.usersState.find((u) => u.userId === userId && !u.isSummon);
  const kage = curBattle.usersState.find((u) => u.userId !== userId && !u.isSummon);
  // Guards
  if (!["KAGE_AI", "KAGE_PVP"].includes(curBattle.battleType)) return;
  if (!user || !user.villageId || !kage || !kage.villageId) return;
  if (user.villageId !== kage.villageId) return;
  // Lost items for the kage
  const deleteItems = [
    ...kage.items.filter((ui) => ui.quantity <= 0).map((i) => i.id),
    ...user.items.filter((ui) => ui.quantity <= 0).map((i) => i.id),
  ];
  const updateItems = [
    ...kage.items.filter((ui) => ui.quantity > 0),
    ...user.items.filter((ui) => ui.quantity > 0),
  ];
  // Apply
  if (result) {
    await Promise.all([
      ...(result.didWin > 0 && user.isAggressor
        ? [
            client
              .update(village)
              .set({ kageId: user.userId, leaderUpdatedAt: new Date() })
              .where(eq(village.id, user.villageId)),
            client
              .update(userData)
              .set({ villagePrestige: KAGE_PRESTIGE_REQUIREMENT })
              .where(eq(userData.userId, user?.village?.kageId ?? "")),
          ]
        : []),
      ...(deleteItems.length > 0
        ? [client.delete(userItem).where(inArray(userItem.id, deleteItems))]
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
        villageId: user.villageId,
        userId: user.userId,
        kageId: kage.userId,
        didWin: result.didWin,
        rounds: curBattle.round,
      }),
    ]);
  }
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
        coLeader4: sql`CASE WHEN ${clan.coLeader4} = ${user.userId} THEN NULL ELSE ${clan.coLeader4} END`,
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
  // Fetch target with whom the user is in a war
  const warResults = curBattle.usersState
    .filter((t) => t.userId !== userId)
    .filter((t) => !t.isSummon)
    .filter((t) => findWarsWithUser(t.wars, user.wars, t.villageId, userVillageId))
    .map((target) => {
      return {
        target,
        wars: findWarsWithUser(target.wars, user.wars, target.villageId, userVillageId),
      };
    });

  // Mutate
  await Promise.all(
    warResults
      .map((warResult) => {
        return warResult.wars
          .map((w) => {
            const townhallVillageId =
              w.attackerVillageId === user.villageId ||
              w.warAllies.some(
                (a) =>
                  a.villageId === user.villageId &&
                  a.supportVillageId === w.attackerVillageId,
              )
                ? w.attackerVillageId
                : w.defenderVillageId;
            return [
              // Insert war kill for tracking purposes
              ...(result.didWin
                ? [
                    client.insert(warKill).values({
                      id: nanoid(),
                      warId: w.id,
                      killerId: user.userId,
                      victimId: warResult.target.userId,
                      killerVillageId: user.villageId || "unknown",
                      victimVillageId: warResult.target.villageId || "unknonwn",
                      sector: user.sector,
                      shrineHpChange: result.shrineChangeHp,
                      townhallHpChange: result.townhallChangeHP,
                      killedAt: new Date(),
                    }),
                  ]
                : []),
              // Update shrine if we're in a sector war
              ...(result.shrineChangeHp !== 0 && w.type === "SECTOR_WAR"
                ? [
                    client
                      .update(war)
                      .set({
                        shrineHp: sql`GREATEST(LEAST(shrineHp + ${result.shrineChangeHp}, ${WAR_SHRINE_HP}), 0)`,
                      })
                      .where(eq(war.id, w.id)),
                  ]
                : []),
              // Update townhall if we're in a village war
              ...(result.townhallChangeHP !== 0 &&
              ["VILLAGE_WAR", "FACTION_RAID"].includes(w.type)
                ? [
                    client
                      .update(villageStructure)
                      .set({
                        curSp: sql`LEAST(maxSp, curSp + ${result.townhallChangeHP})`,
                      })
                      .where(
                        and(
                          eq(villageStructure.villageId, townhallVillageId),
                          eq(villageStructure.route, w.targetStructureRoute),
                        ),
                      ),
                  ]
                : []),
            ];
          })
          .flat();
      })
      .flat(),
  );
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
 * Update the user with battle result using raw queries for speed
 */
export const updateUser = async (
  client: DrizzleClient,
  pusher: PusherClient,
  curBattle: CompleteBattle,
  result: CombatResult | null,
  userId: string,
) => {
  const user = curBattle.usersState.find((u) => u.userId === userId);
  if (result && user) {
    // Update quest tracker with battle result
    if (result.didWin > 0) {
      if (curBattle.battleType === "COMBAT") {
        const { trackers } = getNewTrackers(user, [
          { task: "pvp_kills", increment: 1 },
        ]);
        user.questData = trackers;
      }
      if (curBattle.battleType === "ARENA") {
        const { trackers } = getNewTrackers(user, [
          { task: "arena_kills", increment: 1 },
        ]);
        user.questData = trackers;
      }
    }
    // Update trackers
    const { trackers, notifications } = getNewTrackers(
      user,
      curBattle.usersState
        .filter((u) => u.userId !== userId)
        .map((u) => ({
          task: "defeat_opponents",
          contentId: u.userId,
          text: result.outcome,
        })),
    );
    user.questData = trackers;
    // Add notifications to combatResult
    result.notifications.push(...notifications);
    // Is it a kage challenge
    const isKageChallenge = ["KAGE_AI", "KAGE_PVP"].includes(curBattle.battleType);
    // Any items to be deleted?
    const deleteItems = user.items.filter((ui) => ui.quantity <= 0).map((i) => i.id);
    const updateItems = user.items.filter((ui) => ui.quantity > 0);
    // Any jutsus to be updated
    const jUsage = user.usedActions.filter((a) => a.type === "jutsu").map((a) => a.id);
    const jUnique = [...new Set(jUsage)];
    const jExp = battleJutsuExp(curBattle.battleType, result.eloDiff, user);
    // If new prestige goes below 0, set allyVillage to false
    if (user.villagePrestige + result.villagePrestige < 0) {
      user.allyVillage = false;
    }

    // Calculate LP change for ranked battles
    let lpChange = 0;
    if (curBattle.battleType === "RANKED") {
      const opponent = curBattle.usersState.find(u => u.userId !== userId);
      if (opponent) {
        lpChange = calculateLPChange(user, opponent, result.didWin > 0);
      }
    }

    // Update ranked battle statistics if it's a ranked battle
    if (curBattle.battleType === "RANKED") {
      await client
        .update(userData)
        .set({
          rankedBattles: sql`${userData.rankedBattles} + 1`,
          ...(result.didWin > 0
            ? {
                rankedWins: sql`${userData.rankedWins} + 1`,
                rankedStreak: sql`${userData.rankedStreak} + 1`,
              }
            : {
                rankedStreak: 0,
              }),
        })
        .where(eq(userData.userId, userId));
    }

    // Update user & user items
    await Promise.all([
      // Delete items
      ...(deleteItems.length > 0
        ? [client.delete(userItem).where(inArray(userItem.id, deleteItems))]
        : []),
      // Update items quantity
      ...(updateItems.length > 0
        ? updateItems.map((ui) =>
            client
              .update(userItem)
              .set({ quantity: ui.quantity })
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
          pvpStreak: result.pvpStreak,
          curHealth: result.curHealth,
          curStamina: result.curStamina,
          curChakra: result.curChakra,
          strength: sql`strength + ${result.strength}`,
          intelligence: sql`intelligence + ${result.intelligence}`,
          willpower: sql`willpower + ${result.willpower}`,
          speed: sql`speed + ${result.speed}`,
          money: result.money ? sql`money + ${result.money}` : sql`money`,
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
          questData: user.questData,
          battleId: null,
          regenAt: new Date(),
          ...(isKageChallenge
            ? {
                rank: sql`CASE WHEN ${userData.rank} = 'ELDER' THEN 'JONIN' ELSE ${userData.rank} END`,
              }
            : {}),
          ...(result.curHealth <= 0 && curBattle.battleType !== "SPARRING"
            ? {
                status: "HOSPITALIZED",
                longitude: HOSPITAL_LONG,
                latitude: HOSPITAL_LAT,
                sector: user.allyVillage ? user.sector : user.village?.sector,
                immunityUntil:
                  curBattle.battleType === "COMBAT"
                    ? sql`NOW() + INTERVAL 1 MINUTE`
                    : sql`immunityUntil`,
              }
            : { status: "AWAKE" }),
          ...(curBattle.battleType === "RANKED" && lpChange !== 0
            ? {
                rankedLp: sql`GREATEST(rankedLp + ${lpChange}, 0)`,
              }
            : {}),
        })
        .where(eq(userData.userId, userId)),
    ]);
    // Update map status
    if (result.curHealth > 0 || curBattle.battleType === "SPARRING") {
      void updateUserOnMap(pusher, user.sector, {
        ...user,
        longitude: user.originalLongitude,
        latitude: user.originalLatitude,
      });
    }
  }
};
