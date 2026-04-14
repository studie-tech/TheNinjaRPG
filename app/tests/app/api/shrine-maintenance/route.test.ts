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
  it("deletes mpvpBattleQueue before children, gating child cleanup on the deleted ID set", async () => {
    const staleLobbies = createSelectChain([{ id: "lobby-1" }, { id: "lobby-2" }]);
    // deletedUsersSubquery builder — not awaited, used as inArray subquery
    const deletedUsersChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ __deletedUsersSubquery: true }),
      }),
    };
    const updateWhere = vi.fn().mockResolvedValue({ rowsAffected: 2 });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const deleteLobbiesWhere = vi.fn().mockResolvedValue({ rowsAffected: 2 });
    const deleteLobbyUsersWhere = vi.fn().mockResolvedValue({ rowsAffected: 3 });

    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(staleLobbies.chain)    // 1: initial stale lobby fetch (awaited)
        .mockReturnValueOnce(deletedUsersChain),    // 2: deletedUsersSubquery (not awaited)
      update: vi.fn().mockReturnValue({ set: updateSet }),
      delete: vi
        .fn()
        .mockReturnValueOnce({ where: deleteLobbiesWhere })   // 1st: mpvpBattleQueue (parent gate)
        .mockReturnValueOnce({ where: deleteLobbyUsersWhere }),// 2nd: mpvpBattleUser (children)
    };

    const result = await runStaleShrineLobbyCleanup(new Date("2026-04-12T12:00:00.000Z"), db);

    expect(result).toEqual({ lobbiesCleared: 2, usersReset: 2 });

    // Parent queue must be deleted FIRST — this is the atomic gate
    expect(db.delete).toHaveBeenNthCalledWith(1, mpvpBattleQueue);
    expect(db.delete).toHaveBeenNthCalledWith(2, mpvpBattleUser);

    // userData reset must target the correct table
    expect(db.update).toHaveBeenCalledWith(userData);
    expect(updateSet).toHaveBeenCalledWith({ status: "AWAKE" });

    // Both child operations must execute
    expect(deleteLobbiesWhere).toHaveBeenCalledTimes(1);
    expect(deleteLobbyUsersWhere).toHaveBeenCalledTimes(1);
    expect(updateWhere).toHaveBeenCalledTimes(1);
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

  it("returns zero counts when all candidate lobbies were claimed before the delete", async () => {
    const staleLobbies = createSelectChain([{ id: "lobby-1" }]);
    const deleteLobbiesWhere = vi.fn().mockResolvedValue({ rowsAffected: 0 });

    const db = {
      select: vi.fn().mockReturnValueOnce(staleLobbies.chain),
      update: vi.fn(),
      delete: vi.fn().mockReturnValueOnce({ where: deleteLobbiesWhere }),
    };

    const result = await runStaleShrineLobbyCleanup(new Date("2026-04-12T12:00:00.000Z"), db);

    expect(result).toEqual({ lobbiesCleared: 0, usersReset: 0 });
    expect(db.delete).toHaveBeenCalledWith(mpvpBattleQueue);
    expect(db.update).not.toHaveBeenCalled();
    // mpvpBattleUser must NOT be deleted when parent delete affected 0 rows
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
