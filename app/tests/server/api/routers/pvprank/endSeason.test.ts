import { afterEach, describe, expect, it, vi } from "bun:test";
import { pvpRankRouter } from "@/server/api/routers/pvprank";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { callerForDatabase } from "../../../../setup/testDatabase";

/** Ending a season is a content-editor action on a season that must still be running. */
const endSeasonAs = (
  role: string,
  season: { id: string; ended: boolean } | undefined,
) => {
  stubProfile("fetchUser", async () => ({ role }));
  const database = {
    query: { rankedSeason: { findFirst: vi.fn().mockResolvedValue(season) } },
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  };
  const caller = callerForDatabase(pvpRankRouter, "season-editor", database as never);
  return { result: caller.endSeason({ id: "season" }), database };
};

describe("ending a ranked season", () => {
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it.each([
    [
      "USER",
      { id: "season", ended: false },
      "You don't have permission to end ranked seasons",
    ],
    ["USER", undefined, "You don't have permission to end ranked seasons"],
    ["OWNER", undefined, "Season not found"],
    ["OWNER", { id: "season", ended: true }, "Season already ended"],
  ] as const)("answers %s for season %o with %s", async (role, season, message) => {
    const { result, database } = endSeasonAs(role, season);
    expect(await result).toEqual({ success: false, message });
    expect(database.update).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.delete).not.toHaveBeenCalled();
  });
});
