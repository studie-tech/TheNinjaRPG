import type { DrizzleClient } from "@/server/db";
import { deferPushToUsers } from "./defer";
import { kessenChallengeReceived, kessenDuelStarted } from "./messages";

/** Call after the challenge row was written; the receiver passed the blacklist checks. */
export const notifyKessenChallenge = (client: DrizzleClient, receiverId: string) =>
  deferPushToUsers(client, [receiverId], kessenChallengeReceived());

/** Call after the duel row was written and kept; the player who started it is skipped. */
export const notifyKessenDuelStarted = (
  client: DrizzleClient,
  info: { matchId: string; userIds: string[]; startedBy: string },
) =>
  deferPushToUsers(
    client,
    info.userIds.filter((id) => id !== info.startedBy),
    kessenDuelStarted(info.matchId),
  );
