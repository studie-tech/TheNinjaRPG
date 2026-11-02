/**
 * Message builders. One per notification category, so wording and deep links live in a
 * single place rather than being assembled at each call site.
 */

import type { PushMessage } from "./types";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

/** Decimal and hexadecimal character references, which is what most editors emit. */
const decodeNumeric = (body: string): string | null => {
  const isHex = body[1] === "x" || body[1] === "X";
  const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
  // Out-of-range values and lone surrogates would throw; leave those as written.
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
};

/**
 * Turn the light HTML announcements carry into the plain text a push alert renders.
 *
 * This is a converter, not a sanitiser — the result goes into a notification body, never
 * back into a document. It still strips to a fixpoint, because a single pass over
 * `<<b>b>` leaves a working tag behind, and decodes entities in one pass, because chaining
 * `&amp;` before `&lt;` would unescape `&amp;lt;` twice and turn it into `<`.
 */
export const toPlainText = (html: string): string => {
  let text = html.replace(/<br\s*\/?>/gi, " ");
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== previous);
  return text
    .replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) =>
      body.startsWith("#")
        ? (decodeNumeric(body) ?? match)
        : (NAMED_ENTITIES[body.toLowerCase()] ?? match),
    )
    .replace(/\s+/g, " ")
    .trim();
};

/** iOS truncates well before this; the cap only keeps payloads inside APNs' 4 KB limit. */
const MAX_BODY_LENGTH = 300;

const truncate = (text: string): string =>
  text.length <= MAX_BODY_LENGTH ? text : `${text.slice(0, MAX_BODY_LENGTH - 1)}…`;

/** A game-wide announcement from the news feed. */
export const announcement = (content: string): PushMessage => ({
  title: "TheNinja-RPG",
  body: truncate(toPlainText(content)),
  category: "system",
  url: "/news",
});

/** Sent by the player to their own devices to confirm delivery works. */
export const deliveryTest = (): PushMessage => ({
  title: "Push notifications are on",
  body: "This is a test alert from TheNinja-RPG.",
  category: "system",
  url: "/profile",
  collapseId: "push-delivery-test",
  suppressFailureReport: true,
});

/** Do not put private conversation text, titles or participant names on the lock screen. */
export const conversationMention = (conversationId: string): PushMessage => ({
  title: "You were mentioned in a conversation",
  body: "Open the game to view the conversation.",
  category: "social",
  url: `/inbox?conversationId=${encodeURIComponent(conversationId)}`,
  collapseId: `mention-${conversationId}`,
});

export const combatStarted = (battleId: string): PushMessage => ({
  title: "A battle has started",
  body: "Your ninja is in combat. Open the game to take your turn.",
  category: "combat",
  url: "/combat",
  collapseId: `combat-${battleId}`,
});

export const membershipUpdate = (group: "clan" | "anbu"): PushMessage => ({
  title: group === "anbu" ? "ANBU request update" : "Clan request update",
  body: "Open the game to view your membership requests.",
  category: "clan",
  url: group === "anbu" ? "/anbu" : "/clanhall",
  collapseId: `${group}-requests`,
});

export const warUpdate = (warId: string): PushMessage => ({
  title: "War status changed",
  body: "Open your village to view the latest war or raid status.",
  category: "war",
  url: "/townhall",
  collapseId: `war-${warId}`,
});

export const raidBattleStarted = (battleId: string): PushMessage => ({
  title: "Your raid team has started a battle",
  body: "Open the game to join your team's battle.",
  category: "war",
  url: "/combat",
  collapseId: `raid-${battleId}`,
});

export const tradeUpdate = (id: string): PushMessage => ({
  title: "Auction house update",
  body: "Open the auction house to view your completed listing or trade.",
  category: "trade",
  url: "/auctionhouse",
  collapseId: `trade-${id}`,
});

export const auctionOutbid = (auctionId: string): PushMessage => ({
  title: "You were outbid",
  body: "Another player placed a higher bid on an auction you were leading.",
  category: "trade",
  url: "/auctionhouse",
  collapseId: `outbid-${auctionId}`,
});

export const timerElapsed = (
  kind: "hospital" | "jutsu" | "mastery" | "element" | "covert",
  id: string,
): PushMessage => ({
  title:
    kind === "hospital"
      ? "Your recovery timer has finished"
      : "Your training timer has finished",
  body: "Open the game to review your progress.",
  category: kind === "hospital" ? "recovery" : "training",
  url:
    kind === "hospital"
      ? "/hospital"
      : kind === "jutsu"
        ? "/jutsus"
        : "/traininggrounds",
  collapseId: `timer-${id}`,
});

/** Keep private conversation content and participant names off the Lock Screen. */
export const privateMessage = (conversationId: string): PushMessage => ({
  title: "New private message",
  body: "Open your inbox to read it.",
  category: "social",
  url: `/inbox?conversationId=${encodeURIComponent(conversationId)}`,
  collapseId: `inbox-${conversationId}`,
});
