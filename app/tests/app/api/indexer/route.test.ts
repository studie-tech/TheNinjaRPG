import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { GET } from "@/app/api/indexer/route";
import * as reportSearch from "@/libs/moderation/reportSearch";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../../setup/serverModules";

const NOW = new Date("2026-10-21T12:00:00Z");

beforeEach(() => {
  setSystemTime(NOW);
  stubCronAuth(() => null);
});

afterEach(() => {
  setSystemTime();
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

const setup = (elapsedMs: number) => {
  const update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    }),
  });
  const reports = vi.fn().mockResolvedValue([]);
  stubDatabase({
    query: {
      gameSetting: {
        findFirst: vi.fn().mockResolvedValue({
          id: "timer-id",
          name: "indexer-1m",
          value: 0,
          time: new Date(NOW.getTime() - elapsedMs),
        }),
      },
      userReport: { findMany: reports },
    },
    update,
  });
  const index = vi
    .spyOn(reportSearch, "indexReportEmbeddings")
    .mockResolvedValue(undefined);
  return { update, reports, index };
};

it("runs the indexer when its existing timer is two minutes old", async () => {
  const { update, reports, index } = setup(2 * 60_000);

  const response = await GET(new Request("https://example.com/api/indexer"));

  expect(await response.json()).toBe("OK");
  expect(update).toHaveBeenCalledTimes(1);
  expect(reports).toHaveBeenCalledTimes(1);
  expect(index).toHaveBeenCalledTimes(1);
});

it("keeps recent indexer calls throttled before querying reports", async () => {
  const { update, reports, index } = setup(30_000);

  const response = await GET(new Request("https://example.com/api/indexer"));

  expect(await response.json()).toContain("before running again");
  expect(update).not.toHaveBeenCalled();
  expect(reports).not.toHaveBeenCalled();
  expect(index).not.toHaveBeenCalled();
});
