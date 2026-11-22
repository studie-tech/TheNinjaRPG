/** Cover the guarded Warehouse, escort, fight and delivery writes against real SQL. */
import { beforeEach, expect, it, spyOn } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  BANDIT_OPERATION_EXP,
  CARAVAN_AMBUSH_LOSS_BP,
  CARAVAN_DELAY_MINUTES,
  CARAVAN_GUARD_DELIVERY_RYO,
  CARAVAN_GUARD_OBJECTIVE_RYO,
  WAREHOUSE_PRODUCTION_INTERVAL_HOURS,
} from "@/drizzle/constants";
import {
  battle,
  caravan,
  caravanDiscovery,
  caravanEncounter,
  caravanOperation,
  caravanParticipant,
  dungeonMember,
  dungeonRun,
  huntingSession,
  item,
  mpvpBattleUser,
  rankedPvpQueue,
  tradeRoute,
  tradeRouteMarker,
  userData,
  userItem,
  village,
  villageWarehouse,
  war,
  warehouseDepositLedger,
  warehouseLog,
  warehouseMember,
  warehouseStock,
} from "@/drizzle/schema";
import { CARGO_MOVES, type CaravanBattleState } from "@/libs/caravan";
import type { CompleteBattle } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import {
  chargeAmbushLoss,
  claimLoot,
  closeCaravan,
  dispatchCaravan,
  insertCheckpointAmbush,
  insertGuard,
  listActiveSabotage,
  listFinishedVillageCaravans,
  listOpenVillageCaravans,
  moveCargo,
  queueGuard,
  releaseParticipants,
  renameCaravanUser,
  resolveOperation,
  upsertAttacker,
  upsertDiscoveries,
} from "@/queries/caravan";
import { updateUserDataForGET3 } from "@/queries/cleaner";
import { updateUserDataForFinishBattle } from "@/queries/combat";
import { deleteEmptyUserItem } from "@/queries/item";
import {
  claimWithdrawal,
  depositFromStack,
  destroyRaidedWarehouseStock,
  ensureDepositLedger,
  ensureWarehouseStock,
  startWarehouseAllowanceDay,
} from "@/queries/warehouse";
import {
  cancelCaravan,
  closeVillageTrade,
  deliverCaravan,
  maintainCaravans,
} from "@/server/utils/caravan";
import { settleCaravanCombat } from "@/server/utils/caravanSettlement";
import { depositStackWhere, settleProduction } from "@/server/utils/warehouse";
import { afterTasks } from "../../setup/after";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { aroundStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const HOUR = 3_600_000;

describeWithDatabase("village Warehouse and caravans", () => {
  beforeEach(async () => {
    await resetTables(
      battle,
      caravan,
      caravanDiscovery,
      caravanEncounter,
      caravanOperation,
      caravanParticipant,
      dungeonMember,
      dungeonRun,
      huntingSession,
      item,
      mpvpBattleUser,
      rankedPvpQueue,
      tradeRoute,
      tradeRouteMarker,
      userData,
      userItem,
      village,
      villageWarehouse,
      war,
      warehouseDepositLedger,
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

  it("credits production to every selected stock row alongside the clock", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    const settledAt = new Date(
      now.getTime() - 2 * WAREHOUSE_PRODUCTION_INTERVAL_HOURS * HOUR,
    );
    await db.insert(villageWarehouse).values({
      villageId: "leaf",
      productionItemIds: ["ore", "silk", "wood"],
      productionSettledAt: settledAt,
      updatedAt: settledAt,
    });
    await db.insert(warehouseStock).values([
      { villageId: "leaf", itemId: "ore", quantity: 7 },
      { villageId: "leaf", itemId: "iron", quantity: 3 },
    ]);
    const structure = { level: 5, temporaryLevelBonus: 0 } as never;
    await settleProduction(db, "leaf", structure, now);
    const stock = Object.fromEntries(
      (await db.select().from(warehouseStock)).map((row) => [row.itemId, row.quantity]),
    );
    expect(stock).toEqual({ ore: 7 + 2 * 105, silk: 2 * 105, wood: 2 * 105, iron: 3 });
  });

  it("destroys a raided share of every stock row with the war receipt step", async () => {
    const db = await getTestDatabase();
    await db.insert(war).values({
      id: "raid",
      type: "WAR_RAID",
      status: "ATTACKER_VICTORY",
      attackerVillageId: "sand",
      defenderVillageId: "leaf",
      settlementPending: true,
      settlement: {
        villageIds: ["sand", "leaf"],
        winningVillageIds: ["sand"],
        warIds: ["raid"],
        notificationContent: "",
        boostsDelivered: true,
        structuresDelivered: true,
        warehouseDelivered: false,
        notified: false,
      },
    });
    await db.insert(warehouseStock).values([
      { villageId: "leaf", itemId: "ore", quantity: 100, reserved: 20 },
      { villageId: "leaf", itemId: "silk", quantity: 50 },
      { villageId: "leaf", itemId: "wood", quantity: 10, reserved: 10 },
      { villageId: "sand", itemId: "ore", quantity: 100 },
    ]);
    const step = sql`${war.id} = ${"raid"} AND ${war.settlementPending} = TRUE
      AND JSON_UNQUOTE(JSON_EXTRACT(${war.settlement}, '$.warehouseDelivered')) = 'false'`;
    await destroyRaidedWarehouseStock(db, "leaf", 25, step);
    await destroyRaidedWarehouseStock(db, "leaf", 25, step);
    const stock = Object.fromEntries(
      (await db.select().from(warehouseStock)).map((row) => [
        `${row.villageId}:${row.itemId}`,
        row.quantity,
      ]),
    );
    expect(stock).toEqual({
      "leaf:ore": 80,
      "leaf:silk": 38,
      "leaf:wood": 10,
      "sand:ore": 100,
    });
    const [raid] = await db.select().from(war);
    expect(raid?.settlement?.warehouseDelivered).toBe(true);
  });

  it("caps withdrawals by unreserved stock and the shared daily allowance", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "u", villageId: "leaf" }]);
    await db
      .insert(warehouseStock)
      .values({ villageId: "leaf", itemId: "ore", quantity: 100, reserved: 60 });
    await startWarehouseAllowanceDay(db, "u", "2026-06-14");
    await db
      .update(warehouseMember)
      .set({ allowanceDay: "2026-06-14", allowanceUsed: 30 })
      .where(eq(warehouseMember.userId, "u"));
    await startWarehouseAllowanceDay(db, "u", "2026-06-15");
    const claim = (quantity: number) =>
      claimWithdrawal(db, {
        villageId: "leaf",
        itemId: "ore",
        userId: "u",
        quantity,
        day: "2026-06-15",
        allowance: 30,
        approvedAt: null,
      });
    const results = await Promise.all([claim(20), claim(20)]);
    expect(results.filter((result) => result.rowsAffected > 0)).toHaveLength(1);
    expect((await claim(20)).rowsAffected).toBe(0);
    expect((await claim(10)).rowsAffected).toBeGreaterThan(0);
    const [stock] = await db.select().from(warehouseStock);
    expect(stock?.quantity).toBe(70);
    expect((await claim(1)).rowsAffected).toBe(0);
    // A generous allowance still cannot reach the 10 units held for caravans.
    const wide = await claimWithdrawal(db, {
      villageId: "leaf",
      itemId: "ore",
      userId: "u",
      quantity: 11,
      day: "2026-06-15",
      allowance: 100,
      approvedAt: null,
    });
    expect(wide.rowsAffected).toBe(0);
    const [unchanged] = await db.select().from(warehouseStock);
    expect(unchanged?.quantity).toBe(70);
    // Neither the same day nor a request still dated the day before rewinds the count.
    await startWarehouseAllowanceDay(db, "u", "2026-06-15");
    await startWarehouseAllowanceDay(db, "u", "2026-06-14");
    const [member] = await db.select().from(warehouseMember);
    expect(member?.allowanceDay).toBe("2026-06-15");
    expect(member?.allowanceUsed).toBe(30);
    // An approved allowance holds only while the approval it was read with stands.
    const approvedAt = new Date("2026-06-15T08:00:00.123Z");
    const approved = () =>
      claimWithdrawal(db, {
        villageId: "leaf",
        itemId: "ore",
        userId: "u",
        quantity: 5,
        day: "2026-06-15",
        allowance: 100,
        approvedAt,
      });
    expect((await approved()).rowsAffected).toBe(0);
    await db
      .update(warehouseMember)
      .set({ approvedVillageId: "leaf", approvedAt })
      .where(eq(warehouseMember.userId, "u"));
    expect((await approved()).rowsAffected).toBeGreaterThan(0);
    await db
      .update(warehouseMember)
      .set({ approvedVillageId: null, approvedAt: null })
      .where(eq(warehouseMember.userId, "u"));
    expect((await approved()).rowsAffected).toBe(0);
  });

  it("deposits from a stack once, with its ledger claim and stock credit", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await insertUsers([{ userId: "donor" }]);
    await insertUserItems([
      { id: "pile", userId: "donor", itemId: "ore", quantity: 50 },
    ]);
    await Promise.all([
      ensureDepositLedger(db, "donor", "ore"),
      ensureWarehouseStock(db, "leaf", ["ore"]),
    ]);
    const deposit = (
      expectedQuantity: number,
      options: { take?: number; bonusCarry?: number; at?: Date } = {},
    ) => {
      const at = options.at ?? now;
      return depositFromStack(db, {
        userId: "donor",
        itemId: "ore",
        cooldownStart: new Date(at.getTime() - HOUR),
        now: at,
        expected: { withdrawnUnits: 0, bonusCarry: options.bonusCarry ?? 0 },
        next: { withdrawnUnits: 0, bonusCarry: 250 },
        villageId: "leaf",
        credited: 21,
        userItemId: "pile",
        nextQuantity: expectedQuantity - (options.take ?? 20),
        stackWhere: depositStackWhere({
          userId: "donor",
          userItemId: "pile",
          expectedQuantity,
          now: at,
        }),
      });
    };
    const state = async () => ({
      stack: (await db.select().from(userItem))[0]?.quantity,
      stock: (await db.select().from(warehouseStock))[0]?.quantity,
      ledger: (await db.select().from(warehouseDepositLedger))[0],
    });
    // A stack changed since it was read, or one no longer carried, changes nothing.
    expect((await deposit(49)).rowsAffected).toBe(0);
    await db.update(userItem).set({ storedAtHome: true });
    expect((await deposit(50)).rowsAffected).toBe(0);
    await db.update(userItem).set({ storedAtHome: false });
    // A hunt owns the inventory it preloaded.
    await db.insert(huntingSession).values({
      userId: "donor",
      id: "hunt",
      habitatId: "h",
      contractId: "k",
      sector: 1,
      battleId: "b1",
      startedAt: now,
    });
    expect((await deposit(50)).rowsAffected).toBe(0);
    await db.delete(huntingSession);
    // Any other battle writes the stack's quantity back when it settles.
    await db.update(userData).set({ battleId: "b2" });
    expect((await deposit(50)).rowsAffected).toBe(0);
    await db.update(userData).set({ battleId: null });
    expect(await state()).toMatchObject({ stack: 50, stock: 0 });
    expect((await state()).ledger?.lastDepositAt).toBeNull();
    expect((await deposit(50)).rowsAffected).toBe(3);
    const after = await state();
    expect(after).toMatchObject({ stack: 30, stock: 21 });
    expect(after.ledger?.lastDepositAt?.getTime()).toBe(now.getTime());
    expect(after.ledger?.bonusCarry).toBe(250);
    // The cooldown it claimed refuses a repeat of the same read.
    expect((await deposit(30)).rowsAffected).toBe(0);
    expect(await state()).toMatchObject({ stack: 30, stock: 21 });
    // Once the cooldown passes, the whole stack goes, leaving an empty row to delete.
    const later = new Date(now.getTime() + 25 * HOUR);
    expect(
      (await deposit(30, { take: 30, bonusCarry: 250, at: later })).rowsAffected,
    ).toBe(3);
    expect(await state()).toMatchObject({ stack: 0, stock: 42 });
    expect(
      (await deposit(30, { take: 30, bonusCarry: 250, at: later })).rowsAffected,
    ).toBe(0);
    await deleteEmptyUserItem(db, "pile", "donor");
    expect(await db.select().from(userItem)).toHaveLength(0);
    expect((await db.select().from(warehouseStock))[0]?.quantity).toBe(42);
  });

  it("reserves, loads and releases cargo only while stock covers its reservation", async () => {
    const db = await getTestDatabase();
    const { RESERVE: reserve, RELEASE: release, DISPATCH: dispatch } = CARGO_MOVES;
    await db.insert(warehouseStock).values([
      { villageId: "leaf", itemId: "ore", quantity: 100, reserved: 20 },
      { villageId: "leaf", itemId: "silk", quantity: 50, reserved: 40 },
    ]);
    const stockOf = async () =>
      Object.fromEntries(
        (await db.select().from(warehouseStock)).map((row) => [row.itemId, row]),
      );
    const short = await moveCargo(
      db,
      "leaf",
      [
        { itemId: "ore", quantity: 80 },
        { itemId: "silk", quantity: 20 },
      ],
      reserve,
    );
    // Silk lacks unreserved stock, so the caller sees fewer rows than lines and rolls back.
    expect(short.rowsAffected).toBe(1);
    await db
      .update(warehouseStock)
      .set({ reserved: 20 })
      .where(eq(warehouseStock.itemId, "ore"));
    const cargo = [
      { itemId: "ore", quantity: 80 },
      { itemId: "silk", quantity: 10 },
    ];
    expect((await moveCargo(db, "leaf", cargo, reserve)).rowsAffected).toBe(2);
    expect(await stockOf()).toMatchObject({
      ore: { quantity: 100, reserved: 100 },
      silk: { quantity: 50, reserved: 50 },
    });
    expect(
      (await moveCargo(db, "leaf", [{ itemId: "silk", quantity: 50 }], release))
        .rowsAffected,
    ).toBe(1);
    // Releasing more than is reserved changes nothing.
    expect(
      (await moveCargo(db, "leaf", [{ itemId: "silk", quantity: 10 }], release))
        .rowsAffected,
    ).toBe(0);
    // Silk is no longer reserved, so the caller sees fewer rows than lines and rolls back.
    expect((await moveCargo(db, "leaf", cargo, dispatch)).rowsAffected).toBe(1);
    expect(await stockOf()).toMatchObject({
      ore: { quantity: 20, reserved: 20 },
      silk: { quantity: 50, reserved: 0 },
    });
    // Departure needs the stock that covers the reservation, even when enough is reserved.
    await db
      .update(warehouseStock)
      .set({ quantity: 20, reserved: 30 })
      .where(eq(warehouseStock.itemId, "silk"));
    expect(
      (await moveCargo(db, "leaf", [{ itemId: "silk", quantity: 25 }], dispatch))
        .rowsAffected,
    ).toBe(0);
    expect((await moveCargo(db, "leaf", [], dispatch)).rowsAffected).toBe(0);
  });

  it("dispatches a caravan only with every cargo line covered and its version unchanged", async () => {
    const db = await getTestDatabase();
    const cargo = [
      { itemId: "ore", quantity: 80 },
      { itemId: "silk", quantity: 10 },
    ];
    await db
      .insert(caravan)
      .values(
        caravanRow({ status: "PREPARING", cargo, departedAt: null, arrivesAt: null }),
      );
    await db.insert(warehouseStock).values([
      { villageId: "leaf", itemId: "ore", quantity: 100, reserved: 80 },
      { villageId: "leaf", itemId: "silk", quantity: 50, reserved: 5 },
      { villageId: "sand", itemId: "ore", quantity: 30, reserved: 0 },
    ]);
    const departedAt = new Date();
    const arrivesAt = new Date(departedAt.getTime() + HOUR);
    const read = async () => {
      const [row] = await db.select().from(caravan);
      if (!row) throw new Error("caravan missing");
      return row;
    };
    const stockOf = async () =>
      Object.fromEntries(
        (await db.select().from(warehouseStock)).map((row) => [
          `${row.villageId}:${row.itemId}`,
          { quantity: row.quantity, reserved: row.reserved },
        ]),
      );
    const before = await stockOf();
    const prepared = await read();
    // Silk holds less reservation than its line, so neither the caravan nor the ore moves.
    expect(
      (await dispatchCaravan(db, prepared, { departedAt, arrivesAt })).rowsAffected,
    ).toBe(0);
    expect((await read()).status).toBe("PREPARING");
    expect(await stockOf()).toEqual(before);
    await db
      .update(warehouseStock)
      .set({ reserved: 10 })
      .where(eq(warehouseStock.itemId, "silk"));
    // A caravan changed since it was read stays put.
    expect(
      (
        await dispatchCaravan(
          db,
          { ...prepared, version: prepared.version + 1 },
          { departedAt, arrivesAt },
        )
      ).rowsAffected,
    ).toBe(0);
    expect((await read()).status).toBe("PREPARING");
    expect(
      (await dispatchCaravan(db, prepared, { departedAt, arrivesAt })).rowsAffected,
    ).toBe(1 + cargo.length);
    const departed = await read();
    expect(departed.status).toBe("TRAVELLING");
    expect(departed.version).toBe(prepared.version + 1);
    expect(departed.departedAt?.getTime()).toBe(departedAt.getTime());
    expect(departed.arrivesAt?.getTime()).toBe(arrivesAt.getTime());
    expect(await stockOf()).toEqual({
      "leaf:ore": { quantity: 20, reserved: 0 },
      "leaf:silk": { quantity: 40, reserved: 0 },
      "sand:ore": { quantity: 30, reserved: 0 },
    });
    // The caravan departs once.
    expect(
      (await dispatchCaravan(db, prepared, { departedAt, arrivesAt })).rowsAffected,
    ).toBe(0);
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
    // A caravan with neither cargo lines to settle nor participants closes on its own row.
    const deliver = (version: number) =>
      closeCaravan(
        db,
        { id: "c1", version, status: "TRAVELLING" },
        {
          status: "DELIVERED",
          resolvedAt: now,
          villageId: "sand",
          lines: [],
          stock: "credit",
          pay: [],
          unfought: true,
        },
      );
    expect((await deliver(0)).rowsAffected).toBe(0);
    await db
      .update(caravanEncounter)
      .set({ expiresAt: new Date(now.getTime() - 1000) })
      .where(eq(caravanEncounter.id, "e1"));
    const expired = await chargeAmbushLoss(
      db,
      { id: "e1", status: "PENDING", battleId: null },
      1000,
      now,
    );
    expect(expired.rowsAffected).toBeGreaterThan(0);
    // The expired ambush took its share and bumped the version.
    expect((await deliver(1)).rowsAffected).toBe(1);
    const [delivered] = await db.select().from(caravan).where(eq(caravan.id, "c1"));
    expect(delivered?.status).toBe("DELIVERED");
    expect(delivered?.version).toBe(2);
    expect(delivered?.resolvedAt?.getTime()).toBe(now.getTime());
    expect((await deliver(2)).rowsAffected).toBe(0);
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

  it("lands sabotage that finished before arrival ahead of a page read's delivery", async () => {
    const db = await getTestDatabase();
    const now = Date.now();
    await insertUsers([{ userId: "saboteur", status: "AWAKE" }]);
    await db.insert(caravan).values(
      caravanRow({
        arrivesAt: new Date(now - 10_000),
        checkpointsProcessed: 3,
      }),
    );
    await db.insert(caravanOperation).values({
      id: "op",
      userId: "saboteur",
      activeUserId: "saboteur",
      role: "ENEMY",
      type: "DELAY",
      caravanId: "c1",
      sector: 3,
      succeeds: true,
      status: "ACTIVE",
      startedAt: new Date(now - 30 * 60_000),
      finishesAt: new Date(now - 40_000),
    });
    await afterTasks.run([], () =>
      maintainCaravans(db, new Date(now), { caravanIds: ["c1"] }),
    );
    const [row] = await db.select().from(caravan);
    expect(row?.status).toBe("TRAVELLING");
    expect(row?.delayMinutes).toBe(CARAVAN_DELAY_MINUTES);
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

  it("cancels a preparing caravan once, releasing its reservation and waking queued escorts", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await insertUsers([
      { userId: "guard", status: "AWAKE", villageId: "leaf" },
      { userId: "fighter", status: "BATTLE", battleId: "arena", villageId: "leaf" },
    ]);
    await db
      .insert(warehouseStock)
      .values({ villageId: "leaf", itemId: "ore", quantity: 250, reserved: 200 });
    await db.insert(caravan).values(caravanRow({ status: "PREPARING" }));
    for (const userId of ["guard", "fighter"])
      expect((await insertGuard(db, "c1", userId, now)).rowsAffected).toBe(1);
    expect((await queueGuard(db, "c1", "guard")).rowsAffected).toBe(1);
    const [row] = await db.select().from(caravan);
    if (!row) throw new Error("caravan missing");
    const cancel = (read: typeof row) =>
      afterTasks.run([], () => cancelCaravan(db, read, now));
    // A caravan changed since it was read stays open.
    expect(await cancel({ ...row, version: row.version + 1 })).toBe(false);
    expect((await db.select().from(caravan))[0]?.status).toBe("PREPARING");
    const released = await cancel(row);
    expect(released && [...released].sort()).toEqual(["fighter", "guard"]);
    const [cancelled] = await db.select().from(caravan);
    expect(cancelled?.status).toBe("CANCELLED");
    expect(cancelled?.version).toBe(row.version + 1);
    expect(cancelled?.resolvedAt?.getTime()).toBe(now.getTime());
    const [stock] = await db.select().from(warehouseStock);
    expect(stock).toMatchObject({ quantity: 250, reserved: 0 });
    expect(await statusOf("guard")).toBe("AWAKE");
    // An escort fighting elsewhere keeps their battle and rejoins nothing afterwards.
    expect(await statusOf("fighter")).toBe("BATTLE");
    const escorts = await db.select().from(caravanParticipant);
    expect(escorts.every((p) => p.activeUserId === null)).toBe(true);
    expect(escorts.every((p) => p.rewardedAt === null)).toBe(true);
    const logs = await db.select().from(warehouseLog);
    expect(
      logs.map(({ villageId, type, quantity }) => ({ villageId, type, quantity })),
    ).toEqual([{ villageId: "leaf", type: "RELEASE", quantity: 200 }]);
    // A retry of the same read changes nothing and releases nothing twice.
    expect(await cancel(row)).toBe(false);
    expect((await db.select().from(warehouseStock))[0]?.reserved).toBe(0);
    expect(await db.select().from(warehouseLog)).toHaveLength(1);
  });

  it("refuses to cancel a preparing caravan whose reservation its stock no longer covers", async () => {
    const db = await getTestDatabase();
    await db
      .insert(warehouseStock)
      .values({ villageId: "leaf", itemId: "ore", quantity: 250, reserved: 150 });
    await db.insert(caravan).values(caravanRow({ status: "PREPARING" }));
    const [row] = await db.select().from(caravan);
    if (!row) throw new Error("caravan missing");
    expect(await afterTasks.run([], () => cancelCaravan(db, row))).toBe(false);
    expect((await db.select().from(caravan))[0]?.status).toBe("PREPARING");
    expect((await db.select().from(warehouseStock))[0]?.reserved).toBe(150);
  });

  it("cancels a travelling caravan, bringing its remaining cargo home to new stock rows", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await insertUsers([
      { userId: "guard", status: "QUEUED", villageId: "leaf", money: 0 },
      { userId: "raider", status: "QUEUED", villageId: "sand" },
    ]);
    await db.insert(caravan).values(
      caravanRow({
        lossBp: 1000,
        cargo: [
          { itemId: "ore", quantity: 200 },
          { itemId: "silk", quantity: 50 },
        ],
      }),
    );
    await db.insert(caravanParticipant).values([
      {
        caravanId: "c1",
        userId: "guard",
        role: "GUARD",
        activeUserId: "guard",
        guardSlot: 0,
        objectives: 2,
        joinedAt: now,
      },
      {
        caravanId: "c1",
        userId: "raider",
        role: "BANDIT",
        activeUserId: "raider",
        groupLeaderId: "raider",
        joinedAt: now,
      },
    ]);
    const [row] = await db.select().from(caravan);
    if (!row) throw new Error("caravan missing");
    expect(
      await afterTasks.run([], () => cancelCaravan(db, row, now, { unfought: true })),
    ).toEqual(["guard"]);
    expect((await db.select().from(caravan))[0]?.status).toBe("CANCELLED");
    const stock = Object.fromEntries(
      (await db.select().from(warehouseStock)).map((row) => [row.itemId, row]),
    );
    expect(stock).toMatchObject({
      ore: { villageId: "leaf", quantity: 180, reserved: 0 },
      silk: { villageId: "leaf", quantity: 45, reserved: 0 },
    });
    const participants = await db.select().from(caravanParticipant);
    expect(
      participants.every((p) => p.activeUserId === null && p.groupLeaderId === null),
    ).toBe(true);
    const users = Object.fromEntries(
      (await db.select().from(userData)).map((u) => [u.userId, u]),
    );
    // Escorts leave unpaid; an attacker's status belongs to whatever queued them.
    expect(users.guard).toMatchObject({ status: "AWAKE", money: 0 });
    expect(users.raider?.status).toBe("QUEUED");
    const logs = await db.select().from(warehouseLog);
    expect(
      logs
        .map(({ itemId, type, quantity }) => ({ itemId, type, quantity }))
        .sort((a, b) => (a.itemId ?? "").localeCompare(b.itemId ?? "")),
    ).toEqual([
      { itemId: "ore", type: "RELEASE", quantity: 180 },
      { itemId: "silk", type: "RELEASE", quantity: 45 },
    ]);
  });

  it("returns escorts to the queue only from their caravan's battles", async () => {
    const db = await getTestDatabase();
    await insertUsers([
      { userId: "escort", status: "BATTLE", battleId: "defence", villageId: "leaf" },
      { userId: "raider", status: "BATTLE", battleId: "defence", villageId: "sand" },
      { userId: "healed", status: "BATTLE", battleId: "arena", villageId: "leaf" },
    ]);
    await db.insert(caravan).values(caravanRow({ status: "PREPARING" }));
    for (const userId of ["escort", "healed"])
      expect((await insertGuard(db, "c1", userId, new Date())).rowsAffected).toBe(1);
    const leave = (userId: string, fight: CompleteBattle) =>
      updateUserDataForFinishBattle(
        db,
        () => sql`${userData.curEnergy}`,
        fight,
        {
          userId,
          curHealth: 100,
          curStamina: 100,
          curChakra: 100,
          allyVillage: false,
          sector: 1,
          villageId: null,
        },
        false,
      );
    const defence = makeCompleteBattle({ id: "defence", battleType: "CARAVAN" });
    await leave("escort", defence);
    await leave("raider", defence);
    // An escort healed out of the queue rejoins it themselves after another fight.
    await leave("healed", makeCompleteBattle({ id: "arena", battleType: "ARENA" }));
    expect(await statusOf("escort")).toBe("QUEUED");
    expect(await statusOf("raider")).toBe("AWAKE");
    expect(await statusOf("healed")).toBe("AWAKE");
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
    const now = new Date();
    await insertUsers([
      { userId: "busy", status: "QUEUED", money: 0 },
      { userId: "idle", status: "QUEUED", money: 0 },
      { userId: "fighter", status: "BATTLE", battleId: "arena", money: 10 },
    ]);
    const arrived = caravanRow({
      lossBp: 1000,
      arrivesAt: new Date(Date.now() - 1000),
    });
    await db.insert(caravan).values(arrived);
    await db.insert(caravanParticipant).values(
      ["busy", "idle", "fighter"].map((userId, slot) => ({
        caravanId: "c1",
        userId,
        role: "GUARD" as const,
        activeUserId: userId,
        guardSlot: slot,
        objectives: { busy: 2, idle: 0, fighter: 1 }[userId] ?? 0,
        joinedAt: now,
      })),
    );
    const [row] = await db.select().from(caravan);
    if (!row) throw new Error("caravan missing");
    // Notifications are deferred response work; this direct call drops them.
    const deliver = () => afterTasks.run([], () => deliverCaravan(db, row, now));
    const [first, second] = await Promise.all([deliver(), deliver()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const [delivered] = await db.select().from(caravan);
    expect(delivered?.status).toBe("DELIVERED");
    expect(delivered?.version).toBe(row.version + 1);
    expect(delivered?.resolvedAt?.getTime()).toBe(now.getTime());
    // The destination had no ore row; the delivery created and credited it.
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
    expect(users.fighter?.money).toBe(
      10 + CARAVAN_GUARD_DELIVERY_RYO + CARAVAN_GUARD_OBJECTIVE_RYO,
    );
    expect(users.busy?.status).toBe("AWAKE");
    expect(users.idle?.status).toBe("AWAKE");
    // An escort fighting elsewhere keeps their battle.
    expect(users.fighter?.status).toBe("BATTLE");
    const escorts = await db.select().from(caravanParticipant);
    expect(escorts.every((p) => p.activeUserId === null)).toBe(true);
    expect(escorts.every((p) => p.rewardedAt?.getTime() === now.getTime())).toBe(true);
    const logs = await db.select().from(warehouseLog);
    expect(
      logs.map(({ villageId, type, quantity }) => ({ villageId, type, quantity })),
    ).toEqual([{ villageId: "sand", type: "DELIVERY", quantity: 180 }]);
    // A later retry of the same read pays and credits nothing again.
    expect(await deliver()).toBe(false);
    const [kept] = await db
      .select()
      .from(warehouseStock)
      .where(eq(warehouseStock.villageId, "sand"));
    expect(kept?.quantity).toBe(180);
    const [busy] = await db.select().from(userData).where(eq(userData.userId, "busy"));
    expect(busy?.money).toBe(
      CARAVAN_GUARD_DELIVERY_RYO + 2 * CARAVAN_GUARD_OBJECTIVE_RYO,
    );
  });

  it("keeps an arrived caravan on the road while a fight over it is open", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await insertUsers([{ userId: "guard", status: "QUEUED", money: 0 }]);
    await db
      .insert(caravan)
      .values(caravanRow({ arrivesAt: new Date(Date.now() - 1000) }));
    await db.insert(caravanParticipant).values({
      caravanId: "c1",
      userId: "guard",
      role: "GUARD",
      activeUserId: "guard",
      guardSlot: 0,
      objectives: 1,
      joinedAt: now,
    });
    const [row] = await db.select().from(caravan);
    if (!row) throw new Error("caravan missing");
    // The fight opens after the delivery read its encounters.
    const racing = aroundStatements(
      db,
      caravanEncounter,
      async (run) => {
        const rows = await run();
        await db.insert(caravanEncounter).values({
          id: "e1",
          type: "INTERCEPTION",
          status: "FIGHTING",
          caravanId: "c1",
          activeCaravanId: "c1",
          battleId: "b1",
          createdAt: now,
        });
        return rows;
      },
      { operations: ["select"] },
    );
    expect(await afterTasks.run([], () => deliverCaravan(racing, row, now))).toBe(
      false,
    );
    expect((await db.select().from(caravan))[0]?.status).toBe("TRAVELLING");
    expect((await db.select().from(warehouseStock))[0]?.quantity).toBe(0);
    expect(await statusOf("guard")).toBe("QUEUED");
    const [guard] = await db.select().from(caravanParticipant);
    expect(guard?.activeUserId).toBe("guard");
    expect(guard?.rewardedAt).toBeNull();
    expect(await db.select().from(warehouseLog)).toHaveLength(0);
  });

  it("calls off a caravan for a blocked route only while no fight over it is open", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await db.insert(caravan).values(caravanRow());
    const [row] = await db.select().from(caravan);
    if (!row) throw new Error("caravan missing");
    await insertCheckpointAmbush(db, {
      id: "e1",
      caravanId: "c1",
      expiresAt: new Date(now.getTime() + HOUR),
      now,
    });
    const cancel = () =>
      afterTasks.run([], () => cancelCaravan(db, row, now, { unfought: true }));
    expect(await cancel()).toBe(false);
    const [kept] = await db.select().from(caravan);
    expect(kept?.status).toBe("TRAVELLING");
    expect((await db.select().from(warehouseStock))[0]?.quantity ?? 0).toBe(0);
    await db.delete(caravanEncounter).where(eq(caravanEncounter.id, "e1"));
    expect(await cancel()).toEqual([]);
    const [cancelled] = await db.select().from(caravan);
    expect(cancelled?.status).toBe("CANCELLED");
    expect((await db.select().from(warehouseStock))[0]?.quantity).toBe(200);
  });

  it("releases a fight whose battle was abandoned and settles nothing when it ends", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    const hourAgo = new Date(now.getTime() - HOUR);
    await insertUsers([{ userId: "leader", isOutlaw: true }]);
    await db
      .insert(caravan)
      .values(
        ["c1", "c2", "c3"].map((id) =>
          caravanRow({ id, routeId: id, checkpointsProcessed: 3 }),
        ),
      );
    // c3 is an escort's defence against an ambush, which costs what an unanswered one would.
    await db.insert(caravanEncounter).values(
      ["c1", "c2", "c3"].map((id) => ({
        id: `e-${id}`,
        type: id === "c3" ? ("AMBUSH" as const) : ("INTERCEPTION" as const),
        status: "FIGHTING" as const,
        caravanId: id,
        activeCaravanId: id,
        battleId: `b-${id}`,
        leaderId: "leader",
        createdAt: hourAgo,
      })),
    );
    const fight = (id: string, updatedAt: Date) =>
      makeCompleteBattle({
        id: `b-${id}`,
        battleType: "CARAVAN",
        updatedAt,
        usersState: [
          makeBattleUser("leader", { direction: "left", curHealth: 50 }),
          makeBattleUser("npc", { direction: "right", curHealth: 0, isAi: true }),
        ],
        extraState: {
          caravan: battleState({
            encounterId: `e-${id}`,
            battleId: `b-${id}`,
            caravanId: id,
            attackerIds: ["leader"],
          }),
        },
      });
    await db
      .insert(battle)
      .values([fight("c1", hourAgo), fight("c2", now), fight("c3", hourAgo)]);
    await afterTasks.run([], () =>
      maintainCaravans(db, now, { caravanIds: ["c1", "c2", "c3"] }),
    );
    const encounters = Object.fromEntries(
      (await db.select().from(caravanEncounter)).map((row) => [row.id, row.status]),
    );
    expect(encounters).toEqual({
      "e-c1": "RESOLVED",
      "e-c2": "FIGHTING",
      "e-c3": "RESOLVED",
    });
    await settleCaravanCombat(db, fight("c1", now));
    const losses = Object.fromEntries(
      (await db.select().from(caravan)).map((row) => [row.id, row.lossBp]),
    );
    expect(losses).toEqual({ c1: 0, c2: 0, c3: CARAVAN_AMBUSH_LOSS_BP });
  });

  it("charges an unanswered ambush once its deadline passes", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await db.insert(caravan).values(caravanRow({ checkpointsProcessed: 3 }));
    await db.insert(caravanEncounter).values({
      id: "e1",
      type: "AMBUSH",
      status: "PENDING",
      caravanId: "c1",
      activeCaravanId: "c1",
      expiresAt: new Date(now.getTime() - 1000),
      createdAt: new Date(now.getTime() - HOUR),
    });
    await afterTasks.run([], () => maintainCaravans(db, now, { caravanIds: ["c1"] }));
    const [row] = await db.select().from(caravan);
    expect(row?.lossBp).toBe(CARAVAN_AMBUSH_LOSS_BP);
    const [encounter] = await db.select().from(caravanEncounter);
    expect(encounter?.status).toBe("RESOLVED");
    expect(encounter?.activeCaravanId).toBeNull();
  });

  it("releases the group of a leader renamed during their interception", async () => {
    const db = await getTestDatabase();
    const hourAgo = new Date(Date.now() - HOUR);
    await insertUsers([
      { userId: "leader", isOutlaw: true },
      { userId: "rider", isOutlaw: true },
    ]);
    await db.insert(caravan).values(caravanRow({ checkpointsProcessed: 3 }));
    await db.insert(caravanParticipant).values(
      ["leader", "rider"].map((userId) => ({
        caravanId: "c1",
        userId,
        role: "BANDIT" as const,
        activeUserId: userId,
        groupLeaderId: "leader",
        joinedAt: hourAgo,
      })),
    );
    await db.insert(caravanEncounter).values({
      id: "e1",
      type: "INTERCEPTION",
      status: "FIGHTING",
      caravanId: "c1",
      activeCaravanId: "c1",
      battleId: "b-gone",
      leaderId: "leader",
      createdAt: hourAgo,
    });
    await Promise.all(
      renameCaravanUser(db, { userId: "leader", newUserId: "leader-new" }),
    );
    const [encounter] = await db.select().from(caravanEncounter);
    expect(encounter?.leaderId).toBe("leader-new");
    await afterTasks.run([], () =>
      maintainCaravans(db, new Date(), { caravanIds: ["c1"] }),
    );
    const riders = await db.select().from(caravanParticipant);
    expect(
      riders.map((p) => [p.userId, p.activeUserId, p.groupLeaderId]).sort(),
    ).toEqual([
      ["leader-new", null, null],
      ["rider", null, null],
    ]);
  });

  it("charges an abandoned defence only to a caravan still on the road", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await db
      .insert(caravan)
      .values([
        caravanRow({ id: "road" }),
        caravanRow({ id: "done", status: "DELIVERED", lossBp: 500 }),
      ]);
    await db.insert(caravanEncounter).values(
      ["road", "done"].map((id) => ({
        id: `e-${id}`,
        type: "AMBUSH" as const,
        status: "STARTING" as const,
        caravanId: id,
        activeCaravanId: id,
        battleId: `b-${id}`,
        createdAt: now,
      })),
    );
    // A snapshot of an earlier battle over the encounter releases nothing.
    expect(
      (
        await chargeAmbushLoss(
          db,
          { id: "e-road", status: "STARTING", battleId: "b-earlier" },
          CARAVAN_AMBUSH_LOSS_BP,
          now,
        )
      ).rowsAffected,
    ).toBe(0);
    for (const id of ["road", "done"])
      await chargeAmbushLoss(
        db,
        { id: `e-${id}`, status: "STARTING", battleId: `b-${id}` },
        CARAVAN_AMBUSH_LOSS_BP,
        now,
      );
    // A second pass finds nothing left to release.
    expect(
      (
        await chargeAmbushLoss(
          db,
          { id: "e-road", status: "STARTING", battleId: "b-road" },
          CARAVAN_AMBUSH_LOSS_BP,
          now,
        )
      ).rowsAffected,
    ).toBe(0);
    const losses = Object.fromEntries(
      (await db.select().from(caravan)).map((row) => [row.id, row.lossBp]),
    );
    expect(losses).toEqual({ road: CARAVAN_AMBUSH_LOSS_BP, done: 500 });
    const encounters = await db.select().from(caravanEncounter);
    expect(encounters.every((row) => row.status === "RESOLVED")).toBe(true);
    expect(encounters.every((row) => row.activeCaravanId === null)).toBe(true);
  });

  it("settles a battle whose encounter was never promoted from its start", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "leader", isOutlaw: true }]);
    await db.insert(caravan).values(caravanRow());
    await db.insert(caravanEncounter).values({
      id: "e1",
      type: "AMBUSH",
      status: "STARTING",
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
          makeBattleUser("npc", { direction: "left", curHealth: 50, isAi: true }),
          makeBattleUser("leader", { direction: "right", curHealth: 0 }),
        ],
        extraState: {
          caravan: battleState({
            type: "AMBUSH",
            attackerIds: [],
            guardIds: ["leader"],
          }),
        },
      }),
    );
    const [encounter] = await db.select().from(caravanEncounter);
    expect(encounter?.status).toBe("RESOLVED");
    const [row] = await db.select().from(caravan);
    expect(row?.lossBp).toBe(CARAVAN_AMBUSH_LOSS_BP);
  });

  it("credits no defence for an ambush every player fled", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "guard" }]);
    await db.insert(caravan).values(caravanRow());
    await db.insert(caravanParticipant).values({
      caravanId: "c1",
      userId: "guard",
      role: "GUARD",
      activeUserId: "guard",
      guardSlot: 0,
      joinedAt: new Date(),
    });
    await db.insert(caravanEncounter).values({
      id: "e1",
      type: "AMBUSH",
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
          makeBattleUser("bandit", { direction: "left", curHealth: 50, isAi: true }),
          makeBattleUser("ally", { direction: "right", curHealth: 50, isAi: true }),
          makeBattleUser("guard", {
            direction: "right",
            curHealth: 50,
            fledBattle: true,
          }),
        ],
        extraState: {
          caravan: battleState({
            type: "AMBUSH",
            attackerIds: [],
            guardIds: ["guard"],
          }),
        },
      }),
    );
    const [guard] = await db.select().from(caravanParticipant);
    expect(guard?.objectives).toBe(0);
    const [row] = await db.select().from(caravan);
    expect(row?.lossBp).toBe(0);
  });

  it("names the villages of open and finished caravans apart from their route", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await db.insert(village).values([
      { id: "leaf", name: "Leaf", kageId: "leaf-kage", sector: 1 },
      { id: "sand", name: "Sand", kageId: "sand-kage", sector: 2 },
    ]);
    // The finished caravans' route is closed, and one partner village no longer exists.
    await db.insert(caravan).values([
      caravanRow({ id: "open" }),
      caravanRow({
        id: "delivered",
        routeId: "closed",
        status: "DELIVERED",
        originVillageId: "sand",
        destinationVillageId: "leaf",
        resolvedAt: new Date(now.getTime() - HOUR),
      }),
      caravanRow({
        id: "cancelled",
        routeId: "closed",
        status: "CANCELLED",
        destinationVillageId: "removed",
        resolvedAt: now,
      }),
    ]);
    const names = (
      rows: { id: string; originName: string | null; destinationName: string | null }[],
    ) => rows.map((row) => [row.id, row.originName, row.destinationName]);
    expect(names(await listOpenVillageCaravans(db, "leaf"))).toEqual([
      ["open", "Leaf", "Sand"],
    ]);
    expect(names(await listFinishedVillageCaravans(db, "leaf", 5))).toEqual([
      ["cancelled", "Leaf", null],
      ["delivered", "Sand", "Leaf"],
    ]);
  });

  it("closes a disbanded settlement's routes and calls off its caravans", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    const route = (id: string, villageIdB: string, status: "ACTIVE" | "PROPOSED") => ({
      id,
      villageIdA: "leaf",
      villageIdB,
      openPair: `leaf:${villageIdB}`,
      status,
      proposedByVillageId: "leaf",
      path: [1, 2, 3],
      createdAt: now,
    });
    await db
      .insert(tradeRoute)
      .values([route("r1", "sand", "ACTIVE"), route("r2", "mist", "ACTIVE")]);
    await db
      .insert(caravan)
      .values([
        caravanRow({ id: "outbound", lossBp: 1000 }),
        caravanRow({ id: "outbound2" }),
        caravanRow({ id: "kept", routeId: "r2", destinationVillageId: "mist" }),
      ]);
    // Account deletion disbands the settlement inside its own transaction.
    await afterTasks.run([], () =>
      db.transaction((tx) => closeVillageTrade(tx, "sand", now)),
    );
    const routes = Object.fromEntries(
      (await db.select().from(tradeRoute)).map((row) => [row.id, row]),
    );
    expect(routes.r1?.status).toBe("CLOSED");
    expect(routes.r1?.openPair).toBeNull();
    expect(routes.r2?.status).toBe("ACTIVE");
    const caravans = Object.fromEntries(
      (await db.select().from(caravan)).map((row) => [row.id, row.status]),
    );
    expect(caravans).toEqual({
      outbound: "CANCELLED",
      outbound2: "CANCELLED",
      kept: "TRAVELLING",
    });
    // Caravans bound for the disbanded settlement bring their remaining 180 + 200 ore home.
    const [stock] = await db.select().from(warehouseStock);
    expect(stock).toMatchObject({ villageId: "leaf", quantity: 380 });
  });

  it("calls off a disbanded settlement's caravan whose version moved after the read", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await db.insert(caravan).values(caravanRow());
    // An ambush expires between the disband's read and its cancel, taking 10% of the ore.
    let bumped = false;
    const racing = aroundStatements(
      db,
      caravan,
      async (run) => {
        const rows = await run();
        if (!bumped) {
          bumped = true;
          await db
            .update(caravan)
            .set({ lossBp: 1000, version: 1 })
            .where(eq(caravan.id, "c1"));
        }
        return rows;
      },
      { operations: ["select"] },
    );
    await afterTasks.run([], () => closeVillageTrade(racing, "sand", now));
    const [row] = await db.select().from(caravan);
    expect(row?.status).toBe("CANCELLED");
    const [stock] = await db.select().from(warehouseStock);
    expect(stock).toMatchObject({ villageId: "leaf", quantity: 180 });
  });

  it("alerts a disbanded settlement's escorts only once its transaction commits", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await insertUsers([{ userId: "guard", status: "AWAKE", villageId: "leaf" }]);
    await db
      .insert(warehouseStock)
      .values({ villageId: "leaf", itemId: "ore", quantity: 250, reserved: 200 });
    await db.insert(caravan).values(caravanRow({ status: "PREPARING" }));
    expect((await insertGuard(db, "c1", "guard", now)).rowsAffected).toBe(1);
    const trigger = spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    // Account deletion disbands on its own transaction; its deferred work runs afterwards.
    const disband = (rollsBack: boolean) => {
      const tasks: (() => unknown)[] = [];
      return afterTasks.run(tasks, async () => {
        await db
          .transaction(async (tx) => {
            await closeVillageTrade(tx, "sand", now);
            if (rollsBack) throw new Error("deletion failed");
          })
          .catch(() => undefined);
        for (const task of tasks) await task();
      });
    };
    try {
      await disband(true);
      expect((await db.select().from(caravan))[0]?.status).toBe("PREPARING");
      expect(trigger).not.toHaveBeenCalled();
      await disband(false);
      expect((await db.select().from(caravan))[0]?.status).toBe("CANCELLED");
      expect(trigger).toHaveBeenCalledTimes(1);
      expect(trigger.mock.calls[0]?.[0]).toEqual(["guard"]);
    } finally {
      trigger.mockRestore();
    }
  });

  it("leaves a marker that changed hands since its assault started", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "raider", villageId: "mist" }]);
    await db.insert(tradeRouteMarker).values({
      id: "m1",
      routeId: "r1",
      sector: 2,
      control: 25,
      controllerVillageId: "cloud",
    });
    await db.insert(caravanEncounter).values({
      id: "e1",
      type: "MARKER_ASSAULT",
      status: "FIGHTING",
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
            markerControllerId: null,
          }),
        },
      }),
    );
    const [marker] = await db.select().from(tradeRouteMarker);
    expect(marker).toMatchObject({ controllerVillageId: "cloud", control: 25 });
    const [encounter] = await db.select().from(caravanEncounter);
    expect(encounter?.status).toBe("RESOLVED");
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
      path: [1, 2, 3],
      createdAt: new Date(),
    });
    await db.insert(tradeRouteMarker).values({
      id: "m1",
      routeId: "r1",
      sector: 2,
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
  attackerIds: ["leader", "rider"],
  guardIds: [],
  cargo: [{ itemId: "ore", quantity: 200 }],
  lossBp: 0,
  stealBp: 1000,
  captureVillageId: null,
  markerControllerId: null,
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
