import { describe, expect, it } from "bun:test";
import { TD_SFX } from "@/drizzle/constants";
import { eventSound } from "@/libs/rendering/scenes/towerDefense";
import { TD_SEAL_ARTS, TD_ULTIMATES } from "@/libs/towerDefense/content";
import { TD_BOSS_MOVES, type TdEvent } from "@/libs/towerDefense/sim";

const cueOf = (event: TdEvent) => {
  const sound = eventSound(event);
  expect(sound).not.toBeNull();
  expect(Object.keys(TD_SFX)).toContain(sound?.[0] ?? "");
  return sound;
};

describe("tower defense sounds", () => {
  it("sounds every player action and boss warning", () => {
    for (const art of [...TD_SEAL_ARTS, "fizzle"] as const)
      cueOf({ type: "art", art, x: 0, y: 0, radius: 1 });
    for (const ultimate of TD_ULTIMATES)
      cueOf({ type: "ultimate", ultimate, x: 0, y: 0 });
    for (const move of TD_BOSS_MOVES) cueOf({ type: "bossMove", id: 1, move });
    for (const perfect of [false, true])
      cueOf({ type: "substitution", perfect, counterId: 0 });
    cueOf({ type: "blink", fromX: 0, fromY: 0, x: 1, y: 1 });
    cueOf({ type: "seal", count: 1 });
    cueOf({ type: "loot", kind: "ryo", collected: true });
    cueOf({
      type: "kill",
      id: 1,
      x: 0,
      y: 0,
      boss: true,
      elite: false,
      kind: "boss",
      ryo: 0,
    });
    cueOf({ type: "explosion", x: 0, y: 0, radius: 4, element: "fire" });
    cueOf({ type: "wave", boss: true, titan: false, eras: [] });
  });

  it("keeps the automatic stream of combat silent", () => {
    const silent: TdEvent[] = [
      {
        type: "hit",
        targetId: 1,
        x: 0,
        y: 0,
        amount: 5,
        crit: true,
        element: "fire",
        shield: false,
      },
      {
        type: "kill",
        id: 1,
        x: 0,
        y: 0,
        boss: false,
        elite: true,
        kind: "grunt",
        ryo: 0,
      },
      {
        type: "jutsu",
        from: "hero",
        jutsu: "fire",
        x: 0,
        y: 0,
        radius: 1,
        evolved: false,
        points: [],
      },
      { type: "explosion", x: 0, y: 0, radius: 1.6, element: "fire" },
      {
        type: "throw",
        from: "sentry",
        x: 0,
        y: 0,
        targetId: 1,
        due: 2,
        crit: false,
        element: "physical",
      },
    ];
    for (const event of silent) expect(eventSound(event)).toBeNull();
  });

  it("plays a quiet swish for each of the hero's volleys", () => {
    const sound = cueOf({
      type: "throw",
      from: "hero",
      x: 0,
      y: 0,
      targetId: 1,
      due: 2,
      crit: false,
      element: "physical",
    });
    expect(sound?.[0]).toBe("throw");
    expect(sound?.[1]).toBeLessThanOrEqual(0.15);
    // Long enough to merge a multishot volley, short enough for every throw to sound.
    expect(sound?.[2]).toBeGreaterThan(0);
    expect(sound?.[2]).toBeLessThan(150);
  });

  it("bites once for each landing shuriken volley", () => {
    const sound = cueOf({
      type: "hit",
      targetId: 1,
      x: 0,
      y: 0,
      amount: 5,
      crit: false,
      element: "physical",
      shield: false,
    });
    expect(sound?.[0]).toBe("impact");
    expect(sound?.[2]).toBeGreaterThan(0);
    expect(sound?.[2]).toBeLessThan(150);
  });
});
