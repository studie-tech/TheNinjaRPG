import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { UserItemWithItem } from "@/drizzle/schema";
import {
  fishingCollectionLog,
  fishingHabitat,
  fishingProfile,
  fishingRaidEncounter,
  fishingRaidLobby,
  fishingRaidOccurrence,
  fishingRaidParticipant,
  fishingRaidRewardReceipt,
  fishingRaidSchedule,
  fishingRaidTemplate,
  userData,
} from "@/drizzle/schema";
import {
  getFishingEquipment,
  getFishingLevel,
  isFishingEquipmentAvailable,
} from "@/libs/fishing";
import { nextRaidMeters, requiredRaidAction } from "@/libs/fishingRaid";
import { fetchUser } from "@/routers/profile";
import { fetchUserItems } from "@/server/api/routers/item";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { updateUserItemQuantityAtomically } from "@/server/utils/concurrency";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { canChangeContent } from "@/utils/permissions";
import {
  fishingRaidActionInputSchema,
  fishingRaidIdInputSchema,
  fishingRaidJoinInputSchema,
  fishingRaidLeaveInputSchema,
  fishingRaidLobbyInputSchema,
  fishingRaidReadyInputSchema,
  fishingRaidReconnectInputSchema,
  fishingRaidScheduleInputSchema,
  fishingRaidStartInputSchema,
  fishingRaidTemplateInputSchema,
} from "@/validators/fishingRaid";

const asNumber = (config: Record<string, unknown>, key: string) => Number(config[key]);
const phaseStates = ["HOOK", "CONTROL", "WEAR_DOWN", "SURGE", "LAND"] as const;

type RaidEquipmentSelection = {
  rodUserItemId: string | null;
  baitUserItemId: string | null;
  tackleUserItemId: string | null;
};

const getRaidEquipmentIds = (input: {
  rodUserItemId: string;
  baitUserItemId: string;
  tackleUserItemId: string | null;
}) => ({
  rodUserItemId: input.rodUserItemId,
  baitUserItemId: input.baitUserItemId,
  tackleUserItemId: input.tackleUserItemId,
});

/** Selected equipment is revalidated both on lobby entry and immediately before charging. */
const hasSelectedRaidEquipment = (
  items: UserItemWithItem[],
  selection: RaidEquipmentSelection,
  requiredBait = 1,
) => {
  const owns = (
    id: string | null,
    kind: "ROD" | "BAIT" | "TACKLE",
    minimumQuantity = 1,
  ) =>
    !!id &&
    items.some(
      (entry) =>
        entry.id === id &&
        entry.quantity >= minimumQuantity &&
        isFishingEquipmentAvailable(entry) &&
        getFishingEquipment(entry.itemId)?.kind === kind,
    );
  return (
    owns(selection.rodUserItemId, "ROD") &&
    owns(selection.baitUserItemId, "BAIT", requiredBait) &&
    (!selection.tackleUserItemId || owns(selection.tackleUserItemId, "TACKLE"))
  );
};

export const fishingRaidRouter = createTRPCRouter({
  adminList: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!canChangeContent(user.role)) return errorResponse("Not allowed.");
    const [templates, schedules, occurrences] = await Promise.all([
      ctx.drizzle.query.fishingRaidTemplate.findMany(),
      ctx.drizzle.query.fishingRaidSchedule.findMany(),
      ctx.drizzle.query.fishingRaidOccurrence.findMany({
        orderBy: (table, { desc }) => [desc(table.opensAt)],
        limit: 50,
      }),
    ]);
    return {
      success: true,
      message: "Raid content loaded.",
      templates,
      schedules,
      occurrences,
    };
  }),
  deactivateSchedule: protectedProcedure
    .input(fishingRaidIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) return errorResponse("Not allowed.");
      const result = await ctx.drizzle
        .update(fishingRaidSchedule)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(fishingRaidSchedule.id, input.id),
            eq(fishingRaidSchedule.active, true),
          ),
        );
      return Number(result.rowsAffected ?? 0) === 1
        ? { success: true, message: "Raid schedule deactivated." }
        : errorResponse("Schedule is already inactive or missing.");
    }),
  cancelOccurrence: protectedProcedure
    .input(fishingRaidIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) return errorResponse("Not allowed.");
      const occurrence = await ctx.drizzle.query.fishingRaidOccurrence.findFirst({
        where: eq(fishingRaidOccurrence.id, input.id),
      });
      if (!occurrence || ["CLOSED", "CANCELLED"].includes(occurrence.state))
        return errorResponse("That occurrence cannot be cancelled.");
      const lobbies = await ctx.drizzle.query.fishingRaidLobby.findMany({
        where: eq(fishingRaidLobby.occurrenceId, occurrence.id),
      });
      const members = (
        await Promise.all(
          lobbies.map((lobby) =>
            ctx.drizzle.query.fishingRaidParticipant.findMany({
              where: eq(fishingRaidParticipant.lobbyId, lobby.id),
            }),
          ),
        )
      ).flat();
      const now = new Date();
      const cancelled = await ctx.drizzle.transaction(async (tx) => {
        const occurrenceClaim = await tx
          .update(fishingRaidOccurrence)
          .set({ state: "CANCELLED" })
          .where(
            and(
              eq(fishingRaidOccurrence.id, occurrence.id),
              inArray(fishingRaidOccurrence.state, ["SCHEDULED", "OPEN"]),
            ),
          );
        if (Number(occurrenceClaim.rowsAffected ?? 0) !== 1) return false;
        if (lobbies.length > 0) {
          const lobbyIds = lobbies.map((lobby) => lobby.id);
          await tx
            .update(fishingRaidLobby)
            .set({ state: "CANCELLED" })
            .where(inArray(fishingRaidLobby.id, lobbyIds));
          await tx
            .update(fishingRaidEncounter)
            .set({ state: "FAILED", updatedAt: now })
            .where(inArray(fishingRaidEncounter.lobbyId, lobbyIds));
          await tx
            .update(fishingRaidParticipant)
            .set({ active: false, ready: false, reconnectUntil: null })
            .where(inArray(fishingRaidParticipant.lobbyId, lobbyIds));
        }
        if (members.length > 0) {
          const activeSessionIds = lobbies.map((lobby) => `raid:${lobby.id}`);
          await tx
            .update(fishingProfile)
            .set({ activeSessionId: null, updatedAt: now })
            .where(
              and(
                inArray(
                  fishingProfile.userId,
                  members.map((member) => member.userId),
                ),
                inArray(fishingProfile.activeSessionId, activeSessionIds),
              ),
            );
        }
        return true;
      });
      if (!cancelled) return errorResponse("That occurrence changed; refresh it.");
      return {
        success: true,
        message: "Occurrence cancelled and active raid lines released.",
      };
    }),
  upcoming: protectedProcedure.query(async ({ ctx }) =>
    ctx.drizzle.query.fishingRaidOccurrence.findMany({
      where: inArray(fishingRaidOccurrence.state, ["SCHEDULED", "OPEN"]),
      orderBy: (table, { asc }) => [asc(table.opensAt)],
      limit: 20,
    }),
  ),
  openLobbies: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const lobbies = await ctx.drizzle.query.fishingRaidLobby.findMany({
      where: eq(fishingRaidLobby.state, "OPEN"),
    });
    const rows = await Promise.all(
      lobbies.map(async (lobby) => ({
        lobby,
        members: await ctx.drizzle.query.fishingRaidParticipant.findMany({
          where: eq(fishingRaidParticipant.lobbyId, lobby.id),
        }),
        occurrence: await ctx.drizzle.query.fishingRaidOccurrence.findFirst({
          where: eq(fishingRaidOccurrence.id, lobby.occurrenceId),
        }),
      })),
    );
    return rows.flatMap((row) =>
      row.occurrence?.state === "OPEN" && row.occurrence.closesAt > now
        ? [
            {
              id: row.lobby.id,
              rosterCount: row.members.filter((member) => member.active).length,
              cap: asNumber(row.occurrence.templateConfig, "maximumParticipants"),
            },
          ]
        : [],
    );
  }),
  myActiveLobby: protectedProcedure.query(({ ctx }) =>
    findLiveRaidLobbyId(ctx.drizzle, ctx.userId),
  ),
  getLobby: protectedProcedure
    .input(fishingRaidLobbyInputSchema)
    .query(async ({ ctx, input }) => {
      const [lobby, encounter, participants] = await Promise.all([
        ctx.drizzle.query.fishingRaidLobby.findFirst({
          where: eq(fishingRaidLobby.id, input.occurrenceId),
        }),
        ctx.drizzle.query.fishingRaidEncounter.findFirst({
          where: eq(fishingRaidEncounter.lobbyId, input.occurrenceId),
        }),
        ctx.drizzle.query.fishingRaidParticipant.findMany({
          where: eq(fishingRaidParticipant.lobbyId, input.occurrenceId),
        }),
      ]);
      return { lobby, encounter, participants, selfUserId: ctx.userId };
    }),

  saveTemplate: protectedProcedure
    .input(fishingRaidTemplateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) return errorResponse("Not allowed.");
      const habitat = await ctx.drizzle.query.fishingHabitat.findFirst({
        where: eq(fishingHabitat.id, input.habitatId),
      });
      if (!habitat?.active) return errorResponse("Raids need an active water habitat.");
      const id = input.id ?? nanoid();
      const existing = input.id
        ? await ctx.drizzle.query.fishingRaidTemplate.findFirst({
            where: eq(fishingRaidTemplate.id, id),
          })
        : undefined;
      await ctx.drizzle
        .insert(fishingRaidTemplate)
        .values({
          ...input,
          id,
          version: (existing?.version ?? 0) + 1,
          updatedAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: {
            ...input,
            version: sql`${fishingRaidTemplate.version} + 1`,
            updatedAt: new Date(),
          },
        });
      return {
        success: true,
        message:
          "Raid template saved. Existing occurrences retain their versioned configuration.",
        id,
      };
    }),
  saveSchedule: protectedProcedure
    .input(fishingRaidScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) return errorResponse("Not allowed.");
      if (
        !(await ctx.drizzle.query.fishingRaidTemplate.findFirst({
          where: eq(fishingRaidTemplate.id, input.templateId),
        }))
      )
        return errorResponse("Select a valid raid template.");
      const id = input.id ?? nanoid();
      await ctx.drizzle
        .insert(fishingRaidSchedule)
        .values({
          ...input,
          id,
          recurrenceMinutes: input.recurrenceMinutes ?? null,
          updatedAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: {
            ...input,
            recurrenceMinutes: input.recurrenceMinutes ?? null,
            updatedAt: new Date(),
          },
        });
      return { success: true, message: "UTC raid schedule saved.", id };
    }),

  createLobby: protectedProcedure
    .input(fishingRaidJoinInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (await hasLiveRaidMembership(ctx.drizzle, ctx.userId))
        return errorResponse("Leave your current raid lobby before creating another.");
      const [occurrence, user, userItems, profile] = await Promise.all([
        ctx.drizzle.query.fishingRaidOccurrence.findFirst({
          where: eq(fishingRaidOccurrence.id, input.occurrenceId),
        }),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.fishingProfile.findFirst({
          where: eq(fishingProfile.userId, ctx.userId),
        }),
      ]);
      if (
        !occurrence ||
        occurrence.state !== "OPEN" ||
        occurrence.closesAt <= new Date()
      )
        return errorResponse("This raid is not open.");
      if (user.status !== "AWAKE" || user.battleId)
        return errorResponse("You must be awake and out of combat to join a raid.");
      if (!profile?.tutorialClaimedAt)
        return errorResponse("Start the fishing tutorial before joining a raid.");
      if (
        !hasSelectedRaidEquipment(
          userItems,
          input,
          asNumber(occurrence.templateConfig, "entryBait"),
        ) ||
        !(await isRaidEligible(ctx.drizzle, user, occurrence))
      )
        return errorResponse(
          "You do not meet this raid's equipment or fishing-level requirement.",
        );
      const lobby = {
        id: nanoid(),
        occurrenceId: occurrence.id,
        hostUserId: ctx.userId,
      };
      await ctx.drizzle.transaction(async (tx) => {
        await tx.insert(fishingRaidLobby).values(lobby);
        await tx.insert(fishingRaidParticipant).values({
          lobbyId: lobby.id,
          userId: ctx.userId,
          ...getRaidEquipmentIds(input),
        });
      });
      return {
        success: true,
        message: "Raid lobby created. Choose a role and mark ready.",
        lobbyId: lobby.id,
      };
    }),
  joinLobby: protectedProcedure
    .input(fishingRaidJoinInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [lobby, user, userItems, profile] = await Promise.all([
        ctx.drizzle.query.fishingRaidLobby.findFirst({
          where: eq(fishingRaidLobby.id, input.occurrenceId),
        }),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.fishingProfile.findFirst({
          where: eq(fishingProfile.userId, ctx.userId),
        }),
      ]);
      if (!lobby || lobby.state !== "OPEN")
        return errorResponse("This lobby is no longer accepting anglers.");
      if (await hasLiveRaidMembership(ctx.drizzle, ctx.userId, lobby.id))
        return errorResponse("Leave your current raid lobby before joining another.");
      const occurrence = await ctx.drizzle.query.fishingRaidOccurrence.findFirst({
        where: eq(fishingRaidOccurrence.id, lobby.occurrenceId),
      });
      if (!profile?.tutorialClaimedAt)
        return errorResponse("Start the fishing tutorial before joining a raid.");
      if (
        !occurrence ||
        occurrence.state !== "OPEN" ||
        occurrence.closesAt <= new Date() ||
        !hasSelectedRaidEquipment(
          userItems,
          input,
          asNumber(occurrence.templateConfig, "entryBait"),
        ) ||
        !(await isRaidEligible(ctx.drizzle, user, occurrence))
      )
        return errorResponse("You cannot join this raid right now.");
      const members = await ctx.drizzle.query.fishingRaidParticipant.findMany({
        where: eq(fishingRaidParticipant.lobbyId, lobby.id),
      });
      if (
        members.filter((member) => member.active).length >=
        asNumber(occurrence.templateConfig, "maximumParticipants")
      )
        return errorResponse("This raid lobby is full.");
      await ctx.drizzle
        .insert(fishingRaidParticipant)
        .values({
          lobbyId: lobby.id,
          userId: ctx.userId,
          ...getRaidEquipmentIds(input),
        })
        .onDuplicateKeyUpdate({
          set: { active: true, reconnectUntil: null, ...getRaidEquipmentIds(input) },
        });
      return { success: true, message: "Joined the lobby.", lobbyId: lobby.id };
    }),
  setReady: protectedProcedure
    .input(fishingRaidReadyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const lobby = await ctx.drizzle.query.fishingRaidLobby.findFirst({
        where: eq(fishingRaidLobby.id, input.lobbyId),
      });
      if (!lobby || lobby.state !== "OPEN")
        return errorResponse("Readiness can only change while the lobby is open.");
      const updated = await ctx.drizzle
        .update(fishingRaidParticipant)
        .set({ ready: input.ready, role: input.role })
        .where(
          and(
            eq(fishingRaidParticipant.lobbyId, input.lobbyId),
            eq(fishingRaidParticipant.userId, ctx.userId),
            eq(fishingRaidParticipant.active, true),
          ),
        );
      return Number(updated.rowsAffected ?? 0) === 1
        ? {
            success: true,
            message: input.ready ? "Ready for the catch." : "You are no longer ready.",
          }
        : errorResponse("You are not in that lobby.");
    }),
  start: protectedProcedure
    .input(fishingRaidStartInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [lobby, participants] = await Promise.all([
        ctx.drizzle.query.fishingRaidLobby.findFirst({
          where: eq(fishingRaidLobby.id, input.lobbyId),
        }),
        ctx.drizzle.query.fishingRaidParticipant.findMany({
          where: eq(fishingRaidParticipant.lobbyId, input.lobbyId),
        }),
      ]);
      if (
        !lobby ||
        lobby.hostUserId !== ctx.userId ||
        lobby.state !== "OPEN" ||
        lobby.version !== input.version
      )
        return errorResponse("The lobby changed; refresh before starting.");
      const activeParticipants = participants.filter(
        (participant) => participant.active,
      );
      const occurrence = await ctx.drizzle.query.fishingRaidOccurrence.findFirst({
        where: eq(fishingRaidOccurrence.id, lobby.occurrenceId),
      });
      const minimum = occurrence
        ? asNumber(occurrence.templateConfig, "minimumParticipants")
        : 0;
      if (
        !occurrence ||
        occurrence.state !== "OPEN" ||
        occurrence.closesAt <= new Date() ||
        activeParticipants.length < minimum ||
        activeParticipants.some((participant) => !participant.ready)
      )
        return errorResponse(
          "The event must be open and every angler ready before starting.",
        );
      const eligible = await Promise.all(
        activeParticipants.map(async (participant) =>
          isRaidEligible(
            ctx.drizzle,
            await fetchUser(ctx.drizzle, participant.userId),
            occurrence,
          ),
        ),
      );
      if (eligible.some((value) => !value))
        return errorResponse(
          "Every angler must be awake, out of combat, qualified, and in the raid habitat sector.",
        );
      const participantInventories = await Promise.all(
        activeParticipants.map(async (participant) => ({
          participant,
          items: await fetchUserItems(ctx.drizzle, participant.userId),
        })),
      );
      if (
        participantInventories.some(
          ({ participant, items }) =>
            !hasSelectedRaidEquipment(
              items,
              participant,
              asNumber(occurrence.templateConfig, "entryBait"),
            ),
        )
      )
        return errorResponse(
          "Every angler must keep their selected rod and bait until the raid starts.",
        );
      const now = new Date();
      const bait = asNumber(occurrence.templateConfig, "entryBait");
      let started = false;
      try {
        started = await ctx.drizzle.transaction(async (tx) => {
          const lock = await tx
            .update(fishingRaidLobby)
            .set({
              state: "STARTING",
              version: sql`${fishingRaidLobby.version} + 1`,
              rosterLockedAt: now,
            })
            .where(
              and(
                eq(fishingRaidLobby.id, lobby.id),
                eq(fishingRaidLobby.state, "OPEN"),
                eq(fishingRaidLobby.version, input.version),
              ),
            );
          if (Number(lock.rowsAffected ?? 0) !== 1)
            throw new Error("RAID_START_NOT_ELIGIBLE");
          for (const { participant, items } of participantInventories) {
            await tx
              .insert(fishingProfile)
              .values({ userId: participant.userId })
              .onDuplicateKeyUpdate({
                set: { userId: sql`${fishingProfile.userId}` },
              });
            const selectedBait = items.find(
              (entry) => entry.id === participant.baitUserItemId,
            );
            if (!selectedBait || selectedBait.quantity < bait)
              throw new Error("RAID_START_NOT_ELIGIBLE");
            const claimed = await tx
              .update(fishingProfile)
              .set({
                activeSessionId: `raid:${lobby.id}`,
                updatedAt: now,
              })
              .where(
                and(
                  eq(fishingProfile.userId, participant.userId),
                  sql`${fishingProfile.activeSessionId} IS NULL`,
                ),
              );
            if (Number(claimed.rowsAffected ?? 0) !== 1)
              throw new Error("RAID_START_NOT_ELIGIBLE");
            const consumed = await updateUserItemQuantityAtomically({
              client: tx,
              userId: participant.userId,
              userItemId: selectedBait.id,
              expectedQuantity: selectedBait.quantity,
              nextQuantity: selectedBait.quantity - bait,
            });
            if (!consumed) throw new Error("RAID_START_NOT_ELIGIBLE");
          }
          await tx.insert(fishingRaidEncounter).values({
            lobbyId: lobby.id,
            deadlineAt: new Date(
              now.getTime() +
                asNumber(occurrence.templateConfig, "encounterSeconds") * 1000,
            ),
          });
          await tx
            .update(fishingRaidLobby)
            .set({ state: "ACTIVE" })
            .where(eq(fishingRaidLobby.id, lobby.id));
          return true;
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "RAID_START_NOT_ELIGIBLE")
          throw error;
      }
      return started
        ? { success: true, message: "Lines are in. Hook together!" }
        : errorResponse(
            "A participant lacks selected bait or has another active line; no bait was consumed.",
          );
    }),
  act: protectedProcedure
    .input(fishingRaidActionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [lobby, encounter, participant, user] = await Promise.all([
        ctx.drizzle.query.fishingRaidLobby.findFirst({
          where: eq(fishingRaidLobby.id, input.lobbyId),
        }),
        ctx.drizzle.query.fishingRaidEncounter.findFirst({
          where: eq(fishingRaidEncounter.lobbyId, input.lobbyId),
        }),
        ctx.drizzle.query.fishingRaidParticipant.findFirst({
          where: and(
            eq(fishingRaidParticipant.lobbyId, input.lobbyId),
            eq(fishingRaidParticipant.userId, ctx.userId),
          ),
        }),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      const now = new Date();
      if (
        !lobby ||
        lobby.state !== "ACTIVE" ||
        !encounter ||
        !participant ||
        !participant.active ||
        encounter.version !== input.version ||
        encounter.deadlineAt <= now ||
        user.status !== "AWAKE" ||
        user.battleId
      )
        return errorResponse("This encounter changed or has ended; refresh it.");
      const occurrence = await ctx.drizzle.query.fishingRaidOccurrence.findFirst({
        where: eq(fishingRaidOccurrence.id, lobby.occurrenceId),
      });
      if (!occurrence || !(await isRaidEligible(ctx.drizzle, user, occurrence)))
        return errorResponse(
          "You must remain qualified and in the raid habitat sector.",
        );
      if (requiredRaidAction(encounter.phase, participant.role) !== input.action)
        return errorResponse("That role action does not fit the current shared cue.");
      const contribution = await ctx.drizzle
        .update(fishingRaidParticipant)
        .set({
          contribution: sql`${fishingRaidParticipant.contribution} + 1`,
          lastActionPhase: encounter.phase,
          lastActionAt: now,
        })
        .where(
          and(
            eq(fishingRaidParticipant.lobbyId, input.lobbyId),
            eq(fishingRaidParticipant.userId, ctx.userId),
            ne(fishingRaidParticipant.lastActionPhase, encounter.phase),
          ),
        );
      if (Number(contribution.rowsAffected ?? 0) !== 1)
        return errorResponse(
          "You already completed this phase. Coordinate with another angler.",
        );
      const members = await ctx.drizzle.query.fishingRaidParticipant.findMany({
        where: and(
          eq(fishingRaidParticipant.lobbyId, input.lobbyId),
          eq(fishingRaidParticipant.active, true),
          eq(fishingRaidParticipant.lastActionPhase, encounter.phase),
        ),
      });
      const eligibleMembers = (
        await Promise.all(
          members.map(async (member) => ({
            member,
            eligible: await isRaidEligible(
              ctx.drizzle,
              await fetchUser(ctx.drizzle, member.userId),
              occurrence,
            ),
          })),
        )
      ).filter((value) => value.eligible);
      const minimum = asNumber(occurrence.templateConfig, "minimumParticipants");
      if (eligibleMembers.length < minimum) {
        await beginRaidRecovery(ctx.drizzle, lobby.id, encounter, now);
        return {
          success: true,
          message: "Your contribution counts. Await more distinct anglers.",
          version: encounter.version,
        };
      }
      const meters = nextRaidMeters(encounter.phase, encounter);
      const nextState = meters.succeeded
        ? "SUCCEEDED"
        : phaseStates[meters.nextPhase - 1];
      if (!nextState) return errorResponse("The raid phase is invalid; contact staff.");
      const transition = await ctx.drizzle
        .update(fishingRaidEncounter)
        .set({
          state: nextState,
          phase: meters.nextPhase,
          fishStamina: meters.fishStamina,
          landingProgress: meters.landingProgress,
          escapePressure: meters.escapePressure,
          recoveryUntil: null,
          version: sql`${fishingRaidEncounter.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(fishingRaidEncounter.lobbyId, input.lobbyId),
            eq(fishingRaidEncounter.version, input.version),
          ),
        );
      if (Number(transition.rowsAffected ?? 0) !== 1)
        return {
          success: true,
          message: "Another action advanced the fish. Refresh the shared state.",
          version: input.version + 1,
        };
      if (!meters.succeeded)
        return {
          success: true,
          message: "The group advances! Read the next cue.",
          version: input.version + 1,
        };
      await settleRaidRewards(ctx.drizzle, lobby.id, occurrence, now);
      return {
        success: true,
        message: "The raid fish is landed. Eligible anglers received their rewards.",
        version: input.version + 1,
      };
    }),
  reconnect: protectedProcedure
    .input(fishingRaidReconnectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const updated = await ctx.drizzle
        .update(fishingRaidParticipant)
        .set({ active: true, reconnectUntil: null })
        .where(
          and(
            eq(fishingRaidParticipant.lobbyId, input.lobbyId),
            eq(fishingRaidParticipant.userId, ctx.userId),
            sql`${fishingRaidParticipant.reconnectUntil} > ${now}`,
          ),
        );
      return Number(updated.rowsAffected ?? 0) === 1
        ? { success: true, message: "Line reattached; your contribution remains." }
        : errorResponse("The reconnect grace period has ended.");
    }),
  leave: protectedProcedure
    .input(fishingRaidLeaveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const lobby = await ctx.drizzle.query.fishingRaidLobby.findFirst({
        where: eq(fishingRaidLobby.id, input.lobbyId),
      });
      if (!lobby || !["OPEN", "ACTIVE"].includes(lobby.state))
        return errorResponse("This raid lobby is no longer active.");
      if (lobby.state === "OPEN" && lobby.hostUserId === ctx.userId) {
        const cancelled = await ctx.drizzle.transaction(async (tx) => {
          const lock = await tx
            .update(fishingRaidLobby)
            .set({ state: "CANCELLED" })
            .where(
              and(
                eq(fishingRaidLobby.id, input.lobbyId),
                eq(fishingRaidLobby.state, "OPEN"),
              ),
            );
          if (Number(lock.rowsAffected ?? 0) !== 1) return false;
          await tx
            .update(fishingRaidParticipant)
            .set({ active: false, ready: false, reconnectUntil: null })
            .where(eq(fishingRaidParticipant.lobbyId, input.lobbyId));
          return true;
        });
        if (!cancelled) return errorResponse("The raid lobby changed; refresh it.");
        return { success: true, message: "The open raid lobby was cancelled." };
      }
      const until = new Date(Date.now() + 60_000);
      const departed = await ctx.drizzle
        .update(fishingRaidParticipant)
        .set({ active: false, ready: false, reconnectUntil: until })
        .where(
          and(
            eq(fishingRaidParticipant.lobbyId, input.lobbyId),
            eq(fishingRaidParticipant.userId, ctx.userId),
            eq(fishingRaidParticipant.active, true),
          ),
        );
      if (Number(departed.rowsAffected ?? 0) !== 1)
        return errorResponse("You are not an active member of that raid lobby.");
      return {
        success: true,
        message: "Your line is held for one minute if you reconnect.",
      };
    }),
});

const settleRaidRewards = async (
  db: DrizzleClient,
  lobbyId: string,
  occurrence: typeof fishingRaidOccurrence.$inferSelect,
  now: Date,
) =>
  db.transaction(async (tx) => {
    const members = await tx.query.fishingRaidParticipant.findMany({
      where: eq(fishingRaidParticipant.lobbyId, lobbyId),
    });
    const minimumContribution = Math.max(
      1,
      Math.ceil(asNumber(occurrence.templateConfig, "minimumParticipants") / 2),
    );
    for (const member of members.filter(
      (value: typeof fishingRaidParticipant.$inferSelect) =>
        value.contribution >= minimumContribution,
    )) {
      let claimed = true;
      try {
        await tx.insert(fishingRaidRewardReceipt).values({
          occurrenceId: occurrence.id,
          userId: member.userId,
          lobbyId,
          experience: asNumber(occurrence.templateConfig, "rewardExperience"),
          contribution: member.contribution,
          deliveredAt: now,
        });
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;
        claimed = false;
      }
      // The unique occurrence/user key is claimed before progression. A retry that finds
      // its durable receipt cannot grant a second collection credit or XP.
      if (!claimed) continue;
      await tx
        .update(userData)
        .set({
          fishingExperience: sql`${userData.fishingExperience} + ${asNumber(occurrence.templateConfig, "rewardExperience")}`,
        })
        .where(eq(userData.userId, member.userId));
      await tx
        .insert(fishingCollectionLog)
        .values({
          userId: member.userId,
          speciesId: String(occurrence.templateConfig.speciesId),
          caughtCount: 1,
          firstCaughtAt: now,
          largestSize: 0,
          bestQuality: 0,
        })
        .onDuplicateKeyUpdate({
          set: { caughtCount: sql`${fishingCollectionLog.caughtCount} + 1` },
        });
      await tx
        .update(fishingProfile)
        .set({ activeSessionId: null, updatedAt: now })
        .where(
          and(
            eq(fishingProfile.userId, member.userId),
            eq(fishingProfile.activeSessionId, `raid:${lobbyId}`),
          ),
        );
    }
    // Helpers who missed reward qualification still need their raid line released.
    await tx
      .update(fishingProfile)
      .set({ activeSessionId: null, updatedAt: now })
      .where(
        and(
          inArray(
            fishingProfile.userId,
            members.map(
              (member: typeof fishingRaidParticipant.$inferSelect) => member.userId,
            ),
          ),
          eq(fishingProfile.activeSessionId, `raid:${lobbyId}`),
        ),
      );
    await tx
      .update(fishingRaidLobby)
      .set({ state: "SUCCEEDED" })
      .where(eq(fishingRaidLobby.id, lobbyId));
  });

const isRaidEligible = async (
  db: DrizzleClient,
  user: Awaited<ReturnType<typeof fetchUser>>,
  occurrence: typeof fishingRaidOccurrence.$inferSelect,
) => {
  if (
    user.status !== "AWAKE" ||
    user.battleId ||
    getFishingLevel(user.fishingExperience) <
      asNumber(occurrence.templateConfig, "minimumLevel")
  )
    return false;
  const habitatId = occurrence.templateConfig.habitatId;
  if (typeof habitatId !== "string") return false;
  const habitat = await db.query.fishingHabitat.findFirst({
    where: eq(fishingHabitat.id, habitatId),
  });
  return !!habitat?.active && habitat.sector === user.sector;
};

const hasLiveRaidMembership = async (
  db: DrizzleClient,
  userId: string,
  exceptLobbyId?: string,
) => (await findLiveRaidLobbyId(db, userId, exceptLobbyId)) !== null;

const findLiveRaidLobbyId = async (
  db: DrizzleClient,
  userId: string,
  exceptLobbyId?: string,
) => {
  const memberships = await db.query.fishingRaidParticipant.findMany({
    where: and(
      eq(fishingRaidParticipant.userId, userId),
      eq(fishingRaidParticipant.active, true),
    ),
    orderBy: (table, { desc }) => [desc(table.joinedAt)],
  });
  const candidates = memberships.filter(
    (membership) => membership.lobbyId !== exceptLobbyId,
  );
  const lobbies = await Promise.all(
    candidates.map((membership) =>
      db.query.fishingRaidLobby.findFirst({
        where: eq(fishingRaidLobby.id, membership.lobbyId),
      }),
    ),
  );
  return (
    lobbies.find(
      (lobby) => lobby && ["OPEN", "STARTING", "ACTIVE"].includes(lobby.state),
    )?.id ?? null
  );
};

const beginRaidRecovery = async (
  db: DrizzleClient,
  lobbyId: string,
  encounter: typeof fishingRaidEncounter.$inferSelect,
  now: Date,
) => {
  if (!encounter.recoveryUntil) {
    await db
      .update(fishingRaidEncounter)
      .set({ recoveryUntil: new Date(now.getTime() + 60_000), updatedAt: now })
      .where(
        and(
          eq(fishingRaidEncounter.lobbyId, lobbyId),
          eq(fishingRaidEncounter.version, encounter.version),
        ),
      );
    return;
  }
  if (encounter.recoveryUntil > now) return;
  const members = await db.query.fishingRaidParticipant.findMany({
    where: eq(fishingRaidParticipant.lobbyId, lobbyId),
  });
  await db.transaction(async (tx) => {
    await tx
      .update(fishingRaidEncounter)
      .set({ state: "FAILED", updatedAt: now })
      .where(eq(fishingRaidEncounter.lobbyId, lobbyId));
    await tx
      .update(fishingRaidLobby)
      .set({ state: "FAILED" })
      .where(eq(fishingRaidLobby.id, lobbyId));
    await tx
      .update(fishingProfile)
      .set({ activeSessionId: null, updatedAt: now })
      .where(
        and(
          inArray(
            fishingProfile.userId,
            members.map((member) => member.userId),
          ),
          eq(fishingProfile.activeSessionId, `raid:${lobbyId}`),
        ),
      );
  });
};
