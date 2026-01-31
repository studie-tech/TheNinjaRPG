import { z } from "zod";
import { nanoid } from "nanoid";
import {
  createTRPCRouter,
  protectedProcedure,
  ratelimitMiddleware,
  hasUserMiddleware,
  baseServerResponse,
  errorResponse,
} from "../trpc";
import { and, eq, gte, lt, lte, isNull, sql, desc, inArray } from "drizzle-orm";
import {
  quest,
  raidParticipation,
  raidDamageThreshold,
  userRaidBuff,
  mpvpBattleQueue,
  mpvpBattleUser,
  userData,
  sector,
  item,
  jutsu,
  bloodline,
  badge,
  war,
} from "@/drizzle/schema";
import {
  RAID_BATTLE_MAX_USERS_PER_TEAM,
  RAID_MAX_CONCURRENT_TEAMS,
  RAID_BATTLE_LOBBY_SECONDS,
  RAID_CLAIMING_TIMEOUT_MS,
} from "@/drizzle/constants";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { initiateBattle } from "@/routers/combat";
import { updateRewards } from "@/routers/quests";
import { ObjectiveReward } from "@/validators/rewards";
import type { RaidObjectiveType } from "@/validators/objectives";
import { postProcessRewards } from "@/libs/quest";
import { getRaidObjectiveData, validateRaidIsActive } from "@/libs/raids";
import { secondsFromDate } from "@/utils/time";
import { getServerPusher, updateRaidTeamsOnSector } from "@/libs/pusher";
import type { DrizzleClient } from "@/server/db";
import { canChangeContent } from "@/utils/permissions";
import { AllTags } from "@/validators/combat";

export const raidsRouter = createTRPCRouter({
  /**
   * Get completed raids (ended or boss defeated) for viewing history and claiming rewards
   */
  getCompletedRaids: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      // Derived
      const now = new Date();
      const limit = input?.limit ?? 20;

      // Query - fetch raids that have ended (time expired or boss defeated)
      const completedRaids = await ctx.drizzle.query.quest.findMany({
        where: and(
          eq(quest.questType, "raid"),
          eq(quest.hidden, false),
          sql`(${quest.raidEndsAt} < ${now} OR ${quest.raidBossCurrentHealth} <= 0)`,
        ),
        with: {
          raidParticipations: {
            where: eq(raidParticipation.userId, ctx.userId),
            limit: 1,
          },
        },
        orderBy: desc(quest.raidEndsAt),
        limit,
      });

      return {
        raids: completedRaids.map((raid) => {
          const raidData = getRaidObjectiveData(raid);
          const bossDefeated = (raid.raidBossCurrentHealth ?? 0) <= 0;
          const timeExpired = raid.raidEndsAt ? raid.raidEndsAt < now : false;

          return {
            id: raid.id,
            name: raid.name,
            description: raid.description,
            image: raid.image,
            raidType: raidData?.raidType ?? null,
            raidBossMaxHealth: raid.raidBossMaxHealth,
            raidBossCurrentHealth: raid.raidBossCurrentHealth,
            raidEndsAt: raid.raidEndsAt,
            raidSector: raidData?.sector ?? null,
            userParticipation: raid.raidParticipations[0] ?? null,
            // Completion status
            completionStatus: bossDefeated ? "boss_defeated" : "time_expired",
            bossDefeated,
            timeExpired,
          };
        }),
      };
    }),

  /**
   * Get available raids for the user
   */
  getAvailableRaids: protectedProcedure
    .input(z.object({ sector: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      // Query
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guard
      if (!user) return { raids: [] };

      // Query - parallel fetch for cleanup, raids, sectors, and active sector wars
      const [, raids, userVillageSectors, activeSectorWars] = await Promise.all([
        cleanupExpiredExclusiveRaids(ctx.drizzle),
        ctx.drizzle.query.quest.findMany({
          where: and(
            eq(quest.questType, "raid"),
            eq(quest.hidden, false),
            gte(quest.raidBossCurrentHealth, 1),
          ),
          with: {
            raidParticipations: {
              where: eq(raidParticipation.userId, ctx.userId),
              limit: 1,
            },
          },
          orderBy: desc(quest.createdAt),
        }),
        user.villageId
          ? ctx.drizzle.query.sector.findMany({
              where: eq(sector.villageId, user.villageId),
              columns: { sector: true },
            })
          : Promise.resolve([]),
        // Fetch active sector wars where shrine is defeated (for given sector if provided)
        // This allows attackers to see exclusive raids before war is finalized
        user.villageId
          ? ctx.drizzle.query.war.findMany({
              where: and(
                eq(war.type, "SECTOR_WAR"),
                isNull(war.endedAt),
                lte(war.defenderShrineHp, 0),
                input?.sector !== undefined ? eq(war.sector, input.sector) : undefined,
              ),
              columns: { id: true, sector: true, attackerVillageId: true },
              with: {
                warAllies: {
                  columns: { villageId: true, supportVillageId: true },
                },
              },
            })
          : Promise.resolve([]),
      ]);

      // Derived
      const now = new Date();
      const ownedSectorNumbers = new Set(userVillageSectors.map((s) => s.sector));
      // Sectors where user's village is attacker (or ally of attacker) and shrine is defeated
      const attackerDefeatedShrineSectors = new Set(
        activeSectorWars
          .filter((w) => {
            // User's village is the attacker
            if (w.attackerVillageId === user.villageId) return true;
            // User's village is an ally supporting the attacker
            return w.warAllies.some(
              (a) =>
                a.villageId === user.villageId &&
                a.supportVillageId === w.attackerVillageId,
            );
          })
          .map((w) => w.sector),
      );

      const filteredRaids = raids.filter((raid) => {
        // Check if raid has ended
        if (raid.raidEndsAt && raid.raidEndsAt < now) {
          return false;
        }

        // Get raid type from objective
        const raidData = getRaidObjectiveData(raid);
        if (!raidData) return false;

        if (raidData.isOpen) {
          return true;
        }
        if (raidData.isExclusive) {
          // Check if user's village owns the sector
          if (!user.villageId || raidData.sector === null) {
            return false;
          }
          const ownsCurrentSector = ownedSectorNumbers.has(raidData.sector);
          // Also allow attackers who have defeated the shrine but war not yet finalized
          const isAttackerWithDefeatedShrine = attackerDefeatedShrineSectors.has(
            raidData.sector,
          );

          // Check capture deadline and grace period logic
          if (raid.raidCaptureDeadline && raid.raidCaptureDeadline < now) {
            // Capture deadline has passed
            if (!raid.raidGracePeriodEnd) {
              // No grace period configured - raid is no longer accessible after deadline
              return false;
            }
            if (raid.raidGracePeriodEnd >= now) {
              // Still in grace period - only villages that owned at deadline can access
              // Since we can't track historical ownership, we allow current owners during grace
              return ownsCurrentSector || isAttackerWithDefeatedShrine;
            } else if (raid.raidGracePeriodEnd < now) {
              // Grace period has ended - raid is no longer accessible
              return false;
            }
          }

          return ownsCurrentSector || isAttackerWithDefeatedShrine;
        }
        return false;
      });

      // Filter by sector if provided
      const sectorFilteredRaids =
        input?.sector !== undefined
          ? filteredRaids.filter((raid) => {
              const raidData = getRaidObjectiveData(raid);
              return raidData?.sector === input.sector;
            })
          : filteredRaids;

      return {
        raids: sectorFilteredRaids.map((raid) => {
          const raidData = getRaidObjectiveData(raid);
          return {
            id: raid.id,
            name: raid.name,
            description: raid.description,
            image: raid.image,
            raidType: raidData?.raidType ?? null,
            raidBossMaxHealth: raid.raidBossMaxHealth,
            raidBossCurrentHealth: raid.raidBossCurrentHealth,
            raidEndsAt: raid.raidEndsAt,
            raidSector: raidData?.sector ?? null,
            raidCaptureDeadline: raid.raidCaptureDeadline,
            raidGracePeriodEnd: raid.raidGracePeriodEnd,
            userParticipation: raid.raidParticipations[0] ?? null,
          };
        }),
      };
    }),

  /**
   * Get detailed info about a specific raid
   */
  getRaidDetails: protectedProcedure
    .input(z.object({ questId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query - parallel fetch
      const [raid, participation, thresholds] = await Promise.all([
        ctx.drizzle.query.quest.findFirst({
          where: and(eq(quest.id, input.questId), eq(quest.questType, "raid")),
        }),
        ctx.drizzle.query.raidParticipation.findFirst({
          where: and(
            eq(raidParticipation.questId, input.questId),
            eq(raidParticipation.userId, ctx.userId),
          ),
        }),
        ctx.drizzle.query.raidDamageThreshold.findMany({
          where: eq(raidDamageThreshold.questId, input.questId),
          orderBy: raidDamageThreshold.sortOrder,
        }),
      ]);

      // Guard
      if (!raid) {
        return { raid: null, participation: null, thresholds: [] };
      }

      // Derived
      const raidData = getRaidObjectiveData(raid);

      return {
        raid: {
          id: raid.id,
          name: raid.name,
          description: raid.description,
          image: raid.image,
          raidType: raidData?.raidType ?? null,
          raidBossMaxHealth: raid.raidBossMaxHealth,
          raidBossCurrentHealth: raid.raidBossCurrentHealth,
          raidEndsAt: raid.raidEndsAt,
          raidSector: raidData?.sector ?? null,
        },
        participation,
        thresholds,
      };
    }),

  /**
   * Get the raid leaderboard
   */
  getRaidLeaderboard: protectedProcedure
    .input(
      z.object({
        questId: z.string(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.number().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Derived
      const offset = input.cursor ?? 0;

      // Query
      const participations = await ctx.drizzle.query.raidParticipation.findMany({
        where: eq(raidParticipation.questId, input.questId),
        orderBy: desc(raidParticipation.damageDealt),
        limit: input.limit + 1,
        offset,
        with: {
          user: {
            columns: {
              username: true,
              avatar: true,
              rank: true,
              level: true,
            },
          },
        },
      });

      // Derived
      let nextCursor: typeof input.cursor = undefined;
      if (participations.length > input.limit) {
        participations.pop();
        nextCursor = offset + input.limit;
      }

      return {
        participations: participations.map((p, i) => ({
          rank: offset + i + 1,
          ...p,
        })),
        nextCursor,
      };
    }),

  /**
   * Get user's current raid queue status
   */
  getUserRaidQueue: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const queue = await ctx.drizzle.query.mpvpBattleUser.findFirst({
      where: eq(mpvpBattleUser.userId, ctx.userId),
      with: {
        clanBattle: {
          with: {
            queue: {
              with: {
                user: {
                  columns: {
                    username: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Guard
    if (!queue || queue.clanBattle?.battleType !== "RAID_BATTLE") {
      return { inQueue: false, queue: null, isClaiming: false };
    }
    // Allow teams in "claiming-" state to be visible (they're stuck during battle initialization)
    const isClaimingState = queue.clanBattle.battleId?.startsWith("claiming-") ?? false;
    if (queue.clanBattle.battleId !== null && !isClaimingState) {
      return { inQueue: false, queue: null, isClaiming: false };
    }

    return {
      inQueue: true,
      isClaiming: isClaimingState,
      queue: {
        id: queue.clanBattle.id,
        questId: queue.clanBattle.attackerEntityId,
        createdAt: queue.clanBattle.createdAt,
        members: queue.clanBattle.queue.map((m) => ({
          ...m,
          user: m.user,
        })),
      },
    };
  }),

  /**
   * Get user's active raid buffs
   */
  getUserRaidBuffs: protectedProcedure.query(async ({ ctx }) => {
    // Derived
    const now = new Date();

    // Query
    const buffs = await ctx.drizzle.query.userRaidBuff.findMany({
      where: and(eq(userRaidBuff.userId, ctx.userId), gte(userRaidBuff.expiresAt, now)),
      with: {
        quest: {
          columns: {
            name: true,
            image: true,
          },
        },
      },
    });

    return { buffs };
  }),

  /**
   * Get damage thresholds for a quest (admin use)
   */
  getQuestThresholds: protectedProcedure
    .input(z.object({ questId: z.string() }))
    .query(async ({ ctx, input }) => {
      const thresholds = await ctx.drizzle.query.raidDamageThreshold.findMany({
        where: eq(raidDamageThreshold.questId, input.questId),
        orderBy: raidDamageThreshold.sortOrder,
      });
      return { thresholds };
    }),

  /**
   * Create a new damage threshold
   */
  createDamageThreshold: protectedProcedure
    .use(ratelimitMiddleware)
    .input(
      z.object({
        questId: z.string(),
        damageRequired: z.number().min(1),
        sortOrder: z.number().min(0).max(255).default(0),
        rewards: ObjectiveReward,
        effects: z.array(AllTags).default([]),
        effectDurationMinutes: z.number().min(1).max(10080).default(60),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Guard - null check for TypeScript (protectedProcedure guarantees non-null)
      if (!ctx.userId) return errorResponse("Not authenticated");

      // Query - parallel fetch
      const [user, questData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.quest.findFirst({
          where: and(eq(quest.id, input.questId), eq(quest.questType, "raid")),
        }),
      ]);

      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("Not authorized to create damage thresholds");
      }
      if (!questData) {
        return errorResponse("Raid quest not found");
      }

      // Mutation
      await ctx.drizzle.insert(raidDamageThreshold).values({
        id: nanoid(),
        questId: input.questId,
        damageRequired: input.damageRequired,
        sortOrder: input.sortOrder,
        rewards: input.rewards,
        effects: input.effects,
        effectDurationMinutes: input.effectDurationMinutes,
      });

      return { success: true, message: "Damage threshold created" };
    }),

  /**
   * Update an existing damage threshold
   */
  updateDamageThreshold: protectedProcedure
    .use(ratelimitMiddleware)
    .input(
      z.object({
        thresholdId: z.string(),
        damageRequired: z.number().min(1),
        sortOrder: z.number().min(0).max(255),
        rewards: ObjectiveReward,
        effects: z.array(AllTags).default([]),
        effectDurationMinutes: z.number().min(1).max(10080).default(60),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Guard - null check for TypeScript (protectedProcedure guarantees non-null)
      if (!ctx.userId) return errorResponse("Not authenticated");

      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("Not authorized to update damage thresholds");
      }

      // Mutation
      const result = await ctx.drizzle
        .update(raidDamageThreshold)
        .set({
          damageRequired: input.damageRequired,
          sortOrder: input.sortOrder,
          rewards: input.rewards,
          effects: input.effects,
          effectDurationMinutes: input.effectDurationMinutes,
        })
        .where(eq(raidDamageThreshold.id, input.thresholdId));

      // Guard
      if (result.rowsAffected === 0) {
        return errorResponse("Threshold not found");
      }

      return { success: true, message: "Damage threshold updated" };
    }),

  /**
   * Delete a damage threshold
   */
  deleteDamageThreshold: protectedProcedure
    .use(ratelimitMiddleware)
    .input(z.object({ thresholdId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Guard - null check for TypeScript (protectedProcedure guarantees non-null)
      if (!ctx.userId) return errorResponse("Not authenticated");

      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("Not authorized to delete damage thresholds");
      }

      // Mutation
      await ctx.drizzle
        .delete(raidDamageThreshold)
        .where(eq(raidDamageThreshold.id, input.thresholdId));

      return { success: true, message: "Damage threshold deleted" };
    }),

  /**
   * Get active raid teams for a specific raid
   */
  getActiveRaidTeams: protectedProcedure
    .input(z.object({ questId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query - include teams in "claiming-" state (stuck during battle initialization)
      const teams = await ctx.drizzle.query.mpvpBattleQueue.findMany({
        where: and(
          eq(mpvpBattleQueue.battleType, "RAID_BATTLE"),
          eq(mpvpBattleQueue.attackerEntityId, input.questId),
          sql`(${mpvpBattleQueue.battleId} IS NULL OR ${mpvpBattleQueue.battleId} LIKE 'claiming-%')`,
        ),
        with: {
          queue: {
            with: {
              user: {
                columns: {
                  userId: true,
                  username: true,
                  avatar: true,
                },
              },
            },
          },
        },
        orderBy: mpvpBattleQueue.createdAt,
      });

      // Derived
      return {
        teams: teams.map((team) => {
          const isClaiming = team.battleId?.startsWith("claiming-") ?? false;
          return {
            id: team.id,
            createdAt: team.createdAt,
            isClaiming,
            members: team.queue.map((m) => ({
              slot: m.slot,
              visibleId: m.userId,
              username: m.user.username,
              avatar: m.user.avatar,
            })),
            // Don't allow joining teams that are in claiming state
            canJoin: !isClaiming && team.queue.length < RAID_BATTLE_MAX_USERS_PER_TEAM,
          };
        }),
        maxTeams: RAID_MAX_CONCURRENT_TEAMS,
      };
    }),

  /**
   * Join or create a raid team queue
   */
  joinRaidQueue: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(
      z.object({
        questId: z.string(),
        teamId: z.string().optional(), // If provided, join existing team
      }),
    )
    .output(baseServerResponse.extend({ teamId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Query - parallel fetch all required data upfront
      const [{ user }, raid, teamData] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.quest.findFirst({
          where: and(eq(quest.id, input.questId), eq(quest.questType, "raid")),
        }),
        // Fetch team if joining existing, otherwise skip
        input.teamId
          ? ctx.drizzle.query.mpvpBattleQueue.findFirst({
              where: and(
                eq(mpvpBattleQueue.id, input.teamId),
                eq(mpvpBattleQueue.battleType, "RAID_BATTLE"),
                eq(mpvpBattleQueue.attackerEntityId, input.questId),
                isNull(mpvpBattleQueue.battleId),
              ),
              with: { queue: true },
            })
          : Promise.resolve(null),
      ]);

      // Guard - basic validations
      if (!user) return errorResponse("User not found");
      if (!raid) return errorResponse("Raid not found");
      if (user.status !== "AWAKE") {
        return errorResponse("You cannot join a raid queue in your current status");
      }

      // Guard - raid active state
      const now = new Date();
      const raidValidation = validateRaidIsActive(raid, now);
      if (!raidValidation.isValid) {
        if (raidValidation.error === "This raid has ended") {
          await checkAndCleanupExpiredRaid(ctx.drizzle, raid.id);
        }
        return errorResponse(raidValidation.error);
      }

      // Derived - raid data from objective
      const raidData = getRaidObjectiveData(raid);
      if (!raidData) {
        return errorResponse(
          "This raid is not properly configured (invalid objective)",
        );
      }

      // Guard - user must be in the raid's sector to join
      if (raidData.sector !== null && user.sector !== raidData.sector) {
        return errorResponse(
          `You must travel to sector ${raidData.sector} to join this raid`,
        );
      }

      // Guard - exclusive raid eligibility (sector check required)
      if (raidData.isExclusive) {
        if (!user.villageId) {
          return errorResponse("You must be in a village to join exclusive raids");
        }
        if (raidData.sector === null) {
          return errorResponse("This exclusive raid is not properly configured");
        }

        // Check capture deadline and grace period
        if (raid.raidCaptureDeadline && raid.raidCaptureDeadline < now) {
          if (!raid.raidGracePeriodEnd) {
            return errorResponse("This raid's capture deadline has passed");
          }
          if (raid.raidGracePeriodEnd < now) {
            return errorResponse(
              "This raid's capture deadline and grace period have ended",
            );
          }
        }

        // Check sector ownership OR attacker in sector war with defeated shrine
        const [sectorOwnership, sectorWar] = await Promise.all([
          ctx.drizzle.query.sector.findFirst({
            where: and(
              eq(sector.sector, raidData.sector),
              eq(sector.villageId, user.villageId),
            ),
          }),
          // Fetch sector war with defeated shrine (if any)
          ctx.drizzle.query.war.findFirst({
            where: and(
              eq(war.type, "SECTOR_WAR"),
              eq(war.sector, raidData.sector),
              isNull(war.endedAt),
              lte(war.defenderShrineHp, 0),
            ),
            columns: { attackerVillageId: true },
            with: {
              warAllies: {
                columns: { villageId: true, supportVillageId: true },
              },
            },
          }),
        ]);

        // Check if user's village is attacker or ally supporting the attacker
        const isAttackerOrAlly =
          sectorWar &&
          (sectorWar.attackerVillageId === user.villageId ||
            sectorWar.warAllies.some(
              (a) =>
                a.villageId === user.villageId &&
                a.supportVillageId === sectorWar.attackerVillageId,
            ));

        if (!sectorOwnership && !isAttackerOrAlly) {
          return errorResponse("Your village does not control this sector");
        }
      }

      // Guard - team validation using pre-fetched data
      let teamId = input.teamId;
      let createdNewTeam = false;

      if (teamId) {
        // Guard - validate pre-fetched team
        if (!teamData) {
          return errorResponse("Team not found or battle already started");
        }
        if (teamData.queue.length >= RAID_BATTLE_MAX_USERS_PER_TEAM) {
          return errorResponse("Team is full");
        }
      } else {
        // Mutation - create new team with atomic count guard
        // Uses INSERT ... SELECT to atomically check team count and insert only if under limit
        teamId = nanoid();
        const insertResult = await ctx.drizzle.execute(sql`
          INSERT INTO ${mpvpBattleQueue} (id, battleType, attackerEntityId, defenderEntityId, sector)
          SELECT ${teamId}, 'RAID_BATTLE', ${input.questId}, 'RAID_AI', ${raidData.sector ?? null}
          FROM (SELECT 1) AS dummy
          WHERE (
            SELECT COUNT(*)
            FROM ${mpvpBattleQueue} AS mq
            WHERE mq.battleType = 'RAID_BATTLE'
            AND mq.attackerEntityId = ${input.questId}
            AND mq.battleId IS NULL
          ) < ${RAID_MAX_CONCURRENT_TEAMS}
        `);

        // Guard - check if insert succeeded
        if (insertResult.rowsAffected === 0) {
          return errorResponse(
            "Maximum number of raid teams reached. Please join an existing team.",
          );
        }
        createdNewTeam = true;
      }

      // Mutation - update user status with guard
      const statusResult = await ctx.drizzle
        .update(userData)
        .set({ status: "QUEUED" })
        .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "AWAKE")));

      if (statusResult.rowsAffected === 0) {
        // Rollback - clean up newly created team if status update fails
        if (createdNewTeam && teamId) {
          await ctx.drizzle
            .delete(mpvpBattleQueue)
            .where(
              and(eq(mpvpBattleQueue.id, teamId), isNull(mpvpBattleQueue.battleId)),
            );
        }
        return errorResponse("Failed to update status - you may already be in a queue");
      }

      // Derived - find available slot
      let availableSlot: number | undefined;

      if (createdNewTeam) {
        // For new teams, we know slot 0 is available (we just created it)
        availableSlot = 0;
      } else {
        // For existing teams, re-fetch to get fresh state (handle race conditions)
        const freshTeam = await ctx.drizzle.query.mpvpBattleQueue.findFirst({
          where: eq(mpvpBattleQueue.id, teamId),
          with: { queue: true },
        });

        // Guard - team still exists
        if (!freshTeam) {
          await ctx.drizzle
            .update(userData)
            .set({ status: "AWAKE" })
            .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "QUEUED")));
          return errorResponse("Team is no longer available");
        }

        const usedSlots = freshTeam.queue.map((u) => u.slot);
        availableSlot = [0, 1, 2].find((s) => !usedSlots.includes(s));

        // Guard - slot available
        if (availableSlot === undefined) {
          await ctx.drizzle
            .update(userData)
            .set({ status: "AWAKE" })
            .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "QUEUED")));
          return errorResponse("Team is full");
        }
      }

      // Mutation - insert user into queue
      try {
        await ctx.drizzle.insert(mpvpBattleUser).values({
          id: nanoid(),
          clanBattleId: teamId,
          userId: ctx.userId,
          side: "ATTACKER",
          slot: availableSlot,
        });
      } catch {
        // Rollback - status and team on failure
        await Promise.all([
          ctx.drizzle
            .update(userData)
            .set({ status: "AWAKE" })
            .where(eq(userData.userId, ctx.userId)),
          createdNewTeam && teamId
            ? ctx.drizzle.delete(mpvpBattleQueue).where(eq(mpvpBattleQueue.id, teamId))
            : Promise.resolve(),
        ]);
        return errorResponse("Failed to join team - slot may have been taken");
      }

      // Pusher - notify sector about team changes
      const pusher = getServerPusher();
      void updateRaidTeamsOnSector(pusher, raidData.sector);

      return {
        success: true,
        message: "Joined raid queue",
        teamId,
      };
    }),

  /**
   * Leave raid queue
   */
  leaveRaidQueue: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query - parallel fetch user and queue entry
      const [{ user }, queueEntry] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.mpvpBattleUser.findFirst({
          where: eq(mpvpBattleUser.userId, ctx.userId),
          with: { clanBattle: true },
        }),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      if (!queueEntry) return errorResponse("You are not in a queue");
      if (!queueEntry.clanBattle) {
        // Queue entry exists but clan battle was deleted - clean up orphaned entry
        await ctx.drizzle
          .delete(mpvpBattleUser)
          .where(eq(mpvpBattleUser.id, queueEntry.id));
        await ctx.drizzle
          .update(userData)
          .set({ status: "AWAKE" })
          .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "QUEUED")));
        return { success: true, message: "Left the queue" };
      }
      if (queueEntry.clanBattle.battleType !== "RAID_BATTLE") {
        return errorResponse("You are not in a raid queue");
      }
      // Allow leaving if not in a real battle (claiming state is allowed)
      const isClaimingState =
        queueEntry.clanBattle.battleId?.startsWith("claiming-") ?? false;
      if (queueEntry.clanBattle.battleId !== null && !isClaimingState) {
        return errorResponse("Battle has already started");
      }

      // Store sector before operations for Pusher notification
      const teamSector = queueEntry.clanBattle.sector;

      // Mutation - delete queue entry, update user status, and cleanup claiming ID in parallel
      await Promise.all([
        ctx.drizzle.delete(mpvpBattleUser).where(eq(mpvpBattleUser.id, queueEntry.id)),
        ctx.drizzle
          .update(userData)
          .set({ status: "AWAKE" })
          .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "QUEUED"))),
        // Clean up claiming ID if present
        isClaimingState
          ? ctx.drizzle
              .update(mpvpBattleQueue)
              .set({ battleId: null })
              .where(eq(mpvpBattleQueue.id, queueEntry.clanBattleId))
          : Promise.resolve(),
      ]);

      // Query - check remaining members
      const remainingMembers = await ctx.drizzle.query.mpvpBattleUser.findMany({
        where: eq(mpvpBattleUser.clanBattleId, queueEntry.clanBattleId),
      });

      // Mutation - clean up empty teams (removed battleId null check for robust cleanup)
      if (remainingMembers.length === 0) {
        await ctx.drizzle
          .delete(mpvpBattleQueue)
          .where(eq(mpvpBattleQueue.id, queueEntry.clanBattleId));
      }

      // Pusher - notify sector about team changes
      const pusher = getServerPusher();
      void updateRaidTeamsOnSector(pusher, teamSector);

      return {
        success: true,
        message: "Left raid queue",
      };
    }),

  /**
   * Start a raid battle
   */
  startRaidBattle: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(z.object({ teamId: z.string() }))
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Query - parallel fetch user and team
      const [{ user }, team] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.mpvpBattleQueue.findFirst({
          where: and(
            eq(mpvpBattleQueue.id, input.teamId),
            eq(mpvpBattleQueue.battleType, "RAID_BATTLE"),
          ),
          with: {
            queue: { with: { user: true } },
          },
        }),
      ]);

      // Guard - basic validations
      if (!user) return errorResponse("User not found");
      if (!team) return errorResponse("Team not found");

      // Check battleId state - handle stale claiming states or already started battles
      if (team.battleId !== null) {
        const isStaleClaimingState =
          team.battleId.startsWith("claiming-") &&
          team.createdAt.getTime() < Date.now() - RAID_CLAIMING_TIMEOUT_MS;

        if (isStaleClaimingState) {
          // Reset the stale claiming state
          await ctx.drizzle
            .update(mpvpBattleQueue)
            .set({ battleId: null })
            .where(
              and(
                eq(mpvpBattleQueue.id, input.teamId),
                sql`${mpvpBattleQueue.battleId} LIKE 'claiming-%'`,
                lt(
                  mpvpBattleQueue.createdAt,
                  new Date(Date.now() - RAID_CLAIMING_TIMEOUT_MS),
                ),
              ),
            );
        } else {
          return errorResponse("Battle already started or being claimed");
        }
      }

      const userInTeam = team.queue.find((m) => m.userId === ctx.userId);
      if (!userInTeam) {
        return errorResponse("You are not in this team");
      }

      // Guard - lobby time check (with 2 second buffer for network latency)
      const lobbyTimeElapsed = secondsFromDate(
        RAID_BATTLE_LOBBY_SECONDS,
        team.createdAt,
      );
      const LOBBY_BUFFER_MS = 2000;
      if (
        Date.now() < lobbyTimeElapsed.getTime() - LOBBY_BUFFER_MS &&
        team.queue.length < RAID_BATTLE_MAX_USERS_PER_TEAM
      ) {
        return errorResponse("Please wait for the lobby timer or full team");
      }

      // Query - get raid quest data
      const raid = await ctx.drizzle.query.quest.findFirst({
        where: eq(quest.id, team.attackerEntityId),
      });

      // Guard - raid validations
      if (!raid) return errorResponse("Raid quest not found");

      const raidData = getRaidObjectiveData(raid);
      if (!raidData || !raidData.firstAiId) {
        return errorResponse("Raid boss AI not configured");
      }

      const now = new Date();
      const raidValidation = validateRaidIsActive(raid, now);
      if (!raidValidation.isValid) {
        if (raidValidation.error === "This raid has ended") {
          await checkAndCleanupExpiredRaid(ctx.drizzle, raid.id);
        }
        return errorResponse(raidValidation.error);
      }

      // Mutation - claim the battle atomically
      const claimId = `claiming-${nanoid()}`;
      const claimResult = await ctx.drizzle
        .update(mpvpBattleQueue)
        .set({ battleId: claimId })
        .where(
          and(eq(mpvpBattleQueue.id, input.teamId), isNull(mpvpBattleQueue.battleId)),
        );

      if (claimResult.rowsAffected === 0) {
        return errorResponse("Battle was already started by another player");
      }

      // Query - re-fetch current queue members after claim for fresh state
      const currentQueueMembers = await ctx.drizzle.query.mpvpBattleUser.findMany({
        where: eq(mpvpBattleUser.clanBattleId, input.teamId),
      });

      // Guard - members validation after claim
      if (currentQueueMembers.length === 0) {
        await ctx.drizzle
          .update(mpvpBattleQueue)
          .set({ battleId: null })
          .where(eq(mpvpBattleQueue.id, input.teamId));
        return errorResponse("No team members available to start battle");
      }

      const isStillMember = currentQueueMembers.some((m) => m.userId === ctx.userId);
      if (!isStillMember) {
        await ctx.drizzle
          .update(mpvpBattleQueue)
          .set({ battleId: null })
          .where(
            and(
              eq(mpvpBattleQueue.id, input.teamId),
              eq(mpvpBattleQueue.battleId, claimId),
            ),
          );
        return errorResponse("You are no longer in this team");
      }

      // Derived
      const attackerUserIds = currentQueueMembers.map((m) => m.userId);

      // Mutation - initiate battle
      try {
        const result = await initiateBattle(
          {
            userIds: attackerUserIds,
            client: ctx.drizzle,
            targetIds: [raidData.firstAiId],
            raidQuestId: raid.id,
          },
          "RAID",
        );

        if (result.success && result.battleId) {
          // Mutation - update with real battle ID
          await ctx.drizzle
            .update(mpvpBattleQueue)
            .set({ battleId: result.battleId })
            .where(eq(mpvpBattleQueue.id, input.teamId));

          // Pusher - notify sector about team changes (battle started)
          const pusher = getServerPusher();
          void updateRaidTeamsOnSector(pusher, team.sector);

          return {
            success: true,
            message: "Raid battle started",
            battleId: result.battleId,
          };
        } else {
          // Rollback - release claim, reset statuses, delete users in parallel
          await Promise.all([
            ctx.drizzle
              .update(mpvpBattleQueue)
              .set({ battleId: null })
              .where(
                and(
                  eq(mpvpBattleQueue.id, input.teamId),
                  eq(mpvpBattleQueue.battleId, claimId),
                ),
              ),
            ctx.drizzle
              .update(userData)
              .set({ status: "AWAKE" })
              .where(
                and(
                  inArray(userData.userId, attackerUserIds),
                  eq(userData.status, "QUEUED"),
                ),
              ),
            ctx.drizzle
              .delete(mpvpBattleUser)
              .where(eq(mpvpBattleUser.clanBattleId, input.teamId)),
          ]);

          return errorResponse(result.message ?? "Failed to start battle");
        }
      } catch (err) {
        // Rollback - release claim, reset statuses, delete users in parallel
        await Promise.all([
          ctx.drizzle
            .update(mpvpBattleQueue)
            .set({ battleId: null })
            .where(
              and(
                eq(mpvpBattleQueue.id, input.teamId),
                eq(mpvpBattleQueue.battleId, claimId),
              ),
            ),
          ctx.drizzle
            .update(userData)
            .set({ status: "AWAKE" })
            .where(
              and(
                inArray(userData.userId, attackerUserIds),
                eq(userData.status, "QUEUED"),
              ),
            ),
          ctx.drizzle
            .delete(mpvpBattleUser)
            .where(eq(mpvpBattleUser.clanBattleId, input.teamId)),
        ]);

        throw err;
      }
    }),

  /**
   * Claim damage threshold rewards
   */
  claimDamageReward: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(
      z.object({
        questId: z.string(),
        thresholdId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query - parallel fetch user, participation, and threshold
      const [{ user }, participation, threshold] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.raidParticipation.findFirst({
          where: and(
            eq(raidParticipation.questId, input.questId),
            eq(raidParticipation.userId, ctx.userId),
          ),
        }),
        ctx.drizzle.query.raidDamageThreshold.findFirst({
          where: and(
            eq(raidDamageThreshold.id, input.thresholdId),
            eq(raidDamageThreshold.questId, input.questId),
          ),
        }),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      if (!participation)
        return errorResponse("You have not participated in this raid");
      if (!threshold) return errorResponse("Threshold not found");
      if (participation.damageDealt < threshold.damageRequired) {
        return errorResponse("You have not dealt enough damage to claim this reward");
      }

      // Derived
      const rewards = threshold.rewards;

      // Mutation - atomically claim reward with JSON_CONTAINS guard to prevent double-claim
      const claimResult = await ctx.drizzle
        .update(raidParticipation)
        .set({
          rewardsClaimed: sql`JSON_ARRAY_APPEND(${raidParticipation.rewardsClaimed}, '$', ${input.thresholdId})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(raidParticipation.id, participation.id),
            sql`NOT JSON_CONTAINS(${raidParticipation.rewardsClaimed}, JSON_QUOTE(${input.thresholdId}))`,
          ),
        );

      // Guard - claim result
      if (claimResult.rowsAffected === 0) {
        return errorResponse("You have already claimed this reward");
      }

      // Derived - post-process rewards to convert item format
      const processedRewards = postProcessRewards(rewards);

      // Mutation - grant all reward types
      // Note: We intentionally do NOT roll back the claim on failure because updateRewards is not atomic.
      // If we rolled back, a retry could double-grant rewards that succeeded before the failure.
      // Keeping the claim marked prevents double-grants; partial failures can be investigated manually.
      await updateRewards({
        client: ctx.drizzle,
        user,
        rewards: processedRewards,
        reason: "RAID",
      });

      // Grant combat effects as raid buff if present
      if (threshold.effects && threshold.effects.length > 0) {
        const expiresAt = new Date(
          Date.now() + threshold.effectDurationMinutes * 60 * 1000,
        );

        await ctx.drizzle.insert(userRaidBuff).values({
          id: nanoid(),
          userId: ctx.userId,
          questId: input.questId,
          effects: threshold.effects,
          expiresAt,
        });
      }

      // Fetch names for reward display
      const [items, jutsus, bloodlines, badges] = await Promise.all([
        processedRewards.reward_items.length > 0
          ? ctx.drizzle.query.item.findMany({
              columns: { id: true, name: true },
              where: inArray(item.id, processedRewards.reward_items),
            })
          : Promise.resolve([]),
        processedRewards.reward_jutsus.length > 0
          ? ctx.drizzle.query.jutsu.findMany({
              columns: { id: true, name: true },
              where: inArray(jutsu.id, processedRewards.reward_jutsus),
            })
          : Promise.resolve([]),
        processedRewards.reward_bloodlines.length > 0
          ? ctx.drizzle.query.bloodline.findMany({
              columns: { id: true, name: true },
              where: inArray(bloodline.id, processedRewards.reward_bloodlines),
            })
          : Promise.resolve([]),
        processedRewards.reward_badges.length > 0
          ? ctx.drizzle.query.badge.findMany({
              columns: { id: true, name: true },
              where: inArray(badge.id, processedRewards.reward_badges),
            })
          : Promise.resolve([]),
      ]);

      // Map IDs to names for display
      const displayRewards = {
        ...processedRewards,
        reward_items: processedRewards.reward_items.map(
          (id) => items.find((i) => i.id === id)?.name ?? id,
        ),
        reward_jutsus: jutsus.map((j) => j.name),
        reward_bloodlines: bloodlines.map((b) => b.name),
        reward_badges: badges.map((b) => b.name),
      };

      return {
        success: true,
        message: "Raid Reward Claimed",
        rewards: displayRewards,
      };
    }),
});

/**
 * Handle expired exclusive raids - return sectors to neutral if raid timed out without boss defeat.
 *
 * For exclusive raids: if the raid ends (raidEndsAt passed) and boss is NOT defeated (health > 0),
 * the village failed to complete the raid and loses the sector.
 *
 * This function is idempotent and safe to call multiple times - it only affects
 * raids that have actually expired and have sectors that still need cleanup.
 *
 * @param client - The drizzle database client
 * @returns The number of sectors returned to neutral ownership
 */
export const cleanupExpiredExclusiveRaids = async (
  client: DrizzleClient,
): Promise<number> => {
  const now = new Date();

  // Find all expired exclusive raids where boss is not defeated
  const expiredExclusiveRaids = await client.query.quest.findMany({
    where: and(
      eq(quest.questType, "raid"),
      lt(quest.raidEndsAt, now),
      gte(quest.raidBossCurrentHealth, 1), // Boss not defeated
    ),
    columns: { id: true, content: true },
  });

  // Collect sector numbers to clean up
  const sectorsToClean = expiredExclusiveRaids
    .map((raid) => {
      const objective = raid.content?.objectives?.[0];
      if (objective?.task === "exclusive_raid") {
        const raidSector = (objective as RaidObjectiveType).sector;
        if (raidSector !== null && raidSector !== undefined) {
          return raidSector;
        }
      }
      return null;
    })
    .filter((s): s is number => s !== null);

  // Delete all sectors in parallel
  const results = await Promise.all(
    sectorsToClean.map((sectorNum) =>
      client.delete(sector).where(eq(sector.sector, sectorNum)),
    ),
  );

  return results.filter((r) => r.rowsAffected > 0).length;
};

/**
 * Check if a specific raid has expired and handle cleanup if needed.
 * This is a lightweight check for a single raid, useful when a user
 * tries to interact with a specific raid.
 *
 * @param client - The drizzle database client
 * @param raidId - The quest ID of the raid to check
 * @returns Object indicating if the raid was expired and cleaned up
 */
export const checkAndCleanupExpiredRaid = async (
  client: DrizzleClient,
  raidId: string,
): Promise<{ wasExpired: boolean; sectorCleaned: boolean }> => {
  const now = new Date();

  const raid = await client.query.quest.findFirst({
    where: and(
      eq(quest.id, raidId),
      eq(quest.questType, "raid"),
      lt(quest.raidEndsAt, now),
      gte(quest.raidBossCurrentHealth, 1), // Boss not defeated
    ),
    columns: { id: true, content: true },
  });

  if (!raid) {
    return { wasExpired: false, sectorCleaned: false };
  }

  const objective = raid.content?.objectives?.[0];
  if (objective?.task === "exclusive_raid") {
    const raidSector = (objective as RaidObjectiveType).sector;
    if (raidSector !== null && raidSector !== undefined) {
      // Delete sector - returns it to neutral ownership (syndicate)
      const result = await client.delete(sector).where(eq(sector.sector, raidSector));
      return { wasExpired: true, sectorCleaned: result.rowsAffected > 0 };
    }
  }

  return { wasExpired: true, sectorCleaned: false };
};
