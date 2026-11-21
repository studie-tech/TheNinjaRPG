import { describe, expect, it } from "bun:test";
import type { GameSetting } from "@/drizzle/schema";
import { battleJutsuExp } from "@/libs/train";

describe("battle jutsu experience", () => {
  it.each([0, 32, 1000])(
    "awards 16 base XP in raids and dungeon floors at %s Elo",
    (elo) => {
      expect(battleJutsuExp("RAID", elo)).toBe(16);
      expect(battleJutsuExp("QUEST", elo, [], true)).toBe(16);
    },
  );

  it("applies active jutsu boosts without applying arena boosts to cooperative battles", () => {
    const settings: GameSetting[] = [
      {
        id: "jutsu",
        name: "jutsuExpMultiplier",
        value: 1.53,
        time: new Date(Date.now() + 60000),
      },
      {
        id: "arena",
        name: "battleExpMultiplier",
        value: 5,
        time: new Date(Date.now() + 60000),
      },
    ];
    expect(battleJutsuExp("RAID", 0, settings)).toBe(24);
    expect(battleJutsuExp("QUEST", 0, settings, true)).toBe(24);
    settings[0]!.time = new Date(0);
    expect(battleJutsuExp("RAID", 32, settings)).toBe(16);
  });

  it.each([
    ["COMBAT", 100],
    ["SHRINE_WAR", 24],
    ["ARENA", 16],
    ["QUEST", 16],
    ["TRAINING", 10],
    ["VILLAGE_PROTECTOR", 0],
  ] as const)("preserves ordinary %s XP", (type, expected) => {
    expect(battleJutsuExp(type, 32)).toBe(expected);
  });
  it("keeps ordinary quest XP dependent on Elo", () => {
    expect(battleJutsuExp("QUEST", 0)).toBe(0);
    expect(battleJutsuExp("QUEST", 10)).toBe(5);
  });
});
