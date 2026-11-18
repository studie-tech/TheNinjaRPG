import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { and, asc, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { GET as dailyCounters } from "@/app/api/daily-counters/route";
import { battle, clan, gameSetting, questHistory, userData } from "@/drizzle/schema";
import {
  executeRowsForGET10,
  missingBattleUserDataWhere,
  missingClanUserDataWhere,
  tavernActiveUserDataWhere,
  updateUserDataForGET,
  updateUserDataForGET2,
} from "@/queries/cleaner";
import {
  dailyCountersPendingWhere,
  updateUserDataForDailyCounters,
} from "@/queries/profile";
import type { DrizzleClient } from "@/server/db";
import { updateUserDataCandidates } from "@/server/utils/cleaner";
import { periodStart } from "@/utils/time";
import { insertClans, insertQuestHistory, insertUsers } from "../../setup/factories";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../setup/serverModules";
import { aroundStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  queryRawSql,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";

const dayStart = periodStart("daily", new Date());
const yesterday = new Date(dayStart.getTime() - 60_000);

/** Users spanning batch boundaries, AI rows and every counter the daily reset touches. */
const counterUsers = Array.from({ length: 7 }, (_, index) => ({
  userId: `counter-${index}`,
  username: `counter-${index}`,
  isAi: index === 3,
  villagePrestige: index * 1.5,
  dailyArenaFights: index + 1,
  dailyMissions: index,
  dailyErrands: 2,
  dailyMedicalMissions: 3,
  dailyPvpMissions: 4,
  dailyWarMissions: 5,
  dailyTrainings: 6,
  dailyOverworldQuestRolls: 7,
  dailySageActivations: 8,
  aiCalls: 9,
  tavernMessages: [0, 1, 19, 20, 21, 100, 1_000_001][index]!,
  dailyCountersResetAt: yesterday,
  tavernDecayAt: yesterday,
}));

const counterColumns = {
  userId: userData.userId,
  villagePrestige: userData.villagePrestige,
  dailyArenaFights: userData.dailyArenaFights,
  dailyMissions: userData.dailyMissions,
  dailyErrands: userData.dailyErrands,
  dailyMedicalMissions: userData.dailyMedicalMissions,
  dailyPvpMissions: userData.dailyPvpMissions,
  dailyWarMissions: userData.dailyWarMissions,
  dailyTrainings: userData.dailyTrainings,
  dailyOverworldQuestRolls: userData.dailyOverworldQuestRolls,
  dailySageActivations: userData.dailySageActivations,
  aiCalls: userData.aiCalls,
  tavernMessages: userData.tavernMessages,
  clanId: userData.clanId,
  battleId: userData.battleId,
  status: userData.status,
  curEnergy: userData.curEnergy,
  travelFinishAt: userData.travelFinishAt,
  bracketImmunityPausedAt: userData.bracketImmunityPausedAt,
};

const readUsers = async (db: DrizzleClient) =>
  db.select(counterColumns).from(userData).orderBy(asc(userData.userId));

/** Seed `users`, run `work` and return the resulting rows, so two variants compare exactly. */
const resultOf = async (
  users: Parameters<typeof insertUsers>[0],
  work: (db: DrizzleClient) => Promise<unknown>,
) => {
  await resetTables(questHistory, battle, clan, userData);
  await insertUsers(users);
  const db = await getTestDatabase();
  await work(db);
  return readUsers(db);
};

describeWithDatabase("batched UserData cron updates", () => {
  beforeEach(async () => {
    await resetTables(gameSetting, questHistory, battle, clan, userData);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });

  it("resets daily counters exactly like the table-wide UPDATE, across batches", async () => {
    const tableWide = await resultOf(counterUsers, (db) =>
      db.update(userData).set({
        villagePrestige: sql`${userData.villagePrestige} + 1`,
        dailyArenaFights: 0,
        dailyMissions: 0,
        dailyErrands: 0,
        dailyMedicalMissions: 0,
        dailyPvpMissions: 0,
        dailyWarMissions: 0,
        dailyTrainings: 0,
        dailyOverworldQuestRolls: 0,
        dailySageActivations: 0,
        aiCalls: 0,
      }),
    );
    const batched = await resultOf(counterUsers, async (db) => {
      const { statements } = await recordQueries(() =>
        updateUserDataCandidates(
          db,
          dailyCountersPendingWhere(dayStart),
          (batch) => updateUserDataForDailyCounters(db, dayStart, batch),
          3,
        ),
      );
      // Seven players in batches of three: three key pages and three writes.
      expect(statements.filter((s) => /^update/i.test(s))).toHaveLength(3);
      expect(statements.filter((s) => /^select/i.test(s))).toHaveLength(3);
    });
    expect(batched).toEqual(tableWide);
    expect(batched.map((row) => row.villagePrestige)).toEqual(
      counterUsers.map((user) => user.villagePrestige + 1),
    );
  });

  it("keeps each default batch on a primary-key range plan", async () => {
    // Keep each batch selective so scanning the full table is not a cheaper valid plan.
    await insertUsers(
      Array.from({ length: 4500 }, (_, index) => ({
        userId: `plan-${String(index).padStart(4, "0")}`,
        username: `plan-${index}`,
        dailyCountersResetAt: index < 450 ? yesterday : dayStart,
      })),
    );
    const db = await getTestDatabase();
    await db.execute(sql`ANALYZE TABLE ${userData}`);
    const { statements } = await recordQueries(() =>
      updateUserDataCandidates(db, dailyCountersPendingWhere(dayStart), (batch) =>
        updateUserDataForDailyCounters(db, dayStart, batch),
      ),
    );
    const writes = statements.filter((s) => /^update/i.test(s));
    expect(writes).toHaveLength(3);
    // A key list past range_optimizer_max_mem_size falls back to a full index scan.
    const [plan] = await queryRawSql<{ type: string; key: string }>(
      `EXPLAIN FORMAT=TRADITIONAL ${writes[0]}`,
    );
    expect(plan).toMatchObject({ type: "range", key: "PRIMARY" });
  });

  it("grants prestige once when a run is retried after a failed batch", async () => {
    await insertUsers(counterUsers);
    const db = await getTestDatabase();
    let writes = 0;
    const failsSecondWrite = aroundStatements(
      db,
      userData,
      async (run) => {
        writes += 1;
        if (writes === 2) throw new Error("Statement failed on purpose");
        return run();
      },
      { operations: ["update"] },
    );
    const reset = (client: DrizzleClient) =>
      updateUserDataCandidates(
        client,
        dailyCountersPendingWhere(dayStart),
        (batch) => updateUserDataForDailyCounters(client, dayStart, batch),
        3,
      );
    await expect(reset(failsSecondWrite)).rejects.toThrow(
      "Statement failed on purpose",
    );
    expect((await readUsers(db)).map((row) => row.villagePrestige)).toEqual(
      counterUsers.map((user, index) => user.villagePrestige + (index < 3 ? 1 : 0)),
    );

    await reset(db);
    await reset(db);
    const rows = await readUsers(db);
    expect(rows.map((row) => row.villagePrestige)).toEqual(
      counterUsers.map((user) => user.villagePrestige + 1),
    );
    expect(rows.every((row) => row.dailyArenaFights === 0 && row.aiCalls === 0)).toBe(
      true,
    );
  });

  it("runs the daily-counters cron once per day for every player", async () => {
    await insertUsers(counterUsers);
    const db = await getTestDatabase();
    stubDatabase(db);
    stubCronAuth(() => null);
    const request = () => new Request("https://example.com/api/daily-counters");

    expect(await (await dailyCounters(request())).json()).toBe("OK");
    expect(await (await dailyCounters(request())).json()).toBe(
      "Wait until the next day to run this again",
    );

    const rows = await db
      .select({
        villagePrestige: userData.villagePrestige,
        dailyCountersResetAt: userData.dailyCountersResetAt,
      })
      .from(userData)
      .orderBy(asc(userData.userId));
    expect(rows).toEqual(
      counterUsers.map((user) => ({
        villagePrestige: user.villagePrestige + 1,
        dailyCountersResetAt: dayStart,
      })),
    );
  });

  it("decays tavern messages exactly like the table-wide UPDATE", async () => {
    const tableWide = await resultOf(counterUsers, (db) =>
      db
        .update(userData)
        .set({ tavernMessages: sql`FLOOR(${userData.tavernMessages} * 0.95)` }),
    );
    const batched = await resultOf(counterUsers, (db) =>
      updateUserDataCandidates(
        db,
        tavernActiveUserDataWhere(dayStart),
        (batch) => executeRowsForGET10(db, dayStart, batch),
        2,
      ),
    );
    expect(batched).toEqual(tableWide);
    expect(batched.map((row) => row.tavernMessages)).toEqual([
      0, 0, 18, 19, 19, 95, 950_000,
    ]);
  });

  it("decays tavern messages once when a run is retried after a failed batch", async () => {
    await insertUsers(counterUsers);
    const db = await getTestDatabase();
    let writes = 0;
    const failsSecondWrite = aroundStatements(
      db,
      userData,
      async (run) => {
        writes += 1;
        if (writes === 2) throw new Error("Statement failed on purpose");
        return run();
      },
      { operations: ["update"] },
    );
    const decay = (client: DrizzleClient) =>
      updateUserDataCandidates(
        client,
        tavernActiveUserDataWhere(dayStart),
        (batch) => executeRowsForGET10(client, dayStart, batch),
        2,
      );
    await expect(decay(failsSecondWrite)).rejects.toThrow(
      "Statement failed on purpose",
    );
    // The first batch holds the two lowest tavern-active ids: counter-1 and counter-2.
    expect((await readUsers(db)).map((row) => row.tavernMessages)).toEqual([
      0, 0, 18, 20, 21, 100, 1_000_001,
    ]);

    await decay(db);
    await decay(db);
    expect((await readUsers(db)).map((row) => row.tavernMessages)).toEqual([
      0, 0, 18, 19, 19, 95, 950_000,
    ]);
  });

  it("releases missing clans exactly like the table-wide UPDATE", async () => {
    const users = counterUsers.map((user, index) => ({
      ...user,
      clanId: index % 3 === 0 ? null : index % 3 === 1 ? "live-clan" : `gone-${index}`,
    }));
    const seed = async (db: DrizzleClient) => {
      await insertClans([{ id: "live-clan" }]);
      return db;
    };
    const tableWide = await resultOf(users, async (db) =>
      (await seed(db))
        .update(userData)
        .set({ clanId: null })
        .where(
          and(
            isNotNull(userData.clanId),
            notExists(
              db.select({ id: clan.id }).from(clan).where(eq(clan.id, userData.clanId)),
            ),
          ),
        ),
    );
    const batched = await resultOf(users, async (db) =>
      updateUserDataCandidates(
        await seed(db),
        missingClanUserDataWhere(db),
        (batch) => updateUserDataForGET2(db, batch),
        1,
      ),
    );
    expect(batched).toEqual(tableWide);
    expect(batched.map((row) => row.clanId)).toEqual([
      null,
      "live-clan",
      null,
      null,
      "live-clan",
      null,
      null,
    ]);
  });

  it("releases missing battles like one statement over every player", async () => {
    const users = counterUsers.map((user, index) => ({
      ...user,
      status: index === 0 ? ("AWAKE" as const) : ("BATTLE" as const),
      battleId: index === 0 ? null : index === 1 ? "live-battle" : `gone-${index}`,
      curEnergy: 10,
      maxEnergy: 100,
      travelFinishAt: new Date(dayStart.getTime() + 3_600_000),
    }));
    const seed = async (db: DrizzleClient) => {
      await db.insert(battle).values({
        id: "live-battle",
        battleType: "COMBAT",
        background: "default",
        usersState: [],
        usersEffects: [],
        groundEffects: [],
        extraState: {} as (typeof battle.$inferInsert)["extraState"],
      });
      // An open isolated run keeps its player in BATTLE once the missing fight is released.
      await insertQuestHistory([
        { userId: "counter-2", questId: "pyramid", isolated: true, completed: 0 },
      ]);
      return db;
    };
    const oneStatement = await resultOf(users, async (db) =>
      updateUserDataForGET(
        await seed(db),
        users.map((user) => user.userId),
      ),
    );
    const batched = await resultOf(users, async (db) =>
      updateUserDataCandidates(
        await seed(db),
        missingBattleUserDataWhere(db),
        (batch) => updateUserDataForGET(db, batch),
        2,
      ),
    );
    // Energy regenerates up to the statement's NOW(3); compare it separately.
    const withoutEnergy = (rows: typeof batched) =>
      rows.map(({ curEnergy: _energy, ...row }) => row);
    expect(withoutEnergy(batched)).toEqual(withoutEnergy(oneStatement));
    expect(batched.map((row) => [row.battleId, row.status])).toEqual([
      [null, "AWAKE"],
      ["live-battle", "BATTLE"],
      [null, "BATTLE"],
      [null, "AWAKE"],
      [null, "AWAKE"],
      [null, "AWAKE"],
      [null, "AWAKE"],
    ]);
    expect(batched.map((row) => row.travelFinishAt === null)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    const db = await getTestDatabase();
    const released = await db
      .select({ curEnergy: userData.curEnergy })
      .from(userData)
      .where(inArray(userData.userId, ["counter-2", "counter-3"]));
    expect(released.every((row) => row.curEnergy >= 10)).toBe(true);
  });
});
