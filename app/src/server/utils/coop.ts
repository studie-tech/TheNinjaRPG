import { nanoid } from "nanoid";
import { createPartyClaimId } from "@/libs/questParty";
import {
  deleteBattleById,
  deleteBattleHistoryByBattleId,
  insertConversationForJoinCoopChat,
  updateUserDataForCleanupCoopBattleStart,
} from "@/queries/combat";
import { insertConversationMember } from "@/queries/comments";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/**
 * Allocate the battle ID before reserving either co-op activity, then initiate and publish.
 * Adapter reservations and compensation are scoped to this unique claim; a losing CAS
 * never starts combat. Initiation failures compensate only this launch; publication failures
 * retain the active reservation so another encounter cannot overlap it.
 */
export const launchCoopEncounter = async <
  T extends { success: boolean; message: string; battleId?: string },
>({
  reserve,
  initiate,
  publish,
  recover,
}: {
  reserve: (launch: CoopLaunch) => Promise<boolean>;
  initiate: (launch: CoopLaunch) => Promise<T>;
  publish?: (launch: CoopLaunch, result: T) => Promise<void>;
  recover: (launch: CoopLaunch) => Promise<void>;
}) => {
  const battleId = nanoid();
  const launch = { battleId, claimId: createPartyClaimId(battleId) };
  if (!(await reserve(launch)))
    return errorResponse("The party changed. Refresh and try again.");
  let result: T;
  try {
    result = await initiate(launch);
  } catch (error) {
    await recover(launch);
    throw error;
  }
  if (!result.success) await recover(launch);
  // The battle is committed now. Keep its reservation if publication fails; reads reconcile it.
  else await publish?.(launch, result);
  return result;
};

/** Upsert the existing private conversation and its membership without changing chat permissions. */
export const joinCoopChat = async (
  client: DrizzleClient,
  partyId: string,
  title: string,
  userId: string,
) => {
  await Promise.all([
    insertConversationForJoinCoopChat(client, partyId, title, userId),
    insertConversationMember(client, partyId, userId),
  ]);
};

/** Compensate a failed start before reopening its party; a newer battle has a different ID. */
export const cleanupCoopBattleStart = async (
  client: DrizzleClient,
  battleId: string,
  memberIds: string[],
) =>
  retryOnDeadlock(async () => {
    await deleteBattleById(client, battleId);
    const cleanup = await Promise.allSettled([
      deleteBattleHistoryByBattleId(client, battleId),
      updateUserDataForCleanupCoopBattleStart(client, memberIds, battleId),
    ]);
    const failure = cleanup.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  });

/** Launch identity; the timestamped claim encodes the battle ID used for publication and recovery. */
type CoopLaunch = { claimId: string; battleId: string };
