import type { Grid } from "honeycomb-grid";
import { Container, Graphics, Rectangle, type RenderLayer, Text } from "pixi.js";
import {
  IMG_AVATAR_DEFAULT,
  IMG_ICON_HEAL,
  IMG_MAP_QUEST_ICON,
  IMG_SECTOR_ATTACK,
  IMG_SECTOR_INFO,
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
  IMG_SECTOR_USERSPRITE_LEFT,
  IMG_SECTOR_USERSPRITE_RIGHT,
  IMG_SECTOR_VS_ICON,
  MEDNIN_MIN_RANK,
  RANKS_RESTRICTED_FROM_PVP,
  WORLD_DAY_BRIGHTNESS,
} from "@/drizzle/constants";
import { PathCalculator, type TerrainHex } from "@/libs/hexgrid";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { lpcFacing } from "@/libs/lpc/catalog";
import { passesBracketFilter } from "@/libs/profile";
import { getActiveObjectives } from "@/libs/quest";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import { createRenderScope } from "@/libs/rendering/scope";
import type {
  WorldMotionDirection,
  WorldSpriteDescription,
} from "@/libs/rendering/sectorSprites";
import {
  boundsOverlap,
  isObjectChainVisible,
  type WorldBounds,
} from "@/libs/rendering/visibility";
import { WORLD_DETAIL } from "@/libs/rendering/worldDetail";
import type { WorldShadows } from "@/libs/rendering/worldShadows";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { hasRequiredRank } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { isMapUserAlly } from "@/utils/alliance";
import type { LpcDirection } from "@/validators/lpc";

/** Actor identity and art stay stable across position and presence updates. */
export const createTravelActors = (
  game: GameRenderer,
  layers?: { depth: RenderLayer; overlay: RenderLayer; ground?: RenderLayer },
  shadows?: WorldShadows,
  /** Fixed artwork supplies conservative world-space bounds; unknown poses retain global contact ordering. */
  sceneryBounds?: WeakMap<Container, WorldBounds>,
) => {
  const container = new Container();
  const records = new Map<string, ActorRecord>();
  const byRoot = new Map<Container, ActorRecord>();
  const appearanceParts = new Map<
    string,
    { key: string; parts: WorldSpriteDescription[] }
  >();
  const signatures = new WeakMap<WorldSpriteDescription[], string>();
  const partsFor = (user: SectorUser, tile: TerrainHex) => {
    const id = userActorKey(user);
    // Position and health updates retain artwork; every input used by userParts belongs in this key.
    const key = JSON.stringify([
      user.spriteAppearance,
      user.avatar,
      user.avatarLight,
      user.isNpc,
      user.rank,
      user.allianceStatus,
      user.npcInteractionType,
      tile.width,
      tile.height,
    ]);
    const previous = appearanceParts.get(id);
    if (previous?.key === key) return previous.parts;
    const parts = userParts(user, tile);
    appearanceParts.set(id, { key, parts });
    return parts;
  };
  let viewer: UserWithRelations;
  let users: SectorUser[] = [];
  let friendlyAttack = false;
  let brightness = WORLD_DAY_BRIGHTNESS;
  let hovered: string | null = null;
  let paths: PathCalculator | null = null;
  let pathGrid: Grid<TerrainHex> | null = null;
  let actorSector: number | null = null;
  let sourceSnapshot: TravelActorsSnapshot | null = null;
  let viewport: WorldBounds | null = null;
  let stableViewport: Record<keyof WorldBounds, [number, number]> | null = null;
  let visibleKey = "";
  const movementOrder = new Map<
    string,
    {
      x: number;
      y: number;
      sector: number;
      order: number;
      initialTime: number;
      step?: number;
    }
  >();
  let selectionKey: string | null = null;
  let characterKeys = new Set<string>();
  let paintedOriginY = container.y;
  /** Cull before acquiring artwork; padding preloads nearby actors and the viewer stays present. */
  const visibleSnapshot = (snapshot: TravelActorsSnapshot) => {
    const bounds = viewport;
    const domain: typeof stableViewport = bounds
      ? {
          minX: [-Infinity, Infinity],
          maxX: [-Infinity, Infinity],
          minY: [-Infinity, Infinity],
          maxY: [-Infinity, Infinity],
        }
      : null;
    const boundary = (axis: keyof WorldBounds, value: number) => {
      if (!bounds || !domain) return;
      const range = domain[axis];
      if (bounds[axis] < value) range[1] = Math.min(range[1], value);
      else if (bounds[axis] > value) range[0] = Math.max(range[0], value);
      else range[0] = range[1] = value;
    };
    // Occupants share tile geometry and the exact camera boundaries that change membership.
    const tiles = new Map<
      string,
      { visible: boolean; onScreen: boolean } | undefined
    >();
    const tileFor = (user: SectorUser) => {
      const key = `${user.longitude},${user.latitude}`;
      if (tiles.has(key)) return tiles.get(key);
      const tile = snapshot.grid.getHex({ col: user.longitude, row: user.latitude });
      if (!tile) {
        tiles.set(key, undefined);
        return undefined;
      }
      const x = -tile.center.x,
        y = -tile.center.y,
        width = tile.width,
        height = tile.height;
      boundary("minX", x + width * 3);
      boundary("minX", x + width * 2);
      boundary("maxX", x - width * 3);
      boundary("maxX", x - width);
      boundary("minY", y + height * 3);
      boundary("minY", y + height * 2.4);
      boundary("maxY", y - height * 3);
      boundary("maxY", y - height);
      const entry = {
        visible:
          !bounds ||
          (x >= bounds.minX - width * 3 &&
            x <= bounds.maxX + width * 3 &&
            y >= bounds.minY - height * 3 &&
            y <= bounds.maxY + height * 3),
        onScreen:
          !bounds ||
          boundsOverlap(bounds, {
            minX: x - width,
            maxX: x + width * 2,
            minY: y - height,
            maxY: y + height * 2.4,
          }),
      };
      tiles.set(key, entry);
      return entry;
    };
    const visibleUsers = snapshot.users.filter((user) => {
      const tile = tileFor(user);
      return user.userId === snapshot.viewer?.userId || !!tile?.visible;
    });
    const candidates = visibleUsers.flatMap((user) => {
      if (!canShowUser(snapshot, user) || user.status !== "AWAKE") return [];
      const tile = tileFor(user);
      return tile ? [{ user, key: userActorKey(user), onScreen: tile.onScreen }] : [];
    });
    const key = candidates
      .map((entry) => `${entry.key}:${Number(entry.onScreen)}`)
      .join("|");
    if (key !== selectionKey) {
      selectionKey = key;
      if (candidates.length > WORLD_DETAIL.travelCharacters)
        candidates.sort((a, b) => {
          const ownA = a.user.userId === snapshot.viewer?.userId;
          const ownB = b.user.userId === snapshot.viewer?.userId;
          const orderA = movementOrder.get(a.key),
            orderB = movementOrder.get(b.key);
          return (
            Number(ownB) - Number(ownA) ||
            Number(b.onScreen) - Number(a.onScreen) ||
            // Visible quest/hostile NPCs retain their controls within the same body budget.
            Number(Boolean(b.user.isNpc)) - Number(Boolean(a.user.isNpc)) ||
            (orderB?.order ?? 0) - (orderA?.order ?? 0) ||
            (orderB?.initialTime ?? 0) - (orderA?.initialTime ?? 0) ||
            a.key.localeCompare(b.key)
          );
        });
      characterKeys = new Set(
        candidates.slice(0, WORLD_DETAIL.travelCharacters).map((entry) => entry.key),
      );
    }
    stableViewport = domain;
    return { ...snapshot, users: visibleUsers, characterKeys };
  };
  /** Camera movement only reconciles resources when visible actor membership changes. */
  const userKey = (snapshot: TravelActorsSnapshot) =>
    snapshot.users
      .map((user) => `${user.userId}:${user.npcPlacementId ?? ""}`)
      .join("|") + `/${[...(snapshot.characterKeys ?? [])].join("|")}`;
  /** Retire departed scopes while retaining movement state for unchanged actor identities. */
  const reconcile = (snapshot: TravelActorsSnapshot) => {
    if (pathGrid !== snapshot.grid || actorSector !== snapshot.sector) {
      // Snapshots use sector-local coordinates; interpolation cannot cross their origins.
      for (const record of records.values()) record.scope.dispose();
      records.clear();
      byRoot.clear();
      actorSector = snapshot.sector;
      pathGrid = snapshot.grid;
      paths = new PathCalculator(snapshot.grid);
    }
    viewer = snapshot.viewer;
    users = snapshot.users;
    friendlyAttack = snapshot.friendlyAttack;
    const recipes = travelActorRecipes(snapshot, partsFor);
    const wanted = new Set(recipes.map((recipe) => recipe.key));
    for (const key of appearanceParts.keys())
      if (!wanted.has(key)) appearanceParts.delete(key);
    for (const [key, record] of records) {
      if (!wanted.has(key)) {
        record.scope.dispose();
        byRoot.delete(record.root);
        records.delete(key);
      }
    }
    for (const recipe of recipes) {
      let signature = signatures.get(recipe.parts);
      if (signature === undefined) {
        signature = JSON.stringify([recipe.parts, recipe.user?.allianceStatus]);
        signatures.set(recipe.parts, signature);
      }
      const previous = records.get(recipe.key);
      if (previous?.signature === signature) {
        if (
          previous.recipe.tile !== recipe.tile &&
          !snapshot.motionSteps?.has(recipe.user?.userId ?? "")
        ) {
          const path = paths?.getShortestPath(previous.tile, recipe.tile) ?? [];
          previous.path = path[0] === previous.tile ? path.slice(1) : path;
        }
        if (previous.counterLabel && previous.recipe.counter !== recipe.counter)
          previous.counterLabel.text = String(recipe.counter);
        previous.recipe = recipe;
        continue;
      }
      previous?.scope.dispose();
      if (previous) byRoot.delete(previous.root);
      const scope = createRenderScope(game);
      const root = new Container();
      root.label = recipe.key;
      container.addChild(root);
      (recipe.user ? layers?.depth : layers?.overlay)?.attach(root);
      if (recipe.user?.spriteAppearance) {
        const color =
          recipe.user.allianceStatus === "ALLY"
            ? 0x338855
            : recipe.user.allianceStatus === "ENEMY"
              ? 0xb84040
              : 0x3c80bb;
        root.addChild(
          new Graphics()
            .ellipse(
              recipe.tile.width / 2,
              recipe.tile.height * LPC_TRAVEL_CONTACT_Y,
              recipe.tile.height * 0.35 * LPC_TRAVEL_SCALE,
              recipe.tile.height * 0.12 * LPC_TRAVEL_SCALE,
            )
            .fill({ color: 0x081115, alpha: 0.4 })
            .stroke({ color, alpha: 0.45, width: recipe.tile.height * 0.015 }),
        );
      }
      scope.own(() => {
        if (!root.destroyed)
          root.destroy({ children: true, texture: false, textureSource: false });
      });
      const record: ActorRecord = {
        recipe,
        signature,
        scope,
        root,
        art: null,
        fallback: null,
        counterLabel: null,
        tile: previous?.tile ?? recipe.tile,
        path: previous?.path ?? [],
        x: previous?.x ?? -recipe.tile.center.x,
        y: previous?.y ?? -recipe.tile.center.y,
        facing: previous?.facing ?? 2,
        depth: 0,
        contactY:
          recipe.tile.height *
          (recipe.user?.spriteAppearance ? LPC_TRAVEL_CONTACT_Y : 0.5),
      };
      root.position.set(record.x, record.y);
      root.zIndex = -(record.y + record.contactY + container.y);
      record.depth = root.zIndex;
      const body = recipe.parts.find((entry) => entry.character);
      if (body) {
        // Texture-free anonymous art stays usable through slow or failed atlas/portrait loads.
        const fallback = new Graphics({
          boundsArea: new Rectangle(-0.5, -0.5, 1, 1),
        })
          .circle(0, -0.28, 0.13)
          .roundRect(-0.23, -0.1, 0.46, 0.6, 0.12)
          .fill(0x89929e);
        fallback.label = "avatar";
        fallback.position.set(body.x, body.y);
        fallback.scale.set(body.size, -body.size);
        root.addChild(fallback);
        record.fallback = fallback;
      }
      records.set(recipe.key, record);
      byRoot.set(root, record);
      if (recipe.counter) {
        const label = new Text({
          text: String(recipe.counter),
          style: {
            fontFamily: "serif",
            fontWeight: "bold",
            fontSize: 30,
            fill: "white",
            align: "center",
            padding: 6,
          },
        });
        // Grouped encounters use a single cached badge text texture.
        const badge = new Container();
        const background = new Graphics()
          .rect(-35, -35, 70, 70)
          .fill("firebrick")
          .stroke({ color: "maroon", width: 5 });
        label.anchor.set(0.5);
        record.counterLabel = label;
        badge.addChild(background, label);
        badge.position.set(recipe.tile.width * 0.8, recipe.tile.height * 1.3);
        badge.scale.set(
          (recipe.tile.height * 0.5) / 70,
          (-recipe.tile.height * 0.5) / 70,
        );
        root.addChild(badge);
      }
      void createWorldSprites(scope, recipe.parts, shadows).then(
        (art) => {
          if (scope.isDisposed()) return;
          record.art = art;
          const avatar = art.entries.find(
            (entry) => entry.description.kind === "avatar",
          );
          if (avatar?.description.shadowCaster === "character")
            record.contactY = avatar.groundY;
          art.setLighting(brightness);
          root.addChild(art.container);
          if (layers?.ground) art.attachGroundEffects(layers.ground);
          if (art.entries.some((entry) => entry.description.kind === "avatar")) {
            record.fallback?.destroy();
            record.fallback = null;
          }
          // Controls retain actor transforms/visibility while rendering above all scenery.
          if (recipe.user)
            for (const entry of art.entries)
              if (
                isActorControl(entry.description.kind) ||
                entry.description.mask ||
                entry.description.unlit
              )
                layers?.overlay.attach(entry.sprite);
          updateActions();
          game.invalidate();
        },
        (error) => {
          if (!scope.isDisposed()) console.warn("Travel actor unavailable", error);
        },
      );
    }
    updateActions();
  };
  const updateActions = () => {
    for (const [key, record] of records) {
      const target = record.recipe.user;
      const isHovered = key === hovered && !!viewer && target?.userId !== viewer.userId;
      const alone =
        isHovered &&
        target &&
        users.filter(
          (candidate) =>
            !candidate.isNpc &&
            candidate.userId !== viewer?.userId &&
            candidate.longitude === target.longitude &&
            candidate.latitude === target.latitude,
        ).length === 1;
      const actions =
        isHovered && target && viewer
          ? travelActionAvailability(viewer, target, friendlyAttack)
          : { attack: false, heal: false, info: false };
      for (const entry of record.art?.entries ?? []) {
        if (!target || target.isNpc) continue;
        if (entry.description.kind === "attack")
          entry.sprite.visible = !!(isHovered && alone && actions.attack);
        if (entry.description.kind === "heal")
          entry.sprite.visible = !!(isHovered && alone && actions.heal);
        if (entry.description.kind === "info")
          entry.sprite.visible = !!(isHovered && alone && actions.info);
      }
    }
  };
  const hit = (x: number, y: number): TravelActorHit | null => {
    // Overlay markers and controls take priority over overlapping actor bodies.
    for (const controlsOnly of [true, false]) {
      const overlayChildren = controlsOnly
        ? layers?.overlay.renderLayerChildren
        : undefined;
      const children = overlayChildren ?? container.children;
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        // Overlay paint order follows art attachment, independently of actor foot depth.
        const directRecord = child ? byRoot.get(child) : undefined;
        const record =
          directRecord ??
          (overlayChildren && child?.parent?.parent
            ? byRoot.get(child.parent.parent)
            : undefined);
        if (!record) continue;
        const entries = record.art?.entries ?? [];
        for (let j = entries.length - 1; j >= -1; j--) {
          const entry = entries[j];
          const sprite = entry?.sprite ?? (j === -1 ? record.fallback : null);
          const kind = entry?.description.kind ?? "avatar";
          if (
            !sprite ||
            (overlayChildren && !directRecord && sprite !== child) ||
            (!overlayChildren && isActorControl(kind) !== controlsOnly) ||
            !isObjectChainVisible(sprite)
          )
            continue;
          const bounds = sprite.getBounds();
          if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY)
            continue;
          const { recipe } = record;
          return {
            key: recipe.key,
            type: recipe.quest
              ? "questMarker"
              : recipe.battleId
                ? "battleMarker"
                : kind,
            userId: recipe.user?.userId,
            npcPlacementId: recipe.user?.npcPlacementId,
            battleId: recipe.battleId,
            longitude: recipe.tile.col,
            latitude: recipe.tile.row,
          };
        }
      }
    }
    return null;
  };
  /** Logical contact order can stay unchanged while interpolated feet move between its neighbours. */
  const contactDepth = (root: Container) => byRoot.get(root)?.depth ?? root.zIndex;
  const depthIndices = new WeakMap<Container, number>();
  const hasDepthCrossing = (siblings: readonly Container[], spatial = false) => {
    if (!spatial || !sceneryBounds)
      return siblings.some((root, index) => {
        const before = siblings[index - 1];
        return (
          !!before &&
          (before.zIndex > root.zIndex || contactDepth(before) > contactDepth(root))
        );
      });
    const actors: [number, ActorRecord][] = [];
    // Scenery publishes sorted fixed planes when membership changes. Retained actor indices
    // locate only moving contacts; an insertion or sort invalidates an index by identity.
    for (const actor of records.values()) {
      const root = actor.root;
      let index = depthIndices.get(root) ?? -1;
      if (siblings[index] !== root) {
        index = siblings.indexOf(root);
        depthIndices.set(root, index);
      }
      if (index < 0) continue;
      const before = siblings[index - 1],
        after = siblings[index + 1];
      if (
        (before && before.zIndex > root.zIndex) ||
        (after && after.zIndex < root.zIndex)
      )
        return true;
      actors.push([index, actor]);
    }
    actors.sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < actors.length; index++) {
      const before = actors[index - 1],
        actor = actors[index];
      if (before && actor && before[1].depth > actor[1].depth) return true;
    }
    let comparisons = 0;
    for (const [i, actor] of actors) {
      const root = actor.root;
      let actorBounds: WorldBounds | undefined;
      // A held key can cross several unrelated planes; check every newly overlapping constraint.
      for (const direction of [-1, 1])
        for (let j = i + direction; j >= 0 && j < siblings.length; j += direction) {
          const other = siblings[j];
          if (!other) continue;
          if (direction < 0 ? other.zIndex <= actor.depth : other.zIndex >= actor.depth)
            break;
          // Crowded motion can refresh exact keys instead of repeatedly scanning remote planes.
          if (++comparisons > siblings.length) return true;
          if (byRoot.has(other)) continue;
          const otherBounds = sceneryBounds.get(other);
          if (!otherBounds) return true;
          if (!actorBounds) {
            // Live child bounds include oversized/trimmed LPC frames and fallback replacement.
            const local = root.getLocalBounds();
            actorBounds = {
              minX: local.minX + root.x + container.x,
              maxX: local.maxX + root.x + container.x,
              minY: local.minY + root.y + container.y,
              maxY: local.maxY + root.y + container.y,
            };
          }
          if (boundsOverlap(actorBounds, otherBounds, 1)) return true;
        }
    }
    return false;
  };
  const animate = (
    frame: GameFrame,
    movements?: ReadonlyMap<string, TravelActorMovement>,
  ) => {
    const angle = frame.reducedMotion ? 0 : (frame.now * Math.PI) / 5000;
    const cycle = frame.reducedMotion ? 0 : (frame.now / 1000) % 2;
    const wobble = cycle < 1 ? Math.sin(cycle * Math.PI * 4) * (1 - cycle) * 2 : 0;
    for (const record of records.values()) {
      const { recipe, root } = record;
      if (frame.reducedMotion) {
        record.path.length = 0;
        record.tile = recipe.tile;
      }
      const waypoint = record.path[0] ?? recipe.tile;
      const dx = -waypoint.center.x - record.x,
        dy = -waypoint.center.y - record.y;
      const distance = Math.hypot(dx, dy);
      const movement = movements?.get(recipe.user?.userId ?? "");
      const moving = movement ? movement.direction !== null : distance > 0.01;
      if (movement) {
        // The published edge owns interpolation; its destination consumes any queued snapshot path.
        record.path.length = 0;
        record.tile = recipe.tile;
        record.facing = lpcFacing(
          movement.x - record.x,
          movement.y - record.y,
          record.facing,
        );
        record.x = movement.x;
        record.y = movement.y;
      } else if (moving) {
        record.facing = lpcFacing(dx, dy, record.facing);
        // Still frames reach the authoritative tile in one update; animated movement catches up its queued path.
        const step = frame.reducedMotion
          ? distance
          : Math.min(
              distance,
              recipe.tile.width * frame.delta * 3 * Math.max(1, record.path.length),
            );
        record.x += (dx / distance) * step;
        record.y += (dy / distance) * step;
        if (step === distance) {
          record.tile = waypoint;
          record.path.shift();
        }
      }
      for (const entry of record.art?.entries ?? [])
        entry.character?.render(
          frame,
          moving && !frame.reducedMotion ? "walk" : "idle",
          record.facing,
        );
      const phi = angle + recipe.orbit;
      root.position.set(
        record.x +
          (recipe.spread ? recipe.tile.width * 0.1 * Math.sin(phi) : 0) +
          (recipe.quest ? wobble : 0),
        record.y + (recipe.spread ? recipe.tile.height * 0.1 * Math.cos(phi) : 0),
      );
      // Contact uses the interpolated/orbiting position and the current sector origin.
      record.depth = -(root.y + record.contactY + container.y);
    }
    if (
      paintedOriginY !== container.y ||
      hasDepthCrossing(layers?.depth.renderLayerChildren ?? container.children, true) ||
      (layers?.overlay && hasDepthCrossing(layers.overlay.renderLayerChildren))
    ) {
      // Publish moving keys together so actor crossings and new scenery share one coherent order.
      for (const record of records.values()) record.root.zIndex = record.depth;
      layers?.depth.sortRenderLayerChildren();
      layers?.overlay.sortRenderLayerChildren();
    }
    paintedOriginY = container.y;
    container.sortChildren();
  };
  /** Retain the latest snapshot so viewport changes can materialize its actors without another fetch. */
  const sync = (snapshot: TravelActorsSnapshot) => {
    if (sourceSnapshot?.sector !== snapshot.sector) {
      movementOrder.clear();
      selectionKey = null;
    }
    if (sourceSnapshot?.viewer?.userId !== snapshot.viewer?.userId) selectionKey = null;
    const present = new Set<string>();
    for (const user of snapshot.users) {
      const key = userActorKey(user),
        previous = movementOrder.get(key);
      const step = snapshot.motionSteps?.get(user.userId)?.startedAt;
      present.add(key);
      // Only movement promotes a retained character; health, art and activity refreshes do not.
      const moved =
        previous &&
        (previous.x !== user.longitude ||
          previous.y !== user.latitude ||
          previous.sector !== user.sector);
      const newStep = step !== undefined && step !== previous?.step;
      if (previous && !moved && !newStep) continue;
      selectionKey = null;
      movementOrder.set(key, {
        x: user.longitude,
        y: user.latitude,
        sector: user.sector,
        order: newStep ? step : moved ? performance.now() : (previous?.order ?? 0),
        // A first snapshot has activity timestamps, but no history of observed position changes.
        initialTime: previous?.initialTime ?? (Number(user.updatedAt) || 0),
        step: step ?? previous?.step,
      });
    }
    for (const key of movementOrder.keys())
      if (!present.has(key)) movementOrder.delete(key);
    sourceSnapshot = snapshot;
    const visible = visibleSnapshot(snapshot);
    visibleKey = userKey(visible);
    reconcile(visible);
  };
  return {
    container,
    sync,
    setViewport: (bounds: WorldBounds) => {
      const previous = viewport;
      const domain = stableViewport;
      viewport = { ...bounds };
      if (!sourceSnapshot) return;
      if (
        (previous &&
          bounds.minX === previous.minX &&
          bounds.maxX === previous.maxX &&
          bounds.minY === previous.minY &&
          bounds.maxY === previous.maxY) ||
        (domain &&
          (Object.keys(domain) as (keyof WorldBounds)[]).every(
            (axis) => bounds[axis] > domain[axis][0] && bounds[axis] < domain[axis][1],
          ))
      )
        return;
      const visible = visibleSnapshot(sourceSnapshot);
      const key = userKey(visible);
      if (key === visibleKey) return;
      visibleKey = key;
      reconcile(visible);
    },
    hit,
    animate,
    feet: (userId: string) => {
      const record = records.get(`user:${userId}`);
      if (!record) return undefined;
      const body = record.recipe.parts.find((part) => part.character);
      return {
        x: record.root.x + (body?.x ?? record.recipe.tile.width / 2) + container.x,
        y:
          record.root.y +
          (body ? body.y - (body.size * 28) / 64 : record.recipe.tile.height / 2) +
          container.y,
      };
    },
    setLighting: (next: number) => {
      brightness = next;
      for (const record of records.values()) record.art?.setLighting(next);
    },
    hover: (next: string | null) => {
      if (next !== hovered) {
        hovered = next;
        updateActions();
      }
    },
  };
};

/** Viewer-filtered user/NPC/battle groups; stable recipe keys preserve actor identity between syncs. */
export const travelActorRecipes = (
  snapshot: TravelActorsSnapshot,
  partsFor: (
    user: SectorUser,
    tile: TerrainHex,
  ) => WorldSpriteDescription[] = userParts,
): ActorRecipe[] => {
  const recipes: ActorRecipe[] = [];
  const grouped = new Map<string, SectorUser[]>();
  for (const user of snapshot.users) {
    if (!canShowUser(snapshot, user)) continue;
    const key = `${user.longitude},${user.latitude}`;
    const group = grouped.get(key) ?? [];
    group.push(user);
    grouped.set(key, group);
  }
  for (const tileUsers of grouped.values()) {
    const first = tileUsers[0];
    if (!first) continue;
    const tile = snapshot.grid.getHex({ col: first.longitude, row: first.latitude });
    if (!tile) continue;
    const awake = tileUsers.filter((user) => user.status === "AWAKE");
    const selected = snapshot.characterKeys;
    const shown = selected
      ? awake.filter((user) => selected.has(userActorKey(user)))
      : awake;
    shown.forEach((user, index) => {
      const appearanceUser =
        !user.spriteAppearance && user.userId === snapshot.viewer?.userId
          ? { ...user, spriteAppearance: resolveSpriteAppearance(snapshot.viewer) }
          : user;
      recipes.push({
        key: userActorKey(user),
        user: appearanceUser,
        tile,
        parts: partsFor(appearanceUser, tile),
        orbit: (index / shown.length) * Math.PI * 2,
        spread: shown.length > 1,
      });
    });
    const battles = new Map<string, SectorUser[]>();
    for (const user of tileUsers)
      if (user.status === "BATTLE" && user.battleId) {
        const fighters = battles.get(user.battleId) ?? [];
        fighters.push(user);
        battles.set(user.battleId, fighters);
      }
    let index = 0;
    for (const [battleId, fighters] of battles)
      recipes.push({
        key: `battle:${battleId}`,
        battleId,
        tile,
        parts: battleParts(fighters, tile),
        orbit: (index++ / tileUsers.length) * Math.PI * 2,
        spread: battles.size > 1,
      });
    if (awake.length > 2)
      recipes.push({
        key: `count:${tile.col},${tile.row}`,
        tile,
        parts: [],
        counter: awake.length,
        orbit: 0,
        spread: false,
      });
  }
  if (snapshot.viewer)
    for (const objective of getActiveObjectives(snapshot.viewer)) {
      if (
        !("sector" in objective) ||
        Number(objective.sector) !== snapshot.sector ||
        snapshot.structureObjectiveIds.has(objective.id) ||
        !("image" in objective) ||
        !objective.image ||
        !("longitude" in objective) ||
        !("latitude" in objective)
      )
        continue;
      const tile = snapshot.grid.getHex({
        col: Number(objective.longitude),
        row: Number(objective.latitude),
      });
      if (!tile) continue;
      const tint =
        objective.task === "move_to_location"
          ? 0xf4e365
          : objective.task === "defeat_opponents"
            ? 0x9c273a
            : 0x6666a3;
      recipes.push({
        key: `quest:${objective.id}`,
        tile,
        quest: true,
        orbit: 0,
        spread: false,
        parts: [
          part(tile, "marker", IMG_SECTOR_USER_MARKER, 1.8, 0.5, 1.35, {
            width: tile.height * 1.5,
            mask: IMG_SECTOR_USER_MARKER,
            tint,
          }),
          part(tile, "avatar", IMG_SECTOR_USER_SPRITE_MASK, 1.2, 0.5, 1.5, {
            mask: IMG_SECTOR_USER_SPRITE_MASK,
            tint: 0xd3d9ea,
          }),
          part(tile, "avatar", objective.image, 1.2, 0.5, 1.5, {
            mask: IMG_SECTOR_USER_SPRITE_MASK,
          }),
        ],
      });
    }
  return recipes;
};

/** Viewer-specific hover controls use the same allegiance and masking contract as scouting. */
export const travelActionAvailability = (
  viewer: NonNullable<UserWithRelations>,
  target: SectorUser,
  friendlyAttack: boolean,
) => {
  const isAlly = isMapUserAlly(viewer, target);
  const other = target.userId !== viewer.userId && !target.isNpc;
  return {
    attack:
      !!other &&
      !RANKS_RESTRICTED_FROM_PVP.includes(target.rank) &&
      (friendlyAttack || !isAlly),
    heal:
      !!other &&
      target.curHealth < target.maxHealth &&
      hasRequiredRank(viewer.rank, MEDNIN_MIN_RANK),
    info: !!other && !target.isMasked,
  };
};

/** NPCs prefer full art; players prefer lightweight avatars, with a shared default fallback. */
export const travelAvatar = (
  user: Pick<SectorUser, "avatar" | "avatarLight" | "isNpc">,
) =>
  (user.isNpc ? user.avatar || user.avatarLight : user.avatarLight || user.avatar) ||
  IMG_AVATAR_DEFAULT;
// Keep the sprite-frame foot and shadow contact fixed when scaling travel artwork.
const LPC_TRAVEL_SCALE = 0.7;
const LPC_TRAVEL_HEIGHT = 1.8 * LPC_TRAVEL_SCALE;
const LPC_TRAVEL_FOOT_Y = 0.1;
const LPC_TRAVEL_CONTACT_Y = LPC_TRAVEL_FOOT_Y + (LPC_TRAVEL_HEIGHT * 4) / 64;
const isActorControl = (kind: string) =>
  kind === "attack" || kind === "heal" || kind === "info" || kind === "talk";
/** Repeated NPC appearances remain distinct through placement identity; players use account identity. */
const userActorKey = (user: SectorUser) =>
  user.isNpc ? `npc:${user.npcPlacementId ?? user.userId}` : `user:${user.userId}`;
/** Apply the same visibility policy before body selection and full-roster encounter/count recipes. */
const canShowUser = (snapshot: TravelActorsSnapshot, user: SectorUser) =>
  (snapshot.showUsers || user.userId === snapshot.viewer?.userId) &&
  (user.isNpc ||
    user.userId === snapshot.viewer?.userId ||
    passesBracketFilter(user, snapshot.minBracket));

const part = (
  tile: TerrainHex,
  kind: string,
  image: string,
  height: number,
  x: number,
  y: number,
  extra: Partial<WorldSpriteDescription> = {},
): WorldSpriteDescription => ({
  id: kind,
  kind,
  image,
  size: tile.height * height,
  x: tile.width * x,
  y: tile.height * y,
  groundY: 0,
  unlit: kind !== "avatar",
  ...extra,
});
const pin = (tile: TerrainHex, tint: number) => [
  part(tile, "marker", IMG_SECTOR_USER_MARKER, 1.3, 0.5, 0.9, {
    width: tile.height * 1.1,
    mask: IMG_SECTOR_USER_MARKER,
    tint,
  }),
  part(tile, "marker", IMG_SECTOR_USER_MARKER, 1.2, 0.5, 0.9, {
    width: tile.height,
    mask: IMG_SECTOR_USER_MARKER,
  }),
];
const userParts = (user: SectorUser, tile: TerrainHex) => {
  const parts =
    user.isNpc || user.spriteAppearance
      ? []
      : pin(
          tile,
          user.allianceStatus === "ALLY"
            ? 0x008000
            : user.allianceStatus === "NEUTRAL"
              ? 0x2986cc
              : 0xff0000,
        );
  parts.push(
    part(
      tile,
      "avatar",
      travelAvatar(user),
      user.spriteAppearance ? LPC_TRAVEL_HEIGHT : user.isNpc ? 1.3 : 0.8,
      0.5,
      user.spriteAppearance ? LPC_TRAVEL_FOOT_Y + LPC_TRAVEL_HEIGHT / 2 : 1,
      user.spriteAppearance
        ? {
            character: user.spriteAppearance,
            characterMode: "travel",
            shadowCaster: "character",
            shadow: 0.16,
            light: 0.65,
          }
        : user.isNpc
          ? {
              rendition: 256,
              preserveAspect: true,
              nearest: true,
              shadowCaster: "character",
            }
          : { mask: IMG_SECTOR_USER_SPRITE_MASK },
    ),
  );
  if (user.isNpc)
    parts.push(
      part(
        tile,
        user.npcInteractionType === "HOSTILE" ? "attack" : "talk",
        user.npcInteractionType === "HOSTILE" ? IMG_SECTOR_ATTACK : IMG_MAP_QUEST_ICON,
        0.8,
        0.9,
        1.4,
      ),
    );
  else {
    if (!RANKS_RESTRICTED_FROM_PVP.includes(user.rank))
      parts.push(part(tile, "attack", IMG_SECTOR_ATTACK, 0.8, 0.9, 1.4));
    parts.push(
      part(tile, "heal", IMG_ICON_HEAL, 0.7, 1, 0.5),
      part(tile, "info", IMG_SECTOR_INFO, 0.7, 0.1, 1.4),
    );
  }
  return parts;
};
const battleParts = (users: SectorUser[], tile: TerrainHex) => {
  const parts = pin(tile, 0xff0000);
  const first = users[0],
    second = users[1];
  if (first)
    parts.push(
      part(tile, "avatar", travelAvatar(first), 0.8, 0.5, 1, {
        mask: IMG_SECTOR_USERSPRITE_LEFT,
      }),
    );
  if (second)
    parts.push(
      part(tile, "avatar", travelAvatar(second), 0.8, 0.5, 1, {
        mask: IMG_SECTOR_USERSPRITE_RIGHT,
      }),
    );
  parts.push(part(tile, "marker", IMG_SECTOR_VS_ICON, 0.6, 0.5, 0.5));
  return parts;
};
export type TravelActorsSnapshot = {
  grid: Grid<TerrainHex>;
  sector: number;
  viewer: UserWithRelations;
  users: SectorUser[];
  minBracket: number;
  showUsers: boolean;
  friendlyAttack: boolean;
  structureObjectiveIds: ReadonlySet<string | undefined>;
  /** Limits individual artwork only; occupancy badges and encounters use the complete user list. */
  characterKeys?: ReadonlySet<string>;
  /** Published movement edges already supply interpolation; they need no second path search. */
  motionSteps?: ReadonlyMap<string, TravelMotionStep>;
};
export type TravelActorHit = {
  key: string;
  type: string;
  userId?: string;
  npcPlacementId?: string;
  battleId?: string;
  longitude: number;
  latitude: number;
};
type ActorRecipe = {
  key: string;
  tile: TerrainHex;
  parts: WorldSpriteDescription[];
  user?: SectorUser;
  battleId?: string;
  counter?: number;
  quest?: boolean;
  orbit: number;
  spread: boolean;
};
type ActorRecord = {
  depth: number;
  /** Actor-local foot Y, updated when the visible avatar cutout finishes loading. */
  contactY: number;
  tile: TerrainHex;
  path: TerrainHex[];
  x: number;
  y: number;
  facing: LpcDirection;
  recipe: ActorRecipe;
  signature: string;
  scope: GameRenderer;
  root: Container;
  art: Awaited<ReturnType<typeof createWorldSprites>> | null;
  fallback: Graphics | null;
  counterLabel: Text | null;
};

/** Interpolated sector-local feet use the same path clock as the camera. */
export type TravelActorMovement = {
  x: number;
  y: number;
  direction: WorldMotionDirection | null;
  facing: number;
};

export type TravelMotionStep = {
  from: { sector: number; x: number; y: number };
  to: { sector: number; x: number; y: number };
  startedAt: number;
  direction: WorldMotionDirection;
  facing: 1 | -1;
};
