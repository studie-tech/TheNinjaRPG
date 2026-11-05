import {
  HOME_FURNITURE_POSITION_MAX,
  HOME_FURNITURE_POSITION_MIN,
  HOME_FURNITURE_ROTATION_DEGREES,
  HOME_FURNITURE_ROTATIONS,
  type HomeFurnitureAction,
  type HomeFurnitureRotation,
  type HomeType,
} from "@/drizzle/constants";
import {
  getHomeFloorAnchors,
  HOME_GEOMETRY_EPSILON,
  type HomeFloorRegions,
  isPointInHomeFloor,
  subtractHomeFloorBounds,
} from "@/libs/homeFloorGeometry";
import {
  getHomePlacementRoom,
  getHomeRoom,
  homeRoomLayoutError,
} from "@/libs/homeProperty";

import { HOME_ART_PLANS, HOME_FLOOR_PROJECTION } from "@/libs/homeRoomGeometry";
import { clamp } from "@/utils/math";
import type { HomePlacement } from "@/validators/home";
import type {
  FurnitureGeometry,
  FurnitureImageBounds,
  FurnitureViews,
} from "@/validators/itemFurniture";

/** A furniture instance is an owned inventory row; content supplies its appearance and home action. */
export type HomeFurniture = {
  id: string;
  itemId: string;
  name: string;
  image: string;
  width: number;
  groundAnchor: number;
  geometry?: FurnitureGeometry;
  action: HomeFurnitureAction | null;
  isFloor: boolean;
  quantity: number;
  views: FurnitureViews;
};

/** Only published directions can be selected; the canonical image is always available. */
export const getHomeFurnitureRotations = (furniture: Pick<HomeFurniture, "views">) =>
  HOME_FURNITURE_ROTATIONS.filter(
    (rotation) =>
      rotation === 0 ||
      !!furniture.views?.[HOME_FURNITURE_ROTATION_DEGREES[rotation]]?.image,
  );

/** Removed or incomplete directions render the canonical art until the player saves a new facing. */
export const getHomeFurnitureView = (
  furniture: Pick<
    HomeFurniture,
    "image" | "width" | "groundAnchor" | "geometry" | "views"
  >,
  rotation: HomeFurnitureRotation,
) => {
  const degrees = HOME_FURNITURE_ROTATION_DEGREES[rotation];
  const view = degrees === 0 ? undefined : furniture.views?.[degrees];
  return {
    image: view?.image ?? furniture.image,
    width: view?.width ?? furniture.width,
    groundAnchor: view?.groundAnchor ?? furniture.groundAnchor,
    // Different painted images have independent padding, including cosmetic skins.
    geometry:
      (view ? view.geometry : furniture.geometry) ?? DEFAULT_HOME_FURNITURE_GEOMETRY,
  };
};

/** Uncalibrated content remains usable with a conservative floor strip and its complete image. */
export const DEFAULT_HOME_FURNITURE_GEOMETRY: FurnitureGeometry = {
  aspectRatio: 4 / 3,
  visibleBounds: { x: 0, y: 0, width: 100, height: 100 },
  footprint: { x: 10, y: 85, width: 80, height: 15 },
};

/** Saved coordinates remain stable while the room camera maps them into scene percentages. */
export const projectHomePlacement = (placement: Pick<HomePlacement, "x" | "y">) => ({
  x: HOME_FLOOR_PROJECTION.x + placement.x * HOME_FLOOR_PROJECTION.scaleX,
  y: HOME_FLOOR_PROJECTION.y + placement.y * HOME_FLOOR_PROJECTION.scaleY,
});

export const unprojectHomePlacement = (point: HomePoint) => ({
  x: (point.x - HOME_FLOOR_PROJECTION.x) / HOME_FLOOR_PROJECTION.scaleX,
  y: (point.y - HOME_FLOOR_PROJECTION.y) / HOME_FLOOR_PROJECTION.scaleY,
});

/** Image, selection, and occupied ground bounds share one source-image coordinate system. */
export const getHomeFurnitureGeometry = (
  furniture: HomeFurniture,
  placement: HomePlacement,
  homeType: HomeType,
) => {
  const view = getHomeFurnitureView(furniture, placement.rotation);
  const anchor = projectHomePlacement(placement);
  const room = getHomeRoom(homeType, getHomePlacementRoom(placement));
  const width = (view.width * 100) / (room?.width ?? 100);
  // Scale against the painted world canvas before converting into room-local vertical percentages.
  const height =
    (view.width * HOME_ART_PLANS[homeType].aspectRatio * 100) /
    view.geometry.aspectRatio /
    (room?.height ?? 100);
  const image = {
    x: anchor.x - width / 2,
    y: anchor.y - (height * view.groundAnchor) / 100,
    width,
    height,
  };
  const bounds = (rect: FurnitureImageBounds) => ({
    x: image.x + (image.width * rect.x) / 100,
    y: image.y + (image.height * rect.y) / 100,
    width: (image.width * rect.width) / 100,
    height: (image.height * rect.height) / 100,
  });
  return {
    image,
    visibleBounds: bounds(view.geometry.visibleBounds),
    footprint: bounds(view.geometry.footprint),
  };
};

/** Reject only the proposed arrangement; expected placement failures have recoverable messages. */
export const homeLayoutPlacementError = (
  placements: HomePlacement[],
  furniture: HomeFurniture[],
  homeType: HomeType,
) => {
  const roomError = homeRoomLayoutError(placements, homeType);
  if (roomError) return roomError;
  const available = new Map(furniture.map((piece) => [piece.id, piece]));
  for (const placement of placements) {
    const piece = available.get(placement.id);
    if (!piece) continue; // Ownership is validated before geometry on the server.
    if (
      !isPointInHomeFloor(
        projectHomePlacement(placement),
        getHomeAnchorRegions(piece, placement, homeType),
      )
    ) {
      return piece.action === "farm"
        ? `${piece.name} must fit outside in the garden`
        : `${piece.name} must fit on the room floor, clear of the walls and curtains`;
    }
  }
  for (const [index, placement] of placements.entries()) {
    const piece = available.get(placement.id);
    if (!piece || piece.isFloor) continue;
    const footprint = getHomeFurnitureGeometry(piece, placement, homeType).footprint;
    for (const other of placements.slice(index + 1)) {
      const otherPiece = available.get(other.id);
      if (!otherPiece || !canHomePiecesCollide(placement, piece, other, otherPiece))
        continue;
      if (
        doHomeBoundsOverlap(
          footprint,
          getHomeFurnitureGeometry(otherPiece, other, homeType).footprint,
        )
      ) {
        return `${piece.name} overlaps ${otherPiece.name}. Move them apart before saving`;
      }
    }
  }
  return null;
};

/** Move an anchor to the closest point where its entire painted floor footprint fits. */
export const clampHomeFurniturePlacement = (
  placement: HomePlacement,
  furniture: HomeFurniture,
  homeType: HomeType,
): HomePlacement | null => {
  const regions = getHomeAnchorRegions(furniture, placement, homeType);
  if (!regions.length) return null;
  const anchor = projectHomePlacement(placement);
  if (isPointInHomeFloor(anchor, regions)) return { ...placement };
  const point = closestPointInHomeFloor(anchor, regions);
  return { ...placement, ...unprojectHomePlacement(point) };
};

/** Find nearby free ground for adding, rotating, or recovering a piece without changing its size. */
export const fitHomeFurniturePlacement = (
  placement: HomePlacement,
  furniture: HomeFurniture,
  placements: HomePlacement[],
  pieces: HomeFurniture[],
  homeType: HomeType,
): HomePlacement | null => {
  const clamped = clampHomeFurniturePlacement(placement, furniture, homeType);
  if (!clamped) return null;
  const available = new Map(pieces.map((piece) => [piece.id, piece]));
  const obstacles = furniture.isFloor
    ? []
    : placements.flatMap((other) => {
        const piece = available.get(other.id);
        return other.id !== placement.id &&
          piece &&
          canHomePiecesCollide(placement, furniture, other, piece)
          ? [getHomeFurnitureGeometry(piece, other, homeType).footprint]
          : [];
      });
  const footprint = getHomeFurnitureGeometry(furniture, clamped, homeType).footprint;
  if (!obstacles.some((other) => doHomeBoundsOverlap(footprint, other))) return clamped;

  const anchor = projectHomePlacement(clamped);
  const offset = { x: footprint.x - anchor.x, y: footprint.y - anchor.y };
  // Polygon clipping drops edge-only space. Keep a margin inside the overlap
  // tolerance so touching furniture still fits after projection rounding.
  const inset = HOME_GEOMETRY_EPSILON / 2;
  const regions = subtractHomeFloorBounds(
    getHomeAnchorRegions(furniture, clamped, homeType),
    obstacles
      .map((other) => ({
        x: other.x - offset.x - footprint.width + inset,
        y: other.y - offset.y - footprint.height + inset,
        width: other.width + footprint.width - 2 * inset,
        height: other.height + footprint.height - 2 * inset,
      }))
      .filter(({ width, height }) => width > 0 && height > 0),
  );
  if (!regions.length) return null;
  return {
    ...clamped,
    ...unprojectHomePlacement(closestPointInHomeFloor(anchor, regions)),
  };
};

/** Read old layouts without a database mutation; pieces that no longer fit remain owned in storage. */
export const recoverHomeLayout = (
  placements: HomePlacement[],
  furniture: HomeFurniture[],
  homeType: HomeType,
): HomePlacement[] => {
  const available = new Map(furniture.map((piece) => [piece.id, piece]));
  const recovered: HomePlacement[] = [];
  for (const original of placements) {
    const piece = available.get(original.id);
    if (!piece) continue;
    const placement =
      piece.action === "farm" && getHomePlacementRoom(original) === "main"
        ? { ...original, room: "yard" as const }
        : original;
    const rotations = getHomeFurnitureRotations(piece);
    const preferred = rotations.includes(placement.rotation) ? placement.rotation : 0;
    // A retained room can become shallower when the property's painting changes.
    for (const rotation of [
      preferred,
      ...rotations.filter((value) => value !== preferred),
    ]) {
      const fitted = fitHomeFurniturePlacement(
        { ...placement, rotation },
        piece,
        recovered,
        furniture,
        homeType,
      );
      if (fitted) {
        recovered.push(fitted);
        break;
      }
    }
  }
  return recovered;
};

/** Null coordinates keep an owned item unplaced without a second inventory or layout document. */
export const getHomeLayout = (
  items: {
    id: string;
    homeX: number | null;
    homeY: number | null;
    homeRotation: number;
    homeRoom?: HomePlacement["room"];
  }[],
): HomePlacement[] =>
  items.flatMap((piece) =>
    piece.homeX !== null && piece.homeY !== null
      ? [
          {
            id: piece.id,
            ...(piece.homeRoom && piece.homeRoom !== "main"
              ? { room: piece.homeRoom }
              : {}),
            x: piece.homeX,
            y: piece.homeY,
            rotation: HOME_FURNITURE_ROTATIONS.includes(
              piece.homeRotation as HomeFurnitureRotation,
            )
              ? (piece.homeRotation as HomeFurnitureRotation)
              : 0,
          },
        ]
      : [],
  );

/** Server-owned row IDs prevent placing another account's item or a non-furniture item. */
export const homeLayoutOwnershipError = (
  placements: HomePlacement[],
  furniture: Pick<HomeFurniture, "id">[],
) => {
  const available = new Set(furniture.map((piece) => piece.id));
  return placements.some((placement) => !available.has(placement.id))
    ? "Furniture is no longer available. Reload your home and try again"
    : null;
};

/** A stale editor cannot save a direction whose art was removed or belongs to another skin. */
export const homeLayoutOrientationError = (
  placements: HomePlacement[],
  furniture: Pick<HomeFurniture, "id" | "views">[],
) => {
  const available = new Map(
    furniture.map((piece) => [piece.id, getHomeFurnitureRotations(piece)]),
  );
  return placements.some(
    (placement) => !available.get(placement.id)?.includes(placement.rotation),
  )
    ? "A furniture orientation is no longer available. Reload your home and try again"
    : null;
};

/** Cache lifetime follows furniture identity; callers replace snapshots when appearance changes. */
const homeAnchorCache = new WeakMap<HomeFurniture, Map<string, HomeFloorRegions>>();

/** Pieces only collide inside one room, above the floor layer, and on the same side of farming. */
const canHomePiecesCollide = (
  placement: HomePlacement,
  piece: HomeFurniture,
  other: HomePlacement,
  otherPiece: HomeFurniture,
) =>
  getHomePlacementRoom(other) === getHomePlacementRoom(placement) &&
  !piece.isFloor &&
  !otherPiece.isFloor &&
  (piece.action === "farm") === (otherPiece.action === "farm");

/** Intersect footprint-safe room-local floors with visible-art and saved-position limits. */
const getHomeAnchorRegions = (
  furniture: HomeFurniture,
  placement: HomePlacement,
  homeType: HomeType,
): HomeFloorRegions => {
  const room = getHomeRoom(homeType, getHomePlacementRoom(placement));
  if (!room) return [];
  if (!room.isYard && furniture.action === "farm") return [];
  const key = `${homeType}:${room.id}:${placement.rotation}`;
  let cache = homeAnchorCache.get(furniture);
  if (!cache) {
    cache = new Map();
    homeAnchorCache.set(furniture, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;
  // A fixed reference avoids rounding-dependent cache entries while dragging.
  const reference = { ...placement, x: 50, y: 50 };
  const anchor = projectHomePlacement(reference);
  const geometry = getHomeFurnitureGeometry(furniture, reference, homeType);
  let footprint = {
    ...geometry.footprint,
    x: geometry.footprint.x - anchor.x,
    y: geometry.footprint.y - anchor.y,
  };
  const visible = geometry.visibleBounds;
  const offsetX = visible.x - anchor.x;
  const offsetY = visible.y - anchor.y;
  const floor = furniture.action === "farm" ? [room.outdoor] : room.interior;
  if (furniture.action === "farm") {
    // Cultivation reserves both the visible sprite and its ground contact within the clearing.
    const x = Math.min(footprint.x, offsetX);
    const y = Math.min(footprint.y, offsetY);
    footprint = {
      x,
      y,
      width: Math.max(footprint.x + footprint.width, offsetX + visible.width) - x,
      height: Math.max(footprint.y + footprint.height, offsetY + visible.height) - y,
    };
  }
  const min = projectHomePlacement({
    x: room.isYard ? 0 : HOME_FURNITURE_POSITION_MIN,
    y: room.isYard ? 0 : HOME_FURNITURE_POSITION_MIN,
  });
  const max = projectHomePlacement({
    x: room.isYard ? 100 : HOME_FURNITURE_POSITION_MAX,
    y: room.isYard ? 100 : HOME_FURNITURE_POSITION_MAX,
  });
  // Tall sprites can rise above the floor; lateral floor spans and painting bounds limit their art.
  const left = Math.max(
    min.x,
    Math.max(room.isYard ? 0 : -Infinity, Math.min(...floor.flat().map(({ x }) => x))) -
      offsetX,
  );
  const right = Math.min(
    max.x,
    Math.min(
      room.isYard ? 100 : Infinity,
      Math.max(...floor.flat().map(({ x }) => x)),
    ) -
      offsetX -
      visible.width,
  );
  const top = Math.max(
    min.y,
    (room.isYard ? 0 : (-room.y * 100) / room.height) - offsetY,
  );
  const bottom = Math.min(
    max.y,
    (room.isYard
      ? 100
      : ((HOME_ART_PLANS[homeType].size - room.y) * 100) / room.height) -
      offsetY -
      visible.height,
  );
  // Visible bounds may also admit only a line or point. Give clipping positive
  // area within the same tolerance without moving ordinary visible limits.
  const inset = HOME_GEOMETRY_EPSILON / 2;
  const paddingX = Math.max(0, HOME_GEOMETRY_EPSILON - (right - left)) / 2;
  const paddingY = Math.max(0, HOME_GEOMETRY_EPSILON - (bottom - top)) / 2;
  const regions =
    right + inset > left && bottom + inset > top
      ? getHomeFloorAnchors(floor, footprint, {
          x: left - paddingX,
          y: top - paddingY,
          width: right - left + 2 * paddingX,
          height: bottom - top + 2 * paddingY,
        })
      : [];
  cache.set(key, regions);
  return regions;
};

/** Find the nearest legal point in nonempty regions, considering outer and hole boundaries. */
const closestPointInHomeFloor = (point: HomePoint, regions: HomeFloorRegions) => {
  if (isPointInHomeFloor(point, regions)) return point;
  return regions
    .flat()
    .flatMap((polygon) =>
      polygon.map((edge, index) =>
        closestPointOnHomeSegment(
          point,
          edge,
          polygon[(index + 1) % polygon.length] ?? edge,
        ),
      ),
    )
    .reduce((closest, candidate) =>
      homePointDistanceSquared(candidate, point) <
      homePointDistanceSquared(closest, point)
        ? candidate
        : closest,
    );
};

const closestPointOnHomeSegment = (
  point: HomePoint,
  start: HomePoint,
  end: HomePoint,
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const amount = length
    ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / length, 0, 1)
    : 0;
  return { x: start.x + dx * amount, y: start.y + dy * amount };
};

const homePointDistanceSquared = (a: HomePoint, b: HomePoint) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

const doHomeBoundsOverlap = (a: FurnitureImageBounds, b: FurnitureImageBounds) =>
  a.x + a.width > b.x + HOME_GEOMETRY_EPSILON &&
  b.x + b.width > a.x + HOME_GEOMETRY_EPSILON &&
  a.y + a.height > b.y + HOME_GEOMETRY_EPSILON &&
  b.y + b.height > a.y + HOME_GEOMETRY_EPSILON;

type HomePoint = { x: number; y: number };
