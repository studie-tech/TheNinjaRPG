import { describe, expect, it } from "bun:test";
import { buildDerivedUserRegenUpdate } from "@/server/utils/profileRegen";

/** An awake user's pools and regen clock, without any village or currency state. */
const regenUser: Parameters<typeof buildDerivedUserRegenUpdate>[0]["user"] = {
  curHealth: 100,
  curStamina: 90,
  curChakra: 80,
  curEnergy: 50,
  maxEnergy: 100,
  updatedAt: new Date("2026-05-01T10:00:00.000Z"),
  regenAt: new Date("2026-05-01T10:00:00.000Z"),
  questData: [],
  primaryElement: "Fire",
  secondaryElement: "Water",
  status: "AWAKE",
  travelFinishAt: null,
};

describe("buildDerivedUserRegenUpdate", () => {
  it("keeps only derived regen fields", () => {
    const update = buildDerivedUserRegenUpdate({
      user: regenUser,
      userIp: "127.0.0.1",
    });

    expect(update).toMatchObject({
      curHealth: 100,
      curStamina: 90,
      curChakra: 80,
      primaryElement: "Fire",
      secondaryElement: "Water",
      status: "AWAKE",
      lastIp: "127.0.0.1",
    });
    expect(update).not.toHaveProperty("money");
    expect(update).not.toHaveProperty("bank");
    expect(update).not.toHaveProperty("reputationPoints");
    expect(update).not.toHaveProperty("craftingExperience");
    expect(update).not.toHaveProperty("gatheringExperience");
    expect(update).not.toHaveProperty("extraReskinSlots");
    expect(update).not.toHaveProperty("villagePrestige");
    expect(update).not.toHaveProperty("villageId");
    expect(update).not.toHaveProperty("isOutlaw");
  });

  it("omits village state from a full user snapshot", () => {
    const user = {
      ...regenUser,
      villagePrestige: 300,
      villageId: "village-1",
      isOutlaw: true,
    };
    const update = buildDerivedUserRegenUpdate({ user });

    expect(update).not.toHaveProperty("villagePrestige");
    expect(update).not.toHaveProperty("villageId");
    expect(update).not.toHaveProperty("isOutlaw");
  });
});
