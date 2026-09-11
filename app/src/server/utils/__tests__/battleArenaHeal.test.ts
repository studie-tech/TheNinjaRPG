import { describe, expect, it, vi } from "vitest";
import { resolveCommittedArenaHeal } from "../battleArenaHeal";

describe("resolveCommittedArenaHeal", () => {
  it("returns success after a post-commit read failure so the client settles once", async () => {
    const readHealedPools = vi.fn().mockRejectedValue(new Error("read unavailable"));

    await expect(resolveCommittedArenaHeal(readHealedPools)).resolves.toEqual({
      success: true,
      message: "You've healed",
    });
    expect(readHealedPools).toHaveBeenCalledTimes(1);
  });

  it("returns authoritative pools when the post-commit read succeeds", async () => {
    const healedPools = {
      money: 500,
      curHealth: 100,
      curStamina: 90,
      curChakra: 80,
    };

    await expect(resolveCommittedArenaHeal(async () => healedPools)).resolves.toEqual({
      success: true,
      message: "You've healed",
      ...healedPools,
    });
  });
});
