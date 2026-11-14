import { expect, it } from "bun:test";
import { applyForumReaction } from "@/deltas/forum";

const page = {
  totalComments: 2,
  data: [
    { id: "post-1", reactions: [{ userId: "other", reaction: "helpful" }] },
    { id: "post-2", reactions: [] as { userId: string; reaction: string }[] },
  ],
};

it("sets a confirmed reaction present or absent on its post only", () => {
  const added = applyForumReaction(page, {
    postId: "post-1",
    userId: "me",
    reaction: "helpful",
    active: true,
  });
  expect(added.data[0]?.reactions).toEqual([
    { userId: "other", reaction: "helpful" },
    { userId: "me", reaction: "helpful" },
  ]);
  expect(added.data[1]).toBe(page.data[1]);
  expect(added.totalComments).toBe(2);

  const repeated = applyForumReaction(added, {
    postId: "post-1",
    userId: "me",
    reaction: "helpful",
    active: true,
  });
  expect(repeated.data[0]?.reactions).toHaveLength(2);

  const removed = applyForumReaction(repeated, {
    postId: "post-1",
    userId: "me",
    reaction: "helpful",
    active: false,
  });
  expect(removed.data[0]?.reactions).toEqual([
    { userId: "other", reaction: "helpful" },
  ]);
});

it("returns a page without the post unchanged", () => {
  const change = { postId: "elsewhere", userId: "me", reaction: "❤️", active: true };
  expect(applyForumReaction(page, change)).toBe(page);
});
