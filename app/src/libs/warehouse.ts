import {
  VILLAGE_SYNDICATE_ID,
  WAREHOUSE_ANBU_DAILY_ALLOWANCE,
  WAREHOUSE_APPROVED_DAILY_ALLOWANCE,
  WAREHOUSE_DAILY_ALLOWANCE,
  WAREHOUSE_DEPOSIT_BONUS_PER_LEVEL,
  WAREHOUSE_DEPOSIT_COOLDOWN_HOURS,
  WAREHOUSE_ITEM_TYPES,
  WAREHOUSE_LOYALTY_BONUS,
  WAREHOUSE_LOYALTY_DAYS,
  WAREHOUSE_MIN_DEPOSIT,
  WAREHOUSE_PRODUCTION_BASE_QUANTITY,
  WAREHOUSE_PRODUCTION_BONUS_PER_LEVEL,
  WAREHOUSE_PRODUCTION_INTERVAL_HOURS,
  WAREHOUSE_PRODUCTION_MAX_CYCLES,
} from "@/drizzle/constants";
import type {
  Item,
  UserData,
  UserItem,
  Village,
  VillageStructure,
  WarehouseDepositLedger,
  WarehouseMember,
} from "@/drizzle/schema";
import {
  countInventoryBucketSlots,
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
  getJoinableStackRoom,
  type InventorySlotRow,
  isCarriedUserItem,
} from "@/libs/item";
import { countHeldInventorySlots } from "@/libs/itemsPage";
import { getVillageLoyaltyDays } from "@/libs/villageLoyalty";
import { isFactionVillage } from "@/libs/war";
import { getUtcDayKey, HOUR_S, secondsFromDate } from "@/utils/time";
import { getEffectiveStructureLevel } from "@/utils/village";

/** The Warehouse structure of a village, built or not. */
export const findWarehouse = <T extends Pick<VillageStructure, "route">>(
  structures: T[] | undefined,
) => structures?.find((structure) => structure.route === "/warehouse");

/** Level of a Warehouse including temporary war bonuses; 0 while unbuilt. */
export const getWarehouseLevel = (
  structure: Parameters<typeof getEffectiveStructureLevel>[0] | undefined | null,
  now = new Date(),
) =>
  structure && structure.level > 0 ? getEffectiveStructureLevel(structure, now) : 0;

/**
 * Production bonus in percent, growing with the Warehouse level and multiplied while a won
 * faction raid boosts the Warehouse.
 */
export const getProductionBonus = (level: number, raidMultiplier = 1) =>
  getLevelBonus(WAREHOUSE_PRODUCTION_BONUS_PER_LEVEL, level, raidMultiplier);

/** Deposit bonus in percent, growing with the Warehouse level, with the raid boost. */
export const getDepositBonus = (level: number, raidMultiplier = 1) =>
  getLevelBonus(WAREHOUSE_DEPOSIT_BONUS_PER_LEVEL, level, raidMultiplier);

/** Units of one selected item a production cycle adds, rounded down without carry. */
export const getCycleQuantity = (level: number, raidMultiplier = 1) =>
  level <= 0
    ? 0
    : Math.floor(
        (WAREHOUSE_PRODUCTION_BASE_QUANTITY *
          (100 + getProductionBonus(level, raidMultiplier))) /
          100,
      );

/**
 * Complete cycles since the last settlement. At most WAREHOUSE_PRODUCTION_MAX_CYCLES are
 * credited; the clock still moves past every elapsed cycle so forfeited ones never return.
 */
export const getDueProduction = (settledAt: Date, now: Date) => {
  const interval = WAREHOUSE_PRODUCTION_INTERVAL_HOURS * HOUR_S * 1000;
  const elapsed = Math.max(
    0,
    Math.floor((now.getTime() - settledAt.getTime()) / interval),
  );
  return {
    cycles: Math.min(elapsed, WAREHOUSE_PRODUCTION_MAX_CYCLES),
    nextSettledAt: new Date(settledAt.getTime() + elapsed * interval),
    nextCycleAt: new Date(settledAt.getTime() + (elapsed + 1) * interval),
  };
};

/** Village whose items a Warehouse can produce: faction settlements make Syndicate goods. */
export const getProductionVillageId = (village: Pick<Village, "id" | "type">) =>
  isFactionVillage(village) ? VILLAGE_SYNDICATE_ID : village.id;

/** Items players may deposit into, and withdraw from, any Warehouse. */
export const isWarehouseStorable = (
  item: Pick<Item, "warehouseItem" | "canStack" | "itemType">,
) =>
  item.warehouseItem &&
  item.canStack &&
  (WAREHOUSE_ITEM_TYPES as readonly string[]).includes(item.itemType);

/** Items the Kage of this village can select for production. */
export const canProduceItem = (
  item: Pick<Item, "warehouseItem" | "canStack" | "itemType" | "villageId" | "hidden">,
  village: Pick<Village, "id" | "type">,
) =>
  isWarehouseStorable(item) &&
  !item.hidden &&
  item.villageId === getProductionVillageId(village);

/**
 * Stock credited by a deposit. Units the player withdrew earlier return without a bonus;
 * fractional bonuses accumulate in thousandths so splitting deposits never rounds up.
 */
export const getDepositCredit = (
  quantity: number,
  bonusPercent: number,
  ledger: Pick<WarehouseDepositLedger, "withdrawnUnits" | "bonusCarry"> | undefined,
) => {
  const withdrawn = ledger?.withdrawnUnits ?? 0;
  const returned = Math.min(quantity, withdrawn);
  const eligible = quantity - returned;
  const total = (ledger?.bonusCarry ?? 0) + eligible * Math.round(bonusPercent * 10);
  const bonus = Math.floor(total / 1000);
  return {
    bonus,
    credited: quantity + bonus,
    withdrawnUnits: withdrawn - returned,
    bonusCarry: total % 1000,
  };
};

/** When a player may deposit this item again, or null if now. */
export const getDepositAvailableAt = (
  ledger: Pick<WarehouseDepositLedger, "lastDepositAt"> | undefined,
  now = new Date(),
) => {
  if (!ledger?.lastDepositAt) return null;
  const at = secondsFromDate(
    WAREHOUSE_DEPOSIT_COOLDOWN_HOURS * HOUR_S,
    ledger.lastDepositAt,
  );
  return at > now ? at : null;
};

/**
 * Backpack stacks a player can deposit, in inventory order, with the moment each item's
 * deposit cooldown ends.
 */
export const getDepositCandidates = (
  inventory: (Pick<
    UserItem,
    | "id"
    | "itemId"
    | "quantity"
    | "equipped"
    | "storedAtHome"
    | "isInAuction"
    | "craftingFinishedAt"
  > & {
    item: Pick<Item, "name" | "warehouseItem" | "canStack" | "itemType">;
  })[],
  ledgers: Pick<WarehouseDepositLedger, "itemId" | "lastDepositAt">[],
  now = new Date(),
) =>
  inventory
    .filter(
      (row) =>
        isWarehouseStorable(row.item) &&
        isCarriedUserItem(row, now) &&
        row.equipped === "NONE" &&
        row.quantity >= WAREHOUSE_MIN_DEPOSIT,
    )
    .map((row) => ({
      userItemId: row.id,
      itemId: row.itemId,
      name: row.item.name,
      quantity: row.quantity,
      availableAt: getDepositAvailableAt(
        ledgers.find((ledger) => ledger.itemId === row.itemId),
        now,
      ),
    }));

/**
 * A Kage approval counts in the approving village, for approvals given since the player
 * last joined it; wartime approvals also need their war to still be active.
 */
export const isApprovalActive = (
  member:
    | Pick<WarehouseMember, "approvedVillageId" | "approvedAt" | "approvedWarId">
    | undefined,
  user: Pick<UserData, "villageId" | "joinedVillageAt">,
  activeWarIds: string[],
) =>
  !!member?.approvedVillageId &&
  !!member.approvedAt &&
  member.approvedVillageId === user.villageId &&
  member.approvedAt >= new Date(user.joinedVillageAt) &&
  (!member.approvedWarId || activeWarIds.includes(member.approvedWarId));

/** Daily withdrawal allowance and how much of it is left today. */
export const getWithdrawalAllowance = (
  user: Pick<UserData, "villageId" | "joinedVillageAt" | "anbuId" | "isOutlaw">,
  member: WarehouseMember | undefined,
  activeWarIds: string[],
  now = new Date(),
) => {
  const approved = isApprovalActive(member, user, activeWarIds);
  const base = approved
    ? WAREHOUSE_APPROVED_DAILY_ALLOWANCE
    : user.anbuId
      ? WAREHOUSE_ANBU_DAILY_ALLOWANCE
      : WAREHOUSE_DAILY_ALLOWANCE;
  const loyaltyBonus =
    getVillageLoyaltyDays(user, now) >= WAREHOUSE_LOYALTY_DAYS
      ? WAREHOUSE_LOYALTY_BONUS
      : 0;
  const day = getUtcDayKey(now);
  const used = member?.allowanceDay === day ? member.allowanceUsed : 0;
  const total = base + loyaltyBonus;
  return {
    approved,
    base,
    loyaltyBonus,
    total,
    used,
    remaining: Math.max(0, total - used),
    day,
  };
};

/**
 * Why the backpack cannot take granted goods, judged from the inventory read for the grant:
 * a full inventory bucket takes an item only when, outside a battle, the stacks it may top
 * up hold all of it.
 */
export const getBackpackBlock = (
  user: UserData,
  inventory: (InventorySlotRow & Pick<UserItem, "durability">)[],
  grants: { item: BackpackItem; quantity: number }[],
  now = new Date(),
) => {
  const totals = new Map<string, { item: BackpackItem; quantity: number }>();
  for (const { item, quantity } of grants) {
    const total = totals.get(item.id)?.quantity ?? 0;
    totals.set(item.id, { item, quantity: total + quantity });
  }
  for (const { item, quantity } of totals.values()) {
    const bucket = getInventoryBucket(item);
    const isFull =
      countInventoryBucketSlots(inventory, bucket, now) >=
      getInventoryBucketCapacity(bucket, user);
    const room = user.battleId ? 0 : getJoinableStackRoom(inventory, item.id, now);
    if (isFull && room < quantity)
      return getInventoryBucketFullMessage(
        bucket,
        countHeldInventorySlots(inventory, bucket, now),
      );
  }
  return undefined;
};

/** A Warehouse bonus in percent, to one decimal, for its per-level rate. */
const getLevelBonus = (perLevel: number, level: number, raidMultiplier: number) =>
  Math.round(Math.max(0, level) * perLevel * raidMultiplier * 10) / 10;

/** An item a grant adds to the backpack, with the fields that choose its bucket. */
type BackpackItem = { id: string } & Parameters<typeof getInventoryBucket>[0];
