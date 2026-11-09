import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { Battle } from "@/drizzle/schema";
import type { CompleteBattle } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import { combatRouter } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { makeCompleteBattle, makeUser } from "../../../../setup/combat";
import { resolverOf } from "../../../../setup/testDatabase";

const userId = "ready-player";
const battleId = "ready-battle";

// Exercise the resolver's retry contract without replacing shared server modules.
const readyResolver = resolverOf(combatRouter.iAmHere);

describe("combat lobby readiness retries", () => {
  beforeEach(() => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("marks ready with one read and one guarded write when uncontended", async () => {
    const lobby = makeLobby();
    const result = await lobby.ready();
    expect(result.success).toBe(true);
    expect(lobby.read).toHaveBeenCalledTimes(1);
    expect(lobby.write).toHaveBeenCalledTimes(1);
    expect(lobby.saved?.usersState.map((user) => user.iAmHere)).toEqual([true, false]);
    expect(lobby.saved?.version).toBe(2);
    expect(Pusher.prototype.trigger).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2])(
    "reads once per attempt after %i concurrent updates and preserves the opponent's readiness",
    async (conflicts) => {
      const lobby = makeLobby((state, attempt) => {
        if (attempt > conflicts) return false;
        state.saved!.usersState[1]!.iAmHere = true;
        state.saved!.version++;
        return true;
      });
      const before = new Date();
      const result = await lobby.ready();
      expect(result.success).toBe(true);
      expect(lobby.read).toHaveBeenCalledTimes(conflicts + 1);
      expect(lobby.write).toHaveBeenCalledTimes(conflicts + 1);
      expect(lobby.saved?.usersState.every((user) => user.iAmHere)).toBe(true);
      expect(lobby.saved?.version).toBe(conflicts + 2);
      expect(lobby.saved!.roundStartAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(lobby.saved!.roundStartAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(Pusher.prototype.trigger).toHaveBeenCalledTimes(1);
    },
  );

  it("stops after three conflicts without broadcasting an unsaved readiness change", async () => {
    const lobby = makeLobby((state) => {
      state.saved!.version++;
      return true;
    });
    expect(await lobby.ready()).toMatchObject({
      success: false,
      message: "Someone else updated the battle state",
    });
    expect(lobby.read).toHaveBeenCalledTimes(3);
    expect(lobby.write).toHaveBeenCalledTimes(3);
    expect(lobby.saved?.usersState[0]?.iAmHere).toBe(false);
    expect(Pusher.prototype.trigger).not.toHaveBeenCalled();
  });

  it("does not retry a failed write when the stored version did not change", async () => {
    const lobby = makeLobby(() => true);
    expect(await lobby.ready()).toMatchObject({
      success: false,
      message: "Battle state could not be updated",
    });
    expect(lobby.read).toHaveBeenCalledTimes(2);
    expect(lobby.write).toHaveBeenCalledTimes(1);
    expect(Pusher.prototype.trigger).not.toHaveBeenCalled();
  });

  it("stops if the battle disappears after a failed write", async () => {
    const lobby = makeLobby((state) => {
      state.saved = null;
      return true;
    });
    expect(await lobby.ready()).toMatchObject({ success: false });
    expect(lobby.read).toHaveBeenCalledTimes(2);
    expect(lobby.write).toHaveBeenCalledTimes(1);
    expect(Pusher.prototype.trigger).not.toHaveBeenCalled();
  });

  it.each(["removed", "already ready", "started"] as const)(
    "rechecks the %s participant state in the conflict snapshot before another write",
    async (change) => {
      const lobby = makeLobby((state) => {
        const saved = state.saved!;
        saved.version++;
        if (change === "removed") saved.usersState.shift();
        else if (change === "already ready") saved.usersState[0]!.iAmHere = true;
        else saved.roundStartAt = new Date(0);
        return true;
      });
      expect((await lobby.ready()).success).toBe(change !== "removed");
      expect(lobby.read).toHaveBeenCalledTimes(2);
      expect(lobby.write).toHaveBeenCalledTimes(1);
      expect(Pusher.prototype.trigger).not.toHaveBeenCalled();
    },
  );
});

const makeLobby = (
  beforeWrite?: (state: { saved: CompleteBattle | null }, attempt: number) => boolean,
) => {
  const state = {
    saved: makeCompleteBattle({
      id: battleId,
      version: 1,
      roundStartAt: new Date(Date.now() + 60_000),
      usersState: [
        makeUser({ userId, controllerId: userId, iAmHere: false }),
        makeUser({ userId: "opponent", controllerId: "opponent", iAmHere: false }),
      ],
    }) as CompleteBattle | null,
  };
  // Reads are independent snapshots; failed CAS writes must never leak their edits.
  const read = vi.fn(async () => structuredClone(state.saved));
  const write = vi.fn(
    async (values: Partial<Battle>, where: SQL): Promise<{ rowsAffected: number }> => {
      const { params } = new MySqlDialect().sqlToQuery(where);
      expect(params).toEqual([battleId, values.version! - 1]);
      if (beforeWrite?.(state, write.mock.calls.length)) return { rowsAffected: 0 };
      if (!state.saved || state.saved.version !== values.version! - 1)
        return { rowsAffected: 0 };
      Object.assign(state.saved, structuredClone(values));
      return { rowsAffected: 1 };
    },
  );
  const client = {
    query: { battle: { findFirst: read } },
    update: () => ({
      set: (values: Partial<Battle>) => ({
        where: (where: SQL) => write(values, where),
      }),
    }),
  } as unknown as DrizzleClient;
  return Object.assign(state, {
    read,
    write,
    ready: () =>
      readyResolver({
        ctx: { drizzle: client, userId },
        input: { battleId },
        type: "mutation",
        path: "combat.iAmHere",
      }),
  });
};
