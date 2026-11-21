/** Cover the guarded Warehouse, escort, fight and delivery writes against real SQL. */
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  BANDIT_OPERATION_EXP,
  CARAVAN_GUARD_DELIVERY_RYO,
  CARAVAN_GUARD_OBJECTIVE_RYO,
  WAREHOUSE_PRODUCTION_INTERVAL_HOURS,
} from "@/drizzle/constants";
import {
  caravan,
  caravanDiscovery,
  caravanEncounter,
  caravanOperation,
  caravanParticipant,
  dungeonMember,
  dungeonRun,
  item,
  mpvpBattleUser,
  rankedPvpQueue,
  tradeRoute,
  tradeRouteMarker,
  userData,
  villageWarehouse,
  warehouseLog,
  warehouseMember,
  warehouseStock,
} from "@/drizzle/schema";
import type { CaravanBattleState } from "@/libs/caravan";
import {
  claimLoot,
  expireAmbush,
  insertCheckpointAmbush,
  insertGuard,
  listActiveSabotage,
  queueGuard,
  releaseParticipants,
  resolveOperation,
  transitionCaravan,
  upsertAttacker,
  upsertDiscoveries,
} from "@/queries/caravan";
import { updateUserDataForGET3 } from "@/queries/cleaner";
import {
  claimWithdrawal,
  ensureWarehouseMember,
  resetWarehouseAllowanceDay,
} from "@/queries/warehouse";
import { deliverCaravan, maintainCaravans } from "@/server/utils/caravan";
import { settleCaravanCombat } from "@/server/utils/caravanSettlement";
import { settleProduction } from "@/server/utils/warehouse";
import { afterTasks } from "../../setup/after";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";
import { insertItems, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const HOUR = 3_600_000;

describeWithDatabase("village Warehouse and caravans", () => {
  beforeEach(async () => {
    await resetTables(
      caravan,
      caravanDiscovery,
      caravanEncounter,
      caravanOperation,
      caravanParticipant,
      dungeonMember,
      dungeonRun,
      item,
      mpvpBattleUser,
      rankedPvpQueue,
      tradeRoute,
      tradeRouteMarker,
      userData,
      villageWarehouse,
      warehouseLog,
      warehouseMember,
      warehouseStock,
    );
    await insertItems([
      {
        id: "ore",
        name: "Ore",
        canStack: true,
        warehouseItem: true,
        villageId: "leaf",
      },
    ]);
  });

  it("credits each due production cycle once across concurrent readers", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    const settledAt = new Date(
      now.getTime() - 2.5 * WAREHOUSE_PRODUCTION_INTERVAL_HOURS * HOUR,
    );
    await db.insert(villageWarehouse).values({
      villageId: "leaf",
      productionItemIds: ["ore"],
      productionSettledAt: settledAt,
      updatedAt: settledAt,
    });
    const structure = { level: 5, temporaryLevelBonus: 0 } as never;
    await Promise.all(
      Array.from({ length: 4 }, () => settleProduction(db, "leaf", structure, now)),
    );
    const [stock] = await db.select().from(warehouseStock);
    expect(stock?.quantity).toBe(2 * 105);
    const logs = await db.select().from(warehouseLog);
    expect(logs).toHaveLength(1);
  });

  it("caps withdrawals by unreserved stock and the shared daily allowance", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "u", villageId: "leaf" }]);
    await db
      .insert(warehouseStock)
      .values({ villageId: "leaf", itemId: "ore", quantity: 100, reserved: 60 });
    await ensureWarehouseMember(db, "u");
    await db
      .update(warehouseMember)
      .set({ allowanceDay: "2026-06-14", allowanceUsed: 30 })
      .where(eq(warehouseMember.userId, "u"));
    await resetWarehouseAllowanceDay(db, "u", "2026-06-15");
    const claim = (quantity: number) =>
      claimWithdrawal(db, {
        villageId: "leaf",
        itemId: "ore",
        userId: "u",
        quantity,
        day: "2026-06-15",
        allowance: 30,
      });
    const results = await Promise.all([claim(20), claim(20)]);
    expect(results.filter((result) => result.rowsAffected > 0)).toHaveLength(1);
    expect((await claim(20)).rowsAffected).toBe(0);
    expect((await claim(10)).rowsAffected).toBeGreaterThan(0);
    const [stock] = await db.select().from(warehouseStock);
    expect(stock?.quantity).toBe(70);
    expect((await claim(1)).rowsAffected).toBe(0);
    await resetWarehouseAllowanceDay(db, "u", "2026-06-14");
    const [member] = await db.select().from(warehouseMember);
    expect(member?.allowanceDay).toBe("2026-06-15");
    expect(member?.allowanceUsed).toBe(30);
  });

  it("seats a released attacker in the group they rejoin", async () => {
    const db = await getTestDatabase();
    await db.insert(caravan).values(caravanRow());
    const join = (groupLeaderId: string) =>
      upsertAttacker(db, {
        caravanId: "c1",
        userId: "rider",
        role: "BANDIT",
        groupLeaderId,
        now: new Date(),
      });
    await join("first");
    await releaseParticipants(db, "c1", { userIds: ["rider"] });
    await join("second");
    const [rider] = await db.select().from(caravanParticipant);
    expect(rider?.activeUserId).toBe("rider");
    expect(rider?.groupLeaderId).toBe("second");
    await join("third");
    const [kept] = await db.select().from(caravanParticipant);
    expect(kept?.groupLeaderId).toBe("second");
  });

  it("seats no attacker on a caravan that left the road", async () => {
    const db = await getTestDatabase();
    await db.insert(caravan).values(caravanRow({ status: "DELIVERED" }));
    const joined = await upsertAttacker(db, {
      caravanId: "c1",
      userId: "rider",
      role: "BANDIT",
      groupLeaderId: "rider",
      now: new Date(),
    });
    expect(joined.rowsAffected).toBe(0);
    expect(await db.select().from(caravanParticipant)).toHaveLength(0);
  });

  it("keeps a newer sighting when an older one arrives late", async () => {
    const db = await getTestDatabase();
    const now = Date.now();
    const sighting = (sector: number, seenAt: number) => ({
      caravanId: "c1",
      userId: "scout",
      kind: "LOCATION" as const,
      sector,
      seenAt: new Date(seenAt),
      expiresAt: new Date(seenAt + HOUR),
    });
    await upsertDiscoveries(db, [sighting(2, now)]);
    await upsertDiscoveries(db, [sighting(1, now - 60_000)]);
    const [kept] = await db.select().from(caravanDiscovery);
    expect(kept?.sector).toBe(2);
    expect(kept?.seenAt.getTime()).toBe(now);
    expect(kept?.expiresAt.getTime()).toBe(now + HOUR);
    await upsertDiscoveries(db, [sighting(3, now + 60_000)]);
    const [refreshed] = await db.select().from(caravanDiscovery);
    expect(refreshed?.sector).toBe(3);
    expect(refreshed?.expiresAt.getTime()).toBe(now + 60_000 + HOUR);
  });

  it("opens ambushes only on the road and delivers only once no fight is open", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await db
      .insert(caravan)
      .values([caravanRow(), caravanRow({ id: "done", status: "DELIVERED" })]);
    const ambush = (id: string, caravanId: string) =>
      insertCheckpointAmbush(db, {
        id,
        caravanId,
        expiresAt: new Date(now.getTime() + HOUR),
        now,
      });
    expect((await ambush("late", "done")).rowsAffected).toBe(0);
    expect((await ambush("e1", "c1")).rowsAffected).toBe(1);
    const deliver = (version: number) =>
      transitionCaravan(
        db,
        { id: "c1", version, status: "TRAVELLING" },
        { status: "DELIVERED", resolvedAt: now },
        { unfought: true },
      );
    expect((await deliver(0)).rowsAffected).toBe(0);
    await db
      .update(caravanEncounter)
      .set({ expiresAt: new Date(now.getTime() - 1000) })
      .where(eq(caravanEncounter.id, "e1"));
    expect((await expireAmbush(db, "e1", 1000, now)).rowsAffected).toBeGreaterThan(0);
    // The expired ambush took its share and bumped the version.
    expect((await deliver(1)).rowsAffected).toBe(1);
  });

  it("leaves a finished caravan's loss alone when its stray ambush expires", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await db.insert(caravan).values(caravanRow({ status: "DELIVERED", lossBp: 500 }));
    await db.insert(caravanEncounter).values({
      id: "e1",
      type: "AMBUSH",
      status: "PENDING",
      caravanId: "c1",
      activeCaravanId: "c1",
      expiresAt: new Date(now.getTime() - 1000),
      createdAt: now,
    });
    await expireAmbush(db, "e1", 1000, now);
    const [row] = await db.select().from(caravan);
    expect(row?.lossBp).toBe(500);
    const [encounter] = await db.select().from(caravanEncounter);
    expect(encounter?.status).toBe("RESOLVED");
  });

  it("drops sabotage that finishes only once the caravan is due", async () => {
    const db = await getTestDatabase();
    const now = Date.now();
    await insertUsers([{ userId: "saboteur", status: "AWAKE" }]);
    await db
      .insert(caravan)
      .values(caravanRow({ arrivesAt: new Date(now - 5 * 60_000) }));
    await db.insert(caravanOperation).values({
      id: "op",
      userId: "saboteur",
      activeUserId: "saboteur",
      role: "BANDIT",
      type: "DELAY",
      caravanId: "c1",
      sector: 2,
      succeeds: true,
      status: "ACTIVE",
      startedAt: new Date(now - 30 * 60_000),
      finishesAt: new Date(now - 60_000),
    });
    await afterTasks.run([], () => maintainCaravans(db, new Date(now)));
    const [row] = await db.select().from(caravan);
    expect(row?.status).toBe("DELIVERED");
    expect(row?.delayMinutes).toBe(0);
    const [operation] = await db.select().from(caravanOperation);
    expect(operation?.status).toBe("RESOLVED");
  });

  it("lets escorts interrupt sabotage only while it is under way", async () => {
    const db = await getTestDatabase();
    const now = Date.now();
    await insertUsers([
      { userId: "busy", status: "AWAKE" },
      { userId: "done", status: "AWAKE" },
    ]);
    await db.insert(caravanOperation).values(
      [
        { id: "running", userId: "busy", finishesAt: new Date(now + 60_000) },
        { id: "finished", userId: "done", finishesAt: new Date(now - 1000) },
      ].map((op) => ({
        ...op,
        activeUserId: op.userId,
        role: "BANDIT" as const,
        type: "DISRUPT" as const,
        caravanId: "c1",
        sector: 2,
        succeeds: true,
        status: "ACTIVE" as const,
        startedAt: new Date(now - 30 * 60_000),
      })),
    );
    const listed = await listActiveSabotage(db, ["c1"], new Date(now));
    expect(listed.map((op) => op.id)).toEqual(["running"]);
    expect(listed[0]?.userStatus).toBe("AWAKE");
    const interrupt = (id: string) =>
      resolveOperation(db, id, "INTERRUPTED", new Date(now));
    expect((await interrupt("finished")).rowsAffected).toBe(0);
    expect((await interrupt("running")).rowsAffected).toBe(1);
  });

  it("claims loot only while it holds what the claimant read", async () => {
    const db = await getTestDatabase();
    const read = [{ itemId: "ore", quantity: 3 }];
    await db.insert(caravanParticipant).values({
      caravanId: "c1",
      userId: "leader",
      role: "BANDIT",
      loot: [...read, { itemId: "ore", quantity: 20 }],
      joinedAt: new Date(),
    });
    expect((await claimLoot(db, "c1", "leader", read, new Date())).rowsAffected).toBe(
      0,
    );
    const [row] = await db.select().from(caravanParticipant);
    expect(row?.lootClaimedAt).toBeNull();
    const current = row?.loot ?? [];
    expect(
      (await claimLoot(db, "c1", "leader", current, new Date())).rowsAffected,
    ).toBe(1);
  });

  it("keeps escorts queued until their caravan releases them", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "guard", status: "AWAKE", villageId: "leaf" }]);
    await db.insert(caravan).values(caravanRow({ status: "PREPARING" }));
    expect((await insertGuard(db, "c1", "guard", new Date())).rowsAffected).toBe(1);
    expect((await queueGuard(db, "c1", "guard")).rowsAffected).toBe(1);
    await updateUserDataForGET3(db);
    expect(await statusOf("guard")).toBe("QUEUED");
    await db
      .update(caravanParticipant)
      .set({ activeUserId: null })
      .where(eq(caravanParticipant.userId, "guard"));
    await updateUserDataForGET3(db);
    expect(await statusOf("guard")).toBe("AWAKE");
  });

  it("settles a won robbery once, capping the loss and splitting the loot", async () => {
    const db = await getTestDatabase();
    await insertUsers([
      { userId: "leader", isOutlaw: true },
      { userId: "rider", isOutlaw: true },
    ]);
    await db.insert(caravan).values(caravanRow({ lossBp: 4500 }));
    await db.insert(caravanParticipant).values(
      ["leader", "rider"].map((userId) => ({
        caravanId: "c1",
        userId,
        role: "BANDIT" as const,
        activeUserId: userId,
        groupLeaderId: "leader",
        joinedAt: new Date(),
      })),
    );
    await db.insert(caravanEncounter).values({
      id: "e1",
      type: "INTERCEPTION",
      status: "FIGHTING",
      caravanId: "c1",
      activeCaravanId: "c1",
      battleId: "b1",
      leaderId: "leader",
      createdAt: new Date(),
    });
    const battle = makeCompleteBattle({
      id: "b1",
      battleType: "CARAVAN",
      usersState: [
        makeBattleUser("leader", { direction: "left", curHealth: 50 }),
        makeBattleUser("npc", { direction: "right", curHealth: 0, isAi: true }),
      ],
      extraState: { caravan: battleState({ stealBp: 2000, lossBp: 4500 }) },
    });
    await settleCaravanCombat(db, battle);
    await settleCaravanCombat(db, battle);
    const [row] = await db.select().from(caravan);
    expect(row?.lossBp).toBe(5000);
    const riders = await db.select().from(caravanParticipant);
    const loot = Object.fromEntries(riders.map((p) => [p.userId, p.loot]));
    expect(loot.leader).toEqual([{ itemId: "ore", quantity: 5 }]);
    expect(loot.rider).toEqual([{ itemId: "ore", quantity: 5 }]);
    expect(riders.every((p) => p.activeUserId === null)).toBe(true);
    const users = await db.select().from(userData);
    expect(users.every((u) => u.banditExperience === BANDIT_OPERATION_EXP)).toBe(true);
    const [encounter] = await db.select().from(caravanEncounter);
    expect(encounter?.status).toBe("RESOLVED");
    expect(encounter?.activeCaravanId).toBeNull();
  });

  it("pays raiders nothing once the caravan is plundered and keeps unclaimed loot", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "leader", isOutlaw: true }]);
    await db.insert(caravan).values(caravanRow({ lossBp: 5000 }));
    await db.insert(caravanParticipant).values({
      caravanId: "c1",
      userId: "leader",
      role: "BANDIT",
      activeUserId: "leader",
      groupLeaderId: "leader",
      loot: [{ itemId: "ore", quantity: 3 }],
      joinedAt: new Date(),
    });
    const fight = async (id: string, lossBp: number) => {
      await db.insert(caravanEncounter).values({
        id,
        type: "INTERCEPTION",
        status: "FIGHTING",
        caravanId: "c1",
        activeCaravanId: "c1",
        battleId: `b-${id}`,
        createdAt: new Date(),
      });
      await settleCaravanCombat(
        db,
        makeCompleteBattle({
          id: `b-${id}`,
          battleType: "CARAVAN",
          usersState: [
            makeBattleUser("leader", { direction: "left", curHealth: 50 }),
            makeBattleUser("npc", { direction: "right", curHealth: 0, isAi: true }),
          ],
          extraState: {
            caravan: battleState({
              encounterId: id,
              battleId: `b-${id}`,
              attackerIds: ["leader"],
              lossBp,
              stealBp: 1000,
            }),
          },
        }),
      );
    };
    await fight("capped", 5000);
    const [capped] = await db.select().from(userData);
    expect(capped?.banditExperience).toBe(0);
    await db.update(caravan).set({ lossBp: 0 });
    await db
      .update(caravanParticipant)
      .set({ activeUserId: "leader", groupLeaderId: "leader" });
    await fight("open", 0);
    const [rider] = await db.select().from(caravanParticipant);
    expect(rider?.loot).toEqual([
      { itemId: "ore", quantity: 3 },
      { itemId: "ore", quantity: 20 },
    ]);
    const [paid] = await db.select().from(userData);
    expect(paid?.banditExperience).toBe(BANDIT_OPERATION_EXP);
  });

  it("awards nothing for a won robbery of a caravan that already left the road", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "leader", isOutlaw: true }]);
    await db.insert(caravan).values(caravanRow({ status: "DELIVERED" }));
    await db.insert(caravanParticipant).values({
      caravanId: "c1",
      userId: "leader",
      role: "BANDIT",
      activeUserId: "leader",
      groupLeaderId: "leader",
      joinedAt: new Date(),
    });
    await db.insert(caravanEncounter).values({
      id: "e1",
      type: "INTERCEPTION",
      status: "FIGHTING",
      caravanId: "c1",
      activeCaravanId: "c1",
      battleId: "b1",
      createdAt: new Date(),
    });
    await settleCaravanCombat(
      db,
      makeCompleteBattle({
        id: "b1",
        battleType: "CARAVAN",
        usersState: [
          makeBattleUser("leader", { direction: "left", curHealth: 50 }),
          makeBattleUser("npc", { direction: "right", curHealth: 0, isAi: true }),
        ],
        extraState: { caravan: battleState({ attackerIds: ["leader"] }) },
      }),
    );
    const [rider] = await db.select().from(caravanParticipant);
    expect(rider?.loot).toBeNull();
    expect(rider?.activeUserId).toBeNull();
    const [user] = await db.select().from(userData);
    expect(user?.banditExperience).toBe(0);
  });

  it("delivers remaining cargo once and pays escorts who completed objectives", async () => {
    const db = await getTestDatabase();
    await insertUsers([
      { userId: "busy", status: "QUEUED", money: 0 },
      { userId: "idle", status: "QUEUED", money: 0 },
    ]);
    const arrived = caravanRow({
      lossBp: 1000,
      arrivesAt: new Date(Date.now() - 1000),
    });
    await db.insert(caravan).values(arrived);
    await db.insert(caravanParticipant).values(
      ["busy", "idle"].map((userId, slot) => ({
        caravanId: "c1",
        userId,
        role: "GUARD" as const,
        activeUserId: userId,
        guardSlot: slot,
        objectives: userId === "busy" ? 2 : 0,
        joinedAt: new Date(),
      })),
    );
    // Notifications are deferred response work; this direct call drops them.
    const deliver = () =>
      afterTasks.run([], () => deliverCaravan(db, { ...arrived, version: 0 } as never));
    const [first, second] = await Promise.all([deliver(), deliver()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const [stock] = await db
      .select()
      .from(warehouseStock)
      .where(eq(warehouseStock.villageId, "sand"));
    expect(stock?.quantity).toBe(180);
    const users = Object.fromEntries(
      (await db.select().from(userData)).map((u) => [u.userId, u]),
    );
    expect(users.busy?.money).toBe(
      CARAVAN_GUARD_DELIVERY_RYO + 2 * CARAVAN_GUARD_OBJECTIVE_RYO,
    );
    expect(users.idle?.money).toBe(0);
    expect(users.busy?.status).toBe("AWAKE");
    expect(users.idle?.status).toBe("AWAKE");
  });
  it("hands a worn-down marker to its assailant and calls off caravans still on the road", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "raider", villageId: "mist" }]);
    await db.insert(tradeRoute).values({
      id: "r1",
      villageIdA: "leaf",
      villageIdB: "sand",
      openPair: "leaf:sand",
      status: "ACTIVE",
      proposedByVillageId: "leaf",
      proposedById: "kage",
      path: [1, 2, 3],
      createdAt: new Date(),
    });
    await db.insert(tradeRouteMarker).values({
      id: "m1",
      routeId: "r1",
      sector: 2,
      longitude: 5,
      latitude: 5,
      control: 25,
    });
    await db
      .insert(warehouseStock)
      .values([{ villageId: "leaf", itemId: "ore", quantity: 50, reserved: 50 }]);
    await db.insert(caravan).values([
      // The checkpoint it passed is already rolled, so no random ambush holds it.
      caravanRow({ id: "moving", lossBp: 1000, checkpointsProcessed: 1 }),
      caravanRow({ id: "arrived", arrivesAt: new Date(Date.now() - 1000) }),
      caravanRow({
        id: "waiting",
        status: "PREPARING",
        cargo: [{ itemId: "ore", quantity: 50 }],
        departedAt: null,
        arrivesAt: null,
      }),
    ]);
    await db.insert(caravanEncounter).values({
      id: "e1",
      type: "MARKER_ASSAULT",
      status: "FIGHTING",
      markerId: "m1",
      activeMarkerId: "m1",
      battleId: "b1",
      createdAt: new Date(),
    });
    await settleCaravanCombat(
      db,
      makeCompleteBattle({
        id: "b1",
        battleType: "CARAVAN",
        usersState: [
          makeBattleUser("raider", { direction: "left", curHealth: 80 }),
          makeBattleUser("npc", { direction: "right", curHealth: 0, isAi: true }),
        ],
        extraState: {
          caravan: battleState({
            type: "MARKER_ASSAULT",
            caravanId: null,
            markerId: "m1",
            attackerRole: null,
            attackerIds: ["raider"],
            captureVillageId: "mist",
          }),
        },
      }),
    );
    const [marker] = await db.select().from(tradeRouteMarker);
    expect(marker?.controllerVillageId).toBe("mist");
    expect(marker?.control).toBe(100);
    expect(marker?.capturedAt).not.toBeNull();
    await afterTasks.run([], () =>
      maintainCaravans(db, new Date(), {
        caravanIds: ["moving", "waiting", "arrived"],
      }),
    );
    const caravans = Object.fromEntries(
      (await db.select().from(caravan)).map((row) => [row.id, row.status]),
    );
    expect(caravans).toEqual({
      moving: "CANCELLED",
      waiting: "CANCELLED",
      arrived: "DELIVERED",
    });
    const stock = Object.fromEntries(
      (await db.select().from(warehouseStock)).map((row) => [row.villageId, row]),
    );
    // The waiting caravan's reservation is released; the moving one brings 180 ore home.
    expect(stock.leaf?.reserved).toBe(0);
    expect(stock.leaf?.quantity).toBe(230);
    expect(stock.sand?.quantity).toBe(200);
  });
});

/** A caravan from Leaf to Sand carrying 200 ore. */
const caravanRow = (overrides: Partial<typeof caravan.$inferInsert> = {}) => ({
  id: "c1",
  routeId: "r1",
  originVillageId: "leaf",
  destinationVillageId: "sand",
  status: "TRAVELLING" as const,
  cargo: [{ itemId: "ore", quantity: 200 }],
  path: [1, 2, 3],
  travelMinutes: 120,
  createdById: "kage",
  createdAt: new Date(),
  departedAt: new Date(Date.now() - 30 * 60_000),
  arrivesAt: new Date(Date.now() + 90 * 60_000),
  ...overrides,
});

/** A bandit interception frozen at its start. */
const battleState = (overrides: Partial<CaravanBattleState>): CaravanBattleState => ({
  encounterId: "e1",
  battleId: "b1",
  type: "INTERCEPTION",
  caravanId: "c1",
  markerId: null,
  attackerDirection: "left",
  attackerRole: "BANDIT",
  attackerVillageId: null,
  attackerIds: ["leader", "rider"],
  guardIds: [],
  cargo: [{ itemId: "ore", quantity: 200 }],
  lossBp: 0,
  stealBp: 1000,
  captureVillageId: null,
  ...overrides,
});

/** A player's current status. */
const statusOf = async (userId: string) => {
  const db = await getTestDatabase();
  const [row] = await db
    .select({ status: userData.status })
    .from(userData)
    .where(eq(userData.userId, userId));
  return row?.status;
};
