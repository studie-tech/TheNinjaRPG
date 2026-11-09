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
import { NEAREST_TEXTURE_UV_BIAS, spriteGroundContact } from "@/libs/rendering/assets";
import type { BakedVillageLighting } from "@/libs/rendering/bakedVillageLighting";
import type { ProjectedWorldLighting } from "@/libs/rendering/projectedWorldLighting";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import type { HexTerrainData } from "@/libs/rendering/terrainData";
import { boundsOverlap, type WorldBounds } from "@/libs/rendering/visibility";
import { WORLD_DETAIL } from "@/libs/rendering/worldDetail";
import {
  fillLightFragment,
  lightingFragment,
  lightingVertex,
  materialShader,
  pointLightFragment,
} from "@/libs/rendering/worldLightingShaders";
import {
  acquireCharacterFrameMaterial,
  acquireWorldMaterial,
  acquireWorldSurfaceFrame,
  canopyShadowFrame,
  createCharacterMaterialFrame,
  installAuthoredFrames,
  type MaterialFrame,
  updateCharacterFrameMaterial,
  type WorldMaterial,
  worldMaterialFrame,
} from "@/libs/rendering/worldMaterials";
import { createWorldOcclusion, type Occluder } from "@/libs/rendering/worldOcclusion";
import type { worldSunlight } from "@/libs/rendering/worldSunlight";
import { createSunShadows, type SunCaster } from "@/libs/rendering/worldSunShadows";
import {
  MAX_SMALL_WORLD_WIND,
  MAX_WORLD_WIND,
  STILL_WORLD_WIND,
  type WorldWind,
  worldWindGroup,
  worldWindShader,
} from "@/libs/rendering/worldWind";
import { subscribeVisualEffects } from "@/libs/visualEffects";

/**
 * Physical albedo, matched receiver data and bounded lighting share one composite.
 * Sunlight uses cached light-space depth; cropped local lights clip rays against authored triangular prisms.
 * All coordinates are Y-up: a material texel at screen (x,y), height h represents (x,2(y−h),h).
 */
export const createWorldShadows = (game: GameRenderer, world: Container) => {
  const canInstance = typeof game.renderer.gl?.drawElementsInstanced === "function";
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
  // Shared pass uniforms are explicitly published below, rather than resynchronized per mesh.
  const wind = new UniformGroup(
    {
      uWind: { value: new Float32Array(4), type: "vec4<f32>" },
      uWindSmall: { value: new Float32Array(4), type: "vec4<f32>" },
    },
    { isStatic: true },
  );
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
    dynamicField = createWorldOcclusion({ direct: true, onError: onOcclusionError });
  const setOcclusionEnabled = (enabled: boolean) => {
    staticField.setEnabled(enabled);
    dynamicField.setEnabled(enabled);
  };
  setOcclusionEnabled(game.visualEffects.localLights && game.visualEffects.shadows);
  // Offscreen renderers have no frame to reconcile settings; stop queued work on the preference event itself.
  game.own(
    subscribeVisualEffects((effect, enabled) => {
      if (effect === "localLights" || effect === "shadows")
        setOcclusionEnabled(
          (effect === "localLights" ? enabled : game.visualEffects.localLights) &&
            (effect === "shadows" ? enabled : game.visualEffects.shadows),
        );
    }),
  );
  const view = new UniformGroup(
    {
      uViewport: { value: new Float32Array(4), type: "vec4<f32>" },
      uReceiverSize: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
      uWorldScale: { value: 1, type: "f32" },
    },
    { isStatic: true },
  );
  const lightUniforms = new UniformGroup(
    {
      uStaticBounds: { value: new Float32Array(4), type: "vec4<f32>" },
      uDynamicBounds: { value: new Float32Array(4), type: "vec4<f32>" },
      uFieldHeights: {
        value: new Float32Array([512, 512, 0, 0.01]),
        type: "vec4<f32>",
      },
      uStaticGeometry: { value: new Float32Array([0, 0, 1, 1]), type: "vec4<f32>" },
      uDynamicGeometry: { value: new Float32Array([0, 0, 1, 1]), type: "vec4<f32>" },
      uStaticTables: { value: new Float32Array([2048, 1, 2048, 1]), type: "vec4<f32>" },
      uDynamicTables: {
        value: new Float32Array([2048, 1, 2048, 1]),
        type: "vec4<f32>",
      },
      uLightStrength: { value: 1, type: "f32" },
      uShadows: { value: 1, type: "f32" },
      uDynamicDirect: { value: 0, type: "f32" },
      uInstanceCounts: { value: new Float32Array(2), type: "vec2<f32>" },
    },
    { isStatic: true },
  );
  const look = new UniformGroup(
    {
      uScreenSize: { value: new Float32Array(2), type: "vec2<f32>" },
      uScreenViewport: { value: new Float32Array(4), type: "vec4<f32>" },
      uAmbient: { value: new Float32Array(3), type: "vec3<f32>" },
      uSunColor: { value: new Float32Array(3), type: "vec3<f32>" },
      uDay: { value: 1, type: "f32" },
      uSunlight: { value: 1, type: "f32" },
      uLocalLights: { value: 1, type: "f32" },
    },
    { isStatic: true },
  );
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: lightingVertex, fragment: lightingFragment }),
    // Keep albedo at display density; retained lighting targets have independent budgets.
    resolution: game.renderer.resolution ?? 1,
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
  // Regions share a shader and a stable packed buffer instead of separate draw instructions.
  const terrainBuffer = new Buffer({
    data: new Float32Array(0),
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    shrinkToFit: false,
  });
  const terrainGeometry = new Geometry({
    attributes: {
      aPosition: { buffer: terrainBuffer, format: "float32x3", stride: 12 },
    },
  });
  const terrainShader = Shader.from({
    gl: { vertex: terrainVertex, fragment: terrainFragment },
    resources: { view },
  });
  const terrainState = new State();
  terrainState.blend = false;
  const terrainMesh = new Mesh({
    geometry: terrainGeometry,
    shader: terrainShader,
    state: terrainState,
  });
  terrainMesh.visible = false;
  terrainLayer.addChild(terrainMesh);
  let terrainKey = "";
  // Retain released sources until the cached receiver and depth passes relinquish their bindings.
  const retired: (() => void)[] = [];
  const records = new Set<Caster>(),
    terrains = new Set<TerrainReceiver>();
  let orderedRecords: Caster[] | null = null;
  let liveRecords: Caster[] = [];
  let sceneryOwners: Container[] = [];
  let sceneryCache: {
    bounds: WorldBounds;
    scale: number;
    receivers: VisibleCaster[];
    sun: SunCaster[];
    occluders: Occluder[];
    emitters: Caster[];
    candidates: Caster[];
    owners: {
      owner: Container;
      matrix: Matrix;
      visible: boolean;
      order?: number;
      group?: number;
    }[];
  } | null = null;
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
      aPosition: { buffer: pointBuffer, format: "float32x2", stride: 40, offset: 0 },
      aLight: { buffer: pointBuffer, format: "float32x4", stride: 40, offset: 8 },
      aColor: { buffer: pointBuffer, format: "float32x3", stride: 40, offset: 24 },
      aCastsShadows: { buffer: pointBuffer, format: "float32", stride: 40, offset: 36 },
    },
  });
  const fillShader = Shader.from({
    gl: { vertex: pointVertex, fragment: fillLightFragment },
    resources: { view, lights: lightUniforms, uReceiver: receiver.source },
  });
  let tracedShader: Shader | null = null;
  // Compiled only for a scene with a shadow-casting light. The fixed name keeps its source, and so
  // the browser's compiled-program cache entry, identical whichever scenes the session opened first.
  const pointShaderFor = (traced: boolean) => {
    if (!traced) return fillShader;
    tracedShader ??= Shader.from({
      gl: {
        name: "world-traced-lights",
        vertex: pointVertex,
        fragment: pointLightFragment,
      },
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
    return tracedShader;
  };
  const pointMesh = new Mesh({
    geometry: pointGeometry,
    shader: fillShader,
    blendMode: "add",
  });
  pointLayer.addChild(pointMesh);
  let serial = 0,
    hasSunCasters = false,
    disposed = false,
    receiverKey = "",
    receiverWindKey = "",
    pointKey = "";
  let pointLights: PointLight[] = [],
    pointDay = -1,
    pointRevision = 0;
  let coverage: {
    bounds: WorldBounds;
    pixelX: number;
    pixelY: number;
    width: number;
    height: number;
    baseWidth: number;
    baseHeight: number;
    anchorX: number;
    anchorY: number;
    padding: number;
  } | null = null;
  let receiverRevision = 0;
  let previousReceivers: VisibleCaster[] = [];
  const invalidate = () => {
    orderedRecords = null;
    sceneryCache = null;
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
    receiverBatches.length = 0;
    previousReceivers = [];
    terrainGeometry.destroy(true);
    terrainShader.destroy();
    terrains.clear();
    terrainLayer.destroy({ children: true });
    materialLayer.destroy({ children: true });
    pointGeometry.destroy(true);
    fillShader.destroy();
    tracedShader?.destroy();
    pointLayer.destroy({ children: true });
    filter.destroy();
    sun.dispose();
    for (const record of records) {
      record.active = false;
      record.cell?.lease.release();
      record.animatedMaterial?.texture.destroy(true);
      for (const lease of record.leases) lease.release();
    }
    records.clear();
    liveRecords = [];
    sceneryOwners = [];
    orderedRecords = null;
    sceneryCache = null;
    for (const release of retired.splice(0)) release();
    staticField.dispose();
    dynamicField.dispose();
    receiver.destroy(true);
    points.destroy(true);
    if (!container.destroyed) container.destroy({ children: true });
  });
  return {
    kind: "physical" as const,
    container,
    /**
     * Shares decoded materials and releases pending leases when an owner disappears.
     * sceneryOwner promises fixed child poses; its transform/visibility remain live.
     * Direct child edits must invalidate the retained scenery (wind uses its registered base pose).
     */
    register: (
      sprite: Sprite,
      description: WorldSpriteDescription,
      motionTextures: readonly Texture[] = [],
      character?: Container,
      sceneryOwner?: Container,
    ) => {
      const id = String(++serial);
      const leases = acquireCasterMaterials(description, !!character);
      const surfaces = character
        ? undefined
        : acquireCasterSurfaces(description, sprite.texture);
      const record: Caster = {
        id,
        sprite,
        character,
        sceneryOwner,
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
        selectionBounds: null,
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
      const ready = Promise.all([
        Promise.all(leases.map((lease) => lease.resource)),
        surfaces?.resource,
      ])
        .then(([materials, frames]) => {
          if (!record.active || disposed) return;
          const [still] = materials;
          if (still && frames !== undefined) installAuthoredFrames(still, frames);
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
        if (record.cell) retired.push(record.cell.lease.release);
        if (record.animatedMaterial) {
          const material = record.animatedMaterial;
          retired.push(() => material.texture.destroy(true));
        }
        records.delete(record);
        for (const lease of surfaces ? [...leases, surfaces] : leases) {
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
      for (const segment of data.segments)
        for (const tile of segment.tiles) {
          const height = data.faceOffsets.get(tile.key) ?? 0;
          minHeight = Math.min(minHeight, height);
          for (let i = tile.start; i < tile.start + tile.count; i++)
            values.push(
              segment.positions[i * 2] ?? 0,
              segment.positions[i * 2 + 1] ?? 0,
              height,
            );
        }
      const entry = {
        parent,
        positions: new Float32Array(values),
        id: String(++serial),
        minHeight,
        x: 0,
        y: 0,
        visible: false,
      };
      terrains.add(entry);
      invalidate();
      return () => {
        if (!terrains.delete(entry)) return;
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
      const { sunlight, dayNight, localLights, shadows } = game.visualEffects;
      const lighting = sunlight || dayNight || localLights;
      setOcclusionEnabled(localLights && shadows);
      if (filter.enabled !== lighting) {
        filter.enabled = lighting;
        invalidate();
      }
      // Unlit albedo needs no material, depth or local-light targets.
      if (!lighting) {
        for (const release of retired.splice(0)) release();
        return;
      }
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
      const nextRecords = orderedRecords ?? [...records];
      // Animated passes need a fresh image anyway; keep their raster work at screen size.
      // Still scenes can reuse a small border while the camera moves.
      const windMoves =
        breeze.large.some((value) => value !== 0) ||
        breeze.small.some((value) => value !== 0);
      const animated = nextRecords.some((record) =>
        record.wind
          ? windMoves
          : record.description.shadowCaster === "character" &&
            (!record.cached ||
              record.cached.pose.texture !== record.sprite.texture ||
              !record.cached.pose.parentMatrix.equals(
                origin(record.sprite.parent).matrix,
              )),
      );
      const padding = animated ? 0 : 16;
      const screenSpanX = globalViewport.maxX - globalViewport.minX,
        screenSpanY = globalViewport.maxY - globalViewport.minY;
      const baseWidth = Math.max(1, Math.min(2048, game.renderer.width)),
        baseHeight = Math.max(1, Math.min(2048, game.renderer.height));
      const pixelX = screenSpanX / baseWidth,
        pixelY = screenSpanY / baseHeight;
      // A screen-density border lets camera translation reuse material/light targets.
      // Keep the world texel grid fixed until coverage, zoom or output dimensions change.
      if (
        !coverage ||
        coverage.padding !== padding ||
        coverage.baseWidth !== baseWidth ||
        coverage.baseHeight !== baseHeight ||
        Math.abs(coverage.pixelX - pixelX) > pixelX * 1e-6 ||
        Math.abs(coverage.pixelY - pixelY) > pixelY * 1e-6 ||
        globalViewport.minX < coverage.bounds.minX ||
        globalViewport.maxX > coverage.bounds.maxX ||
        globalViewport.minY < coverage.bounds.minY ||
        globalViewport.maxY > coverage.bounds.maxY
      ) {
        const paddingX = Math.min(padding, Math.floor((2048 - baseWidth) / 2)),
          paddingY = Math.min(padding, Math.floor((2048 - baseHeight) / 2));
        const width = baseWidth + paddingX * 2,
          height = baseHeight + paddingY * 2;
        const minX = paddingX
            ? (Math.floor(globalViewport.minX / pixelX) - paddingX) * pixelX
            : globalViewport.minX,
          minY = paddingY
            ? (Math.floor(globalViewport.minY / pixelY) - paddingY) * pixelY
            : globalViewport.minY;
        coverage = {
          bounds: {
            minX,
            minY,
            maxX: minX + width * pixelX,
            maxY: minY + height * pixelY,
          },
          pixelX,
          pixelY,
          width,
          height,
          baseWidth,
          baseHeight,
          padding,
          // Local camera motion keeps cached poses; distant travel rebases within Float32 precision.
          anchorX:
            coverage && Math.abs(globalViewport.minX - coverage.anchorX) <= 1024
              ? coverage.anchorX
              : Math.floor(globalViewport.minX / 128) * 128,
          anchorY:
            coverage && Math.abs(globalViewport.minY - coverage.anchorY) <= 1024
              ? coverage.anchorY
              : Math.floor(globalViewport.minY / 128) * 128,
        };
      }
      const { anchorX, anchorY } = coverage;
      const viewport = {
        minX: coverage.bounds.minX - anchorX,
        maxX: coverage.bounds.maxX - anchorX,
        minY: coverage.bounds.minY - anchorY,
        maxY: coverage.bounds.maxY - anchorY,
      };
      const screenViewport = {
        minX: globalViewport.minX - anchorX,
        maxX: globalViewport.maxX - anchorX,
        minY: globalViewport.minY - anchorY,
        maxY: globalViewport.maxY - anchorY,
      };
      const spanX = viewport.maxX - viewport.minX,
        spanY = viewport.maxY - viewport.minY;
      const { width, height } = coverage;
      if (receiver.width !== width || receiver.height !== height) {
        receiver.resize(width, height);
        invalidate();
      }
      const pointWidth = Math.max(
          1,
          Math.ceil(width * WORLD_DETAIL.localLightResolution),
        ),
        pointHeight = Math.max(
          1,
          Math.ceil(height * WORLD_DETAIL.localLightResolution),
        );
      if (points.width !== pointWidth || points.height !== pointHeight) {
        points.resize(pointWidth, pointHeight);
        invalidate();
      }
      // Pixi transforms this rectangle through the container matrix; camera bounds must stay in local world units.
      container.filterArea = new Rectangle(
        globalViewport.minX,
        globalViewport.minY,
        screenSpanX,
        screenSpanY,
      );
      view.uniforms.uViewport.set([viewport.minX, viewport.minY, spanX, spanY]);
      view.uniforms.uReceiverSize.set([width, height]);
      view.uniforms.uWorldScale = scale;
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
      if (!orderedRecords) {
        orderedRecords = nextRecords;
        liveRecords = orderedRecords.filter((record) => !record.sceneryOwner);
        // Registrations own membership; camera selection only resnapshots owner poses.
        sceneryOwners = [
          ...new Set(
            orderedRecords.flatMap((record) =>
              record.sceneryOwner ? [record.sceneryOwner] : [],
            ),
          ),
        ];
      }
      // Fixed scenery shares one coarse visibility/pose snapshot. Wind remains a live shader input.
      const sceneryBounds = {
        minX: Math.floor(coverage.bounds.minX / 128) * 128,
        maxX: Math.ceil(coverage.bounds.maxX / 128) * 128,
        minY: Math.floor(coverage.bounds.minY / 128) * 128,
        maxY: Math.ceil(coverage.bounds.maxY / 128) * 128,
      };
      const sceneryViewport = {
        minX: sceneryBounds.minX - anchorX,
        maxX: sceneryBounds.maxX - anchorX,
        minY: sceneryBounds.minY - anchorY,
        maxY: sceneryBounds.maxY - anchorY,
      };
      const retainedPoses =
        sceneryCache &&
        sceneryCache.scale === scale &&
        sceneryCache.owners.every((previous) => {
          const current = origin(previous.owner);
          return (
            previous.matrix.equals(current.matrix) &&
            previous.visible === current.visible &&
            previous.order === current.drawRoot?.zIndex &&
            previous.group === current.drawRoot?.uid
          );
        })
          ? sceneryCache
          : null;
      const retainedScenery =
        retainedPoses &&
        retainedPoses.bounds.minX === sceneryBounds.minX &&
        retainedPoses.bounds.maxX === sceneryBounds.maxX &&
        retainedPoses.bounds.minY === sceneryBounds.minY &&
        retainedPoses.bounds.maxY === sceneryBounds.maxY;
      const candidates = retainedPoses?.candidates ?? orderedRecords;
      const scenery: Caster[] = [];
      if (retainedScenery)
        for (const record of sceneryCache?.emitters ?? [])
          if (
            record.cached &&
            boundsOverlap(record.cached.receiver.bounds, viewport, 384)
          )
            appendLights(record, record.cached.lights);
      for (const record of retainedScenery ? liveRecords : candidates) {
        if (
          retainedPoses &&
          record.sceneryOwner &&
          !record.cached &&
          record.selectionBounds &&
          !boundsOverlap(record.selectionBounds, sceneryBounds, 384)
        )
          continue;
        const { sprite, description } = record;
        const sourcePose = record.wind?.pose ?? sprite;
        if (sprite.destroyed || !sprite.visible || !record.materials.length) continue;
        const p = origin(sprite.parent);
        if (!p.visible) continue;
        const margin = 384;
        const recordViewport = record.sceneryOwner ? sceneryViewport : viewport;
        const dynamic = description.shadowCaster === "character";
        // Combat sheets replace the portrait's texture source after registration.
        // Their shadows must follow the live cell, never sample the old portrait material.
        const liveCell =
          dynamic && !record.character && !record.sources.has(sprite.texture.source);
        if (record.cell?.texture !== (liveCell ? sprite.texture : undefined)) {
          if (record.cell) retired.push(record.cell.lease.release);
          record.cell = undefined;
          if (!liveCell) record.cached = null;
          if (liveCell) {
            const lease = acquireCharacterFrameMaterial(sprite.texture);
            const previous = record.animatedMaterial;
            const material = updateCharacterFrameMaterial(lease.material, previous);
            record.cell = {
              texture: sprite.texture,
              lease,
              material,
            };
            if (previous && previous !== material)
              retired.push(() => previous.texture.destroy(true));
            record.animatedMaterial = material;
            record.cached = null;
            invalidate();
          }
        }
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
          if (!boundsOverlap(record.cached.receiver.bounds, recordViewport, margin))
            continue;
          if (record.sceneryOwner) {
            scenery.push(record);
            if (boundsOverlap(record.cached.receiver.bounds, viewport, 384))
              appendLights(record, record.cached.lights);
            continue;
          }
          visible.push(record.cached.receiver);
          if (record.cached.sun) sunCasters.push(record.cached.sun);
          if (record.occluder)
            (dynamic ? dynamicOccluders : staticOccluders).push(record.occluder);
          appendLights(record, record.cached.lights);
          continue;
        }
        const position = p.matrix.apply(sourcePose);
        const radius =
          description.size +
          Math.abs(sprite.width) * Math.max(Math.abs(p.matrix.a), Math.abs(p.matrix.d));
        const selectionBounds = {
          minX: position.x - radius,
          maxX: position.x + radius,
          minY: position.y - radius,
          maxY: position.y + radius,
        };
        if (record.sceneryOwner && !record.cached)
          record.selectionBounds = selectionBounds;
        if (
          !boundsOverlap(
            selectionBounds,
            record.sceneryOwner ? sceneryBounds : globalViewport,
            margin,
          )
        )
          continue;
        const recordLights: PointLight[] = [];
        const material =
          record.cell?.material ??
          record.materials[record.sources.get(sprite.texture.source) ?? 0] ??
          record.materials[0];
        if (!material) continue;
        const materialTexture = record.cell ? material.texture : sprite.texture;
        const sourceRatio = material.width / materialTexture.source.pixelWidth,
          heightRatio = material.height / materialTexture.source.pixelHeight;
        const frameRect = materialTexture.frame.clone();
        frameRect.x *= sourceRatio;
        frameRect.y *= heightRatio;
        frameRect.width *= sourceRatio;
        frameRect.height *= heightRatio;
        let frame: MaterialFrame;
        if (record.character || (dynamic && material.isBillboard)) {
          let cached = characterFrames.get(sprite.texture);
          if (!cached) {
            cached = createCharacterMaterialFrame(
              material,
              materialTexture,
              record.character
                ? undefined
                : (spriteGroundContact(sprite).y * materialTexture.orig.height) /
                    sprite.texture.orig.height,
            );
            characterFrames.set(sprite.texture, cached);
          }
          frame = cached;
        } else frame = worldMaterialFrame(material, frameRect);
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
        const contact =
          dynamic && !record.character ? spriteGroundContact(sprite) : undefined;
        const characterFoot = characterRoot
          ? characterRoot.matrix.apply({ x: 0, y: 28 / 64 })
          : contact
            ? m.apply({
                x: contact.x - w * sprite.anchor.x,
                y: contact.y - h * sprite.anchor.y,
              })
            : undefined;
        const characterHeight = characterRoot
          ? Math.hypot(characterRoot.matrix.c, characterRoot.matrix.d)
          : objectHeight;
        const bounds = quadBounds(transform);
        if (record.wind) {
          const margin = record.wind.group < 4 ? MAX_WORLD_WIND : MAX_SMALL_WORLD_WIND;
          bounds.minX -= margin;
          bounds.maxX += margin;
        }
        if (!boundsOverlap(bounds, recordViewport, margin)) continue;
        // Retained passes use the stored Float32 pose, including movement smaller than a screen pixel.
        const prepared = record.cached?.receiver;
        const receiverEntry = {
          // Translation changes only the two instance offsets; surface/atlas data belongs to the pose.
          vertices:
            canInstance &&
            prepared?.vertices &&
            pose?.texture === sprite.texture &&
            prepared.material === material &&
            prepared.frame === frame &&
            prepared.height === objectHeight &&
            prepared.transform[0] === transform[0] &&
            prepared.transform[1] === transform[1] &&
            prepared.transform[2] === transform[2] &&
            prepared.transform[3] === transform[3]
              ? prepared.vertices
              : undefined,
          record,
          material,
          frame,
          transform,
          height: objectHeight,
          bounds,
          order: p.drawRoot
            ? p.drawRoot.zIndex
            : sprite.zIndex || -(description.groundY + p.y),
          rootOrder: p.drawRoot?.uid ?? sprite.uid,
          layerOrder: sprite.zIndex,
        };
        if (!record.sceneryOwner) visible.push(receiverEntry);
        let sunEntry: SunCaster | null = null;
        // Receiving authored surface light does not make a small prop a sun or local-light occluder.
        if (description.shadowCaster) {
          const shadowFrame =
            description.shadowCaster === "canopy" && !description.small
              ? canopyShadowFrame(material, frame)
              : frame;
          // Shared wind uniforms deform the retained base pose in every physical pass.
          const stable = transform,
            casterHeight = objectHeight;
          const stableKey = `${record.id}:${sprite.texture.uid}:${frameRect.x}:${frameRect.y}:${stable}:${casterHeight}`;
          sunEntry = {
            id: record.id,
            key: stableKey,
            frame: shadowFrame,
            material,
            transform: stable,
            height: casterHeight,
            dynamic,
            wind: record.wind?.group,
          };
          if (!record.sceneryOwner) sunCasters.push(sunEntry);
          const fieldKey = `${record.id}:${sprite.texture.uid}:${frameRect.x}:${frameRect.y}:${frameRect.width}:${frameRect.height}:${[stable[0], stable[1], stable[2], stable[3], Math.fround((stable[4] ?? 0) + anchorX), Math.fround((stable[5] ?? 0) + anchorY)]}:${casterHeight}`;
          if (record.occlusionKey !== fieldKey) {
            // Instances share authored local geometry; the field inverts this same source transform per ray.
            const volumes = shadowFrame.volumes;
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
          if (record.occluder && !record.sceneryOwner)
            (dynamic ? dynamicOccluders : staticOccluders).push(record.occluder);
        }
        if (dynamic && record.occluder) {
          // An overhead fill stays above the head while its falloff reaches the ground around the feet.
          recordLights.push({
            x: (characterFoot?.x ?? record.occluder.footX) - anchorX,
            y:
              (characterFoot ? characterFoot.y * 2 : record.occluder.footY) -
              anchorY * 2,
            z: characterHeight + 2,
            reach: characterHeight * 0.65,
            color: [3, 2.5, 1.8],
            castsShadows: false,
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
              castsShadows: true,
            });
          }
        record.selectionBounds = null;
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
        if (record.sceneryOwner) {
          scenery.push(record);
          if (boundsOverlap(bounds, viewport, 384)) appendLights(record, recordLights);
        } else appendLights(record, recordLights);
      }
      if (!retainedScenery) {
        // Fixed passes share the same conservative selection; wind deforms retained geometry on the GPU.
        const receivers: VisibleCaster[] = [],
          sun: SunCaster[] = [],
          occluders: Occluder[] = [],
          emitters: Caster[] = [];
        const detailed = scenery
          .filter(
            (record) =>
              !record.description.small ||
              (record.cached?.receiver.height ?? 0) * scale >
                WORLD_DETAIL.groundLightingPixels[0] ||
              !!record.cached?.lights.length,
          )
          .sort((a, b) =>
            a.cached && b.cached
              ? receiverOrder(a.cached.receiver, b.cached.receiver)
              : 0,
          );
        for (const record of detailed) {
          const cached = record.cached;
          if (!cached) continue;
          if (cached.lights.length) emitters.push(record);
          if (
            record.description.small &&
            cached.receiver.height * scale <= WORLD_DETAIL.groundLightingPixels[0]
          )
            continue;
          if (
            record.sprite.alpha >= 0.75 &&
            boundsOverlap(cached.receiver.bounds, sceneryViewport, 2)
          )
            receivers.push(cached.receiver);
          if (cached.sun) sun.push(cached.sun);
          if (record.occluder) occluders.push(record.occluder);
        }
        sceneryCache = {
          bounds: sceneryBounds,
          scale,
          receivers,
          sun,
          occluders,
          emitters,
          // Flat, non-emitting poses stay excluded until their owners, scale or registrations change.
          // Unseen records remain candidates so entering the selection always prepares their material.
          candidates: candidates.filter(
            (record) =>
              !record.sceneryOwner ||
              !record.cached ||
              !record.description.small ||
              record.cached.receiver.height * scale >
                WORLD_DETAIL.groundLightingPixels[0] ||
              record.cached.lights.length > 0,
          ),
          owners: sceneryOwners.map((owner) => {
            const pose = origin(owner);
            return {
              owner,
              matrix: pose.matrix,
              visible: pose.visible,
              order: pose.drawRoot?.zIndex,
              group: pose.drawRoot?.uid,
            };
          }),
        };
      }
      // Keep a conservative static batch while panning; the viewport clips it at full screen density.
      const flatDetails = new Set<string>(),
        flatOccluders = new Set<Occluder>();
      const receivers = visible.filter((entry) => {
        if (
          entry.record.description.small &&
          entry.height * scale <= WORLD_DETAIL.groundLightingPixels[0]
        ) {
          flatDetails.add(entry.record.id);
          if (entry.record.occluder) flatOccluders.add(entry.record.occluder);
          return false;
        }
        return (
          entry.record.sprite.alpha >= 0.75 &&
          boundsOverlap(
            entry.bounds,
            entry.record.sceneryOwner ? sceneryViewport : viewport,
            2,
          )
        );
      });
      const detailedSunCasters = sunCasters.filter(
        (caster) => !flatDetails.has(caster.id),
      );
      const detailedOccluders = staticOccluders.filter(
        (caster) => !flatOccluders.has(caster),
      );
      receivers.push(...(sceneryCache?.receivers ?? []));
      detailedSunCasters.push(...(sceneryCache?.sun ?? []));
      detailedOccluders.push(...(sceneryCache?.occluders ?? []));
      receivers.sort(receiverOrder);
      const viewKey = `${viewport.minX}:${viewport.minY}:${spanX}:${spanY}`;
      let nextTerrainKey = "";
      let minReceiverHeight = 0;
      for (const terrain of terrains) {
        const p = origin(terrain.parent);
        terrain.visible = p.visible && terrain.parent.renderable;
        if (terrain.visible)
          minReceiverHeight = Math.min(minReceiverHeight, terrain.minHeight);
        // Match Float32 uniform offsets before adding the same local Float32 positions.
        terrain.x = Math.fround(p.x - anchorX);
        terrain.y = Math.fround(p.y - anchorY);
        nextTerrainKey += `${terrain.id}:${terrain.x}:${terrain.y}:${terrain.visible}`;
      }
      if (nextTerrainKey !== terrainKey) {
        terrainKey = nextTerrainKey;
        let length = 0;
        for (const terrain of terrains)
          if (terrain.visible) length += terrain.positions.length;
        const vertices =
          terrainBuffer.data.length === length
            ? (terrainBuffer.data as Float32Array)
            : new Float32Array(length);
        let offset = 0;
        for (const terrain of terrains) {
          if (!terrain.visible) continue;
          for (let i = 0; i < terrain.positions.length; i += 3) {
            vertices[offset++] = (terrain.positions[i] ?? 0) + terrain.x;
            vertices[offset++] = (terrain.positions[i + 1] ?? 0) + terrain.y;
            vertices[offset++] = terrain.positions[i + 2] ?? 0;
          }
        }
        terrainBuffer.data = vertices;
        terrainBuffer.update();
        terrainMesh.visible = length > 0;
      }
      const receiverView = viewKey + nextTerrainKey;
      const contentsChanged =
        previousReceivers.length !== receivers.length ||
        receivers.some((entry, index) => entry !== previousReceivers[index]);
      const receiverChanged = receiverView !== receiverKey || contentsChanged;
      if (receiverChanged) {
        receiverKey = receiverView;
        previousReceivers = receivers;
        receiverRevision++;
        // Camera uniforms do not change retained receiver vertices or texture slots.
        if (contentsChanged)
          updateReceiverBatches(
            receiverBatches,
            receivers,
            materialLayer,
            view,
            wind,
            canInstance,
          );
      }
      const nextReceiverKey = String(receiverRevision);
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
      if (sunlight && shadows && light.day > 0) {
        sun.update(
          detailedSunCasters,
          screenViewport,
          light,
          breeze,
          minReceiverHeight,
        );
        hasSunCasters = true;
      } else if (hasSunCasters) {
        sun.update([], screenViewport, light);
        hasSunCasters = false;
      }
      if (!shadows || !sunlight) {
        // Surface lighting follows the sun even when its depth maps are disabled.
        sun.setUnshadowedDirection(light);
      }
      const fieldBounds = {
        minX: globalViewport.minX - 192,
        maxX: globalViewport.maxX + 192,
        minY: globalViewport.minY * 2 - 640,
        maxY: globalViewport.maxY * 2 + 192,
      };
      if (localLights && shadows) {
        staticField.update(
          detailedOccluders,
          fieldBounds,
          occlusionHeightRange(detailedOccluders),
        );
        dynamicField.update(
          dynamicOccluders,
          fieldBounds,
          occlusionHeightRange(dynamicOccluders),
        );
      }
      let receiverHalfQuantum = 0;
      for (const entry of receivers)
        if (!entry.material.isBillboard && boundsOverlap(entry.bounds, viewport, 2))
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
      if (!localLights) lights.length = 0;
      const nextPointDay = Math.round(light.day * 256);
      // Cached emitter snapshots are immutable; camera and wind leave their identities intact.
      const pointGeometryChanged =
        pointDay !== nextPointDay ||
        pointLights.length !== lights.length ||
        lights.some((entry, index) => entry !== pointLights[index]);
      if (pointGeometryChanged) pointRevision++;
      // Shadowless fill depends on wind only where a swaying receiver meets its light pool.
      const windChangesPoints =
        (shadows &&
          lights.some((entry) => entry.castsShadows) &&
          (detailedOccluders.some((entry) => entry.wind !== undefined) ||
            dynamicOccluders.some((entry) => entry.wind !== undefined))) ||
        (hasWindReceivers &&
          receivers.some(
            (entry) =>
              entry.record.wind &&
              lights.some((pointLight) => {
                const { radius, cy, ry } = pointLightBounds(pointLight, light.day);
                return boundsOverlap(entry.bounds, {
                  minX: pointLight.x - radius,
                  maxX: pointLight.x + radius,
                  minY: cy - ry,
                  maxY: cy + ry,
                });
              }),
          ));
      const nextPointKey =
        lights.length === 0
          ? "empty"
          : nextReceiverKey +
            `${staticField.revision}:${dynamicField.revision}` +
            `:${pointRevision}:${shadows}:` +
            (windChangesPoints ? breeze.key : "");
      lightUniforms.uniforms.uStaticBounds.set(
        boundsUniform(staticField.bounds, anchorX, anchorY * 2),
      );
      lightUniforms.uniforms.uDynamicBounds.set(
        boundsUniform(dynamicField.bounds, anchorX, anchorY * 2),
      );
      lightUniforms.uniforms.uDynamicDirect = dynamicField.directCount;
      lightUniforms.uniforms.uInstanceCounts.set([
        staticField.instanceCount,
        dynamicField.instanceCount,
      ]);
      lightUniforms.uniforms.uShadows = Number(shadows);
      lightUniforms.uniforms.uLightStrength = 1 - light.day * 0.85;
      lightUniforms.update();
      if (pointKey !== nextPointKey) {
        pointKey = nextPointKey;
        // Wind changes visibility, while stationary light bounds keep their vertex buffer.
        if (pointGeometryChanged) {
          const resized = pointBuffer.data.length !== lights.length * 60;
          if (resized) pointBuffer.data = new Float32Array(lights.length * 60);
          const vertices = pointBuffer.data as Float32Array;
          for (const [index, l] of lights.entries()) {
            if (!resized && pointDay === nextPointDay && l === pointLights[index])
              continue;
            const { radius, cy, ry } = pointLightBounds(l, light.day);
            let offset = index * 60;
            // Offscreen quads clip on the GPU; only changed lights rewrite their retained slots.
            for (const [u, v] of corners) {
              vertices.set(
                [
                  l.x + (u - 0.5) * radius * 2,
                  cy + (v - 0.5) * ry * 2,
                  l.x,
                  l.y,
                  l.z,
                  radius,
                  ...l.color,
                  Number(l.castsShadows),
                ],
                offset,
              );
              offset += 10;
            }
          }
          pointLights = lights;
          pointDay = nextPointDay;
          pointBuffer.update();
          pointMesh.visible = vertices.length > 0;
        }
        pointMesh.shader = pointShaderFor(
          shadows && lights.some((entry) => entry.castsShadows),
        );
        game.renderer.render({
          container: pointLayer,
          target: points,
          clear: true,
          clearColor: [0, 0, 0, 0],
        });
      }
      const day = dayNight ? light.day : 1;
      look.uniforms.uScreenSize.set([game.renderer.width, game.renderer.height]);
      look.uniforms.uScreenViewport.set([
        screenViewport.minX,
        screenViewport.minY,
        screenSpanX,
        screenSpanY,
      ]);
      // Neutral daylight replaces directional shading when sunlight is disabled.
      look.uniforms.uAmbient.set([
        0.13 + (sunlight ? 0.19 : 0.87) * day,
        0.22 + (sunlight ? 0.12 : 0.78) * day,
        0.31 + (sunlight ? 0.03 : 0.69) * day,
      ]);
      const horizon = 1 - light.z;
      look.uniforms.uSunColor.set([
        0.78 + horizon * 0.16,
        0.77 - horizon * 0.15,
        0.7 - horizon * 0.22,
      ]);
      look.uniforms.uDay = light.day;
      look.uniforms.uSunlight = Number(sunlight);
      look.uniforms.uLocalLights = Number(localLights);
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
/** Projected light spheres exclude fixtures whose illumination cannot reach the viewport. */
const pointLightBounds = (light: PointLight, day: number) => {
  const radius = Math.hypot(light.z, light.reach * (1.5 - day * 0.5));
  const cy = light.y * 0.5 + light.z,
    ry = radius * Math.sqrt(1.25);
  return {
    radius,
    cy,
    ry,
    minX: light.x - radius,
    maxX: light.x + radius,
    minY: cy - ry,
    maxY: cy + ry,
  };
};

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

/** Material quads follow the same ground, root and layer ordering as the visible artwork. */
const receiverOrder = (a: VisibleCaster, b: VisibleCaster) =>
  // Ground cover belongs below all upright art, independently of its foot coordinate.
  Number(!a.record.description.small) - Number(!b.record.description.small) ||
  a.order - b.order ||
  a.rootOrder - b.rootOrder ||
  a.layerOrder - b.layerOrder;

/** Batches adjacent painter-ordered quads; atlas limits never reorder overlapping artwork. */
const updateReceiverBatches = (
  batches: ReceiverBatch[],
  casters: VisibleCaster[],
  layer: Container,
  view: UniformGroup,
  wind: UniformGroup,
  instanced: boolean,
) => {
  const pending: {
    sources: WorldMaterial[];
    casters: VisibleCaster[];
    dynamic: boolean;
  }[] = [];
  for (const entry of casters) {
    const dynamic =
      entry.record.description.shadowCaster === "character" ||
      !!entry.record.description.motion;
    let batch = pending.at(-1);
    if (
      !batch ||
      batch.dynamic !== dynamic ||
      (batch.sources.length === 8 && !batch.sources.includes(entry.material))
    ) {
      batch = { sources: [], casters: [], dynamic };
      pending.push(batch);
    }
    if (!batch.sources.includes(entry.material)) batch.sources.push(entry.material);
    batch.casters.push(entry);
  }
  const available = batches.slice();
  const retained: ReceiverBatch[] = [];
  for (let i = 0; i < pending.length; i++) {
    const next = pending[i];
    if (!next) continue;
    // Material bindings own the GPU batch; painter-order insertion only changes its position.
    const match = available.findIndex(
      (batch) =>
        batch.sources.length === next.sources.length &&
        batch.sources.every((source, index) => source === next.sources[index]),
    );
    let batch = match < 0 ? undefined : available.splice(match, 1)[0];
    // Camera uniforms and wind can change without changing any receiver vertices.
    if (
      batch &&
      batch.casters.length === next.casters.length &&
      next.casters.every((entry, index) => entry === batch?.casters[index])
    ) {
      retained.push(batch);
      if (layer.children[i] !== batch.mesh) layer.setChildIndex(batch.mesh, i);
      continue;
    }
    const stride = instanced ? 28 : 120;
    const length = next.casters.length * stride;
    const vertices =
      batch?.buffer.data instanceof Float32Array && batch.buffer.data.length === length
        ? batch.buffer.data
        : new Float32Array(length);
    for (const [entryIndex, entry] of next.casters.entries()) {
      entry.vertices ??= receiverVertices(entry, instanced);
      const packed = entry.vertices;
      const offset = entryIndex * stride;
      vertices.set(packed, offset);
      if (instanced) {
        vertices[offset + 2] = entry.transform[4] ?? 0;
        vertices[offset + 6] = entry.transform[5] ?? 0;
      }
      const slot = next.sources.indexOf(entry.material);
      for (let vertex = 0; vertex < stride; vertex += instanced ? 28 : 20)
        vertices[offset + vertex + (instanced ? 13 : 5)] = slot;
    }

    if (!batch) {
      const buffer = new Buffer({
        data: new Float32Array(0),
        usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        shrinkToFit: false,
      });
      const geometry = new Geometry({
        attributes: instanced
          ? {
              aCorner: {
                buffer: new Buffer({
                  data: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
                  usage: BufferUsage.VERTEX,
                }),
                format: "float32x2",
              },
              aObjectX: {
                buffer,
                format: "float32x4",
                stride: 112,
                offset: 0,
                instance: true,
              },
              aObjectY: {
                buffer,
                format: "float32x4",
                stride: 112,
                offset: 16,
                instance: true,
              },
              aUVRect: {
                buffer,
                format: "float32x4",
                stride: 112,
                offset: 32,
                instance: true,
              },
              aData: {
                buffer,
                format: "float32x4",
                stride: 112,
                offset: 48,
                instance: true,
              },
              aNormalX: {
                buffer,
                format: "float32x4",
                stride: 112,
                offset: 64,
                instance: true,
              },
              aNormalY: {
                buffer,
                format: "float32x4",
                stride: 112,
                offset: 80,
                instance: true,
              },
              aTrim: {
                buffer,
                format: "float32x4",
                stride: 112,
                offset: 96,
                instance: true,
              },
            }
          : {
              aPosition: { buffer, format: "float32x2", stride: 80, offset: 0 },
              aUV: { buffer, format: "float32x2", stride: 80, offset: 8 },
              aData: { buffer, format: "float32x4", stride: 80, offset: 16 },
              aNormalX: { buffer, format: "float32x3", stride: 80, offset: 32 },
              aNormalY: { buffer, format: "float32x3", stride: 80, offset: 44 },
              // Native dimensions, world units per texel, and the low-cover material marker.
              aPixel: { buffer, format: "float32x4", stride: 80, offset: 56 },
              aWind: { buffer, format: "float32x2", stride: 80, offset: 72 },
            },
      });
      if (instanced) geometry.addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
      const shader = Shader.from({
        gl: { vertex: receiverVertex(instanced), fragment: receiverFragment },
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
      batch = { mesh, buffer, sources: next.sources, casters: next.casters };
      batches.push(batch);
    }
    batch.casters = next.casters;
    if (instanced) batch.mesh.geometry.instanceCount = next.casters.length;
    batch.buffer.data = vertices;
    batch.buffer.update();
    retained.push(batch);
    if (layer.children[i] !== batch.mesh) layer.setChildIndex(batch.mesh, i);
  }
  for (const batch of available) destroyBatch(batch);
  batches.splice(0, batches.length, ...retained);
};
/** A pose owns its packed geometry; texture-slot assignment belongs to its current adjacent batch. */
const receiverVertices = (entry: VisibleCaster, instanced: boolean) => {
  const vertices: number[] = [];
  const index = 0;
  // Live cells own a standalone material; its UVs and texel scale must use that cell, not the albedo atlas.
  const texture = entry.record.cell
    ? entry.material.texture
    : entry.record.sprite.texture;
  const sourceRatio = entry.material.width / texture.source.pixelWidth;
  const heightRatio = entry.material.height / texture.source.pixelHeight;
  const frame = texture.frame,
    m = entry.transform;
  // Inverse transpose of the source-pixel surface transform, scaled by object height.
  // The physical basis is (x, -2*(y+height), height), so screen shear also changes a wall's normal.
  const aspect = entry.record.character
      ? texture.orig.width / texture.orig.height
      : frame.width / frame.height,
    h = entry.height;
  const a = (m[0] ?? 0) / aspect,
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
  // Match albedo sampling at texel boundaries so receiver normals/coverage do not reintroduce bands.
  if (instanced) {
    const { orig, trim } = texture;
    // One object record drives a shared quad; GPU positioning does not duplicate the per-object normal basis.
    vertices.push(
      m[0] ?? 0,
      m[2] ?? 0,
      m[4] ?? 0,
      entry.material.width,
      m[1] ?? 0,
      m[3] ?? 0,
      m[5] ?? 0,
      entry.material.height,
      (frame.x * sourceRatio) / entry.material.width + NEAREST_TEXTURE_UV_BIAS,
      (frame.y * heightRatio) / entry.material.height + NEAREST_TEXTURE_UV_BIAS,
      (frame.width * sourceRatio) / entry.material.width,
      (frame.height * heightRatio) / entry.material.height,
      h,
      index,
      entry.material.isBillboard
        ? (frame.y -
            (entry.record.character ? (trim?.y ?? 0) + orig.height / 2 - 28 : 0)) /
            texture.source.pixelHeight
        : 0,
      entry.material.isBillboard
        ? (entry.record.character ? orig.height : frame.height) /
            texture.source.pixelHeight
        : 0,
      ...normalX,
      h / ((entry.record.character ? orig.height : frame.height) * heightRatio),
      ...normalY,
      (entry.record.wind ? entry.record.wind.group + 2 : 1) *
        (entry.record.description.small ? -1 : 1),
      entry.record.character ? (trim?.x ?? 0) / orig.width : 0,
      entry.record.character ? (trim?.y ?? 0) / orig.height : 0,
      entry.record.character ? (trim?.width ?? orig.width) / orig.width : 1,
      entry.record.character ? (trim?.height ?? orig.height) / orig.height : 1,
    );
    return new Float32Array(vertices);
  }
  for (const [u, v] of corners) {
    const { orig, trim } = texture;
    const logicalU = entry.record.character
      ? ((trim?.x ?? 0) + u * (trim?.width ?? orig.width)) / orig.width
      : u;
    const logicalV = entry.record.character
      ? ((trim?.y ?? 0) + v * (trim?.height ?? orig.height)) / orig.height
      : v;
    vertices.push(
      (m[4] ?? 0) + (m[0] ?? 0) * logicalU + (m[2] ?? 0) * logicalV,
      (m[5] ?? 0) + (m[1] ?? 0) * logicalU + (m[3] ?? 0) * logicalV,
      ((frame.x + u * frame.width) * sourceRatio) / entry.material.width +
        NEAREST_TEXTURE_UV_BIAS,
      ((frame.y + v * frame.height) * heightRatio) / entry.material.height +
        NEAREST_TEXTURE_UV_BIAS,
      entry.height,
      index,
      entry.material.isBillboard
        ? (frame.y -
            (entry.record.character ? (trim?.y ?? 0) + orig.height / 2 - 28 : 0)) /
            texture.source.pixelHeight
        : 0,
      entry.material.isBillboard
        ? (entry.record.character ? orig.height : frame.height) /
            texture.source.pixelHeight
        : 0,
      ...normalX,
      ...normalY,
      entry.material.width,
      entry.material.height,
      entry.height /
        ((entry.record.character ? orig.height : frame.height) * heightRatio),
      Number(entry.record.description.small === true),
      entry.record.wind ? entry.record.wind.group + 1 : 0,
      1 - v,
    );
  }

  return new Float32Array(vertices);
};

const destroyBatch = (batch: ReceiverBatch) => {
  batch.mesh.shader?.destroy();
  batch.mesh.geometry.destroy(true);
  batch.mesh.destroy();
};
const receiverVertex = (instanced: boolean) => `precision highp float;
${
  instanced
    ? `attribute vec2 aCorner; attribute vec4 aObjectX; attribute vec4 aObjectY;
attribute vec4 aUVRect; attribute vec4 aTrim; attribute vec4 aNormalX; attribute vec4 aNormalY;`
    : `attribute vec2 aPosition; attribute vec2 aUV;
attribute vec3 aNormalX; attribute vec3 aNormalY; attribute vec2 aWind; attribute vec4 aPixel;`
}
attribute vec4 aData;
${worldWindShader}
varying vec2 vUV; varying vec4 vData; varying vec3 vNormalX; varying vec3 vNormalY; varying vec3 vPixel; varying float vDetail; uniform vec4 uViewport; uniform float uWorldScale;
void main() {
  ${
    instanced
      ? `vec2 logical = aTrim.xy + aCorner * aTrim.zw;
  vec2 position = vec2(dot(aObjectX.xy, logical) + aObjectX.z,
    dot(aObjectY.xy, logical) + aObjectY.z);
  vUV = aUVRect.xy + aCorner * aUVRect.zw;
  vNormalX = aNormalX.xyz; vNormalY = aNormalY.xyz;
  vPixel = vec3(aObjectX.w, aObjectY.w, aNormalX.w);
  float small = aNormalY.w < 0.0 ? 1.0 : 0.0;
  float windCode = abs(aNormalY.w) - 1.0;`
      : `vec2 position = aPosition; vUV = aUV; vNormalX = aNormalX; vNormalY = aNormalY;
  vPixel = aPixel.xyz; float small = aPixel.w; float windCode = aWind.x;`
  }
  vData = aData;
  vDetail = small > 0.5 ? smoothstep(${WORLD_DETAIL.groundLightingPixels[0].toFixed(1)}, ${WORLD_DETAIL.groundLightingPixels[1].toFixed(1)}, aData.x * uWorldScale) : 1.0;
  float dx = worldWind(windCode);
  // Inverse transpose of the rooted shear, including a rotated source plane.
  float slope = dx / max(aData.x, 0.00001);
  vec3 rootedNormalY = vNormalY;
  float stretch = 1.0 + slope * 0.5 * rootedNormalY.x;
  vNormalX.x /= stretch; vNormalY.x /= stretch;
  vNormalX.yz -= vec2(slope * 0.5, slope) * rootedNormalY.y * vNormalX.x;
  vNormalY.yz -= vec2(slope * 0.5, slope) * rootedNormalY.y * vNormalY.x;
  position += vec2(dx * ${instanced ? "(1.0 - aCorner.y)" : "aWind.y"}, 0.0);
  gl_Position = vec4((position - uViewport.xy) / uViewport.zw * 2.0 - 1.0, 0.0, 1.0); }`;
const receiverFragment = `precision highp float;
precision highp sampler2D; // Preserve material flags, coverage and height before receiver encoding.
varying vec2 vUV; varying vec4 vData; varying vec3 vNormalX; varying vec3 vNormalY; varying vec3 vPixel; varying float vDetail;
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
  // Tiny cover inherits the ground plane gradually; primary art keeps its full physical material.
  height *= vDetail;
  n = normalize(mix(vec3(0.0, 0.0, 1.0), n, vDetail));
  vec2 normal = octNormal(n);
  gl_FragColor = vec4((floor(normal.x * 31.0 + 0.5) * 8.0 + flags) / 255.0, normal.y, packHeight(height));
}`;
const terrainVertex = `precision highp float; attribute vec3 aPosition; varying float vHeight; uniform vec4 uViewport;
void main() { vHeight = aPosition.z; gl_Position = vec4((aPosition.xy - uViewport.xy) / uViewport.zw * 2.0 - 1.0, 0.0, 1.0); }`;
const terrainFragment = `precision highp float; varying float vHeight; ${materialShader}
void main() { gl_FragColor = vec4(128.0 / 255.0, 128.0 / 255.0, packHeight(vHeight)); }`;
const pointVertex = `precision highp float; attribute vec2 aPosition; attribute vec4 aLight; attribute vec3 aColor; attribute float aCastsShadows;
varying vec2 vWorld; varying vec4 vLight; varying vec3 vColor; varying float vCastsShadows; uniform vec4 uViewport;
void main() { vWorld = aPosition; vLight = aLight; vColor = aColor; vCastsShadows = aCastsShadows; gl_Position = vec4((aPosition - uViewport.xy) / uViewport.zw * 2.0 - 1.0, 0.0, 1.0); }`;

export type WorldShadowShape =
  | "canopy"
  | "conifer"
  | "building"
  | "wall"
  | "character"
  | "column";
/**
 * Leases a physical caster's materials. Sprite loading acquires them beside its artwork,
 * so registration reuses decoded materials instead of starting another download.
 */
export const acquireCasterMaterials = (
  description: WorldSpriteDescription,
  character = false,
) =>
  [description.image, ...(description.motion?.clip.images ?? [])].map((image) =>
    acquireWorldMaterial(
      image,
      description.shadowCaster ?? "column",
      character ? 0 : 128,
      description.worldMaterial,
    ),
  );
/**
 * Leases the authored topology of a catalogue caster's frame; registration reuses it.
 * Persisted materials (`worldMaterial`) load their whole atlas with the material.
 */
export const acquireCasterSurfaces = (
  description: WorldSpriteDescription,
  texture?: Texture,
) =>
  description.worldMaterial
    ? undefined
    : acquireWorldSurfaceFrame(description.image, description.frame, texture);
/** Common registration/update contract for physical, projected and prebaked scene lighting. */
export type WorldShadows =
  | ReturnType<typeof createWorldShadows>
  | ProjectedWorldLighting
  | BakedVillageLighting;
type Caster = {
  character?: Container;
  sceneryOwner?: Container;
  id: string;
  sprite: Sprite;
  description: WorldSpriteDescription;
  leases: ReturnType<typeof acquireWorldMaterial>[];
  materials: WorldMaterial[];
  animatedMaterial?: WorldMaterial;
  cell?: {
    texture: Texture;
    lease: ReturnType<typeof acquireCharacterFrameMaterial>;
    material: WorldMaterial;
  };
  sources: Map<Texture["source"], number>;
  active: boolean;
  /** Fixed, unprepared poses retain their conservative world bounds until owner invalidation. */
  selectionBounds: WorldBounds | null;
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
  /** Packed vertices stay valid for this immutable material/pose; batch-local texture slots are copied separately. */
  vertices?: Float32Array;
  record: Caster;
  material: WorldMaterial;
  frame: MaterialFrame;
  transform: Float32Array;
  height: number;
  bounds: WorldBounds;
  order: number;
  rootOrder: number;
  layerOrder: number;
};
type TerrainReceiver = {
  id: string;
  parent: Container;
  positions: Float32Array;
  x: number;
  y: number;
  visible: boolean;
  minHeight: number;
};
type ReceiverBatch = {
  casters: VisibleCaster[];
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
  /** Character fill lights illuminate freely; fixed fixtures trace scene occlusion. */
  castsShadows: boolean;
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
