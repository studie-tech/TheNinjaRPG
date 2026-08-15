// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  lock: vi.fn(),
  rollback: vi.fn(),
  handleError: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  fetchMaps: vi.fn(),
  resolve: vi.fn(),
  snap: vi.fn(),
  updateSets: [] as Record<string, unknown>[],
}));

vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/utils/cron", () => ({
  authenticateCronRequest: mocks.authenticate,
}));
vi.mock("@/libs/gamesettings", () => ({
  lockWithDailyTimer: mocks.lock,
  updateGameSetting: mocks.rollback,
  handleEndpointError: mocks.handleError,
}));
vi.mock("@/libs/overworldAi", () => ({
  resolveOverworldPosition: mocks.resolve,
  snapOverworldPositionToWalkable: mocks.snap,
}));
vi.mock("@/server/utils/sectorMap", () => ({
  fetchPublishedSectorMaps: mocks.fetchMaps,
}));
vi.mock("@/server/db", () => ({
  drizzleDB: {
    query: { overworldAiPlacement: { findMany: mocks.findMany } },
    update: mocks.update,
  },
}));

import { GET } from "@/app/api/daily-overworld-ai/route";

const request = () => new Request("https://example.com/api/daily-overworld-ai");
const placement = (id: string, sector: number) => ({
  id,
  sector,
  longitude: 1,
  latitude: 2,
  sectorType: "specific",
  sectorList: [],
  locationType: "random",
});

describe("daily-overworld-ai route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSets.length = 0;
    mocks.authenticate.mockReturnValue(null);
    mocks.lock.mockResolvedValue({
      isNewDay: true,
      prevTime: new Date("2026-08-14T00:00:00.000Z"),
      response: new Response("locked"),
    });
    mocks.findMany.mockResolvedValue([placement("p1", 1), placement("p2", 2)]);
    mocks.resolve.mockImplementation((value: { sector: number }) => ({
      sector: value.sector,
      longitude: 3,
      latitude: 4,
    }));
    mocks.snap.mockImplementation((value: unknown) => value);
    mocks.handleError.mockResolvedValue(new Response("failed", { status: 500 }));
    mocks.update.mockImplementation(() => ({
      set: vi.fn((value: Record<string, unknown>) => {
        mocks.updateSets.push(value);
        return { where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
      }),
    }));
  });

  it("returns an authentication error before claiming the daily timer", async () => {
    mocks.authenticate.mockReturnValue(new Response("unauthorized", { status: 401 }));

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it("does no placement work when another invocation owns the daily timer", async () => {
    mocks.lock.mockResolvedValue({
      isNewDay: false,
      prevTime: new Date(),
      response: new Response("locked"),
    });

    expect(await (await GET(request())).text()).toBe("locked");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("validates every destination before writing, then rolls the timer back on failure", async () => {
    mocks.fetchMaps.mockResolvedValue(new Map([[1, { sector: 1 }]]));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });

  it("updates every validated placement and increments its position version", async () => {
    mocks.fetchMaps.mockResolvedValue(
      new Map([
        [1, { sector: 1 }],
        [2, { sector: 2 }],
      ]),
    );

    const response = await GET(request());

    await expect(response.json()).resolves.toBe("OK");
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.updateSets).toHaveLength(2);
    expect(mocks.updateSets[0]).toMatchObject({
      sector: 1,
      longitude: 3,
      latitude: 4,
      positionVersion: expect.anything(),
    });
    expect(mocks.rollback).not.toHaveBeenCalled();
  });
});
