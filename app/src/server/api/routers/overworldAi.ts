import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { OVERWORLD_QUEST_ROLLS_PER_DAY } from "@/drizzle/constants";
import {
  overworldAiPlacement,
  overworldAiPlacementQuest,
  quest,
  questHistory,
  userData,
} from "@/drizzle/schema";
import {
  findActionableBoundObjective,
  pickWeightedQuest,
  resolveOverworldPosition,
} from "@/libs/overworldAi";
import { getReward, getUserQuests, isAvailableUserQuests } from "@/libs/quest";
import { initiateBattle } from "@/routers/combat";
import { fetchUserItems } from "@/routers/item";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import {
  ASSIGNABLE_QUEST_TYPES,
  assignQuestToUser,
  commitQuestObjectiveRewards,
  questTypeConcurrentBlockMessage,
} from "@/routers/quests";
import type { DrizzleClient } from "@/server/db";
import { claimActiveNpcQuest, clearActiveNpcQuest } from "@/server/utils/concurrency";
import { canChangeContent } from "@/utils/permissions";
import { OverworldPlacementSchema } from "@/validators/overworldAi";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "../trpc";

export const overworldAiRouter = createTRPCRouter({
  getPlacementsForAi: protectedProcedure
    .input(z.object({ aiTemplateUserId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Guard: placement config is staff-only, same as the write/delete endpoints below.
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) {
        throw serverError("UNAUTHORIZED", "Not allowed");
      }
      return ctx.drizzle.query.overworldAiPlacement.findMany({
        where: eq(overworldAiPlacement.aiTemplateUserId, input.aiTemplateUserId),
        with: { questPool: true },
      });
    }),

  getAllPlacementNames: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.drizzle.query.overworldAiPlacement.findMany({
      columns: { id: true, interactionType: true, sector: true, isActive: true },
      with: { aiTemplate: { columns: { username: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      label: `${r.aiTemplate?.username ?? "?"} · ${r.interactionType} · sector ${r.sector}${r.isActive ? "" : " [inactive]"}`,
    }));
  }),

  upsertPlacement: protectedProcedure
    .input(z.object({ id: z.string().optional(), data: OverworldPlacementSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      // Prepare
      const { quests, ...cfg } = input.data;
      const pos = resolveOverworldPosition(cfg);
      const id = input.id ?? nanoid();
      const row = {
        id,
        aiTemplateUserId: cfg.aiTemplateUserId,
        interactionType: cfg.interactionType,
        isActive: cfg.isActive,
        sectorType: cfg.sectorType,
        locationType: cfg.locationType,
        sectorList: cfg.sectorList,
        sector: pos.sector,
        longitude: pos.longitude,
        latitude: pos.latitude,
        // Bump on every edit so clients holding a stale position version are told to refresh
        // (mirrors the daily cron's reposition bump); new placements start at 0.
        positionVersion: input.id
          ? sql`${overworldAiPlacement.positionVersion} + 1`
          : 0,
      };
      // Mutate
      if (input.id) {
        const updated = await ctx.drizzle
          .update(overworldAiPlacement)
          .set(row)
          .where(eq(overworldAiPlacement.id, input.id));
        // Stale id (placement concurrently deleted): abort before writing child rows, which
        // would otherwise orphan (no FK cascade on PlanetScale). The positionVersion bump
        // above guarantees an existing row always changes, so rowsAffected reflects existence.
        if (updated.rowsAffected === 0) {
          return errorResponse("Placement no longer exists");
        }
        await ctx.drizzle
          .delete(overworldAiPlacementQuest)
          .where(eq(overworldAiPlacementQuest.placementId, id));
      } else {
        await ctx.drizzle.insert(overworldAiPlacement).values(row);
      }
      if (quests.length > 0) {
        await ctx.drizzle.insert(overworldAiPlacementQuest).values(
          quests.map((q) => ({
            id: nanoid(),
            placementId: id,
            questId: q.questId,
            chance: q.chance,
          })),
        );
      }
      // Return
      return { success: true, message: input.id ? "Placement updated" : id };
    }),

  deletePlacement: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      // Mutate: delete child pool rows first (no FK cascade in PlanetScale), then the placement
      await ctx.drizzle
        .delete(overworldAiPlacementQuest)
        .where(eq(overworldAiPlacementQuest.placementId, input.id));
      await ctx.drizzle
        .delete(overworldAiPlacement)
        .where(eq(overworldAiPlacement.id, input.id));
      // Return
      return { success: true, message: "Placement deleted" };
    }),

  interactWithOverworldAi: protectedProcedure
    .input(
      z.object({
        placementId: z.string(),
        positionVersion: z.number(),
        dialogContentId: z.string().optional(),
      }),
    )
    .output(
      baseServerResponse.extend({
        battleId: z.string().optional(),
        grantedQuestId: z.string().optional(),
        dialog: z
          .object({
            objectiveId: z.string(),
            branches: z.array(
              z.object({ text: z.string(), nextObjectiveId: z.string().optional() }),
            ),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch placement and actor in parallel — both are needed regardless of interaction type.
      const [placement, actor] = await Promise.all([
        fetchPlacement(ctx.drizzle, input.placementId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);

      // Validate placement: must exist, be active, bind a still-AI template, and the
      // client's position version must match the authoritative server placement.
      if (!placement || !placement.isActive || !placement.aiTemplate?.isAi) {
        return errorResponse("This NPC is no longer here");
      }
      if (placement.positionVersion !== input.positionVersion) {
        return errorResponse("The NPC has moved - refresh the map");
      }

      // Validate actor state. Server placement coordinates are authoritative; the
      // client-supplied position is only a hint, so we compare the actor against the
      // placement's stored tile rather than trusting any client coordinates.
      if (actor.isBanned) return errorResponse("You are banned");
      if (actor.status !== "AWAKE") return errorResponse("You must be awake");
      if (actor.travelFinishAt && actor.travelFinishAt > new Date()) {
        return errorResponse("You are travelling");
      }
      if (
        actor.sector !== placement.sector ||
        actor.longitude !== placement.longitude ||
        actor.latitude !== placement.latitude
      ) {
        return errorResponse("You are not standing on the NPC's tile");
      }

      // HOSTILE -> clean PvE fight against the AI template (no quest data needed).
      if (placement.interactionType === "HOSTILE") {
        const battle = await initiateBattle(
          {
            longitude: placement.longitude,
            latitude: placement.latitude,
            sector: placement.sector,
            userIds: [ctx.userId],
            targetIds: [placement.aiTemplateUserId],
            client: ctx.drizzle,
            scaleTarget: true,
            biome: "default",
          },
          "OVERWORLD",
        );
        return battle.success
          ? { success: true, message: "Battle started", battleId: battle.battleId }
          : errorResponse(battle.message);
      }

      // FRIENDLY -> load quest relations, inventory and settings together.
      const [{ user: activeUser, settings }, useritems] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId, forceRegen: true }),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      if (!activeUser) return errorResponse("User does not exist");
      // getNewTrackers (called inside getReward) reads useritems for deliver_item
      // possession checks; attach it to a single typed user object reused below.
      const userForTrackers = { ...activeUser, useritems };
      const ownedItemIds = useritems.map((i) => i.itemId);

      // 1) Objective-target sub-path: advance a bound, actionable objective and pay it.
      const bound = findActionableBoundObjective({
        activeQuests: getUserQuests(activeUser).map((q) => {
          const tracker = (activeUser.questData ?? []).find((t) => t.id === q.id);
          return {
            questId: q.id,
            objectives: q.content.objectives.map((objective) => {
              const goal = tracker?.goals.find((g) => g.id === objective.id);
              return {
                id: objective.id,
                task: objective.task,
                overworldPlacementId: objective.overworldPlacementId,
                done: goal?.done,
                deliverItemIds:
                  "deliverItemIds" in objective ? objective.deliverItemIds : undefined,
              };
            }),
          };
        }),
        ownedItemIds,
        placementId: placement.id,
      });

      if (bound) {
        // Two-step dialog: the first call returns the available branches; the user
        // picks one and re-submits with dialogContentId to advance + pay.
        if (bound.objective.task === "dialog" && !input.dialogContentId) {
          const dialogObjective = getUserQuests(activeUser)
            .flatMap((q) => q.content.objectives)
            .find((o) => o.id === bound.objective.id);
          const branches =
            dialogObjective &&
            "nextObjectiveId" in dialogObjective &&
            Array.isArray(dialogObjective.nextObjectiveId)
              ? dialogObjective.nextObjectiveId
              : [];
          return {
            success: true,
            message: "dialog",
            dialog: { objectiveId: bound.objective.id, branches },
          };
        }

        // getReward advances trackers (it internally calls getNewTrackers with the
        // dialog contentId + useritems on the user), marks the completed objective as
        // collected, and accumulates that objective's reward into `rewards`. This is the
        // same resolver checkRewards uses. commitQuestObjectiveRewards then performs the
        // exact shared post-completion sequence checkRewards uses (completion CAS +
        // revert, structural consequences, sensei mission bonus, tier-quest bootstrap /
        // repeatable-achievement re-arm, and the reward payout via updateRewards), so the
        // overworld path stays in parity with the canonical reward claim.
        const { rewards, trackers, userQuest, resolved, notifications, consequences } =
          getReward(userForTrackers, bound.questId, input.dialogContentId, settings);

        const claim = await commitQuestObjectiveRewards({
          client: ctx.drizzle,
          userId: ctx.userId,
          user: activeUser,
          rewards,
          trackers,
          userQuest,
          resolved,
          notifications,
          consequences,
          existingHistory:
            activeUser.userQuests?.find((q) => q.questId === bound.questId) ?? null,
        });

        if (claim.outcome !== "claimed") {
          return errorResponse("Quest state changed, please try again");
        }

        return {
          success: true,
          message: claim.postNotifications.join(" ") || "Interaction complete",
        };
      }

      // 2) Quest-giver sub-path: only reached when no bound objective is actionable.
      // Each pool row carries its own per-quest grant chance.
      const poolQuestIds = placement.questPool.map((p) => p.questId);
      if (poolQuestIds.length === 0) {
        return { success: true, message: "The NPC has nothing for you." };
      }
      const [pool, prevByQuest] = await Promise.all([
        ctx.drizzle.query.quest.findMany({
          where: inArray(quest.id, poolQuestIds),
        }),
        ctx.drizzle.query.questHistory.findMany({
          where: and(
            eq(questHistory.userId, ctx.userId),
            inArray(questHistory.questId, poolQuestIds),
          ),
        }),
      ]);
      const questsById = new Map(pool.map((q) => [q.id, q]));

      // Build the eligible pool, keeping each entry's chance. isAvailableUserQuests now
      // includes the per-period cap, so period-capped quests drop out here automatically.
      const eligible = placement.questPool
        .map((p, poolIndex) => {
          const q = questsById.get(p.questId);
          if (!q) return null;
          // Skip types the centralized assigner can't start (e.g. errand, whose daily cap
          // only startRandom enforces). Reaching assignQuestToUser with one throws and would
          // strand the claimed active-NPC-quest slot, leaving the player permanently blocked.
          if (!ASSIGNABLE_QUEST_TYPES.includes(q.questType)) return null;
          const prev = prevByQuest.find((ph) => ph.questId === q.id);
          const available =
            isAvailableUserQuests({ ...q, ...prev }, activeUser).check &&
            !questTypeConcurrentBlockMessage(q, activeUser);
          if (!available) return null;
          return { quest: q, chance: p.chance, prev, poolIndex };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null)
        // Deterministic order: pool insertion order, tie-break by questId.
        .sort((a, b) =>
          a.poolIndex !== b.poolIndex
            ? a.poolIndex - b.poolIndex
            : a.quest.id.localeCompare(b.quest.id),
        );

      // Eligible-empty check BEFORE the daily-roll CAS so an empty pool costs no roll.
      if (eligible.length === 0) {
        return {
          success: true,
          message: "The NPC has nothing available for you right now.",
        };
      }

      // One mission at a time: block if the player holds an active quest of a type this NPC
      // gives. Read from the already-loaded user quests — no extra round-trip.
      const npcPoolTypes = new Set(
        placement.questPool
          .map((p) => questsById.get(p.questId)?.questType)
          .filter((t): t is NonNullable<typeof t> => Boolean(t)),
      );
      const heldPoolTypeQuest = getUserQuests(activeUser).find(
        (q) => !q.endAt && npcPoolTypes.has(q.questType),
      );
      if (heldPoolTypeQuest) {
        return {
          success: true,
          message: "Finish your current mission before asking for another.",
        };
      }
      // Self-heal: no active pool-type quest, so any lingering claim is stale — clear that
      // exact id so a concurrent NPC's legitimate claim is never disturbed.
      if (activeUser.activeNpcQuestId) {
        await clearActiveNpcQuest({
          client: ctx.drizzle,
          userId: ctx.userId,
          questId: activeUser.activeNpcQuestId,
        });
      }

      // Consume one daily roll via CAS BEFORE rolling so a failed roll still costs a
      // slot (prevents unlimited re-rolling against the per-quest chances).
      const claim = await ctx.drizzle
        .update(userData)
        .set({
          dailyOverworldQuestRolls: sql`${userData.dailyOverworldQuestRolls} + 1`,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            sql`${userData.dailyOverworldQuestRolls} < ${OVERWORLD_QUEST_ROLLS_PER_DAY}`,
          ),
        );
      if (claim.rowsAffected === 0) {
        return errorResponse("You've reached your daily mission allowance.");
      }

      // Weighted band-walk: each quest owns [acc, acc+chance); a roll past the summed
      // chances grants nothing this time.
      const chosenId = pickWeightedQuest(
        eligible.map((e) => ({ questId: e.quest.id, chance: e.chance })),
        Math.random() * 100,
      );
      const chosen = chosenId
        ? eligible.find((e) => e.quest.id === chosenId)
        : undefined;
      if (!chosen) {
        return { success: true, message: "The NPC had nothing for you this time." };
      }
      // Claim the single active-NPC-mission slot atomically before granting. If the slot is
      // already taken (e.g. a concurrent interaction won the race), don't grant a second one.
      const claimed = await claimActiveNpcQuest({
        client: ctx.drizzle,
        userId: ctx.userId,
        questId: chosen.quest.id,
      });
      if (!claimed) {
        return {
          success: true,
          message: "Finish your current mission before asking for another.",
        };
      }
      const result = await assignQuestToUser({
        client: ctx.drizzle,
        user: activeUser,
        quest: chosen.quest,
        source: "overworld_npc",
        prevAttempt: chosen.prev,
      });
      if (!result.success) {
        // Assign failed (e.g. cap/availability raced) — release the slot we just claimed so
        // the player isn't stranded behind a claim that never produced a quest.
        await clearActiveNpcQuest({
          client: ctx.drizzle,
          userId: ctx.userId,
          questId: chosen.quest.id,
        });
        return errorResponse(result.message);
      }
      return {
        success: true,
        message: result.message,
        grantedQuestId: chosen.quest.id,
      };
    }),
});

/** Load a placement with its quest pool and the AI template identity/isAi flag. */
const fetchPlacement = async (client: DrizzleClient, placementId: string) =>
  client.query.overworldAiPlacement.findFirst({
    where: eq(overworldAiPlacement.id, placementId),
    with: {
      questPool: true,
      aiTemplate: { columns: { userId: true, isAi: true } },
    },
  });
