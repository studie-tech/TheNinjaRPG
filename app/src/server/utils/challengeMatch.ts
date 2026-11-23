import { nanoid } from "nanoid";
import { after } from "next/server";
import { getServerPusher } from "@/libs/pusher";
import {
  insertConversationComment,
  updateConversationForCreateConversationComment,
} from "@/queries/comments";
import type { DrizzleClient } from "@/server/db";
import type { ChallengeMatch } from "@/validators/comments";

/**
 * Announces, once the response is sent, in the public conversation a challenge was sent
 * from, that its match started: a message posted as the challenger that links the match
 * for others to watch, so the announcement adds no round trip to the accept. Nothing when
 * the challenge came from elsewhere. The event names no sender, so both players' own
 * clients load it too.
 */
export const announceChallengeMatch = (
  client: DrizzleClient,
  { conversationId, challengerId, match }: ChallengeMatchAnnouncement,
) => {
  if (!conversationId) return;
  const commentId = nanoid();
  const kind = match.type === "SPAR" ? "a spar" : "a Kessen duel";
  after(async () => {
    await Promise.all([
      insertConversationComment(
        client,
        commentId,
        `<p>Started ${kind} with ${match.opponentName}.</p>`,
        challengerId,
        challengerId,
        conversationId,
        match,
      ),
      updateConversationForCreateConversationComment(client, { id: conversationId }),
    ]);
    await getServerPusher().trigger(conversationId, "event", {
      message: "new",
      commentId,
    });
  });
};

interface ChallengeMatchAnnouncement {
  conversationId: string | null;
  challengerId: string;
  match: ChallengeMatch;
}
