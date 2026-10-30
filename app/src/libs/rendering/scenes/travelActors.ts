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
import { isObjectChainVisible, type WorldBounds } from "@/libs/rendering/visibility";
import type { WorldShadows } from "@/libs/rendering/worldShadows";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { hasRequiredRank } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { findVillageUserRelationship } from "@/utils/alliance";

/** Actor identity and art stay stable across position and presence updates. */
export const createTravelActors = (
  game: GameRenderer,
  layers?: { depth: RenderLayer; overlay: RenderLayer; ground?: RenderLayer },
  shadows?: WorldShadows,
) => {
  const container = new Container();
  const records = new Map<string, ActorRecord>();
  const byRoot = new Map<Container, ActorRecord>();
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
  let visibleKey = "";
  /** Cull before acquiring artwork; padding preloads nearby actors and the viewer stays present. */
  const visibleSnapshot = (snapshot: TravelActorsSnapshot) => {
    const bounds = viewport;
    const visibleUsers = !bounds
      ? snapshot.users
      : snapshot.users.filter((user) => {
          if (user.userId === snapshot.viewer?.userId) return true;
          const tile = snapshot.grid.getHex({
            col: user.longitude,
            row: user.latitude,
          });
          return (
            tile &&
            -tile.center.x >= bounds.minX - tile.width * 3 &&
            -tile.center.x <= bounds.maxX + tile.width * 3 &&
            -tile.center.y >= bounds.minY - tile.height * 3 &&
            -tile.center.y <= bounds.maxY + tile.height * 3
          );
        });
    return { ...snapshot, users: visibleUsers };
  };
  /** Camera movement only reconciles resources when visible actor membership changes. */
  const userKey = (snapshot: TravelActorsSnapshot) =>
    snapshot.users
      .map((user) => `${user.userId}:${user.npcPlacementId ?? ""}`)
      .join("|");
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
    const recipes = travelActorRecipes(snapshot);
    const wanted = new Set(recipes.map((recipe) => recipe.key));
    for (const [key, record] of records) {
      if (!wanted.has(key)) {
        record.scope.dispose();
        byRoot.delete(record.root);
        records.delete(key);
      }
    }
    for (const recipe of recipes) {
      const signature = JSON.stringify([
        recipe.parts,
        recipe.counter,
        recipe.user?.allianceStatus,
      ]);
      const previous = records.get(recipe.key);
      if (previous?.signature === signature) {
        if (previous.recipe.tile !== recipe.tile) {
          const path = paths?.getShortestPath(previous.tile, recipe.tile) ?? [];
          previous.path = path[0] === previous.tile ? path.slice(1) : path;
        }
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
            .fill({ color, alpha: 0.55 }),
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
        tile: previous?.tile ?? recipe.tile,
        path: previous?.path ?? [],
        x: previous?.x ?? -recipe.tile.center.x,
        y: previous?.y ?? -recipe.tile.center.y,
        facing: previous?.facing ?? 2,
      };
      root.position.set(record.x, record.y);
      root.zIndex = -(
        record.y +
        recipe.tile.height *
          (recipe.user?.spriteAppearance ? LPC_TRAVEL_CONTACT_Y : 0.5) +
        container.y
      );
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
          art.setLighting(brightness);
          root.addChild(art.container);
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
        target &&
        users.filter(
          (candidate) =>
            !candidate.isNpc &&
            candidate.userId !== viewer?.userId &&
            candidate.longitude === target.longitude &&
            candidate.latitude === target.latitude,
        ).length === 1;
      const actions =
        target && viewer
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
  const animate = (
    frame: GameFrame,
    movements?: ReadonlyMap<string, TravelActorMovement>,
  ) => {
    const angle = frame.reducedMotion ? 0 : (frame.now * Math.PI) / 5000;
    const cycle = frame.reducedMotion ? 0 : (frame.now / 1000) % 2;
    const wobble = cycle < 1 ? Math.sin(cycle * Math.PI * 4) * (1 - cycle) * 2 : 0;
    for (const record of records.values()) {
      const { recipe, root } = record;
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
        // Catch up queued network waypoints without overshooting; reduced motion snaps to each one.
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
        entry.character?.render(frame, moving ? "walk" : "idle", record.facing);
      const phi = angle + recipe.orbit;
      root.position.set(
        record.x +
          (recipe.spread ? recipe.tile.width * 0.1 * Math.sin(phi) : 0) +
          (recipe.quest ? wobble : 0),
        record.y + (recipe.spread ? recipe.tile.height * 0.1 * Math.cos(phi) : 0),
      );
      // Contact uses the interpolated/orbiting position and the current sector origin.
      // zIndex also invalidates Pixi's retained render instructions when depth changes.
      root.zIndex = -(
        root.y +
        recipe.tile.height *
          (recipe.user?.spriteAppearance ? LPC_TRAVEL_CONTACT_Y : 0.5) +
        container.y
      );
    }
    container.sortChildren();
  };
  /** Retain the latest snapshot so viewport changes can materialize its actors without another fetch. */
  const sync = (snapshot: TravelActorsSnapshot) => {
    sourceSnapshot = snapshot;
    const visible = visibleSnapshot(snapshot);
    visibleKey = userKey(visible);
    reconcile(visible);
  };
  return {
    container,
    sync,
    setViewport: (bounds: WorldBounds) => {
      viewport = bounds;
      if (!sourceSnapshot) return;
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
export const travelActorRecipes = (snapshot: TravelActorsSnapshot): ActorRecipe[] => {
  const recipes: ActorRecipe[] = [];
  const grouped = new Map<string, SectorUser[]>();
  for (const user of snapshot.users) {
    if (
      (!snapshot.showUsers && user.userId !== snapshot.viewer?.userId) ||
      (!user.isNpc &&
        user.userId !== snapshot.viewer?.userId &&
        !passesBracketFilter(user, snapshot.minBracket))
    )
      continue;
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
    awake.forEach((user, index) => {
      const appearanceUser =
        !user.spriteAppearance && user.userId === snapshot.viewer?.userId
          ? { ...user, spriteAppearance: resolveSpriteAppearance(snapshot.viewer) }
          : user;
      recipes.push({
        key: user.isNpc
          ? `npc:${user.npcPlacementId ?? user.userId}`
          : `user:${user.userId}`,
        user: appearanceUser,
        tile,
        parts: userParts(appearanceUser, tile),
        orbit: (index / tileUsers.length) * Math.PI * 2,
        spread: awake.length > 1,
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
  const relationship =
    viewer.village && findVillageUserRelationship(viewer.village, target.villageId);
  const isAlly =
    target.allianceStatus === "ALLY" ||
    (target.allianceStatus !== "ENEMY" &&
      (target.villageId === viewer.villageId || relationship?.status === "ALLY"));
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
const LPC_TRAVEL_CONTACT_Y = 0.2;
const isActorControl = (kind: string) =>
  kind === "attack" || kind === "heal" || kind === "info" || kind === "talk";

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
          ? { rendition: 256, nearest: true, shadowCaster: "character" }
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
  tile: TerrainHex;
  path: TerrainHex[];
  x: number;
  y: number;
  facing: import("@/validators/lpc").LpcDirection;
  recipe: ActorRecipe;
  signature: string;
  scope: GameRenderer;
  root: Container;
  art: Awaited<ReturnType<typeof createWorldSprites>> | null;
  fallback: Graphics | null;
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
