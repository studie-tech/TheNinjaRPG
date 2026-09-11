// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { WAR_VICTORY_TOKEN_BONUS } from "@/drizzle/constants";
import {
  actionLog,
  notification,
  userData,
  village,
  villageStructure,
  war,
  warAlly,
} from "@/drizzle/schema";
import { handleWarEnd } from "@/libs/war";
import { warRouter } from "@/routers/war";
import type { FetchActiveWarsReturnType } from "@/routers/war";
import type { DrizzleClient } from "@/server/db";
import {
  type AdminEndWarSnapshot,
  type SurrenderParticipationRole,
  type SurrenderWarInput,
  getAdminEndWarRevision,
} from "@/validators/war";
import { insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const ATTACKER_KAGE = "gap101-attacker-kage";
const DEFENDER_KAGE = "gap101-defender-kage";
const ATTACKER_ALLY_KAGE = "gap101-attacker-ally-kage";
const DEFENDER_ALLY_KAGE = "gap101-defender-ally-kage";
const ADMIN = "gap101-admin";
const BANNED_KAGE = "gap101-banned-kage";
const ATTACKER_VILLAGE = "gap101-attacker-village";
const DEFENDER_VILLAGE = "gap101-defender-village";
const ATTACKER_ALLY_VILLAGE = "gap101-attacker-ally-village";
const DEFENDER_ALLY_VILLAGE = "gap101-defender-ally-village";
const WAR_ID = "gap101-village-war";
const ATTACKER_ALLY_ID = "gap101-attacker-ally";
const DEFENDER_ALLY_ID = "gap101-defender-ally";
const STARTED_AT = new Date("2026-09-11T08:00:00.000Z");
const REDUCED_AT = new Date("2026-09-11T09:00:00.000Z");
const ATTACKER_ALLY_JOINED_AT = new Date("2026-09-11T08:15:00.000Z");
const DEFENDER_ALLY_JOINED_AT = new Date("2026-09-11T08:20:00.000Z");

const warRow = (
  overrides: Partial<typeof war.$inferInsert> = {},
): typeof war.$inferInsert => ({
  id: WAR_ID,
  attackerVillageId: ATTACKER_VILLAGE,
  defenderVillageId: DEFENDER_VILLAGE,
  startedAt: STARTED_AT,
  endedAt: null,
  status: "ACTIVE",
  type: "VILLAGE_WAR",
  sector: 0,
  attackerShrineHp: 450,
  attackerShrineMaxHp: 500,
  attackerShrineStatus: "ACTIVE",
  defenderShrineHp: 410,
  defenderShrineMaxHp: 500,
  defenderShrineStatus: "ACTIVE",
  lastTokenReductionAt: REDUCED_AT,
  targetStructureRoute: "/townhall",
  attackerWarHealth: 900,
  defenderWarHealth: 850,
  attackerWarHealthMax: 1000,
  defenderWarHealthMax: 1000,
  ...overrides,
});

const snapshot = (
  overrides: Partial<AdminEndWarSnapshot> = {},
): AdminEndWarSnapshot => ({
  id: WAR_ID,
  attackerVillageId: ATTACKER_VILLAGE,
  defenderVillageId: DEFENDER_VILLAGE,
  startedAt: STARTED_AT.toISOString(),
  endedAt: null,
  status: "ACTIVE",
  type: "VILLAGE_WAR",
  sector: 0,
  attackerShrineHp: 450,
  attackerShrineMaxHp: 500,
  attackerShrineStatus: "ACTIVE",
  defenderShrineHp: 410,
  defenderShrineMaxHp: 500,
  defenderShrineStatus: "ACTIVE",
  lastTokenReductionAt: REDUCED_AT.toISOString(),
  targetStructureRoute: "/townhall",
  attackerWarHealth: 900,
  defenderWarHealth: 850,
  attackerWarHealthMax: 1000,
  defenderWarHealthMax: 1000,
  ...overrides,
});

const roleData = (role: SurrenderParticipationRole) => {
  switch (role) {
    case "MAIN_ATTACKER":
      return { userId: ATTACKER_KAGE, villageId: ATTACKER_VILLAGE, ally: null };
    case "MAIN_DEFENDER":
      return { userId: DEFENDER_KAGE, villageId: DEFENDER_VILLAGE, ally: null };
    case "ALLY_ATTACKER":
      return {
        userId: ATTACKER_ALLY_KAGE,
        villageId: ATTACKER_ALLY_VILLAGE,
        ally: {
          id: ATTACKER_ALLY_ID,
          warId: WAR_ID,
          villageId: ATTACKER_ALLY_VILLAGE,
          supportVillageId: ATTACKER_VILLAGE,
          tokensPaid: 1200,
          joinedAt: ATTACKER_ALLY_JOINED_AT.toISOString(),
        },
      };
    case "ALLY_DEFENDER":
      return {
        userId: DEFENDER_ALLY_KAGE,
        villageId: DEFENDER_ALLY_VILLAGE,
        ally: {
          id: DEFENDER_ALLY_ID,
          warId: WAR_ID,
          villageId: DEFENDER_ALLY_VILLAGE,
          supportVillageId: DEFENDER_VILLAGE,
          tokensPaid: 1800,
          joinedAt: DEFENDER_ALLY_JOINED_AT.toISOString(),
        },
      };
  }
};

const surrenderInput = (
  role: SurrenderParticipationRole,
  requestId: string,
  expectedWar = snapshot(),
): SurrenderWarInput => {
  const current = roleData(role);
  return {
    warId: WAR_ID,
    requestId,
    expectedWar,
    expectedRevision: getAdminEndWarRevision(expectedWar),
    expectedActor: {
      userId: current.userId,
      villageId: current.villageId,
      kageId: current.userId,
    },
    expectedParticipationRole: role,
    expectedWarAlly: current.ally,
  };
};

const transactionalProxy = (
  database: DrizzleClient,
  wrap: (tx: DrizzleClient) => DrizzleClient,
) =>
  new Proxy(database, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return <T>(callback: (tx: DrizzleClient) => Promise<T>) =>
          target.transaction((tx) => callback(wrap(tx as unknown as DrizzleClient)));
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DrizzleClient;

describe("war.surrender validation", () => {
  it("ties the revision, war, actor, role, and ally assignment together", async () => {
    const caller = warRouter.createCaller({} as never);
    const valid = surrenderInput(
      "MAIN_ATTACKER",
      "10100000-0000-4000-8000-000000000001",
    );
    await expect(
      caller.surrender({ ...valid, expectedRevision: "wrong" }),
    ).rejects.toThrow();
    await expect(
      caller.surrender({
        ...valid,
        expectedParticipationRole: "ALLY_ATTACKER",
        expectedWarAlly: null,
      }),
    ).rejects.toThrow();
  });
});

describeWithDatabase("war.surrender", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      notification,
      warAlly,
      war,
      villageStructure,
      userData,
      village,
    );
    await insertUsers([
      {
        userId: ATTACKER_KAGE,
        username: "Gap101 Attacker Kage",
        villageId: ATTACKER_VILLAGE,
      },
      {
        userId: DEFENDER_KAGE,
        username: "Gap101 Defender Kage",
        villageId: DEFENDER_VILLAGE,
      },
      {
        userId: ATTACKER_ALLY_KAGE,
        username: "Gap101 Attacker Ally Kage",
        villageId: ATTACKER_ALLY_VILLAGE,
      },
      {
        userId: DEFENDER_ALLY_KAGE,
        username: "Gap101 Defender Ally Kage",
        villageId: DEFENDER_ALLY_VILLAGE,
      },
      { userId: ADMIN, username: "Gap101 Admin", role: "OWNER" },
      {
        userId: BANNED_KAGE,
        username: "Gap101 Banned Kage",
        villageId: ATTACKER_VILLAGE,
        isBanned: true,
      },
    ]);
    const database = await getTestDatabase();
    await database.insert(village).values([
      {
        id: ATTACKER_VILLAGE,
        name: "Gap101 Attackers",
        sector: 501,
        kageId: ATTACKER_KAGE,
        tokens: 9000,
      },
      {
        id: DEFENDER_VILLAGE,
        name: "Gap101 Defenders",
        sector: 502,
        kageId: DEFENDER_KAGE,
        tokens: 7000,
      },
      {
        id: ATTACKER_ALLY_VILLAGE,
        name: "Gap101 Attack Support",
        sector: 503,
        kageId: ATTACKER_ALLY_KAGE,
        tokens: 5000,
      },
      {
        id: DEFENDER_ALLY_VILLAGE,
        name: "Gap101 Defense Support",
        sector: 504,
        kageId: DEFENDER_ALLY_KAGE,
        tokens: 6000,
      },
    ]);
    await database.insert(villageStructure).values([
      {
        id: "gap101-attacker-townhall",
        name: "Town Hall",
        route: "/townhall",
        image: "townhall.png",
        villageId: ATTACKER_VILLAGE,
        curSp: 1000,
        maxSp: 1000,
      },
      {
        id: "gap101-defender-townhall",
        name: "Town Hall",
        route: "/townhall",
        image: "townhall.png",
        villageId: DEFENDER_VILLAGE,
        curSp: 1000,
        maxSp: 1000,
      },
    ]);
    await database.insert(war).values(warRow());
    await database.insert(warAlly).values([
      {
        id: ATTACKER_ALLY_ID,
        warId: WAR_ID,
        villageId: ATTACKER_ALLY_VILLAGE,
        supportVillageId: ATTACKER_VILLAGE,
        tokensPaid: 1200,
        joinedAt: ATTACKER_ALLY_JOINED_AT,
      },
      {
        id: DEFENDER_ALLY_ID,
        warId: WAR_ID,
        villageId: DEFENDER_ALLY_VILLAGE,
        supportVillageId: DEFENDER_VILLAGE,
        tokensPaid: 1800,
        joinedAt: DEFENDER_ALLY_JOINED_AT,
      },
    ]);
  });

  it("ends an attacker-main surrender exactly once with defender rewards", async () => {
    const database = await getTestDatabase();
    const input = surrenderInput(
      "MAIN_ATTACKER",
      "10100000-0000-4000-8000-000000000002",
    );
    const caller = await callerFor(warRouter, ATTACKER_KAGE);
    const first = await caller.surrender(input);
    const replay = await caller.surrender(input);

    expect(first).toMatchObject({
      success: true,
      outcome: "MAIN_WAR_ENDED",
      resultStatus: "DEFENDER_VICTORY",
      loserVillageId: ATTACKER_VILLAGE,
      winnerVillageId: DEFENDER_VILLAGE,
      participationRole: "MAIN_ATTACKER",
    });
    expect(replay).toEqual(first);
    expect(await database.query.war.findFirst()).toMatchObject({
      status: "DEFENDER_VICTORY",
    });
    expect(await database.query.village.findFirst({ where: eq(village.id, DEFENDER_VILLAGE) })).toMatchObject({
      tokens: 7000 + WAR_VICTORY_TOKEN_BONUS / 2,
    });
    expect(await database.query.village.findFirst({ where: eq(village.id, DEFENDER_ALLY_VILLAGE) })).toMatchObject({
      tokens: 6000 + WAR_VICTORY_TOKEN_BONUS / 2,
    });
    expect(await database.query.notification.findMany()).toHaveLength(1);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("ends a defender-main surrender with the exact attacker victory", async () => {
    const result = await (
      await callerFor(warRouter, DEFENDER_KAGE)
    ).surrender(
      surrenderInput(
        "MAIN_DEFENDER",
        "10100000-0000-4000-8000-000000000003",
      ),
    );
    expect(result).toMatchObject({
      success: true,
      resultStatus: "ATTACKER_VICTORY",
      loserVillageId: DEFENDER_VILLAGE,
      winnerVillageId: ATTACKER_VILLAGE,
    });
  });

  it("withdraws only the exact ally, preserves the war and other allies, and applies exhaustion", async () => {
    const database = await getTestDatabase();
    const result = await (
      await callerFor(warRouter, ATTACKER_ALLY_KAGE)
    ).surrender(
      surrenderInput(
        "ALLY_ATTACKER",
        "10100000-0000-4000-8000-000000000004",
      ),
    );
    expect(result).toMatchObject({
      success: true,
      outcome: "ALLY_WITHDRAWN",
      resultStatus: "ACTIVE",
      allyId: ATTACKER_ALLY_ID,
      winnerVillageId: null,
    });
    expect(await database.query.war.findFirst()).toMatchObject({ status: "ACTIVE" });
    expect(await database.query.warAlly.findMany()).toEqual([
      expect.objectContaining({ id: DEFENDER_ALLY_ID }),
    ]);
    expect(
      await database.query.village.findFirst({
        where: eq(village.id, ATTACKER_ALLY_VILLAGE),
      }),
    ).toMatchObject({ lastWarEndedAt: expect.any(Date), warExhaustionEndedAt: expect.any(Date) });
    expect(await database.query.notification.findMany()).toEqual([]);
  });

  it("replays ally withdrawal but rejects changed payload and recreated ally state", async () => {
    const database = await getTestDatabase();
    const input = surrenderInput(
      "ALLY_ATTACKER",
      "10100000-0000-4000-8000-000000000005",
    );
    const caller = await callerFor(warRouter, ATTACKER_ALLY_KAGE);
    const first = await caller.surrender(input);
    expect(await caller.surrender(input)).toEqual(first);
    const changed = await caller.surrender({
      ...input,
      expectedActor: { ...input.expectedActor, kageId: DEFENDER_KAGE },
    });
    expect(changed).toMatchObject({ success: false });

    await database.insert(warAlly).values({
      id: "gap101-recreated-ally",
      warId: WAR_ID,
      villageId: ATTACKER_ALLY_VILLAGE,
      supportVillageId: ATTACKER_VILLAGE,
      tokensPaid: 0,
    });
    expect(await caller.surrender(input)).toEqual({
      success: false,
      message: "Surrender receipt no longer matches ally withdrawal",
    });
  });

  it("rejects stale war, Kage, village, membership, banned, and missing-auth state without effects", async () => {
    const database = await getTestDatabase();
    const staleWar = snapshot({ defenderShrineHp: 409 });
    const stale = await (
      await callerFor(warRouter, ATTACKER_KAGE)
    ).surrender(
      surrenderInput(
        "MAIN_ATTACKER",
        "10100000-0000-4000-8000-000000000006",
        staleWar,
      ),
    );
    expect(stale).toMatchObject({ success: false });

    const wrongRole = await (
      await callerFor(warRouter, ATTACKER_KAGE)
    ).surrender({
      ...surrenderInput(
        "MAIN_ATTACKER",
        "10100000-0000-4000-8000-000000000007",
      ),
      expectedParticipationRole: "MAIN_DEFENDER",
    });
    expect(wrongRole).toMatchObject({ success: false });

    await database
      .update(village)
      .set({ kageId: BANNED_KAGE })
      .where(eq(village.id, ATTACKER_VILLAGE));
    const demoted = await (
      await callerFor(warRouter, ATTACKER_KAGE)
    ).surrender(
      surrenderInput(
        "MAIN_ATTACKER",
        "10100000-0000-4000-8000-000000000008",
      ),
    );
    expect(demoted).toMatchObject({ success: false });
    const bannedInput = surrenderInput(
      "MAIN_ATTACKER",
      "10100000-0000-4000-8000-000000000009",
    );
    bannedInput.expectedActor.userId = BANNED_KAGE;
    bannedInput.expectedActor.kageId = BANNED_KAGE;
    const banned = await (
      await callerFor(warRouter, BANNED_KAGE)
    ).surrender(bannedInput);
    expect(banned).toMatchObject({ success: false });
    const missing = await (
      await callerFor(warRouter, "gap101-missing")
    ).surrender(bannedInput);
    expect(missing).toMatchObject({ success: false });
    expect(await database.query.war.findFirst()).toMatchObject({ status: "ACTIVE" });
    expect(await database.query.notification.findMany()).toEqual([]);
    expect(await database.query.actionLog.findMany()).toEqual([]);
  });

  it("allows one exact effect for duplicate and distinct concurrent requests", async () => {
    const database = await getTestDatabase();
    const same = surrenderInput(
      "MAIN_ATTACKER",
      "10100000-0000-4000-8000-000000000010",
    );
    const caller = await callerFor(warRouter, ATTACKER_KAGE);
    const duplicate = await Promise.all([caller.surrender(same), caller.surrender(same)]);
    expect(duplicate.every((entry) => entry.success)).toBe(true);
    expect(await database.query.notification.findMany()).toHaveLength(1);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);

    await resetTables(actionLog, notification, warAlly, war);
    await database.insert(war).values(warRow());
    await database.insert(warAlly).values([
      {
        id: ATTACKER_ALLY_ID,
        warId: WAR_ID,
        villageId: ATTACKER_ALLY_VILLAGE,
        supportVillageId: ATTACKER_VILLAGE,
        tokensPaid: 1200,
        joinedAt: ATTACKER_ALLY_JOINED_AT,
      },
      {
        id: DEFENDER_ALLY_ID,
        warId: WAR_ID,
        villageId: DEFENDER_ALLY_VILLAGE,
        supportVillageId: DEFENDER_VILLAGE,
        tokensPaid: 1800,
        joinedAt: DEFENDER_ALLY_JOINED_AT,
      },
    ]);
    const distinct = await Promise.all([
      caller.surrender(
        surrenderInput(
          "MAIN_ATTACKER",
          "10100000-0000-4000-8000-000000000011",
        ),
      ),
      caller.surrender(
        surrenderInput(
          "MAIN_ATTACKER",
          "10100000-0000-4000-8000-000000000012",
        ),
      ),
    ]);
    expect(distinct.filter((entry) => entry.success)).toHaveLength(1);
    expect(await database.query.notification.findMany()).toHaveLength(1);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("serializes against normal resolution so only one outcome and reward set commits", async () => {
    const database = await getTestDatabase();
    const active = await database.query.war.findFirst({
      where: eq(war.id, WAR_ID),
      with: {
        attackerVillage: { with: { structures: true } },
        defenderVillage: { with: { structures: true } },
        warAllies: { with: { village: true } },
      },
    });
    const surrender = (
      await callerFor(warRouter, ATTACKER_KAGE)
    ).surrender(
      surrenderInput(
        "MAIN_ATTACKER",
        "10100000-0000-4000-8000-000000000013",
      ),
    );
    const normal = handleWarEnd(active as FetchActiveWarsReturnType, {
      client: database,
      forcedLoserVillageId: DEFENDER_VILLAGE,
    });
    const [surrenderResult, normalResult] = await Promise.all([surrender, normal]);
    expect(Number(surrenderResult.success) + Number(Boolean(normalResult))).toBe(1);
    expect(await database.query.notification.findMany()).toHaveLength(1);
    expect(await database.query.war.findFirst()).toMatchObject({
      status: expect.stringMatching(/^(ATTACKER|DEFENDER)_VICTORY$/),
    });
  });

  it("serializes against administrative removal without orphaned effects", async () => {
    const database = await getTestDatabase();
    const surrender = (
      await callerFor(warRouter, ATTACKER_KAGE)
    ).surrender(
      surrenderInput(
        "MAIN_ATTACKER",
        "10100000-0000-4000-8000-000000000017",
      ),
    );
    const admin = (await callerFor(warRouter, ADMIN)).adminEndWar({ warId: WAR_ID });
    const [surrenderResult, adminResult] = await Promise.all([surrender, admin]);
    expect(Number(surrenderResult.success) + Number(adminResult.success)).toBe(1);
    const remainingWar = await database.query.war.findFirst();
    if (surrenderResult.success) {
      expect(remainingWar).toMatchObject({ status: "DEFENDER_VICTORY" });
      expect(await database.query.notification.findMany()).toHaveLength(1);
    } else {
      expect(remainingWar).toBeUndefined();
      expect(await database.query.notification.findMany()).toEqual([]);
    }
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("lets only one distinct ally-removal request apply", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(warRouter, ATTACKER_ALLY_KAGE);
    const [first, second] = await Promise.all([
      caller.surrender(
        surrenderInput(
          "ALLY_ATTACKER",
          "10100000-0000-4000-8000-000000000018",
        ),
      ),
      caller.surrender(
        surrenderInput(
          "ALLY_ATTACKER",
          "10100000-0000-4000-8000-000000000019",
        ),
      ),
    ]);
    expect([first, second].filter((entry) => entry.success)).toHaveLength(1);
    expect(await database.query.war.findFirst()).toMatchObject({ status: "ACTIVE" });
    expect(
      await database.query.warAlly.findFirst({
        where: eq(warAlly.id, ATTACKER_ALLY_ID),
      }),
    ).toBeUndefined();
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("rolls back all main-war outcome effects when the receipt write fails", async () => {
    const database = await getTestDatabase();
    const failingDatabase = transactionalProxy(database, (tx) =>
      beforeStatements(tx, actionLog, [
        async () => undefined,
        async () => {
          throw new Error("Gap101 receipt failed");
        },
      ]),
    );
    await expect(
      callerForDatabase(warRouter, ATTACKER_KAGE, failingDatabase).surrender(
        surrenderInput(
          "MAIN_ATTACKER",
          "10100000-0000-4000-8000-000000000014",
        ),
      ),
    ).rejects.toThrow("Gap101 receipt failed");
    expect(await database.query.war.findFirst()).toMatchObject({ status: "ACTIVE" });
    expect(await database.query.village.findFirst({ where: eq(village.id, DEFENDER_VILLAGE) })).toMatchObject({ tokens: 7000 });
    expect(await database.query.notification.findMany()).toEqual([]);
    expect(await database.query.actionLog.findMany()).toEqual([]);
  });

  it("rolls back an ally removal when applying exhaustion fails", async () => {
    const database = await getTestDatabase();
    const failingDatabase = transactionalProxy(database, (tx) =>
      beforeStatements(tx, village, [
        async () => undefined,
        async () => {
          throw new Error("Gap101 exhaustion failed");
        },
      ]),
    );
    await expect(
      callerForDatabase(warRouter, ATTACKER_ALLY_KAGE, failingDatabase).surrender(
        surrenderInput(
          "ALLY_ATTACKER",
          "10100000-0000-4000-8000-000000000020",
        ),
      ),
    ).rejects.toThrow("Gap101 exhaustion failed");
    expect(
      await database.query.warAlly.findFirst({
        where: eq(warAlly.id, ATTACKER_ALLY_ID),
      }),
    ).toBeDefined();
    expect(await database.query.actionLog.findMany()).toEqual([]);
  });

  it("observes a Kage change at the lock boundary and commits zero outcome effects", async () => {
    const database = await getTestDatabase();
    const interleaved = transactionalProxy(database, (tx) =>
      beforeStatements(tx, village, [async () => {
        await database
          .update(village)
          .set({ kageId: DEFENDER_KAGE })
          .where(eq(village.id, ATTACKER_VILLAGE));
      }]),
    );
    const result = await callerForDatabase(
      warRouter,
      ATTACKER_KAGE,
      interleaved,
    ).surrender(
      surrenderInput(
        "MAIN_ATTACKER",
        "10100000-0000-4000-8000-000000000015",
      ),
    );
    expect(result).toMatchObject({ success: false });
    expect(await database.query.war.findFirst()).toMatchObject({ status: "ACTIVE" });
    expect(await database.query.notification.findMany()).toEqual([]);
    expect(await database.query.actionLog.findMany()).toEqual([]);
  });

  it("observes a war revision change at the lock boundary and commits zero effects", async () => {
    const database = await getTestDatabase();
    const interleaved = transactionalProxy(database, (tx) =>
      beforeStatements(tx, war, [async () => {
        await database
          .update(war)
          .set({ defenderShrineHp: 409 })
          .where(eq(war.id, WAR_ID));
      }]),
    );
    const result = await callerForDatabase(
      warRouter,
      ATTACKER_KAGE,
      interleaved,
    ).surrender(
      surrenderInput(
        "MAIN_ATTACKER",
        "10100000-0000-4000-8000-000000000016",
      ),
    );
    expect(result).toMatchObject({ success: false });
    expect(await database.query.war.findFirst()).toMatchObject({
      status: "ACTIVE",
      defenderShrineHp: 409,
    });
    expect(await database.query.notification.findMany()).toEqual([]);
    expect(await database.query.actionLog.findMany()).toEqual([]);
  });
});
