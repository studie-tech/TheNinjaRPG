import { expect, it, vi } from "bun:test";
import { BufferImageSource, Texture } from "pixi.js";
import type { LpcCatalog } from "@/libs/lpc/catalog";
import type { CompositeCell } from "@/libs/rendering/characterComposites";
import { createLpcCharacter } from "@/libs/rendering/primitives/character";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { SpriteAppearance } from "@/validators/lpc";

it("composes real atlas buffers with the selected skin, body replacement and mirrored hex facing", async () => {
  const textures = new Map<string, Texture>();
  const image = (name: string, values: { x: number; color: number[] }[]) => {
    const pixels = new Uint8Array(128 * 128 * 4);
    for (const { x, color } of values) pixels.set(color, (63 * 128 + x) * 4);
    textures.set(
      name,
      new Texture({
        source: new BufferImageSource({ resource: pixels, width: 128, height: 128 }),
      }),
    );
    return name;
  };
  const body = image("body", [
    { x: 63, color: [240, 30, 20, 255] },
    { x: 64, color: [240, 30, 20, 255] },
  ]);
  const dark = image("body-dark", [
    { x: 63, color: [40, 50, 60, 255] },
    { x: 64, color: [40, 50, 60, 255] },
  ]);
  const bodyDepth = image("body-depth", [
    { x: 63, color: [0, 0, 161, 255] },
    { x: 64, color: [0, 0, 164, 255] },
  ]);
  const shirt = image("shirt", [{ x: 63, color: [0, 240, 0, 255] }]);
  const shirtDepth = image("shirt-depth", [{ x: 63, color: [0, 1, 65, 255] }]);
  const catalog: LpcCatalog = {
    palettes: [{ channel: "skin", images: { black: dark } }],
    layouts: [
      {
        cell: 128,
        pixelsPerUnit: 128,
        columns: 1,
        clips: { stand: [[0], [0], [0], [0]], walk: [[0], [0], [0], [0]] },
        facings: [
          { row: 0, mirror: false },
          { row: 2, mirror: true },
          { row: 3, mirror: false },
          { row: 2, mirror: false },
          { row: 1, mirror: true },
          { row: 1, mirror: false },
        ],
      },
    ],
    designs: {
      body: {
        category: "body",
        replacementSlots: [],
        replacesBodyParts: ["torso", "hands"],
        defaultColor: "light",
        defaultEyes: "blue",
      },
      shirt: {
        category: "equipment",
        replacementSlots: ["shirt"],
        replacesBodyParts: ["torso"],
        defaultColor: "gray",
        defaultEyes: "blue",
      },
    },
    entries: {
      "body/male/light/blue": [
        {
          image: body,
          depth: bodyDepth,
          bodyRegions: true,
          palette: 0,
          z: 0,
          layout: 0,
        },
      ],
      "shirt/male/gray/blue": [
        { image: shirt, depth: shirtDepth, bodyRegions: true, z: 1, layout: 0 },
      ],
    },
  };
  const rasterizers = new Map<string, () => Uint8Array>();
  const acquire = vi.fn((key: string, _rig: unknown, rasterize: () => Uint8Array) => {
    rasterizers.set(key, rasterize);
    return { key, texture: Texture.EMPTY } as CompositeCell;
  });
  const cleanups: (() => void)[] = [];
  const game = {
    lpcCatalog: catalog,
    assets: {
      texture: vi.fn(async (url: string) => {
        const texture = textures.get(url);
        if (!texture) throw Error("Unknown image");
        return texture;
      }),
    },
    signal: new AbortController().signal,
    isDisposed: () => false,
    own: (cleanup: () => void) => cleanups.push(cleanup),
    characterComposites: {
      cellSize: 128,
      pixelsPerUnit: 128,
      epoch: () => 0,
      acquire,
      release: vi.fn(),
    },
  } as unknown as GameRenderer;
  const appearance: SpriteAppearance = {
    version: 1,
    body: "male",
    layers: [
      { profile: "body", color: "black", slot: "body" },
      { profile: "shirt", color: "gray", slot: "CHEST" },
    ],
  };
  try {
    const actor = await createLpcCharacter(game, appearance);
    const first = [...rasterizers.values()].at(-1)!();
    const pixel = (data: Uint8Array, x: number) => [
      ...data.slice((63 * 128 + x) * 4, (63 * 128 + x) * 4 + 4),
    ];
    expect(pixel(first, 63)).toEqual([0, 240, 0, 255]);
    expect(pixel(first, 64)).toEqual([40, 50, 60, 255]);
    expect(actor.sprite.children[0]?.scale.x).toBe(1 / 128);
    actor.render({ now: 100, delta: 0, reducedMotion: false }, "walk", 1, true);
    const mirrored = [...rasterizers.values()].at(-1)!();
    expect(pixel(mirrored, 63)).toEqual([40, 50, 60, 255]);
    expect(pixel(mirrored, 64)).toEqual([0, 240, 0, 255]);
    const clothedKey = acquire.mock.calls[0]![0];
    await createLpcCharacter(game, { ...appearance, layers: [appearance.layers[0]!] });
    expect(acquire.mock.calls.at(-1)?.[0]).not.toBe(clothedKey);
    const bare = [...rasterizers.values()].at(-1)!();
    expect(pixel(bare, 63)).toEqual([40, 50, 60, 255]);
    expect(game.assets.texture).not.toHaveBeenCalledWith("body", 0, "nearest");
    catalog.layouts[0] = {
      ...catalog.layouts[0]!,
      pixelsPerUnit: 100,
      ground: { x: 64, y: 105 },
    };
    game.characterComposites!.pixelsPerUnit = 100;
    const calibrated = await createLpcCharacter(game, appearance);
    expect(calibrated.layers[0]?.sprite.y).toBeCloseTo(0.0275);
    expect(calibrated.layers[0]?.sprite.scale.y).toBe(1 / 100);
    expect(calibrated.sprite.children[0]?.scale.y).toBe(1 / 100);
    const shifted = [...rasterizers.values()].at(-1)!();
    expect([...shifted.slice((66 * 128 + 63) * 4, (66 * 128 + 63) * 4 + 4)]).toEqual([
      0, 240, 0, 255,
    ]);
  } finally {
    for (const cleanup of cleanups) cleanup();
    for (const texture of textures.values()) texture.destroy(true);
  }
});
