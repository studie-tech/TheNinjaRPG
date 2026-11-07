import { afterEach, beforeEach, expect, it } from "bun:test";
import { eq, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import { setTimeout } from "node:timers/promises";
import {
  actionLog,
  gameSetting,
  notification,
  sector,
  userData,
  village,
  villageStructure,
  war,
  warAlly,
} from "@/drizzle/schema";
import { villageRouter } from "@/server/api/routers/village";
import type { DrizzleClient } from "@/server/db";
import { startDeclaredWar } from "@/server/utils/war";
import { defaultWarRules } from "@/validators/war";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

const sectorId = 205;
const leader = "defender-kage";
const rejection =
  "Sector ownership or leadership changed, or this is an active war objective. Refresh and try again.";
const dialect = new MySqlDialect();
const declaration = {
  attackerVillageId: "attacker",
  attackerVillageName: "attacker",
  defenderVillageId: "defender",
  defenderVillageName: "defender",
  initiatedByUserId: "attacker-kage",
  warType: "VILLAGE_WAR" as const,
  targetStructureRoute: "/townhall",
};

/** Exercise the procedure's real SQL while rejecting an application transaction. */
const releaseClient = (
  database: DrizzleClient,
  run: (
    query: SQL,
    execute: () => ReturnType<DrizzleClient["execute"]>,
  ) => ReturnType<DrizzleClient["execute"]> = (_query, execute) => execute(),
) =>
  new Proxy(database, {
    get(target, property, receiver) {
      if (property === "transaction")
        return () => {
          throw new Error("Sector release must use one guarded statement");
        };
      if (property === "execute")
        return (query: SQL) => run(query, () => target.execute(query));
      return Reflect.get(target, property, receiver);
    },
  });

/** Observe the contested parent row, rather than relying on a timing delay. */
const expectVillageLockWait = async (
  observer: mysql.Connection,
  requestedMode: "S" | "X",
) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [locks] = await observer.query<mysql.RowDataPacket[]>(`
      SELECT requested.LOCK_MODE AS mode FROM performance_schema.data_lock_waits AS waits
      INNER JOIN performance_schema.data_locks AS requested
        ON requested.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
      INNER JOIN performance_schema.data_locks AS blocking
        ON blocking.ENGINE_LOCK_ID = waits.BLOCKING_ENGINE_LOCK_ID
      WHERE requested.OBJECT_SCHEMA = DATABASE() AND requested.OBJECT_NAME = ?
        AND blocking.OBJECT_NAME = ? AND requested.LOCK_MODE LIKE ?
    `, [getTableName(village), getTableName(village), `${requestedMode}%`]);
    if (locks.length > 0) return;
    await setTimeout(10);
  }
  throw new Error(`No ${requestedMode} lock wait on the village row`);
};

const seed = async () => {
  const database = await getTestDatabase();
  await database.insert(village).values(
    ["attacker", "defender", "other", "another"].map((id, index) => ({
      id,
      name: id,
      sector: 101 + index,
      kageId: `${id}-kage`,
      tokens: defaultWarRules.declarationCost * 2,
    })),
  );
  await database.insert(sector).values([
    { sector: 301, villageId: "attacker", shrineLevel: 1 },
    { sector: 302, villageId: "attacker", shrineLevel: 1 },
    { sector: sectorId, villageId: "defender", shrineLevel: 1 },
    { sector: 206, villageId: "defender", shrineLevel: 1 },
  ]);
  await insertUsers([{ userId: leader, username: leader, villageId: "defender" }]);
  stubProfile("fetchUpdatedUser", async () => ({
    user: await database.query.userData.findFirst({
      where: eq(userData.userId, leader),
      with: { village: true },
    }),
    requiresUserRefresh: false,
  }));
  return database;
};

const release = (database: DrizzleClient) =>
  callerForDatabase(villageRouter, leader, database).releaseSector({ sector: sectorId });

const enableObjectives = (database: DrizzleClient) =>
  database.insert(gameSetting).values({
    id: "OBJECTIVE_WAR_enabled",
    name: "OBJECTIVE_WAR_enabled",
    value: 1,
    time: new Date(),
  });

describeWithDatabase("guarded sector release", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog, notification, gameSetting, sector, userData,
      villageStructure, warAlly, war, village,
    );
  });
  afterEach(resetServerModuleStubs);

  it.each([
    { name: "active defending objective", blocked: true },
    { name: "active attacking objective", blocked: true, attackerVillageId: "defender", defenderVillageId: "attacker" },
    { name: "destroyed objective", blocked: false, destroyed: true },
    { name: "ended war", blocked: false, endedAt: new Date() },
    { name: "terminal war", blocked: false, status: "DRAW" as const },
    { name: "legacy war", blocked: false, legacy: true },
    { name: "other sector", blocked: false, objectiveSector: 206 },
    { name: "other objective owner", blocked: false, objectiveVillageId: "attacker" },
    { name: "unrelated war", blocked: false, attackerVillageId: "other", defenderVillageId: "another" },
  ])("checks the current $name and logs only a successful release", async (scenario) => {
    const database = await seed();
    await database.insert(war).values({
      id: "release-war",
      type: "VILLAGE_WAR",
      attackerVillageId: scenario.attackerVillageId ?? "attacker",
      defenderVillageId: scenario.defenderVillageId ?? "defender",
      status: scenario.status ?? "ACTIVE",
      endedAt: scenario.endedAt ?? null,
      rules: scenario.legacy ? null : { ...defaultWarRules, enabled: true },
      objectiveState: {
        attackerEspionage: 0,
        defenderEspionage: 0,
        objectives: [{
          sector: scenario.objectiveSector ?? sectorId,
          villageId: scenario.objectiveVillageId ?? "defender",
          hp: defaultWarRules.shrineHp,
          maxHp: defaultWarRules.shrineHp,
          isReserve: false,
          destroyed: scenario.destroyed ?? false,
        }],
      },
    });
    const { result, statements } = await recordQueries(() => release(releaseClient(database)));
    expect(result.success).toBe(!scenario.blocked);
    if (scenario.blocked) expect(result.message).toBe(rejection);
    expect(Boolean(await database.query.sector.findFirst({ where: eq(sector.sector, sectorId) }))).toBe(scenario.blocked);
    expect(await database.query.actionLog.findMany()).toHaveLength(scenario.blocked ? 0 : 1);
    expect(statements.filter((query) => /^\s*DELETE /i.test(query))).toHaveLength(1);
    expect(statements.some((query) => /^(begin|start transaction|commit)\b/i.test(query.trim()))).toBe(false);
  });

  it.each(["leadership", "ownership"] as const)("rechecks %s changed after the initial reads", async (change) => {
    const database = await seed();
    const client = releaseClient(database, async (_query, execute) => {
      if (change === "leadership") {
        await database.update(village).set({ kageId: "replacement-kage" }).where(eq(village.id, "defender"));
      } else {
        await database.update(sector).set({ villageId: "other" }).where(eq(sector.sector, sectorId));
      }
      return execute();
    });
    expect(await release(client)).toMatchObject({ success: false, message: rejection });
    expect(await database.query.sector.findFirst({ where: eq(sector.sector, sectorId) })).toBeDefined();
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("retries a deadlocked delete without repeating its action log", async () => {
    const database = await seed();
    let attempts = 0;
    const client = releaseClient(database, async (_query, execute) => {
      if (++attempts === 1) throw new Error("Deadlock found when trying to get lock");
      return execute();
    });
    expect((await release(client)).success).toBe(true);
    expect(attempts).toBe(2);
    expect(await database.query.sector.findFirst({ where: eq(sector.sector, sectorId) })).toBeUndefined();
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("preserves an objective committed while release waits for the declaring village", async () => {
    const database = await seed();
    await enableObjectives(database);
    const locked = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const observer = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
    const declarationClient = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== "transaction") return Reflect.get(target, property, receiver);
        return (callback: Parameters<DrizzleClient["transaction"]>[0]) =>
          target.transaction((tx) => callback(new Proxy(tx, {
            get(transaction, key, txReceiver) {
              if (key !== "query") return Reflect.get(transaction, key, txReceiver);
              return {
                ...transaction.query,
                war: {
                  ...transaction.query.war,
                  findMany: async (options: Parameters<typeof transaction.query.war.findMany>[0]) => {
                    locked.resolve();
                    await resume.promise;
                    return transaction.query.war.findMany(options);
                  },
                },
              };
            },
          })));
      },
    });
    const started = startDeclaredWar(declarationClient, declaration);
    let released: ReturnType<typeof release> | undefined;
    try {
      await locked.promise;
      released = release(releaseClient(database));
      await expectVillageLockWait(observer, "S");
      resume.resolve();
      expect(await started).toBe(true);
      expect(await released).toMatchObject({ success: false, message: rejection });
      const current = await database.query.war.findFirst();
      expect(current?.objectiveState?.objectives).toContainEqual(expect.objectContaining({ sector: sectorId, villageId: "defender", destroyed: false }));
      expect(await database.query.sector.findFirst({ where: eq(sector.sector, sectorId) })).toBeDefined();
      expect(await database.query.actionLog.findMany()).toHaveLength(0);
    } finally {
      resume.resolve();
      await Promise.allSettled([started, ...(released ? [released] : [])]);
      await observer.end();
    }
  });

  it("makes a declaration see a release committed while its village lock waits", async () => {
    const database = await seed();
    await enableObjectives(database);
    const connection = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
    const deleted = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const client = releaseClient(database, async (query) => {
      // Keep this real procedure statement uncommitted only to observe the declaration's wait.
      await connection.beginTransaction();
      const compiled = dialect.sqlToQuery(query);
      const [result] = await connection.query<mysql.ResultSetHeader>(compiled.sql, compiled.params);
      deleted.resolve();
      await resume.promise;
      await connection.commit();
      return { rowsAffected: result.affectedRows } as Awaited<ReturnType<DrizzleClient["execute"]>>;
    });
    const released = release(client);
    let started: ReturnType<typeof startDeclaredWar> | undefined;
    try {
      await deleted.promise;
      started = startDeclaredWar(database, declaration);
      await expectVillageLockWait(connection, "X");
      resume.resolve();
      expect((await released).success).toBe(true);
      expect(await started).toBe(false);
      expect(await database.query.sector.findFirst({ where: eq(sector.sector, sectorId) })).toBeUndefined();
      expect(await database.query.war.findMany()).toHaveLength(0);
      expect((await database.query.village.findFirst({ where: eq(village.id, "attacker") }))?.tokens).toBe(defaultWarRules.declarationCost * 2);
      expect(await database.query.actionLog.findMany()).toHaveLength(1);
    } finally {
      resume.resolve();
      await Promise.allSettled([released, ...(started ? [started] : [])]);
      await connection.rollback();
      await connection.end();
    }
  });
});
