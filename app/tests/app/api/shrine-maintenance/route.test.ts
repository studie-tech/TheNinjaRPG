import { describe, expect, it, vi } from "vitest";
import { mpvpBattleQueue, mpvpBattleUser, userData } from "@/drizzle/schema";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/libs/gamesettings", () => ({
  handleEndpointError: vi.fn(),
  lockWithDailyTimer: vi.fn(),
  lockWithMinuteTimer: vi.fn(),
  updateGameSetting: vi.fn(),
}));

vi.mock("@/server/api/routers/village", () => ({
  fetchVillages: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  drizzleDB: {},
}));

import { runStaleShrineLobbyCleanup } from "@/app/api/shrine-maintenance/route";

function createSelectChain<T>(rows: T[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  return { chain: { from }, where };
}

describe("runStaleShrineLobbyCleanup", () => {
  it("resets queued users and clears stale shrine lobbies, gating user delete with a subquery", async () => {
    const staleLobbies = createSelectChain([{ id: "lobby-1" }, { id: "lobby-2" }]);
    const queuedUsers = createSelectChain([
      { userId: "user-1" },
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    const stillStaleSubqueryChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ __subqueryBuilder: true }),
      }),
    };
    const updateWhere = vi.fn().mockResolvedValue({ rowsAffected: 2 });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const deleteLobbyUsersWhere = vi.fn().mockResolvedValue({ rowsAffected: 3 });
    const deleteLobbiesWhere = vi.fn().mockResolvedValue({ rowsAffected: 2 });

    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(staleLobbies.chain)
        .mockReturnValueOnce(queuedUsers.chain)
        .mockReturnValueOnce(stillStaleSubqueryChain),
      update: vi.fn().mockReturnValue({ set: updateSet }),
      delete: vi
        .fn()
        .mockReturnValueOnce({ where: deleteLobbyUsersWhere })
        .mockReturnValueOnce({ where: deleteLobbiesWhere }),
    };

    const result = await runStaleShrineLobbyCleanup(new Date("2026-04-12T12:00:00.000Z"), db);

    expect(result).toEqual({ lobbiesCleared: 2, usersReset: 2 });
    expect(db.update).toHaveBeenCalledWith(userData);
    expect(updateSet).toHaveBeenCalledWith({ status: "AWAKE" });
    expect(db.delete).toHaveBeenNthCalledWith(1, mpvpBattleUser);
    expect(db.delete).toHaveBeenNthCalledWith(2, mpvpBattleQueue);
    // The user-row delete must be gated by a subquery (third db.select call),
    // not a flat inArray(..., staleIds). If anyone reverts that, db.select
    // will only be called twice and this assertion fails.
    expect(db.select).toHaveBeenCalledTimes(3);
    expect(deleteLobbyUsersWhere).toHaveBeenCalledTimes(1);
  });

  it("returns zero counts when no stale shrine lobbies exist", async () => {
    const staleLobbies = createSelectChain<{ id: string }>([]);
    const db = {
      select: vi.fn().mockReturnValue(staleLobbies.chain),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const result = await runStaleShrineLobbyCleanup(new Date("2026-04-12T12:00:00.000Z"), db);

    expect(result).toEqual({ lobbiesCleared: 0, usersReset: 0 });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });
});
