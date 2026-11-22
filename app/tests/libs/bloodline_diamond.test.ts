import { describe, expect, it } from "bun:test";
import { LetterRanks } from "@/drizzle/constants";
import {
  getDiamondRestoreBloodlineId,
  hasDiamondBloodlineSwaps,
  isDiamondSwapBloodline,
  resolveDiamondBloodlineRevert,
  shouldRememberPreDiamondBloodline,
} from "@/libs/bloodline";

describe("Diamond bloodline eligibility", () => {
  const user = { villageId: "leaf" };
  it("reaches released D–A bloodlines of no village or the player's own", () => {
    const eligible = LetterRanks.filter((rank) =>
      isDiamondSwapBloodline({ rank, hidden: false, villageId: null }, user),
    );
    expect(eligible).toEqual(["D", "C", "B", "A"]);
    expect(
      isDiamondSwapBloodline({ rank: "A", hidden: false, villageId: "leaf" }, user),
    ).toBe(true);
    expect(
      isDiamondSwapBloodline({ rank: "A", hidden: false, villageId: "sand" }, user),
    ).toBe(false);
    expect(
      isDiamondSwapBloodline({ rank: "D", hidden: true, villageId: null }, user),
    ).toBe(false);
  });
});

describe("Diamond bloodline memory", () => {
  it("remembers the bloodline before the first Diamond swap, never a Diamond pick", () => {
    const remember = (
      diamondBloodlineActive: boolean,
      currentBloodlineId: string | null,
    ) =>
      shouldRememberPreDiamondBloodline({
        diamondBloodlineActive,
        currentBloodlineId,
        ownedBloodlineIds: ["owned"],
      });
    expect(remember(false, "owned")).toBe(true);
    expect(remember(false, null)).toBe(true);
    // A second Diamond swap from a Diamond pick keeps the original memory.
    expect(remember(true, "diamond-pick")).toBe(false);
    // Moving back to an owned bloodline (or none) between swaps updates it.
    expect(remember(true, "owned")).toBe(true);
    expect(remember(true, null)).toBe(true);
  });

  it("reverts only a Diamond pick, to the remembered bloodline or none", () => {
    const revert = (
      currentBloodlineId: string | null,
      preDiamondBloodlineId: string | null,
      preDiamondBloodlineExists = true,
    ) =>
      resolveDiamondBloodlineRevert({
        currentBloodlineId,
        preDiamondBloodlineId,
        preDiamondBloodlineExists,
        ownedBloodlineIds: ["owned", "other-owned"],
      });
    expect(revert("diamond-pick", "owned")).toEqual({ restoreBloodlineId: "owned" });
    expect(revert("diamond-pick", null, false)).toEqual({ restoreBloodlineId: null });
    // A deleted remembered bloodline falls back to none.
    expect(revert("diamond-pick", "deleted", false)).toEqual({
      restoreBloodlineId: null,
    });
    // Owned bloodlines and having none were chosen outside Diamond and stay.
    expect(revert("other-owned", "owned")).toBeUndefined();
    expect(revert(null, "owned")).toBeUndefined();
    expect(revert("owned", "owned")).toBeUndefined();
  });
});

describe("Diamond swap access and restore target", () => {
  it("grants staff Diamond swaps through their effective tier", () => {
    expect(
      hasDiamondBloodlineSwaps({ federalStatus: "DIAMOND", staffAccount: false }),
    ).toBe(true);
    expect(
      hasDiamondBloodlineSwaps({ federalStatus: "NONE", staffAccount: true }),
    ).toBe(true);
    expect(
      hasDiamondBloodlineSwaps({ federalStatus: "GOLD", staffAccount: false }),
    ).toBe(false);
  });

  it("reports the bloodline the player would actually return to", () => {
    const owned = ["owned", "other-owned"];
    const target = (
      diamondBloodlineActive: boolean,
      bloodlineId: string | null,
      preDiamondBloodlineId: string | null,
    ) =>
      getDiamondRestoreBloodlineId(
        { diamondBloodlineActive, bloodlineId, preDiamondBloodlineId },
        owned,
      );
    expect(target(false, "owned", null)).toBe("owned");
    expect(target(true, "diamond-pick", "owned")).toBe("owned");
    expect(target(true, "other-owned", "owned")).toBe("other-owned");
    expect(target(true, null, "owned")).toBeNull();
  });
});
