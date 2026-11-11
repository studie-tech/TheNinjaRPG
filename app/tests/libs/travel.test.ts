import { describe, expect, it } from "bun:test";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import {
  filterLiveSectorBattleUsers,
  findGlobalTravelDestination,
  getBiomeAtSectorAnchor,
  isTravelKeyBlocked,
  optimisticGlobalTravelStart,
  resolveGlobeJourney,
  SECTOR_BATTLE_STALE_SECONDS,
} from "@/libs/travel";
import { sectorTile as makeTile, sectorMap } from "../setup/sectorMap";

const makeMap = (width: number, height: number, blocked: Set<string> = new Set()) =>
  sectorMap(width, height, (x, y) =>
    blocked.has(`${x},${y}`) ? { walkCost: 0, blocked: true } : {},
  );

describe("confirmed globe journey", () => {
  const stored = {
    userId: "hero",
    fromSector: 724,
    toSector: 177,
    finishAt: 20_000,
    durationMs: 10_000,
  };
  const user = {
    userId: "hero",
    sector: 177,
    status: "TRAVEL" as const,
    travelFinishAt: new Date(20_000),
  };

  it("restores the server-confirmed journey after serialization, including instant travel", () => {
    expect(resolveGlobeJourney(JSON.parse(JSON.stringify(stored)), user)).toEqual(
      stored,
    );
    expect(
      resolveGlobeJourney(
        { ...stored, toSector: 222, durationMs: 0 },
        { ...user, sector: 222 },
      )?.durationMs,
    ).toBe(0);
  });

  it("ignores malformed, stale and other-account routes without changing travel state", () => {
    for (const entry of [
      null,
      {},
      "route",
      { ...stored, fromSector: -1 },
      { ...stored, durationMs: -1 },
      { ...stored, durationMs: Infinity },
      { ...stored, fromSector: 177 },
      { ...stored, userId: "another-user" },
      { ...stored, toSector: 178 },
      { ...stored, finishAt: 19_000 },
    ])
      expect(resolveGlobeJourney(entry, user)).toBeNull();
    expect(resolveGlobeJourney(stored, { ...user, status: "AWAKE" })).toBeNull();
    expect(resolveGlobeJourney(stored, { ...user, travelFinishAt: null })).toBeNull();
    expect(resolveGlobeJourney(stored, undefined)).toBeNull();
  });
});

describe("findGlobalTravelDestination", () => {
  it("lands in the center of a standard sector", () => {
    expect(findGlobalTravelDestination(makeMap(26, 26))).toEqual({ x: 13, y: 13 });
  });

  it("uses the authored dimensions for a rectangular sector", () => {
    expect(findGlobalTravelDestination(makeMap(9, 5))).toEqual({ x: 4, y: 2 });
  });

  it("includes shaded terrain among landing tiles", () => {
    const map = makeMap(3, 1, new Set(["1,0"]));

    expect(findGlobalTravelDestination(map)).toEqual({ x: 1, y: 0 });
  });

  it("uses the nearest tile to a missing center instead of an edge spawn anchor", () => {
    const map = makeMap(9, 9);
    map.tiles = [makeTile(0, 0), makeTile(4, 3), makeTile(8, 8)];

    expect(findGlobalTravelDestination(map)).toEqual({ x: 4, y: 3 });
  });

  it("returns null when the sector has no tiles", () => {
    expect(findGlobalTravelDestination(makeMap(0, 0))).toBeNull();
  });
});

describe("getBiomeAtSectorAnchor", () => {
  it("uses the authored anchor tile instead of a conflicting globe biome", () => {
    const map = makeMap(3, 3);
    map.anchors = [{ key: "shrine.default", x: 1, y: 1 }];
    map.tiles[4] = {
      ...map.tiles[4]!,
      terrain: "dessert",
      battleBiome: "dessert",
    };

    expect(getBiomeAtSectorAnchor(map, "shrine.default", 3)).toBe("dessert");
  });

  it("uses visible terrain instead of an independent combat override", () => {
    const map = makeMap(3, 3);
    map.anchors = [{ key: "shrine.default", x: 1, y: 1 }];
    map.tiles[4] = {
      ...map.tiles[4]!,
      terrain: "dessert",
      battleBiome: "ground",
    };

    expect(getBiomeAtSectorAnchor(map, "shrine.default", 1)).toBe("dessert");
  });

  it("falls back to the globe biome when the anchor is absent", () => {
    expect(getBiomeAtSectorAnchor(makeMap(3, 3), "shrine.default", 3)).toBe("ice");
  });
});

describe("optimisticGlobalTravelStart", () => {
  it("omits travelFinishAt for instant journeys so arrival cannot race start", () => {
    expect(optimisticGlobalTravelStart(0)).toEqual({ status: "TRAVEL" });
  });

  it("sets a future travelFinishAt when the journey takes time", () => {
    const before = Date.now();
    const patch = optimisticGlobalTravelStart(12);
    expect(patch.status).toBe("TRAVEL");
    expect(patch.travelFinishAt).toBeInstanceOf(Date);
    expect(patch.travelFinishAt?.getTime()).toBeGreaterThanOrEqual(before + 12_000);
    expect(patch.travelFinishAt?.getTime()).toBeLessThanOrEqual(Date.now() + 12_000);
  });
});

describe("filterLiveSectorBattleUsers", () => {
  const users = [
    { userId: "awake", status: "AWAKE", battleId: null },
    { userId: "fighting", status: "BATTLE", battleId: "live" },
    { userId: "knocked-out", status: "BATTLE", battleId: "abandoned" },
    { userId: "orphaned", status: "BATTLE", battleId: null },
  ];

  it("keeps awake players and fighters in live battles", () => {
    expect(
      filterLiveSectorBattleUsers(users, new Set(["live"])).map((u) => u.userId),
    ).toEqual(["awake", "fighting"]);
  });

  it("hides every battle marker when no battle is live", () => {
    expect(filterLiveSectorBattleUsers(users, new Set()).map((u) => u.userId)).toEqual([
      "awake",
    ]);
  });

  it("allows several idle turn timeouts before treating a battle as abandoned", () => {
    expect(SECTOR_BATTLE_STALE_SECONDS).toBeGreaterThanOrEqual(COMBAT_SECONDS * 3);
    expect(SECTOR_BATTLE_STALE_SECONDS).toBeLessThan(60 * 60);
  });
});

describe("isTravelKeyBlocked", () => {
  const press = (target: EventTarget | null, extra: Partial<KeyboardEvent> = {}) =>
    ({
      key: "w",
      target,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...extra,
    }) as KeyboardEvent;

  it("lets map keys through outside text fields", () => {
    expect(isTravelKeyBlocked(press(document.body))).toBe(false);
  });

  it("ignores keys typed into chat and other text fields", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const word = document.createElement("p");
    editor.append(word);
    expect(isTravelKeyBlocked(press(word))).toBe(true);
    expect(isTravelKeyBlocked(press(document.createElement("textarea")))).toBe(true);
    expect(isTravelKeyBlocked(press(document.createElement("input")))).toBe(true);
  });

  it("ignores browser shortcuts and keys another handler already used", () => {
    expect(isTravelKeyBlocked(press(document.body, { ctrlKey: true }))).toBe(true);
    expect(isTravelKeyBlocked(press(document.body, { defaultPrevented: true }))).toBe(
      true,
    );
  });
});
