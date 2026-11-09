import { describe, expect, it } from "bun:test";
import { HomeTypes } from "@/drizzle/constants";
import { clampHomeFurniturePlacement, fitHomeFurniturePlacement, getHomeFurnitureGeometry, homeLayoutPlacementError, unprojectHomePlacement, type HomeFurniture } from "@/libs/home";
import { getHomeFloorAnchors, isPointInHomeFloor, isPointInHomePolygon } from "@/libs/homeFloorGeometry";
import { getHomeRooms } from "@/libs/homeProperty";
import { HOME_ART_PLANS, homeArtRectPolygon } from "@/libs/homeRoomGeometry";

const bounds = { x: -100, y: -100, width: 300, height: 300 };
const footprint = { x: -1, y: -1, width: 2, height: 2 };
const piece: HomeFurniture = { id: "chair", itemId: "chair", name: "Chair", image: "/chair.webp", width: 6, groundAnchor: 100, action: null, isFloor: false, quantity: 1, views: { "90": { image: "/90.webp", width: 7 }, "180": { image: "/180.webp", width: 8 }, "270": { image: "/270.webp", width: 9 } } };

describe("measured floor placement", () => {
  it("preserves concave wings while rejecting a notch even when every footprint corner is on floor", () => {
    const floor = [[0, 0], [10, 0], [10, 10], [6, 10], [6, 4], [4, 4], [4, 10], [0, 10]].map(([x, y]) => ({ x: x!, y: y! }));
    const anchors = getHomeFloorAnchors([floor], { x: -1.5, y: -1, width: 3, height: 2 }, bounds);
    expect(isPointInHomeFloor({ x: 2, y: 7 }, anchors)).toBe(true);
    expect(isPointInHomeFloor({ x: 8, y: 7 }, anchors)).toBe(true);
    for (const x of [3.5, 6.5]) for (const y of [5, 7]) expect(isPointInHomePolygon({ x, y }, floor)).toBe(true);
    expect(isPointInHomeFloor({ x: 5, y: 6 }, anchors)).toBe(false);
  });

  it("allows a footprint across a finish seam and keeps disconnected components and holes", () => {
    const joined = getHomeFloorAnchors([homeArtRectPolygon([0, 0, 10, 5]), homeArtRectPolygon([0, 5, 10, 10])], footprint, bounds);
    expect(isPointInHomeFloor({ x: 5, y: 5 }, joined)).toBe(true);
    const separated = getHomeFloorAnchors([homeArtRectPolygon([0, 0, 10, 10]), homeArtRectPolygon([20, 0, 30, 10])], footprint, bounds);
    expect(isPointInHomeFloor({ x: 25, y: 5 }, separated)).toBe(true);
    expect(isPointInHomeFloor({ x: 15, y: 5 }, separated)).toBe(false);
    const ring = getHomeFloorAnchors([[0, 0, 10, 3], [0, 7, 10, 10], [0, 3, 3, 7], [7, 3, 10, 7]].map((rect) => homeArtRectPolygon(rect as [number, number, number, number])), footprint, bounds);
    expect(isPointInHomeFloor({ x: 5, y: 1 }, ring)).toBe(true);
    expect(isPointInHomeFloor({ x: 5, y: 5 }, ring)).toBe(false);
  });

  it.each([
    { room: "room-3", x: 36, y: 37 },
    { room: "room-5", x: 63, y: 57 },
    { room: "room-5", x: 60, y: 51 },
  ] as const)("accepts measured Mansion floor at $x,$y in every facing", ({ room: roomId, x, y }) => {
    const room = getHomeRooms("MANSION").find(({ id }) => id === roomId)!;
    const local = { x: (x * 3.7 - room.x) * 100 / room.width, y: (y * 3.7 - room.y) * 100 / room.height };
    for (const rotation of [0, 1, 2, 3] as const) {
      const placement = { id: piece.id, room: roomId, ...unprojectHomePlacement(local), rotation };
      expect(homeLayoutPlacementError([placement], [piece], "MANSION")).toBeNull();
      expect(clampHomeFurniturePlacement(placement, piece, "MANSION")).toEqual(placement);
      expect(getHomeFurnitureGeometry(piece, placement, "MANSION").image.width * room.width / 100).toBe([6, 7, 8, 9][rotation]!);
    }
  });

  it("finds free ground beside another piece in the complex Palace corridor", () => {
    const first = clampHomeFurniturePlacement({ id: piece.id, room: "room-6", x: 50, y: 50, rotation: 0 }, piece, "PALACE")!;
    const second = { ...piece, id: "second-chair" };
    const fitted = fitHomeFurniturePlacement({ ...first, id: second.id }, second, [first], [piece, second], "PALACE");
    expect(fitted).not.toBeNull();
    expect(homeLayoutPlacementError([first, fitted!], [piece, second], "PALACE")).toBeNull();
  });

  it.each([...HomeTypes])("keeps all %s footprints on measured ground after clamping in every facing", (homeType) => {
    for (const room of getHomeRooms(homeType).filter(({ isYard }) => !isYard)) {
      for (const rotation of [0, 1, 2, 3] as const) {
        const placement = clampHomeFurniturePlacement({ id: piece.id, room: room.id, x: -200, y: 200, rotation }, piece, homeType);
        if (!placement) continue;
        expect(homeLayoutPlacementError([placement], [piece], homeType)).toBeNull();
        const footprint = getHomeFurnitureGeometry(piece, placement, homeType).footprint;
        for (const dx of [0, 0.5, 1]) for (const dy of [0, 0.5, 1]) {
          const point = { x: footprint.x + footprint.width * dx, y: footprint.y + footprint.height * dy };
          expect(room.interior.some((polygon) => isPointInHomePolygon(point, polygon))).toBe(true);
        }
      }
    }
    expect(HOME_ART_PLANS[homeType].floorSurfaces.length).toBe(getHomeRooms(homeType).length - 1);
  });
});
