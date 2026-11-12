import {
  VILLAGE_DUTY_MAX_PATROLS,
  VILLAGE_DUTY_MIN_RANK,
  VILLAGE_DUTY_PRESENCE_SECONDS,
  VILLAGE_DUTY_WANDER_RADIUS,
} from "@/drizzle/constants";
import type { UserData, VillageStructure } from "@/drizzle/schema";
import { createHexGrid, oddQHexDistance, PathCalculator } from "@/libs/hexgrid";
import {
  anonymousSpriteAppearance,
  resolveSpriteAppearance,
} from "@/libs/lpc/appearance";
import {
  isOpenWanderTile,
  WANDER_STEP_MS,
  wanderPose,
  wanderPoseTile,
  wanderSpots,
} from "@/libs/overworldWander";
import { hasRequiredRank } from "@/libs/rank";
import type { NormalizedSectorMap, SectorCoordinate } from "@/libs/sector-map/types";
import {
  getNeighborCoordinates,
  getSectorTile,
  resolveSectorAnchor,
} from "@/libs/sector-map/validation";
import { planVillageWalls } from "@/libs/sector-map/village-walls";
import type { SectorUser } from "@/libs/sector-map/world-types";
import type { listVillageDutyPatrols } from "@/queries/villageDuty";
import { type BoostStructure, getStrucBoost } from "@/utils/village";

/** Structure and temporary level boosts share the normal rules, with a hard ceiling of twenty bodies. */
export const villageDutyCapacity = (structures?: BoostStructure[]) =>
  Math.min(
    VILLAGE_DUTY_MAX_PATROLS,
    Math.max(0, Math.floor(getStrucBoost("patrolSlotsPerLvl", structures))),
  );

/** Give patrols and combat copies an identity that cannot claim their owner's account row. */
export const villageDutyActorId = (userId: string) => `duty:${userId}`;

/** Enrollment belongs to one membership tenure and never makes a banned or outlaw account a defender. */
export const isOnVillageDuty = (
  user: Pick<
    UserData,
    | "villageId"
    | "villageDutyVillageId"
    | "villageDutyStartedAt"
    | "joinedVillageAt"
    | "rank"
    | "isAi"
    | "isBanned"
    | "isOutlaw"
  >,
  villageId = user.villageId,
) =>
  !!villageId &&
  user.villageId === villageId &&
  user.villageDutyVillageId === villageId &&
  !!user.villageDutyStartedAt &&
  user.villageDutyStartedAt >= user.joinedVillageAt &&
  !user.isAi &&
  !user.isBanned &&
  !user.isOutlaw &&
  hasRequiredRank(user.rank, VILLAGE_DUTY_MIN_RANK);

type VillageDutyStructure = Pick<
  VillageStructure,
  "hasPage" | "longitude" | "latitude" | "route"
>;

const navigationMaps = new WeakMap<
  NormalizedSectorMap,
  WeakMap<readonly VillageDutyStructure[], NormalizedSectorMap>
>();

/** Keep patrols inside the rendered walls and clear of buildings without editing published maps. */
export const villageDutyNavigationMap = (
  map: NormalizedSectorMap,
  structures?: readonly VillageDutyStructure[],
): NormalizedSectorMap => {
  if (!structures?.length) return map;
  let layouts = navigationMaps.get(map);
  const cached = layouts?.get(structures);
  if (cached) return cached;
  const shrine = resolveSectorAnchor(map, "shrine.default");
  const buildings = structures.some((structure) => structure.route === "/shrine")
    ? structures
    : [
        ...structures,
        {
          hasPage: 1,
          route: "/shrine",
          longitude: shrine?.x ?? 10,
          latitude: shrine?.y ?? 5,
        },
      ];
  const anchors = buildings.flatMap((structure, index) =>
    structure.hasPage
      ? [
          {
            key: `structure.patrol.${index}`,
            x: structure.longitude,
            y: structure.latitude,
          },
        ]
      : [],
  );
  const wall = planVillageWalls(map, [...buildings]);
  const interior = new Set(wall.interior.map((tile) => tile.y * map.width + tile.x));
  const navigation = {
    ...map,
    anchors: [...map.anchors, ...anchors],
    tiles: map.tiles.map((tile) =>
      interior.has(tile.y * map.width + tile.x) ? tile : { ...tile, blocked: true },
    ),
  };
  if (!layouts) {
    layouts = new WeakMap();
    navigationMaps.set(map, layouts);
  }
  layouts.set(structures, navigation);
  return navigation;
};

/** Publish copies on walkable village tiles without revealing their owners' current positions or activities. */
export const villageDutyPatrols = (
  users: Awaited<ReturnType<typeof listVillageDutyPatrols>>,
  map: NormalizedSectorMap,
  sector: number,
  viewerVillageId: string | null,
  patrols?: VillageDutyPatrol[],
  structures?: readonly VillageDutyStructure[],
): SectorUser[] => {
  map = villageDutyNavigationMap(map, structures);
  const tiles = map.tiles.filter(
    (tile) => tile.zone === "village" && isOpenWanderTile(map, tile.x, tile.y, false),
  );
  if (!tiles.length) return [];
  const anchors = villageDutyAnchors(patrols ?? users, tiles);
  return users.flatMap((user) => {
    const tile = anchors.get(user.userId);
    if (!tile) return [];
    const masked = !!user.anbuId && user.villageId !== viewerVillageId;
    const pursuit = patrols?.find((entry) => entry.userId === user.userId)?.pursuit;
    return [
      {
        userId: villageDutyActorId(user.userId),
        villageDutyUserId: masked ? undefined : user.userId,
        isVillageDuty: true,
        username: masked ? "ANBU Protector" : user.username,
        isMasked: masked,
        avatar: masked ? (user.anbuSquad?.image ?? null) : user.avatar,
        avatarLight: masked ? (user.anbuSquad?.image ?? null) : user.avatarLight,
        spriteAppearance: masked
          ? anonymousSpriteAppearance(true)
          : resolveSpriteAppearance(user),
        curHealth: user.maxHealth,
        maxHealth: user.maxHealth,
        sector,
        longitude: tile.x,
        latitude: tile.y,
        location: "Village",
        villageId: user.villageId,
        level: user.level,
        experience: user.experience,
        rank: user.rank,
        isOutlaw: false,
        isBanned: false,
        immunityUntil: new Date(0),
        robImmunityUntil: new Date(0),
        updatedAt: user.villageDutyStartedAt ?? new Date(0),
        allianceStatus: user.villageId === viewerVillageId ? "ALLY" : "NEUTRAL",
        status: "AWAKE",
        battleId: null,
        npcWander: {
          seed: villageDutyActorId(user.userId),
          anchor: { x: tile.x, y: tile.y },
          radius: VILLAGE_DUTY_WANDER_RADIUS,
          wildOnly: false,
          villageOnly: true,
          pursuit:
            pursuit && isVillageDutyPursuitClear(pursuit, map) ? pursuit : undefined,
        },
      } satisfies SectorUser,
    ];
  });
};

/** Persisted copy state belongs to one hourly roster, never to its owner's health or activity. */
export type VillageDutyPatrol = {
  userId: string;
  defeated: boolean;
  battleId: string | null;
  pursuit?: {
    targetUserId: string;
    startedAt: number;
    expiresAt?: number;
    path: SectorCoordinate[];
  } | null;
};

/** Persisted paths must still fit the current building layout before server or client replay. */
const isVillageDutyPursuitClear = (
  pursuit: NonNullable<VillageDutyPatrol["pursuit"]>,
  map: NormalizedSectorMap,
) =>
  pursuit.path.every(
    (tile) =>
      isOpenWanderTile(map, tile.x, tile.y, false) &&
      getSectorTile(map, tile)?.zone === "village",
  );

/** A pursuit advances at the NPC pace until its travel presence expires, then resumes shared roaming. */
export const villageDutyPursuitPosition = (
  pursuit: NonNullable<VillageDutyPatrol["pursuit"]>,
  now: number,
) => {
  if (
    now >=
    (pursuit.expiresAt ?? pursuit.startedAt + VILLAGE_DUTY_PRESENCE_SECONDS * 1000)
  )
    return null;
  const progress = Math.max(0, (now - pursuit.startedAt) / WANDER_STEP_MS);
  const index = Math.min(pursuit.path.length - 1, Math.floor(progress));
  const from = pursuit.path[index];
  const to = pursuit.path[Math.min(index + 1, pursuit.path.length - 1)];
  return from && to ? { from, to, progress: Math.min(1, progress - index) } : null;
};

/** Use the same roaming pose as the scene before a patrol starts or retargets its pursuit. */
export const villageDutyPosition = (
  patrol: VillageDutyPatrol,
  actor: Pick<SectorUser, "npcWander" | "longitude" | "latitude">,
  map: NormalizedSectorMap,
  now: number,
) => {
  if (patrol.pursuit && isVillageDutyPursuitClear(patrol.pursuit, map)) {
    const pose = villageDutyPursuitPosition(patrol.pursuit, now);
    if (pose) return pose.progress < 0.5 ? pose.from : pose.to;
  }
  const wander = actor.npcWander;
  return wander
    ? wanderPoseTile(
        wanderPose(
          {
            ...wander,
            spots: wanderSpots(map, wander.anchor, wander.radius, false, true),
          },
          0,
          now,
        ),
      )
    : { x: actor.longitude, y: actor.latitude };
};

/** Deterministic distance ties keep nearby guards from switching targets between equivalent visitors. */
export const nearestVillageDutyIntruder = <
  T extends { userId: string; longitude: number; latitude: number },
>(
  from: SectorCoordinate,
  intruders: readonly T[],
) =>
  [...intruders].sort(
    (a, b) =>
      oddQHexDistance(from.x, from.y, a.longitude, a.latitude) -
        oddQHexDistance(from.x, from.y, b.longitude, b.latitude) ||
      a.userId.localeCompare(b.userId),
  )[0];

/** Stable anchors prevent patrols jumping between sector refreshes and agree with server pursuits. */
export const villageDutyAnchor = (
  userId: string,
  tiles: readonly SectorCoordinate[],
) => {
  let hash = 0;
  for (const char of userId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return tiles[hash % tiles.length];
};

/** Reserve distinct anchors from the full shift so defeated or withdrawn copies cannot move survivors. */
const villageDutyAnchors = (
  roster: readonly { userId: string }[],
  tiles: readonly SectorCoordinate[],
) => {
  const anchors = new Map<string, SectorCoordinate>();
  const occupied = new Set<number>();
  for (const { userId } of [...roster].sort((a, b) =>
    a.userId.localeCompare(b.userId),
  )) {
    const preferred = villageDutyAnchor(userId, tiles);
    if (!preferred) continue;
    let index = tiles.indexOf(preferred);
    for (let attempt = 0; attempt < tiles.length && occupied.has(index); attempt++)
      index = (index + 1) % tiles.length;
    const tile = tiles[index];
    if (tile) {
      anchors.set(userId, tile);
      occupied.add(index);
    }
  }
  return anchors;
};

/** Plan shared pursuit paths using existing hex routing; no database, timers or owner mutations occur here. */
export const planVillageDutyPursuits = (
  patrols: readonly VillageDutyPatrol[],
  owners: readonly { userId: string }[],
  map: NormalizedSectorMap,
  intruders: readonly {
    userId: string;
    longitude: number;
    latitude: number;
    expiresAt?: number;
  }[],
  now: number,
  structures?: readonly VillageDutyStructure[],
): VillageDutyPatrol[] => {
  map = villageDutyNavigationMap(map, structures);
  const tiles = map.tiles.filter(
    (tile) => tile.zone === "village" && isOpenWanderTile(map, tile.x, tile.y, false),
  );
  const anchors = villageDutyAnchors(patrols, tiles);
  const actors = owners.flatMap((owner) => {
    const anchor = anchors.get(owner.userId);
    return anchor
      ? [
          {
            villageDutyUserId: owner.userId,
            longitude: anchor.x,
            latitude: anchor.y,
            npcWander: {
              seed: villageDutyActorId(owner.userId),
              anchor,
              radius: VILLAGE_DUTY_WANDER_RADIUS,
              wildOnly: false,
              villageOnly: true,
            },
          },
        ]
      : [];
  });
  let paths: PathCalculator | undefined;
  return patrols.map((patrol) => {
    if (patrol.defeated || patrol.battleId) return patrol;
    const actor = actors.find((entry) => entry.villageDutyUserId === patrol.userId);
    if (!actor) return patrol;
    const from = villageDutyPosition(patrol, actor, map, now);
    const target = nearestVillageDutyIntruder(from, intruders);
    if (!target) return patrol.pursuit ? { ...patrol, pursuit: null } : patrol;
    const expiresAt = target.expiresAt ?? now + VILLAGE_DUTY_PRESENCE_SECONDS * 1000;
    const last = patrol.pursuit?.path.at(-1);
    if (
      patrol.pursuit?.targetUserId === target.userId &&
      isVillageDutyPursuitClear(patrol.pursuit, map) &&
      villageDutyPursuitPosition(patrol.pursuit, now) &&
      last &&
      oddQHexDistance(last.x, last.y, target.longitude, target.latitude) <= 1
    )
      return patrol.pursuit.expiresAt === expiresAt
        ? patrol
        : { ...patrol, pursuit: { ...patrol.pursuit, expiresAt } };
    // Most heartbeats retain their pursuit; build routing state only for a changed destination.
    if (!paths) {
      const grid = createHexGrid(1, map.width, map.height);
      for (const tile of grid) {
        tile.blocked =
          !isOpenWanderTile(map, tile.col, tile.row, false) ||
          getSectorTile(map, { x: tile.col, y: tile.row })?.zone !== "village";
        tile.cost = 1;
      }
      paths = new PathCalculator(grid);
    }
    const grid = paths.grid;
    const origin = grid.getHex({ col: from.x, row: from.y });
    if (!origin) return patrol;
    const goals = [
      { x: target.longitude, y: target.latitude },
      ...getNeighborCoordinates({ x: target.longitude, y: target.latitude }),
    ].sort(
      (a, b) =>
        oddQHexDistance(from.x, from.y, a.x, a.y) -
        oddQHexDistance(from.x, from.y, b.x, b.y),
    );
    // A visitor can stand on a building's clearance tiles. Reach the nearest open position
    // before engaging rather than leaving that visitor permanently immune to the patrol.
    const nearestOpen = tiles.reduce<(typeof tiles)[number] | undefined>(
      (best, tile) =>
        !best ||
        oddQHexDistance(tile.x, tile.y, target.longitude, target.latitude) <
          oddQHexDistance(best.x, best.y, target.longitude, target.latitude)
          ? tile
          : best,
      undefined,
    );
    goals.push(...(nearestOpen ? [nearestOpen] : []), from);
    for (const goal of goals) {
      const destination = grid.getHex({ col: goal.x, row: goal.y });
      if (!destination || destination.blocked) continue;
      const path = paths.getShortestPath(origin, destination);
      if (path)
        return {
          ...patrol,
          pursuit: {
            targetUserId: target.userId,
            startedAt: now,
            expiresAt,
            path: path.map((tile) => ({ x: tile.col, y: tile.row })),
          },
        };
    }
    return patrol;
  });
};
