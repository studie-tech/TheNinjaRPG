import { nanoid } from "nanoid";
import { z } from "zod";
import { getReleasedEscortUserUpdate } from "@/deltas/caravan";
import { getPaidWarehouseChange } from "@/deltas/warehouse";
import {
  TRADE_ROUTE_MARKER_MAX_CONTROL,
  TRADE_ROUTE_MAX_LEVEL,
  TRADE_ROUTE_UPGRADE_COST,
} from "@/drizzle/constants";
import {
  describeTradeRoute,
  findSectorPath,
  getRouteTravelMinutes,
  getTradeBlock,
  planRouteMarkers,
} from "@/libs/caravan";
import { isFactionVillage } from "@/libs/war";
import { findWarehouse } from "@/libs/warehouse";
import { listOpenCaravans } from "@/queries/caravan";
import { fetchUser } from "@/queries/profile";
import {
  acceptTradeRoute,
  closeTradeRoutes,
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
import { cancelCaravan, canManageTrade, notifyPlayers } from "@/server/utils/caravan";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { userDeltaResponseSchema } from "@/validators/userCache";
import { warehouseResponseSchema } from "@/validators/warehouse";

/** A proposal accepted into an active route with the markers planned along it. */
const activatedRouteSchema = z.object({
  routeId: z.string(),
  markers: z.array(
    z.object({ id: z.string(), sector: z.number().int(), control: z.number().int() }),
  ),
});

/**
 * A declined or closed route with its partner, which may be offered again, and whether the
 * closure changed open caravans on it.
 */
const removedRouteSchema = z.object({
  routeId: z.string(),
  partner: z.object({ id: z.string(), name: z.string(), block: z.string().nullable() }),
  caravansChanged: z.boolean().optional(),
});

export const tradeRouteRouter = createTRPCRouter({
  getRoutes: protectedProcedure
    .meta({ mcp: { description: "List your village's trade routes and partners" } })
    .query(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!user.villageId) return null;
      const [villageData, routes, partners, relationships, wars] = await Promise.all([
        fetchVillage(ctx.drizzle, user.villageId),
        listVillageRoutes(ctx.drizzle, user.villageId),
        listWarehouseVillages(ctx.drizzle),
        listVillageRelationships(ctx.drizzle),
        listOpenWars(ctx.drizzle),
      ]);
      if (!villageData) return null;
      const villageId = villageData.id;
      const names = new Map(partners.map((row) => [row.id, row.name]));
      const openPartners = new Set(
        routes.map((route) =>
          route.villageIdA === villageId ? route.villageIdB : route.villageIdA,
        ),
      );
      return {
        canManage: canManageTrade(user, villageData),
        fundsLabel: isFactionVillage(villageData) ? "clan points" : "village tokens",
        routes: routes.map((route) => {
          const isA = route.villageIdA === villageId;
          const partner = isA ? route.villageB : route.villageA;
          return describeTradeRoute({
            id: route.id,
            status: route.status,
            level: route.level,
            partner: {
              id: isA ? route.villageIdB : route.villageIdA,
              name: partner?.name ?? "Former partner",
            },
            proposedByUs: route.proposedByVillageId === villageId,
            sectors: route.path.length,
            markers: route.markers.map((marker) => ({
              id: marker.id,
              sector: marker.sector,
              control: marker.control,
              controller: marker.controllerVillageId
                ? (names.get(marker.controllerVillageId) ?? "A hostile village")
                : null,
            })),
          });
        }),
        partners: partners
          .filter((row) => row.id !== villageId && !openPartners.has(row.id))
          .map((row) => ({
            id: row.id,
            name: row.name,
            block: getTradeBlock(relationships, wars, villageId, row.id),
          })),
      };
    }),
  propose: protectedProcedure
    .meta({ mcp: { description: "Propose a trade route to another village" } })
    .input(z.object({ villageId: z.string() }))
    .output(
      baseServerResponse.extend({
        proposed: z
          .object({
            id: z.string(),
            partner: z.object({ id: z.string(), name: z.string() }),
            sectors: z.number().int(),
          })
          .optional(),
      }),
    )
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
      const block = getTradeBlock(relationships, wars, own.id, partner.id);
      if (block) return errorResponse(block);
      // Sorted, so the open-pair key holds one open route between two villages.
      const [villageIdA, villageIdB] = [own.id, partner.id].sort() as [string, string];
      const sectorA = villageIdA === own.id ? own.sector : partner.sector;
      const sectorB = villageIdB === own.id ? own.sector : partner.sector;
      const path = findSectorPath(sectorA, sectorB);
      if (!path) return errorResponse("No path connects the two villages");
      const routeId = nanoid();
      try {
        const inserted = await insertTradeRoute(ctx.drizzle, {
          id: routeId,
          villageIdA,
          villageIdB,
          openPair: `${villageIdA}:${villageIdB}`,
          status: "PROPOSED",
          proposedByVillageId: own.id,
          path,
          createdAt: new Date(),
        });
        if (inserted.rowsAffected !== 1)
          return errorResponse(
            "A village moved while the route was being proposed. Refresh and try again",
          );
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse(`You already have an agreement with ${partner.name}`);
        throw error;
      }
      notifyPlayers(ctx.drizzle, [partner.kageId], {
        title: "Trade route proposed",
        body: `${own.name} proposes a trade route to ${partner.name}.`,
        refresh: ["routes"],
      });
      return {
        success: true,
        message: `Proposed a trade route to ${partner.name}`,
        proposed: {
          id: routeId,
          partner: { id: partner.id, name: partner.name },
          sectors: path.length,
        },
      };
    }),
  respond: protectedProcedure
    .meta({ mcp: { description: "Accept or decline a proposed trade route" } })
    .input(z.object({ routeId: z.string(), accept: z.boolean() }))
    .output(
      baseServerResponse.extend({
        activated: activatedRouteSchema.optional(),
        removed: removedRouteSchema.optional(),
      }),
    )
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
      const proposer =
        route.villageIdA === answeringId ? route.villageB : route.villageA;
      const own =
        user.villageId === answeringId
          ? await fetchVillage(ctx.drizzle, answeringId)
          : undefined;
      if (!own || !canManageTrade(user, own))
        return errorResponse("Only the invited village's Kage and Elders can answer");
      const now = new Date();
      const block = getTradeBlock(
        relationships,
        wars,
        route.villageIdA,
        route.villageIdB,
      );
      if (!input.accept) {
        const closed = await closeTradeRoutes(ctx.drizzle, { routeId: route.id }, now);
        if (closed.rowsAffected !== 1)
          return errorResponse("This proposal is no longer open");
        return {
          success: true,
          message: "Proposal declined",
          removed: {
            routeId: route.id,
            partner: { id: route.proposedByVillageId, name: proposer.name, block },
          },
        };
      }
      if (block) return errorResponse(block);
      if ((findWarehouse(own.structures)?.level ?? 0) <= 0)
        return errorResponse("Construct your Warehouse first");
      const accepted = await acceptTradeRoute(ctx.drizzle, route.id, now);
      if (accepted.rowsAffected !== 1)
        return errorResponse("This proposal is no longer open");
      const markers = planRouteMarkers(route.path).map((marker) => ({
        id: nanoid(),
        routeId: route.id,
        control: TRADE_ROUTE_MARKER_MAX_CONTROL,
        ...marker,
      }));
      await insertRouteMarkers(ctx.drizzle, markers);
      notifyPlayers(ctx.drizzle, [proposer.kageId], {
        title: "Trade route agreed",
        body: `${own.name} accepted your trade route.`,
        refresh: ["routes"],
      });
      return {
        success: true,
        message: "Trade route established",
        activated: {
          routeId: route.id,
          markers: markers.map((marker) => ({
            id: marker.id,
            sector: marker.sector,
            control: marker.control,
          })),
        },
      };
    }),
  close: protectedProcedure
    .meta({ mcp: { description: "Close one of your village's trade routes" } })
    .input(z.object({ routeId: z.string() }))
    .output(userDeltaResponseSchema.extend({ removed: removedRouteSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      // Relationships and wars decide whether the partner can be offered again.
      const [user, route, relationships, wars] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findTradeRoute(ctx.drizzle, input.routeId),
        listVillageRelationships(ctx.drizzle),
        listOpenWars(ctx.drizzle),
      ]);
      if (!route || route.status === "CLOSED") return errorResponse("Route not found");
      const own =
        user.villageId && [route.villageIdA, route.villageIdB].includes(user.villageId)
          ? await fetchVillage(ctx.drizzle, user.villageId)
          : undefined;
      if (!own || !canManageTrade(user, own))
        return errorResponse("Only the Kage and Elders manage trade routes");
      const now = new Date();
      const closed = await closeTradeRoutes(ctx.drizzle, { routeId: route.id }, now);
      if (closed.rowsAffected !== 1) return errorResponse("Route already closed");
      // Travelling caravans continue to their destination; unsent ones are called off.
      const caravans = await listOpenCaravans(ctx.drizzle, [route.id]);
      const preparing = caravans.filter((row) => row.status === "PREPARING");
      const cancelled = await Promise.all(
        preparing.map((row) => cancelCaravan(ctx.drizzle, row, now)),
      );
      const partnerIsA = route.villageIdA !== own.id;
      return {
        success: true,
        message: "Trade route closed",
        ...getReleasedEscortUserUpdate(
          user,
          cancelled.flatMap((released) => released || []),
        ),
        removed: {
          routeId: route.id,
          partner: {
            id: partnerIsA ? route.villageIdA : route.villageIdB,
            name: (partnerIsA ? route.villageA : route.villageB).name,
            block: getTradeBlock(
              relationships,
              wars,
              route.villageIdA,
              route.villageIdB,
            ),
          },
          caravansChanged: caravans.length > 0,
        },
      };
    }),
  upgrade: protectedProcedure
    .meta({ mcp: { description: "Upgrade a trade route to shorten caravan travel" } })
    .input(z.object({ routeId: z.string() }))
    .output(
      warehouseResponseSchema.extend({
        upgraded: z.object({ routeId: z.string(), level: z.number().int() }).optional(),
      }),
    )
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
      const upgraded = await upgradeTradeRoute(ctx.drizzle, {
        routeId: route.id,
        level: route.level,
        cost: TRADE_ROUTE_UPGRADE_COST,
        villageId: own.id,
        userId: user.userId,
        clanId,
      });
      if (upgraded.rowsAffected === 0)
        return errorResponse(
          `Upgrading costs ${TRADE_ROUTE_UPGRADE_COST.toLocaleString()} ${clanId ? "clan points" : "village tokens"}, or the route changed meanwhile`,
        );
      return {
        success: true,
        message: `Route upgraded; caravans now travel ${getRouteTravelMinutes(route.level + 1)} minutes`,
        upgraded: { routeId: route.id, level: route.level + 1 },
        warehouseChange: getPaidWarehouseChange(TRADE_ROUTE_UPGRADE_COST),
      };
    }),
});
