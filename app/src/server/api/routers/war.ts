import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { RouterOutputs } from "@/app/_trpc/client";
import {
  ELDER_MIN_VOTING_COUNT,
  ELDER_WAR_VOTE_HOURS,
  IMG_AVATAR_DEFAULT,
  MAP_RESERVED_SECTORS,
  SHRINE_MAX_PER_VILLAGE,
  VILLAGE_SYNDICATE_ID,
  WAR_ALLY_MAX_PAYMENT_PERCENTAGE,
  WAR_DECLARATION_COOLDOWN_HOURS,
  WAR_DECLARATION_COST,
  WAR_FACTION_MAX_SECTORS,
  WAR_LOSING_COOLDOWN_DAYS,
  WAR_MINIMUM_MEMBERS_REQUIRED,
  WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  WAR_RAID_SHRINE_HP,
  WAR_VILLAGE_MAX_SECTORS,
} from "@/drizzle/constants";
import type { Village, VillageStructure, War, WarAlly } from "@/drizzle/schema";
import {
  actionLog,
  notification,
  quest,
  sector,
  userData,
  userRequest,
  village,
  villageElderVote,
  war,
  warAlly,
  warKill,
} from "@/drizzle/schema";
import { castElderVoteEntry, fetchElderVote, fetchElderVotes } from "@/libs/elder";
import { findActiveExclusiveRaidForSector } from "@/libs/raids";
import {
  canJoinWar,
  getShrineHpByLevel,
  handleWarEnd,
  isVillageInvolvedInAnyWar,
} from "@/libs/war";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import {
  fetchRequest,
  fetchRequests,
  insertRequest,
  updateRequestState,
} from "@/routers/sparring";
import {
  countVillageSectors,
  fetchAlliances,
  fetchSector,
  fetchStructures,
  fetchVillage,
  fetchVillages,
} from "@/routers/village";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { findRelationship } from "@/utils/alliance";
import { isKage } from "@/utils/kage";
import { canAdministrateWars, canSeeSecretData } from "@/utils/permissions";
import { DAY_S, secondsFromDate, secondsFromNow } from "@/utils/time";
import {
  type AdminEndWarSnapshot,
  adminEndWarInputSchema,
  adminEndWarSnapshotSchema,
  getAdminEndWarRevision,
  type SurrenderParticipationRole,
  surrenderActorSnapshotSchema,
  surrenderWarAllySnapshotSchema,
  surrenderWarInputSchema,
} from "@/validators/war";

const writeRowsAffected = (result: unknown): number => {
  if (Array.isArray(result)) return writeRowsAffected(result[0]);
  if (!result || typeof result !== "object") return 0;
  if ("rowsAffected" in result && typeof result.rowsAffected === "number") {
    return result.rowsAffected;
  }
  if ("affectedRows" in result && typeof result.affectedRows === "number") {
    return result.affectedRows;
  }
  return 0;
};

export const warRouter = createTRPCRouter({
  // Get active wars for a village
  getActiveWars: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get active wars for a village" },
    })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await fetchActiveWars(ctx.drizzle, input.villageId);
    }),

  // Get ended wars for a village
  getEndedWars: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get ended wars for a village" },
    })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return fetchEndedWars(ctx.drizzle, input.villageId);
    }),

  adminEndWar: protectedProcedure
    .input(adminEndWarInputSchema)
    .output(
      baseServerResponse.extend({
        requestId: z.string().uuid().optional(),
        warId: z.string().optional(),
        warType: z.enum(["VILLAGE_WAR", "SECTOR_WAR", "WAR_RAID"]).optional(),
        expectedRevision: z.string().optional(),
        previousStatus: z.literal("ACTIVE").optional(),
        outcome: z.literal("ADMIN_ENDED").optional(),
        removedWarKillCount: z.number().int().nonnegative().optional(),
        removedWarAllyCount: z.number().int().nonnegative().optional(),
        removedAllyOfferCount: z.number().int().nonnegative().optional(),
        clearedParticipantCount: z.number().int().nonnegative().optional(),
        auditLogId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const requestId = input.requestId ?? crypto.randomUUID();
      const auditLogId = `admin-end-war:${requestId}`;

      const snapshotWar = (currentWar: War): AdminEndWarSnapshot => ({
        id: currentWar.id,
        attackerVillageId: currentWar.attackerVillageId,
        defenderVillageId: currentWar.defenderVillageId,
        startedAt: currentWar.startedAt.toISOString(),
        endedAt: currentWar.endedAt?.toISOString() ?? null,
        status: currentWar.status,
        type: currentWar.type,
        sector: currentWar.sector,
        attackerShrineHp: currentWar.attackerShrineHp,
        attackerShrineMaxHp: currentWar.attackerShrineMaxHp,
        attackerShrineStatus: currentWar.attackerShrineStatus,
        defenderShrineHp: currentWar.defenderShrineHp,
        defenderShrineMaxHp: currentWar.defenderShrineMaxHp,
        defenderShrineStatus: currentWar.defenderShrineStatus,
        lastTokenReductionAt: currentWar.lastTokenReductionAt.toISOString(),
        targetStructureRoute: currentWar.targetStructureRoute,
        attackerWarHealth: currentWar.attackerWarHealth,
        defenderWarHealth: currentWar.defenderWarHealth,
        attackerWarHealthMax: currentWar.attackerWarHealthMax,
        defenderWarHealthMax: currentWar.defenderWarHealthMax,
      });

      const exactSnapshot = (left: AdminEndWarSnapshot, right: AdminEndWarSnapshot) =>
        JSON.stringify(left) === JSON.stringify(right);
      const rowsAffected = (result: unknown) => {
        if (Array.isArray(result)) return rowsAffected(result[0]);
        if (!result || typeof result !== "object") return 0;
        if ("rowsAffected" in result && typeof result.rowsAffected === "number") {
          return result.rowsAffected;
        }
        if ("affectedRows" in result && typeof result.affectedRows === "number") {
          return result.affectedRows;
        }
        return 0;
      };

      type AdminEndWarReceipt = {
        version: 1;
        requestId: string;
        actorUserId: string;
        expectedRevision: string;
        expectedWar: AdminEndWarSnapshot;
        outcome: "ADMIN_ENDED";
        removedWarKillCount: number;
        removedWarAllyCount: number;
        removedAllyOfferCount: number;
        clearedParticipantCount: number;
      };

      const responseFromReceipt = (receipt: AdminEndWarReceipt) => ({
        success: true as const,
        message: "War ended successfully",
        requestId: receipt.requestId,
        warId: receipt.expectedWar.id,
        warType: receipt.expectedWar.type,
        expectedRevision: receipt.expectedRevision,
        previousStatus: "ACTIVE" as const,
        outcome: receipt.outcome,
        removedWarKillCount: receipt.removedWarKillCount,
        removedWarAllyCount: receipt.removedWarAllyCount,
        removedAllyOfferCount: receipt.removedAllyOfferCount,
        clearedParticipantCount: receipt.clearedParticipantCount,
        auditLogId,
      });

      return ctx.drizzle.transaction(async (tx) => {
        // War-first is the global lock order shared with normal resolution. This prevents an
        // admin participant from holding their UserData row while waiting on a resolver which
        // already owns the War row and will later update participant state.
        await tx.execute(
          sql`SELECT ${war.id} FROM ${war} WHERE ${war.id} = ${input.warId} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} = ${ctx.userId} FOR UPDATE`,
        );
        const actor = await tx.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
        });
        if (!actor) return errorResponse("User not found");
        if (actor.isBanned) {
          return errorResponse("You are banned and cannot administratively end wars");
        }
        if (!canAdministrateWars(actor.role)) {
          return errorResponse("You are not authorized to end wars");
        }

        // Lock the request receipt after War and actor so concurrent retries cannot both delete.
        await tx.execute(
          sql`SELECT ${actionLog.id} FROM ${actionLog} WHERE ${actionLog.id} = ${auditLogId} FOR UPDATE`,
        );

        const previousRequest = await tx.query.actionLog.findFirst({
          where: eq(actionLog.id, auditLogId),
        });
        if (previousRequest) {
          const parsedReceipt = z
            .object({
              version: z.literal(1),
              requestId: z.string().uuid(),
              actorUserId: z.string(),
              expectedRevision: z.string(),
              expectedWar: adminEndWarSnapshotSchema,
              outcome: z.literal("ADMIN_ENDED"),
              removedWarKillCount: z.number().int().nonnegative(),
              removedWarAllyCount: z.number().int().nonnegative(),
              removedAllyOfferCount: z.number().int().nonnegative(),
              clearedParticipantCount: z.number().int().nonnegative(),
            })
            .safeParse(previousRequest.changes);
          const receipt = parsedReceipt.success ? parsedReceipt.data : undefined;
          const exactReplay =
            receipt &&
            previousRequest.userId === actor.userId &&
            previousRequest.tableName === "War" &&
            previousRequest.relatedId === input.warId &&
            receipt.actorUserId === actor.userId &&
            receipt.requestId === requestId &&
            (!input.expectedWar ||
              exactSnapshot(receipt.expectedWar, input.expectedWar)) &&
            (!input.expectedRevision ||
              receipt.expectedRevision === input.expectedRevision);
          if (!exactReplay) {
            return errorResponse("Invalid administrative war-end request ID");
          }
          // A receipt proves the earlier transaction committed, but replay is only successful
          // while its terminal state is still true. Never let an old receipt hide a recreated war
          // or orphaned child/offer state for the same target.
          await tx.execute(
            sql`SELECT ${warKill.id} FROM ${warKill} WHERE ${warKill.warId} = ${input.warId} ORDER BY ${warKill.id} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT ${warAlly.id} FROM ${warAlly} WHERE ${warAlly.warId} = ${input.warId} ORDER BY ${warAlly.id} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT ${userRequest.id} FROM ${userRequest} WHERE ${userRequest.relatedId} = ${input.warId} AND ${userRequest.type} = 'WAR_ALLY' ORDER BY ${userRequest.id} FOR UPDATE`,
          );
          const replayWar = await tx.query.war.findFirst({
            where: eq(war.id, input.warId),
            columns: { id: true },
          });
          const replayKill = await tx.query.warKill.findFirst({
            where: eq(warKill.warId, input.warId),
            columns: { id: true },
          });
          const replayAlly = await tx.query.warAlly.findFirst({
            where: eq(warAlly.warId, input.warId),
            columns: { id: true },
          });
          const replayOffer = await tx.query.userRequest.findFirst({
            where: and(
              eq(userRequest.relatedId, input.warId),
              eq(userRequest.type, "WAR_ALLY"),
            ),
            columns: { id: true },
          });
          if (replayWar || replayKill || replayAlly || replayOffer) {
            return errorResponse(
              "Administrative war-end receipt no longer matches current state",
            );
          }
          return responseFromReceipt(receipt);
        }

        const currentWar = await tx.query.war.findFirst({
          where: eq(war.id, input.warId),
        });
        if (!currentWar) return errorResponse("War not found");
        if (currentWar.status !== "ACTIVE" || currentWar.endedAt !== null) {
          return errorResponse("War is no longer active. Refresh and try again");
        }

        const currentSnapshot = snapshotWar(currentWar);
        const expectedWar = input.expectedWar ?? currentSnapshot;
        const expectedRevision =
          input.expectedRevision ?? getAdminEndWarRevision(expectedWar);
        if (
          getAdminEndWarRevision(expectedWar) !== expectedRevision ||
          !exactSnapshot(currentSnapshot, expectedWar)
        ) {
          return errorResponse("War state changed. Refresh before ending it");
        }

        // Lock child ranges before counting/deleting them. This includes empty indexed ranges so
        // already-started ally/kill inserts cannot slip between the snapshot and cleanup.
        await tx.execute(
          sql`SELECT ${warKill.id} FROM ${warKill} WHERE ${warKill.warId} = ${input.warId} ORDER BY ${warKill.id} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT ${warAlly.id} FROM ${warAlly} WHERE ${warAlly.warId} = ${input.warId} ORDER BY ${warAlly.id} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT ${userRequest.id} FROM ${userRequest} WHERE ${userRequest.relatedId} = ${input.warId} AND ${userRequest.type} = 'WAR_ALLY' ORDER BY ${userRequest.id} FOR UPDATE`,
        );

        const warKills = await tx.query.warKill.findMany({
          where: eq(warKill.warId, input.warId),
          columns: { id: true },
        });
        const warAllies = await tx.query.warAlly.findMany({
          where: eq(warAlly.warId, input.warId),
          columns: { id: true, villageId: true },
        });
        const allyOffers = await tx.query.userRequest.findMany({
          where: and(
            eq(userRequest.relatedId, input.warId),
            eq(userRequest.type, "WAR_ALLY"),
          ),
          columns: { id: true },
        });

        await tx.delete(warKill).where(eq(warKill.warId, input.warId));
        await tx.delete(warAlly).where(eq(warAlly.warId, input.warId));
        await tx
          .delete(userRequest)
          .where(
            and(
              eq(userRequest.relatedId, input.warId),
              eq(userRequest.type, "WAR_ALLY"),
            ),
          );
        const deletedWar = await tx
          .delete(war)
          .where(and(eq(war.id, input.warId), eq(war.status, "ACTIVE")));
        if (rowsAffected(deletedWar) !== 1) {
          throw serverError(
            "CONFLICT",
            "War state changed while it was being ended. Refresh and try again",
          );
        }

        // Clear participation only when a village has no other active war. No village tokens,
        // sector ownership, structures, rewards, or win/loss status are changed by an admin end.
        const participantVillageIds = [
          currentWar.attackerVillageId,
          currentWar.defenderVillageId,
          ...warAllies.map((ally) => ally.villageId),
        ];
        const clearedParticipants = await tx
          .update(userData)
          .set({ warParticipantUntil: new Date(0) })
          .where(
            and(
              inArray(userData.villageId, participantVillageIds),
              sql`NOT EXISTS (
                SELECT 1 FROM War w
                WHERE w.endedAt IS NULL
                  AND (w.attackerVillageId = ${userData.villageId} OR w.defenderVillageId = ${userData.villageId})
              )`,
              sql`NOT EXISTS (
                SELECT 1 FROM WarAlly wa
                INNER JOIN War w ON wa.warId = w.id
                WHERE w.endedAt IS NULL AND wa.villageId = ${userData.villageId}
              )`,
            ),
          );

        const receipt: AdminEndWarReceipt = {
          version: 1,
          requestId,
          actorUserId: actor.userId,
          expectedRevision,
          expectedWar,
          outcome: "ADMIN_ENDED",
          removedWarKillCount: warKills.length,
          removedWarAllyCount: warAllies.length,
          removedAllyOfferCount: allyOffers.length,
          clearedParticipantCount: rowsAffected(clearedParticipants),
        };
        await tx.insert(actionLog).values({
          id: auditLogId,
          userId: actor.userId,
          tableName: "War",
          changes: receipt,
          relatedId: input.warId,
          relatedMsg: `Administratively ended ${currentWar.type}`,
          relatedImage: IMG_AVATAR_DEFAULT,
        });

        return responseFromReceipt(receipt);
      });
    }),

  buildShrine: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Build a shrine to claim a sector" },
    })
    .input(z.object({ warId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWar, exclusiveRaids] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWar(ctx.drizzle, input.warId),
        // Fetch all exclusive raids (filter by sector after we know the war's sector)
        ctx.drizzle.query.quest.findMany({
          where: and(eq(quest.questType, "raid"), eq(quest.hidden, false)),
        }),
      ]);

      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to build a shrine");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to build a shrine");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can build shrines");
      }
      if (!activeWar) {
        return errorResponse("War not found");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (activeWar.type !== "SECTOR_WAR") {
        return errorResponse("War is not a sector war");
      }
      if (activeWar.defenderShrineHp > 0) {
        return errorResponse("Shrine is still standing");
      }
      if (MAP_RESERVED_SECTORS.includes(activeWar.sector)) {
        return errorResponse("Shrine cannot be built on reserved sectors");
      }

      // Check if there's an active exclusive raid for this sector that must be completed first
      const activeExclusiveRaid = findActiveExclusiveRaidForSector(
        exclusiveRaids,
        activeWar.sector,
      );

      if (activeExclusiveRaid) {
        return errorResponse(
          "You must defeat the raid boss before claiming this sector! Check the shrine page to join the raid.",
        );
      }

      if (user.village.tokens < WAR_PURCHASE_SHRINE_TOKEN_COST) {
        return errorResponse(
          `Your village needs ${WAR_PURCHASE_SHRINE_TOKEN_COST} tokens to build a shrine`,
        );
      }
      if (activeWar.attackerVillageId !== user.villageId) {
        return errorResponse("Only the attacking village can build shrines");
      }

      // The purchase and forced sector-war outcome share the War-row lock and transaction. An
      // admin cleanup or another resolver can therefore win, but cannot interleave side effects.
      const endedWar = await handleWarEnd(activeWar, {
        client: ctx.drizzle,
        forcedLoserVillageId: activeWar.defenderVillageId,
        villageTokenSpend: {
          villageId: user.villageId,
          amount: WAR_PURCHASE_SHRINE_TOKEN_COST,
        },
      });
      if (!endedWar) {
        return errorResponse(
          "War state or village tokens changed. Refresh before building the shrine",
        );
      }
      return { success: true, message: "Shrine built successfully" };
    }),

  declareSectorWar: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Declare a sector war on a map sector",
      },
    })
    .input(z.object({ sectorId: z.number(), userVillageId: z.string().nullable() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWars, villages, relationships, targetSector, sectorCount] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
          }),
          fetchActiveWars(ctx.drizzle),
          fetchVillages(ctx.drizzle),
          fetchAlliances(ctx.drizzle),
          fetchSector(ctx.drizzle, input.sectorId),
          countVillageSectors(ctx.drizzle, input.userVillageId),
        ]);
      // Derived
      const now = new Date();
      const attackerVillage = villages.find((v) => v.id === user?.village?.id);
      const defenderVillage = villages.find((v) => v.id === targetSector?.villageId);
      const defenderVillageId = defenderVillage?.id || VILLAGE_SYNDICATE_ID;

      // Check minimum member count for war participation (after we know village IDs)
      const [attackerMemberCount, actualDefenderCount] = await Promise.all([
        attackerVillage ? getVillageMemberCount(ctx.drizzle, attackerVillage.id) : 0,
        defenderVillage ? getVillageMemberCount(ctx.drizzle, defenderVillage.id) : 0,
      ]);
      const relationship = findRelationship(
        relationships,
        attackerVillage?.id || "",
        defenderVillageId,
      );
      const activeSectorWars = activeWars.filter(
        (w) =>
          (w.attackerVillageId === user?.village?.id ||
            w.defenderVillageId === user?.village?.id) &&
          w.type === "SECTOR_WAR",
      );
      const sectorVillage = villages.find((v) => v.sector === input.sectorId);
      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to declare war");
      }
      if (sectorVillage) {
        return errorResponse("This sector is already occupied");
      }
      if (input.userVillageId && input.userVillageId !== user.villageId) {
        return errorResponse(
          "Your village does not seem to match that on your profile",
        );
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to declare war");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the leader can declare sector wars");
      }
      if (user.village.tokens < WAR_DECLARATION_COST) {
        return errorResponse(
          `Your village needs ${WAR_DECLARATION_COST.toLocaleString()} tokens to declare war`,
        );
      }
      if (!attackerVillage) {
        return errorResponse("Village not found");
      }
      if (relationship && relationship?.status !== "ENEMY") {
        return errorResponse("You can only declare war on enemy villages");
      }
      if (MAP_RESERVED_SECTORS.includes(input.sectorId)) {
        return errorResponse("This sector is reserved and cannot be claimed");
      }
      if (
        targetSector &&
        attackerVillage.warExhaustionEndedAt &&
        attackerVillage.warExhaustionEndedAt > now
      ) {
        return errorResponse("Your village is under war exhaustion");
      }
      if (attackerVillage.id === defenderVillageId) {
        return errorResponse("You cannot declare sector war on your own sector");
      }
      if (
        activeWars.find(
          (w) =>
            w.attackerVillageId === user?.village?.id && w.sector === input.sectorId,
        )
      ) {
        return errorResponse("You are already at war for this sector");
      }
      if (activeSectorWars.length > 0) {
        return errorResponse(
          `You are already in a sector war for sector ${activeSectorWars.map((w) => w.sector).join(", ")}`,
        );
      }
      if (activeSectorWars.length >= SHRINE_MAX_PER_VILLAGE) {
        return errorResponse(
          `You can only own ${SHRINE_MAX_PER_VILLAGE} sectors at a time`,
        );
      }
      if (user.isOutlaw && sectorCount >= WAR_FACTION_MAX_SECTORS) {
        return errorResponse(
          `Your faction has too many sectors. Can max own ${WAR_FACTION_MAX_SECTORS} sectors`,
        );
      }
      if (!user.isOutlaw && sectorCount >= WAR_VILLAGE_MAX_SECTORS) {
        return errorResponse(
          `Your village has too many sectors. Can max own ${WAR_VILLAGE_MAX_SECTORS} sectors`,
        );
      }
      if (
        activeWars.find(
          (w) =>
            (w.attackerVillageId === user?.village?.id &&
              w.defenderVillageId === defenderVillageId) ||
            (w.attackerVillageId === defenderVillageId &&
              w.defenderVillageId === user?.village?.id),
        )
      ) {
        return errorResponse("You are already at war against the owner village.");
      }

      // Check if attacker village is already involved in any active war
      if (
        isVillageInvolvedInAnyWar(activeWars, user?.village?.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Your village is already involved in an active war");
      }

      // Check if target village is already involved in any active war
      if (
        isVillageInvolvedInAnyWar(activeWars, defenderVillageId, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Target village is already involved in an active war");
      }

      // Check minimum member count for war participation
      if (attackerVillage && attackerMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Your village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to declare sector war`,
        );
      }
      if (defenderVillage && actualDefenderCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Target village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to be attacked`,
        );
      }

      // Re-check just before creation to avoid races
      if (
        isVillageInvolvedInAnyWar(activeWars, attackerVillage.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ]) ||
        isVillageInvolvedInAnyWar(activeWars, defenderVillageId, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("A village is now already involved in an active war");
      }

      // Create war and deduct tokens
      const warId = nanoid();
      const [updateResult] = await Promise.all([
        ctx.drizzle
          .update(village)
          .set({ tokens: attackerVillage.tokens - WAR_DECLARATION_COST })
          .where(
            and(
              eq(village.id, user.villageId),
              gte(village.tokens, WAR_DECLARATION_COST),
            ),
          ),
        ctx.drizzle.insert(war).values({
          id: warId,
          attackerVillageId: user.villageId,
          defenderVillageId: defenderVillageId,
          status: "ACTIVE",
          type: "SECTOR_WAR",
          sector: input.sectorId,
          // Sector wars only have a defender shrine (the sector's shrine)
          attackerShrineHp: 0,
          attackerShrineMaxHp: 0,
          attackerShrineStatus: "CAPTURED",
          defenderShrineHp: getShrineHpByLevel(targetSector?.shrineLevel),
          defenderShrineMaxHp: getShrineHpByLevel(targetSector?.shrineLevel),
          defenderShrineStatus: "ACTIVE",
        }),
        ctx.drizzle.insert(notification).values({
          userId: user.userId,
          content: `${attackerVillage?.name} has declared a sector war in sector ${input.sectorId}`,
        }),
        ctx.drizzle
          .update(userData)
          .set({ unreadNotifications: sql`unreadNotifications + 1` })
          .where(
            inArray(
              userData.villageId,
              [user.villageId, defenderVillageId].filter((v) => v),
            ),
          ),
        ...(!targetSector
          ? [
              ctx.drizzle.insert(sector).values({
                sector: input.sectorId,
                villageId: defenderVillageId,
              }),
            ]
          : []),
      ]);
      if (updateResult.rowsAffected === 0) {
        await ctx.drizzle.delete(war).where(eq(war.id, warId));
        return errorResponse("Not enough tokens to declare sector war");
      }
      return {
        success: true,
        message: "Sector war declared successfully",
      };
    }),

  // Declare war on another village
  declareVillageWarOrRaid: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Declare village war or raid" },
    })
    .input(
      z.object({
        targetVillageId: z.string(),
        targetStructureRoute: z.string(),
        userVillageId: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Single pre-fetch round: user, war state, village data, and elder/cooldown checks all in parallel
      const [
        { user },
        activeWars,
        villages,
        relationships,
        structures,
        attackerMemberCount,
        defenderMemberCount,
        recentRejection,
        existingPending,
        elders,
      ] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchActiveWars(ctx.drizzle),
        fetchVillages(ctx.drizzle),
        fetchAlliances(ctx.drizzle),
        fetchStructures(ctx.drizzle, input.targetVillageId),
        getVillageMemberCount(ctx.drizzle, input.userVillageId),
        getVillageMemberCount(ctx.drizzle, input.targetVillageId),
        ctx.drizzle.query.villageElderVote.findFirst({
          columns: { endsAt: true },
          where: and(
            eq(villageElderVote.villageId, input.userVillageId),
            eq(villageElderVote.type, "WAR_DECLARATION"),
            eq(villageElderVote.status, "REJECTED"),
            gte(
              villageElderVote.endsAt,
              secondsFromNow(-WAR_DECLARATION_COOLDOWN_HOURS * 3600),
            ),
          ),
          orderBy: desc(villageElderVote.endsAt),
        }),
        ctx.drizzle.query.villageElderVote.findFirst({
          columns: { id: true },
          where: and(
            eq(villageElderVote.villageId, input.userVillageId),
            eq(villageElderVote.type, "WAR_DECLARATION"),
            eq(villageElderVote.status, "PENDING"),
          ),
        }),
        ctx.drizzle.query.userData.findMany({
          columns: { userId: true },
          where: and(
            eq(userData.villageId, input.userVillageId),
            eq(userData.rank, "ELDER"),
            eq(userData.isAi, false),
          ),
        }),
      ]);
      // Derived
      const now = new Date();
      const attackerVillage = villages.find((v) => v.id === user?.village?.id);
      const defenderVillage = villages.find((v) => v.id === input.targetVillageId);
      const relationship = findRelationship(
        relationships,
        attackerVillage?.id || "",
        defenderVillage?.id || "",
      );
      const targetIsOutlaw = ["TOWN", "HIDEOUT", "OUTLAW"].includes(
        defenderVillage?.type || "",
      );
      const isRaid = user?.isOutlaw || targetIsOutlaw;
      const warType = isRaid ? "WAR_RAID" : "VILLAGE_WAR";
      const relationshipStatus = isRaid ? "ENEMY" : relationship?.status;
      const structure = structures.find((s) => s.route === input.targetStructureRoute);
      // Exclude the kage (war initiator) from the elder count
      const eligibleElders = elders.filter((e) => e.userId !== user?.userId);

      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to declare war");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to declare war");
      }
      if (user.villageId !== input.userVillageId) {
        return errorResponse("Village mismatch — please refresh and try again");
      }
      if (!structure) {
        return errorResponse("Structure not found");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the leader can declare war");
      }
      if (recentRejection) {
        const cooldownEnd = new Date(
          recentRejection.endsAt.getTime() +
            WAR_DECLARATION_COOLDOWN_HOURS * 3600 * 1000,
        );
        return errorResponse(
          `War declaration is on cooldown after a recent rejection or cancellation. Available again at ${cooldownEnd.toUTCString()}.`,
        );
      }
      if (existingPending) {
        return errorResponse("Your village already has a pending war declaration vote");
      }

      if (user.village.tokens < WAR_DECLARATION_COST) {
        return errorResponse(
          `Your village needs ${WAR_DECLARATION_COST.toLocaleString()} tokens to declare war`,
        );
      }
      if (!attackerVillage || !defenderVillage) {
        return errorResponse("Village not found");
      }
      if (relationshipStatus !== "ENEMY") {
        return errorResponse("You can only declare war on enemy villages");
      }
      if (!["VILLAGE", "TOWN", "HIDEOUT"].includes(attackerVillage.type)) {
        return errorResponse("You cannot declare war on this type of village");
      }
      if (!["VILLAGE", "TOWN", "HIDEOUT"].includes(defenderVillage.type)) {
        return errorResponse("You cannot declare war on this type of village");
      }
      if (defenderVillage.tokens < WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE) {
        return errorResponse(
          `Target village needs ${WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE.toLocaleString()} tokens to declare war`,
        );
      }
      if (!attackerVillage.allianceSystem && warType === "VILLAGE_WAR") {
        return errorResponse("Your village is not part of the alliance system");
      }
      if (!defenderVillage.allianceSystem && warType === "VILLAGE_WAR") {
        return errorResponse("Target village is not part of the alliance system");
      }
      if (
        attackerVillage.warExhaustionEndedAt &&
        attackerVillage.warExhaustionEndedAt > now
      ) {
        return errorResponse("Your village is under war exhaustion");
      }
      if (
        defenderVillage.warExhaustionEndedAt &&
        defenderVillage.warExhaustionEndedAt > now
      ) {
        return errorResponse("Target village is under war exhaustion");
      }
      if (attackerVillage.id === defenderVillage.id) {
        return errorResponse("You cannot declare war on your own village");
      }
      if (
        activeWars.find(
          (w) =>
            (w.type === "VILLAGE_WAR" &&
              w.attackerVillageId === user?.village?.id &&
              w.defenderVillageId === input.targetVillageId) ||
            (w.type === "VILLAGE_WAR" &&
              w.attackerVillageId === input.targetVillageId &&
              w.defenderVillageId === user?.village?.id),
        )
      ) {
        return errorResponse("You are already at war with this village");
      }
      if (
        activeWars.find((w) =>
          w.warAllies.some(
            (f) =>
              f.villageId === user?.village?.id &&
              f.supportVillageId === input.targetVillageId,
          ),
        )
      ) {
        return errorResponse("You are already supporting this village");
      }
      if (
        activeWars.find(
          (w) =>
            w.type === "WAR_RAID" &&
            w.attackerVillageId === user?.village?.id &&
            w.defenderVillageId === input.targetVillageId &&
            w.targetStructureRoute === input.targetStructureRoute,
        )
      ) {
        return errorResponse("You are already raiding this village structure");
      }

      // Check if attacker village is already involved in any active war
      if (
        isVillageInvolvedInAnyWar(activeWars, user?.village?.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Your village is already involved in an active war");
      }

      // Check if target village is already involved in any active war
      if (
        isVillageInvolvedInAnyWar(activeWars, input.targetVillageId, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Target village is already involved in an active war");
      }

      // Check minimum member count for war participation
      if (attackerMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Your village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to declare war`,
        );
      }
      if (defenderMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Target village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to be attacked`,
        );
      }

      // Re-check just before creation to avoid races
      if (
        isVillageInvolvedInAnyWar(activeWars, attackerVillage.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ]) ||
        isVillageInvolvedInAnyWar(activeWars, defenderVillage.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("A village is now already involved in an active war");
      }

      // Require minimum elder count to proceed with war declaration
      if (eligibleElders.length < ELDER_MIN_VOTING_COUNT)
        return errorResponse(
          `At least ${ELDER_MIN_VOTING_COUNT} elders must be in position before war can be declared`,
        );

      // Insert vote — existingPending guard above prevents concurrent dupes
      const voteId = nanoid();
      const endsAt = secondsFromNow(ELDER_WAR_VOTE_HOURS * 3600);
      await ctx.drizzle.insert(villageElderVote).values({
        id: voteId,
        villageId: user.villageId,
        type: "WAR_DECLARATION",
        initiatedByUserId: user.userId,
        targetId: input.targetVillageId,
        warType: warType,
        targetStructureRoute: structure.route,
        status: "PENDING",
        endsAt,
      });
      const elderContent = `${user.username} has submitted a war declaration against ${defenderVillage.name}. You have ${ELDER_WAR_VOTE_HOURS} hours to vote.`;
      const kageContent = `Your war declaration against ${defenderVillage.name} has been submitted. Elders have ${ELDER_WAR_VOTE_HOURS} hours to vote.`;
      const elderUserIds = eligibleElders.map((e) => e.userId);
      const allNotifyIds = [user.userId, ...elderUserIds];
      await Promise.all([
        ctx.drizzle.insert(notification).values([
          { userId: user.userId, content: kageContent },
          ...elderUserIds.map((userId) => ({
            userId,
            content: elderContent,
          })),
        ]),
        ctx.drizzle
          .update(userData)
          .set({ unreadNotifications: sql`unreadNotifications + 1` })
          .where(inArray(userData.userId, allNotifyIds)),
      ]);
      return {
        success: true,
        message: `War declaration submitted. Elders have ${ELDER_WAR_VOTE_HOURS} hours to vote.`,
      };
    }),

  // Create an offer for factions to join the war
  createAllyOffer: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Create ally offer for war support" },
    })
    .input(
      z.object({
        warId: z.string(),
        tokenOffer: z.int().min(1000),
        targetVillageId: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWar, villages, relationships, allActiveWars] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
          }),
          fetchActiveWar(ctx.drizzle, input.warId),
          fetchVillages(ctx.drizzle),
          fetchAlliances(ctx.drizzle),
          fetchActiveWars(ctx.drizzle),
        ]);
      // Derived
      const targetVillage = villages.find((v) => v.id === input.targetVillageId);

      // Check minimum member count for war participation (after we know village IDs)
      const [userVillageMemberCount, targetVillageMemberCount] = await Promise.all([
        user?.villageId ? getVillageMemberCount(ctx.drizzle, user.villageId) : 0,
        targetVillage ? getVillageMemberCount(ctx.drizzle, targetVillage.id) : 0,
      ]);
      // Guard
      if (!user?.village || !user?.villageId) {
        return errorResponse("You must be in a village to create faction offers");
      }
      const offeringVillageId = user.villageId;
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can create faction offers");
      }
      if (!activeWar) {
        return errorResponse("War not found");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (!["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)) {
        return errorResponse(
          "War ally offers only available for village wars and raids",
        );
      }
      if (
        ![activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
          user.villageId,
        )
      ) {
        return errorResponse("You are not part of this war");
      }
      if (user.village.tokens < input.tokenOffer) {
        return errorResponse("Not enough tokens to create offer");
      }

      // Check if payment exceeds max percentage of village tokens
      const maxPayment = Math.floor(
        user.village.tokens * WAR_ALLY_MAX_PAYMENT_PERCENTAGE,
      );
      const maxPercentage = WAR_ALLY_MAX_PAYMENT_PERCENTAGE * 100;
      if (input.tokenOffer > maxPayment) {
        return errorResponse(
          `Payment cannot exceed ${maxPercentage}% of village tokens (max: ${maxPayment.toLocaleString()})`,
        );
      }
      if (!targetVillage) {
        return errorResponse("Target village not found");
      }
      if (
        [activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
          input.targetVillageId,
        )
      ) {
        return errorResponse("Cannot create offer for a village already in the war");
      }

      // Check if target village is already involved in any other active war
      if (
        isVillageInvolvedInAnyWar(allActiveWars, input.targetVillageId, activeWar.id, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse(
          "Target village is already involved in another active war",
        );
      }

      if (userVillageMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Your village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to create ally offers`,
        );
      }
      if (targetVillageMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Target village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to be invited to war`,
        );
      }

      // Final checks
      const { check, message } = canJoinWar(
        activeWar,
        relationships,
        targetVillage,
        user.village,
      );
      if (!check) {
        return errorResponse(message);
      }
      // Keep offer creation in the same War-first serialization order as surrender, ally joins,
      // and both resolution paths. An offer can no longer appear after terminal cleanup.
      const offered = await ctx.drizzle.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT ${war.id} FROM ${war} WHERE ${war.id} = ${activeWar.id} FOR UPDATE`,
        );
        const currentWar = await tx.query.war.findFirst({
          where: and(eq(war.id, activeWar.id), eq(war.status, "ACTIVE")),
          columns: {
            id: true,
            endedAt: true,
            type: true,
            attackerVillageId: true,
            defenderVillageId: true,
          },
        });
        if (
          !currentWar ||
          currentWar.endedAt ||
          !["VILLAGE_WAR", "WAR_RAID"].includes(currentWar.type) ||
          ![currentWar.attackerVillageId, currentWar.defenderVillageId].includes(
            offeringVillageId,
          )
        ) {
          return false;
        }
        await insertRequest(
          tx as unknown as DrizzleClient,
          user.userId,
          targetVillage.kageId,
          "WAR_ALLY",
          input.tokenOffer,
          activeWar.id,
        );
        return true;
      });
      if (!offered) {
        return errorResponse("War state changed. Refresh before sending an ally offer");
      }

      // Return
      return { success: true, message: "Ally offer sent" };
    }),

  rejectAllyOffer: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Reject a war ally offer" } })
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const [{ user }, request] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchRequest(ctx.drizzle, input.id, "WAR_ALLY"),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("Not in a village");
      if (!isKage(user)) return errorResponse("Not kage");
      if (!request) return errorResponse("Request not found");
      if (request.type !== "WAR_ALLY") return errorResponse("Not a war ally request");
      if (request.status !== "PENDING") return errorResponse("Request not pending");
      if (request.receiverId !== user.userId) return errorResponse("Not your request");

      // Update request
      await updateRequestState(ctx.drizzle, request.id, "REJECTED", "WAR_ALLY");

      // Return
      return { success: true, message: "Faction offer rejected" };
    }),

  // Get faction offers for a war
  getAllyOffers: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get pending war ally offers" },
    })
    .query(async ({ ctx }) => {
      return await fetchRequests(ctx.drizzle, ["WAR_ALLY"], 3600 * 12, ctx.userId);
    }),

  // Delist a faction offer
  cancelAllyOffer: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Cancel a war ally offer" } })
    .input(z.object({ offerId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, offer] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchRequest(ctx.drizzle, input.offerId, "WAR_ALLY"),
      ]);

      // Guard
      if (!offer) {
        return errorResponse("Offer not found");
      }
      if (!user?.village) {
        return errorResponse("You must be in a village to delist offers");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can delist offers");
      }
      if (offer.senderId !== user.userId) {
        return errorResponse("Not your offer to delist");
      }

      // Update request
      await updateRequestState(ctx.drizzle, input.offerId, "CANCELLED", "WAR_ALLY");

      return { success: true, message: "Offer delisted" };
    }),

  // Accept a faction offer
  acceptAllyOffer: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Accept a war ally offer" } })
    .input(z.object({ offerId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWars, request, relationships] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWars(ctx.drizzle),
        fetchRequest(ctx.drizzle, input.offerId, "WAR_ALLY"),
        fetchAlliances(ctx.drizzle),
      ]);
      if (!request) {
        return errorResponse("Offer not found");
      }
      // Derived
      const warId = request.relatedId;
      const activeWar = activeWars.find(
        (w) =>
          (w.attackerVillage?.kageId === request.senderId ||
            w.defenderVillage?.kageId === request.senderId) &&
          w.id === warId,
      );
      const senderVillage =
        activeWar?.attackerVillage?.kageId === request.senderId
          ? activeWar?.attackerVillage
          : activeWar?.defenderVillage;
      // Guard
      if (!senderVillage) {
        return errorResponse("Sender village not found");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village or faction to accept offers");
      }
      if (!user?.village) {
        return errorResponse("You must be in a village or faction to accept offers");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the leader can accept offers");
      }
      if (!activeWar) {
        return errorResponse("No active war found for the one listing the offer");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (!["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)) {
        return errorResponse(
          "War ally offers only available for village wars and raids",
        );
      }
      if (request.receiverId !== user.userId) {
        return errorResponse("This offer is not for your village");
      }
      if (request.senderId === user.userId) {
        return errorResponse("Cannot accept your own offer");
      }
      if (activeWar.warAllies.some((f) => f.villageId === user.villageId)) {
        return errorResponse("Already joined this war");
      }
      // Final checks
      const { check, message } = canJoinWar(
        activeWar,
        relationships,
        user.village,
        senderVillage,
      );
      if (!check) return errorResponse(message);
      const acceptingVillageId = user.villageId;
      // Claim the still-pending offer only while its War row is locked and active. Admin cleanup
      // uses the same War -> offer/ally lock order, so a late accept cannot recreate child state
      // or transfer tokens after the war was removed.
      const paymentConflict = Symbol("paymentConflict");
      let joined = false;
      try {
        joined = await ctx.drizzle.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT ${war.id} FROM ${war} WHERE ${war.id} = ${activeWar.id} FOR UPDATE`,
          );
          const currentWar = await tx.query.war.findFirst({
            where: and(eq(war.id, activeWar.id), eq(war.status, "ACTIVE")),
            columns: { id: true, endedAt: true, type: true },
          });
          if (
            !currentWar ||
            currentWar.endedAt ||
            !["VILLAGE_WAR", "WAR_RAID"].includes(currentWar.type)
          ) {
            return false;
          }
          await tx.execute(
            sql`SELECT ${userRequest.id} FROM ${userRequest} WHERE ${userRequest.id} = ${request.id} FOR UPDATE`,
          );
          const freshRequest = await tx.query.userRequest.findFirst({
            where: and(
              eq(userRequest.id, request.id),
              eq(userRequest.type, "WAR_ALLY"),
              eq(userRequest.status, "PENDING"),
              eq(userRequest.relatedId, activeWar.id),
              eq(userRequest.senderId, request.senderId),
              eq(userRequest.receiverId, ctx.userId),
            ),
          });
          if (!freshRequest) return false;
          const offerValue = freshRequest.value ?? 0;
          const existingAlly = await tx.query.warAlly.findFirst({
            where: and(
              eq(warAlly.warId, activeWar.id),
              eq(warAlly.villageId, acceptingVillageId),
            ),
            columns: { id: true },
          });
          if (existingAlly) return false;
          const claimedOffer = await tx
            .update(userRequest)
            .set({ status: "ACCEPTED" })
            .where(
              and(
                eq(userRequest.id, freshRequest.id),
                eq(userRequest.type, "WAR_ALLY"),
                eq(userRequest.status, "PENDING"),
                eq(userRequest.relatedId, activeWar.id),
              ),
            );
          if (writeRowsAffected(claimedOffer) !== 1) return false;
          const paid = await tx
            .update(village)
            .set({ tokens: sql`${village.tokens} - ${offerValue}` })
            .where(
              and(
                eq(village.kageId, freshRequest.senderId),
                gte(village.tokens, offerValue),
              ),
            );
          if (writeRowsAffected(paid) !== 1) throw paymentConflict;
          await tx.insert(warAlly).values({
            id: nanoid(),
            warId: activeWar.id,
            villageId: acceptingVillageId,
            supportVillageId: senderVillage.id,
            tokensPaid: offerValue,
          });
          await tx
            .update(village)
            .set({ tokens: sql`tokens + ${offerValue}` })
            .where(eq(village.id, acceptingVillageId));
          return true;
        });
      } catch (error) {
        if (error !== paymentConflict) throw error;
      }
      if (!joined) {
        return errorResponse("War or ally offer changed. Refresh before accepting");
      }

      return { success: true, message: "Offer accepted and alliance formed" };
    }),

  // Surrender war
  surrender: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Surrender a war" } })
    .input(surrenderWarInputSchema)
    .output(
      baseServerResponse.extend({
        requestId: z.string().uuid().optional(),
        warId: z.string().optional(),
        warType: z.enum(["VILLAGE_WAR", "WAR_RAID"]).optional(),
        expectedRevision: z.string().optional(),
        actorUserId: z.string().optional(),
        villageId: z.string().optional(),
        kageId: z.string().optional(),
        participationRole: z
          .enum(["MAIN_ATTACKER", "MAIN_DEFENDER", "ALLY_ATTACKER", "ALLY_DEFENDER"])
          .optional(),
        outcome: z.enum(["MAIN_WAR_ENDED", "ALLY_WITHDRAWN"]).optional(),
        resultStatus: z
          .enum(["ATTACKER_VICTORY", "DEFENDER_VICTORY", "ACTIVE"])
          .optional(),
        loserVillageId: z.string().optional(),
        winnerVillageId: z.string().nullable().optional(),
        allyId: z.string().nullable().optional(),
        endedAt: z.string().datetime().nullable().optional(),
        auditLogId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const auditLogId = `war-surrender:${input.requestId}`;
      const snapshotWar = (currentWar: War): AdminEndWarSnapshot => ({
        id: currentWar.id,
        attackerVillageId: currentWar.attackerVillageId,
        defenderVillageId: currentWar.defenderVillageId,
        startedAt: currentWar.startedAt.toISOString(),
        endedAt: currentWar.endedAt?.toISOString() ?? null,
        status: currentWar.status,
        type: currentWar.type,
        sector: currentWar.sector,
        attackerShrineHp: currentWar.attackerShrineHp,
        attackerShrineMaxHp: currentWar.attackerShrineMaxHp,
        attackerShrineStatus: currentWar.attackerShrineStatus,
        defenderShrineHp: currentWar.defenderShrineHp,
        defenderShrineMaxHp: currentWar.defenderShrineMaxHp,
        defenderShrineStatus: currentWar.defenderShrineStatus,
        lastTokenReductionAt: currentWar.lastTokenReductionAt.toISOString(),
        targetStructureRoute: currentWar.targetStructureRoute,
        attackerWarHealth: currentWar.attackerWarHealth,
        defenderWarHealth: currentWar.defenderWarHealth,
        attackerWarHealthMax: currentWar.attackerWarHealthMax,
        defenderWarHealthMax: currentWar.defenderWarHealthMax,
      });
      const exactJson = (left: unknown, right: unknown) =>
        JSON.stringify(left) === JSON.stringify(right);
      const affectedRowCount = (result: unknown): number => {
        if (Array.isArray(result)) return affectedRowCount(result[0]);
        if (!result || typeof result !== "object") return 0;
        if ("rowsAffected" in result && typeof result.rowsAffected === "number") {
          return result.rowsAffected;
        }
        if ("affectedRows" in result && typeof result.affectedRows === "number") {
          return result.affectedRows;
        }
        return 0;
      };
      const firstExecuteRow = <T extends Record<string, unknown>>(result: unknown) => {
        if (Array.isArray(result)) {
          const rows = Array.isArray(result[0]) ? result[0] : result;
          return rows[0] as T | undefined;
        }
        if (result && typeof result === "object" && "rows" in result) {
          const rows = (result as { rows?: unknown[] }).rows;
          return rows?.[0] as T | undefined;
        }
        return undefined;
      };

      type SurrenderReceipt = {
        version: 1;
        requestId: string;
        expectedRevision: string;
        expectedWar: AdminEndWarSnapshot;
        expectedActor: z.infer<typeof surrenderActorSnapshotSchema>;
        participationRole: SurrenderParticipationRole;
        expectedWarAlly: z.infer<typeof surrenderWarAllySnapshotSchema> | null;
        outcome: "MAIN_WAR_ENDED" | "ALLY_WITHDRAWN";
        resultStatus: "ATTACKER_VICTORY" | "DEFENDER_VICTORY" | "ACTIVE";
        loserVillageId: string;
        winnerVillageId: string | null;
        allyId: string | null;
        endedAt: string | null;
      };
      const receiptSchema = z.object({
        version: z.literal(1),
        requestId: z.string().uuid(),
        expectedRevision: z.string(),
        expectedWar: adminEndWarSnapshotSchema,
        expectedActor: surrenderActorSnapshotSchema,
        participationRole: z.enum([
          "MAIN_ATTACKER",
          "MAIN_DEFENDER",
          "ALLY_ATTACKER",
          "ALLY_DEFENDER",
        ]),
        expectedWarAlly: surrenderWarAllySnapshotSchema.nullable(),
        outcome: z.enum(["MAIN_WAR_ENDED", "ALLY_WITHDRAWN"]),
        resultStatus: z.enum(["ATTACKER_VICTORY", "DEFENDER_VICTORY", "ACTIVE"]),
        loserVillageId: z.string(),
        winnerVillageId: z.string().nullable(),
        allyId: z.string().nullable(),
        endedAt: z.string().datetime().nullable(),
      });
      const responseFromReceipt = (receipt: SurrenderReceipt) => ({
        success: true as const,
        message:
          receipt.outcome === "MAIN_WAR_ENDED"
            ? "Your village surrendered and the war has ended"
            : "Your village withdrew from the war",
        requestId: receipt.requestId,
        warId: receipt.expectedWar.id,
        warType: receipt.expectedWar.type as "VILLAGE_WAR" | "WAR_RAID",
        expectedRevision: receipt.expectedRevision,
        actorUserId: receipt.expectedActor.userId,
        villageId: receipt.expectedActor.villageId,
        kageId: receipt.expectedActor.kageId,
        participationRole: receipt.participationRole,
        outcome: receipt.outcome,
        resultStatus: receipt.resultStatus,
        loserVillageId: receipt.loserVillageId,
        winnerVillageId: receipt.winnerVillageId,
        allyId: receipt.allyId,
        endedAt: receipt.endedAt,
        auditLogId,
      });

      return ctx.drizzle.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DrizzleClient;
        // All war mutations claim the War row first. Combat's guarded UPDATE and normal/admin
        // resolution therefore either happen wholly before this request or do nothing afterward.
        await tx.execute(
          sql`SELECT ${war.id} FROM ${war} WHERE ${war.id} = ${input.warId} FOR UPDATE`,
        );
        await tx.execute(
          sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} = ${ctx.userId} FOR UPDATE`,
        );
        const actor = await tx.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
          with: { village: true },
        });
        if (!actor) return errorResponse("User not found");
        if (actor.isBanned) return errorResponse("Banned users cannot surrender wars");
        if (!actor.villageId || !actor.village) {
          return errorResponse("You must be in a village to surrender");
        }
        // Secure the village leadership row after discovering it, then refresh the actor. A
        // Kage handover which commits at the validation boundary must be observed before any
        // surrender effect can run.
        const lockedVillageResult = await tx.execute(
          sql`SELECT ${village.id} AS villageId, ${village.kageId} AS kageId FROM ${village} WHERE ${village.id} = ${actor.villageId} FOR UPDATE`,
        );
        const lockedVillage = firstExecuteRow<{ villageId: string; kageId: string }>(
          lockedVillageResult,
        );
        if (!lockedVillage || lockedVillage.villageId !== actor.villageId) {
          return errorResponse("You must be in a village to surrender");
        }
        if (actor.userId !== lockedVillage.kageId) {
          return errorResponse("Only the current Kage can surrender");
        }
        if (
          !exactJson(input.expectedActor, {
            userId: actor.userId,
            villageId: actor.villageId,
            kageId: lockedVillage.kageId,
          })
        ) {
          return errorResponse(
            "Kage or village identity changed. Reopen the confirmation",
          );
        }

        await tx.execute(
          sql`SELECT ${actionLog.id} FROM ${actionLog} WHERE ${actionLog.id} = ${auditLogId} FOR UPDATE`,
        );
        const previousLog = await tx.query.actionLog.findFirst({
          where: eq(actionLog.id, auditLogId),
        });
        const currentWar = await tx.query.war.findFirst({
          where: eq(war.id, input.warId),
          with: {
            attackerVillage: { with: { structures: true } },
            defenderVillage: { with: { structures: true } },
            warAllies: { with: { village: true } },
          },
        });

        if (previousLog) {
          const parsed = receiptSchema.safeParse(previousLog.changes);
          const receipt = parsed.success ? parsed.data : undefined;
          const exactReplay =
            receipt &&
            previousLog.userId === actor.userId &&
            previousLog.tableName === "War" &&
            previousLog.relatedId === input.warId &&
            receipt.requestId === input.requestId &&
            receipt.expectedRevision === input.expectedRevision &&
            exactJson(receipt.expectedWar, input.expectedWar) &&
            exactJson(receipt.expectedActor, input.expectedActor) &&
            receipt.participationRole === input.expectedParticipationRole &&
            exactJson(receipt.expectedWarAlly, input.expectedWarAlly);
          if (!exactReplay) return errorResponse("Invalid surrender request ID");
          if (!currentWar) {
            return errorResponse("Surrender receipt no longer matches the current war");
          }
          const sameWarIdentity =
            currentWar.id === receipt.expectedWar.id &&
            currentWar.startedAt.toISOString() === receipt.expectedWar.startedAt &&
            currentWar.attackerVillageId === receipt.expectedWar.attackerVillageId &&
            currentWar.defenderVillageId === receipt.expectedWar.defenderVillageId &&
            currentWar.type === receipt.expectedWar.type;
          if (receipt.outcome === "MAIN_WAR_ENDED") {
            if (
              !sameWarIdentity ||
              currentWar.status !== receipt.resultStatus ||
              currentWar.endedAt?.toISOString() !== receipt.endedAt
            ) {
              return errorResponse(
                "Surrender receipt no longer matches the war outcome",
              );
            }
          } else {
            const recreatedAlly = await tx.query.warAlly.findFirst({
              where: and(
                eq(warAlly.warId, input.warId),
                eq(warAlly.villageId, actor.villageId),
              ),
              columns: { id: true },
            });
            if (
              !sameWarIdentity ||
              currentWar.status !== "ACTIVE" ||
              currentWar.endedAt !== null ||
              recreatedAlly
            ) {
              return errorResponse(
                "Surrender receipt no longer matches ally withdrawal",
              );
            }
          }
          return responseFromReceipt(receipt as SurrenderReceipt);
        }

        if (!currentWar?.attackerVillage || !currentWar.defenderVillage) {
          return errorResponse("Active war was not found");
        }
        if (
          currentWar.status !== "ACTIVE" ||
          currentWar.endedAt !== null ||
          !["VILLAGE_WAR", "WAR_RAID"].includes(currentWar.type)
        ) {
          return errorResponse("War is no longer surrenderable. Refresh and try again");
        }
        if (!exactJson(snapshotWar(currentWar), input.expectedWar)) {
          return errorResponse(
            "War state changed. Reopen the confirmation before surrendering",
          );
        }

        let participationRole: SurrenderParticipationRole | undefined;
        if (actor.villageId === currentWar.attackerVillageId) {
          participationRole = "MAIN_ATTACKER";
        } else if (actor.villageId === currentWar.defenderVillageId) {
          participationRole = "MAIN_DEFENDER";
        }
        const currentAlly = currentWar.warAllies.find(
          (entry) => entry.villageId === actor.villageId,
        );
        if (!participationRole && currentAlly) {
          if (currentAlly.supportVillageId === currentWar.attackerVillageId) {
            participationRole = "ALLY_ATTACKER";
          } else if (currentAlly.supportVillageId === currentWar.defenderVillageId) {
            participationRole = "ALLY_DEFENDER";
          }
        }
        if (!participationRole) return errorResponse("You are not part of this war");
        if (participationRole !== input.expectedParticipationRole) {
          return errorResponse(
            "Your role in this war changed. Reopen the confirmation",
          );
        }
        const currentAllySnapshot = currentAlly
          ? {
              id: currentAlly.id,
              warId: currentAlly.warId,
              villageId: currentAlly.villageId,
              supportVillageId: currentAlly.supportVillageId,
              tokensPaid: currentAlly.tokensPaid,
              joinedAt: currentAlly.joinedAt.toISOString(),
            }
          : null;
        if (!exactJson(currentAllySnapshot, input.expectedWarAlly)) {
          return errorResponse("War ally assignment changed. Reopen the confirmation");
        }

        let receipt: SurrenderReceipt;
        if (participationRole.startsWith("MAIN_")) {
          const endedWar = await handleWarEnd(currentWar, {
            transaction: tx,
            expectedWarState: currentWar,
            forcedLoserVillageId: actor.villageId,
          });
          if (
            !endedWar ||
            !["ATTACKER_VICTORY", "DEFENDER_VICTORY"].includes(endedWar.status)
          ) {
            if (endedWar) {
              throw serverError(
                "CONFLICT",
                "War state changed. Refresh before surrendering",
              );
            }
            return errorResponse("War state changed. Refresh before surrendering");
          }
          const winnerVillageId =
            endedWar.status === "ATTACKER_VICTORY"
              ? endedWar.attackerVillageId
              : endedWar.defenderVillageId;
          receipt = {
            version: 1,
            requestId: input.requestId,
            expectedRevision: input.expectedRevision,
            expectedWar: input.expectedWar,
            expectedActor: input.expectedActor,
            participationRole,
            expectedWarAlly: null,
            outcome: "MAIN_WAR_ENDED",
            resultStatus: endedWar.status as "ATTACKER_VICTORY" | "DEFENDER_VICTORY",
            loserVillageId: actor.villageId,
            winnerVillageId,
            allyId: null,
            endedAt: endedWar.endedAt?.toISOString() ?? null,
          };
        } else {
          if (!currentAlly || !input.expectedWarAlly) {
            return errorResponse(
              "War ally assignment changed. Reopen the confirmation",
            );
          }
          await tx.execute(
            sql`SELECT ${warAlly.id} FROM ${warAlly} WHERE ${warAlly.id} = ${currentAlly.id} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT ${village.id} FROM ${village} WHERE ${village.id} = ${actor.villageId} FOR UPDATE`,
          );
          const removedAlly = await tx
            .delete(warAlly)
            .where(
              and(
                eq(warAlly.id, input.expectedWarAlly.id),
                eq(warAlly.warId, input.warId),
                eq(warAlly.villageId, actor.villageId),
                eq(warAlly.supportVillageId, input.expectedWarAlly.supportVillageId),
                eq(warAlly.tokensPaid, input.expectedWarAlly.tokensPaid),
              ),
            );
          if (affectedRowCount(removedAlly) !== 1) {
            throw serverError(
              "PRECONDITION_FAILED",
              "War ally assignment changed. Refresh before surrendering",
            );
          }
          const surrenderedAt = new Date();
          const exhaustion = await tx
            .update(village)
            .set({
              warExhaustionEndedAt: secondsFromDate(
                WAR_LOSING_COOLDOWN_DAYS * DAY_S,
                surrenderedAt,
              ),
              lastWarEndedAt: surrenderedAt,
            })
            .where(eq(village.id, actor.villageId));
          if (affectedRowCount(exhaustion) !== 1) {
            throw serverError(
              "INTERNAL_SERVER_ERROR",
              "Failed to apply war exhaustion",
            );
          }
          receipt = {
            version: 1,
            requestId: input.requestId,
            expectedRevision: input.expectedRevision,
            expectedWar: input.expectedWar,
            expectedActor: input.expectedActor,
            participationRole,
            expectedWarAlly: input.expectedWarAlly,
            outcome: "ALLY_WITHDRAWN",
            resultStatus: "ACTIVE",
            loserVillageId: actor.villageId,
            winnerVillageId: null,
            allyId: currentAlly.id,
            endedAt: null,
          };
        }

        await tx.insert(actionLog).values({
          id: auditLogId,
          userId: actor.userId,
          tableName: "War",
          relatedId: input.warId,
          relatedMsg: receipt.outcome,
          changes: receipt,
        });
        return responseFromReceipt(receipt);
      });
    }),

  getWarKills: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get war kill records" } })
    .input(z.object({ warId: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.drizzle.query.warKill.findMany({
        where: eq(warKill.warId, input.warId),
        with: {
          killer: { columns: { userId: true, avatar: true, username: true } },
          victim: { columns: { userId: true, avatar: true, username: true } },
          killerVillage: { columns: { id: true, name: true } },
          victimVillage: { columns: { id: true, name: true } },
        },
        orderBy: [desc(warKill.killedAt)],
      });
      // Ensure killer and victim are not null
      return results.filter((kill) => kill.killer && kill.victim);
    }),

  getWarKillStats: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get aggregated war kill statistics" },
    })
    .input(
      z.object({
        warId: z.string(),
        aggregateBy: z.enum(["townhallHpChange", "shrineHpChange", "totalKills"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      // If total kills
      if (input.aggregateBy === "totalKills") {
        return await ctx.drizzle
          .select({
            killerId: warKill.killerId,
            killerUsername: userData.username,
            villageId: userData.villageId,
            villageName: village.name,
            killerAvatar: userData.avatar,
            count: sql<number>`count(*)`,
          })
          .from(warKill)
          .leftJoin(userData, eq(warKill.killerId, userData.userId))
          .leftJoin(village, eq(userData.villageId, village.id))
          .where(eq(warKill.warId, input.warId))
          .groupBy(warKill.killerId)
          .orderBy(desc(sql<number>`count(*)`));
      }

      // Other aggregate fields - only sum positive values (actual damage contribution)
      // Negative values represent losses, which shouldn't count as "damage dealt"
      const aggregateField =
        input.aggregateBy === "townhallHpChange"
          ? warKill.townhallHpChange
          : warKill.shrineHpChange;

      return await ctx.drizzle
        .select({
          killerId: warKill.killerId,
          killerUsername: userData.username,
          villageId: userData.villageId,
          villageName: village.name,
          killerAvatar: userData.avatar,
          count: sql<number>`sum(GREATEST(${aggregateField}, 0))`,
        })
        .from(warKill)
        .leftJoin(userData, eq(warKill.killerId, userData.userId))
        .leftJoin(village, eq(userData.villageId, village.id))
        .where(eq(warKill.warId, input.warId))
        .groupBy(warKill.killerId)
        .orderBy(desc(sql<number>`sum(GREATEST(${aggregateField}, 0))`));
    }),

  // Get pending elder votes for a village
  getElderVotes: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get pending elder votes for a village",
      },
    })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Optimistically fetch for the requested village; it is the user's own in
      // every normal case, so this stays a single round-trip.
      const [user, votes] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchElderVotes(ctx.drizzle, input.villageId),
      ]);
      // Staff may inspect any village. Everyone else only ever sees their own, so
      // a villageId the client cached before switching village re-reads the
      // current one instead of failing the townhall page with an error toast.
      if (canSeeSecretData(user.role) || user.villageId === input.villageId) {
        return votes;
      }
      if (!user.villageId) return [];
      return await fetchElderVotes(ctx.drizzle, user.villageId);
    }),

  // Kage cancels a pending war declaration before elders vote
  cancelWarDeclaration: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Cancel a pending war declaration vote (Kage only)",
      },
    })
    .input(z.object({ voteId: z.string(), userVillageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, voteRecord, elders] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchElderVote(ctx.drizzle, input.voteId),
        ctx.drizzle
          .select({ userId: userData.userId })
          .from(userData)
          .where(
            and(
              eq(userData.villageId, input.userVillageId),
              eq(userData.rank, "ELDER"),
            ),
          ),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.userVillageId)
        return errorResponse("Village mismatch — please refresh and try again");
      if (!user.village) return errorResponse("Village not found");
      if (user.village.kageId !== user.userId)
        return errorResponse("Only the Kage can cancel a war declaration");
      if (!voteRecord) return errorResponse("War declaration not found");
      if (voteRecord.villageId !== user.villageId)
        return errorResponse("This vote does not belong to your village");
      if (voteRecord.type !== "WAR_DECLARATION")
        return errorResponse("Can only cancel war declarations");
      if (voteRecord.status !== "PENDING")
        return errorResponse("Can only cancel a pending war declaration");
      if (new Date(voteRecord.endsAt).getTime() <= Date.now())
        return errorResponse("Voting window has ended; cannot cancel");

      // Atomically cancel — guard ensures it's still PENDING.
      // Set endsAt = now so the cooldown window starts from the actual resolution time,
      // not the original scheduled deadline (which would be in the future).
      const updateRes = await ctx.drizzle
        .update(villageElderVote)
        .set({ status: "REJECTED", endsAt: new Date() })
        .where(
          and(
            eq(villageElderVote.id, input.voteId),
            eq(villageElderVote.status, "PENDING"),
          ),
        );

      if (updateRes.rowsAffected === 0)
        return errorResponse(
          "War declaration could not be cancelled — it may have already been resolved",
        );

      if (elders.length > 0) {
        const notifyIds = elders.map((e) => e.userId);
        await Promise.all([
          ctx.drizzle.insert(notification).values(
            notifyIds.map((userId) => ({
              userId,
              content: `${user.username} has cancelled the war declaration. No war will be started.`,
            })),
          ),
          ctx.drizzle
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(inArray(userData.userId, notifyIds)),
        ]);
      }

      return {
        success: true,
        message: "War declaration cancelled. No tokens were charged.",
      };
    }),

  // Elder votes on a pending war declaration
  voteOnWarDeclaration: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Vote on a pending war declaration as elder",
      },
    })
    .input(
      z.object({
        voteId: z.string(),
        vote: z.enum(["YES", "NO"]),
        userVillageId: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [{ user }, voteRecord, attackerVillage, elderCount] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchElderVote(ctx.drizzle, input.voteId),
        fetchVillage(ctx.drizzle, input.userVillageId),
        ctx.drizzle
          .select({ count: sql<number>`count(*)` })
          .from(userData)
          .where(
            and(
              eq(userData.villageId, input.userVillageId),
              eq(userData.rank, "ELDER"),
              eq(userData.isAi, false),
            ),
          )
          .then(([r]) => r?.count ?? 0),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (!user.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.userVillageId)
        return errorResponse("Village mismatch — please refresh and try again");
      if (user.rank !== "ELDER") return errorResponse("Only elders can vote");
      if (!voteRecord) return errorResponse("Vote not found");
      if (voteRecord.status !== "PENDING")
        return errorResponse("Vote is no longer pending");
      if (voteRecord.villageId !== user.villageId)
        return errorResponse("Vote is not for your village");
      if (voteRecord.type !== "WAR_DECLARATION")
        return errorResponse("Not a war declaration vote");
      if (user.userId === voteRecord.initiatedByUserId)
        return errorResponse(
          "The war declaration initiator cannot vote on their own motion",
        );
      if (new Date() > voteRecord.endsAt)
        return errorResponse("Voting period has ended");

      if (elderCount < ELDER_MIN_VOTING_COUNT) {
        return errorResponse(
          `At least ${ELDER_MIN_VOTING_COUNT} elders must be in position to vote`,
        );
      }

      // Insert the vote entry, re-fetch fresh entries, and resolve outcome
      const voteResult = await castElderVoteEntry(
        ctx.drizzle,
        input.voteId,
        user.userId,
        input.vote,
        elderCount,
      );
      if (!voteResult) return errorResponse("You have already voted");
      const { outcome, freshEntries } = voteResult;
      if (outcome === "APPROVED") {
        // Atomically claim the motion and pre-fetch needed data in parallel
        const [claimResult, defenderVillage, currentActiveWars] = await Promise.all([
          ctx.drizzle
            .update(villageElderVote)
            .set({ status: "APPROVED" })
            .where(
              and(
                eq(villageElderVote.id, input.voteId),
                eq(villageElderVote.status, "PENDING"),
              ),
            ),
          ctx.drizzle.query.village.findFirst({
            columns: { name: true, kageId: true },
            where: eq(village.id, voteRecord.targetId),
          }),
          fetchActiveWars(ctx.drizzle),
        ]);
        if (claimResult.rowsAffected === 0) {
          return errorResponse("Vote already processed");
        }

        // Re-check war involvement — a village may have entered a war during the voting window
        if (
          isVillageInvolvedInAnyWar(
            currentActiveWars,
            voteRecord.villageId,
            undefined,
            ["VILLAGE_WAR", "WAR_RAID"],
          ) ||
          isVillageInvolvedInAnyWar(currentActiveWars, voteRecord.targetId, undefined, [
            "VILLAGE_WAR",
            "WAR_RAID",
          ])
        ) {
          await Promise.all([
            ctx.drizzle
              .update(villageElderVote)
              .set({ status: "REJECTED", endsAt: new Date() })
              .where(eq(villageElderVote.id, input.voteId)),
            ctx.drizzle.insert(notification).values({
              userId: voteRecord.initiatedByUserId,
              content: `War declaration against ${defenderVillage?.name ?? "another village"} was cancelled — a village is already involved in an active war.`,
            }),
            ctx.drizzle
              .update(userData)
              .set({ unreadNotifications: sql`unreadNotifications + 1` })
              .where(eq(userData.userId, voteRecord.initiatedByUserId)),
          ]);
          return errorResponse("A village is already involved in an active war");
        }

        // Start the war and deduct tokens
        if (!attackerVillage || attackerVillage.tokens < WAR_DECLARATION_COST) {
          await Promise.all([
            ctx.drizzle
              .update(villageElderVote)
              .set({ status: "REJECTED", endsAt: new Date() })
              .where(eq(villageElderVote.id, input.voteId)),
            ctx.drizzle.insert(notification).values({
              userId: voteRecord.initiatedByUserId,
              content: `War declaration against ${defenderVillage?.name ?? "another village"} was cancelled — village no longer has enough tokens.`,
            }),
            ctx.drizzle
              .update(userData)
              .set({ unreadNotifications: sql`unreadNotifications + 1` })
              .where(eq(userData.userId, voteRecord.initiatedByUserId)),
          ]);
          return errorResponse("Village no longer has enough tokens to declare war");
        }
        // Deduct tokens with DB guard — if this fails, war is never inserted
        const tokenResult = await ctx.drizzle
          .update(village)
          .set({ tokens: sql`${village.tokens} - ${WAR_DECLARATION_COST}` })
          .where(
            and(
              eq(village.id, voteRecord.villageId),
              gte(village.tokens, WAR_DECLARATION_COST),
            ),
          );
        if (tokenResult.rowsAffected === 0) {
          await Promise.all([
            ctx.drizzle
              .update(villageElderVote)
              .set({ status: "REJECTED", endsAt: new Date() })
              .where(eq(villageElderVote.id, input.voteId)),
            ctx.drizzle.insert(notification).values({
              userId: voteRecord.initiatedByUserId,
              content: `War declaration against ${defenderVillage?.name ?? "another village"} was cancelled — the village no longer has enough tokens.`,
            }),
            ctx.drizzle
              .update(userData)
              .set({ unreadNotifications: sql`unreadNotifications + 1` })
              .where(eq(userData.userId, voteRecord.initiatedByUserId)),
          ]);
          return errorResponse("Village no longer has enough tokens to declare war");
        }
        const warId = nanoid();
        const warContent = `${attackerVillage.name} has declared war on ${defenderVillage?.name ?? "another village"}!`;
        const notifyKageIds = [voteRecord.initiatedByUserId];
        if (defenderVillage?.kageId) notifyKageIds.push(defenderVillage.kageId);
        await Promise.all([
          ctx.drizzle.insert(war).values({
            id: warId,
            attackerVillageId: voteRecord.villageId,
            defenderVillageId: voteRecord.targetId,
            status: "ACTIVE",
            type: voteRecord.warType ?? "VILLAGE_WAR",
            targetStructureRoute: voteRecord.targetStructureRoute ?? "/townhall",
            attackerShrineHp: WAR_RAID_SHRINE_HP,
            attackerShrineMaxHp: WAR_RAID_SHRINE_HP,
            attackerShrineStatus: "ACTIVE",
            defenderShrineHp: WAR_RAID_SHRINE_HP,
            defenderShrineMaxHp: WAR_RAID_SHRINE_HP,
            defenderShrineStatus: "ACTIVE",
          }),
          ctx.drizzle
            .insert(notification)
            .values(notifyKageIds.map((userId) => ({ userId, content: warContent }))),
          ctx.drizzle
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(inArray(userData.userId, notifyKageIds)),
        ]);
        return {
          success: true,
          message: "War declaration approved. War has started!",
        };
      }

      if (outcome === "REJECTED") {
        // Atomically claim the rejection to prevent double notifications on concurrent votes.
        // Set endsAt = now so the cooldown window starts from the real resolution time.
        const [claimResult, targetVillage] = await Promise.all([
          ctx.drizzle
            .update(villageElderVote)
            .set({ status: "REJECTED", endsAt: new Date() })
            .where(
              and(
                eq(villageElderVote.id, input.voteId),
                eq(villageElderVote.status, "PENDING"),
              ),
            ),
          ctx.drizzle.query.village.findFirst({
            columns: { name: true },
            where: eq(village.id, voteRecord.targetId),
          }),
        ]);
        if (claimResult.rowsAffected === 0) {
          return {
            success: true,
            message: "War declaration vote already resolved",
          };
        }
        await Promise.all([
          ctx.drizzle.insert(notification).values({
            userId: voteRecord.initiatedByUserId,
            content: `War declaration against ${targetVillage?.name ?? "another village"} was rejected by the elders.`,
          }),
          ctx.drizzle
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(eq(userData.userId, voteRecord.initiatedByUserId)),
        ]);
        return {
          success: true,
          message: "War declaration rejected by the elders",
        };
      }

      return {
        success: true,
        message: `Vote recorded. Current tally: ${freshEntries.filter((e) => e.vote === "YES").length} YES, ${freshEntries.filter((e) => e.vote === "NO").length} NO`,
      };
    }),
});

/**
 * Fetch active wars for a village
 * @param client - The database client
 * @param villageId - The ID of the village
 * @returns The active wars
 */
export const fetchActiveWars = async (client: DrizzleClient, villageId?: string) => {
  // Fetch from database the active ones
  let activeWars = await client.query.war.findMany({
    where: eq(war.status, "ACTIVE"),
    with: {
      attackerVillage: {
        with: { structures: true },
      },
      defenderVillage: {
        with: { structures: true },
      },
      warAllies: {
        with: {
          village: true,
        },
      },
    },
  });
  // Process the wars and end the ones that need to be ended
  const processedWars: typeof activeWars = [];
  for (const activeWar of activeWars) {
    if (!activeWar.attackerVillage || !activeWar.defenderVillage) continue;
    const shouldEnd =
      activeWar.attackerVillage.tokens <= 0 ||
      activeWar.defenderVillage.tokens <= 0 ||
      (["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type) &&
        (activeWar.attackerWarHealth <= 0 || activeWar.defenderWarHealth <= 0));
    if (shouldEnd) {
      const endedWar = await handleWarEnd(activeWar, { client });
      if (endedWar) processedWars.push(endedWar);
    } else {
      processedWars.push(activeWar);
    }
  }
  activeWars = processedWars;
  // Final active wars
  activeWars = activeWars.filter((war) => {
    if (villageId) {
      return isVillageInvolvedInAnyWar([war], villageId);
    }
    return war.status === "ACTIVE";
  });

  // Return active wars
  return activeWars;
};

export type FetchActiveWarsReturnType = War & {
  warAllies: (WarAlly & { village: Village })[];
  attackerVillage: Village & { structures: VillageStructure[] };
  defenderVillage: Village & { structures: VillageStructure[] };
};

/**
 * Fetch an active war
 * @param client - The database client
 * @param warId - The ID of the war
 * @returns The war
 */
export const fetchActiveWar = async (client: DrizzleClient, warId: string) => {
  return await client.query.war.findFirst({
    where: and(eq(war.id, warId), eq(war.status, "ACTIVE")),
    with: {
      attackerVillage: {
        with: { structures: true },
      },
      defenderVillage: {
        with: { structures: true },
      },
      warAllies: {
        with: {
          village: true,
        },
      },
    },
  });
};

/**
 * Fetch ended wars for a village
 * @param client - The database client
 * @param villageId - The ID of the village
 * @returns The ended wars
 */
export const fetchEndedWars = async (client: DrizzleClient, villageId?: string) => {
  const endedWars = await client.query.war.findMany({
    where: ne(war.status, "ACTIVE"),
    with: {
      attackerVillage: {
        with: { structures: true },
      },
      defenderVillage: {
        with: { structures: true },
      },
      warAllies: {
        with: {
          village: true,
        },
      },
    },
    orderBy: [desc(war.endedAt)],
  });
  return endedWars.filter((war) => {
    if (villageId) {
      return isVillageInvolvedInAnyWar([war], villageId);
    }
    return true;
  });
};

export type GetActiveWarsReturnType = NonNullable<
  RouterOutputs["war"]["getActiveWars"]
>;

/**
 * Get the member count for a village
 * @param client - The DrizzleClient instance
 * @param villageId - The ID of the village
 * @returns The number of members in the village
 */
const getVillageMemberCount = async (
  client: DrizzleClient,
  villageId: string,
): Promise<number> => {
  const result = await client
    .select({ count: sql<number>`count(*)` })
    .from(userData)
    .where(eq(userData.villageId, villageId));
  return result[0]?.count || 0;
};

// Elder vote utilities live in @/libs/elder — re-exported here for backward compatibility
export {
  castElderVoteEntry,
  fetchElderVote,
  fetchElderVotes,
  fetchExpiredElderVotes,
  resolveElderVote,
} from "@/libs/elder";
