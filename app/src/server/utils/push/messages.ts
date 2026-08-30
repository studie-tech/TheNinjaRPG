/**
 * Message builders. One per notification category, so wording and deep links live in a
 * single place rather than being assembled at each call site.
 */

import type { PushMessage } from "./types";

/** Strip the light HTML some announcements carry; a push alert renders plain text only. */
export const toPlainText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

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
