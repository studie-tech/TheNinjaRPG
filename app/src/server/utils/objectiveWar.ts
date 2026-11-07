import { sql } from "drizzle-orm";
import {
  WAR_CAMP_DURATION_HOURS,
  WAR_CAMP_INTERVAL_HOURS,
  WAR_ESPIONAGE_TARGET,
} from "@/drizzle/constants";
import {
  sector,
  userData,
  type War,
  type WarCamp,
  war,
  type warKill,
} from "@/drizzle/schema";
import { getObjectiveWarDeadline, isObjectiveWarActive } from "@/libs/objectiveWar";
import {
  executeClaimedForApplyObjectiveWarAction,
  executeRowsForApplyObjectiveWarAction,
  executeRowsForApplyObjectiveWarAction2,
  executeRowsForResolveDueWarCamps,
  executeRowsForSyncWarCamps,
  insertWarActionReceiptForApplyObjectiveWarAction,
  insertWarContributionForApplyObjectiveWarAction,
  insertWarKillForApplyObjectiveWarAction,
  listGameSettingForFetchWarRules,
  listSectorForSyncWarCamps,
  listWarCampAiUserIds,
  listWarCampForSettleObjectiveWarSchedule,
  listWarCampForSyncWarCamps,
  updateWarForApplyObjectiveWarDecay,
} from "@/queries/war";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getRandomElement } from "@/utils/array";
import { defaultWarRules, type WarRules, warRulesSchema } from "@/validators/war";

/** Overlay saved staff settings on defaults; declarations persist the validated snapshot. */
export const fetchWarRules = async (client: DrizzleClient): Promise<WarRules> => {
  const rows = await listGameSettingForFetchWarRules(client);
  const rules = { ...defaultWarRules };
  for (const row of rows) {
    const key = row.name.replace("OBJECTIVE_WAR_", "");
    if (key === "enabled") rules.enabled = row.value === 1;
    else if (key in rules) Object.assign(rules, { [key]: row.value });
  }
  return warRulesSchema.parse(rules);
};

/** Add paused combat time once; callers clear the pause in the same guarded user update. */
export const resumeBracketImmunitySql = () => sql`CASE
  WHEN ${userData.bracketImmunityPausedAt} IS NOT NULL THEN
    TIMESTAMPADD(MICROSECOND, GREATEST(TIMESTAMPDIFF(MICROSECOND, ${userData.bracketImmunityPausedAt}, SYSDATE(3)), 0), ${userData.bracketImmunityLiftedUntil})
  ELSE ${userData.bracketImmunityLiftedUntil} END`;

/**
 * Commit a unique receipt and its actual, clamped strategic deltas without a read.
 * The transaction holds the war/sector locks between measuring and applying deltas:
 * MySQL does not guarantee assignment order across tables in a joined UPDATE.
 * Destroyed ordinary shrines are deleted under those locks so ownership and
 * strategic credit cannot diverge. MySQL cannot combine UPDATE and DELETE.
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
    /** Mercenary allegiance frozen at combat initiation survives mid-battle dismissal. */
    hasMercenarySnapshot?: boolean;
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
  const rejected = new Error("War action prerequisites changed");
  return retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      if (action.claim && !(await action.claim(tx))) return false;
      const receipt = await insertWarActionReceiptForApplyObjectiveWarAction(
        tx,
        action,
        activeWar,
      );
      if (receipt.rowsAffected === 0) throw rejected;
      await insertWarContributionForApplyObjectiveWarAction(tx, activeWar, action);
      // Freeze actual clamped deltas while acquiring the war lock. No data is fetched.
      // Multi-table SET expressions cannot rely on assignment order across tables.
      const claimed = await executeClaimedForApplyObjectiveWarAction(
        tx,
        action,
        objective,
        damage,
        recovery,
        willDestroy,
        canDamageShrine,
        hp,
        activeWar,
        rules,
      );
      if (!claimed.rowsAffected) throw rejected;
      await executeRowsForApplyObjectiveWarAction(
        tx,
        action,
        objective,
        enemyHp,
        ownHp,
        ownMax,
        path,
        hp,
        spyPath,
        isAttacker,
        activeWar,
      );
      // A destroyed ordinary objective is gone for good: its owner loses the sector and
      // shrine, and nobody inherits it, so the sector is free to be claimed again.
      if (objective && !objective.isReserve) {
        await executeRowsForApplyObjectiveWarAction2(tx, action, objective);
      }
      if (action.kills?.length)
        await insertWarKillForApplyObjectiveWarAction(tx, { kills: action.kills });
      // A concurrent espionage completion can already have saturated the counter.
      // The guarded receipt still proves this attempt completed successfully.
      return true;
    }),
  ).catch((error: unknown) => {
    // Roll back the consumed attempt and receipt together when strategic guards reject it.
    if (error === rejected) return false;
    throw error;
  });
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
  const deadline = getObjectiveWarDeadline(activeWar.combatStartedAt, activeWar.rules);
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
      updateWarForApplyObjectiveWarDecay(client, decay, activeWar, interval, previous),
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
  const deadline = getObjectiveWarDeadline(activeWar.combatStartedAt, activeWar.rules);
  const cutoff = Math.min(now.getTime(), deadline);
  const camps =
    preloadedCamps ??
    (await listWarCampForSettleObjectiveWarSchedule(client, activeWar, cutoff));
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
    listWarCampForSyncWarCamps(client),
    listSectorForSyncWarCamps(client),
    listWarCampAiUserIds(client),
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
        await executeRowsForSyncWarCamps(
          client,
          w,
          slot,
          selectedSector,
          guardianId,
          startsAt,
          endsAt,
        );
      }),
  );
};

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
        retryOnDeadlock(() => executeRowsForResolveDueWarCamps(client, camp)),
      ),
  );
};
