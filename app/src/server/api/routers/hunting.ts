import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  actionLog,
  huntingHabitat,
  huntingProgress,
  huntingSession,
  item,
  sectorMap,
  userData,
} from "@/drizzle/schema";
import { huntingAllowance, huntingEligibility } from "@/libs/hunting/contracts";
import { findNearestReachableCoordinate } from "@/libs/sector-map/validation";
import { initiateBattle } from "@/routers/combat";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { canChangeContent } from "@/utils/permissions";
import {
  acceptHuntingContractSchema,
  huntingIdSchema,
  huntingSessionActionSchema,
  saveHuntingHabitatSchema,
} from "@/validators/hunting";

export const huntingRouter = createTRPCRouter({
  getBoard: protectedProcedure.query(async ({ ctx }) => {
    const [user, habitats, session, progress, materials, creatures] = await Promise.all(
      [
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
          columns: {
            occupation: true,
            huntingExperience: true,
            sector: true,
            status: true,
          },
        }),
        ctx.drizzle.query.huntingHabitat.findMany(),
        ctx.drizzle.query.huntingSession.findFirst({
          where: eq(huntingSession.userId, ctx.userId),
        }),
        ctx.drizzle.query.huntingProgress.findMany({
          where: eq(huntingProgress.userId, ctx.userId),
        }),
        ctx.drizzle.query.item.findMany({
          columns: { id: true, name: true, canStack: true, stackSize: true },
          where: eq(item.canBeHunted, true),
        }),
        ctx.drizzle.query.userData.findMany({
          where: eq(userData.isAi, true),
          columns: { userId: true, username: true, level: true },
        }),
      ],
    );
    return {
      user,
      habitats:
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
          : [],
      session,
      progress,
      materials,
      creatures,
      serverTime: new Date(),
    };
  }),
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.drizzle.query.userData.findFirst({
      where: eq(userData.userId, ctx.userId),
      columns: { role: true },
    });
    return user && canChangeContent(user.role)
      ? ctx.drizzle.query.huntingHabitat.findMany()
      : [];
  }),
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
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
          columns: { role: true },
        }),
        aiIds.length
          ? ctx.drizzle.query.userData.findMany({
              where: and(inArray(userData.userId, aiIds), eq(userData.isAi, true)),
              columns: { userId: true },
            })
          : [],
        itemIds.length
          ? ctx.drizzle.query.item.findMany({
              where: and(inArray(item.id, itemIds), eq(item.canBeHunted, true)),
              columns: { id: true },
            })
          : [],
        ctx.drizzle.query.sectorMap.findMany({
          where: and(
            inArray(sectorMap.sector, input.content.sectors),
            eq(sectorMap.status, "PUBLISHED"),
          ),
        }),
        ctx.drizzle.query.huntingHabitat.findMany(),
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
      const inCombat = new Error(
        "Hunters are fighting in this habitat. Wait for those battles to finish before editing.",
      );
      // Content and its audit log must describe the same successful edit.
      try {
        await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            if (input.id) {
              const saved = await tx
                .update(huntingHabitat)
                .set({ content: input.content, updatedAt: new Date() })
                .where(
                  and(
                    eq(huntingHabitat.id, id),
                    sql`NOT EXISTS (SELECT 1 FROM ${huntingSession} WHERE ${huntingSession.habitatId} = ${id} AND ${huntingSession.battleId} IS NOT NULL)`,
                  ),
                );
              if (saved.rowsAffected !== 1) throw inCombat;
            } else
              await tx
                .insert(huntingHabitat)
                .values({ id, content: input.content, updatedAt: new Date() });
            for (const contract of input.content.contracts) {
              // A reduced allowance that is already exhausted must replenish after its cooldown.
              await tx
                .update(huntingProgress)
                .set({
                  cooldownUntil: new Date(Date.now() + contract.cooldownSeconds * 1000),
                  version: sql`${huntingProgress.version} + 1`,
                })
                .where(
                  and(
                    eq(huntingProgress.contractId, contract.id),
                    sql`${huntingProgress.used} >= ${contract.hunts}`,
                    isNull(huntingProgress.cooldownUntil),
                  ),
                );
            }
            await tx.insert(actionLog).values({
              id: nanoid(),
              userId: ctx.userId,
              relatedId: id,
              tableName: "huntingHabitat",
              relatedMsg: "Updated hunting habitat",
              changes: [JSON.stringify(input.content)],
            });
          }),
        );
      } catch (error) {
        if (error === inCombat) return errorResponse(inCombat.message);
        throw error;
      }
      return { success: true, message: "Habitat saved.", id };
    }),
  delete: protectedProcedure.input(huntingIdSchema).mutation(async ({ ctx, input }) => {
    const user = await ctx.drizzle.query.userData.findFirst({
      where: eq(userData.userId, ctx.userId),
      columns: { role: true },
    });
    if (!user || !canChangeContent(user.role))
      return errorResponse("You cannot edit hunting habitats.");
    const removed = await ctx.drizzle
      .delete(huntingHabitat)
      .where(
        and(
          eq(huntingHabitat.id, input.id),
          sql`NOT EXISTS (SELECT 1 FROM ${huntingSession} WHERE ${huntingSession.habitatId} = ${input.id})`,
        ),
      );
    if (!removed.rowsAffected)
      return errorResponse("This habitat has active sessions. Disable it instead.");
    await ctx.drizzle.insert(actionLog).values({
      id: nanoid(),
      userId: ctx.userId,
      relatedId: input.id,
      tableName: "huntingHabitat",
      relatedMsg: "Deleted hunting habitat",
      changes: [],
    });
    return { success: true, message: "Habitat deleted." };
  }),
  accept: protectedProcedure
    .use(ratelimitMiddleware)
    .input(acceptHuntingContractSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, habitat, session, progress, maps] = await Promise.all([
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
        }),
        ctx.drizzle.query.huntingHabitat.findFirst({
          where: eq(huntingHabitat.id, input.habitatId),
        }),
        ctx.drizzle.query.huntingSession.findFirst({
          where: eq(huntingSession.userId, ctx.userId),
        }),
        ctx.drizzle.query.huntingProgress.findFirst({
          where: and(
            eq(huntingProgress.userId, ctx.userId),
            eq(huntingProgress.contractId, input.contractId),
          ),
        }),
        ctx.drizzle.query.sectorMap.findMany({
          where: eq(sectorMap.status, "PUBLISHED"),
        }),
      ]);
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
        return { success: true, message: "Your existing encounter is still assigned." };
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
      const next = {
        id: nanoid(),
        habitatId: habitat.id,
        contractId: contract.id,
        sector,
        readyAt: null,
        battleId: null,
        lastResult: null,
        startedAt: new Date(),
        version: (session?.version ?? -1) + 1,
      };
      // An unused zero-allowance row is harmless if another session wins the following CAS.
      await ctx.drizzle
        .insert(huntingProgress)
        .values({ userId: ctx.userId, contractId: contract.id })
        .onDuplicateKeyUpdate({ set: { contractId: contract.id } });
      try {
        const saved = session
          ? await ctx.drizzle
              .update(huntingSession)
              .set(next)
              .where(
                and(
                  eq(huntingSession.userId, ctx.userId),
                  eq(huntingSession.version, session.version),
                  isNull(huntingSession.battleId),
                ),
              )
          : await ctx.drizzle
              .insert(huntingSession)
              .values({ ...next, userId: ctx.userId });
        if (saved.rowsAffected !== 1)
          return errorResponse("Your hunting session changed. Refresh the board.");
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;
        return errorResponse("You already have an active contract. Refresh the board.");
      }
      return {
        success: true,
        message: `Contract accepted. Travel to sector ${sector}.`,
      };
    }),
  sessionAction: protectedProcedure
    .input(huntingSessionActionSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, session, habitats] = await Promise.all([
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
        }),
        ctx.drizzle.query.huntingSession.findFirst({
          where: eq(huntingSession.userId, ctx.userId),
        }),
        ctx.drizzle.query.huntingHabitat.findMany(),
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
        const saved = await ctx.drizzle.delete(huntingSession).where(guard);
        return saved.rowsAffected === 1
          ? {
              success: true,
              message: "Hunting finished. Your contract allowance is preserved.",
            }
          : errorResponse("Your session changed.");
      }
      const habitat = habitats.find((h) => h.id === session.habitatId);
      const contract = habitat?.content.contracts.find(
        (c) => c.id === session.contractId,
      );
      if (
        !user ||
        user.status !== "AWAKE" ||
        user.isBanned ||
        user.sector !== session.sector ||
        !contract ||
        !contract.enabled ||
        !habitat?.content.enabled ||
        !huntingEligibility(user.occupation, user.huntingExperience, contract)
      )
        return errorResponse(
          "Travel to the assigned sector as an eligible Hunter before preparing.",
        );
      if (session.readyAt)
        return { success: true, message: "Preparation has already started." };
      const saved = await ctx.drizzle
        .update(huntingSession)
        .set({
          readyAt: new Date(Date.now() + contract.preparationSeconds * 1000),
          version: sql`${huntingSession.version} + 1`,
        })
        .where(guard);
      return saved.rowsAffected === 1
        ? { success: true, message: "Preparation started." }
        : errorResponse("Your session changed.");
    }),
  start: protectedProcedure
    .use(ratelimitMiddleware)
    .input(huntingIdSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, session, habitats, progressRows, maps, materials] =
        await Promise.all([
          ctx.drizzle.query.userData.findFirst({
            where: eq(userData.userId, ctx.userId),
          }),
          ctx.drizzle.query.huntingSession.findFirst({
            where: eq(huntingSession.userId, ctx.userId),
          }),
          ctx.drizzle.query.huntingHabitat.findMany(),
          ctx.drizzle.query.huntingProgress.findMany({
            where: eq(huntingProgress.userId, ctx.userId),
          }),
          ctx.drizzle.query.sectorMap.findMany({
            where: eq(sectorMap.status, "PUBLISHED"),
          }),
          ctx.drizzle.query.item.findMany({
            where: eq(item.canBeHunted, true),
            columns: { id: true, name: true, canStack: true, stackSize: true },
          }),
        ]);
      const habitat = habitats.find((h) => h.id === session?.habitatId);
      const contract = habitat?.content.contracts.find(
        (c) => c.id === session?.contractId,
      );
      if (
        !session ||
        session.id !== input.id ||
        session.battleId ||
        !contract ||
        !habitat?.content.enabled ||
        !contract.enabled
      )
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
      if (
        !contract.sectors.includes(session.sector) ||
        !habitat.content.sectors.includes(session.sector) ||
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
      return initiateBattle(
        {
          client: ctx.drizzle,
          userIds: [ctx.userId],
          targetIds: [contract.aiId],
          sector: user.sector,
          hunting: {
            userId: ctx.userId,
            sessionId: session.id,
            sessionVersion: session.version,
            habitatId: habitat.id,
            habitatUpdatedAt: habitat.updatedAt.toISOString(),
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
    }),
});
