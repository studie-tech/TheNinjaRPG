import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import {
  HOME_FURNITURE_MAX_PLACEMENTS,
  HOME_FURNITURE_POSITION_MIN,
  HOME_FURNITURE_POSITION_MAX,
} from "@/drizzle/constants";
import {
  DEFAULT_HOME_FURNITURE_GEOMETRY,
  clampHomeFurniturePlacement,
  fitHomeFurniturePlacement,
  getHomeLayout,
  getHomeFurnitureGeometry,
  getHomeFurnitureRotations,
  getHomeFurnitureView,
  homeLayoutOrientationError,
  homeLayoutOwnershipError,
  homeLayoutPlacementError,
  projectHomePlacement,
  recoverHomeLayout,
  unprojectHomePlacement,
  type HomeFurniture,
} from "@/libs/home";
import { homeFurnitureSaveInputSchema } from "@/validators/home";
import { getHomeRooms } from "@/libs/homeProperty";
import { furnitureDataSchema } from "@/validators/itemFurniture";

const fixture = (id: string, patch: Partial<HomeFurniture> = {}): HomeFurniture => ({
  id,
  itemId: `content-${id}`,
  name: id,
  image: "/furniture.webp",
  width: 24,
  groundAnchor: 100,
  action: null,
  isFloor: false,
  quantity: 1,
  views: {},
  ...patch,
});
const placement = (id: string) => ({ id, x: 50, y: 50, rotation: 0 as const });
/** Furniture as the item catalogue seeds it. */
const seededFurniture = (itemId: string, name: string) => {
  const catalogue = readFileSync(
    new URL("../../data/item.sql", import.meta.url),
    "utf8",
  );
  const data = catalogue.match(
    new RegExp(`\\('${itemId}', '${name}',.*?'FURNITURE', '(\\{.*?\\})'`),
  )?.[1];
  expect(data).toBeDefined();
  return fixture(itemId, furnitureDataSchema.parse(JSON.parse(data!)));
};

describe("owned furniture layouts", () => {
  it("uses each published direction's art and optional geometry without transforming the base image", () => {
    const piece = fixture("cabinet", {
      views: {
        "90": { image: "/cabinet-90.webp", width: 18 },
        "270": { image: "/cabinet-270.webp", groundAnchor: 85 },
      },
    });
    expect(getHomeFurnitureRotations(piece)).toEqual([0, 1, 3]);
    expect(getHomeFurnitureView(piece, 0)).toEqual({
      image: piece.image,
      width: 24,
      groundAnchor: 100,
      geometry: DEFAULT_HOME_FURNITURE_GEOMETRY,
    });
    expect(getHomeFurnitureView(piece, 1)).toEqual({
      image: "/cabinet-90.webp",
      width: 18,
      groundAnchor: 100,
      geometry: DEFAULT_HOME_FURNITURE_GEOMETRY,
    });
    expect(getHomeFurnitureView(piece, 2)).toEqual({
      image: piece.image,
      width: 24,
      groundAnchor: 100,
      geometry: DEFAULT_HOME_FURNITURE_GEOMETRY,
    });
    expect(getHomeFurnitureView(piece, 3)).toEqual({
      image: "/cabinet-270.webp",
      width: 24,
      groundAnchor: 85,
      geometry: DEFAULT_HOME_FURNITURE_GEOMETRY,
    });
    expect(
      homeLayoutOrientationError([{ ...placement(piece.id), rotation: 1 }], [piece]),
    ).toBeNull();
    expect(
      homeLayoutOrientationError([{ ...placement(piece.id), rotation: 2 }], [piece]),
    ).toContain("no longer available");
  });

  it("loads only complete positions into independent drafts and normalizes rotation", () => {
    const rows = [
      { id: "placed", homeX: 20, homeY: 40, homeRotation: 1 },
      { id: "opposite", homeX: 40, homeY: 50, homeRotation: 2 },
      { id: "left", homeX: 60, homeY: 50, homeRotation: 3 },
      { id: "unplaced", homeX: null, homeY: null, homeRotation: 0 },
      { id: "partial", homeX: 20, homeY: null, homeRotation: 0 },
      { id: "normal-rotation", homeX: 70, homeY: 60, homeRotation: 4 },
    ];
    const draft = getHomeLayout(rows);
    expect(draft).toEqual([
      { id: "placed", x: 20, y: 40, rotation: 1 },
      { id: "opposite", x: 40, y: 50, rotation: 2 },
      { id: "left", x: 60, y: 50, rotation: 3 },
      { id: "normal-rotation", x: 70, y: 60, rotation: 0 },
    ]);
    draft[0]!.x = 50;
    expect(rows[0]!.homeX).toBe(20);
    expect(getHomeLayout(rows)[0]!.x).toBe(20);
  });

  it("accepts independent owned copies and rejects foreign row IDs", () => {
    const copies = [
      fixture("copy-a", { itemId: "cabinet" }),
      fixture("copy-b", { itemId: "cabinet" }),
    ];
    expect(
      homeLayoutOwnershipError(
        copies.map(({ id }) => placement(id)),
        copies,
      ),
    ).toBeNull();
    expect(homeLayoutOwnershipError([placement("cabinet")], copies)).toContain(
      "no longer available",
    );
    expect(homeLayoutOwnershipError([], [])).toBeNull();
  });

  it("bounds room size while action validation uses the owned content snapshot", () => {
    const input = { homeType: "NONE", revision: 0, placements: [] };
    expect(homeFurnitureSaveInputSchema.safeParse(input).success).toBe(true);
    const placements = Array.from(
      { length: HOME_FURNITURE_MAX_PLACEMENTS },
      (_, index) => placement(`owned-${index}`),
    );
    expect(
      homeFurnitureSaveInputSchema.safeParse({ ...input, placements }).success,
    ).toBe(true);
    expect(
      homeFurnitureSaveInputSchema.safeParse({
        ...input,
        placements: [...placements, placement("overflow")],
      }).success,
    ).toBe(false);
    expect(
      homeFurnitureSaveInputSchema.safeParse({
        ...input,
        placements: [placement("same"), placement("same")],
      }).success,
    ).toBe(false);
    expect(
      homeFurnitureSaveInputSchema.safeParse({ ...input, owned: ["foreign"] }).success,
    ).toBe(false);
  });

  it.each([
    { id: "row", x: HOME_FURNITURE_POSITION_MIN - 1, y: 50, rotation: 0 },
    { id: "row", x: 50, y: HOME_FURNITURE_POSITION_MAX + 1, rotation: 0 },
    { id: "row", x: Number.NaN, y: 50, rotation: 0 },
    { id: "row", x: 50, y: 50, rotation: 4 },
    { id: "", x: 50, y: 50, rotation: 0 },
  ])("rejects unsafe placement %j", (invalid) => {
    expect(
      homeFurnitureSaveInputSchema.safeParse({
        homeType: "NONE",
        revision: 0,
        placements: [invalid],
      }).success,
    ).toBe(false);
  });
});

describe("painted furniture geometry", () => {
  const piece = fixture("table", {
    width: 20,
    geometry: {
      aspectRatio: 2,
      visibleBounds: { x: 20, y: 10, width: 60, height: 80 },
      footprint: { x: 25, y: 75, width: 50, height: 15 },
    },
  });

  it("projects normalized image bounds without transparent padding or source-aspect distortion", () => {
    const position = placement(piece.id);
    const anchor = projectHomePlacement(position);
    expect(unprojectHomePlacement(anchor)).toEqual({ x: 50, y: 50 });
    const geometry = getHomeFurnitureGeometry(piece, position, "NONE");
    const room = getHomeRooms("NONE")[0]!;
    const sx = room.width / 100;
    const sy = room.height / 100;
    expect(geometry.image.width * sx).toBeCloseTo(20);
    expect(geometry.image.height * sy).toBeCloseTo(40 / 3);
    expect(geometry.visibleBounds.width * sx).toBeCloseTo(12);
    expect(geometry.visibleBounds.height * sy).toBeCloseTo(32 / 3);
    expect(geometry.footprint.width * sx).toBeCloseTo(10);
    expect(geometry.footprint.height * sy).toBeCloseTo(2);
    expect(geometry.visibleBounds.x).toBeCloseTo(anchor.x - 6 / sx);
    expect(geometry.footprint.y).toBeCloseTo(anchor.y - 10 / 3 / sy);
  });

  it("uses a direction's own source geometry and never reuses another image's padding", () => {
    const rotated = fixture("table", {
      ...piece,
      views: {
        "90": {
          image: "/table-90.webp",
          width: 15,
          geometry: { ...piece.geometry!, aspectRatio: 1 },
        },
      },
    });
    expect(
      (getHomeFurnitureGeometry(
        rotated,
        { ...placement(piece.id), rotation: 1 },
        "NONE",
      ).image.height *
        getHomeRooms("NONE")[0]!.height) /
        100,
    ).toBeCloseTo(20);
    expect(
      getHomeFurnitureView(
        { ...rotated, views: { "90": { image: "/uncalibrated.webp" } } },
        1,
      ).geometry,
    ).toEqual(DEFAULT_HOME_FURNITURE_GEOMETRY);
  });

  it("fits tight visible bounds at the right wall instead of reserving transparent frame padding", () => {
    const rightWall = Math.max(
      ...getHomeRooms("NONE")[0]!
        .interior.flat()
        .map(({ x }) => x),
    );
    const fitted = clampHomeFurniturePlacement(
      { ...placement(piece.id), x: 100 },
      piece,
      "NONE",
    );
    expect(fitted).not.toBeNull();
    const geometry = getHomeFurnitureGeometry(piece, fitted!, "NONE");
    expect(geometry.visibleBounds.x + geometry.visibleBounds.width).toBeLessThanOrEqual(
      rightWall,
    );
    expect(
      homeLayoutPlacementError([{ ...fitted!, x: fitted!.x + 1 }], [piece], "NONE"),
    ).not.toBeNull();
    expect(geometry.image.x + geometry.image.width).toBeGreaterThan(rightWall);
    expect(homeLayoutPlacementError([fitted!], [piece], "NONE")).toBeNull();
  });

  it("keeps footprint overlap strict while allowing rugs under furniture and disjoint ground", () => {
    const other = fixture("chair", { ...piece, id: "chair" });
    expect(
      homeLayoutPlacementError(
        [placement(piece.id), placement(other.id)],
        [piece, other],
        "NONE",
      ),
    ).toContain("overlaps");
    expect(
      homeLayoutPlacementError(
        [placement(piece.id), placement(other.id)],
        [piece, { ...other, isFloor: true }],
        "NONE",
      ),
    ).toBeNull();
    const touching = {
      ...placement(other.id),
      ...unprojectHomePlacement({
        x:
          projectHomePlacement(placement(piece.id)).x +
          getHomeFurnitureGeometry(piece, placement(piece.id), "NONE").footprint.width,
        y: projectHomePlacement(placement(piece.id)).y,
      }),
    };
    expect(
      homeLayoutPlacementError([placement(piece.id), touching], [piece, other], "NONE"),
    ).toBeNull();
    // These sprites overlap above the floor, while their ground strips have separate space.
    expect(
      homeLayoutPlacementError(
        [placement(piece.id), { ...placement(other.id), y: 60 }],
        [piece, other],
        "NONE",
      ),
    ).toBeNull();
  });

  it("rejects walls and the front curtains, with farm pieces confined to outdoor ground", () => {
    const curtain = {
      ...placement(piece.id),
      ...unprojectHomePlacement({ x: 50, y: 90 }),
    };
    expect(homeLayoutPlacementError([curtain], [piece], "NONE")).toContain(
      "walls and curtains",
    );
    expect(
      homeLayoutPlacementError(
        [{ ...placement(piece.id), ...unprojectHomePlacement({ x: 5, y: 60 }) }],
        [piece],
        "NONE",
      ),
    ).toContain("walls and curtains");
    const farm = { ...piece, groundAnchor: 90, action: "farm" as const };
    expect(homeLayoutPlacementError([placement(piece.id)], [farm], "NONE")).toContain(
      "outside",
    );
    const outdoor = clampHomeFurniturePlacement(
      { ...placement(piece.id), room: "yard" },
      farm,
      "NONE",
    );
    expect(outdoor).not.toBeNull();
    expect(homeLayoutPlacementError([outdoor!], [farm], "NONE")).toBeNull();
    expect(homeLayoutPlacementError([outdoor!], [piece], "NONE")).toContain(
      "walls and curtains",
    );
  });

  it("finds free ground and recovers old placements without changing the saved input", () => {
    const other = { ...piece, id: "chair" };
    const saved = [
      placement(piece.id),
      placement(other.id),
      { ...placement("garden"), y: 40 },
    ];
    const pieces = [
      piece,
      other,
      { ...piece, id: "garden", groundAnchor: 90, action: "farm" as const },
    ];
    const fitted = fitHomeFurniturePlacement(
      placement(other.id),
      other,
      [placement(piece.id)],
      pieces,
      "NONE",
    );
    expect(fitted).not.toBeNull();
    expect(
      homeLayoutPlacementError([placement(piece.id), fitted!], pieces, "NONE"),
    ).toBeNull();
    const recovered = recoverHomeLayout(saved, pieces, "NONE");
    expect(recovered).toHaveLength(3);
    expect(homeLayoutPlacementError(recovered, pieces, "NONE")).toBeNull();
    expect(saved[1]).toEqual(placement(other.id));
    expect(saved[2]!.y).toBe(40);
  });

  it.each([
    { columns: 2, rows: 1 },
    { columns: 1, rows: 2 },
    { columns: 2, rows: 2 },
  ])(
    "fits touching furniture in a full $columns by $rows arrangement",
    ({ columns, rows }) => {
      const yard = getHomeRooms("NONE").find(({ isYard }) => isYard)!;
      const lawn = yard.interior[0]!;
      const left = Math.min(...lawn.map(({ x }) => x));
      const top = Math.min(...lawn.map(({ y }) => y));
      const width = Math.max(...lawn.map(({ x }) => x)) - left;
      const height = Math.max(...lawn.map(({ y }) => y)) - top;
      const pieceWidth = width * (columns === 1 ? 0.7 : 1 / columns);
      const pieceHeight = height * (rows === 1 ? 0.7 : 1 / rows);
      const furnitureWidth = (pieceWidth * yard.width) / 100;
      const furnitureHeight = (pieceHeight * yard.height) / 100;
      const data = furnitureDataSchema.parse({
        width: furnitureWidth,
        geometry: {
          aspectRatio: (furnitureWidth * 4) / 3 / furnitureHeight,
          visibleBounds: { x: 0, y: 0, width: 100, height: 100 },
          footprint: { x: 0, y: 0, width: 100, height: 100 },
        },
      });
      const pieces = Array.from({ length: columns * rows }, (_, index) =>
        fixture(`chair-${index}`, data),
      );
      const touching = pieces.map(({ id }, index) => ({
        id,
        room: "yard" as const,
        rotation: 0 as const,
        ...unprojectHomePlacement({
          x:
            left +
            (width - columns * pieceWidth) / 2 +
            ((index % columns) + 0.5) * pieceWidth,
          y:
            top +
            (height - rows * pieceHeight) / 2 +
            (Math.floor(index / columns) + 1) * pieceHeight,
        }),
      }));
      expect(homeLayoutPlacementError(touching, pieces, "NONE")).toBeNull();
      const saved = touching.map((position) => ({
        ...position,
        x: touching[0]!.x,
        y: touching[0]!.y,
      }));
      const original = structuredClone(saved);
      const fitted = fitHomeFurniturePlacement(
        saved.at(-1)!,
        pieces.at(-1)!,
        touching.slice(0, -1),
        pieces,
        "NONE",
      );
      expect(fitted).not.toBeNull();
      expect(
        homeLayoutPlacementError([...touching.slice(0, -1), fitted!], pieces, "NONE"),
      ).toBeNull();
      const overlapping = {
        ...fitted!,
        x: fitted!.x + (saved[0]!.x - fitted!.x) / 100,
        y: fitted!.y + (saved[0]!.y - fitted!.y) / 100,
      };
      expect(
        homeLayoutPlacementError(
          [...touching.slice(0, -1), overlapping],
          pieces,
          "NONE",
        ),
      ).toContain("overlaps");
      const recovered = recoverHomeLayout(saved, pieces, "NONE");
      expect(recovered).toHaveLength(pieces.length);
      expect(homeLayoutPlacementError(recovered, pieces, "NONE")).toBeNull();
      expect(saved).toEqual(original);
    },
  );

  it.each([
    { surface: "lawn", widthFraction: 0.5, heightFraction: 1, action: null },
    {
      surface: "cultivation",
      widthFraction: 1,
      heightFraction: 0.5,
      action: "farm" as const,
    },
    {
      surface: "cultivation",
      widthFraction: 1,
      heightFraction: 1,
      action: "farm" as const,
    },
  ])(
    "preserves an exact $widthFraction by $heightFraction fit on the $surface",
    ({ widthFraction, heightFraction, action }) => {
      const yard = getHomeRooms("NONE").find(({ isYard }) => isYard)!;
      const floor = action ? yard.outdoor : yard.interior[0]!;
      const left = Math.min(...floor.map(({ x }) => x));
      const top = Math.min(...floor.map(({ y }) => y));
      const width = Math.max(...floor.map(({ x }) => x)) - left;
      const height = Math.max(...floor.map(({ y }) => y)) - top;
      const furnitureWidth = (width * widthFraction * yard.width) / 100;
      const furnitureHeight = (height * heightFraction * yard.height) / 100;
      const piece = fixture(
        "exact-fit",
        furnitureDataSchema.parse({
          action,
          width: furnitureWidth,
          geometry: {
            aspectRatio: (furnitureWidth * 4) / 3 / furnitureHeight,
            visibleBounds: { x: 0, y: 0, width: 100, height: 100 },
            footprint: { x: 0, y: 0, width: 100, height: 100 },
          },
        }),
      );
      const position = {
        id: piece.id,
        room: "yard" as const,
        rotation: 0 as const,
        ...unprojectHomePlacement({
          x: left + width / 2,
          y: top + (height * (1 + heightFraction)) / 2,
        }),
      };
      expect(homeLayoutPlacementError([position], [piece], "NONE")).toBeNull();
      expect(clampHomeFurniturePlacement(position, piece, "NONE")).toEqual(position);
      expect(fitHomeFurniturePlacement(position, piece, [], [piece], "NONE")).toEqual(
        position,
      );
      expect(recoverHomeLayout([position], [piece], "NONE")).toEqual([position]);

      const outside = {
        ...position,
        x: position.x + (widthFraction === 1 ? 0.01 : 0),
        y: position.y + (heightFraction === 1 ? 0.01 : 0),
      };
      expect(homeLayoutPlacementError([outside], [piece], "NONE")).not.toBeNull();
      const clamped = clampHomeFurniturePlacement(outside, piece, "NONE");
      expect(clamped).not.toBeNull();
      expect(homeLayoutPlacementError([clamped!], [piece], "NONE")).toBeNull();
      const footprint = getHomeFurnitureGeometry(piece, clamped!, "NONE").footprint;
      expect(footprint.x).toBeGreaterThanOrEqual(left - 1e-6);
      expect(footprint.y).toBeGreaterThanOrEqual(top - 1e-6);
      expect(footprint.x + footprint.width).toBeLessThanOrEqual(left + width + 1e-6);
      expect(footprint.y + footprint.height).toBeLessThanOrEqual(top + height + 1e-6);

      const oversized = { ...piece, width: piece.width * 1.001 };
      expect(homeLayoutPlacementError([position], [oversized], "NONE")).not.toBeNull();
      expect(clampHomeFurniturePlacement(position, oversized, "NONE")).toBeNull();
      expect(
        fitHomeFurniturePlacement(position, oversized, [], [oversized], "NONE"),
      ).toBeNull();
      expect(recoverHomeLayout([position], [oversized], "NONE")).toEqual([]);
    },
  );

  it.each([1, 3] as const)(
    "preserves the seeded lantern's saved facing %s on the measured floor",
    (rotation) => {
      const piece = seededFurniture("home-lantern", "Paper Lantern");
      const position = {
        id: piece.id,
        room: "room-8" as const,
        x: 50,
        y: 50,
        rotation,
      };

      expect(
        homeFurnitureSaveInputSchema.safeParse({
          homeType: "MARSHMALLOWOPOLIS",
          revision: 0,
          placements: [position],
        }).success,
      ).toBe(true);
      expect(homeLayoutOrientationError([position], [piece])).toBeNull();
      expect(
        homeLayoutPlacementError([position], [piece], "MARSHMALLOWOPOLIS"),
      ).toBeNull();
      expect(clampHomeFurniturePlacement(position, piece, "MARSHMALLOWOPOLIS")).toEqual(
        position,
      );
      expect(
        fitHomeFurniturePlacement(position, piece, [], [piece], "MARSHMALLOWOPOLIS"),
      ).toEqual(position);
      expect(recoverHomeLayout([position], [piece], "MARSHMALLOWOPOLIS")).toEqual([
        position,
      ]);
    },
  );

  it("preserves a rotated bed when the complete upgraded floor fits its facing", () => {
    const bed = seededFurniture("home-bed", "Bed");
    const saved = [
      {
        id: bed.id,
        room: "room-3" as const,
        x: 50,
        y: 50.515778311884056,
        rotation: 1 as const,
      },
    ];
    const original = structuredClone({ saved, bed });

    expect(homeLayoutPlacementError(saved, [bed], "TOWN_HOUSE")).toBeNull();
    expect(recoverHomeLayout(saved, [bed], "TOWN_HOUSE")).toEqual(saved);
    expect(
      fitHomeFurniturePlacement(saved[0]!, bed, [], [bed], "MANSION"),
    ).not.toBeNull();

    const recovered = recoverHomeLayout(saved, [bed], "MANSION");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ id: bed.id, room: "room-3", rotation: 1 });
    expect(homeLayoutPlacementError(recovered, [bed], "MANSION")).toBeNull();
    expect(homeLayoutOrientationError(recovered, [bed])).toBeNull();
    expect({ saved, bed }).toEqual(original);

    // A removed room or a piece with no fitting published view stays unplaced.
    expect(recoverHomeLayout(saved, [bed], "NONE")).toEqual([]);
    expect(
      recoverHomeLayout(saved, [{ ...bed, width: 100, views: {} }], "MANSION"),
    ).toEqual([]);
  });
});
