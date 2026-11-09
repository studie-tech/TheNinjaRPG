/**
 * Database access for village; authorization and transaction scopes stay in callers.
 */
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  ALLIANCEHALL_LAT,
  ALLIANCEHALL_LONG,
  FACTION_MIN_MEMBERS_FOR_STRONGHOLD,
  IMG_AVATAR_DEFAULT,
  KAGE_WAR_DECLARE_COST,
  VILLAGE_SYNDICATE_ID,
  WAR_FUNDS_COST,
} from "@/drizzle/constants";
import type { UserRank } from "@/drizzle/schema";
import {
  actionLog,
  kageDefendedChallenges,
  notification,
  sector,
  userData,
  village,
  villageAlliance,
  villageStructure,
  war,
} from "@/drizzle/schema";
import { activeWarAllyWhere } from "@/queries/war";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";

/**
 * Build the `villageStructure` update for `clearExpiredStructureBonuses`, setting
 * `temporaryLevelBonus` and `temporaryLevelBonusExpiresAt`, using predicates on
 * `temporaryLevelBonusExpiresAt`.
 */
export const updateVillageStructureForClearExpiredStructureBonuses = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
) =>
  client
    .update(villageStructure)
    .set({
      temporaryLevelBonus: 0,
      temporaryLevelBonusExpiresAt: null,
    })
    .where(
      and(
        isNotNull(villageStructure.temporaryLevelBonusExpiresAt),
        lt(villageStructure.temporaryLevelBonusExpiresAt, now),
      ),
    );

/** Build the `village` update for `syncStrongholdMembership`, using predicates on `type` and `id`. */
export const updateVillageForSyncStrongholdMembership = (
  client: Pick<DrizzleClient, "update">,
  expired: SQL<unknown>,
  count: SQL<unknown>,
  villageId: undefined | string,
) =>
  client
    .update(village)
    .set({
      wasDowngraded: sql`CASE WHEN ${expired} THEN 1 ELSE ${village.wasDowngraded} END`,
      type: sql`CASE WHEN ${expired} THEN 'HIDEOUT' ELSE ${village.type} END`,
      belowMemberMinimumSince: sql`CASE WHEN ${count} >= ${FACTION_MIN_MEMBERS_FOR_STRONGHOLD} THEN NULL ELSE COALESCE(${village.belowMemberMinimumSince}, NOW(3)) END`,
    })
    .where(
      and(
        eq(village.type, "STRONGHOLD"),
        villageId ? eq(village.id, villageId) : undefined,
      ),
    );

/**
 * Build the `village` listing for `accrueVillageStructureMaintenance`, selecting row
 * fields `id` and `structureMaintenanceMonth`, using predicates on `type`.
 */
export const listVillageForAccrueVillageStructureMaintenance = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.village.findMany({
    columns: { id: true, structureMaintenanceMonth: true },
    with: { structures: { columns: { route: true, level: true } } },
    where: eq(village.type, "VILLAGE"),
  });

/**
 * Build the `village` update for `accrueVillageStructureMaintenance`, setting
 * `structureMaintenanceDue` and `structureMaintenanceMonth`, using predicates on `id`
 * and `structureMaintenanceMonth`.
 */
export const updateVillageForAccrueVillageStructureMaintenance = (
  client: Pick<DrizzleClient, "update">,
  fee: number,
  month: string,
  entry: { id: string },
  previous: null | string,
) =>
  client
    .update(village)
    .set({
      structureMaintenanceDue: sql`${village.structureMaintenanceDue} + ${fee}`,
      structureMaintenanceMonth: month,
    })
    .where(
      and(
        eq(village.id, entry.id),
        previous
          ? eq(village.structureMaintenanceMonth, previous)
          : isNull(village.structureMaintenanceMonth),
      ),
    );

/**
 * Build the `village` update for `accrueVillageStructureMaintenance`, setting `tokens`
 * and `structureMaintenanceDue`, using predicates on `type`,
 * `structureMaintenanceDue`, `tokens`.
 */
export const updateVillageForAccrueVillageStructureMaintenance2 = (
  client: Pick<DrizzleClient, "update">,
) =>
  client
    .update(village)
    .set({
      tokens: sql`${village.tokens} - ${village.structureMaintenanceDue}`,
      structureMaintenanceDue: 0,
    })
    .where(
      and(
        eq(village.type, "VILLAGE"),
        gt(village.structureMaintenanceDue, 0),
        gte(village.tokens, village.structureMaintenanceDue),
      ),
    );

/**
 * Fetches all alliances from the database.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @returns A promise that resolves to an array of alliance objects.
 */
export const fetchAlliances = async (client: DrizzleClient) => {
  const villageA = alias(village, "villageA");
  const villageB = alias(village, "villageB");
  return await client
    .select(getTableColumns(villageAlliance))
    .from(villageAlliance)
    .innerJoin(villageA, eq(villageA.id, villageAlliance.villageIdA))
    .innerJoin(villageB, eq(villageB.id, villageAlliance.villageIdB))
    .where(and(eq(villageA.allianceSystem, true), eq(villageB.allianceSystem, true)));
};

/**
 * Fetches a village from the database.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @param villageId - The ID of the village to fetch.
 * @returns A Promise that resolves to the fetched village.
 */
export const fetchVillage = async (client: DrizzleClient, villageId: string) => {
  return await client.query.village.findFirst({
    where: eq(village.id, villageId),
    with: villageRelations,
  });
};

/**
 * Fetches a sector village from the database.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @param sector - The sector number of the village to fetch.
 * @returns A Promise that resolves to the fetched village.
 */
export const fetchSectorVillage = async (
  client: DrizzleClient,
  sector: number,
  isOutlaw = false,
) => {
  const result = await client.query.village.findFirst({
    where: !isOutlaw
      ? eq(village.sector, sector)
      : or(
          and(
            eq(village.sector, sector),
            inArray(village.type, ["SAFEZONE", "HIDEOUT", "STRONGHOLD"]),
          ),
          eq(village.type, "OUTLAW"),
        ),
    orderBy: (villages) =>
      sql`FIELD(${villages.type}, 'SAFEZONE', 'HIDEOUT', 'STRONGHOLD', 'OUTLAW')`,
    with: villageRelations,
  });
  return result || null;
};

/**
 * Fetches villages from the server.
 * @param client - The DrizzleClient instance used for querying the server.
 * @returns A promise that resolves to an array of villages, including the associated kage information.
 */
export const fetchVillages = async (client: DrizzleClient) => {
  return await client.query.village.findMany({
    with: { kage: { columns: { username: true, userId: true, avatar: true } } },
  });
};

/**
 * Fetches structures for a given village.
 * @param client - The DrizzleClient instance used for querying.
 * @param villageId - The ID of the village to fetch structures for.
 * @returns A promise that resolves to an array of structures.
 */
export const fetchStructures = async (
  client: DrizzleClient,
  villageId?: string | null,
) => {
  return await client.query.villageStructure.findMany({
    where: eq(villageStructure.villageId, villageId ?? VILLAGE_SYNDICATE_ID),
  });
};

/**
 * Counts the number of sectors a village has.
 * @param client - The DrizzleClient instance used to query the database.
 * @param villageId - The ID of the village to count sectors for.
 * @returns The number of sectors a village has.
 */
export const countVillageSectors = async (
  client: DrizzleClient,
  villageId: string | null,
) => {
  if (!villageId) return 0;
  const counts = await client
    .select({ count: count() })
    .from(sector)
    .where(eq(sector.villageId, villageId));
  return counts?.[0]?.count || 0;
};

/**
 * Fetches a sector from the database.
 * @param client - The DrizzleClient instance used to query the database.
 * @param sectorId - The ID of the sector to fetch.
 * @returns A Promise that resolves to the fetched sector.
 */
export const fetchSector = async (client: DrizzleClient, sectorId: number) => {
  return await client.query.sector.findFirst({
    columns: {
      sector: true,
      villageId: true,
      shrineLevel: true,
      capturedAt: true,
    },
    with: { village: { columns: { name: true, id: true } } },
    where: eq(sector.sector, sectorId),
  });
};

/** Build the `village` listing for `getAllNames`, selecting only `id` and `name`, using predicates on `type`. */
export const listVillageForGetAllNames = (client: Pick<DrizzleClient, "query">) =>
  client.query.village.findMany({
    columns: { id: true, name: true },
    where: inArray(village.type, ["VILLAGE", "OUTLAW", "SAFEZONE"]),
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `villageStructure` update for `restoreStructurePoints`, setting `curSp`, using predicates on `id`. */
export const updateVillageStructureForRestoreStructurePoints = (
  client: Pick<DrizzleClient, "update">,
  input: { structureId: string },
) =>
  client
    .update(villageStructure)
    .set({ curSp: sql`${villageStructure.maxSp}` })
    .where(eq(villageStructure.id, input.structureId));

/** Build the `actionLog` insert for `restoreStructurePoints`. */
export const insertActionLogForRestoreStructurePoints = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { structureId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "war",
    changes: [`Restored structure points for ${input.structureId}`],
    relatedId: input.structureId,
  });

/** Build the `kageDefendedChallenges` listing for `get`, including predicates on `villageId`, `status`, `didWin`. */
export const listKageDefendedChallengesForGet = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.kageDefendedChallenges.findMany({
    with: {
      user: {
        columns: {
          username: true,
          userId: true,
          avatar: true,
        },
      },
    },
    where: and(
      eq(kageDefendedChallenges.villageId, input.id),
      eq(kageDefendedChallenges.status, "COMPLETED"),
      isNotNull(kageDefendedChallenges.didWin),
      isNotNull(kageDefendedChallenges.rounds),
    ),
    limit: 8,
    orderBy: (table, { desc }) => [desc(table.resolvedAt)],
  });

/**
 * Build the `sector` listing for `getSectorOwnerships`, selecting only `sector` and
 * `villageId`, using predicates on `villageId`.
 */
export const listSectorForGetSectorOwnerships = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.sector.findMany({
    columns: {
      sector: true,
      villageId: true,
    },
    where: ne(sector.villageId, VILLAGE_SYNDICATE_ID),
  });

/** Build the `village` listing for `getSectorOwnerships`. */
export const listVillageForGetSectorOwnerships = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.village.findMany({
    columns: {
      id: true,
      name: true,
      mapName: true,
      hexColor: true,
    },
  });

/** Build the `war` listing for `getSectorOwnerships`, using predicates on `status` and `type`. */
export const listWarForGetSectorOwnerships = (client: Pick<DrizzleClient, "query">) =>
  client.query.war.findMany({
    columns: {
      sector: true,
      attackerVillageId: true,
      defenderVillageId: true,
    },
    with: {
      warAllies: {
        where: activeWarAllyWhere(),
        columns: {
          villageId: true,
        },
      },
    },
    where: and(eq(war.status, "ACTIVE"), eq(war.type, "SECTOR_WAR")),
  });

/** Build the `userData` update for `buyFood`, using predicates on `userId`, `status`, `money`. */
export const updateUserDataForBuyFood = (
  client: Pick<DrizzleClient, "update">,
  cost: number,
  newStamina: number,
  newChakra: number,
  ctx: { userId: string },
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({
      ...readiness?.set,
      money: sql`${userData.money} - ${cost}`,
      curStamina: newStamina,
      curChakra: newChakra,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        readiness?.where ?? eq(userData.status, "AWAKE"),
        gte(userData.money, cost),
      ),
    );

/** Build the `userData` update for `leaveVillage`, using predicates on `userId` and `status`. */
export const updateUserDataForLeaveVillage = (
  client: Pick<DrizzleClient, "update">,
  user: { villagePrestige: number; rank: UserRank },
  ctx: { userId: string },
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({
      ...readiness?.set,
      villageId: VILLAGE_SYNDICATE_ID,
      villagePrestige: Math.abs(user.villagePrestige), // Converted to notoriety
      isOutlaw: true,
      joinedVillageAt: new Date(),
      ...villageChangeFields(user),
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        readiness?.where ?? eq(userData.status, "AWAKE"),
      ),
    );

/** Build the `userData` update for `joinVillage`, using predicates on `userId` and `status`. */
export const updateUserDataForJoinVillage = (
  client: Pick<DrizzleClient, "update">,
  village: { id: string },
  user: { rank: UserRank },
  ctx: { userId: string },
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({
      ...readiness?.set,
      villageId: village.id,
      villagePrestige: 0,
      isOutlaw: false,
      joinedVillageAt: new Date(),
      ...villageChangeFields(user),
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        readiness?.where ?? eq(userData.status, "AWAKE"),
      ),
    );

/** Build the `userData` update releasing a member's genin students when the member changes village. */
export const updateUserDataForDetachFromVillageRelations = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ senseiId: null })
    .where(and(eq(userData.senseiId, ctx.userId), eq(userData.rank, "GENIN")));

/** Build the `userData` update for `swapVillage`, using predicates on `userId`, `reputationPoints`, `status`. */
export const updateUserDataForSwapVillage = (
  client: Pick<DrizzleClient, "update">,
  village: {
    id: string;
    type: "VILLAGE" | "OUTLAW" | "SAFEZONE" | "HIDEOUT" | "STRONGHOLD";
    sector: number;
  },
  user: { rank: UserRank },
  cost: number,
  ctx: { userId: string },
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({
      ...readiness?.set,
      villageId: village.id,
      reputationPoints: sql`${userData.reputationPoints} - ${cost}`,
      isOutlaw: village.type === "OUTLAW",
      sector: village.sector,
      longitude: ALLIANCEHALL_LONG,
      latitude: ALLIANCEHALL_LAT,
      ...villageChangeFields(user),
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        gte(userData.reputationPoints, cost),
        readiness?.where ?? eq(userData.status, "AWAKE"),
      ),
    );

/** Execute the database statement for `releaseSector`. */
export const executeReleasedForReleaseSector = (
  client: Pick<DrizzleClient, "execute">,
  input: { sector: number },
  villageId: string,
  ctx: { userId: string },
) =>
  client.execute(sql`
          DELETE ${sector} FROM ${sector}
          INNER JOIN ${village} ON ${village.id} = ${sector.villageId}
          WHERE ${sector.sector} = ${input.sector}
            AND ${village.id} = ${villageId} AND ${village.kageId} = ${ctx.userId}
            AND NOT EXISTS (
              SELECT 1 FROM ${war}
              WHERE ${war.status} = 'ACTIVE' AND ${war.endedAt} IS NULL
                AND (${war.attackerVillageId} = ${village.id} OR ${war.defenderVillageId} = ${village.id})
                AND ${war.rules} IS NOT NULL
                AND JSON_CONTAINS(${war.objectiveState}, JSON_OBJECT(
                  'sector', ${sector.sector}, 'villageId', ${village.id}, 'destroyed', CAST('false' AS JSON)
                ), '$.objectives')
            )
        `);

/** Build the action log entry for releasing a village sector. */
export const insertSectorReleaseLog = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  sectorNumber: number,
  villageName: string,
  villageId: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: userId,
    tableName: "war",
    changes: [`Released sector ${sectorNumber} from ${villageName}`],
    relatedId: villageId,
    relatedMsg: `Released sector ${sectorNumber}`,
    relatedImage: IMG_AVATAR_DEFAULT,
  });

/** Build the `notification` insert for `declareEnemy`. */
export const insertNotificationForDeclareEnemy = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  userVillage: { name: string },
  target: { name: string },
) =>
  client.insert(notification).values({
    userId: ctx.userId,
    content: `${userVillage.name} has declared war on ${target.name}`,
  });

/**
 * Build the `userData` update for `declareEnemy`, setting `unreadNotifications`, using
 * predicates on `villageId` and `userId`.
 */
export const updateUserDataForDeclareEnemy = (
  client: Pick<DrizzleClient, "update">,
  villageId: string,
  targetId: string,
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({ unreadNotifications: sql`${userData.unreadNotifications} + 1` })
    // Only members of the two villages; the kage's own row is bumped by the
    // prestige update below, as overlapping UserData updates can deadlock.
    .where(
      and(
        inArray(userData.villageId, [villageId, targetId]),
        ne(userData.userId, user.userId),
      ),
    );

/** Build the `village` token debit for `declareEnemy`, guarded by the village's balance. */
export const updateVillageForDeclareEnemy = (
  client: Pick<DrizzleClient, "update">,
  villageId: string,
) =>
  client
    .update(village)
    .set({ tokens: sql`${village.tokens} - ${WAR_FUNDS_COST}` })
    .where(and(eq(village.id, villageId), gte(village.tokens, WAR_FUNDS_COST)));

/**
 * Build the `userData` update for `declareEnemy`, setting `villagePrestige` and
 * `unreadNotifications`, using predicates on `userId`.
 */
export const updateUserDataForDeclareEnemy2 = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({
      villagePrestige: sql`${userData.villagePrestige} - ${KAGE_WAR_DECLARE_COST}`,
      unreadNotifications: sql`${userData.unreadNotifications} + 1`,
    })
    .where(eq(userData.userId, user.userId));

/** Build the `villageAlliance` update for `upsertAllianceStatus`, setting `status`, using predicates on `id`. */
export const updateVillageAllianceForUpsertAllianceStatus = (
  client: Pick<DrizzleClient, "update">,
  status: "ALLY" | "NEUTRAL" | "ENEMY",
  alliance: { id: string },
) =>
  client
    .update(villageAlliance)
    .set({ status })
    .where(eq(villageAlliance.id, alliance.id));

/** Build the `villageAlliance` insert for `upsertAllianceStatus`. */
export const insertVillageAllianceForUpsertAllianceStatus = (
  client: Pick<DrizzleClient, "insert">,
  villageIdA: string,
  villageIdB: string,
  status: "ALLY" | "NEUTRAL" | "ENEMY",
) =>
  client
    .insert(villageAlliance)
    .values({ id: nanoid(), villageIdA, villageIdB, status });

/** Build a village lookup by ID. */
export const findVillageById = (
  client: Pick<DrizzleClient, "query">,
  villageId: string,
) => client.query.village.findFirst({ where: eq(village.id, villageId) });

/** Build the `village` listing. */
export const listVillagesWithStructures = (client: Pick<DrizzleClient, "query">) =>
  client.query.village.findMany({
    with: { structures: true },
  });

/** Build the village lookup for a map sector. */
export const findVillageBySector = (
  client: Pick<DrizzleClient, "query">,
  sector: number,
) =>
  client.query.village.findFirst({
    where: eq(village.sector, sector),
  });

/** Build deletion of sector ownership by sector number; callers decide when the sector may be released. */
export const deleteSectorByNumber = (
  client: Pick<DrizzleClient, "delete">,
  sectorNum: number,
) => client.delete(sector).where(eq(sector.sector, sectorNum));

/** Build a village token increment by village ID; reward eligibility stays in callers. */
export const incrementVillageTokens = (
  client: Pick<DrizzleClient, "update">,
  amount: number,
  villageId: string,
) =>
  client
    .update(village)
    .set({ tokens: sql`${village.tokens} + ${amount}` })
    .where(eq(village.id, villageId));

/** Relations of a full village read, shared by the id and sector lookups. */
const villageRelations = {
  notice: true,
  relationshipA: true,
  relationshipB: true,
  structures: { orderBy: desc(villageStructure.name) },
  kage: { columns: { username: true, userId: true, avatar: true } },
} as const;

/** A genin loses their sensei and an elder loses their seat when changing village. */
const villageChangeFields = (user: { rank: UserRank }) => ({
  villageDutyVillageId: null,
  villageDutyStartedAt: null,
  ...(user.rank === "GENIN" && { senseiId: null }),
  ...(user.rank === "ELDER" && { rank: "JONIN" as const }),
});
