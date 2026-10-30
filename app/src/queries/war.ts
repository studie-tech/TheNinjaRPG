/**
 * Database access for war; authorization and transaction scopes stay in callers.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  BRACKET_IMMUNITY_LIFT_SECS,
  FACTION_RAID_BOOST_HOURS,
  FACTION_RAID_FAILURE_COOLDOWN_HOURS,
  FACTION_RAID_MAX_DAYS,
  FACTION_RAID_STRUCTURE_HP,
  FACTION_RAID_TARGET_COOLDOWN_HOURS,
  IMG_AVATAR_DEFAULT,
  OBJECTIVE_WAR_ATTACKER_COOLDOWN_DAYS,
  OBJECTIVE_WAR_DEFEAT_PENALTY_LEVELS,
  OBJECTIVE_WAR_DEFENDER_COOLDOWN_DAYS,
  TERR_BOT_ID,
  WAR_CAMP_SCORE_PER_WIN,
  WAR_DECLARATION_COOLDOWN_HOURS,
  WAR_DECLARATION_COST,
  WAR_DEFEAT_STRUCTURE_PENALTY_LEVELS,
  WAR_DRAW_PENALTY_LEVELS,
  WAR_ESPIONAGE_TARGET,
  WAR_MERCENARY_RYO_PER_TOKEN,
  WAR_PARTICIPANT_SECS,
  WAR_POINT_CONVERSION_DAYS,
  WAR_POINT_PRESTIGE_RATE,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  WAR_RAID_SHRINE_HP,
  WAR_RESERVE_LOCKOUT_DAYS,
  WAR_SECTOR_LOSS_TOWNHALL_DAMAGE,
  WAR_VICTORY_BOOSTED_STRUCTURES,
  WAR_VICTORY_STRUCTURE_BOOST_LEVELS,
  WAR_WINNING_BOOST_REGEN_PERC,
  WAR_WINNING_BOOST_TRAINING_PERC,
} from "@/drizzle/constants";
import {
  actionLog,
  clan,
  dungeonMember,
  dungeonRun,
  gameSetting,
  mpvpBattleQueue,
  notification,
  quest,
  questHistory,
  sector,
  userData,
  userRequest,
  type Village,
  village,
  villageElderVote,
  villageStructure,
  type WarAlly,
  war,
  warActionReceipt,
  warAlly,
  warCamp,
  warContribution,
  warKill,
  warMercenary,
} from "@/drizzle/schema";
import { getShrineHpByLevel, isVillageInvolvedInAnyWar } from "@/libs/war";
import type { DrizzleClient } from "@/server/db";
import { DAY_S, secondsFromDate, secondsFromNow } from "@/utils/time";
import { defaultWarRules, type WarMissionAttempt } from "@/validators/war";

/**
 * Build the `war` update for `GET`, setting `attackerWarHealth` and
 * `defenderWarHealth`, using predicates on `id` and `endedAt`.
 */
export const updateWarForGET = (
  client: Pick<DrizzleClient, "update">,
  totalHealthDrain: number,
  activeWar: { id: string },
) =>
  client
    .update(war)
    .set({
      attackerWarHealth: sql`GREATEST(attackerWarHealth - ${totalHealthDrain}, 0)`,
      defenderWarHealth: sql`GREATEST(defenderWarHealth - ${totalHealthDrain}, 0)`,
    })
    .where(and(eq(war.id, activeWar.id), isNull(war.endedAt)));

/** Build a village token update from its settled war balance. */
export const updateWarVillageTokens = (
  client: Pick<DrizzleClient, "update">,
  tokens: number,
  villageId: string,
) => client.update(village).set({ tokens: tokens }).where(eq(village.id, villageId));

/** Build the `war` update for `GET`, using predicates on `id` and `endedAt`. */
export const updateWarForGET2 = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  totalHealthDrain: number,
  activeWar: { id: string },
) =>
  client
    .update(war)
    .set({
      lastTokenReductionAt: now,
      attackerWarHealth: sql`GREATEST(attackerWarHealth - ${totalHealthDrain}, 0)`,
      defenderWarHealth: sql`GREATEST(defenderWarHealth - ${totalHealthDrain}, 0)`,
    })
    .where(and(eq(war.id, activeWar.id), isNull(war.endedAt)));

/** Build a war declaration approval guarded by its pending status. */
export const approvePendingWarDeclaration = (
  client: Pick<DrizzleClient, "update">,
  voteId: string,
) =>
  client
    .update(villageElderVote)
    .set({ status: "APPROVED" })
    .where(
      and(eq(villageElderVote.id, voteId), eq(villageElderVote.status, "PENDING")),
    );

/** Build the `gameSetting` listing for `fetchWarRules`, using predicates on `name`. */
export const listGameSettingForFetchWarRules = (client: Pick<DrizzleClient, "query">) =>
  client.query.gameSetting.findMany({
    where: inArray(
      gameSetting.name,
      Object.keys(defaultWarRules).map((key) => `OBJECTIVE_WAR_${key}`),
    ),
  });

/** Build the `warActionReceipt` insert for `applyObjectiveWarAction`. */
export const insertWarActionReceiptForApplyObjectiveWarAction = (
  client: Pick<DrizzleClient, "insert">,
  action: { id: string },
  activeWar: { id: string },
) =>
  client
    .insert(warActionReceipt)
    .ignore()
    .values({ id: action.id, warId: activeWar.id });

/** Build the `warContribution` insert for `applyObjectiveWarAction`, updating duplicate keys. */
export const insertWarContributionForApplyObjectiveWarAction = (
  client: Pick<DrizzleClient, "insert">,
  activeWar: { id: string },
  action: { userId: string },
) =>
  client
    .insert(warContribution)
    .values({ warId: activeWar.id, userId: action.userId })
    .onDuplicateKeyUpdate({ set: { userId: sql`${warContribution.userId}` } });

/** Execute the database statement for `applyObjectiveWarAction`. */
export const executeClaimedForApplyObjectiveWarAction = (
  client: Pick<DrizzleClient, "execute">,
  action: {
    id: string;
    camp?: undefined | import("@/drizzle/schema").WarCamp;
    shrineDamage?: undefined | number;
    userId: string;
    sideVillageId: string;
    hasMercenarySnapshot?: undefined | false | true;
    damage?: undefined | number;
  },
  objective: undefined | import("@/validators/war").WarObjectiveState,
  damage: SQL<unknown>,
  recovery: SQL<unknown>,
  willDestroy: SQL<unknown>,
  canDamageShrine: SQL<unknown>,
  hp: SQL<unknown>,
  activeWar: { id: string },
  rules: { durationDays: number },

  destroyed: SQL<unknown>,
  spyPath: "$.attackerEspionage" | "$.defenderEspionage",
) =>
  client.execute(sql`
      UPDATE ${war} INNER JOIN ${warActionReceipt} ON ${warActionReceipt.id} = ${action.id}
      ${objective ? sql`LEFT JOIN ${sector} ON ${sector.sector} = ${objective.sector} AND ${sector.villageId} = ${objective.villageId}` : sql``}
      ${action.camp ? sql`INNER JOIN ${warCamp} ON ${warCamp.id} = ${action.camp.id} AND ${warCamp.warId} = ${war.id}` : sql``}
      SET ${war.id} = ${war.id}, ${warActionReceipt.applied} = TRUE,
          ${warActionReceipt.damage} = ${damage}, ${warActionReceipt.recovery} = ${recovery},
          ${warActionReceipt.captured} = ${willDestroy}
          ${objective ? sql`, ${sector.sector} = ${sector.sector}, ${warActionReceipt.shrineDamage} = CASE WHEN ${canDamageShrine} THEN LEAST(${hp}, ${action.shrineDamage ?? 0}) ELSE 0 END` : sql``}
      WHERE ${war.id} = ${activeWar.id} AND ${war.endedAt} IS NULL AND ${war.status} = 'ACTIVE'
        AND SYSDATE(3) < DATE_ADD(${war.combatStartedAt}, INTERVAL ${rules.durationDays} DAY)
        AND ${war.attackerWarHealth} > 0 AND ${war.defenderWarHealth} > 0
        AND EXISTS (SELECT 1 FROM UserData actor WHERE actor.userId = ${action.userId} AND actor.isAi = FALSE AND actor.isBanned = FALSE AND
          (actor.villageId = ${action.sideVillageId} OR EXISTS (SELECT 1 FROM WarAlly membership WHERE membership.warId = ${war.id} AND membership.villageId = actor.villageId AND membership.supportVillageId = ${action.sideVillageId} AND membership.acceptedAt IS NOT NULL AND membership.endedAt IS NULL)
            OR ${action.hasMercenarySnapshot ?? false}
            OR EXISTS (SELECT 1 FROM WarMercenary merc WHERE merc.warId = ${war.id} AND merc.userId = actor.userId AND merc.sideVillageId = ${action.sideVillageId} AND merc.acceptedAt IS NOT NULL AND merc.endedAt IS NULL)))
        AND ${warActionReceipt.applied} = FALSE
        AND ${objectiveWarCombatGuard()}
        ${objective && action.damage === undefined ? sql`AND ${sector.sector} IS NOT NULL AND NOT (${destroyed}) AND ${hp} > 0 AND CAST(JSON_EXTRACT(${war.objectiveState}, ${spyPath}) AS UNSIGNED) >= ${WAR_ESPIONAGE_TARGET}` : sql``}
        ${action.camp ? sql`AND ${warCamp.resolvedAt} IS NULL AND ${warCamp.startsAt} <= SYSDATE(3) AND ${warCamp.endsAt} > SYSDATE(3)` : sql``}
    `);

/** Execute the database statement for `applyObjectiveWarAction`. */
export const executeRowsForApplyObjectiveWarAction = (
  client: Pick<DrizzleClient, "execute">,
  action: {
    id: string;
    userId: string;
    camp?: undefined | import("@/drizzle/schema").WarCamp;
    espionage?: undefined | number;
  },
  objective: undefined | import("@/validators/war").WarObjectiveState,
  enemyHp:
    | typeof import("@/drizzle/schema").war["attackerWarHealth"]
    | typeof import("@/drizzle/schema").war["defenderWarHealth"],
  ownHp:
    | typeof import("@/drizzle/schema").war["attackerWarHealth"]
    | typeof import("@/drizzle/schema").war["defenderWarHealth"],
  ownMax:
    | typeof import("@/drizzle/schema").war["attackerWarHealthMax"]
    | typeof import("@/drizzle/schema").war["defenderWarHealthMax"],
  path: string,
  hp: SQL<unknown>,
  spyPath: "$.attackerEspionage" | "$.defenderEspionage",
  isAttacker: false | true,
  activeWar: { id: string },
) =>
  client.execute(sql`
      UPDATE ${war} INNER JOIN ${warActionReceipt} ON ${warActionReceipt.id} = ${action.id}
      INNER JOIN ${warContribution} ON ${warContribution.warId} = ${war.id} AND ${warContribution.userId} = ${action.userId}
      ${objective ? sql`LEFT JOIN ${sector} ON ${sector.sector} = ${objective.sector} AND ${sector.villageId} = ${objective.villageId}` : sql``}
      ${action.camp ? sql`INNER JOIN ${warCamp} ON ${warCamp.id} = ${action.camp.id} AND ${warCamp.warId} = ${war.id}` : sql``}
      SET ${warContribution.damage} = ${warContribution.damage} + ${warActionReceipt.damage},
          ${warContribution.recovery} = ${warContribution.recovery} + ${warActionReceipt.recovery},
          ${enemyHp} = GREATEST(${enemyHp} - ${warActionReceipt.damage}, 0),
          ${ownHp} = LEAST(${ownHp} + ${warActionReceipt.recovery}, ${ownMax})
          ${
            objective
              ? sql`,
            ${sector.boostLockedUntil} = CASE WHEN ${warActionReceipt.captured} AND ${objective.isReserve} THEN DATE_ADD(SYSDATE(3), INTERVAL ${WAR_RESERVE_LOCKOUT_DAYS} DAY) ELSE ${sector.boostLockedUntil} END,
            ${war.objectiveState} = JSON_SET(${war.objectiveState}, ${`${path}.destroyed`}, IF(${warActionReceipt.captured}, CAST('true' AS JSON), JSON_EXTRACT(${war.objectiveState}, ${`${path}.destroyed`})), ${`${path}.hp`}, GREATEST(${hp} - ${warActionReceipt.shrineDamage}, 0))`
              : sql``
          }
          ${action.espionage ? sql`, ${war.objectiveState} = JSON_SET(${war.objectiveState}, ${spyPath}, LEAST(${WAR_ESPIONAGE_TARGET}, CAST(JSON_EXTRACT(${war.objectiveState}, ${spyPath}) AS UNSIGNED) + ${action.espionage}))` : sql``}
          ${action.camp ? sql`, ${isAttacker ? warCamp.attackerScore : warCamp.defenderScore} = ${isAttacker ? warCamp.attackerScore : warCamp.defenderScore} + ${WAR_CAMP_SCORE_PER_WIN}` : sql``}
      WHERE ${war.id} = ${activeWar.id} AND ${warActionReceipt.applied} = TRUE
    `);

/** Execute the database statement for `applyObjectiveWarAction`. */
export const executeRowsForApplyObjectiveWarAction2 = (
  client: Pick<DrizzleClient, "execute">,
  action: { id: string },
  objective: { sector: number; villageId: string },
) =>
  client.execute(sql`
        DELETE ${sector} FROM ${sector}
        INNER JOIN ${warActionReceipt} ON ${warActionReceipt.id} = ${action.id} AND ${warActionReceipt.captured} = TRUE
        WHERE ${sector.sector} = ${objective.sector} AND ${sector.villageId} = ${objective.villageId}
      `);

/** Build the `warKill` insert for `applyObjectiveWarAction`. */
export const insertWarKillForApplyObjectiveWarAction = (
  client: Pick<DrizzleClient, "insert">,
  action: {
    kills: (typeof warKill.$inferInsert)[];
  },
) => client.insert(warKill).values(action.kills);

/** Build the `war` update for `applyObjectiveWarDecay`, including predicates on `id`, `endedAt`, `lastTokenReductionAt`. */
export const updateWarForApplyObjectiveWarDecay = (
  client: Pick<DrizzleClient, "update">,
  decay: number,
  activeWar: { lastTokenReductionAt: Date; id: string },
  interval: number,
  previous: Date,
) =>
  client
    .update(war)
    .set({
      attackerWarHealth: sql`GREATEST(${war.attackerWarHealth} - ${decay}, 0)`,
      defenderWarHealth: sql`GREATEST(${war.defenderWarHealth} - ${decay}, 0)`,
      lastTokenReductionAt: new Date(
        activeWar.lastTokenReductionAt.getTime() + interval * 86400000,
      ),
    })
    .where(
      and(
        eq(war.id, activeWar.id),
        isNull(war.endedAt),
        eq(war.lastTokenReductionAt, previous),
        gt(war.attackerWarHealth, 0),
        gt(war.defenderWarHealth, 0),
      ),
    );

/** Build the `warCamp` listing for `settleObjectiveWarSchedule`, using predicates on `warId`, `resolvedAt`, `endsAt`. */
export const listWarCampForSettleObjectiveWarSchedule = (
  client: Pick<DrizzleClient, "query">,
  activeWar: { id: string },
  cutoff: number,
) =>
  client.query.warCamp.findMany({
    where: and(
      eq(warCamp.warId, activeWar.id),
      isNull(warCamp.resolvedAt),
      lte(warCamp.endsAt, new Date(cutoff)),
    ),
  });

/** Build the `warCamp` listing for `syncWarCamps`, using predicates on `resolvedAt`. */
export const listWarCampForSyncWarCamps = (client: Pick<DrizzleClient, "query">) =>
  client.query.warCamp.findMany({ where: isNull(warCamp.resolvedAt) });

/** Build the `sector` listing for `syncWarCamps`. */
export const listSectorForSyncWarCamps = (client: Pick<DrizzleClient, "query">) =>
  client.query.sector.findMany();

/** Build the `userData` listing, selecting only `userId`, using predicates on `isAi` and `isWarCamp`. */
export const listWarCampAiUserIds = (client: Pick<DrizzleClient, "query">) =>
  client.query.userData.findMany({
    columns: { userId: true },
    where: and(eq(userData.isAi, true), eq(userData.isWarCamp, true)),
  });

/** Execute the database statement for `syncWarCamps`. */
export const executeRowsForSyncWarCamps = (
  client: Pick<DrizzleClient, "execute">,
  w: { id: string },
  slot: number,
  selectedSector: number,
  guardianId: string,
  startsAt: Date,
  endsAt: Date,
) =>
  client.execute(sql`
          INSERT IGNORE INTO WarCamp (id, warId, sector, guardianId, startsAt, endsAt)
          SELECT ${`${w.id}:${slot}`}, ${war.id}, ${selectedSector}, ${guardianId}, ${startsAt}, ${endsAt}
          FROM ${war} WHERE ${war.id} = ${w.id} AND ${war.status} = 'ACTIVE' AND ${war.endedAt} IS NULL
            AND ${objectiveWarCombatGuard()}
        `);

/** Close unconverted balances after the postwar window while retaining historical damage. */
export const expireWarPoints = (client: DrizzleClient) =>
  client.execute(sql`
  UPDATE ${warContribution} INNER JOIN ${war} ON ${war.id} = ${warContribution.warId}
  SET ${warContribution.expiredAt} = SYSDATE(3)
  WHERE ${warContribution.expiredAt} IS NULL AND ${warContribution.convertedAt} IS NULL
    AND ${war.endedAt} IS NOT NULL AND DATE_ADD(${war.endedAt}, INTERVAL ${WAR_POINT_CONVERSION_DAYS} DAY) <= SYSDATE(3)
`);

/** Execute the database statement for `resolveDueWarCamps`. */
export const executeRowsForResolveDueWarCamps = (
  client: Pick<DrizzleClient, "execute">,
  camp: { id: string },
) =>
  client.execute(sql`
    UPDATE ${warCamp} INNER JOIN ${war} ON ${war.id} = ${warCamp.warId}
    SET ${war.attackerWarHealth} = GREATEST(${war.attackerWarHealth} - CASE WHEN ${war.endedAt} IS NULL AND ${war.attackerWarHealth} > 0 AND ${war.defenderWarHealth} > 0 AND ${war.rules} IS NOT NULL AND ${warCamp.endsAt} <= DATE_ADD(${war.combatStartedAt}, INTERVAL CAST(JSON_EXTRACT(${war.rules}, '$.durationDays') AS UNSIGNED) DAY) AND ${warCamp.defenderScore} > ${warCamp.attackerScore} THEN CAST(JSON_EXTRACT(${war.rules}, '$.campDamage') AS UNSIGNED) ELSE 0 END, 0),
        ${war.defenderWarHealth} = GREATEST(${war.defenderWarHealth} - CASE WHEN ${war.endedAt} IS NULL AND ${war.attackerWarHealth} > 0 AND ${war.defenderWarHealth} > 0 AND ${war.rules} IS NOT NULL AND ${warCamp.endsAt} <= DATE_ADD(${war.combatStartedAt}, INTERVAL CAST(JSON_EXTRACT(${war.rules}, '$.durationDays') AS UNSIGNED) DAY) AND ${warCamp.attackerScore} > ${warCamp.defenderScore} THEN CAST(JSON_EXTRACT(${war.rules}, '$.campDamage') AS UNSIGNED) ELSE 0 END, 0),
        ${warCamp.resolvedAt} = SYSDATE(3)
    WHERE ${warCamp.id} = ${camp.id} AND ${warCamp.resolvedAt} IS NULL AND ${warCamp.endsAt} <= SYSDATE(3)
  `);

/** Table alias for membership joins, keeping its columns distinct from other participants. */
const membership = alias(warAlly, "wa");

/** Table alias for raid structure joins, keeping its columns distinct from other participants. */
const raidStructure = alias(villageStructure, "raid_structure");

/** Table alias for unlisted joins, keeping its columns distinct from other participants. */
const unlisted = alias(war, "unlisted");

/** Table alias for related joins, keeping its columns distinct from other participants. */
const related = alias(war, "related");

/** Table alias for recipient joins, keeping its columns distinct from other participants. */
const recipient = alias(village, "recipient");

/** Table alias for defender joins, keeping its columns distinct from other participants. */
const defender = alias(village, "defender");

/** Table alias for attacker joins, keeping its columns distinct from other participants. */
const attacker = alias(village, "attacker");

/** Build the `war` listing for `handleWarEnd`, using predicates on `sector`, `type`, `status`. */
export const listWarForHandleWarEnd = (
  client: Pick<DrizzleClient, "query">,
  current: { sector: number },
) =>
  client.query.war.findMany({
    where: and(
      eq(war.sector, current.sector),
      eq(war.type, "SECTOR_WAR"),
      eq(war.status, "ACTIVE"),
    ),
    with: { warAllies: { where: activeWarAllyWhere() } },
  });

/** Execute the database statement for `handleWarEnd`. */
export const executeClaimedForHandleWarEnd = (
  client: Pick<DrizzleClient, "execute">,
  villageIds: string[],
  isSector: false | true,
  loserId: string,
  sectorWars: (import("@/drizzle/schema").War & {
    warAllies: import("@/drizzle/schema").WarAlly[];
  })[],
  settlement: import("@/validators/war").WarSettlement,
  isRaid: false | true,
  current: {
    targetStructureRoute: string;
    attackerVillageId: string;
    defenderVillageId: string;
    rules: null | import("@/validators/war").WarRules;
    id: string;
    attackerWarHealth: number;
    defenderWarHealth: number;
    attackerVillage: { tokens: number };
    defenderVillage: { tokens: number };
    warAllies: (WarAlly & { village: Village })[];
  },
  status: "ATTACKER_VICTORY" | "DEFENDER_VICTORY" | "DRAW",
  endedAt: Date,
  options: { shrineBuilderId?: undefined | string },
  winningVillageIds: string[],
  winnerId: string,
  winnerTokens: number,
  share: number,
  attackerCooldown: Date,
  defenderCooldown: Date,
  losingVillageId: undefined | string,

  rosterMatches: SQL<unknown>,
) =>
  client.execute(sql`
      UPDATE ${war}
      INNER JOIN ${village} AS attacker ON ${attacker.id} = ${war.attackerVillageId}
      INNER JOIN ${village} AS defender ON ${defender.id} = ${war.defenderVillageId}
      INNER JOIN ${village} AS recipient ON ${inArray(recipient.id, villageIds)}
      ${
        isSector
          ? sql`
        INNER JOIN ${sector} ON ${sector.sector} = ${war.sector}
        LEFT JOIN ${villageStructure} ON ${villageStructure.villageId} = ${loserId} AND ${villageStructure.route} = '/townhall'
        LEFT JOIN ${war} AS related ON ${related.id} != ${war.id} AND ${inArray(
          related.id,
          sectorWars.map((other) => other.id),
        )}
          AND ${related.status} = 'ACTIVE' AND ${related.endedAt} IS NULL
        LEFT JOIN ${war} AS unlisted ON ${unlisted.sector} = ${war.sector}
          AND ${unlisted.type} = 'SECTOR_WAR' AND ${unlisted.status} = 'ACTIVE' AND ${unlisted.endedAt} IS NULL
          AND ${notInArray(unlisted.id, settlement.warIds)}
      `
          : sql``
      }
      ${isRaid ? sql`LEFT JOIN ${villageStructure} AS raid_structure ON ${raidStructure.villageId} = ${recipient.id} AND ${raidStructure.route} = ${current.targetStructureRoute}` : sql``}
      SET ${war.status} = ${status}, ${war.endedAt} = ${endedAt},
          ${war.settlement} = JSON_SET(${JSON.stringify(settlement)}, '$.cleanupCutoff', CAST(UNIX_TIMESTAMP(SYSDATE(3)) * 1000 AS UNSIGNED)), ${war.settlementPending} = TRUE,
          ${recipient.tokens} = ${recipient.tokens} + ${
            isSector
              ? sql`CASE WHEN ${recipient.id} = ${current.attackerVillageId} THEN ${options.shrineBuilderId ? -WAR_PURCHASE_SHRINE_TOKEN_COST : 0} ELSE 0 END`
              : winningVillageIds.length
                ? sql`CASE WHEN ${recipient.id} = ${winnerId} THEN ${winnerTokens} WHEN ${inArray(recipient.id, winningVillageIds)} THEN ${share} ELSE 0 END`
                : sql`0`
          }
          ${
            isRaid
              ? sql`,
              ${raidStructure.raidProtectedUntil} = CASE WHEN ${raidStructure.villageId} = ${current.defenderVillageId} THEN ${secondsFromDate(FACTION_RAID_TARGET_COOLDOWN_HOURS * 3600, endedAt)} ELSE ${raidStructure.raidProtectedUntil} END,
              ${raidStructure.raidBoostExpiresAt} = CASE WHEN ${raidStructure.villageId} = ${winnerId} AND (${raidStructure.raidBoostExpiresAt} IS NULL OR ${raidStructure.raidBoostExpiresAt} <= ${endedAt}) THEN ${secondsFromDate(FACTION_RAID_BOOST_HOURS * 3600, endedAt)} ELSE ${raidStructure.raidBoostExpiresAt} END,
              ${recipient.raidRetryCooldowns} = CASE WHEN ${status === "DEFENDER_VICTORY"} AND ${recipient.id} = ${current.attackerVillageId} THEN JSON_SET(${recipient.raidRetryCooldowns}, ${`$.${JSON.stringify(current.defenderVillageId)}`}, ${secondsFromDate(FACTION_RAID_FAILURE_COOLDOWN_HOURS * 3600, endedAt).toISOString()}) ELSE ${recipient.raidRetryCooldowns} END`
              : !isSector
                ? sql`, ${recipient.warExhaustionEndedAt} = CASE
            WHEN ${recipient.id} = ${current.attackerVillageId} THEN ${attackerCooldown}
            WHEN ${recipient.id} = ${current.defenderVillageId} THEN ${defenderCooldown}
            ELSE ${recipient.warExhaustionEndedAt} END,
            ${recipient.lastWarEndedAt} = CASE WHEN ${inArray(recipient.id, current.rules ? villageIds : [winnerId, loserId])} THEN GREATEST(COALESCE(${recipient.lastWarEndedAt}, ${endedAt}), ${endedAt}) ELSE ${recipient.lastWarEndedAt} END`
                : sql`,
            ${winnerId !== current.defenderVillageId ? sql`${sector.villageId} = ${winnerId}, ${sector.shrineLevel} = 1, ${sector.capturedAt} = ${endedAt},` : sql``}
            ${villageStructure.curSp} = GREATEST(${villageStructure.curSp} - ${WAR_SECTOR_LOSS_TOWNHALL_DAMAGE}, 0),
            ${related.status} = 'DEFENDER_VICTORY', ${related.endedAt} = ${endedAt}`
          }
      WHERE ${war.id} = ${current.id} AND ${war.status} = 'ACTIVE' AND ${war.endedAt} IS NULL
        AND ${war.attackerWarHealth} = ${current.attackerWarHealth} AND ${war.defenderWarHealth} = ${current.defenderWarHealth}
        AND ${attacker.tokens} = ${current.attackerVillage.tokens} AND ${defender.tokens} = ${current.defenderVillage.tokens}
        ${isRaid && losingVillageId ? sql`AND ${warRaidCombatGuard()}` : sql``}
        ${options.shrineBuilderId ? sql`AND ${attacker.kageId} = ${options.shrineBuilderId} AND ${attacker.tokens} >= ${WAR_PURCHASE_SHRINE_TOKEN_COST} AND ${war.defenderShrineHp} <= 0` : sql``}
        ${isSector ? sql`AND ${sector.villageId} = ${current.defenderVillageId} AND ${unlisted.id} IS NULL` : sql``}
        AND (SELECT COUNT(*) FROM ${warAlly} wa WHERE ${membership.warId} = ${war.id} AND ${membership.acceptedAt} IS NOT NULL AND ${membership.endedAt} IS NULL) = ${current.warAllies.length}
        AND NOT EXISTS (SELECT 1 FROM ${warAlly} wa WHERE ${membership.warId} = ${war.id} AND ${membership.acceptedAt} IS NOT NULL AND ${membership.endedAt} IS NULL AND NOT (${rosterMatches}))
    `);

/** Build the war lookup with involved villages and allies for settlement processing. */
export const fetchSettlementWar = (client: DrizzleClient, warId: string) =>
  client.query.war.findFirst({
    where: eq(war.id, warId),
    with: {
      attackerVillage: { with: { structures: true } },
      defenderVillage: { with: { structures: true } },
      warAllies: { where: activeWarAllyWhere(), with: { village: true } },
    },
  });

/** Build the `war` listing for `resumePendingWarSettlements`, using predicates on `settlementPending`. */
export const listWarForResumePendingWarSettlements = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.war.findMany({
    where: eq(war.settlementPending, true),
  });

/** Build the `gameSetting` listing for `finishWarSettlement`, selecting only `name`, using predicates on `name`. */
export const listGameSettingForFinishWarSettlement = (
  client: Pick<DrizzleClient, "query">,
  names: string[],
) =>
  client.query.gameSetting.findMany({
    where: inArray(gameSetting.name, names),
    columns: { name: true },
  });

/** Build the `gameSetting` insert for `finishWarSettlement`. */
export const insertGameSettingForFinishWarSettlement = (
  client: Pick<DrizzleClient, "insert">,
  missing: string[],
) =>
  client
    .insert(gameSetting)
    .ignore()
    .values(missing.map((name) => ({ id: name, name, value: 0, time: new Date(0) })));

/**
 * Build the `warMercenary` update for `finishWarSettlement`, setting `endedAt`, using
 * predicates on `warId` and `endedAt`.
 */
export const updateWarMercenaryForFinishWarSettlement = (
  client: Pick<DrizzleClient, "update">,
  endedAt: Date,
  endedWar: { id: string },
) =>
  client
    .update(warMercenary)
    .set({ endedAt })
    .where(and(eq(warMercenary.warId, endedWar.id), isNull(warMercenary.endedAt)));

/** Build the `userData` update for `finishWarSettlement`, setting `warMission`, using predicates on `warMission`. */
export const updateUserDataForFinishWarSettlement = (
  client: Pick<DrizzleClient, "update">,
  endedWar: { id: string },
) =>
  client
    .update(userData)
    .set({ warMission: null })
    .where(
      sql`JSON_UNQUOTE(JSON_EXTRACT(${userData.warMission}, '$.warId')) = ${endedWar.id}`,
    );

/** Execute the database statement for `finishWarSettlement`. */
export const executeRowsForFinishWarSettlement = (
  client: Pick<DrizzleClient, "execute">,
  winningIds: string[],
  endedWar: { rules: null | import("@/validators/war").WarRules },
  winnerId: string,
  boostEnd: Date,

  stepGuard: (
    key: "boostsDelivered" | "structuresDelivered" | "notified",
  ) => SQL<unknown>,
) =>
  client.execute(sql`
        UPDATE ${war} LEFT JOIN ${gameSetting} ON ${inArray(gameSetting.name, [...winningIds.map((id) => `war-${id}-regen`), ...(endedWar.rules ? winningIds : [winnerId]).map((id) => `war-${id}-train`)])}
        SET ${gameSetting.value} = CASE WHEN ${gameSetting.time} < ${boostEnd}
          THEN CASE WHEN ${inArray(
            gameSetting.name,
            (endedWar.rules ? winningIds : [winnerId]).map((id) => `war-${id}-train`),
          )} THEN ${WAR_WINNING_BOOST_TRAINING_PERC} ELSE ${WAR_WINNING_BOOST_REGEN_PERC} END ELSE ${gameSetting.value} END,
            ${gameSetting.time} = GREATEST(${gameSetting.time}, ${boostEnd}),
            ${war.settlement} = ${stepReceipt("boostsDelivered")}
        WHERE ${stepGuard("boostsDelivered")}
      `);

/** Execute the database statement for `finishWarSettlement`. */
export const executeRowsForFinishWarSettlement2 = (
  client: Pick<DrizzleClient, "execute">,
  loserId: string,
  endedWar: {
    type: "VILLAGE_WAR" | "SECTOR_WAR" | "WAR_RAID";
    targetStructureRoute: string;
    rules: null | import("@/validators/war").WarRules;
  },
  isDraw: false | true,
  winningIds: string[],
  winnerId: string,
  endedAt: Date,
  penaltyEnd: Date,
  structureEnd: Date,

  stepGuard: (
    key: "boostsDelivered" | "structuresDelivered" | "notified",
  ) => SQL<unknown>,
) =>
  client.execute(sql`
        UPDATE ${war} LEFT JOIN ${villageStructure} ON
          ((${villageStructure.villageId} = ${loserId} ${endedWar.type === "WAR_RAID" ? sql`AND ${villageStructure.route} = ${endedWar.targetStructureRoute}` : sql``})
          OR (${endedWar.rules && !isDraw ? inArray(villageStructure.villageId, winningIds) : eq(villageStructure.villageId, winnerId)} ${isDraw ? (endedWar.type === "WAR_RAID" ? sql`AND ${villageStructure.route} = ${endedWar.targetStructureRoute}` : sql``) : endedWar.rules ? sql`` : sql`AND ${inArray(villageStructure.route, [...WAR_VICTORY_BOOSTED_STRUCTURES])}`}))
        LEFT JOIN ${village} ON ${village.id} = ${villageStructure.villageId}
        SET ${villageStructure.temporaryLevelBonus} = CASE
              WHEN ${village.lastWarEndedAt} IS NULL OR ${village.lastWarEndedAt} <= ${endedAt}
              THEN CASE WHEN ${isDraw} OR ${villageStructure.villageId} = ${loserId} THEN ${-(endedWar.rules ? (isDraw ? WAR_DRAW_PENALTY_LEVELS : OBJECTIVE_WAR_DEFEAT_PENALTY_LEVELS) : WAR_DEFEAT_STRUCTURE_PENALTY_LEVELS)} ELSE ${WAR_VICTORY_STRUCTURE_BOOST_LEVELS} END
              ELSE ${villageStructure.temporaryLevelBonus} END,
            ${villageStructure.temporaryLevelBonusExpiresAt} = CASE
              WHEN ${village.lastWarEndedAt} IS NULL OR ${village.lastWarEndedAt} <= ${endedAt}
              THEN CASE WHEN ${isDraw} OR ${villageStructure.villageId} = ${loserId} THEN ${penaltyEnd} ELSE ${structureEnd} END
              ELSE ${villageStructure.temporaryLevelBonusExpiresAt} END,
            ${war.settlement} = ${stepReceipt("structuresDelivered")}
        WHERE ${stepGuard("structuresDelivered")}
      `);

/** Build the `notification` insert for `finishWarSettlement`, updating duplicate keys. */
export const insertNotificationForFinishWarSettlement = (
  client: Pick<DrizzleClient, "insert">,
  endedWar: { id: string },
  receipt: { notificationContent: string },
) =>
  client
    .insert(notification)
    .values({
      warId: endedWar.id,
      userId: TERR_BOT_ID,
      content: receipt.notificationContent,
    })
    .onDuplicateKeyUpdate({ set: { warId: sql`${notification.warId}` } });

/** Build the `userRequest` deletion for `finishWarSettlement`, using predicates on `type`, `createdAt`, `relatedId`. */
export const deleteUserRequestForFinishWarSettlement = (
  client: Pick<DrizzleClient, "delete">,
  cleanupCutoff: Date,
  receipt: { warIds: string[] },
) =>
  client
    .delete(userRequest)
    .where(
      and(
        eq(userRequest.type, "WAR_ALLY"),
        lte(userRequest.createdAt, cleanupCutoff),
        inArray(userRequest.relatedId, receipt.warIds),
      ),
    );

/** Execute the database statement for `finishWarSettlement`. */
export const executeRowsForFinishWarSettlement3 = (
  client: Pick<DrizzleClient, "execute">,
  cleanupCutoff: Date,
  receipt: { villageIds: string[] },
) =>
  client.execute(sql`
        DELETE qh FROM QuestHistory qh INNER JOIN ${userData} ON qh.userId = ${userData.userId}
        WHERE qh.questType = 'war' AND qh.completed = 0 AND qh.startedAt <= ${cleanupCutoff}
          AND ${inArray(userData.villageId, receipt.villageIds)}
      `);

/** Execute the database statement for `finishWarSettlement`. */
export const executeRowsForFinishWarSettlement4 = (
  client: Pick<DrizzleClient, "execute">,
  endedWar: { attackerVillageId: string; defenderVillageId: string },

  stepGuard: (
    key: "boostsDelivered" | "structuresDelivered" | "notified",
  ) => SQL<unknown>,
) =>
  client.execute(sql`
      UPDATE ${war} LEFT JOIN ${userData} ON ${inArray(userData.villageId, [endedWar.attackerVillageId, endedWar.defenderVillageId])}
      SET ${userData.unreadNotifications} = ${userData.unreadNotifications} + 1, ${war.settlement} = ${stepReceipt("notified")}
      WHERE ${stepGuard("notified")}
    `);

/** Build the `userData` update for `finishWarSettlement`, setting `warParticipantUntil`, using predicates on `villageId`. */
export const updateUserDataForFinishWarSettlement2 = (
  client: Pick<DrizzleClient, "update">,
  receipt: { villageIds: string[] },
) =>
  client
    .update(userData)
    .set({ warParticipantUntil: new Date(0) })
    .where(
      and(
        inArray(userData.villageId, receipt.villageIds),
        sql`NOT EXISTS (SELECT 1 FROM War w WHERE w.endedAt IS NULL AND (w.attackerVillageId = ${userData.villageId} OR w.defenderVillageId = ${userData.villageId}))`,
        sql`NOT EXISTS (SELECT 1 FROM WarAlly wa INNER JOIN War w ON wa.warId = w.id WHERE w.endedAt IS NULL AND wa.acceptedAt IS NOT NULL AND wa.endedAt IS NULL AND wa.villageId = ${userData.villageId})`,
      ),
    );

/** Execute the database statement for `finishWarSettlement`. */
export const executeRowsForFinishWarSettlement5 = (
  client: Pick<DrizzleClient, "execute">,
  queueMatch: undefined | SQL<unknown>,
) =>
  client.execute(sql`
        UPDATE ${userData} INNER JOIN MpvpBattleUser mbu ON ${userData.userId} = mbu.userId
        INNER JOIN ${mpvpBattleQueue} ON mbu.clanBattleId = ${mpvpBattleQueue.id}
        SET ${userData.status} = 'AWAKE' WHERE ${queueMatch} AND ${userData.status} = 'QUEUED'
          AND NOT EXISTS (SELECT 1 FROM ${dungeonMember} INNER JOIN ${dungeonRun} ON ${dungeonRun.id} = ${dungeonMember.runId} WHERE ${dungeonMember.activeUserId} = ${userData.userId} AND ${dungeonRun.status} NOT IN ('COMPLETED', 'ENDED'))
      `);

/** Execute the database statement for `finishWarSettlement`. */
export const executeRowsForFinishWarSettlement6 = (
  client: Pick<DrizzleClient, "execute">,
  queueMatch: undefined | SQL<unknown>,
) =>
  client.execute(sql`
      DELETE mbu FROM MpvpBattleUser mbu INNER JOIN ${mpvpBattleQueue} ON mbu.clanBattleId = ${mpvpBattleQueue.id}
      WHERE ${queueMatch}
    `);

/** Build the `mpvpBattleQueue` deletion for `finishWarSettlement`, using the configured predicates. */
export const deleteMpvpBattleQueueForFinishWarSettlement = (
  client: Pick<DrizzleClient, "delete">,
  queueMatch: undefined | SQL<unknown>,
) => client.delete(mpvpBattleQueue).where(queueMatch);

/** Build the `war` update for `finishWarSettlement`, setting `settlementPending`, using predicates on `id`. */
export const updateWarForFinishWarSettlement = (
  client: Pick<DrizzleClient, "update">,
  endedWar: { id: string },
) =>
  client.update(war).set({ settlementPending: false }).where(eq(war.id, endedWar.id));

/**
 * Build village row locks in sorted ID order on the caller transaction, keeping
 * opposing declarations in the same lock order.
 */
export const selectVillageForStartSectorWar = (
  client: Pick<DrizzleClient, "select">,
  villageIds: string[],
) =>
  client
    .select()
    .from(village)
    .where(inArray(village.id, villageIds))
    .orderBy(asc(village.id))
    .for("update");

/** Build the `war` listing for `startSectorWar`, using predicates on `status`. */
export const listWarForStartSectorWar = (client: Pick<DrizzleClient, "query">) =>
  client.query.war.findMany({
    where: eq(war.status, "ACTIVE"),
    with: { warAllies: { where: activeWarAllyWhere() } },
  });

/** Build the `village` update for `startSectorWar`, setting `tokens`, using predicates on `id` and `tokens`. */
export const updateVillageForStartSectorWar = (
  client: Pick<DrizzleClient, "update">,
  attacker: { id: string },
) =>
  client
    .update(village)
    .set({ tokens: sql`${village.tokens} - ${WAR_DECLARATION_COST}` })
    .where(and(eq(village.id, attacker.id), gte(village.tokens, WAR_DECLARATION_COST)));

/** Build the `war` insert for `startSectorWar`. */
export const insertWarForStartSectorWar = (
  client: Pick<DrizzleClient, "insert">,
  declaration: { id: string; defenderVillageId: string; sectorId: number },
  attacker: { id: string },
  targetSector: { shrineLevel: undefined | number } | undefined,
) =>
  client.insert(war).values({
    id: declaration.id,
    attackerVillageId: attacker.id,
    defenderVillageId: declaration.defenderVillageId,
    status: "ACTIVE",
    type: "SECTOR_WAR",
    sector: declaration.sectorId,
    attackerShrineHp: 0,
    attackerShrineMaxHp: 0,
    attackerShrineStatus: "CAPTURED",
    defenderShrineHp: getShrineHpByLevel(targetSector?.shrineLevel),
    defenderShrineMaxHp: getShrineHpByLevel(targetSector?.shrineLevel),
    defenderShrineStatus: "ACTIVE",
  });

/** Build the `sector` insert for `startSectorWar`. */
export const insertSectorForStartSectorWar = (
  client: Pick<DrizzleClient, "insert">,
  declaration: { sectorId: number; defenderVillageId: string },
) =>
  client.insert(sector).values({
    sector: declaration.sectorId,
    villageId: declaration.defenderVillageId,
  });

/** Build the `war` listing for `startDeclaredWar`, using predicates on `status` and `type`. */
export const listWarForStartDeclaredWar = (
  client: Pick<DrizzleClient, "query">,
  rules: null | import("@/validators/war").WarRules,
) =>
  client.query.war.findMany({
    where: and(
      eq(war.status, "ACTIVE"),
      inArray(
        war.type,
        rules ? ["VILLAGE_WAR", "WAR_RAID", "SECTOR_WAR"] : ["VILLAGE_WAR", "WAR_RAID"],
      ),
    ),
    with: { warAllies: { where: activeWarAllyWhere() } },
  });

/** Build the `sector` listing for `startDeclaredWar`, using predicates on `villageId`. */
export const listSectorForStartDeclaredWar = (
  client: Pick<DrizzleClient, "query">,
  villageIds: string[],
) =>
  client.query.sector.findMany({
    where: inArray(sector.villageId, villageIds),
  });

/** Build the `villageStructure` selection for `startDeclaredWar`, using predicates on `villageId`. */
export const selectVillageStructureForStartDeclaredWar = (
  client: Pick<DrizzleClient, "select">,
  villageIds: string[],
) =>
  client
    .select()
    .from(villageStructure)
    .where(inArray(villageStructure.villageId, villageIds));

/** Build the `village` update for `startDeclaredWar`, setting `tokens`, using predicates on `id` and `tokens`. */
export const updateVillageForStartDeclaredWar = (
  client: Pick<DrizzleClient, "update">,
  cost: number,
  declaration: { attackerVillageId: string },
) =>
  client
    .update(village)
    .set({ tokens: sql`${village.tokens} - ${cost}` })
    .where(
      and(eq(village.id, declaration.attackerVillageId), gte(village.tokens, cost)),
    );

/** Build the `war` insert for `startDeclaredWar`. */
export const insertWarForStartDeclaredWar = (
  client: Pick<DrizzleClient, "insert">,
  warId: string,
  declaration: {
    attackerVillageId: string;
    defenderVillageId: string;
    warType: "VILLAGE_WAR" | "SECTOR_WAR" | "WAR_RAID";
    targetStructureRoute: string;
  },
  rules: null | import("@/validators/war").WarRules,
  combatStartedAt: null | Date,
  objectives: import("@/validators/war").WarObjectiveState[],
  isRaid: false | true,
) =>
  client.insert(war).values({
    id: warId,
    attackerVillageId: declaration.attackerVillageId,
    defenderVillageId: declaration.defenderVillageId,
    status: "ACTIVE",
    type: declaration.warType,
    rules,
    combatStartedAt,
    ...(rules
      ? {
          attackerWarHealth: rules.townhallHp,
          defenderWarHealth: rules.townhallHp,
          attackerWarHealthMax: rules.townhallHp,
          defenderWarHealthMax: rules.townhallHp,
          lastTokenReductionAt: combatStartedAt!,
          objectiveState: {
            objectives,
            attackerEspionage: 0,
            defenderEspionage: 0,
          },
        }
      : {}),
    targetStructureRoute: rules ? "/townhall" : declaration.targetStructureRoute,
    ...(isRaid
      ? {
          attackerWarHealth: FACTION_RAID_STRUCTURE_HP,
          defenderWarHealth: FACTION_RAID_STRUCTURE_HP,
          attackerWarHealthMax: FACTION_RAID_STRUCTURE_HP,
          defenderWarHealthMax: FACTION_RAID_STRUCTURE_HP,
        }
      : {}),
    attackerShrineHp: WAR_RAID_SHRINE_HP,
    attackerShrineMaxHp: WAR_RAID_SHRINE_HP,
    attackerShrineStatus: "ACTIVE",
    defenderShrineHp: WAR_RAID_SHRINE_HP,
    defenderShrineMaxHp: WAR_RAID_SHRINE_HP,
    defenderShrineStatus: "ACTIVE",
  });

/** Build the `notification` insert for `startDeclaredWar`. */
export const insertNotificationForStartDeclaredWar = (
  client: Pick<DrizzleClient, "insert">,
  notifyKageIds: string[],
  warContent: string,
) =>
  client
    .insert(notification)
    .values(notifyKageIds.map((userId) => ({ userId, content: warContent })));

/**
 * Build the `villageElderVote` update for `startApprovedVoteWar`, setting `status`,
 * using predicates on `id` and `status`.
 */
export const updateVillageElderVoteForStartApprovedVoteWar = (
  client: Pick<DrizzleClient, "update">,
  voteId: string,
) =>
  client
    .update(villageElderVote)
    .set({ status: "PENDING" })
    .where(
      and(eq(villageElderVote.id, voteId), eq(villageElderVote.status, "APPROVED")),
    );

/** Build the `war` update for `applyRaidHealthDecay`, using predicates on `id`, `endedAt`, `lastTokenReductionAt`. */
export const updateWarForApplyRaidHealthDecay = (
  client: Pick<DrizzleClient, "update">,
  drain: number,
  raid: { lastTokenReductionAt: Date; id: string },
  intervals: number,
) =>
  client
    .update(war)
    .set({
      attackerWarHealth: sql`GREATEST(${war.attackerWarHealth} - ${drain}, 0)`,
      defenderWarHealth: sql`GREATEST(${war.defenderWarHealth} - ${drain}, 0)`,
      lastTokenReductionAt: new Date(
        raid.lastTokenReductionAt.getTime() + intervals * DAY_S * 1000,
      ),
    })
    .where(
      and(
        eq(war.id, raid.id),
        isNull(war.endedAt),
        eq(war.lastTokenReductionAt, raid.lastTokenReductionAt),
        warRaidCombatGuard(),
      ),
    );

/** Table alias for request joins, keeping its columns distinct from other participants. */
const request = alias(userRequest, "r");

/** Table alias for supporting joins, keeping its columns distinct from other participants. */
const supporting = alias(village, "supporting");

/** Table alias for joining joins, keeping its columns distinct from other participants. */
const joining = alias(village, "joining");

/** Table alias for active war joins, keeping its columns distinct from other participants. */
const activeWar = alias(war, "w");

/** Table alias for withdrawing joins, keeping its columns distinct from other participants. */
const withdrawing = alias(village, "v");

/** Execute the database statement for `closeWarAllyOffer`. */
export const executeClosedForCloseWarAllyOffer = (
  client: Pick<DrizzleClient, "execute">,
  status: "CANCELLED" | "REJECTED",
  offerId: string,
  userId: string,
) =>
  client.execute(sql`
    UPDATE ${userRequest} r
    LEFT JOIN ${warAlly} wa ON ${membership.id} = ${request.id} AND ${membership.acceptedAt} IS NULL AND ${membership.endedAt} IS NULL
    SET ${request.status} = ${status}, ${membership.endedAt} = CURRENT_TIMESTAMP(3)
    WHERE ${request.id} = ${offerId} AND ${request.type} = 'WAR_ALLY' AND ${request.status} = 'PENDING'
      AND ${status === "CANCELLED" ? request.senderId : request.receiverId} = ${userId}
  `);

/** Execute the database statement for `acceptWarAllyOffer`. */
export const executeRowsForAcceptWarAllyOffer = (
  client: Pick<DrizzleClient, "execute">,
  offer: {
    villageId: string;
    supportVillageId: string;
    offerId: string;
    userId: string;
    warId: string;
  },
) =>
  client.execute(sql`
    INSERT IGNORE INTO ${warAlly} (id, warId, villageId, supportVillageId, tokensPaid, acceptedAt)
    SELECT ${request.id}, ${activeWar.id}, ${joining.id}, ${supporting.id}, 0, NULL
    FROM ${userRequest} r
    INNER JOIN ${war} w ON ${activeWar.id} = ${request.relatedId}
    INNER JOIN ${village} joining ON ${joining.id} = ${offer.villageId} AND ${joining.kageId} = ${request.receiverId}
    INNER JOIN ${village} supporting ON ${supporting.id} = ${offer.supportVillageId} AND ${supporting.kageId} = ${request.senderId}
    WHERE ${request.id} = ${offer.offerId} AND ${request.type} = 'WAR_ALLY' AND ${request.status} = 'PENDING'
      AND ${request.receiverId} = ${offer.userId} AND ${request.value} >= 0
      AND ${activeWar.id} = ${offer.warId} AND ${activeWar.status} = 'ACTIVE' AND ${activeWar.endedAt} IS NULL
      AND ${supporting.id} IN (${activeWar.attackerVillageId}, ${activeWar.defenderVillageId})
  `);

/** Execute the database statement for `acceptWarAllyOffer`. */
export const executeDeliveredForAcceptWarAllyOffer = (
  client: Pick<DrizzleClient, "execute">,
  offer: {
    offerId: string;
    userId: string;
    villageId: string;
    supportVillageId: string;
  },
) =>
  client.execute(sql`
    UPDATE ${userRequest} r
    INNER JOIN ${warAlly} wa ON ${membership.id} = ${request.id} AND ${membership.warId} = ${request.relatedId}
    INNER JOIN ${war} w ON ${activeWar.id} = ${membership.warId}
    INNER JOIN ${village} joining ON ${joining.id} = ${membership.villageId} AND ${joining.kageId} = ${request.receiverId}
    INNER JOIN ${village} supporting ON ${supporting.id} = ${membership.supportVillageId} AND ${supporting.kageId} = ${request.senderId}
    SET ${request.status} = 'ACCEPTED', ${membership.acceptedAt} = CURRENT_TIMESTAMP(3), ${membership.tokensPaid} = ${request.value},
        ${joining.tokens} = ${joining.tokens} + ${request.value}, ${supporting.tokens} = ${supporting.tokens} - ${request.value}
    WHERE ${request.id} = ${offer.offerId} AND ${request.type} = 'WAR_ALLY' AND ${request.status} = 'PENDING'
      AND ${request.receiverId} = ${offer.userId} AND ${request.value} >= 0 AND ${supporting.tokens} >= ${request.value}
      AND ${membership.villageId} = ${offer.villageId} AND ${membership.supportVillageId} = ${offer.supportVillageId}
      AND ${membership.acceptedAt} IS NULL AND ${membership.endedAt} IS NULL
      AND ${activeWar.status} = 'ACTIVE' AND ${activeWar.endedAt} IS NULL
  `);

/** Build the `warAlly` lookup for `acceptWarAllyOffer`, including predicates on `id`, `warId`, `villageId`. */
export const findWarAllyForAcceptWarAllyOffer = (
  client: Pick<DrizzleClient, "query">,
  offer: {
    offerId: string;
    warId: string;
    villageId: string;
    supportVillageId: string;
  },
) =>
  client.query.warAlly.findFirst({
    where: and(
      eq(warAlly.id, offer.offerId),
      eq(warAlly.warId, offer.warId),
      eq(warAlly.villageId, offer.villageId),
      eq(warAlly.supportVillageId, offer.supportVillageId),
    ),
  });

/** Build the `warAlly` deletion for `acceptWarAllyOffer`, using predicates on `id` and `acceptedAt`. */
export const deleteWarAllyForAcceptWarAllyOffer = (
  client: Pick<DrizzleClient, "delete">,
  offer: { offerId: string },
) =>
  client
    .delete(warAlly)
    .where(and(eq(warAlly.id, offer.offerId), isNull(warAlly.acceptedAt)));

/** Execute the database statement for `withdrawWarAlly`. */
export const executeWithdrawnForWithdrawWarAlly = (
  client: Pick<DrizzleClient, "execute">,
  endedAt: Date,
  cooldown: Date,
  warId: string,
  villageId: string,
  userId: string,
) =>
  client.execute(sql`
    UPDATE ${warAlly} wa
    INNER JOIN ${war} w ON ${activeWar.id} = ${membership.warId}
    INNER JOIN ${village} v ON ${withdrawing.id} = ${membership.villageId}
    SET ${membership.endedAt} = ${endedAt}, ${withdrawing.warExhaustionEndedAt} = CASE WHEN ${activeWar.rules} IS NOT NULL THEN DATE_ADD(${endedAt}, INTERVAL (CASE WHEN ${membership.supportVillageId} = ${activeWar.attackerVillageId} THEN ${OBJECTIVE_WAR_ATTACKER_COOLDOWN_DAYS} ELSE ${OBJECTIVE_WAR_DEFENDER_COOLDOWN_DAYS} END) DAY) ELSE ${cooldown} END, ${withdrawing.lastWarEndedAt} = ${endedAt}
    WHERE ${membership.warId} = ${warId} AND ${membership.villageId} = ${villageId}
      AND ${membership.acceptedAt} IS NOT NULL AND ${membership.endedAt} IS NULL
      AND ${activeWar.status} = 'ACTIVE' AND ${activeWar.endedAt} IS NULL AND ${withdrawing.kageId} = ${userId}
  `);

/** Build the `warMercenary` selection for `fetchMercenaryWarId`, including predicates on `userId`, `status`, `endedAt`. */
export const selectWarMercenaryForFetchMercenaryWarId = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ warId: warMercenary.warId })
    .from(warMercenary)
    .innerJoin(war, eq(war.id, warMercenary.warId))
    .where(
      and(
        eq(warMercenary.userId, userId),
        activeWarMercenaryWhere(),
        eq(war.status, "ACTIVE"),
        isNull(war.endedAt),
        sql`${war.attackerWarHealth} > 0 AND ${war.defenderWarHealth} > 0 AND SYSDATE(3) < DATE_ADD(${war.combatStartedAt}, INTERVAL CAST(JSON_EXTRACT(${war.rules}, '$.durationDays') AS UNSIGNED) DAY)`,
      ),
    );

/** Execute the database statement for `acceptWarMercenary`. */
export const executeRowsForAcceptWarMercenary = (
  client: Pick<DrizzleClient, "execute">,
  userId: string,
) =>
  client.execute(sql`UPDATE WarMercenary m INNER JOIN War w ON w.id = m.warId
    SET m.endedAt = COALESCE(w.endedAt, SYSDATE(3))
    WHERE m.userId = ${userId} AND m.endedAt IS NULL AND (w.status != 'ACTIVE' OR w.endedAt IS NOT NULL OR w.attackerWarHealth <= 0 OR w.defenderWarHealth <= 0 OR SYSDATE(3) >= DATE_ADD(w.combatStartedAt, INTERVAL CAST(JSON_EXTRACT(w.rules, '$.durationDays') AS UNSIGNED) DAY))`);

/** Execute the database statement for `acceptWarMercenary`. */
export const executeResultForAcceptWarMercenary = (
  client: Pick<DrizzleClient, "execute">,
  id: string,
  userId: string,
) =>
  client.execute(sql`
      UPDATE WarMercenary m
      INNER JOIN War w ON w.id = m.warId
      INNER JOIN Village payer ON payer.id = m.sideVillageId
      INNER JOIN UserData recipient ON recipient.userId = m.userId
      SET payer.tokens = payer.tokens - m.tokens,
        recipient.money = recipient.money + m.tokens * ${WAR_MERCENARY_RYO_PER_TOKEN},
        m.acceptedAt = SYSDATE(3)
      WHERE m.id = ${id} AND m.userId = ${userId} AND m.acceptedAt IS NULL AND m.endedAt IS NULL
        AND w.status = 'ACTIVE' AND w.endedAt IS NULL AND w.rules IS NOT NULL
        AND w.attackerWarHealth > 0 AND w.defenderWarHealth > 0
        AND SYSDATE(3) < DATE_ADD(w.combatStartedAt, INTERVAL CAST(JSON_EXTRACT(w.rules, '$.durationDays') AS UNSIGNED) DAY)
        AND payer.kageId = m.invitedById AND payer.tokens >= m.tokens
        AND payer.id IN (w.attackerVillageId, w.defenderVillageId)
        AND NOT EXISTS (SELECT 1 FROM War otherWar WHERE otherWar.id != w.id AND otherWar.status = 'ACTIVE' AND otherWar.endedAt IS NULL AND (recipient.villageId IN (otherWar.attackerVillageId, otherWar.defenderVillageId) OR EXISTS (SELECT 1 FROM WarAlly otherAlly WHERE otherAlly.warId = otherWar.id AND otherAlly.villageId = recipient.villageId AND otherAlly.acceptedAt IS NOT NULL AND otherAlly.endedAt IS NULL)))
        AND recipient.isBanned = FALSE AND recipient.isAi = FALSE AND recipient.status != 'BATTLE' AND recipient.warMission IS NULL
        AND (recipient.villageId IS NULL OR recipient.villageId != payer.id)
        AND (recipient.villageId IS NULL OR recipient.villageId != IF(payer.id = w.attackerVillageId, w.defenderVillageId, w.attackerVillageId))
        AND NOT EXISTS (SELECT 1 FROM WarAlly enemy WHERE enemy.warId = w.id AND enemy.villageId = recipient.villageId
          AND enemy.supportVillageId != payer.id AND enemy.acceptedAt IS NOT NULL AND enemy.endedAt IS NULL)
    `);

/** Build the `war` listing for `fetchWarCampEntry`, including predicates on `id`, `warId`, `sector`. */
export const listWarForFetchWarCampEntry = (
  client: Pick<DrizzleClient, "query" | "select">,
  destination: number,
) =>
  client.query.war.findMany({
    where: inArray(
      war.id,
      client
        .select({ warId: warCamp.warId })
        .from(warCamp)
        .where(
          and(
            eq(warCamp.sector, destination),
            isNull(warCamp.resolvedAt),
            sql`${warCamp.startsAt} <= SYSDATE(3) AND ${warCamp.endsAt} > SYSDATE(3)`,
          ),
        ),
    ),
    with: {
      warAllies: { where: activeWarAllyWhere() },
      warMercenaries: { where: activeWarMercenaryWhere() },
    },
  });

/**
 * Fetch an active war
 * @param client - The database client
 * @param warId - The ID of the war
 * @returns The war
 */
export const fetchActiveWar = async (client: DrizzleClient, warId: string) => {
  return await client.query.war.findFirst({
    where: and(eq(war.id, warId), eq(war.status, "ACTIVE")),
    with: {
      attackerVillage: {
        with: { structures: true },
      },
      defenderVillage: {
        with: { structures: true },
      },
      warMercenaries: { where: activeWarMercenaryWhere() },
      warAllies: {
        where: activeWarAllyWhere(),
        with: {
          village: true,
        },
      },
    },
  });
};

/**
 * Fetch ended wars for a village
 * @param client - The database client
 * @param villageId - The ID of the village
 * @returns The ended wars
 */
export const fetchEndedWars = async (client: DrizzleClient, villageId?: string) => {
  const endedWars = await client.query.war.findMany({
    where: ne(war.status, "ACTIVE"),
    with: {
      attackerVillage: {
        with: { structures: true },
      },
      defenderVillage: {
        with: { structures: true },
      },
      warAllies: {
        where: activeWarAllyWhere(),
        with: {
          village: true,
        },
      },
    },
    orderBy: [desc(war.endedAt)],
  });
  return endedWars.filter((war) => {
    if (villageId) {
      return isVillageInvolvedInAnyWar([war], villageId);
    }
    return true;
  });
};

/** Build the `warMercenary` listing for `getMercenaryOffers`, using predicates on `userId`, `endedAt`, `warId`. */
export const listWarMercenaryForGetMercenaryOffers = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.warMercenary.findMany({
    where: and(
      eq(warMercenary.userId, ctx.userId),
      isNull(warMercenary.endedAt),
      sql`EXISTS (SELECT 1 FROM War w WHERE w.id = ${warMercenary.warId} AND w.status = 'ACTIVE' AND w.endedAt IS NULL AND w.attackerWarHealth > 0 AND w.defenderWarHealth > 0 AND SYSDATE(3) < DATE_ADD(w.combatStartedAt, INTERVAL CAST(JSON_EXTRACT(w.rules, '$.durationDays') AS UNSIGNED) DAY))`,
    ),
    with: {
      village: { columns: { name: true } },
      war: {
        columns: { id: true },
        with: {
          attackerVillage: { columns: { name: true } },
          defenderVillage: { columns: { name: true } },
        },
      },
    },
  });

/** Build the `war` lookup for `getMercenaries`, using predicates on `id`. */
export const findWarForGetMercenaries = (
  client: Pick<DrizzleClient, "query">,
  input: { warId: string },
) => client.query.war.findFirst({ where: eq(war.id, input.warId) });

/** Build the `warMercenary` listing for `getMercenaries`, using predicates on `warId` and `endedAt`. */
export const listWarMercenaryForGetMercenaries = (
  client: Pick<DrizzleClient, "query">,
  input: { warId: string },
) =>
  client.query.warMercenary.findMany({
    where: and(eq(warMercenary.warId, input.warId), isNull(warMercenary.endedAt)),
    with: { user: { columns: { username: true } } },
  });

/** Build the ID-only lookup for the village led by a user. */
export const findLedVillageId = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.village.findFirst({
    where: eq(village.kageId, userId),
    columns: { id: true },
  });

/** Build the `war` lookup for `inviteMercenary`, using predicates on `id`. */
export const findWarForInviteMercenary = (
  client: Pick<DrizzleClient, "query">,
  input: { warId: string },
) =>
  client.query.war.findFirst({
    where: eq(war.id, input.warId),
    with: { warAllies: { where: activeWarAllyWhere() } },
  });

/** Build the `village` lookup for `inviteMercenary`, using predicates on `kageId`. */
export const findVillageForInviteMercenary = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) => client.query.village.findFirst({ where: eq(village.kageId, ctx.userId) });

/** Build the `warMercenary` listing for `inviteMercenary`, using predicates on `warId` and `endedAt`. */
export const listWarMercenaryForInviteMercenary = (
  client: Pick<DrizzleClient, "query">,
  input: { warId: string },
) =>
  client.query.warMercenary.findMany({
    where: and(eq(warMercenary.warId, input.warId), isNull(warMercenary.endedAt)),
  });

/** Execute the database statement for `inviteMercenary`. */
export const executeSavedForInviteMercenary = (
  client: Pick<DrizzleClient, "execute">,
  input: { userId: string; tokens: number; warId: string },
  ctx: { userId: string },
  slot: number,
  payer: { id: string },
) =>
  client.execute(sql`
        INSERT INTO WarMercenary (id, warId, sideVillageId, userId, invitedById, tokens, slot)
        SELECT ${nanoid()}, w.id, payer.id, ${input.userId}, ${ctx.userId}, ${input.tokens}, ${slot}
        FROM War w INNER JOIN Village payer ON payer.id IN (w.attackerVillageId, w.defenderVillageId)
        WHERE w.id = ${input.warId} AND w.status = 'ACTIVE' AND w.endedAt IS NULL AND w.rules IS NOT NULL
          AND payer.id = ${payer.id} AND payer.kageId = ${ctx.userId} AND payer.tokens >= ${input.tokens}
          AND w.attackerWarHealth > 0 AND w.defenderWarHealth > 0
          AND SYSDATE(3) < DATE_ADD(w.combatStartedAt, INTERVAL CAST(JSON_EXTRACT(w.rules, '$.durationDays') AS UNSIGNED) DAY)
      `);

/** Execute the database statement for `leaveMercenary`. */
export const executeSavedForLeaveMercenary = (
  client: Pick<DrizzleClient, "execute">,
  input: { contractId: string },
  ctx: { userId: string },
) =>
  client.execute(sql`
      UPDATE WarMercenary m INNER JOIN Village v ON v.id = m.sideVillageId
      INNER JOIN UserData participant ON participant.userId = m.userId
      SET m.endedAt = SYSDATE(3), participant.warMission = CASE
        WHEN m.acceptedAt IS NOT NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(participant.warMission, '$.warId')) = m.warId
          AND JSON_UNQUOTE(JSON_EXTRACT(participant.warMission, '$.sideVillageId')) = m.sideVillageId
        THEN NULL ELSE participant.warMission END
      WHERE m.id = ${input.contractId} AND m.endedAt IS NULL
        AND (m.userId = ${ctx.userId} OR v.kageId = ${ctx.userId})
    `);

/** Build the `gameSetting` insert for `setRules`, updating duplicate keys. */
export const insertGameSettingForSetRules = (
  client: Pick<DrizzleClient, "insert">,
  input: import("@/validators/war").WarRules,
) =>
  client
    .insert(gameSetting)
    .values(
      Object.entries(input).map(([key, value]) => ({
        id: `OBJECTIVE_WAR_${key}`,
        name: `OBJECTIVE_WAR_${key}`,
        value: typeof value === "boolean" ? Number(value) : value,
        time: new Date(),
      })),
    )
    .onDuplicateKeyUpdate({
      set: { value: sql`VALUES(value)`, time: sql`VALUES(time)` },
    });

/** Build the `war` lookup for `getObjectiveWarInfo`, using predicates on `id`. */
export const findWarForGetObjectiveWarInfo = (
  client: Pick<DrizzleClient, "query">,
  input: { warId: string },
) =>
  client.query.war.findFirst({
    where: eq(war.id, input.warId),
    with: {
      attackerVillage: { columns: { name: true, sector: true } },
      defenderVillage: { columns: { name: true, sector: true } },
      warMercenaries: { where: activeWarMercenaryWhere() },
      warAllies: { where: activeWarAllyWhere() },
    },
  });

/** Build the `quest` listing for `getObjectiveWarInfo`, using predicates on `questType` and `hidden`. */
export const listQuestForGetObjectiveWarInfo = (client: Pick<DrizzleClient, "query">) =>
  client.query.quest.findMany({
    where: and(eq(quest.questType, "war"), eq(quest.hidden, false)),
  });

/** Build the `warCamp` listing for `getObjectiveWarInfo`, using predicates on `warId` and `resolvedAt`. */
export const listWarCampForGetObjectiveWarInfo = (
  client: Pick<DrizzleClient, "query">,
  input: { warId: string },
) =>
  client.query.warCamp.findMany({
    where: and(eq(warCamp.warId, input.warId), isNull(warCamp.resolvedAt)),
  });

/** Build the `warContribution` selection for `getObjectiveWarInfo`, using predicates on `warId`. */
export const selectWarContributionForGetObjectiveWarInfo = (
  client: Pick<DrizzleClient, "select">,
  input: { warId: string },
) =>
  client
    .select({
      userId: warContribution.userId,
      username: userData.username,
      damage: warContribution.damage,
      recovery: warContribution.recovery,
      convertedAt: warContribution.convertedAt,
      expiredAt: warContribution.expiredAt,
    })
    .from(warContribution)
    .leftJoin(userData, eq(userData.userId, warContribution.userId))
    .where(eq(warContribution.warId, input.warId));

/** Build the `questHistory` listing for `getObjectiveWarInfo`, using predicates on `userId` and `completed`. */
export const listQuestHistoryForGetObjectiveWarInfo = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.questHistory.findMany({
    columns: { id: true, questId: true, completed: true },
    where: and(eq(questHistory.userId, ctx.userId), eq(questHistory.completed, 1)),
  });

/** Build the `village` selection for `getObjectiveWarInfo`, using predicates on `userId`. */
export const selectVillageForGetObjectiveWarInfo = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({ kageId: village.kageId })
    .from(village)
    .innerJoin(userData, eq(userData.villageId, village.id))
    .where(eq(userData.userId, ctx.userId));

/**
 * Build the `warKill` listing for `getObjectiveWarInfo`, selecting row fields
 * `killerId` and `victimId`, using predicates on `warId`.
 */
export const listWarKillForGetObjectiveWarInfo = (
  client: Pick<DrizzleClient, "query">,
  input: { warId: string },
) =>
  client.query.warKill.findMany({
    columns: { killerId: true, victimId: true },
    where: eq(warKill.warId, input.warId),
    with: {
      killer: { columns: { username: true } },
      victim: { columns: { username: true } },
    },
  });

/**
 * Build the `warMercenary` listing for `getObjectiveWarInfo`, selecting only `userId`,
 * using predicates on `warId` and `acceptedAt`.
 */
export const listWarMercenaryForGetObjectiveWarInfo = (
  client: Pick<DrizzleClient, "query">,
  input: { warId: string },
) =>
  client.query.warMercenary.findMany({
    columns: { userId: true },
    where: and(
      eq(warMercenary.warId, input.warId),
      sql`${warMercenary.acceptedAt} IS NOT NULL`,
    ),
  });

/** Build the `war` lookup for `startWarMission`, using predicates on `id`. */
export const findWarForStartWarMission = (
  client: Pick<DrizzleClient, "query">,
  input: { warId: string },
) =>
  client.query.war.findFirst({
    where: eq(war.id, input.warId),
    with: {
      attackerVillage: { columns: { sector: true } },
      defenderVillage: { columns: { sector: true } },
      warMercenaries: { where: activeWarMercenaryWhere() },
      warAllies: { where: activeWarAllyWhere() },
    },
  });

/** Build the `userData` update for `startWarMission`, including predicates on `userId`, `status`, `warMission`. */
export const updateUserDataForStartWarMission = (
  client: Pick<DrizzleClient, "update">,
  attempt: WarMissionAttempt,
  ctx: { userId: string },
  user: { villageId: null | string; sector: number },
  activeWar: { id: string },
  side: string,
) =>
  client
    .update(userData)
    .set({
      warMission: attempt,
      immunityUntil: new Date(0),
      bracketImmunityLiftedUntil: liftBracketImmunitySql(),
      warParticipantUntil: extendWarParticipantSql(),
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.status, "AWAKE"),
        isNull(userData.warMission),
        user.villageId
          ? eq(userData.villageId, user.villageId)
          : isNull(userData.villageId),
        eq(userData.sector, user.sector),
        eq(userData.isBanned, false),
        sql`EXISTS (SELECT 1 FROM War currentWar WHERE currentWar.id = ${activeWar.id} AND currentWar.endedAt IS NULL AND currentWar.status = 'ACTIVE'
              AND currentWar.attackerWarHealth > 0 AND currentWar.defenderWarHealth > 0
              AND currentWar.combatStartedAt <= SYSDATE(3)
              AND SYSDATE(3) < DATE_ADD(currentWar.combatStartedAt, INTERVAL CAST(JSON_EXTRACT(currentWar.rules, '$.durationDays') AS UNSIGNED) DAY)
              AND ${warMissionMembershipGuard(activeWar.id, side, ctx.userId)})`,
      ),
    );

/** Build the `war` lookup for `completeWarMission`, using predicates on `id`. */
export const findWarForCompleteWarMission = (
  client: Pick<DrizzleClient, "query">,
  attempt: { warId: string },
) =>
  client.query.war.findFirst({
    where: eq(war.id, attempt.warId),
    with: {
      warMercenaries: { where: activeWarMercenaryWhere() },
      warAllies: { where: activeWarAllyWhere() },
    },
  });

/**
 * Build the `userData` update for `claim`, setting `warMission`, including predicates
 * on `userId`, `status`, `villageId`.
 */
export const updateUserDataForClaim = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string },
  attempt: {
    villageId: null | string;
    sector: number;
    id: string;
    endsAt: string;
    sideVillageId: string;
  },
  activeWar: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ warMission: null })
    .where(
      and(
        eq(userData.userId, user.userId),
        eq(userData.status, "AWAKE"),
        attempt.villageId
          ? eq(userData.villageId, attempt.villageId)
          : isNull(userData.villageId),
        eq(userData.sector, attempt.sector),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${userData.warMission}, '$.id')) = ${attempt.id}`,
        sql`SYSDATE(3) >= ${new Date(attempt.endsAt)}`,
        warMissionMembershipGuard(activeWar.id, attempt.sideVillageId, ctx.userId),
      ),
    );

/**
 * Build the `userData` update for `cancelWarMission`, setting `warMission`, using
 * predicates on `userId` and `warMission`.
 */
export const updateUserDataForCancelWarMission = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  input: { attemptId: string },
) =>
  client
    .update(userData)
    .set({ warMission: null })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${userData.warMission}, '$.id')) = ${input.attemptId}`,
      ),
    );

/** Build the `warCamp` lookup for `attackWarCamp`, using predicates on `id`. */
export const findWarCampForAttackWarCamp = (
  client: Pick<DrizzleClient, "query">,
  input: { campId: string },
) => client.query.warCamp.findFirst({ where: eq(warCamp.id, input.campId) });

/** Build the `war` lookup for `attackWarCamp`, using predicates on `id` and `warId`. */
export const findWarForAttackWarCamp = (
  client: Pick<DrizzleClient, "query" | "select">,
  input: { campId: string },
) =>
  client.query.war.findFirst({
    where: eq(
      war.id,
      client
        .select({ warId: warCamp.warId })
        .from(warCamp)
        .where(eq(warCamp.id, input.campId)),
    ),
    with: {
      warMercenaries: { where: activeWarMercenaryWhere() },
      warAllies: { where: activeWarAllyWhere() },
    },
  });

/** Build the `warCamp` selection for `getWarCampNotices`, including predicates on `endedAt`, `id`, `status`. */
export const selectWarCampForGetWarCampNotices = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({ id: warCamp.id, sector: warCamp.sector, endsAt: warCamp.endsAt })
    .from(warCamp)
    .innerJoin(war, eq(war.id, warCamp.warId))
    .innerJoin(userData, eq(userData.userId, ctx.userId))
    .where(
      and(
        isNull(war.endedAt),
        sql`NOT EXISTS (SELECT 1 FROM WarMercenary exclusiveMerc INNER JOIN War exclusiveWar ON exclusiveWar.id = exclusiveMerc.warId WHERE exclusiveMerc.userId = ${ctx.userId} AND exclusiveMerc.warId != ${war.id} AND exclusiveMerc.acceptedAt IS NOT NULL AND exclusiveMerc.endedAt IS NULL AND exclusiveWar.status = 'ACTIVE' AND exclusiveWar.endedAt IS NULL AND exclusiveWar.attackerWarHealth > 0 AND exclusiveWar.defenderWarHealth > 0 AND SYSDATE(3) < DATE_ADD(exclusiveWar.combatStartedAt, INTERVAL CAST(JSON_EXTRACT(exclusiveWar.rules, '$.durationDays') AS UNSIGNED) DAY))`,
        eq(war.status, "ACTIVE"),
        sql`${war.combatStartedAt} <= SYSDATE(3) AND SYSDATE(3) < DATE_ADD(${war.combatStartedAt}, INTERVAL CAST(JSON_EXTRACT(${war.rules}, '$.durationDays') AS UNSIGNED) DAY)`,
        gt(war.attackerWarHealth, 0),
        gt(war.defenderWarHealth, 0),
        isNull(warCamp.resolvedAt),
        sql`${warCamp.startsAt} <= SYSDATE(3) AND ${warCamp.endsAt} > SYSDATE(3)`,
        or(
          eq(war.attackerVillageId, userData.villageId),
          eq(war.defenderVillageId, userData.villageId),
          sql`EXISTS (SELECT 1 FROM WarMercenary m WHERE m.warId = ${war.id} AND m.userId = ${ctx.userId} AND m.acceptedAt IS NOT NULL AND m.endedAt IS NULL)`,
          sql`EXISTS (SELECT 1 FROM WarAlly WHERE warId = ${war.id} AND villageId = ${userData.villageId} AND acceptedAt IS NOT NULL AND endedAt IS NULL)`,
        ),
      ),
    );

/**
 * Build the `warContribution` selection for `getWarPointClaims`, including predicates
 * on `userId`, `damage`, `convertedAt`.
 */
export const selectWarContributionForGetWarPointClaims = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({
      warId: warContribution.warId,
      points: warContribution.damage,
      endedAt: war.endedAt,
    })
    .from(warContribution)
    .innerJoin(war, eq(war.id, warContribution.warId))
    .where(
      and(
        eq(warContribution.userId, ctx.userId),
        gt(warContribution.damage, 0),
        isNull(warContribution.convertedAt),
        isNull(warContribution.expiredAt),
        sql`${war.endedAt} IS NOT NULL AND DATE_ADD(${war.endedAt}, INTERVAL ${WAR_POINT_CONVERSION_DAYS} DAY) > SYSDATE(3)`,
      ),
    );

/** Execute the database statement for `convertWarPoints`. */
export const executeSavedForConvertWarPoints = (
  client: Pick<DrizzleClient, "execute">,
  input: { warId: string },
  ctx: { userId: string },
) =>
  client.execute(sql`
      UPDATE ${warContribution} INNER JOIN ${war} ON ${war.id} = ${warContribution.warId}
      INNER JOIN ${userData} ON ${userData.userId} = ${warContribution.userId}
      SET ${userData.villagePrestige} = ${userData.villagePrestige} + ${warContribution.damage} * ${WAR_POINT_PRESTIGE_RATE},
        ${warContribution.convertedAt} = SYSDATE(3)
      WHERE ${warContribution.warId} = ${input.warId} AND ${warContribution.userId} = ${ctx.userId}
        AND ${warContribution.damage} > 0 AND ${warContribution.convertedAt} IS NULL AND ${warContribution.expiredAt} IS NULL
        AND ${war.endedAt} IS NOT NULL AND DATE_ADD(${war.endedAt}, INTERVAL ${WAR_POINT_CONVERSION_DAYS} DAY) > SYSDATE(3)
    `);

/** Build the `war` deletion for `adminEndWar`, using predicates on `id`. */
export const deleteWarForAdminEndWar = (
  client: Pick<DrizzleClient, "delete">,
  input: { warId: string },
) => client.delete(war).where(eq(war.id, input.warId));

/** Build the `warKill` deletion for `adminEndWar`, using predicates on `warId`. */
export const deleteWarKillForAdminEndWar = (
  client: Pick<DrizzleClient, "delete">,
  input: { warId: string },
) => client.delete(warKill).where(eq(warKill.warId, input.warId));

/** Build the `warAlly` deletion for `adminEndWar`, using predicates on `warId`. */
export const deleteWarAllyForAdminEndWar = (
  client: Pick<DrizzleClient, "delete">,
  input: { warId: string },
) => client.delete(warAlly).where(eq(warAlly.warId, input.warId));

/** Build the `actionLog` insert for `adminEndWar`. */
export const insertActionLogForAdminEndWar = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  activeWar: { attackerVillage: { name: string }; defenderVillage: { name: string } },
  input: { warId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "war",
    changes: [
      `Ended war between ${activeWar.attackerVillage?.name ?? "Unknown"} and ${activeWar.defenderVillage?.name ?? "Unknown"}`,
    ],
    relatedId: input.warId,
    relatedMsg: `Ended war`,
    relatedImage: IMG_AVATAR_DEFAULT,
  });

/** Build the `notification` insert for `declareSectorWar`. */
export const insertNotificationForDeclareSectorWar = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  attackerVillage: { name: string },
  input: { sectorId: number },
) =>
  client.insert(notification).values({
    userId: user.userId,
    content: `${attackerVillage?.name} has declared a sector war in sector ${input.sectorId}`,
  });

/** Build the `userData` update for `declareSectorWar`, setting `unreadNotifications`, using predicates on `villageId`. */
export const updateUserDataForDeclareSectorWar = (
  client: Pick<DrizzleClient, "update">,
  user: { villageId: string },
  defenderVillageId: string,
) =>
  client
    .update(userData)
    .set({ unreadNotifications: sql`unreadNotifications + 1` })
    .where(
      inArray(
        userData.villageId,
        [user.villageId, defenderVillageId].filter((v) => v),
      ),
    );

/**
 * Build the `villageElderVote` lookup for `declareVillageWarOrRaid`, selecting only
 * `endsAt`, including predicates on `villageId`, `type`, `status`.
 */
export const findVillageElderVoteForDeclareVillageWarOrRaid = (
  client: Pick<DrizzleClient, "query">,
  input: { userVillageId: string },
) =>
  client.query.villageElderVote.findFirst({
    columns: { endsAt: true },
    where: and(
      eq(villageElderVote.villageId, input.userVillageId),
      eq(villageElderVote.type, "WAR_DECLARATION"),
      eq(villageElderVote.status, "REJECTED"),
      gte(
        villageElderVote.endsAt,
        secondsFromNow(-WAR_DECLARATION_COOLDOWN_HOURS * 3600),
      ),
    ),
    orderBy: desc(villageElderVote.endsAt),
  });

/**
 * Build the `villageElderVote` lookup for `declareVillageWarOrRaid`, selecting only
 * `id`, using predicates on `villageId`, `type`, `status`.
 */
export const findVillageElderVoteForDeclareVillageWarOrRaid2 = (
  client: Pick<DrizzleClient, "query">,
  input: { userVillageId: string },
) =>
  client.query.villageElderVote.findFirst({
    columns: { id: true },
    where: and(
      eq(villageElderVote.villageId, input.userVillageId),
      eq(villageElderVote.type, "WAR_DECLARATION"),
      eq(villageElderVote.status, "PENDING"),
    ),
  });

/**
 * Build the `userData` listing for `declareVillageWarOrRaid`, selecting only `userId`,
 * using predicates on `villageId`, `rank`, `isAi`.
 */
export const listUserDataForDeclareVillageWarOrRaid = (
  client: Pick<DrizzleClient, "query">,
  input: { userVillageId: string },
) =>
  client.query.userData.findMany({
    columns: { userId: true },
    where: and(
      eq(userData.villageId, input.userVillageId),
      eq(userData.rank, "ELDER"),
      eq(userData.isAi, false),
    ),
  });

/** Build the `villageElderVote` insert for `declareVillageWarOrRaid`. */
export const insertVillageElderVoteForDeclareVillageWarOrRaid = (
  client: Pick<DrizzleClient, "insert">,
  voteId: string,
  user: { villageId: string; userId: string },
  input: { targetVillageId: string },
  warType: "VILLAGE_WAR" | "WAR_RAID",
  structure: { route: string },
  endsAt: Date,
) =>
  client.insert(villageElderVote).values({
    id: voteId,
    villageId: user.villageId,
    type: "WAR_DECLARATION",
    initiatedByUserId: user.userId,
    targetId: input.targetVillageId,
    warType: warType,
    targetStructureRoute: structure.route,
    status: "PENDING",
    endsAt,
  });

/** Build the `notification` insert for `declareVillageWarOrRaid`. */
export const insertNotificationForDeclareVillageWarOrRaid = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  kageContent: string,
  elderUserIds: string[],
  elderContent: string,
) =>
  client.insert(notification).values([
    { userId: user.userId, content: kageContent },
    ...elderUserIds.map((userId) => ({
      userId,
      content: elderContent,
    })),
  ]);

/** Build the `warKill` listing for `getWarKills`, using predicates on `warId`. */
export const listWarKillForGetWarKills = (
  client: Pick<DrizzleClient, "query">,
  input: { warId: string },
) =>
  client.query.warKill.findMany({
    where: eq(warKill.warId, input.warId),
    with: {
      killer: { columns: { userId: true, avatar: true, username: true } },
      victim: { columns: { userId: true, avatar: true, username: true } },
      killerVillage: { columns: { id: true, name: true } },
      victimVillage: { columns: { id: true, name: true } },
    },
    orderBy: [desc(warKill.killedAt)],
  });

/** Build the `warKill` selection for `getWarKillStats`, using predicates on `warId`. */
export const selectWarKillForGetWarKillStats = (
  client: Pick<DrizzleClient, "select">,
  aggregate: SQL<number>,
  input: { warId: string },
) =>
  client
    .select({
      killerId: warKill.killerId,
      killerUsername: userData.username,
      villageId: userData.villageId,
      villageName: village.name,
      killerAvatar: userData.avatar,
      count: aggregate,
    })
    .from(warKill)
    .leftJoin(userData, eq(warKill.killerId, userData.userId))
    .leftJoin(village, eq(userData.villageId, village.id))
    .where(eq(warKill.warId, input.warId))
    .groupBy(warKill.killerId)
    .orderBy(desc(aggregate));

/** Build the `userData` selection for `cancelWarDeclaration`, using predicates on `villageId` and `rank`. */
export const selectUserDataForCancelWarDeclaration = (
  client: Pick<DrizzleClient, "select">,
  input: { userVillageId: string },
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(
      and(eq(userData.villageId, input.userVillageId), eq(userData.rank, "ELDER")),
    );

/**
 * Build the `villageElderVote` update for `cancelWarDeclaration`, setting `status` and
 * `endsAt`, using predicates on `id` and `status`.
 */
export const updateVillageElderVoteForCancelWarDeclaration = (
  client: Pick<DrizzleClient, "update">,
  input: { voteId: string },
) =>
  client
    .update(villageElderVote)
    .set({ status: "REJECTED", endsAt: new Date() })
    .where(
      and(
        eq(villageElderVote.id, input.voteId),
        eq(villageElderVote.status, "PENDING"),
      ),
    );

/** Build the `notification` insert for `cancelWarDeclaration`. */
export const insertNotificationForCancelWarDeclaration = (
  client: Pick<DrizzleClient, "insert">,
  notifyIds: string[],
  user: { username: string },
) =>
  client.insert(notification).values(
    notifyIds.map((userId) => ({
      userId,
      content: `${user.username} has cancelled the war declaration. No war will be started.`,
    })),
  );

/** Build the `userData` selection for `voteOnWarDeclaration`, using predicates on `villageId`, `rank`, `isAi`. */
export const selectUserDataForVoteOnWarDeclaration = (
  client: Pick<DrizzleClient, "select">,
  input: { userVillageId: string },
) =>
  client
    .select({ count: count() })
    .from(userData)
    .where(
      and(
        eq(userData.villageId, input.userVillageId),
        eq(userData.rank, "ELDER"),
        eq(userData.isAi, false),
      ),
    );

/** Build the `village` lookup for `voteOnWarDeclaration`, selecting only `name` and `kageId`, using predicates on `id`. */
export const findVillageForVoteOnWarDeclaration = (
  client: Pick<DrizzleClient, "query">,
  voteRecord: { targetId: string },
) =>
  client.query.village.findFirst({
    columns: { name: true, kageId: true },
    where: eq(village.id, voteRecord.targetId),
  });

/**
 * Build the `villageElderVote` update for `voteOnWarDeclaration`, setting `status` and
 * `endsAt`, using predicates on `id`.
 */
export const updateVillageElderVoteForVoteOnWarDeclaration2 = (
  client: Pick<DrizzleClient, "update">,
  input: { voteId: string },
) =>
  client
    .update(villageElderVote)
    .set({ status: "REJECTED", endsAt: new Date() })
    .where(eq(villageElderVote.id, input.voteId));

/** Build the `notification` insert for `voteOnWarDeclaration`. */
export const insertNotificationForVoteOnWarDeclaration = (
  client: Pick<DrizzleClient, "insert">,
  voteRecord: { initiatedByUserId: string },
  defenderVillage: { name: undefined | string } | undefined,
) =>
  client.insert(notification).values({
    userId: voteRecord.initiatedByUserId,
    content: `War declaration against ${defenderVillage?.name ?? "another village"} was cancelled — a village is already involved in an active war.`,
  });

/** Build the `notification` insert for `voteOnWarDeclaration`. */
export const insertNotificationForVoteOnWarDeclaration2 = (
  client: Pick<DrizzleClient, "insert">,
  voteRecord: { initiatedByUserId: string },
  defenderVillage: { name: undefined | string } | undefined,
) =>
  client.insert(notification).values({
    userId: voteRecord.initiatedByUserId,
    content: `War declaration against ${defenderVillage?.name ?? "another village"} was cancelled — village no longer has enough tokens.`,
  });

/** Build the `notification` insert for `voteOnWarDeclaration`. */
export const insertNotificationForVoteOnWarDeclaration3 = (
  client: Pick<DrizzleClient, "insert">,
  voteRecord: { initiatedByUserId: string },
  defenderVillage: { name: undefined | string } | undefined,
) =>
  client.insert(notification).values({
    userId: voteRecord.initiatedByUserId,
    content: `War declaration against ${defenderVillage?.name ?? "another village"} was cancelled — a village is already involved in a war or there are no longer enough tokens.`,
  });

/** Build the `village` lookup for `voteOnWarDeclaration`, selecting only `name`, using predicates on `id`. */
export const findVillageForVoteOnWarDeclaration2 = (
  client: Pick<DrizzleClient, "query">,
  voteRecord: { targetId: string },
) =>
  client.query.village.findFirst({
    columns: { name: true },
    where: eq(village.id, voteRecord.targetId),
  });

/** Build the `notification` insert for `voteOnWarDeclaration`. */
export const insertNotificationForVoteOnWarDeclaration4 = (
  client: Pick<DrizzleClient, "insert">,
  voteRecord: { initiatedByUserId: string },
  targetVillage: { name: undefined | string } | undefined,
) =>
  client.insert(notification).values({
    userId: voteRecord.initiatedByUserId,
    content: `War declaration against ${targetVillage?.name ?? "another village"} was rejected by the elders.`,
  });

/** Build the `war` listing for `fetchActiveWars`, using predicates on `status` and `settlementPending`. */
export const listWarForFetchActiveWars = (client: Pick<DrizzleClient, "query">) =>
  client.query.war.findMany({
    where: or(eq(war.status, "ACTIVE"), eq(war.settlementPending, true)),
    with: {
      attackerVillage: {
        with: { structures: true },
      },
      defenderVillage: {
        with: { structures: true },
      },
      warMercenaries: { where: activeWarMercenaryWhere() },
      warAllies: {
        where: activeWarAllyWhere(),
        with: {
          village: true,
        },
      },
    },
  });

/** Build the count of non-AI clan members belonging to a village. */
export const selectClanMemberCountForVillage = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
) =>
  client
    .select({ count: count() })
    .from(userData)
    .innerJoin(clan, eq(clan.id, userData.clanId))
    .where(and(eq(clan.villageId, villageId), eq(userData.isAi, false)));

/** Build the `userData` selection for `getVillageMemberCount`, using predicates on `villageId`. */
export const selectUserDataForGetVillageMemberCount2 = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
) =>
  client
    .select({ count: count() })
    .from(userData)
    .where(eq(userData.villageId, villageId));

/** Build the `village` selection for `getVillageMemberCount`, using predicates on `id`. */
export const selectVillageForGetVillageMemberCount = (
  client: Pick<DrizzleClient, "select">,
  factionMembers: ReturnType<typeof selectClanMemberCountForVillage>,
  residents: ReturnType<typeof selectUserDataForGetVillageMemberCount2>,
  villageId: string,
) =>
  client
    .select({
      count:
        sql`CASE WHEN ${village.type} IN ('HIDEOUT', 'STRONGHOLD') THEN (${factionMembers}) ELSE (${residents}) END`.mapWith(
          Number,
        ),
    })
    .from(village)
    .where(eq(village.id, villageId));

/** Build the `war` listing, using predicates on `status` and `rules`. */
export const listActiveWarsWithRules = (client: Pick<DrizzleClient, "query">) =>
  client.query.war.findMany({
    where: and(eq(war.status, "ACTIVE"), isNotNull(war.rules)),
  });

/** Raid combat closes at the deadline or the first defeated structure, even before settlement runs. */
export const warRaidCombatGuard = () =>
  // SYSDATE reevaluates wall time after a row-lock wait; NOW freezes it at statement start.
  sql`(${war.type} != 'WAR_RAID' OR (${war.startedAt} > SYSDATE(3) - INTERVAL ${FACTION_RAID_MAX_DAYS * 24} HOUR AND ${war.attackerWarHealth} > 0 AND ${war.defenderWarHealth} > 0))`;

/**
 * SQL fragment that extends `userData.warParticipantUntil` to the larger of its current
 * value and `NOW() + WAR_PARTICIPANT_SECS`, so an existing longer stamp is never shortened.
 */
export const extendWarParticipantSql = () =>
  sql`GREATEST(${userData.warParticipantUntil}, NOW() + INTERVAL ${WAR_PARTICIPANT_SECS} SECOND)`;

/**
 * SQL fragment that lifts `userData.bracketImmunityLiftedUntil` to the larger of its current
 * value and `NOW() + BRACKET_IMMUNITY_LIFT_SECS`, so an existing longer lift is never shortened.
 */
export const liftBracketImmunitySql = () =>
  sql`GREATEST(${userData.bracketImmunityLiftedUntil}, NOW() + INTERVAL ${BRACKET_IMMUNITY_LIFT_SECS} SECOND)`;

/** Match accepted war-ally memberships that have not ended. */
export const activeWarAllyWhere = () =>
  and(isNotNull(warAlly.acceptedAt), isNull(warAlly.endedAt));

/** Accepted contracts are loaded with the parent war, then frozen into battle state. */
export const activeWarMercenaryWhere = () =>
  and(isNotNull(warMercenary.acceptedAt), isNull(warMercenary.endedAt));

/** Recheck live affiliation when a mission is claimed, including a racing resignation. */
export const warMissionMembershipGuard = (
  warId: string,
  side: string,
  userId: string,
) => sql`
  (NOT EXISTS (SELECT 1 FROM WarMercenary exclusiveMerc INNER JOIN War exclusiveWar ON exclusiveWar.id = exclusiveMerc.warId
      WHERE exclusiveMerc.userId = ${userId} AND exclusiveMerc.warId != ${warId} AND exclusiveMerc.acceptedAt IS NOT NULL AND exclusiveMerc.endedAt IS NULL AND exclusiveWar.status = 'ACTIVE' AND exclusiveWar.endedAt IS NULL
      AND exclusiveWar.attackerWarHealth > 0 AND exclusiveWar.defenderWarHealth > 0 AND SYSDATE(3) < DATE_ADD(exclusiveWar.combatStartedAt, INTERVAL CAST(JSON_EXTRACT(exclusiveWar.rules, '$.durationDays') AS UNSIGNED) DAY)))
  AND ((${userData.villageId} = ${side} OR EXISTS (SELECT 1 FROM WarAlly ally WHERE ally.warId = ${warId}
      AND ally.villageId = ${userData.villageId} AND ally.supportVillageId = ${side} AND ally.acceptedAt IS NOT NULL AND ally.endedAt IS NULL))
   OR EXISTS (SELECT 1 FROM WarMercenary merc WHERE merc.warId = ${warId} AND merc.userId = ${userId}
     AND merc.sideVillageId = ${side} AND merc.acceptedAt IS NOT NULL AND merc.endedAt IS NULL))`;

/** Reevaluate the deadline after row-lock waits rather than using the battle snapshot. */
const objectiveWarCombatGuard = () => sql`(${war.rules} IS NULL OR (
  ${war.combatStartedAt} <= SYSDATE(3) AND
  SYSDATE(3) < DATE_ADD(${war.combatStartedAt}, INTERVAL CAST(JSON_EXTRACT(${war.rules}, '$.durationDays') AS UNSIGNED) DAY)
  AND ${war.attackerWarHealth} > 0 AND ${war.defenderWarHealth} > 0))`;

/** Mark one settlement delivery step in the same statement that publishes its effects. */
const stepReceipt = (key: "boostsDelivered" | "structuresDelivered" | "notified") =>
  sql`JSON_SET(${war.settlement}, ${`$.${key}`}, CAST('true' AS JSON))`;
