import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { BatchableSprite, BatcherPipe, BufferImageSource, InstructionSet, Matrix, Rectangle, type Renderer, type Shader, Sprite, Texture, type UniformGroup, type WebGLRenderer } from "pixi.js";
import { createWindSprite, updateWindSprites, WindSprite, WindSpritePipe } from "@/libs/rendering/primitives/windSprites";
import { ensureDom } from "../../setup/dom.mjs";

ensureDom();
beforeEach(() => vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null));
afterEach(() => vi.restoreAllMocks());

describe("scenery wind vertex data", () => {
  it.each([false, true])("matches rooted sprite deformation for trimmed artwork: %s", (trimmed) => {
    const texture = new Texture({
      source: new BufferImageSource({ resource: new Uint8Array(20 * 20 * 4), width: 20, height: 20 }),
      frame: new Rectangle(0, 0, trimmed ? 12 : 16, trimmed ? 10 : 16),
      orig: new Rectangle(0, 0, 16, 16),
      ...(trimmed ? { trim: new Rectangle(2, 3, 12, 10) } : {}),
    });
    const batcher = BatcherPipe.getBatcher("worldWindSprite", 8);
    try {
      for (const anchor of [0.5, 1]) for (const mirrored of [false, true]) for (const dx of [-1.25, 0, 2.125]) {
        const sprite = new WindSprite(texture, 6);
        sprite.anchor.set(0.5, anchor);
        sprite.position.set(41.5, 62.25);
        sprite.scale.set(mirrored ? -1.25 : 1.25, -2);
        sprite.rotation = 0.23;
        sprite.skew.y = -0.12;
        sprite.updateLocalTransform();
        const parent = new Matrix(0.7, 0.1, -0.2, -0.5, 120, 250);
        const base = sprite.localTransform.clone();
        const entry = new BatchableSprite();
        entry.renderable = sprite;
        entry.texture = texture;
        entry.bounds = sprite.visualBounds;
        entry.transform = parent.clone().append(base);
        entry.roundPixels = 1;
        const data = new ArrayBuffer(36 * 4);
        const floats = new Float32Array(data), integers = new Uint32Array(data);
        batcher.packQuadAttributes(entry, floats, integers, 0, 2);
        const scaleY = -Math.hypot(base.c - dx / texture.orig.height, base.d);
        sprite.scale.y = scaleY;
        sprite.skew.x = sprite.rotation - Math.atan2(-(base.c - dx / texture.orig.height) / scaleY, base.d / scaleY);
        sprite.position.x += dx * (1 - anchor);
        sprite.updateLocalTransform();
        const expected = parent.clone().append(sprite.localTransform);
        const xs = [entry.bounds.minX, entry.bounds.maxX, entry.bounds.maxX, entry.bounds.minX];
        const ys = [entry.bounds.minY, entry.bounds.minY, entry.bounds.maxY, entry.bounds.maxY];
        for (let vertex = 0; vertex < 4; vertex++) {
          const i = vertex * 9, x = xs[vertex]!, y = ys[vertex]!;
          expect(floats[i]! + floats[i + 7]! * dx).toBeCloseTo(expected.a * x + expected.c * y + expected.tx, 4);
          expect(floats[i + 1]! + floats[i + 8]! * dx).toBeCloseTo(expected.b * x + expected.d * y + expected.ty, 4);
          expect(floats[i + 6]).toBe(6);
          expect(integers[i + 4]).toBe(entry.color);
          expect(integers[i + 5]).toBe((2 << 16) | 1);
          if (!trimmed && vertex >= 2) {
            expect(floats[i + 7]).toBe(0);
            expect(floats[i + 8]).toBe(0);
          }
        }
        sprite.destroy();
      }
    } finally { batcher.destroy({ shader: true }); texture.destroy(true); }
  });

  it("keeps the CPU path available when the renderer has no wind pipe", () => {
    const sprite = createWindSprite({} as Renderer, Texture.EMPTY, 2);
    try {
      expect(sprite).toBeInstanceOf(Sprite);
      expect(sprite).not.toBeInstanceOf(WindSprite);
    } finally { sprite.destroy(); }
  });

  it("binds changing gusts on retained frames and after an instruction-set rebuild", () => {
    const batcher = BatcherPipe.getBatcher("worldWindSprite", 8);
    const samples: number[][] = [];
    const renderer = {
      roundPixels: false,
      renderPipes: { batch: {
        break: vi.fn(),
        addToBatch: (entry: BatchableSprite) => { entry._batcher = batcher; },
      } },
      shader: { bind: (shader: Shader) => samples.push(Array.from((shader.resources.wind as UniformGroup).uniforms.uWind as Float32Array)) },
    } as unknown as WebGLRenderer;
    const pipe = new WindSpritePipe(renderer);
    const sprite = createWindSprite(renderer, Texture.EMPTY, 1) as WindSprite;
    const instructions = new InstructionSet();
    const breeze = (value: number) => ({ large: new Float32Array([value, 0, 0, 0]), small: new Float32Array(4), key: String(value) });
    try {
      pipe.addRenderable(sprite, instructions);
      pipe.addRenderable(sprite, instructions);
      expect(instructions.instructionSize).toBe(1);
      expect(renderer.renderPipes.batch.break).toHaveBeenCalledTimes(1);
      const first = instructions.instructions[0] as Parameters<WindSpritePipe["execute"]>[0];
      updateWindSprites(renderer, breeze(1));
      pipe.execute(first);
      updateWindSprites(renderer, breeze(2));
      pipe.execute(first);
      expect(samples).toEqual([[1, 0, 0, 0], [2, 0, 0, 0]]);
      instructions.reset();
      pipe.addRenderable(sprite, instructions);
      expect(instructions.instructionSize).toBe(1);
      const next = instructions.instructions[0] as Parameters<WindSpritePipe["execute"]>[0];
      expect(next).not.toBe(first);
      updateWindSprites(renderer, breeze(3));
      pipe.execute(next);
      expect(samples.at(-1)).toEqual([3, 0, 0, 0]);
    } finally { pipe.destroy(); sprite.destroy(); batcher.destroy({ shader: true }); }
  });
});
