import {
  ELDER_MIN_VOTING_COUNT,
  KAGE_ELDER_REMOVAL_LOCK_SECS,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { resolveElderVote, tallyElderVotes } from "@/libs/elder";
import {
  findKageRemovalVoteById,
  findVillageElderVoteForSettleKageRemoval,
  insertNotificationForSettleKageRemoval,
  listEligibleKageRemovalElders,
  updateVillageElderVoteForSettleKageRemoval,
  updateVillageForSettleKageRemoval2,
} from "@/queries/kage";
import { incrementKageScheduleVersion } from "@/queries/kageDefense";
import { incrementNotificationCounters } from "@/queries/misc";
import { findVillageById } from "@/queries/village";
import type { DrizzleClient } from "@/server/db";
import { queryInTransaction } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/**
 * Resolve live votes and cron expiry against the current electorate and Kage tenure.
 * The motion receipt, vacancy and announcement commit together so retries cannot lose
 * or duplicate an outcome. These writes span an update, insert and recipient counters;
 * one guarded statement cannot express them. Village prestige is retained.
 */
export const settleKageRemoval = async (
  client: DrizzleClient,
  voteId: string,
  expired = false,
) => {
  const initial = await findVillageElderVoteForSettleKageRemoval(client, voteId);
  if (initial?.type !== "KAGE_REMOVAL")
    return { success: false, message: "Removal vote not found" };
  return retryOnDeadlock(() =>
    client.transaction(async (transaction) => {
      const tx = transaction as unknown as DrizzleClient;
      // Use the same first lock as defense assignments and successor appointments.
      await incrementKageScheduleVersion(tx, initial.villageId);
      const [motion, v, elders] = await queryInTransaction([
        findKageRemovalVoteById(tx, voteId),
        findVillageById(tx, initial.villageId),
        listEligibleKageRemovalElders(tx, initial),
      ]);
      if (motion?.status !== "PENDING")
        return { success: true, message: "Removal vote already resolved" };
      const electorate = getKageRemovalElectorate(elders, motion.targetId);
      const { yes, no } = tallyElderVotes(motion.entries, electorate);
      const isValid =
        !!v &&
        v.kageId === motion.targetId &&
        (!motion.tenure || motion.tenure.getTime() === v.leaderUpdatedAt.getTime()) &&
        Date.now() >= v.leaderUpdatedAt.getTime() + KAGE_ELDER_REMOVAL_LOCK_SECS * 1000;
      const outcome =
        !isValid || electorate.size < ELDER_MIN_VOTING_COUNT
          ? "REJECTED"
          : resolveElderVote(
              yes,
              no,
              electorate.size,
              expired || new Date() >= motion.endsAt,
            );
      if (outcome === "PENDING")
        return {
          success: true,
          message: `Vote recorded. Current tally: ${yes} YES, ${no} NO`,
        };
      const now = new Date();
      const claim = await updateVillageElderVoteForSettleKageRemoval(
        tx,
        outcome,
        now,
        voteId,
      );
      if (!claim.rowsAffected)
        return { success: true, message: "Removal vote already resolved" };
      if (outcome === "APPROVED" && v) {
        await updateVillageForSettleKageRemoval2(tx, now, motion, v);
      }
      const recipients = [...new Set([motion.targetId, ...electorate])];
      // Publish one system announcement; unread counters determine who receives it.
      await insertNotificationForSettleKageRemoval(tx, outcome, v);
      await incrementNotificationCounters(tx, recipients);
      return {
        success: isValid,
        message: !isValid
          ? "The Kage has changed or is still protected; vote rejected"
          : outcome === "APPROVED"
            ? "Kage removed. Elders may now nominate an eligible successor."
            : "Kage removal vote failed",
      };
    }),
  );
};

/** Holds an elder seat in the village, matching `listEligibleKageRemovalElders`. */
export const isServingElder = <
  T extends Pick<UserData, "rank" | "isAi" | "isBanned" | "villageId">,
>(
  user: T | null | undefined,
  villageId: string,
): user is T =>
  user?.rank === "ELDER" &&
  !user.isAi &&
  !user.isBanned &&
  user.villageId === villageId;

/** The motion's target never counts toward the electorate deciding their removal. */
export const getKageRemovalElectorate = (
  elders: { userId: string }[],
  targetId: string | null,
) => new Set(elders.map((e) => e.userId).filter((userId) => userId !== targetId));
