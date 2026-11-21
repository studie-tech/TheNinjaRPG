import { nanoid } from "nanoid";
import { z } from "zod";
import {
  CARAVANS_PER_TRADE_ROUTE,
  TRADE_ROUTE_MAX_LEVEL,
  TRADE_ROUTE_UPGRADE_COST,
} from "@/drizzle/constants";
import {
  findSectorPath,
  getRoutePair,
  getRouteTravelMinutes,
  getTradeBlock,
  planRouteMarkers,
} from "@/libs/caravan";
import { isFactionVillage } from "@/libs/war";
import { findWarehouse } from "@/libs/warehouse";
import { countOutgoingCaravans, listOpenCaravans } from "@/queries/caravan";
import { fetchUser } from "@/queries/profile";
import {
  acceptTradeRoute,
  closeTradeRoute,
  findTradeRoute,
  insertRouteMarkers,
  insertTradeRoute,
  listVillageRelationships,
  listVillageRoutes,
  listWarehouseVillages,
  upgradeTradeRoute,
} from "@/queries/tradeRoute";
import { fetchVillage } from "@/queries/village";
import { listOpenWars } from "@/queries/warehouse";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import {
  cancelCaravan,
  canManageTrade,
  isAtWar,
  notifyPlayers,
} from "@/server/utils/caravan";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";

export const tradeRouteRouter = createTRPCRouter({
  getRoutes: protectedProcedure
    .meta({ mcp: { description: "List your village's trade routes and partners" } })
    .query(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!user.villageId) return null;
      const [villageData, routes, partners, relationships, wars, [outgoing]] =
        await Promise.all([
          fetchVillage(ctx.drizzle, user.villageId),
          listVillageRoutes(ctx.drizzle, user.villageId),
          listWarehouseVillages(ctx.drizzle),
          listVillageRelationships(ctx.drizzle),
          listOpenWars(ctx.drizzle),
          countOutgoingCaravans(ctx.drizzle, user.villageId),
        ]);
      if (!villageData) return null;
      const villageId = villageData.id;
      const names = new Map(partners.map((row) => [row.id, row.name]));
      const active = routes.filter((route) => route.status === "ACTIVE");
      const openPartners = new Set(
        routes.map((route) =>
          route.villageIdA === villageId ? route.villageIdB : route.villageIdA,
        ),
      );
      return {
        village: { id: villageId, name: villageData.name },
        canManage: canManageTrade(user, villageData),
        hasWarehouse: (findWarehouse(villageData.structures)?.level ?? 0) > 0,
        capacity: {
          total: active.length * CARAVANS_PER_TRADE_ROUTE,
          used: outgoing?.count ?? 0,
        },
        routes: routes.map((route) => {
          const partner =
            route.villageIdA === villageId ? route.villageB : route.villageA;
          return {
            id: route.id,
            status: route.status,
            level: route.level,
            maxLevel: TRADE_ROUTE_MAX_LEVEL,
            travelMinutes: getRouteTravelMinutes(route.level),
            nextTravelMinutes:
              route.level < TRADE_ROUTE_MAX_LEVEL
                ? getRouteTravelMinutes(route.level + 1)
                : null,
            upgradeCost: TRADE_ROUTE_UPGRADE_COST,
            partner: { id: partner.id, name: partner.name, sector: partner.sector },
            proposedByUs: route.proposedByVillageId === villageId,
            sectors: route.path.length,
            blocked: route.markers.some((marker) => marker.controllerVillageId),
            markers: route.markers.map((marker) => ({
              id: marker.id,
              sector: marker.sector,
              control: marker.control,
              controller: marker.controllerVillageId
                ? (names.get(marker.controllerVillageId) ?? "A hostile village")
                : null,
            })),
          };
        }),
        partners: partners
          .filter((row) => row.id !== villageId && !openPartners.has(row.id))
          .map((row) => ({
            id: row.id,
            name: row.name,
            block: getTradeBlock(
              relationships,
              villageId,
              row.id,
              isAtWar(wars, villageId, row.id),
            ),
          })),
      };
    }),
  propose: protectedProcedure
    .meta({ mcp: { description: "Propose a trade route to another village" } })
    .input(z.object({ villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!user.villageId) return errorResponse("You have no village");
      const [own, partner, relationships, wars] = await Promise.all([
        fetchVillage(ctx.drizzle, user.villageId),
        fetchVillage(ctx.drizzle, input.villageId),
        listVillageRelationships(ctx.drizzle),
        listOpenWars(ctx.drizzle),
      ]);
      if (!own || !partner) return errorResponse("Village not found");
      if (!canManageTrade(user, own))
        return errorResponse("Only the Kage and Elders manage trade routes");
      if ((findWarehouse(own.structures)?.level ?? 0) <= 0)
        return errorResponse("Construct your Warehouse first");
      if ((findWarehouse(partner.structures)?.level ?? 0) <= 0)
        return errorResponse(`${partner.name} has no Warehouse`);
      const block = getTradeBlock(
        relationships,
        own.id,
        partner.id,
        isAtWar(wars, own.id, partner.id),
      );
      if (block) return errorResponse(block);
      const [villageIdA, villageIdB] = getRoutePair(own.id, partner.id);
      const sectorA = villageIdA === own.id ? own.sector : partner.sector;
      const sectorB = villageIdB === own.id ? own.sector : partner.sector;
      const path = findSectorPath(sectorA, sectorB);
      if (!path) return errorResponse("No path connects the two villages");
      try {
        await insertTradeRoute(ctx.drizzle, {
          id: nanoid(),
          villageIdA,
          villageIdB,
          openPair: `${villageIdA}:${villageIdB}`,
          status: "PROPOSED",
          proposedByVillageId: own.id,
          proposedById: user.userId,
          path,
          createdAt: new Date(),
        });
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse(`You already have an agreement with ${partner.name}`);
        throw error;
      }
      notifyPlayers(ctx.drizzle, [partner.kageId], {
        title: "Trade route proposed",
        body: `${own.name} proposes a trade route to ${partner.name}.`,
        route: "/warehouse",
      });
      return { success: true, message: `Proposed a trade route to ${partner.name}` };
    }),
  respond: protectedProcedure
    .meta({ mcp: { description: "Accept or decline a proposed trade route" } })
    .input(z.object({ routeId: z.string(), accept: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, route, relationships, wars] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findTradeRoute(ctx.drizzle, input.routeId),
        listVillageRelationships(ctx.drizzle),
        listOpenWars(ctx.drizzle),
      ]);
      if (route?.status !== "PROPOSED")
        return errorResponse("This proposal is no longer open");
      const answeringId =
        route.proposedByVillageId === route.villageIdA
          ? route.villageIdB
          : route.villageIdA;
      const own =
        user.villageId === answeringId
          ? await fetchVillage(ctx.drizzle, answeringId)
          : undefined;
      if (!own || !canManageTrade(user, own))
        return errorResponse("Only the invited village's Kage and Elders can answer");
      const now = new Date();
      if (!input.accept) {
        await closeTradeRoute(ctx.drizzle, route.id, now);
        return { success: true, message: "Proposal declined" };
      }
      const block = getTradeBlock(
        relationships,
        route.villageIdA,
        route.villageIdB,
        isAtWar(wars, route.villageIdA, route.villageIdB),
      );
      if (block) return errorResponse(block);
      if ((findWarehouse(own.structures)?.level ?? 0) <= 0)
        return errorResponse("Construct your Warehouse first");
      const accepted = await acceptTradeRoute(ctx.drizzle, route.id, now);
      if (accepted.rowsAffected !== 1)
        return errorResponse("This proposal is no longer open");
      await insertRouteMarkers(
        ctx.drizzle,
        planRouteMarkers(route.path).map((marker) => ({
          id: nanoid(),
          routeId: route.id,
          ...marker,
        })),
      );
      const proposer =
        route.villageIdA === answeringId ? route.villageB : route.villageA;
      notifyPlayers(ctx.drizzle, [proposer.kageId], {
        title: "Trade route agreed",
        body: `${own.name} accepted your trade route.`,
        route: "/warehouse",
      });
      return { success: true, message: "Trade route established" };
    }),
  close: protectedProcedure
    .meta({ mcp: { description: "Close one of your village's trade routes" } })
    .input(z.object({ routeId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, route] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findTradeRoute(ctx.drizzle, input.routeId),
      ]);
      if (!route || route.status === "CLOSED") return errorResponse("Route not found");
      const own =
        user.villageId && [route.villageIdA, route.villageIdB].includes(user.villageId)
          ? await fetchVillage(ctx.drizzle, user.villageId)
          : undefined;
      if (!own || !canManageTrade(user, own))
        return errorResponse("Only the Kage and Elders manage trade routes");
      const now = new Date();
      const closed = await closeTradeRoute(ctx.drizzle, route.id, now);
      if (closed.rowsAffected !== 1) return errorResponse("Route already closed");
      // Travelling caravans continue to their destination; unsent ones are called off.
      const caravans = await listOpenCaravans(ctx.drizzle, [route.id]);
      await Promise.all(
        caravans
          .filter((row) => row.status === "PREPARING")
          .map((row) => cancelCaravan(ctx.drizzle, row, now)),
      );
      return { success: true, message: "Trade route closed" };
    }),
  upgrade: protectedProcedure
    .meta({ mcp: { description: "Upgrade a trade route to shorten caravan travel" } })
    .input(z.object({ routeId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, route] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findTradeRoute(ctx.drizzle, input.routeId),
      ]);
      if (route?.status !== "ACTIVE") return errorResponse("Route not found");
      const own =
        user.villageId && [route.villageIdA, route.villageIdB].includes(user.villageId)
          ? await fetchVillage(ctx.drizzle, user.villageId)
          : undefined;
      if (!own || !canManageTrade(user, own))
        return errorResponse("Only the Kage and Elders manage trade routes");
      if (route.level >= TRADE_ROUTE_MAX_LEVEL)
        return errorResponse("This route is at its maximum level");
      const clanId = isFactionVillage(own) ? user.clanId : null;
      if (isFactionVillage(own) && !clanId) return errorResponse("Faction not found");
      const upgraded = await retryOnDeadlock(() =>
        upgradeTradeRoute(ctx.drizzle, {
          routeId: route.id,
          level: route.level,
          cost: TRADE_ROUTE_UPGRADE_COST,
          villageId: own.id,
          userId: user.userId,
          clanId,
        }),
      );
      if (upgraded.rowsAffected === 0)
        return errorResponse(
          `Upgrading costs ${TRADE_ROUTE_UPGRADE_COST.toLocaleString()} ${clanId ? "clan points" : "village tokens"}, or the route changed meanwhile`,
        );
      return {
        success: true,
        message: `Route upgraded; caravans now travel ${getRouteTravelMinutes(route.level + 1)} minutes`,
      };
    }),
});
