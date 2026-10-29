/**
 * Database access for combat; authorization and transaction scopes stay in callers.
 */
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
  type SQL,
  sql,
} from "drizzle-orm";
import { type AnyMySqlColumn, alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  BATTLE_ARENA_HEAL_COST,
  type BattleDataEntryType,
  type BattleType,
  type BattleTypes,
  type CombatBiome,
  type CombatStatName,
  HOSPITAL_LAT,
  HOSPITAL_LONG,
  HUNTING_REQUIRED_EXP,
  ITEM_LEVEL_CAP,
  KAGE_DEFENSE_GRACE_MINUTES,
  KAGE_MIN_DAYS_IN_VILLAGE,
  KAGE_PRESTIGE_REQUIREMENT,
  MAP_WAKE_ISLAND_SECTOR,
  MasteryNames,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  STEALTH_POST_COMBAT_COOLDOWN_SECONDS,
  type TimedMasteryName,
  type TrainingSpeed,
  VILLAGE_SYNDICATE_ID,
  WAR_RECAPTURE_THRESHOLD,
  WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL,
} from "@/drizzle/constants";
import {
  anbuSquad,
  type BattleAction,
  battle,
  battleAction,
  battleHistory,
  bounty,
  clan,
  conversation,
  dataBattleAction,
  dungeonRun,
  gameAsset,
  gameSetting,
  huntingProgress,
  huntingSession,
  jutsu,
  kageDefendedChallenges,
  logBattleLengths,
  mpvpBattleQueue,
  mpvpBattleUser,
  notification,
  quest,
  raidParticipation,
  rankedPvpQueue,
  type SectorType,
  sageMode,
  territoryWar,
  tournament,
  tournamentMatch,
  trainingLog,
  type UserData,
  userData,
  userItem,
  userItemImbuement,
  userJutsu,
  userPet,
  village,
  villageAlliance,
  war,
  warKill,
} from "@/drizzle/schema";
import { matchBloodrightSnapshot } from "@/libs/bloodright";
import { petsAllowedInBattle } from "@/libs/combat/pets";
import type { ActionEffect, CombatResult, CompleteBattle } from "@/libs/combat/types";
import type { CombatCacheSnapshot } from "@/libs/combat/userCache";
import { getVillage } from "@/libs/combat/util";
import type { DungeonBattleState } from "@/libs/dungeon";
import { fetchDmgConfig } from "@/libs/gamesettings";
import { withMercenaryParticipation } from "@/libs/objectiveWar";
import { petExperienceGainSql } from "@/libs/pets/experience";
import { getIsolatedPyramid } from "@/libs/questRun";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import type { TerritoryCompetitor } from "@/libs/territoryWar";
import type { RegenerationPeriod } from "@/libs/timedBuffs";
import { fetchAiProfileById } from "@/queries/ai";
import {
  activeWarAllyWhere,
  activeWarMercenaryWhere,
  extendWarParticipantSql,
  liftBracketImmunitySql,
  warRaidCombatGuard,
} from "@/queries/war";
import type { DrizzleClient } from "@/server/db";
import {
  activityCompletionExtras,
  completedQuestHistoryRelation,
  userQuestHistoryRelation,
} from "@/server/utils/achievementObjectives";
import { battleClaimRollbackStatus } from "@/server/utils/concurrency";
import {
  elementalSnapshotConditions,
  masteryGainUpdates,
} from "@/server/utils/masteryProgression";
import { resumeBracketImmunitySql } from "@/server/utils/objectiveWar";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import { questAttemptIsActive } from "@/server/utils/questEntry";
import { territoryWarBoostWindowsSql } from "@/server/utils/territoryWar";
import { periodStart, secondsFromDate, secondsFromNow } from "@/utils/time";
import type { EncounterWave } from "@/validators/coop";

/** Load the complete battle state by ID or return null; the read does not advance combat. */
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

/** Table alias for defender joins, keeping its columns distinct from other participants. */
const defender = alias(userData, "defender");

/** Table alias for attacker joins, keeping its columns distinct from other participants. */
const attacker = alias(userData, "attacker");

/** Build the `battleAction` listing for `getBattleEntries`, using the configured predicates. */
export const listBattleActionForGetBattleEntries = (
  client: Pick<DrizzleClient, "query">,
  limit: number,
  input: { offset?: undefined | number },
  conditions: SQL<unknown>[],
) =>
  client.query.battleAction.findMany({
    limit: limit,
    offset: input.offset ?? 0,
    where: and(...conditions),
    // Sort by round desc, then version desc for consistent ordering within rounds
    orderBy: [desc(battleAction.battleRound), desc(battleAction.battleVersion)],
  });

/** Build the `battleHistory` distinct selection for `getGraph`, using predicates on `battleType`. */
export const selectDistinctBattleHistoryForGetGraph = (
  client: Pick<DrizzleClient, "selectDistinct">,
  input: { userId: string },
  isDirectFight: undefined | SQL<unknown>,
) =>
  client
    .selectDistinct({
      userId: sql<string>`case when ${battleHistory.attackedId} = ${input.userId}
            then ${battleHistory.defenderId} else ${battleHistory.attackedId} end`,
    })
    .from(battleHistory)
    .innerJoin(attacker, eq(battleHistory.attackedId, attacker.userId))
    .innerJoin(defender, eq(battleHistory.defenderId, defender.userId))
    .where(and(eq(battleHistory.battleType, "COMBAT"), isDirectFight));

/** Build the `battleHistory` selection for `getGraph`, using predicates on `battleType`, `attackedId`, `defenderId`. */
export const selectBattleHistoryForGetGraph = (
  client: Pick<DrizzleClient, "select">,
  userIds: string[],
  isDirectFight: undefined | SQL<unknown>,
) =>
  client
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

/** Build the `battleHistory` lookup for `getBattleHistoryEntry`, using predicates on `battleId`. */
export const findBattleHistoryForGetBattleHistoryEntry = (
  client: Pick<DrizzleClient, "query">,
  input: { battleId: string },
) =>
  client.query.battleHistory.findFirst({
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

/**
 * Build the `battleHistory` listing for `getBattleHistory`, including predicates on
 * `attackedId`, `defenderId`, `createdAt`.
 */
export const listBattleHistoryForGetBattleHistory = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
  input: {
    secondsBack?: undefined | number;
    cursor?: undefined | null | Pick<SectorType, "id" | "createdAt">;
    combatTypes?: undefined | BattleType[];
    limit: number;
  },
) =>
  client.query.battleHistory.findMany({
    where: and(
      or(eq(battleHistory.attackedId, userId), eq(battleHistory.defenderId, userId)),
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

/** Build the `userData` update for `battleArenaHeal`, using predicates on `userId`, `status`, `money`. */
export const updateUserDataForBattleArenaHeal = (
  client: Pick<DrizzleClient, "update">,
  user: { maxHealth: number; maxStamina: number; maxChakra: number },
  ctx: { userId: string },
) =>
  client
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

/** Build the `userData` lookup for `startArenaBattle`, including predicates on `userId`, `isAi`, `isSummon`. */
export const findUserDataForStartArenaBattle = (
  client: Pick<DrizzleClient, "query">,
  input: { aiId: string },
) =>
  client.query.userData.findFirst({
    where: and(
      eq(userData.userId, input.aiId),
      eq(userData.isAi, true),
      eq(userData.isSummon, false),
      eq(userData.inArena, true),
    ),
  });

/**
 * Build the `userJutsu` update for `updateCombatLoadout`, setting `equipped`, using
 * predicates on `userId` and `jutsuId`.
 */
export const updateUserJutsuForUpdateCombatLoadout = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  invalidatedJutsuIds: string[],
) =>
  client
    .update(userJutsu)
    .set({ equipped: false })
    .where(
      and(
        eq(userJutsu.userId, ctx.userId),
        inArray(userJutsu.jutsuId, invalidatedJutsuIds),
      ),
    );

/** Build the `battle` update for `updateCombatLoadout`, using predicates on `id` and `version`. */
export const updateBattleForUpdateCombatLoadout = (
  client: Pick<DrizzleClient, "update">,
  userBattle: {
    usersState: import("@/libs/combat/types").BattleUserState[];
    usersEffects: import("@/libs/combat/types").UserEffect[];
    extraState: import("@/libs/combat/types").ExtraState;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    roundStartAt: Date;
  },
  input: { battleId: string },
) =>
  client
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
      and(eq(battle.id, input.battleId), eq(battle.version, userBattle.version - 1)),
    );

/** Build the `battle` update for `iAmHere`, using predicates on `id` and `version`. */
export const updateBattleForIAmHere = (
  client: Pick<DrizzleClient, "update">,
  userBattle: {
    usersState: import("@/libs/combat/types").BattleUserState[];
    version: number;
    createdAt: Date;
    updatedAt: Date;
    roundStartAt: Date;
  },
  input: { battleId: string },
) =>
  client
    .update(battle)
    .set({
      usersState: userBattle.usersState,
      version: userBattle.version,
      createdAt: userBattle.createdAt,
      updatedAt: userBattle.updatedAt,
      roundStartAt: userBattle.roundStartAt,
    })
    .where(
      and(eq(battle.id, input.battleId), eq(battle.version, userBattle.version - 1)),
    );

/** Build the `userData` update for `rememberPreference`, setting `defaultAutoCombat`, using predicates on `userId`. */
export const updateUserDataForRememberPreference = (
  client: Pick<DrizzleClient, "update">,
  input: { enabled: false | true },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ defaultAutoCombat: input.enabled })
    .where(eq(userData.userId, ctx.userId));

/** Build the `battle` update for `toggleAutoCombat`, using predicates on `id` and `version`. */
export const updateBattleForToggleAutoCombat = (
  client: Pick<DrizzleClient, "update">,
  userBattle: {
    usersState: import("@/libs/combat/types").BattleUserState[];
    version: number;
    updatedAt: Date;
  },
  input: { battleId: string },
) =>
  client
    .update(battle)
    .set({
      usersState: userBattle.usersState,
      version: userBattle.version,
      updatedAt: userBattle.updatedAt,
    })
    .where(
      and(eq(battle.id, input.battleId), eq(battle.version, userBattle.version - 1)),
    );

/**
 * Build the `userData` listing for `startShrineBattle`, selecting only `userId`, using
 * predicates on `isAi` and `inShrines`.
 */
export const listUserDataForStartShrineBattle = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.userData.findMany({
    where: and(eq(userData.isAi, true), eq(userData.inShrines, true)),
    columns: { userId: true },
  });

/** Execute the database statement for `listOngoingBattles`. */
export const executeResultsForListOngoingBattles = (
  client: Pick<DrizzleClient, "execute">,
  input: {
    battleType: BattleType;
    limit: number;
    offset: number;
  },
) =>
  client.execute(
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
              EXISTS (
                SELECT 1 FROM TournamentMatch
                WHERE TournamentMatch.battleId = Battle.id
              )
            )
          ORDER BY Battle.createdAt DESC
          LIMIT ${input.limit} OFFSET ${input.offset}
        `,
  );

/** Build the `userData` listing for `queryBattleUsers`, using predicates on `status` and `userId`. */
export const listUserDataForQueryBattleUsers = (
  client: Pick<DrizzleClient, "query">,
  userIds: string[],
  allyAiIds: string[],
  targetIds: string[],
) =>
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
      attributes: true,
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
      userQuests: userQuestHistoryRelation,
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

/** Build the `gameAsset` listing for `initiateBattle`, using predicates on `hidden` and `onInitialBattleField`. */
export const listGameAssetForInitiateBattle = (client: Pick<DrizzleClient, "query">) =>
  client.query.gameAsset.findMany({
    where: and(eq(gameAsset.hidden, false), eq(gameAsset.onInitialBattleField, true)),
  });

/**
 * Build the `battleHistory` selection for `initiateBattle`, including predicates on
 * `attackedId`, `defenderId`, `createdAt`.
 */
export const selectBattleHistoryForInitiateBattle = (
  client: Pick<DrizzleClient, "select">,
  userIds: string[],
  targetIds: string[],
) =>
  client
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
            .innerJoin(tournament, eq(tournament.id, tournamentMatch.tournamentId))
            .where(
              and(
                eq(tournamentMatch.userId1, battleHistory.attackedId),
                eq(tournamentMatch.battleId, battleHistory.battleId),
                eq(tournament.type, "EVENT"),
              ),
            ),
        ),
      ),
    );

/** Build the `userItem` listing for `initiateBattle`, including predicates on `userId`, `itemId`, `quantity`. */
export const listUserItemForInitiateBattle = (
  client: Pick<DrizzleClient, "query">,
  userIds: string[],
  targetIds: string[],
  itemIds: string[],
) =>
  client.query.userItem.findMany({
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
  });

/** Build the `jutsu` listing for `initiateBattle`, using predicates on `injectableInBattle`. */
export const listJutsuForInitiateBattle2 = (client: Pick<DrizzleClient, "query">) =>
  client.query.jutsu.findMany({ where: eq(jutsu.injectableInBattle, true) });

/**
 * Build the `quest` lookup for `initiateBattle`, selecting only
 * `raidBossCurrentHealth` and `raidBossMaxHealth`, using predicates on `id`.
 */
export const findQuestForInitiateBattle = (
  client: Pick<DrizzleClient, "query">,
  info: { raidQuestId: string },
) =>
  client.query.quest.findFirst({
    where: eq(quest.id, info.raidQuestId),
    columns: { raidBossCurrentHealth: true, raidBossMaxHealth: true },
  });

/**
 * Build the `raidParticipation` listing for `initiateBattle`, selecting only `userId`
 * and `battleCount`, using predicates on `questId` and `userId`.
 */
export const listRaidParticipationForInitiateBattle = (
  client: Pick<DrizzleClient, "query">,
  info: { raidQuestId: string },
  userIds: string[],
  targetIds: string[],
) =>
  client.query.raidParticipation.findMany({
    where: and(
      eq(raidParticipation.questId, info.raidQuestId),
      inArray(raidParticipation.userId, [...new Set([...userIds, ...targetIds])]),
    ),
    columns: { userId: true, battleCount: true },
  });

/**
 * Build the `tournament` listing for `initiateBattle`, selecting only `eventData`,
 * using predicates on `type` and `status`.
 */
export const listTournamentForInitiateBattle = (client: Pick<DrizzleClient, "query">) =>
  client.query.tournament.findMany({
    where: and(
      eq(tournament.type, "EVENT"),
      inArray(tournament.status, ["OPEN", "IN_PROGRESS"]),
    ),
    columns: { eventData: true },
    limit: 100,
  });

/** Build the `userPet` listing for `initiateBattle`, using predicates on `userId`. */
export const listUserPetForInitiateBattle = (
  client: Pick<DrizzleClient, "query">,
  userIds: string[],
  targetIds: string[],
) =>
  client.query.userPet.findMany({
    where: inArray(userPet.userId, [...userIds, ...targetIds]),
    with: { species: true },
  });

/** Build the `jutsu` listing for `initiateBattle`, using predicates on `userId` and `jutsuIds`. */
export const listJutsuForInitiateBattle3 = (
  client: Pick<DrizzleClient, "query" | "select">,
  userIds: string[],
  targetIds: string[],
) =>
  client.query.jutsu.findMany({
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
  });

/** Build the `sageMode` listing for `initiateBattle`, using predicates on `id`. */
export const listSageModeForInitiateBattle = (
  client: Pick<DrizzleClient, "query">,
  missingSageIds: string[],
) =>
  client.query.sageMode.findMany({
    where: inArray(sageMode.id, missingSageIds),
  });

/** Build the `battle` insert for `createBattle`. */
export const insertBattleForCreateBattle = (
  client: Pick<DrizzleClient, "insert">,
  battleId: string,
  battleType: BattleType,
  background: CombatBiome,
  usersState: import("@/libs/combat/types").BattleUserState[],
  userEffects: import("@/libs/combat/types").UserEffect[],
  groundEffects: import("@/libs/combat/types").BattleEffect[],
  gridSize: { width: number; height: number },
  extraState: import("@/libs/combat/types").ExtraState,
  profileCacheSnapshots: { [k: string]: CombatCacheSnapshot },
  pvpExperienceScaling: undefined | number,
  previousBattleResults: null | { count: number }[],
  energyRegeneration: { [k: string]: number },
  energyRegenerationPeriods: { [k: string]: RegenerationPeriod[] },
  energyCapacity: { [k: string]: number },
  injectableJutsus: import("@/drizzle/schema").Jutsu[],
  dmgConfig: import("@/libs/combat/constants").DmgConfig,
  settings: import("@/drizzle/schema").GameSetting[],
  initialDurability: Record<string, Record<string, number>>,
  info: {
    hunting?: undefined | import("@/validators/hunting").HuntingBattleState;
    questBattleSource?: undefined | { questId: string; objectiveId: string };
    warCamp?: undefined | import("@/drizzle/schema").WarCamp;
    raidQuestId?: undefined | string;
    forceKeepPools?: undefined | false | true;
  },
  territoryWarEvent:
    | undefined
    | null
    | import("@/drizzle/schema").TerritoryWar
    | import("@/drizzle/schema").TerritoryWar,
  territoryCompetitors: { [k: string]: TerritoryCompetitor },
  raidInitialBossHp: undefined | number,
  raidParticipations:
    | never[]
    | Pick<import("@/drizzle/schema").RaidParticipation, "userId" | "battleCount">[],
  sectorExclusiveRaids: never[] | import("@/drizzle/schema").Quest[],
  rankedTopPlayersLP: number[],
  rewardScaling: number,
  startTime: Date,
  activeUserId: undefined | string,
) =>
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
  });

/** Build the `battleHistory` insert for `createBattle`. */
export const insertBattleHistoryForCreateBattle = (
  client: Pick<DrizzleClient, "insert">,
  userIds: string[],
  targetIds: string[],
  battleId: string,
  battleType: BattleType,
) =>
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
  );

/** Build the `userData` update for `createBattle`, including predicates on `userId`, `activePetId`, `petTask`. */
export const updateUserDataForCreateBattle = (
  client: DrizzleClient,
  queueUpdate: Record<string, SQL<unknown>>,
  battleId: string,
  info: {
    tournamentGame?: undefined | { id: string; battleId: string; aiOnly: false | true };
    hunting?: undefined | import("@/validators/hunting").HuntingBattleState;
    questAttempt?: undefined | import("@/drizzle/schema").UserQuest;
    kageMatch?:
      | undefined
      | {
          id: string;
          villageId: string;
          kageId: string;
          tenure: string;
          battleId: string;
          ai: false | true;
          instantRequest?: undefined | { id: string; scheduledAt: string };
        };
    territoryWar?: undefined | import("@/drizzle/schema").TerritoryWar;
    clanBattle?: undefined | { queueId: string; battleId: string };
    questBattleSource?: { questId: undefined | string } | undefined;
  },
  battleType: BattleType,
  userIds: string[],
  stealthBreakUserIds: string[],
  warAggressorIds: string[],
  bracketImmunityAggressorIds: string[],
  allParticipantIds: string[],
  fetchedUsers: Pick<UserData, "userId" | "activePetId" | "petTask">[],
  sector: undefined | number,
  huntingEquipment: Pick<
    import("@/drizzle/schema").UserItem,
    "id" | "quantity" | "equipped" | "durability"
  >[],
  partyQuestSnapshots: Pick<
    import("@/drizzle/schema").BattleAction,
    "updatedAt" | "userId"
  >[],
  users: Pick<
    UserData,
    | "userId"
    | "role"
    | "rank"
    | "isAi"
    | "isOutlaw"
    | "clanId"
    | "villageId"
    | "bloodlineId"
    | "bloodright"
  >[],
  queuedParticipants: { original: import("@/drizzle/schema").UserData }[],
  questEncounter:
    | undefined
    | {
        kind: "quest";
        battleId: string;
        id: string;
        quest: import("@/drizzle/schema").Quest;
        tracker: import("@/validators/objectives").QuestTrackerType;
      },
  dungeonEncounter:
    | undefined
    | (Omit<DungeonBattleState, "lastActionRound"> & {
        kind: "dungeon";
        battleId: string;
        waves: EncounterWave[];
      }),
  longitude: undefined | number,
  latitude: undefined | number,
) =>
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
              users.find((u) => u.userId === info.questAttempt?.userId)?.role ?? "USER",
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
          ? [eq(userData.questPartyId, questEncounter.id), eq(userData.status, "AWAKE")]
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
                ...(longitude !== undefined ? [eq(userData.longitude, longitude)] : []),
                ...(latitude !== undefined ? [eq(userData.latitude, latitude)] : []),
              ),
            ]
          : []),
      ),
    );

/**
 * Build the `tournamentMatch` update for `createBattle`, setting `battleId`, using
 * predicates on `userId1` and `userId2`.
 */
export const updateTournamentMatchForCreateBattle = (
  client: Pick<DrizzleClient, "update">,
  battleId: string,
  userIds: string[],
  targetIds: string[],
) =>
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
    );

/**
 * Build the `village` update for `initiateBattle`, setting `kageScheduleVersion`,
 * including predicates on `id`, `kageId`, `leaderUpdatedAt`.
 */
export const updateVillageForInitiateBattle = (
  client: Pick<DrizzleClient, "update" | "select">,
  m: {
    instantRequest?: { id: undefined | string } | undefined;
    villageId: string;
    kageId: string;
    tenure: string;
    id: string;
    ai: false | true;
  },
  launchAt: Date,
) =>
  client
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
          client
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

/** Build the `kageDefendedChallenges` update for `initiateBattle`, including predicates on `id`, `status`, `kageId`. */
export const updateKageDefendedChallengesForInitiateBattle = (
  client: Pick<DrizzleClient, "update">,
  battleId: string,
  launchAt: Date,
  m: {
    id: string;
    kageId: string;
    tenure: string;
    instantRequest?: { id: undefined | string; scheduledAt: string } | undefined;
    ai: false | true;
  },
) =>
  client
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

/**
 * Build the `huntingSession` update for `initiateBattle`, setting `battleId` and
 * `version`, including predicates on `userId`, `id`, `version`.
 */
export const updateHuntingSessionForInitiateBattle = (
  client: Pick<DrizzleClient, "update">,
  battleId: string,
  meta: {
    userId: string;
    sessionId: string;
    sessionVersion: number;
    contract: { id: string };
    habitatId: string;
    progressVersion: number;
  },
  sector: undefined | number,
) =>
  client
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

/** Build the `userData` listing for `initiateBattle`, selecting only `userId`, using predicates on `battleId`. */
export const listUserDataForInitiateBattle = (
  client: Pick<DrizzleClient, "query">,
  battleId: string,
) =>
  client.query.userData.findMany({
    columns: { userId: true },
    where: eq(userData.battleId, battleId),
  });

/** Build the `trainingLog` insert for `initiateBattle`. */
export const insertTrainingLogForInitiateBattle = (
  client: Pick<DrizzleClient, "insert">,
  logs: (
    | {
        userId: string;
        stat: CombatStatName;
        amount: number;
        speed: TrainingSpeed;
        trainingFinishedAt: Date;
      }
    | {
        userId: string;
        stat: TimedMasteryName;
        amount: number;
        speed: TrainingSpeed;
        trainingFinishedAt: Date;
      }
  )[],
) => client.insert(trainingLog).values(logs);

/** Build the `userData` update for `initiateBattle`, using predicates on `battleId`. */
export const updateUserDataForInitiateBattle = (
  client: DrizzleClient,
  info: {
    questAttempt?: { isolated?: undefined | false | true; userId: string } | undefined;
    clanBattle?: undefined | { queueId: string; battleId: string };
  },
  battleType: BattleType,
  battleId: string,
) =>
  client
    .update(userData)
    .set({
      status: info.questAttempt?.isolated
        ? sql`CASE WHEN ${userData.userId} = ${info.questAttempt.userId} THEN 'BATTLE' ELSE ${battleClaimRollbackStatus(client, battleType, info.clanBattle)} END`
        : battleClaimRollbackStatus(client, battleType, info.clanBattle),
      bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
      bracketImmunityPausedAt: null,
      battleId: null,
    })
    .where(eq(userData.battleId, battleId));

/** Build the `battle` deletion, using predicates on `id`. */
export const deleteBattleById = (
  client: Pick<DrizzleClient, "delete">,
  battleId: string,
) => client.delete(battle).where(eq(battle.id, battleId));

/** Build the `battleHistory` deletion, using predicates on `battleId`. */
export const deleteBattleHistoryByBattleId = (
  client: Pick<DrizzleClient, "delete">,
  battleId: string,
) => client.delete(battleHistory).where(eq(battleHistory.battleId, battleId));

/** Build the `userData` listing for `processUsersForBattle`, using predicates on `userId`. */
export const listUserDataForProcessUsersForBattle = (
  client: Pick<DrizzleClient, "query">,
  missingSummonIds: string[],
) =>
  client.query.userData.findMany({
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

/** Combat usage counters recorded for an action, including its optional related bloodline. */
export type DataBattleAction = {
  type: (typeof BattleDataEntryType)[number];
  contentId: string;
  battleType: (typeof BattleTypes)[number];
  battleWon: number;
  relatedBloodlineId?: string;
};

/** Build a version-guarded battle deletion so settlement cannot remove a newer battle snapshot. */
export const deleteBattleIfVersionMatches = (
  client: Pick<DrizzleClient, "delete">,
  newBattle: { id: string },
  fetchedVersion: number,
) =>
  client
    .delete(battle)
    .where(and(eq(battle.id, newBattle.id), eq(battle.version, fetchedVersion)));

/** Build the `battle` update for `updateBattleState`, using predicates on `id` and `version`. */
export const updateBattleForUpdateBattleState = (
  client: Pick<DrizzleClient, "update">,
  newBattle: {
    version: number;
    createdAt: Date;
    updatedAt: Date;
    usersState: import("@/libs/combat/types").BattleUserState[];
    usersEffects: import("@/libs/combat/types").UserEffect[];
    groundEffects: import("@/libs/combat/types").BattleEffect[];
    extraState: import("@/libs/combat/types").ExtraState;
    activeUserId: null | string;
    roundStartAt: Date;
    round: number;
    id: string;
  },
  fetchedVersion: number,
) =>
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
    .where(and(eq(battle.id, newBattle.id), eq(battle.version, fetchedVersion)));

/** Build the `logBattleLengths` insert for `finishBattle`, updating duplicate keys. */
export const insertLogBattleLengthsForFinishBattle = (
  client: Pick<DrizzleClient, "insert">,
  newBattle: {
    battleType: BattleType;
    round: number;
  },
  user: { level: number },
  other: { level: number },
) =>
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
    });

/** Build the `mpvpBattleUser` deletion for `finishBattle`, using predicates on `clanBattleId`, `id`, `battleId`. */
export const deleteMpvpBattleUserForFinishBattle = (
  client: Pick<DrizzleClient, "delete" | "select">,
  newBattle: { id: string },
) =>
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
    );

/** Build the `userData` update for `finishBattle`, using predicates on `userId` and `battleId`. */
export const updateUserDataForFinishBattle = (
  client: Pick<DrizzleClient, "update">,
  combatEnergyRecoverySql: (
    snapshot?: CompleteBattle,
    userId?: string,
    reward?: number,
    settledAt?: Date,
  ) => SQL<unknown>,
  newBattle: import("@/libs/combat/types").CompleteBattle,
  teammate: {
    userId: string;
    curHealth: number;
    curStamina: number;
    curChakra: number;
    allyVillage: false | true;
    sector: number;
    villageId: null | string;
  },
  sendToHospital: false | true,
) =>
  client
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
      and(eq(userData.userId, teammate.userId), eq(userData.battleId, newBattle.id)),
    );

/** Build the `mpvpBattleQueue` deletion for `finishBattle`, using predicates on `battleId`. */
export const deleteMpvpBattleQueueForFinishBattle = (
  client: Pick<DrizzleClient, "delete">,
  newBattle: { id: string },
) => client.delete(mpvpBattleQueue).where(eq(mpvpBattleQueue.battleId, newBattle.id));

/** Build the `dataBattleAction` insert for `saveUsage`, updating duplicate keys. */
export const insertDataBattleActionForSaveUsage = (
  client: Pick<DrizzleClient, "insert">,
  uniqueData: DataBattleAction[],
) =>
  client
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

/** Build the `mpvpBattleQueue` selection for `createAction`, using predicates on `battleId` and `battleType`. */
export const selectMpvpBattleQueueForCreateAction = (
  client: Pick<DrizzleClient, "select">,
  entry: BattleAction,
  newBattle: { id: string },
) =>
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
    .$dynamic();

/** Build the `battleAction` insert from the supplied selections for `createAction`, updating duplicate keys. */
export const insertBattleActionForCreateAction = (
  client: Pick<DrizzleClient, "insert">,
  selections: ReturnType<typeof selectMpvpBattleQueueForCreateAction>[],
) =>
  client
    .insert(battleAction)
    .select(selections.reduce((combined, next) => combined.unionAll(next)))
    .onDuplicateKeyUpdate({ set: { id: sql`${battleAction.id}` } });

/** Build the `battleAction` insert for `createAction`, updating duplicate keys. */
export const insertBattleActionForCreateAction2 = (
  client: Pick<DrizzleClient, "insert">,
  actions: import("@/drizzle/schema").BattleAction[],
) =>
  client
    .insert(battleAction)
    .values(actions)
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `kageDefendedChallenges` update for `completeKageDefense`, using predicates on `id`, `status`, `battleId`. */
export const updateKageDefendedChallengesForCompleteKageDefense = (
  client: Pick<DrizzleClient, "update">,
  won: false | true,
  curBattle: { round: number; id: string },
  match: { id: string },
) =>
  client
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

/** Build the `kageDefendedChallenges` insert for `updateKage`, updating duplicate keys. */
export const insertKageDefendedChallengesForUpdateKage = (
  client: Pick<DrizzleClient, "insert">,
  curBattle: { id: string; createdAt: Date; round: number },
  challenger: { villageId: string; userId: string },
  defenderId: string,
  challengerDidWin: false | true,
) =>
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
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `village` update for `updateKage`, using predicates on `id`, `kageId`, `leaderUpdatedAt`. */
export const updateVillageForUpdateKage = (
  client: Pick<DrizzleClient, "update">,
  challenger: { userId: string; villageId: string },
  defenderId: string,
  curBattle: {
    extraState: {
      kageMatch?:
        | undefined
        | {
            id: string;
            villageId: string;
            kageId: string;
            tenure: string;
            ai: false | true;
          };
    };
  },
) =>
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
    );

/** Build the `userItemImbuement` deletion for `updateKage`, using predicates on `userItemId`. */
export const deleteUserItemImbuementForUpdateKage = (
  client: Pick<DrizzleClient, "delete">,
  deleteItems: string[],
) =>
  client
    .delete(userItemImbuement)
    .where(inArray(userItemImbuement.userItemId, deleteItems));

/** Build the `userItem` update for `updateKage`, setting `quantity`, using predicates on `id` and `quantity`. */
export const updateUserItemForUpdateKage = (
  client: Pick<DrizzleClient, "update">,
  ui: { quantity: number; id: string },
) =>
  client
    .update(userItem)
    .set({ quantity: ui.quantity })
    .where(and(eq(userItem.id, ui.id), gt(userItem.quantity, 0)));

/** Build the `clan` update for `updateClanLeaders`, using predicates on `id`. */
export const updateClanForUpdateClanLeaders = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string; clanId: string },
) =>
  client
    .update(clan)
    .set({
      leaderId: user.userId,
      coLeader1: sql`CASE WHEN ${clan.coLeader1} = ${user.userId} THEN NULL ELSE ${clan.coLeader1} END`,
      coLeader2: sql`CASE WHEN ${clan.coLeader2} = ${user.userId} THEN NULL ELSE ${clan.coLeader2} END`,
      coLeader3: sql`CASE WHEN ${clan.coLeader3} = ${user.userId} THEN NULL ELSE ${clan.coLeader3} END`,
    })
    .where(eq(clan.id, user.clanId));

/** Build the `village` update for `updateClanLeaders`, setting `kageId`, using predicates on `id` and `type`. */
export const updateVillageForUpdateClanLeaders = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string; villageId: null | string },
) =>
  client
    .update(village)
    .set({ kageId: user.userId })
    .where(
      and(
        eq(village.id, user.villageId ?? VILLAGE_SYNDICATE_ID),
        or(eq(village.type, "HIDEOUT"), eq(village.type, "STRONGHOLD")),
      ),
    );

/** Build the `warKill` insert for `updateWars`. */
export const insertWarKillForUpdateWars = (
  client: Pick<DrizzleClient, "insert">,
  w: { id: string },
  user: { userId: string; villageId: null | string; sector: number },
  warResult: { target: { userId: string; villageId: null | string } },
  logShrineHpChange: number,
  result: { warHealthChange: number },
) =>
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
  });

/** Build the `war` update for `updateWars`, setting `defenderShrineHp`, using predicates on `id` and `endedAt`. */
export const updateWarForUpdateWars = (
  client: Pick<DrizzleClient, "update">,
  result: { shrineChangeHp: number },
  w: { id: string },
) =>
  client
    .update(war)
    .set({
      defenderShrineHp: sql`GREATEST(LEAST(defenderShrineHp + ${result.shrineChangeHp}, defenderShrineMaxHp), 0)`,
    })
    .where(and(eq(war.id, w.id), isNull(war.endedAt), warRaidCombatGuard()));

/** Build the `war` update for `updateWars`, setting `attackerWarHealth`, using predicates on `id` and `endedAt`. */
export const updateWarForUpdateWars2 = (
  client: Pick<DrizzleClient, "update">,
  result: { warHealthChange: number },
  w: { id: string },
) =>
  client
    .update(war)
    .set({
      attackerWarHealth: sql`GREATEST(LEAST(attackerWarHealth + ${result.warHealthChange}, attackerWarHealthMax), 0)`,
    })
    .where(and(eq(war.id, w.id), isNull(war.endedAt), warRaidCombatGuard()));

/** Build the `war` update for `updateWars`, setting `defenderWarHealth`, using predicates on `id` and `endedAt`. */
export const updateWarForUpdateWars3 = (
  client: Pick<DrizzleClient, "update">,
  result: { warHealthChange: number },
  w: { id: string },
) =>
  client
    .update(war)
    .set({
      defenderWarHealth: sql`GREATEST(LEAST(defenderWarHealth + ${result.warHealthChange}, defenderWarHealthMax), 0)`,
    })
    .where(and(eq(war.id, w.id), isNull(war.endedAt), warRaidCombatGuard()));

/** Build the `quest` update for `updateWars`, using predicates on `id`. */
export const updateQuestForUpdateWars = (
  client: Pick<DrizzleClient, "update">,
  m: {
    raidEndsAt: Date;
    raidCaptureDeadline: Date;
    raidBossCurrentHealth: number;
    raidId: string;
  },
) =>
  client
    .update(quest)
    .set({
      raidEndsAt: m.raidEndsAt,
      raidCaptureDeadline: m.raidCaptureDeadline,
      raidGracePeriodEnd: null,
      raidBossCurrentHealth: m.raidBossCurrentHealth,
    })
    .where(eq(quest.id, m.raidId));

/** Build the `war` update for `recoverWarShrine`, setting `` and ``, using the configured predicates. */
export const updateWarForRecoverWarShrine = (
  client: Pick<DrizzleClient, "update">,
  columns: {
    hp: "attackerShrineHp" | "defenderShrineHp";
    status: "attackerShrineStatus" | "defenderShrineStatus";
  },
  recoveredHp: SQL<unknown>,
  activeWar: undefined | SQL<unknown>,
  status:
    | typeof import("@/drizzle/schema").war["attackerShrineStatus"]
    | typeof import("@/drizzle/schema").war["defenderShrineStatus"],
  hp:
    | typeof import("@/drizzle/schema").war["attackerShrineHp"]
    | typeof import("@/drizzle/schema").war["defenderShrineHp"],
  change: number,
  maxHp:
    | typeof import("@/drizzle/schema").war["attackerShrineMaxHp"]
    | typeof import("@/drizzle/schema").war["defenderShrineMaxHp"],
) =>
  client
    .update(war)
    .set({ [columns.hp]: recoveredHp, [columns.status]: "ACTIVE" })
    .where(
      and(
        activeWar,
        eq(status, "CAPTURED"),
        sql`${hp} + ${change} > ${maxHp} * ${WAR_RECAPTURE_THRESHOLD}`,
      ),
    );

/** Build the `war` update for `recoverWarShrine`, setting ``, using the configured predicates. */
export const updateWarForRecoverWarShrine2 = (
  client: Pick<DrizzleClient, "update">,
  columns: {
    warHealth: "attackerWarHealth" | "defenderWarHealth";
    warHealthMax: "attackerWarHealthMax" | "defenderWarHealthMax";
  },
  activeWar: undefined | SQL<unknown>,
) =>
  client
    .update(war)
    .set({
      [columns.warHealth]: sql`LEAST(${war[columns.warHealth]} + ${WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL}, ${war[columns.warHealthMax]})`,
    })
    .where(activeWar);

/** Build the `war` update for `recoverWarShrine`, setting ``, using the configured predicates. */
export const updateWarForRecoverWarShrine3 = (
  client: Pick<DrizzleClient, "update">,
  columns: { hp: "attackerShrineHp" | "defenderShrineHp" },
  recoveredHp: SQL<unknown>,
  activeWar: undefined | SQL<unknown>,
) =>
  client
    .update(war)
    .set({ [columns.hp]: recoveredHp })
    .where(activeWar);

/**
 * Build the `tournamentMatch` update for `updateTournament`, setting `state` and
 * `winnerId`, using predicates on `id`, `battleId`, `state`.
 */
export const updateTournamentMatchForUpdateTournament = (
  client: Pick<DrizzleClient, "update">,
  result: { outcome: "Draw" | "Won" | "Lost" | "Fled"; didWin: number },
  user: { userId: string },
  target: { userId: string },
  curBattle: { extraState: { tournamentGameId: string }; id: string },
) =>
  client
    .update(tournamentMatch)
    .set({
      state: "PLAYED",
      winnerId:
        result.outcome === "Draw" ? null : result.didWin ? user.userId : target.userId,
    })
    .where(
      and(
        eq(tournamentMatch.id, curBattle.extraState.tournamentGameId),
        eq(tournamentMatch.battleId, curBattle.id),
        eq(tournamentMatch.state, "WAITING"),
      ),
    );

/** Build the `tournamentMatch` update for `updateTournament`, setting `winnerId`, using predicates on `battleId`. */
export const updateTournamentMatchForUpdateTournament2 = (
  client: Pick<DrizzleClient, "update">,
  result: { didWin: number },
  user: { userId: string },
  target: { userId: string },
  curBattle: { id: string },
) =>
  client
    .update(tournamentMatch)
    .set({ winnerId: result.didWin ? user.userId : target.userId })
    .where(eq(tournamentMatch.battleId, curBattle.id));

/** Build the `anbuSquad` update for `updateVillageAnbuClan`, setting `pvpActivity`, using predicates on `id`. */
export const updateAnbuSquadForUpdateVillageAnbuClan = (
  client: Pick<DrizzleClient, "update">,
  user: { anbuId: string },
) =>
  client
    .update(anbuSquad)
    .set({ pvpActivity: sql`${anbuSquad.pvpActivity} + 1` })
    .where(eq(anbuSquad.id, user.anbuId));

/** Build the `clan` update for `updateVillageAnbuClan`, using predicates on `id`. */
export const updateClanForUpdateVillageAnbuClan = (
  client: Pick<DrizzleClient, "update">,
  result: { clanPoints: number },
  user: { clanId: string },
) =>
  client
    .update(clan)
    .set({
      pvpActivity: sql`${clan.pvpActivity} + 1`,
      points: sql`${clan.points} + ${result.clanPoints}`,
      activityPoints: sql`${clan.activityPoints} + ${result.clanPoints}`,
    })
    .where(eq(clan.id, user.clanId));

/** Build the `raidParticipation` insert for `updateRaidProgress`. */
export const insertRaidParticipationForUpdateRaidProgress = (
  client: Pick<DrizzleClient, "insert">,
  raidQuestId: string,
  userId: string,
  userDamage: number,
) =>
  client.insert(raidParticipation).values({
    id: nanoid(),
    questId: raidQuestId,
    userId: userId,
    damageDealt: userDamage,
    battleCount: 1,
    rewardsClaimed: [],
  });

/** Build the `raidParticipation` update for `updateRaidProgress`, using predicates on `questId`, `userId`, `battleCount`. */
export const updateRaidParticipationForUpdateRaidProgress = (
  client: Pick<DrizzleClient, "update">,
  userDamage: number,
  raidQuestId: string,
  userId: string,
  startBattleCount: number,
) =>
  client
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

/**
 * Build the `quest` update for `updateRaidProgress`, setting `raidBossCurrentHealth`,
 * using predicates on `id` and `questType`.
 */
export const updateQuestForUpdateRaidProgress = (
  client: Pick<DrizzleClient, "update">,
  userDamage: number,
  raidQuestId: string,
) =>
  client
    .update(quest)
    .set({
      raidBossCurrentHealth: sql`GREATEST(0, ${quest.raidBossCurrentHealth} - ${userDamage})`,
    })
    .where(and(eq(quest.id, raidQuestId), eq(quest.questType, "raid")));

/**
 * Build the `quest` lookup for `updateRaidProgress`, selecting only
 * `raidBossCurrentHealth` and `name`, using predicates on `id`.
 */
export const findQuestForUpdateRaidProgress = (
  client: Pick<DrizzleClient, "query">,
  raidQuestId: string,
) =>
  client.query.quest.findFirst({
    where: eq(quest.id, raidQuestId),
    columns: { raidBossCurrentHealth: true, name: true },
  });

/** Build the `notification` insert for `updateRaidProgress`. */
export const insertNotificationForUpdateRaidProgress = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  raidName: string,
) =>
  client.insert(notification).values([
    {
      userId,
      content: `The boss in ${raidName} has been defeated! Check if you've earned any rewards.`,
    },
  ]);

/** Build the `userData` update for `updateUser`, using predicates on `userId` and `battleId`. */
export const updateUserDataForUpdateUser = (
  client: Pick<DrizzleClient, "update">,
  settledAt: Date,
  combatEnergyRecoverySql: (
    snapshot?: CompleteBattle,
    userId?: string,
    reward?: number,
    settledAt?: Date,
  ) => SQL<unknown>,
  curBattle: import("@/libs/combat/types").CompleteBattle,
  userId: string,
) =>
  client
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

/** Build the `bounty` update for `updateUser`, using predicates on `id` and `status`. */
export const updateBountyForUpdateUser = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  result: {
    bountiesClaimed: { bountyId: string; hunterId: string; amountRyo: number }[];
  },
) =>
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
    );

/**
 * Build the `userItem` update for `updateUser`, setting `quantity` and `durability`,
 * using predicates on `userId`, `id`, `quantity`.
 */
export const updateUserItemForUpdateUser = (
  client: Pick<DrizzleClient, "update">,
  updateItems: import("@/libs/combat/types").BattleUserItem[],
  settlingHunt: false | true,
  userId: string,
) =>
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
    );

/** Execute the database statement for `updateUser`. */
export const executeRowsForUpdateUser = (
  client: Pick<DrizzleClient, "execute">,
  jExp: number,
  xpToLevel: SQL<unknown>,
  user: { userId: string },
  cap: number,
  ids: string[],
) =>
  client.execute(sql`
              UPDATE ${userJutsu}
              SET ${userJutsu.experience} = IF(${userJutsu.experience} + ${jExp} >= ${xpToLevel}, 0, ${userJutsu.experience} + ${jExp}),
                  ${userJutsu.level} = ${userJutsu.level} + (${userJutsu.experience} = 0)
              WHERE ${userJutsu.userId} = ${user.userId}
                AND ${userJutsu.level} < ${cap}
                AND ${inArray(userJutsu.jutsuId, ids)}
            `);

/** Build the `userItem` update for `updateUser`, using predicates on `userId`, `level`, `id`. */
export const updateUserItemForUpdateUser2 = (
  client: Pick<DrizzleClient, "update">,

  xpToLevel: number,
  iExp: number,
  user: { userId: string },
  ids: Set<string>,
) =>
  client
    .update(userItem)
    .set(xpGainOrLevelUpSet(userItem, xpToLevel, iExp))
    .where(
      and(
        eq(userItem.userId, user.userId),
        lt(userItem.level, ITEM_LEVEL_CAP),
        inArray(userItem.id, [...ids]),
      ),
    );

/** Build the `userData` update for `updateUser`, using predicates on `userId` and `battleId`. */
export const updateUserDataForUpdateUser2 = (
  client: Pick<DrizzleClient, "update">,
  combatEnergyRecoverySql: (
    snapshot?: CompleteBattle,
    userId?: string,
    reward?: number,
    settledAt?: Date,
  ) => SQL<unknown>,
  curBattle: import("@/libs/combat/types").CompleteBattle,
  userId: string,
  result: CombatResult,
  settledAt: Date,
  hasHumanOpponent: false | true,
  user: {
    sageModeUsedThisBattle?: undefined | false | true;
    allyVillage: false | true;
    sector: number;
    villageId: null | string;
  },
  updatedQuestData: import("@/validators/objectives").QuestTrackerType[],
  tookKageSeat: false | true,
  hydratedUser: Parameters<typeof getIsolatedPyramid>[0],
  confirmPetReward = false,
) =>
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
        : { status: getIsolatedPyramid(hydratedUser) ? "BATTLE" : "AWAKE" }),
      // Deactivate stealth and set cooldown after leaving combat (20 seconds)
      stealthActive: false,
      stealthActivatedAt: null,
      stealthCooldownAt: new Date(
        Math.floor(settledAt.getTime() / 1000) * 1000 +
          STEALTH_POST_COMBAT_COOLDOWN_SECONDS * 1000,
      ),
    })
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.battleId, curBattle.id),
        // Reuse the exact payout expression: this match proves the live companion
        // receives its positive XP grant in the same atomic account update.
        confirmPetReward
          ? gt(
              petExperienceGainSql(
                Math.round(result.experience) + Math.round(result.earnedExperience),
                curBattle.extraState.petIdsByOwner?.[userId] ?? null,
              ),
              userData.petExperience,
            )
          : undefined,
      ),
    );

/** Build the `userItem` insert for `updateUser`. */
export const insertUserItemForUpdateUser = (
  client: Pick<DrizzleClient, "insert">,
  result: { droppedItems: import("@/libs/combat/types").DroppedItem[] },
  user: { userId: string },
) =>
  client.insert(userItem).values(
    result.droppedItems.map((d) => ({
      id: nanoid(),
      userId: user.userId,
      itemId: d.itemId,
      equipped: "NONE" as const,
    })),
  );

/** Build the `conversation` insert for `joinCoopChat`, updating duplicate keys. */
export const insertConversationForJoinCoopChat = (
  client: Pick<DrizzleClient, "insert">,
  partyId: string,
  title: string,
  userId: string,
) =>
  client
    .insert(conversation)
    .values({
      id: partyId,
      title,
      createdById: userId,
      isPublic: false,
      isEnabled: true,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `userData` update for `cleanupCoopBattleStart`, using predicates on `userId` and `battleId`. */
export const updateUserDataForCleanupCoopBattleStart = (
  client: Pick<DrizzleClient, "update">,
  memberIds: string[],
  battleId: string,
) =>
  client
    .update(userData)
    .set({
      status: "AWAKE",
      battleId: null,
      bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
      bracketImmunityPausedAt: null,
      updatedAt: new Date(),
    })
    .where(and(inArray(userData.userId, memberIds), eq(userData.battleId, battleId)));

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
