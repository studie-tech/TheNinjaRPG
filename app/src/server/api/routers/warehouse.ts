import * as Sentry from "@sentry/nextjs";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getApprovalWarehouseChange,
  getDepositInventoryChanges,
  getDepositWarehouseChange,
  getProductionWarehouseChange,
  getWarehouseLogEntries,
  getWithdrawWarehouseChange,
} from "@/deltas/warehouse";
import {
  WAREHOUSE_DEPOSIT_COOLDOWN_HOURS,
  WAREHOUSE_HISTORY_PAGE_SIZE,
  WAREHOUSE_MAX_PRODUCTION_ITEMS,
  WAREHOUSE_MIN_DEPOSIT,
} from "@/drizzle/constants";
import type { UserData, Village } from "@/drizzle/schema";
import { isCarriedUserItem } from "@/libs/item";
import { isFactionVillage } from "@/libs/war";
import {
  canProduceItem,
  findWarehouse,
  getBackpackBlock,
  getCycleQuantity,
  getDepositAvailableAt,
  getDepositBonus,
  getDepositCandidates,
  getDepositCredit,
  getDueProduction,
  getProductionBonus,
  getProductionVillageId,
  getWarehouseLevel,
  getWithdrawalAllowance,
  isApprovalActive,
  isWarehouseStorable,
} from "@/libs/warehouse";
import { fetchClan } from "@/queries/clan";
import { deleteEmptyUserItem } from "@/queries/item";
import { fetchUser } from "@/queries/profile";
import { fetchVillage } from "@/queries/village";
import {
  addWithdrawnUnits,
  approveWarehouseMember,
  claimWithdrawal,
  depositFromStack,
  ensureDepositLedger,
  ensureWarehouseStock,
  findVillageWarehouse,
  findWarehouseMember,
  insertWarehouseLogs,
  listDepositLedgers,
  listOpenWars,
  listProducibleItems,
  listWarehouseApprovals,
  listWarehouseItems,
  listWarehouseLogs,
  listWarehouseStock,
  revokeWarehouseMember,
  startWarehouseAllowanceDay,
  updateWarehouseProduction,
} from "@/queries/warehouse";
import { fetchUserItems } from "@/server/api/routers/item";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { grantUserItems } from "@/server/utils/itemGrants";
import { depositStackWhere, settleProduction } from "@/server/utils/warehouse";
import { HOUR_S, secondsFromDate } from "@/utils/time";
import { calcStructureUpgrade, getRaidStructureMultiplier } from "@/utils/village";
import { warehouseResponseSchema } from "@/validators/warehouse";

export const warehouseRouter = createTRPCRouter({
  getWarehouse: protectedProcedure
    .meta({ mcp: { description: "Get your village Warehouse stock and allowance" } })
    .query(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!user.villageId) return null;
      const villageId = user.villageId;
      // Leader and faction reads follow the village read without waiting for the others.
      const village = fetchVillage(ctx.drizzle, villageId);
      const [
        villageData,
        member,
        ledgers,
        wars,
        inventory,
        current,
        stocked,
        [producible, approvals, clanData],
      ] = await Promise.all([
        village,
        findWarehouseMember(ctx.drizzle, ctx.userId),
        listDepositLedgers(ctx.drizzle, ctx.userId),
        listOpenWars(ctx.drizzle),
        fetchUserItems(ctx.drizzle, ctx.userId),
        findVillageWarehouse(ctx.drizzle, villageId),
        listWarehouseStock(ctx.drizzle, villageId),
        village.then((row) => {
          const leads = !!row && row.kageId === user.userId;
          return Promise.all([
            row && leads
              ? listProducibleItems(ctx.drizzle, getProductionVillageId(row))
              : [],
            leads ? listWarehouseApprovals(ctx.drizzle, villageId) : [],
            row && isFactionVillage(row) && user.clanId
              ? fetchClan(ctx.drizzle, user.clanId)
              : undefined,
          ]);
        }),
      ]);
      if (!villageData) return null;
      const now = new Date();
      const structure = findWarehouse(villageData.structures);
      const isLeader = villageData.kageId === user.userId;
      const isFaction = isFactionVillage(villageData);
      const settings = await settleProduction(
        ctx.drizzle,
        villageData.id,
        structure,
        now,
        current,
      );
      // Settled production may have credited stock, here or in a competing reader, and a
      // selection saved after the stock read adds rows that read has not seen.
      const stock =
        settings.settled ||
        settings.productionItemIds.some(
          (id) => !stocked.some((row) => row.itemId === id),
        )
          ? await listWarehouseStock(ctx.drizzle, villageData.id)
          : stocked;
      const level = getWarehouseLevel(structure, now);
      const multiplier = structure ? getRaidStructureMultiplier(structure, now) : 1;
      const activeWarIds = getVillageWars(wars, villageData.id).map((war) => war.id);
      const allowance = getWithdrawalAllowance(user, member, activeWarIds, now);
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
          structureMaintenanceDue: villageData.structureMaintenanceDue,
          usesClanPoints: isFaction,
          // Faction settlements build and upgrade with their clan's points.
          funds: isFaction ? (clanData?.points ?? 0) : villageData.tokens,
        },
        structure: structure
          ? {
              id: structure.id,
              image: structure.image,
              level: structure.level,
              maxLevel: structure.maxLevel,
              effectiveLevel: level,
              raidBoosted: multiplier > 1,
              nextCost: structure.level < structure.maxLevel ? cost : null,
            }
          : null,
        isLeader,
        productionBonus: getProductionBonus(level, multiplier),
        depositBonus: getDepositBonus(level, multiplier),
        cycleQuantity: getCycleQuantity(level, multiplier),
        nextCycleAt,
        // Production items always have a stock row, which carries their name.
        production: settings.productionItemIds.flatMap((itemId) => {
          const info = stock.find((row) => row.itemId === itemId);
          return info ? [{ itemId, name: info.name }] : [];
        }),
        producibleItems: producible
          .filter((row) => canProduceItem(row, villageData))
          .map((row) => ({ id: row.id, name: row.name, image: row.image })),
        stock,
        allowance,
        depositCandidates: getDepositCandidates(inventory, ledgers, now),
        approvals: approvals.map((row) => ({
          userId: row.userId,
          username: row.username,
          wartime: !!row.approvedWarId,
          active: isApprovalActive(row, row, activeWarIds),
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
    .output(warehouseResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const [villageData, inventory, ledgers] = await Promise.all([
        user.villageId ? fetchVillage(ctx.drizzle, user.villageId) : undefined,
        fetchUserItems(ctx.drizzle, ctx.userId),
        listDepositLedgers(ctx.drizzle, ctx.userId),
      ]);
      const stack = inventory.find((row) => row.id === input.userItemId);
      const ledger = ledgers.find((row) => row.itemId === stack?.itemId);
      const now = new Date();
      const structure = findWarehouse(villageData?.structures);
      const accessError = warehouseAccessError(user, villageData, structure);
      if (accessError) return errorResponse(accessError);
      if (!villageData || !structure) return errorResponse("Warehouse not found");
      if (!stack) return errorResponse("Select a stack from your backpack");
      if (!isWarehouseStorable(stack.item))
        return errorResponse("The Warehouse does not accept this item");
      if (user.battleId) return errorResponse("Finish your battle first");
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
      const log = {
        id: nanoid(),
        villageId: villageData.id,
        userId: ctx.userId,
        itemId: stack.itemId,
        type: "DEPOSIT" as const,
        quantity: credit.credited,
      };
      const remaining = stack.quantity - input.quantity;
      await Promise.all([
        ledger ? undefined : ensureDepositLedger(ctx.drizzle, ctx.userId, stack.itemId),
        ensureWarehouseStock(ctx.drizzle, villageData.id, [stack.itemId]),
      ]);
      const deposited = await depositFromStack(ctx.drizzle, {
        userId: ctx.userId,
        itemId: stack.itemId,
        cooldownStart: secondsFromDate(-WAREHOUSE_DEPOSIT_COOLDOWN_HOURS * HOUR_S, now),
        now,
        expected: {
          withdrawnUnits: ledger?.withdrawnUnits ?? 0,
          bonusCarry: ledger?.bonusCarry ?? 0,
        },
        next: { withdrawnUnits: credit.withdrawnUnits, bonusCarry: credit.bonusCarry },
        villageId: villageData.id,
        credited: credit.credited,
        userItemId: stack.id,
        nextQuantity: remaining,
        stackWhere: depositStackWhere({
          userId: ctx.userId,
          userItemId: stack.id,
          expectedQuantity: stack.quantity,
          now,
        }),
      });
      if (deposited.rowsAffected === 0)
        return errorResponse(
          "Your stack or deposit cooldown changed. Refresh and try again",
        );
      await Promise.all([
        // History follows the deposit: a failure here costs only a log row support can add.
        insertWarehouseLogs(ctx.drizzle, [log], now),
        remaining === 0
          ? deleteEmptyUserItem(ctx.drizzle, stack.id, ctx.userId).catch(
              (error: unknown) => {
                // The deposit already committed; inventory reads hide zero stacks and reclaim
                // stale ones, so report success rather than invite a repeat.
                Sentry.captureException(error, {
                  level: "warning",
                  tags: { source: "warehouseDeposit" },
                });
              },
            )
          : undefined,
      ]);
      return {
        success: true,
        message: credit.bonus
          ? `Deposited ${input.quantity} ${stack.item.name}; the Warehouse added ${credit.bonus} bonus`
          : `Deposited ${input.quantity} ${stack.item.name}`,
        warehouseChange: getDepositWarehouseChange({
          stack,
          quantity: input.quantity,
          credited: credit.credited,
          inventory,
          ledgers,
          now,
        }),
        warehouseLogs: getWarehouseLogEntries(
          [log],
          {
            items: new Map([[stack.itemId, stack.item.name]]),
            username: user.username,
          },
          now,
        ),
        inventoryChanges: getDepositInventoryChanges(stack, input.quantity),
      };
    }),
  withdraw: protectedProcedure
    .meta({ mcp: { description: "Withdraw materials from the Warehouse" } })
    .input(z.object({ itemId: z.string(), quantity: z.number().int().min(1) }))
    .output(warehouseResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Deposit cooldowns describe the stacks a withdrawal opens in the confirmed view.
      const [villageData, member, wars, inventory, [info], ledgers] = await Promise.all(
        [
          user.villageId ? fetchVillage(ctx.drizzle, user.villageId) : undefined,
          findWarehouseMember(ctx.drizzle, ctx.userId),
          listOpenWars(ctx.drizzle),
          fetchUserItems(ctx.drizzle, ctx.userId),
          listWarehouseItems(ctx.drizzle, [input.itemId]),
          listDepositLedgers(ctx.drizzle, ctx.userId),
        ],
      );
      const now = new Date();
      const structure = findWarehouse(villageData?.structures);
      const accessError = warehouseAccessError(user, villageData, structure);
      if (accessError) return errorResponse(accessError);
      if (!villageData) return errorResponse("Warehouse not found");
      if (!info || info.hidden || !isWarehouseStorable(info))
        return errorResponse("The Warehouse does not hold this item");
      const activeWarIds = getVillageWars(wars, villageData.id).map((war) => war.id);
      const allowance = getWithdrawalAllowance(user, member, activeWarIds, now);
      if (input.quantity > allowance.remaining)
        return errorResponse(
          `You can withdraw ${allowance.remaining} more units today (UTC)`,
        );
      const fullBackpack = getBackpackBlock(
        user,
        inventory,
        [{ item: info, quantity: input.quantity }],
        now,
      );
      if (fullBackpack) return errorResponse(fullBackpack);
      if (member?.allowanceDay !== allowance.day)
        await startWarehouseAllowanceDay(ctx.drizzle, ctx.userId, allowance.day);
      // One guarded statement takes the stock and charges the allowance before delivery, so
      // a retry or race never delivers twice. A backpack the player filled since the check
      // above takes the goods on a new stack past its capacity, which they can clear.
      const claimed = await claimWithdrawal(ctx.drizzle, {
        villageId: villageData.id,
        itemId: input.itemId,
        userId: ctx.userId,
        quantity: input.quantity,
        day: allowance.day,
        allowance: allowance.total,
        approvedAt: allowance.approved ? (member?.approvedAt ?? null) : null,
      });
      if (claimed.rowsAffected === 0)
        return errorResponse(
          "Not enough unreserved stock, or your allowance changed. Refresh and try again",
        );
      const log = {
        id: nanoid(),
        villageId: villageData.id,
        userId: ctx.userId,
        itemId: input.itemId,
        type: "WITHDRAW" as const,
        quantity: input.quantity,
      };
      // A grant that fails after this leaves the WITHDRAW row support restores the goods from.
      await Promise.all([
        addWithdrawnUnits(ctx.drizzle, ctx.userId, input.itemId, input.quantity),
        insertWarehouseLogs(ctx.drizzle, [log], now),
      ]);
      const { stacks } = await grantUserItems(ctx.drizzle, ctx.userId, [
        { itemId: input.itemId, quantity: input.quantity },
      ]);
      // Filled stacks change their snapshot time in SQL, so the inventory reloads.
      return {
        success: true,
        message: `Withdrew ${input.quantity} ${info.name}`,
        warehouseChange: getWithdrawWarehouseChange({
          item: info,
          quantity: input.quantity,
          inventory,
          stacks,
          ledgers,
          now,
        }),
        warehouseLogs: getWarehouseLogEntries(
          [log],
          { items: new Map([[info.id, info.name]]), username: user.username },
          now,
        ),
      };
    }),
  setProduction: protectedProcedure
    .meta({ mcp: { description: "Choose the items your Warehouse produces, as Kage" } })
    .input(
      z.object({
        itemIds: z.array(z.string()).max(WAREHOUSE_MAX_PRODUCTION_ITEMS),
      }),
    )
    .output(warehouseResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned) return errorResponse("You are banned");
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
      return {
        success: true,
        message: "Production updated",
        // Production settled in this request credited stock the view has not seen.
        warehouseChange: settings.settled
          ? undefined
          : getProductionWarehouseChange(
              itemIds.flatMap((id) => items.filter((row) => row.id === id)),
            ),
      };
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
    .output(warehouseResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, target, wars] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        listOpenWars(ctx.drizzle),
      ]);
      if (user.isBanned) return errorResponse("You are banned");
      if (!user.villageId) return errorResponse("You have no village");
      const villageData = await fetchVillage(ctx.drizzle, user.villageId);
      if (!villageData || villageData.kageId !== user.userId)
        return errorResponse("Only the leader manages Warehouse access");
      if (target.villageId !== villageData.id || target.isAi)
        return errorResponse("Approve members of your own village");
      if (!input.approve) {
        await revokeWarehouseMember(ctx.drizzle, target.userId, villageData.id);
        return {
          success: true,
          message: `${target.username} lost increased access`,
          warehouseChange: getApprovalWarehouseChange(user.userId, target, null),
        };
      }
      const [war] = getVillageWars(wars, villageData.id);
      if (input.wartime && !war)
        return errorResponse("Wartime access requires an active war");
      if (!input.wartime && target.rank === "ELDER")
        return errorResponse("Elders receive increased access only during wartime");
      await approveWarehouseMember(ctx.drizzle, {
        userId: target.userId,
        villageId: villageData.id,
        warId: input.wartime && war ? war.id : null,
        now: new Date(),
      });
      return {
        success: true,
        message: input.wartime
          ? `${target.username} has increased access until the war ends`
          : `${target.username} has increased access`,
        warehouseChange: getApprovalWarehouseChange(user.userId, target, {
          wartime: input.wartime,
        }),
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

/** Open wars a village fights in, on either side. */
const getVillageWars = (
  wars: Awaited<ReturnType<typeof listOpenWars>>,
  villageId: string,
) =>
  wars.filter(
    (war) => war.attackerVillageId === villageId || war.defenderVillageId === villageId,
  );
