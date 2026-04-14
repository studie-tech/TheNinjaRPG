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
  it("resets user statuses before deleting children, both gated by isNull(battleId) subquery, parent last", async () => {
    const staleLobbies = createSelectChain([{ id: "lobby-1" }, { id: "lobby-2" }]);
    // unclaimedSubquery builder — not awaited
    const unclaimedChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ __unclaimedSubquery: true }),
      }),
    };
    // unclaimedUsersSubquery builder — not awaited
    const unclaimedUsersChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ __unclaimedUsersSubquery: true }),
      }),
    };
    const updateWhere = vi.fn().mockResolvedValue({ rowsAffected: 2 });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const deleteLobbyUsersWhere = vi.fn().mockResolvedValue({ rowsAffected: 3 });
    const deleteLobbiesWhere = vi.fn().mockResolvedValue({ rowsAffected: 2 });

    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(staleLobbies.chain)  // 1: initial stale lobby fetch (awaited)
        .mockReturnValueOnce(unclaimedChain)       // 2: unclaimedSubquery (not awaited)
        .mockReturnValueOnce(unclaimedUsersChain), // 3: unclaimedUsersSubquery (not awaited)
      update: vi.fn().mockReturnValue({ set: updateSet }),
      delete: vi
        .fn()
        .mockReturnValueOnce({ where: deleteLobbyUsersWhere }) // 1st: mpvpBattleUser (children)
        .mockReturnValueOnce({ where: deleteLobbiesWhere }),   // 2nd: mpvpBattleQueue (parent)
    };

    const result = await runStaleShrineLobbyCleanup(new Date("2026-04-12T12:00:00.000Z"), db);

    expect(result).toEqual({ lobbiesCleared: 2, usersReset: 2 });

    // userData must be reset BEFORE mpvpBattleUser is deleted — the update's
    // subquery reads from mpvpBattleUser, so if the delete ran first the subquery
    // would return zero rows and users would stay QUEUED permanently.
    // mpvpBattleQueue (parent) must be deleted last.
    expect(db.delete).toHaveBeenNthCalledWith(1, mpvpBattleUser);
    expect(db.delete).toHaveBeenNthCalledWith(2, mpvpBattleQueue);

    expect(db.update).toHaveBeenCalledWith(userData);
    expect(updateSet).toHaveBeenCalledWith({ status: "AWAKE" });

    expect(deleteLobbyUsersWhere).toHaveBeenCalledTimes(1);
    expect(deleteLobbiesWhere).toHaveBeenCalledTimes(1);
    expect(updateWhere).toHaveBeenCalledTimes(1);

    // Three select calls: initial fetch + two subquery builders (unclaimedSubquery,
    // unclaimedUsersSubquery). Both subqueries re-check isNull(battleId) at
    // execution time, preventing child cleanup of concurrently-claimed lobbies.
    expect(db.select).toHaveBeenCalledTimes(3);
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
