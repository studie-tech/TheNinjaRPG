import { and, eq, exists, gte, lte } from "drizzle-orm";
import { z } from "zod";
import {
  ELDER_KAGE_REMOVAL_VOTE_DAYS,
  ELDER_MIN_VOTING_COUNT,
  KAGE_DEFENSE_SETUP_HOURS,
  KAGE_DELAY_SECS,
  KAGE_ELDER_REMOVAL_LOCK_SECS,
  KAGE_MAX_WEEKLY_PRESTIGE_SEND,
  KAGE_REMOVAL_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import { clan, village, villageStructure } from "@/drizzle/schema";
import { castElderVoteEntry } from "@/libs/elder";
import { fetchClan } from "@/queries/clan";
import { fetchElderVote } from "@/queries/elder";
import {
  executeResultForUpgradeStructure,
  fetchElders,
  fetchKageReplacement,
  findKageRemovalVoteById,
  findVillageElderVoteForNominateKage,
  insertActionLogForSendKagePrestige,
  insertActionLogForTakeKage,
  insertNotificationForInitiateKageRemovalVote,
  insertVillageElderVoteForInitiateKageRemovalVote,
  listActionLogForSendKagePrestige,
  listEligibleKageRemovalElders,
  listVillageElderVoteForGetRemovalHistory,
  listVillageElderVoteForInitiateKageRemovalVote,
  selectUserDataForUpgradeStructure,
  setKageCandidateToJonin,
  updateUserDataForSendKagePrestige,
  updateUserDataForTakeKage,
  updateVillageElderVoteForNominateKage,
  updateVillageForPayStructureMaintenance,
  updateVillageForResignKage,
  updateVillageForTakeKage,
} from "@/queries/kage";
import { incrementNotificationCounters } from "@/queries/misc";
import {
  fetchUser,
  findUserById,
  incrementUserVillagePrestige,
} from "@/queries/profile";

import { fetchVillage } from "@/queries/village";
import { kageDefenseProcedures } from "@/routers/kageDefense";
import { fetchUpdatedUser, updateNindo } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { queryInTransaction } from "@/server/utils/concurrency";
import { withKageDefense } from "@/server/utils/kage";
import { settleKageRemoval } from "@/server/utils/kageGovernance";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getKageEligibility } from "@/utils/kage";
import { canTakeKage } from "@/utils/permissions";
import { secondsFromDate, secondsFromNow } from "@/utils/time";
import { calcStructureUpgrade } from "@/utils/village";
import {
  kageNominationSchema,
  kageRemovalSchema,
  kageVillageSchema,
  kageVoteSchema,
} from "@/validators/kage";
import { userDeltaResponseSchema } from "@/validators/userCache";
import {
  structureUpgradeSchema,
  villageMaintenancePaymentSchema,
} from "@/validators/villageMission";

export const kageRouter = createTRPCRouter({
  ...kageDefenseProcedures,
  /**
   * Misc other kage features
   */
  resignKage: protectedProcedure
    .meta({ mcp: { description: "Resign from kage position" } })
    .input(z.object({ villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Destructure
      const villageId = input.villageId;
      // Fetch
      const [user, uVillage, elder] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchVillage(ctx.drizzle, input.villageId),
        fetchKageReplacement(ctx.drizzle, input.villageId, ctx.userId),
      ]);
      // Guards
      if (!elder) return errorResponse("No elder found");
      if (!user) return errorResponse("User not found");
      if (!uVillage) return errorResponse("Village not found");
      if (uVillage.type !== "VILLAGE") return errorResponse("Only for villages");
      if (user.villageId !== villageId) return errorResponse("Wrong village");
      if (user.userId !== uVillage?.kageId) return errorResponse("Not kage");
      // Update
      await updateVillageForResignKage(ctx.drizzle, elder, {
        villageId: user.villageId,
      });
      return { success: true, message: "You have resigned as kage" };
    }),

  sendKagePrestige: protectedProcedure
    .meta({
      mcp: { description: "Send prestige to the kage as elder" },
    })
    .input(z.object({ kageId: z.string(), amount: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, kage, records] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.kageId),
        listActionLogForSendKagePrestige(ctx.drizzle, ctx, input),
      ]);
      // Derived
      const previousSent = records?.reduce((acc, curr) => acc + curr.relatedValue, 0);
      // Guards
      if (user.rank !== "ELDER") return errorResponse("Must be an elder");
      if (user.villageId !== kage.villageId) return errorResponse("Wrong village");
      if (input.amount <= 0) return errorResponse("Invalid amount");
      if (previousSent + input.amount > KAGE_MAX_WEEKLY_PRESTIGE_SEND) {
        return errorResponse(
          `You have already sent ${previousSent} prestige this week. You can only send ${KAGE_MAX_WEEKLY_PRESTIGE_SEND - previousSent} more.`,
        );
      }
      if (user.villagePrestige < input.amount) {
        return errorResponse("Not enough prestige");
      }
      // Create transfer request
      await Promise.all([
        updateUserDataForSendKagePrestige(ctx.drizzle, input, ctx),
        incrementUserVillagePrestige(ctx.drizzle, input.amount, input.kageId),
        insertActionLogForSendKagePrestige(ctx.drizzle, ctx, input, kage, user),
      ]);
      return {
        success: true,
        message: `Sent ${input.amount} prestige to ${kage.username}`,
      };
    }),
  takeKage: protectedProcedure
    .output(userDeltaResponseSchema)
    .input(
      z.object({
        reason: z
          .string()
          .min(10, "Reason must be at least 10 characters")
          .transform((val) => val.trim()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guards
      if (!user) return errorResponse("User not found");

      // Fetch village data for logging
      if (user.anbuId) return errorResponse("Cannot be kage while in ANBU");
      if (user.village?.type !== "VILLAGE") return errorResponse("Only for villages");
      if (!canTakeKage(user.role)) return errorResponse("Not staff");
      // Update
      const [result] = await Promise.all([
        updateVillageForTakeKage(ctx.drizzle, user),
        // The outgoing kage keeps their village prestige: a staff takeover is an
        // administrative action and must not cost the displaced player anything.
        updateUserDataForTakeKage(ctx.drizzle, user),
        insertActionLogForTakeKage(
          ctx.drizzle,
          ctx,
          {
            userId: user.userId,
            village: { name: user?.village?.name, kageId: user?.village?.kageId },
          },
          input,
        ),
      ]);
      if (result.rowsAffected === 0) return errorResponse("No village found");
      return { success: true, message: "You have taken the kage position" };
    }),
  upsertNotice: protectedProcedure
    .meta({
      mcp: { description: "Update village notice as kage" },
    })
    .input(z.object({ content: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const village = user?.village;
      // Apply 24-hour lockout to all kages (villages, hideouts, and strongholds)
      const lockout = KAGE_DELAY_SECS;
      // Guards
      if (!user) return errorResponse("User not found");
      if (!village) return errorResponse("Village not found");
      if (user.isBanned) return errorResponse("User is banned");
      if (user.isSilenced) return errorResponse("User is silenced");
      if (village.kageId !== ctx.userId) return errorResponse("Not kage");
      if (secondsFromDate(lockout, village.leaderUpdatedAt) > new Date()) {
        return errorResponse("Must have been kage for 5 days");
      }
      // Update
      return updateNindo(ctx.drizzle, village.id, input.content, "kageOrder");
    }),
  getElders: protectedProcedure
    .meta({ mcp: { description: "Get village elders" } })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await fetchElders(ctx.drizzle, input.villageId);
    }),
  upgradeStructure: protectedProcedure
    .meta({
      mcp: { description: "Upgrade village structure as kage" },
    })
    .input(structureUpgradeSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, userVillage, clanData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchVillage(ctx.drizzle, input.villageId),
        input.clanId ? fetchClan(ctx.drizzle, input.clanId) : null,
      ]);

      // Derived
      const structure = userVillage?.structures.find((s) => s.id === input.structureId);
      const isHideoutOrStronghold = ["HIDEOUT", "STRONGHOLD"].includes(
        userVillage?.type ?? "",
      );
      const lockout = isHideoutOrStronghold ? KAGE_DELAY_SECS : 0;

      // Guards
      if (!user) return errorResponse("User not found");
      if (!userVillage) return errorResponse("Village not found");
      if (!structure) return errorResponse("Structure not found");
      if (isHideoutOrStronghold && !clanData) return errorResponse("Faction not found");
      if (userVillage.kageId !== user.userId) return errorResponse("Not the leader");
      if (structure.level === 0) return errorResponse("Can't upgrade from lvl 0 yet");
      if (structure.level >= structure.maxLevel)
        return errorResponse("Structure is already at its maximum level");
      if (user.isBanned) return errorResponse("You are banned");
      if (userVillage.type === "VILLAGE" && userVillage.structureMaintenanceDue > 0)
        return errorResponse("Pay outstanding structure maintenance before upgrading");
      if (user.villageId !== structure.villageId) return errorResponse("Wrong village");
      if (!["VILLAGE", "STRONGHOLD"].includes(userVillage.type)) {
        return errorResponse("Only for villages");
      }
      if (clanData && clanData.id !== user.clanId) {
        return errorResponse("Not in faction");
      }
      if (secondsFromDate(lockout, userVillage.leaderUpdatedAt) > new Date()) {
        return errorResponse("Must have been in charge for 24 hours");
      }
      // Guard on cost & mutate
      const { total } = calcStructureUpgrade(structure, userVillage);
      if (
        isHideoutOrStronghold && clanData
          ? clanData.points < total
          : userVillage.tokens < total
      ) {
        return errorResponse(
          isHideoutOrStronghold ? "Not enough clan points" : "Not enough tokens",
        );
      }
      const fundingClan = isHideoutOrStronghold ? clanData : null;
      const balance = fundingClan ? clan.points : village.tokens;
      const guards = and(
        eq(villageStructure.id, input.structureId),
        eq(villageStructure.villageId, input.villageId),
        eq(villageStructure.level, structure.level),
        gte(villageStructure.maxLevel, structure.level + 1),
        eq(village.kageId, ctx.userId),
        eq(village.type, userVillage.type),
        gte(balance, total),
        fundingClan
          ? lte(village.leaderUpdatedAt, new Date(Date.now() - lockout * 1000))
          : eq(village.structureMaintenanceDue, 0),
        exists(selectUserDataForUpgradeStructure(ctx.drizzle, ctx, fundingClan)),
      );
      // Drizzle has no multi-table UPDATE builder. A joined write debits funds and
      // upgrades the guarded level together, without a transaction or partial payment.
      const result = await retryOnDeadlock(() =>
        executeResultForUpgradeStructure(
          ctx.drizzle,
          fundingClan,
          balance,
          total,
          structure,
          guards,
        ),
      );
      if (result.rowsAffected === 0)
        return errorResponse("Structure or funds changed; refresh and try again");

      return { success: true, message: "Structure upgraded" };
    }),
  payStructureMaintenance: protectedProcedure
    .input(villageMaintenancePaymentSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await updateVillageForPayStructureMaintenance(
        ctx.drizzle,
        input,
        ctx,
      );
      return result.rowsAffected > 0
        ? {
            success: true,
            message: "Structure maintenance paid",
          }
        : errorResponse(
            "Only the village Kage can pay an outstanding bill, and the village must have enough tokens",
          );
    }),
  /** Publish a reasoned removal motion after tenure protection and the failed-vote cooldown. */
  initiateKageRemovalVote: protectedProcedure
    .meta({
      mcp: {
        description: "Initiate a vote to remove the current kage",
      },
    })
    .input(kageRemovalSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      return (
        (await withKageDefense(ctx.drizzle, input.villageId, async (tx, hall) => {
          const [user, elders, failedVotes] = await queryInTransaction([
            findUserById(tx, ctx.userId),
            listEligibleKageRemovalElders(tx, input),
            listVillageElderVoteForInitiateKageRemovalVote(tx, input),
          ]);
          const v = hall.village;
          if (
            user?.rank !== "ELDER" ||
            user.isAi ||
            user.isBanned ||
            user.villageId !== input.villageId
          )
            return errorResponse(
              "Only serving village elders can initiate a removal vote",
            );
          if (!v.kageId || ctx.userId === v.kageId)
            return errorResponse(
              "Choose the village's current Kage; you cannot remove yourself",
            );
          if (
            hall.now.getTime() <
            v.leaderUpdatedAt.getTime() + KAGE_ELDER_REMOVAL_LOCK_SECS * 1000
          )
            return errorResponse(
              `The Kage is protected for ${KAGE_ELDER_REMOVAL_LOCK_SECS / 86400} days after taking office`,
            );
          const failed = failedVotes[0];
          if (
            failed?.resolvedAt &&
            failed.targetId === v.kageId &&
            (!failed.tenure ||
              failed.tenure.getTime() === v.leaderUpdatedAt.getTime()) &&
            failed.resolvedAt >= v.leaderUpdatedAt &&
            failed.resolvedAt > secondsFromNow(-KAGE_REMOVAL_COOLDOWN_DAYS * 86400)
          )
            return errorResponse(
              `The village must wait ${KAGE_REMOVAL_COOLDOWN_DAYS} days after a failed removal vote`,
            );
          const eligibleElders = elders.filter((e) => e.userId !== v.kageId);
          if (eligibleElders.length < ELDER_MIN_VOTING_COUNT)
            return errorResponse(
              `At least ${ELDER_MIN_VOTING_COUNT} elders are required`,
            );
          const inserted = await insertVillageElderVoteForInitiateKageRemovalVote(
            tx,
            v,
            ctx,
            input,
          );
          if (!inserted.rowsAffected)
            return errorResponse("There is already a pending Kage removal vote");
          const recipients = eligibleElders.map((e) => e.userId);
          // Commit publication and delivery with the motion so a failed request can retry
          // without leaving an unannounced pending vote that blocks further proposals.
          // Notification is a shared announcement; unread counters select its recipients.
          await insertNotificationForInitiateKageRemovalVote(tx, user, v, input);
          await incrementNotificationCounters(tx, recipients);
          return {
            success: true,
            message: `Removal vote published. Elders have ${ELDER_KAGE_REMOVAL_VOTE_DAYS} days to vote.`,
          };
        })) ?? errorResponse("Village not found")
      );
    }),

  /** Record a serving elder's ballot under the village lock, then use the shared resolver. */
  voteOnKageRemoval: protectedProcedure
    .meta({
      mcp: {
        description: "Vote on a pending kage removal motion",
      },
    })
    .input(kageVoteSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const motion = await fetchElderVote(ctx.drizzle, input.voteId);
      if (motion?.type !== "KAGE_REMOVAL")
        return errorResponse("Removal vote not found");
      const recorded = await withKageDefense(
        ctx.drizzle,
        motion.villageId,
        async (tx, hall) => {
          const [user, current, elders] = await queryInTransaction([
            findUserById(tx, ctx.userId),
            findKageRemovalVoteById(tx, input.voteId),
            listEligibleKageRemovalElders(tx, motion),
          ]);
          if (
            user?.rank !== "ELDER" ||
            user.isAi ||
            user.isBanned ||
            user.villageId !== motion.villageId
          )
            return errorResponse("Only serving village elders can vote");
          if (current?.status !== "PENDING" || hall.now >= current.endsAt)
            return errorResponse("The voting period has ended");
          if (ctx.userId === current.targetId)
            return errorResponse("The Kage cannot vote on their own removal");
          const count = elders.filter((e) => e.userId !== current.targetId).length;
          if (count < ELDER_MIN_VOTING_COUNT)
            return errorResponse(
              `At least ${ELDER_MIN_VOTING_COUNT} eligible elders are required`,
            );
          const inserted = await castElderVoteEntry(
            tx,
            input.voteId,
            ctx.userId,
            input.vote,
            count,
          );
          return inserted
            ? { success: true, message: "Vote recorded" }
            : errorResponse("You have already voted");
        },
      );
      if (!recorded?.success) return recorded ?? errorResponse("Village not found");
      return settleKageRemoval(ctx.drizzle, input.voteId);
    }),

  /** Public reasons, historical ballot totals and successor receipts for recent removal motions. */
  getRemovalHistory: protectedProcedure
    .input(kageVillageSchema)
    .query(async ({ ctx, input }) => {
      const votes = await listVillageElderVoteForGetRemovalHistory(ctx.drizzle, input);
      return votes.map(({ entries, ...vote }) => ({
        ...vote,
        yes: entries.filter((e) => e.vote === "YES").length,
        no: entries.filter((e) => e.vote === "NO").length,
      }));
    }),
  /** Fill the current vacancy once, recording the approved motion's successor when applicable. */
  nominateKage: protectedProcedure
    .input(kageNominationSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const result =
        (await withKageDefense(ctx.drizzle, input.villageId, async (tx, hall) => {
          const [elder, candidate, motion] = await queryInTransaction([
            findUserById(tx, ctx.userId),
            findUserById(tx, input.userId),
            findVillageElderVoteForNominateKage(tx, input, hall),
          ]);
          if (
            input.voteId &&
            (motion?.type !== "KAGE_REMOVAL" ||
              motion.status !== "APPROVED" ||
              !motion.resolvedAt ||
              motion.villageId !== input.villageId)
          )
            return errorResponse(
              "A successful removal vote for this village is required",
            );
          if (
            elder?.rank !== "ELDER" ||
            elder.isBanned ||
            elder.isAi ||
            elder.userId === hall.state.vacancy?.removedUserId ||
            elder.villageId !== input.villageId
          )
            return errorResponse("Only serving elders may nominate the successor");
          if (!candidate) return errorResponse("Candidate not found");
          const reason = getKageEligibility(candidate, input.villageId);
          if (reason) return errorResponse(reason);
          if (candidate.userId === hall.state.vacancy?.removedUserId)
            return errorResponse("Nominate a different villager than the removed Kage");
          if (
            hall.village.kageId ||
            !hall.state.vacancy ||
            (motion &&
              hall.village.leaderUpdatedAt.getTime() !== motion.resolvedAt?.getTime())
          )
            return errorResponse("The vacancy has already been filled");
          // Both nomination forms bind to this vacancy's exact removal timestamp. The
          // receipt, elder demotion and appointment must commit together to prevent a
          // recorded successor without a Kage, or an appointed Kage still serving as elder.
          if (motion) {
            const claim = await updateVillageElderVoteForNominateKage(
              tx,
              candidate,
              motion,
            );
            if (!claim.rowsAffected)
              return errorResponse("A successor has already been nominated");
          }
          if (candidate.rank === "ELDER") await setKageCandidateToJonin(tx, candidate);
          const leaderUpdatedAt = new Date();
          await updateVillageForResignKage(tx, candidate, input, leaderUpdatedAt);
          return {
            success: true,
            message: `${candidate.username} appointed Kage. Publish a schedule within ${KAGE_DEFENSE_SETUP_HOURS} hours.`,
            userPatch: {
              village: {
                id: input.villageId,
                kageId: candidate.userId,
                leaderUpdatedAt,
                kageSchedule: null,
              },
              ...(candidate.userId === ctx.userId && candidate.rank === "ELDER"
                ? { rank: "JONIN" as const }
                : {}),
            },
          };
        })) ?? errorResponse("Village not found");
      return result;
    }),
});
