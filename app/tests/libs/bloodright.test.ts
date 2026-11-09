import { describe, expect, it } from "bun:test";
import { getBloodrightRefundIds } from "@/libs/bloodright";

const tiers = [
  { id: "root", requiredSkillIds: [] },
  { id: "child", requiredSkillIds: ["root"] },
  { id: "grandchild", requiredSkillIds: ["child"] },
  { id: "other", requiredSkillIds: [] },
];
describe("Bloodright refunds", () => {
  it("removes transitive dependents without removing another branch", () => {
    expect(
      getBloodrightRefundIds("root", ["root", "child", "grandchild", "other"], tiers),
    ).toEqual(["root", "child", "grandchild"]);
  });
  it("retains ancestors when refunding a leaf", () => {
    expect(
      getBloodrightRefundIds("grandchild", ["root", "child", "grandchild"], tiers),
    ).toEqual(["grandchild"]);
  });
  it("does not refund tiers the player has never purchased", () => {
    expect(getBloodrightRefundIds("root", ["root", "other"], tiers)).toEqual(["root"]);
  });
  it("allows an unavailable purchased tier to be refunded", () => {
    expect(getBloodrightRefundIds("deleted", ["deleted"], tiers)).toEqual(["deleted"]);
  });
});
