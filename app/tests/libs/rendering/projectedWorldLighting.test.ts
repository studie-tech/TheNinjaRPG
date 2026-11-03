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
  it("allocates sunlight silhouettes only when needed and releases offscreen GPU objects", () => {
    const f = fixture();
    try {
      const release = f.register();
      const ground = f.lighting.container.children[0]!;
      f.lighting.update({ ...worldSunlight(), day: 0 }, viewport);
      expect(ground.children).toHaveLength(0);
      f.lighting.update(worldSunlight(), viewport);
      const shadow = ground.children[0] as Sprite;
      f.lighting.update(worldSunlight(), { minX: 10, maxX: 110, minY: 0, maxY: 100 });
      expect(ground.children[0]).toBe(shadow);
      f.lighting.update(worldSunlight(), { minX: 1000, maxX: 1100, minY: 0, maxY: 100 });
      expect(ground.children).toHaveLength(0);
      expect(shadow.destroyed).toBe(true);
      expect(f.source.texture.destroyed).toBe(false);
      f.lighting.update(worldSunlight(), viewport);
      const replacement = ground.children[0] as Sprite;
      expect(replacement).not.toBe(shadow);
      release();
      expect(replacement.destroyed).toBe(true);
    } finally { f.dispose(); }
  });
  it("retains projected pixels that enter the viewport from an offscreen caster", () => {
    const f = fixture();
    try {
      f.source.position.set(-110, 200); f.source.height = 200;
      f.lighting.register(f.source, { id: "long-tree", kind: "decoration", image: "tree.png", x: -110, y: 200, size: 200, groundY: 100, shadowCaster: "canopy" });
      f.lighting.update({ x: -1, y: 0, z: 0.5, day: 1 }, { minX: 0, maxX: 100, minY: 80, maxY: 180 });
      const ground = f.lighting.container.children[0]!;
      expect(ground.children).toHaveLength(1);
      expect((ground.children[0] as Sprite).x).toBe(-110);
    } finally { f.dispose(); }
  });
  it("restores painter order when a previously offscreen silhouette re-enters", () => {
    const f = fixture();
    try {
      f.register();
      const far = new Sprite(Texture.WHITE); far.anchor.set(0.5); far.width = 20; far.height = 40; far.position.set(300, 30); f.owner.addChild(far);
      f.lighting.register(far, { id: "far-tree", kind: "decoration", image: "tree.png", x: 300, y: 30, size: 40, groundY: 10, shadowCaster: "canopy" });
      const ground = f.lighting.container.children[0]!;
      f.lighting.update(worldSunlight(), viewport);
      f.lighting.update(worldSunlight(), { minX: 250, maxX: 350, minY: 0, maxY: 100 });
      expect(ground.children).toHaveLength(1);
      expect(ground.children[0]!.x).toBe(300);
      f.lighting.update(worldSunlight(), { minX: 0, maxX: 350, minY: 0, maxY: 100 });
      expect(ground.children.map((shadow) => shadow.x)).toEqual([20, 300]);
    } finally { f.dispose(); }
  });
  it("keeps night colors, warm emitters and sunlight independently configurable", () => {
    const f = fixture(), light = { ...worldSunlight(), day: 0 };
    try {
      f.register();
      const filter = f.lighting.container.filters![0]!, uniforms = filter.resources.night.uniforms;
      f.game.visualEffects.localLights = false;
      f.lighting.update(light, viewport);
      expect(uniforms.uNight).toBe(1);
      expect(uniforms.uLocalNight).toBe(0);
      f.game.visualEffects.dayNight = false;
      f.game.visualEffects.localLights = true;
      f.lighting.update(light, viewport);
      expect(uniforms.uNight).toBe(0);
      expect(uniforms.uLocalNight).toBe(1);
      expect(filter.enabled).toBe(true);
      f.game.visualEffects.localLights = false;
      f.lighting.update(light, viewport);
      expect(filter.enabled).toBe(false);
    } finally { f.dispose(); }
  });
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
