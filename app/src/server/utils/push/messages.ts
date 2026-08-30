/**
 * Message builders. One per notification category, so wording and deep links live in a
 * single place rather than being assembled at each call site.
 */

import type { PushMessage } from "./types";

const ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  "#39": "'",
};

/**
 * Turn the light HTML announcements carry into the plain text a push alert renders.
 *
 * This is a converter, not a sanitiser — the result goes into a notification body, never
 * back into a document. It still strips to a fixpoint, because a single pass over
 * `<<b>b>` leaves a working tag behind, and decodes entities in one pass, because
 * chaining `&amp;` before `&lt;` would unescape `&amp;lt;` twice and turn it into `<`.
 */
export const toPlainText = (html: string): string => {
  let text = html.replace(/<br\s*\/?>/gi, " ");
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== previous);
  return text
    .replace(
      /&(#?\w+);/g,
      (match, name: string) => ENTITIES[name.toLowerCase()] ?? match,
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
});
