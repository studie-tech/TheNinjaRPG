import { expect, it, vi } from "bun:test";
import { Container, type Renderer, Sprite } from "pixi.js";
import { createCharacterComposites } from "@/libs/rendering/characterComposites";

it("uploads a rasterized pose once, shares it, and redraws it after a context reset", () => {
  const sources: Sprite[] = [];
  const render = vi.fn(({ container }: { container: Container }) => {
    for (const holder of container.children)
      if (holder instanceof Container)
        for (const child of holder.children)
          if (child instanceof Sprite) sources.push(child);
  });
  const cache = createCharacterComposites({ render } as unknown as Renderer, {
    cellSize: 2,
    pixelsPerUnit: 2,
    pageSize: 4,
    maxPages: 1,
  });
  const rig = new Container(),
    other = new Container();
  const bytes = new Uint8Array(16).fill(127),
    rasterize = vi.fn(() => bytes);
  const cell = cache.acquire("same", rig, rasterize)!;
  expect(cache.acquire("same", other, rasterize)).toBe(cell);
  cache.flush();
  expect(render).toHaveBeenCalledTimes(1);
  expect(rasterize).toHaveBeenCalledTimes(1);
  expect(sources[0]?.destroyed).toBe(true);
  expect(rig.parent).toBeNull();
  cache.flush();
  expect(render).toHaveBeenCalledTimes(1);
  cache.reset();
  cache.acquire("same", rig, rasterize);
  cache.flush();
  expect(rasterize).toHaveBeenCalledTimes(2);
  cache.release(cell);
  cache.release(cell);
  cache.destroy();
  rig.destroy();
  other.destroy();
});

it("removes failed rasterization work and permits the actor to request its pose again", () => {
  const render = vi.fn();
  const cache = createCharacterComposites({ render } as unknown as Renderer, {
    cellSize: 2,
    pixelsPerUnit: 2,
    pageSize: 4,
  });
  const rig = new Container();
  const failed = cache.acquire("broken", rig, () => new Uint8Array(4))!;
  expect(() => cache.flush()).toThrow("dimensions must match");
  expect(failed.key).toBeNull();
  expect(rig.parent).toBeNull();
  cache.release(failed);
  const retry = cache.acquire("broken", rig, () => new Uint8Array(16))!;
  cache.flush();
  expect(render).toHaveBeenCalledTimes(1);
  expect(retry.key).toBe("broken");
  cache.release(retry);
  cache.destroy();
  rig.destroy();
});
