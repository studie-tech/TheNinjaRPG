import { describe, it, expect } from "vitest";
import { mutateCommentSchema } from "@/validators/comments";

describe("mutateCommentSchema senderId", () => {
  it("accepts payload without senderId", () => {
    const data = {
      comment: "Hello world!",
      object_id: "abc123",
    };
    const parsed = mutateCommentSchema.parse(data);
    expect(parsed.comment).toBe("Hello world!");
    expect(parsed.object_id).toBe("abc123");
    expect(parsed.senderId).toBeUndefined();
  });

  it("accepts payload with senderId", () => {
    const data = {
      comment: "Posting as AI",
      object_id: "thread1",
      senderId: "ai-user-1",
    };
    const parsed = mutateCommentSchema.parse(data);
    expect(parsed.senderId).toBe("ai-user-1");
  });

  it("rejects too short comment", () => {
    const data = { comment: "hey", object_id: "x" } as any;
    expect(() => mutateCommentSchema.parse(data)).toThrowError();
  });
});
