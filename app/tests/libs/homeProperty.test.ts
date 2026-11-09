import { describe, expect, it } from "bun:test";
import { HOME_FURNITURE_MAX_PLACEMENTS, HomeTypes } from "@/drizzle/constants";
import {
  clampHomeFurniturePlacement,
  getHomeFurnitureGeometry,
  homeLayoutPlacementError,
  recoverHomeLayout,
  type HomeFurniture,
} from "@/libs/home";
import {
  boundHomeCamera,
  getHomeOverviewCamera,
  getHomeRoomCamera,
  getHomeRooms,
  HOME_CAMERA_MAX_SCALE,
  homeRoomLayoutError,
  zoomHomeCamera,
  zoomHomeCameraTo,
} from "@/libs/homeProperty";
import { HOME_ART_PLANS } from "@/libs/homeRoomGeometry";
import { homeFurnitureSaveInputSchema } from "@/validators/home";

const piece: HomeFurniture = {
  id: "chair",
  itemId: "chair",
  name: "Chair",
  image: "/chair.webp",
  width: 10,
  groundAnchor: 95,
  action: null,
  isFloor: false,
  quantity: 1,
  views: {},
};
const placement = { id: piece.id, x: 50, y: 50, rotation: 0 as const };

describe("painted home properties", () => {
  it("retains each tier's room capacity and separates decoration from cultivation", () => {
    for (const [tier, homeType] of HomeTypes.entries()) {
      const rooms = getHomeRooms(homeType);
      expect(rooms.filter(({ isYard }) => !isYard)).toHaveLength(
        [1, 2, 3, 4, 5, 8, 9, 10][tier]!,
      );
      const yard = rooms.find(({ isYard }) => isYard)!;
      expect(yard.interior[0]).toHaveLength(4);
      expect(yard.outdoor).toHaveLength(4);
      expect(new Set(rooms.map(({ id }) => id)).size).toBe(rooms.length);
      for (const [index, room] of rooms.filter(({ isYard }) => !isYard).entries()) {
        const world = room.interior.map((polygon) =>
          polygon.map(({ x, y }) => [
            ((room.x + (x * room.width) / 100) * 100) / HOME_ART_PLANS[homeType].size,
            ((room.y + (y * room.height) / 100) * 100) / HOME_ART_PLANS[homeType].size,
          ]),
        );
        for (const [surface, polygon] of HOME_ART_PLANS[homeType].floorSurfaces[
          index
        ]!.map((surface, i) => [surface, world[i]!] as const)) {
          for (const [i, point] of surface.entries()) {
            expect(polygon[i]![0]).toBeCloseTo(point[0]);
            expect(polygon[i]![1]).toBeCloseTo(point[1]);
          }
        }
      }
      const farm = { ...piece, action: "farm" as const };
      const fitted = clampHomeFurniturePlacement(
        { ...placement, room: "yard" },
        farm,
        homeType,
      );
      expect(fitted).not.toBeNull();
      expect(homeLayoutPlacementError([fitted!], [farm], homeType)).toBeNull();
      expect(homeLayoutPlacementError([{ ...placement }], [farm], homeType)).toContain(
        "garden",
      );
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
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 0,
      wall: [42, 33],
      floor: [50, 33],
      normalized: true,
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 9,
      wall: [61, 45],
      floor: [58, 45],
      normalized: true,
    },
  ] as const)(
    "keeps $homeType room $room finishes off measured walls and fixtures",
    (sample) => {
      const { homeType, room, wall, floor } = sample;
      const normalized = "normalized" in sample;
      for (const [point, expected] of [
        [wall, false],
        [floor, true],
      ] as const) {
        const x = normalized ? point[0] : (point[0] * 100) / 1448;
        const y = normalized ? point[1] : (point[1] * 100) / 1086;
        expect(
          HOME_ART_PLANS[homeType].floorSurfaces[room]!.some((polygon) =>
            containsArtPoint(polygon, x, y),
          ),
        ).toBe(expected);
      }
    },
  );

  it.each([
    {
      room: 1,
      floor: [
        [253, 245],
        [267, 245],
        [270, 251],
      ],
      architecture: [
        [253, 235],
        [268, 237],
        [241, 245],
        [280, 230],
      ],
    },
    {
      room: 2,
      floor: [
        [248, 489],
        [259, 489],
        [264, 485],
      ],
      architecture: [
        [243, 480],
        [253, 482],
        [238, 490],
        [275, 476],
      ],
    },
    {
      room: 3,
      floor: [
        [1173, 245],
        [1188, 245],
        [1192, 250],
      ],
      architecture: [
        [1175, 236],
        [1193, 237],
        [1200, 245],
        [1159, 230],
      ],
    },
    {
      room: 4,
      floor: [
        [1194, 490],
        [1200, 490],
        [1200, 494],
      ],
      architecture: [
        [1196, 480],
        [1205, 482],
        [1210, 490],
        [1185, 477],
      ],
    },
  ] as const)(
    "finishes Town House room $room floors around the corner lamp plinth feet",
    ({ room, floor, architecture }) => {
      const plan = HOME_ART_PLANS.TOWN_HOUSE;
      for (const [landmarks, expected] of [
        [floor, true],
        [architecture, false],
      ] as const) {
        const surfaces = expected
          ? plan.floorSurfaces[room]!
          : plan.floorSurfaces.flat();
        for (const [x, y] of landmarks) {
          expect(
            surfaces.some((polygon) =>
              containsArtPoint(polygon, (x * 100) / 1448, (y * 100) / 1086),
            ),
          ).toBe(expected);
        }
      }
    },
  );

  it("finishes Mansion Room 2 to its wall joins without foreground restoring the floor", () => {
    const plan = HOME_ART_PLANS.MANSION;
    // Source-art landmarks beside the back, side and front wall joins, including both sides of the door.
    for (const point of [
      [275, 363],
      [255, 480],
      [446, 380],
      [432, 430],
      [440, 480],
      [400, 495],
    ] as const) {
      expect(containsSourceLandmark(plan.floorSurfaces[1]!, point)).toBe(true);
      expect(
        containsSourceLandmark(
          plan.foreground.map(({ polygon }) => polygon),
          point,
        ),
      ).toBe(false);
    }
    // Preserve the open door leaf, timber frame, baseboard and front wall.
    for (const point of [
      [445, 433],
      [456, 405],
      [455, 480],
      [250, 420],
      [350, 351],
      [350, 506],
    ] as const) {
      expect(containsSourceLandmark(plan.floorSurfaces[1]!, point)).toBe(false);
    }
    expect(
      containsSourceLandmark(
        plan.foreground.map(({ polygon }) => polygon),
        [350, 506],
      ),
    ).toBe(true);
  });

  it.each([
    {
      homeType: "MANSION",
      room: 2,
      floor: [
        [255, 565],
        [350, 562],
        [486, 620],
        [490, 650],
      ],
      architecture: [
        [350, 543],
        [256, 541],
        [480, 575],
        [510, 614],
        [350, 664],
      ],
    },
    {
      homeType: "MANSION",
      room: 4,
      floor: [
        [490, 500],
        [530, 540],
        [530, 580],
        [490, 505],
        [500, 505],
        [525, 505],
        [527, 530],
        [526, 560],
        [525, 585],
        [525, 610],
      ],
      architecture: [
        [490, 550],
        [490, 570],
        [503, 530],
        [508, 520],
        [480, 585],
        [490, 510],
        [500, 510],
        [510, 505],
        [516, 530],
        [520, 515],
        [521, 560],
        [520, 600],
        [518, 620],
      ],
    },
    {
      homeType: "MANSION",
      room: 5,
      floor: [
        [920, 430],
        [950, 450],
        [1000, 440],
        [1005, 410],
        [1007, 430],
        [1008, 440],
        [1010, 450],
        [1010, 460],
        [948, 475],
        [958, 475],
        [962, 477],
        [980, 470],
        [980, 475],
        [1000, 470],
        [1000, 475],
        [1008, 475],
        [1045, 550],
        [1047, 580],
        [1048, 600],
        [1050, 620],
        [986, 625],
        [987, 640],
        [989, 650],
        [1000, 640],
        [1030, 645],
        [1000, 652],
        [1055, 640],
        [1056, 650],
      ],
      architecture: [
        [920, 470],
        [930, 475],
        [912, 490],
        [940, 450],
        [1030, 440],
        [1025, 420],
        [1030, 460],
        [1010, 410],
        [1016, 430],
        [1015, 450],
        [1014, 460],
        [950, 480],
        [960, 480],
        [980, 485],
        [1000, 480],
        [1014, 475],
        [1020, 470],
        [1030, 475],
        [1055, 550],
        [1058, 580],
        [1060, 590],
        [1070, 604],
        [1070, 615],
        [1070, 625],
        [1080, 620],
        [1058, 625],
        [980, 625],
        [983, 640],
        [985, 650],
        [1058, 640],
        [1059, 650],
        [1070, 635],
        [1070, 650],
        [1080, 640],
        [1082, 650],
        [1000, 656],
      ],
    },
    {
      homeType: "MANSION",
      room: 6,
      floor: [
        [1054, 467],
        [1059, 472],
        [1065, 478],
      ],
      architecture: [
        [1047, 467],
        [1046, 477],
        [1059, 485],
        [1030, 472],
      ],
    },
    {
      homeType: "MANSION",
      room: 7,
      floor: [
        [1085, 612],
        [1100, 605],
        [1110, 532],
        [1250, 620],
        [1082, 530],
        [1091, 540],
        [1100, 550],
        [1098, 570],
        [1096, 590],
        [1100, 594],
        [1083, 593],
        [1090, 600],
      ],
      architecture: [
        [1085, 563],
        [1070, 604],
        [1090, 640],
        [1248, 515],
        [1076, 530],
        [1085, 540],
        [1094, 552],
        [1092, 575],
        [1083, 589],
        [1088, 595],
        [1090, 596],
        [1078, 615],
      ],
    },
    {
      homeType: "PALACE",
      room: 0,
      floor: [
        [735, 398],
        [800, 398],
        [710, 390],
        [824, 390],
      ],
      architecture: [
        [710, 398],
        [824, 398],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 0,
      floor: [
        [735, 398],
        [800, 398],
        [710, 390],
        [824, 390],
      ],
      architecture: [
        [710, 398],
        [824, 398],
      ],
    },
    {
      homeType: "PALACE",
      room: 4,
      floor: [
        [580, 550],
        [582, 550],
        [578, 553],
        [580, 556],
      ],
      architecture: [
        [575, 560],
        [590, 500],
        [585, 554],
        [578, 560],
      ],
    },
    {
      homeType: "PALACE",
      room: 8,
      floor: [
        [950, 482],
        [955, 510],
        [959, 536],
        [951, 548],
        [960, 556],
      ],
      architecture: [
        [940, 482],
        [945, 510],
        [945, 536],
        [950, 554],
        [960, 562],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 4,
      floor: [
        [580, 550],
        [582, 550],
        [578, 553],
        [580, 556],
      ],
      architecture: [
        [575, 560],
        [590, 500],
        [585, 554],
        [578, 560],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 8,
      floor: [
        [950, 482],
        [955, 510],
        [959, 536],
        [951, 548],
        [960, 556],
      ],
      architecture: [
        [940, 482],
        [945, 510],
        [945, 536],
        [950, 554],
        [960, 562],
      ],
    },
    {
      homeType: "PALACE",
      room: 5,
      floor: [
        [580, 420],
        [613, 450],
        [615, 474],
        [612, 490],
      ],
      architecture: [
        [580, 450],
        [595, 440],
        [597, 450],
        [597, 474],
        [608, 440],
        [610, 468],
        [605, 490],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 5,
      floor: [
        [580, 420],
        [613, 450],
        [615, 474],
        [612, 490],
      ],
      architecture: [
        [580, 450],
        [595, 440],
        [597, 450],
        [597, 474],
        [608, 440],
        [610, 468],
        [605, 490],
      ],
    },
    {
      homeType: "PALACE",
      room: 6,
      floor: [
        [925, 420],
        [925, 440],
        [923, 450],
        [922, 474],
        [927, 490],
      ],
      architecture: [
        [932, 440],
        [933, 450],
        [932, 474],
        [930, 440],
        [927, 470],
        [932, 490],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 9,
      floor: [
        [925, 420],
        [925, 440],
        [923, 450],
        [922, 474],
        [927, 490],
      ],
      architecture: [
        [932, 440],
        [933, 450],
        [932, 474],
        [930, 440],
        [927, 470],
        [932, 490],
      ],
    },
    {
      homeType: "PALACE",
      room: 3,
      floor: [
        [380, 442],
        [366, 442],
        [364, 448],
      ],
      architecture: [
        [380, 420],
        [361, 442],
        [363, 445],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 3,
      floor: [
        [380, 442],
        [366, 442],
        [364, 448],
      ],
      architecture: [
        [380, 420],
        [361, 442],
        [363, 445],
      ],
    },
    {
      homeType: "PALACE",
      room: 7,
      floor: [
        [1156, 442],
        [1171, 443],
        [1170, 448],
      ],
      architecture: [
        [1156, 420],
        [1173, 443],
        [1175, 446],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 7,
      floor: [
        [1156, 442],
        [1171, 443],
        [1170, 448],
      ],
      architecture: [
        [1156, 420],
        [1173, 443],
        [1175, 446],
      ],
    },
  ] as const)(
    "traces $homeType room $room finishes around source-art doors, lamps and post caps",
    ({ homeType, room, floor, architecture }) => {
      const plan = HOME_ART_PLANS[homeType];
      for (const point of floor) {
        expect(containsSourceLandmark(plan.floorSurfaces[room]!, point)).toBe(true);
        expect(
          containsSourceLandmark(
            plan.foreground.map(({ polygon }) => polygon),
            point,
          ),
        ).toBe(false);
      }
      for (const point of architecture) {
        expect(containsSourceLandmark(plan.floorSurfaces[room]!, point)).toBe(false);
      }
    },
  );

  it.each([
    {
      homeType: "MANSION",
      room: 5,
      points: [
        [920, 520],
        [920, 580],
      ],
    },
    {
      homeType: "MANSION",
      room: 6,
      points: [
        [1045, 380],
        [1200, 478],
      ],
    },
    {
      homeType: "PALACE",
      room: 5,
      points: [
        [580, 330],
        [620, 360],
      ],
    },
    {
      homeType: "PALACE",
      room: 6,
      points: [
        [950, 330],
        [900, 480],
      ],
    },
    {
      homeType: "PALACE",
      room: 3,
      points: [
        [380, 470],
        [380, 520],
      ],
    },
    {
      homeType: "PALACE",
      room: 7,
      points: [
        [1156, 470],
        [1156, 520],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 9,
      points: [
        [950, 330],
        [900, 480],
      ],
    },
  ] as const)(
    "finishes the $homeType room $room corridors and wall joins",
    ({ homeType, room, points }) => {
      const plan = HOME_ART_PLANS[homeType];
      for (const point of points) {
        expect(containsSourceLandmark(plan.floorSurfaces[room]!, point)).toBe(true);
        expect(
          containsSourceLandmark(
            plan.foreground.map(({ polygon }) => polygon),
            point,
          ),
        ).toBe(false);
      }
    },
  );

  it("preserves Mansion's entrance arch and post caps in front of furniture", () => {
    const plan = HOME_ART_PLANS.MANSION;
    const foreground = plan.foreground.map(({ polygon }) => polygon);
    for (const point of [
      [760, 605],
      [665, 585],
      [835, 585],
    ] as const) {
      expect(containsSourceLandmark(plan.floorSurfaces[0]!, point)).toBe(false);
      expect(containsSourceLandmark(foreground, point)).toBe(true);
    }
    for (const point of [
      [760, 575],
      [875, 610],
    ] as const) {
      expect(containsSourceLandmark(plan.floorSurfaces[0]!, point)).toBe(true);
      expect(containsSourceLandmark(foreground, point)).toBe(false);
    }
  });

  it.each(["PALACE", "MARSHMALLOWOPOLIS"] as const)(
    "finishes %s floors to their baseboards and front rails",
    (homeType) => {
      const plan = HOME_ART_PLANS[homeType];
      const foreground = plan.foreground.map(({ polygon }) => polygon);
      for (const { room, points } of [
        { room: 0, points: [[768, 278]] },
        {
          room: 1,
          points: [
            [731, 520],
            [805, 520],
          ],
        },
        {
          room: 2,
          points: [
            [500, 422],
            [380, 420],
          ],
        },
        { room: 3, points: [[230, 390]] },
        {
          room: 4,
          points: [
            [500, 473],
            [500, 563],
          ],
        },
        {
          room: 5,
          points: [
            [620, 414],
            [650, 510],
          ],
        },
        {
          room: 6,
          points: [
            [1030, 422],
            [1156, 420],
          ],
        },
        { room: 7, points: [[1330, 430]] },
        {
          room: 8,
          points: [
            [1020, 473],
            [1020, 563],
          ],
        },
        {
          room: homeType === "PALACE" ? 6 : 9,
          points: [
            [900, 414],
            [880, 510],
          ],
        },
      ] as const) {
        for (const point of points) {
          expect(containsSourceLandmark(plan.floorSurfaces[room]!, point)).toBe(true);
          expect(containsSourceLandmark(foreground, point)).toBe(false);
        }
      }
      for (const { room, point } of [
        { room: 1, point: [768, 520] },
        { room: 2, point: [410, 427] },
        { room: 5, point: [625, 508] },
      ] as const) {
        expect(containsSourceLandmark(plan.floorSurfaces[room]!, point)).toBe(false);
      }
    },
  );

  it.each(["PALACE", "MARSHMALLOWOPOLIS"] as const)(
    "finishes %s hall recesses while preserving their doors, post caps and rails",
    (homeType) => {
      const plan = HOME_ART_PLANS[homeType];
      const foreground = plan.foreground.map(({ polygon }) => polygon);
      for (const { room, floor, architecture } of [
        {
          room: 5,
          floor: [
            [573, 415],
            [572, 418],
            [571, 425],
            [682, 510],
            [650, 514],
            [666, 515],
          ],
          architecture: [
            [568, 418],
            [565, 410],
            [595, 428],
            [640, 514],
            [680, 514],
            [665, 518],
          ],
        },
        {
          room: homeType === "PALACE" ? 6 : 9,
          floor: [
            [940, 412],
            [960, 414],
            [965, 421],
            [952, 427],
            [964, 428],
            [852, 510],
            [869, 514],
            [888, 515],
          ],
          architecture: [
            [968, 420],
            [975, 410],
            [937, 427],
            [950, 433],
            [851, 514],
            [895, 514],
            [875, 518],
          ],
        },
      ] as const) {
        for (const point of floor) {
          expect(containsSourceLandmark(plan.floorSurfaces[room]!, point)).toBe(true);
          expect(containsSourceLandmark(foreground, point)).toBe(false);
        }
        for (const point of architecture) {
          expect(containsSourceLandmark(plan.floorSurfaces[room]!, point)).toBe(false);
        }
      }
      for (const point of [
        [665, 518],
        [875, 518],
      ] as const) {
        expect(containsSourceLandmark(foreground, point)).toBe(true);
      }
      // The floor beyond each door remains assigned to its neighboring room.
      for (const [point, room] of [
        [[545, 420], 2],
        [[990, 420], 6],
      ] as const) {
        expect(
          plan.floorSurfaces.flatMap((surfaces, index) =>
            containsSourceLandmark(surfaces, point) ? [index] : [],
          ),
        ).toEqual([room]);
      }
    },
  );

  it("keeps neighboring Mansion floors separate beside the open door", () => {
    const point = [481, 595] as const;
    const covered = HOME_ART_PLANS.MANSION.floorSurfaces.flatMap((surfaces, room) =>
      containsSourceLandmark(surfaces, point) ? [room] : [],
    );
    expect(covered).toEqual([2]);
  });

  it.each([
    { homeType: "MANSION", point: { x: 44.75, y: 32.25 } },
    { homeType: "MANSION", point: { x: 75, y: 66 } },
    { homeType: "PALACE", point: { x: 44.5, y: 25.25 } },
    { homeType: "PALACE", point: { x: 14.75, y: 35.25 } },
    { homeType: "MARSHMALLOWOPOLIS", point: { x: 26, y: 28.75 } },
  ] as const)(
    "keeps $homeType window and timber landmarks out of wall paint",
    ({ homeType, point }) => {
      const masks = HOME_ART_PLANS[homeType].paint.flat();
      expect(masks.some((polygon) => containsArtPoint(polygon, point.x, point.y))).toBe(
        false,
      );
    },
  );

  it.each([
    {
      homeType: "NONE",
      room: 0,
      walls: [
        [500, 110],
        [445, 260],
        [500, 535],
      ],
      fixtures: [
        [580, 123],
        [480, 140],
        [995, 355],
      ],
    },
    {
      homeType: "STUDIO_APARTMENT",
      room: 0,
      walls: [
        [350, 150],
        [275, 250],
        [400, 580],
      ],
      fixtures: [
        [575, 155],
        [310, 160],
        [823, 155],
      ],
    },
    {
      homeType: "ONE_BED_APARTMENT",
      room: 2,
      walls: [
        [1000, 405],
        [1248, 416],
        [1000, 620],
      ],
      fixtures: [
        [1215, 418],
        [1250, 475],
      ],
    },
    {
      homeType: "TWO_BED_HOUSE",
      room: 0,
      walls: [
        [680, 390],
        [235, 530],
        [400, 625],
      ],
      fixtures: [
        [273, 402],
        [595, 640],
      ],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 2,
      walls: [
        [350, 448],
        [230, 535],
        [400, 660],
      ],
      fixtures: [
        [244, 455],
        [190, 630],
      ],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 3,
      walls: [
        [980, 200],
        [1210, 280],
      ],
      fixtures: [[1195, 203]],
    },
    {
      homeType: "MANSION",
      room: 1,
      walls: [
        [430, 330],
        [246, 380],
        [240, 475],
      ],
      fixtures: [
        [340, 330],
        [265, 340],
      ],
    },
    {
      homeType: "MANSION",
      room: 2,
      walls: [
        [350, 535],
        [235, 575],
        [270, 695],
      ],
      fixtures: [
        [255, 540],
        [350, 695],
      ],
    },
    {
      homeType: "PALACE",
      room: 3,
      walls: [
        [255, 350],
        [233, 515],
      ],
      fixtures: [
        [295, 350],
        [218, 465],
        [223, 375],
        [223, 505],
      ],
    },
    {
      homeType: "STUDIO_APARTMENT",
      room: 0,
      walls: [[248, 450]],
      fixtures: [[260, 393]],
    },
    {
      homeType: "STUDIO_APARTMENT",
      room: 1,
      walls: [[1218, 460]],
      fixtures: [[1207, 410]],
    },
    {
      homeType: "ONE_BED_APARTMENT",
      room: 0,
      walls: [
        [230, 380],
        [213, 550],
      ],
      fixtures: [
        [237, 345],
        [226, 421],
        [218, 530],
      ],
    },
    {
      homeType: "ONE_BED_APARTMENT",
      room: 1,
      walls: [[1208, 225]],
      fixtures: [[1218, 253]],
    },
    {
      homeType: "ONE_BED_APARTMENT",
      room: 2,
      walls: [[1261, 555]],
      fixtures: [[1253, 555]],
    },
    { homeType: "TWO_BED_HOUSE", room: 0, walls: [[230, 540]], fixtures: [[238, 519]] },
    { homeType: "TWO_BED_HOUSE", room: 1, walls: [[250, 325]], fixtures: [[261, 315]] },
    {
      homeType: "TWO_BED_HOUSE",
      room: 2,
      walls: [[1195, 325]],
      fixtures: [[1194, 311]],
    },
    {
      homeType: "TWO_BED_HOUSE",
      room: 3,
      walls: [[1213, 540]],
      fixtures: [[1209, 502]],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 0,
      walls: [
        [576, 663],
        [860, 663],
      ],
      fixtures: [
        [576, 643],
        [860, 643],
      ],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 1,
      walls: [
        [223, 387],
        [300, 202],
      ],
      fixtures: [
        [225, 378],
        [314, 202],
      ],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 2,
      walls: [
        [212, 626],
        [400, 670],
      ],
      fixtures: [
        [222, 611],
        [400, 643],
      ],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 3,
      walls: [
        [1228, 378],
        [1150, 204],
      ],
      fixtures: [
        [1221, 373],
        [1134, 204],
      ],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 4,
      walls: [
        [1228, 625],
        [1100, 670],
      ],
      fixtures: [
        [1230, 616],
        [1100, 643],
      ],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 1,
      walls: [
        [233, 188],
        [240, 185],
        [266, 192],
        [266, 216],
        [252, 223],
      ],
      fixtures: [
        [248, 184],
        [248, 192],
        [244, 203],
        [250, 217],
        [312, 195],
        [275, 229],
      ],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 2,
      walls: [
        [230, 440],
        [252, 438],
        [259, 444],
      ],
      fixtures: [
        [243, 438],
        [243, 446],
        [250, 457],
        [235, 472],
        [400, 475],
      ],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 3,
      walls: [
        [1188, 186],
        [1208, 188],
        [1210, 190],
        [1180, 223],
        [1196, 224],
      ],
      fixtures: [
        [1197, 184],
        [1194, 196],
        [1194, 211],
        [1193, 219],
        [1193, 221],
        [1217, 190],
        [1134, 204],
      ],
    },
    {
      homeType: "TOWN_HOUSE",
      room: 4,
      walls: [
        [1195, 438],
        [1213, 439],
        [1209, 438],
      ],
      fixtures: [
        [1203, 438],
        [1197, 448],
        [1202, 460],
        [1214, 457],
        [1200, 477],
      ],
    },
    { homeType: "MANSION", room: 1, walls: [[236, 480]], fixtures: [[240, 463]] },
    { homeType: "MANSION", room: 2, walls: [[220, 648]], fixtures: [[224, 642]] },
    {
      homeType: "MANSION",
      room: 5,
      walls: [
        [985, 680],
        [1000, 680],
        [1067, 680],
        [985, 700],
        [1000, 700],
        [1050, 702],
        [1067, 708],
      ],
      fixtures: [
        [975, 685],
        [976, 705],
        [1000, 672],
        [1000, 718],
        [1077, 700],
      ],
    },
    {
      homeType: "MANSION",
      room: 6,
      walls: [[1263, 470]],
      fixtures: [
        [1252, 465],
        [1260, 490],
      ],
    },
    {
      homeType: "MANSION",
      room: 7,
      walls: [
        [1270, 627],
        [1120, 660],
        [1250, 660],
        [1120, 670],
        [1250, 670],
        [1120, 687],
        [1250, 687],
        [1112, 680],
        [1235, 680],
        [1270, 680],
      ],
      fixtures: [
        [1278, 623],
        [1100, 687],
        [1107, 672],
        [1150, 660],
        [1170, 665],
        [1205, 687],
        [1220, 680],
        [1250, 651],
        [1250, 698],
        [1283, 688],
      ],
    },
    {
      homeType: "PALACE",
      room: 0,
      walls: [
        [622, 541],
        [666, 394],
        [667, 405],
        [680, 400],
        [680, 415],
        [690, 419],
        [695, 423],
        [850, 405],
        [863, 398],
        [842, 418],
        [852, 414],
        [868, 401],
        [670, 546],
        [675, 558],
        [645, 544],
        [650, 562],
        [680, 566],
        [870, 530],
        [880, 532],
        [915, 530],
        [855, 540],
        [855, 566],
        [883, 546],
        [887, 558],
        [920, 546],
        [917, 557],
        [650, 530],
        [670, 532],
        [680, 530],
        [617, 540],
        [618, 556],
        [620, 563],
      ],
      fixtures: [
        [630, 550],
        [662, 400],
        [680, 394],
        [680, 418],
        [690, 423],
        [697, 404],
        [850, 395],
        [874, 400],
        [834, 405],
        [850, 422],
        [640, 550],
        [644, 560],
        [650, 574],
        [675, 574],
        [690, 558],
        [684, 538],
        [875, 521],
        [900, 552],
        [897, 540],
        [892, 555],
        [888, 567],
        [901, 534],
        [906, 540],
        [909, 549],
        [912, 558],
        [935, 540],
        [930, 554],
        [865, 575],
        [957, 536],
        [660, 521],
        [634, 534],
        [633, 536],
        [638, 538],
        [610, 550],
        [620, 575],
        [686, 530],
      ],
    },
    {
      homeType: "PALACE",
      room: 1,
      walls: [
        [717, 560],
        [819, 560],
      ],
      fixtures: [
        [728, 560],
        [806, 560],
        [722, 560],
        [813, 560],
        [730, 568],
        [805, 568],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 1,
      walls: [
        [717, 560],
        [819, 560],
      ],
      fixtures: [
        [728, 560],
        [806, 560],
        [722, 560],
        [813, 560],
        [730, 568],
        [805, 568],
      ],
    },
    {
      homeType: "PALACE",
      room: 2,
      walls: [[450, 290]],
      fixtures: [
        [390, 315],
        [419, 315],
      ],
    },
    {
      homeType: "PALACE",
      room: 6,
      walls: [[1080, 290]],
      fixtures: [
        [1118, 315],
        [1145, 315],
      ],
    },
    {
      homeType: "PALACE",
      room: 7,
      walls: [
        [1199, 350],
        [1214, 515],
        [1270, 350],
        [1270, 355],
        [1270, 363],
      ],
      fixtures: [
        [1194, 358],
        [1310, 380],
        [1205, 514],
        [1270, 344],
        [1280, 350],
        [1285, 350],
        [1280, 362],
        [1285, 365],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 0,
      walls: [
        [622, 541],
        [666, 394],
        [667, 405],
        [680, 400],
        [680, 415],
        [690, 419],
        [695, 423],
        [850, 405],
        [863, 398],
        [842, 418],
        [852, 414],
        [868, 401],
        [670, 546],
        [675, 558],
        [645, 544],
        [650, 562],
        [680, 566],
        [870, 530],
        [880, 532],
        [915, 530],
        [855, 540],
        [855, 566],
        [883, 546],
        [887, 558],
        [920, 546],
        [917, 557],
        [650, 530],
        [670, 532],
        [680, 530],
        [617, 540],
        [618, 556],
        [620, 563],
      ],
      fixtures: [
        [630, 550],
        [662, 400],
        [680, 394],
        [680, 418],
        [690, 423],
        [697, 404],
        [850, 395],
        [874, 400],
        [834, 405],
        [850, 422],
        [640, 550],
        [644, 560],
        [650, 574],
        [675, 574],
        [690, 558],
        [684, 538],
        [875, 521],
        [900, 552],
        [897, 540],
        [892, 555],
        [888, 567],
        [901, 534],
        [906, 540],
        [909, 549],
        [912, 558],
        [935, 540],
        [930, 554],
        [865, 575],
        [957, 536],
        [660, 521],
        [634, 534],
        [633, 536],
        [638, 538],
        [610, 550],
        [620, 575],
        [686, 530],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 2,
      walls: [[450, 290]],
      fixtures: [
        [390, 315],
        [419, 315],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 3,
      walls: [[233, 515]],
      fixtures: [
        [223, 375],
        [223, 505],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 6,
      walls: [[1080, 290]],
      fixtures: [
        [1118, 315],
        [1145, 315],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 7,
      walls: [
        [1199, 350],
        [1214, 515],
        [1270, 350],
        [1270, 355],
        [1270, 363],
      ],
      fixtures: [
        [1194, 358],
        [1310, 380],
        [1205, 514],
        [1270, 344],
        [1280, 350],
        [1285, 350],
        [1280, 362],
        [1285, 365],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 8,
      walls: [
        [1000, 455],
        [980, 595],
        [1090, 595],
      ],
      fixtures: [
        [1030, 595],
        [935, 555],
      ],
    },
    {
      homeType: "PALACE",
      room: 2,
      walls: [
        [600, 275],
        [600, 290],
        [600, 297],
      ],
      fixtures: [
        [567, 290],
        [600, 301],
        [634, 285],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 2,
      walls: [
        [600, 275],
        [600, 290],
        [600, 297],
      ],
      fixtures: [
        [567, 290],
        [600, 301],
        [634, 285],
      ],
    },
    {
      homeType: "PALACE",
      room: 6,
      walls: [
        [936, 275],
        [936, 290],
        [936, 297],
      ],
      fixtures: [
        [903, 285],
        [936, 301],
        [971, 285],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 6,
      walls: [
        [936, 275],
        [936, 290],
        [936, 297],
      ],
      fixtures: [
        [903, 285],
        [936, 301],
        [971, 285],
      ],
    },
    {
      homeType: "PALACE",
      room: 7,
      walls: [
        [1190, 348],
        [1194, 366],
        [1257, 350],
        [1272, 355],
        [1263, 367],
        [1196, 502],
        [1212, 510],
        [1212, 531],
        [1196, 531],
      ],
      fixtures: [
        [1194, 358],
        [1263, 355],
        [1263, 361],
        [1200, 507],
        [1195, 513],
        [1206, 513],
        [1200, 517],
        [1200, 527],
        [1263, 370],
        [1190, 518],
        [1210, 539],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 7,
      walls: [
        [1190, 348],
        [1194, 366],
        [1257, 350],
        [1272, 355],
        [1263, 367],
        [1196, 502],
        [1212, 510],
        [1212, 531],
        [1196, 531],
      ],
      fixtures: [
        [1194, 358],
        [1263, 355],
        [1263, 361],
        [1200, 507],
        [1195, 513],
        [1206, 513],
        [1200, 517],
        [1200, 527],
        [1263, 370],
        [1190, 518],
        [1210, 539],
      ],
    },
    {
      homeType: "PALACE",
      room: 3,
      walls: [
        [326, 502],
        [327, 530],
        [340, 531],
      ],
      fixtures: [
        [320, 515],
        [336, 507],
        [330, 513],
        [336, 519],
        [336, 526],
        [343, 520],
        [333, 538],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 3,
      walls: [
        [326, 502],
        [327, 530],
        [340, 531],
      ],
      fixtures: [
        [320, 515],
        [336, 507],
        [330, 513],
        [336, 519],
        [336, 526],
        [343, 520],
        [333, 538],
      ],
    },
    {
      homeType: "PALACE",
      room: 3,
      walls: [
        [210, 486],
        [222, 493],
        [208, 500],
        [229, 506],
        [210, 513],
        [222, 516],
        [229, 522],
      ],
      fixtures: [
        [218, 483],
        [202, 494],
        [235, 514],
        [230, 531],
        [216, 489],
        [216, 496],
        [217, 505],
        [217, 512],
        [215, 519],
      ],
    },
    {
      homeType: "PALACE",
      room: 7,
      walls: [
        [1335, 487],
        [1326, 491],
        [1337, 492],
        [1315, 504],
        [1314, 520],
        [1323, 514],
        [1324, 515],
      ],
      fixtures: [
        [1326, 483],
        [1305, 512],
        [1341, 495],
        [1315, 528],
        [1331, 490],
        [1326, 498],
        [1331, 505],
        [1331, 513],
        [1330, 520],
        [1302, 527],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 3,
      walls: [
        [210, 486],
        [222, 493],
        [208, 500],
        [229, 506],
        [210, 513],
        [222, 516],
        [229, 522],
      ],
      fixtures: [
        [218, 483],
        [202, 494],
        [235, 514],
        [230, 531],
        [216, 489],
        [216, 496],
        [217, 505],
        [217, 512],
        [215, 519],
      ],
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: 7,
      walls: [
        [1335, 487],
        [1326, 491],
        [1337, 492],
        [1315, 504],
        [1314, 520],
        [1323, 514],
        [1324, 515],
      ],
      fixtures: [
        [1326, 483],
        [1305, 512],
        [1341, 495],
        [1315, 528],
        [1331, 490],
        [1326, 498],
        [1331, 505],
        [1331, 513],
        [1330, 520],
        [1302, 527],
      ],
    },
  ] as const)(
    "covers $homeType room $room wall faces while preserving windows and lamps",
    ({ homeType, room, walls, fixtures }) => {
      const plan = HOME_ART_PLANS[homeType];
      const [width, height] = plan.aspectRatio === 3 / 2 ? [1536, 1024] : [1448, 1086];
      for (const [landmarks, expected] of [
        [walls, true],
        [fixtures, false],
      ] as const) {
        const panels = expected ? plan.paint[room]! : plan.paint.flat();
        for (const [x, y] of landmarks) {
          expect(
            panels.some((polygon) =>
              containsArtPoint(polygon, (x * 100) / width, (y * 100) / height),
            ),
          ).toBe(expected);
        }
      }
    },
  );

  it.each([
    {
      room: 0,
      walls: [
        [870, 660],
        [940, 675],
      ],
      fixtures: [[835, 660]],
    },
    {
      room: 1,
      walls: [
        [252, 318],
        [257, 318],
        [260, 318],
        [275, 318],
        [280, 325],
        [280, 340],
        [295, 340],
        [430, 330],
        [246, 380],
        [236, 480],
      ],
      fixtures: [
        [264, 323],
        [266, 333],
        [266, 343],
        [340, 330],
        [310, 330],
      ],
    },
    {
      room: 2,
      walls: [
        [245, 519],
        [260, 519],
        [264, 525],
        [268, 535],
        [280, 535],
        [350, 535],
        [270, 695],
      ],
      fixtures: [
        [254, 523],
        [254, 533],
        [255, 543],
        [480, 540],
        [350, 695],
      ],
    },
    {
      room: 3,
      walls: [
        [550, 330],
        [620, 320],
        [625, 320],
        [643, 320],
        [623, 340],
        [650, 340],
        [657, 325],
        [835, 320],
        [840, 320],
        [858, 320],
        [837, 340],
        [867, 340],
        [875, 325],
        [550, 440],
      ],
      fixtures: [
        [635, 318],
        [635, 328],
        [635, 338],
        [850, 318],
        [850, 328],
        [850, 338],
        [738, 330],
        [675, 330],
      ],
    },
    {
      room: 4,
      walls: [
        [570, 660],
        [635, 680],
      ],
      fixtures: [[540, 660]],
    },
    {
      room: 5,
      walls: [
        [930, 330],
        [990, 330],
        [985, 520],
        [1000, 680],
      ],
      fixtures: [
        [1015, 330],
        [980, 685],
      ],
    },
    {
      room: 6,
      walls: [
        [1032, 318],
        [1045, 318],
        [1058, 318],
        [1032, 330],
        [1045, 330],
        [1058, 330],
        [1032, 344],
        [1045, 344],
        [1058, 344],
        [1195, 320],
        [1205, 330],
        [1215, 320],
        [1222, 320],
        [1237, 320],
        [1200, 344],
        [1215, 344],
      ],
      fixtures: [
        [1070, 330],
        [1180, 330],
        [1120, 330],
        [1230, 323],
        [1228, 333],
        [1228, 343],
      ],
    },
    {
      room: 7,
      walls: [
        [1100, 505],
        [1150, 510],
        [1200, 515],
        [1230, 505],
        [1235, 515],
        [1240, 505],
        [1243, 504],
        [1257, 502],
        [1258, 505],
        [1120, 670],
        [1250, 680],
      ],
      fixtures: [
        [1250, 501],
        [1248, 510],
        [1248, 520],
        [1265, 508],
        [1170, 665],
      ],
    },
  ] as const)(
    "paints complete Mansion room $room plaster faces around fixture silhouettes",
    ({ room, walls, fixtures }) => {
      const plan = HOME_ART_PLANS.MANSION;
      for (const point of walls) {
        expect(containsSourceLandmark(plan.paint[room]!, point)).toBe(true);
      }
      for (const point of fixtures) {
        expect(containsSourceLandmark(plan.paint.flat(), point)).toBe(false);
      }
    },
  );

  it.each([
    { homeType: "MANSION", point: [37, 64], room: 4 },
    { homeType: "PALACE", point: [39, 38.5], room: 5 },
    { homeType: "MARSHMALLOWOPOLIS", point: [60, 38.5], room: 9 },
  ] as const)(
    "assigns shared $homeType wall faces to only room $room",
    ({ homeType, point, room }) => {
      const paintedRooms = HOME_ART_PLANS[homeType].paint.flatMap((panels, index) =>
        panels.some((polygon) => containsArtPoint(polygon, point[0], point[1]))
          ? [index]
          : [],
      );
      expect(paintedRooms).toEqual([room]);
    },
  );

  it.each([...HomeTypes])(
    "allows indoor action furniture on the %s lawn while keeping the cultivation plot separate",
    (homeType) => {
      for (const action of ["sleep", "storage", "kitchen"] as const) {
        const furniture = { ...piece, action };
        const lawn = clampHomeFurniturePlacement(
          { ...placement, room: "yard" },
          furniture,
          homeType,
        );
        expect(lawn).not.toBeNull();
        expect(homeLayoutPlacementError([lawn!], [furniture], homeType)).toBeNull();
        expect(
          homeLayoutPlacementError(
            [lawn!],
            [{ ...furniture, action: "farm" }],
            homeType,
          ),
        ).toContain("outside");
      }
    },
  );

  it("preserves furniture proportions across differently sized authored rooms", () => {
    for (const homeType of HomeTypes) {
      for (const room of getHomeRooms(homeType)) {
        const image = getHomeFurnitureGeometry(
          piece,
          { ...placement, room: room.id },
          homeType,
        ).image;
        expect((image.width * room.width) / 100).toBeCloseTo(piece.width);
        expect((image.height * room.height) / 100).toBeCloseTo(
          (piece.width * (HOME_ART_PLANS[homeType].aspectRatio ?? 4 / 3)) / (4 / 3),
        );
      }
    }
  });

  it("checks collisions within rooms and recovers removed floors into storage", () => {
    const other = { ...piece, id: "other" };
    const layout = [placement, { ...placement, id: other.id, room: "room-1" as const }];
    expect(homeLayoutPlacementError(layout, [piece, other], "TOWN_HOUSE")).toBeNull();
    expect(
      homeLayoutPlacementError(
        layout.map((p) => ({ ...p, room: "main" })),
        [piece, other],
        "TOWN_HOUSE",
      ),
    ).toContain("overlaps");
    expect(recoverHomeLayout(layout, [piece, other], "NONE")).toEqual([placement]);
  });

  it("allows the furniture limit per room and rejects unknown rooms", () => {
    const main = Array.from({ length: HOME_FURNITURE_MAX_PLACEMENTS }, (_, i) => ({
      ...placement,
      id: `main-${i}`,
    }));
    const other = main.map((p) => ({
      ...p,
      id: `other-${p.id}`,
      room: "room-1" as const,
    }));
    expect(
      homeFurnitureSaveInputSchema.safeParse({
        homeType: "TOWN_HOUSE",
        revision: 0,
        placements: [...main, ...other],
      }).success,
    ).toBe(true);
    expect(homeRoomLayoutError([...main, ...other], "TOWN_HOUSE")).toBeNull();
    expect(homeRoomLayoutError([...main, placement], "TOWN_HOUSE")).toContain("up to");
    expect(homeRoomLayoutError(other, "NONE")).toContain("no longer");
  });

  it("fits the complete painting and bounds pan/zoom to its edges", () => {
    for (const homeType of HomeTypes) {
      const size = HOME_ART_PLANS[homeType].size;
      const overview = getHomeOverviewCamera(homeType);
      expect(size * overview.scale).toBeCloseTo(100);
      expect(boundHomeCamera(overview, homeType)).toEqual(overview);
      for (const scale of [0, 0.3, 1, 10]) {
        const camera = boundHomeCamera({ x: 9999, y: -9999, scale }, homeType);
        expect(camera.scale).toBeGreaterThanOrEqual(overview.scale);
        expect(camera.scale).toBeLessThanOrEqual(1.8);
        expect(camera.x).toBe(0);
        expect(camera.y).toBeCloseTo(100 - size * camera.scale);
      }
      for (const room of getHomeRooms(homeType)) {
        const camera = getHomeRoomCamera(homeType, room.id);
        expect(boundHomeCamera(camera, homeType)).toEqual(camera);
        const xs = room.interior.flat().map(({ x }) => x);
        const ys = room.interior.flat().map(({ y }) => y);
        const centerX =
          camera.x +
          (room.x + ((Math.min(...xs) + Math.max(...xs)) * room.width) / 200) *
            camera.scale;
        const centerY =
          camera.y +
          (room.y + ((Math.min(...ys) + Math.max(...ys)) * room.height) / 200) *
            camera.scale;
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
    for (const after of [before, { x: 46, y: 57 }]) {
      const next = zoomHomeCamera(camera, 1.2, before, after);
      expect((after.x - next.x) / next.scale).toBeCloseTo(
        (before.x - camera.x) / camera.scale,
      );
      expect((after.y - next.y) / next.scale).toBeCloseTo(
        (before.y - camera.y) / camera.scale,
      );
    }
  });
});

/** Check a 1536x1024 artwork pixel against percentage contours, including concave masks. */
const containsSourceLandmark = (
  polygons: readonly (readonly (readonly [number, number])[])[],
  [x, y]: readonly [number, number],
) => {
  return polygons.some((polygon) =>
    containsArtPoint(polygon, (x * 100) / 1536, (y * 100) / 1024),
  );
};

/**
 * Check percentage contours with paint's even-odd fill; the authored floors and foreground
 * have the same interior under nonzero fill.
 */
const containsArtPoint = (
  polygon: readonly (readonly [number, number])[],
  x: number,
  y: number,
) => {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const [ax, ay] = polygon[index]!;
    const [bx, by] = polygon[previous]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
};

describe("zoomHomeCameraTo", () => {
  const center = { x: 50, y: 50 };
  const overview = getHomeOverviewCamera("TOWN_HOUSE");

  it("clamps the scale before anchoring the zoom", () => {
    const camera = { x: -20, y: -20, scale: 1.5 };
    expect(zoomHomeCameraTo(camera, 9, "TOWN_HOUSE", center)).toEqual(
      boundHomeCamera(
        zoomHomeCamera(camera, HOME_CAMERA_MAX_SCALE, center),
        "TOWN_HOUSE",
      ),
    );
  });

  it("stops at the overview when zooming out", () => {
    expect(
      zoomHomeCameraTo(overview, overview.scale / 2, "TOWN_HOUSE", center).scale,
    ).toBe(overview.scale);
  });

  it("moves the anchor when a pinch midpoint travels", () => {
    const camera = { x: -20, y: -20, scale: 1 };
    const moved = { x: 55, y: 50 };
    expect(zoomHomeCameraTo(camera, 1.2, "TOWN_HOUSE", center, moved)).toEqual(
      boundHomeCamera(zoomHomeCamera(camera, 1.2, center, moved), "TOWN_HOUSE"),
    );
  });
});
