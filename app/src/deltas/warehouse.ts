import type { InfiniteData } from "@tanstack/react-query";
import type { RouterOutputs } from "@/app/_trpc/client";
import { getInventoryQuantityChanges } from "@/deltas/item";
import type { WarehouseLogType } from "@/drizzle/constants";
import type {
  Item,
  UserData,
  UserItem,
  WarehouseDepositLedger,
} from "@/drizzle/schema";
import type { CargoLine } from "@/libs/caravan";
import { getDepositCandidates } from "@/libs/warehouse";
import type { WarehouseChange, WarehouseLogEntry } from "@/validators/warehouse";

type WarehouseView = RouterOutputs["warehouse"]["getWarehouse"];
type HistoryPages = InfiniteData<RouterOutputs["warehouse"]["getHistory"]>;
type CandidateStack = Parameters<typeof getDepositCandidates>[0][number];
type StockItem = Pick<
  Item,
  "name" | "image" | "itemType" | "rarity" | "stackSize" | "canStack"
>;

/**
 * Describe a confirmed deposit: the credited stock, the stack it consumed and the cooldown
 * it started for the item's other stacks.
 */
export const getDepositWarehouseChange = ({
  stack,
  quantity,
  credited,
  inventory,
  ledgers,
  now,
}: {
  stack: CandidateStack & { item: StockItem };
  quantity: number;
  credited: number;
  inventory: CandidateStack[];
  ledgers: Pick<WarehouseDepositLedger, "itemId" | "lastDepositAt">[];
  now: Date;
}): WarehouseChange => ({
  stock: [
    {
      itemId: stack.itemId,
      quantity: credited,
      reserved: 0,
      item: getStockItem(stack.item),
    },
  ],
  candidates: getItemCandidates(
    stack.itemId,
    inventory.map((row) =>
      row.id === stack.id ? { ...row, quantity: row.quantity - quantity } : row,
    ),
    [
      ...ledgers.filter((ledger) => ledger.itemId !== stack.itemId),
      { itemId: stack.itemId, lastDepositAt: now },
    ],
    now,
  ),
});

/** Describe the consumed stack of a deposit; its quantity was guarded by the write. */
export const getDepositInventoryChanges = (
  stack: Pick<UserItem, "id" | "itemId" | "quantity">,
  quantity: number,
) =>
  getInventoryQuantityChanges(
    [stack],
    [{ id: stack.id, quantity: stack.quantity - quantity }],
  );

/**
 * Describe a confirmed withdrawal: stock and allowance taken, and the item's deposit
 * candidates after the backpack stacks it filled or opened. A filled stack missing from the
 * loaded inventory withholds the change.
 */
export const getWithdrawWarehouseChange = ({
  item,
  quantity,
  inventory,
  stacks,
  ledgers,
  now,
}: {
  item: { id: string } & CandidateStack["item"];
  quantity: number;
  inventory: CandidateStack[];
  stacks: { id: string; itemId: string; quantity: number }[];
  ledgers: Pick<WarehouseDepositLedger, "itemId" | "lastDepositAt">[];
  now: Date;
}): WarehouseChange | undefined => {
  const opened = stacks.filter(
    (stack) => !inventory.some((row) => row.id === stack.id),
  );
  if (opened.some((stack) => stack.itemId !== item.id)) return;
  const updated: CandidateStack[] = [
    ...inventory.map((row) => {
      const stack = stacks.find((entry) => entry.id === row.id);
      return stack ? { ...row, quantity: stack.quantity } : row;
    }),
    ...opened.map((stack) => ({
      id: stack.id,
      itemId: stack.itemId,
      quantity: stack.quantity,
      equipped: "NONE" as const,
      storedAtHome: false,
      isInAuction: false,
      craftingFinishedAt: null,
      item,
    })),
  ];
  return {
    stock: [{ itemId: item.id, quantity: -quantity, reserved: 0 }],
    allowanceUsed: quantity,
    candidates: getItemCandidates(item.id, updated, ledgers, now),
  };
};

/**
 * Stock moved by a caravan's cargo, per unit of the manifest: reservation adds to reserved
 * stock, release removes it, and departure removes both the stock and its reservation.
 */
export const getCargoWarehouseChange = (
  cargo: CargoLine[],
  sign: { quantity: -1 | 0; reserved: -1 | 1 },
): WarehouseChange => ({
  stock: cargo.map((line) => ({
    itemId: line.itemId,
    quantity: sign.quantity * line.quantity,
    reserved: sign.reserved * line.quantity,
  })),
});

/** Describe a saved production choice, which also opens empty stock rows for its items. */
export const getProductionWarehouseChange = (
  items: ({ id: string } & StockItem)[],
): WarehouseChange => ({
  production: items.map((item) => ({ itemId: item.id, name: item.name })),
  stock: items.map((item) => ({
    itemId: item.id,
    quantity: 0,
    reserved: 0,
    item: getStockItem(item),
  })),
});

/** Describe a granted or revoked approval; a granted one starts active. */
export const getApprovalWarehouseChange = (
  target: Pick<UserData, "userId" | "username" | "avatar" | "rank">,
  approval: { wartime: boolean } | null,
): WarehouseChange => ({
  approval: {
    userId: target.userId,
    row: approval
      ? {
          userId: target.userId,
          username: target.username,
          avatar: target.avatar,
          rank: target.rank,
          wartime: approval.wartime,
          active: true,
        }
      : null,
  },
});

/** Describe the funds a village paid; faction settlements pay with clan points, not tokens. */
export const getPaidWarehouseChange = (
  cost: number,
  usesClanPoints: boolean,
): WarehouseChange => ({
  funds: { tokens: usesClanPoints ? 0 : -cost, funds: -cost },
});

/** History rows for written logs, named the way the history pages list them. */
export const getWarehouseLogEntries = (
  logs: { id: string; type: WarehouseLogType; quantity: number; itemId: string }[],
  names: { items: Map<string, string>; username: string },
  createdAt: Date,
): WarehouseLogEntry[] =>
  logs.map((log) => ({
    id: log.id,
    type: log.type,
    quantity: log.quantity,
    createdAt,
    itemName: names.items.get(log.itemId) ?? null,
    username: names.username,
  }));

/**
 * Apply a confirmed change to the Warehouse view. Unknown stock rows without item details
 * and stock removed from rows the view lacks return undefined for an authoritative read.
 */
export const applyWarehouseChange = (
  current: WarehouseView,
  change: WarehouseChange | undefined,
): WarehouseView | undefined => {
  if (!current || !change) return;
  let stock = current.stock;
  for (const entry of change.stock ?? []) {
    const row = stock.find((item) => item.itemId === entry.itemId);
    if (row) {
      stock = stock.map((item) =>
        item === row
          ? {
              ...item,
              quantity: item.quantity + entry.quantity,
              reserved: item.reserved + entry.reserved,
            }
          : item,
      );
      continue;
    }
    if (!entry.item || entry.quantity < 0 || entry.reserved < 0) return;
    const added = {
      itemId: entry.itemId,
      quantity: entry.quantity,
      reserved: entry.reserved,
      ...entry.item,
    };
    // Stock lists by item name.
    const index = stock.findIndex((item) => item.name.localeCompare(added.name) > 0);
    stock =
      index === -1
        ? [...stock, added]
        : [...stock.slice(0, index), added, ...stock.slice(index)];
  }
  const used = current.allowance.used + (change.allowanceUsed ?? 0);
  return {
    ...current,
    stock,
    allowance: {
      ...current.allowance,
      used,
      remaining: Math.max(0, current.allowance.total - used),
    },
    depositCandidates: change.candidates
      ? replaceCandidates(current.depositCandidates, change.candidates)
      : current.depositCandidates,
    village: change.funds
      ? {
          ...current.village,
          tokens: current.village.tokens + change.funds.tokens,
          funds: current.village.funds + change.funds.funds,
        }
      : current.village,
    production: change.production ?? current.production,
    approvals: change.approval
      ? replaceApproval(current.approvals, change.approval)
      : current.approvals,
  };
};

/** Show the logs a mutation wrote at the top of the loaded history. */
export const getWarehouseHistoryWithLogs = (
  current: HistoryPages,
  logs: WarehouseLogEntry[] | undefined,
): HistoryPages | undefined => {
  const [first, ...rest] = current.pages;
  if (!first || !logs) return;
  const fresh = logs
    .filter((log) => !first.data.some((row) => row.id === log.id))
    // History lists newest first, then by descending id.
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
    );
  return {
    ...current,
    pages: [{ ...first, data: [...fresh, ...first.data] }, ...rest],
  };
};

const getStockItem = (item: StockItem) => ({
  name: item.name,
  image: item.image,
  itemType: item.itemType,
  rarity: item.rarity,
  stackSize: item.stackSize,
  canStack: item.canStack,
});

const getItemCandidates = (
  itemId: string,
  inventory: CandidateStack[],
  ledgers: Pick<WarehouseDepositLedger, "itemId" | "lastDepositAt">[],
  now: Date,
) => ({
  itemIds: [itemId],
  rows: getDepositCandidates(
    inventory.filter((row) => row.itemId === itemId),
    ledgers,
    now,
  ),
});

const replaceCandidates = (
  rows: NonNullable<WarehouseView>["depositCandidates"],
  change: NonNullable<WarehouseChange["candidates"]>,
) => {
  const index = rows.findIndex((row) => change.itemIds.includes(row.itemId));
  const kept = rows.filter((row) => !change.itemIds.includes(row.itemId));
  const at = index === -1 ? kept.length : index;
  return [...kept.slice(0, at), ...change.rows, ...kept.slice(at)];
};

const replaceApproval = (
  rows: NonNullable<WarehouseView>["approvals"],
  change: NonNullable<WarehouseChange["approval"]>,
) => {
  const { row } = change;
  if (!row) return rows.filter((entry) => entry.userId !== change.userId);
  return rows.some((entry) => entry.userId === change.userId)
    ? rows.map((entry) => (entry.userId === change.userId ? row : entry))
    : [...rows, row];
};
