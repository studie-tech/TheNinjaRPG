import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { DUNGEON_RUN_SECONDS, DUNGEON_SOLO_PETS } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { transitionCoopParty } from "@/libs/coop";
import { dungeonFloorAt, dungeonRequirements } from "@/libs/dungeon";
import {
  dungeonDropKey,
  dungeonRewardError,
  rollDungeonRewards,
} from "@/libs/dungeonRewards";
import { canUsePet } from "@/libs/pets/progression";
import { listAiUserIds } from "@/queries/ai";
import { listUserPetForInitiateBattle } from "@/queries/combat";
import {
  claimDungeonQueue,
  clearDungeonActiveUsers,
  deleteDungeonMemberForUpdateParty,
  deleteDungeonRunForCreate,
  findDungeonForCreate,
  findDungeonMemberForClaim,
  findDungeonMemberForCreate,
  findDungeonRequirementSources,
  findDungeonRewardUserCache,
  findDungeonRunForAct,
  findMapAssetForSave,
  findUserDataForGetAvailable,
  grantDungeonPetExperience,
  insertActionLogForSave,
  insertDungeonForSave,
  insertDungeonMember,
  insertDungeonRunForCreate,
  listBattleForGetState,
  listDungeonForGetAvailable,
  listDungeonMemberForAct,
  listDungeonMemberForGetState,
  listDungeonRewardHistory,
  listDungeonRunForGetState,
  listItemForSave,
  listJutsuForSave,
  listRewardPackageForSave,
  listUserDataForGetState,
  lockDungeonRewardUser,
  releaseDungeonQueue,
  selectCandidatesForGetState,
  selectDungeonMemberForGetState,
  updateDungeonMemberForClaim,
  updateDungeonRewardReceipt,
  updateDungeonRunForReserve,
  updateDungeonRunForUpdateParty,
} from "@/queries/dungeon";
import { findUserById, findUserRoleById } from "@/queries/profile";
import { initiateBattle } from "@/routers/combat";
import { updateRewards } from "@/routers/quests";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { launchCoopEncounter } from "@/server/utils/coop";
import { expireDungeonRun, rollbackDungeonStart } from "@/server/utils/dungeon";
import { dungeonAdmission, fetchDungeonEntryData } from "@/server/utils/dungeonEntry";
import { getDungeonRewardUserUpdate } from "@/server/utils/dungeonUserCache";
import { notifyMapLocationsChanged } from "@/server/utils/mapLocations";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { canChangeContent } from "@/utils/permissions";
import { secondsFromNow } from "@/utils/time";
import {
  dungeonActionSchema,
  dungeonContentSchema,
  dungeonIdSchema,
  dungeonSectorSchema,
  saveDungeonSchema,
} from "@/validators/dungeon";

/** Party state is versioned; active membership and completion receipts guard cross-run effects. */
export const dungeonRouter = createTRPCRouter({
  /** List visible, unexpired definitions only for the player's current sector. */
  getAvailable: protectedProcedure
    .input(dungeonSectorSchema)
    .query(async ({ ctx, input }) => {
      const [user, definitions, admissionData] = await Promise.all([
        findUserDataForGetAvailable(ctx.drizzle, ctx),
        listDungeonForGetAvailable(ctx.drizzle),
        fetchDungeonEntryData(ctx.drizzle, [ctx.userId]),
      ]);
      if (user?.sector !== input.sector) return [];
      return definitions
        .filter(
          (d) =>
            !d.content.hidden &&
            d.content.sector === user?.sector &&
            (!d.content.expiresAt ||
              new Date(d.content.expiresAt).getTime() > Date.now()),
        )
        .map((d) => ({
          ...d,
          content: { ...d.content, requirements: dungeonRequirements(d.content) },
          admission: dungeonAdmission(admissionData, user, d.id, d.content),
        }));
    }),
  /** Load parties and receipts, expiring deadlines and recovering interrupted floor starts. */
  getState: protectedProcedure.query(async ({ ctx }) => {
    // A derived UNION materializes indexed candidates once; IN can become a dependent
    // subquery that scans every historical run before probing membership.
    const candidates = selectDungeonMemberForGetState(ctx.drizzle, ctx);
    const runs = await selectCandidatesForGetState(ctx.drizzle, candidates, ctx);
    const expiryNeedsRefresh = await Promise.all(
      runs.map((run) => expireDungeonRun(ctx.drizzle, run)),
    );
    const ids = [
      ...new Set(runs.flatMap((r) => [...r.state.memberIds, ...r.state.invitedIds])),
    ];
    const [users, members, refreshedRuns] = await Promise.all([
      ids.length ? listUserDataForGetState(ctx.drizzle, ids) : [],
      runs.length ? listDungeonMemberForGetState(ctx.drizzle, runs) : [],
      expiryNeedsRefresh.some(Boolean)
        ? listDungeonRunForGetState(ctx.drizzle, runs)
        : null,
    ]);
    // Reconcile a reservation whose queue claim was interrupted before the next read.
    await Promise.all(
      users
        .filter((user) => user.status === "AWAKE")
        .map(async (user) => {
          const run = (refreshedRuns ?? runs).find(
            (run) =>
              ["LOBBY", "BETWEEN", "PAUSED"].includes(run.status) &&
              run.state.memberIds.includes(user.userId),
          );
          if (run) {
            const claim = await claimDungeonQueue(ctx.drizzle, user.userId, run.id);
            if (claim.rowsAffected === 1) user.status = "QUEUED";
          }
        }),
    );
    // Selection prioritizes active parties; the response keeps its chronological ordering.
    let currentRuns =
      refreshedRuns ??
      [...runs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const interrupted = currentRuns.filter(
      (r) =>
        ["FIGHTING", "STARTING"].includes(r.status) &&
        r.battleId &&
        r.state.entryStartedAt &&
        Date.now() - r.state.entryStartedAt > 60000,
    );
    if (interrupted.length) {
      const battles = await listBattleForGetState(ctx.drizzle, interrupted);
      const missing = interrupted.filter(
        (r) => r.status === "STARTING" || !battles.some((b) => b.id === r.battleId),
      );
      await Promise.all(
        missing.map((r) =>
          rollbackDungeonStart(
            ctx.drizzle,
            {
              ...r,
              expiresAt: r.state.entryPreviousDeadline
                ? new Date(r.state.entryPreviousDeadline)
                : null,
            },
            r.battleId as string,
            r.version,
          ),
        ),
      );
      if (missing.length)
        currentRuns = await listDungeonRunForGetState(ctx.drizzle, currentRuns);
    }
    return {
      runs: currentRuns,
      users,
      members: members.filter((m) => m.userId === ctx.userId),
      serverTime: new Date(),
    };
  }),
  /** Staff may inspect hidden and expired definitions when authoring dungeon content. */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const user = await findUserRoleById(ctx.drizzle, ctx.userId);
    return user && canChangeContent(user.role)
      ? listDungeonForGetAvailable(ctx.drizzle)
      : [];
  }),
  /** Validate sources and grant limits, copying approved package snapshots before saving. */
  save: protectedProcedure
    .use(ratelimitMiddleware)
    .input(saveDungeonSchema)
    .mutation(async ({ ctx, input }) => {
      const aiIds = [
        ...new Set(
          input.content.tiers.flatMap((tier) =>
            tier.flatMap((floor) => floor.waves.flatMap((w) => w.aiIds)),
          ),
        ),
      ];
      const drops = input.content.rewards.drops;
      const [
        user,
        ais,
        items,
        jutsus,
        entranceAsset,
        packages,
        [requiredQuest, requiredItem],
      ] = await Promise.all([
        findUserRoleById(ctx.drizzle, ctx.userId),
        listAiUserIds(ctx.drizzle, aiIds),
        drops.some((d) => d.type === "item" || d.type === "cache")
          ? listItemForSave(ctx.drizzle, drops)
          : [],
        drops.some((d) => d.type === "jutsu")
          ? listJutsuForSave(ctx.drizzle, drops)
          : [],
        input.content.structureAssetId ? findMapAssetForSave(ctx.drizzle, input) : null,
        drops.some((d) => d.type === "package")
          ? listRewardPackageForSave(ctx.drizzle, drops)
          : [],
        findDungeonRequirementSources(ctx.drizzle, input.content.requirements),
      ]);
      if (!user || !canChangeContent(user.role))
        return errorResponse("You cannot edit dungeons.");
      if (
        (input.content.requirements.prerequisiteQuestId && !requiredQuest) ||
        (input.content.requirements.requiredItemId && !requiredItem)
      )
        return errorResponse("A prerequisite quest or entry item no longer exists.");
      if (input.content.structureAssetId && !entranceAsset)
        return errorResponse(
          "The entrance artwork no longer exists. Choose another asset.",
        );
      if (
        ais.length !== aiIds.length ||
        drops.some(
          (d) =>
            !(
              d.type === "package" ? packages : d.type === "jutsu" ? jutsus : items
            ).some((row) => row.id === d.id),
        )
      )
        return errorResponse("An enemy or reward no longer exists.");
      if (
        drops.some(
          (drop) =>
            drop.type === "cache" &&
            !items
              .find((entry) => entry.id === drop.id)
              ?.effects.some(
                (effect) =>
                  effect.type === "noncombatconsumereward" &&
                  effect.rewardMode === "weightedCache",
              ),
        )
      )
        return errorResponse("Choose a weighted cache for each cache reward.");
      // Only approved catalog data enters the snapshot, regardless of the client's payload.
      const content = {
        ...input.content,
        requirements: {
          ...input.content.requirements,
          prerequisiteQuestName: requiredQuest?.name,
          requiredItemName: requiredItem?.name,
        },
        rewards: {
          ...input.content.rewards,
          drops: drops.map(({ package: _snapshot, ...drop }) => {
            const source =
              drop.type === "package"
                ? packages.find((entry) => entry.id === drop.id)
                : undefined;
            return source
              ? {
                  ...drop,
                  package: {
                    name: source.name,
                    description: source.description,
                    rewards: source.rewards,
                  },
                }
              : drop;
          }),
        },
      };
      const rewardError = dungeonRewardError(content.rewards);
      if (rewardError) return errorResponse(rewardError);
      const id = input.id ?? nanoid();
      await Promise.all([
        insertDungeonForSave(ctx.drizzle, id, content),
        insertActionLogForSave(ctx.drizzle, ctx, id, content),
      ]);
      await notifyMapLocationsChanged();
      return { success: true, message: "Dungeon saved.", id };
    }),
  /** Snapshot an available definition and reserve the leader's sole active membership. */
  create: protectedProcedure
    .use(ratelimitMiddleware)
    .input(
      z.object({
        id: z.string().min(1),
        petIds: z
          .array(z.string().min(1))
          .length(DUNGEON_SOLO_PETS)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            `Choose ${DUNGEON_SOLO_PETS} different companions.`,
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [user, definition, active, admissionData, pets] = await Promise.all([
        findUserById(ctx.drizzle, ctx.userId),
        findDungeonForCreate(ctx.drizzle, input),
        findDungeonMemberForCreate(ctx.drizzle, ctx),
        fetchDungeonEntryData(ctx.drizzle, [ctx.userId]),
        input.petIds ? listUserPetForInitiateBattle(ctx.drizzle, [ctx.userId], []) : [],
      ]);
      if (user?.status !== "AWAKE" || user.isBanned || user.isAi)
        return errorResponse(
          "You must be awake and out of combat to create a dungeon lobby.",
        );
      if (active) return errorResponse("Finish or leave your current dungeon first.");
      const content = definition && dungeonContentSchema.parse(definition.content);
      if (
        !definition ||
        !content ||
        content.hidden ||
        (content.expiresAt && content.expiresAt.getTime() <= Date.now())
      )
        return errorResponse("This dungeon is unavailable.");
      if (user.sector !== content.sector)
        return errorResponse("Travel to the dungeon's sector to create a lobby.");
      const admission = dungeonAdmission(admissionData, user, definition.id, content);
      if (admission.error) return errorResponse(admission.error);
      const selectedPets = input.petIds?.map((id) =>
        pets.find((pet) => pet.id === id && pet.userId === user.userId),
      );
      if (
        selectedPets?.some(
          (pet) =>
            !pet ||
            !pet.species ||
            pet.generationStatus !== "READY" ||
            user.petTask?.petId === pet.id ||
            !canUsePet(pet, user),
        )
      )
        return errorResponse(
          `Choose ${DUNGEON_SOLO_PETS} fully generated, battle-ready companions who are not on a task.`,
        );
      const lineup = selectedPets?.flatMap((pet) =>
        pet ? [{ id: pet.id, name: pet.name, avatar: pet.avatar }] : [],
      );
      const id = nanoid();
      // The unique activeUserId prevents two parties for this account. A crash between
      // inserts can leave only an empty, unreferenced run, which support can remove.
      await insertDungeonRunForCreate(
        ctx.drizzle,
        id,
        definition,
        ctx,
        content,
        lineup,
      );
      try {
        await insertDungeonMember(ctx.drizzle, id, ctx.userId);
        // A crash here can leave a reversible membership without queue protection. A
        // failed status claim removes only this run's reservation and never another activity.
        const queued = await claimDungeonQueue(ctx.drizzle, ctx.userId, id);
        if (queued.rowsAffected !== 1) {
          await deleteDungeonMemberForUpdateParty(ctx.drizzle, { id }, ctx.userId);
          await deleteDungeonRunForCreate(ctx.drizzle, id);
          return errorResponse("Your activity changed. Refresh and try again.");
        }
      } catch (error) {
        // Never remove a run if membership committed despite an ambiguous driver failure.
        await deleteDungeonRunForCreate(ctx.drizzle, id);
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("You already joined another dungeon.");
        throw error;
      }
      return { success: true, message: "Lobby created.", userPatch: {}, id };
    }),
  /** Apply one party version; membership changes also commit their cross-run reservation. */
  act: protectedProcedure
    .use(ratelimitMiddleware)
    .input(dungeonActionSchema)
    .mutation(async ({ ctx, input }) => {
      const [run, user, target, active] = await Promise.all([
        findDungeonRunForAct(ctx.drizzle, input),
        findUserById(ctx.drizzle, ctx.userId),
        input.userId ? findUserById(ctx.drizzle, input.userId) : undefined,
        listDungeonMemberForAct(ctx.drizzle, ctx, input),
      ]);
      if (!run || !user) return errorResponse("Dungeon not found.");
      if (run.expiresAt && run.expiresAt.getTime() <= Date.now()) {
        await expireDungeonRun(ctx.drizzle, run);
        return {
          ...errorResponse("The dungeon deadline expired."),
          userPatch: undefined,
        };
      }
      const { action } = input;
      const transition = transitionCoopParty(
        run.state.pets ? "dungeonSolo" : "dungeon",
        {
          ...run.state,
          leaderId: run.leaderId,
          isPublic: false,
          phase: run.status,
        },
        ctx.userId,
        action === "accept" ? "join" : action,
        input.userId,
      );
      if (!transition.success) return errorResponse(transition.message);
      if (run.state.pets && ["invite", "accept", "remove"].includes(action))
        return errorResponse("A solo squad uses its selected companions.");
      if (action === "invite") {
        if (!target || target.isAi || target.isBanned || target.status !== "AWAKE")
          return errorResponse("Invite someone who is awake and out of combat.");
        if (active.some((m) => m.activeUserId === target.userId))
          return errorResponse("That player is already in a dungeon.");
      }
      if (
        ["accept", "ready", "unready"].includes(action) &&
        (user.status !== (action === "accept" ? "AWAKE" : "QUEUED") ||
          user.isBanned ||
          user.isAi)
      )
        return errorResponse(
          "You must be awake and out of combat to join or ready up.",
        );
      if (action === "accept" && active.some((m) => m.activeUserId === ctx.userId))
        return errorResponse("You are already in a dungeon.");
      if (["accept", "ready"].includes(action) && !run.state.entryPaidAt) {
        const admission = dungeonAdmission(
          await fetchDungeonEntryData(ctx.drizzle, [ctx.userId]),
          user,
          run.dungeonId,
          run.content,
        );
        if (admission.error) return errorResponse(admission.error);
      }
      const { party, removedUserId: removedUser, ended: ending } = transition;
      const joined = !!transition.joinedUserId;
      const state = {
        ...run.state,
        memberIds: party.memberIds,
        invitedIds: party.invitedIds,
        readyIds: party.readyIds,
        ...(ending ? { message: "A party member abandoned the dungeon." } : {}),
      };
      const status =
        party.phase === "STARTING" || party.phase === "ACTIVE"
          ? run.status
          : party.phase;
      if (action === "start") {
        const floor = dungeonFloorAt(run.content, state.floor);
        if (!floor) return errorResponse("This floor is unavailable.");
        const expiresAt = run.state.entryPaidAt
          ? (run.expiresAt ?? secondsFromNow(DUNGEON_RUN_SECONDS))
          : secondsFromNow(DUNGEON_RUN_SECONDS);
        const result = await launchCoopEncounter({
          reserve: async ({ battleId }) => {
            const claimed = await updateDungeonRunForReserve(
              ctx.drizzle,
              battleId,
              expiresAt,
              run,
              state,
            );
            return claimed.rowsAffected === 1;
          },
          initiate: ({ battleId }) =>
            initiateBattle(
              {
                client: ctx.drizzle,
                cacheUserId: ctx.userId,
                userIds: state.memberIds,
                targetIds: floor.waves.flatMap((w) => w.aiIds),
                biome: run.content.background,
                forceKeepPools: true,
                autoCombatFromDefaults: true,
                coop: {
                  kind: "dungeon",
                  dungeonId: run.dungeonId,
                  content: run.content,
                  battleId,
                  runId: run.id,
                  runVersion: run.version + 1,
                  runState: state,
                  totalFloors: run.content.tiers.flat().length,
                  roomKind: floor.kind,
                  expiresAt: expiresAt.getTime(),
                  waves: floor.waves,
                },
              },
              "QUEST",
              0,
            ),
          recover: ({ battleId }) =>
            rollbackDungeonStart(ctx.drizzle, run, battleId, run.version + 1),
        });
        return result;
      }

      const queueChanged = new Error("Dungeon queue claim changed");
      /** Keep the run's member list consistent with each member's unique active reservation. */
      const updateParty = async (
        client: Pick<DrizzleClient, "update" | "insert" | "delete">,
      ) => {
        const claim = await updateDungeonRunForUpdateParty(client, state, status, run);
        if (claim.rowsAffected !== 1) return false;
        if (joined) {
          await insertDungeonMember(client, run.id, ctx.userId);
          const queued = await claimDungeonQueue(client, ctx.userId, run.id);
          if (queued.rowsAffected !== 1) throw queueChanged;
        }
        if (removedUser || ending)
          await releaseDungeonQueue(client, run.id, ending ? undefined : removedUser);
        if (removedUser)
          await deleteDungeonMemberForUpdateParty(client, run, removedUser);
        if (ending) await clearDungeonActiveUsers(client, run.id);
        return true;
      };
      try {
        // Roster changes span the run and unique activeUserId reservation. Neither row's
        // guard alone can keep them consistent after failure; use a short transaction only
        // for these changes. Invitations, readiness and pause/resume need just the run CAS.
        const saved = await retryOnDeadlock(() =>
          joined || removedUser || ending
            ? ctx.drizzle.transaction(updateParty)
            : updateParty(ctx.drizzle),
        );
        return saved
          ? { success: true, message: "Party updated.", userPatch: {} }
          : errorResponse("The party changed. Refresh and try again.");
      } catch (error) {
        if (error === queueChanged)
          return errorResponse("Your activity changed. Refresh and try again.");
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("That player joined another dungeon.");
        throw error;
      }
    }),
  /** Deliver one complete-pyramid roll per member; repeat claims return its saved receipt. */
  claim: protectedProcedure
    .use(ratelimitMiddleware)
    .input(dungeonIdSchema)
    .mutation(async ({ ctx, input }) => {
      const [run, member, user] = await Promise.all([
        findDungeonRunForAct(ctx.drizzle, input),
        findDungeonMemberForClaim(ctx.drizzle, input, ctx),
        findDungeonRewardUserCache(ctx.drizzle, ctx.userId),
      ]);
      if (!run || !member || !user || !run.state.memberIds.includes(ctx.userId))
        return errorResponse("You are not in this party.");
      if (member.reward)
        return {
          success: true,
          message: "Rewards already delivered.",
          reward: member.reward,
          ...getDungeonRewardUserUpdate(user, member.reward.rewards, true),
        };
      if (
        run.status !== "COMPLETED" ||
        run.state.clearedFloors.length !== run.content.tiers.flat().length
      )
        return errorResponse("Clear the entire dungeon to collect rewards.");
      const rewards = run.content.rewards;
      const rewardError = dungeonRewardError(rewards);
      if (rewardError) return errorResponse(rewardError);
      // Item/jutsu inserts and village grants cannot share one guarded statement with
      // the receipt. The transaction also serializes cross-run drop history per player.
      const receipt = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await lockDungeonRewardUser(tx, ctx.userId);
          const history = rewards.drops.some((drop) => drop.onlyOnce)
            ? await listDungeonRewardHistory(tx, ctx.userId, run.dungeonId)
            : [];
          const claimedDrops = new Set(
            history.flatMap(({ reward }) => reward?.grantedDrops ?? []),
          );
          const { grantedDrops, ...rolled } = rollDungeonRewards(rewards, claimedDrops);
          const receipt = {
            claimedAt: Date.now(),
            money: rolled.reward_money,
            experience: rolled.reward_exp,
            tokens: rolled.reward_tokens,
            prestige: rolled.reward_prestige,
            items: rolled.reward_items,
            jutsus: rolled.reward_jutsus,
            rewards: rolled,
            grantedDrops,
          };
          const claim = await updateDungeonMemberForClaim(tx, receipt, run, ctx);
          if (claim.rowsAffected === 0) return null;
          // Reward tasks execute serially inside the driver's rotating transaction session.
          const delivered = await updateRewards({
            client: tx as unknown as DrizzleClient,
            user,
            rewards: rolled,
            reason: `Dungeon: ${run.content.name}`,
            inTransaction: true,
            persistQuestData: false,
            pvpBoostApplied: true,
            ...(run.state.pets
              ? {
                  postClaimUserDataPatch: {
                    petExperience: sql`${userData.petExperience}`,
                  },
                }
              : {}),
          });
          if (run.state.pets) {
            const experience =
              Math.max(0, Math.round(rolled.reward_exp ?? 0)) +
              Math.round(rolled.reward_pet_experience ?? 0);
            if (experience) {
              for (const pet of run.state.pets)
                await grantDungeonPetExperience(tx, ctx.userId, [pet.id], experience);
            }
          }
          const deliveredItems = new Set(delivered.items.map(({ id }) => id));
          const deliveredJutsus = new Set(delivered.jutsus.map(({ id }) => id));
          const items = receipt.items.filter((id) => deliveredItems.has(id));
          const jutsus = receipt.jutsus.filter((id) => deliveredJutsus.has(id));
          if (
            items.length !== receipt.items.length ||
            jutsus.length !== receipt.jutsus.length
          ) {
            // Owned jutsu and missing catalog entries are skipped by the reward pipeline.
            // Only delivered direct drops consume eligibility; packages retain their roll identity.
            const skippedDrops = new Set(
              rewards.drops
                .filter((drop) =>
                  drop.type === "jutsu"
                    ? !deliveredJutsus.has(drop.id)
                    : drop.type !== "package" && !deliveredItems.has(drop.id),
                )
                .map(dungeonDropKey),
            );
            receipt.items = items;
            receipt.jutsus = jutsus;
            receipt.rewards.reward_items = items;
            receipt.rewards.reward_jutsus = jutsus;
            receipt.grantedDrops = grantedDrops.filter((key) => !skippedDrops.has(key));
            await updateDungeonRewardReceipt(tx, run.id, ctx.userId, receipt);
          }
          return receipt;
        }),
      );
      return receipt
        ? {
            success: true,
            message: "Completion rewards delivered.",
            reward: receipt,
            ...getDungeonRewardUserUpdate(user, receipt.rewards),
          }
        : errorResponse("Rewards were already claimed. Refresh to view your receipt.");
    }),
});
