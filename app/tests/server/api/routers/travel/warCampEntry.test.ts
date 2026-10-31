import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { IMG_AVATAR_DEFAULT, SECTOR_HEIGHT, SECTOR_WIDTH } from "@/drizzle/constants";
import { warCamp } from "@/drizzle/schema";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { travelRouter } from "@/server/api/routers/travel";
import type { DrizzleClient } from "@/server/db";
import { getSectorNeighborIds, invalidatePublishedMapCache } from "@/server/utils/sectorMap";
import { defaultWarRules } from "@/validators/war";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { callerForDatabase } from "../../../../setup/testDatabase";

const SECTOR = 1538;
const neighbors = getSectorNeighborIds(SECTOR);
const dialect = new MySqlDialect();
const reservedWar = {
  id: "war", status: "ACTIVE", attackerVillageId: "attacker", defenderVillageId: "defender",
  attackerWarHealth: 100, defenderWarHealth: 100, endedAt: null,
  combatStartedAt: new Date(Date.now() - 60_000), rules: defaultWarRules,
  warAllies: [], warMercenaries: [],
};
const makeMap = (width = SECTOR_WIDTH, height = SECTOR_HEIGHT): NormalizedSectorMap => ({
  formatVersion: 1, sector: SECTOR, name: "Test sector", width, height,
  anchors: [], objects: [], exits: [], metadata: { importedAt: "2026-01-01", source: "tiled" },
  tiles: Array.from({ length: width * height }, (_, index) => ({
    x: index % width, y: Math.floor(index / width), terrain: "ground", battleBiome: "ground",
    walkCost: 1, blocked: false, zone: "wilderness",
  })),
});

const fixture = ({ width = SECTOR_WIDTH, height = SECTOR_HEIGHT,
  reservedSectors = [] as number[], queued = false, settledVillage = "neutral",
  failedCampReads = 0,
} = {}) => {
  const reads: string[] = [];
  const campSectors: number[] = [];
  let writes = 0;
  let releaseUser!: () => void;
  let signalUserRead!: () => void;
  const userStarted = new Promise<void>((resolve) => { signalUserRead = resolve; });
  const userReady = new Promise<void>((resolve) => { releaseUser = resolve; });
  const user = {
    userId: "visitor", username: "Visitor", sector: SECTOR, villageId: "neutral",
    status: "AWAKE", updatedAt: new Date(), energyQueueHead: 0, energyQueueTail: queued ? 1 : 0,
    stealthActive: true, stealthActivatedAt: new Date(), stealth: 10_000,
    questData: [],
  };
  const readUser = async () => {
    reads.push("user");
    signalUserRead();
    await userReady;
    reads.push("user resolved");
    return user;
  };
  const sourceMap = makeMap(width, height);
  const client = {
    query: {
      userData: { findFirst: readUser },
      sectorMap: {
        findMany: async () => {
          reads.push("maps");
          return [SECTOR, ...Object.values(neighbors)].filter((sector) => sector >= 0).map((sector) => ({
            sector, version: 1, normalizedJson: sector === SECTOR ? sourceMap : makeMap(),
          }));
        },
        findFirst: async ({ where }: { where: SQL }) => {
          reads.push("map");
          const sector = Number(dialect.sqlToQuery(where).params[0]);
          return { sector, version: 1, normalizedJson: sector === SECTOR ? sourceMap : makeMap() };
        },
      },
      war: { findMany: async () => {
        reads.push("camp wars");
        if (campSectors.length <= failedCampReads) throw new Error("Camp admission unavailable");
        return reservedSectors.includes(campSectors.at(-1)!) ? [reservedWar] : [];
      } },
    },
    select: () => ({ from: (table: unknown) => table === warCamp
      ? { where: (condition: SQL) => {
          campSectors.push(Number(dialect.sqlToQuery(condition).params[0]));
          return {};
        } }
      : { innerJoin: () => ({ where: async () => { reads.push("mercenary"); return []; } }) },
    }),
    update: () => ({ set: () => ({ where: async () => { writes += 1; return { rowsAffected: 1 }; } }) }),
  } as unknown as DrizzleClient;
  stubProfile("fetchUser", readUser);
  stubProfile("fetchUpdatedUser", async () => ({ user: { ...user, villageId: settledVillage } }));
  const api = callerForDatabase(travelRouter, user.userId, client);
  const move = (longitude: number, latitude: number, curLongitude = longitude - 1, curLatitude = latitude) => api.moveInSector({
    sector: SECTOR, longitude, latitude, curLongitude, curLatitude,
    villageId: "neutral", level: 20, avatar: IMG_AVATAR_DEFAULT, avatarLight: IMG_AVATAR_DEFAULT, username: "Visitor",
  });
  return { api, move, reads, campSectors, userStarted, releaseUser, getWrites: () => writes };
};

beforeEach(() => invalidatePublishedMapCache());
afterEach(() => { resetServerModuleStubs(); invalidatePublishedMapCache(); });

describe("travel camp admission scheduling", () => {
  it("starts global-travel admission reads while the user read is still pending", async () => {
    const test = fixture();
    const pending = test.api.startGlobalMove({ sector: neighbors.east });
    await test.userStarted;
    expect(test.reads).toContain("camp wars");
    expect(test.reads).toContain("mercenary");
    expect(test.getWrites()).toBe(0);
    test.releaseUser();
    expect(await pending).toMatchObject({ success: true, data: { sector: neighbors.east, longitude: SECTOR_WIDTH / 2, latitude: SECTOR_HEIGHT / 2 } });
    expect(test.campSectors).toEqual([neighbors.east]);
    expect(test.getWrites()).toBe(1);
  });

  it("prefetches a default border crossing once alongside the user and maps", async () => {
    const test = fixture();
    const pending = test.move(SECTOR_WIDTH, 10);
    await test.userStarted;
    expect(test.reads).toEqual(["maps", "user", "camp wars", "mercenary"]);
    test.releaseUser();
    expect((await pending).data?.sector).toBe(neighbors.east);
    expect(test.campSectors).toEqual([neighbors.east]);
    expect(test.getWrites()).toBe(1);
  });

  it("does not read camp admission for an ordinary local step", async () => {
    const test = fixture();
    test.releaseUser();
    expect((await test.move(10, 10)).success).toBe(true);
    expect(test.campSectors).toEqual([]);
    expect(test.reads).not.toContain("mercenary");
  });

  it.each([0, 1])("allows a custom-map local step with an unused prediction (failed reads: %s)", async (failedCampReads) => {
    const test = fixture({ width: SECTOR_WIDTH + 1, failedCampReads });
    test.releaseUser();
    expect(await test.move(SECTOR_WIDTH, 10)).toMatchObject({ success: true, data: { sector: SECTOR } });
    expect(test.campSectors).toEqual([neighbors.east]);
    expect(test.getWrites()).toBe(1);
  });

  it.each([true, false])("fetches required admission after a failed prediction (reserved: %s)", async (reserved) => {
    const test = fixture({ failedCampReads: 1, reservedSectors: reserved ? [neighbors.east] : [] });
    test.releaseUser();
    expect((await test.move(SECTOR_WIDTH, 10)).success).toBe(!reserved);
    expect(test.campSectors).toEqual([neighbors.east, neighbors.east]);
    expect(test.getWrites()).toBe(reserved ? 0 : 1);
  });

  it("does not enter when both speculative and required admission reads fail", async () => {
    const test = fixture({ failedCampReads: 2 });
    test.releaseUser();
    await expect(test.move(SECTOR_WIDTH, 10)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(test.campSectors).toEqual([neighbors.east, neighbors.east]);
    expect(test.getWrites()).toBe(0);
  });

  it("uses serial admission when a custom-sized border was not predicted", async () => {
    const test = fixture({ width: 20, reservedSectors: [neighbors.east] });
    const pending = test.move(20, 10);
    await test.userStarted;
    expect(test.campSectors).toEqual([]);
    test.releaseUser();
    expect((await pending).success).toBe(false);
    expect(test.campSectors).toEqual([neighbors.east]);
    expect(test.reads.indexOf("camp wars")).toBeGreaterThan(test.reads.indexOf("user resolved"));
    expect(test.getWrites()).toBe(0);
  });

  it.each([true, false])("rechecks the actual custom-map destination when the prediction differs (reserved: %s)", async (reserved) => {
    const test = fixture({ width: SECTOR_WIDTH + 1, height: 20,
      reservedSectors: [reserved ? neighbors.north : neighbors.east],
    });
    test.releaseUser();
    const result = await test.move(SECTOR_WIDTH, 20, SECTOR_WIDTH, 19);
    expect(result.success).toBe(!reserved);
    expect(test.campSectors).toEqual([neighbors.east, neighbors.north]);
    expect(test.getWrites()).toBe(reserved ? 0 : 1);
  });

  it("discards speculative admission data when the move is not a valid crossing", async () => {
    const test = fixture();
    test.releaseUser();
    expect((await test.move(SECTOR_WIDTH, 10, 2, 10)).success).toBe(false);
    expect(test.campSectors).toEqual([neighbors.east]);
    expect(test.getWrites()).toBe(0);
  });

  it.each(["global", "crossing"])("evaluates %s admission against the settled user", async (kind) => {
    const test = fixture({ reservedSectors: [neighbors.east], queued: true, settledVillage: "attacker" });
    test.releaseUser();
    const result = kind === "global"
      ? await test.api.startGlobalMove({ sector: neighbors.east })
      : await test.move(SECTOR_WIDTH, 10);
    expect(result.success).toBe(true);
    expect(test.getWrites()).toBe(1);
    expect(test.campSectors).toEqual([neighbors.east]);
  });

  it.each(["global", "crossing"])("rejects outsider %s entry before a location write", async (kind) => {
    const test = fixture({ reservedSectors: [neighbors.east] });
    test.releaseUser();
    const result = kind === "global"
      ? await test.api.startGlobalMove({ sector: neighbors.east })
      : await test.move(SECTOR_WIDTH, 10);
    expect(result).toMatchObject({ success: false, message: "This sector is reserved for participants in an active war camp." });
    expect(test.getWrites()).toBe(0);
  });
});
