import alea from "alea";
import { Container, type RenderLayer, Sprite, Texture } from "pixi.js";
import {
  CRITTER_HABITATS,
  type Critter,
  type CritterClip,
  type CritterGroup,
  type CritterHabitat,
  type CritterSpecies,
  type CritterSpeciesId,
  type CritterSpot,
  critterFrame,
  planCritterGroups,
  stepCritterGroup,
} from "@/libs/critters";
import type { TerrainHex } from "@/libs/hexgrid";
import { createClipTextures } from "@/libs/rendering/primitives/animation";
import { acquireSoftShadowTexture } from "@/libs/rendering/primitives/shadow";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import { boundsOverlap, type WorldBounds } from "@/libs/rendering/visibility";

/** Groups per sector; performance mode keeps one small group. */
const GROUPS = { full: 2, light: 1 } as const;
const MEMBERS = { full: 8, light: 3 } as const;
/**
 * Members drawn at once, nearest groups first. A member between wind-animated scenery planes
 * splits their batch, so each costs about one draw call; joining the wind batcher instead
 * would draw it out of painter order beside default-batched structures.
 */
const DRAWN = { full: 12, light: 5 } as const;
/** Packed atlases load raw; species list their 128px sheets, plenty at map scale. */
const CELL_RENDITION = 0;
/** Feet sit this far above the cell's bottom edge once Sprite Studio seats a sheet. */
const FOOT_ANCHOR = 0.94;

/**
 * Wandering wildlife on the travel map. Members live in the shared depth layer so trees and
 * buildings occlude them, and publish live bounds beside the scenery's so actor ordering
 * checks treat them as ordinary planes. Off-screen groups pause; nothing allocates per frame.
 */
export const createWorldCritters = (
  game: GameRenderer,
  layers: { depth: RenderLayer; ground: RenderLayer },
  sceneryBounds: WeakMap<Container, WorldBounds>,
  lightLayout = false,
) => {
  const container = new Container({ label: "world-critters", eventMode: "none" });
  const detail = lightLayout ? "light" : "full";
  const sectors = new Map<number, SectorCritters>();
  const species = new Map<CritterSpeciesId, Promise<SpeciesFrames | null>>();
  const loaded = new Map<CritterSpeciesId, SpeciesFrames>();
  const shadowLease = acquireSoftShadowTexture();
  let shadowTexture: Texture | null = null;
  let disposed = false;
  let shown = false;
  void shadowLease.resource.then(
    (texture) => {
      shadowTexture = disposed ? null : texture;
    },
    () => undefined,
  );
  const { depth, ground } = layers;
  const roots = new Set<Container>();
  const indices = new WeakMap<Container, number>();
  const present = new Set<number>();
  const candidates: GroupView[] = [];
  const reach: WorldBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let paintedFrame = 0;

  const framesFor = (id: CritterSpeciesId, group: CritterGroup) => {
    let pending = species.get(id);
    if (!pending) {
      const clip = (source: CritterClip) =>
        createClipTextures(
          game,
          {
            images: [source.url],
            columns: source.columns,
            rows: source.rows,
            frameCount: source.frameCount,
            frameDurationMs: 1000 / source.fps,
            loop: true,
          },
          { size: 1, rendition: CELL_RENDITION },
        );
      pending = Promise.all([clip(group.species.move), clip(group.species.idle)]).then(
        ([move, idle]) => {
          const frames = { move: move.views, idle: idle.views };
          loaded.set(id, frames);
          return frames;
        },
        (error) => {
          if (!disposed) console.warn("Critter artwork unavailable", id, error);
          return null;
        },
      );
      species.set(id, pending);
    }
    return loaded.get(id) ?? null;
  };

  const addSector = (input: CritterSectorInput) => {
    const random = alea(`critters:${input.sector}`);
    const groups = planCritterGroups({
      key: String(input.sector),
      spots: input.spots(),
      tile: input.tile,
      maxGroups: GROUPS[detail],
      maxMembers: MEMBERS[detail],
      random,
    }).map((group) => ({
      group,
      clock: 0,
      tile: input.tile,
      random,
      input,
      distance: 0,
      shownFrame: -1,
      views: group.members.map((member) => {
        const root = new Container({ label: `critter:${group.key}`, visible: false });
        const shadow = new Sprite();
        shadow.anchor.set(0.5);
        shadow.alpha = 0.45;
        const body = new Sprite(Texture.EMPTY);
        body.anchor.set(0.5, FOOT_ANCHOR);
        root.addChild(shadow, body);
        container.addChild(root);
        depth.attach(root);
        // Contact shadows batch together under every actor instead of splitting depth draws.
        ground.attach(shadow);
        roots.add(root);
        return {
          member,
          root,
          body,
          shadow,
          frame: -1,
          moving: false,
          bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        };
      }),
    }));
    sectors.set(input.sector, { key: input.key, groups });
  };

  const removeSector = (sector: number) => {
    const entry = sectors.get(sector);
    if (!entry) return;
    for (const { views } of entry.groups)
      for (const view of views) {
        ground.detach(view.shadow);
        depth.detach(view.root);
        roots.delete(view.root);
        view.root.destroy({ children: true, texture: false, textureSource: false });
      }
    sectors.delete(sector);
  };

  /** Re-sort only when a member now crosses a neighbouring plane it actually overlaps. */
  const needsSort = () => {
    const siblings = depth.renderLayerChildren as Container[];
    for (const root of roots) {
      if (!root.visible) continue;
      let index = indices.get(root) ?? -1;
      if (siblings[index] !== root) {
        index = siblings.indexOf(root);
        indices.set(root, index);
      }
      if (index < 0) continue;
      const own = sceneryBounds.get(root);
      let comparisons = 0;
      for (const direction of [-1, 1])
        for (let j = index + direction; j >= 0 && j < siblings.length; j += direction) {
          const other = siblings[j];
          if (!other) continue;
          if (direction < 0 ? other.zIndex <= root.zIndex : other.zIndex >= root.zIndex)
            break;
          if (++comparisons > 64) return true;
          const otherBounds = sceneryBounds.get(other);
          if (!otherBounds || !own || boundsOverlap(own, otherBounds, 1)) return true;
        }
    }
    return false;
  };

  const update = (
    frame: GameFrame,
    window: ReadonlyMap<number, CritterSectorInput>,
    viewport: WorldBounds | null,
    enabled: boolean,
  ) => {
    if (disposed) return;
    if (!enabled) {
      if (shown) for (const root of roots) root.visible = false;
      shown = false;
      return;
    }
    shown = true;
    present.clear();
    for (const input of window.values()) {
      present.add(input.sector);
      const entry = sectors.get(input.sector);
      if (entry && entry.key !== input.key) removeSector(input.sector);
      if (!sectors.has(input.sector)) addSector(input);
    }
    if (sectors.size > present.size)
      for (const sector of sectors.keys())
        if (!present.has(sector)) removeSector(sector);
    paintedFrame++;
    candidates.length = 0;
    const centerX = viewport ? (viewport.minX + viewport.maxX) / 2 : 0,
      centerY = viewport ? (viewport.minY + viewport.maxY) / 2 : 0;
    for (const input of window.values()) {
      const entry = sectors.get(input.sector);
      if (!entry) continue;
      for (const view of entry.groups) {
        const leader = view.group.members[0];
        if (!leader || !framesFor(view.group.species.id, view.group)) continue;
        view.input = input;
        const x = input.position.x + leader.x,
          y = input.position.y + leader.y;
        const margin = (view.group.species.range + 2) * view.tile.width;
        reach.minX = x - margin;
        reach.maxX = x + margin;
        reach.minY = y - margin;
        reach.maxY = y + margin;
        if (viewport && !boundsOverlap(reach, viewport)) continue;
        view.distance = Math.hypot(x - centerX, y - centerY);
        candidates.push(view);
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const delta = frame.reducedMotion ? 0 : Math.min(0.1, frame.delta);
    const nowMs = frame.reducedMotion ? 0 : frame.now;
    let drawn = 0,
      moved = false;
    for (const view of candidates) {
      const { group, input, tile } = view;
      const frames = loaded.get(group.species.id);
      if (!frames || drawn + view.views.length > DRAWN[detail]) continue;
      drawn += view.views.length;
      view.shownFrame = paintedFrame;
      if (delta > 0) {
        view.clock += delta;
        stepCritterGroup(group, view.clock, delta, tile, view.random);
      }
      const height = group.species.height * tile.height;
      for (const member of view.views) {
        paint(member, frames, group.species, height, nowMs);
        const x = input.position.x + member.member.x,
          y = input.position.y + member.member.y;
        if (!member.root.visible || member.root.x !== x || member.root.y !== y) {
          member.root.visible = true;
          member.root.position.set(x, y);
          member.root.zIndex = -y;
          const half = height * 0.6;
          member.bounds.minX = x - half;
          member.bounds.maxX = x + half;
          member.bounds.minY = y;
          member.bounds.maxY = y + height;
          sceneryBounds.set(member.root, member.bounds);
          moved = true;
        }
      }
    }
    // Groups that left view or lost their slot to nearer ones pause where they stand.
    for (const entry of sectors.values())
      for (const view of entry.groups)
        if (view.shownFrame !== paintedFrame)
          for (const member of view.views) member.root.visible = false;
    if (moved && needsSort()) depth.sortRenderLayerChildren();
  };

  /** Swap textures only when the clip or its frame index changes. */
  const paint = (
    view: CritterView,
    frames: SpeciesFrames,
    species: CritterSpecies,
    height: number,
    nowMs: number,
  ) => {
    const { member, body, shadow } = view;
    const moving = member.moving;
    const clip = moving ? species.move : species.idle;
    const textures = moving ? frames.move : frames.idle;
    const index = critterFrame(member, clip, nowMs);
    if (index !== view.frame || moving !== view.moving || !body.texture.width) {
      const texture = textures[index] ?? textures[0];
      if (texture) {
        body.texture = texture;
        const scale = height / texture.height;
        body.scale.set(scale * member.facing, -scale);
      }
      view.frame = index;
      view.moving = moving;
    } else if (Math.sign(body.scale.x) !== member.facing) body.scale.x = -body.scale.x;
    if (shadowTexture && shadow.texture !== shadowTexture) {
      shadow.texture = shadowTexture;
      shadow.width = height * 0.75;
      shadow.height = height * 0.22;
    }
  };

  game.own(() => {
    disposed = true;
    for (const sector of [...sectors.keys()]) removeSector(sector);
    container.destroy({ children: true });
    shadowLease.release();
    shadowTexture = null;
  });
  return { container, update };
};

/** Open, dry tiles outside villages and roads, as foot points in sector-local world units. */
export const critterSpots = (tiles: Iterable<TerrainHex>): CritterSpot[] => {
  const spots: CritterSpot[] = [];
  for (const tile of tiles) {
    const habitat = tile.spec?.key as CritterHabitat | undefined;
    if (!habitat || !CRITTER_HABITATS.includes(habitat)) continue;
    if (tile.spec?.isWater || tile.hasStructure) continue;
    if (tile.zone && tile.zone !== "wilderness") continue;
    spots.push({
      x: -tile.center.x + tile.width / 2,
      y: -tile.center.y + tile.height * 0.3,
      habitat,
    });
  }
  return spots;
};

export type CritterSectorInput = {
  sector: number;
  /** Changes when the sector's terrain changes, which replans its groups. */
  key: string;
  position: { x: number; y: number };
  tile: { width: number; height: number };
  /** Read once when the sector is first planned. */
  spots: () => CritterSpot[];
};

type SpeciesFrames = { move: Texture[]; idle: Texture[] };
type CritterView = {
  member: Critter;
  root: Container;
  body: Sprite;
  shadow: Sprite;
  frame: number;
  moving: boolean;
  bounds: WorldBounds;
};
type GroupView = {
  group: CritterGroup;
  /** Seconds this group has been simulated; it only advances while drawn. */
  clock: number;
  tile: { width: number; height: number };
  random: () => number;
  input: CritterSectorInput;
  distance: number;
  shownFrame: number;
  views: CritterView[];
};
type SectorCritters = { key: string; groups: GroupView[] };
