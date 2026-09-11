// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actionLog,
  notification,
  sector,
  userData,
  userRequest,
  village,
  villageStructure,
  war,
  warAlly,
  warKill,
} from "@/drizzle/schema";
import { handleWarEnd } from "@/libs/war";
import { insertActiveWarKill } from "@/libs/combat/database";
import { warRouter } from "@/routers/war";
import type { FetchActiveWarsReturnType } from "@/routers/war";
import type { DrizzleClient } from "@/server/db";
import {
  type AdminEndWarSnapshot,
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

const ADMIN = "gap100-admin";
const BANNED_ADMIN = "gap100-banned-admin";
const ORDINARY_USER = "gap100-user";
const ATTACKER_KAGE = "gap100-attacker-kage";
const DEFENDER_KAGE = "gap100-defender-kage";
const ALLY_KAGE = "gap100-ally-kage";
const ATTACKER = "gap100-attacker";
const DEFENDER = "gap100-defender";
const ALLY = "gap100-ally";
const ATTACKER_VILLAGE = "gap100-attacker-village";
const DEFENDER_VILLAGE = "gap100-defender-village";
const ALLY_VILLAGE = "gap100-ally-village";
const WAR_ID = "gap100-sector-war";
const STARTED_AT = new Date("2026-09-10T10:00:00.000Z");
const REDUCED_AT = new Date("2026-09-10T11:00:00.000Z");

const sectorWarRow = (
  overrides: Partial<typeof war.$inferInsert> = {},
): typeof war.$inferInsert => ({
  id: WAR_ID,
  attackerVillageId: ATTACKER_VILLAGE,
  defenderVillageId: DEFENDER_VILLAGE,
  startedAt: STARTED_AT,
  endedAt: null,
  status: "ACTIVE",
  type: "SECTOR_WAR",
  sector: 401,
  attackerShrineHp: 500,
  attackerShrineMaxHp: 500,
  attackerShrineStatus: "ACTIVE",
  defenderShrineHp: 321,
  defenderShrineMaxHp: 500,
  defenderShrineStatus: "ACTIVE",
  lastTokenReductionAt: REDUCED_AT,
  targetStructureRoute: "/townhall",
  attackerWarHealth: 820,
  defenderWarHealth: 760,
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
  type: "SECTOR_WAR",
  sector: 401,
  attackerShrineHp: 500,
  attackerShrineMaxHp: 500,
  attackerShrineStatus: "ACTIVE",
  defenderShrineHp: 321,
  defenderShrineMaxHp: 500,
  defenderShrineStatus: "ACTIVE",
  lastTokenReductionAt: REDUCED_AT.toISOString(),
  targetStructureRoute: "/townhall",
  attackerWarHealth: 820,
  defenderWarHealth: 760,
  attackerWarHealthMax: 1000,
  defenderWarHealthMax: 1000,
  ...overrides,
});

const endInput = (
  requestId: string,
  overrides: Partial<{
    warId: string;
    expectedRevision: string;
    expectedWar: AdminEndWarSnapshot;
  }> = {},
) => {
  const expectedWar = overrides.expectedWar ?? snapshot();
  return {
    warId: WAR_ID,
    requestId,
    expectedWar,
    expectedRevision: getAdminEndWarRevision(expectedWar),
    ...overrides,
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

describe("war.adminEndWar validation", () => {
  it("requires the durable request fields together and ties the snapshot to warId", async () => {
    const caller = warRouter.createCaller({} as never);
    await expect(
      caller.adminEndWar({ warId: WAR_ID, requestId: crypto.randomUUID() }),
    ).rejects.toThrow();
    await expect(
      caller.adminEndWar({
        ...endInput("10000000-0000-4000-8000-000000000001"),
        warId: "different-war",
      }),
    ).rejects.toThrow();
  });
});

describeWithDatabase("war.adminEndWar", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      notification,
      userRequest,
      warKill,
      warAlly,
      war,
      sector,
      villageStructure,
      userData,
      village,
    );
    await insertUsers([
      { userId: ADMIN, username: "Gap100 Admin", role: "OWNER" },
      {
        userId: BANNED_ADMIN,
        username: "Gap100 Banned",
        role: "OWNER",
        isBanned: true,
      },
      { userId: ORDINARY_USER, username: "Gap100 User", role: "USER" },
      { userId: ATTACKER_KAGE, username: "Gap100 Attacker Kage" },
      { userId: DEFENDER_KAGE, username: "Gap100 Defender Kage" },
      { userId: ALLY_KAGE, username: "Gap100 Ally Kage" },
      {
        userId: ATTACKER,
        username: "Gap100 Attacker",
        villageId: ATTACKER_VILLAGE,
        warParticipantUntil: new Date("2030-01-01T00:00:00.000Z"),
      },
      {
        userId: DEFENDER,
        username: "Gap100 Defender",
        villageId: DEFENDER_VILLAGE,
        warParticipantUntil: new Date("2030-01-01T00:00:00.000Z"),
      },
      {
        userId: ALLY,
        username: "Gap100 Ally",
        villageId: ALLY_VILLAGE,
        warParticipantUntil: new Date("2030-01-01T00:00:00.000Z"),
      },
    ]);
    const database = await getTestDatabase();
    await database.insert(village).values([
      {
        id: ATTACKER_VILLAGE,
        name: "Gap100 Attackers",
        sector: 410,
        kageId: ATTACKER_KAGE,
        tokens: 900,
      },
      {
        id: DEFENDER_VILLAGE,
        name: "Gap100 Defenders",
        sector: 411,
        kageId: DEFENDER_KAGE,
        tokens: 700,
      },
      {
        id: ALLY_VILLAGE,
        name: "Gap100 Allies",
        sector: 412,
        kageId: ALLY_KAGE,
        tokens: 500,
      },
    ]);
    await database.insert(sector).values({
      sector: 401,
      villageId: DEFENDER_VILLAGE,
      shrineLevel: 4,
      capturedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await database.insert(villageStructure).values([
      {
        id: "gap100-attacker-townhall",
        name: "Town Hall",
        route: "/townhall",
        image: "townhall.png",
        villageId: ATTACKER_VILLAGE,
        curSp: 1000,
        maxSp: 1000,
      },
      {
        id: "gap100-defender-townhall",
        name: "Town Hall",
        route: "/townhall",
        image: "townhall.png",
        villageId: DEFENDER_VILLAGE,
        curSp: 1000,
        maxSp: 1000,
      },
    ]);
    await database.insert(war).values(sectorWarRow());
    await database.insert(warAlly).values({
      id: "gap100-war-ally",
      warId: WAR_ID,
      villageId: ALLY_VILLAGE,
      supportVillageId: ATTACKER_VILLAGE,
      tokensPaid: 50,
    });
    await database.insert(warKill).values({
      id: "gap100-war-kill",
      warId: WAR_ID,
      killerId: ATTACKER,
      victimId: DEFENDER,
      killerVillageId: ATTACKER_VILLAGE,
      victimVillageId: DEFENDER_VILLAGE,
      sector: 401,
      shrineHpChange: -20,
      townhallHpChange: 0,
    });
    await database.insert(userRequest).values({
      id: "gap100-ally-offer",
      senderId: ATTACKER_KAGE,
      receiverId: ALLY_KAGE,
      status: "PENDING",
      type: "WAR_ALLY",
      relatedId: WAR_ID,
      value: 50,
    });
  });

  it("atomically removes the exact sector war and history without awarding an outcome", async () => {
    const database = await getTestDatabase();
    const input = endInput("10000000-0000-4000-8000-000000000002");
    const result = await (await callerFor(warRouter, ADMIN)).adminEndWar(input);

    expect(result).toMatchObject({
      success: true,
      requestId: input.requestId,
      warId: WAR_ID,
      warType: "SECTOR_WAR",
      expectedRevision: input.expectedRevision,
      previousStatus: "ACTIVE",
      outcome: "ADMIN_ENDED",
      removedWarKillCount: 1,
      removedWarAllyCount: 1,
      removedAllyOfferCount: 1,
      clearedParticipantCount: 3,
      auditLogId: `admin-end-war:${input.requestId}`,
    });
    expect(await database.query.war.findFirst()).toBeUndefined();
    expect(await database.query.warKill.findMany()).toEqual([]);
    expect(await database.query.warAlly.findMany()).toEqual([]);
    expect(await database.query.userRequest.findMany()).toEqual([]);
    expect(await database.query.notification.findMany()).toEqual([]);
    expect(await database.query.sector.findFirst()).toMatchObject({
      villageId: DEFENDER_VILLAGE,
      shrineLevel: 4,
    });
    expect(
      await database.query.village.findMany({
        columns: { id: true, tokens: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { id: ATTACKER_VILLAGE, tokens: 900 },
        { id: DEFENDER_VILLAGE, tokens: 700 },
        { id: ALLY_VILLAGE, tokens: 500 },
      ]),
    );
    expect(
      await database.query.userData.findMany({
        where: eq(userData.warParticipantUntil, new Date(0)),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: ATTACKER }),
        expect.objectContaining({ userId: DEFENDER }),
        expect.objectContaining({ userId: ALLY }),
      ]),
    );
  });

  it("replays the exact request once and rejects changed-payload UUID reuse", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(warRouter, ADMIN);
    const input = endInput("10000000-0000-4000-8000-000000000003");
    const first = await caller.adminEndWar(input);
    const replay = await caller.adminEndWar(input);
    const changedSnapshot = snapshot({ sector: 402 });
    const changed = await caller.adminEndWar({
      ...input,
      expectedWar: changedSnapshot,
      expectedRevision: getAdminEndWarRevision(changedSnapshot),
    });

    expect(first.success).toBe(true);
    expect(replay).toEqual(first);
    expect(changed).toEqual({
      success: false,
      message: "Invalid administrative war-end request ID",
    });
    expect(
      await database.query.actionLog.findMany({
        where: eq(actionLog.id, `admin-end-war:${input.requestId}`),
      }),
    ).toHaveLength(1);
  });

  it("rejects receipt replay when the target or cleaned child state was recreated", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(warRouter, ADMIN);
    const input = endInput("10000000-0000-4000-8000-000000000013");
    expect((await caller.adminEndWar(input)).success).toBe(true);

    await database.insert(war).values(sectorWarRow());
    expect(await caller.adminEndWar(input)).toEqual({
      success: false,
      message: "Administrative war-end receipt no longer matches current state",
    });

    await database.delete(war).where(eq(war.id, WAR_ID));
    await database.insert(userRequest).values({
      id: "gap100-recreated-offer",
      senderId: ATTACKER_KAGE,
      receiverId: ALLY_KAGE,
      status: "PENDING",
      type: "WAR_ALLY",
      relatedId: WAR_ID,
      value: 1,
    });
    expect(await caller.adminEndWar(input)).toEqual({
      success: false,
      message: "Administrative war-end receipt no longer matches current state",
    });
  });

  it("rejects stale state, banned actors, and unauthorized actors", async () => {
    const database = await getTestDatabase();
    await database
      .update(war)
      .set({ defenderShrineHp: 300 })
      .where(eq(war.id, WAR_ID));

    const stale = await (
      await callerFor(warRouter, ADMIN)
    ).adminEndWar(endInput("10000000-0000-4000-8000-000000000004"));
    const banned = await (
      await callerFor(warRouter, BANNED_ADMIN)
    ).adminEndWar(endInput("10000000-0000-4000-8000-000000000005"));
    const unauthorized = await (
      await callerFor(warRouter, ORDINARY_USER)
    ).adminEndWar(endInput("10000000-0000-4000-8000-000000000006"));

    expect(stale).toEqual({
      success: false,
      message: "War state changed. Refresh before ending it",
    });
    expect(banned.success).toBe(false);
    expect(unauthorized.success).toBe(false);
    expect(await database.query.war.findFirst()).toBeDefined();
  });

  it("makes distinct concurrent calls single-winner and same-request calls exact replays", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(warRouter, ADMIN);
    const sameInput = endInput("10000000-0000-4000-8000-000000000007");
    const sameResults = await Promise.all([
      caller.adminEndWar(sameInput),
      caller.adminEndWar(sameInput),
    ]);
    expect(sameResults).toEqual([sameResults[0], sameResults[0]]);
    expect(sameResults[0]?.success).toBe(true);

    await database.insert(war).values(sectorWarRow());
    const competitors = await Promise.all([
      caller.adminEndWar(endInput("10000000-0000-4000-8000-000000000008")),
      caller.adminEndWar(endInput("10000000-0000-4000-8000-000000000009")),
    ]);
    expect(competitors.map((result) => result.success).sort()).toEqual([
      false,
      true,
    ]);
  });

  it("serializes against an active sector-war state update without partial cleanup", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(warRouter, ADMIN);
    const [adminResult] = await Promise.all([
      caller.adminEndWar(endInput("10000000-0000-4000-8000-000000000011")),
      database
        .update(war)
        .set({ defenderShrineHp: 300 })
        .where(and(eq(war.id, WAR_ID), eq(war.status, "ACTIVE"))),
    ]);
    const remainingWar = await database.query.war.findFirst({
      where: eq(war.id, WAR_ID),
    });
    const receipt = await database.query.actionLog.findFirst({
      where: eq(
        actionLog.id,
        "admin-end-war:10000000-0000-4000-8000-000000000011",
      ),
    });

    if (adminResult.success) {
      expect(remainingWar).toBeUndefined();
      expect(receipt).toBeDefined();
      expect(await database.query.warKill.findMany()).toEqual([]);
      expect(await database.query.warAlly.findMany()).toEqual([]);
    } else {
      expect(adminResult.message).toBe("War state changed. Refresh before ending it");
      expect(remainingWar?.defenderShrineHp).toBe(300);
      expect(receipt).toBeUndefined();
      expect(await database.query.warKill.findMany()).toHaveLength(1);
      expect(await database.query.warAlly.findMany()).toHaveLength(1);
    }
  });

  it("serializes combat kill insertion with cleanup in either order", async () => {
    const database = await getTestDatabase();
    await insertActiveWarKill(database, {
      id: "gap100-action-wins-kill",
      warId: WAR_ID,
      killerId: ATTACKER,
      victimId: DEFENDER,
      killerVillageId: ATTACKER_VILLAGE,
      victimVillageId: DEFENDER_VILLAGE,
      sector: 401,
      shrineHpChange: -10,
      townhallHpChange: 0,
    });
    expect(await database.query.warKill.findMany()).toHaveLength(2);

    const adminResult = await (
      await callerFor(warRouter, ADMIN)
    ).adminEndWar(endInput("10000000-0000-4000-8000-000000000016"));
    expect(adminResult).toMatchObject({
      success: true,
      removedWarKillCount: 2,
    });
    await insertActiveWarKill(database, {
      id: "gap100-admin-wins-kill",
      warId: WAR_ID,
      killerId: ATTACKER,
      victimId: DEFENDER,
      killerVillageId: ATTACKER_VILLAGE,
      victimVillageId: DEFENDER_VILLAGE,
      sector: 401,
      shrineHpChange: -10,
      townhallHpChange: 0,
    });
    expect(await database.query.warKill.findMany()).toEqual([]);
  });

  it("lets normal sector resolution win before admin cleanup and keeps its exact outcome", async () => {
    const database = await getTestDatabase();
    const staleWar = await database.query.war.findFirst({
      where: eq(war.id, WAR_ID),
      with: {
        attackerVillage: { with: { structures: true } },
        defenderVillage: { with: { structures: true } },
        warAllies: { with: { village: true } },
      },
    });
    expect(staleWar).toBeDefined();

    const normalResult = await handleWarEnd(
      staleWar as FetchActiveWarsReturnType,
      {
        client: database,
        forcedLoserVillageId: DEFENDER_VILLAGE,
      },
    );
    const adminInput = endInput("10000000-0000-4000-8000-000000000014");
    const adminResult = await (
      await callerFor(warRouter, ADMIN)
    ).adminEndWar(adminInput);

    expect(normalResult).toMatchObject({
      id: WAR_ID,
      status: "ATTACKER_VICTORY",
    });
    expect(adminResult).toEqual({
      success: false,
      message: "War is no longer active. Refresh and try again",
    });
    expect(
      await database.query.war.findFirst({ where: eq(war.id, WAR_ID) }),
    ).toMatchObject({ status: "ATTACKER_VICTORY" });
    expect(await database.query.sector.findFirst()).toMatchObject({
      villageId: ATTACKER_VILLAGE,
      shrineLevel: 1,
    });
    expect(
      await database.query.villageStructure.findFirst({
        where: eq(villageStructure.id, "gap100-defender-townhall"),
      }),
    ).toMatchObject({ curSp: 700 });
    expect(await database.query.notification.findMany()).toHaveLength(1);
    expect(await database.query.warKill.findMany()).toHaveLength(1);
    expect(await database.query.warAlly.findMany()).toHaveLength(1);
    expect(
      await database.query.actionLog.findFirst({
        where: eq(actionLog.id, `admin-end-war:${adminInput.requestId}`),
      }),
    ).toBeUndefined();
  });

  it("makes a stale normal resolver a complete no-op after admin cleanup wins", async () => {
    const database = await getTestDatabase();
    const staleWar = await database.query.war.findFirst({
      where: eq(war.id, WAR_ID),
      with: {
        attackerVillage: { with: { structures: true } },
        defenderVillage: { with: { structures: true } },
        warAllies: { with: { village: true } },
      },
    });
    expect(staleWar).toBeDefined();
    const adminInput = endInput("10000000-0000-4000-8000-000000000015");
    expect(
      (await (await callerFor(warRouter, ADMIN)).adminEndWar(adminInput)).success,
    ).toBe(true);

    const before = {
      villages: await database.query.village.findMany({
        columns: { id: true, tokens: true },
      }),
      sector: await database.query.sector.findFirst(),
      structures: await database.query.villageStructure.findMany(),
      notifications: await database.query.notification.findMany(),
      receipt: await database.query.actionLog.findMany(),
    };
    const staleResult = await handleWarEnd(
      staleWar as FetchActiveWarsReturnType,
      {
        client: database,
        forcedLoserVillageId: DEFENDER_VILLAGE,
      },
    );

    expect(staleResult).toBeUndefined();
    expect(await database.query.war.findFirst()).toBeUndefined();
    expect(await database.query.warKill.findMany()).toEqual([]);
    expect(await database.query.warAlly.findMany()).toEqual([]);
    expect(await database.query.userRequest.findMany()).toEqual([]);
    expect(
      await database.query.village.findMany({
        columns: { id: true, tokens: true },
      }),
    ).toEqual(before.villages);
    expect(await database.query.sector.findFirst()).toEqual(before.sector);
    expect(await database.query.villageStructure.findMany()).toEqual(
      before.structures,
    );
    expect(await database.query.notification.findMany()).toEqual(
      before.notifications,
    );
    expect(await database.query.actionLog.findMany()).toEqual(before.receipt);
  });

  it("preserves a village token update that wins before prepared decay locks its snapshot", async () => {
    const database = await getTestDatabase();
    const staleWar = await database.query.war.findFirst({
      where: eq(war.id, WAR_ID),
      with: {
        attackerVillage: { with: { structures: true } },
        defenderVillage: { with: { structures: true } },
        warAllies: { with: { village: true } },
      },
    });
    expect(staleWar).toBeDefined();
    let releaseLockAttempt: () => void = () => undefined;
    let signalLockAttempt: () => void = () => undefined;
    const lockAttempted = new Promise<void>((resolve) => {
      signalLockAttempt = resolve;
    });
    const allowLock = new Promise<void>((resolve) => {
      releaseLockAttempt = resolve;
    });
    const controlledDatabase = transactionalProxy(database, (tx) =>
      beforeStatements(tx, war, [
        async () => {
          signalLockAttempt();
          await allowLock;
        },
      ]),
    );

    const resolution = handleWarEnd(staleWar as FetchActiveWarsReturnType, {
      client: controlledDatabase,
      preparedState: {
        attackerTokens: 850,
        defenderTokens: 0,
        attackerWarHealth: 800,
        defenderWarHealth: 0,
      },
    });
    await lockAttempted;
    await database
      .update(village)
      .set({ tokens: 901 })
      .where(eq(village.id, ATTACKER_VILLAGE));
    releaseLockAttempt();

    expect(await resolution).toBeUndefined();
    expect(
      await database.query.village.findFirst({
        where: eq(village.id, ATTACKER_VILLAGE),
      }),
    ).toMatchObject({ tokens: 901 });
    expect(
      await database.query.village.findFirst({
        where: eq(village.id, DEFENDER_VILLAGE),
      }),
    ).toMatchObject({ tokens: 700 });
    expect(
      await database.query.war.findFirst({ where: eq(war.id, WAR_ID) }),
    ).toMatchObject({
      status: "ACTIVE",
      attackerWarHealth: 820,
      defenderWarHealth: 760,
    });
    expect(await database.query.notification.findMany()).toEqual([]);
  });

  it("rolls back prepared health and tokens when the transition statement fails", async () => {
    const database = await getTestDatabase();
    const staleWar = await database.query.war.findFirst({
      where: eq(war.id, WAR_ID),
      with: {
        attackerVillage: { with: { structures: true } },
        defenderVillage: { with: { structures: true } },
        warAllies: { with: { village: true } },
      },
    });
    expect(staleWar).toBeDefined();
    const failingDatabase = transactionalProxy(database, (tx) =>
      beforeStatements(tx, war, [
        async () => undefined,
        async () => undefined,
        async () => {
          throw new Error("Gap100 transition failed after preparation");
        },
      ]),
    );

    await expect(
      handleWarEnd(staleWar as FetchActiveWarsReturnType, {
        client: failingDatabase,
        preparedState: {
          attackerTokens: 850,
          defenderTokens: 0,
          attackerWarHealth: 800,
          defenderWarHealth: 0,
        },
      }),
    ).rejects.toThrow("Gap100 transition failed after preparation");
    expect(
      await database.query.war.findFirst({ where: eq(war.id, WAR_ID) }),
    ).toMatchObject({
      status: "ACTIVE",
      attackerWarHealth: 820,
      defenderWarHealth: 760,
    });
    expect(
      await database.query.village.findMany({
        columns: { id: true, tokens: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { id: ATTACKER_VILLAGE, tokens: 900 },
        { id: DEFENDER_VILLAGE, tokens: 700 },
      ]),
    );
    expect(await database.query.notification.findMany()).toEqual([]);
  });

  it("uses the rollback sentinel when the post-preparation re-read loses its target", async () => {
    const database = await getTestDatabase();
    const staleWar = await database.query.war.findFirst({
      where: eq(war.id, WAR_ID),
      with: {
        attackerVillage: { with: { structures: true } },
        defenderVillage: { with: { structures: true } },
        warAllies: { with: { village: true } },
      },
    });
    expect(staleWar).toBeDefined();
    const disappearingDatabase = transactionalProxy(database, (tx) =>
      beforeStatements(tx, village, [
        async () => undefined,
        async () => undefined,
        async () => {
          await tx.delete(war).where(eq(war.id, WAR_ID));
        },
      ]),
    );

    expect(
      await handleWarEnd(staleWar as FetchActiveWarsReturnType, {
        client: disappearingDatabase,
        preparedState: {
          attackerTokens: 850,
          defenderTokens: 0,
          attackerWarHealth: 800,
          defenderWarHealth: 0,
        },
      }),
    ).toBeUndefined();
    expect(
      await database.query.war.findFirst({ where: eq(war.id, WAR_ID) }),
    ).toMatchObject({
      status: "ACTIVE",
      attackerWarHealth: 820,
      defenderWarHealth: 760,
    });
    expect(
      await database.query.village.findMany({
        columns: { id: true, tokens: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { id: ATTACKER_VILLAGE, tokens: 900 },
        { id: DEFENDER_VILLAGE, tokens: 700 },
      ]),
    );
    expect(await database.query.notification.findMany()).toEqual([]);
  });

  it("keeps participation active when a village remains in another active war", async () => {
    const database = await getTestDatabase();
    await database.insert(war).values(
      sectorWarRow({
        id: "gap100-other-active-war",
        sector: 402,
        startedAt: new Date("2026-09-10T12:00:00.000Z"),
      }),
    );

    const result = await (
      await callerFor(warRouter, ADMIN)
    ).adminEndWar(endInput("10000000-0000-4000-8000-000000000012"));
    expect(result.success).toBe(true);
    expect(result.clearedParticipantCount).toBe(1);
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, ATTACKER),
      }),
    ).toMatchObject({ warParticipantUntil: new Date("2030-01-01T00:00:00.000Z") });
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, DEFENDER),
      }),
    ).toMatchObject({ warParticipantUntil: new Date("2030-01-01T00:00:00.000Z") });
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, ALLY),
      }),
    ).toMatchObject({ warParticipantUntil: new Date(0) });
  });

  it("rolls back every delete when writing the durable audit receipt fails", async () => {
    const database = await getTestDatabase();
    const failingDatabase = transactionalProxy(database, (tx) =>
      beforeStatements(tx, actionLog, [
        async () => undefined,
        async () => {
          throw new Error("Gap100 receipt write failed");
        },
      ]),
    );
    await expect(
      callerForDatabase(warRouter, ADMIN, failingDatabase).adminEndWar(
        endInput("10000000-0000-4000-8000-000000000010"),
      ),
    ).rejects.toThrow("Gap100 receipt write failed");

    expect(await database.query.war.findFirst()).toBeDefined();
    expect(await database.query.warKill.findMany()).toHaveLength(1);
    expect(await database.query.warAlly.findMany()).toHaveLength(1);
    expect(await database.query.userRequest.findMany()).toHaveLength(1);
  });

  it("preserves the legacy Village War caller while keeping resources unchanged", async () => {
    const database = await getTestDatabase();
    await database
      .update(war)
      .set({ type: "VILLAGE_WAR", sector: 0 })
      .where(eq(war.id, WAR_ID));

    const result = await (
      await callerFor(warRouter, ADMIN)
    ).adminEndWar({ warId: WAR_ID });
    expect(result).toMatchObject({
      success: true,
      warId: WAR_ID,
      warType: "VILLAGE_WAR",
      outcome: "ADMIN_ENDED",
    });
    expect(await database.query.war.findFirst()).toBeUndefined();
    expect(
      await database.query.village.findMany({
        columns: { id: true, tokens: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { id: ATTACKER_VILLAGE, tokens: 900 },
        { id: DEFENDER_VILLAGE, tokens: 700 },
      ]),
    );
  });

  it.each(["VILLAGE_WAR", "WAR_RAID"] as const)(
    "accepts an exact immutable %s snapshot without assigning rewards",
    async (warType) => {
      const database = await getTestDatabase();
      const expectedWar = snapshot({ type: warType, sector: 0 });
      await database
        .update(war)
        .set({ type: warType, sector: 0 })
        .where(eq(war.id, WAR_ID));

      const input = endInput(
        warType === "VILLAGE_WAR"
          ? "10200000-0000-4000-8000-000000000001"
          : "10200000-0000-4000-8000-000000000002",
        { expectedWar },
      );
      const result = await (await callerFor(warRouter, ADMIN)).adminEndWar(input);

      expect(result).toMatchObject({
        success: true,
        requestId: input.requestId,
        warId: WAR_ID,
        warType,
        expectedRevision: input.expectedRevision,
        previousStatus: "ACTIVE",
        outcome: "ADMIN_ENDED",
        auditLogId: `admin-end-war:${input.requestId}`,
      });
      expect(await database.query.war.findFirst()).toBeUndefined();
      expect(await database.query.notification.findMany()).toEqual([]);
      expect(
        await database.query.village.findMany({
          columns: { id: true, tokens: true },
        }),
      ).toEqual(
        expect.arrayContaining([
          { id: ATTACKER_VILLAGE, tokens: 900 },
          { id: DEFENDER_VILLAGE, tokens: 700 },
        ]),
      );
    },
  );
});
