import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  WAR_CAMP_DURATION_HOURS,
  WAR_CAMP_INTERVAL_HOURS,
  WAR_CAMP_SCORE_PER_WIN,
  WAR_ESPIONAGE_TARGET,
  WAR_POINT_CONVERSION_DAYS,
  WAR_RESERVE_LOCKOUT_DAYS,
} from "@/drizzle/constants";
import {
  gameSetting,
  sector,
  userData,
  type War,
  type WarCamp,
  war,
  warActionReceipt,
  warCamp,
  warContribution,
  warKill,
} from "@/drizzle/schema";
import { isObjectiveWarActive } from "@/libs/objectiveWar";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getRandomElement } from "@/utils/array";
import { defaultWarRules, type WarRules, warRulesSchema } from "@/validators/war";

/** Overlay saved staff settings on defaults; declarations persist the validated snapshot. */
export const fetchWarRules = async (client: DrizzleClient): Promise<WarRules> => {
  const rows = await client.query.gameSetting.findMany({
    where: inArray(
      gameSetting.name,
      Object.keys(defaultWarRules).map((key) => `OBJECTIVE_WAR_${key}`),
    ),
  });
  const rules = { ...defaultWarRules };
  for (const row of rows) {
    const key = row.name.replace("OBJECTIVE_WAR_", "");
    if (key === "enabled") rules.enabled = row.value === 1;
    else if (key in rules) Object.assign(rules, { [key]: row.value });
  }
  return warRulesSchema.parse(rules);
};

/** Reevaluate the deadline after row-lock waits rather than using the battle snapshot. */
export const objectiveWarCombatGuard = () => sql`(${war.rules} IS NULL OR (
  ${war.combatStartedAt} <= SYSDATE(3) AND
  SYSDATE(3) < DATE_ADD(${war.combatStartedAt}, INTERVAL CAST(JSON_EXTRACT(${war.rules}, '$.durationDays') AS UNSIGNED) DAY)
  AND ${war.attackerWarHealth} > 0 AND ${war.defenderWarHealth} > 0))`;

/** Add paused combat time once; callers clear the pause in the same guarded user update. */
export const resumeBracketImmunitySql = () => sql`CASE
  WHEN ${userData.bracketImmunityPausedAt} IS NOT NULL THEN
    TIMESTAMPADD(MICROSECOND, GREATEST(TIMESTAMPDIFF(MICROSECOND, ${userData.bracketImmunityPausedAt}, SYSDATE(3)), 0), ${userData.bracketImmunityLiftedUntil})
  ELSE ${userData.bracketImmunityLiftedUntil} END`;

/**
 * Commit a unique receipt and its actual, clamped strategic deltas without a read.
 * The transaction holds the war/sector locks between measuring and applying deltas:
 * MySQL does not guarantee assignment order across tables in a joined UPDATE.
 * Optional mission consumption must commit with those writes, never before them.
 */
export const applyObjectiveWarAction = async (
  client: DrizzleClient,
  activeWar: War,
  action: {
    id: string;
    userId: string;
    sideVillageId: string;
    damage?: number;
    recovery?: number;
    espionage?: number;
    objectiveIndex?: number;
    shrineDamage?: number;
    camp?: WarCamp;
    /** Persist PvP outcomes with the same receipt as their strategic contribution. */
    kills?: (typeof warKill.$inferInsert)[];
    /** Consume a mission with its own CAS on the same transaction as strategic delivery. */
    claim?: (tx: DrizzleClient) => Promise<boolean>;
  },
) => {
  const rules = activeWar.rules;
  if (!rules || !activeWar.objectiveState) return false;
  const isAttacker = action.sideVillageId === activeWar.attackerVillageId;
  const ownHp = isAttacker ? war.attackerWarHealth : war.defenderWarHealth;
  const enemyHp = isAttacker ? war.defenderWarHealth : war.attackerWarHealth;
  const ownMax = isAttacker ? war.attackerWarHealthMax : war.defenderWarHealthMax;
  const spyPath = isAttacker ? "$.attackerEspionage" : "$.defenderEspionage";
  const objective =
    action.objectiveIndex === undefined
      ? undefined
      : activeWar.objectiveState.objectives[action.objectiveIndex];
  const path = `$.objectives[${action.objectiveIndex ?? 0}]`;
  const hp = sql`CAST(JSON_EXTRACT(${war.objectiveState}, ${`${path}.hp`}) AS SIGNED)`;
  const destroyed = sql`JSON_UNQUOTE(JSON_EXTRACT(${war.objectiveState}, ${`${path}.destroyed`})) = 'true'`;
  const revealed = sql`CAST(JSON_EXTRACT(${war.objectiveState}, ${spyPath}) AS UNSIGNED) >= ${WAR_ESPIONAGE_TARGET}`;
  const canDamageShrine = sql`(${revealed} AND NOT (${destroyed}) AND ${hp} > 0 AND ${sector.sector} IS NOT NULL)`;
  const willDestroy =
    objective && action.shrineDamage
      ? sql`(${canDamageShrine} AND ${hp} <= ${action.shrineDamage})`
      : sql`FALSE`;
  const damage = sql`LEAST(${enemyHp}, ${action.damage ?? 0} + CASE WHEN ${willDestroy} THEN ${rules.objectiveDamage} ELSE 0 END)`;
  const recovery = sql`LEAST(${ownMax} - ${ownHp}, ${action.recovery ?? 0})`;
  return retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      if (action.claim && !(await action.claim(tx))) return false;
      const receipt = await tx
        .insert(warActionReceipt)
        .ignore()
        .values({ id: action.id, warId: activeWar.id });
      if (receipt.rowsAffected === 0) return false;
      await tx
        .insert(warContribution)
        .values({ warId: activeWar.id, userId: action.userId })
        .onDuplicateKeyUpdate({ set: { userId: sql`${warContribution.userId}` } });
      // Freeze actual clamped deltas while acquiring the war lock. No data is fetched.
      // Multi-table SET expressions cannot rely on assignment order across tables.
      const claimed = await tx.execute(sql`
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
          (actor.villageId = ${action.sideVillageId} OR EXISTS (SELECT 1 FROM WarAlly membership WHERE membership.warId = ${war.id} AND membership.villageId = actor.villageId AND membership.supportVillageId = ${action.sideVillageId} AND membership.acceptedAt IS NOT NULL AND membership.endedAt IS NULL)))
        AND ${warActionReceipt.applied} = FALSE
        AND ${objectiveWarCombatGuard()}
        ${objective && action.damage === undefined ? sql`AND ${sector.sector} IS NOT NULL AND NOT (${destroyed}) AND ${hp} > 0 AND CAST(JSON_EXTRACT(${war.objectiveState}, ${spyPath}) AS UNSIGNED) >= ${WAR_ESPIONAGE_TARGET}` : sql``}
        ${action.camp ? sql`AND ${warCamp.resolvedAt} IS NULL AND ${warCamp.startsAt} <= SYSDATE(3) AND ${warCamp.endsAt} > SYSDATE(3)` : sql``}
    `);
      if (!claimed.rowsAffected) return false;
      await tx.execute(sql`
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
            ${sector.shrineLevel} = CASE WHEN ${warActionReceipt.captured} AND NOT ${objective.isReserve} THEN 0 ELSE ${sector.shrineLevel} END,
            ${sector.villageId} = CASE WHEN ${warActionReceipt.captured} AND NOT ${objective.isReserve} THEN ${action.sideVillageId} ELSE ${sector.villageId} END,
            ${war.objectiveState} = JSON_SET(${war.objectiveState}, ${`${path}.destroyed`}, IF(${warActionReceipt.captured}, CAST('true' AS JSON), JSON_EXTRACT(${war.objectiveState}, ${`${path}.destroyed`})), ${`${path}.hp`}, GREATEST(${hp} - ${warActionReceipt.shrineDamage}, 0))`
              : sql``
          }
          ${action.espionage ? sql`, ${war.objectiveState} = JSON_SET(${war.objectiveState}, ${spyPath}, LEAST(${WAR_ESPIONAGE_TARGET}, CAST(JSON_EXTRACT(${war.objectiveState}, ${spyPath}) AS UNSIGNED) + ${action.espionage}))` : sql``}
          ${action.camp ? sql`, ${isAttacker ? warCamp.attackerScore : warCamp.defenderScore} = ${isAttacker ? warCamp.attackerScore : warCamp.defenderScore} + ${WAR_CAMP_SCORE_PER_WIN}` : sql``}
      WHERE ${war.id} = ${activeWar.id} AND ${warActionReceipt.applied} = TRUE
    `);
      if (action.kills?.length) await tx.insert(warKill).values(action.kills);
      // A concurrent espionage completion can already have saturated the counter.
      // The guarded receipt still proves this attempt completed successfully.
      return true;
    }),
  );
};

/** Advance each due day with a timestamp CAS; overlapping jobs cannot repeat decay. */
export const applyObjectiveWarDecay = async (
  client: DrizzleClient,
  activeWar: War,
  now = new Date(),
) => {
  if (
    !activeWar.rules ||
    !activeWar.combatStartedAt ||
    activeWar.endedAt ||
    activeWar.status !== "ACTIVE" ||
    activeWar.combatStartedAt > now
  )
    return;
  const deadline =
    activeWar.combatStartedAt.getTime() + activeWar.rules.durationDays * 86400000;
  const intervals = Math.floor(
    (Math.min(now.getTime(), deadline) - activeWar.lastTokenReductionAt.getTime()) /
      86400000,
  );
  if (intervals <= 0) return;
  const decay = activeWar.rules.dailyDecay;
  for (let interval = 1; interval <= intervals; interval++) {
    const previous = new Date(
      activeWar.lastTokenReductionAt.getTime() + (interval - 1) * 86400000,
    );
    await retryOnDeadlock(() =>
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
        ),
    );
  }
};

/** Replay scheduled effects in time order; health guards preserve the first defeat. */
export const settleObjectiveWarSchedule = async (
  client: DrizzleClient,
  activeWar: War,
  now = new Date(),
  preloadedCamps?: WarCamp[],
) => {
  if (!activeWar.rules || !activeWar.combatStartedAt || activeWar.endedAt) return;
  const deadline =
    activeWar.combatStartedAt.getTime() + activeWar.rules.durationDays * 86400000;
  const cutoff = Math.min(now.getTime(), deadline);
  const camps =
    preloadedCamps ??
    (await client.query.warCamp.findMany({
      where: and(
        eq(warCamp.warId, activeWar.id),
        isNull(warCamp.resolvedAt),
        lte(warCamp.endsAt, new Date(cutoff)),
      ),
    }));
  const events: { at: Date; camp?: WarCamp }[] = camps
    .filter((c) => c.endsAt.getTime() <= cutoff)
    .map((camp) => ({ at: camp.endsAt, camp }));
  for (
    let at = activeWar.lastTokenReductionAt.getTime() + 86400000;
    at <= cutoff;
    at += 86400000
  )
    events.push({ at: new Date(at) });
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  let previous = activeWar.lastTokenReductionAt;
  for (const event of events) {
    if (event.camp) await resolveDueWarCamps(client, [event.camp], now);
    else {
      await applyObjectiveWarDecay(
        client,
        { ...activeWar, lastTokenReductionAt: previous },
        event.at,
      );
      previous = event.at;
    }
  }
};

/** Settle overdue events, then create at most one camp per war/slot using its unique ID. */
export const syncWarCamps = async (
  client: DrizzleClient,
  wars: War[],
  now = new Date(),
) => {
  const [camps, sectors, guardians] = await Promise.all([
    client.query.warCamp.findMany({ where: isNull(warCamp.resolvedAt) }),
    client.query.sector.findMany(),
    client.query.userData.findMany({
      columns: { userId: true },
      where: and(eq(userData.isAi, true), eq(userData.isWarCamp, true)),
    }),
  ]);
  await Promise.all(
    wars.map((w) =>
      settleObjectiveWarSchedule(
        client,
        w,
        now,
        camps.filter((c) => c.warId === w.id),
      ),
    ),
  );
  await resolveDueWarCamps(
    client,
    camps.filter((c) => !wars.some((w) => w.id === c.warId)),
    now,
  );
  if (!guardians.length) return;
  await Promise.all(
    wars
      .filter((w) => isObjectiveWarActive(w, now))
      .map(async (w) => {
        const slot = Math.floor(
          (now.getTime() - w.combatStartedAt!.getTime()) /
            (WAR_CAMP_INTERVAL_HOURS * 3600000),
        );
        const startsAt = new Date(
          w.combatStartedAt!.getTime() + slot * WAR_CAMP_INTERVAL_HOURS * 3600000,
        );
        const endsAt = new Date(startsAt.getTime() + WAR_CAMP_DURATION_HOURS * 3600000);
        if (now >= endsAt) return;
        const owned = sectors.filter((s) =>
          [w.attackerVillageId, w.defenderVillageId].includes(s.villageId),
        );
        if (!owned.length) return;
        const selectedSector = getRandomElement(owned)!.sector;
        const guardianId = getRandomElement(guardians)!.userId;
        // Replay can have ended combat since preload; guard insertion against current health.
        await client.execute(sql`
          INSERT IGNORE INTO WarCamp (id, warId, sector, guardianId, startsAt, endsAt)
          SELECT ${`${w.id}:${slot}`}, ${war.id}, ${selectedSector}, ${guardianId}, ${startsAt}, ${endsAt}
          FROM ${war} WHERE ${war.id} = ${w.id} AND ${war.status} = 'ACTIVE' AND ${war.endedAt} IS NULL
            AND ${objectiveWarCombatGuard()}
        `);
      }),
  );
};

/** Close unconverted balances after the postwar window while retaining historical damage. */
export const expireWarPoints = (client: DrizzleClient) =>
  client.execute(sql`
  UPDATE ${warContribution} INNER JOIN ${war} ON ${war.id} = ${warContribution.warId}
  SET ${warContribution.expiredAt} = SYSDATE(3)
  WHERE ${warContribution.expiredAt} IS NULL AND ${warContribution.convertedAt} IS NULL
    AND ${war.endedAt} IS NOT NULL AND DATE_ADD(${war.endedAt}, INTERVAL ${WAR_POINT_CONVERSION_DAYS} DAY) <= SYSDATE(3)
`);

/** Atomically mark each camp resolved and damage its losing side; ties deal no damage. */
const resolveDueWarCamps = async (
  client: DrizzleClient,
  camps: WarCamp[],
  now: Date,
) => {
  await Promise.all(
    camps
      .filter((camp) => camp.endsAt <= now)
      .map((camp) =>
        retryOnDeadlock(() =>
          client.execute(sql`
    UPDATE ${warCamp} INNER JOIN ${war} ON ${war.id} = ${warCamp.warId}
    SET ${war.attackerWarHealth} = GREATEST(${war.attackerWarHealth} - CASE WHEN ${war.endedAt} IS NULL AND ${war.attackerWarHealth} > 0 AND ${war.defenderWarHealth} > 0 AND ${war.rules} IS NOT NULL AND ${warCamp.endsAt} <= DATE_ADD(${war.combatStartedAt}, INTERVAL CAST(JSON_EXTRACT(${war.rules}, '$.durationDays') AS UNSIGNED) DAY) AND ${warCamp.defenderScore} > ${warCamp.attackerScore} THEN CAST(JSON_EXTRACT(${war.rules}, '$.campDamage') AS UNSIGNED) ELSE 0 END, 0),
        ${war.defenderWarHealth} = GREATEST(${war.defenderWarHealth} - CASE WHEN ${war.endedAt} IS NULL AND ${war.attackerWarHealth} > 0 AND ${war.defenderWarHealth} > 0 AND ${war.rules} IS NOT NULL AND ${warCamp.endsAt} <= DATE_ADD(${war.combatStartedAt}, INTERVAL CAST(JSON_EXTRACT(${war.rules}, '$.durationDays') AS UNSIGNED) DAY) AND ${warCamp.attackerScore} > ${warCamp.defenderScore} THEN CAST(JSON_EXTRACT(${war.rules}, '$.campDamage') AS UNSIGNED) ELSE 0 END, 0),
        ${warCamp.resolvedAt} = SYSDATE(3)
    WHERE ${warCamp.id} = ${camp.id} AND ${warCamp.resolvedAt} IS NULL AND ${warCamp.endsAt} <= SYSDATE(3)
  `),
        ),
      ),
  );
};
