import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import * as moderation from "@/libs/moderation/defer";
import * as pusher from "@/libs/pusher";
import { commentsRouter } from "@/routers/comments";
import type { DrizzleClient } from "@/server/db";
import { callerForDatabase } from "../../../setup/testDatabase";

const user = {
  userId: "poster",
  username: "Poster",
  role: "USER",
  isBanned: false,
  isSilenced: false,
  level: MESSAGING_MIN_LEVEL,
};
// The server attaches quotes when a message is sent, so a stored message can pass the reply limit.
const quote = `<blockquote author="twix" date="11/04/2026" data-comment-id="quoted-message"><p>${"long quote ".repeat(600)}</p></blockquote>`;
const stored = {
  id: "message",
  userId: user.userId,
  conversationId: "conversation",
  createdAt: new Date("2026-11-04T00:00:00Z"),
  content: `${quote}\n\n<p>add them to the blocklist</p>`,
};

let saved: { content?: string } | undefined;
let created: { content?: string } | undefined;
const db = () =>
  ({
    query: {
      userData: { findFirst: async () => user },
      conversationComment: {
        findFirst: async () => stored,
        findMany: async () => [{ ...stored, id: "quoted-message", user: null }],
      },
      conversation: {
        findFirst: async () => ({
          id: "conversation",
          isPublic: true,
          isEnabled: true,
          isStaffAvailable: false,
          users: [{ userId: user.userId }],
        }),
      },
      userBlackList: { findMany: async () => [] },
      parentalControl: { findMany: async () => [] },
    },
    insert: () => ({
      values: async (values: { content?: string }) => {
        created = values;
        return { rowsAffected: 1 };
      },
    }),
    update: () => ({
      set: (values: { content?: string }) => ({
        where: async () => {
          saved = values;
          return { rowsAffected: 1 };
        },
      }),
    }),
  }) as unknown as DrizzleClient;

const edit = (comment: string) =>
  callerForDatabase(commentsRouter, user.userId, db()).editConversationComment({
    object_id: "message",
    comment,
    quoteIds: null,
    senderId: null,
  });

beforeEach(() => {
  saved = undefined;
  created = undefined;
  vi.spyOn(pusher, "getServerPusher").mockReturnValue({
    trigger: async () => {},
  } as never);
  vi.spyOn(moderation, "deferModeration").mockImplementation(() => {});
  stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected HTTP request" });
});
afterEach(() => vi.restoreAllMocks());

it("keeps a message's attached quotes when its author edits only their own text", async () => {
  expect(stored.content.length).toBeGreaterThan(5000);
  const result = await edit("<p>blocklist them</p>");
  expect(result.success).toBe(true);
  expect(saved?.content).toBe(`${quote}<p>blocklist them</p>`);
});

it("does not repeat the quotes when an older client sends them with the edit", async () => {
  const result = await edit(
    `${quote.slice(0, 120)}</p></blockquote><p>blocklist them</p>`,
  );
  expect(result.success).toBe(true);
  expect(saved?.content).toBe(`${quote}<p>blocklist them</p>`);
});

it("does not add a jump ID supplied in the edited reply", async () => {
  const result = await edit(
    '<p>Edited reply</p><blockquote author="Other" data-comment-id="forged">Fake</blockquote>',
  );
  expect(result.success).toBe(true);
  expect(saved?.content).toContain('data-comment-id="quoted-message"');
  expect(saved?.content).not.toContain('data-comment-id="forged"');
});

it("stores generated quote IDs while discarding IDs from authored content", async () => {
  const result = await callerForDatabase(
    commentsRouter,
    user.userId,
    db(),
  ).createConversationComment({
    object_id: "conversation",
    comment:
      '<p>Reply</p><blockquote author="Other" data-comment-id="forged">Fake</blockquote>',
    quoteIds: ["quoted-message"],
    senderId: null,
  });
  expect(result.success).toBe(true);
  expect(created?.content).toContain('data-comment-id="quoted-message"');
  expect(created?.content).not.toContain('data-comment-id="forged"');
});
