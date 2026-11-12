import { and, eq, getTableColumns, gte, is, isNull, or, SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  MasteryNames,
  RESOURCE_SILO_POINTS_REQUIRED,
  RESOURCE_SILO_RESPAWN_COST,
} from "@/drizzle/constants";
import {
  actionLog,
  anbuSquad,
  clan,
  item,
  resourceSilo,
  type UserData,
  userData,
  village,
  war,
} from "@/drizzle/schema";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";
import { allocateMasteryGains, canPromoteMastery } from "@/libs/masteryProgression";
import type { GetRewardResult } from "@/libs/quest/rewards";
import { resourceSiloBattlePoints } from "@/libs/resourceSilos";
import { nextSnapshotSql } from "@/queries/concurrency";
import { userRewardDataUpdate } from "@/queries/quests";
import { warRaidCombatGuard } from "@/queries/war";
import type { DrizzleClient } from "@/server/db";
import type {
  ActionReadiness,
  ActionReadinessWrite,
} from "@/server/utils/actionReadiness";
import { userRegenerationGainSql } from "@/server/utils/regeneration";
import { calculateContentDiff } from "@/utils/diff";
import type { ResourceSiloEntryType } from "@/validators/resourceSilos";
import { hasMasteryPromotion, MASTERY_EXPERIENCE_FIELDS } from "@/validators/rewards";

/** Read the shrine's singleton reward pool. */
export const findResourceSilo = (client: DrizzleClient) =>
  client.query.resourceSilo.findFirst({ where: eq(resourceSilo.id, "war-torn") });
/** Load consumable candidates once; the caller filters their cache effects in memory. */
export const listResourceSiloCaches = (client: DrizzleClient) =>
  client.query.item.findMany({
    columns: { id: true, name: true, effects: true },
    where: and(eq(item.hidden, false), eq(item.itemType, "CONSUMABLE")),
  });
/** Persist validated catalog snapshots. */
export const saveResourceSilo = (
  client: DrizzleClient,
  entries: ResourceSiloEntryType[],
) =>
  client
    .insert(resourceSilo)
    .values({ id: "war-torn", entries, updatedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { entries, updatedAt: new Date() } });
/** Record the exact pool change with the staff author's identity. */
export const auditResourceSilo = (
  client: DrizzleClient,
  userId: string,
  before: ResourceSiloEntryType[],
  entries: ResourceSiloEntryType[],
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId,
    tableName: "resourceSilo",
    relatedId: "war-torn",
    relatedMsg: "Update: Resource Silos",
    changes: calculateContentDiff({ entries: before }, { entries }),
  });
/** Fold points into combat's battle-ID CAS so duplicate settlement cannot award twice. */
export const resourceSiloProgressUpdate = (
  battle: CompleteBattle,
  userId: string,
  result: CombatResult,
  now: Date,
) => {
  const points = resourceSiloBattlePoints(battle, userId, result, now);
  const windowId = battle.extraState.resourceSiloWindowId;
  if (!points || !windowId) return {};
  return {
    resourceSiloProgress: sql`IF(JSON_UNQUOTE(JSON_EXTRACT(${userData.resourceSiloProgress}, '$.windowId')) = ${windowId}, JSON_SET(${userData.resourceSiloProgress}, '$.points', COALESCE(JSON_EXTRACT(${userData.resourceSiloProgress}, '$.points'), 0) + ${points}), CAST(${JSON.stringify({ windowId, points, claimed: false })} AS JSON))`,
  };
};
/** Atomically consume this window's offer while fencing battle admission and account changes. */
export const claimResourceSilo = (
  client: DrizzleClient,
  user: UserData,
  window: { id: string; start: Date; end: Date },
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({
      ...readiness?.set,
      resourceSiloProgress: sql`JSON_SET(${userData.resourceSiloProgress}, '$.claimed', CAST('true' AS JSON))`,
      updatedAt: nextSnapshotSql(userData.updatedAt),
    })
    .where(resourceSiloClaimWhere(user, window, readiness));

/**
 * Commit an UPDATE-only payout and its receipt together, including related faction/war counters.
 * Joined updates report all affected rows; any positive count proves the guarded receipt changed.
 * INSERT/DELETE rewards stay with updateRewards inside the caller's transaction.
 */
export const claimResourceSiloWithRewards = (
  client: DrizzleClient,
  readiness: ActionReadiness,
  window: ResourceSiloWindow,
  rewards: GetRewardResult,
  membershipVillageId?: string,
  wars: ResourceSiloWarReward[] = [],
) => {
  const user = readiness.user;
  const set: Record<string, unknown> = {
    ...readiness.set,
    ...userRewardDataUpdate(rewards),
    ...(membershipVillageId ? { villageId: membershipVillageId } : {}),
    resourceSiloProgress: sql`JSON_SET(${userData.resourceSiloProgress}, '$.claimed', CAST('true' AS JSON))`,
    updatedAt: nextSnapshotSql(userData.updatedAt),
  };
  if (readiness.set.petExperience) {
    // Recovery and payout each mirror player XP. Compose both gains on the live pet bank.
    set.petExperience = sql`${readiness.set.petExperience} + (${set.petExperience} - ${userData.petExperience})`;
  }
  const hasMasteryUpdates = MasteryNames.some((stat) => stat in set);
  if (hasMasteryUpdates) {
    // Multi-table UPDATE assignment order is unspecified. Allocate after queued training,
    // then guard the complete stored source instead of composing ordered SQL increments.
    // Drizzle writes masteryRanks before mastery columns, so the payout uses its newly
    // promoted cap; queued training in readiness still used the preceding rank's cap.
    const source =
      hasMasteryPromotion(rewards) &&
      canPromoteMastery(user, rewards.reward_mastery_stat, rewards.reward_mastery_rank)
        ? {
            ...user,
            masteryRanks: {
              ...user.masteryRanks,
              [rewards.reward_mastery_stat]: rewards.reward_mastery_rank,
            },
          }
        : user;
    const gains = allocateMasteryGains(
      source,
      Object.fromEntries(
        MasteryNames.map((stat, index) => {
          const field = MASTERY_EXPERIENCE_FIELDS[index];
          return [stat, field ? (rewards[field] ?? 0) : 0];
        }),
      ),
    );
    for (const stat of MasteryNames) {
      if (stat in set) set[stat] = user[stat] + (gains[stat] ?? 0);
    }
  }
  const guards = [
    resourceSiloClaimWhere(readiness.initial, window, readiness),
    ...(hasMasteryUpdates
      ? [
          ...MasteryNames.map((stat) => eq(userData[stat], readiness.initial[stat])),
          sql`${userData.masteryRanks} = CAST(${JSON.stringify(readiness.initial.masteryRanks)} AS JSON)`,
        ]
      : []),
  ];
  const joins: SQL[] = [];
  const assignments: SQL[] = [];
  if (rewards.reward_tokens > 0 && user.villageId) {
    joins.push(sql`LEFT JOIN ${village} ON ${village.id} = ${user.villageId}`);
    assignments.push(
      sql`${village.tokens} = ${village.tokens} + ${rewards.reward_tokens}`,
    );
  }
  if (rewards.reward_clanpoints > 0 && user.clanId) {
    joins.push(sql`LEFT JOIN ${clan} ON ${clan.id} = ${user.clanId}`);
    assignments.push(
      sql`${clan.points} = ${clan.points} + ${rewards.reward_clanpoints}`,
      sql`${clan.activityPoints} = ${clan.activityPoints} + ${rewards.reward_clanpoints}`,
    );
  }
  if (rewards.reward_anbupoints > 0 && user.anbuId) {
    joins.push(sql`LEFT JOIN ${anbuSquad} ON ${anbuSquad.id} = ${user.anbuId}`);
    assignments.push(
      sql`${anbuSquad.points} = ${anbuSquad.points} + ${rewards.reward_anbupoints}`,
    );
  }
  for (const [index, entry] of wars.entries()) {
    const target = alias(war, `siloWar${index}`);
    joins.push(
      sql`LEFT JOIN ${war} AS ${sql.identifier(`siloWar${index}`)} ON ${and(eq(target.id, entry.id), isNull(target.endedAt), warRaidCombatGuard(target))}`,
    );
    const ownHealth =
      entry.side === "attacker" ? target.attackerWarHealth : target.defenderWarHealth;
    const ownMaxHealth =
      entry.side === "attacker"
        ? target.attackerWarHealthMax
        : target.defenderWarHealthMax;
    const enemyHealth =
      entry.side === "attacker" ? target.defenderWarHealth : target.attackerWarHealth;
    let canHeal = true;
    if (rewards.reward_war_damage > 0 && rewards.reward_war_healing > 0) {
      const enemyBefore =
        entry.side === "attacker" ? entry.defenderWarHealth : entry.attackerWarHealth;
      // Transactional delivery damages first, so a lethal raid hit closes healing.
      // Bind this decision to the stored source; a concurrent hit rejects the whole claim.
      guards.push(
        or(
          isNull(target.id),
          and(eq(target.type, entry.type), eq(enemyHealth, enemyBefore)),
        ),
      );
      canHeal = entry.type !== "WAR_RAID" || enemyBefore > rewards.reward_war_damage;
    }
    if (rewards.reward_war_damage > 0)
      assignments.push(
        sql`${enemyHealth} = GREATEST(${enemyHealth} - ${rewards.reward_war_damage}, 0)`,
      );
    if (rewards.reward_war_healing > 0 && canHeal)
      assignments.push(
        sql`${ownHealth} = LEAST(${ownHealth} + ${rewards.reward_war_healing}, ${ownMaxHealth})`,
      );
  }
  const where = and(...guards);
  if (!joins.length) return client.update(userData).set(set).where(where);
  const columns = getTableColumns(userData);
  const accountAssignments = Object.entries(set).map(([key, value]) => {
    const column = columns[key as keyof typeof columns];
    return sql`${column} = ${is(value, SQL) ? value : sql.param(value, column)}`;
  });
  return client.execute(sql`UPDATE ${userData} ${sql.join(joins, sql` `)}
    SET ${sql.join([...accountAssignments, ...assignments], sql`, `)} WHERE ${where}`);
};

/** Fence eligibility, recovery and the current account snapshot before consuming the receipt. */
const resourceSiloClaimWhere = (
  user: UserData,
  window: ResourceSiloWindow,
  readiness?: ActionReadinessWrite,
) =>
  and(
    eq(userData.userId, user.userId),
    eq(userData.updatedAt, user.updatedAt),
    eq(userData.isBanned, false),
    readiness?.where ?? eq(userData.status, "AWAKE"),
    eq(userData.sector, MAP_WAR_TORN_BATTLEGROUND_SECTOR),
    sql`JSON_UNQUOTE(JSON_EXTRACT(${userData.resourceSiloProgress}, '$.windowId')) = ${window.id}`,
    sql`JSON_EXTRACT(${userData.resourceSiloProgress}, '$.points') >= ${RESOURCE_SILO_POINTS_REQUIRED}`,
    sql`JSON_EXTRACT(${userData.resourceSiloProgress}, '$.claimed') = CAST('false' AS JSON)`,
    sql`UTC_TIMESTAMP(3) >= ${window.start} AND UTC_TIMESTAMP(3) < ${window.end}`,
  );

/** Server-derived boundaries persisted with the guarded spawn receipt. */
type ResourceSiloWindow = { id: string; start: Date; end: Date };
/** Loaded allegiance and health used to preserve damage-before-healing in joined writes. */
type ResourceSiloWarReward = {
  id: string;
  side: "attacker" | "defender";
  type: typeof war.$inferSelect.type;
  attackerWarHealth: number;
  defenderWarHealth: number;
};

/** A paid revival spends money and consumes the death choice in the same guarded statement. */
export const resolveWarTornRespawn = (
  client: DrizzleClient,
  user: UserData,
  shrine: { x: number; y: number } | undefined,
  revivedAt = new Date(),
) =>
  client
    .update(userData)
    .set({
      warTornRespawn: false,
      updatedAt: nextSnapshotSql(userData.updatedAt),
      ...(shrine
        ? {
            money: sql`${userData.money} - ${RESOURCE_SILO_RESPAWN_COST}`,
            status: "AWAKE" as const,
            sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
            longitude: shrine.x,
            latitude: shrine.y,
            curHealth: user.maxHealth,
            curChakra: user.maxChakra,
            curStamina: user.maxStamina,
            curEnergy: sql`LEAST(${user.maxEnergy}, ${userData.curEnergy} + ${userRegenerationGainSql(user, userData.regenAt, revivedAt)})`,
            maxEnergy: user.maxEnergy,
            regenAt: revivedAt,
            immunityUntil: new Date(0),
          }
        : {}),
    })
    .where(
      and(
        eq(userData.userId, user.userId),
        eq(userData.updatedAt, user.updatedAt),
        eq(userData.status, "HOSPITALIZED"),
        eq(userData.warTornRespawn, true),
        eq(userData.isBanned, false),
        shrine ? gte(userData.money, RESOURCE_SILO_RESPAWN_COST) : undefined,
      ),
    );
