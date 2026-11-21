import { nanoid } from "nanoid";
import { z } from "zod";
import { getEscortStatusUserUpdate } from "@/deltas/caravan";
import {
  CARAVAN_DEFAULT_ENCOUNTER_RATE,
  CARAVAN_ENCOUNTER_RATE_SETTING,
  CARAVAN_GUARD_SLOTS,
  CARAVAN_MAX_CARGO_ITEMS,
  CARAVAN_MAX_CARGO_UNITS,
  CARAVAN_MIN_CARGO_UNITS,
  CARAVANS_PER_TRADE_ROUTE,
} from "@/drizzle/constants";
import type { VillageAlliance } from "@/drizzle/schema";
import {
  type CargoLine,
  getCaravanSector,
  getJourneyProgress,
  getReachedCheckpoints,
  getRemainingCargo,
  getRouteTravelMinutes,
  getTradeBlock,
} from "@/libs/caravan";
import { updateGameSetting } from "@/libs/gamesettings";
import { findWarehouse, isWarehouseStorable } from "@/libs/warehouse";
import {
  checkInGuard,
  deleteGuard,
  dispatchCargo,
  findCaravan,
  insertCaravanWithinCapacity,
  insertGuard,
  listActiveSabotage,
  listCaravanParticipants,
  listFinishedVillageCaravans,
  listOpenEncounters,
  listOpenVillageCaravans,
  listUserParticipations,
  queueGuard,
  reserveCargo,
  resolveOperation,
  transitionCaravan,
  wakeReleasedGuards,
} from "@/queries/caravan";
import { findGameSettingByName } from "@/queries/gamesettings";
import { fetchUser } from "@/queries/profile";
import {
  findTradeRoute,
  listVillageRelationships,
  listVillageRoutes,
} from "@/queries/tradeRoute";
import { fetchVillage } from "@/queries/village";
import {
  insertWarehouseLogs,
  listOpenWars,
  listWarehouseItems,
} from "@/queries/warehouse";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import {
  cancelCaravan,
  canManageTrade,
  isAtWar,
  maintainCaravans,
  notifyPlayers,
} from "@/server/utils/caravan";
import {
  launchCaravanBattle,
  pickCaravanAi,
  selectQueuedGuards,
} from "@/server/utils/caravanBattle";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { canChangeContent } from "@/utils/permissions";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const caravanRouter = createTRPCRouter({
  getEncounterRate: protectedProcedure
    .meta({
      mcp: { description: "Chance of an NPC bandit ambush per caravan checkpoint" },
    })
    .query(async ({ ctx }) => {
      const setting = await findGameSettingByName(
        ctx.drizzle,
        CARAVAN_ENCOUNTER_RATE_SETTING,
      );
      return { rate: setting ? setting.value : CARAVAN_DEFAULT_ENCOUNTER_RATE };
    }),
  setEncounterRate: protectedProcedure
    .meta({ mcp: { description: "Set the caravan ambush chance, as content staff" } })
    .input(z.object({ rate: z.number().int().min(0).max(100) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      await updateGameSetting(
        ctx.drizzle,
        CARAVAN_ENCOUNTER_RATE_SETTING,
        input.rate,
        new Date(),
      );
      return { success: true, message: `Caravan ambush chance set to ${input.rate}%` };
    }),
  getCaravans: protectedProcedure
    .meta({ mcp: { description: "List your village's caravans and escort duty" } })
    .query(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!user.villageId) return null;
      const now = new Date();
      const [villageData, open] = await Promise.all([
        fetchVillage(ctx.drizzle, user.villageId),
        listOpenVillageCaravans(ctx.drizzle, user.villageId),
      ]);
      if (!villageData) return null;
      await maintainCaravans(ctx.drizzle, now, {
        caravanIds: open.map((row) => row.id),
      });
      const [current, history, routes] = await Promise.all([
        listOpenVillageCaravans(ctx.drizzle, villageData.id),
        listFinishedVillageCaravans(ctx.drizzle, villageData.id, 10),
        listVillageRoutes(ctx.drizzle, villageData.id),
      ]);
      const ids = current.map((row) => row.id);
      const [participants, encounters, sabotage, items] = await Promise.all([
        listCaravanParticipants(ctx.drizzle, ids),
        listOpenEncounters(ctx.drizzle, { caravanIds: ids }),
        listActiveSabotage(ctx.drizzle, ids, now),
        listWarehouseItems(ctx.drizzle, [
          ...new Set(
            [...current, ...history].flatMap((row) => row.cargo.map((l) => l.itemId)),
          ),
        ]),
      ]);
      const itemNames = new Map(items.map((row) => [row.id, row.name]));
      const partnerName = (row: (typeof current)[number]) => {
        const route = routes.find((r) => r.id === row.routeId);
        const otherId =
          row.originVillageId === villageData.id
            ? row.destinationVillageId
            : row.originVillageId;
        return route
          ? route.villageIdA === otherId
            ? route.villageA.name
            : route.villageB.name
          : "Former partner";
      };
      const describeCargo = (cargo: CargoLine[]) =>
        cargo.map((line) => ({
          itemId: line.itemId,
          name: itemNames.get(line.itemId) ?? "Unknown item",
          quantity: line.quantity,
        }));
      return {
        canManage: canManageTrade(user, villageData),
        caravans: current.map((row) => {
          const guards = participants.filter(
            (p) => p.caravanId === row.id && p.role === "GUARD" && p.activeUserId,
          );
          const viewer = guards.find((p) => p.userId === user.userId);
          const encounter = encounters.find((e) => e.caravanId === row.id);
          const reached = getReachedCheckpoints(row, now);
          return {
            id: row.id,
            status: row.status,
            outgoing: row.originVillageId === villageData.id,
            partner: partnerName(row),
            cargo: describeCargo(getRemainingCargo(row.cargo, row.lossBp)),
            lossPercent: row.lossBp / 100,
            delayMinutes: row.delayMinutes,
            travelMinutes: row.travelMinutes,
            departedAt: row.departedAt,
            arrivesAt: row.arrivesAt,
            progress: getJourneyProgress(row, now),
            sector: getCaravanSector(row, now),
            checkpoints: reached,
            disrupted: !!row.disruptedUntil && row.disruptedUntil > now,
            guards: guards.map((p) => ({
              userId: p.userId,
              username: p.username,
              avatar: p.avatar,
              level: p.level,
              status: p.status,
              objectives: p.objectives,
            })),
            openSlots: CARAVAN_GUARD_SLOTS - guards.length,
            encounter: encounter
              ? {
                  id: encounter.id,
                  type: encounter.type,
                  status: encounter.status,
                  expiresAt: encounter.expiresAt,
                }
              : null,
            sabotage: sabotage
              .filter((op) => op.caravanId === row.id)
              .map((op) => ({
                id: op.id,
                type: op.type,
                username: op.username,
                finishesAt: op.finishesAt,
              })),
            viewer: viewer
              ? {
                  status: viewer.status,
                  objectives: viewer.objectives,
                  canCheckIn:
                    row.status === "TRAVELLING" && reached > viewer.lastCheckpoint,
                }
              : null,
          };
        }),
        history: history.map((row) => ({
          id: row.id,
          status: row.status,
          outgoing: row.originVillageId === villageData.id,
          partner: partnerName(row),
          cargo: describeCargo(
            row.status === "DELIVERED"
              ? getRemainingCargo(row.cargo, row.lossBp)
              : row.cargo,
          ),
          lossPercent: row.lossBp / 100,
          resolvedAt: row.resolvedAt,
        })),
      };
    }),
  prepare: protectedProcedure
    .meta({ mcp: { description: "Prepare a caravan, reserving Warehouse stock" } })
    .input(
      z.object({
        routeId: z.string(),
        cargo: z
          .array(z.object({ itemId: z.string(), quantity: z.number().int().min(1) }))
          .min(1)
          .max(CARAVAN_MAX_CARGO_ITEMS),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!user.villageId) return errorResponse("You have no village");
      const [own, route, routes, items, relationships, wars] = await Promise.all([
        fetchVillage(ctx.drizzle, user.villageId),
        findTradeRoute(ctx.drizzle, input.routeId),
        listVillageRoutes(ctx.drizzle, user.villageId),
        listWarehouseItems(
          ctx.drizzle,
          input.cargo.map((line) => line.itemId),
        ),
        listVillageRelationships(ctx.drizzle),
        listOpenWars(ctx.drizzle),
      ]);
      if (!own || !canManageTrade(user, own))
        return errorResponse("Only the Kage and Elders send caravans");
      if ((findWarehouse(own.structures)?.level ?? 0) <= 0)
        return errorResponse("Construct your Warehouse first");
      if (
        route?.status !== "ACTIVE" ||
        ![route.villageIdA, route.villageIdB].includes(own.id)
      )
        return errorResponse("Select one of your active trade routes");
      if (route.markers.some((marker) => marker.controllerVillageId))
        return errorResponse("A hostile village holds a marker on this route");
      const block = getRouteTradeBlock(route, relationships, wars);
      if (block) return errorResponse(block);
      const cargo = mergeCargo(input.cargo);
      if (
        cargo.length !== items.length ||
        items.some((row) => !isWarehouseStorable(row))
      )
        return errorResponse("Caravans carry Warehouse goods only");
      const units = cargo.reduce((sum, line) => sum + line.quantity, 0);
      if (units < CARAVAN_MIN_CARGO_UNITS)
        return errorResponse(
          `A caravan carries at least ${CARAVAN_MIN_CARGO_UNITS} units`,
        );
      if (units > CARAVAN_MAX_CARGO_UNITS)
        return errorResponse(
          `A caravan carries at most ${CARAVAN_MAX_CARGO_UNITS.toLocaleString()} units`,
        );
      const toVillageA = route.villageIdA !== own.id;
      const id = nanoid();
      const capacity =
        routes.filter((row) => row.status === "ACTIVE").length *
        CARAVANS_PER_TRADE_ROUTE;
      const full = new CaravanConflict(
        `Your ${capacity} trade route${capacity === 1 ? "" : "s"} allow${capacity === 1 ? "s" : ""} ${capacity} caravan${capacity === 1 ? "" : "s"} at a time`,
      );
      try {
        // Reserving every cargo line and creating the caravan span several rows; the
        // transaction releases earlier reservations when a later line or the capacity fails.
        await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            for (const line of cargo) {
              const reserved = await reserveCargo(tx, own.id, line);
              if (reserved.rowsAffected !== 1)
                throw new CaravanConflict(
                  `Not enough unreserved ${items.find((row) => row.id === line.itemId)?.name ?? "stock"}`,
                );
            }
            const inserted = await insertCaravanWithinCapacity(
              tx,
              {
                id,
                routeId: route.id,
                originVillageId: own.id,
                destinationVillageId: toVillageA ? route.villageIdA : route.villageIdB,
                cargo,
                path: toVillageA ? [...route.path].reverse() : route.path,
                travelMinutes: getRouteTravelMinutes(route.level),
                createdById: user.userId,
                now: new Date(),
              },
              capacity,
            );
            if (inserted.rowsAffected !== 1) throw full;
            await insertWarehouseLogs(
              tx,
              cargo.map((line) => ({
                villageId: own.id,
                userId: user.userId,
                itemId: line.itemId,
                type: "RESERVE" as const,
                quantity: line.quantity,
              })),
              new Date(),
            );
          }),
        );
      } catch (error) {
        if (error instanceof CaravanConflict) return errorResponse(error.message);
        throw error;
      }
      return { success: true, message: "Caravan prepared; escorts can now sign up" };
    }),
  cancel: protectedProcedure
    .meta({ mcp: { description: "Cancel a caravan that has not departed" } })
    .input(z.object({ caravanId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, row] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findCaravan(ctx.drizzle, input.caravanId),
      ]);
      if (row?.status !== "PREPARING")
        return errorResponse("Only caravans that have not departed can be cancelled");
      const own = await fetchVillage(ctx.drizzle, row.originVillageId);
      if (!own || !canManageTrade(user, own))
        return errorResponse("Only the Kage and Elders manage caravans");
      if (!(await cancelCaravan(ctx.drizzle, row)))
        return errorResponse("The caravan changed meanwhile. Refresh and try again");
      return { success: true, message: "Caravan cancelled; its cargo is released" };
    }),
  dispatch: protectedProcedure
    .meta({ mcp: { description: "Send a prepared caravan on its way" } })
    .input(z.object({ caravanId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, row] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findCaravan(ctx.drizzle, input.caravanId),
      ]);
      if (row?.status !== "PREPARING")
        return errorResponse("This caravan is not waiting to depart");
      const [own, route, relationships, wars] = await Promise.all([
        fetchVillage(ctx.drizzle, row.originVillageId),
        findTradeRoute(ctx.drizzle, row.routeId),
        listVillageRelationships(ctx.drizzle),
        listOpenWars(ctx.drizzle),
      ]);
      if (!own || !canManageTrade(user, own))
        return errorResponse("Only the Kage and Elders manage caravans");
      if (route?.status !== "ACTIVE") return errorResponse("The trade route is closed");
      if (route.markers.some((marker) => marker.controllerVillageId))
        return errorResponse("A hostile village holds a marker on this route");
      const block = getRouteTradeBlock(route, relationships, wars);
      if (block) return errorResponse(block);
      const now = new Date();
      const travelMinutes = getRouteTravelMinutes(route.level);
      const conflict = new CaravanConflict(
        "The caravan or its reserved stock changed. Refresh and try again",
      );
      try {
        // Departure removes every reserved cargo line from stock; the transaction keeps the
        // caravan from leaving without its cargo or the cargo leaving without the caravan.
        await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            const claimed = await transitionCaravan(tx, row, {
              status: "TRAVELLING",
              departedAt: now,
              travelMinutes,
              arrivesAt: new Date(now.getTime() + travelMinutes * 60_000),
            });
            if (claimed.rowsAffected !== 1) throw conflict;
            for (const line of row.cargo) {
              const loaded = await dispatchCargo(tx, row.originVillageId, line);
              if (loaded.rowsAffected !== 1) throw conflict;
            }
            await insertWarehouseLogs(
              tx,
              row.cargo.map((line) => ({
                villageId: row.originVillageId,
                userId: user.userId,
                itemId: line.itemId,
                type: "DISPATCH" as const,
                quantity: line.quantity,
              })),
              now,
            );
          }),
        );
      } catch (error) {
        if (error instanceof CaravanConflict) return errorResponse(error.message);
        throw error;
      }
      const participants = await listCaravanParticipants(ctx.drizzle, [row.id]);
      notifyPlayers(
        ctx.drizzle,
        participants
          .filter((p) => p.role === "GUARD" && p.activeUserId)
          .map((p) => p.userId),
        {
          title: "Caravan departed",
          body: `Your caravan departed and arrives in ${travelMinutes} minutes.`,
          route: "/warehouse",
        },
      );
      return {
        success: true,
        message: `Caravan departed; it arrives in ${travelMinutes} minutes`,
      };
    }),
  joinEscort: protectedProcedure
    .meta({ mcp: { description: "Sign up to escort one of your village's caravans" } })
    .input(z.object({ caravanId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated, row, participations] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        findCaravan(ctx.drizzle, input.caravanId),
        listUserParticipations(ctx.drizzle, ctx.userId),
      ]);
      if (!updated.user) return errorResponse("User not found");
      if (row?.status !== "PREPARING")
        return errorResponse("Escorts sign up before the caravan departs");
      const readiness = prepareActionReadiness(updated.user, updated.settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const own = await fetchVillage(ctx.drizzle, row.originVillageId);
      if (!own || user.villageId !== own.id)
        return errorResponse("Only villagers escort their caravans");
      if (user.isBanned) return errorResponse("You are banned");
      if (own.type !== "OUTLAW" && user.sector !== own.sector)
        return errorResponse("Travel to your village to join the escort at departure");
      if (participations.some((p) => p.activeUserId))
        return errorResponse("You are already committed to a caravan");
      try {
        const inserted = await insertGuard(
          ctx.drizzle,
          row.id,
          user.userId,
          new Date(),
        );
        if (inserted.rowsAffected !== 1)
          return errorResponse("Every escort slot is taken");
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse(
            "That slot was just taken, or you already escort a caravan",
          );
        throw error;
      }
      const queued = await queueGuard(ctx.drizzle, row.id, user.userId, readiness);
      if (queued.rowsAffected !== 1) {
        await deleteGuard(ctx.drizzle, row.id, user.userId);
        return errorResponse("You must be awake to join");
      }
      return actionReadinessResponse(
        {
          success: true,
          message: "You joined the escort and wait at departure",
          ...getEscortStatusUserUpdate("QUEUED"),
        },
        readiness,
        ctx.drizzle,
        null,
      );
    }),
  leaveEscort: protectedProcedure
    .meta({ mcp: { description: "Leave a caravan escort before it departs" } })
    .input(z.object({ caravanId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await findCaravan(ctx.drizzle, input.caravanId);
      if (row?.status !== "PREPARING")
        return errorResponse("Escorts are committed once the caravan departs");
      const removed = await deleteGuard(ctx.drizzle, row.id, ctx.userId);
      if (removed.rowsAffected !== 1)
        return errorResponse("You are not in this escort");
      await wakeReleasedGuards(ctx.drizzle, [ctx.userId]);
      return {
        success: true,
        message: "You left the escort",
        ...getEscortStatusUserUpdate("AWAKE"),
      };
    }),
  rejoinEscort: protectedProcedure
    .meta({ mcp: { description: "Return to your caravan's escort after a fight" } })
    .input(z.object({ caravanId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const queued = await queueGuard(ctx.drizzle, input.caravanId, ctx.userId);
      if (queued.rowsAffected !== 1)
        return errorResponse("You must be awake and assigned to this escort");
      return {
        success: true,
        message: "You rejoined the escort",
        ...getEscortStatusUserUpdate("QUEUED"),
      };
    }),
  checkIn: protectedProcedure
    .meta({ mcp: { description: "Report at the checkpoint your caravan passed" } })
    .input(z.object({ caravanId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const row = await findCaravan(ctx.drizzle, input.caravanId);
      if (row?.status !== "TRAVELLING")
        return errorResponse("The caravan is not travelling");
      const reached = getReachedCheckpoints(row);
      if (reached === 0)
        return errorResponse("The caravan has not reached a checkpoint");
      const checked = await checkInGuard(ctx.drizzle, row.id, ctx.userId, reached);
      if (checked.rowsAffected !== 1)
        return errorResponse("You already reported at this checkpoint");
      return { success: true, message: `Checked in at checkpoint ${reached}` };
    }),
  defend: protectedProcedure
    .meta({ mcp: { description: "Fight the bandits ambushing your caravan" } })
    .input(z.object({ encounterId: z.string(), caravanId: z.string() }))
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [row, participants, encounters] = await Promise.all([
        findCaravan(ctx.drizzle, input.caravanId),
        listCaravanParticipants(ctx.drizzle, [input.caravanId]),
        listOpenEncounters(ctx.drizzle, { caravanIds: [input.caravanId] }),
      ]);
      const encounter = encounters.find((e) => e.id === input.encounterId);
      if (
        !row ||
        !encounter ||
        encounter.type !== "AMBUSH" ||
        encounter.status !== "PENDING"
      )
        return errorResponse("This ambush is over");
      const guards = selectQueuedGuards(participants);
      const self = guards.find((p) => p.userId === ctx.userId);
      if (!self)
        return errorResponse("Only escorts waiting with the caravan can defend it");
      const userIds = [
        self.userId,
        ...guards.filter((p) => p !== self).map((p) => p.userId),
      ];
      const bandits = await pickCaravanAi(ctx.drizzle, userIds.length, self.level);
      if (bandits.length === 0)
        return errorResponse("No caravan bandits are configured");
      return launchCaravanBattle(ctx.drizzle, {
        pendingEncounterId: encounter.id,
        encounter: { type: "AMBUSH", caravanId: row.id },
        state: {
          type: "AMBUSH",
          caravanId: row.id,
          markerId: null,
          attackerDirection: "right",
          attackerRole: null,
          attackerVillageId: null,
          attackerIds: [],
          guardIds: userIds,
          cargo: row.cargo,
          lossBp: row.lossBp,
          stealBp: 0,
          captureVillageId: null,
        },
        userIds,
        targetIds: bandits,
        scaleTarget: true,
        cacheUserId: ctx.userId,
      });
    }),
  intervene: protectedProcedure
    .meta({ mcp: { description: "Stop a saboteur working on your caravan" } })
    .input(z.object({ caravanId: z.string(), operationId: z.string() }))
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [row, participants, sabotage] = await Promise.all([
        findCaravan(ctx.drizzle, input.caravanId),
        listCaravanParticipants(ctx.drizzle, [input.caravanId]),
        listActiveSabotage(ctx.drizzle, [input.caravanId], now),
      ]);
      const operation = sabotage.find((op) => op.id === input.operationId);
      if (row?.status !== "TRAVELLING" || !operation)
        return errorResponse("The saboteur is gone");
      const self = selectQueuedGuards(participants).find(
        (p) => p.userId === ctx.userId,
      );
      if (!self)
        return errorResponse("Only escorts waiting with the caravan can intervene");
      // A saboteur busy elsewhere cannot be fought; catching them at work stops it outright.
      if (operation.userStatus !== "AWAKE") {
        const stopped = await resolveOperation(
          ctx.drizzle,
          operation.id,
          "INTERRUPTED",
          now,
        );
        if (stopped.rowsAffected !== 1) return errorResponse("The saboteur is gone");
        notifyPlayers(ctx.drizzle, [operation.userId], {
          title: "Sabotage stopped",
          body: "An escort caught you at work on their caravan and stopped your sabotage.",
          route: "/warehouse",
        });
        return {
          success: true,
          message: `You stopped ${operation.username}'s sabotage`,
        };
      }
      const result = await launchCaravanBattle(ctx.drizzle, {
        encounter: {
          type: "INTERVENTION",
          caravanId: row.id,
          operationId: operation.id,
        },
        state: {
          type: "INTERVENTION",
          caravanId: row.id,
          markerId: null,
          attackerDirection: "right",
          attackerRole: "ENEMY",
          attackerVillageId: null,
          attackerIds: [operation.userId],
          guardIds: [self.userId],
          cargo: row.cargo,
          lossBp: row.lossBp,
          stealBp: 0,
          captureVillageId: null,
        },
        userIds: [self.userId],
        targetIds: [operation.userId],
        cacheUserId: ctx.userId,
      });
      // Engaging the saboteur stops their work whatever the fight's outcome, judged at the
      // moment it was confirmed under way.
      if (result.success)
        await resolveOperation(ctx.drizzle, operation.id, "INTERRUPTED", now);
      return result;
    }),
});

/** Why a route's villages may no longer trade, once they turned enemies or went to war. */
const getRouteTradeBlock = (
  route: { villageIdA: string; villageIdB: string },
  relationships: VillageAlliance[],
  wars: { attackerVillageId: string; defenderVillageId: string }[],
) =>
  getTradeBlock(
    relationships,
    route.villageIdA,
    route.villageIdB,
    isAtWar(wars, route.villageIdA, route.villageIdB),
  );

/** Combine repeated cargo lines of the same item. */
const mergeCargo = (lines: CargoLine[]) => {
  const totals = new Map<string, number>();
  for (const line of lines)
    totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.quantity);
  return [...totals].map(([itemId, quantity]) => ({ itemId, quantity }));
};

/** Raised inside a caravan transaction to roll it back with a player-facing message. */
class CaravanConflict extends Error {}
