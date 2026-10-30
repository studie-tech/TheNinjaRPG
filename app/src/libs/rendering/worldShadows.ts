import {
  Buffer,
  BufferUsage,
  Container,
  Filter,
  Geometry,
  GlProgram,
  Matrix,
  Mesh,
  Rectangle,
  RenderTexture,
  Shader,
  type Sprite,
  State,
  Texture,
  UniformGroup,
} from "pixi.js";
import { WORLD_DAY_BRIGHTNESS, WORLD_NIGHT_BRIGHTNESS } from "@/drizzle/constants";
import { getWorldCycleBrightness, getWorldCyclePosition } from "@/libs/dayNight";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import type { HexTerrainData } from "@/libs/rendering/terrainData";
import { boundsOverlap, type WorldBounds } from "@/libs/rendering/visibility";
import {
  lightingFragment,
  lightingVertex,
  materialShader,
  pointLightFragment,
} from "@/libs/rendering/worldLightingShaders";
import {
  acquireWorldMaterial,
  createCharacterMaterialFrame,
  type MaterialFrame,
  type WorldMaterial,
  worldMaterialFrame,
} from "@/libs/rendering/worldMaterials";
import { createWorldOcclusion, type Occluder } from "@/libs/rendering/worldOcclusion";
import { createSunShadows, type SunCaster } from "@/libs/rendering/worldSunShadows";
import {
  MAX_SMALL_WORLD_WIND,
  MAX_WORLD_WIND,
  STILL_WORLD_WIND,
  type WorldWind,
  worldWindGroup,
  worldWindShader,
} from "@/libs/rendering/worldWind";

/** East (+X), south (−Y), west (−X) follow the existing server-corrected cycle. Null freezes noon. */
export const worldSunlight = (date: Date | null = null) => {
  const cycle = date ? getWorldCyclePosition(date) : null;
  const brightness = date ? getWorldCycleBrightness(date) : WORLD_DAY_BRIGHTNESS;
  const day = Math.max(
    0,
    Math.min(
      1,
      (brightness - WORLD_NIGHT_BRIGHTNESS) /
        (WORLD_DAY_BRIGHTNESS - WORLD_NIGHT_BRIGHTNESS),
    ),
  );
  const progress = !cycle
    ? 0.5
    : cycle.phase === "day"
      ? cycle.phaseOffset / cycle.phaseDuration
      : day > 0
        ? 0
        : 1;
  const angle = Math.PI * progress;
  const x = Math.cos(angle),
    y = -Math.sin(angle) * 0.65,
    z = 0.28 + Math.sin(angle) * 0.8;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length, day };
};

/**
 * Physical albedo, matched receiver data and bounded lighting share one composite.
 * Sunlight uses cached light-space depth; cropped local lights clip rays against authored triangular prisms.
 * All coordinates are Y-up: a material texel at screen (x,y), height h represents (x,2(y−h),h).
 */
export const createWorldShadows = (game: GameRenderer, world: Container) => {
  const container = new Container({ label: "physical-world" });
  const receiver = RenderTexture.create({
    width: 1,
    height: 1,
    scaleMode: "nearest",
    antialias: false,
  });
  const points = RenderTexture.create({
    width: 1,
    height: 1,
    scaleMode: "nearest",
    antialias: false,
  });
  const wind = new UniformGroup({
    uWind: { value: new Float32Array(4), type: "vec4<f32>" },
    uWindSmall: { value: new Float32Array(4), type: "vec4<f32>" },
  });
  const onOcclusionError = (error: Error) =>
    console.warn(
      "World occlusion unavailable; retaining the last complete field",
      error,
    );
  const sun = createSunShadows(game),
    staticField = createWorldOcclusion({
      incremental: true,
      onUpdate: game.invalidate,
      onError: onOcclusionError,
      budgetMs: 2,
    }),
    dynamicField = createWorldOcclusion({ onError: onOcclusionError });
  const view = new UniformGroup({
    uViewport: { value: new Float32Array(4), type: "vec4<f32>" },
    uReceiverSize: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
  });
  const lightUniforms = new UniformGroup({
    uStaticBounds: { value: new Float32Array(4), type: "vec4<f32>" },
    uDynamicBounds: { value: new Float32Array(4), type: "vec4<f32>" },
    uFieldHeights: { value: new Float32Array([512, 512, 0, 0.01]), type: "vec4<f32>" },
    uStaticGeometry: { value: new Float32Array([0, 0, 1, 1]), type: "vec4<f32>" },
    uDynamicGeometry: { value: new Float32Array([0, 0, 1, 1]), type: "vec4<f32>" },
    uStaticTables: { value: new Float32Array([2048, 1, 2048, 1]), type: "vec4<f32>" },
    uDynamicTables: { value: new Float32Array([2048, 1, 2048, 1]), type: "vec4<f32>" },
    uLightStrength: { value: 1, type: "f32" },
    uInstanceCounts: { value: new Float32Array(2), type: "vec2<f32>" },
  });
  const look = new UniformGroup({
    uScreenSize: { value: new Float32Array(2), type: "vec2<f32>" },
    uAmbient: { value: new Float32Array(3), type: "vec3<f32>" },
    uSunColor: { value: new Float32Array(3), type: "vec3<f32>" },
    uDay: { value: 1, type: "f32" },
  });
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: lightingVertex, fragment: lightingFragment }),
    antialias: false,
    resources: {
      uReceiver: receiver.source,
      uPoints: points.source,
      uStaticSun: sun.staticTexture.source,
      uDynamicSun: sun.dynamicTexture.source,
      uStaticField: staticField.texture.source,
      uDynamicField: dynamicField.texture.source,
      view,
      sun: sun.uniforms,
      look,
      lights: lightUniforms,
    },
  });
  container.filters = [filter];
  const materialLayer = new Container(),
    terrainLayer = new Container(),
    pointLayer = new Container();
  const receiverBatches: ReceiverBatch[] = [];
  // Retain released sources until the cached receiver and depth passes relinquish their bindings.
  const retired: (() => void)[] = [];
  const records = new Set<Caster>(),
    terrains = new Set<TerrainReceiver>();
  const origins = new Map<
    Container,
    { x: number; y: number; matrix: Matrix; visible: boolean; drawRoot?: Container }
  >();
  const characterFrames = new WeakMap<Texture, MaterialFrame>();
  const pointBuffer = new Buffer({
    data: new Float32Array(0),
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    shrinkToFit: false,
  });
  const pointGeometry = new Geometry({
    attributes: {
      aPosition: { buffer: pointBuffer, format: "float32x2", stride: 36, offset: 0 },
      aLight: { buffer: pointBuffer, format: "float32x4", stride: 36, offset: 8 },
      aColor: { buffer: pointBuffer, format: "float32x3", stride: 36, offset: 24 },
    },
  });
  const pointShader = Shader.from({
    gl: { vertex: pointVertex, fragment: pointLightFragment },
    resources: {
      view,
      lights: lightUniforms,
      wind,
      uReceiver: receiver.source,
      uStaticField: staticField.texture.source,
      uDynamicField: dynamicField.texture.source,
      uStaticReferences: staticField.references.source,
      uDynamicReferences: dynamicField.references.source,
      uStaticPrisms: staticField.prisms.source,
      uDynamicPrisms: dynamicField.prisms.source,
    },
  });
  const pointMesh = new Mesh({
    geometry: pointGeometry,
    shader: pointShader,
    blendMode: "add",
  });
  pointLayer.addChild(pointMesh);
  let serial = 0,
    hasSunCasters = false,
    disposed = false,
    receiverKey = "",
    receiverWindKey = "",
    pointKey = "",
    pointGeometryKey = "";
  const invalidate = () => {
    receiverKey = pointKey = "";
    sun.invalidate();
  };
  game.canvas.addEventListener("webglcontextrestored", invalidate);
  /** Parent matrices exclude the common camera transform and preserve nested LPC layer scales. */
  const origin = (
    parent: Container | null,
  ): {
    x: number;
    y: number;
    matrix: Matrix;
    visible: boolean;
    drawRoot?: Container;
  } => {
    if (!parent || parent === world)
      return { x: 0, y: 0, matrix: new Matrix(), visible: parent === world };
    const cached = origins.get(parent);
    if (cached) return cached;
    const previous = origin(parent.parent);
    parent.updateLocalTransform();
    const matrix = previous.matrix.clone().append(parent.localTransform);
    const result = {
      x: matrix.tx,
      y: matrix.ty,
      matrix,
      visible: previous.visible && parent.visible,
      drawRoot: parent.parentRenderLayer ? parent : previous.drawRoot,
    };
    origins.set(parent, result);
    return result;
  };
  game.own(() => {
    if (disposed) return;
    disposed = true;
    game.canvas.removeEventListener("webglcontextrestored", invalidate);
    for (const batch of receiverBatches) destroyBatch(batch);
    for (const terrain of terrains) {
      terrain.mesh.geometry.destroy(true);
      terrain.mesh.shader?.destroy();
    }
    terrains.clear();
    terrainLayer.destroy({ children: true });
    materialLayer.destroy({ children: true });
    pointGeometry.destroy(true);
    pointShader.destroy();
    pointLayer.destroy({ children: true });
    filter.destroy();
    sun.dispose();
    for (const record of records) for (const lease of record.leases) lease.release();
    records.clear();
    for (const release of retired.splice(0)) release();
    staticField.dispose();
    dynamicField.dispose();
    receiver.destroy(true);
    points.destroy(true);
    if (!container.destroyed) container.destroy({ children: true });
  });
  return {
    container,
    /** Material registrations share decoded sources and release even when their owner disappears during loading. */
    register: (
      sprite: Sprite,
      description: WorldSpriteDescription,
      motionTextures: readonly Texture[] = [],
      character?: Container,
    ) => {
      const id = String(++serial);
      const images = [description.image, ...(description.motion?.clip.images ?? [])];
      const leases = images.map((image) =>
        acquireWorldMaterial(
          image,
          description.shadowCaster ?? "column",
          character ? 0 : 128,
        ),
      );
      const record: Caster = {
        id,
        sprite,
        character,
        description,
        leases,
        materials: [],
        sources: new Map([
          [sprite.texture.source, 0],
          ...motionTextures.map(
            (texture, index) =>
              [
                texture.source,
                (description.motion?.clip.images.length === 1 ? 0 : index) + 1,
              ] as const,
          ),
        ]),
        active: true,
        cached: null,
        occluder: null,
        occlusionKey: "",
        wind: undefined,
      };
      if (description.wind != null) {
        sprite.updateLocalTransform();
        const m = sprite.localTransform,
          w = sprite.texture.orig.width,
          h = sprite.texture.orig.height;
        record.wind = {
          group: worldWindGroup(description.wind, description.small),
          transform: new Float32Array([
            m.a * w,
            m.b * w,
            m.c * h,
            m.d * h,
            m.tx - m.a * w * sprite.anchor.x - m.c * h * sprite.anchor.y,
            m.ty - m.b * w * sprite.anchor.x - m.d * h * sprite.anchor.y,
          ]),
          pose: {
            x: sprite.x,
            y: sprite.y,
            scale: { x: sprite.scale.x, y: sprite.scale.y },
            skew: { x: sprite.skew.x, y: sprite.skew.y },
            rotation: sprite.rotation,
          },
        };
      }
      records.add(record);
      invalidate();
      const ready = Promise.all(leases.map((lease) => lease.resource))
        .then((materials) => {
          if (!record.active || disposed) return;
          record.materials = materials;
          invalidate();
        })
        .catch((error: unknown) => {
          if (record.active && !disposed)
            console.warn("World material unavailable", error);
        });
      const release = () => {
        if (!record.active) return;
        record.active = false;
        records.delete(record);
        for (const lease of leases) {
          if (disposed) lease.release();
          else retired.push(lease.release);
        }
        invalidate();
      };
      return Object.assign(release, { ready });
    },
    /** Face elevations share terrain's navigation-neutral projected offsets, including recessed water. */
    registerTerrain: (parent: Container, data: HexTerrainData) => {
      const values: number[] = [];
      let minHeight = 0;
      for (const batch of data.batches)
        for (const tile of batch.tiles) {
          const height = data.faceOffsets.get(tile.key) ?? 0;
          minHeight = Math.min(minHeight, height);
          for (let i = tile.start; i < tile.start + tile.count; i++)
            values.push(
              batch.positions[i * 2] ?? 0,
              batch.positions[i * 2 + 1] ?? 0,
              height,
            );
        }
      const geometry = new Geometry({
        attributes: {
          aPosition: { buffer: new Float32Array(values), format: "float32x3" },
        },
      });
      const shader = Shader.from({
        gl: { vertex: terrainVertex, fragment: terrainFragment },
        resources: {
          view,
          object: { uOffset: { value: new Float32Array(2), type: "vec2<f32>" } },
        },
      });
      const state = new State();
      state.blend = false;
      const mesh = new Mesh({ geometry, shader, state });
      terrainLayer.addChild(mesh);
      const entry = { parent, mesh, id: String(++serial), minHeight };
      terrains.add(entry);
      invalidate();
      return () => {
        if (!terrains.delete(entry)) return;
        geometry.destroy(true);
        shader.destroy();
        mesh.destroy();
        invalidate();
      };
    },
    invalidate,
    /** Runs after movement and camera transforms; unchanged material/depth/light passes retain their GPU contents. */
    update: (
      light: ReturnType<typeof worldSunlight>,
      fallbackViewport: WorldBounds,
      breeze: WorldWind = STILL_WORLD_WIND,
    ) => {
      if (disposed) return;
      wind.uniforms.uWind.set(breeze.large);
      wind.uniforms.uWindSmall.set(breeze.small);
      wind.update();
      origins.clear();
      const scale = Math.abs(world.scale.x) || 1;
      const globalViewport =
        world.scale.y < 0
          ? {
              minX: -world.x / scale,
              maxX: (game.renderer.width - world.x) / scale,
              minY: (world.y - game.renderer.height) / scale,
              maxY: world.y / scale,
            }
          : fallbackViewport;
      const anchorX = Math.floor(globalViewport.minX / 128) * 128,
        anchorY = Math.floor(globalViewport.minY / 128) * 128;
      const viewport = {
        minX: globalViewport.minX - anchorX,
        maxX: globalViewport.maxX - anchorX,
        minY: globalViewport.minY - anchorY,
        maxY: globalViewport.maxY - anchorY,
      };
      const spanX = viewport.maxX - viewport.minX,
        spanY = viewport.maxY - viewport.minY;
      // Materials and color share screen-pixel sampling; world-unit buffers would mix neighboring roof and wall pixels at zoom.
      const width = Math.max(1, Math.min(2048, game.renderer.width)),
        height = Math.max(1, Math.min(2048, game.renderer.height));
      if (receiver.width !== width || receiver.height !== height) {
        receiver.resize(width, height);
        points.resize(width, height);
        invalidate();
      }
      // Pixi transforms this rectangle through the container matrix; camera bounds must stay in local world units.
      container.filterArea = new Rectangle(
        globalViewport.minX,
        globalViewport.minY,
        spanX,
        spanY,
      );
      view.uniforms.uViewport.set([viewport.minX, viewport.minY, spanX, spanY]);
      view.uniforms.uReceiverSize.set([width, height]);
      view.update();
      const visible: VisibleCaster[] = [],
        sunCasters: SunCaster[] = [],
        staticOccluders: Occluder[] = [],
        dynamicOccluders: Occluder[] = [];
      const lights: PointLight[] = [];
      const litCharacters = new Set<Container>();
      const appendLights = (record: Caster, candidates: PointLight[]) => {
        if (
          !candidates.length ||
          (record.character && litCharacters.has(record.character))
        )
          return;
        if (record.character) litCharacters.add(record.character);
        lights.push(...candidates);
      };
      for (const record of records) {
        const { sprite, description } = record;
        const sourcePose = record.wind?.pose ?? sprite;
        if (sprite.destroyed || !sprite.visible || !record.materials.length) continue;
        const p = origin(sprite.parent);
        if (!p.visible) continue;
        const position = p.matrix.apply(sourcePose);
        const radius =
          description.size +
          Math.abs(sprite.width) * Math.max(Math.abs(p.matrix.a), Math.abs(p.matrix.d));
        if (
          !boundsOverlap(
            {
              minX: position.x - radius,
              maxX: position.x + radius,
              minY: position.y - radius,
              maxY: position.y + radius,
            },
            globalViewport,
            384,
          )
        )
          continue;
        const dynamic = description.shadowCaster === "character";
        const pose = record.cached?.pose;
        if (
          pose?.parentMatrix.equals(p.matrix) &&
          pose.parentOrder === p.drawRoot?.zIndex &&
          pose.parentGroup === p.drawRoot?.uid &&
          pose.originX === anchorX &&
          pose.originY === anchorY &&
          pose.texture === sprite.texture &&
          pose.x === sourcePose.x &&
          pose.y === sourcePose.y &&
          pose.sx === sourcePose.scale.x &&
          pose.sy === sourcePose.scale.y &&
          pose.kx === sourcePose.skew.x &&
          pose.ky === sourcePose.skew.y &&
          pose.rotation === sourcePose.rotation &&
          pose.order === sprite.zIndex &&
          pose.alpha === sprite.alpha &&
          pose.ax === sprite.anchor.x &&
          pose.ay === sprite.anchor.y &&
          record.cached
        ) {
          visible.push(record.cached.receiver);
          if (record.cached.sun) sunCasters.push(record.cached.sun);
          if (record.occluder)
            (dynamic ? dynamicOccluders : staticOccluders).push(record.occluder);
          appendLights(record, record.cached.lights);
          continue;
        }
        const recordLights: PointLight[] = [];
        const material =
          record.materials[record.sources.get(sprite.texture.source) ?? 0] ??
          record.materials[0];
        if (!material) continue;
        const sourceRatio = material.width / sprite.texture.source.pixelWidth;
        const frameRect = sprite.texture.frame.clone();
        frameRect.x *= sourceRatio;
        frameRect.y *= sourceRatio;
        frameRect.width *= sourceRatio;
        frameRect.height *= sourceRatio;
        let frame = worldMaterialFrame(material, frameRect);
        if (record.character) {
          let cached = characterFrames.get(sprite.texture);
          if (!cached) {
            cached = createCharacterMaterialFrame(material, sprite.texture);
            characterFrames.set(sprite.texture, cached);
          }
          frame = cached;
        }
        sprite.updateLocalTransform();
        const m = p.matrix.clone().append(sprite.localTransform);
        const w = sprite.texture.orig.width,
          h = sprite.texture.orig.height;
        const transform = record.wind
          ? new Float32Array([
              ...record.wind.transform.slice(0, 4),
              (record.wind.transform[4] ?? 0) + p.x - anchorX,
              (record.wind.transform[5] ?? 0) + p.y - anchorY,
            ])
          : new Float32Array([
              m.a * w,
              m.b * w,
              m.c * h,
              m.d * h,
              m.tx - anchorX - m.a * w * sprite.anchor.x - m.c * h * sprite.anchor.y,
              m.ty - anchorY - m.b * w * sprite.anchor.x - m.d * h * sprite.anchor.y,
            ]);
        const objectHeight = record.wind ? description.size : Math.hypot(m.c, m.d) * h;
        const characterRoot = record.character ? origin(record.character) : undefined;
        const characterFoot = characterRoot?.matrix.apply({ x: 0, y: 28 / 64 });
        const characterHeight = characterRoot
          ? Math.hypot(characterRoot.matrix.c, characterRoot.matrix.d)
          : objectHeight;
        const bounds = quadBounds(transform);
        if (record.wind) {
          const margin = record.wind.group < 4 ? MAX_WORLD_WIND : MAX_SMALL_WORLD_WIND;
          bounds.minX -= margin;
          bounds.maxX += margin;
        }
        if (!boundsOverlap(bounds, viewport, 384)) continue;
        // Retained passes use the stored Float32 pose, including movement smaller than a screen pixel.
        const key = `${record.id}:${sprite.texture.uid}:${frameRect.x}:${frameRect.y}:${frameRect.width}:${frameRect.height}:${transform}:${objectHeight}:${sprite.alpha}:${record.wind?.group ?? ""}`;
        const receiverEntry = {
          record,
          material,
          frame,
          transform,
          height: objectHeight,
          bounds,
          key,
          order: p.drawRoot
            ? p.drawRoot.zIndex
            : sprite.zIndex || -(description.groundY + p.y),
          rootOrder: p.drawRoot?.uid ?? sprite.uid,
          layerOrder: sprite.zIndex,
        };
        visible.push(receiverEntry);
        let sunEntry: SunCaster | null = null;
        // Receiving authored surface light does not make a small prop a sun or local-light occluder.
        if (description.shadowCaster) {
          // Shared wind uniforms deform the retained base pose in every physical pass.
          const stable = transform,
            casterHeight = objectHeight;
          const stableKey = `${record.id}:${sprite.texture.uid}:${frameRect.x}:${frameRect.y}:${stable}:${casterHeight}`;
          sunEntry = {
            id: record.id,
            key: stableKey,
            frame,
            material,
            transform: stable,
            height: casterHeight,
            dynamic,
            wind: record.wind?.group,
          };
          sunCasters.push(sunEntry);
          const fieldKey = `${record.id}:${sprite.texture.uid}:${frameRect.x}:${frameRect.y}:${frameRect.width}:${frameRect.height}:${[stable[0], stable[1], stable[2], stable[3], Math.fround((stable[4] ?? 0) + anchorX), Math.fround((stable[5] ?? 0) + anchorY)]}:${casterHeight}`;
          if (record.occlusionKey !== fieldKey) {
            // Instances share authored local geometry; the field inverts this same source transform per ray.
            const volumes = frame.volumes;
            const sourceTransform =
              volumes || record.wind
                ? new Float32Array([
                    stable[0] ?? 0,
                    stable[1] ?? 0,
                    stable[2] ?? 0,
                    stable[3] ?? 0,
                    (stable[4] ?? 0) + anchorX,
                    (stable[5] ?? 0) + anchorY,
                  ])
                : undefined;
            const samples = new Float32Array(volumes ? 0 : frame.points.length);
            for (let i = 0; i < samples.length; i += 4) {
              const u = frame.points[i] ?? 0,
                v = frame.points[i + 1] ?? 0,
                z = (frame.points[i + 2] ?? 0) * casterHeight;
              samples[i] =
                (stable[0] ?? 0) * u +
                (stable[2] ?? 0) * v +
                (stable[4] ?? 0) +
                anchorX;
              samples[i + 1] =
                2 *
                ((stable[1] ?? 0) * u +
                  (stable[3] ?? 0) * v +
                  (stable[5] ?? 0) +
                  anchorY -
                  z);
              samples[i + 2] = z;
              samples[i + 3] = frame.points[i + 3] ?? 0;
            }
            const foot =
              description.entrance?.y ??
              description.y - description.size * (1 - (description.anchorY ?? 0.5));
            record.occluder = {
              key: fieldKey,
              points: samples,
              volumes,
              transform: volumes ? sourceTransform : undefined,
              windProjection: !volumes && record.wind ? sourceTransform : undefined,
              shape: description.shadowCaster,
              width: characterRoot
                ? Math.hypot(characterRoot.matrix.a, characterRoot.matrix.b)
                : Math.abs(sprite.width),
              height: volumes ? casterHeight : characterHeight,
              footX: characterFoot?.x ?? p.x + sourcePose.x,
              footY: characterFoot
                ? characterFoot.y * 2
                : 2 * (p.y + foot + sourcePose.y - description.y),
              dynamic,
              wind: record.wind?.group,
            };
            record.occlusionKey = fieldKey;
          }
          if (record.occluder)
            (dynamic ? dynamicOccluders : staticOccluders).push(record.occluder);
        }
        if (dynamic && record.occluder) {
          // An elevated fill directly over the feet keeps the pool centered and the self shadow compact.
          recordLights.push({
            x: (characterFoot?.x ?? record.occluder.footX) - anchorX,
            y:
              (characterFoot ? characterFoot.y * 2 : record.occluder.footY) -
              anchorY * 2,
            z: characterHeight * 2 + 2,
            reach: characterHeight * 0.65,
            color: [3, 2.5, 1.8],
          });
        } else if (!dynamic)
          for (const emitter of frame.emitters) {
            const x =
              (transform[4] ?? 0) +
              (transform[0] ?? 0) * emitter.x +
              (transform[2] ?? 0) * emitter.y;
            const y =
              (transform[5] ?? 0) +
              (transform[1] ?? 0) * emitter.x +
              (transform[3] ?? 0) * emitter.y;
            const z = emitter.height * objectHeight;
            recordLights.push({
              x: x + Math.sign(emitter.x - 0.5) * 2,
              y: 2 * (y - z) - 5,
              z: z + 2,
              reach:
                description.shadowCaster === "column"
                  ? Math.max(14, Math.abs(sprite.width) * 0.6)
                  : Math.max(64, Math.abs(sprite.width) * 0.65),
              color:
                description.shadowCaster === "column"
                  ? [7.0, 3.4, 0.9]
                  : [3.8, 1.8, 0.5],
            });
          }
        record.cached = {
          pose: {
            parentMatrix: p.matrix,
            parentOrder: p.drawRoot?.zIndex,
            parentGroup: p.drawRoot?.uid,
            originX: anchorX,
            originY: anchorY,
            texture: sprite.texture,
            x: sourcePose.x,
            y: sourcePose.y,
            sx: sourcePose.scale.x,
            sy: sourcePose.scale.y,
            kx: sourcePose.skew.x,
            ky: sourcePose.skew.y,
            rotation: sourcePose.rotation,
            order: sprite.zIndex,
            alpha: sprite.alpha,
            ax: sprite.anchor.x,
            ay: sprite.anchor.y,
          },
          receiver: receiverEntry,
          sun: sunEntry,
          lights: recordLights,
        };
        appendLights(record, recordLights);
      }
      const receivers = visible.filter(
        (entry) =>
          entry.record.sprite.alpha >= 0.75 && boundsOverlap(entry.bounds, viewport, 2),
      );
      receivers.sort(
        (a, b) =>
          a.order - b.order || a.rootOrder - b.rootOrder || a.layerOrder - b.layerOrder,
      );
      const viewKey = `${viewport.minX}:${viewport.minY}:${spanX}:${spanY}`;
      let nextTerrainKey = "";
      let minReceiverHeight = 0;
      for (const terrain of terrains) {
        const p = origin(terrain.parent);
        terrain.mesh.visible = p.visible && terrain.parent.renderable;
        if (terrain.mesh.visible)
          minReceiverHeight = Math.min(minReceiverHeight, terrain.minHeight);
        terrain.mesh.shader?.resources.object.uniforms.uOffset.set([
          p.x - anchorX,
          p.y - anchorY,
        ]);
        terrain.mesh.shader?.resources.object.update();
        nextTerrainKey += `${terrain.id}:${p.x}:${p.y}:${terrain.mesh.visible}`;
      }
      const nextReceiverKey =
        viewKey + nextTerrainKey + receivers.map((entry) => entry.key).join(";");
      const receiverChanged = nextReceiverKey !== receiverKey;
      if (receiverChanged) {
        receiverKey = nextReceiverKey;
        updateReceiverBatches(receiverBatches, receivers, materialLayer, view, wind);
      }
      const hasWindReceivers = receivers.some((entry) => entry.record.wind);
      if (receiverChanged || (hasWindReceivers && receiverWindKey !== breeze.key)) {
        receiverWindKey = breeze.key;
        game.renderer.render({
          container: terrainLayer,
          target: receiver,
          clear: true,
          clearColor: [128 / 255, 128 / 255, 127 / 255, 0.5],
        });
        game.renderer.render({
          container: materialLayer,
          target: receiver,
          clear: false,
        });
      }
      if (light.day > 0) {
        sun.update(sunCasters, viewport, light, breeze, minReceiverHeight);
        hasSunCasters = true;
      } else if (hasSunCasters) {
        sun.update([], viewport, light);
        hasSunCasters = false;
      }
      const fieldBounds = {
        minX: globalViewport.minX - 192,
        maxX: globalViewport.maxX + 192,
        minY: globalViewport.minY * 2 - 640,
        maxY: globalViewport.maxY * 2 + 192,
      };
      staticField.update(
        staticOccluders,
        fieldBounds,
        occlusionHeightRange(staticOccluders),
      );
      dynamicField.update(
        dynamicOccluders,
        fieldBounds,
        occlusionHeightRange(dynamicOccluders),
      );
      let receiverHalfQuantum = 0;
      for (const entry of receivers)
        if (!entry.material.isBillboard)
          receiverHalfQuantum = Math.max(receiverHalfQuantum, entry.height / 510);
      lightUniforms.uniforms.uFieldHeights.set([
        staticField.heightRange,
        dynamicField.heightRange,
        receiverHalfQuantum,
        Math.max(staticField.precision, dynamicField.precision),
      ]);
      lightUniforms.uniforms.uStaticGeometry.set(
        boundsUniform(staticField.geometryBounds, anchorX, anchorY * 2),
      );
      lightUniforms.uniforms.uDynamicGeometry.set(
        boundsUniform(dynamicField.geometryBounds, anchorX, anchorY * 2),
      );
      lightUniforms.uniforms.uStaticTables.set([
        staticField.references.source.pixelWidth,
        staticField.references.source.pixelHeight,
        staticField.prisms.source.pixelWidth,
        staticField.prisms.source.pixelHeight,
      ]);
      lightUniforms.uniforms.uDynamicTables.set([
        dynamicField.references.source.pixelWidth,
        dynamicField.references.source.pixelHeight,
        dynamicField.prisms.source.pixelWidth,
        dynamicField.prisms.source.pixelHeight,
      ]);
      const nextPointGeometryKey = `${viewKey}:${lights.map((l) => `${l.x}:${l.y}:${l.z}:${l.reach}:${l.color}`).join(";")}:${Math.round(light.day * 256)}`;
      const nextPointKey =
        nextReceiverKey +
        `${staticField.revision}:${dynamicField.revision}` +
        nextPointGeometryKey +
        (hasWindReceivers ||
        staticOccluders.some((record) => record.wind !== undefined) ||
        dynamicOccluders.some((record) => record.wind !== undefined)
          ? breeze.key
          : "");
      lightUniforms.uniforms.uStaticBounds.set(
        boundsUniform(staticField.bounds, anchorX, anchorY * 2),
      );
      lightUniforms.uniforms.uDynamicBounds.set(
        boundsUniform(dynamicField.bounds, anchorX, anchorY * 2),
      );
      lightUniforms.uniforms.uInstanceCounts.set([
        staticField.instanceCount,
        dynamicField.instanceCount,
      ]);
      lightUniforms.uniforms.uLightStrength = 1 - light.day * 0.85;
      lightUniforms.update();
      if (pointKey !== nextPointKey) {
        pointKey = nextPointKey;
        // Wind changes visibility, while stationary light bounds keep their vertex buffer.
        if (pointGeometryKey !== nextPointGeometryKey) {
          pointGeometryKey = nextPointGeometryKey;
          const vertices: number[] = [];
          for (const l of lights) {
            // Expand the ground reach after reading cached fixtures so stationary lights follow dusk and dawn.
            const radius = Math.hypot(l.z, l.reach * (1.5 - light.day * 0.5));
            const cy = l.y * 0.5 + l.z,
              ry = radius * Math.sqrt(1.25);
            if (
              !boundsOverlap(
                {
                  minX: l.x - radius,
                  maxX: l.x + radius,
                  minY: cy - ry,
                  maxY: cy + ry,
                },
                viewport,
              )
            )
              continue;
            for (const [u, v] of corners)
              vertices.push(
                l.x + (u - 0.5) * radius * 2,
                cy + (v - 0.5) * ry * 2,
                l.x,
                l.y,
                l.z,
                radius,
                ...l.color,
              );
          }
          pointBuffer.data = new Float32Array(vertices);
          pointBuffer.update();
          pointMesh.visible = vertices.length > 0;
        }
        game.renderer.render({
          container: pointLayer,
          target: points,
          clear: true,
          clearColor: [0, 0, 0, 0],
        });
      }
      const day = light.day;
      look.uniforms.uScreenSize.set([game.renderer.width, game.renderer.height]);
      look.uniforms.uAmbient.set([
        0.13 + 0.19 * day,
        0.22 + 0.12 * day,
        0.31 + 0.03 * day,
      ]);
      const horizon = 1 - light.z;
      look.uniforms.uSunColor.set([
        0.78 + horizon * 0.16,
        0.77 - horizon * 0.15,
        0.7 - horizon * 0.22,
      ]);
      look.uniforms.uDay = day;
      look.update();
      for (const release of retired.splice(0)) release();
    },
  };
};

/** Use the smallest power-of-two range covering the casters so thin eaves retain vertical precision. */
const occlusionHeightRange = (records: readonly Occluder[]) => {
  let maximum = 32;
  for (const record of records) maximum = Math.max(maximum, record.height);
  return 2 ** Math.ceil(Math.log2(maximum));
};

const boundsUniform = (b: WorldBounds, x: number, y: number) => [
  b.minX - x,
  b.minY - y,
  b.maxX - b.minX,
  b.maxY - b.minY,
];
const corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 0],
  [1, 1],
  [0, 1],
] as const;
const quadBounds = (m: Float32Array) => {
  const x = [
    m[4] ?? 0,
    (m[4] ?? 0) + (m[0] ?? 0),
    (m[4] ?? 0) + (m[2] ?? 0),
    (m[4] ?? 0) + (m[0] ?? 0) + (m[2] ?? 0),
  ];
  const y = [
    m[5] ?? 0,
    (m[5] ?? 0) + (m[1] ?? 0),
    (m[5] ?? 0) + (m[3] ?? 0),
    (m[5] ?? 0) + (m[1] ?? 0) + (m[3] ?? 0),
  ];
  return {
    minX: Math.min(...x),
    maxX: Math.max(...x),
    minY: Math.min(...y),
    maxY: Math.max(...y),
  };
};

/** Batches adjacent painter-ordered quads; atlas limits never reorder overlapping artwork. */
const updateReceiverBatches = (
  batches: ReceiverBatch[],
  casters: VisibleCaster[],
  layer: Container,
  view: UniformGroup,
  wind: UniformGroup,
) => {
  const pending: { sources: WorldMaterial[]; vertices: number[] }[] = [];
  for (const entry of casters) {
    let batch = pending.at(-1);
    if (
      !batch ||
      (batch.sources.length === 8 && !batch.sources.includes(entry.material))
    ) {
      batch = { sources: [], vertices: [] };
      pending.push(batch);
    }
    let index = batch.sources.indexOf(entry.material);
    if (index < 0) {
      index = batch.sources.length;
      batch.sources.push(entry.material);
    }
    const sourceRatio =
      entry.material.width / entry.record.sprite.texture.source.pixelWidth;
    const frame = entry.record.sprite.texture.frame,
      m = entry.transform;
    // Inverse transpose of the source-pixel surface transform, scaled by object height.
    // The physical basis is (x, -2*(y+height), height), so screen shear also changes a wall's normal.
    const aspect = entry.record.character
        ? entry.record.sprite.texture.orig.width /
          entry.record.sprite.texture.orig.height
        : frame.width / frame.height,
      h = entry.height,
      a = (m[0] ?? 0) / aspect,
      b = -(m[2] ?? 0) * 0.5,
      c = -(m[2] ?? 0),
      d = (2 * (m[1] ?? 0)) / aspect,
      e = -(m[3] ?? 0),
      f = -2 * ((m[3] ?? 0) + h),
      determinant = a * e - b * d;
    const normalX =
      Math.abs(determinant) > 0.000001
        ? [(h * e) / determinant, (-h * b) / determinant, (b * f - e * c) / determinant]
        : [1, 0, 0];
    const normalY =
      Math.abs(determinant) > 0.000001
        ? [(-h * d) / determinant, (h * a) / determinant, (d * c - a * f) / determinant]
        : [0, 1, 0];
    for (const [u, v] of corners) {
      const { orig, trim } = entry.record.sprite.texture;
      const logicalU = entry.record.character
        ? ((trim?.x ?? 0) + u * (trim?.width ?? orig.width)) / orig.width
        : u;
      const logicalV = entry.record.character
        ? ((trim?.y ?? 0) + v * (trim?.height ?? orig.height)) / orig.height
        : v;
      batch.vertices.push(
        (m[4] ?? 0) + (m[0] ?? 0) * logicalU + (m[2] ?? 0) * logicalV,
        (m[5] ?? 0) + (m[1] ?? 0) * logicalU + (m[3] ?? 0) * logicalV,
        ((frame.x + u * frame.width) * sourceRatio) / entry.material.width,
        ((frame.y + v * frame.height) * sourceRatio) / entry.material.height,
        entry.height,
        index,
        entry.material.isBillboard
          ? (frame.y -
              (entry.record.character ? (trim?.y ?? 0) + orig.height / 2 - 28 : 0)) /
              entry.record.sprite.texture.source.pixelHeight
          : 0,
        entry.material.isBillboard
          ? (entry.record.character ? orig.height : frame.height) /
              entry.record.sprite.texture.source.pixelHeight
          : 0,
        ...normalX,
        ...normalY,
        entry.material.width,
        entry.material.height,
        entry.height /
          ((entry.record.character ? orig.height : frame.height) * sourceRatio),
        entry.record.wind ? entry.record.wind.group + 1 : 0,
        1 - v,
      );
    }
  }
  for (let i = 0; i < pending.length; i++) {
    const next = pending[i];
    if (!next) continue;
    let batch = batches[i];
    if (
      !batch ||
      batch.sources.some((value, index) => value !== next.sources[index]) ||
      batch.sources.length !== next.sources.length
    ) {
      if (batch) destroyBatch(batch);
      const buffer = new Buffer({
        data: new Float32Array(0),
        usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        shrinkToFit: false,
      });
      const geometry = new Geometry({
        attributes: {
          aPosition: { buffer, format: "float32x2", stride: 76, offset: 0 },
          aUV: { buffer, format: "float32x2", stride: 76, offset: 8 },
          aData: { buffer, format: "float32x4", stride: 76, offset: 16 },
          aNormalX: { buffer, format: "float32x3", stride: 76, offset: 32 },
          aNormalY: { buffer, format: "float32x3", stride: 76, offset: 44 },
          aPixel: { buffer, format: "float32x3", stride: 76, offset: 56 },
          aWind: { buffer, format: "float32x2", stride: 76, offset: 68 },
        },
      });
      const shader = Shader.from({
        gl: { vertex: receiverVertex, fragment: receiverFragment },
        resources: {
          view,
          wind,
          ...Object.fromEntries(
            Array.from({ length: 8 }, (_, index) => [
              `uMaterial${index}`,
              (next.sources[index]?.texture ?? Texture.WHITE).source,
            ]),
          ),
        },
      });
      const state = new State();
      state.blend = false;
      const mesh = new Mesh({ geometry, shader, state });
      layer.addChild(mesh);
      batch = { mesh, buffer, sources: next.sources };
      batches[i] = batch;
    }
    batch.buffer.data = new Float32Array(next.vertices);
    batch.buffer.update();
    layer.setChildIndex(batch.mesh, i);
  }
  while (batches.length > pending.length) {
    const batch = batches.pop();
    if (batch) destroyBatch(batch);
  }
};
const destroyBatch = (batch: ReceiverBatch) => {
  batch.mesh.shader?.destroy();
  batch.mesh.geometry.destroy(true);
  batch.mesh.destroy();
};
const receiverVertex = `precision highp float; attribute vec2 aPosition; attribute vec2 aUV; attribute vec4 aData;
attribute vec3 aNormalX; attribute vec3 aNormalY;
attribute vec3 aPixel; attribute vec2 aWind;
${worldWindShader}
varying vec2 vUV; varying vec4 vData; varying vec3 vNormalX; varying vec3 vNormalY; varying vec3 vPixel; uniform vec4 uViewport;
void main() { vUV = aUV; vData = aData; vNormalX = aNormalX; vNormalY = aNormalY;
  vPixel = aPixel;
  float dx = worldWind(aWind.x);
  // Inverse transpose of the rooted shear, including a rotated source plane.
  float slope = dx / max(aData.x, 0.00001);
  float stretch = 1.0 + slope * 0.5 * aNormalY.x;
  vNormalX.x /= stretch; vNormalY.x /= stretch;
  vNormalX.yz -= vec2(slope * 0.5, slope) * aNormalY.y * vNormalX.x;
  vNormalY.yz -= vec2(slope * 0.5, slope) * aNormalY.y * vNormalY.x;
  vec2 position = aPosition + vec2(dx * aWind.y, 0.0);
  gl_Position = vec4((position - uViewport.xy) / uViewport.zw * 2.0 - 1.0, 0.0, 1.0); }`;
const receiverFragment = `precision highp float;
precision highp sampler2D; // Preserve material flags, coverage and height before receiver encoding.
varying vec2 vUV; varying vec4 vData; varying vec3 vNormalX; varying vec3 vNormalY; varying vec3 vPixel;
${Array.from({ length: 8 }, (_, i) => `uniform sampler2D uMaterial${i};`).join("\n")}
${materialShader}
void main() {
  vec4 data = vec4(0.0);
  ${Array.from({ length: 8 }, (_, i) => `${i ? "else " : ""}if (vData.y < ${i + 0.5}) data = texture2D(uMaterial${i}, vUV);`).join("\n")}
  if (data.a < 0.5) discard;
  float flags = mod(floor(data.r * 255.0 + 0.5), 8.0);
  // A positive frame V span selects the analytic fallback billboard, independent of atlas size.
  bool billboard = vData.w > 0.0;
  vec3 sourceNormal = billboard ? vec3(0.0, -1.0, 0.0) : receiverNormal(data);
  // Authored heights describe global source texel centers, including fractional atlas frames.
  // Reconstruct the same plane at this fragment before transforming its normal into physical space.
  vec2 sourcePixel = vUV * vPixel.xy;
  vec2 sourceOffset = sourcePixel - floor(sourcePixel) - 0.5;
  float height = billboard ? max(0.0, 1.0 - (vUV.y - vData.z) / vData.w) * vData.x : data.b * vData.x;
  float facingCamera = sourceNormal.z - 2.0 * sourceNormal.y;
  if (!billboard && abs(facingCamera) > 0.05)
    height += (2.0 * sourceNormal.y * sourceOffset.y - sourceNormal.x * sourceOffset.x) / facingCamera * vPixel.z;
  vec3 n = normalize(vNormalX * sourceNormal.x + vNormalY * sourceNormal.y + vec3(0.0, 0.0, sourceNormal.z));
  vec2 normal = octNormal(n);
  gl_FragColor = vec4((floor(normal.x * 31.0 + 0.5) * 8.0 + flags) / 255.0, normal.y, packHeight(height));
}`;
const terrainVertex = `precision highp float; attribute vec3 aPosition; varying float vHeight; uniform vec4 uViewport; uniform vec2 uOffset;
void main() { vHeight = aPosition.z; gl_Position = vec4((aPosition.xy + uOffset - uViewport.xy) / uViewport.zw * 2.0 - 1.0, 0.0, 1.0); }`;
const terrainFragment = `precision highp float; varying float vHeight; ${materialShader}
void main() { gl_FragColor = vec4(128.0 / 255.0, 128.0 / 255.0, packHeight(vHeight)); }`;
const pointVertex = `precision highp float; attribute vec2 aPosition; attribute vec4 aLight; attribute vec3 aColor;
varying vec2 vWorld; varying vec4 vLight; varying vec3 vColor; uniform vec4 uViewport;
void main() { vWorld = aPosition; vLight = aLight; vColor = aColor; gl_Position = vec4((aPosition - uViewport.xy) / uViewport.zw * 2.0 - 1.0, 0.0, 1.0); }`;

export type WorldShadowShape =
  | "canopy"
  | "conifer"
  | "building"
  | "wall"
  | "character"
  | "column";
export type WorldShadows = ReturnType<typeof createWorldShadows>;
type Caster = {
  character?: Container;
  id: string;
  sprite: Sprite;
  description: WorldSpriteDescription;
  leases: ReturnType<typeof acquireWorldMaterial>[];
  materials: WorldMaterial[];
  sources: Map<Texture["source"], number>;
  active: boolean;
  cached: {
    pose: CachedPose;
    receiver: VisibleCaster;
    sun: SunCaster | null;
    lights: PointLight[];
  } | null;
  occluder: Occluder | null;
  occlusionKey: string;
  wind?: {
    group: number;
    transform: Float32Array;
    pose: {
      x: number;
      y: number;
      scale: { x: number; y: number };
      skew: { x: number; y: number };
      rotation: number;
    };
  };
};
type VisibleCaster = {
  record: Caster;
  material: WorldMaterial;
  frame: MaterialFrame;
  transform: Float32Array;
  height: number;
  bounds: WorldBounds;
  key: string;
  order: number;
  rootOrder: number;
  layerOrder: number;
};
type TerrainReceiver = {
  id: string;
  parent: Container;
  mesh: Mesh<Geometry, Shader>;
  minHeight: number;
};
type ReceiverBatch = {
  mesh: Mesh<Geometry, Shader>;
  buffer: Buffer;
  sources: WorldMaterial[];
};
type PointLight = {
  x: number;
  y: number;
  z: number;
  /** Horizontal reach on terrain below the fixture; the night cycle scales this before projection. */
  reach: number;
  color: [number, number, number];
};

/** Numeric snapshots avoid rebuilding strings for stationary scenery on every animation frame. */
type CachedPose = {
  parentMatrix: Matrix;
  parentOrder?: number;
  parentGroup?: number;
  originX: number;
  originY: number;
  texture: Texture;
  x: number;
  y: number;
  sx: number;
  sy: number;
  kx: number;
  ky: number;
  rotation: number;
  order: number;
  alpha: number;
  ax: number;
  ay: number;
};
