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

// Partial-mock drizzle-orm so inArray() returns a distinctive sentinel when
// called with a non-array (i.e., a subquery builder). This lets the test
// assert that the stale-lobby cleanup gates its user-row delete through a
// subquery — without which a concurrent initiateShrineBattle claim could
// strand a live battle with zero mpvpBattleUser rows.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: (column: unknown, values: unknown) => {
      if (Array.isArray(values)) {
        return (actual.inArray as (c: unknown, v: unknown) => unknown)(column, values);
      }
      return { __isSubqueryGuard: true };
    },
  };
});

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
    // The user-row delete must be gated by the subquery; regression guard
    // against anyone reverting to inArray(..., staleIds) on this delete.
    expect(db.select).toHaveBeenCalledTimes(3);
    expect(deleteLobbyUsersWhere).toHaveBeenCalledWith(
      expect.objectContaining({ __isSubqueryGuard: true }),
    );
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
