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
 * The writes announcing, in the public conversation a challenge was sent from, that its
 * match started: a message posted as the challenger that links the match for others to
 * watch. None when the challenge came from elsewhere. Run them in the accepting
 * mutation's write phase; readers learn of the message once the response is sent. The
 * event names no sender, so both players' own clients load it too.
 */
export const announceChallengeMatch = (
  client: DrizzleClient,
  input: {
    conversationId: string | null;
    challengerId: string;
    match: ChallengeMatch;
  },
) => {
  const { conversationId, challengerId, match } = input;
  if (!conversationId) return [];
  const commentId = nanoid();
  after(() =>
    getServerPusher().trigger(conversationId, "event", { message: "new", commentId }),
  );
  const kind = match.type === "SPAR" ? "a spar" : "a Kessen duel";
  return [
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
  ];
};
