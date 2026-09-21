// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildDerivedUserRegenUpdate,
  buildNegativePrestigeVillageUpdate,
} from "@/server/utils/profileRegen";

describe("buildDerivedUserRegenUpdate", () => {
  it("keeps only derived regen fields by default", () => {
    const update = buildDerivedUserRegenUpdate({
      user: {
        curHealth: 100,
        curStamina: 90,
        curChakra: 80,
        updatedAt: new Date("2026-05-01T10:00:00.000Z"),
        regenAt: new Date("2026-05-01T10:00:00.000Z"),
        questData: [],
        primaryElement: "Fire",
        secondaryElement: "Water",
        status: "AWAKE",
        travelFinishAt: null,
        villagePrestige: 300,
        villageId: "village-1",
        isOutlaw: false,
      },
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
  });

  it("includes village state only when explicitly requested", () => {
    const update = buildDerivedUserRegenUpdate({
      user: {
        curHealth: 100,
        curStamina: 90,
        curChakra: 80,
        updatedAt: new Date("2026-05-01T10:00:00.000Z"),
        regenAt: new Date("2026-05-01T10:00:00.000Z"),
        questData: [],
        primaryElement: "Fire",
        secondaryElement: "Water",
        status: "AWAKE",
        travelFinishAt: null,
        villagePrestige: 300,
        villageId: "village-1",
        isOutlaw: true,
      },
      includeVillageState: true,
    });

    expect(update).toMatchObject({
      villagePrestige: 300,
      villageId: "village-1",
      isOutlaw: true,
    });
  });

  it("builds a complete negative-prestige village transition", () => {
    const joinedVillageAt = new Date("2026-05-01T10:00:00.000Z");
    expect(
      buildNegativePrestigeVillageUpdate(
        { villagePrestige: -125 },
        "syndicate",
        joinedVillageAt,
      ),
    ).toEqual({
      villagePrestige: 125,
      villageId: "syndicate",
      isOutlaw: true,
      joinedVillageAt,
    });
  });
});
