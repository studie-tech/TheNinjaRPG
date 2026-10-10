import { Grid, rectangle } from "honeycomb-grid";
import { Group, Texture, TextureLoader } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { GameAsset } from "@/drizzle/schema";
import { defineHex } from "@/libs/hexgrid";
import { drawCombatEffects, resetCombatCaches } from "@/libs/threejs/combat";
import { ActionSprite, SpriteMixer } from "@/libs/threejs/SpriteMixer";
import { showAnimation } from "@/libs/threejs/util";

type DrawInfo = Parameters<typeof drawCombatEffects>[0];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let texture: Texture<HTMLImageElement>;
let sequence = 0;

beforeEach(() => {
  resetCombatCaches();
  texture = new Texture<HTMLImageElement>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  vi.spyOn(TextureLoader.prototype, "load").mockReturnValue(texture);
});
afterEach(() => {
  vi.restoreAllMocks();
  resetCombatCaches();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const createInfo = (): DrawInfo => ({
  groupEffects: new Group(),
  grid: new Grid(defineHex(), rectangle({ width: 2, height: 2 })),
  spriteMixer: new SpriteMixer(),
  animationId: 1,
  gameAssets: [
    {
      id: "animation",
      image: `https://example.com/animation-${sequence++}.png`,
      frames: 4,
      speed: 30,
    } as GameAsset,
  ],
  battle: {
    groundEffects: [],
    usersEffects: [],
    usersState: [],
  } as unknown as DrawInfo["battle"],
});
const effect = (id: string): DrawInfo["battle"]["groundEffects"][number] =>
  ({
    id,
    type: "damage",
    longitude: 0,
    latitude: 0,
    staticAnimation: "animation",
    power: 100,
  }) as DrawInfo["battle"]["groundEffects"][number];

describe("combat effect animation lifecycle", () => {
  it("retains a temporarily hidden effect without recreating its animation", () => {
    const info = createInfo();
    info.battle.groundEffects = [effect("retained")];
    drawCombatEffects(info);
    const group = info.groupEffects.children[0]!;
    info.battle.groundEffects = [{ ...effect("retained"), power: 0 }];
    drawCombatEffects(info);
    expect(info.groupEffects.children).toEqual([group]);
    expect(group.visible).toBe(false);
    info.battle.groundEffects = [effect("retained")];
    drawCombatEffects(info);
    expect(info.groupEffects.children).toEqual([group]);
    expect(group.visible).toBe(true);
    expect(group.children).toHaveLength(1);
  });

  it("keeps animation work bounded through repeated effect replacement", () => {
    const info = createInfo();
    let previous: ActionSprite | undefined;
    for (let round = 0; round < 100; round++) {
      info.battle.groundEffects = Array.from({ length: 40 }, (_, i) =>
        effect(`${round}-${i}`),
      );
      drawCombatEffects(info);
      expect(info.groupEffects.children).toHaveLength(40);
      const oldFrame = previous?.currentDisplayTime;
      info.spriteMixer.update(0.016);
      if (previous) expect(previous.currentDisplayTime).toBe<typeof oldFrame>(oldFrame);
      previous = info.groupEffects.children[0]?.children.find(
        (child): child is ActionSprite => child instanceof ActionSprite,
      );
    }
    info.battle.groundEffects = [];
    drawCombatEffects(info);
    expect(info.groupEffects.children).toHaveLength(0);
  });

  it("disposes an expired animation's material while preserving its cached texture", () => {
    const info = createInfo();
    info.battle.groundEffects = [effect("expired")];
    drawCombatEffects(info);
    const sprite = info.groupEffects.children[0]?.children.find(
      (child): child is ActionSprite => child instanceof ActionSprite,
    );
    expect(sprite).toBeDefined();
    const disposeMaterial = vi.spyOn(sprite!.material, "dispose");
    const disposeTexture = vi.spyOn(texture, "dispose");
    info.battle.groundEffects = [];
    drawCombatEffects(info);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(disposeTexture).not.toHaveBeenCalled();
  });

  it("preserves the cached texture when a one-shot animation finishes", () => {
    const info = createInfo();
    const sprite = showAnimation({
      gameAsset: info.gameAssets[0]!,
      spriteMixer: info.spriteMixer,
      scale: 1,
      position: { x: 0, y: 0 },
      layer: 1,
    });
    info.groupEffects.add(sprite);
    const disposeTexture = vi.spyOn(texture, "dispose");
    info.spriteMixer.update(0.15);
    expect(info.groupEffects.children).toHaveLength(0);
    expect(disposeTexture).not.toHaveBeenCalled();
  });

  it("unregisters an unfinished one-shot's listener when its effect expires", () => {
    const info = createInfo();
    info.battle.groundEffects = [
      { ...effect("expired"), appearAnimation: "animation" },
    ];
    drawCombatEffects(info);
    const removeListener = vi.spyOn(info.spriteMixer, "removeEventListener");
    info.battle.groundEffects = [];
    drawCombatEffects(info);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
