import { describe, expect, it } from "bun:test";
import { getUserFactionNotifications } from "@/libs/userNotifications";
import type { UserWithRelations } from "@/server/api/routers/profile";

const notify = (overrides: Record<string, unknown>) =>
  getUserFactionNotifications({
    userId: "ninja",
    villageId: "home",
    isAi: false,
    village: { type: "VILLAGE", kageId: "kage" },
    shrineBattles: [],
    activeWars: [],
    activeRaids: [],
    ...overrides,
  } as unknown as UserWithRelations);

const names = (overrides: Record<string, unknown>) =>
  notify(overrides).map((entry) => entry.name);

const war = (overrides: Record<string, unknown>) => ({
  id: "war",
  type: "SECTOR_WAR",
  sector: 7,
  attackerVillageId: "foe",
  defenderVillageId: "home",
  attackerVillage: { name: "Foe" },
  defenderVillage: { name: "Home" },
  ...overrides,
});

describe("getUserFactionNotifications", () => {
  it("lists each shrine sector once, ignores sector 0 and pluralizes by sector count", () => {
    expect(
      notify({
        shrineBattles: [
          { sector: 4, defenderEntityId: "home", attackerEntityId: "foe" },
          { sector: 4, defenderEntityId: "home", attackerEntityId: "foe" },
          { sector: 0, defenderEntityId: "home", attackerEntityId: "foe" },
          { sector: 9, defenderEntityId: "foe", attackerEntityId: "home" },
          { sector: 8, defenderEntityId: "foe", attackerEntityId: "home" },
        ],
      }),
    ).toEqual([
      {
        href: "/travel",
        name: "Shrine under attack (Sector 4)",
        color: "red",
        alwaysShow: true,
      },
      {
        href: "/travel",
        name: "We are attacking Shrines (Sectors 9, 8)",
        color: "blue",
        alwaysShow: true,
      },
    ]);
    expect(
      names({
        shrineBattles: [
          { sector: 4, defenderEntityId: "home", attackerEntityId: "foe" },
          { sector: 5, defenderEntityId: "home", attackerEntityId: "foe" },
          { sector: 9, defenderEntityId: "foe", attackerEntityId: "home" },
        ],
      }),
    ).toEqual([
      "Shrines under attack (Sectors 4, 5)",
      "We are attacking Shrine (Sector 9)",
    ]);
  });

  it("groups war sectors by the side the village fights on, including allied support", () => {
    const allies = [{ villageId: "home", supportVillageId: "friend" }];
    expect(
      names({
        activeWars: [
          war({ sector: 7 }),
          war({ sector: 7 }),
          war({ sector: 0 }),
          war({
            sector: 3,
            attackerVillageId: "friend",
            defenderVillageId: "foe",
            warAllies: allies,
          }),
          war({
            sector: 2,
            attackerVillageId: "home",
            defenderVillageId: "foe",
          }),
        ],
      }),
    ).toEqual([
      "Sector under attack (Sector 7)",
      "We are attacking Sectors (Sectors 3, 2)",
    ]);
    expect(
      names({
        activeWars: [
          war({ sector: 7 }),
          war({ sector: 8 }),
          war({ sector: 2, attackerVillageId: "home", defenderVillageId: "foe" }),
        ],
      }),
    ).toEqual([
      "Sectors under attack (Sectors 7, 8)",
      "We are attacking Sector (Sector 2)",
    ]);
  });

  it("labels village wars and raids for direct parties and supporters alike", () => {
    const type = "VILLAGE_WAR";
    const allies = [{ villageId: "home", supportVillageId: "friend" }];
    expect(
      notify({
        activeWars: [
          war({ type, sector: 0, attackerVillageId: "home", defenderVillageId: "foe" }),
          war({ type: "WAR_RAID", sector: 0 }),
          war({
            type,
            sector: 0,
            attackerVillageId: "friend",
            defenderVillageId: "foe",
            attackerVillage: { name: "Friend" },
            defenderVillage: { name: "Foe" },
            warAllies: allies,
          }),
          war({
            type,
            sector: 0,
            attackerVillageId: "foe",
            defenderVillageId: "friend",
            attackerVillage: null,
            defenderVillage: { name: "Friend" },
            warAllies: allies,
          }),
          war({
            type,
            sector: 0,
            attackerVillageId: "other",
            defenderVillageId: "foe",
          }),
        ],
      }),
    ).toEqual(
      [
        "At war: attacking Home",
        "At war: defending vs Foe",
        "Supporting Friend attacking Foe",
        "Supporting Friend defending vs another village",
      ].map((name) => ({ href: "/townhall", name, color: "red", alwaysShow: true })),
    );
  });

  it("keeps raid sector 0, which faction raids use, and pluralizes each raid type", () => {
    expect(
      names({
        activeRaids: [
          { raidType: "open", sector: 0 },
          { raidType: "open", sector: 0 },
          { raidType: "exclusive", sector: 6 },
          { raidType: "exclusive", sector: 7 },
        ],
      }),
    ).toEqual([
      "Open Raid available (Sector 0)",
      "Village Raids active (Sectors 6, 7)",
    ]);
    expect(
      names({
        activeRaids: [
          { raidType: "open", sector: 1 },
          { raidType: "open", sector: 2 },
          { raidType: "exclusive", sector: 6 },
        ],
      }),
    ).toEqual([
      "Open Raids available (Sectors 1, 2)",
      "Village Raid active (Sector 6)",
    ]);
  });

  it("orders shrine, war, village war and raid notices", () => {
    expect(
      names({
        shrineBattles: [
          { sector: 4, defenderEntityId: "home", attackerEntityId: "foe" },
        ],
        activeWars: [war({ sector: 7 }), war({ type: "VILLAGE_WAR", sector: 0 })],
        activeRaids: [{ raidType: "open", sector: 1 }],
      }),
    ).toEqual([
      "Shrine under attack (Sector 4)",
      "Sector under attack (Sector 7)",
      "At war: defending vs Foe",
      "Open Raid available (Sector 1)",
    ]);
  });

  it("returns nothing for a missing user", () => {
    expect(getUserFactionNotifications(undefined)).toEqual([]);
  });
});
