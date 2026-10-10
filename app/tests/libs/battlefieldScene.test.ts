
import { describe, expect, it } from "bun:test";
import {
  battlefieldSceneOf,
  sceneAssetIds,
  sceneSoundIds,
} from "@/libs/contentReview/battlefield";

const tag = (visuals: Record<string, string>, target?: string) => ({
  type: "damage",
  power: 10,
  ...(target ? { target } : {}),
  staticAssetPath: "",
  staticAnimation: "",
  appearAnimation: "",
  disappearAnimation: "",
  ...visuals,
});

const placements = (scene: ReturnType<typeof battlefieldSceneOf>) =>
  scene?.effects.map((effect) => effect.placement);

describe("battlefieldSceneOf", () => {
  it("puts a user-targeted jutsu's tags on the target and SELF tags on the caster", () => {
    const scene = battlefieldSceneOf("JUTSU", "j1", {
      target: "OTHER_USER",
      effects: [
        tag({ appearAnimation: "hit" }, "INHERIT"),
        tag({ staticAnimation: "aura" }, "SELF"),
        tag({ appearAnimation: "burn" }),
      ],
    });
    expect(placements(scene)).toEqual(["target", "caster", "target"]);
    expect(sceneAssetIds(scene)).toEqual(["hit", "aura", "burn"]);
  });

  it("leaves a ground jutsu's inherited tags on the tile", () => {
    const scene = battlefieldSceneOf("JUTSU", "j2", {
      target: "EMPTY_GROUND",
      effects: [
        tag({ staticAssetPath: "water-field" }, "INHERIT"),
        tag({ appearAnimation: "cast" }, "SELF"),
      ],
    });
    expect(placements(scene)).toEqual(["ground", "caster"]);
  });

  it("keeps bloodline and worn-item effects on their owner", () => {
    const effects = [tag({ staticAnimation: "glow" }, "INHERIT")];
    expect(placements(battlefieldSceneOf("BLOODLINE", "b1", { effects }))).toEqual([
      "caster",
    ]);
    expect(
      placements(
        battlefieldSceneOf("ITEM", "i1", { itemType: "ARMOR", target: "OTHER_USER", effects }),
      ),
    ).toEqual(["caster"]);
    expect(
      placements(
        battlefieldSceneOf("ITEM", "i2", {
          itemType: "WEAPON",
          target: "OTHER_USER",
          effects,
        }),
      ),
    ).toEqual(["target"]);
  });

  it("keeps sound-only effects and lists sounds apart from what it draws", () => {
    const scene = battlefieldSceneOf("JUTSU", "j4", {
      target: "OTHER_USER",
      effects: [
        tag({ appearAnimation: "zap", appearSfx: "zap-sound" }),
        tag({ disappearSfx: "fizzle" }, "SELF"),
      ],
    });
    expect(placements(scene)).toEqual(["target", "caster"]);
    expect(sceneAssetIds(scene)).toEqual(["zap"]);
    expect(sceneSoundIds(scene)).toEqual(["zap-sound", "fizzle"]);
  });

  it("skips effects that neither draw nor sound, and entities that draw nothing", () => {
    expect(battlefieldSceneOf("JUTSU", "j3", { target: "SELF", effects: [tag({})] })).toBe(
      null,
    );
    expect(battlefieldSceneOf("BADGE", "b1", { name: "Brave" })).toBe(null);
  });

  it("draws an animation asset on a tile and on the target, from suggested values", () => {
    const scene = battlefieldSceneOf("GAME_ASSET", "a1", {
      type: "ANIMATION",
      name: "Splash",
      image: "https://example.com/splash.webp",
      frames: "6",
      speed: 80,
    });
    expect(scene?.effects).toEqual([
      expect.objectContaining({ staticAnimation: "a1", placement: "ground" }),
      expect.objectContaining({ appearAnimation: "a1", placement: "target" }),
    ]);
    expect(scene?.assets).toEqual([
      {
        id: "a1",
        name: "Splash",
        image: "https://example.com/splash.webp",
        frames: 6,
        speed: 80,
      },
    ]);
    expect(
      battlefieldSceneOf("GAME_ASSET", "a2", { type: "STATIC" })?.effects[0],
    ).toMatchObject({ staticAssetPath: "a2", placement: "ground" });
    expect(battlefieldSceneOf("GAME_ASSET", "a3", { type: "SFX" })).toBe(null);
  });

  it("stands an AI on the target tile with its own artwork", () => {
    const scene = battlefieldSceneOf("AI", "ai1", {
      avatar: "https://example.com/ai.webp",
      effects: [tag({ staticAnimation: "shield" }, "SELF")],
    });
    expect(scene?.targetAvatar).toBe("https://example.com/ai.webp");
    expect(placements(scene)).toEqual(["target"]);
  });
});
