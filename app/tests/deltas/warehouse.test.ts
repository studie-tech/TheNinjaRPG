import { describe, expect, it } from "bun:test";
import type { InfiniteData } from "@tanstack/react-query";
import type { RouterOutputs } from "@/app/_trpc/client";
import {
  applyWarehouseChange,
  getApprovalWarehouseChange,
  getCargoWarehouseChange,
  getDepositInventoryChanges,
  getDepositWarehouseChange,
  getPaidWarehouseChange,
  getProductionWarehouseChange,
  getWarehouseHistoryWithLogs,
  getWarehouseLogEntries,
  getWithdrawWarehouseChange,
} from "@/deltas/warehouse";
import {
  WAREHOUSE_DEPOSIT_COOLDOWN_HOURS,
  WAREHOUSE_MIN_DEPOSIT,
} from "@/drizzle/constants";
import { CARGO_MOVES } from "@/libs/caravan";

type Warehouse = NonNullable<RouterOutputs["warehouse"]["getWarehouse"]>;
type History = InfiniteData<RouterOutputs["warehouse"]["getHistory"]>;

const now = new Date("2026-11-21T12:00:00Z");
const wood = {
  name: "Wood",
  image: "wood.png",
  itemType: "MATERIAL" as const,
  canStack: true,
  warehouseItem: true,
};
const stack = (id: string, quantity: number, extra: object = {}) => ({
  id,
  itemId: "wood",
  quantity,
  equipped: "NONE" as const,
  storedAtHome: false,
  isInAuction: false,
  craftingFinishedAt: null,
  item: wood,
  ...extra,
});
const view = (overrides: Partial<Warehouse> = {}) =>
  ({
    village: { id: "v", name: "V", funds: 1000, usesClanPoints: false },
    stock: [
      {
        itemId: "iron",
        quantity: 10,
        reserved: 0,
        name: "Iron",
        image: "",
      },
      {
        itemId: "wood",
        quantity: 50,
        reserved: 5,
        ...wood,
      },
    ],
    allowance: { total: 100, used: 10, remaining: 90, day: "2026-11-21" },
    depositCandidates: [
      {
        userItemId: "s1",
        itemId: "wood",
        name: "Wood",
        quantity: 30,
        availableAt: null,
      },
      {
        userItemId: "s2",
        itemId: "iron",
        name: "Iron",
        quantity: 20,
        availableAt: null,
      },
    ],
    production: [],
    approvals: [],
    ...overrides,
  }) as unknown as Warehouse;

describe("warehouse deltas", () => {
  it("credits a deposit and starts the item's cooldown on its remaining stacks", () => {
    const change = getDepositWarehouseChange({
      stack: stack("s1", 80),
      quantity: 50,
      credited: 52,
      inventory: [stack("s1", 80), stack("s3", WAREHOUSE_MIN_DEPOSIT)],
      ledgers: [],
      now,
    });
    const next = applyWarehouseChange(view(), change);
    const availableAt = new Date(
      now.getTime() + WAREHOUSE_DEPOSIT_COOLDOWN_HOURS * 3_600_000,
    );
    expect(next?.stock.find((row) => row.itemId === "wood")).toMatchObject({
      quantity: 102,
      reserved: 5,
    });
    // The consumed stack falls below the minimum and leaves the candidates in place.
    expect(next?.depositCandidates.map((row) => row.userItemId)).toEqual(["s3", "s2"]);
    expect(next?.depositCandidates[0]?.availableAt).toEqual(availableAt);
    expect(getDepositInventoryChanges(stack("s1", 80), 50)).toEqual([
      { id: "s1", itemId: "wood", beforeQuantity: 80, quantity: 30 },
    ]);
  });

  it("adds a first stock row in name order and rejects unknown rows without details", () => {
    const fresh = { ...wood, name: "Clay" };
    const change = getDepositWarehouseChange({
      stack: { ...stack("s9", 40), itemId: "clay", item: fresh },
      quantity: 40,
      credited: 40,
      inventory: [],
      ledgers: [],
      now,
    });
    expect(
      applyWarehouseChange(view(), change)?.stock.map((row) => row.itemId),
    ).toEqual(["clay", "iron", "wood"]);
    expect(
      applyWarehouseChange(
        view(),
        getCargoWarehouseChange(
          [{ itemId: "clay", quantity: 5 }],
          CARGO_MOVES.DISPATCH,
        ),
      ),
    ).toBeUndefined();
    expect(applyWarehouseChange(view(), undefined)).toBeUndefined();
    expect(applyWarehouseChange(null, change)).toBeUndefined();
  });

  it("charges a withdrawal against stock and allowance and lists the stacks it filled", () => {
    const change = getWithdrawWarehouseChange({
      item: { id: "wood", ...wood },
      quantity: 35,
      inventory: [stack("s1", 30)],
      stacks: [
        { id: "s1", itemId: "wood", quantity: 60 },
        { id: "new", itemId: "wood", quantity: 5 },
      ],
      ledgers: [{ itemId: "wood", lastDepositAt: new Date(now.getTime() - 3_600_000) }],
      now,
    });
    const next = applyWarehouseChange(view(), change);
    expect(next?.stock.find((row) => row.itemId === "wood")?.quantity).toBe(15);
    expect(next?.allowance).toMatchObject({ total: 100, used: 45, remaining: 55 });
    // A view still showing the previous UTC day reads the new day's allowance instead.
    const allowance = { ...view().allowance, day: "2026-11-20" };
    expect(applyWarehouseChange(view({ allowance }), change)).toBeUndefined();
    // The opened stack is below the deposit minimum; the filled one keeps the cooldown.
    expect(next?.depositCandidates).toEqual([
      expect.objectContaining({
        userItemId: "s1",
        quantity: 60,
        availableAt: new Date(
          now.getTime() + (WAREHOUSE_DEPOSIT_COOLDOWN_HOURS - 1) * 3_600_000,
        ),
      }),
      expect.objectContaining({ userItemId: "s2" }),
    ]);
  });

  it("reserves, releases and dispatches cargo", () => {
    const cargo = [{ itemId: "wood", quantity: 5 }];
    const reserved = applyWarehouseChange(
      view(),
      getCargoWarehouseChange(cargo, CARGO_MOVES.RESERVE),
    );
    expect(reserved?.stock[1]).toMatchObject({ quantity: 50, reserved: 10 });
    const departed = applyWarehouseChange(
      view(),
      getCargoWarehouseChange(cargo, CARGO_MOVES.DISPATCH),
    );
    expect(departed?.stock[1]).toMatchObject({ quantity: 45, reserved: 0 });
  });

  it("replaces production, approvals and funds", () => {
    const produced = applyWarehouseChange(
      view(),
      getProductionWarehouseChange([{ id: "wood", ...wood }]),
    );
    expect(produced?.production).toEqual([{ itemId: "wood", name: "Wood" }]);
    expect(produced?.stock[1]).toMatchObject({ quantity: 50, reserved: 5 });
    const target = { userId: "u", username: "Ninja" };
    const approved = applyWarehouseChange(
      view(),
      getApprovalWarehouseChange("kage", target, { wartime: true }),
    );
    expect(approved?.approvals).toEqual([{ ...target, wartime: true, active: true }]);
    expect(
      applyWarehouseChange(approved!, getApprovalWarehouseChange("kage", target, null))
        ?.approvals,
    ).toEqual([]);
    // A leader's own approval changes their allowance, which the view must reconcile.
    expect(getApprovalWarehouseChange("u", target, { wartime: false })).toBeUndefined();
    expect(getApprovalWarehouseChange("u", target, null)).toBeUndefined();
    expect(
      applyWarehouseChange(view(), getPaidWarehouseChange(300))?.village,
    ).toMatchObject({ funds: 700 });
  });

  it("shows written logs at the top of the first history page once", () => {
    const history: History = {
      pages: [
        {
          data: [
            {
              id: "old",
              type: "DEPOSIT",
              quantity: 1,
              createdAt: new Date(now.getTime() - 1000),
              itemName: "Wood",
              username: "A",
            },
          ],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    };
    const logs = getWarehouseLogEntries(
      [
        { id: "a", type: "RESERVE", quantity: 5, itemId: "wood" },
        { id: "b", type: "RESERVE", quantity: 2, itemId: "iron" },
      ],
      { items: new Map([["wood", "Wood"]]), username: "Kage" },
      now,
    );
    const next = getWarehouseHistoryWithLogs(history, logs);
    expect(next?.pages[0]?.data.map((row) => row.id)).toEqual(["b", "a", "old"]);
    expect(next?.pages[0]?.data[0]?.itemName).toBeNull();
    expect(getWarehouseHistoryWithLogs(next!, logs)?.pages[0]?.data).toHaveLength(3);
    expect(getWarehouseHistoryWithLogs(history, undefined)).toBeUndefined();
  });

  it("keeps the history order around logs written before a newer shown row", () => {
    const row = (id: string, at: number) => ({
      id,
      type: "DEPOSIT" as const,
      quantity: 1,
      createdAt: new Date(now.getTime() + at),
      itemName: "Wood",
      username: "A",
    });
    const history: History = {
      pages: [
        {
          data: [row("newer", 1000), row("last", -5000)],
          nextCursor: { createdAt: new Date(now.getTime() - 5000), id: "last" },
        },
      ],
      pageParams: [null],
    };
    const logs = [row("mine", 0), row("older", -9000)];
    expect(
      getWarehouseHistoryWithLogs(history, logs)?.pages[0]?.data.map(
        (entry) => entry.id,
      ),
    ).toEqual(["newer", "mine", "last"]);
  });
});
