import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  OVERWORLD_QUEST_ROLLS_PER_DAY,
  WAR_MISSIONS_PER_DAY,
} from "@/drizzle/constants";
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
  pickWeightedQuest,
  resolveOverworldPosition,
  snapOverworldPositionToWalkable,
} from "@/libs/overworldAi";
import {
  attemptCapReached,
  getBoundObjectiveCandidates,
  getReward,
  isAvailableUserQuests,
  isMockQuestHistoryRow,
} from "@/libs/quest";
import { availableQuestLetterRanks } from "@/libs/train";
import { initiateBattle } from "@/routers/combat";
import { fetchUserItems } from "@/routers/item";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import {
  assignQuestToUser,
  commitQuestObjectiveRewards,
  OVERWORLD_ASSIGNABLE_QUEST_TYPES,
  questTypeConcurrentBlockMessage,
} from "@/routers/quests";
import { fetchActiveWars } from "@/routers/war";
import type { DrizzleClient } from "@/server/db";
import { claimActiveNpcQuest, clearActiveNpcQuest } from "@/server/utils/concurrency";
import { fetchPublishedSectorMap } from "@/server/utils/sectorMap";
import { canChangeContent } from "@/utils/permissions";
import { OverworldPlacementSchema } from "@/validators/overworldAi";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "../trpc";

/** Shown when a player asks an NPC for a mission while their single active-NPC-mission slot is
 *  still held — both on the pre-roll slot decision and when the atomic claim loses a race. */
const ACTIVE_NPC_MISSION_BLOCKED_MESSAGE =
  "Finish your current mission before asking for another.";

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

  /**
   * Quest names for the placement pool editor. Returns every quest with an `assignable` flag
   * rather than filtering server-side: the editor needs a name for quests already in a pool whose
   * type has since drifted out of the grantable set, which a filtered list would reduce to a raw id.
   */
  getAssignableQuestNames: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!canChangeContent(user.role)) {
      throw serverError("UNAUTHORIZED", "Not allowed");
    }
    const quests = await ctx.drizzle.query.quest.findMany({
      columns: { id: true, name: true, questType: true },
      orderBy: (table, { asc }) => [asc(table.name)],
    });
    return quests.map((q) => ({
      ...q,
      assignable: OVERWORLD_ASSIGNABLE_QUEST_TYPES.includes(q.questType),
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
      const { quests, ...cfg } = input.data;
      const placementId = input.id;
      const [targetAi, existingPlacement, poolQuests] = await Promise.all([
        ctx.drizzle.query.userData.findFirst({
          columns: { userId: true, isAi: true },
          where: eq(userData.userId, cfg.aiTemplateUserId),
        }),
        placementId
          ? ctx.drizzle.query.overworldAiPlacement.findFirst({
              columns: { id: true, aiTemplateUserId: true },
              where: eq(overworldAiPlacement.id, placementId),
            })
          : Promise.resolve(undefined),
        quests.length > 0
          ? ctx.drizzle.query.quest.findMany({
              columns: { id: true, name: true, questType: true },
              where: inArray(
                quest.id,
                quests.map((q) => q.questId),
              ),
            })
          : Promise.resolve([]),
      ]);
      if (!targetAi?.isAi) return errorResponse("AI template does not exist");
      if (placementId && !existingPlacement) {
        return errorResponse("Placement no longer exists");
      }
      const poolQuestById = new Map(poolQuests.map((q) => [q.id, q]));
      const missingQuestIds = quests
        .map((q) => q.questId)
        .filter((id) => !poolQuestById.has(id));
      if (missingQuestIds.length > 0) {
        return errorResponse(
          `Quest pool contains missing quest(s): ${missingQuestIds.join(", ")}`,
        );
      }
      const unsupportedPoolQuests = poolQuests.filter(
        (q) => !OVERWORLD_ASSIGNABLE_QUEST_TYPES.includes(q.questType),
      );
      if (unsupportedPoolQuests.length > 0) {
        return errorResponse(
          `These quest types cannot be granted by an overworld NPC: ${unsupportedPoolQuests
            .map((q) => `${q.name} (${q.questType})`)
            .join(", ")}`,
        );
      }

      // Position-map loading is independent of the binding checks below. Start it now so the
      // successful edit path pays for both DB reads in parallel; normalize failure to null so an
      // early binding return cannot leave a rejected promise unobserved.
      const rawPosition = resolveOverworldPosition(cfg);
      const sectorMapPromise = fetchPublishedSectorMap(
        ctx.drizzle,
        rawPosition.sector,
      ).catch(() => null);

      // Referential-safety guards: a bound placement cannot be deactivated, repointed at a
      // different AI, or changed to HOSTILE while it carries a friendly interaction objective.
      const makingHostile = input.data.interactionType === "HOSTILE";
      const changingAi =
        !!existingPlacement &&
        existingPlacement.aiTemplateUserId !== cfg.aiTemplateUserId;
      if (placementId && makingHostile) {
        // HOSTILE needs objective content to detect friendly deliver/dialog bindings; that fetch
        // already carries the quest names, so a single query also covers the deactivate check.
        const binding = await fetchQuestsBindingPlacement(ctx.drizzle, placementId);
        if (!input.data.isActive && binding.length > 0) {
          return errorResponse(
            `Cannot deactivate: bound to quest(s): ${binding.map((q) => q.name).join(", ")}.`,
          );
        }
        if (changingAi && binding.length > 0) {
          return errorResponse(
            `Cannot change AI template: bound to quest(s): ${binding.map((q) => q.name).join(", ")}. Unbind them first.`,
          );
        }
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
      } else if (placementId && (!input.data.isActive || changingAi)) {
        // Pure deactivation / AI reassignment only needs names, so skip the heavy content JSON.
        const binding = await fetchQuestNamesBindingPlacement(ctx.drizzle, placementId);
        if (binding.length > 0) {
          return errorResponse(
            `${changingAi ? "Cannot change AI template" : "Cannot deactivate"}: bound to quest(s): ${binding.map((q) => q.name).join(", ")}.`,
          );
        }
      }
      // Prepare
      const sectorMap = await sectorMapPromise;
      if (!sectorMap) {
        return errorResponse(`Sector ${rawPosition.sector} has no published map`);
      }
      const pos = snapOverworldPositionToWalkable(rawPosition, sectorMap);
      if (!pos)
        return errorResponse(`Sector ${rawPosition.sector} has no walkable tile`);
      if (
        cfg.sectorType === "specific" &&
        cfg.locationType === "specific" &&
        (pos.longitude !== rawPosition.longitude ||
          pos.latitude !== rawPosition.latitude)
      ) {
        return errorResponse(
          `Tile (${rawPosition.longitude}, ${rawPosition.latitude}) is blocked. Nearest walkable tile: (${pos.longitude}, ${pos.latitude}).`,
        );
      }
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
      // Guard: refuse to delete a placement that a quest objective references (names only)
      const binding = await fetchQuestNamesBindingPlacement(ctx.drizzle, input.id);
      if (binding.length > 0) {
        return errorResponse(
          `Cannot delete: bound to quest(s): ${binding.map((q) => q.name).join(", ")}. Unbind them first.`,
        );
      }
      // No foreign keys link these tables in PlanetScale, so both deletes are independent.
      await Promise.all([
        ctx.drizzle
          .delete(overworldAiPlacementQuest)
          .where(eq(overworldAiPlacementQuest.placementId, input.id)),
        ctx.drizzle
          .delete(overworldAiPlacement)
          .where(eq(overworldAiPlacement.id, input.id)),
      ]);
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

      // getNewTrackers reads `useritems` for delivery possession checks, while the shared
      // consequence handler resolves the concrete row to delete through `items`.
      // fetchUpdatedUser only hydrates equipped items, so both properties must use the full
      // inventory fetched above for an unequipped delivery item to be consumed.
      const userForTrackers = { ...activeUser, items: useritems, useritems };
      const ownedItemIds = useritems.map((i) => i.itemId);

      // 1) Bound-objective sub-path (defeat_opponents | dialog | deliver_item).
      const boundCandidates = getBoundObjectiveCandidates(activeUser);
      const matchedBound = findActionableBoundObjective({
        activeQuests: boundCandidates,
        ownedItemIds,
        placementId: placement.id,
      });
      // Friendly-only objectives attached to a HOSTILE placement are malformed legacy content;
      // ignore them so they cannot make the ordinary hostile fight unreachable.
      const bound =
        matchedBound &&
        (placement.interactionType === "FRIENDLY" ||
          matchedBound.objective.task === "defeat_opponents")
          ? matchedBound
          : null;

      if (bound) {
        // Defeat target: start a battle vs the placement's AI. The win is recorded by
        // the normal post-battle tracker path (updateUser -> getNewTrackers): the
        // player's questData is loaded into battle state and opponentAIs == this
        // placement's AI (derived at save).
        if (bound.objective.task === "defeat_opponents") {
          const full = bound.objective.source;
          const scaleTarget =
            "opponent_scaled_to_user" in full
              ? Boolean(full.opponent_scaled_to_user)
              : false;
          const scaleGains = "scaleGains" in full ? Number(full.scaleGains ?? 1) : 1;
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
          const dialogObjective = bound.objective.source;
          const branches =
            "nextObjectiveId" in dialogObjective &&
            Array.isArray(dialogObjective.nextObjectiveId)
              ? dialogObjective.nextObjectiveId
              : [];
          return {
            success: true,
            // Empty message suppresses showMutationToast on the client (see item.ts /
            // combat.ts convention); the dialog modal opens off `data.dialog`, not the message.
            message: "",
            dialog: {
              objectiveId: bound.objective.id,
              // description / sceneBackground / sceneCharacters are baseObjectiveFields,
              // present on every objective — default safely.
              description: dialogObjective.description ?? "",
              sceneBackground: dialogObjective.sceneBackground ?? "",
              sceneCharacters: dialogObjective.sceneCharacters ?? [],
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
          user: userForTrackers,
          rewards,
          trackers,
          userQuest,
          resolved,
          notifications,
          consequences,
          // Match only a real, persisted questHistory row. Achievements carry an in-memory
          // mock row (id === questId, no DB row) that would make existingHistory truthy and
          // skip the required INSERT in commitQuestObjectiveRewards — leaving the completion
          // CAS with no row to update (not_found). Excluding mocks lets that INSERT run.
          existingHistory:
            activeUser.userQuests?.find(
              (q) => q.questId === bound.questId && !isMockQuestHistoryRow(q),
            ) ?? null,
          // The active-NPC-mission slot is freed centrally by commitQuestObjectiveRewards on
          // terminal completion (questId-scoped IF, folded into updateRewards' userData write),
          // so this path needs no explicit clear.
        });

        // `already_completed` means the completion actually landed server-side on an earlier
        // (double-click / raced) claim; commitQuestObjectiveRewards is idempotent and the reward
        // was granted then, so surface it as success rather than a spurious "state changed" toast.
        // Only not_found / state_changed are genuinely retryable errors.
        if (claim.outcome === "already_completed") {
          return { success: true, message: "Interaction complete" };
        }
        if (claim.outcome !== "claimed") {
          return errorResponse("Quest state changed, please try again");
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

      // A reachable delivery with missing items is still the intended interaction. Detect it
      // before the quest-giver fallback so clicking "Deliver" cannot spend a mission roll or
      // grant an unrelated quest merely because the possession-aware matcher skipped it.
      const missingDelivery = findActionableBoundObjective({
        activeQuests: boundCandidates,
        ownedItemIds,
        placementId: placement.id,
        ignoreItemOwnership: true,
      });
      if (missingDelivery?.objective.task === "deliver_item") {
        const source = missingDelivery.objective.source;
        const itemName = "item_name" in source ? source.item_name : "the required item";
        return errorResponse(`You don't have ${itemName} to deliver.`);
      }

      // 3) Quest-giver sub-path: only reached when no bound objective is actionable.
      // Each pool row carries its own per-quest grant chance.
      const poolQuestIds = placement.questPool.map((p) => p.questId);
      if (poolQuestIds.length === 0) {
        return { success: true, message: "The NPC has nothing for you." };
      }
      const now = new Date();
      const poolPromise = ctx.drizzle.query.quest.findMany({
        where: inArray(quest.id, poolQuestIds),
      });
      // War lookup depends on the pool contents, but chaining it from the pool promise lets it
      // overlap the independent history and cooldown reads instead of adding another DB round-trip.
      const activeWarsPromise = poolPromise.then((pool) =>
        activeUser.villageId && pool.some((q) => q.questType === "war")
          ? fetchActiveWars(ctx.drizzle, activeUser.villageId)
          : [],
      );
      const [pool, prevByQuest, attemptRows, activeWars] = await Promise.all([
        poolPromise,
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
        activeWarsPromise,
      ]);
      const attemptByQuest = new Map(
        attemptRows.map((r) => [r.questId, r.lastAttemptAt]),
      );
      const historyByQuest = new Map(prevByQuest.map((r) => [r.questId, r]));
      const questsById = new Map(pool.map((q) => [q.id, q]));
      const allowedRanks = availableQuestLetterRanks(activeUser.rank);

      // Build the eligible pool, keeping each entry's chance. isAvailableUserQuests now
      // includes the per-period cap, so period-capped quests drop out here automatically.
      const eligible = placement.questPool
        .map((p) => {
          const q = questsById.get(p.questId);
          if (!q) return null;
          // Skip types the overworld pool can't grant: ones the centralized assigner can't start
          // (e.g. errand, whose daily cap only startRandom enforces — reaching assignQuestToUser
          // with one throws and strands the claimed slot), plus occupation/structure-gated types
          // (hunting/gathering/anbu/story/event) whose UI gate the overworld path can't enforce.
          if (!OVERWORLD_ASSIGNABLE_QUEST_TYPES.includes(q.questType)) return null;
          const prev = historyByQuest.get(q.id);
          const warEligible =
            q.questType !== "war" ||
            (!!activeUser.villageId &&
              activeUser.dailyWarMissions < WAR_MISSIONS_PER_DAY &&
              activeWars.length > 0);
          const available =
            isAvailableUserQuests({ ...q, ...prev }, activeUser).check &&
            allowedRanks.includes(q.questRank) &&
            !(q.startsAt && q.startsAt > now.toISOString()) &&
            warEligible &&
            !questTypeConcurrentBlockMessage(q, activeUser) &&
            !attemptCapReached(
              { attemptDelay: q.attemptDelay, lastAttemptAt: attemptByQuest.get(q.id) },
              now,
            );
          if (!available) return null;
          return { quest: q, chance: p.chance, prev };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      // Eligible-empty check BEFORE the daily-roll CAS so an empty pool costs no roll.
      if (eligible.length === 0) {
        return {
          success: true,
          message: "The NPC has nothing available for you right now.",
        };
      }

      // The slot, rather than quest type, determines whether another NPC mission may start.
      const activeNpcQuestId = activeUser.activeNpcQuestId;
      const slottedQuestIsActive =
        !!activeNpcQuestId &&
        (activeUser.userQuests ?? []).some(
          (q) => q.questId === activeNpcQuestId && !q.endAt,
        );
      if (slottedQuestIsActive) {
        return { success: true, message: ACTIVE_NPC_MISSION_BLOCKED_MESSAGE };
      }

      // Consume one daily roll via CAS before rolling so a failed roll still costs a slot.
      // A stale slot belongs to another quest and can be cleared in parallel with this counter.
      const clearStale = activeNpcQuestId
        ? clearActiveNpcQuest({
            client: ctx.drizzle,
            userId: ctx.userId,
            questId: activeNpcQuestId,
          })
        : Promise.resolve();
      const [, claim] = await Promise.all([
        clearStale,
        ctx.drizzle
          .update(userData)
          .set({
            dailyOverworldQuestRolls: sql`${userData.dailyOverworldQuestRolls} + 1`,
          })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              sql`${userData.dailyOverworldQuestRolls} < ${OVERWORLD_QUEST_ROLLS_PER_DAY}`,
            ),
          ),
      ]);
      if (claim.rowsAffected === 0) {
        return errorResponse("You've reached your daily mission allowance.");
      }

      // Record an attempt for every eligible cooldown quest, including a roll that grants nothing.
      const attemptRowsToInsert = eligible
        .filter((e) => e.quest.attemptDelay !== "none")
        .map((e) => ({
          userId: ctx.userId,
          questId: e.quest.id,
          lastAttemptAt: now,
        }));
      // This write is independent of the selected quest and may run alongside the slot claim.
      const attemptPromise =
        attemptRowsToInsert.length > 0
          ? ctx.drizzle
              .insert(userQuestAttempt)
              .values(attemptRowsToInsert)
              .onDuplicateKeyUpdate({ set: { lastAttemptAt: now } })
          : Promise.resolve();

      // Each quest owns [acc, acc+chance); a roll past the total grants nothing.
      const chosenId = pickWeightedQuest(
        eligible.map((e) => ({ questId: e.quest.id, chance: e.chance })),
        Math.random() * 100,
      );
      const chosen = chosenId
        ? eligible.find((e) => e.quest.id === chosenId)
        : undefined;
      if (!chosen) {
        await attemptPromise;
        return { success: true, message: "The NPC had nothing for you this time." };
      }
      // Claim the single active-NPC-mission slot atomically before granting. If the slot is
      // already taken (e.g. a concurrent interaction won the race), don't grant a second one.
      const [, claimed] = await Promise.all([
        attemptPromise,
        claimActiveNpcQuest({
          client: ctx.drizzle,
          userId: ctx.userId,
          questId: chosen.quest.id,
        }),
      ]);
      if (!claimed) {
        return { success: true, message: ACTIVE_NPC_MISSION_BLOCKED_MESSAGE };
      }
      // Release the slot we just claimed on ANY assign failure — a `!success` return or an
      // unexpected throw — so a failed assign never strands the player behind a claim that
      // produced no quest.
      /** Releases the NPC-mission slot claimed for this quest when assignment does not complete. */
      const releaseClaimedSlot = () =>
        clearActiveNpcQuest({
          client: ctx.drizzle,
          userId: ctx.userId,
          questId: chosen.quest.id,
        });
      let result: Awaited<ReturnType<typeof assignQuestToUser>>;
      try {
        result = await assignQuestToUser({
          client: ctx.drizzle,
          user: activeUser,
          quest: chosen.quest,
          source: "overworld_npc",
          overworldPlacementId: placement.id,
          prevAttempt: chosen.prev,
        });
      } catch (e) {
        await releaseClaimedSlot();
        throw e;
      }
      if (!result.success) {
        // Assign failed (e.g. cap/availability raced).
        await releaseClaimedSlot();
        return errorResponse(result.message);
      }
      return {
        success: true,
        message: result.message,
        grantedQuestId: chosen.quest.id,
      };
    }),
});

/** Exact JSON membership predicate: a quest's objective content binds this placement
 *  (overworldPlacementId). Shared by the name-only and content-bearing fetches below. */
const questBindsPlacementWhere = (placementId: string) =>
  sql`JSON_CONTAINS(JSON_EXTRACT(${quest.content}, '$.objectives[*].overworldPlacementId'), JSON_QUOTE(${placementId})) = 1`;

/** Quests (id + name only) whose objective content binds this placement — for name-only guards.
 *  Skips the potentially large `content` JSON the deactivate/delete callers never inspect. */
const fetchQuestNamesBindingPlacement = async (
  client: DrizzleClient,
  placementId: string,
) =>
  client.query.quest.findMany({
    columns: { id: true, name: true },
    where: questBindsPlacementWhere(placementId),
  });

/** Same binding set, plus the objective content needed to detect friendly deliver/dialog
 *  bindings (only the make-HOSTILE guard reads it). Admin-only guard. */
const fetchQuestsBindingPlacement = async (
  client: DrizzleClient,
  placementId: string,
) =>
  client.query.quest.findMany({
    columns: { id: true, name: true, content: true },
    where: questBindsPlacementWhere(placementId),
  });

/** Load a placement with its quest pool and the AI template identity/isAi flag. */
const fetchPlacement = async (client: DrizzleClient, placementId: string) =>
  client.query.overworldAiPlacement.findFirst({
    where: eq(overworldAiPlacement.id, placementId),
    columns: {
      id: true,
      isActive: true,
      aiTemplateUserId: true,
      interactionType: true,
      sector: true,
      longitude: true,
      latitude: true,
      positionVersion: true,
    },
    with: {
      questPool: { columns: { questId: true, chance: true } },
      aiTemplate: { columns: { isAi: true } },
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
