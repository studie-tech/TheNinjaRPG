import { Grid, rectangle } from "honeycomb-grid";
import { Group, Sprite, Texture, TextureLoader } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { ASSETS_LAYER, EFFECTS_LAYER } from "@/drizzle/constants";
import type { GameAsset } from "@/drizzle/schema";
import { defineHex } from "@/libs/hexgrid";
import { applyEffects, expireGroundEffects } from "@/libs/combat/process";
import {
  drawCombatBackground,
  drawCombatEffects,
  resetCombatCaches,
} from "@/libs/threejs/combat";
import { ActionSprite, SpriteMixer } from "@/libs/threejs/SpriteMixer";
import { showAnimation } from "@/libs/threejs/util";
import * as audio from "@/utils/audio";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeDamageEffect,
  makeEffect,
} from "./combat/helpers/battleScenario";

type DrawInfo = Parameters<typeof drawCombatEffects>[0];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let texture: Texture<HTMLImageElement>;
let load: ReturnType<typeof vi.spyOn<TextureLoader, "load">>;
let sequence = 0;

beforeEach(() => {
  resetCombatCaches();
  texture = new Texture<HTMLImageElement>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  load = vi.spyOn(TextureLoader.prototype, "load").mockReturnValue(texture);
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

describe("combat tile labels", () => {
  it("blends translucent labels above effects and below scenery without writing depth", () => {
    const context = {
      globalAlpha: 1,
      measureText: () => ({ width: 18 }),
      fillText: vi.fn(),
      fillRect: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }),
      putImageData: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const { group_names } = drawCombatBackground(
      100,
      { width: 2, height: 2, background: "ground" } as DrawInfo["battle"],
      () => 1,
      true,
    );
    expect(group_names.children).toHaveLength(4);
    for (const label of group_names.children) {
      expect(label).toBeInstanceOf(Sprite);
      const material = (label as Sprite).material;
      expect(material.depthWrite).toBe(false);
      expect(material.depthTest).toBe(true);
      expect(label.position.z).toBeGreaterThan(EFFECTS_LAYER);
      expect(label.position.z).toBeLessThan(ASSETS_LAYER);
    }
  });
});

describe("combat effect animation lifecycle", () => {
  it("skips effect sheets while retaining static markers with animations disabled", () => {
    const info = createInfo();
    info.animateBattlefield = false;
    const markerUrl = `https://example.com/marker-${sequence++}.png`;
    info.gameAssets.push({ id: "marker", image: markerUrl } as GameAsset);
    info.battle.groundEffects = [{
      ...effect("static"), staticAssetPath: "marker", appearAnimation: "animation",
    }];
    drawCombatEffects(info);
    expect(load.mock.calls.map(([url]) => url)).toEqual([markerUrl]);
    const group = info.groupEffects.children[0]!;
    expect(group.visible).toBe(true);
    expect(group.children).toHaveLength(1);
    expect(group.children[0]).toBeInstanceOf(Sprite);
    expect(group.children[0]).not.toBeInstanceOf(ActionSprite);
    info.animateBattlefield = true;
    drawCombatEffects(info);
    expect(group.children.filter((child) => child instanceof ActionSprite)).toHaveLength(1);
    expect(load.mock.calls.map(([url]) => url)).toContain(info.gameAssets[0]!.image);
  });

  it("retires visible and hidden animations, then resumes loops without replaying appearance", () => {
    const info = createInfo();
    info.sfxEnabled = true;
    info.gameAssets.push({ id: "sound", url: "https://example.com/appear.wav" } as GameAsset);
    const playback = vi.spyOn(audio, "playPreloadedAudio").mockResolvedValue(undefined);
    info.battle.groundEffects = [
      { ...effect("visible"), appearAnimation: "animation", appearSfx: "sound" },
      effect("hidden"),
    ];
    drawCombatEffects(info);
    const [visible, hidden] = info.groupEffects.children;
    const animations = info.groupEffects.children.flatMap((group) => group.children) as ActionSprite[];
    const removeSprite = vi.spyOn(info.spriteMixer, "removeActionSprite");
    const removeListener = vi.spyOn(info.spriteMixer, "removeEventListener");
    info.battle.groundEffects[1]!.power = 0;
    drawCombatEffects(info);
    info.animateBattlefield = false;
    drawCombatEffects(info);
    expect(info.groupEffects.children).toEqual([visible!, hidden!]);
    expect(hidden!.visible).toBe(false);
    expect(visible!.children).toHaveLength(0);
    expect(hidden!.children).toHaveLength(0);
    expect(removeSprite).toHaveBeenCalledTimes(3);
    expect(removeListener).toHaveBeenCalledTimes(1);
    const frames = animations.map((sprite) => sprite.currentDisplayTime);
    info.spriteMixer.update(0.1);
    expect(animations.map((sprite) => sprite.currentDisplayTime)).toEqual(frames);
    info.animateBattlefield = true;
    drawCombatEffects(info);
    drawCombatEffects(info);
    expect(visible!.children).toHaveLength(1);
    expect(playback).toHaveBeenCalledTimes(1);
  });

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

describe("combat effect disappearance sounds", () => {
  const createSoundInfo = () => {
    const info = createInfo();
    info.sfxEnabled = true;
    info.sfxVolume = 0.4;
    info.gameAssets.push(
      { id: "appear", url: "https://example.com/appear.wav" } as GameAsset,
      { id: "disappear", url: "https://example.com/disappear.wav" } as GameAsset,
    );
    info.battle.groundEffects = [
      { ...effect("shield"), appearSfx: "appear", disappearSfx: "disappear" },
    ];
    return info;
  };

  it("plays once across 60 frames after combat damage depletes a retained shield", () => {
    const playback = vi.spyOn(audio, "playPreloadedAudio").mockResolvedValue(undefined);
    const info = createSoundInfo();
    const shield = makeEffect(
      "shield",
      { power: 1, health: 1, rounds: 5, disappearSfx: "disappear" },
      {
        id: "shield",
        creatorId: "defender",
        targetId: "defender",
        targetType: "user",
        isNew: false,
        createdRound: 0,
      },
    );
    const battle = makeCompleteBattle({
      round: 2,
      usersState: [makeBattleUser("attacker"), makeBattleUser("defender")],
      usersEffects: [
        shield,
        makeDamageEffect({
          power: 100,
          calculation: "static",
          creatorId: "attacker",
          targetId: "defender",
          targetType: "user",
          isNew: true,
          createdRound: 2,
          rounds: 0,
        }),
      ],
    });
    info.battle = battle as unknown as DrawInfo["battle"];
    drawCombatEffects(info);
    const group = info.groupEffects.children[0]!;
    expect(group.visible).toBe(true);
    expect(playback).not.toHaveBeenCalled();

    const { newBattle } = applyEffects(battle, "attacker");
    const spent = newBattle.usersEffects.find((entry) => entry.id === shield.id);
    expect(spent?.power).toBe(0);
    expect(spent?.rounds).toBe(5);
    expect(spent?.disappearSfx).toBe("disappear");
    info.battle = newBattle as unknown as DrawInfo["battle"];
    for (let frame = 0; frame < 60; frame++) drawCombatEffects(info);

    expect(info.groupEffects.children).toEqual([group]);
    expect(group.visible).toBe(false);
    expect(playback).toHaveBeenCalledTimes(1);
    expect(playback).toHaveBeenCalledWith("https://example.com/disappear.wav", 0.4);
  });

  it("plays once for an initially depleted effect and resets when it reappears", () => {
    const playback = vi.spyOn(audio, "playPreloadedAudio").mockResolvedValue(undefined);
    const info = createSoundInfo();
    const retained = info.battle.groundEffects[0]!;
    retained.appearSfx = "";
    retained.power = 0;
    for (let frame = 0; frame < 60; frame++) drawCombatEffects(info);
    const group = info.groupEffects.children[0]!;
    expect(playback).toHaveBeenCalledTimes(1);

    retained.power = 10;
    drawCombatEffects(info);
    expect(group.visible).toBe(true);
    retained.power = 0;
    for (let frame = 0; frame < 60; frame++) drawCombatEffects(info);
    expect(info.groupEffects.children).toEqual([group]);
    expect(playback).toHaveBeenCalledTimes(2);
  });

  it("queues one disappearance after the appearance sound until movement ends", async () => {
    const playback = vi.spyOn(audio, "playPreloadedAudio").mockResolvedValue(undefined);
    const info = createSoundInfo();
    info.isAnyUserMoving = true;
    drawCombatEffects(info);
    info.battle.groundEffects[0]!.power = 0;
    for (let frame = 0; frame < 60; frame++) drawCombatEffects(info);
    expect(playback).not.toHaveBeenCalled();

    info.isAnyUserMoving = false;
    drawCombatEffects(info);
    expect(playback).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(playback.mock.calls).toEqual([
      ["https://example.com/appear.wav", 0.4],
      ["https://example.com/disappear.wav", 0.4],
    ]);
    drawCombatEffects(info);
    expect(playback).toHaveBeenCalledTimes(2);
  });

  it("keeps sounds independent per effect and preserves expiry visuals and audio", () => {
    const playback = vi.spyOn(audio, "playPreloadedAudio").mockResolvedValue(undefined);
    const info = createSoundInfo();
    info.battle.groundEffects = ["first", "second"].map((id) => ({
      ...effect(id),
      power: 0,
      disappearSfx: "disappear",
    }));
    for (let frame = 0; frame < 60; frame++) drawCombatEffects(info);
    expect(playback).toHaveBeenCalledTimes(2);

    const battle = makeCompleteBattle({
      round: 2,
      groundEffects: [
        {
          ...effect("expired"),
          rounds: 0,
          isNew: false,
          disappearAnimation: "animation",
          disappearSfx: "disappear",
        },
      ],
    });
    expireGroundEffects(battle, []);
    info.battle = battle as unknown as DrawInfo["battle"];
    drawCombatEffects(info);
    expect(info.groupEffects.children).toHaveLength(1);
    const expiry = info.groupEffects.children[0]!;
    expect(expiry.visible).toBe(true);
    expect(expiry.children.some((child) => child instanceof ActionSprite)).toBe(true);
    for (let frame = 0; frame < 60; frame++) drawCombatEffects(info);
    expect(playback).toHaveBeenCalledTimes(3);
  });

  it.each(["muted", "initial snapshot"])(
    "does not replay a suppressed disappearance after a %s transition",
    (reason) => {
      const playback = vi.spyOn(audio, "playPreloadedAudio").mockResolvedValue(undefined);
      const info = createSoundInfo();
      info.battle.groundEffects[0]!.appearSfx = "";
      drawCombatEffects(info);
      info.battle.groundEffects[0]!.power = 0;
      info.sfxEnabled = reason !== "muted";
      info.animationId = reason === "initial snapshot" ? 0 : 1;
      drawCombatEffects(info);
      info.sfxEnabled = true;
      info.animationId = 2;
      for (let frame = 0; frame < 60; frame++) drawCombatEffects(info);
      expect(playback).not.toHaveBeenCalled();
    },
  );
});
