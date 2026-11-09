import { describe, expect, it } from "bun:test";
import { getActiveRewardNodes } from "@/libs/rewardNodes";

describe("active reward nodes", () => {
  const nodes = [
    { id: "ryo", fields: ["reward_money"] },
    { id: "currency", fields: ["reward_money", "reward_seichi_silver"] },
    { id: "currency-copy", fields: ["reward_money", "reward_seichi_silver"] },
    { id: "items", fields: ["reward_items"] },
  ] as const;
  /** Fixture with populated currency fields and an empty item reward. */
  const active = (field: string) => field !== "reward_items";

  it("opens one complete group instead of repeating overlapping saved rewards", () => {
    expect(getActiveRewardNodes(nodes, [], active)).toEqual([nodes[1]]);
  });
  it("preserves explicitly selected custom nodes and their complete field lists", () => {
    expect(getActiveRewardNodes(nodes, ["ryo", "currency-copy"], active)).toEqual([
      nodes[0],
      nodes[2],
    ]);
  });
  it("adds a group when an existing reward is not covered by the selected node", () => {
    expect(getActiveRewardNodes(nodes, ["ryo"], active)).toEqual([nodes[0], nodes[1]]);
  });
  it("keeps empty rewards compact while exposing an explicitly added empty node", () => {
    expect(getActiveRewardNodes(nodes, [], () => false)).toEqual([]);
    expect(getActiveRewardNodes(nodes, ["items"], () => false)).toEqual([nodes[3]]);
  });
  it("retains opened groups in selection order even when their values are cleared", () => {
    expect(getActiveRewardNodes(nodes, ["items", "currency"], () => false)).toEqual([
      nodes[3],
      nodes[1],
    ]);
  });
  it("ignores removed catalog nodes and appends uncovered saved rewards", () => {
    expect(getActiveRewardNodes(nodes, ["removed", "items"], active)).toEqual([
      nodes[3],
      nodes[1],
    ]);
  });
});
