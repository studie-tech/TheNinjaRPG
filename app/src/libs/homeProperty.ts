import {
  HOME_FURNITURE_MAX_PLACEMENTS,
  HOME_ROOM_IDS,
  type HomeType,
} from "@/drizzle/constants";
import {
  HOME_ART_PLANS,
  HOME_FLOOR_PROJECTION,
  type HomePoint,
  homeArtRectPolygon,
} from "@/libs/homeRoomGeometry";
import { clamp } from "@/utils/math";
import type { HomePlacement, HomeRoomStyle } from "@/validators/home";

/** Stable identities tie saved placements and finishes to rooms across home tier changes. */
export type HomeRoomId = (typeof HOME_ROOM_IDS)[number];
/** Room-local coordinates map to measured floor areas in one complete painting. */
export type HomeRoom = {
  id: HomeRoomId;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isYard: boolean;
  /** Complete measured floor contours in the unchanged saved-coordinate frame. */
  interior: HomePoint[][];
  /** Yard-only cultivation contour, separate from the decorative furniture floor. */
  outdoor: HomePoint[];
};
/** Translation is measured in viewport percentages and applied after scaling the property. */
export type HomeCamera = { x: number; y: number; scale: number };

/** Closest zoom on a home painting. */
export const HOME_CAMERA_MAX_SCALE = 1.8;

/** Fit the complete painting, including the usable gardens, into the viewport. */
export const getHomeOverviewCamera = (homeType: HomeType): HomeCamera => ({
  x: 0,
  y: 0,
  scale: 100 / HOME_ART_PLANS[homeType].size,
});

/** A rectangular painting bounds navigation without snapping between unrelated room centers. */
export const boundHomeCamera = (camera: HomeCamera, homeType: HomeType): HomeCamera => {
  const scale = clamp(
    camera.scale,
    getHomeOverviewCamera(homeType).scale,
    HOME_CAMERA_MAX_SCALE,
  );
  const extent = HOME_ART_PLANS[homeType].size * scale;
  return {
    scale,
    x: clamp(camera.x, 100 - extent, 0),
    y: clamp(camera.y, 100 - extent, 0),
  };
};

/** Frame the selected floor with room headroom without leaving the painted property. */
export const getHomeRoomCamera = (homeType: HomeType, id: HomeRoomId): HomeCamera => {
  const room = getHomeRoom(homeType, id);
  if (!room) return getHomeOverviewCamera(homeType);
  const points = [
    ...room.interior.flat(),
    ...room.outdoor,
    // Preserve the saved frame's wall headroom above every measured indoor floor.
    ...(room.isYard
      ? []
      : homeArtRectPolygon([
          0,
          Math.min(
            0,
            ...room.interior.flat().map(({ y }) => y - HOME_FLOOR_PROJECTION.y),
          ),
          100,
          100,
        ])),
  ];
  const left = room.x + (Math.min(...points.map(({ x }) => x)) * room.width) / 100;
  const top = room.y + (Math.min(...points.map(({ y }) => y)) * room.height) / 100;
  const right = room.x + (Math.max(...points.map(({ x }) => x)) * room.width) / 100;
  const bottom = room.y + (Math.max(...points.map(({ y }) => y)) * room.height) / 100;
  // Reserve viewport margin around the focused room and its furniture controls.
  const scale = Math.min(
    HOME_CAMERA_MAX_SCALE,
    85 / Math.max(right - left, bottom - top),
  );
  return boundHomeCamera(
    {
      scale,
      x: 50 - ((left + right) / 2) * scale,
      y: 50 - ((top + bottom) / 2) * scale,
    },
    homeType,
  );
};

/** Keep the world point under the wheel pointer or pinch midpoint anchored while zooming. */
export const zoomHomeCamera = (
  camera: HomeCamera,
  scale: number,
  before: { x: number; y: number },
  after = before,
): HomeCamera => ({
  scale,
  x: after.x - ((before.x - camera.x) * scale) / camera.scale,
  y: after.y - ((before.y - camera.y) * scale) / camera.scale,
});

/**
 * Zoom within the camera's limits. The scale is clamped before anchoring, because bounding
 * the result afterwards would move the world point the zoom keeps in place.
 */
export const zoomHomeCameraTo = (
  camera: HomeCamera,
  scale: number,
  homeType: HomeType,
  before: { x: number; y: number },
  after = before,
) =>
  boundHomeCamera(
    zoomHomeCamera(
      camera,
      clamp(scale, getHomeOverviewCamera(homeType).scale, HOME_CAMERA_MAX_SCALE),
      before,
      after,
    ),
    homeType,
  );

/** The CSS transform that places the property under a camera. */
export const homeCameraTransform = (camera: HomeCamera) =>
  `translate(${camera.x}%, ${camera.y}%) scale(${camera.scale})`;

/**
 * Follow one pointer of a camera gesture: a lone pointer pans, and a second pointer
 * pinches around the midpoint of both. Coordinates are client pixels inside `rect`.
 */
export const moveHomeCamera = (
  camera: HomeCamera,
  homeType: HomeType,
  rect: { left: number; top: number; width: number; height: number },
  previous: { x: number; y: number },
  next: { x: number; y: number },
  other?: { x: number; y: number },
) => {
  const before = other ? Math.hypot(previous.x - other.x, previous.y - other.y) : 0;
  if (other && before > 0) {
    const after = Math.hypot(next.x - other.x, next.y - other.y);
    const toView = (point: { x: number; y: number }) => ({
      x: (((point.x + other.x) / 2 - rect.left) / rect.width) * 100,
      y: (((point.y + other.y) / 2 - rect.top) / rect.height) * 100,
    });
    return zoomHomeCameraTo(
      camera,
      (camera.scale * after) / before,
      homeType,
      toView(previous),
      toView(next),
    );
  }
  return boundHomeCamera(
    {
      ...camera,
      x: camera.x + ((next.x - previous.x) / rect.width) * 100,
      y: camera.y + ((next.y - previous.y) / rect.height) * 100,
    },
    homeType,
  );
};

/** One room of a home, or undefined when the home lacks it. */
export const getHomeRoom = (homeType: HomeType, id: HomeRoomId) =>
  getHomeRooms(homeType).find((room) => room.id === id);

/**
 * Keep saved room frames and physical scale while mapping all measured contours into them.
 *
 * Each room frame, and the shared yard frame, is derived from its measured floor rectangle
 * (painting percentages scaled by `unit`): the floor spans 78% of the frame's width and 54%
 * of its height, offset 12% of the frame width from its left edge and 26% of the frame
 * height from its top. Contours are then expressed as percentages of that frame. These
 * ratios are separate from HOME_FLOOR_PROJECTION.
 */
export const getHomeRooms = (homeType: HomeType): HomeRoom[] => {
  const plan = HOME_ART_PLANS[homeType];
  const unit = plan.size / 100;
  const rooms: HomeRoom[] = plan.floors.map(([left, top, right, bottom], index) => {
    const width = ((right - left) * unit) / 0.78;
    const height = ((bottom - top) * unit) / 0.54;
    return {
      id: HOME_ROOM_IDS[index] ?? "main",
      name: index === 0 ? "Main room" : `Room ${index + 1}`,
      x: left * unit - width * 0.12,
      y: top * unit - height * 0.26,
      width,
      height,
      isYard: false,
      interior: (plan.floorSurfaces[index] ?? []).map((polygon) =>
        polygon.map(([x, y]) => ({
          x: ((x * unit - (left * unit - width * 0.12)) * 100) / width,
          y: ((y * unit - (top * unit - height * 0.26)) * 100) / height,
        })),
      ),
      outdoor: [],
    };
  });
  // Both yard regions share a canvas so decorative furniture cannot occupy the cultivation clearing.
  const left = Math.min(plan.lawn[0], plan.garden[0]);
  const top = Math.min(plan.lawn[1], plan.garden[1]);
  const right = Math.max(plan.lawn[2], plan.garden[2]);
  const bottom = Math.max(plan.lawn[3], plan.garden[3]);
  const width = ((right - left) * unit) / 0.78;
  const height = ((bottom - top) * unit) / 0.54;
  const x = left * unit - width * 0.12;
  const y = top * unit - height * 0.26;
  const local = (point: HomePoint) => ({
    x: ((point.x * unit - x) * 100) / width,
    y: ((point.y * unit - y) * 100) / height,
  });
  rooms.push({
    id: "yard",
    name: "Garden",
    x,
    y,
    width,
    height,
    isYard: true,
    interior: [homeArtRectPolygon(plan.lawn).map(local)],
    outdoor: homeArtRectPolygon(plan.garden).map(local),
  });
  return rooms;
};

/** Placements without an explicit room retain the original main-room coordinates. */
export const getHomePlacementRoom = (
  placement: Pick<HomePlacement, "room">,
): HomeRoomId => placement.room ?? "main";

/** Check tier-specific room membership and per-room capacity before geometry validation. */
export const homeRoomLayoutError = (
  placements: HomePlacement[],
  homeType: HomeType,
) => {
  const rooms = getHomeRooms(homeType);
  for (const placement of placements) {
    if (!rooms.some(({ id }) => id === getHomePlacementRoom(placement)))
      return "This room is no longer part of your home. Refresh and try again";
  }
  for (const room of rooms) {
    if (
      placements.filter((placement) => getHomePlacementRoom(placement) === room.id)
        .length > HOME_FURNITURE_MAX_PLACEMENTS
    )
      return `${room.name} can display up to ${HOME_FURNITURE_MAX_PLACEMENTS} pieces`;
  }
  return null;
};

/** Finishes may be sparse, but each available room can appear at most once. */
export const homeRoomStylesError = (styles: HomeRoomStyle[], homeType: HomeType) => {
  const rooms = getHomeRooms(homeType);
  return new Set(styles.map(({ room }) => room)).size !== styles.length ||
    styles.some(({ room }) => !rooms.some(({ id }) => id === room))
    ? "Choose finishes once for each available room"
    : null;
};
