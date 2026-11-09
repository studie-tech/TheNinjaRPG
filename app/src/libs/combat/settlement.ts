import type { BattleType } from "@/drizzle/constants";
import {
  FRIENDLY_PRESTIGE_COST,
  getUserCaps,
  KAGE_CHALLENGE_WIN_PRESTIGE,
  KAGE_PRESTIGE_COST,
  KILLING_NOTORIETY_GAIN,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  NO_REWARD_BATTLE_TYPES,
  PRACTICE_BATTLE_TYPES,
  PVP_KILL_ANBU_POINTS_REWARD,
  PVP_KILL_PRESTIGE_REWARD,
  PVP_KILL_PRESTIGE_REWARD_ANBU,
  PVP_KILL_PRESTIGE_REWARD_ASSASSIN,
  PVP_KILL_TOKEN_REWARD,
  PVP_KILL_TOKEN_REWARD_ANBU,
  PVP_KILL_TOKEN_REWARD_ASSASSIN,
  PvpBattleTypes,
  RANKED_DRAW_LP,
  SPARRING_BATTLE_TYPES,
  STREAK_LEVEL_DIFF,
  VILLAGE_WAR_TYPES,
  WAR_HEALTH_ANBU_RECOVER,
  WAR_HEALTH_ANBU_REMOVE,
  WAR_HEALTH_ASSASSIN_RECOVER,
  WAR_HEALTH_ASSASSIN_REMOVE,
  WAR_HEALTH_COLEADER_RECOVER,
  WAR_HEALTH_COLEADER_REMOVE,
  WAR_HEALTH_ELDER_RECOVER,
  WAR_HEALTH_ELDER_REMOVE,
  WAR_HEALTH_KAGE_RECOVER,
  WAR_HEALTH_KAGE_REMOVE,
  WAR_HEALTH_KAGEDEATH_REMOVE,
  WAR_HEALTH_RECOVER,
  WAR_HEALTH_REMOVE,
  WAR_SECTORWAR_AI_SHRINE_RECOVER,
  WAR_SECTORWAR_AI_SHRINE_REDUCE,
  WAR_SECTORWAR_PVP_SHRINE_RECOVER,
  WAR_SECTORWAR_PVP_SHRINE_REDUCE,
  WAR_TORN_SECTOR_BASE_MONEY,
} from "@/drizzle/constants";
import type { GameSetting, Item, UserItem, VillageAlliance } from "@/drizzle/schema";
import { combatMasteryGains } from "@/libs/combat/mastery";
import { areBattleAllies, hasHumanOpponent } from "@/libs/combat/participants";
import type { CombatQuestTrackerTask } from "@/libs/combat/quests";
import { dungeonCombatResult } from "@/libs/dungeon";
import { applyGameSettingMultiplier } from "@/libs/gameSettingBoost";
import { getWarSide } from "@/libs/objectiveWar";
import { boostPvpGain, pvpExperienceReward } from "@/libs/pvpExperience";
import { calculateLpEloChange } from "@/libs/ranked_pvp";
import { getVillageLoyaltyBonuses, percentageMultiplier } from "@/libs/villageLoyalty";
import { findRelationship } from "@/utils/alliance";
import { randomInt, round } from "@/utils/math";
import { countBoostingShrines, getShrineBoost, getStrucBoost } from "@/utils/village";
import { checkAssassin, checkCoLeader } from "@/validators/clan";
import { stillInBattle } from "./actions";
import type {
  BattleUserState,
  BattleWar,
  CombatQueryVillage,
  CombatResult,
  CompleteBattle,
  DroppedItem,
  ReturnedBattle,
} from "./types";
import {
  getBloodline,
  getClan,
  getCompletedQuestsFromBattle,
  getEffectiveCurPool,
  getItem,
  getQuestDataFromBattle,
  getUserQuestsFromBattle,
  getVillage,
  inertUserItemColumns,
  isOpponentDamageTarget,
} from "./util";

/**
 * Return null while the user's battle is undecided or already settled.
 * A result marks the user's departure in the supplied battle state.
 * Battle teams determine victory and shared credit; summons cannot outlive their
 * controller and are excluded from settlement participants.
 */
export const calcBattleResult = (
  battle: CompleteBattle,
  userId: string,
  settings?: GameSetting[],
): CombatResult | null => {
  if (battle.extraState.dungeon) return dungeonCombatResult(battle, userId);
  const battleType = battle.battleType;
  const users = battle.usersState;
  const user = users.find((u) => u.userId === userId);
  if (user && !user.leftBattle) {
    // Membership fields come from battle initiation; loyalty needs no additional combat reads.
    const loyalty = getVillageLoyaltyBonuses(user);
    // Faction identities still determine reward eligibility and political consequences.
    const villageIds = [
      ...new Set(users.filter((u) => !u.isSummon).map((u) => u.villageId)),
    ];
    const targets = users.filter((u) => !u.isSummon && !areBattleAllies(u, user));
    // The PvP milestone covers open-world human stat gains and experience, excluding money.
    const pvpRewardBoost =
      battleType === "COMBAT" &&
      !user.isAi &&
      !user.isSummon &&
      hasHumanOpponent(users, user)
        ? loyalty.pvpRewards
        : 0;
    const friends = getBattleTeamMembers(battle, user);
    const survivingTargets = targets.filter((t) => stillInBattle(t));
    if (
      !stillInBattle(user) ||
      (survivingTargets.length === 0 &&
        !battle.extraState.encounter?.pendingWaves.length)
    ) {
      // Update the user left
      user.leftBattle = true;

      // Calculate ELO change
      const uExp = friends.reduce((a, b) => a + b.experience, 0) / friends.length;
      const oExp = targets.reduce((a, b) => a + b.experience, 0) / targets.length;
      const effectiveHealth = getEffectiveCurPool(user, "Health");
      const didWin = effectiveHealth > 0 && !user.fledBattle;
      const maxGain = 32;

      // Check if we have a shrine boost - look up village from staticData
      const village = getVillage(battle, user.villageId);
      const sectors = countBoostingShrines(village?.sectors);
      const shrineBoost = getShrineBoost(sectors, "PVP", village);
      const shrineBoostFactor = shrineBoost ? 1 + shrineBoost : 1;

      // Experience boost
      let expBoost = 1;
      if (battleType === "ARENA") {
        expBoost += getStrucBoost("arenaRewardPerLvl", village?.structures) / 100;
      }
      const userClan = getClan(battle, user.clanId);
      // Clan and faction training bonuses use the same stored percentage.
      if (userClan?.trainingBoost && userClan.trainingBoost > 0) {
        expBoost += userClan.trainingBoost / 100;
      }

      // Calculate ELO change if user had won.
      let eloDiff = Math.max(calcEloChange(uExp, oExp || 1000, maxGain), 0.02);

      // If killing ally, then no experience (unless in war-torn sector)
      const isInWarTornSector = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
      if (battleType === "COMBAT" && villageIds.length === 1 && !isInWarTornSector) {
        eloDiff = 0;
      }

      const pvpPercent = user.pvpBoostPercent ?? 0;

      // Calculate Experience gain
      let experience = didWin ? eloDiff * expBoost : 0;
      const streakBonus = 1 + user.pvpStreak * 0.05; // 5% per streak
      if (["COMBAT", "TOURNAMENT"].includes(battleType)) {
        experience *= 10;
        if (battleType === "COMBAT") {
          experience *= streakBonus;
        }
      } else if (
        [
          "CLAN_CHALLENGE",
          "KAGE_AI",
          "KAGE_PVP",
          "TRAINING",
          "VILLAGE_PROTECTOR",
          "RANKED_PVP",
        ].includes(battleType)
      ) {
        experience = 0;
      } else if (battleType === "ARENA") {
        experience = Math.min(experience, 20);
      }

      // Scale experience based on reward scaling
      experience *= battle.rewardScaling * shrineBoostFactor * (1 + pvpPercent / 100);

      // Apply battle arena exp multiplier if available
      if (battleType === "ARENA" || battleType === "COMBAT") {
        experience = applyGameSettingMultiplier(
          experience,
          "battleExpMultiplier",
          settings,
        );
      }
      experience *= percentageMultiplier(pvpRewardBoost);

      // Find users who did not leave battle yet
      const friendsUsers = friends.filter((u) => !u.isAi);
      const targetUsers = targets.filter((u) => !u.isAi);
      const friendsLeft = friendsUsers.filter((u) => !u.leftBattle);
      const targetsLeft = targetUsers.filter((u) => !u.leftBattle);
      const friendsAlive = friends.filter((u) => u.curHealth > 0).length;
      const targetsAlive = targets.filter((u) => u.curHealth > 0).length;
      const totalAlive = friendsAlive + targetsAlive;
      const allOpponentsFled = targets.every((u) => u.fledBattle);

      // Figure outcome status from battle
      const outcome = user.fledBattle
        ? "Fled"
        : totalAlive > 0
          ? didWin
            ? "Won"
            : "Lost"
          : "Draw";

      // Ranked PvP LP change - handle draws
      let lpDiff = 0;
      if (battleType === "RANKED_PVP" && targets[0]) {
        if (outcome === "Draw") {
          lpDiff = RANKED_DRAW_LP;
        } else {
          lpDiff = calculateLpEloChange(
            user,
            targets[0],
            didWin,
            battle.extraState.topPlayersLP ?? [],
          );
        }
      }

      // Tokens & prestige
      let deltaTokens = 0;
      let deltaPrestige = 0;
      let deltaAnbuPoints = 0;
      let clanPoints = 0;
      let deltaEarnedExperience = 0;

      // Clan and faction Ryo bonuses use the same stored percentage.
      const moneyBoost = userClan?.ryoBoost ? 1 + userClan.ryoBoost / 100 : 1;
      const isCombatOrWarBattle =
        battleType === "COMBAT" || battleType === "SHRINE_WAR";
      let moneyDelta = didWin
        ? (isCombatOrWarBattle && isInWarTornSector
            ? WAR_TORN_SECTOR_BASE_MONEY
            : randomInt(30, 40) + user.level) * moneyBoost
        : 0;

      // If combat, more money
      if (battleType === "COMBAT") {
        moneyDelta *= 1.5;
      }

      // If ranked PVP, add benefits
      if (battleType === "RANKED_PVP") {
        if (didWin) {
          moneyDelta = 3000;
          deltaTokens += 400;
          deltaPrestige += 400;
          deltaEarnedExperience += 100;
        }
      }

      moneyDelta = boostPvpGain(moneyDelta, pvpPercent);

      // Include money stolen during combat
      if (battleType === "COMBAT" && user.moneyStolen) {
        if (user.moneyStolen > 0 && outcome !== "Won") {
          user.moneyStolen = 0;
        } else if (user.moneyStolen < 0 && outcome === "Won") {
          user.moneyStolen = 0;
        }
      } else {
        user.moneyStolen = 0;
      }

      // Prestige calculation
      if (["KAGE_AI", "KAGE_PVP"].includes(battleType)) {
        if (!didWin && user.isAggressor) {
          deltaPrestige = -KAGE_PRESTIGE_COST;
        }
        if (didWin && !user.isAggressor) {
          deltaPrestige = KAGE_CHALLENGE_WIN_PRESTIGE;
        }
      }

      // Clan battles pay the clan once through shared settlement, rather than
      // awarding additional clan points for each participant's result.
      if (didWin && !allOpponentsFled && battleType !== "CLAN_BATTLE") {
        if (user.clanId) clanPoints += 1;
      }

      // Check for prestige, tokens, etc.
      const vilId = friends[0]?.villageId ?? user.villageId;
      const isInitiatingTeam = friends.some((member) => member.isAggressor);
      if (didWin && battleType === "COMBAT" && isInitiatingTeam) {
        targetUsers.forEach((target) => {
          const targetRelations = getRelationsArray(battle, target);
          const relation = findRelationship(targetRelations, vilId, target.villageId);
          const isAlly = relation?.status === "ALLY";
          const sameVillage = target.villageId === vilId;
          if (user.isOutlaw) {
            deltaPrestige += KILLING_NOTORIETY_GAIN;
          } else {
            // Prestige deduction for killing allies (skip if in war-torn sector)
            if (!isInWarTornSector) {
              deltaPrestige -= isAlly || sameVillage ? FRIENDLY_PRESTIGE_COST : 0;
            }
          }

          // Base prestige for PvP kill (only for enemies, even in war-torn sector)
          if (
            user.isOutlaw ||
            !(isAlly || (sameVillage && targetRelations.length > 0))
          ) {
            const isUserAssassin =
              user.isOutlaw && checkAssassin(user.userId, userClan);

            deltaPrestige += user.anbuId
              ? PVP_KILL_PRESTIGE_REWARD_ANBU
              : isUserAssassin
                ? PVP_KILL_PRESTIGE_REWARD_ASSASSIN
                : PVP_KILL_PRESTIGE_REWARD;

            // Base village tokens for PvP kill (only for enemies)
            deltaTokens += user.anbuId
              ? PVP_KILL_TOKEN_REWARD_ANBU
              : isUserAssassin
                ? PVP_KILL_TOKEN_REWARD_ASSASSIN
                : PVP_KILL_TOKEN_REWARD;

            // ANBU points for PvP kill (only if target is not more than 10 levels under)
            if (user.anbuId && user.level - target.level <= 10) {
              deltaAnbuPoints += PVP_KILL_ANBU_POINTS_REWARD;
            }
          }

          // Additional village tokens for killing enemies
          deltaTokens += relation?.status === "ENEMY" ? 5 : 0;
        });
      }

      const {
        warHealthInfo,
        shrineInfo,
        villageWarShrineInfo,
        villageWarShrineDisplay,
        warHealthChange,
        shrineChangeHp,
      } = calcWarDamage({
        battle,
        user,
        targets,
        targetUsers,
        village,
        userClan,
        didWin,
        isInWarTornSector,
      });

      // Opponent level gaps for rewards count AI opponents too.
      const maxTargetLevel = Math.max(...targets.map((t) => t.level), 0);

      // Check if any bounties were claimed
      const bountiesClaimed =
        battleType === "COMBAT" && didWin
          ? collectClaimedBounties(battle, user, targets)
          : [];

      // Roll item drops from defeated opponents and include in result for frontend display
      const droppedItems = didWin ? rollDroppedItems(battle, targets) : [];

      // Positive generated prestige/tokens gain loyalty; penalties retain their existing values.
      deltaTokens = boostPvpGain(deltaTokens, loyalty.villageRewards);
      deltaPrestige = boostPvpGain(deltaPrestige, loyalty.villageRewards);

      // Result object
      const result: CombatResult = {
        outcome: outcome,
        didWin: didWin ? 1 : 0,
        eloDiff: eloDiff,
        lpDiff: lpDiff,
        experience: 0.01,
        earnedExperience: 0,
        pvpStreak: calcPvpStreak(battleType, user, maxTargetLevel, didWin),
        curHealth: user.curHealth,
        curStamina: user.curStamina,
        curChakra: user.curChakra,
        strength: 0,
        intelligence: 0,
        willpower: 0,
        speed: 0,
        offence: 0,
        defence: 0,
        money: 0,
        seichiSilver: 0,
        villagePrestige: deltaPrestige,
        friendsLeft: friendsLeft.length,
        targetsLeft: targetsLeft.length,
        villageTokens: deltaTokens,
        anbuPoints: deltaAnbuPoints,
        warHealthChange: warHealthChange,
        shrineChangeHp: shrineChangeHp,
        shrineInfo: shrineInfo,
        warHealthInfo: warHealthInfo,
        villageWarShrineInfo: villageWarShrineInfo,
        villageWarShrineDisplay: villageWarShrineDisplay,
        clanPoints: clanPoints * battle.rewardScaling,
        notifications: [],
        bountiesClaimed: bountiesClaimed,
        droppedItems: droppedItems,
      };

      // Things to reward for non-spars
      if (!NO_REWARD_BATTLE_TYPES.includes(battleType)) {
        // Money stolen/given
        result.money = moneyDelta * battle.rewardScaling + user.moneyStolen;
        // If any stats were used, distribute exp change on stats.
        // If not, then distribute equally among all stats & generals
        const statsTotal = Object.values(user.usedStats).reduce(
          (sum, value) => sum + value,
          0,
        );
        const gensTotal = Object.values(user.usedGenerals).reduce(
          (sum, value) => sum + value,
          0,
        );
        let total = statsTotal + gensTotal;
        if (total === 0) {
          user.usedStats = {
            offence: 1,
            defence: 1,
          };
          user.usedGenerals = {
            strength: 1,
            intelligence: 1,
            willpower: 1,
            speed: 1,
          };
          total = 6;
        }
        let assignedExp = 0;
        const { stats_cap, gens_cap } = getUserCaps(user.rank);

        Object.entries(user.usedStats).forEach(([stat, value]) => {
          assignedExp += distributeExpToStat(
            user,
            stat as keyof typeof user.usedStats,
            value,
            stats_cap,
            total,
            experience,
            result,
          );
        });
        Object.entries(user.usedGenerals).forEach(([stat, value]) => {
          assignedExp += distributeExpToStat(
            user,
            stat as keyof typeof user.usedGenerals,
            value,
            gens_cap,
            total,
            experience,
            result,
          );
        });

        // Experience
        result.experience = Math.floor(assignedExp * 100) / 100;
      }

      // Ensure Ranked PvP winner rewards are applied despite noRewardBattles gating
      if (battleType === "RANKED_PVP" && didWin) {
        // Money (respect global reward scaling)
        result.money = moneyDelta * battle.rewardScaling;
        result.earnedExperience = deltaEarnedExperience * battle.rewardScaling;
        result.villageTokens = deltaTokens * battle.rewardScaling;
        result.villagePrestige = deltaPrestige * battle.rewardScaling;
      }

      // Apply 1.6x multiplier to all PvP rewards in war-torn sector
      // Allow both COMBAT and war battle types (SHRINE_WAR, etc.) in war-torn sector
      if (isCombatOrWarBattle && isInWarTornSector && didWin) {
        result.experience *= 1.6;
        result.money *= 1.6;
        result.earnedExperience *= 1.6;

        // Silver drop chance for kills in war-torn sector (using same diminishing returns as rewards)
        // Check level difference is within 10 levels
        if (targets.length > 0) {
          const levelDifference = Math.abs(user.level - maxTargetLevel);
          if (levelDifference <= STREAK_LEVEL_DIFF) {
            const silverDropChance = 5 * battle.rewardScaling;
            if (Math.random() * 100 < silverDropChance) {
              result.seichiSilver = 1;
            }
          }
        }
      }

      // Apply money penalty for losers in war-torn sector (lose the same amount winner would gain)
      if (isCombatOrWarBattle && isInWarTornSector && !didWin && outcome !== "Fled") {
        // Calculate what the user would have gotten if they won (same calculation as winner)
        let loserMoneyGain = WAR_TORN_SECTOR_BASE_MONEY * moneyBoost;
        loserMoneyGain *= 1.5; // COMBAT multiplier
        loserMoneyGain *= battle.rewardScaling;
        // Apply 1.6x multiplier (same as winner gets)
        loserMoneyGain *= 1.6;
        // Deduct this amount from the loser, but don't let money go below 0
        const currentMoney = user?.money || 0;
        const moneyToLose = Math.min(loserMoneyGain, currentMoney);
        result.money = -moneyToLose;
      }

      result.masteryGains = combatMasteryGains(
        battle,
        user,
        targets,
        outcome,
        experience,
      );

      result.villagePrestige = boostPvpGain(result.villagePrestige, pvpPercent);
      result.villageTokens = boostPvpGain(result.villageTokens, pvpPercent);
      result.clanPoints = boostPvpGain(result.clanPoints, pvpPercent);
      // Match MySQL's integer currency payouts while preserving fractional penalties.
      for (const field of ["money", "villageTokens", "clanPoints"] as const) {
        if (result[field] > 0) result[field] = Math.round(result[field]);
      }
      const earnsPvpExperience =
        !user.isAi &&
        !user.isSummon &&
        [
          "COMBAT",
          "RANKED_PVP",
          "CLAN_BATTLE",
          "SHRINE_WAR",
          "KAGE_PVP",
          "TOURNAMENT",
        ].includes(battleType) &&
        targetUsers.length > 0 &&
        !(battleType === "COMBAT" && villageIds.length === 1 && !isInWarTornSector);
      result.pvpExperience = earnsPvpExperience
        ? pvpExperienceReward(
            outcome,
            battle.extraState.pvpExperienceScaling ?? battle.rewardScaling,
          )
        : 0;
      if (result.pvpExperience > 0)
        result.pvpExperience = round(
          result.pvpExperience * percentageMultiplier(pvpRewardBoost),
          2,
        );
      result.weeklyPvpKills =
        earnsPvpExperience && outcome === "Won"
          ? targetUsers.filter((target) => wasDefeated(target)).length
          : 0;

      // Keep the result summary consistent with exhibition settlement's progression bypass.
      if (battle.extraState.tournamentGameId || battle.extraState.hunting) {
        result.droppedItems = [];
        result.experience = 0;
        result.earnedExperience = 0;
        result.money = 0;
        result.seichiSilver = 0;
        result.offence = 0;
        result.defence = 0;
        result.strength = 0;
        result.intelligence = 0;
        result.willpower = 0;
        result.speed = 0;
        result.clanPoints = 0;
        result.anbuPoints = 0;
        result.villageTokens = 0;
        result.villagePrestige = 0;
        result.masteryGains = {};
      }
      // Return results
      return result;
    }
  }
  return null;
};

/**
 * War health, sector shrine and village-war shrine changes of one fighter's result.
 * Reward scaling covers war health and sector shrines; village-war shrines stay per kill.
 */
const calcWarDamage = ({
  battle,
  user,
  targets,
  targetUsers,
  village,
  userClan,
  didWin,
  isInWarTornSector,
}: {
  battle: CompleteBattle;
  user: BattleUserState;
  targets: BattleUserState[];
  /** Human opponents; only they drive the level normalisation. */
  targetUsers: BattleUserState[];
  village: CompleteBattle["extraState"]["villages"][string] | undefined;
  userClan: CompleteBattle["extraState"]["clans"][string] | undefined;
  didWin: boolean;
  isInWarTornSector: boolean;
}) => {
  const { battleType } = battle;
  // Determine war kills bonus
  const warHealthInfo: Record<string, number> = {};
  const addWarHealth = (villageName: string, change: number) => {
    warHealthInfo[villageName] = (warHealthInfo[villageName] ?? 0) + change;
  };
  const shrineInfo: Record<number, number> = {};
  // Track attacker and defender shrine changes separately per war
  const villageWarShrineInfo: Record<string, { attacker: number; defender: number }> =
    {};
  const villageWarShrineDisplay: Record<string, number> = {};
  const warIdToDisplayName: Record<string, string> = {};
  const ensureVillageWarShrine = (war: BattleWar) => {
    if (war.id in villageWarShrineInfo) return;
    villageWarShrineInfo[war.id] = { attacker: 0, defender: 0 };
    // Create display name for this war using village names
    const attackerName = war.attackerVillage?.name ?? "Attacker";
    const defenderName = war.defenderVillage?.name ?? "Defender";
    warIdToDisplayName[war.id] = `${attackerName} vs ${defenderName}`;
  };
  let warHealthChange = 0;
  let shrineChangeHp = 0;
  const userWars = getBattleTeamWars(battle, user);
  // Skip war updates if kill happened in war-torn sector
  if (!user.fledBattle && !isInWarTornSector) {
    targets.forEach((target) => {
      const wars = getOpposingBattleWars(battle, user, target);
      wars.forEach(({ war, sideVillageId }) => {
        // Objective wars award clamped strategic damage through their own receipts.
        if (war.rules) return;
        const isUserOnAttackerSide = war.attackerVillageId === sideVillageId;
        // Get the names of the village
        const userVillageName = isUserOnAttackerSide
          ? war?.attackerVillage?.name || ""
          : war?.defenderVillage?.name || "";
        const targetVillageName = isUserOnAttackerSide
          ? war?.defenderVillage?.name || ""
          : war?.attackerVillage?.name || "";
        // Reset to 0 if not in warHealthInfo
        if (targetVillageName && !(targetVillageName in warHealthInfo)) {
          warHealthInfo[targetVillageName] = 0;
        }
        if (userVillageName && !(userVillageName in warHealthInfo)) {
          warHealthInfo[userVillageName] = 0;
        }

        // Village wars & raids
        if (VILLAGE_WAR_TYPES.includes(war.type) && battleType === "COMBAT") {
          const targetVillage = getVillage(battle, target.villageId);
          if (didWin) {
            const { recover, remove } = getWarHealthTier(user, village, userClan);
            warHealthChange += recover;
            addWarHealth(userVillageName, recover);
            addWarHealth(targetVillageName, -remove);
            if (targetVillage?.kageId === target.userId) {
              addWarHealth(targetVillageName, -WAR_HEALTH_KAGEDEATH_REMOVE);
            }
          } else {
            const targetClan = getClan(battle, target.clanId);
            const { remove } = getWarHealthTier(target, targetVillage, targetClan);
            warHealthChange -= remove;
            addWarHealth(userVillageName, -remove);
            if (village?.kageId === user.userId) {
              warHealthChange -= WAR_HEALTH_KAGEDEATH_REMOVE;
              addWarHealth(userVillageName, -WAR_HEALTH_KAGEDEATH_REMOVE);
            }
          }
        }
        // Sector wars
        if (war.type === "SECTOR_WAR") {
          const sector = war.sector;
          if (!(sector in shrineInfo)) {
            shrineInfo[sector] = 0;
          }
          if (battleType === "SHRINE_WAR") {
            if (
              (didWin && isUserOnAttackerSide) ||
              (!didWin && !isUserOnAttackerSide)
            ) {
              shrineChangeHp -= WAR_SECTORWAR_AI_SHRINE_REDUCE;
              shrineInfo[sector] =
                (shrineInfo[sector] ?? 0) - WAR_SECTORWAR_AI_SHRINE_REDUCE;
            } else {
              shrineChangeHp += WAR_SECTORWAR_AI_SHRINE_RECOVER;
              shrineInfo[sector] =
                (shrineInfo[sector] ?? 0) + WAR_SECTORWAR_AI_SHRINE_RECOVER;
            }
          }
          if (battleType === "COMBAT") {
            if (
              (didWin && isUserOnAttackerSide) ||
              (!didWin && !isUserOnAttackerSide)
            ) {
              if (didWin) shrineChangeHp -= WAR_SECTORWAR_PVP_SHRINE_REDUCE;
              shrineInfo[sector] =
                (shrineInfo[sector] ?? 0) - WAR_SECTORWAR_PVP_SHRINE_REDUCE;
            } else {
              if (didWin) shrineChangeHp += WAR_SECTORWAR_PVP_SHRINE_RECOVER;
              shrineInfo[sector] =
                (shrineInfo[sector] ?? 0) + WAR_SECTORWAR_PVP_SHRINE_RECOVER;
            }
          }
        }
        // Village wars and raids - abstract shrine HP mechanic
        // Tracked per war so a user in several wars credits each war separately
        // Track attacker and defender shrine changes separately
        if (VILLAGE_WAR_TYPES.includes(war.type)) {
          ensureVillageWarShrine(war);
          const isUserOnDefenderSide = !isUserOnAttackerSide;

          // Determine which shrine is being targeted based on user's sector
          const atAttackerVillage = war.attackerVillage?.sector === user.sector;
          const atDefenderVillage = war.defenderVillage?.sector === user.sector;

          // AI shrine battles (SHRINE_WAR) - attacking the shrine directly
          if (battleType === "SHRINE_WAR") {
            const warInfo = villageWarShrineInfo[war.id];
            if (didWin && warInfo) {
              if (isUserOnAttackerSide && atDefenderVillage) {
                // Attacker wins at defender's shrine: defender shrine HP down
                warInfo.defender -= WAR_SECTORWAR_AI_SHRINE_REDUCE;
              } else if (isUserOnAttackerSide && atAttackerVillage) {
                // Attacker wins defending own shrine: attacker shrine HP up
                warInfo.attacker += WAR_SECTORWAR_AI_SHRINE_RECOVER;
              } else if (isUserOnDefenderSide && atAttackerVillage) {
                // Defender wins at attacker's shrine: attacker shrine HP down
                warInfo.attacker -= WAR_SECTORWAR_AI_SHRINE_REDUCE;
              } else if (isUserOnDefenderSide && atDefenderVillage) {
                // Defender wins defending own shrine: defender shrine HP up
                warInfo.defender += WAR_SECTORWAR_AI_SHRINE_RECOVER;
              }
            }
          }

          // PvP battles (COMBAT) - affect shrine based on where battle occurred
          if (battleType === "COMBAT") {
            const warInfo = villageWarShrineInfo[war.id];
            if (didWin && warInfo) {
              if (atDefenderVillage) {
                // Battle at defender village affects defender shrine
                if (isUserOnAttackerSide) {
                  // Attacker kills defender at defender village: defender shrine HP down
                  warInfo.defender -= WAR_SECTORWAR_PVP_SHRINE_REDUCE;
                } else if (isUserOnDefenderSide) {
                  // Defender kills attacker at own village: defender shrine HP up
                  warInfo.defender += WAR_SECTORWAR_PVP_SHRINE_RECOVER;
                }
              } else if (atAttackerVillage) {
                // Battle at attacker village affects attacker shrine
                if (isUserOnDefenderSide) {
                  // Defender kills attacker at attacker village: attacker shrine HP down
                  warInfo.attacker -= WAR_SECTORWAR_PVP_SHRINE_REDUCE;
                } else if (isUserOnAttackerSide) {
                  // Attacker kills defender at own village: attacker shrine HP up
                  warInfo.attacker += WAR_SECTORWAR_PVP_SHRINE_RECOVER;
                }
              }
            }
          }
        }
      });
    });

    // Handle SHRINE_WAR village wars separately for defend scenarios
    // When defending own shrine, AI target has same villageId as user, so normal
    // target loop doesn't process it. Handle this case based on user's wars directly.
    if (battleType === "SHRINE_WAR" && didWin) {
      userWars
        .filter(({ war }) => VILLAGE_WAR_TYPES.includes(war.type))
        .forEach(({ war, sideVillageId }) => {
          // Objective-war recovery shares the same receipt boundary as damage.
          if (war.rules) return;
          const isUserOnAttackerSide = war.attackerVillageId === sideVillageId;
          const isUserOnDefenderSide = !isUserOnAttackerSide;

          const atAttackerVillage = war.attackerVillage?.sector === user.sector;
          const atDefenderVillage = war.defenderVillage?.sector === user.sector;

          // Check if this is a defend scenario (at own village)
          const isDefendScenario =
            (isUserOnAttackerSide && atAttackerVillage) ||
            (isUserOnDefenderSide && atDefenderVillage);

          // Skip if not a defend scenario (attack scenarios are handled by target loop)
          if (!isDefendScenario) return;

          ensureVillageWarShrine(war);

          // Apply shrine HP recovery for defend
          const warInfo = villageWarShrineInfo[war.id];
          if (warInfo) {
            if (isUserOnAttackerSide && atAttackerVillage) {
              // Attacker wins defending own shrine: attacker shrine HP up
              warInfo.attacker += WAR_SECTORWAR_AI_SHRINE_RECOVER;
            } else if (isUserOnDefenderSide && atDefenderVillage) {
              // Defender wins defending own shrine: defender shrine HP up
              warInfo.defender += WAR_SECTORWAR_AI_SHRINE_RECOVER;
            }
          }
        });
    }
  }

  // Scale everything based on reward scaling
  shrineChangeHp *= battle.rewardScaling;
  warHealthChange *= battle.rewardScaling;
  mapRecordValues(shrineInfo, (value) => value * battle.rewardScaling);
  mapRecordValues(warHealthInfo, (value) => value * battle.rewardScaling);
  // Note: villageWarShrineInfo is intentionally NOT scaled by rewardScaling.
  // Shrine HP changes are a strategic war mechanic and should not be reduced
  // by anti-farming scaling, ensuring consistent war progress per kill.

  // Adjust shrine & townhall damage based on the level difference to human opponents;
  // fights against AI alone keep their full damage.
  const maxHumanTargetLevel = Math.max(...targetUsers.map((t) => t.level), 0);
  if (
    targetUsers.length > 0 &&
    Math.abs(user.level - maxHumanTargetLevel) > STREAK_LEVEL_DIFF
  ) {
    // Check if any kage was killed in this battle
    const targetKageLost =
      targets.some((target) => {
        const tVillage = getVillage(battle, target.villageId);
        return tVillage?.kageId === target.userId;
      }) && didWin;
    const userKageLost = village?.kageId === user.userId && !didWin;
    const kageLost = targetKageLost || userKageLost;
    const strongestWon = user.level > maxHumanTargetLevel && didWin;
    const weakestLost = user.level < maxHumanTargetLevel && !didWin;
    // If kage was killed, we preserve all war damage, otherwise reduce all changes to 1/abs(change) if we're the stronger player
    if (!kageLost && (strongestWon || weakestLost)) {
      shrineChangeHp = Math.sign(shrineChangeHp);
      warHealthChange = Math.sign(warHealthChange);
      mapRecordValues(shrineInfo, Math.sign);
      mapRecordValues(warHealthInfo, Math.sign);
      for (const info of Object.values(villageWarShrineInfo)) {
        info.attacker = Math.sign(info.attacker);
        info.defender = Math.sign(info.defender);
      }
    }
  }

  // Convert villageWarShrineInfo to display-friendly format using war names
  // Combine attacker and defender changes for display purposes
  for (const [warId, info] of Object.entries(villageWarShrineInfo)) {
    const displayName = warIdToDisplayName[warId] ?? warId;
    villageWarShrineDisplay[displayName] = info.attacker + info.defender;
  }

  return {
    warHealthInfo,
    shrineInfo,
    villageWarShrineInfo,
    villageWarShrineDisplay,
    warHealthChange,
    shrineChangeHp,
  };
};

/** The PvP streak after a battle; only open-world combat changes it. */
const calcPvpStreak = (
  battleType: string,
  user: { level: number; pvpStreak: number; isAggressor: boolean },
  maxTargetLevel: number,
  didWin: boolean,
): number => {
  if (battleType !== "COMBAT") {
    return user.pvpStreak;
  }
  const levelDifference = user.level - maxTargetLevel;
  if (user.isAggressor && levelDifference > STREAK_LEVEL_DIFF) {
    return user.pvpStreak;
  }
  if (didWin) {
    return user.pvpStreak + 1;
  }
  if (user.isAggressor || levelDifference > -STREAK_LEVEL_DIFF) {
    return 0;
  }
  return user.pvpStreak;
};

/** Bounties the user signed up for on defeated targets, by signup then target. */
const collectClaimedBounties = (
  battle: CompleteBattle,
  user: BattleUserState,
  targets: BattleUserState[],
) => {
  const bountiesClaimed: {
    bountyId: string;
    hunterId: string;
    amountRyo: number;
  }[] = [];
  for (const signup of getUserBountySignups(battle, user.controllerId)) {
    for (const target of targets) {
      const bounty = getUserBounties(battle, target.controllerId).find(
        (b) => b.id === signup.bountyId,
      );
      if (bounty) {
        bountiesClaimed.push({
          bountyId: bounty.id,
          hunterId: user.userId,
          amountRyo: bounty.amountRyo,
        });
      }
    }
  }
  return bountiesClaimed;
};

/** Roll each droppable item of the AI opponents; an item with no drop chance spends no roll. */
const rollDroppedItems = (battle: CompleteBattle, targets: BattleUserState[]) => {
  const droppedItems: DroppedItem[] = [];
  targets
    .filter((t) => !t.isSummon && t.isAi)
    .forEach((t) => {
      t.items.forEach((ui) => {
        const chance = ui.dropChancePerc ?? 0;
        if (chance > 0 && Math.random() * 100 < chance) {
          const itemData = getItem(battle, ui.itemId);
          droppedItems.push({
            itemId: ui.itemId,
            name: itemData?.name ?? "Item",
            userItemId: ui.id,
            fromUserId: t.userId,
          });
        }
      });
    });
  return droppedItems;
};

/** Replace every value of a record in place. */
const mapRecordValues = <K extends string | number>(
  record: Record<K, number>,
  transform: (value: number) => number,
) => {
  for (const key of Object.keys(record) as K[]) record[key] = transform(record[key]);
};

/** War health a kill recovers and removes, by the rank of the fighter it counts for. */
const getWarHealthTier = (
  fighter: BattleUserState,
  village: CompleteBattle["extraState"]["villages"][string] | undefined,
  clan: CompleteBattle["extraState"]["clans"][string] | undefined,
) => {
  if (village?.kageId === fighter.userId) {
    return { recover: WAR_HEALTH_KAGE_RECOVER, remove: WAR_HEALTH_KAGE_REMOVE };
  }
  if (fighter.rank === "ELDER") {
    return { recover: WAR_HEALTH_ELDER_RECOVER, remove: WAR_HEALTH_ELDER_REMOVE };
  }
  if (fighter.isOutlaw && checkCoLeader(fighter.userId, clan)) {
    return { recover: WAR_HEALTH_COLEADER_RECOVER, remove: WAR_HEALTH_COLEADER_REMOVE };
  }
  if (fighter.anbuId) {
    return { recover: WAR_HEALTH_ANBU_RECOVER, remove: WAR_HEALTH_ANBU_REMOVE };
  }
  if (fighter.isOutlaw && checkAssassin(fighter.userId, clan)) {
    return { recover: WAR_HEALTH_ASSASSIN_RECOVER, remove: WAR_HEALTH_ASSASSIN_REMOVE };
  }
  return { recover: WAR_HEALTH_RECOVER, remove: WAR_HEALTH_REMOVE };
};

/**
 * Distributes a portion of experience to a given stat, based on usage
 * @returns The amount of experience distributed
 */
const distributeExpToStat = (
  user: BattleUserState,
  stat: keyof typeof user.usedStats | keyof typeof user.usedGenerals,
  count: number,
  cap: number,
  total: number,
  experience: number,
  result: CombatResult,
): number => {
  const expWeighted = (count / total) * experience;
  const expRounded = Math.floor(expWeighted * 100) / 100;
  const expResult = Math.max(0, Math.min(expRounded, cap - user[stat]));
  result[stat] += expResult;
  return expResult;
};

/**
 * Computes the winner's change in ELO rating based on original ELO ratings
 */
const calcEloChange = (user: number, opponent: number, kFactor: number) => {
  const expectedScore = 1 / (1 + 2 ** ((opponent - user) / (0.03 * (opponent + user))));
  const ratingChange = kFactor * (1 - expectedScore);
  return Math.floor(ratingChange * 100) / 100;
};

/**
 * Get all relations for a user as array
 */
const getRelationsArray = (
  battle: CompleteBattle | ReturnedBattle,
  user: BattleUserState,
) => {
  return (user.relationIds ?? [])
    .map((id) => battle.extraState.relations?.[id])
    .filter((r): r is VillageAlliance => Boolean(r));
};

/**
 * Get bounties from extraState for a user
 */
const getUserBounties = (
  battle: CompleteBattle | ReturnedBattle,
  controllerId: string,
) => {
  return battle.extraState.bounties?.[controllerId] ?? [];
};

/**
 * Get bounty signups from extraState for a user
 */
const getUserBountySignups = (
  battle: CompleteBattle | ReturnedBattle,
  controllerId: string,
) => {
  return battle.extraState.bountySignups?.[controllerId] ?? [];
};

/**
 * Resolve preloaded wars and their sponsored sides for the user's battle team.
 * The first matching member in sponsorship order chooses each war's side,
 * including registered supporters. Persistent village/war membership is unchanged.
 * Mercenary appointments frozen in battle state restrict credit to the assigned war.
 */
export const getBattleTeamWars = (battle: CompleteBattle, user: BattleUserState) => {
  const wars = new Map<string, { war: BattleWar; sideVillageId: string }>();
  for (const member of getBattleTeamMembers(battle, user)) {
    for (const war of Object.values(battle.extraState.wars ?? {})) {
      const assignedWarId = war.mercenaryWarIds?.[user.userId];
      if (assignedWarId && war.id !== assignedWarId) continue;
      const sideVillageId = getWarSide(war, member.villageId, member.userId);
      if (sideVillageId && !wars.has(war.id)) wars.set(war.id, { war, sideVillageId });
    }
  }
  return [...wars.values()];
};

/**
 * Return team wars whose opposite war side sponsors the target's combat team.
 * Summons and same-team targets never qualify as war opponents.
 */
export const getOpposingBattleWars = (
  battle: CompleteBattle,
  user: BattleUserState,
  target: BattleUserState,
) => {
  if (target.isSummon || areBattleAllies(user, target)) return [];
  const opponents = getBattleTeamWars(battle, target);
  return getBattleTeamWars(battle, user).filter((entry) =>
    opponents.some(
      (other) =>
        other.war.id === entry.war.id && other.sideVillageId !== entry.sideVillageId,
    ),
  );
};

/**
 * Return non-summon teammates in stable faction-sponsorship order.
 * Aggressors precede other members; immutable IDs break ties so initiative
 * sorting and loadout edits cannot change the team's faction context.
 */
const getBattleTeamMembers = (battle: CompleteBattle, user: BattleUserState) =>
  battle.usersState
    .filter((member) => !member.isSummon && areBattleAllies(member, user))
    .sort(
      (a, b) =>
        Number(b.isAggressor) - Number(a.isAggressor) ||
        a.userId.localeCompare(b.userId),
    );

/**
 * Hydrate a BattleUserState with data from extraState for use with e.g. getNewTrackers.
 * Returns a fully hydrated user with relations populated from battle.extraState.
 */
export const hydrateUserForQuests = (battle: CompleteBattle, user: BattleUserState) => {
  // Hydrate relations from extraState
  const userQuests = getUserQuestsFromBattle(battle, user.controllerId).filter((q) =>
    Array.isArray(q.quest?.content?.objectives),
  );
  const completedQuests = getCompletedQuestsFromBattle(battle, user.controllerId);
  const questData = getQuestDataFromBattle(battle, user.controllerId);
  // Quest rewards read structures only through boost lookups, which the catalog keeps.
  const village = user.villageId
    ? (getVillage(battle, user.villageId) as CombatQueryVillage | undefined)
    : undefined;
  const bloodline = getBloodline(battle, user.bloodlineId);

  // Omit BattleUserState.items (BattleUserItem[]) to rebuild as the UserItem shape
  // (with the minimal item relation) that UserWithRelations carries.
  const { items: battleItems, ...userWithoutItems } = user;

  // Convert BattleUserItem[] to UserItem[] by adding the fields not tracked on the
  // battle reference type. The item relation is looked up from extraState so the
  // result matches UserWithRelations.items.
  const now = new Date();
  const items: (UserItem & {
    item: Pick<Item, "id" | "itemType" | "maxDurability">;
  })[] = battleItems.map((bi) => {
    const itemData = getItem(battle, bi.itemId);
    return {
      ...bi,
      ...inertUserItemColumns(user.userId, now),
      activeVariantId: bi.activeVariantId ?? null,
      item: {
        id: bi.itemId,
        itemType: itemData?.itemType ?? "CONSUMABLE",
        maxDurability: itemData?.maxDurability ?? 0,
      },
    };
  });

  // Return hydrated user for quest processing
  return {
    ...userWithoutItems,
    userQuests,
    completedQuests,
    questData,
    village,
    bloodline: bloodline ?? null,
    items,
  };
};

/**
 * Build the combat objective tracker tasks from pre-loaded battle state.
 *
 * Pure: reads only accumulated battle-state fields (usedActions, usedTagTypes, damageDealt)
 * and the opponent list — no DB fetch — so it folds into the single getNewTrackers call in
 * updateUser (database.ts) without breaking the combat-performance rule. Win-only trackers
 * gate on result.didWin > 0; combat usage/damage trackers count on any outcome.
 */
export const buildCombatTrackerTasks = (
  curBattle: CompleteBattle,
  user: BattleUserState,
  result: CombatResult,
): CombatQuestTrackerTask[] => {
  const tasks: CombatQuestTrackerTask[] = [];

  // Each cast counts, including repeated casts and battles lost or fled.
  const isPvp = hasHumanOpponent(curBattle.usersState, user);
  // Participation is settled once per real match on wins, losses, draws and fleeing.
  // Practice ranked spars and staff tournament exhibitions do not advance competitive counters.
  if (!curBattle.extraState.tournamentGameId && !user.isAi && !user.isSummon) {
    if (curBattle.battleType === "COMBAT" && isPvp)
      tasks.push({ task: "pvp_participated", increment: 1 });
    if (curBattle.battleType === "SPARRING" && isPvp)
      tasks.push({ task: "spars_participated", increment: 1 });
    if (curBattle.battleType === "RANKED_PVP" && isPvp) {
      tasks.push({ task: "ranked_participated", increment: 1 });
      if (result.didWin > 0) tasks.push({ task: "ranked_wins", increment: 1 });
    }
    if (curBattle.battleType === "OVERWORLD") {
      const opponents = curBattle.usersState.filter(
        (opponent) =>
          !areBattleAllies(user, opponent) && opponent.isAi && !opponent.isSummon,
      );
      if (opponents.length)
        tasks.push({ task: "overworld_ai_fought", increment: opponents.length });
    }
  }
  const combatType = isPvp ? "PVP" : "PVE";
  for (const action of user.usedActions.filter((action) => action.type === "jutsu")) {
    tasks.push({
      task: "use_specific_jutsu_combat",
      increment: 1,
      contentId: action.id,
      masteryTypes: action.masteryTypes,
      combatType,
    });
  }
  const usedItemIds = [
    ...new Set(
      user.usedActions
        .filter((action) => action.type === "item")
        .map((action) => action.id),
    ),
  ];
  for (const id of usedItemIds) {
    tasks.push({ task: "use_specific_item_combat", increment: 1, contentId: id });
  }

  // damage_dealt: total damage this user dealt to real opponents this battle (accumulated
  // at consequence application in process.ts; damage from the user's summons/clones is
  // credited here via controllerId). Any outcome; skip a no-op zero emit.
  if (user.damageDealt > 0) {
    tasks.push({ task: "damage_dealt", increment: user.damageDealt });
  }

  if (result.didWin > 0) {
    // creatures_hunted: +1 per opposing-side (non-self, non-summon) opponent that was actually
    // defeated when the battle is won. isOpponentDamageTarget keeps the predicate aligned with
    // damage_dealt; wasDefeated wraps the engine's own defeat check plus a flee exclusion. Gating
    // is implicit — these objectives are authored only on hunting-rank quests.
    for (const u of curBattle.usersState) {
      if (isOpponentDamageTarget(user, u) && wasDefeated(u)) {
        tasks.push({ task: "creatures_hunted", increment: 1 });
      }
    }
    // tag_usage_win: one tick per DISTINCT tag type the user APPLIED (resolved) this
    // battle. usedTagTypes is populated at effect resolution in process.ts.
    for (const t of new Set(user.usedTagTypes)) {
      tasks.push({ task: "tag_usage_win", increment: 1, contentId: t });
    }
  }

  return tasks;
};

/**
 * True when `u` was defeated (not fled), for the creatures_hunted tracker. Wraps the engine's
 * own effective-health defeat check (stillInBattle, which already returns false for a fled user)
 * with an explicit flee exclusion, so a foe that escaped is never counted as hunted. Centralized
 * so the defeat predicate — and the reason leftBattle is intentionally excluded (a foe killed
 * earlier already has leftBattle=true from its own calcBattleResult) — lives in one documented
 * place rather than being re-derived at each call site.
 */
export const wasDefeated = (u: BattleUserState): boolean =>
  !u.fledBattle && !stillInBattle(u);

/**
 * Whether a battle can pay out the PvP Energy reward for the given user: a non-sparring
 * PvP battle type with at least one human, non-summon opponent on the other side. Shared
 * by reward settlement and the result screen so PvE fights (quests, AI on the map, Kage
 * AI, arena, ...) are never presented as PvP.
 */
export const isPvpEnergyRewardBattle = (
  battle: {
    battleType: BattleType;
    usersState: Pick<BattleUserState, "userId" | "direction" | "isAi" | "isSummon">[];
  },
  userId: string,
): boolean => {
  if (!PvpBattleTypes.includes(battle.battleType)) return false;
  if (SPARRING_BATTLE_TYPES.includes(battle.battleType)) return false;
  const user = battle.usersState.find((u) => u.userId === userId);
  if (!user) return false;
  return hasHumanOpponent(battle.usersState, user);
};

/**
 * Whether a finished battle hospitalizes a user at this health. Isolated pyramid runs stay in
 * their run, which callers check against the user.
 */
export const sendsToHospital = (
  battle: { battleType: BattleType; forceKeepPools: boolean },
  curHealth: number,
) =>
  !battle.forceKeepPools &&
  curHealth <= 0 &&
  !PRACTICE_BATTLE_TYPES.includes(battle.battleType);

/**
 * Resolve a Kage challenge from shared battle state. CombatResult is scoped to
 * whichever user finalized the battle, so a caller-relative didWin flips meaning
 * depending on which client reaches combat cleanup first; this predicate reads
 * the same persisted state at every finalization. Unlike wasDefeated, a kage who
 * fled counts as beaten — abandoning the challenge forfeits the seat.
 */
export const didKageChallengerWin = (
  challenger: BattleUserState,
  kage: BattleUserState,
): boolean => stillInBattle(challenger) && !stillInBattle(kage);

/**
 * Resolve the two sides of a Kage challenge: the challenger is always the
 * non-summon aggressor and the defending kage the non-summon defender, both from
 * the same village. Returns null for other battle types or inconsistent state.
 */
export const getKageChallengeParticipants = (
  battle: Pick<CompleteBattle, "battleType" | "usersState">,
): { challenger: KageChallengeSide; kage: KageChallengeSide } | null => {
  if (!["KAGE_AI", "KAGE_PVP"].includes(battle.battleType)) return null;
  const challenger = battle.usersState.find((u) => u.isAggressor && !u.isSummon);
  const kage = battle.usersState.find((u) => !u.isAggressor && !u.isSummon);
  if (!challenger || !kage) return null;
  if (!challenger.villageId || !kage.villageId) return null;
  if (challenger.villageId !== kage.villageId) return null;
  return {
    challenger: { ...challenger, villageId: challenger.villageId },
    kage: { ...kage, villageId: kage.villageId },
  };
};

type KageChallengeSide = BattleUserState & { villageId: string };

/**
 * Whether the given user takes the kage seat as a result of this battle: only a
 * winning Kage challenger does. A kage cannot also be an elder, so this gates the
 * ELDER to JONIN rank change applied during settlement; the defending kage and a
 * losing challenger keep their rank.
 */
export const didUserTakeKageSeat = (
  battle: Pick<CompleteBattle, "battleType" | "usersState" | "usersEffects">,
  userId: string,
): boolean => {
  const participants = getKageChallengeParticipants(battle);
  if (!participants) return false;
  const { challenger, kage } = participants;
  return challenger.userId === userId && didKageChallengerWin(challenger, kage);
};
