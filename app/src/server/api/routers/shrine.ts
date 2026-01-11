import { z } from "zod";
import { nanoid } from "nanoid";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { baseServerResponse, errorResponse } from "../trpc";
import { eq, and, gte, sql, asc, isNull, desc, inArray } from "drizzle-orm";
import {
  SHRINE_UPGRADE_COST,
  SHRINE_BOOST_DURATION_HOURS,
  SHRINE_AI_UNLOCK_COST,
  SHRINE_MAX_AI_ASSIGNMENTS,
  SHRINE_MAX_LEVEL,
  SHRINE_WEEKLY_MAINTENANCE_COST,
  SHRINE_BOOST_TYPES,
  SHRINE_BOOST_COST,
  WAR_SHRINE_MAINTENANCE_DAYS,
  SHRINE_BATTLE_MIN_ATTACKERS,
  SHRINE_BATTLE_MAX_USERS_PER_SIDE,
  SHRINE_BATTLE_LOBBY_SECONDS,
} from "@/drizzle/constants";
import {
  sector,
  village,
  userData,
  mpvpBattleQueue,
  mpvpBattleUser,
} from "@/drizzle/schema";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { secondsFromDate, secondsFromNow } from "@/utils/time";
import { initiateBattle } from "@/routers/combat";
import { getServerPusher } from "@/libs/pusher";

// Pusher instance
const pusher = getServerPusher();

export const shrineRouter = createTRPCRouter({
  // Get all AI names
  getShrineAis: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.userData.findMany({
      where: and(eq(userData.isAi, true), eq(userData.inShrines, true)),
      with: {
        jutsus: {
          columns: {
            level: true,
          },
          with: {
            jutsu: {
              columns: {
                name: true,
              },
            },
          },
        },
      },
      columns: {
        userId: true,
        username: true,
        level: true,
        rank: true,
        avatar: true,
      },
      orderBy: asc(userData.level),
    });
  }),
  // Get the captured sectors for a village
  getCapturedSectors: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sectors = await ctx.drizzle.query.sector.findMany({
        where: eq(sector.villageId, input.villageId),
      });
      return sectors;
    }),
  // Upgrade a shrine level (simplified version)
  upgradeShrine: protectedProcedure
    .input(z.object({ sectorNumber: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, targetSector] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.sector.findFirst({
          where: eq(sector.sector, input.sectorNumber),
        }),
      ]);

      // Guards
      if (!user?.villageId) {
        return errorResponse("You must be in a village");
      }
      if (!targetSector) {
        return errorResponse("Sector not found");
      }
      if (targetSector.villageId !== user.villageId) {
        return errorResponse("You can only upgrade your own shrines");
      }
      if (targetSector.shrineLevel >= SHRINE_MAX_LEVEL) {
        return errorResponse(`Shrine level cannot exceed ${SHRINE_MAX_LEVEL}`);
      }
      if (user?.village?.kageId !== user.userId) {
        return errorResponse("Only the Kage can upgrade shrines");
      }
      if (user?.village?.tokens < SHRINE_UPGRADE_COST) {
        return errorResponse(
          `Need ${SHRINE_UPGRADE_COST.toLocaleString()} tokens to upgrade shrine`,
        );
      }

      // Calculate new HP and perform upgrade
      await Promise.all([
        ctx.drizzle
          .update(sector)
          .set({ shrineLevel: targetSector.shrineLevel + 1 })
          .where(eq(sector.sector, input.sectorNumber)),
        ctx.drizzle
          .update(village)
          .set({ tokens: user.village.tokens - SHRINE_UPGRADE_COST })
          .where(eq(village.id, user.villageId)),
      ]);

      return {
        success: true,
        message: `Successfully upgraded shrine to level ${targetSector.shrineLevel + 1}!`,
      };
    }),

  // Activate village-wide boost (requires level 3 shrine)
  activateBoost: protectedProcedure
    .input(z.object({ boostType: z.enum(SHRINE_BOOST_TYPES), villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, level3Shrines] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.sector.findMany({
          where: and(eq(sector.villageId, input.villageId), eq(sector.shrineLevel, 3)),
        }),
      ]);
      // Guards
      if (!user?.villageId) {
        return errorResponse("You must be in a village");
      }
      if (user.villageId !== input.villageId) {
        return errorResponse("You can only activate boosts for your own village");
      }
      if (!user.village) {
        return errorResponse("Village not found");
      }
      if (user.village?.kageId !== user.userId) {
        return errorResponse("Only the Kage can activate boosts");
      }
      if (level3Shrines.length === 0) {
        return errorResponse("Need at least one Level 3 shrine to activate boosts");
      }
      if (user.village.tokens < SHRINE_BOOST_COST) {
        return errorResponse(
          `Need ${SHRINE_BOOST_COST.toLocaleString()} tokens to activate boosts`,
        );
      }

      // Check if boost is already active
      const currentBoosts = user.village.shrineSettings.activeBoosts || {};
      const existingBoost = currentBoosts[input.boostType];
      if (existingBoost && new Date(existingBoost) > new Date()) {
        return errorResponse(`${input.boostType} boost is already active`);
      }

      // Update active boosts
      const boostExpiry = secondsFromNow(SHRINE_BOOST_DURATION_HOURS * 60 * 60);
      const updatedBoosts = {
        ...currentBoosts,
        [input.boostType]: boostExpiry.toISOString(),
      };

      // Run mutation to do update
      await ctx.drizzle
        .update(village)
        .set({
          tokens: sql`${village.tokens} - ${SHRINE_BOOST_COST}`,
          shrineSettings: {
            ...user.village.shrineSettings,
            activeBoosts: updatedBoosts,
          },
        })
        .where(eq(village.id, user.villageId));

      return {
        success: true,
        message: `${input.boostType} boost activated for ${SHRINE_BOOST_DURATION_HOURS} hours!`,
      };
    }),

  // Unlock AI defender type for village (Kage only)
  unlockAiDefender: protectedProcedure
    .input(z.object({ aiId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [{ user }, ai] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchUser(ctx.drizzle, input.aiId),
      ]);

      // Guards
      if (!user) {
        return errorResponse("User not found");
      }
      if (!user.village || !user.villageId) {
        return errorResponse("You must be in a village");
      }
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can unlock AI defenders");
      }
      if (user.village.tokens < SHRINE_AI_UNLOCK_COST) {
        return errorResponse(
          `Need ${SHRINE_AI_UNLOCK_COST.toLocaleString()} tokens to unlock AI defender`,
        );
      }
      if (!ai) {
        return errorResponse("AI not found");
      }
      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      if (currentUnlocks.includes(input.aiId)) {
        return errorResponse("AI defender already unlocked");
      }

      // Update unlocked AI types
      const updatedUnlocks = [...currentUnlocks, input.aiId];

      // Deduct tokens and update unlocked AI IDs
      await ctx.drizzle
        .update(village)
        .set({
          tokens: sql`${village.tokens} - ${SHRINE_AI_UNLOCK_COST}`,
          shrineSettings: {
            ...user.village.shrineSettings,
            unlockedAiIds: updatedUnlocks,
          },
        })
        .where(
          and(
            eq(village.id, user.villageId),
            gte(village.tokens, SHRINE_AI_UNLOCK_COST),
          ),
        );

      return {
        success: true,
        message: `AI defender unlocked! Cost: ${SHRINE_AI_UNLOCK_COST.toLocaleString()} tokens`,
      };
    }),

  // Toggle village-wide AI defender
  toggleVillageAiDefender: protectedProcedure
    .input(z.object({ aiId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [{ user }, ai] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchUser(ctx.drizzle, input.aiId),
      ]);

      // Guards
      if (!user) {
        return errorResponse("User not found");
      }
      if (!user.village || !user.villageId) {
        return errorResponse("You must be in a village");
      }
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can manage AI defenders");
      }
      if (!ai) {
        return errorResponse("AI not found");
      }

      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      const currentAssigns = user.village.shrineSettings.activeAiIds || [];

      if (!currentUnlocks.includes(input.aiId)) {
        return errorResponse("AI defender not unlocked");
      }

      let newAssigns: string[];
      let message: string;

      if (currentAssigns.includes(input.aiId)) {
        // Remove AI defender (deselect)
        newAssigns = currentAssigns.filter((id) => id !== input.aiId);
        message = `AI defender ${ai.username} removed from active defenders`;
      } else {
        // Add AI defender (select)
        if (currentAssigns.length >= SHRINE_MAX_AI_ASSIGNMENTS) {
          return errorResponse(
            `Can only assign up to ${SHRINE_MAX_AI_ASSIGNMENTS} AI defenders`,
          );
        }
        newAssigns = [...currentAssigns, input.aiId];
        message = `AI defender ${ai.username} added to active defenders`;
      }

      // Run update mutation
      await ctx.drizzle
        .update(village)
        .set({
          shrineSettings: {
            ...user.village.shrineSettings,
            activeAiIds: newAssigns,
          },
        })
        .where(eq(village.id, user.villageId));

      return { success: true, message };
    }),

  // Weekly maintenance payment per sector
  payWeeklyMaintenance: protectedProcedure
    .input(z.object({ sectorId: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, targetSector] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.sector.findFirst({
          where: eq(sector.id, input.sectorId),
          with: {
            village: true,
          },
        }),
      ]);

      // Guards
      if (!user) {
        return errorResponse("User not found");
      }
      if (!user.village || !user.villageId) {
        return errorResponse("You must be in a village");
      }
      if (!targetSector) {
        return errorResponse("Sector not found");
      }
      if (targetSector.villageId !== user.villageId) {
        return errorResponse(
          "You can only pay maintenance for your own village's sectors",
        );
      }
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can pay shrine maintenance");
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

      // Update payment and maintenance date for the specific sector
      await Promise.all([
        ctx.drizzle
          .update(village)
          .set({
            tokens: sql`${village.tokens} - ${SHRINE_WEEKLY_MAINTENANCE_COST}`,
          })
          .where(
            and(
              eq(village.id, user.villageId),
              gte(village.tokens, SHRINE_WEEKLY_MAINTENANCE_COST),
            ),
          ),
        ctx.drizzle
          .update(sector)
          .set({
            nextMaintainanceDueDate: nextNextMaintainanceDueDate,
          })
          .where(eq(sector.id, input.sectorId)),
      ]);

      return {
        success: true,
        message: `Weekly maintenance paid for sector ${targetSector.sector}: ${SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens`,
      };
    }),

  // ============================================
  // MPVP Shrine Battle Endpoints
  // ============================================

  // Get active shrine battles for a sector
  getShrineBattles: protectedProcedure
    .input(z.object({ sectorNumber: z.number() }))
    .query(async ({ ctx, input }) => {
      // Fetch all battles with FIFO ordering (oldest first)
      const battles = await ctx.drizzle.query.mpvpBattleQueue.findMany({
        where: and(
          eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
          eq(mpvpBattleQueue.sector, input.sectorNumber),
          isNull(mpvpBattleQueue.battleId),
        ),
        with: {
          queue: {
            columns: {
              userId: true,
              side: true,
              slot: true,
              createdAt: true,
            },
            with: {
              user: {
                columns: {
                  username: true,
                  level: true,
                  rank: true,
                  avatar: true,
                  villageId: true,
                },
              },
            },
          },
        },
        orderBy: asc(mpvpBattleQueue.createdAt), // FIFO ordering - oldest first
      });

      // Filter to non-empty battles and identify empty ones for cleanup
      const nonEmptyBattles = battles.filter((battle) => battle.queue.length > 0);
      const emptyBattleIds = battles
        .filter((battle) => battle.queue.length === 0)
        .map((battle) => battle.id);

      // Non-blocking cleanup of empty queues (fire and forget)
      if (emptyBattleIds.length > 0) {
        void ctx.drizzle
          .delete(mpvpBattleQueue)
          .where(
            and(
              inArray(mpvpBattleQueue.id, emptyBattleIds),
              isNull(mpvpBattleQueue.battleId),
            ),
          );
      }

      return nonEmptyBattles;
    }),

  // Get user's currently queued shrine battle (to check which sector they're queued for)
  // Filter to active battles (battleId IS NULL) and order explicitly
  getUserQueuedShrineBattle: protectedProcedure.query(async ({ ctx }) => {
    // Query all queue entries for this user with their battle info
    const queueEntries = await ctx.drizzle.query.mpvpBattleUser.findMany({
      where: eq(mpvpBattleUser.userId, ctx.userId),
      with: {
        clanBattle: {
          columns: {
            id: true,
            battleType: true,
            sector: true,
            battleId: true,
            createdAt: true,
          },
        },
      },
      orderBy: desc(mpvpBattleUser.createdAt),
    });

    // Find the first active shrine battle (battleId IS NULL means not started)
    const activeEntry = queueEntries.find(
      (entry) =>
        entry.clanBattle?.battleType === "SHRINE_BATTLE" &&
        entry.clanBattle?.battleId === null,
    );

    // Return null if not in any active shrine battle queue
    if (!activeEntry || !activeEntry.clanBattle) {
      return null;
    }

    return {
      battleId: activeEntry.clanBattle.id,
      sector: activeEntry.clanBattle.sector,
    };
  }),

  // Challenge a shrine (create a new shrine battle queue)
  challengeShrine: protectedProcedure
    .input(z.object({ sectorNumber: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user and sector data
      const [{ user }, targetSector, existingQueues] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.sector.findFirst({
          where: eq(sector.sector, input.sectorNumber),
          with: {
            village: true,
          },
        }),
        ctx.drizzle.query.mpvpBattleQueue.findMany({
          where: and(
            eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
            eq(mpvpBattleQueue.sector, input.sectorNumber),
            isNull(mpvpBattleQueue.battleId),
          ),
          with: {
            queue: true,
          },
        }),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake to challenge");
      if (!user.villageId) return errorResponse("You must be in a village");
      if (!targetSector) return errorResponse("Sector not found");
      if (!targetSector.villageId)
        return errorResponse("This sector has no shrine to attack");
      if (targetSector.villageId === user.villageId)
        return errorResponse("Cannot attack your own village's shrine");

      // Check if user is already in a queue
      const alreadyQueued = existingQueues.some((q) =>
        q.queue.some((u) => u.userId === user.userId),
      );
      if (alreadyQueued) return errorResponse("Already in a shrine battle queue");

      // Create new shrine battle queue with rollback on failure
      const shrineBattleId = nanoid();
      const result = await ctx.drizzle
        .update(userData)
        .set({ status: "QUEUED" })
        .where(and(eq(userData.userId, user.userId), eq(userData.status, "AWAKE")));
      if (result.rowsAffected === 0) return errorResponse("Was not awake?");

      try {
        // Insert queue first, then user - sequence allows compensating delete on failure
        await ctx.drizzle.insert(mpvpBattleQueue).values({
          id: shrineBattleId,
          createdAt: new Date(),
          battleType: "SHRINE_BATTLE",
          attackerEntityId: user.villageId,
          defenderEntityId: targetSector.villageId,
          sector: input.sectorNumber,
        });

        try {
          await ctx.drizzle.insert(mpvpBattleUser).values({
            id: nanoid(),
            userId: user.userId,
            clanBattleId: shrineBattleId,
            side: "ATTACKER",
            slot: 0, // First attacker gets slot 0
          });
        } catch (userInsertError) {
          // Compensating delete: remove the queue we just created
          await ctx.drizzle
            .delete(mpvpBattleQueue)
            .where(eq(mpvpBattleQueue.id, shrineBattleId));
          throw userInsertError;
        }
      } catch (error) {
        // Rollback user status on any insert failure
        await ctx.drizzle
          .update(userData)
          .set({ status: "AWAKE" })
          .where(eq(userData.userId, user.userId));
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
        message: `Shrine attack party created! Waiting for more attackers (min ${SHRINE_BATTLE_MIN_ATTACKERS})`,
      };
    }),

  // Join a shrine battle queue
  joinShrineBattle: protectedProcedure
    .input(
      z.object({
        shrineBattleId: z.string(),
        side: z.enum(["ATTACKER", "DEFENDER"]),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user and battle data
      const [{ user }, shrineBattle] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.mpvpBattleQueue.findFirst({
          where: and(
            eq(mpvpBattleQueue.id, input.shrineBattleId),
            eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
          ),
          with: {
            queue: {
              with: {
                user: {
                  columns: {
                    username: true,
                    villageId: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake to join");
      if (!user.villageId) return errorResponse("You must be in a village");
      if (!shrineBattle) return errorResponse("Shrine battle not found");
      if (shrineBattle.battleId) return errorResponse("Shrine battle already started");

      // Check if user is already in queue
      const alreadyQueued = shrineBattle.queue.some((q) => q.userId === user.userId);
      if (alreadyQueued) return errorResponse("Already in this shrine battle queue");

      // Validate side based on village
      if (input.side === "ATTACKER") {
        if (user.villageId === shrineBattle.defenderEntityId) {
          return errorResponse("Defenders cannot join as attackers");
        }
      } else {
        if (user.villageId !== shrineBattle.defenderEntityId) {
          return errorResponse("Only shrine village members can defend");
        }
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
      const result = await ctx.drizzle
        .update(userData)
        .set({ status: "QUEUED" })
        .where(and(eq(userData.userId, user.userId), eq(userData.status, "AWAKE")));
      if (result.rowsAffected === 0) return errorResponse("Was not awake?");

      // Try to insert with slot - unique constraint prevents race conditions
      try {
        await ctx.drizzle.insert(mpvpBattleUser).values({
          id: nanoid(),
          userId: user.userId,
          clanBattleId: input.shrineBattleId,
          side: input.side,
          slot: availableSlot,
        });
      } catch (error) {
        // On any insert failure, verify user status and revert if needed
        // Check if it's a duplicate key/constraint violation (slot taken)
        const isDuplicateError =
          error instanceof Error &&
          (error.message.includes("Duplicate entry") ||
            error.message.includes("ER_DUP_ENTRY") ||
            error.message.includes("UNIQUE constraint"));

        // Verify user is still QUEUED and not in any queue before reverting
        const [currentUser, existingEntry] = await Promise.all([
          ctx.drizzle.query.userData.findFirst({
            where: eq(userData.userId, user.userId),
            columns: { status: true },
          }),
          ctx.drizzle.query.mpvpBattleUser.findFirst({
            where: and(
              eq(mpvpBattleUser.userId, user.userId),
              eq(mpvpBattleUser.clanBattleId, input.shrineBattleId),
            ),
          }),
        ]);

        // Only revert if user is still QUEUED and not in this battle
        if (currentUser?.status === "QUEUED" && !existingEntry) {
          await ctx.drizzle
            .update(userData)
            .set({ status: "AWAKE" })
            .where(
              and(eq(userData.userId, user.userId), eq(userData.status, "QUEUED")),
            );
        }

        if (isDuplicateError) {
          return errorResponse("Slot was taken by another player. Please try again.");
        }
        // For other errors, rethrow after status revert
        throw error;
      }

      return {
        success: true,
        message: `Joined shrine battle as ${input.side.toLowerCase()}`,
      };
    }),

  // Leave a shrine battle queue (DB-guarded writes to prevent races)
  leaveShrineBattle: protectedProcedure
    .input(z.object({ shrineBattleId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user data
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "QUEUED") return errorResponse("Not queued");

      // Use a subquery to only delete if the parent battle hasn't started
      // This ensures atomic check + delete for the mpvpBattleUser row
      const activeQueueSubquery = ctx.drizzle
        .select({ id: mpvpBattleQueue.id })
        .from(mpvpBattleQueue)
        .where(
          and(
            eq(mpvpBattleQueue.id, input.shrineBattleId),
            isNull(mpvpBattleQueue.battleId),
          ),
        );

      const deleteResult = await ctx.drizzle
        .delete(mpvpBattleUser)
        .where(
          and(
            eq(mpvpBattleUser.userId, user.userId),
            inArray(mpvpBattleUser.clanBattleId, activeQueueSubquery),
          ),
        );

      // If no rows deleted, either user wasn't in queue or battle already started
      if (deleteResult.rowsAffected === 0) {
        // Check why - was it because battle started?
        const battle = await ctx.drizzle.query.mpvpBattleQueue.findFirst({
          where: eq(mpvpBattleQueue.id, input.shrineBattleId),
          columns: { battleId: true },
        });
        if (battle?.battleId) {
          return errorResponse("Shrine battle already started - cannot leave");
        }
        return errorResponse("Not in this shrine battle queue");
      }

      // Only update user status if we successfully deleted the queue entry
      await ctx.drizzle
        .update(userData)
        .set({ status: "AWAKE" })
        .where(and(eq(userData.userId, user.userId), eq(userData.status, "QUEUED")));

      // If no one left in queue, delete the battle queue
      const counts = await ctx.drizzle
        .select({ remaining: sql<number>`count(*)` })
        .from(mpvpBattleUser)
        .where(eq(mpvpBattleUser.clanBattleId, input.shrineBattleId));
      const remaining = counts[0]?.remaining ?? 0;

      if (remaining === 0) {
        // Only delete if battleId is still null (battle hasn't started)
        await ctx.drizzle
          .delete(mpvpBattleQueue)
          .where(
            and(
              eq(mpvpBattleQueue.id, input.shrineBattleId),
              isNull(mpvpBattleQueue.battleId),
            ),
          );
      }

      return { success: true, message: "Left shrine battle queue" };
    }),

  // Initiate shrine battle (start the battle after lobby time)
  // Fixed double-start race with atomic claim BEFORE initiateBattle()
  initiateShrineBattle: protectedProcedure
    .input(z.object({ shrineBattleId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user and battle data
      const [{ user }, shrineBattle] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.mpvpBattleQueue.findFirst({
          where: and(
            eq(mpvpBattleQueue.id, input.shrineBattleId),
            eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
          ),
          with: {
            queue: {
              with: {
                user: {
                  columns: {
                    username: true,
                    villageId: true,
                  },
                },
              },
            },
          },
        }),
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
        const defenderVillage = await ctx.drizzle.query.village.findFirst({
          where: eq(village.id, shrineBattle.defenderEntityId),
        });
        if (defenderVillage?.shrineSettings?.activeAiIds) {
          defenderIds = defenderVillage.shrineSettings.activeAiIds.slice(
            0,
            SHRINE_BATTLE_MAX_USERS_PER_SIDE,
          );
        }
        // If still no village-configured AI, fall back to global shrine AIs
        if (defenderIds.length === 0) {
          const globalAiDefenders = await ctx.drizzle.query.userData.findMany({
            where: and(eq(userData.isAi, true), eq(userData.inShrines, true)),
            columns: { userId: true },
            limit: SHRINE_BATTLE_MAX_USERS_PER_SIDE,
          });
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
      const claimResult = await ctx.drizzle
        .update(mpvpBattleQueue)
        .set({ battleId: claimId })
        .where(
          and(
            eq(mpvpBattleQueue.id, input.shrineBattleId),
            isNull(mpvpBattleQueue.battleId),
          ),
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
        },
        "SHRINE_WAR",
      );

      if (result.success && result.battleId) {
        // Update with the real battleId (replace our claim placeholder)
        await ctx.drizzle
          .update(mpvpBattleQueue)
          .set({ battleId: result.battleId })
          .where(eq(mpvpBattleQueue.id, input.shrineBattleId));

        // Note: initiateBattle() already sets user statuses appropriately:
        // - Human players: status="BATTLE"
        // - AI defenders: status="AWAKE"

        // Notify participants
        allUserIds.forEach((userId) => {
          void pusher.trigger(userId, "event", {
            type: "userMessage",
            message: "Shrine battle has started!",
            route: "/combat",
            routeText: "To Combat",
          });
        });

        return { success: true, message: "Shrine battle initiated!" };
      }

      // If initiateBattle failed, release the claim so others can try
      await ctx.drizzle
        .update(mpvpBattleQueue)
        .set({ battleId: null })
        .where(
          and(
            eq(mpvpBattleQueue.id, input.shrineBattleId),
            eq(mpvpBattleQueue.battleId, claimId),
          ),
        );

      return errorResponse(`Failed to initiate shrine battle: ${result.message}`);
    }),
});
