import type { Grid } from "honeycomb-grid";
import { Container, Graphics, Text } from "pixi.js";
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
} from "@/drizzle/constants";
import { PathCalculator, type TerrainHex } from "@/libs/hexgrid";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { lpcFacing } from "@/libs/lpc/catalog";
import { passesBracketFilter } from "@/libs/profile";
import { getActiveObjectives } from "@/libs/quest";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import { createRenderScope } from "@/libs/rendering/scope";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { isObjectChainVisible } from "@/libs/rendering/visibility";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { hasRequiredRank } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { findVillageUserRelationship } from "@/utils/alliance";

/** Actor identity and art stay stable across position and presence updates. */
export const createTravelActors = (game: GameRenderer) => {
  const container = new Container();
  const records = new Map<string, ActorRecord>();
  const byRoot = new Map<Container, ActorRecord>();
  let viewer: UserWithRelations;
  let users: SectorUser[] = [];
  let friendlyAttack = false;
  let hovered: string | null = null;
  let paths: PathCalculator | null = null;
  let pathGrid: Grid<TerrainHex> | null = null;
  const sync = (snapshot: TravelActorsSnapshot) => {
    if (pathGrid !== snapshot.grid) {
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
      const signature = JSON.stringify([recipe.parts, recipe.counter]);
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
      container.addChild(root);
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
              recipe.tile.height * 0.2,
              recipe.tile.height * 0.35,
              recipe.tile.height * 0.12,
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
        tile: previous?.tile ?? recipe.tile,
        path: previous?.path ?? [],
        x: previous?.x ?? -recipe.tile.center.x,
        y: previous?.y ?? -recipe.tile.center.y,
        facing: previous?.facing ?? 2,
      };
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
      void createWorldSprites(scope, recipe.parts).then(
        (art) => {
          if (scope.isDisposed()) return;
          record.art = art;
          root.addChild(art.container);
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
    // Explicit actor lists avoid tile hit meshes and scene-graph raycasts.
    for (let i = container.children.length - 1; i >= 0; i--) {
      const root = container.children[i];
      const record = root ? byRoot.get(root) : undefined;
      if (!record?.art) continue;
      for (let j = record.art.entries.length - 1; j >= 0; j--) {
        const entry = record.art.entries[j];
        if (!entry || !isObjectChainVisible(entry.sprite)) continue;
        const bounds = entry.sprite.getBounds();
        if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY)
          continue;
        const { recipe } = record;
        return {
          key: recipe.key,
          type: recipe.quest
            ? "questMarker"
            : recipe.battleId
              ? "battleMarker"
              : entry.description.kind,
          userId: recipe.user?.userId,
          npcPlacementId: recipe.user?.npcPlacementId,
          battleId: recipe.battleId,
          longitude: recipe.tile.col,
          latitude: recipe.tile.row,
        };
      }
    }
    return null;
  };
  const animate = (frame: GameFrame) => {
    const angle = frame.reducedMotion ? 0 : (frame.now * Math.PI) / 5000;
    const cycle = frame.reducedMotion ? 0 : (frame.now / 1000) % 2;
    const wobble = cycle < 1 ? Math.sin(cycle * Math.PI * 4) * (1 - cycle) * 2 : 0;
    for (const record of records.values()) {
      const { recipe, root } = record;
      const waypoint = record.path[0] ?? recipe.tile;
      const dx = -waypoint.center.x - record.x,
        dy = -waypoint.center.y - record.y;
      const distance = Math.hypot(dx, dy);
      const moving = distance > 0.01;
      if (moving) {
        record.facing = lpcFacing(dx, dy, record.facing);
        const step = frame.reducedMotion
          ? distance
          : Math.min(distance, recipe.tile.width * frame.delta * 6);
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
    }
    container.children.sort((a, b) => b.position.y - a.position.y);
  };
  return {
    container,
    sync,
    hit,
    animate,
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
      user.spriteAppearance ? 1.8 : user.isNpc ? 1.3 : 0.8,
      0.5,
      1,
      user.spriteAppearance
        ? { character: user.spriteAppearance }
        : user.isNpc
          ? { rendition: 256 }
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
};
