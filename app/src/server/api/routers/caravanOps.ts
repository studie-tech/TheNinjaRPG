import { nanoid } from "nanoid";
import { z } from "zod";
import {
  BANDIT_RANK_LABELS,
  CARAVAN_BANDIT_MIN_GROUP,
  CARAVAN_DISCOVERY_MINUTES,
  CARAVAN_ENEMY_MIN_GROUP,
  CARAVAN_MAX_GROUP,
  CARAVAN_MAX_LOSS_BP,
  CARAVAN_OPERATION_HISTORY_SIZE,
  CARAVAN_OPERATION_STATUSES,
  CARAVAN_OPERATION_TYPES,
  CARAVAN_ROLES,
  CARAVAN_TRACK_COOLDOWN_SECONDS,
  type CaravanRole,
  TRADE_ROUTE_MARKER_GUARDS,
  UserStatuses,
} from "@/drizzle/constants";
import type { CaravanDiscovery, UserData, VillageAlliance } from "@/drizzle/schema";
import {
  activeGuards,
  getAttackerRole,
  getBanditRank,
  getBanditRankProgress,
  getCaravanSector,
  getOperationChance,
  getOperationMinutes,
  getStealBp,
  getStealthChance,
  rollChance,
} from "@/libs/caravan";
import {
  countInventoryBucketSlots,
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
} from "@/libs/item";
import { countHeldInventorySlots } from "@/libs/itemsPage";
import {
  claimLoot,
  claimOperatorReadiness,
  insertOperation,
  listCaravanAi,
  listCaravanParticipants,
  listCaravansByIds,
  listCaravansWithVillageNames,
  listOpenEncounters,
  listUserDiscoveries,
  listUserOperations,
  listUserParticipations,
  releaseParticipants,
  trackDiscovery,
  upsertAttacker,
} from "@/queries/caravan";
import { fetchUser, updateUserBanditProfession } from "@/queries/profile";
import {
  findMarker,
  listMarkerDiscoveries,
  listSectorMarkers,
  listVillageRelationships,
} from "@/queries/tradeRoute";
import { listOpenWars, listWarehouseItems } from "@/queries/warehouse";
import { fetchUserItems } from "@/server/api/routers/item";
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
import { maintainCaravans, notifyPlayers } from "@/server/utils/caravan";
import {
  launchCaravanBattle,
  pickCaravanAi,
  selectQueuedGuards,
} from "@/server/utils/caravanBattle";
import { grantUserItems } from "@/server/utils/itemGrants";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { WarehouseConflict } from "@/server/utils/warehouse";
import { groupBy } from "@/utils/grouping";
import { MINUTE_S, secondsFromDate } from "@/utils/time";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const caravanOpsRouter = createTRPCRouter({
  getControls: protectedProcedure
    .meta({
      mcp: { description: "Caravan scouting, sabotage and bandit controls here" },
    })
    .query(async ({ ctx }) => {
      const now = new Date();
      const readOperator = () =>
        Promise.all([
          fetchUser(ctx.drizzle, ctx.userId),
          listUserDiscoveries(ctx.drizzle, ctx.userId, now),
          listUserParticipations(ctx.drizzle, ctx.userId),
          listUserOperations(ctx.drizzle, ctx.userId, CARAVAN_OPERATION_HISTORY_SIZE),
          listVillageRelationships(ctx.drizzle),
          listOpenWars(ctx.drizzle),
        ]);
      let [user, discoveries, participations, operations, relationships, wars] =
        await readOperator();
      // A player runs one operation at a time, the latest started, so a due one is listed.
      if (operations.some((row) => row.status === "ACTIVE" && row.finishesAt <= now)) {
        await maintainCaravans(ctx.drizzle, now, { userId: ctx.userId });
        // A competing reader can win the work, so reread even when this one changed nothing.
        [user, discoveries, participations, operations, relationships, wars] =
          await readOperator();
      }
      const caravanIds = [
        ...new Set([
          ...discoveries.map((row) => row.caravanId),
          ...participations.map((row) => row.caravanId),
        ]),
      ];
      const [
        caravans,
        participants,
        encounters,
        markers,
        markerDiscoveries,
        lootItems,
      ] = await Promise.all([
        listCaravansWithVillageNames(ctx.drizzle, caravanIds),
        listCaravanParticipants(ctx.drizzle, caravanIds),
        listOpenEncounters(ctx.drizzle, caravanIds),
        listSectorMarkers(ctx.drizzle, user.sector),
        user.villageId
          ? listMarkerDiscoveries(ctx.drizzle, user.villageId, now)
          : Promise.resolve([]),
        listWarehouseItems(
          ctx.drizzle,
          participations.flatMap((row) => row.loot?.map((line) => line.itemId) ?? []),
        ),
      ]);
      const villageNames = new Map<string, string>();
      for (const row of caravans) {
        if (row.originName) villageNames.set(row.originVillageId, row.originName);
        if (row.destinationName)
          villageNames.set(row.destinationVillageId, row.destinationName);
      }
      for (const marker of markers) {
        if (marker.villageNameA)
          villageNames.set(marker.villageIdA, marker.villageNameA);
        if (marker.villageNameB)
          villageNames.set(marker.villageIdB, marker.villageNameB);
      }
      const villageName = (id: string) => villageNames.get(id) ?? "Unknown village";
      const known = new Set(markerDiscoveries.map((row) => row.markerId));
      const committed = participations.find((row) => row.activeUserId);
      // A group join racing delivery can outlive the caravan; free it so the player can act again.
      const stranded =
        committed?.role !== "GUARD" &&
        !caravans.some(
          (row) =>
            row.id === committed?.caravanId &&
            (row.status === "PREPARING" || row.status === "TRAVELLING"),
        );
      if (committed && stranded)
        await releaseParticipants(ctx.drizzle, committed.caravanId, {
          userIds: [ctx.userId],
        });
      const active = stranded ? undefined : committed;
      return {
        sector: user.sector,
        isOutlaw: user.isOutlaw,
        bandit: {
          enabled: user.isBandit,
          experience: user.banditExperience,
          rank: BANDIT_RANK_LABELS[getBanditRank(user.banditExperience)],
          ...getBanditRankProgress(user.banditExperience),
          chance: getOperationChance("BANDIT", user),
          scoutMinutes: getOperationMinutes(
            "INVESTIGATE",
            "BANDIT",
            user.banditExperience,
          ),
          stealPercent: getStealBp(user.banditExperience) / 100,
        },
        stealthChance: getStealthChance(user.stealth),
        operations: operations.map((row) => ({
          id: row.id,
          type: row.type,
          status: row.status,
          succeeds: row.status === "ACTIVE" ? null : row.succeeds,
          sector: row.sector,
          finishesAt: row.finishesAt,
        })),
        commitment: active
          ? {
              caravanId: active.caravanId,
              role: active.role,
              userId: user.userId,
              groupLeaderId: active.groupLeaderId,
            }
          : null,
        caravans: caravans
          .filter((row) => row.status === "PREPARING" || row.status === "TRAVELLING")
          .map((row) => {
            const role = getAttackerRole(
              user,
              row.originVillageId,
              relationships,
              wars,
            );
            const sighting = discoveries.find(
              (d) => d.caravanId === row.id && d.kind === "LOCATION",
            );
            const groups = describeGroups(participants, row.id, role, {
              sighted: !!sighting,
              encounters,
              villageId: user.villageId,
            });
            return {
              id: row.id,
              status: row.status,
              origin: villageName(row.originVillageId),
              destination: villageName(row.destinationVillageId),
              departedAt: row.departedAt,
              arrivesAt: row.arrivesAt,
              role,
              lastSector: sighting?.sector ?? null,
              seenAt: sighting?.seenAt ?? null,
              inSector:
                !!sighting &&
                row.status === "TRAVELLING" &&
                getCaravanSector(row, now) === user.sector,
              guards: activeGuards(participants, row.id).length,
              groups,
            };
          }),
        loot: participations
          .filter((row) => row.loot && !row.lootClaimedAt)
          .map((row) => ({
            caravanId: row.caravanId,
            lines: (row.loot ?? []).map((line) => ({
              ...line,
              name:
                lootItems.find((item) => item.id === line.itemId)?.name ??
                "Unknown item",
            })),
          })),
        markers: markers
          .filter(
            (marker) =>
              known.has(marker.id) ||
              [marker.villageIdA, marker.villageIdB].includes(user.villageId ?? ""),
          )
          .map((marker) => ({
            id: marker.id,
            route: `${villageName(marker.villageIdA)} – ${villageName(marker.villageIdB)}`,
            control: marker.control,
            controller: marker.controllerVillageId
              ? (marker.controllerName ?? "Unknown village")
              : null,
            canAssault: !getMarkerAssaultBlock(user, marker, relationships, wars, true),
          })),
      };
    }),
  setBandit: protectedProcedure
    .meta({
      mcp: { description: "Take up or abandon the Bandit profession as an outlaw" },
    })
    .input(z.object({ enabled: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (input.enabled && !user.isOutlaw)
        return errorResponse("Only outlaws can become bandits");
      const updated = await updateUserBanditProfession(
        ctx.drizzle,
        ctx.userId,
        input.enabled,
      );
      // No change is fine for a bandit already in the trade, not for one who lost outlaw status.
      if (input.enabled && updated.rowsAffected !== 1 && !user.isBandit)
        return errorResponse("Only outlaws can become bandits");
      return {
        success: true,
        message: input.enabled
          ? "You took up the Bandit profession"
          : "You left banditry",
      };
    }),
  startOperation: protectedProcedure
    .meta({ mcp: { description: "Investigate, search or sabotage caravans" } })
    .input(
      z.object({
        type: z.enum(CARAVAN_OPERATION_TYPES),
        caravanId: z.string().optional(),
      }),
    )
    .output(
      baseServerResponse.extend({
        operation: z
          .object({
            id: z.string(),
            type: z.enum(CARAVAN_OPERATION_TYPES),
            status: z.enum(CARAVAN_OPERATION_STATUSES),
            succeeds: z.boolean().nullable(),
            sector: z.number().int(),
            finishesAt: z.date(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const isSabotage = input.type === "DISRUPT" || input.type === "DELAY";
      const targetId = isSabotage ? input.caravanId : undefined;
      const [
        updated,
        relationships,
        wars,
        discoveries,
        participations,
        [target],
        targetParticipants,
      ] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        listVillageRelationships(ctx.drizzle),
        listOpenWars(ctx.drizzle),
        listUserDiscoveries(ctx.drizzle, ctx.userId, now),
        listUserParticipations(ctx.drizzle, ctx.userId),
        listCaravansByIds(ctx.drizzle, targetId ? [targetId] : []),
        listCaravanParticipants(ctx.drizzle, targetId ? [targetId] : []),
      ]);
      if (!updated.user) return errorResponse("User not found");
      if (updated.user.isBanned) return errorResponse("You are banned");
      const readiness = prepareActionReadiness(updated.user, updated.settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      if (activeGuards(participations).length > 0)
        return errorResponse("Escorts cannot work against caravans");
      let role: CaravanRole | null = user.isOutlaw
        ? user.isBandit
          ? "BANDIT"
          : null
        : "ENEMY";
      if (isSabotage) {
        if (target?.status !== "TRAVELLING")
          return errorResponse("Select a travelling caravan you have located");
        role = getAttackerRole(user, target.originVillageId, relationships, wars);
        if (role !== "ENEMY")
          return errorResponse("Only shinobi of a hostile village sabotage caravans");
        if (!hasSighting(discoveries, target.id))
          return errorResponse("Locate the caravan first");
        if (getCaravanSector(target, now) !== user.sector)
          return errorResponse("Travel to the caravan's sector to sabotage it");
      }
      if (!role)
        return errorResponse(
          user.isOutlaw
            ? "Take up the Bandit profession first"
            : "You cannot act against caravans",
        );
      const minutes = getOperationMinutes(input.type, role, user.banditExperience);
      const finishesAt = secondsFromDate(minutes * MINUTE_S, now);
      if (target && (!target.arrivesAt || target.arrivesAt <= finishesAt))
        return errorResponse("The caravan arrives before your sabotage could finish");
      const ready = await claimOperatorReadiness(ctx.drizzle, user.userId, readiness);
      if (ready.rowsAffected !== 1)
        return errorResponse("Your state changed. Please try again");
      const operationId = nanoid();
      try {
        await insertOperation(ctx.drizzle, {
          id: operationId,
          userId: user.userId,
          role,
          type: input.type,
          caravanId: target?.id ?? null,
          sector: user.sector,
          succeeds: rollChance(getOperationChance(role, user)),
          startedAt: now,
          finishesAt,
        });
      } catch (error) {
        // The readiness claim already woke a recovering player.
        if (isMysqlDuplicateKeyError(error))
          return actionReadinessResponse(
            errorResponse("Finish your current operation first"),
            readiness,
            ctx.drizzle,
          );
        throw error;
      }
      if (target)
        notifyPlayers(
          ctx.drizzle,
          activeGuards(targetParticipants).map((p) => p.userId),
          {
            title: "Caravan sabotage",
            body: `${user.username} is sabotaging your caravan. Intervene within ${minutes} minutes!`,
            refresh: ["caravans"],
          },
        );
      return actionReadinessResponse(
        {
          success: true,
          message: `Operation started; it takes ${minutes} minutes`,
          operation: {
            id: operationId,
            type: input.type,
            status: "ACTIVE" as const,
            succeeds: null,
            sector: user.sector,
            finishesAt,
          },
        },
        readiness,
        ctx.drizzle,
      );
    }),
  track: protectedProcedure
    .meta({ mcp: { description: "Refresh the last known position of a caravan" } })
    .input(z.object({ caravanId: z.string() }))
    .output(
      baseServerResponse.extend({
        sighting: z
          .object({ caravanId: z.string(), sector: z.number().int(), seenAt: z.date() })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [discoveries, [target]] = await Promise.all([
        listUserDiscoveries(ctx.drizzle, ctx.userId, now),
        listCaravansByIds(ctx.drizzle, [input.caravanId]),
      ]);
      if (target?.status !== "TRAVELLING")
        return errorResponse("The caravan is not on the road");
      // Tracking follows a sighting; route intelligence alone needs a sector search first.
      if (!hasSighting(discoveries, target.id))
        return errorResponse(
          "Search the caravan's sector to sight it before tracking it",
        );
      const sector = getCaravanSector(target, now);
      const tracked = await trackDiscovery(ctx.drizzle, {
        caravanId: target.id,
        userId: ctx.userId,
        sector,
        now,
        seenBefore: secondsFromDate(-CARAVAN_TRACK_COOLDOWN_SECONDS, now),
        expiresAt: secondsFromDate(CARAVAN_DISCOVERY_MINUTES * MINUTE_S, now),
      });
      if (tracked.rowsAffected !== 1)
        return errorResponse(
          `You can track a caravan once every ${CARAVAN_TRACK_COOLDOWN_SECONDS / 60} minutes`,
        );
      return {
        success: true,
        message: `The caravan was last seen in sector ${sector}`,
        sighting: { caravanId: target.id, sector, seenAt: now },
      };
    }),
  formGroup: protectedProcedure
    .meta({ mcp: { description: "Form an interception group against a caravan" } })
    .input(z.object({ caravanId: z.string(), leaderId: z.string().optional() }))
    .output(
      baseServerResponse.extend({
        group: z
          .object({
            commitment: z.object({
              caravanId: z.string(),
              role: z.enum(CARAVAN_ROLES),
              userId: z.string(),
              groupLeaderId: z.string().nullable(),
            }),
            groups: z.array(
              z.object({
                leaderId: z.string(),
                leaderName: z.string(),
                role: z.enum(CARAVAN_ROLES).nullable(),
                villageId: z.string().nullable(),
                joinable: z.boolean(),
                members: z.array(
                  z.object({
                    userId: z.string(),
                    username: z.string(),
                    status: z.enum(UserStatuses),
                    sector: z.number().int(),
                    level: z.number().int(),
                  }),
                ),
              }),
            ),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [
        user,
        relationships,
        wars,
        discoveries,
        [target],
        participants,
        encounters,
      ] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listVillageRelationships(ctx.drizzle),
        listOpenWars(ctx.drizzle),
        listUserDiscoveries(ctx.drizzle, ctx.userId, now),
        listCaravansByIds(ctx.drizzle, [input.caravanId]),
        listCaravanParticipants(ctx.drizzle, [input.caravanId]),
        listOpenEncounters(ctx.drizzle, [input.caravanId]),
      ]);
      if (target?.status !== "TRAVELLING")
        return errorResponse("The caravan is not on the road");
      if (user.isBanned) return errorResponse("You are banned");
      const role = getAttackerRole(user, target.originVillageId, relationships, wars);
      if (!role) return errorResponse("You cannot attack this caravan");
      if (!hasSighting(discoveries, target.id))
        return errorResponse("Locate the caravan first");
      const leaderId = input.leaderId ?? user.userId;
      if (leaderId !== user.userId) {
        const group = groupsOf(participants, target.id).find(
          (g) => g.leaderId === leaderId,
        );
        if (!group || group.role !== role)
          return errorResponse("That group is gone or rides for the other side");
        if (role === "ENEMY" && group.villageId !== user.villageId)
          return errorResponse("Enemy shinobi ride with their own villagers");
        // A simultaneous join can take the last seat too; groups stay small either way.
        if (group.members.length >= CARAVAN_MAX_GROUP)
          return errorResponse("The group is full");
        // Settlement disbands only the raiders who fought, so a fighting group takes no one.
        if (
          encounters.some((e) => e.type === "INTERCEPTION" && e.leaderId === leaderId)
        )
          return errorResponse("That group is already fighting");
      }
      try {
        await upsertAttacker(ctx.drizzle, {
          caravanId: target.id,
          userId: user.userId,
          role,
          groupLeaderId: leaderId,
          now,
        });
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("You are already committed to another caravan");
        throw error;
      }
      const [[current], joinedRows] = await Promise.all([
        listCaravansByIds(ctx.drizzle, [target.id]),
        listCaravanParticipants(ctx.drizzle, [target.id]),
      ]);
      if (current?.status !== "TRAVELLING") {
        // Delivery released the group before this commitment landed; drop it too.
        await releaseParticipants(ctx.drizzle, target.id, { userIds: [user.userId] });
        return errorResponse("The caravan is not on the road");
      }
      const joined = joinedRows.find((p) => p.userId === user.userId);
      if (
        !joined?.activeUserId ||
        joined.role !== role ||
        joined.groupLeaderId !== leaderId
      )
        return errorResponse(
          "You already took a side on this journey or are in another group",
        );
      return {
        success: true,
        message:
          leaderId === user.userId
            ? "Interception group formed"
            : "You joined the group",
        group: {
          commitment: {
            caravanId: target.id,
            role,
            userId: user.userId,
            groupLeaderId: leaderId,
          },
          groups: describeGroups(joinedRows, target.id, role, {
            sighted: true,
            encounters,
            villageId: user.villageId,
          }),
        },
      };
    }),
  leaveGroup: protectedProcedure
    .meta({ mcp: { description: "Leave or disband your interception group" } })
    .input(z.object({ caravanId: z.string() }))
    .output(
      baseServerResponse.extend({
        left: z.object({ caravanId: z.string(), userId: z.string() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const participations = await listUserParticipations(ctx.drizzle, ctx.userId);
      const own = participations.find(
        (p) => p.caravanId === input.caravanId && p.activeUserId && p.role !== "GUARD",
      );
      if (!own) return errorResponse("You are not in an interception group");
      const encounters = await listOpenEncounters(ctx.drizzle, [own.caravanId]);
      if (
        encounters.some(
          (e) => e.type === "INTERCEPTION" && e.leaderId === own.groupLeaderId,
        )
      )
        return errorResponse("Your group is fighting");
      await releaseParticipants(
        ctx.drizzle,
        own.caravanId,
        own.groupLeaderId === ctx.userId
          ? { groupLeaderId: ctx.userId }
          : { userIds: [ctx.userId] },
      );
      return {
        success: true,
        message: "You left the group",
        left: { caravanId: own.caravanId, userId: ctx.userId },
      };
    }),
  attack: protectedProcedure
    .meta({ mcp: { description: "Lead your interception group against a caravan" } })
    .input(z.object({ caravanId: z.string() }))
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [user, [target], participants, discoveries, pool] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listCaravansByIds(ctx.drizzle, [input.caravanId]),
        listCaravanParticipants(ctx.drizzle, [input.caravanId]),
        listUserDiscoveries(ctx.drizzle, ctx.userId, now),
        listCaravanAi(ctx.drizzle),
      ]);
      // Interceptions end at arrival, like ambushes and sabotage, before delivery runs.
      if (
        target?.status !== "TRAVELLING" ||
        !target.arrivesAt ||
        target.arrivesAt <= now
      )
        return errorResponse("The caravan is not on the road");
      const group = groupsOf(participants, target.id).find(
        (g) => g.leaderId === user.userId,
      );
      if (!group?.role)
        return errorResponse("Only a group's leader launches its attack");
      if (!hasSighting(discoveries, target.id))
        return errorResponse("Locate the caravan first");
      const sector = getCaravanSector(target, now);
      const minimum =
        group.role === "BANDIT" ? CARAVAN_BANDIT_MIN_GROUP : CARAVAN_ENEMY_MIN_GROUP;
      if (group.members.length < minimum)
        return errorResponse(`Gather at least ${minimum} raiders`);
      if (group.members.some((m) => m.sector !== sector))
        return errorResponse(`Every raider must be in sector ${sector}`);
      if (target.lossBp >= CARAVAN_MAX_LOSS_BP)
        return errorResponse("This caravan has nothing left worth taking");
      // Escorts meet the raiders one for one; NPC guards fill the places of absent escorts,
      // one fewer while the caravan is disrupted.
      const guards = selectQueuedGuards(participants).slice(0, group.members.length);
      const disrupted = !!target.disruptedUntil && target.disruptedUntil > now;
      const npcCount = Math.max(
        guards.length === 0 ? 1 : 0,
        group.members.length - guards.length - (disrupted ? 1 : 0),
      );
      const level = Math.round(
        group.members.reduce((sum, m) => sum + m.level, 0) / group.members.length,
      );
      const npcGuards = pickCaravanAi(pool, npcCount, level);
      if (guards.length + npcGuards.length === 0)
        return errorResponse("No caravan guards are configured");
      const attackerIds = [
        user.userId,
        ...group.members.filter((m) => m.userId !== user.userId).map((m) => m.userId),
      ];
      const result = await launchCaravanBattle(ctx.drizzle, {
        leaderId: user.userId,
        state: {
          type: "INTERCEPTION",
          caravanId: target.id,
          attackerDirection: "left",
          attackerRole: group.role,
          attackerIds,
          guardIds: guards.map((g) => g.userId),
          cargo: target.cargo,
          lossBp: target.lossBp,
          stealBp: getStealBp(user.banditExperience),
        },
        userIds: attackerIds,
        targetIds: [...guards.map((g) => g.userId), ...npcGuards],
        cacheUserId: ctx.userId,
      });
      if (result.success)
        notifyPlayers(
          ctx.drizzle,
          activeGuards(participants).map((p) => p.userId),
          {
            title: "Caravan attacked",
            body: `${user.username}'s group attacks your caravan!`,
            route: "/combat",
          },
        );
      return result;
    }),
  claimLoot: protectedProcedure
    .meta({ mcp: { description: "Claim goods stolen in a successful robbery" } })
    .input(z.object({ caravanId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, participations, inventory] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listUserParticipations(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      const row = participations.find(
        (p) => p.caravanId === input.caravanId && p.loot && !p.lootClaimedAt,
      );
      if (!row?.loot) return errorResponse("No stolen goods to claim");
      const loot = row.loot;
      const items = await listWarehouseItems(
        ctx.drizzle,
        loot.map((line) => line.itemId),
      );
      const full = items.find((item) => {
        const bucket = getInventoryBucket(item);
        return (
          countInventoryBucketSlots(inventory, bucket) >=
          getInventoryBucketCapacity(bucket, user)
        );
      });
      const fullBackpack = new WarehouseConflict(
        full
          ? getInventoryBucketFullMessage(
              getInventoryBucket(full),
              countHeldInventorySlots(inventory, getInventoryBucket(full)),
            )
          : "Your backpack is full",
      );
      try {
        // The one-time claim and the backpack stacks it fills are separate rows; rolling
        // both back keeps the loot claimable when the backpack has no room.
        await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            const claimed = await claimLoot(
              tx,
              row.caravanId,
              ctx.userId,
              loot,
              new Date(),
            );
            if (claimed.rowsAffected !== 1)
              throw new WarehouseConflict("Already claimed");
            const { unstacked } = await grantUserItems(tx, ctx.userId, loot, {
              topUpOnly: !!full,
            });
            if (full && unstacked.length > 0) throw fullBackpack;
          }),
        );
      } catch (error) {
        if (error instanceof WarehouseConflict) return errorResponse(error.message);
        throw error;
      }
      return { success: true, message: "You claimed the stolen goods" };
    }),
  assaultMarker: protectedProcedure
    .meta({ mcp: { description: "Assault a trade route marker in your sector" } })
    .input(z.object({ markerId: z.string() }))
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [user, marker, relationships, wars, pool] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findMarker(ctx.drizzle, input.markerId),
        listVillageRelationships(ctx.drizzle),
        listOpenWars(ctx.drizzle),
        listCaravanAi(ctx.drizzle),
      ]);
      if (marker?.status !== "ACTIVE") return errorResponse("Marker not found");
      const discoveries = user.villageId
        ? await listMarkerDiscoveries(ctx.drizzle, user.villageId, now)
        : [];
      const known = discoveries.some((row) => row.markerId === marker.id);
      const block = getMarkerAssaultBlock(user, marker, relationships, wars, known);
      if (block) return errorResponse(block);
      const isRouteVillage = [marker.villageIdA, marker.villageIdB].includes(
        user.villageId ?? "",
      );
      const guards = pickCaravanAi(pool, TRADE_ROUTE_MARKER_GUARDS, user.level);
      if (guards.length === 0) return errorResponse("No marker guards are configured");
      return launchCaravanBattle(ctx.drizzle, {
        leaderId: user.userId,
        state: {
          type: "MARKER_ASSAULT",
          markerId: marker.id,
          attackerDirection: "left",
          attackerIds: [user.userId],
          captureVillageId: isRouteVillage ? null : user.villageId,
          markerControllerId: marker.controllerVillageId,
        },
        userIds: [user.userId],
        targetIds: guards,
        scaleTarget: true,
        cacheUserId: ctx.userId,
      });
    }),
});

/**
 * A caravan's interception groups riding for a side, each marked joinable when formGroup's
 * join guards would accept the viewer, so the controls offer only joins it accepts.
 */
const describeGroups = (
  participants: Awaited<ReturnType<typeof listCaravanParticipants>>,
  caravanId: string,
  role: CaravanRole | null,
  viewer: {
    sighted: boolean;
    encounters: Awaited<ReturnType<typeof listOpenEncounters>>;
    villageId: string | null;
  },
) =>
  groupsOf(participants, caravanId)
    .filter((group) => group.role === role)
    .map((group) => ({
      ...group,
      joinable:
        viewer.sighted &&
        group.members.length < CARAVAN_MAX_GROUP &&
        (role === "BANDIT" || group.villageId === viewer.villageId) &&
        !viewer.encounters.some(
          (e) =>
            e.caravanId === caravanId &&
            e.type === "INTERCEPTION" &&
            e.leaderId === group.leaderId,
        ),
    }));

/** Interception groups of a caravan by leader, with their members' details. */
const groupsOf = (
  participants: Awaited<ReturnType<typeof listCaravanParticipants>>,
  caravanId: string,
) => {
  const raiders = participants.filter(
    (p) =>
      p.caravanId === caravanId &&
      p.activeUserId &&
      p.role !== "GUARD" &&
      p.groupLeaderId,
  );
  return [...groupBy(raiders, "groupLeaderId")].map(([leaderId, members]) => {
    const leader = members.find((p) => p.userId === leaderId);
    return {
      leaderId: leaderId as string,
      leaderName: leader?.username ?? "Unknown",
      role: leader?.role ?? null,
      villageId: leader?.villageId ?? null,
      members: members.map((p) => ({
        userId: p.userId,
        username: p.username,
        status: p.status,
        sector: p.sector,
        level: p.level,
      })),
    };
  });
};

/** Whether a player still knows where a caravan is. */
const hasSighting = (discoveries: CaravanDiscovery[], caravanId: string) =>
  discoveries.some((row) => row.caravanId === caravanId && row.kind === "LOCATION");

/**
 * Why a player cannot assault a marker. Hostile villages wear down markers their enemies'
 * route holds; a route's own villages retake markers held by outsiders.
 */
const getMarkerAssaultBlock = (
  user: UserData,
  marker: {
    sector: number;
    controllerVillageId: string | null;
    villageIdA: string;
    villageIdB: string;
  },
  relationships: VillageAlliance[],
  wars: { attackerVillageId: string; defenderVillageId: string }[],
  known: boolean,
) => {
  if (user.isBanned) return "You are banned";
  if (user.isOutlaw || !user.villageId)
    return "Only village shinobi fight over trade routes";
  if (user.sector !== marker.sector) return "Travel to the marker's sector";
  const villageId = user.villageId;
  const isRouteVillage = [marker.villageIdA, marker.villageIdB].includes(villageId);
  if (isRouteVillage)
    return marker.controllerVillageId ? null : "Your village already holds this marker";
  if (!known) return "Discover the marker by searching this sector first";
  if (marker.controllerVillageId === villageId)
    return "Your village already holds this marker";
  const holders = marker.controllerVillageId
    ? [marker.controllerVillageId]
    : [marker.villageIdA, marker.villageIdB];
  const hostile = holders.some(
    (holder) => getAttackerRole(user, holder, relationships, wars) === "ENEMY",
  );
  return hostile ? null : "Only enemies of the holding village can assault it";
};
