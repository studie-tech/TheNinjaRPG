import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { GET as dailyPvp } from "@/app/api/daily-pvp/route";
import { GET as weeklyPvp } from "@/app/api/weekly-pvp/route";
import { anbuSquad, clan, gameSetting, userData } from "@/drizzle/schema";
import * as gameSettings from "@/libs/gamesettings";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../../setup/serverModules";

type PvpResetTestMocks = {
  dailyLock: ReturnType<typeof vi.fn>;
  weeklyLock: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  handleError: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  getSetting: ReturnType<typeof vi.fn>;
  updates: { table: unknown; set: Record<string, unknown> }[];
  /** rowsAffected answered for the next GameSetting marker claim. */
  markerClaimRows: number;
  /** Player ids the decay candidate read returns. */
  candidates: string[];
};

const mocks: PvpResetTestMocks = {
  dailyLock: vi.fn(),
  weeklyLock: vi.fn(),
  rollback: vi.fn(),
  handleError: vi.fn(),
  update: vi.fn(),
  getSetting: vi.fn(),
  updates: [],
  markerClaimRows: 1,
  candidates: [],
};

const cronRequest = (path: string) => new Request(`https://example.com/api/${path}`);

const setsFor = (table: unknown) =>
  mocks.updates.filter((u) => u.table === table).map((u) => u.set);
const userDataSets = () => setsFor(userData);

describe("PvP reset crons", () => {
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(gameSettings, "lockWithDailyTimer").mockImplementation(mocks.dailyLock);
    vi.spyOn(gameSettings, "lockWithWeeklyTimer").mockImplementation(mocks.weeklyLock);
    vi.spyOn(gameSettings, "handleEndpointError").mockImplementation(mocks.handleError);
    vi.spyOn(gameSettings, "getGameSetting").mockImplementation(mocks.getSetting);
    stubCronAuth(() => null);
    const update = mocks.update;
    stubDatabase({
      update,
      transaction: (run: (tx: unknown) => Promise<unknown>) => run({ update }),
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(mocks.candidates.map((userId) => ({ userId }))),
        }),
      }),
    });
    for (const mock of [
      mocks.dailyLock,
      mocks.weeklyLock,
      mocks.rollback,
      mocks.handleError,
      mocks.update,
      mocks.getSetting,
    ]) {
      mock.mockReset();
    }
    mocks.updates.length = 0;
    mocks.markerClaimRows = 1;
    mocks.candidates = ["user-1"];
    mocks.getSetting.mockResolvedValue({
      id: "marker",
      name: "daily-pvp-group-decay",
      time: new Date(0),
      value: 0,
    });
    mocks.dailyLock.mockResolvedValue({
      release: mocks.rollback,
      isClaimed: true,
      isNewDay: true,
      prevTime: 1,
    });
    mocks.weeklyLock.mockResolvedValue({
      release: mocks.rollback,
      isClaimed: true,
      isNewWeek: true,
      prevTime: 1,
    });
    // Bulk updates are awaited either directly or after .where().
    mocks.update.mockImplementation((table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        mocks.updates.push({ table, set });
        const result = Promise.resolve({ rowsAffected: 1 });
        const rowsAffected = table === gameSetting ? mocks.markerClaimRows : 1;
        return Object.assign(result, {
          where: vi.fn().mockResolvedValue({ rowsAffected }),
        });
      },
    }));
  });

  // updatedAt is every player's last activity: online counts, the online record,
  // inactive-account cleanup and sector lists all read it. A bulk bump marks every
  // account as online at once.
  it("daily decay does not mark every player as recently active", async () => {
    const response = await dailyPvp(cronRequest("daily-pvp"));

    expect(await response.json()).toBe("OK");
    const [decay] = userDataSets();
    expect(decay).toHaveProperty("pvpExperience");
    expect(decay).toHaveProperty("pvpExperienceDecayAt");
    expect(decay).not.toHaveProperty("updatedAt");
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  // THENINJARPG-340: the endpoint timer is released on failure, so the next tick reruns
  // the job. Clan/ANBU decay must not be applied again on that retry.
  it("skips clan and ANBU decay when today's marker is already set", async () => {
    mocks.getSetting.mockResolvedValue({
      id: "marker",
      name: "daily-pvp-group-decay",
      time: new Date(Date.now() + 60_000),
      value: 0,
    });

    const response = await dailyPvp(cronRequest("daily-pvp"));

    expect(await response.json()).toBe("OK");
    expect(setsFor(clan)).toHaveLength(0);
    expect(setsFor(anbuSquad)).toHaveLength(0);
    expect(userDataSets()).toHaveLength(1);
  });

  it("skips clan and ANBU decay when another run claimed the marker first", async () => {
    mocks.markerClaimRows = 0;

    const response = await dailyPvp(cronRequest("daily-pvp"));

    expect(await response.json()).toBe("OK");
    expect(setsFor(gameSetting)).toHaveLength(1);
    expect(setsFor(clan)).toHaveLength(0);
    expect(setsFor(anbuSquad)).toHaveLength(0);
  });

  it("applies clan and ANBU decay once and decays players in batches", async () => {
    mocks.candidates = Array.from({ length: 2500 }, (_, i) => `user-${i}`);

    const response = await dailyPvp(cronRequest("daily-pvp"));

    expect(await response.json()).toBe("OK");
    expect(setsFor(clan)).toHaveLength(1);
    expect(setsFor(anbuSquad)).toHaveLength(1);
    expect(userDataSets()).toHaveLength(3);
  });

  it("weekly kill reset does not mark every player as recently active", async () => {
    const response = await weeklyPvp(cronRequest("weekly-pvp"));

    expect(await response.json()).toBe("OK");
    const [reset] = userDataSets();
    expect(reset).toMatchObject({ weeklyPvpKills: 0 });
    expect(reset).not.toHaveProperty("updatedAt");
    expect(mocks.rollback).not.toHaveBeenCalled();
  });
});
