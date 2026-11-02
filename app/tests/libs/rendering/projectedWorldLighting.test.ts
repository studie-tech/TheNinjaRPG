import { describe, expect, it } from "bun:test";
import { Container, Sprite, Texture } from "pixi.js";
import { createProjectedWorldLighting } from "@/libs/rendering/projectedWorldLighting";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { worldSunlight } from "@/libs/rendering/worldSunlight";

const viewport = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
const fixture = () => {
  const cleanups: (() => void)[] = [];
  const game = { visualEffects: { lighting: true, shadows: true, animations: true },
    renderer: { resolution: 1 }, own: (cleanup: () => void) => cleanups.push(cleanup) } as unknown as GameRenderer;
  const world = new Container(), owner = new Container();
  const lighting = createProjectedWorldLighting(game, world);
  world.addChild(owner, lighting.container);
  const source = new Sprite(Texture.WHITE);
  source.anchor.set(0.5); source.position.set(20, 30); source.width = 20; source.height = 40;
  owner.addChild(source);
  const register = () => lighting.register(source, { id: "tree", kind: "decoration", image: "tree.png", x: 20, y: 30, size: 40, groundY: 10, shadowCaster: "canopy" });
  return { game, world, owner, source, lighting, register, dispose: () => { for (const cleanup of cleanups) cleanup(); world.destroy({ children: true }); } };
};

describe("projected world lighting", () => {
  it("retains a shared artwork silhouette while camera transforms change", async () => {
    const f = fixture();
    try {
      const release = f.register(); await release.ready;
      f.lighting.update(worldSunlight(), viewport);
      const shadow = f.lighting.container.children[0]!.children[0] as Sprite;
      shadow.updateLocalTransform();
      const pose = shadow.localTransform.clone();
      expect(shadow.texture).toBe(f.source.texture);
      f.world.position.set(-100, 80); f.world.scale.set(2, -2);
      f.lighting.update(worldSunlight(), viewport);
      shadow.updateLocalTransform();
      expect(shadow.localTransform.equals(pose)).toBe(true);
      release(); expect(shadow.destroyed).toBe(true);
      expect(f.source.texture.destroyed).toBe(false);
    } finally { f.dispose(); }
  });
  it("tracks translated owners after invalidation and keeps shadows below scenery", () => {
    const f = fixture();
    try {
      f.register();
      f.lighting.container.addChild(new Container(), new Container());
      f.lighting.update(worldSunlight(), viewport);
      const ground = f.lighting.container.children[1]!;
      const shadow = ground.children[0] as Sprite;
      const x = shadow.x, y = shadow.y;
      f.owner.position.set(120, 70); f.lighting.invalidate();
      f.lighting.update(worldSunlight(), viewport);
      expect(shadow.x).toBeCloseTo(x + 120);
      expect(shadow.y).toBeCloseTo(y + 70);
      expect(f.lighting.container.children[1]).toBe(ground);
    } finally { f.dispose(); }
  });
  it("honors shadow and lighting preferences without allocating physical targets", () => {
    const f = fixture();
    try {
      f.register(); f.lighting.update(worldSunlight(), viewport);
      const ground = f.lighting.container.children[0]!;
      expect(ground.visible).toBe(true);
      f.game.visualEffects.shadows = false;
      f.lighting.update(worldSunlight(), viewport); expect(ground.visible).toBe(false);
      f.game.visualEffects.shadows = true; f.game.visualEffects.lighting = false;
      f.lighting.update(worldSunlight(), viewport); expect(ground.visible).toBe(false);
      expect(f.lighting.container.filters?.[0]?.enabled).toBe(false);
    } finally { f.dispose(); }
  });
  it("samples sun direction by minute while preserving dawn and dusk luminance", () => {
    const first = worldSunlight(new Date(451000), 60000), second = worldSunlight(new Date(479000), 60000);
    expect([second.x, second.y, second.z]).toEqual([first.x, first.y, first.z]);
    const before = worldSunlight(new Date(885000), 60000), after = worldSunlight(new Date(899000), 60000);
    expect([before.x, before.y, before.z]).toEqual([after.x, after.y, after.z]);
    expect(after.day).toBeLessThan(before.day);
  });
});
