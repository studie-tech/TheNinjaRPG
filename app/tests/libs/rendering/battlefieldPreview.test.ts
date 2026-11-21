import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { GameAsset } from "@/drizzle/schema";
import {
  type BattlefieldScene,
  battlefieldSceneOf,
} from "@/libs/contentReview/battlefield";
import { createBattlefieldPreview } from "@/libs/rendering/scenes/battlefieldPreview";
import type { CombatSceneSnapshot } from "@/libs/rendering/scenes/combat";
import * as combat from "@/libs/rendering/scenes/combat";
import * as audio from "@/utils/audio";

let frames: CombatSceneSnapshot[];
let sounds: string[];
const previews: NonNullable<Awaited<ReturnType<typeof createBattlefieldPreview>>>[] =
  [];
beforeEach(() => {
  frames = [];
  sounds = [];
  vi.spyOn(audio, "preloadAudioBuffers").mockResolvedValue(undefined);
  vi.spyOn(combat, "createCombatScene").mockImplementation(async (options) => {
    const seen = new Set<string>();
    const renderAt = async () => {
      const snapshot = options.getSnapshot();
      frames.push(structuredClone(snapshot));
      for (const effect of [
        ...snapshot.battle.groundEffects,
        ...snapshot.battle.usersEffects,
      ]) {
        if (seen.has(effect.id)) continue;
        seen.add(effect.id);
        if (snapshot.sound && effect.appearSfx) options.play(effect.appearSfx, 1);
      }
    };
    return {
      canvas: document.createElement("canvas"),
      grid: {},
      dispose: () => {},
      refresh: () => {
        void renderAt();
      },
      renderAt,
    } as unknown as Awaited<ReturnType<typeof combat.createCombatScene>>;
  });
});
afterEach(() => {
  for (const preview of previews.splice(0)) preview.dispose();
  vi.restoreAllMocks();
});
const preview = async (scene: BattlefieldScene | null, assets: GameAsset[] = []) => {
  if (!scene) throw new Error("Scene did not normalize");
  const result = await createBattlefieldPreview({
    scene,
    assets,
    viewport: "desktop",
    background: "ground",
    onSound: (url) => {
      sounds.push(url);
    },
  });
  if (!result) throw new Error("Preview did not initialize");
  previews.push(result);
  return result;
};
const pattern = {
  origin: "TARGET",
  selection: "ALL",
  coordinates: [{ longitude: -2, latitude: 0 }],
  randomCount: 1,
};

it("keeps TARGET artwork on the authored footprint when the display victim moves", async () => {
  await preview(
    battlefieldSceneOf("JUTSU", "cast", {
      target: "OTHER_USER",
      method: "COORDINATES",
      coordinateTargeting: pattern,
      effects: [
        { type: "damage", appearAnimation: "hit", target: "INHERIT" },
        {
          type: "visual",
          target: "COORDINATES",
          staticAssetPath: "field",
          coordinateTargeting: pattern,
        },
      ],
    }),
  );
  expect(frames.at(-1)?.battle.usersState[1]?.longitude).toBe(7);
  expect(frames.at(-1)?.battle.groundEffects[0]?.longitude).toBe(7);
});
it("skips a caster-tile flight while retaining its ground effect", async () => {
  const result = await preview(
    battlefieldSceneOf("JUTSU", "cast", {
      target: "GROUND",
      method: "COORDINATES",
      coordinateTargeting: {
        ...pattern,
        origin: "CASTER",
        coordinates: [{ longitude: 0, latitude: 0 }],
      },
      effects: [{ type: "damage", target: "INHERIT", projectileAnimation: "bolt" }],
    }),
  );
  expect(result.timeline.arrivalMs).toBe(0);
  const effects = frames.at(-1)!.battle.groundEffects;
  expect(effects).toHaveLength(1);
  expect(effects[0]?.longitude).toBe(2);
  expect(effects[0]?.projectileOnly).not.toBe(true);
});
it("starts a requested audible replay only after the paused preview plays", async () => {
  const result = await preview(
    battlefieldSceneOf("JUTSU", "cast", {
      effects: [{ type: "damage", appearSfx: "cue" }],
    }),
  );
  result.setSound(true);
  await Promise.resolve();
  expect(sounds).toEqual([]);
  result.play();
  await Promise.resolve();
  expect(sounds).toEqual(["cue"]);
});
it("resumes without replay when sound is enabled with restart false", async () => {
  const result = await preview(
    battlefieldSceneOf("JUTSU", "cast", {
      effects: [{ type: "damage", appearSfx: "cue" }],
    }),
  );
  await result.renderAt(450);
  const cycle = result.getPlaybackState().cycle;
  result.setSound(true, { restart: false });
  result.play();
  expect(result.getPlaybackState()).toMatchObject({ elapsedMs: 450, cycle });
  expect(sounds).toEqual([]);
});
it.each([false, true])(
  "checks the native decal texture and any dual-use clip (%s)",
  async (dualUse) => {
    const original = globalThis.Image;
    const urls: string[] = [];
    globalThis.Image = class {
      onload?: () => void;
      onerror?: () => void;
      set src(url: string) {
        urls.push(url);
        queueMicrotask(() =>
          url.includes("width=50") ? this.onload?.() : this.onerror?.(),
        );
      }
    } as unknown as typeof Image;
    try {
      const result = await preview(
        battlefieldSceneOf("JUTSU", "cast", {
          target: "GROUND",
          effects: [
            {
              type: "visual",
              staticAssetPath: "floor",
              groundStyle: "DECAL",
              ...(dualUse ? { appearAnimation: "floor" } : {}),
            },
          ],
        }),
        [
          {
            id: "floor",
            name: "Floor",
            image: "https://uploadthing.b-cdn.net/floor.png",
            frames: 1,
            speed: 1,
          } as GameAsset,
        ],
      );
      expect(await result.whenLoaded()).toEqual(["Floor (floor)"]);
      expect(urls).toContain("https://uploadthing.b-cdn.net/floor.png");
      expect(urls).toHaveLength(dualUse ? 2 : 1);
      if (dualUse)
        expect(urls).toContain("https://uploadthing.b-cdn.net/floor.png?width=50");
    } finally {
      globalThis.Image = original;
    }
  },
);
