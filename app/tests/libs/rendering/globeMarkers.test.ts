import { afterEach, expect, it, vi } from "bun:test";
import { type Mesh, UniformGroup } from "pixi.js";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createGlobeMarkers } from "@/libs/rendering/scenes/globeMarkers";

afterEach(() => vi.restoreAllMocks());

it("moves the character and its ring without rebuilding marker textures or other billboards", () => {
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as never,
  );
  const cleanups: (() => void)[] = [];
  const game = {
    signal: new AbortController().signal,
    own: (fn: () => void) => cleanups.push(fn),
  } as unknown as GameRenderer;
  const markers = createGlobeMarkers(
    game,
    new UniformGroup({}),
    {
      longitude: 0,
      latitude: 0,
      distance: 20,
      width: 390,
      height: 390,
    },
    10,
  );
  try {
    const start = { x: 10, y: 0, z: 0 };
    markers.set([
      { id: "traveler", kind: "ring", sector: 724, point: start },
      { kind: "ring", sector: 177, point: { x: 0, y: 0, z: 10 } },
      { id: "traveler", kind: "avatar", sector: 724, point: start },
    ]);
    const mesh = markers.container.children[0] as Mesh;
    const geometry = mesh.geometry,
      shader = mesh.shader;
    const before = Array.from(geometry.getBuffer("aPosition").data as Float32Array);
    const updated = vi.spyOn(geometry.getBuffer("aPosition"), "update");
    const drawn = (context.ellipse as ReturnType<typeof vi.fn>).mock.calls.length;
    const next = { x: 7, y: 1, z: 7 };
    markers.move("traveler", next);
    expect(markers.container.children[0]).toBe(mesh);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.shader).toBe(shader);
    const positions = Array.from(geometry.getBuffer("aPosition").data as Float32Array);
    for (const offset of [0, 24])
      expect(positions.slice(offset, offset + 12)).toEqual([
        7, 1, 7, 7, 1, 7, 7, 1, 7, 7, 1, 7,
      ]);
    expect(positions.slice(12, 24)).toEqual(before.slice(12, 24));
    expect(updated).toHaveBeenCalledTimes(1);
    markers.move("traveler", next);
    expect(updated).toHaveBeenCalledTimes(1);
    expect(context.ellipse).toHaveBeenCalledTimes(drawn);
  } finally {
    for (const cleanup of cleanups) cleanup();
    markers.container.destroy();
  }
});
