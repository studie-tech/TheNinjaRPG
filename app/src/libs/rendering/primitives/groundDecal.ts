import { Geometry, Mesh, Shader, State } from "pixi.js";
import type { TerrainHex } from "@/libs/hexgrid";
import { textureOpaqueFrame } from "@/libs/rendering/assets";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { project2DShader } from "@/libs/rendering/shaders";

/** Terrain-aligned artwork keeps its pixels while an analytic hex mask softens its edge. */
export const createGroundDecal = async (
  game: GameRenderer,
  image: string,
  tile: TerrainHex,
  opacity: number,
  feather: number,
  outerEdges: boolean[] = [true, true, true, true, true, true],
) => {
  const texture = await game.assets.texture(image, 0);
  if (game.isDisposed()) throw new DOMException("Decal cancelled", "AbortError");
  const bounds = textureOpaqueFrame(texture);
  const uvBounds = [
    bounds.x / texture.source.pixelWidth,
    bounds.y / texture.source.pixelHeight,
    bounds.width / texture.source.pixelWidth,
    bounds.height / texture.source.pixelHeight,
  ];
  const points = [
    { x: tile.width / 2, y: tile.height / 2 },
    ...tile.corners.map((point) => ({
      x: point.x + tile.center.x,
      y: point.y + tile.center.y,
    })),
  ];
  const geometry = new Geometry({
    attributes: {
      aPosition: {
        buffer: new Float32Array(points.flatMap(({ x, y }) => [x, y])),
        format: "float32x2",
      },
      aUV: {
        buffer: new Float32Array(
          points.flatMap(({ x, y }) => [x / tile.width, 1 - y / tile.height]),
        ),
        format: "float32x2",
      },
    },
    indexBuffer: new Uint32Array(
      Array.from({ length: 6 }, (_, i) => [0, i + 1, ((i + 1) % 6) + 1]).flat(),
    ),
  });
  const shader = Shader.from({
    gl: {
      vertex: `precision highp float; attribute vec2 aPosition; attribute vec2 aUV; varying vec2 vUV; ${project2DShader} void main(){ vUV=aUV; gl_Position=project2D(aPosition); }`,
      fragment: `precision mediump float; varying vec2 vUV; uniform sampler2D uImage; uniform float uOpacity; uniform float uFeather; uniform vec4 uBounds;
        ${tile.corners.map((_, i) => `uniform vec4 uEdge${i};`).join("\n")}
        void main(){ float coverage=1.0;
          ${tile.corners.map((_, i) => `if(uFeather>0.0 && uEdge${i}.w>0.5) coverage=min(coverage,smoothstep(0.0,uFeather,dot(uEdge${i}.xy,vUV)+uEdge${i}.z));`).join("\n")}
          gl_FragColor=texture2D(uImage,uBounds.xy+vUV*uBounds.zw)*uOpacity*coverage; }`,
    },
    resources: {
      uImage: texture.source,
      style: {
        uOpacity: { value: opacity, type: "f32" },
        uFeather: { value: feather, type: "f32" },
        uBounds: { value: uvBounds, type: "vec4<f32>" },
        ...Object.fromEntries(
          tile.corners.map((point, i) => {
            const next = tile.corners[(i + 1) % 6];
            if (!next) throw new Error("Hex edge is missing");
            const a = {
              x: (point.x + tile.center.x) / tile.width,
              y: 1 - (point.y + tile.center.y) / tile.height,
            };
            const b = {
              x: (next.x + tile.center.x) / tile.width,
              y: 1 - (next.y + tile.center.y) / tile.height,
            };
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            let x = -(b.y - a.y) / length;
            let y = (b.x - a.x) / length;
            let z = -x * a.x - y * a.y;
            if (x * 0.5 + y * 0.5 + z < 0) {
              x = -x;
              y = -y;
              z = -z;
            }
            return [
              `uEdge${i}`,
              { value: [x, y, z, outerEdges[i] ? 1 : 0], type: "vec4<f32>" },
            ];
          }),
        ),
      },
    },
  });
  const mesh = new Mesh({
    geometry,
    shader,
    state: State.for2d(),
    label: "ground-surface",
  });
  game.own(() => {
    mesh.destroy();
    geometry.destroy();
    shader.destroy();
  });
  return Object.assign(mesh, {
    setOuterEdges: (edges: boolean[]) => {
      edges.forEach((outer, i) => {
        shader.resources.style.uniforms[`uEdge${i}`][3] = outer ? 1 : 0;
      });
    },
  });
};

/** Adjacent tiles of one material share their interior edge; only the field perimeter fades. */
export const groundDecalBoundaries = (
  tiles: { id: string; material: string; tile: TerrainHex }[],
) => {
  const edges = new Map<string, Set<string>>();
  const keys = tiles.map(({ id, material, tile }) => ({
    id,
    keys: tile.corners.map((a, i) => {
      const b = tile.corners[(i + 1) % 6];
      if (!b) throw new Error("Hex edge is missing");
      const key = `${material}:${[a, b]
        .map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)
        .sort()
        .join(":")}`;
      const owners = edges.get(key) ?? new Set<string>();
      owners.add(`${tile.col},${tile.row}`);
      edges.set(key, owners);
      return key;
    }),
  }));
  return new Map(
    keys.map(({ id, keys }) => [id, keys.map((key) => edges.get(key)?.size === 1)]),
  );
};
