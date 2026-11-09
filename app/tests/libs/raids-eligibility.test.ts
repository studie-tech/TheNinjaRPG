import { describe, expect, it } from "bun:test";
import {
  createBattleClaimId,
  isBattleClaimId,
  raidCaptureClosedMessage,
} from "@/libs/raids";
import { getWarSide } from "@/libs/objectiveWar";

describe("raidCaptureClosedMessage", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const past = new Date("2026-06-15T11:00:00Z");
  const future = new Date("2026-06-15T13:00:00Z");

  it("stays open before the deadline or without one", () => {
    const open = { raidGracePeriodEnd: null };
    expect(
      raidCaptureClosedMessage({ ...open, raidCaptureDeadline: null }, now),
    ).toBeNull();
    expect(
      raidCaptureClosedMessage({ ...open, raidCaptureDeadline: future }, now),
    ).toBeNull();
  });

  it("stays open during the grace period", () => {
    expect(
      raidCaptureClosedMessage(
        { raidCaptureDeadline: past, raidGracePeriodEnd: future },
        now,
      ),
    ).toBeNull();
  });

  it("closes after the deadline and after the grace period", () => {
    expect(
      raidCaptureClosedMessage(
        { raidCaptureDeadline: past, raidGracePeriodEnd: null },
        now,
      ),
    ).toBe("This raid's capture deadline has passed");
    expect(
      raidCaptureClosedMessage(
        { raidCaptureDeadline: past, raidGracePeriodEnd: past },
        now,
      ),
    ).toBe("This raid's capture deadline and grace period have ended");
  });
});

describe("battle queue claims", () => {
  it("recognises only its own placeholder", () => {
    expect(isBattleClaimId(createBattleClaimId("nonce"))).toBe(true);
    expect(isBattleClaimId("battle-id")).toBe(false);
    expect(isBattleClaimId(null)).toBe(false);
  });
});

describe("getWarSide", () => {
  const war = {
    attackerVillageId: "attacker",
    defenderVillageId: "defender",
    warAllies: [
      { villageId: "ally", supportVillageId: "attacker" },
      { villageId: "other", supportVillageId: "defender" },
    ],
  };

  it("puts the attacker and the allies supporting it on the attacking side", () => {
    expect(getWarSide(war, "attacker")).toBe("attacker");
    expect(getWarSide(war, "ally")).toBe("attacker");
  });

  it("excludes the defender's allies and users without a village", () => {
    expect(getWarSide(war, "other")).toBe("defender");
    expect(getWarSide(war, null)).toBeNull();
  });
});
