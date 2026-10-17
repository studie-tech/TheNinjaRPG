import { describe, expect, it } from "bun:test";
import { ShapeUtils, Vector2 } from "three";
import { HOME_FURNITURE_MAX_PLACEMENTS, HomeTypes } from "@/drizzle/constants";
import { clampHomeFurniturePlacement, getHomeFurnitureGeometry, homeLayoutPlacementError, isPointInHomePolygon, recoverHomeLayout, type HomeFurniture } from "@/libs/home";
import { boundHomeCamera, getHomeOverviewCamera, getHomeRoomCamera, getHomeRooms, homeRoomLayoutError, zoomHomeCamera } from "@/libs/homeProperty";
import { HOME_ART_PLANS } from "@/libs/homeRoomGeometry";
import { homeFurnitureSaveInputSchema } from "@/validators/home";

const piece: HomeFurniture = { id: "chair", itemId: "chair", name: "Chair", image: "/chair.webp", width: 10, groundAnchor: 95, action: null, isFloor: false, quantity: 1, views: {} };
const placement = { id: piece.id, x: 50, y: 50, rotation: 0 as const };

describe("painted home properties", () => {
  it("retains each tier's room capacity and separates decoration from cultivation", () => {
    for (const [tier, homeType] of HomeTypes.entries()) {
      const rooms = getHomeRooms(homeType);
      expect(rooms.filter(({isYard}) => !isYard)).toHaveLength([1, 2, 3, 4, 5, 8, 9, 10][tier]!);
      const yard = rooms.find(({isYard})=>isYard)!;
      expect(yard.interior).toHaveLength(4);
      expect(yard.outdoor).toHaveLength(4);
      expect(new Set(rooms.map(({id})=>id)).size).toBe(rooms.length);
      for (const [index, room] of rooms.filter(({isYard})=>!isYard).entries()) {
        const bounds = HOME_ART_PLANS[homeType].floors[index]!;
        const world = room.interior.map(({x,y}) => ({x:room.x+x*room.width/100,y:room.y+y*room.height/100}));
        expect(world[0]!.x).toBeCloseTo(bounds[0]*HOME_ART_PLANS[homeType].size/100);
        expect(world[2]!.y).toBeCloseTo(bounds[3]*HOME_ART_PLANS[homeType].size/100);
      }
      const farm = {...piece, action: "farm" as const};
      const fitted = clampHomeFurniturePlacement({...placement, room:"yard"},farm,homeType);
      expect(fitted).not.toBeNull();
      expect(homeLayoutPlacementError([fitted!],[farm],homeType)).toBeNull();
      expect(homeLayoutPlacementError([{...placement}],[farm],homeType)).toContain("garden");
    }
  });

  it.each([
    { homeType: "NONE", room: 0, wall: [461, 300], floor: [484, 300] },
    { homeType: "NONE", room: 0, wall: [982, 360], floor: [970, 360] },
    { homeType: "STUDIO_APARTMENT", room: 0, wall: [285, 480], floor: [300, 480] },
    { homeType: "STUDIO_APARTMENT", room: 1, wall: [1197, 480], floor: [1180, 480] },
    { homeType: "ONE_BED_APARTMENT", room: 0, wall: [278, 220], floor: [285, 220] },
    { homeType: "ONE_BED_APARTMENT", room: 1, wall: [1186, 180], floor: [1175, 180] },
    { homeType: "TWO_BED_HOUSE", room: 0, wall: [254, 480], floor: [280, 480] },
    { homeType: "TWO_BED_HOUSE", room: 1, wall: [500, 377], floor: [500, 362] },
    { homeType: "TWO_BED_HOUSE", room: 2, wall: [997, 350], floor: [950, 355] },
    { homeType: "TWO_BED_HOUSE", room: 0, wall: [700, 625], floor: [700, 610] },
    { homeType: "TOWN_HOUSE", room: 2, wall: [225, 525], floor: [255, 525] },
    { homeType: "TOWN_HOUSE", room: 1, wall: [514, 310], floor: [507, 310] },
    { homeType: "TOWN_HOUSE", room: 4, wall: [1230, 550], floor: [1200, 550] },
    { homeType: "MANSION", room: 1, wall: [15, 40], floor: [20, 40], normalized: true },
    { homeType: "MANSION", room: 3, wall: [40, 42], floor: [45, 40], normalized: true },
    { homeType: "MANSION", room: 7, wall: [71, 55], floor: [77, 55], normalized: true },
    { homeType: "PALACE", room: 2, wall: [36, 35], floor: [30, 35], normalized: true },
    { homeType: "PALACE", room: 8, wall: [74, 48], floor: [65, 48], normalized: true },
    { homeType: "MARSHMALLOWOPOLIS", room: 0, wall: [42, 33], floor: [50, 33], normalized: true },
    { homeType: "MARSHMALLOWOPOLIS", room: 9, wall: [61, 45], floor: [58, 45], normalized: true },
  ] as const)("keeps $homeType room $room finishes off measured walls and fixtures", (sample) => {
    const { homeType, room, wall, floor } = sample;
    const normalized = "normalized" in sample;
    // Finish contours can be concave; triangulate them before using the convex placement helper.
    const triangles = HOME_ART_PLANS[homeType].floorSurfaces[room]!.flatMap((polygon) => {
      const contour = polygon.map(([x, y]) => new Vector2(x * (normalized ? 1 : 1448 / 100), y * (normalized ? 1 : 1086 / 100)));
      return ShapeUtils.triangulateShape(contour, []).map((indices) => indices.map((index) => contour[index]!));
    });
    for (const [point, expected] of [[wall, false], [floor, true]] as const) {
      expect(triangles.some((triangle) => isPointInHomePolygon({ x: point[0], y: point[1] }, triangle))).toBe(expected);
    }
  });

  it.each([
    { homeType: "MANSION", point: { x: 44.75, y: 32.25 } },
    { homeType: "MANSION", point: { x: 75, y: 66 } },
    { homeType: "PALACE", point: { x: 44.5, y: 25.25 } },
    { homeType: "PALACE", point: { x: 14.75, y: 35.25 } },
    { homeType: "MARSHMALLOWOPOLIS", point: { x: 26, y: 28.75 } },
  ] as const)("keeps $homeType window and timber landmarks out of wall paint", ({ homeType, point }) => {
    const masks = HOME_ART_PLANS[homeType].paint.flat();
    expect(masks.some((polygon) => isPointInHomePolygon(point, polygon.map(([x, y]) => ({ x, y }))))).toBe(false);
  });

  it("preserves furniture proportions across differently sized authored rooms", () => {
    for (const homeType of HomeTypes) {
      for (const room of getHomeRooms(homeType)) {
        const image = getHomeFurnitureGeometry(piece,{...placement,room:room.id},homeType).image;
        expect(image.width * room.width / 100).toBeCloseTo(piece.width);
        expect(image.height * room.height / 100).toBeCloseTo(piece.width * (HOME_ART_PLANS[homeType].aspectRatio ?? 4 / 3) / (4 / 3));
      }
    }
  });

  it("checks collisions within rooms and recovers removed floors into storage", () => {
    const other = { ...piece, id: "other" };
    const layout = [placement, { ...placement, id: other.id, room: "room-1" as const }];
    expect(homeLayoutPlacementError(layout, [piece, other], "TOWN_HOUSE")).toBeNull();
    expect(homeLayoutPlacementError(layout.map((p) => ({ ...p, room: "main" })), [piece, other], "TOWN_HOUSE")).toContain("overlaps");
    expect(recoverHomeLayout(layout, [piece, other], "NONE")).toEqual([placement]);
  });

  it("allows the furniture limit per room and rejects unknown rooms", () => {
    const main = Array.from({ length: HOME_FURNITURE_MAX_PLACEMENTS }, (_, i) => ({ ...placement, id: `main-${i}` }));
    const other = main.map((p) => ({ ...p, id: `other-${p.id}`, room: "room-1" as const }));
    expect(homeFurnitureSaveInputSchema.safeParse({ homeType: "TOWN_HOUSE", revision: 0, placements: [...main, ...other] }).success).toBe(true);
    expect(homeRoomLayoutError([...main, ...other], "TOWN_HOUSE")).toBeNull();
    expect(homeRoomLayoutError([...main, placement], "TOWN_HOUSE")).toContain("up to");
    expect(homeRoomLayoutError(other, "NONE")).toContain("no longer");
  });

  it("fits the complete painting and bounds pan/zoom to its edges", () => {
    for (const homeType of HomeTypes) {
      const size = HOME_ART_PLANS[homeType].size;
      const overview = getHomeOverviewCamera(homeType);
      expect(size*overview.scale).toBeCloseTo(100);
      expect(boundHomeCamera(overview,homeType)).toEqual(overview);
      for (const scale of [0, .3, 1, 10]) {
        const camera = boundHomeCamera({x:9999,y:-9999,scale},homeType);
        expect(camera.scale).toBeGreaterThanOrEqual(overview.scale);
        expect(camera.scale).toBeLessThanOrEqual(1.8);
        expect(camera.x).toBe(0);
        expect(camera.y).toBeCloseTo(100-size*camera.scale);
      }
      for (const room of getHomeRooms(homeType)) {
        const camera = getHomeRoomCamera(homeType,room.id);
        expect(boundHomeCamera(camera,homeType)).toEqual(camera);
        const centerX = camera.x+(room.x+room.width/2)*camera.scale;
        const centerY = camera.y+(room.y+room.height/2)*camera.scale;
        expect(centerX).toBeGreaterThan(0);
        expect(centerX).toBeLessThan(100);
        expect(centerY).toBeGreaterThan(0);
        expect(centerY).toBeLessThan(100);
      }
    }
  });

  it("anchors wheel and pinch zoom to their focal point and follows midpoint translation", () => {
    const camera = { x: -40, y: -50, scale: 0.8 };
    const before = { x: 40, y: 60 };
    for (const after of [before,{x:46,y:57}]) {
      const next = zoomHomeCamera(camera,1.2,before,after);
      expect((after.x-next.x)/next.scale).toBeCloseTo((before.x-camera.x)/camera.scale);
      expect((after.y-next.y)/next.scale).toBeCloseTo((before.y-camera.y)/camera.scale);
    }
  });
});
