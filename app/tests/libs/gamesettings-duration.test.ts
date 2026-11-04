import { afterEach, beforeEach, describe, expect, it, setSystemTime, vi } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { lockWithGameTimer } from "@/libs/gamesettings";
import type { DrizzleClient } from "@/server/db";

const NOW = new Date("2026-10-21T12:00:00Z");
const dialect = new MySqlDialect();

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

const createClient = (name: string, elapsedMs: number) => {
  const findFirst = vi.fn().mockResolvedValue({
    id: "timer-id",
    name,
    value: 0,
    time: new Date(NOW.getTime() - elapsedMs),
  });
  const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  const client = {
    query: { gameSetting: { findFirst } },
    update,
  } as unknown as DrizzleClient;
  return { client, findFirst, update, set, where };
};

describe("lockWithGameTimer", () => {
  it("updates the same persisted key that it checked", async () => {
    const name = "transaction-sync-1h";
    const { client, findFirst, set, where } = createClient(name, 60 * 60_000);

    expect(await lockWithGameTimer(client, name, 60 * 60_000)).toBe(false);

    for (const [query] of findFirst.mock.calls as [{ where: SQL }][]) {
      expect(dialect.sqlToQuery(query.where).params).toEqual([name]);
    }
    expect(set).toHaveBeenCalledWith({ value: 0, time: NOW });
    const predicate = dialect.sqlToQuery(where.mock.calls[0]?.[0] as SQL);
    expect(predicate.sql).toBe("(`GameSetting`.`id` = ? and `GameSetting`.`time` = ?)");
    expect(predicate.params).toEqual(["timer-id", "2026-10-21 11:00:00.000"]);
  });

  it("does not update a timer while its duration has not elapsed", async () => {
    const { client, update } = createClient("transaction-sync-1h", 10 * 60_000);

    expect(await lockWithGameTimer(client, "transaction-sync-1h", 60 * 60_000)).toBeInstanceOf(Response);
    expect(update).not.toHaveBeenCalled();
  });

  it("reports remaining time from the duration rather than the key's label", async () => {
    const { client } = createClient("auction-expire-0.083m", 2 * 60_000);

    const response = await lockWithGameTimer(client, "auction-expire-0.083m", 5 * 60_000);

    expect(response).toBeInstanceOf(Response);
    if (response) {
      expect(await response.json()).toBe("Wait 2 mins, 59 secs before running again");
    }
  });
});
