import { and, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { FISHING_STARTER_BAIT } from "@/drizzle/constants";
import {
  fishingActivity,
  fishingCatchReceipt,
  fishingCollectionLog,
  fishingHabitat,
  fishingProfile,
  fishingSchoolMark,
  fishingSession,
  item,
  questHistory,
  userData,
  userItem,
} from "@/drizzle/schema";
import {
  FISHING_SPECIES,
  fishingHexDistance,
  getFishingEquipment,
  getFishingLevel,
  getFishingLevelProgress,
  getFishingSpecies,
  getFishingTogetherBonus,
  getMovingSchoolPosition,
  hasFishingCastPositionChanged,
  isFishingEquipmentAvailable,
  resolveFishingAction,
  selectFishingSpecies,
} from "@/libs/fishing";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  type ObjectiveTrackerTaskInput,
} from "@/libs/quest";
import { resolveTerrainSpec } from "@/libs/sector-map/terrains";
import { getNeighborCoordinates, getSectorTile } from "@/libs/sector-map/validation";
import { fetchUser } from "@/routers/profile";
import { fetchUserItems } from "@/server/api/routers/item";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { awardCaughtFish } from "@/server/utils/caughtFishDelivery";
import {
  claimUserSnapshot,
  consumeUserItemAtomically,
} from "@/server/utils/concurrency";
import { fetchPublishedSectorMap } from "@/server/utils/sectorMap";
import { canChangeContent } from "@/utils/permissions";
import {
  fishingActInputSchema,
  fishingCastInputSchema,
  fishingHabitatDeleteInputSchema,
  fishingHabitatInputSchema,
  fishingHabitatSectorInputSchema,
  fishingMarkSchoolInputSchema,
  fishingPendingCatchClaimInputSchema,
  fishingResolveInputSchema,
  fishingTrackInputSchema,
} from "@/validators/fishing";

const terminalStates = new Set(["FAILED", "RESOLVED"]);
const FISHING_QUEST_PROGRESS_ATTEMPTS = 3;

/**
 * Fishing writes progression independently from quest JSON. Recompute from the
 * same user snapshot and claim it with CAS so simultaneous casts/catches cannot
 * erase each other's objective counters.
 */
const emitFishingQuestProgress = async (
  client: Parameters<typeof fetchUser>[0],
  userId: string,
  tasks: ObjectiveTrackerTaskInput[],
) => {
  for (let attempt = 0; attempt < FISHING_QUEST_PROGRESS_ATTEMPTS; attempt++) {
    const [user, questState] = await Promise.all([
      fetchUser(client, userId),
      client.query.userData.findFirst({
        where: eq(userData.userId, userId),
        columns: { userId: true, questData: true, updatedAt: true },
        with: {
          userQuests: {
            where: or(
              and(isNull(questHistory.endAt), eq(questHistory.completed, 0)),
              eq(questHistory.questType, "achievement"),
            ),
            with: { quest: true },
          },
          completedQuests: {
            columns: { id: true, questId: true, completed: true },
            where: gte(questHistory.completed, 1),
          },
        },
      }),
    ]);
    if (!questState) return false;
    const trackerUser = {
      ...user,
      questData: questState.questData,
      userQuests: questState.userQuests.filter((entry) => entry.quest),
      completedQuests: questState.completedQuests,
    } as unknown as Parameters<typeof getNewTrackers>[0];
    const relevant = new Set(tasks.map((task) => task.task));
    const hasOpenObjective = questState.userQuests.some((entry) =>
      entry.quest?.content.objectives.some((objective) => {
        if (!relevant.has(objective.task)) return false;
        const goal = questState.questData
          ?.find((tracker) => tracker.id === entry.questId)
          ?.goals.find((candidate) => candidate.id === objective.id);
        return !goal?.done;
      }),
    );
    if (!hasOpenObjective) return true;
    const { trackers } = getNewTrackers(trackerUser, tasks);
    const claim = await claimUserSnapshot({
      client,
      userId,
      updatedAt: questState.updatedAt,
      set: {
        questData: filterQuestTrackersForDbPersist(trackers, trackerUser),
      },
    });
    if (claim.success) return true;
  }
  return false;
};

export const fishingRouter = createTRPCRouter({
  markSchool: protectedProcedure
    .input(fishingMarkSchoolInputSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.status !== "AWAKE" || user.battleId)
        return errorResponse("You must be awake and out of combat to mark a school.");
      const habitat = await ctx.drizzle.query.fishingHabitat.findFirst({
        where: and(
          eq(fishingHabitat.id, input.habitatId),
          eq(fishingHabitat.sector, user.sector),
          eq(fishingHabitat.active, true),
        ),
      });
      if (!habitat) return errorResponse("That school is no longer available.");
      if (
        !(await validateHabitatWater(ctx.drizzle, habitat, {
          x: user.longitude,
          y: user.latitude,
        }))
      )
        return errorResponse("That school is no longer within your casting range.");
      await ctx.drizzle
        .insert(fishingProfile)
        .values({ userId: ctx.userId })
        .onDuplicateKeyUpdate({ set: { userId: sql`${fishingProfile.userId}` } });
      const rateLimit = await ctx.drizzle
        .update(fishingProfile)
        .set({ lastSchoolMarkedAt: now, updatedAt: now })
        .where(
          and(
            eq(fishingProfile.userId, ctx.userId),
            sql`${fishingProfile.lastSchoolMarkedAt} IS NULL OR ${fishingProfile.lastSchoolMarkedAt} <= DATE_SUB(NOW(), INTERVAL 30 SECOND)`,
          ),
        );
      if (Number(rateLimit.rowsAffected ?? 0) !== 1)
        return errorResponse("Wait before marking another school.");
      await ctx.drizzle.insert(fishingSchoolMark).values({
        id: nanoid(),
        userId: ctx.userId,
        sector: user.sector,
        habitatId: habitat.id,
        markedAt: now,
      });
      return { success: true, message: "School marked for nearby anglers." };
    }),
  getHabitats: protectedProcedure
    .input(fishingHabitatSectorInputSchema)
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.sector !== input.sector) return [];
      const habitats = await ctx.drizzle.query.fishingHabitat.findMany({
        where: and(
          eq(fishingHabitat.sector, input.sector),
          eq(fishingHabitat.active, true),
        ),
      });
      return filterReachableHabitats(ctx.drizzle, habitats, user);
    }),
  listHabitats: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!canChangeContent(user.role)) return [];
    return await ctx.drizzle.query.fishingHabitat.findMany({
      orderBy: (table, { asc }) => [asc(table.sector), asc(table.name)],
    });
  }),
  saveHabitat: protectedProcedure
    .input(fishingHabitatInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (input.speciesIds.some((id) => !getFishingSpecies(id)))
        return errorResponse("Habitats may only reference configured fishing species.");
      const valid = await validateHabitatWater(ctx.drizzle, input);
      if (!valid)
        return errorResponse(
          "Habitats must be placed on water with a reachable bank in casting range.",
        );
      const id = input.id ?? nanoid();
      await ctx.drizzle
        .insert(fishingHabitat)
        .values({ ...input, id, updatedAt: new Date() })
        .onDuplicateKeyUpdate({
          set: {
            name: input.name,
            sector: input.sector,
            tileX: input.tileX,
            tileY: input.tileY,
            radius: input.radius,
            speciesIds: input.speciesIds,
            active: input.active,
            updatedAt: new Date(),
          },
        });
      return { success: true, message: "Fishing habitat saved.", id };
    }),
  deleteHabitat: protectedProcedure
    .input(fishingHabitatDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      const deleted = await ctx.drizzle
        .delete(fishingHabitat)
        .where(eq(fishingHabitat.id, input.id));
      if (Number(deleted.rowsAffected ?? 0) !== 1)
        return errorResponse("That fishing habitat no longer exists.");
      return { success: true, message: "Fishing habitat deleted." };
    }),
  getState: protectedProcedure.query(async ({ ctx }) =>
    buildFishingState(ctx.drizzle, ctx.userId),
  ),

  inspectCollection: protectedProcedure.mutation(async ({ ctx }) => {
    await emitFishingQuestProgress(ctx.drizzle, ctx.userId, [
      { task: "fishing_collection_viewed", increment: 1 },
    ]);
    return { success: true, message: "Fishing collection reviewed." };
  }),

  claimTutorialSupplies: protectedProcedure.mutation(async ({ ctx }) => {
    const now = new Date();
    await ctx.drizzle
      .insert(fishingProfile)
      .values({ userId: ctx.userId })
      .onDuplicateKeyUpdate({ set: { userId: sql`${fishingProfile.userId}` } });
    const claimed = await ctx.drizzle.transaction(async (tx) => {
      const claim = await tx
        .update(fishingProfile)
        .set({ tutorialClaimedAt: now, updatedAt: now })
        .where(
          and(
            eq(fishingProfile.userId, ctx.userId),
            sql`${fishingProfile.tutorialClaimedAt} IS NULL`,
          ),
        );
      if (Number(claim.rowsAffected ?? 0) !== 1) return false;
      await tx.insert(userItem).values([
        {
          id: nanoid(),
          userId: ctx.userId,
          itemId: "fishing-bamboo-rod",
          quantity: 1,
          equipped: "NONE",
        },
        {
          id: nanoid(),
          userId: ctx.userId,
          itemId: "fishing-starter-grub",
          quantity: FISHING_STARTER_BAIT,
          equipped: "NONE",
        },
      ]);
      return true;
    });
    if (!claimed)
      return errorResponse("Your starter fishing equipment has already been claimed.");
    await emitFishingQuestProgress(ctx.drizzle, ctx.userId, [
      { task: "fishing_starter_claimed", increment: 1 },
    ]);
    return { success: true, message: "You received a basic rod and starter bait." };
  }),

  recoverStarterSupplies: protectedProcedure.mutation(async ({ ctx }) => {
    const now = new Date();
    const recovery = await ctx.drizzle.transaction(async (tx) => {
      const claim = await tx
        .update(fishingProfile)
        .set({ starterRecoveryClaimedAt: now, updatedAt: now })
        .where(
          and(
            eq(fishingProfile.userId, ctx.userId),
            sql`${fishingProfile.tutorialClaimedAt} IS NOT NULL`,
            sql`${fishingProfile.starterRecoveryClaimedAt} IS NULL`,
          ),
        );
      if (Number(claim.rowsAffected ?? 0) !== 1) return false;
      const hasRod = await tx.query.userItem.findFirst({
        where: and(
          eq(userItem.userId, ctx.userId),
          eq(userItem.itemId, "fishing-bamboo-rod"),
          gt(userItem.quantity, 0),
        ),
        columns: { id: true },
      });
      const starterBait = await tx.query.userItem.findFirst({
        where: and(
          eq(userItem.userId, ctx.userId),
          eq(userItem.itemId, "fishing-starter-grub"),
          gt(userItem.quantity, 0),
        ),
      });
      if (!hasRod)
        await tx.insert(userItem).values({
          id: nanoid(),
          userId: ctx.userId,
          itemId: "fishing-bamboo-rod",
          quantity: 1,
          equipped: "NONE",
        });
      if (starterBait)
        await tx
          .insert(userItem)
          .values({
            ...starterBait,
            quantity: FISHING_STARTER_BAIT,
            updatedAt: now,
          })
          .onDuplicateKeyUpdate({
            set: {
              quantity: sql`GREATEST(${userItem.quantity}, ${FISHING_STARTER_BAIT})`,
              updatedAt: now,
            },
          });
      else
        await tx.insert(userItem).values({
          id: nanoid(),
          userId: ctx.userId,
          itemId: "fishing-starter-grub",
          quantity: FISHING_STARTER_BAIT,
          equipped: "NONE",
        });
      return true;
    });
    if (!recovery)
      return errorResponse("Your one-time starter-kit recovery is not available.");
    return {
      success: true,
      message: "Your basic rod was restored and your bait was topped up.",
    };
  }),

  trackSpecies: protectedProcedure
    .input(fishingTrackInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.speciesId && !getFishingSpecies(input.speciesId))
        return errorResponse("Unknown fish species.");
      await ctx.drizzle
        .insert(fishingProfile)
        .values({ userId: ctx.userId })
        .onDuplicateKeyUpdate({
          set: { trackedSpeciesId: input.speciesId, updatedAt: new Date() },
        });
      await ctx.drizzle
        .update(fishingProfile)
        .set({ trackedSpeciesId: input.speciesId, updatedAt: new Date() })
        .where(eq(fishingProfile.userId, ctx.userId));
      await emitFishingQuestProgress(ctx.drizzle, ctx.userId, [
        { task: "fishing_collection_viewed", increment: 1 },
        ...(input.speciesId
          ? ([{ task: "fishing_species_tracked", increment: 1 }] as const)
          : []),
      ]);
      return {
        success: true,
        message: input.speciesId ? "Fish tracking updated." : "Fish tracking cleared.",
      };
    }),

  cast: protectedProcedure
    .input(fishingCastInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, profile, latest, habitats, userItems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.fishingProfile.findFirst({
          where: eq(fishingProfile.userId, ctx.userId),
        }),
        ctx.drizzle.query.fishingSession.findFirst({
          where: eq(fishingSession.userId, ctx.userId),
          orderBy: (table, { desc }) => [desc(table.startedAt)],
        }),
        ctx.drizzle.query.fishingHabitat.findMany({
          where: and(
            eq(fishingHabitat.sector, input.sector),
            eq(fishingHabitat.active, true),
          ),
        }),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      if (user.status !== "AWAKE" || user.battleId)
        return errorResponse("You must be awake and out of combat to fish.");
      if (user.sector !== input.sector)
        return errorResponse("Travel to that sector before casting.");
      if (!profile?.tutorialClaimedAt)
        return errorResponse("Start the fishing tutorial before casting.");
      const rod = userItems.find(
        (entry) =>
          entry.id === input.rodUserItemId &&
          isFishingEquipmentAvailable(entry) &&
          getFishingEquipment(entry.itemId)?.kind === "ROD",
      );
      const bait = userItems.find(
        (entry) =>
          entry.id === input.baitUserItemId &&
          isFishingEquipmentAvailable(entry) &&
          getFishingEquipment(entry.itemId)?.kind === "BAIT",
      );
      const tackle = input.tackleUserItemId
        ? userItems.find(
            (entry) =>
              entry.id === input.tackleUserItemId &&
              isFishingEquipmentAvailable(entry) &&
              getFishingEquipment(entry.itemId)?.kind === "TACKLE",
          )
        : undefined;
      if (!rod) return errorResponse("Select an owned fishing rod before casting.");
      if (!bait) return errorResponse("Select bait before casting.");
      if (input.tackleUserItemId && !tackle)
        return errorResponse("That fishing tackle is no longer available.");
      if (latest && !terminalStates.has(latest.state) && latest.expiresAt > new Date())
        return errorResponse("Resolve or let your current fishing attempt end first.");
      if (
        latest &&
        !terminalStates.has(latest.state) &&
        latest.expiresAt <= new Date()
      ) {
        const interruptedAt = new Date();
        await Promise.all([
          ctx.drizzle
            .update(fishingSession)
            .set({ state: "FAILED", resolvedAt: interruptedAt })
            .where(
              and(
                eq(fishingSession.id, latest.id),
                eq(fishingSession.version, latest.version),
              ),
            ),
          ctx.drizzle
            .update(fishingProfile)
            .set({ activeSessionId: null, updatedAt: interruptedAt })
            .where(
              and(
                eq(fishingProfile.userId, ctx.userId),
                eq(fishingProfile.activeSessionId, latest.id),
              ),
            ),
          ctx.drizzle
            .delete(fishingActivity)
            .where(
              and(
                eq(fishingActivity.userId, ctx.userId),
                eq(fishingActivity.sessionId, latest.id),
              ),
            ),
        ]);
      }
      const level = getFishingLevel(user.fishingExperience);
      const validHabitats = await filterReachableHabitats(ctx.drizzle, habitats, user);
      const habitatSpecies = new Set(
        validHabitats.flatMap((habitat) => habitat.speciesIds),
      );
      const eligible = FISHING_SPECIES.filter(
        (fish) => fish.minLevel <= level && habitatSpecies.has(fish.id),
      );
      if (eligible.length === 0)
        return errorResponse("There is no active fishing habitat in this sector.");
      const fish = selectFishingSpecies(
        eligible,
        profile?.trackedSpeciesId,
        `${ctx.userId}:${input.sector}:${Math.floor(Date.now() / 60000)}`,
      );
      if (!fish) return errorResponse("No fish are currently available here.");
      const now = new Date();
      const participantCount = await getEligibleFishingParticipantCount(
        ctx.drizzle,
        input.sector,
        now,
        ctx.userId,
      );
      const socialBonusPercent = getFishingTogetherBonus(participantCount);
      const selectedEquipment = [rod, bait, tackle]
        .filter((entry): entry is NonNullable<typeof entry> => !!entry)
        .map((entry) => getFishingEquipment(entry.itemId))
        .filter((entry): entry is NonNullable<typeof entry> => !!entry);
      const equipmentAttractionBonus = selectedEquipment.reduce(
        (total, entry) => total + entry.attractionBonus,
        0,
      );
      const equipmentControlBonus = selectedEquipment.reduce(
        (total, entry) => total + entry.controlBonus,
        0,
      );
      const equipmentExperienceBonus = selectedEquipment.reduce(
        (total, entry) => total + entry.experienceBonus,
        0,
      );
      const session = {
        id: nanoid(),
        userId: ctx.userId,
        speciesId: fish.id,
        sector: input.sector,
        castLongitude: user.longitude,
        castLatitude: user.latitude,
        state: "ATTRACT" as const,
        socialBonusPercent,
        socialParticipantCount: participantCount,
        equipmentAttractionBonus,
        equipmentControlBonus,
        equipmentExperienceBonus,
        startedAt: now,
        actionAt: now,
        expiresAt: new Date(now.getTime() + 45_000),
      };
      // The profile lock and the selected bait-stack CAS commit together. Parallel
      // tabs can neither start two sessions nor consume bait without a session.
      const accepted = await ctx.drizzle.transaction(async (tx) => {
        await tx
          .insert(fishingProfile)
          .values({ userId: ctx.userId })
          .onDuplicateKeyUpdate({ set: { userId: sql`${fishingProfile.userId}` } });
        const lock = await tx
          .update(fishingProfile)
          .set({ activeSessionId: session.id, updatedAt: now })
          .where(
            and(
              eq(fishingProfile.userId, ctx.userId),
              isNull(fishingProfile.activeSessionId),
            ),
          );
        if (Number(lock.rowsAffected ?? 0) !== 1) return false;
        const consumed = await consumeUserItemAtomically({
          client: tx,
          userId: ctx.userId,
          userItemId: bait.id,
          expectedQuantity: bait.quantity,
        });
        if (!consumed) return false;
        await tx.insert(fishingSession).values(session);
        await tx
          .insert(fishingActivity)
          .values({
            userId: ctx.userId,
            sessionId: session.id,
            sector: input.sector,
            interactedAt: now,
          })
          .onDuplicateKeyUpdate({
            set: { sessionId: session.id, sector: input.sector, interactedAt: now },
          });
        return true;
      });
      if (!accepted)
        return errorResponse(
          "Another fishing attempt is active or your bait changed; refresh and try again.",
        );
      await emitFishingQuestProgress(ctx.drizzle, ctx.userId, [
        { task: "fishing_casts", increment: 1 },
      ]);
      return {
        success: true,
        message: "Cast accepted. Use gentle lure movement to attract a bite.",
        session: { ...session, version: 1, tension: 20, landingProgress: 0 },
      };
    }),

  act: protectedProcedure
    .input(fishingActInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, session] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.fishingSession.findFirst({
          where: and(
            eq(fishingSession.id, input.sessionId),
            eq(fishingSession.userId, ctx.userId),
          ),
        }),
      ]);
      if (!session) return errorResponse("Fishing attempt not found.");
      const now = new Date();
      if (
        user.status !== "AWAKE" ||
        user.battleId ||
        terminalStates.has(session.state) ||
        session.expiresAt <= now ||
        hasFishingCastPositionChanged(session, user)
      ) {
        await interruptFishingSession(ctx.drizzle, ctx.userId, session, now);
        return errorResponse("This fishing attempt was interrupted.");
      }
      if (session.version !== input.version)
        return errorResponse(
          "That fishing action is out of date. Refresh the encounter.",
        );
      if (now.getTime() - session.actionAt.getTime() < 800)
        return errorResponse("Take a moment to read the fish before your next action.");
      const fish = getFishingSpecies(session.speciesId);
      if (!fish)
        return errorResponse("Fishing content changed; this attempt cannot continue.");
      const result = resolveFishingAction({
        behavior: fish.behavior,
        state: session.state,
        tension: session.tension,
        landingProgress: session.landingProgress,
        action: input.action,
        socialBonusPercent: session.socialBonusPercent,
        attractionBonus: session.equipmentAttractionBonus,
        controlBonus: session.equipmentControlBonus,
        attractionRoll:
          Math.abs(hash(`${session.id}:${session.actionAt.getTime()}`)) % 100,
      });
      if (!result)
        return errorResponse("That action does not fit the current fishing cue.");
      const update = await ctx.drizzle
        .update(fishingSession)
        .set({
          ...result,
          version: sql`${fishingSession.version} + 1`,
          actionAt: now,
          resolvedAt: result.state === "FAILED" ? now : undefined,
        })
        .where(
          and(
            eq(fishingSession.id, session.id),
            eq(fishingSession.version, input.version),
          ),
        );
      if (Number(update.rowsAffected ?? 0) !== 1)
        return errorResponse(
          "Another action updated this encounter. Refresh and continue.",
        );
      await ctx.drizzle
        .update(fishingActivity)
        .set({ interactedAt: now })
        .where(
          and(
            eq(fishingActivity.userId, ctx.userId),
            eq(fishingActivity.sessionId, session.id),
          ),
        );
      if (result.state === "FAILED")
        await clearFishingActivity(ctx.drizzle, ctx.userId, session.id, now);
      return {
        success: true,
        message:
          result.state === "LANDED"
            ? "The fish is landed! Keep it or release it."
            : result.state === "FAILED"
              ? "The fish escaped."
              : result.state === "ATTRACT"
                ? "The fish is still testing the lure. Keep the presentation steady."
                : "Good control. Watch the text cue and continue.",
        state: result.state,
        version: input.version + 1,
        tension: result.tension,
        landingProgress: result.landingProgress,
      };
    }),

  resolve: protectedProcedure
    .input(fishingResolveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.drizzle.query.fishingSession.findFirst({
        where: and(
          eq(fishingSession.id, input.sessionId),
          eq(fishingSession.userId, ctx.userId),
        ),
      });
      if (!session || session.state !== "LANDED" || session.version !== input.version)
        return errorResponse("That catch is no longer ready to resolve.");
      const fish = getFishingSpecies(session.speciesId);
      if (!fish)
        return errorResponse("Fishing content changed; this catch cannot be resolved.");
      const [user, itemInfo, userItems, existingCollection] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        input.keep
          ? ctx.drizzle.query.item.findFirst({ where: eq(item.id, fish.itemId) })
          : Promise.resolve(null),
        input.keep ? fetchUserItems(ctx.drizzle, ctx.userId) : Promise.resolve([]),
        ctx.drizzle.query.fishingCollectionLog.findFirst({
          where: and(
            eq(fishingCollectionLog.userId, ctx.userId),
            eq(fishingCollectionLog.speciesId, fish.id),
          ),
        }),
      ]);
      if (hasFishingCastPositionChanged(session, user)) {
        await interruptFishingSession(ctx.drizzle, ctx.userId, session, new Date());
        return errorResponse("This fishing attempt was interrupted by movement.");
      }
      if (input.keep && !itemInfo)
        return errorResponse(
          "Fishing reward content is unavailable; please contact support.",
        );
      const now = new Date();
      const size = 20 + (Math.abs(hash(`${session.id}:size`)) % 81);
      const quality = 1 + (Math.abs(hash(`${session.id}:quality`)) % 5);
      const experience = Math.floor(
        fish.experience *
          (1 + (session.socialBonusPercent + session.equipmentExperienceBonus) / 100),
      );
      const settled = await ctx.drizzle.transaction(async (tx) => {
        // This is intentionally a short transaction: session CAS, progression and receipt
        // form one irreversible delivery unit. A retry sees the terminal session and cannot
        // grant XP or collection credit a second time.
        const claim = await tx
          .update(fishingSession)
          .set({
            state: "RESOLVED",
            resolvedAt: now,
            version: sql`${fishingSession.version} + 1`,
          })
          .where(
            and(
              eq(fishingSession.id, session.id),
              eq(fishingSession.version, input.version),
              eq(fishingSession.state, "LANDED"),
            ),
          );
        if (Number(claim.rowsAffected ?? 0) !== 1) return false;
        const delivery =
          input.keep && itemInfo
            ? await awardCaughtFish({
                client: tx,
                user,
                userId: ctx.userId,
                itemInfo,
                userItems,
              })
            : "DELIVERED";
        await tx.insert(fishingCatchReceipt).values({
          sessionId: session.id,
          userId: ctx.userId,
          speciesId: fish.id,
          itemId: input.keep ? fish.itemId : null,
          keep: input.keep,
          experience,
          deliveredAt: delivery === "DELIVERED" ? now : null,
        });
        await tx
          .update(userData)
          .set({
            fishingExperience: sql`${userData.fishingExperience} + ${experience}`,
          })
          .where(eq(userData.userId, ctx.userId));
        await tx
          .insert(fishingCollectionLog)
          .values({
            userId: ctx.userId,
            speciesId: fish.id,
            caughtCount: 1,
            firstCaughtAt: now,
            largestSize: size,
            bestQuality: quality,
          })
          .onDuplicateKeyUpdate({
            set: {
              caughtCount: sql`${fishingCollectionLog.caughtCount} + 1`,
              largestSize: sql`GREATEST(${fishingCollectionLog.largestSize}, ${size})`,
              bestQuality: sql`GREATEST(${fishingCollectionLog.bestQuality}, ${quality})`,
            },
          });
        await tx
          .update(fishingProfile)
          .set({ activeSessionId: null, updatedAt: now })
          .where(
            and(
              eq(fishingProfile.userId, ctx.userId),
              eq(fishingProfile.activeSessionId, session.id),
            ),
          );
        await tx
          .delete(fishingActivity)
          .where(
            and(
              eq(fishingActivity.userId, ctx.userId),
              eq(fishingActivity.sessionId, session.id),
            ),
          );
        return delivery;
      });
      if (!settled) return errorResponse("This catch was already resolved.");
      await emitFishingQuestProgress(ctx.drizzle, ctx.userId, [
        { task: "fishing_catches", increment: 1 },
      ]);
      return {
        success: true,
        message: input.keep
          ? settled === "DELIVERED"
            ? `Kept ${fish.name}.`
            : `${fish.name} is waiting to be claimed after you make inventory space.`
          : `Released ${fish.name}.`,
        fishingExperienceDelta: experience,
        speciesId: fish.id,
        isFirstDiscovery: !existingCollection,
        size,
        quality,
        pendingInventoryClaim: settled !== "DELIVERED",
      };
    }),

  claimPendingCatch: protectedProcedure
    .input(fishingPendingCatchClaimInputSchema)
    .mutation(async ({ ctx, input }) => {
      const receipt = await ctx.drizzle.query.fishingCatchReceipt.findFirst({
        where: and(
          eq(fishingCatchReceipt.sessionId, input.sessionId),
          eq(fishingCatchReceipt.userId, ctx.userId),
          eq(fishingCatchReceipt.keep, true),
          sql`${fishingCatchReceipt.deliveredAt} IS NULL`,
        ),
      });
      if (!receipt?.itemId)
        return errorResponse("That pending catch is no longer available.");
      const [user, itemInfo, userItems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.item.findFirst({ where: eq(item.id, receipt.itemId) }),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      if (!itemInfo)
        return errorResponse(
          "Fishing reward content is unavailable; please contact support.",
        );
      let result: "DELIVERED" | "FULL" | "CHANGED";
      try {
        result = await ctx.drizzle.transaction(async (tx) => {
          // Claim first; an inventory-full path throws, rolling this claim and every
          // mutation back. A losing concurrent request therefore awards nothing.
          const claimed = await tx
            .update(fishingCatchReceipt)
            .set({ deliveredAt: new Date() })
            .where(
              and(
                eq(fishingCatchReceipt.sessionId, receipt.sessionId),
                eq(fishingCatchReceipt.userId, ctx.userId),
                sql`${fishingCatchReceipt.deliveredAt} IS NULL`,
              ),
            );
          if (Number(claimed.rowsAffected ?? 0) !== 1) return "CHANGED" as const;
          const delivery = await awardCaughtFish({
            client: tx,
            user,
            userId: ctx.userId,
            itemInfo,
            userItems,
          });
          if (delivery !== "DELIVERED") throw new Error(delivery);
          return "DELIVERED" as const;
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "FULL" || error.message === "CHANGED")
        )
          result = error.message;
        else throw error;
      }
      if (result !== "DELIVERED")
        return errorResponse(
          result === "FULL"
            ? "Inventory is still full. Make space and try again."
            : "Your inventory changed; refresh and try again.",
        );
      return {
        success: true,
        message: `Claimed ${getFishingSpecies(receipt.speciesId)?.name ?? "your fish"}.`,
      };
    }),
});

const buildFishingState = async (
  client: Parameters<typeof fetchUser>[0],
  userId: string,
) => {
  const [user, profile, collection, latest, pendingCatches, userItems] =
    await Promise.all([
      fetchUser(client, userId),
      client.query.fishingProfile.findFirst({
        where: eq(fishingProfile.userId, userId),
      }),
      client.query.fishingCollectionLog.findMany({
        where: eq(fishingCollectionLog.userId, userId),
      }),
      client.query.fishingSession.findFirst({
        where: eq(fishingSession.userId, userId),
        orderBy: (table, { desc }) => [desc(table.startedAt)],
      }),
      client.query.fishingCatchReceipt.findMany({
        where: and(
          eq(fishingCatchReceipt.userId, userId),
          eq(fishingCatchReceipt.keep, true),
          sql`${fishingCatchReceipt.deliveredAt} IS NULL`,
        ),
      }),
      fetchUserItems(client, userId),
    ]);
  const progress = getFishingLevelProgress(user.fishingExperience);
  const activeSession =
    latest && !terminalStates.has(latest.state) && latest.expiresAt > new Date()
      ? latest
      : null;
  const now = new Date();
  const [participantCount, recentMarks, habitats] = await Promise.all([
    getEligibleFishingParticipantCount(client, user.sector, now),
    client.query.fishingSchoolMark.findMany({
      where: and(
        eq(fishingSchoolMark.sector, user.sector),
        gt(fishingSchoolMark.markedAt, new Date(now.getTime() - 120_000)),
      ),
      orderBy: (table, { desc }) => [desc(table.markedAt)],
      limit: 10,
    }),
    client.query.fishingHabitat.findMany({
      where: and(
        eq(fishingHabitat.sector, user.sector),
        eq(fishingHabitat.active, true),
      ),
    }),
  ]);
  const reachableHabitats = await filterReachableHabitats(client, habitats, user);
  const reachableHabitatIds = new Set(reachableHabitats.map((habitat) => habitat.id));
  const schools = await Promise.all(
    reachableHabitats.map((habitat) => getSchoolState(client, habitat, now)),
  );
  return {
    fishingExperience: user.fishingExperience,
    fishingLevel: progress.level,
    expForCurrentLevel: progress.expForCurrentLevel,
    expForNextLevel: progress.expForNextLevel,
    equipment: userItems.flatMap((entry) => {
      const equipment = getFishingEquipment(entry.itemId);
      return equipment && isFishingEquipmentAvailable(entry)
        ? [
            {
              userItemId: entry.id,
              itemId: entry.itemId,
              name: equipment.name,
              kind: equipment.kind,
              quantity: entry.quantity,
              attractionBonus: equipment.attractionBonus,
              controlBonus: equipment.controlBonus,
              experienceBonus: equipment.experienceBonus,
            },
          ]
        : [];
    }),
    trackedSpeciesId: profile?.trackedSpeciesId ?? null,
    tutorialClaimed: !!profile?.tutorialClaimedAt,
    starterRecoveryClaimed: !!profile?.starterRecoveryClaimedAt,
    collection,
    pendingCatches: pendingCatches
      .filter((receipt) => !!receipt.itemId)
      .map((receipt) => ({
        sessionId: receipt.sessionId,
        speciesId: receipt.speciesId,
        itemId: receipt.itemId as string,
      })),
    activeSession,
    participantCount,
    socialBonusPercent: getFishingTogetherBonus(participantCount),
    recentMarks: recentMarks
      .filter((mark) => reachableHabitatIds.has(mark.habitatId))
      .map((mark) => ({ habitatId: mark.habitatId, markedAt: mark.markedAt })),
    schools: schools.filter(
      (school): school is NonNullable<typeof school> => school !== null,
    ),
  };
};

const getEligibleFishingParticipantCount = async (
  client: Parameters<typeof fetchUser>[0],
  sector: number,
  now: Date,
  includeUserId?: string,
) => {
  const active = await client
    .select({ userId: fishingActivity.userId })
    .from(fishingActivity)
    .innerJoin(userData, eq(userData.userId, fishingActivity.userId))
    .innerJoin(fishingSession, eq(fishingSession.id, fishingActivity.sessionId))
    .where(
      and(
        eq(fishingActivity.sector, sector),
        gt(fishingActivity.interactedAt, new Date(now.getTime() - 60_000)),
        eq(userData.sector, sector),
        eq(userData.status, "AWAKE"),
        isNull(userData.battleId),
        gt(fishingSession.expiresAt, now),
        sql`${fishingSession.state} IN ('ATTRACT', 'HOOK', 'FIGHT')`,
      ),
    );
  const participantIds = new Set(active.map((entry) => entry.userId));
  if (includeUserId) participantIds.add(includeUserId);
  return Math.max(1, participantIds.size);
};

const clearFishingActivity = async (
  client: Parameters<typeof fetchUser>[0],
  userId: string,
  sessionId: string,
  now: Date,
) => {
  await client
    .update(fishingProfile)
    .set({ activeSessionId: null, updatedAt: now })
    .where(
      and(
        eq(fishingProfile.userId, userId),
        eq(fishingProfile.activeSessionId, sessionId),
      ),
    );
  await client
    .delete(fishingActivity)
    .where(
      and(eq(fishingActivity.userId, userId), eq(fishingActivity.sessionId, sessionId)),
    );
};

const interruptFishingSession = async (
  client: Parameters<typeof fetchUser>[0],
  userId: string,
  session: typeof fishingSession.$inferSelect,
  now: Date,
) => {
  await client
    .update(fishingSession)
    .set({ state: "FAILED", resolvedAt: now })
    .where(
      and(
        eq(fishingSession.id, session.id),
        eq(fishingSession.version, session.version),
      ),
    );
  await clearFishingActivity(client, userId, session.id, now);
};

const filterReachableHabitats = async (
  client: Parameters<typeof fetchUser>[0],
  habitats: (typeof fishingHabitat.$inferSelect)[],
  player: { longitude: number; latitude: number },
) => {
  const valid = await Promise.all(
    habitats.map(async (habitat) =>
      (await validateHabitatWater(client, habitat, {
        x: player.longitude,
        y: player.latitude,
      }))
        ? habitat
        : null,
    ),
  );
  return valid.filter(
    (habitat): habitat is typeof fishingHabitat.$inferSelect => habitat !== null,
  );
};

const getSchoolState = async (
  client: Parameters<typeof fetchUser>[0],
  habitat: typeof fishingHabitat.$inferSelect,
  now: Date,
) => {
  try {
    const [map, terrains] = await Promise.all([
      fetchPublishedSectorMap(client, habitat.sector),
      client.query.mapTerrain.findMany(),
    ]);
    const registry = new Map(terrains.map((terrain) => [terrain.key, terrain]));
    const center = { x: habitat.tileX, y: habitat.tileY };
    const centerTile = getSectorTile(map, center);
    if (!centerTile || !resolveTerrainSpec(centerTile.terrain, registry).isWater)
      return null;
    const water = [center, ...getNeighborCoordinates(center)].filter((point) => {
      const tile = getSectorTile(map, point);
      return !!tile && resolveTerrainSpec(tile.terrain, registry).isWater;
    });
    const position = getMovingSchoolPosition(water, habitat.id, now);
    return (
      position && {
        habitatId: habitat.id,
        ...position,
        movesAt: new Date((Math.floor(now.getTime() / 30_000) + 1) * 30_000),
      }
    );
  } catch {
    return null;
  }
};

const hash = (text: string) =>
  [...text].reduce((value, char) => ((value << 5) - value + char.charCodeAt(0)) | 0, 0);

const validateHabitatWater = async (
  client: Parameters<typeof fetchUser>[0],
  habitat: { sector: number; tileX: number; tileY: number; radius: number },
  player?: { x: number; y: number },
) => {
  try {
    const [map, terrains] = await Promise.all([
      fetchPublishedSectorMap(client, habitat.sector),
      client.query.mapTerrain.findMany(),
    ]);
    const registry = new Map(terrains.map((terrain) => [terrain.key, terrain]));
    const center = getSectorTile(map, { x: habitat.tileX, y: habitat.tileY });
    if (!center || !resolveTerrainSpec(center.terrain, registry).isWater) return false;
    if (
      player &&
      fishingHexDistance(player, { x: habitat.tileX, y: habitat.tileY }) >
        habitat.radius
    )
      return false;
    if (player) {
      const tile = getSectorTile(map, player);
      if (!tile || tile.blocked || resolveTerrainSpec(tile.terrain, registry).isWater)
        return false;
    }
    for (
      let x = habitat.tileX - habitat.radius;
      x <= habitat.tileX + habitat.radius;
      x++
    )
      for (
        let y = habitat.tileY - habitat.radius;
        y <= habitat.tileY + habitat.radius;
        y++
      ) {
        const tile = getSectorTile(map, { x, y });
        if (
          tile &&
          !tile.blocked &&
          !resolveTerrainSpec(tile.terrain, registry).isWater
        )
          return true;
      }
    return false;
  } catch {
    return false;
  }
};
