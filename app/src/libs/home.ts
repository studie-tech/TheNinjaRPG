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
  getHomePlacementRoom,
  getHomeRooms,
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
  const room = getHomeRooms(homeType).find(
    ({ id }) => id === getHomePlacementRoom(placement),
  );
  const width = (view.width * 100) / (room?.width ?? 100);
  // Scale against the painted world canvas before converting into room-local vertical percentages.
  const height =
    (view.width * (HOME_ART_PLANS[homeType].aspectRatio ?? 4 / 3) * 100) /
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
      !isPointInHomePolygon(
        projectHomePlacement(placement),
        getHomeAnchorPolygon(piece, placement, homeType),
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
      if (
        !otherPiece ||
        getHomePlacementRoom(other) !== getHomePlacementRoom(placement) ||
        otherPiece.isFloor ||
        (piece.action === "farm") !== (otherPiece.action === "farm")
      )
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
  const polygon = getHomeAnchorPolygon(furniture, placement, homeType);
  if (!polygon.length) return null;
  const anchor = projectHomePlacement(placement);
  if (isPointInHomePolygon(anchor, polygon)) return { ...placement };
  const point = closestPointInHomePolygon(anchor, polygon);
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
          getHomePlacementRoom(other) === getHomePlacementRoom(placement) &&
          piece &&
          !piece.isFloor &&
          (piece.action === "farm") === (furniture.action === "farm")
          ? [getHomeFurnitureGeometry(piece, other, homeType).footprint]
          : [];
      });
  const footprint = getHomeFurnitureGeometry(furniture, clamped, homeType).footprint;
  if (!obstacles.some((other) => doHomeBoundsOverlap(footprint, other))) return clamped;

  const anchor = projectHomePlacement(clamped);
  const offset = { x: footprint.x - anchor.x, y: footprint.y - anchor.y };
  const polygon = getHomeAnchorPolygon(furniture, clamped, homeType);
  const candidates = polygon.flatMap((point, index) => [
    point,
    closestPointOnHomeSegment(
      anchor,
      point,
      polygon[(index + 1) % polygon.length] ?? point,
    ),
  ]);
  const xs = [anchor.x, ...polygon.map(({ x }) => x)];
  const ys = [anchor.y, ...polygon.map(({ y }) => y)];
  for (const other of obstacles) {
    xs.push(other.x - offset.x - footprint.width, other.x + other.width - offset.x);
    ys.push(other.y - offset.y - footprint.height, other.y + other.height - offset.y);
  }
  for (const x of xs)
    for (const y of ys) candidates.push(closestPointInHomePolygon({ x, y }, polygon));
  candidates.sort(
    (a, b) => homePointDistanceSquared(a, anchor) - homePointDistanceSquared(b, anchor),
  );
  for (const point of candidates) {
    const candidate = { ...clamped, ...unprojectHomePlacement(point) };
    const bounds = getHomeFurnitureGeometry(furniture, candidate, homeType).footprint;
    if (!obstacles.some((other) => doHomeBoundsOverlap(bounds, other)))
      return candidate;
  }
  return null;
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

/** Measured convex floor regions shrink by the footprint to keep every piece on usable ground. */
const getHomeAnchorPolygon = (
  furniture: HomeFurniture,
  placement: HomePlacement,
  homeType: HomeType,
) => {
  const room = getHomeRooms(homeType).find(
    ({ id }) => id === getHomePlacementRoom(placement),
  );
  const isYard = room?.isYard;
  // Decorative lawn and cultivation ground remain separate within the garden.
  if (isYard && furniture.action && furniture.action !== "farm") return [];
  if (!room || (!isYard && furniture.action === "farm")) return [];
  const region = furniture.action === "farm" ? room.outdoor : room.interior;
  if (region.length < 3) return [];
  const anchor = projectHomePlacement(placement);
  const geometry = getHomeFurnitureGeometry(furniture, placement, homeType);
  const footprint = {
    ...geometry.footprint,
    x: geometry.footprint.x - anchor.x,
    y: geometry.footprint.y - anchor.y,
  };
  const corners = getHomeBoundsCorners(footprint);
  if (furniture.action === "farm") {
    corners.push(
      ...getHomeBoundsCorners({
        ...geometry.visibleBounds,
        x: geometry.visibleBounds.x - anchor.x,
        y: geometry.visibleBounds.y - anchor.y,
      }),
    );
  }
  const min = projectHomePlacement({
    x: HOME_FURNITURE_POSITION_MIN,
    y: HOME_FURNITURE_POSITION_MIN,
  });
  const max = projectHomePlacement({
    x: HOME_FURNITURE_POSITION_MAX,
    y: HOME_FURNITURE_POSITION_MAX,
  });
  let polygon: HomePoint[] = [
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y },
  ];
  const orientation = homePolygonOrientation(region);
  for (const [index, point] of region.entries()) {
    const next = region[(index + 1) % region.length] ?? point;
    const a = -(next.y - point.y) * orientation;
    const b = (next.x - point.x) * orientation;
    const c =
      a * point.x +
      b * point.y -
      Math.min(...corners.map((corner) => a * corner.x + b * corner.y));
    polygon = clipHomeAnchorPolygon(polygon, a, b, c);
  }
  // Tall furniture may cover the rear wall, but its visible sides cannot enter side curtains.
  const visible = geometry.visibleBounds;
  const offsetX = visible.x - anchor.x;
  const offsetY = visible.y - anchor.y;
  const left = Math.max(0, Math.min(...region.map(({ x }) => x)));
  const right = Math.min(100, Math.max(...region.map(({ x }) => x)));
  polygon = clipHomeAnchorPolygon(polygon, 1, 0, left - offsetX);
  polygon = clipHomeAnchorPolygon(polygon, -1, 0, -(right - offsetX - visible.width));
  polygon = clipHomeAnchorPolygon(polygon, 0, 1, -offsetY);
  return clipHomeAnchorPolygon(polygon, 0, -1, -(100 - offsetY - visible.height));
};

const clipHomeAnchorPolygon = (
  polygon: HomePoint[],
  a: number,
  b: number,
  c: number,
) => {
  const clipped: HomePoint[] = [];
  for (const [index, point] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length] ?? point;
    const distance = a * point.x + b * point.y - c;
    const nextDistance = a * next.x + b * next.y - c;
    const isInside = distance >= -HOME_GEOMETRY_EPSILON;
    const isNextInside = nextDistance >= -HOME_GEOMETRY_EPSILON;
    if (isInside) clipped.push(point);
    if (isInside !== isNextInside) {
      const amount = distance / (distance - nextDistance);
      clipped.push({
        x: point.x + (next.x - point.x) * amount,
        y: point.y + (next.y - point.y) * amount,
      });
    }
  }
  return clipped;
};

/** Use the placement polygon for room targeting as well as furniture boundary checks. */
export const isPointInHomePolygon = (
  point: HomePoint,
  polygon: readonly HomePoint[],
) => {
  if (polygon.length < 3) return false;
  const orientation = homePolygonOrientation(polygon);
  return polygon.every((edge, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? edge;
    return (
      ((next.x - edge.x) * (point.y - edge.y) -
        (next.y - edge.y) * (point.x - edge.x)) *
        orientation >=
      -HOME_GEOMETRY_EPSILON
    );
  });
};

const homePolygonOrientation = (polygon: readonly HomePoint[]) =>
  polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point;
    return area + point.x * next.y - next.x * point.y;
  }, 0) >= 0
    ? 1
    : -1;

const closestPointInHomePolygon = (point: HomePoint, polygon: readonly HomePoint[]) => {
  if (isPointInHomePolygon(point, polygon)) return point;
  return polygon
    .map((edge, index) =>
      closestPointOnHomeSegment(
        point,
        edge,
        polygon[(index + 1) % polygon.length] ?? edge,
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

const getHomeBoundsCorners = (bounds: FurnitureImageBounds): HomePoint[] => [
  { x: bounds.x, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  { x: bounds.x, y: bounds.y + bounds.height },
];

const doHomeBoundsOverlap = (a: FurnitureImageBounds, b: FurnitureImageBounds) =>
  a.x + a.width > b.x + HOME_GEOMETRY_EPSILON &&
  b.x + b.width > a.x + HOME_GEOMETRY_EPSILON &&
  a.y + a.height > b.y + HOME_GEOMETRY_EPSILON &&
  b.y + b.height > a.y + HOME_GEOMETRY_EPSILON;

const HOME_GEOMETRY_EPSILON = 0.000001;
type HomePoint = { x: number; y: number };
