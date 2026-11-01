import { nanoid } from "nanoid";
import { z } from "zod";
import {
  IMG_AVATAR_DEFAULT,
  MAP_RESERVED_SECTORS,
  SHRINE_AI_UNLOCK_COST,
  SHRINE_BATTLE_LOBBY_SECONDS,
  SHRINE_BATTLE_MAX_USERS_PER_SIDE,
  SHRINE_BATTLE_MIN_ATTACKERS,
  SHRINE_BOOST_COST,
  SHRINE_BOOST_DURATION_HOURS,
  SHRINE_BOOST_TYPES,
  SHRINE_MAX_AI_ASSIGNMENTS,
  SHRINE_MAX_LEVEL,
  SHRINE_UPGRADE_COST,
  SHRINE_WEEKLY_MAINTENANCE_COST,
  shrineLobbyFreshAfter,
  VILLAGE_SYNDICATE_ID,
  WAR_SHRINE_MAINTENANCE_DAYS,
} from "@/drizzle/constants";
import {
  areWarObjectivesRevealed,
  getWarSide,
  isObjectiveWarActive,
} from "@/libs/objectiveWar";
import { getServerPusher } from "@/libs/pusher";
import { fetchActiveUserMpvpBattles } from "@/queries/clan";
import { fetchUser, queueAwakeUser, wakeQueuedUser } from "@/queries/profile";
import {
  claimBattleQueue,
  deleteQueueById,
  deleteUnclaimedBattleQueue,
  releaseBattleQueueClaim,
  setQueueBattleId,
} from "@/queries/raids";
import {
  deleteMpvpBattleQueueForGetShrineBattles,
  deleteMpvpBattleUserForLeaveShrineBattle,
  findMpvpBattleQueueForJoinShrineBattle,
  findMpvpBattleQueueForLeaveShrineBattle,
  findMpvpBattleUserForJoinShrineBattle,
  findSectorByNumber,
  findSectorForPayWeeklyMaintenance,
  findSectorWithVillage,
  findUserDataForJoinShrineBattle,
  findVillageForGetBoostTemplate,
  insertMpvpBattleQueueForChallengeShrine,
  insertMpvpBattleUserForJoinShrineBattle,
  listMpvpBattleQueueForGetShrineBattles,
  listSectorForGetCapturedSectors,
  listUserDataForGetShrineAis,
  listUserDataForInitiateShrineBattle,
  selectMpvpBattleQueueForLeaveShrineBattle,
  selectMpvpBattleUserForGetUserQueuedShrineBattle,
  selectMpvpBattleUserForLeaveShrineBattle,
  selectSectorForHasLevel3Shrine,
  updateSectorForPayWeeklyMaintenance,
  updateSectorForUpgradeShrine,
  updateVillageForActivateBoost,
  updateVillageForPayWeeklyMaintenance,
  updateVillageForPayWeeklyMaintenance2,
  updateVillageForSetBoostTemplate,
  updateVillageForToggleVillageAiDefender,
  updateVillageForUnlockAiDefender,
  updateVillageForUpgradeShrine,
  updateVillageForUpgradeShrine2,
} from "@/queries/shrine";
import { findVillageBoostUserCache } from "@/queries/socialUserCache";
import {
  fetchAlliances,
  findVillageById,
  findVillageBySector,
} from "@/queries/village";
import { initiateBattle } from "@/routers/combat";
import { fetchUpdatedUser, type UserWithRelations } from "@/routers/profile";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
// Pusher instance
import { findRelationship } from "@/utils/alliance";
import { canSeeSecretData } from "@/utils/permissions";
import { secondsFromDate } from "@/utils/time";
import { getBoostTemplateSchema, setBoostTemplateSchema } from "@/validators/shrine";
import { userDeltaResponseSchema } from "@/validators/userCache";
import { fetchActiveWars } from "./war";

const pusher = getServerPusher();

export const shrineRouter = createTRPCRouter({
  /** Observe cron-activated boosts without loading unrelated profile progression. */
  getVillageBoostState: protectedProcedure.query(async ({ ctx }) => {
    return (await findVillageBoostUserCache(ctx.drizzle, ctx.userId))?.village ?? null;
  }),
  // Get all AI names
  getShrineAis: publicProcedure
    .meta({ mcp: { description: "Get all shrine AI defenders" } })
    .query(async ({ ctx }) => {
      return await listUserDataForGetShrineAis(ctx.drizzle);
    }),

  /** List standing captured shrines; destroyed remnants cannot be maintained. */
  getCapturedSectors: protectedProcedure
    .meta({ mcp: { description: "Get captured sectors for a village" } })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sectors = await listSectorForGetCapturedSectors(ctx.drizzle, input);
      return sectors;
    }),

  // Upgrade a shrine level
  upgradeShrine: protectedProcedure
    .meta({ mcp: { description: "Upgrade a shrine level (Kage only)" } })
    .input(z.object({ sectorNumber: z.number() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [{ user, requiresUserRefresh }, targetSector] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        findSectorByNumber(ctx.drizzle, input.sectorNumber),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("You must be in a village");
      if (!targetSector) return errorResponse("Sector not found");
      if (targetSector.villageId !== user.villageId) {
        return errorResponse("You can only upgrade your own shrines");
      }
      if (targetSector.shrineLevel < 1) {
        return errorResponse("This shrine has been destroyed");
      }
      if (targetSector.shrineLevel >= SHRINE_MAX_LEVEL) {
        return errorResponse(`Shrine level cannot exceed ${SHRINE_MAX_LEVEL}`);
      }
      if (user?.village?.kageId !== user.userId) {
        return errorResponse("Only the Kage can upgrade shrines");
      }
      if (!user.village) return errorResponse("Village not found");
      if (user.village.tokens < SHRINE_UPGRADE_COST) {
        return errorResponse(
          `Need ${SHRINE_UPGRADE_COST.toLocaleString()} tokens to upgrade shrine`,
        );
      }

      // IMPORTANT: do token update with DB-guard + atomic decrement
      // We do tokens first; if it fails, we do nothing else.
      const tokenRes = await updateVillageForUpgradeShrine(ctx.drizzle, {
        villageId: user.villageId,
      });

      if (tokenRes.rowsAffected === 0) {
        return errorResponse("Not enough village tokens to upgrade shrine");
      }

      // Match ownership and level so a concurrent capture or upgrade triggers a refund.
      const shrineUpdateRes = await updateSectorForUpgradeShrine(
        ctx.drizzle,
        targetSector,
        input,
        { villageId: user.villageId },
      );

      if (shrineUpdateRes.rowsAffected === 0) {
        // Refund tokens since the guarded update failed
        await updateVillageForUpgradeShrine2(ctx.drizzle, {
          villageId: user.villageId,
        });
        return errorResponse(
          "Shrine upgrade failed - shrine may have been upgraded by another request",
        );
      }

      return {
        success: true,
        message: `Successfully upgraded shrine to level ${targetSector.shrineLevel + 1}!`,
        userDelta: requiresUserRefresh
          ? undefined
          : { village: { id: user.villageId, tokens: -SHRINE_UPGRADE_COST } },
      };
    }),

  // Activate village-wide boost (requires level 3 shrine)
  activateBoost: protectedProcedure
    .meta({ mcp: { description: "Activate village-wide shrine boost" } })
    .input(z.object({ boostType: z.enum(SHRINE_BOOST_TYPES), villageId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user, requiresUserRefresh }, hasShrine] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        hasLevel3Shrine(ctx.drizzle, input.villageId),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.villageId) {
        return errorResponse("You can only activate boosts for your own village");
      }
      if (!user.village) return errorResponse("Village not found");
      if (user.village.kageId !== user.userId && user.rank !== "ELDER") {
        return errorResponse("Only the Kage or Elders can activate boosts");
      }
      if (!hasShrine) {
        return errorResponse("Need at least one Level 3 shrine to activate boosts");
      }
      if (user.village.tokens < SHRINE_BOOST_COST) {
        return errorResponse(
          `Need ${SHRINE_BOOST_COST.toLocaleString()} tokens to activate boosts`,
        );
      }

      // Check if boost is already active
      const now = new Date();
      const currentBoosts = user.village.shrineSettings.activeBoosts || {};
      const existingBoost = currentBoosts[input.boostType];
      if (existingBoost && new Date(existingBoost) > now) {
        return errorResponse(`${input.boostType} boost is already active`);
      }

      // Update active boosts — JSON_SET targets only the specific boost key to avoid
      // race conditions with concurrent cron writes to other boost keys.
      const boostExpiry = secondsFromDate(SHRINE_BOOST_DURATION_HOURS * 60 * 60, now);

      const updateRes = await updateVillageForActivateBoost(
        ctx.drizzle,
        input,
        boostExpiry,
        { villageId: user.villageId },
        now,
      );

      if (updateRes.rowsAffected === 0) {
        return errorResponse(
          "Could not activate boost — insufficient tokens or boost already active",
        );
      }

      return {
        success: true,
        message: `${input.boostType} boost activated for ${SHRINE_BOOST_DURATION_HOURS} hours!`,
        userPatch: {
          village: {
            id: user.villageId,
            shrineSettings: {
              activeBoosts: { [input.boostType]: boostExpiry.toISOString() },
            },
          },
        },
        userDelta: requiresUserRefresh
          ? undefined
          : { village: { id: user.villageId, tokens: -SHRINE_BOOST_COST } },
      };
    }),

  // Unlock AI defender type for village (Kage only)
  unlockAiDefender: protectedProcedure
    .meta({ mcp: { description: "Unlock an AI defender for village" } })
    .input(z.object({ aiId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [{ user, requiresUserRefresh }, ai] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchUser(ctx.drizzle, input.aiId),
      ]);

      if (!user) return errorResponse("User not found");
      if (!user.village || !user.villageId)
        return errorResponse("You must be in a village");
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can unlock AI defenders");
      }
      if (user.village.tokens < SHRINE_AI_UNLOCK_COST) {
        return errorResponse(
          `Need ${SHRINE_AI_UNLOCK_COST.toLocaleString()} tokens to unlock AI defender`,
        );
      }
      if (!ai) return errorResponse("AI not found");

      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      if (currentUnlocks.includes(input.aiId)) {
        return errorResponse("AI defender already unlocked");
      }

      const updatedUnlocks = [...currentUnlocks, input.aiId];

      const updateRes = await updateVillageForUnlockAiDefender(
        ctx.drizzle,
        updatedUnlocks,
        { villageId: user.villageId },
      );

      if (updateRes.rowsAffected === 0) {
        return errorResponse("Not enough village tokens to unlock AI defender");
      }

      return {
        success: true,
        message: `AI defender unlocked! Cost: ${SHRINE_AI_UNLOCK_COST.toLocaleString()} tokens`,
        userPatch: {
          village: {
            id: user.villageId,
            shrineSettings: { unlockedAiIds: updatedUnlocks },
          },
        },
        userDelta: requiresUserRefresh
          ? undefined
          : { village: { id: user.villageId, tokens: -SHRINE_AI_UNLOCK_COST } },
      };
    }),

  // Toggle village-wide AI defender
  toggleVillageAiDefender: protectedProcedure
    .meta({ mcp: { description: "Toggle AI defender active status" } })
    .input(z.object({ aiId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [{ user, requiresUserRefresh }, ai] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchUser(ctx.drizzle, input.aiId),
      ]);

      if (!user) return errorResponse("User not found");
      if (!user.village || !user.villageId)
        return errorResponse("You must be in a village");
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can manage AI defenders");
      }
      if (!ai) return errorResponse("AI not found");

      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      const currentAssigns = user.village.shrineSettings.activeAiIds || [];

      if (!currentUnlocks.includes(input.aiId)) {
        return errorResponse("AI defender not unlocked");
      }

      let newAssigns: string[];
      let message: string;

      if (currentAssigns.includes(input.aiId)) {
        newAssigns = currentAssigns.filter((id) => id !== input.aiId);
        message = `AI defender ${ai.username} removed from active defenders`;
      } else {
        if (currentAssigns.length >= SHRINE_MAX_AI_ASSIGNMENTS) {
          return errorResponse(
            `Can only assign up to ${SHRINE_MAX_AI_ASSIGNMENTS} AI defenders`,
          );
        }
        newAssigns = [...currentAssigns, input.aiId];
        message = `AI defender ${ai.username} added to active defenders`;
      }

      await updateVillageForToggleVillageAiDefender(ctx.drizzle, newAssigns, {
        villageId: user.villageId,
      });

      return {
        success: true,
        message,
        userPatch: {
          village: {
            id: user.villageId,
            shrineSettings: { activeAiIds: newAssigns },
          },
        },
        userDelta: requiresUserRefresh ? undefined : {},
      };
    }),

  // Weekly maintenance payment per sector
  payWeeklyMaintenance: protectedProcedure
    .meta({ mcp: { description: "Pay weekly shrine maintenance" } })
    .input(z.object({ sectorId: z.number() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [{ user, requiresUserRefresh }, targetSector] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        findSectorForPayWeeklyMaintenance(ctx.drizzle, input),
      ]);

      if (!user) return errorResponse("User not found");
      if (!user.village || !user.villageId)
        return errorResponse("You must be in a village");
      if (!targetSector) return errorResponse("Sector not found");
      if (targetSector.villageId !== user.villageId) {
        return errorResponse(
          "You can only pay maintenance for your own village's sectors",
        );
      }
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can pay shrine maintenance");
      }
      if (targetSector.shrineLevel <= 0) {
        return errorResponse("This shrine has been destroyed");
      }
      if (user.village.tokens < SHRINE_WEEKLY_MAINTENANCE_COST) {
        return errorResponse(
          `Need ${SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens for maintenance`,
        );
      }

      const currentNextMaintainanceDueDate =
        targetSector.nextMaintainanceDueDate || new Date();

      const nextNextMaintainanceDueDate = secondsFromDate(
        WAR_SHRINE_MAINTENANCE_DAYS * 24 * 60 * 60,
        currentNextMaintainanceDueDate,
      );

      const tokenRes = await updateVillageForPayWeeklyMaintenance(ctx.drizzle, {
        villageId: user.villageId,
      });

      if (tokenRes.rowsAffected === 0) {
        return errorResponse("Not enough village tokens for maintenance");
      }

      // Match the saved deadline, live shrine and ownership; a concurrent capture,
      // destruction or payment must fail this update and refund the token debit.
      const maintenanceUpdateRes = await updateSectorForPayWeeklyMaintenance(
        ctx.drizzle,
        nextNextMaintainanceDueDate,
        input,
        { villageId: user.villageId },
        targetSector,
      );

      if (maintenanceUpdateRes.rowsAffected === 0) {
        // Refund tokens since the guarded update failed
        await updateVillageForPayWeeklyMaintenance2(ctx.drizzle, {
          villageId: user.villageId,
        });
        return errorResponse(
          "Maintenance update failed - sector may have been modified by another request",
        );
      }

      return {
        success: true,
        message: `Weekly maintenance paid for sector ${targetSector.sector}: ${SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens`,
        userDelta: requiresUserRefresh
          ? undefined
          : {
              village: { id: user.villageId, tokens: -SHRINE_WEEKLY_MAINTENANCE_COST },
            },
      };
    }),

  // Get the boost template for a village
  getBoostTemplate: protectedProcedure
    .meta({ mcp: { description: "Get boost template for a village" } })
    .input(getBoostTemplateSchema)
    .query(async ({ ctx, input }) => {
      const [user, targetVillage] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findVillageForGetBoostTemplate(ctx.drizzle, input),
      ]);

      if (!user) {
        throw serverError("NOT_FOUND", "User not found");
      }
      if (!targetVillage) {
        throw serverError("NOT_FOUND", "Village not found");
      }

      if (user.villageId !== input.villageId && !canSeeSecretData(user.role)) {
        throw serverError(
          "FORBIDDEN",
          "You can only view boost templates for your own village",
        );
      }

      // shrineSettings is notNull with a default, but guard against legacy/null rows
      // the same way the cron tick does rather than dereferencing blindly.
      const shrineSettings = targetVillage.shrineSettings ?? null;
      return {
        boostTemplate: shrineSettings?.boostTemplate ?? [],
        boostTemplateUpdatedBy: shrineSettings?.boostTemplateUpdatedBy ?? null,
        boostTemplateUpdatedAt: shrineSettings?.boostTemplateUpdatedAt ?? null,
      };
    }),

  // Set the boost template for a village (Kage or Elder only)
  setBoostTemplate: protectedProcedure
    .meta({
      mcp: {
        description: "Set boost template for a village (Kage/Elder only)",
      },
    })
    .input(setBoostTemplateSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [{ user, requiresUserRefresh }, hasShrine] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        hasLevel3Shrine(ctx.drizzle, input.villageId),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.villageId) {
        return errorResponse("You can only set boost templates for your own village");
      }
      if (!user.village) return errorResponse("Village not found");
      if (user.village.kageId !== user.userId && user.rank !== "ELDER") {
        return errorResponse("Only the Kage or Elders can set boost templates");
      }
      if (!hasShrine) {
        return errorResponse(
          "Need at least one Level 3 shrine to set a boost template",
        );
      }

      const templateUpdatedAt = new Date().toISOString();
      await updateVillageForSetBoostTemplate(
        ctx.drizzle,
        input,
        user,
        templateUpdatedAt,
      );

      return {
        success: true,
        message: "Boost template saved",
        userPatch: {
          village: {
            id: user.villageId,
            shrineSettings: {
              boostTemplate: input.template,
              boostTemplateUpdatedBy: user.username,
              boostTemplateUpdatedAt: templateUpdatedAt,
            },
          },
        },
        userDelta: requiresUserRefresh ? undefined : {},
      };
    }),

  // ============================================
  // MPVP Shrine Battle Endpoints
  // ============================================

  // Get active shrine battles for a sector
  getShrineBattles: protectedProcedure
    .meta({
      mcp: { description: "Get active shrine battles for sector" },
    })
    .input(z.object({ sectorNumber: z.number() }))
    .query(async ({ ctx, input }) => {
      // Exclude lobbies past their natural lifetime so abandoned shrine
      // battles stop showing up in the lobby UI before the cron deletes them.
      const shrineLobbyStaleBefore = shrineLobbyFreshAfter();
      // Fetch all battles with FIFO ordering (oldest first)
      const [battles, activeWars, viewer] = await Promise.all([
        listMpvpBattleQueueForGetShrineBattles(
          ctx.drizzle,
          input,
          shrineLobbyStaleBefore,
        ),
        fetchActiveWars(ctx.drizzle),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);

      // Filter to non-empty battles and identify empty ones for cleanup
      const nonEmptyBattles = battles.filter((battle) => battle.queue.length > 0);
      const emptyBattleIds = battles
        .filter((battle) => battle.queue.length === 0)
        .map((battle) => battle.id);

      // Non-blocking cleanup of empty queues (fire and forget)
      if (emptyBattleIds.length > 0) {
        void deleteMpvpBattleQueueForGetShrineBattles(ctx.drizzle, emptyBattleIds);
      }

      return nonEmptyBattles.map((entry) => {
        const activeWar = activeWars.find(
          (w) =>
            w.rules &&
            w.objectiveState?.objectives.some((o) => o.sector === entry.sector),
        );
        const side = activeWar
          ? getWarSide(activeWar, viewer.villageId, ctx.userId)
          : viewer.villageId;
        return {
          ...entry,
          viewerSide: !side
            ? null
            : side === entry.defenderEntityId
              ? ("DEFENDER" as const)
              : ("ATTACKER" as const),
          queue: entry.queue.map((member) => ({
            ...member,
            user:
              activeWar?.warMercenaries?.some((m) => m.userId === member.userId) &&
              member.userId !== ctx.userId
                ? { ...member.user, username: "Mercenary", avatar: IMG_AVATAR_DEFAULT }
                : member.user,
          })),
        };
      });
    }),

  // Get user's currently queued shrine battle (to check which sector they're queued for)
  // Filter to active battles (battleId IS NULL) and order explicitly
  getUserQueuedShrineBattle: protectedProcedure
    .meta({ mcp: { description: "Get user's queued shrine battle" } })
    .query(async ({ ctx }) => {
      const shrineLobbyStaleBefore = shrineLobbyFreshAfter();
      const [activeEntry] = await selectMpvpBattleUserForGetUserQueuedShrineBattle(
        ctx.drizzle,
        ctx,
        shrineLobbyStaleBefore,
      );

      return activeEntry ?? null;
    }),

  // Challenge a shrine (create a new shrine battle queue)
  challengeShrine: protectedProcedure
    .meta({ mcp: { description: "Challenge a shrine to battle" } })
    .input(z.object({ sectorNumber: z.number() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch user and sector data
      const [
        { user, requiresUserRefresh },
        targetSector,
        activeWars,
        relationships,
        isHome,
        existingUserBattles,
      ] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        findSectorWithVillage(ctx.drizzle, input.sectorNumber),
        fetchActiveWars(ctx.drizzle),
        fetchAlliances(ctx.drizzle),
        findVillageBySector(ctx.drizzle, input.sectorNumber),
        // Check if user is already in any active battle queue
        fetchActiveUserMpvpBattles(ctx.drizzle, ctx.userId),
      ]);

      // Get the war the user is involved with
      // For SECTOR_WAR: check war.sector matches and user is attacker
      // For VILLAGE_WAR/WAR_RAID: check village sectors
      const userWar = activeWars.find((w) => {
        if (w.status !== "ACTIVE") return false;
        const side = getWarSide(w, user?.villageId ?? null, user?.userId);
        const isUserOnAttackerSide = side === w.attackerVillageId;
        const isUserOnDefenderSide = side === w.defenderVillageId;

        if (w.rules)
          return (
            !!side &&
            isObjectiveWarActive(w) &&
            areWarObjectivesRevealed(w, side) &&
            !!w.objectiveState?.objectives.some(
              (o) =>
                o.sector === input.sectorNumber && o.villageId !== side && !o.destroyed,
            )
          );

        if (w.type === "SECTOR_WAR") {
          // Sector wars use war.sector and only attackers can attack
          return w.sector === input.sectorNumber && isUserOnAttackerSide;
        }

        if (["VILLAGE_WAR", "WAR_RAID"].includes(w.type)) {
          // Village wars/raids: check if user is at the opposing village's sector
          // Attackers attack at defender's village sector
          // Defenders counter-attack at attacker's village sector
          const atDefenderVillage = w.defenderVillage?.sector === input.sectorNumber;
          const atAttackerVillage = w.attackerVillage?.sector === input.sectorNumber;

          return (
            (atDefenderVillage && isUserOnAttackerSide) ||
            (atAttackerVillage && isUserOnDefenderSide)
          );
        }

        return false;
      });

      // Check if this is a Village War or Raid (allows attacking home sectors)
      const isVillageWarOrRaid =
        userWar?.type === "VILLAGE_WAR" || userWar?.type === "WAR_RAID";

      // Relationship check
      const relationship = findRelationship(
        relationships,
        user?.villageId || "",
        targetSector?.villageId || "",
      );

      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake to challenge");
      const attackerSide = userWar
        ? getWarSide(userWar, user.villageId, user.userId)
        : user.villageId;
      if (!attackerSide)
        return errorResponse(
          "You must be in a village or serving as a mercenary for this shrine",
        );
      if (MAP_RESERVED_SECTORS.includes(input.sectorNumber)) {
        return errorResponse("This sector is reserved and cannot be attacked");
      }
      // Home sectors can only be attacked during Village Wars or Raids
      if (isHome && !isVillageWarOrRaid) {
        return errorResponse("Cannot attack shrines in village home sectors");
      }
      if (!targetSector) return errorResponse("Sector not found");
      if (!targetSector.villageId)
        return errorResponse("This sector has no shrine to attack");
      if (targetSector.villageId === user.villageId)
        return errorResponse("Cannot attack your own village's shrine");

      // Sector war or village war check
      const isSyndicate = targetSector.villageId === VILLAGE_SYNDICATE_ID;
      if (!userWar && relationship?.status !== "ENEMY" && !isSyndicate) {
        return errorResponse(
          "You can only attack shrines in sectors where your village has declared a sector war or if you are at war with that village",
        );
      }

      // Check if user is already in any battle queue
      if (existingUserBattles.length > 0) {
        return errorResponse("Already in a battle queue");
      }

      const objectiveWar = activeWars.find(
        (w) =>
          w.rules &&
          w.objectiveState?.objectives.some((o) => o.sector === input.sectorNumber),
      );
      if (objectiveWar) {
        const side = getWarSide(objectiveWar, user.villageId, user.userId);
        if (
          !side ||
          !isObjectiveWarActive(objectiveWar) ||
          !areWarObjectivesRevealed(objectiveWar, side)
        )
          return errorResponse(
            "This objective shrine is hidden until active combat and completed espionage",
          );
      }

      // Create new shrine battle queue with rollback on failure
      const shrineBattleId = nanoid();
      const createdAt = new Date();
      const result = await queueAwakeUser(ctx.drizzle, user);
      if (result.rowsAffected === 0) return errorResponse("Was not awake?");

      try {
        // Insert queue first, then user - sequence allows compensating delete on failure
        await insertMpvpBattleQueueForChallengeShrine(
          ctx.drizzle,
          shrineBattleId,
          attackerSide,
          targetSector,
          input,
          createdAt,
        );

        try {
          await insertMpvpBattleUserForJoinShrineBattle(
            ctx.drizzle,
            user,
            { shrineBattleId, side: "ATTACKER" },
            0,
          );
        } catch (userInsertError) {
          // Compensating delete: remove the queue we just created
          await deleteQueueById(ctx.drizzle, shrineBattleId);
          throw userInsertError;
        }
      } catch (error) {
        // Rollback user status on any insert failure
        await wakeQueuedUser(ctx.drizzle, user.userId);
        throw error;
      }

      // Notify the defending village via village channel
      void pusher.trigger(`village-${targetSector.villageId}`, "event", {
        type: "villageAlert",
        alertType: "SHRINE_UNDER_ATTACK",
        sector: input.sectorNumber,
        message: `Sector ${input.sectorNumber} is under attack! Your village's shrine is being challenged.`,
        route: "/travel",
        routeText: "Go to Map",
      });

      return {
        success: true,
        userPatch: requiresUserRefresh
          ? undefined
          : {
              status: "QUEUED",
              shrineBattles: [
                ...((user as NonNullable<UserWithRelations>).shrineBattles ?? []),
                ...(attackerSide === user.villageId ||
                targetSector.villageId === user.villageId
                  ? [
                      {
                        id: shrineBattleId,
                        createdAt,
                        battleType: "SHRINE_BATTLE" as const,
                        attackerEntityId: attackerSide,
                        defenderEntityId: targetSector.villageId,
                        sector: input.sectorNumber,
                        battleId: null,
                        winnerId: null,
                        territoryWarId: null,
                      },
                    ]
                  : []),
              ],
            },
        message: `Shrine attack party created! Waiting for more attackers (min ${SHRINE_BATTLE_MIN_ATTACKERS})`,
      };
    }),

  // Join a shrine battle queue
  joinShrineBattle: protectedProcedure
    .meta({ mcp: { description: "Join a shrine battle queue" } })
    .input(
      z.object({
        shrineBattleId: z.string(),
        side: z.enum(["ATTACKER", "DEFENDER"]),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const shrineLobbyStaleBefore = shrineLobbyFreshAfter();

      // Fetch user and battle data
      const [
        { user, requiresUserRefresh },
        shrineBattle,
        existingUserBattles,
        activeWars,
      ] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        findMpvpBattleQueueForJoinShrineBattle(
          ctx.drizzle,
          input,
          shrineLobbyStaleBefore,
        ),
        // Check if user is already in any active battle queue
        fetchActiveUserMpvpBattles(ctx.drizzle, ctx.userId),
        fetchActiveWars(ctx.drizzle),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake to join");
      if (
        !user.villageId &&
        !activeWars.some((w) => w.warMercenaries?.some((m) => m.userId === ctx.userId))
      )
        return errorResponse("You must be in a village or serving as a mercenary");
      if (!shrineBattle) return errorResponse("Shrine battle not found");
      if (shrineBattle.battleId) return errorResponse("Shrine battle already started");

      // Check if user is already in any battle queue
      if (existingUserBattles.length > 0) {
        return errorResponse("Already in a battle queue");
      }

      const objectiveWar = activeWars.find(
        (w) =>
          w.rules &&
          w.objectiveState?.objectives.some((o) => o.sector === shrineBattle.sector),
      );
      const side = objectiveWar
        ? getWarSide(objectiveWar, user.villageId, user.userId)
        : null;
      if (objectiveWar) {
        if (
          !side ||
          !isObjectiveWarActive(objectiveWar) ||
          (input.side === "DEFENDER"
            ? side !== shrineBattle.defenderEntityId
            : side === shrineBattle.defenderEntityId ||
              !areWarObjectivesRevealed(objectiveWar, side))
        )
          return errorResponse("You cannot join this shrine party on that war side.");
      } else if (
        !user.villageId ||
        (input.side === "ATTACKER"
          ? user.villageId === shrineBattle.defenderEntityId
          : user.villageId !== shrineBattle.defenderEntityId)
      ) {
        return errorResponse("You cannot join this shrine party on that side.");
      }

      // Find available slots for this side
      const existingSlots = shrineBattle.queue
        .filter((q) => q.side === input.side)
        .map((q) => q.slot)
        .filter((s): s is number => s !== null);

      // Find first available slot (0-based)
      let availableSlot: number | null = null;
      for (let i = 0; i < SHRINE_BATTLE_MAX_USERS_PER_SIDE; i++) {
        if (!existingSlots.includes(i)) {
          availableSlot = i;
          break;
        }
      }

      if (availableSlot === null) {
        return errorResponse(
          `Maximum ${SHRINE_BATTLE_MAX_USERS_PER_SIDE} ${input.side.toLowerCase()}s allowed`,
        );
      }

      // Update user status
      const result = await queueAwakeUser(ctx.drizzle, user);
      if (result.rowsAffected === 0) return errorResponse("Was not awake?");

      // Try to insert with slot - unique constraint prevents race conditions
      try {
        await insertMpvpBattleUserForJoinShrineBattle(
          ctx.drizzle,
          user,
          input,
          availableSlot,
        );
      } catch (error) {
        // On any insert failure, verify user status and revert if needed
        const isDuplicateError = isMysqlDuplicateKeyError(error);

        // Verify user is still QUEUED and not in any queue before reverting
        const [currentUser, existingEntry] = await Promise.all([
          findUserDataForJoinShrineBattle(ctx.drizzle, user),
          findMpvpBattleUserForJoinShrineBattle(ctx.drizzle, user, input),
        ]);

        // Only revert if user is still QUEUED and not in this battle
        if (currentUser?.status === "QUEUED" && !existingEntry) {
          await wakeQueuedUser(ctx.drizzle, user.userId);
        }

        if (isDuplicateError) {
          return errorResponse("Slot was taken by another player. Please try again.");
        }
        // For other errors, rethrow after status revert
        throw error;
      }

      return {
        success: true,
        userPatch: requiresUserRefresh ? undefined : { status: "QUEUED" },
        message: `Joined shrine battle as ${input.side.toLowerCase()}`,
      };
    }),

  // Leave a shrine battle queue (DB-guarded writes to prevent races)
  leaveShrineBattle: protectedProcedure
    .meta({ mcp: { description: "Leave a shrine battle queue" } })
    .input(z.object({ shrineBattleId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch user data
      const { user, requiresUserRefresh } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "QUEUED") return errorResponse("Not queued");

      const shrineLobbyStaleBefore = shrineLobbyFreshAfter();

      // Use a subquery to only delete if the parent battle hasn't started and isn't stale
      // This ensures atomic check + delete for the mpvpBattleUser row
      const activeQueueSubquery = selectMpvpBattleQueueForLeaveShrineBattle(
        ctx.drizzle,
        input,
        shrineLobbyStaleBefore,
      );

      const deleteResult = await deleteMpvpBattleUserForLeaveShrineBattle(
        ctx.drizzle,
        user,
        activeQueueSubquery,
      );

      // If no rows deleted, either user wasn't in queue, battle started, or lobby expired
      if (deleteResult.rowsAffected === 0) {
        const battle = await findMpvpBattleQueueForLeaveShrineBattle(
          ctx.drizzle,
          input,
        );
        if (battle?.battleId) {
          return errorResponse("Shrine battle already started - cannot leave");
        }
        if (battle && battle.createdAt <= shrineLobbyStaleBefore) {
          // Lobby is confirmed stale — reset status immediately so the user
          // isn't blocked until the cron tick clears it.
          const wake = await wakeQueuedUser(ctx.drizzle, user.userId);
          return {
            ...errorResponse("Shrine battle expired"),
            userPatch:
              !requiresUserRefresh && wake.rowsAffected === 1
                ? {
                    status: "AWAKE",
                    shrineBattles:
                      (user as NonNullable<UserWithRelations>).shrineBattles ?? [],
                  }
                : undefined,
          };
        }
        return errorResponse("Not in this shrine battle queue");
      }

      // Only update user status if we successfully deleted the queue entry
      const wake = await wakeQueuedUser(ctx.drizzle, user.userId);

      // If no one left in queue, delete the battle queue
      const counts = await selectMpvpBattleUserForLeaveShrineBattle(ctx.drizzle, input);
      const remaining = counts[0]?.remaining ?? 0;

      const removed =
        remaining === 0
          ? await deleteUnclaimedBattleQueue(ctx.drizzle, input.shrineBattleId)
          : undefined;

      return {
        success: true,
        message: "Left shrine battle queue",
        userPatch:
          !requiresUserRefresh &&
          wake.rowsAffected === 1 &&
          (remaining > 0 || removed?.rowsAffected === 1)
            ? {
                status: "AWAKE",
                shrineBattles: (
                  (user as NonNullable<UserWithRelations>).shrineBattles ?? []
                ).filter((entry) => remaining > 0 || entry.id !== input.shrineBattleId),
              }
            : undefined,
      };
    }),

  // Initiate shrine battle (start the battle after lobby time)
  // Fixed double-start race with atomic claim BEFORE initiateBattle()
  initiateShrineBattle: protectedProcedure
    .meta({ mcp: { description: "Start a shrine battle" } })
    .input(z.object({ shrineBattleId: z.string() }))
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const shrineLobbyStaleBefore = shrineLobbyFreshAfter();

      // Fetch user and battle data
      const [{ user }, shrineBattle, activeWars, relationships] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        findMpvpBattleQueueForJoinShrineBattle(
          ctx.drizzle,
          input,
          shrineLobbyStaleBefore,
        ),
        fetchActiveWars(ctx.drizzle),
        fetchAlliances(ctx.drizzle),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (!shrineBattle) return errorResponse("Shrine battle not found");
      if (shrineBattle.battleId) return errorResponse("Battle already initiated");

      // Check if user is in the queue as an attacker (only attackers can initiate)
      const userQueueEntry = shrineBattle.queue.find((q) => q.userId === user.userId);
      if (!userQueueEntry) return errorResponse("Not in this shrine battle");
      if (userQueueEntry.side !== "ATTACKER") {
        return errorResponse("Only attackers can initiate the shrine battle");
      }

      // Get the war the user is involved with
      const userWar = activeWars.find((w) =>
        w.rules
          ? isObjectiveWarActive(w) &&
            !!w.objectiveState?.objectives.some((o) => o.sector === shrineBattle.sector)
          : w.attackerVillageId === user.villageId &&
            w.sector === shrineBattle.sector &&
            w.type === "SECTOR_WAR",
      );
      if (
        userWar?.rules &&
        shrineBattle.queue.some((entry) => {
          const side = getWarSide(userWar, entry.user.villageId, entry.userId);
          return (
            !side ||
            (entry.side === "DEFENDER"
              ? side !== shrineBattle.defenderEntityId
              : side === shrineBattle.defenderEntityId ||
                !areWarObjectivesRevealed(userWar, side))
          );
        })
      )
        return errorResponse(
          "This objective shrine is unavailable until active combat and completed espionage, or a queued participant’s war affiliation changed. Leave the queue and try again.",
        );

      // Relationship check
      const relationship = findRelationship(
        relationships,
        user?.villageId || "",
        shrineBattle.defenderEntityId || "",
      );

      // Sector war or village war check
      const isSyndicate = shrineBattle.defenderEntityId === VILLAGE_SYNDICATE_ID;
      if (!userWar && relationship?.status !== "ENEMY" && !isSyndicate) {
        return errorResponse(
          "You can only attack shrines in sectors where your village has declared a sector war or if you are at war with that village",
        );
      }

      // Check lobby time has passed
      if (
        new Date() <
        secondsFromDate(SHRINE_BATTLE_LOBBY_SECONDS, shrineBattle.createdAt)
      ) {
        return errorResponse("Shrine battle lobby time has not passed yet");
      }

      // Get attackers and defenders
      const attackers = shrineBattle.queue.filter((q) => q.side === "ATTACKER");
      const defenders = shrineBattle.queue.filter((q) => q.side === "DEFENDER");
      const allUserIds = shrineBattle.queue.map((q) => q.userId);

      // Check minimum attackers
      if (attackers.length < SHRINE_BATTLE_MIN_ATTACKERS) {
        return errorResponse(
          `Need at least ${SHRINE_BATTLE_MIN_ATTACKERS} attackers to start`,
        );
      }

      // Prepare attacker and defender IDs
      const attackerIds = attackers.map((a) => a.userId);
      let defenderIds: string[] = defenders.map((d) => d.userId);

      // If no player defenders, use AI defenders from the defender village
      if (defenderIds.length === 0) {
        // Use defenderEntityId directly - it's the village ID for shrine battles
        const defenderVillage = await findVillageById(
          ctx.drizzle,
          shrineBattle.defenderEntityId,
        );
        if (defenderVillage?.shrineSettings?.activeAiIds) {
          defenderIds = defenderVillage.shrineSettings.activeAiIds.slice(
            0,
            SHRINE_BATTLE_MAX_USERS_PER_SIDE,
          );
        }
        // If still no village-configured AI, fall back to global shrine AIs
        if (defenderIds.length === 0) {
          const globalAiDefenders = await listUserDataForInitiateShrineBattle(
            ctx.drizzle,
          );
          defenderIds = globalAiDefenders.map((ai) => ai.userId);
        }
        // Final fallback: use the same hardcoded AI as solo shrine battles
        if (defenderIds.length === 0) {
          defenderIds = ["MJMzOE67Cx2YP3NX8SAbh"];
        }
      }

      // CRITICAL: Claim the battle BEFORE calling initiateBattle()
      // Use a placeholder battle ID to atomically claim this queue
      const claimId = `claiming-${nanoid()}`;
      const claimResult = await claimBattleQueue(
        ctx.drizzle,
        claimId,
        input.shrineBattleId,
      );

      // If no rows updated, another process already claimed this battle
      if (claimResult.rowsAffected === 0) {
        return errorResponse("Battle was already initiated by another participant");
      }

      // Now we have exclusive ownership - start the battle
      const result = await initiateBattle(
        {
          userIds: attackerIds,
          targetIds: defenderIds,
          client: ctx.drizzle,
          biome: "default",
          forceDefenderVillageId: shrineBattle.defenderEntityId,
          sector: shrineBattle.sector ?? undefined,
        },
        "SHRINE_WAR",
      );

      if (result.success && result.battleId) {
        // Update with the real battleId (replace our claim placeholder)
        await setQueueBattleId(ctx.drizzle, result.battleId, input.shrineBattleId);

        // Note: initiateBattle() sets human participants to status="BATTLE".
        // AI defender rows are never claimed or modified — the shared AI row
        // is cloned into the battle state instead, so it stays untouched.

        // Notify participants
        allUserIds.forEach((userId) => {
          void pusher.trigger(userId, "event", {
            type: "userMessage",
            message: "Shrine battle has started!",
            route: "/combat",
            routeText: "To Combat",
          });
        });

        return {
          success: true,
          message: "Shrine battle initiated!",
          battleId: result.battleId,
        };
      }

      // If initiateBattle failed, release the claim so others can try
      await releaseBattleQueueClaim(ctx.drizzle, input.shrineBattleId, claimId);

      return errorResponse(`Failed to initiate shrine battle: ${result.message}`);
    }),
});

/**
 * Returns whether the village controls at least one Level 3 shrine.
 * Existence-only check — selects a single id rather than pulling full sector rows.
 */
const hasLevel3Shrine = async (
  client: DrizzleClient,
  villageId: string,
): Promise<boolean> => {
  const rows = await selectSectorForHasLevel3Shrine(client, villageId);
  return rows.length > 0;
};
