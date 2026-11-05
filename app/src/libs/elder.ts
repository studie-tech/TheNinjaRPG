import {
  type ElderRotationLogEntry,
  fetchElderVote,
  insertVillageElderVoteEntryForCastElderVoteEntry,
  listVillageElderVoteForFetchElderVotes,
  selectUserDataForFetchElderVotes,
  selectVillageForFetchElderVotes,
} from "@/queries/elder";
import type { DrizzleClient } from "@/server/db";

/** The nominee fields that decide whether the monthly rotation can promote them. */
type ElderNominee = {
  userId: string;
  username: string;
  clanId: string | null;
  villageId: string | null;
  isBanned: boolean;
  rank: string;
  anbuId: string | null;
};

/**
 * Why a clan's nominee cannot become elder, or undefined when they can. Demotions
 * run first, so an elder renominated by their clan is a JONIN by this point.
 */
export const getElderNomineeSkipReason = (
  nominee: ElderNominee | undefined,
  clan: { id: string; villageId: string | null },
) => {
  if (!nominee) return "Character no longer exists";
  if (nominee.isBanned) return "Banned";
  if (nominee.villageId !== clan.villageId) return "Left the village";
  if (nominee.clanId !== clan.id) return "Left the clan";
  if (nominee.anbuId !== null) return "In ANBU";
  if (nominee.rank !== "JONIN") return `Rank is ${nominee.rank}, not JONIN`;
  return undefined;
};

/**
 * Decide the outcome of the monthly rotation: who gets promoted, and the log rows
 * that explain every demotion, promotion and skipped nominee.
 */
export const resolveElderRotation = (
  elders: { userId: string; username: string; villageId: string | null }[],
  clans: {
    id: string;
    name: string;
    villageId: string | null;
    leaderId: string;
    elderNomineeId: string | null;
  }[],
  nominees: ElderNominee[],
) => {
  const nomineeById = new Map(nominees.map((n) => [n.userId, n]));
  const logs: ElderRotationLogEntry[] = elders.map((elder) => ({
    userId: elder.userId,
    villageId: elder.villageId,
    message: `${elder.username} demoted from elder`,
    changes: [
      `Demoted from elder to JONIN: ${elder.username} (${elder.userId})`,
      "Reason: Monthly elder rotation",
    ],
  }));
  const toPromote: string[] = [];
  for (const clan of clans) {
    const nomineeId = clan.elderNomineeId || clan.leaderId;
    if (!nomineeId) continue;
    const nominee = nomineeById.get(nomineeId);
    const username = nominee?.username ?? nomineeId;
    const reason = getElderNomineeSkipReason(nominee, clan);
    if (!reason) toPromote.push(nomineeId);
    logs.push({
      userId: nomineeId,
      villageId: clan.villageId,
      message: reason
        ? `${username} skipped as elder nominee`
        : `${username} promoted to elder`,
      changes: [
        reason
          ? `Skipped elder nominee: ${username} (${nomineeId})`
          : `Promoted to elder: ${username} (${nomineeId})`,
        `Clan: ${clan.name} (${clan.id})`,
        clan.elderNomineeId ? "Selected by: Nomination" : "Selected by: Clan leader",
        ...(reason ? [`Reason: ${reason}`] : []),
      ],
    });
  }
  return { toPromote, logs };
};

/**
 * Fetch all pending elder votes for a village, with enriched target names
 */
export const fetchElderVotes = async (client: DrizzleClient, villageId: string) => {
  const votes = await listVillageElderVoteForFetchElderVotes(client, villageId);
  // Batch-fetch target names to avoid N+1 queries
  const villageTargetIds = [
    ...new Set(
      votes.filter((v) => v.type === "WAR_DECLARATION").map((v) => v.targetId),
    ),
  ];
  const userTargetIds = [
    ...new Set(votes.filter((v) => v.type === "KAGE_REMOVAL").map((v) => v.targetId)),
  ];
  const [targetVillages, targetUsers] = await Promise.all([
    villageTargetIds.length > 0
      ? selectVillageForFetchElderVotes(client, villageTargetIds)
      : [],
    userTargetIds.length > 0
      ? selectUserDataForFetchElderVotes(client, userTargetIds)
      : [],
  ]);
  const villageById = Object.fromEntries(targetVillages.map((v) => [v.id, v.name]));
  const userById = Object.fromEntries(targetUsers.map((u) => [u.userId, u.username]));
  return votes.map((vote) => {
    let targetName = vote.targetId;
    if (vote.type === "WAR_DECLARATION") {
      targetName = villageById[vote.targetId] ?? vote.targetId;
    } else if (vote.type === "KAGE_REMOVAL") {
      targetName = userById[vote.targetId] ?? vote.targetId;
    }
    return { ...vote, targetName };
  });
};

/**
 * Determine outcome of an elder vote based on simple majority.
 * Majority = more than half of eligible elders (Math.floor(elderCount / 2) + 1).
 * If all elders have voted and it's a tie → REJECTED.
 */
export const resolveElderVote = (
  yesCount: number,
  noCount: number,
  elderCount: number,
  isExpired = false,
  autoApprove = false,
): "APPROVED" | "REJECTED" | "PENDING" => {
  const majority = Math.floor(elderCount / 2) + 1;
  if (yesCount >= majority) return "APPROVED";
  if (noCount >= majority) return "REJECTED";
  // All elders voted and it's a tie → cancelled
  if (yesCount + noCount >= elderCount && yesCount === noCount) return "REJECTED";
  if (isExpired) {
    // autoApprove (WAR_DECLARATION): war starts unless a majority actively blocked it
    if (autoApprove) return "APPROVED";
    // !autoApprove (KAGE_REMOVAL): removal requires a true majority, not just a plurality
    return "REJECTED";
  }
  return "PENDING";
};

/**
 * Insert an elder vote entry, re-fetch the fresh entry list, and resolve the
 * current outcome. Returns null when the user has already voted (duplicate).
 */
export const castElderVoteEntry = async (
  client: DrizzleClient,
  voteId: string,
  userId: string,
  vote: "YES" | "NO",
  elderCount: number,
): Promise<{
  outcome: "APPROVED" | "REJECTED" | "PENDING";
  freshEntries: NonNullable<Awaited<ReturnType<typeof fetchElderVote>>>["entries"];
} | null> => {
  const insertResult = await insertVillageElderVoteEntryForCastElderVoteEntry(
    client,
    voteId,
    userId,
    vote,
  );
  if (!insertResult.rowsAffected) return null;

  const freshVote = await fetchElderVote(client, voteId);
  const freshEntries = freshVote?.entries ?? [];
  const yesCount = freshEntries.filter((e) => e.vote === "YES").length;
  const noCount = freshEntries.filter((e) => e.vote === "NO").length;
  const outcome = resolveElderVote(yesCount, noCount, elderCount);
  return { outcome, freshEntries };
};
