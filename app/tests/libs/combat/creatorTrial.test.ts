import { describe, expect, it } from "bun:test";
import { CREATOR_USERNAME } from "@/drizzle/constants";
import { isCreator } from "@/libs/combat/creatorTrial";

describe("creator trial", () => {
  it("recognises only the creator's own account", () => {
    expect(isCreator({ username: CREATOR_USERNAME })).toBe(true);
    expect(isCreator({ username: CREATOR_USERNAME, isAi: true })).toBe(false);
    expect(isCreator({ username: "Someone else" })).toBe(false);
  });
});
