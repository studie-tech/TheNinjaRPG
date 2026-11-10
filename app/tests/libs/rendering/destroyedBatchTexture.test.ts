import { describe, expect, it } from "bun:test";
import {
  BatchableSprite,
  DefaultBatcher,
  GlTextureSystem,
  InstructionSet,
  Sprite,
  Texture,
  TextureSource,
} from "pixi.js";

const quad = (texture: Texture) => {
  const element = new BatchableSprite();
  element.renderable = new Sprite(texture);
  element.texture = texture;
  element.bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  element.transform = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: 0,
    ty: 0,
  } as BatchableSprite["transform"];
  return element;
};

describe("destroyed sources in retained batches", () => {
  it("keeps a moved-on sprite's old source listed in its batch", () => {
    // Pixi swaps a texture in place when the new source is already in the batch, so
    // the previous source stays listed until the batch is rebuilt.
    const shared = new Texture({ source: new TextureSource({ width: 4, height: 4 }) });
    const previous = new Texture({
      source: new TextureSource({ width: 4, height: 4 }),
    });
    const batcher = new DefaultBatcher({ maxTextures: 4 });
    const fighter = quad(previous);
    batcher.begin();
    batcher.add(quad(shared));
    batcher.add(fighter);
    batcher.break(new InstructionSet());
    batcher.finish(new InstructionSet());
    expect(batcher.checkAndUpdateTexture(fighter, shared)).toBe(true);
    const batch = fighter._batch!;
    expect([...batch.textures.textures].slice(0, batch.textures.count)).toContain(
      previous.source,
    );
    batcher.destroy();
  });

  it("binds the empty texture for a destroyed source instead of reading its style", () => {
    const source = new TextureSource({ width: 4, height: 4 });
    source.destroy();
    const bound: TextureSource[] = [];
    const system = Object.assign(Object.create(GlTextureSystem.prototype), {
      _useSeparateSamplers: false,
      bindSource: (next: TextureSource) => bound.push(next),
    }) as GlTextureSystem;
    system.bind(source, 0);
    expect(bound).toEqual([Texture.EMPTY.source]);
  });

  it("never re-creates a destroyed source from its null style on other bind paths", () => {
    // Render targets, unbind and text uploads reach getGlSource without bind's guard.
    const source = new TextureSource({ width: 4, height: 4 });
    source.destroy();
    const created: TextureSource[] = [];
    const system = Object.assign(Object.create(GlTextureSystem.prototype), {
      _renderer: { uid: 9001, gc: { now: 0 } },
      _initSource: (next: TextureSource) => {
        created.push(next);
        return { texture: "empty" };
      },
    }) as { getGlSource: (source: TextureSource) => unknown };
    expect(system.getGlSource(source)).toEqual({ texture: "empty" });
    expect(created).toEqual([Texture.EMPTY.source]);
  });

  it("skips style parameters for a source without a style", () => {
    const source = new TextureSource({ width: 4, height: 4 });
    source.destroy();
    expect(source.style).toBeNull();
    const system = Object.assign(Object.create(GlTextureSystem.prototype), {
      getGlSource: () => {
        throw new Error("style update must not touch the GPU texture");
      },
    }) as { updateStyle: (source: TextureSource, firstCreation: boolean) => void };
    expect(() => system.updateStyle(source, false)).not.toThrow();
  });
});
