import type { Grid } from "honeycomb-grid";
import {
  BitmapText,
  Container,
  Graphics,
  Matrix,
  Rectangle,
  type RenderLayer,
  Sprite,
} from "pixi.js";
import {
  type AvatarFacing,
  CREATOR_USERNAME,
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
import { hasRequiredRank } from "@/libs/rank";
import { animationTextureUrl } from "@/libs/rendering/animationTextures";
import { textureOpaqueFrame } from "@/libs/rendering/assets";
import type { LpcCharacter } from "@/libs/rendering/primitives/character";
import {
  acquireContactRingTexture,
  CONTACT_RING,
} from "@/libs/rendering/primitives/shadow";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import {
  createWaterRipples,
  RIPPLE_INTERVAL,
} from "@/libs/rendering/primitives/waterRipples";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import { createRenderScope } from "@/libs/rendering/scope";
import type {
  WorldLoop,
  WorldMotionDirection,
  WorldSpriteDescription,
} from "@/libs/rendering/sectorSprites";
import { standingOffset } from "@/libs/rendering/terrainElevation";
import {
  boundsOverlap,
  isObjectChainVisible,
  type WorldBounds,
} from "@/libs/rendering/visibility";
import { WORLD_DETAIL } from "@/libs/rendering/worldDetail";
import type { WorldShadows } from "@/libs/rendering/worldShadows";
import type { SectorUser } from "@/libs/sector-map/world-types";
import type { CharacterAnimation } from "@/libs/spriteAnimations";
import type { UserWithRelations } from "@/routers/profile";
import { canShowMapAttack } from "@/utils/alliance";
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
  // Tile counts appear and vanish constantly as a crowd walks; their own render group keeps
  // that from rebuilding the whole scene. The scene paints it above every layer.
  const badges = new Container({ isRenderGroup: true, label: "travel-counts" });
  // Contact rings, shadows and light pools follow their actors from two groups of their own,
  // so re-sorting the upright world never walks them and their churn rebuilds only these.
  const groundEffects = {
    shadows: new Container({ isRenderGroup: true, label: "actor-ground-shadows" }),
    lights: new Container({ isRenderGroup: true, label: "actor-ground-lights" }),
  };
  // Rings sit on the water surface beneath every actor, created once a character first stands in water.
  let ripples: ReturnType<typeof createWaterRipples> | null = null;
  const waterRipples = () => {
    if (ripples) return ripples;
    ripples = createWaterRipples(game);
    ripples.container.zIndex = -Number.MAX_VALUE;
    container.addChild(ripples.container);
    layers?.ground?.attach(ripples.container);
    return ripples;
  };
  const records = new Map<string, ActorRecord>();
  const byRoot = new Map<Container, ActorRecord>();
  const appearanceParts = new Map<
    string,
    { inputs: AppearanceInputs; tile: TerrainHex; parts: WorldSpriteDescription[] }
  >();
  const signatures = new WeakMap<WorldSpriteDescription[], string>();
  /** Position and health updates arrive every walking step; they retain the actor's artwork. */
  const partsFor = (user: SectorUser, tile: TerrainHex) => {
    const id = travelActorKey(user);
    const previous = appearanceParts.get(id);
    if (
      previous &&
      previous.tile.width === tile.width &&
      previous.tile.height === tile.height &&
      sameAppearance(previous.inputs, user)
    )
      return previous.parts;
    const parts = userParts(user, tile);
    appearanceParts.set(id, { inputs: appearanceInputs(user), tile, parts });
    return parts;
  };
  let viewer: UserWithRelations;
  let users: SectorUser[] = [];
  let friendlyAttack = false;
  let wars: TravelActorsSnapshot["wars"];
  let brightness = WORLD_DAY_BRIGHTNESS;
  let hovered: string | null = null;
  let paths: PathCalculator | null = null;
  let pathGrid: Grid<TerrainHex> | null = null;
  let hasOpenWater = false;
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
  let characterKeys: Set<string> | null = null;
  let paintedOriginY = container.y;
  let lastDepthSortAt = Number.NEGATIVE_INFINITY;
  let lastActorSortAt = Number.NEGATIVE_INFINITY;
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
      { visible: boolean; retained: boolean; onScreen: boolean } | undefined
    >();
    const tileFor = (user: SectorUser) => {
      // A roaming NPC can be anywhere within its radius of the anchor tile it reports.
      const reach = user.npcWander?.radius ?? 0;
      const key = `${user.longitude},${user.latitude},${reach}`;
      if (tiles.has(key)) return tiles.get(key);
      const tile = snapshot.grid.getHex({ col: user.longitude, row: user.latitude });
      if (!tile) {
        tiles.set(key, undefined);
        return undefined;
      }
      const x = -tile.center.x,
        y = -tile.center.y,
        width = tile.width * (1 + reach),
        height = tile.height * (1 + reach);
      for (const reachTiles of [LOAD_TILES, RETAIN_TILES]) {
        boundary("minX", x + width * reachTiles);
        boundary("maxX", x - width * reachTiles);
        boundary("minY", y + height * reachTiles);
        boundary("maxY", y - height * reachTiles);
      }
      boundary("minX", x + width * 2);
      boundary("maxX", x - width);
      boundary("minY", y + height * 2.4);
      boundary("maxY", y - height);
      const within = (reachTiles: number) =>
        !bounds ||
        (x >= bounds.minX - width * reachTiles &&
          x <= bounds.maxX + width * reachTiles &&
          y >= bounds.minY - height * reachTiles &&
          y <= bounds.maxY + height * reachTiles);
      const entry = {
        visible: within(LOAD_TILES),
        retained: within(RETAIN_TILES),
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
    // Actors load near the view and stay until well past it, so walkers along that edge
    // are not rebuilt on every step.
    const visibleUsers = snapshot.users.filter((user) => {
      const tile = tileFor(user);
      return (
        user.userId === snapshot.viewer?.userId ||
        !!tile?.visible ||
        (!!tile?.retained && records.has(travelActorKey(user)))
      );
    });
    const candidates = visibleUsers.flatMap((user) => {
      if (!canShowUser(snapshot, user) || user.status !== "AWAKE") return [];
      const tile = tileFor(user);
      return tile ? [{ user, key: travelActorKey(user), onScreen: tile.onScreen }] : [];
    });
    stableViewport = domain;
    // Every awake candidate gets a body while the crowd fits the budget.
    if (candidates.length <= WORLD_DETAIL.travelCharacters) {
      selectionKey = null;
      characterKeys = null;
      return { ...snapshot, users: visibleUsers, characterKeys: undefined };
    }
    const key = candidates
      .map((entry) => `${entry.key}:${Number(entry.onScreen)}`)
      .join("|");
    if (key !== selectionKey || !characterKeys) {
      selectionKey = key;
      if (candidates.length > WORLD_DETAIL.travelCharacters)
        candidates.sort((a, b) => {
          const ownA = a.user.userId === snapshot.viewer?.userId;
          const ownB = b.user.userId === snapshot.viewer?.userId;
          const orderA = movementOrder.get(a.key),
            orderB = movementOrder.get(b.key);
          return (
            Number(ownB) - Number(ownA) ||
            Number(b.user.username === CREATOR_USERNAME) -
              Number(a.user.username === CREATOR_USERNAME) ||
            Number(b.onScreen) - Number(a.onScreen) ||
            // Visible quest/hostile NPCs retain their controls within the same body budget;
            // ambient wildlife yields to every player.
            ambientRank(a.user) - ambientRank(b.user) ||
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
    return { ...snapshot, users: visibleUsers, characterKeys };
  };
  /** Camera movement only reconciles resources when visible actor membership changes. */
  const userKey = (snapshot: TravelActorsSnapshot) =>
    `${snapshot.users
      .map((user) => travelActorKey(user))
      .join("|")}/${[...(snapshot.characterKeys ?? [])].join("|")}`;
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
      // Settlements are usually dry; only sectors with open water look up the ground under feet.
      hasOpenWater = snapshot.grid.toArray().some(isOpenWater);
    }
    viewer = snapshot.viewer;
    users = snapshot.users;
    friendlyAttack = snapshot.friendlyAttack;
    wars = snapshot.wars;
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
        previous.hold = undefined;
        continue;
      }
      previous?.scope.dispose();
      if (previous) byRoot.delete(previous.root);
      const scope = createRenderScope(game);
      const root = new Container();
      root.label = recipe.key;
      const effects = recipe.user
        ? {
            shadows: new Container({ label: `${recipe.key}:ground` }),
            lights: new Container({ label: `${recipe.key}:lights` }),
          }
        : null;
      if (effects) {
        groundEffects.shadows.addChild(effects.shadows);
        groundEffects.lights.addChild(effects.lights);
        scope.own(() => {
          for (const group of [effects.shadows, effects.lights])
            if (!group.destroyed)
              group.destroy({ children: true, texture: false, textureSource: false });
        });
      }
      if (recipe.counter) badges.addChild(root);
      else {
        container.addChild(root);
        (recipe.user ? layers?.depth : layers?.overlay)?.attach(root);
      }
      if (recipe.user?.spriteAppearance) {
        const color =
          recipe.user.allianceStatus === "ALLY"
            ? 0x338855
            : recipe.user.allianceStatus === "ENEMY"
              ? 0xb84040
              : 0x3c80bb;
        // One shared quad per ring keeps a crowd's moving geometry small; the alliance colour
        // tints its rim and leaves the near-black fill dark.
        const ringLease = acquireContactRingTexture();
        scope.own(ringLease.release);
        const ring = new Sprite(ringLease.texture);
        ring.scale.set(
          (recipe.tile.height * 0.35 * LPC_TRAVEL_SCALE) / CONTACT_RING.radiusX,
        );
        ring.anchor.set(0.5);
        ring.position.set(
          recipe.tile.width / 2,
          recipe.tile.height * LPC_TRAVEL_CONTACT_Y,
        );
        ring.tint = color;
        ring.label = "contact-ring";
        // The ring lies on the ground with the contact shadows, so upright figures and
        // scenery batch together in the depth layer.
        effects?.shadows.addChild(ring);
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
        effects,
        // Roaming NPC copies share a template userId, so their movement is keyed per actor.
        movementKey: recipe.user?.isNpc ? recipe.key : (recipe.user?.userId ?? ""),
        character: undefined,
        loops: false,
        tile: previous?.tile ?? recipe.tile,
        path: previous?.path ?? [],
        x: previous?.x ?? -recipe.tile.center.x,
        y: previous?.y ?? -recipe.tile.center.y + standingOffset(recipe.tile),
        facing: previous?.facing ?? 2,
        heading: previous?.heading,
        ripple: previous?.ripple ?? 0,
        depth: 0,
        cast: null,
        castKey: "",
        contactY:
          recipe.tile.height *
          (recipe.user?.spriteAppearance ? LPC_TRAVEL_CONTACT_Y : 0.5),
        footprint: null,
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
        // Crowds change tile counts constantly; glyph quads update without redrawing a canvas.
        const label = new BitmapText({
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
          record.character = art.entries.find((entry) => entry.character)?.character;
          record.loops = art.entries.some(
            (entry) => entry.description.loop || entry.description.walk,
          );
          const avatar = art.entries.find(
            (entry) => entry.description.kind === "avatar",
          );
          if (avatar?.description.shadowCaster === "character") {
            record.contactY = avatar.groundY;
            record.footprint = artFootprint(avatar);
          }
          // NPC art casts a sun silhouette on the ground, as fighters do in combat.
          if (recipe.user?.isNpc && avatar?.sprite instanceof Sprite) {
            const cast = new Sprite(avatar.sprite.texture);
            cast.label = "cast-shadow";
            cast.tint = CAST_SHADOW_TINT;
            cast.visible = false;
            if (record.effects) record.effects.shadows.addChildAt(cast, 0);
            else root.addChildAt(cast, 0);
            record.cast = cast;
            record.castBody = { sprite: avatar.sprite, groundY: avatar.groundY };
          }
          art.setLighting(brightness);
          root.addChild(art.container);
          // Each art set keeps one container of contact shadows and one of light pools.
          const shadowsBox = art.entries.find((entry) => entry.shadow)?.shadow?.parent;
          const lightsBox = art.entries.find((entry) => entry.light)?.light?.parent;
          if (record.effects) {
            if (shadowsBox) record.effects.shadows.addChild(shadowsBox);
            if (lightsBox) record.effects.lights.addChild(lightsBox);
          } else if (layers?.ground) art.attachGroundEffects(layers.ground);
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
          updateActions(record);
          game.invalidate();
        },
        (error) => {
          if (!scope.isDisposed()) console.warn("Travel actor unavailable", error);
        },
      );
    }
    // Availability follows the snapshot; only the hovered actor shows controls.
    const target = hovered === null ? undefined : records.get(hovered);
    if (target) updateActions(target);
  };
  /** Show the hovered actor's controls; every other actor keeps them hidden. */
  const updateActions = (...only: (ActorRecord | undefined)[]) => {
    for (const record of only.length ? only : records.values()) {
      if (!record) continue;
      const key = record.recipe.key;
      const target = record.recipe.user;
      const isHovered = key === hovered && !!viewer && target?.userId !== viewer.userId;
      const alone = isHovered && target && isAloneOnTile(users, target, viewer?.userId);
      const actions =
        isHovered && target && viewer
          ? travelActionAvailability(viewer, target, friendlyAttack, wars)
          : { attack: false, heal: false, info: false };
      for (const entry of record.art?.entries ?? []) {
        if (!target || target.isNpc) continue;
        const kind = entry.description.kind;
        if (kind !== "attack" && kind !== "heal" && kind !== "info") continue;
        const shown =
          kind === "attack"
            ? // The creator's trial takes any number of challengers, however crowded the tile.
              isHovered &&
              (alone || target.username === CREATOR_USERNAME) &&
              actions.attack
            : isHovered && alone && actions[kind];
        showControl(record, entry.sprite, !!shown);
      }
    }
  };
  /**
   * Hidden player controls leave the scene graph, so a crowd's controls cost nothing when the
   * scene rebuilds its batches; the owning scope destroys them either way.
   */
  const showControl = (record: ActorRecord, sprite: Container, shown: boolean) => {
    if (shown) {
      if (!sprite.parent && record.art && !record.art.container.destroyed) {
        record.art.container.addChild(sprite);
        layers?.overlay.attach(sprite);
      }
      sprite.visible = true;
      return;
    }
    sprite.visible = false;
    if (!sprite.parent) return;
    if (!record.detached) {
      const detached = new Set<Container>();
      record.detached = detached;
      record.scope.own(() => {
        for (const control of detached) if (!control.destroyed) control.destroy();
      });
    }
    record.detached.add(sprite);
    layers?.overlay.detach(sprite);
    sprite.removeFromParent();
  };
  let sun: CastLight | null = null;
  const castMatrix = new Matrix();
  /**
   * Pose an NPC's ground silhouette like projected scenery: the current frame sheared away from
   * the sun from its feet. Recomputed only when the frame, facing, foot or sun changes.
   */
  const paintCast = (record: ActorRecord) => {
    const cast = record.cast,
      body = record.castBody;
    if (!cast || !body) return;
    const visible = !!sun && sun.day > 0 && body.sprite.visible;
    cast.visible = visible;
    if (!visible || !sun) return;
    const sprite = body.sprite,
      texture = sprite.texture;
    const key = `${texture.uid}:${sprite.scale.x}:${sprite.x}:${body.groundY}:${sun.x}:${sun.y}:${sun.z}:${sun.day}`;
    if (key === record.castKey) return;
    record.castKey = key;
    cast.texture = texture;
    const height = Math.abs(sprite.height);
    const top = sprite.y + height * (1 - sprite.anchor.y);
    cast.anchor.set(0.5, height ? (top - body.groundY) / height : 1);
    const rise = height / Math.max(1, texture.orig.height);
    // Clamp grazing sun so long copies never cover distant scenery (as projected scenery does).
    const slopeX = Math.max(-1.4, Math.min(1.4, sun.x / Math.max(0.3, sun.z))) * rise;
    const slopeY = Math.min(-0.12, sun.y / (2 * Math.max(0.3, sun.z))) * rise;
    castMatrix.set(sprite.scale.x, 0, slopeX, slopeY, sprite.x, body.groundY);
    cast.setFromMatrix(castMatrix);
    cast.alpha = CAST_SHADOW_ALPHA * sun.day;
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
            npcCopy: recipe.user?.npcCopy,
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
  const hasDepthCrossing = (
    siblings: readonly Container[],
    spatial = false,
    /** Which crossings are due: actors passing scenery, and actors passing each other. */
    due = { scenery: true, actors: true },
  ) => {
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
        due.scenery &&
        ((before && before.zIndex > root.zIndex) ||
          (after && after.zIndex < root.zIndex))
      )
        return true;
      actors.push([index, actor]);
    }
    actors.sort((a, b) => a[0] - b[0]);
    if (due.actors && actorsCross(actors)) return true;
    if (!due.scenery) return false;
    let comparisons = 0;
    for (const [i, actor] of actors) {
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
            const local = actorFrame(actor);
            actorBounds = {
              minX: local.minX + container.x,
              maxX: local.maxX + container.x,
              minY: local.minY + container.y,
              maxY: local.maxY + container.y,
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
    let urgentDepth = false;
    for (const record of records.values()) {
      const { recipe, root } = record;
      if (frame.reducedMotion) {
        record.path.length = 0;
        record.tile = recipe.tile;
      }
      const waypoint = record.path[0] ?? recipe.tile;
      const movement = movements?.get(record.movementKey);
      // A finished step stands its actor on the step's tile until the next sync catches up.
      const hold = movement ? undefined : record.hold;
      const dx = (hold?.x ?? -waypoint.center.x) - record.x,
        dy = (hold?.y ?? -waypoint.center.y + standingOffset(waypoint)) - record.y;
      const distance = Math.hypot(dx, dy);
      const moving = movement ? movement.direction !== null : distance > 0.01;
      const [fromX, fromY] = [record.x, record.y];
      if (movement) {
        // The published edge owns interpolation; its destination consumes any queued snapshot path.
        record.path.length = 0;
        record.tile = recipe.tile;
        record.facing = lpcFacing(
          movement.x - record.x,
          movement.y - record.y,
          record.facing,
        );
        record.heading = headingOf(movement.x - record.x, record.heading);
        record.x = movement.x;
        record.y = movement.y;
        record.hold = movement.to;
      } else if (moving) {
        record.facing = lpcFacing(dx, dy, record.facing);
        record.heading = headingOf(dx, record.heading);
        // Still frames reach the authoritative tile in one update; animated movement catches up its queued path.
        const step = frame.reducedMotion
          ? distance
          : Math.min(
              distance,
              recipe.tile.width * frame.delta * 3 * Math.max(1, record.path.length),
            );
        record.x += (dx / distance) * step;
        record.y += (dy / distance) * step;
        if (step === distance && !hold) {
          record.tile = waypoint;
          record.path.shift();
        }
      }
      // Players, quest NPCs and orbiting crowds re-sort the moment they cross scenery.
      if (
        recipe.user?.npcInteractionType !== "AMBIENT" &&
        (record.x !== fromX || record.y !== fromY || recipe.spread || recipe.quest)
      )
        urgentDepth = true;
      record.character?.render(
        frame,
        moving && !frame.reducedMotion ? "walk" : "idle",
        record.facing,
      );
      if (record.loops)
        record.art?.animateLoops(frame, { moving, heading: record.heading });
      if (record.cast) paintCast(record);
      const phi = angle + recipe.orbit;
      root.position.set(
        record.x +
          (recipe.spread ? recipe.tile.width * 0.1 * Math.sin(phi) : 0) +
          (recipe.quest ? wobble : 0),
        record.y + (recipe.spread ? recipe.tile.height * 0.1 * Math.cos(phi) : 0),
      );
      if (record.effects) {
        record.effects.shadows.position.copyFrom(root.position);
        record.effects.lights.position.copyFrom(root.position);
      }
      if (
        hasOpenWater &&
        recipe.user &&
        !frame.reducedMotion &&
        isOpenWater(groundTile(record))
      ) {
        record.ripple -= frame.delta;
        if (record.ripple <= 0) {
          record.ripple = moving ? RIPPLE_INTERVAL.moving : RIPPLE_INTERVAL.idle;
          const feet = actorFeet(record);
          waterRipples().emit(feet.x, feet.y, ringScale(record));
        }
      } else record.ripple = 0;
      // Contact uses the interpolated/orbiting position and the current sector origin.
      record.depth = -(root.y + record.contactY + container.y);
    }
    // A sort rebuilds the whole scene's batches, and wildlife in a forest crosses trees all the
    // time; crossings that only roaming wildlife cause wait for the next sort slot.
    // Crowds pass each other just as often, so actors swapping places wait for their own slot.
    const depthDue =
      urgentDepth || frame.now - lastDepthSortAt >= AMBIENT_DEPTH_SORT_MS;
    const actorOrderDue = frame.now - lastActorSortAt >= ACTOR_DEPTH_SORT_MS;
    if (
      paintedOriginY !== container.y ||
      ((depthDue || actorOrderDue) &&
        (hasDepthCrossing(
          layers?.depth.renderLayerChildren ?? container.children,
          true,
          {
            scenery: depthDue,
            actors: actorOrderDue,
          },
        ) ||
          (layers?.overlay && hasDepthCrossing(layers.overlay.renderLayerChildren))))
    ) {
      lastDepthSortAt = frame.now;
      lastActorSortAt = frame.now;
      // Publish moving keys together so actor crossings and new scenery share one coherent order.
      for (const record of records.values()) record.root.zIndex = record.depth;
      layers?.depth.sortRenderLayerChildren();
      layers?.overlay.sortRenderLayerChildren();
    }
    paintedOriginY = container.y;
    badges.position.copyFrom(container.position);
    groundEffects.shadows.position.copyFrom(container.position);
    groundEffects.lights.position.copyFrom(container.position);
    container.sortChildren();
    ripples?.update(frame);
  };
  /** The hex under an actor's interpolated position, so wakes end where the shore begins; it is looked up only after a move. */
  const groundTile = (record: ActorRecord) => {
    if (record.ground && record.ground.x === record.x && record.ground.y === record.y)
      return record.ground.tile;
    const anchor = record.recipe.tile;
    const tile =
      sourceSnapshot?.grid.pointToHex(
        {
          x: anchor.x + anchor.center.x + record.x,
          y: anchor.y + anchor.center.y + record.y,
        },
        { allowOutside: false },
      ) ?? record.tile;
    record.ground = { x: record.x, y: record.y, tile };
    return tile;
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
      const key = travelActorKey(user),
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
    /** Tile-count badges; add above every layer, after `container`. */
    badges,
    /** Actors' ground effects; add after the actor ground layer, shadows before lights. */
    groundEffects,
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
    /** Sun direction for NPC silhouettes; null hides them (night, or shadows switched off). */
    setSun: (light: CastLight | null) => {
      sun = light;
    },
    feet: (userId: string) => {
      const record = records.get(`user:${userId}`);
      if (!record) return undefined;
      const feet = actorFeet(record);
      return { x: feet.x + container.x, y: feet.y + container.y };
    },
    /** World-space extent and paint depth of a user's actor; scenery above that depth covers it. */
    body: (userId: string) => {
      const record = records.get(`user:${userId}`);
      if (!record) return undefined;
      const body = actorBody(record);
      return {
        bounds: {
          minX: body.minX + container.x,
          maxX: body.maxX + container.x,
          minY: body.minY + container.y,
          maxY: body.maxY + container.y,
        },
        depth: record.depth,
      };
    },
    setLighting: (next: number) => {
      brightness = next;
      for (const record of records.values()) record.art?.setLighting(next);
    },
    hover: (next: string | null) => {
      if (next !== hovered) {
        const previous = hovered === null ? undefined : records.get(hovered);
        hovered = next;
        updateActions(previous, next === null ? undefined : records.get(next));
      }
    },
  };
};

/**
 * Whether two actors are painted in the wrong order where their figures overlap. A crowd walks
 * past each other constantly, and every re-sort rebuilds the whole scene's batches; actors that do
 * not touch can keep a stale order until they do.
 */
const actorsCross = (actors: readonly [number, ActorRecord][]) => {
  let inverted = false;
  for (let index = 1; index < actors.length && !inverted; index++)
    inverted = (actors[index - 1]?.[1].depth ?? 0) > (actors[index]?.[1].depth ?? 0);
  if (!inverted) return false;
  // Sweep by left edge so only horizontally overlapping frames are compared.
  const boxes = actors
    .map(([order, record]) => ({ order, depth: record.depth, ...actorBody(record) }))
    .sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (!a) continue;
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (!b || b.minX > a.maxX) break;
      if (b.maxY < a.minY || b.minY > a.maxY) continue;
      if (a.order < b.order !== a.depth <= b.depth && a.depth !== b.depth) return true;
    }
  }
  return false;
};

/**
 * Container-local extent an actor paints over scenery: a character's whole sprite frame, which
 * includes held weapons, or the live bounds of other artwork and the loading fallback.
 */
const actorFrame = (record: ActorRecord): WorldBounds => {
  const body = record.recipe.parts.find((part) => part.character);
  const { root } = record;
  if (!body || record.fallback) {
    const local = root.getLocalBounds();
    return {
      minX: local.minX + root.x,
      maxX: local.maxX + root.x,
      minY: local.minY + root.y,
      maxY: local.maxY + root.y,
    };
  }
  const half = body.size / 2;
  return {
    minX: root.x + body.x - half,
    maxX: root.x + body.x + half,
    minY: root.y + body.y - half,
    maxY: root.y + body.y + half,
  };
};

/**
 * Container-local contact point of an actor: its art's solid feet once loaded, the LPC frame's
 * foot row before that, or the tile center without a body.
 */
const actorFeet = (record: ActorRecord) => {
  if (record.footprint)
    return {
      x: record.root.x + record.footprint.x,
      y: record.root.y + record.footprint.y,
    };
  const body = record.recipe.parts.find((part) => part.character);
  return {
    x: record.root.x + (body?.x ?? record.recipe.tile.width / 2),
    y:
      record.root.y +
      (body ? body.y - (body.size * 28) / 64 : record.recipe.tile.height / 2),
  };
};

/**
 * Container-local box of a character's visible figure within its sprite frame, from the feet up;
 * other art uses its live bounds.
 */
const actorBody = (record: ActorRecord): WorldBounds => {
  const body = record.recipe.parts.find((part) => part.character);
  if (!body) {
    const local = record.root.getLocalBounds();
    return {
      minX: local.minX + record.root.x,
      maxX: local.maxX + record.root.x,
      minY: local.minY + record.root.y,
      maxY: local.maxY + record.root.y,
    };
  }
  const feet = actorFeet(record);
  return {
    minX: feet.x - body.size * LPC_FIGURE_HALF_WIDTH,
    maxX: feet.x + body.size * LPC_FIGURE_HALF_WIDTH,
    minY: feet.y,
    maxY: feet.y + body.size * LPC_FIGURE_HEIGHT,
  };
};

/**
 * Actor-local footprint of loaded avatar art, at its solid feet. Cutouts centre it under their
 * visible figure, since the lowest solid row of a walking pose can be a single foot.
 */
const artFootprint = (avatar: {
  sprite: Container;
  character?: unknown;
  description: WorldSpriteDescription;
  groundY: number;
}) => {
  const { sprite, description, groundY } = avatar;
  if (avatar.character || !(sprite instanceof Sprite))
    return {
      x: description.x,
      y: groundY,
      width: description.size * LPC_FIGURE_HALF_WIDTH * 2,
    };
  const { texture } = sprite;
  const opaque = textureOpaqueFrame(texture);
  const centre = sprite.localTransform.apply({
    x:
      opaque.x +
      opaque.width / 2 -
      texture.frame.x +
      (texture.trim?.x ?? 0) -
      sprite.anchor.x * texture.orig.width,
    y: 0,
  });
  return { x: centre.x, y: groundY, width: opaque.width * Math.abs(sprite.scale.x) };
};

/** Water rings sized to the figure standing in them, relative to a walking LPC character. */
const ringScale = (record: ActorRecord) => {
  const tile = record.recipe.tile;
  const figure = tile.height * LPC_TRAVEL_HEIGHT * LPC_FIGURE_HALF_WIDTH * 2;
  const width = record.footprint?.width ?? figure;
  return (
    (tile.width / 44) *
    Math.min(RING_MAX_SCALE, Math.max(RING_MIN_SCALE, width / figure))
  );
};

/** Characters walk on unfrozen water; ice, bridges and foundations carry no rings. */
const isOpenWater = (tile: TerrainHex) =>
  !!tile.spec?.isWater && !tile.frozen && !tile.hasStructure && tile.zone !== "road";

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
    // Roaming NPCs only start on their anchor; they never orbit tile mates.
    const key = user.npcWander
      ? travelActorKey(user)
      : `${user.longitude},${user.latitude}`;
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
      ? awake.filter((user) => selected.has(travelActorKey(user)))
      : awake;
    shown.forEach((user, index) => {
      const appearanceUser = user.bodyArt
        ? { ...user, spriteAppearance: undefined }
        : !user.spriteAppearance && user.userId === snapshot.viewer?.userId
          ? { ...user, spriteAppearance: resolveSpriteAppearance(snapshot.viewer) }
          : user;
      recipes.push({
        key: travelActorKey(user),
        user: appearanceUser,
        tile,
        parts: partsFor(appearanceUser, tile),
        orbit: (index / shown.length) * Math.PI * 2,
        spread: shown.length > 1,
      });
    });
    // Fights on the creator's tile are trials: a pin there would cover their attack control,
    // and the Colosseum already lists them.
    const hostsTrial = awake.some((user) => user.username === CREATOR_USERNAME);
    const battles = new Map<string, SectorUser[]>();
    for (const user of tileUsers)
      if (!hostsTrial && user.status === "BATTLE" && user.battleId) {
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
/** Whether a player is the only awake one the viewer could mean on their tile. */
export const isAloneOnTile = (
  users: SectorUser[],
  target: SectorUser,
  viewerId?: string,
) =>
  users.filter(
    (candidate) =>
      !candidate.isNpc &&
      candidate.status === "AWAKE" &&
      candidate.userId !== viewerId &&
      candidate.longitude === target.longitude &&
      candidate.latitude === target.latitude,
  ).length === 1;

export const travelActionAvailability = (
  viewer: NonNullable<UserWithRelations>,
  target: SectorUser,
  friendlyAttack: boolean,
  wars: TravelActorsSnapshot["wars"],
) => {
  const other = target.userId !== viewer.userId && !target.isNpc;
  return {
    attack: !!other && canShowMapAttack(viewer, target, friendlyAttack, wars),
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
/** A walking LPC figure spans about 24 of its frame's 64 columns and 48 of its rows. */
const LPC_FIGURE_HALF_WIDTH = 12 / 64;
const LPC_FIGURE_HEIGHT = 48 / 64;
const NPC_TRAVEL_HEIGHT = 1.3;
/** Water rings follow a figure's width within this range of an LPC character's. */
const RING_MIN_SCALE = 0.6;
const RING_MAX_SCALE = 2.5;
const PLAYER_TRAVEL_SHADOW = 0.16;
const PLAYER_TRAVEL_LIGHT = 0.65;
/** A sheet's cells share its still image's square framing, so frames swap in place. */
const sheetLoop = (animation: CharacterAnimation): WorldLoop => ({
  clip: {
    images: [animationTextureUrl(animation, 256)],
    columns: animation.columns,
    rows: animation.rows,
    frameCount: animation.frameCount,
    frameDurationMs: 1000 / animation.fps,
    loop: true,
  },
  facing: animation.facing,
});
/**
 * An NPC's idle and walk loops, each actor at its own point in the clip and idling at its own
 * tempo, so a herd sharing one sheet never moves in lockstep.
 */
const npcLoops = (user: SectorUser) => {
  let hash = 0x811c9dc5;
  for (const char of travelActorKey(user))
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  hash >>>= 0;
  const offsetMs = hash % 10_000;
  const tempo = 0.85 + ((hash >>> 14) % 301) / 1000;
  const idle = user.npcSheets?.idle && sheetLoop(user.npcSheets.idle);
  const walk = user.npcSheets?.move && sheetLoop(user.npcSheets.move);
  return {
    loop: idle && {
      ...idle,
      clip: { ...idle.clip, frameDurationMs: idle.clip.frameDurationMs * tempo },
      offsetMs,
    },
    walk: walk && { ...walk, offsetMs },
  };
};
const headingOf = (dx: number, previous?: AvatarFacing): AvatarFacing | undefined =>
  Math.abs(dx) < 0.001 ? previous : dx < 0 ? "left" : "right";
/** Player control centers in tile units: x across the tile width, y up from the tile's foot. */
const PORTRAIT_CONTROLS = {
  attack: [0.9, 1.4],
  heal: [1, 0.5],
  info: [0.1, 1.4],
} as const;
const SPRITE_CONTROLS = {
  attack: [0.79, 1.2],
  heal: [0.8, 0.5],
  info: [0.22, 1.2],
} as const;
const isActorControl = (kind: string) =>
  kind === "attack" || kind === "heal" || kind === "info" || kind === "talk";
/** Repeated NPC appearances remain distinct through placement identity; players use account identity. */
/** Actor identity: one per player, and one per member of each NPC copy. */
export const travelActorKey = (user: SectorUser) =>
  user.isNpc
    ? `npc:${user.npcPlacementId ?? user.userId}:${user.npcCopy ?? 0}:${user.npcMember ?? 0}`
    : `user:${user.userId}`;
/** Every input userParts reads; walking steps and health updates change none of them. */
const appearanceInputs = (user: SectorUser) => ({
  spriteAppearance: user.spriteAppearance,
  appearanceJson: JSON.stringify(user.spriteAppearance),
  bodyArt: user.bodyArt,
  bodyIdle: user.bodyIdle?.id,
  bodyMove: user.bodyMove?.id,
  npcIdle: user.npcSheets?.idle?.id,
  npcMove: user.npcSheets?.move?.id,
  npcScale: user.npcScale,
  avatar: user.avatar,
  avatarLight: user.avatarLight,
  isNpc: user.isNpc,
  rank: user.rank,
  allianceStatus: user.allianceStatus,
  npcInteractionType: user.npcInteractionType,
  username: user.username,
});
type AppearanceInputs = ReturnType<typeof appearanceInputs>;
/** Whether a user still draws the artwork recorded in `inputs`. */
const sameAppearance = (inputs: AppearanceInputs, user: SectorUser) =>
  inputs.bodyArt === user.bodyArt &&
  inputs.bodyIdle === user.bodyIdle?.id &&
  inputs.bodyMove === user.bodyMove?.id &&
  inputs.npcIdle === user.npcSheets?.idle?.id &&
  inputs.npcMove === user.npcSheets?.move?.id &&
  inputs.npcScale === user.npcScale &&
  inputs.avatar === user.avatar &&
  inputs.avatarLight === user.avatarLight &&
  inputs.isNpc === user.isNpc &&
  inputs.rank === user.rank &&
  inputs.allianceStatus === user.allianceStatus &&
  inputs.npcInteractionType === user.npcInteractionType &&
  inputs.username === user.username &&
  // Walking steps carry the same recipe object; a rebuilt one is compared by value.
  (inputs.spriteAppearance === user.spriteAppearance ||
    inputs.appearanceJson === JSON.stringify(user.spriteAppearance));
const ambientRank = (user: SectorUser) => Number(user.npcInteractionType === "AMBIENT");
/** Apply the same visibility policy before body selection and full-roster encounter/count recipes. */
const canShowUser = (snapshot: TravelActorsSnapshot, user: SectorUser) =>
  (snapshot.showUsers || user.userId === snapshot.viewer?.userId) &&
  (snapshot.showAmbient !== false || user.npcInteractionType !== "AMBIENT") &&
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
  const fullBody = user.isNpc || !!user.bodyArt;
  const parts =
    fullBody || user.spriteAppearance
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
      user.bodyArt ?? travelAvatar(user),
      user.spriteAppearance
        ? LPC_TRAVEL_HEIGHT
        : user.bodyArt
          ? NPC_TRAVEL_HEIGHT * 2
          : user.isNpc
            ? NPC_TRAVEL_HEIGHT * (user.npcScale ?? 1)
            : 0.8,
      0.5,
      user.spriteAppearance ? LPC_TRAVEL_FOOT_Y + LPC_TRAVEL_HEIGHT / 2 : 1,
      user.spriteAppearance
        ? {
            character: user.spriteAppearance,
            characterMode: "travel",
            shadowCaster: "character",
            shadow: PLAYER_TRAVEL_SHADOW,
            light: PLAYER_TRAVEL_LIGHT,
          }
        : fullBody
          ? {
              // Double-height body art outgrows a 256px rendition; it keeps its native
              // source and samples smoothly, so its scale never doubles or drops pixels.
              rendition: user.bodyArt ? 0 : 256,
              preserveAspect: true,
              nearest: !user.bodyArt,
              shadowCaster: "character",
              // Body art and NPCs stand on the ground like players: grounded and animated, and
              // lit at night unless they are wildlife.
              shadow: PLAYER_TRAVEL_SHADOW,
              ...(user.npcInteractionType === "AMBIENT"
                ? {}
                : { light: PLAYER_TRAVEL_LIGHT }),
              ...(user.bodyArt
                ? {
                    loop: user.bodyIdle && sheetLoop(user.bodyIdle),
                    walk: user.bodyMove && sheetLoop(user.bodyMove),
                  }
                : npcLoops(user)),
            }
          : { mask: IMG_SECTOR_USER_SPRITE_MASK },
    ),
  );
  if (user.isNpc) {
    // Ambient NPCs are scenery and offer no control.
    if (user.npcInteractionType !== "AMBIENT")
      parts.push(
        part(
          tile,
          user.npcInteractionType === "HOSTILE" ? "attack" : "talk",
          user.npcInteractionType === "HOSTILE"
            ? IMG_SECTOR_ATTACK
            : IMG_MAP_QUEST_ICON,
          0.8,
          0.9,
          1.4,
        ),
      );
  } else {
    // Character sprites are narrower than portraits, so their controls tuck in around the body.
    const at = user.spriteAppearance ? SPRITE_CONTROLS : PORTRAIT_CONTROLS;
    if (
      user.username === CREATOR_USERNAME ||
      !RANKS_RESTRICTED_FROM_PVP.includes(user.rank)
    )
      parts.push(
        part(tile, "attack", IMG_SECTOR_ATTACK, 0.8, at.attack[0], at.attack[1]),
      );
    parts.push(
      part(tile, "heal", IMG_ICON_HEAL, 0.7, at.heal[0], at.heal[1]),
      part(tile, "info", IMG_SECTOR_INFO, 0.7, at.info[0], at.info[1]),
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
  wars?: Parameters<typeof canShowMapAttack>[3];
  structureObjectiveIds: ReadonlySet<string | undefined>;
  /** Limits individual artwork only; occupancy badges and encounters use the complete user list. */
  characterKeys?: ReadonlySet<string>;
  /** Published movement edges already supply interpolation; they need no second path search. */
  motionSteps?: ReadonlyMap<string, TravelMotionStep>;
  /** Ambient overworld AIs (wildlife) follow the Wildlife visual effect. */
  showAmbient?: boolean;
};
export type TravelActorHit = {
  key: string;
  type: string;
  userId?: string;
  npcPlacementId?: string;
  npcCopy?: number;
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
type CastLight = { x: number; y: number; z: number; day: number };
/** Matches projected scenery silhouettes, so NPC and tree shadows read as one light. */
/** Actors load within this many tiles of the view and are kept until this many. */
const LOAD_TILES = 3;
const RETAIN_TILES = 6;
/** Wildlife-only depth crossings re-sort at most this often. */
const AMBIENT_DEPTH_SORT_MS = 250;
/** Actors overlapping in the wrong order re-sort at most this often; scenery crossings do not wait. */
const ACTOR_DEPTH_SORT_MS = 200;
const CAST_SHADOW_TINT = 0x202932;
const CAST_SHADOW_ALPHA = 0.22;
type ActorRecord = {
  depth: number;
  cast: Sprite | null;
  castBody?: { sprite: Sprite; groundY: number };
  /** Inputs the cast silhouette was last posed from. */
  castKey: string;
  /** Actor-local foot Y, updated when the visible avatar cutout finishes loading. */
  contactY: number;
  /** Actor-local feet and visible figure width of the loaded avatar; rings and the route use it. */
  footprint: { x: number; y: number; width: number } | null;
  tile: TerrainHex;
  path: TerrainHex[];
  x: number;
  y: number;
  facing: LpcDirection;
  /** Last sideways direction walked; up and down keep it, so looping art never flips. */
  heading?: AvatarFacing;
  /** Where the last published step ended, until a newer snapshot places the actor. */
  hold?: { x: number; y: number };
  /** Seconds until the next water ring; zero emits on the first frame over water. */
  ripple: number;
  /** Hex under the actor at its last looked-up position, for water rings. */
  ground?: { x: number; y: number; tile: TerrainHex };
  recipe: ActorRecipe;
  signature: string;
  scope: GameRenderer;
  root: Container;
  art: Awaited<ReturnType<typeof createWorldSprites>> | null;
  fallback: Graphics | null;
  counterLabel: BitmapText | null;
  /** Key of this actor's published movement. */
  movementKey: string;
  /** The loaded layered character, posed every frame. */
  character: LpcCharacter | undefined;
  /** Whether the loaded art has idle or walk loops to play. */
  loops: boolean;
  /** Ground effects positioned with the actor from their own render groups. */
  effects: { shadows: Container; lights: Container } | null;
  /** Player controls currently outside the scene graph. */
  detached?: Set<Container>;
};

/** Interpolated sector-local feet use the same path clock as the camera. */
export type TravelActorMovement = {
  x: number;
  y: number;
  /** Where a published step ends; the actor stays there once the step expires. */
  to?: { x: number; y: number };
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
