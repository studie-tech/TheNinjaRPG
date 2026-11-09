import { describe, expect, it } from "bun:test";
import {
  createConversationSchema,
  deleteCommentSchema,
  mutateCommentSchema,
  mutateContentSchema,
} from "@/validators/comments";

const issues = (result: { error?: { issues: object[] } }) =>
  result.error?.issues.map((issue) => {
    const { code, message, path } = issue as Record<string, unknown>;
    return { code, message, path };
  });

describe("comment schemas", () => {
  it("requires the comment's nullable keys to be present", () => {
    const base = { comment: "hello", object_id: "x" };
    expect(mutateCommentSchema.safeParse(base).success).toBe(false);
    expect(
      mutateCommentSchema.safeParse({ ...base, quoteIds: undefined, senderId: null })
        .success,
    ).toBe(false);
    expect(
      mutateCommentSchema.parse({ ...base, quoteIds: null, senderId: null }),
    ).toEqual({ ...base, quoteIds: null, senderId: null });
    expect(
      mutateCommentSchema.parse({ ...base, quoteIds: ["a"], senderId: "b" }),
    ).toEqual({ ...base, quoteIds: ["a"], senderId: "b" });
  });

  it("requires a conversation's sender key to be present", () => {
    const base = { title: "title", comment: "hello", users: ["a"] };
    expect(createConversationSchema.safeParse(base).success).toBe(false);
    expect(createConversationSchema.parse({ ...base, senderId: null })).toEqual({
      ...base,
      senderId: null,
    });
  });

  it("rejects unknown keys", () => {
    const comment = {
      comment: "hello",
      object_id: "x",
      quoteIds: null,
      senderId: null,
    };
    expect(mutateCommentSchema.safeParse({ ...comment, extra: 1 }).success).toBe(false);
    expect(deleteCommentSchema.safeParse({ id: "a", extra: 1 }).success).toBe(false);
    expect(mutateContentSchema.safeParse({ content: "ok", extra: 1 }).success).toBe(
      false,
    );
  });

  it("reports missing delete and content keys as missing strings", () => {
    for (const input of [{}, { id: undefined }]) {
      expect(issues(deleteCommentSchema.safeParse(input))).toEqual([
        {
          code: "invalid_type",
          message: "Invalid input: expected string, received undefined",
          path: ["id"],
        },
      ]);
    }
    expect(issues(mutateContentSchema.safeParse({}))).toEqual([
      {
        code: "invalid_type",
        message: "Invalid input: expected string, received undefined",
        path: ["content"],
      },
    ]);
    expect(deleteCommentSchema.safeParse({ id: null }).success).toBe(false);
    expect(mutateContentSchema.safeParse({ content: "x" }).success).toBe(false);
    expect(mutateContentSchema.parse({ content: "ok" })).toEqual({ content: "ok" });
  });
});
