import { afterEach, expect, it, vi } from "bun:test";
import type { Redis } from "@upstash/redis";
import * as Sentry from "@sentry/nextjs";
import type { CombatResult, ReturnedBattle } from "@/libs/combat/types";
import { createCombatCompletionStore } from "@/server/utils/combatCompletion";
import { makeCompleteBattle } from "../../setup/combat";
import { hasLocalRedis, startLocalRedis } from "../../setup/localRedis";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const fixture = () => {
  const entries = new Map<string, unknown>();
  const set = vi.fn(async (key: string, value: unknown, _options: { ex: number }) => {
    entries.set(key, value);
    return "OK";
  });
  const get = vi.fn(async (key: string) => entries.get(key) ?? null);
  const store = createCombatCompletionStore({ get, set } as unknown as Redis);
  const battle = makeCompleteBattle({
    id: "arena-result",
    battleType: "ARENA",
    updatedAt: new Date("2026-11-06T10:00:00Z"),
  }) as unknown as ReturnedBattle;
  const result = { outcome: "Won", money: 58, experience: 5.45 } as CombatResult;
  return { store, battle, result, get, set, entries };
};

it("retains a dated arena result for ten minutes and permits repeated display without consuming it", async () => {
  const { store, battle, result, set } = fixture();
  await store.save("player", battle, result);
  expect(set.mock.calls[0]?.[2]).toEqual({ ex: 600 });
  const first = await store.recover("player", battle.id);
  expect(first).toEqual({ battle, result });
  expect(first?.battle.updatedAt).toBeInstanceOf(Date);
  expect(await store.recover("player", battle.id)).toEqual(first);
  expect(set).toHaveBeenCalledTimes(1);
});

it("never returns another player's receipt or a different battle's result", async () => {
  vi.useFakeTimers();
  const { store, battle, result } = fixture();
  await store.save("player", battle, result);
  const otherPlayer = store.recover("other-player", battle.id);
  await Promise.resolve();
  vi.runAllTimers();
  expect(await otherPlayer).toBeNull();
  const otherBattle = store.recover("player", "another-battle");
  await Promise.resolve();
  vi.runAllTimers();
  expect(await otherBattle).toBeNull();
});

it("waits for the winning request to finish publishing its result", async () => {
  vi.useFakeTimers();
  const { store, battle, result } = fixture();
  const recovery = store.recover("player", battle.id);
  await store.save("player", battle, result);
  vi.runAllTimers();
  expect(await recovery).toEqual({ battle, result });
});

it("adds no receipt writes for ongoing turns or other battle types", async () => {
  const { store, battle, result, set } = fixture();
  await store.save("player", battle, null);
  await store.save("player", { ...battle, battleType: "COMBAT" }, result);
  expect(set).not.toHaveBeenCalled();
});

it("keeps committed action responses usable when receipt storage is unavailable", async () => {
  const { store, battle, result, get, set } = fixture();
  const report = vi.spyOn(Sentry, "captureException").mockReturnValue("event");
  set.mockRejectedValue(new Error("Redis unavailable"));
  get.mockRejectedValue(new Error("Redis unavailable"));
  await expect(store.save("player", battle, result)).resolves.toBeUndefined();
  expect(await store.recover("player", battle.id)).toBeNull();
  expect(get).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledTimes(2);
});

it.skipIf(!hasLocalRedis)(
  "round trips through the production Redis client with a bounded expiry",
  async () => {
    const { redis, close } = await startLocalRedis("combat-completion");
    const { battle, result } = fixture();
    const store = createCombatCompletionStore(redis);
    try {
      await store.save("player", battle, result);
      expect(await store.recover("player", battle.id)).toEqual({ battle, result });
      const [key] = await redis.keys("combat-completion:*");
      expect(key).toBeDefined();
      const ttl = await redis.ttl(key!);
      expect(ttl).toBeGreaterThan(590);
      expect(ttl).toBeLessThanOrEqual(600);
    } finally {
      close();
    }
  },
);
