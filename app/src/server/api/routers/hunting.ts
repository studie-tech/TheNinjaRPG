import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { huntingHabitat, huntingSession } from "@/drizzle/schema";
import { huntingAllowance, huntingEligibility } from "@/libs/hunting/contracts";
import { findNearestReachableCoordinate } from "@/libs/sector-map/validation";
import { listAiUserIds } from "@/queries/ai";
import {
  deleteHuntingHabitatForDelete,
  deleteHuntingSessionForSessionAction,
  executeSavedForAccept,
  findHuntingHabitatForDelete,
  findHuntingHabitatForReconcileInactiveAllowance,
  findHuntingProgressForAccept,
  findHuntingSessionForUser,
  findUserDataForGetBoard,
  insertActionLogForDelete,
  insertActionLogForSave,
  insertHuntingHabitatForSave,
  insertHuntingProgressForAccept,
  listHuntableItems,
  listHuntingHabitats,
  listHuntingProgressForGetBoard,
  listItemForSave,
  listPublishedHuntingMaps,
  listSectorMapForSave,
  listUserDataForGetBoard,
  selectHuntingSessionForGetSession,
  updateHuntingHabitatForSave,
  updateHuntingProgressForReconcileInactiveAllowance,
  updateHuntingProgressForSave,
  updateHuntingSessionForSessionAction,
} from "@/queries/hunting";
import { findUserById, findUserRoleById } from "@/queries/profile";
import { initiateBattle } from "@/routers/combat";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getBattleUserPatch } from "@/server/utils/socialUserCache";
import { canChangeContent } from "@/utils/permissions";
import {
  acceptHuntingContractSchema,
  huntingIdSchema,
  huntingSessionActionSchema,
  saveHuntingHabitatSchema,
} from "@/validators/hunting";
import { userDeltaResponseSchema } from "@/validators/userCache";

/** Staff-authored definitions and version-guarded, personal hunting sessions. */
export const huntingRouter = createTRPCRouter({
  /**
   * Load only the caller's encounter for travel/dashboard polling in one joined read.
   * Missing accepted terms leave a null contract so legacy sessions can still be finished.
   */
  getSession: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await selectHuntingSessionForGetSession(ctx.drizzle, ctx);
    if (!row) return null;
    const contract = row.session.content?.contracts.find(
      (c) => c.id === row.session.contractId,
    );
    const serverTime = new Date();
    return {
      session: row.session,
      contract: contract ?? null,
      allowance: contract
        ? huntingAllowance(contract, row.progress ?? undefined, serverTime.getTime())
        : null,
      serverTime,
    };
  }),
  /** Load the visible board and session together; filter independent catalogs after parallel reads. */
  getBoard: protectedProcedure.query(async ({ ctx }) => {
    const [user, habitats, session, progress, materials, creatures] = await Promise.all(
      [
        findUserDataForGetBoard(ctx.drizzle, ctx),
        listHuntingHabitats(ctx.drizzle),
        findHuntingSessionForUser(ctx.drizzle, ctx),
        listHuntingProgressForGetBoard(ctx.drizzle, ctx),
        listHuntableItems(ctx.drizzle),
        listUserDataForGetBoard(ctx.drizzle),
      ],
    );
    const visibleHabitats =
      user?.occupation === "HUNTER"
        ? habitats
            .filter((h) => h.content.enabled)
            .map((h) => ({
              ...h,
              content: {
                ...h.content,
                contracts: h.content.contracts.filter((c) => c.enabled),
              },
            }))
        : [];
    // Accepted AI and reward references remain visible after their live contracts change.
    const contracts = [
      ...visibleHabitats.flatMap((h) => h.content.contracts),
      ...(session?.content?.contracts ?? []),
    ];
    const aiIds = new Set(contracts.map((c) => c.aiId));
    const itemIds = new Set(contracts.flatMap((c) => c.rewards.map((r) => r.itemId)));
    return {
      user,
      habitats: visibleHabitats,
      session,
      progress,
      materials: materials.filter((m) => itemIds.has(m.id)),
      creatures: creatures.filter((c) => aiIds.has(c.userId)),
      serverTime: new Date(),
    };
  }),
  /** Return disabled and enabled definitions only to staff with content-edit permission. */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const user = await findUserRoleById(ctx.drizzle, ctx.userId);
    return user && canChangeContent(user.role) ? listHuntingHabitats(ctx.drizzle) : [];
  }),
  /** Validate authored references and locations before publishing rules to future contracts. */
  save: protectedProcedure
    .use(ratelimitMiddleware)
    .input(saveHuntingHabitatSchema)
    .mutation(async ({ ctx, input }) => {
      const aiIds = [...new Set(input.content.contracts.map((c) => c.aiId))];
      const itemIds = [
        ...new Set(
          input.content.contracts.flatMap((c) => c.rewards.map((r) => r.itemId)),
        ),
      ];
      const [user, ais, materials, maps, habitats] = await Promise.all([
        findUserRoleById(ctx.drizzle, ctx.userId),
        aiIds.length ? listAiUserIds(ctx.drizzle, aiIds) : [],
        itemIds.length ? listItemForSave(ctx.drizzle, itemIds) : [],
        listSectorMapForSave(ctx.drizzle, input),
        listHuntingHabitats(ctx.drizzle),
      ]);
      if (!user || !canChangeContent(user.role))
        return errorResponse("You cannot edit hunting habitats.");
      if (ais.length !== aiIds.length || materials.length !== itemIds.length)
        return errorResponse("Choose existing AI creatures and huntable materials.");
      if (
        input.content.sectors.some(
          (s) =>
            !maps.some(
              (m) =>
                m.sector === s &&
                findNearestReachableCoordinate(m.normalizedJson, { x: 0, y: 0 }),
            ),
        )
      )
        return errorResponse("Every habitat sector needs a published, reachable map.");
      if (
        habitats.some(
          (h) =>
            h.id !== input.id &&
            h.content.contracts.some((c) =>
              input.content.contracts.some((next) => next.id === c.id),
            ),
        )
      )
        return errorResponse("A contract ID is already used by another habitat.");
      const id = input.id ?? nanoid();
      const existingIds = new Set(
        habitats.find((h) => h.id === input.id)?.content.contracts.map((c) => c.id),
      );
      // New contracts get server IDs so concurrent habitat saves cannot share progress.
      const content = {
        ...input.content,
        contracts: input.content.contracts.map((c) => ({
          ...c,
          id: existingIds.has(c.id) ? c.id : nanoid(),
        })),
      };
      const missing = new Error("Habitat not found. Refresh the editor.");
      // Rules and affected allowances must commit together: a reduced limit can exhaust
      // progress with no cooldown, and an interleaved save must not apply superseded rules.
      // One guarded UPDATE cannot also reconcile the separate progress rows.
      try {
        await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            if (input.id) {
              const saved = await updateHuntingHabitatForSave(tx, content, id);
              if (saved.rowsAffected !== 1) throw missing;
            } else await insertHuntingHabitatForSave(tx, id, content);
            for (const contract of content.contracts) {
              // A reduced allowance that is already exhausted must replenish after its cooldown.
              await updateHuntingProgressForSave(tx, contract);
            }
          }),
        );
      } catch (error) {
        if (error === missing) return errorResponse(missing.message);
        throw error;
      }
      await insertActionLogForSave(ctx.drizzle, ctx, id, content);
      return { success: true, message: "Habitat saved.", id, content };
    }),
  /** Active sessions retain their habitat; staff can disable it instead of deleting it. */
  delete: protectedProcedure.input(huntingIdSchema).mutation(async ({ ctx, input }) => {
    const user = await findUserRoleById(ctx.drizzle, ctx.userId);
    if (!user || !canChangeContent(user.role))
      return errorResponse("You cannot edit hunting habitats.");
    const removed = await deleteHuntingHabitatForDelete(ctx.drizzle, input);
    if (!removed.rowsAffected) {
      const exists = await findHuntingHabitatForDelete(ctx.drizzle, input);
      return errorResponse(
        exists
          ? "This habitat has active sessions. Disable it instead."
          : "Habitat not found. Refresh the editor.",
      );
    }
    await insertActionLogForDelete(ctx.drizzle, ctx, input);
    return { success: true, message: "Habitat deleted." };
  }),
  /** Capture accepted terms and a reachable sector; atomically reconcile usage when switching. */
  accept: protectedProcedure
    .use(ratelimitMiddleware)
    .input(acceptHuntingContractSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, habitats, session, progress] = await Promise.all([
        findUserById(ctx.drizzle, ctx.userId),
        listHuntingHabitats(ctx.drizzle),
        findHuntingSessionForUser(ctx.drizzle, ctx),
        findHuntingProgressForAccept(ctx.drizzle, ctx, input),
      ]);
      const habitat = habitats.find((h) => h.id === input.habitatId);
      const contract = habitat?.content.contracts.find(
        (c) => c.id === input.contractId,
      );
      if (!user || user.isAi || user.isBanned || user.status !== "AWAKE")
        return errorResponse(
          "You must be awake and out of combat to select a contract.",
        );
      if (
        !contract ||
        !habitat?.content.enabled ||
        !contract.enabled ||
        !huntingEligibility(user.occupation, user.huntingExperience, contract)
      )
        return errorResponse("This contract is unavailable at your hunting rank.");
      const allowance = huntingAllowance(contract, progress);
      if (allowance.cooling || !allowance.remaining)
        return errorResponse("This contract is on cooldown.");
      if ((session?.version ?? null) !== input.version || session?.battleId)
        return errorResponse("Your hunting session changed. Refresh the board.");
      if (session?.contractId === contract.id)
        return {
          success: true,
          userPatch: {},
          message: "Your existing encounter is still assigned.",
        };
      // Maps carry large JSON payloads; load only the contract's sectors after
      // eligibility and session guards pass.
      const maps = await listPublishedHuntingMaps(ctx.drizzle, contract.sectors);
      const locations = contract.sectors.filter(
        (s) =>
          habitat.content.sectors.includes(s) &&
          maps.some(
            (m) =>
              m.sector === s &&
              findNearestReachableCoordinate(m.normalizedJson, { x: 0, y: 0 }),
          ),
      );
      const sector = locations[Math.floor(Math.random() * locations.length)];
      if (sector === undefined)
        return errorResponse(
          "There are no approved reachable locations for this contract.",
        );
      // Retain habitat metadata for the board, but freeze only the selected contract.
      const next = {
        id: nanoid(),
        habitatId: habitat.id,
        contractId: contract.id,
        content: { ...habitat.content, contracts: [contract] },
        sector,
        startedAt: new Date(),
        version: (session?.version ?? -1) + 1,
      };
      // An unused zero-allowance row is harmless if another session wins the following CAS.
      await insertHuntingProgressForAccept(ctx.drizzle, ctx, contract);
      const previousHabitat = habitats.find((h) => h.id === session?.habitatId);
      const previousContract = previousHabitat?.content.contracts.find(
        (c) => c.id === session?.contractId,
      );
      // A save may reconcile the target allowance before admission; accept only
      // the same habitat version that supplied this session's terms.
      const targetHabitatGuard = and(
        eq(huntingHabitat.id, habitat.id),
        eq(huntingHabitat.updatedAt, habitat.updatedAt),
      );
      try {
        // Switching and reconciling the old allowance share one guarded statement.
        const saved = await retryOnDeadlock(() =>
          executeSavedForAccept(
            ctx.drizzle,
            session,
            next,
            previousContract,
            ctx,
            targetHabitatGuard,
            previousHabitat,
          ),
        );
        if (saved.rowsAffected === 0)
          return errorResponse("Your hunting session changed. Refresh the board.");
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;
        return errorResponse("You already have an active contract. Refresh the board.");
      }
      return {
        success: true,
        userPatch: {},
        message: `Contract accepted. Travel to sector ${sector}.`,
      };
    }),
  /** Prepare accepted terms once, or finish the displayed session and reconcile reduced limits. */
  sessionAction: protectedProcedure
    .input(huntingSessionActionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, session] = await Promise.all([
        findUserById(ctx.drizzle, ctx.userId),
        findHuntingSessionForUser(ctx.drizzle, ctx),
      ]);
      if (
        !session ||
        session.id !== input.id ||
        session.version !== input.version ||
        session.battleId
      )
        return errorResponse(
          "Your session changed or is in combat. Refresh the board.",
        );
      const guard = and(
        eq(huntingSession.userId, ctx.userId),
        eq(huntingSession.id, input.id),
        eq(huntingSession.version, input.version),
        isNull(huntingSession.battleId),
      );
      if (input.action === "finish") {
        // A joined UPDATE can switch contracts, but MySQL cannot DELETE this session
        // and UPDATE its allowance in one statement. Separate writes could release it
        // without starting an exhausted allowance's cooldown if reconciliation fails.
        // Keep this transaction confined to finish so both writes commit or retry together.
        const saved = await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            const deleted = await deleteHuntingSessionForSessionAction(tx, guard);
            if (deleted.rowsAffected === 1)
              await reconcileInactiveAllowance(
                tx as unknown as DrizzleClient,
                ctx.userId,
                session.habitatId,
                session.contractId,
              );
            return deleted;
          }),
        );
        return saved.rowsAffected === 1
          ? {
              success: true,
              userPatch: {},
              message: "Hunting finished. Your contract allowance is preserved.",
            }
          : errorResponse("Your session changed.");
      }
      const contract = session.content?.contracts.find(
        (c) => c.id === session.contractId,
      );
      if (
        !user ||
        user.status !== "AWAKE" ||
        user.isBanned ||
        user.sector !== session.sector ||
        !contract ||
        !huntingEligibility(user.occupation, user.huntingExperience, contract)
      )
        return errorResponse(
          "Travel to the assigned sector as an eligible Hunter before preparing.",
        );
      if (session.readyAt)
        return {
          success: true,
          userPatch: {},
          message: "Preparation has already started.",
        };
      const saved = await updateHuntingSessionForSessionAction(
        ctx.drizzle,
        contract,
        guard,
      );
      return saved.rowsAffected === 1
        ? { success: true, userPatch: {}, message: "Preparation started." }
        : errorResponse("Your session changed.");
    }),
  /** Validate accepted terms and preload combat data before guarded encounter admission. */
  start: protectedProcedure
    .use(ratelimitMiddleware)
    .input(huntingIdSchema)
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [user, session, progressRows, materials] = await Promise.all([
        findUserById(ctx.drizzle, ctx.userId),
        findHuntingSessionForUser(ctx.drizzle, ctx),
        listHuntingProgressForGetBoard(ctx.drizzle, ctx),
        listHuntableItems(ctx.drizzle),
      ]);
      const contract = session?.content?.contracts.find(
        (c) => c.id === session?.contractId,
      );
      if (!session || session.id !== input.id || session.battleId || !contract)
        return errorResponse("This hunting session is unavailable. Refresh the board.");
      const progress = progressRows.find((p) => p.contractId === contract.id);
      const allowance = huntingAllowance(contract, progress);
      if (
        !user ||
        user.status !== "AWAKE" ||
        user.isBanned ||
        user.isAi ||
        user.battleId ||
        user.sector !== session.sector ||
        !huntingEligibility(user.occupation, user.huntingExperience, contract)
      )
        return errorResponse(
          "You must be an eligible, awake Hunter in the assigned sector.",
        );
      if (!session.readyAt || session.readyAt.getTime() > Date.now())
        return errorResponse("Finish preparing before starting combat.");
      if (!progress || allowance.cooling || allowance.remaining < 1)
        return errorResponse("This contract is on cooldown.");
      // Maps carry large JSON payloads; load only the assigned sector after
      // eligibility and session guards pass.
      const maps = await listPublishedHuntingMaps(ctx.drizzle, [session.sector]);
      if (
        !contract.sectors.includes(session.sector) ||
        !maps.some(
          (m) =>
            m.sector === session.sector &&
            findNearestReachableCoordinate(m.normalizedJson, { x: 0, y: 0 }),
        )
      )
        return errorResponse(
          "The encounter location is no longer approved. Select another contract.",
        );
      if (contract.rewards.some((r) => !materials.some((m) => m.id === r.itemId)))
        return errorResponse(
          "A contract material is unavailable. Please contact staff.",
        );
      const result = await initiateBattle(
        {
          client: ctx.drizzle,
          userIds: [ctx.userId],
          targetIds: [contract.aiId],
          sector: user.sector,
          hunting: {
            // initiateBattle captures the eligible passive bonus from its preloaded hunter.
            huntingBonusQuantity: 0,
            userId: ctx.userId,
            sessionId: session.id,
            sessionVersion: session.version,
            habitatId: session.habitatId,
            contract,
            used: allowance.used,
            progressVersion: progress.version,
            huntingExperience: user.huntingExperience,
            materialNames: Object.fromEntries(materials.map((m) => [m.id, m.name])),
            materialStacks: Object.fromEntries(
              materials.map((m) => [m.id, m.canStack ? Math.max(1, m.stackSize) : 1]),
            ),
          },
        },
        "HUNTING",
        0,
      );
      return result.success
        ? {
            ...result,
            userPatch: await getBattleUserPatch(
              ctx.drizzle,
              ctx.userId,
              result.requiresUserRefresh,
            ),
          }
        : result;
    }),
});

/**
 * Start a reduced allowance's cooldown without changing its consumed hunts.
 * The caller must release the session on this same transaction client first; failures
 * must roll back both operations. Habitat revisions and active-session guards prevent
 * applying superseded rules or changing another accepted contract's allowance.
 */
const reconcileInactiveAllowance = async (
  client: DrizzleClient,
  userId: string,
  habitatId: string,
  contractId: string,
) => {
  // This read depends on releasing the session: a concurrent save must see the
  // allowance as inactive, or finish before we read its updated terms.
  const habitat = await findHuntingHabitatForReconcileInactiveAllowance(
    client,
    habitatId,
  );
  const contract = habitat?.content.contracts.find((c) => c.id === contractId);
  if (!habitat || !contract) return;
  await updateHuntingProgressForReconcileInactiveAllowance(
    client,
    contract,
    userId,
    habitatId,
    habitat,
  );
};
