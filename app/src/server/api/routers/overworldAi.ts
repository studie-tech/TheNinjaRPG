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
  userQuestAttempt,
} from "@/drizzle/schema";
import {
  findActionableBoundObjective,
  hasFriendlyBindingToPlacement,
  npcMissionSlotDecision,
  pickWeightedQuest,
  resolveOverworldPosition,
} from "@/libs/overworldAi";
import {
  attemptCapReached,
  getReward,
  getUserQuests,
  isAvailableUserQuests,
} from "@/libs/quest";
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
    // Guard: placement config is staff-only, same as the sibling endpoints below.
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!canChangeContent(user.role)) {
      throw serverError("UNAUTHORIZED", "Not allowed");
    }
    const rows = await ctx.drizzle.query.overworldAiPlacement.findMany({
      columns: {
        id: true,
        aiTemplateUserId: true,
        interactionType: true,
        sector: true,
        isActive: true,
      },
      with: { aiTemplate: { columns: { username: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      aiTemplateUserId: r.aiTemplateUserId,
      interactionType: r.interactionType,
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
      // Referential-safety guards on a single binding fetch: a bound placement can't be
      // deactivated, and a placement carrying deliver_item/dialog objectives can't be made
      // HOSTILE — those only resolve at a FRIENDLY NPC (the inverse of the quest-save check).
      const placementId = input.id;
      const makingHostile = input.data.interactionType === "HOSTILE";
      if (placementId && (!input.data.isActive || makingHostile)) {
        const binding = await fetchQuestsBindingPlacement(ctx.drizzle, placementId);
        if (!input.data.isActive && binding.length > 0) {
          return errorResponse(
            `Cannot deactivate: bound to quest(s): ${binding.map((q) => q.name).join(", ")}.`,
          );
        }
        if (makingHostile) {
          const friendlyBound = binding.filter((q) =>
            hasFriendlyBindingToPlacement(q.content.objectives, placementId),
          );
          if (friendlyBound.length > 0) {
            return errorResponse(
              `Cannot set HOSTILE: deliver/dialog objectives in quest(s) ${friendlyBound
                .map((q) => q.name)
                .join(", ")} require a FRIENDLY NPC. Unbind them first.`,
            );
          }
        }
      }
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
      // Guard: refuse to delete a placement that a quest objective references
      const binding = await fetchQuestsBindingPlacement(ctx.drizzle, input.id);
      if (binding.length > 0) {
        return errorResponse(
          `Cannot delete: bound to quest(s): ${binding.map((q) => q.name).join(", ")}. Unbind them first.`,
        );
      }
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
            description: z.string(),
            sceneBackground: z.string(),
            sceneCharacters: z.array(z.string()),
            branches: z.array(
              z.object({ text: z.string(), nextObjectiveId: z.string().optional() }),
            ),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch placement + actor (with quest relations) + inventory in parallel. The
      // bound-objective check needs quest relations before the HOSTILE branch, so load
      // the full user up front (this also removes the previous duplicate user fetch in
      // the FRIENDLY branch).
      //
      // forceRegen MUST be false here: fetchUpdatedUser persists passive regen to
      // userData when forceRegen is true, which would add a DB write to EVERY overworld
      // click (including plain HOSTILE fights). We only need the in-memory user + quest
      // relations + settings. The battle snapshot is re-fetched/regenerated inside
      // initiateBattle, and the reward paths use atomic SQL increments, so none of the
      // paths below depend on persisted regen.
      const [placement, { user: activeUser, settings }, useritems] = await Promise.all([
        fetchPlacement(ctx.drizzle, input.placementId),
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: false,
        }),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);

      // Validate placement: must exist, be active, bind a still-AI template, and the
      // client's position version must match the authoritative server placement.
      if (!placement?.isActive || !placement.aiTemplate?.isAi) {
        return errorResponse("This NPC is no longer here");
      }
      if (placement.positionVersion !== input.positionVersion) {
        return errorResponse("The NPC has moved - refresh the map");
      }
      if (!activeUser) return errorResponse("User does not exist");

      // Validate actor state. Server placement coordinates are authoritative; the
      // client-supplied position is only a hint, so we compare the actor against the
      // placement's stored tile rather than trusting any client coordinates.
      if (activeUser.isBanned) return errorResponse("You are banned");
      if (activeUser.status !== "AWAKE") return errorResponse("You must be awake");
      if (activeUser.travelFinishAt && activeUser.travelFinishAt > new Date()) {
        return errorResponse("You are travelling");
      }
      if (
        activeUser.sector !== placement.sector ||
        activeUser.longitude !== placement.longitude ||
        activeUser.latitude !== placement.latitude
      ) {
        return errorResponse("You are not standing on the NPC's tile");
      }

      // getNewTrackers (called inside getReward) reads useritems for deliver_item
      // possession checks; attach it to a single typed user object reused below.
      const userForTrackers = { ...activeUser, useritems };
      const ownedItemIds = useritems.map((i) => i.itemId);

      // 1) Bound-objective sub-path (defeat_opponents | dialog | deliver_item).
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
        // Defeat target: start a battle vs the placement's AI. The win is recorded by
        // the normal post-battle tracker path (updateUser -> getNewTrackers): the
        // player's questData is loaded into battle state and opponentAIs == this
        // placement's AI (derived at save).
        if (bound.objective.task === "defeat_opponents") {
          const full = getUserQuests(activeUser)
            .flatMap((q) => q.content.objectives)
            .find((o) => o.id === bound.objective.id);
          const scaleTarget =
            full && "opponent_scaled_to_user" in full
              ? Boolean(full.opponent_scaled_to_user)
              : false;
          const scaleGains =
            full && "scaleGains" in full ? Number(full.scaleGains ?? 1) : 1;
          const battle = await startOverworldBattle({
            client: ctx.drizzle,
            placement,
            userId: ctx.userId,
            scaleTarget,
            scaleGains,
          });
          return battle.success
            ? { success: true, message: "Battle started", battleId: battle.battleId }
            : errorResponse(battle.message);
        }

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
            dialog: {
              objectiveId: bound.objective.id,
              // description / sceneBackground / sceneCharacters are baseObjectiveFields,
              // present on every objective — default safely.
              description: dialogObjective?.description ?? "",
              sceneBackground: dialogObjective?.sceneBackground ?? "",
              sceneCharacters: dialogObjective?.sceneCharacters ?? [],
              branches,
            },
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
          getReward(
            userForTrackers,
            bound.questId,
            input.dialogContentId,
            settings,
            // The player is validated as standing on this placement's tile above, so a
            // bound deliver_item/objective resolves off the placement, not stored coords.
            new Set([placement.id]),
          );

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

        // Free the active-NPC-mission slot the moment this interaction completes the quest,
        // instead of waiting for the next NPC visit's self-heal. clearActiveNpcQuest is
        // questId-scoped, so it only releases the slot if it was held for this quest.
        if (resolved) {
          await clearActiveNpcQuest({
            client: ctx.drizzle,
            userId: ctx.userId,
            questId: bound.questId,
          });
        }

        return {
          success: true,
          message: claim.postNotifications.join(" ") || "Interaction complete",
        };
      }

      // 2) Plain HOSTILE fight (no matching bound objective) — existing behavior via the
      // shared helper.
      if (placement.interactionType === "HOSTILE") {
        const battle = await startOverworldBattle({
          client: ctx.drizzle,
          placement,
          userId: ctx.userId,
          scaleTarget: true,
          scaleGains: 1,
        });
        return battle.success
          ? { success: true, message: "Battle started", battleId: battle.battleId }
          : errorResponse(battle.message);
      }

      // 3) Quest-giver sub-path: only reached when no bound objective is actionable.
      // Each pool row carries its own per-quest grant chance.
      const poolQuestIds = placement.questPool.map((p) => p.questId);
      if (poolQuestIds.length === 0) {
        return { success: true, message: "The NPC has nothing for you." };
      }
      const now = new Date();
      const [pool, prevByQuest, attemptRows] = await Promise.all([
        ctx.drizzle.query.quest.findMany({
          where: inArray(quest.id, poolQuestIds),
        }),
        ctx.drizzle.query.questHistory.findMany({
          where: and(
            eq(questHistory.userId, ctx.userId),
            inArray(questHistory.questId, poolQuestIds),
          ),
        }),
        ctx.drizzle
          .select()
          .from(userQuestAttempt)
          .where(
            and(
              eq(userQuestAttempt.userId, ctx.userId),
              inArray(userQuestAttempt.questId, poolQuestIds),
            ),
          ),
      ]);
      const attemptByQuest = new Map(
        attemptRows.map((r) => [r.questId, r.lastAttemptAt]),
      );
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
            !questTypeConcurrentBlockMessage(q, activeUser) &&
            !attemptCapReached(
              { attemptDelay: q.attemptDelay, lastAttemptAt: attemptByQuest.get(q.id) },
              now,
            );
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

      // One NPC mission at a time, tracked by the authoritative activeNpcQuestId slot (the
      // quest TYPE is not a reliable proxy — it both over-blocks unrelated quests and lets a
      // mismatched-type active NPC quest be wrongly self-healed away). Block while the slot
      // points to a still-active quest; release it when the slotted quest has completed/left.
      const slotDecision = npcMissionSlotDecision(
        activeUser.activeNpcQuestId,
        activeUser.userQuests ?? [],
      );
      if (slotDecision === "block") {
        return {
          success: true,
          message: "Finish your current mission before asking for another.",
        };
      }
      if (slotDecision === "clear-stale" && activeUser.activeNpcQuestId) {
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

      // The roll is now committed — record an attempt for every eligible cooldown quest so a
      // 99% "nothing" still spends today's attempt (mirrors how the completion cap works on grant).
      await Promise.all(
        eligible
          .filter((e) => e.quest.attemptDelay !== "none")
          .map((e) =>
            ctx.drizzle
              .insert(userQuestAttempt)
              .values({
                id: nanoid(),
                userId: ctx.userId,
                questId: e.quest.id,
                lastAttemptAt: now,
              })
              .onDuplicateKeyUpdate({ set: { lastAttemptAt: now } }),
          ),
      );

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

/** Quests whose objective content binds to this placement (overworldPlacementId).
 *  Exact JSON membership on the content column (admin-only guard). */
const fetchQuestsBindingPlacement = async (
  client: DrizzleClient,
  placementId: string,
) =>
  client.query.quest.findMany({
    columns: { id: true, name: true, content: true },
    where: sql`JSON_CONTAINS(JSON_EXTRACT(${quest.content}, '$.objectives[*].overworldPlacementId'), JSON_QUOTE(${placementId})) = 1`,
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

/** Start an OVERWORLD PvE battle against a placement's AI. Shared by the plain HOSTILE
 *  fight and the quest-target (defeat_opponents) fight. */
const startOverworldBattle = (opts: {
  client: DrizzleClient;
  placement: NonNullable<Awaited<ReturnType<typeof fetchPlacement>>>;
  userId: string;
  scaleTarget: boolean;
  scaleGains: number;
}) =>
  initiateBattle(
    {
      longitude: opts.placement.longitude,
      latitude: opts.placement.latitude,
      sector: opts.placement.sector,
      userIds: [opts.userId],
      targetIds: [opts.placement.aiTemplateUserId],
      client: opts.client,
      scaleTarget: opts.scaleTarget,
      biome: "default",
    },
    "OVERWORLD",
    opts.scaleGains,
  );
