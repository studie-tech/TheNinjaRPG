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
  input: ChallengeMatchAnnouncement,
) => {
  const announcement = buildAnnouncement(client, input);
  if (!announcement) return [];
  after(announcement.notify);
  return announcement.writes;
};

/**
 * Posts the announcement of `announceChallengeMatch` once the response is sent, for an
 * accepting mutation whose match is confirmed only after its write phase, so the
 * announcement adds no round trip to the accept.
 */
export const announceChallengeMatchAfterResponse = (
  client: DrizzleClient,
  input: ChallengeMatchAnnouncement,
) => {
  const announcement = buildAnnouncement(client, input);
  if (!announcement) return;
  after(async () => {
    await Promise.all(announcement.writes);
    await announcement.notify();
  });
};

/** The announcement's writes and the event telling the conversation's readers. */
const buildAnnouncement = (
  client: DrizzleClient,
  { conversationId, challengerId, match }: ChallengeMatchAnnouncement,
) => {
  if (!conversationId) return null;
  const commentId = nanoid();
  const kind = match.type === "SPAR" ? "a spar" : "a Kessen duel";
  return {
    writes: [
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
    ],
    notify: () =>
      getServerPusher().trigger(conversationId, "event", { message: "new", commentId }),
  };
};

interface ChallengeMatchAnnouncement {
  conversationId: string | null;
  challengerId: string;
  match: ChallengeMatch;
}
