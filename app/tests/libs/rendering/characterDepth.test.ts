import { describe, expect, it } from "bun:test";
import {
  type CharacterDepthLayer,
  composeCharacterPixels,
} from "@/libs/rendering/characterDepth";
import {
  CHARACTER_COMPOSITE_CELL,
  CHARACTER_FOOT_Y,
  CHARACTER_PIXELS_PER_UNIT,
  characterFrameOffset,
} from "@/libs/rendering/characterFrame";

const layer = (
  color: [number, number, number, number],
  distances: number[],
  z = 0,
): CharacterDepthLayer => {
  const depth = new Uint8Array(16),
    pixels = new Uint8Array(16);
  distances.forEach((value, index) => {
    depth.set([value >>> 16, (value >>> 8) & 255, value & 255, 255], index * 4);
    pixels.set(color, index * 4);
  });
  return {
    pixels,
    depth,
    width: 2,
    height: 2,
    pixelsPerUnit: 2,
    mirror: false,
    z,
    frame: { x: 0, y: 0, width: 2, height: 2, size: 2 },
  };
};

describe("character camera-depth composition", () => {
  it("preserves adjacent native detail pixels instead of collapsing them to the lower density", () => {
    const pixels = new Uint8Array(4 * 4 * 4);
    const depth = new Uint8Array(pixels.length);
    for (let i = 0; i < 16; i++) {
      pixels.set([i * 16, 255 - i * 16, 64, 255], i * 4);
      depth.set([0, 1, 0, 255], i * 4);
    }
    const source: CharacterDepthLayer = {
      pixels,
      depth,
      width: 4,
      height: 4,
      pixelsPerUnit: CHARACTER_PIXELS_PER_UNIT,
      mirror: false,
      z: 0,
      frame: { x: 0, y: 0, width: 4, height: 4, size: 320, trim: { x: 158, y: 158 } },
    };
    const native = composeCharacterPixels(
      [source],
      CHARACTER_COMPOSITE_CELL,
      CHARACTER_PIXELS_PER_UNIT,
    );
    for (let y = 0; y < 4; y++)
      expect(
        native.slice(((158 + y) * 320 + 158) * 4, ((158 + y) * 320 + 162) * 4),
      ).toEqual(pixels.slice(y * 16, (y + 1) * 16));
    const lower = composeCharacterPixels([source], 192, 100);
    expect([...lower].filter((v, i) => i % 4 === 3 && v).length).toBeLessThan(16);
    expect(CHARACTER_COMPOSITE_CELL / CHARACTER_PIXELS_PER_UNIT).toBeCloseTo(192 / 100);
  });
  it("aligns an authored ground contact in colour and depth without changing the unit actor footer", () => {
    const source = layer([255, 0, 0, 255], [16, 16, 16, 16]);
    source.frame.ground = { x: 1, y: 1 + CHARACTER_FOOT_Y * 2 - 1 };
    expect(characterFrameOffset(source.frame, 2)).toEqual({ x: 0, y: 0.5 });
    expect([...composeCharacterPixels([source], 2, 2)]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255,
    ]);
    source.frame.ground.x = 0.5;
    expect(characterFrameOffset(source.frame, 2).x).toBe(0.25);
    expect(characterFrameOffset(source.frame, 2, true).x).toBe(-0.25);
  });
  it("removes replaced mesh sections while retaining accessories and sorting by physical depth", () => {
    const body = layer([255, 0, 0, 255], [160 | 1, 160 | 4, 160 | 0, 160 | 1]);
    body.bodyRegions = new Set([1]);
    const shirt = layer([0, 255, 0, 255], [320 | 1, 320 | 1, 320 | 1, 160 | 1], 5);
    shirt.bodyRegions = new Set();
    expect([...composeCharacterPixels([body, shirt], 2, 2)]).toEqual([
      0, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255,
    ]);
    body.bodyRegions = new Set();
    body.depth[2] = 160 | 7;
    shirt.depth.set([0, 0, 160 | 1, 255], 0);
    // Region IDs carry no physical ordering: coplanar surfaces still use authored z.
    expect([...composeCharacterPixels([body, shirt], 2, 2)].slice(0, 4)).toEqual([
      0, 255, 0, 255,
    ]);
  });
  it("places the same weapon in front of one sleeve and behind the other", () => {
    const shirt = layer([240, 30, 20, 255], [300, 900, 300, 900], 99);
    const sword = layer([10, 40, 230, 255], [600, 600, 600, 600], -99);
    const pixels = composeCharacterPixels([shirt, sword], 2, 2);
    expect([...pixels]).toEqual([
      240, 30, 20, 255, 10, 40, 230, 255, 240, 30, 20, 255, 10, 40, 230, 255,
    ]);
    expect(composeCharacterPixels([sword, shirt], 2, 2)).toEqual(pixels);
  });
  it("compares all three depth bytes and uses authored z only for coplanar surfaces", () => {
    const far = layer([255, 0, 0, 255], [65536, 65536, 65536, 65536], 100);
    const near = layer([0, 255, 0, 255], [65535, 65535, 65535, 65535], -100);
    expect([...composeCharacterPixels([near, far], 2, 2)].slice(0, 4)).toEqual([
      0, 255, 0, 255,
    ]);
    near.depth = far.depth;
    expect([...composeCharacterPixels([near, far], 2, 2)].slice(0, 4)).toEqual([
      255, 0, 0, 255,
    ]);
  });
  it("ignores empty depth and transparent colour, and blends translucent details above the nearest body", () => {
    const body = layer([0, 0, 255, 255], [100, 100, 100, 100]);
    const glass = layer([255, 0, 0, 128], [50, 150, 0, 50]);
    glass.pixels[15] = 0;
    const pixels = composeCharacterPixels([glass, body], 2, 2);
    expect([...pixels]).toEqual([
      128, 0, 127, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255,
    ]);
    expect([...composeCharacterPixels([glass], 2, 2)].slice(0, 4)).toEqual([
      255, 0, 0, 128,
    ]);
  });
  it("reflects the colour and depth together and aligns trimmed layers inside a larger cell", () => {
    const source = layer([255, 0, 0, 255], [1, 2, 3, 4]);
    source.pixels.set([0, 255, 0, 255], 4);
    source.mirror = true;
    expect([...composeCharacterPixels([source], 2, 2)].slice(0, 8)).toEqual([
      0, 255, 0, 255, 255, 0, 0, 255,
    ]);
    source.mirror = false;
    source.frame = { ...source.frame, size: 4, trim: { x: 1, y: 1 } };
    const large = composeCharacterPixels([source], 4, 2);
    expect([...large.slice(0, 20)]).toEqual(new Array(20).fill(0));
    expect([...large.slice(20, 24)]).toEqual([255, 0, 0, 255]);
    expect([...large.slice(24, 28)]).toEqual([0, 255, 0, 255]);
  });
  it("preserves world scale when a denser sprite is composited and rejects mismatched numerical buffers", () => {
    const source = layer([255, 0, 0, 255], [1, 1, 1, 1]);
    expect(
      [...composeCharacterPixels([source], 4, 4)].filter(
        (_, i) => i % 4 === 3 && _ === 255,
      ),
    ).toHaveLength(16);
    source.depth = new Uint8Array(4);
    expect(() => composeCharacterPixels([source], 2, 2)).toThrow(
      "dimensions must match",
    );
  });
});
