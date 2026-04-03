import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  userData,
  village,
  villageElderVote,
  villageElderVoteEntry,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * Fetch all pending elder votes for a village, with enriched target names
 */
export const fetchElderVotes = async (client: DrizzleClient, villageId: string) => {
  const votes = await client.query.villageElderVote.findMany({
    where: and(
      eq(villageElderVote.villageId, villageId),
      eq(villageElderVote.status, "PENDING"),
    ),
    with: {
      entries: {
        with: {
          user: { columns: { username: true, userId: true, avatar: true } },
        },
      },
      initiatedBy: { columns: { username: true, userId: true, avatar: true } },
    },
    orderBy: [desc(villageElderVote.createdAt)],
  });
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
      ? client
          .select({ id: village.id, name: village.name })
          .from(village)
          .where(inArray(village.id, villageTargetIds))
      : [],
    userTargetIds.length > 0
      ? client
          .select({ userId: userData.userId, username: userData.username })
          .from(userData)
          .where(inArray(userData.userId, userTargetIds))
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
 * Fetch a single elder vote by ID
 */
export const fetchElderVote = async (client: DrizzleClient, voteId: string) => {
  return client.query.villageElderVote.findFirst({
    where: eq(villageElderVote.id, voteId),
    with: { entries: true },
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
  const insertResult = await client
    .insert(villageElderVoteEntry)
    .values({ id: nanoid(), voteId, userId, vote })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  if (!insertResult.rowsAffected) return null;

  const freshVote = await fetchElderVote(client, voteId);
  const freshEntries = freshVote?.entries ?? [];
  const yesCount = freshEntries.filter((e) => e.vote === "YES").length;
  const noCount = freshEntries.filter((e) => e.vote === "NO").length;
  const outcome = resolveElderVote(yesCount, noCount, elderCount);
  return { outcome, freshEntries };
};

/**
 * Fetch all pending elder votes whose deadline has passed
 */
export const fetchExpiredElderVotes = async (client: DrizzleClient) => {
  return client.query.villageElderVote.findMany({
    where: and(
      eq(villageElderVote.status, "PENDING"),
      lt(villageElderVote.endsAt, new Date()),
    ),
    with: { entries: true },
  });
};
