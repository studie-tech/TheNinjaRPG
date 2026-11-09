import { describe, expect, it, mock, vi } from "bun:test";
import { readFileSync } from "node:fs";
import {
  BufferImageSource,
  Container,
  Matrix,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js";
import sharp from "sharp";
import {
  bakedShadowBasis,
  bakedShadowBounds,
  bakedShadowKey,
  bakedShadowTransform,
  hasBakedShadow,
  loadBakedShadowAtlas,
  placeBakedShadow,
} from "@/libs/rendering/bakedShadowAtlas";
import { createBakedVillageLighting } from "@/libs/rendering/bakedVillageLighting";
import sources from "@/libs/rendering/bakedWorldSources.json";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { WORLD_ASSET_SOURCES } from "@/libs/rendering/worldAssetSources";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import { worldArtDirectory, worldArtFile } from "../../setup/worldArt";

const first = () => {
  const entry = Object.entries(sources)[0];
  if (!entry) throw Error("Baked asset fixture missing");
  return entry;
};
const texture = (width: number, height: number) =>
  new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array(width * height * 4),
      width,
      height,
    }),
  });

describe("prebaked world assets", () => {
  it("keeps fitted wall foundations while casting in a common world light basis", async () => {
    for (const [key] of Object.entries(sources).filter(
      ([key]) => JSON.parse(key).length === 5,
    )) {
      const [image, frame, , material, basis] = JSON.parse(key);
      const original = texture(1024, 1024),
        view = new Texture({
          source: original.source,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
        });
      const shadowTexture = texture(1024, 1024),
        glow = texture(1024, 1024),
        scale = 0.25;
      const description = {
        id: "wall",
        kind: "village_wall_panel",
        image,
        worldMaterial: material,
        size: frame.height * scale,
        width: frame.width * scale * basis[0],
        shearY: basis[1] / basis[0],
        shadowCaster: "wall",
        x: 100,
        y: -40,
        groundY: -40,
      } as WorldSpriteDescription;
      const sprite = new Sprite(view);
      sprite.anchor.set(0.4, 0.7);
      const pose = new Matrix(basis[0] * scale, basis[1] * scale, 0, -scale, 100, -40);
      const game = {
        assets: {
          acquireTexture: (path: string) => ({
            resource: Promise.resolve(
              Object.values(sources).some(
                (source) => "emission" in source && source.emission === path,
              )
                ? glow
                : shadowTexture,
            ),
            release() {},
          }),
        },
        signal: new AbortController().signal,
        isDisposed: () => false,
      } as unknown as GameRenderer;
      try {
        expect(bakedShadowKey(view, description)).toBe(key);
        expect(bakedShadowBasis(view, description)).toEqual(basis);
        const atlas = await loadBakedShadowAtlas(game, key),
          m = bakedShadowTransform(atlas, sprite, pose);
        expect(m.b).toBeCloseTo(0, 6);
        expect(m.c).toBeCloseTo(0, 6);
        expect(m.a / ((atlas.width * frame.height) / atlas.cellWidth)).toBeCloseTo(
          scale,
          6,
        );
        expect(-m.d / ((atlas.height * frame.height) / atlas.cellHeight)).toBeCloseTo(
          scale,
          6,
        );
        const zero = m.apply({
          x: (-atlas.minX / atlas.width) * atlas.cellWidth,
          y: (-atlas.minY / atlas.height) * atlas.cellHeight,
        });
        const anchor = pose.apply({
          x: -sprite.anchor.x * frame.width,
          y: -sprite.anchor.y * frame.height,
        });
        expect(zero.x).toBeCloseTo(anchor.x, 6);
        expect(zero.y).toBeCloseTo(anchor.y, 6);
        atlas.destroy();
        atlas.releaseTextures();
      } finally {
        sprite.destroy();
        view.destroy(false);
        original.destroy(true);
        shadowTexture.destroy(true);
        glow.destroy(true);
      }
    }
  });
  it.skipIf(!worldArtDirectory)(
    "retains canopy depth and occupied pixels in every baked compass direction",
    async () => {
      for (const width of [124.5, 110]) {
        const entry = Object.entries(sources).find(([key]) => {
          const [image, frame] = JSON.parse(key);
          return (
            image === WORLD_ASSET_SOURCES["/world-art/woodland-village.webp"]?.image &&
            frame.width === width
          );
        });
        expect(entry).toBeDefined();
        const [key, source] = entry!;
        const { data, info } = await sharp(readFileSync(worldArtFile(source.atlas)))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const cellWidth = source.cellWidth,
          cellHeight = source.cellHeight;
        for (let direction = 0; direction < 8; direction++) {
          let x0 = cellWidth,
            y0 = cellHeight,
            x1 = -1,
            y1 = -1;
          const [fx, fy, w, h] = source.directions[direction]!.frame;
          const [tx, ty] = source.directions[direction]!.trim;
          for (let iy = 0; iy < h!; iy++)
            for (let ix = 0; ix < w!; ix++) {
              const x = ix + tx!,
                y = iy + ty!;
              if (data[((fy! + iy) * info.width + fx! + ix) * 4 + 3]! >= 128) {
                x0 = Math.min(x0, x);
                x1 = Math.max(x1, x);
                y0 = Math.min(y0, y);
                y1 = Math.max(y1, y);
              }
            }
          expect(x1 - x0).toBeGreaterThan(2);
          expect(y1 - y0).toBeGreaterThan(2);
          if (direction === 0 || direction === 4)
            expect(((y1 - y0) * 2) / (x1 - x0)).toBeGreaterThan(0.2);
        }
        const [, frame] = JSON.parse(key);
        const original = texture(627, 627),
          view = new Texture({
            source: original.source,
            frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
          });
        try {
          expect(
            hasBakedShadow(view, {
              image: "/world-art/woodland-village.webp",
            } as WorldSpriteDescription),
          ).toBe(true);
        } finally {
          view.destroy(false);
          original.destroy(true);
        }
      }
    },
  );
  it.skipIf(!worldArtDirectory)(
    "publishes every compass mask as a trimmed view within bounded shared pages",
    async () => {
      const pages = new Map<string, { width: number; height: number }>();
      for (const source of Object.values(sources)) {
        let page = pages.get(source.atlas);
        if (!page) {
          const m = await sharp(readFileSync(worldArtFile(source.atlas))).metadata();
          page = { width: m.width!, height: m.height! };
          pages.set(source.atlas, page);
        }
        expect(page.width).toBeLessThanOrEqual(1024);
        expect(page.height).toBeLessThanOrEqual(1024);
        expect(source.directions).toHaveLength(8);
        for (const direction of source.directions) {
          const [x, y, w, h] = direction.frame,
            [tx, ty, tw, th] = direction.trim;
          expect(x! + w!).toBeLessThanOrEqual(page.width);
          expect(y! + h!).toBeLessThanOrEqual(page.height);
          expect([w, h]).toEqual([tw, th]);
          expect(tx! + tw!).toBeLessThanOrEqual(source.cellWidth);
          expect(ty! + th!).toBeLessThanOrEqual(source.cellHeight);
        }
        if ("emission" in source) {
          const m = await sharp(readFileSync(worldArtFile(source.emission))).metadata();
          const [x, y, w, h] = source.emissionFrame;
          expect(x! + w!).toBeLessThanOrEqual(m.width!);
          expect(y! + h!).toBeLessThanOrEqual(m.height!);
          expect(source.emissionBytes).toBe(w! * h! * 4);
          expect(source.emitters.length).toBeGreaterThan(0);
        }
      }
      expect(pages.size).toBeLessThan(40);
    },
  );

  it("keeps every published footprint fixed while one opaque mask follows the light", async () => {
    const page = texture(1024, 1024);
    const game = {
      assets: {
        acquireTexture: () => ({ resource: Promise.resolve(page), release() {} }),
      },
      signal: new AbortController().signal,
      isDisposed: () => false,
    } as unknown as GameRenderer;
    try {
      for (const [key] of Object.entries(sources)) {
        const [, frame, , , authoredBasis] = JSON.parse(key);
        const basis = authoredBasis ?? [1, 0, 0, -1];
        const original = texture(frame.x + frame.width, frame.y + frame.height);
        const view = new Texture({
          source: original.source,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
        });
        const sprite = new Sprite(view),
          shadow = new Sprite();
        sprite.anchor.set(0.37, 0.88);
        const pose = new Matrix(...basis);
        for (const axis of ["a", "b", "c", "d"] as const) pose[axis] *= 0.4;
        pose.tx = 123;
        pose.ty = -57;
        pose.prepend(new Matrix(0.85, 0.2, -0.1, 1.3, 20, 15));
        const atlas = await loadBakedShadowAtlas(game, key, false);
        try {
          const matrix = bakedShadowTransform(atlas, sprite, pose);
          const corners = [
            [0, 0],
            [atlas.cellWidth, 0],
            [0, atlas.cellHeight],
            [atlas.cellWidth, atlas.cellHeight],
          ].map(([x, y]) => matrix.apply({ x: x!, y: y! }));
          const bounds = bakedShadowBounds(atlas, matrix);
          expect(bounds.minX).toBeCloseTo(Math.min(...corners.map((p) => p.x)), 6);
          expect(bounds.maxX).toBeCloseTo(Math.max(...corners.map((p) => p.x)), 6);
          expect(bounds.minY).toBeCloseTo(Math.min(...corners.map((p) => p.y)), 6);
          expect(bounds.maxY).toBeCloseTo(Math.max(...corners.map((p) => p.y)), 6);
          // A source ground point is expressed in the bake's fixed frame, independent of the light.
          const foot = pose.apply({
            x: frame.width * (0.5 - sprite.anchor.x),
            y: frame.height * (1 - sprite.anchor.y),
          });
          const ground = new Matrix(...basis).apply({
            x: frame.width * 0.5,
            y: frame.height,
          });
          const point = {
            x: ((ground.x / frame.height - atlas.minX) / atlas.width) * atlas.cellWidth,
            y:
              ((-ground.y / frame.height - atlas.minY) / atlas.height) *
              atlas.cellHeight,
          };
          for (let direction = 0; direction < 8; direction++) {
            for (const offset of [-0.49, 0, 0.49]) {
              const angle = ((direction + offset) * Math.PI) / 4;
              placeBakedShadow(
                shadow,
                atlas,
                matrix,
                Math.cos(angle),
                Math.sin(angle),
                0.3,
              );
              expect(shadow.texture).toBe(atlas.views[direction]!);
              expect(shadow.visible).toBe(true);
              expect(shadow.alpha).toBe(0.3);
              shadow.updateLocalTransform();
              const contact = shadow.localTransform.apply(point);
              expect(contact.x).toBeCloseTo(foot.x, 5);
              expect(contact.y).toBeCloseTo(foot.y, 5);
            }
          }
          placeBakedShadow(shadow, atlas, matrix, 1, 0, 0);
          expect(shadow.visible).toBe(false);
        } finally {
          atlas.destroy();
          atlas.releaseTextures();
          sprite.destroy();
          shadow.destroy();
          view.destroy(false);
          original.destroy(true);
        }
      }
    } finally {
      page.destroy(true);
    }
  });

  it("invalidates a bake when artwork, material metadata, or the atlas frame changes", () => {
    const [key] = first(),
      [image, frame, orig, material] = JSON.parse(key);
    const source = texture(frame.x + frame.width, frame.y + frame.height);
    const view = new Texture({
      source: source.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
      orig: new Rectangle(orig.x, orig.y, orig.width, orig.height),
    });
    const description: WorldSpriteDescription = {
      id: "building",
      kind: "structure",
      preserveAspect: true,
      image,
      worldMaterial: material,
      size: 1,
      x: 0,
      y: 0,
      groundY: 0,
    };
    try {
      expect(hasBakedShadow(view, description)).toBe(true);
      expect(hasBakedShadow(view, { ...description, image: `${image}-changed` })).toBe(
        false,
      );
      expect(
        hasBakedShadow(view, {
          ...description,
          worldMaterial: { ...material, surfaces: `${material.surfaces}-changed` },
        }),
      ).toBe(false);
      view.frame.x += 1;
      expect(hasBakedShadow(view, description)).toBe(false);
    } finally {
      view.destroy(false);
      source.destroy(true);
    }
  });

  it("loads every direction together without a renderer or live shadow calculation and releases only its views", async () => {
    const [key, metadata] = first(),
      atlas = texture(1024, 1024),
      emission = texture(1024, 1024);
    const load = mock(async (path: string) =>
      path === metadata.atlas ? atlas : emission,
    );
    const game = {
      assets: {
        acquireTexture: (path: string) => ({ resource: load(path), release: vi.fn() }),
      },
      signal: new AbortController().signal,
      isDisposed: () => false,
    } as unknown as GameRenderer;
    try {
      const result = await loadBakedShadowAtlas(game, key);
      expect(load.mock.calls.map(([path]) => path)).toEqual([
        metadata.atlas,
        ...("emission" in metadata ? [metadata.emission] : []),
      ]);
      expect(result.views).toHaveLength(8);
      expect(new Set(result.views.map((view) => view.source)).size).toBe(1);
      expect(
        result.views.map((view) => [
          view.frame.x,
          view.frame.y,
          view.frame.width,
          view.frame.height,
        ]),
      ).toEqual(metadata.directions.map((d) => d.frame));
      expect(
        result.views.every(
          (view) =>
            view.orig.width === metadata.cellWidth &&
            view.orig.height === metadata.cellHeight,
        ),
      ).toBe(true);
      expect(
        result.views.map((view) => [
          view.trim!.x,
          view.trim!.y,
          view.trim!.width,
          view.trim!.height,
        ]),
      ).toEqual(metadata.directions.map((d) => d.trim));
      result.destroy();
      expect(result.views.every((view) => view.destroyed)).toBe(true);
      expect(atlas.destroyed).toBe(false);
      expect(emission.destroyed).toBe(false);
    } finally {
      atlas.destroy(true);
      emission.destroy(true);
    }
  });

  it("rejects unsupported asset versions before loading textures", async () => {
    const load = mock(async () => Texture.WHITE);
    await expect(
      loadBakedShadowAtlas(
        {
          assets: { acquireTexture: () => ({ resource: load(), release: vi.fn() }) },
        } as unknown as GameRenderer,
        "unknown-version",
      ),
    ).rejects.toThrow("No authored shadow bake");
    expect(load).not.toHaveBeenCalled();
  });

  it("installs cached building masks and warm spill after background loading without a render pass", async () => {
    const canvas = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    const [key, metadata] = first(),
      [image, frame, orig, material] = JSON.parse(key);
    const original = texture(frame.x + frame.width, frame.y + frame.height);
    const view = new Texture({
      source: original.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
      orig: new Rectangle(orig.x, orig.y, orig.width, orig.height),
    });
    const atlas = texture(1024, 1024),
      emission = texture(1024, 1024),
      world = new Container(),
      cleanups: (() => void)[] = [];
    const game = {
      renderer: { resolution: 1 },
      assets: {
        acquireTexture: (path: string) => ({
          resource: Promise.resolve(path === metadata.atlas ? atlas : emission),
          release: vi.fn(),
        }),
      },
      visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
      signal: new AbortController().signal,
      isDisposed: () => false,
      invalidate: () => {},
      own: (cleanup: () => void) => cleanups.push(cleanup),
    } as unknown as GameRenderer;
    try {
      const lighting = createBakedVillageLighting(game, world),
        building = new Sprite(view);
      building.anchor.set(0.5);
      world.addChild(lighting.container, building);
      const release = lighting.register(building, {
        id: "building",
        kind: "structure",
        preserveAspect: true,
        image,
        worldMaterial: material,
        shadowCaster: "building",
        light: 1,
        size: orig.height,
        x: 0,
        y: 0,
        groundY: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      lighting.update(
        { x: 0, y: -0.5, z: 0.866, day: 0 },
        { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 },
      );
      expect(building.children).toHaveLength(1);
      expect(building.children[0]?.visible).toBe(true);
      expect(
        lighting.container.children.some(
          (child) => child.label === "baked-village-glow",
        ),
      ).toBe(false);
      lighting.update(
        { x: 1, y: 0, z: 1, day: 1 },
        { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 },
      );
      const shadow = lighting.container.children.find(
        (child) => child.label === "baked-village-ground",
      )!.children[0] as Sprite;
      shadow.updateLocalTransform();
      const matrix = shadow.localTransform.clone(),
        direction = shadow.texture;
      lighting.update(
        { x: 0.7, y: 0.7, z: 0.6, day: 1 },
        { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 },
      );
      shadow.updateLocalTransform();
      expect(shadow.texture).not.toBe(direction);
      expect(shadow.localTransform).toEqual(matrix);
      release();
      expect(building.children).toHaveLength(0);
    } finally {
      world.destroy({ children: true });
      for (const cleanup of cleanups) cleanup();
      view.destroy(false);
      original.destroy(true);
      atlas.destroy(true);
      emission.destroy(true);
      canvas.mockRestore();
    }
  });
});
