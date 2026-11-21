import { z } from "zod";
import {
  WAREHOUSE_DEPOSIT_COOLDOWN_HOURS,
  WAREHOUSE_HISTORY_PAGE_SIZE,
  WAREHOUSE_MAX_PRODUCTION_ITEMS,
  WAREHOUSE_MIN_DEPOSIT,
} from "@/drizzle/constants";
import type { UserData, Village } from "@/drizzle/schema";
import {
  countInventoryBucketSlots,
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
  isCarriedUserItem,
} from "@/libs/item";
import { countHeldInventorySlots } from "@/libs/itemsPage";
import { isFactionVillage } from "@/libs/war";
import {
  canProduceItem,
  findWarehouse,
  getCycleQuantity,
  getDepositAvailableAt,
  getDepositBonus,
  getDepositCredit,
  getDueProduction,
  getProductionBonus,
  getProductionVillageId,
  getWarehouseLevel,
  getWithdrawalAllowance,
  isWarehouseStorable,
} from "@/libs/warehouse";
import { fetchClan } from "@/queries/clan";
import { fetchUser } from "@/queries/profile";
import { fetchVillage } from "@/queries/village";
import {
  addWithdrawnUnits,
  approveWarehouseMember,
  claimDepositLedger,
  claimWithdrawal,
  creditWarehouseStock,
  ensureDepositLedger,
  ensureWarehouseMember,
  ensureWarehouseStock,
  findWarehouseMember,
  insertWarehouseLogs,
  listDepositLedgers,
  listOpenWars,
  listProducibleItems,
  listWarehouseApprovals,
  listWarehouseItems,
  listWarehouseLogs,
  listWarehouseStock,
  resetWarehouseAllowanceDay,
  revokeWarehouseMember,
  updateWarehouseProduction,
} from "@/queries/warehouse";
import { fetchUserItems } from "@/server/api/routers/item";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { updateUserItemQuantityAtomically } from "@/server/utils/concurrency";
import { grantUserItems } from "@/server/utils/itemGrants";
import { isServingElder } from "@/server/utils/kageGovernance";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { settleProduction, WarehouseConflict } from "@/server/utils/warehouse";
import { calcStructureUpgrade, getRaidStructureMultiplier } from "@/utils/village";

export const warehouseRouter = createTRPCRouter({
  getWarehouse: protectedProcedure
    .meta({ mcp: { description: "Get your village Warehouse stock and allowance" } })
    .query(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!user.villageId) return null;
      const [villageData, member, ledgers, wars, inventory] = await Promise.all([
        fetchVillage(ctx.drizzle, user.villageId),
        findWarehouseMember(ctx.drizzle, ctx.userId),
        listDepositLedgers(ctx.drizzle, ctx.userId),
        listOpenWars(ctx.drizzle),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      if (!villageData) return null;
      const now = new Date();
      const structure = findWarehouse(villageData.structures);
      const isLeader = villageData.kageId === user.userId;
      const settings = await settleProduction(
        ctx.drizzle,
        villageData.id,
        structure,
        now,
      );
      const isFaction = isFactionVillage(villageData);
      const [stock, producible, approvals, selected, clanData] = await Promise.all([
        listWarehouseStock(ctx.drizzle, villageData.id),
        isLeader
          ? listProducibleItems(ctx.drizzle, getProductionVillageId(villageData))
          : Promise.resolve([]),
        isLeader
          ? listWarehouseApprovals(ctx.drizzle, villageData.id)
          : Promise.resolve([]),
        listWarehouseItems(ctx.drizzle, settings.productionItemIds),
        isFaction && user.clanId ? fetchClan(ctx.drizzle, user.clanId) : undefined,
      ]);
      const level = getWarehouseLevel(structure, now);
      const multiplier = structure ? getRaidStructureMultiplier(structure, now) : 1;
      const villageWars = wars.filter(
        (war) =>
          war.attackerVillageId === villageData.id ||
          war.defenderVillageId === villageData.id,
      );
      const activeWarIds = villageWars.map((war) => war.id);
      const allowance = getWithdrawalAllowance(user, member, activeWarIds, now);
      const ledgerByItem = new Map(ledgers.map((ledger) => [ledger.itemId, ledger]));
      const nextCycleAt = getDueProduction(
        settings.productionSettledAt,
        now,
      ).nextCycleAt;
      const cost = structure
        ? calcStructureUpgrade(structure, villageData).total
        : null;
      return {
        village: {
          id: villageData.id,
          name: villageData.name,
          type: villageData.type,
          tokens: villageData.tokens,
          structureMaintenanceDue: villageData.structureMaintenanceDue,
          usesClanPoints: isFaction,
          // Faction settlements build and upgrade with their clan's points.
          funds: isFaction ? (clanData?.points ?? 0) : villageData.tokens,
        },
        structure: structure
          ? {
              id: structure.id,
              level: structure.level,
              maxLevel: structure.maxLevel,
              effectiveLevel: level,
              raidBoosted: multiplier > 1,
              nextCost: structure.level < structure.maxLevel ? cost : null,
            }
          : null,
        isLeader,
        canManageTrade: isLeader || isServingElder(user, villageData.id),
        productionBonus: getProductionBonus(level, multiplier),
        depositBonus: getDepositBonus(level, multiplier),
        cycleQuantity: getCycleQuantity(level, multiplier),
        nextCycleAt,
        production: settings.productionItemIds.flatMap((itemId) => {
          const info = selected.find((row) => row.id === itemId);
          return info ? [{ itemId, name: info.name }] : [];
        }),
        producibleItems: producible
          .filter((row) => canProduceItem(row, villageData))
          .map((row) => ({ id: row.id, name: row.name, image: row.image })),
        stock,
        allowance,
        depositCandidates: inventory
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
            image: row.item.image,
            quantity: row.quantity,
            availableAt: getDepositAvailableAt(ledgerByItem.get(row.itemId), now),
          })),
        approvals: approvals.map((row) => ({
          userId: row.userId,
          username: row.username,
          avatar: row.avatar,
          rank: row.rank,
          wartime: !!row.approvedWarId,
          active:
            !!row.approvedAt &&
            row.approvedAt >= new Date(row.joinedVillageAt) &&
            (!row.approvedWarId || activeWarIds.includes(row.approvedWarId)),
        })),
        activeWarIds: isLeader ? activeWarIds : [],
      };
    }),
  getHistory: protectedProcedure
    .meta({ mcp: { description: "Page through your village Warehouse history" } })
    .input(
      z.object({
        cursor: z.object({ createdAt: z.date(), id: z.string() }).nullish(),
        limit: z.number().int().min(1).max(50).default(WAREHOUSE_HISTORY_PAGE_SIZE),
      }),
    )
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!user.villageId) return { data: [], nextCursor: null };
      const rows = await listWarehouseLogs(
        ctx.drizzle,
        user.villageId,
        input.limit,
        input.cursor ?? undefined,
      );
      const data = rows.slice(0, input.limit);
      const last = data[data.length - 1];
      return {
        data,
        nextCursor:
          rows.length > input.limit && last
            ? { createdAt: last.createdAt, id: last.id }
            : null,
      };
    }),
  deposit: protectedProcedure
    .meta({ mcp: { description: "Deposit a stack of materials into the Warehouse" } })
    .input(
      z.object({
        userItemId: z.string(),
        quantity: z.number().int().min(WAREHOUSE_MIN_DEPOSIT),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const [villageData, inventory] = await Promise.all([
        user.villageId ? fetchVillage(ctx.drizzle, user.villageId) : undefined,
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      const stack = inventory.find((row) => row.id === input.userItemId);
      const ledger = stack
        ? (await listDepositLedgers(ctx.drizzle, ctx.userId, [stack.itemId]))[0]
        : undefined;
      const now = new Date();
      const structure = findWarehouse(villageData?.structures);
      const accessError = warehouseAccessError(user, villageData, structure);
      if (accessError) return errorResponse(accessError);
      if (!villageData || !structure) return errorResponse("Warehouse not found");
      if (!stack) return errorResponse("Select a stack from your backpack");
      if (!isWarehouseStorable(stack.item))
        return errorResponse("The Warehouse does not accept this item");
      if (!isCarriedUserItem(stack, now) || stack.equipped !== "NONE")
        return errorResponse("Unequip the stack and take it out of storage or auction");
      if (input.quantity > stack.quantity)
        return errorResponse("You do not have that many");
      const availableAt = getDepositAvailableAt(ledger, now);
      if (availableAt)
        return errorResponse(
          `You can deposit ${stack.item.name} again in ${Math.ceil((availableAt.getTime() - now.getTime()) / 60_000)} minutes`,
        );
      const level = getWarehouseLevel(structure, now);
      const credit = getDepositCredit(
        input.quantity,
        getDepositBonus(level, getRaidStructureMultiplier(structure, now)),
        ledger,
      );
      const conflict = new WarehouseConflict(
        "Your stack or deposit cooldown changed. Refresh and try again",
      );
      try {
        // Consuming the stack (an update or a delete), claiming the per-item cooldown and
        // crediting shared stock touch three rows that no single guarded statement can
        // write together; the transaction keeps the donation from vanishing or doubling.
        await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            await ensureDepositLedger(tx, ctx.userId, stack.itemId);
            const claimed = await claimDepositLedger(tx, {
              userId: ctx.userId,
              itemId: stack.itemId,
              cooldownStart: new Date(
                now.getTime() - WAREHOUSE_DEPOSIT_COOLDOWN_HOURS * 3_600_000,
              ),
              now,
              expected: {
                withdrawnUnits: ledger?.withdrawnUnits ?? 0,
                bonusCarry: ledger?.bonusCarry ?? 0,
              },
              next: {
                withdrawnUnits: credit.withdrawnUnits,
                bonusCarry: credit.bonusCarry,
              },
            });
            if (claimed.rowsAffected !== 1) throw conflict;
            const consumed = await updateUserItemQuantityAtomically({
              client: tx,
              userId: ctx.userId,
              userItemId: stack.id,
              expectedQuantity: stack.quantity,
              nextQuantity: stack.quantity - input.quantity,
            });
            if (!consumed) throw conflict;
            await creditWarehouseStock(
              tx,
              villageData.id,
              stack.itemId,
              credit.credited,
            );
            await insertWarehouseLogs(
              tx,
              [
                {
                  villageId: villageData.id,
                  userId: ctx.userId,
                  itemId: stack.itemId,
                  type: "DEPOSIT",
                  quantity: credit.credited,
                },
              ],
              now,
            );
          }),
        );
      } catch (error) {
        if (error instanceof WarehouseConflict) return errorResponse(error.message);
        throw error;
      }
      return {
        success: true,
        message: credit.bonus
          ? `Deposited ${input.quantity} ${stack.item.name}; the Warehouse added ${credit.bonus} bonus`
          : `Deposited ${input.quantity} ${stack.item.name}`,
      };
    }),
  withdraw: protectedProcedure
    .meta({ mcp: { description: "Withdraw materials from the Warehouse" } })
    .input(z.object({ itemId: z.string(), quantity: z.number().int().min(1) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const [villageData, member, wars, inventory, [info]] = await Promise.all([
        user.villageId ? fetchVillage(ctx.drizzle, user.villageId) : undefined,
        findWarehouseMember(ctx.drizzle, ctx.userId),
        listOpenWars(ctx.drizzle),
        fetchUserItems(ctx.drizzle, ctx.userId),
        listWarehouseItems(ctx.drizzle, [input.itemId]),
      ]);
      const now = new Date();
      const structure = findWarehouse(villageData?.structures);
      const accessError = warehouseAccessError(user, villageData, structure);
      if (accessError) return errorResponse(accessError);
      if (!villageData) return errorResponse("Warehouse not found");
      if (!info || !isWarehouseStorable(info))
        return errorResponse("The Warehouse does not hold this item");
      const activeWarIds = wars
        .filter(
          (war) =>
            war.attackerVillageId === villageData.id ||
            war.defenderVillageId === villageData.id,
        )
        .map((war) => war.id);
      const allowance = getWithdrawalAllowance(user, member, activeWarIds, now);
      if (input.quantity > allowance.remaining)
        return errorResponse(
          `You can withdraw ${allowance.remaining} more units today (UTC)`,
        );
      const bucket = getInventoryBucket(info);
      const topUpOnly =
        countInventoryBucketSlots(inventory, bucket) >=
        getInventoryBucketCapacity(bucket, user);
      const fullBackpack = new WarehouseConflict(
        getInventoryBucketFullMessage(
          bucket,
          countHeldInventorySlots(inventory, bucket),
        ),
      );
      const conflict = new WarehouseConflict(
        "Not enough unreserved stock, or your allowance changed. Refresh and try again",
      );
      try {
        // Taking stock and charging the allowance is one guarded update, but delivering it
        // inserts or tops up backpack stacks; the transaction undoes the claim when the
        // backpack has no room, so stock never leaves the Warehouse without arriving.
        await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            await ensureWarehouseMember(tx, ctx.userId);
            await resetWarehouseAllowanceDay(tx, ctx.userId, allowance.day);
            const claimed = await claimWithdrawal(tx, {
              villageId: villageData.id,
              itemId: input.itemId,
              userId: ctx.userId,
              quantity: input.quantity,
              day: allowance.day,
              allowance: allowance.total,
            });
            if (claimed.rowsAffected === 0) throw conflict;
            const { unstacked } = await grantUserItems(
              tx,
              ctx.userId,
              [{ itemId: input.itemId, quantity: input.quantity }],
              { topUpOnly },
            );
            if (topUpOnly && unstacked.length > 0) throw fullBackpack;
            await addWithdrawnUnits(tx, ctx.userId, input.itemId, input.quantity);
            await insertWarehouseLogs(
              tx,
              [
                {
                  villageId: villageData.id,
                  userId: ctx.userId,
                  itemId: input.itemId,
                  type: "WITHDRAW",
                  quantity: input.quantity,
                },
              ],
              now,
            );
          }),
        );
      } catch (error) {
        if (error instanceof WarehouseConflict) return errorResponse(error.message);
        throw error;
      }
      return { success: true, message: `Withdrew ${input.quantity} ${info.name}` };
    }),
  setProduction: protectedProcedure
    .meta({ mcp: { description: "Choose the items your Warehouse produces, as Kage" } })
    .input(
      z.object({
        itemIds: z.array(z.string()).max(WAREHOUSE_MAX_PRODUCTION_ITEMS),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const villageData = user.villageId
        ? await fetchVillage(ctx.drizzle, user.villageId)
        : undefined;
      const structure = findWarehouse(villageData?.structures);
      if (!villageData || !structure) return errorResponse("Warehouse not found");
      if (villageData.kageId !== user.userId)
        return errorResponse("Only the leader chooses production");
      if (structure.level <= 0) return errorResponse("Construct the Warehouse first");
      const itemIds = [...new Set(input.itemIds)];
      const [items, settings] = await Promise.all([
        listWarehouseItems(ctx.drizzle, itemIds),
        settleProduction(ctx.drizzle, villageData.id, structure),
      ]);
      if (
        items.length !== itemIds.length ||
        items.some((row) => !canProduceItem(row, villageData))
      )
        return errorResponse("Select Warehouse items that belong to your village");
      await ensureWarehouseStock(ctx.drizzle, villageData.id, itemIds);
      const result = await updateWarehouseProduction(
        ctx.drizzle,
        villageData.id,
        itemIds,
        settings.updatedAt,
        new Date(),
      );
      if (result.rowsAffected !== 1)
        return errorResponse("Production changed meanwhile. Refresh and try again");
      return { success: true, message: "Production updated" };
    }),
  setApproval: protectedProcedure
    .meta({
      mcp: { description: "Grant or revoke increased Warehouse access, as Kage" },
    })
    .input(
      z.object({
        userId: z.string(),
        approve: z.boolean(),
        wartime: z.boolean().default(false),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, target, wars] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        listOpenWars(ctx.drizzle),
      ]);
      if (!user.villageId) return errorResponse("You have no village");
      const villageData = await fetchVillage(ctx.drizzle, user.villageId);
      if (!villageData || villageData.kageId !== user.userId)
        return errorResponse("Only the leader manages Warehouse access");
      if (target.villageId !== villageData.id || target.isAi)
        return errorResponse("Approve members of your own village");
      if (!input.approve) {
        await revokeWarehouseMember(ctx.drizzle, target.userId, villageData.id);
        return { success: true, message: `${target.username} lost increased access` };
      }
      const war = wars.find(
        (row) =>
          row.attackerVillageId === villageData.id ||
          row.defenderVillageId === villageData.id,
      );
      if (input.wartime && !war)
        return errorResponse("Wartime access requires an active war");
      if (!input.wartime && target.rank === "ELDER")
        return errorResponse("Elders receive increased access only during wartime");
      await approveWarehouseMember(ctx.drizzle, {
        userId: target.userId,
        villageId: villageData.id,
        approvedById: user.userId,
        warId: input.wartime && war ? war.id : null,
        now: new Date(),
      });
      return {
        success: true,
        message: input.wartime
          ? `${target.username} has increased access until the war ends`
          : `${target.username} has increased access`,
      };
    }),
});

/** Why a player cannot use their village's Warehouse right now, if they cannot. */
const warehouseAccessError = (
  user: UserData,
  villageData: Pick<Village, "id" | "type" | "sector"> | undefined,
  structure: { level: number } | undefined,
) => {
  if (user.isBanned) return "You are banned";
  if (!villageData || !structure) return "Your village has no Warehouse";
  if (structure.level <= 0) return "Your village has not constructed its Warehouse";
  if (villageData.type !== "OUTLAW" && user.sector !== villageData.sector)
    return "Travel to your village to use its Warehouse";
  return null;
};
