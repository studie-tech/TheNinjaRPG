import { describe, expect, it } from "bun:test";
import { CS_SFX } from "@/drizzle/constants";
import { CS_ENEMY_KINDS, CS_JUTSU } from "@/libs/chakraStorm/content";
import type { CsEvent } from "@/libs/chakraStorm/sim";
import { eventSound } from "@/libs/rendering/scenes/chakraStorm";
import { TD_ELEMENTS } from "@/libs/towerDefense/content";

const cueOf = (event: CsEvent) => {
  const sound = eventSound(event);
  expect(sound).not.toBeNull();
  expect(Object.keys(CS_SFX)).toContain(sound?.[0] ?? "");
  return sound;
};

describe("chakra storm sounds", () => {
  it("sounds every jutsu cast, element hit, kill and pickup", () => {
    for (const jutsu of CS_JUTSU) cueOf({ type: "cast", jutsu, x: 0, y: 0 });
    for (const element of TD_ELEMENTS)
      for (const crit of [false, true])
        cueOf({ type: "hit", id: 1, x: 0, y: 0, amount: 5, element, crit });
    for (const kind of CS_ENEMY_KINDS)
      cueOf({ type: "kill", id: 1, x: 0, y: 0, kind, elite: false });
    for (const kind of ["experience", "onigiri", "scroll", "talisman"] as const)
      cueOf({ type: "pickup", kind, x: 0, y: 0, value: 1 });
  });

  it("sounds every fanfare and warning", () => {
    const events: CsEvent[] = [
      { type: "burst", x: 0, y: 0, radius: 2, awakened: false },
      { type: "bloom", x: 0, y: 0, radius: 2 },
      { type: "hurt", amount: 5 },
      { type: "level", level: 2 },
      { type: "awaken", jutsu: "shuriken" },
      { type: "revive", x: 0, y: 0 },
      { type: "boss", id: 1, name: "Captain" },
      { type: "bossWindup", id: 1, x: 0, y: 0, dx: 1, dy: 0 },
      { type: "bossBurst", x: 0, y: 0 },
      { type: "elite", id: 1 },
      { type: "swarm" },
      { type: "over", won: true },
      { type: "over", won: false },
    ];
    for (const event of events) cueOf(event);
  });

  it("keeps the hero's own throw above the crowd's hits and kills", () => {
    const hit = { type: "hit", id: 1, x: 0, y: 0, amount: 5, crit: false } as const;
    const throwSound = cueOf({ type: "cast", jutsu: "shuriken", x: 0, y: 0 });
    const loudestHit = Math.max(
      ...TD_ELEMENTS.map((element) => cueOf({ ...hit, element })?.[1] ?? 0),
    );
    const kill = cueOf({
      type: "kill",
      id: 1,
      x: 0,
      y: 0,
      kind: "grunt",
      elite: false,
    });
    expect(throwSound?.[1]).toBeGreaterThan(loudestHit);
    expect(throwSound?.[1]).toBeGreaterThan(kill?.[1] ?? 0);
  });

  it("spaces out the sounds a crowd repeats", () => {
    const hit = { type: "hit", id: 1, x: 0, y: 0, amount: 5, crit: false } as const;
    for (const element of TD_ELEMENTS)
      expect(cueOf({ ...hit, element })?.[2]).toBeGreaterThan(0);
    expect(
      cueOf({ type: "kill", id: 1, x: 0, y: 0, kind: "grunt", elite: false })?.[2],
    ).toBeGreaterThan(0);
    expect(
      cueOf({ type: "pickup", kind: "experience", x: 0, y: 0, value: 1 })?.[2],
    ).toBeGreaterThan(0);
    expect(cueOf({ type: "elite", id: 1 })?.[2]).toBeGreaterThan(0);
  });
});
