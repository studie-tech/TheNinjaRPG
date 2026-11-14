import { describe, expect, it, vi } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";

describe("isMysqlDuplicateKeyError", () => {
  it("returns true for common MySQL duplicate messages", () => {
    expect(
      isMysqlDuplicateKeyError(
        new Error(
          "Duplicate entry 'x' for key 'BloodlineRolls.BloodlineRolls_natural_roll_per_user_key'",
        ),
      ),
    ).toBe(true);
    expect(isMysqlDuplicateKeyError(new Error("ER_DUP_ENTRY: duplicate"))).toBe(true);
    expect(isMysqlDuplicateKeyError(new Error("UNIQUE constraint failed"))).toBe(true);
  });

  it("returns true when Drizzle wraps the driver error as Failed query", () => {
    const driver = new Error(
      "Duplicate entry 'raid-quest-1-raid-user' for key 'RaidParticipation.RaidParticipation_questId_userId'",
    );
    (driver as { sqlMessage?: string }).sqlMessage =
      "Duplicate entry 'raid-quest-1-raid-user' for key 'RaidParticipation.RaidParticipation_questId_userId'";
    expect(
      isMysqlDuplicateKeyError(
        new Error(
          "Failed query: insert into `RaidParticipation` (`id`, `questId`, `userId`) values (?, ?, ?)",
          { cause: driver },
        ),
      ),
    ).toBe(true);
  });

  it("returns true for a structured driver error down the cause chain", () => {
    const cause = Object.assign(new Error("insert failed"), { errno: 1062 });
    expect(isMysqlDuplicateKeyError(new Error("Failed query", { cause }))).toBe(true);
    expect(
      isMysqlDuplicateKeyError(
        Object.assign(new Error("insert failed"), { code: "ER_DUP_ENTRY" }),
      ),
    ).toBe(true);
  });

  it("ignores 1062 in query text, which can be a bound parameter", () => {
    expect(
      isMysqlDuplicateKeyError(new Error("Failed query: insert\nparams: txn-1062")),
    ).toBe(false);
  });

  it("returns false for unrelated errors and non-errors", () => {
    expect(isMysqlDuplicateKeyError(new Error("connection timeout"))).toBe(false);
    expect(isMysqlDuplicateKeyError(null)).toBe(false);
    expect(isMysqlDuplicateKeyError("Duplicate entry")).toBe(false);
  });
});

describe("retryOnDeadlock", () => {
  const deadlock = () =>
    new Error("Deadlock found when trying to get lock; try restarting transaction");

  it("runs the work again after a deadlock", async () => {
    let calls = 0;
    const value = await retryOnDeadlock(async () => {
      calls += 1;
      if (calls < 3) throw deadlock();
      return "done";
    });
    expect(value).toBe("done");
    expect(calls).toBe(3);
  });

  it("retries a mysql2 deadlock wrapped by Drizzle", async () => {
    let calls = 0;
    const result = await retryOnDeadlock(async () => {
      calls += 1;
      if (calls === 1)
        throw new DrizzleQueryError(
          "update UserData set status = ?, battleId = ? where userId = ?",
          ["BATTLE", "later-battle", "arena-ready"],
          Object.assign(deadlock(), { code: "ER_LOCK_DEADLOCK", errno: 1213 }),
        );
      return { rowsAffected: 1 };
    });
    expect(result.rowsAffected).toBe(1);
    expect(calls).toBe(2);
  });

  it("gives up after the last attempt", async () => {
    let calls = 0;
    await expect(
      retryOnDeadlock(async () => {
        calls += 1;
        throw deadlock();
      }, 2),
    ).rejects.toThrow(/Deadlock/);
    expect(calls).toBe(2);
  });

  it("backs off exponentially from the base delay plus jitter", async () => {
    const delays: (number | undefined)[] = [];
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      resolve: () => void,
      ms?: number,
    ) => {
      delays.push(ms);
      resolve();
    }) as unknown as typeof setTimeout);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    await expect(
      retryOnDeadlock(
        async () => {
          throw deadlock();
        },
        3,
        { baseDelayMs: 100, jitterMs: 100 },
      ),
    ).rejects.toThrow(/Deadlock/);
    timer.mockRestore();
    random.mockRestore();
    expect(delays).toEqual([150, 250]);
  });

  it("reports each retry with its backoff", async () => {
    const retries: [number, number][] = [];
    let calls = 0;
    await retryOnDeadlock(
      async () => {
        calls += 1;
        if (calls < 3) throw deadlock();
      },
      4,
      {
        baseDelayMs: 2,
        onRetry: (attempt, delayMs) => retries.push([attempt, delayMs]),
      },
    );
    expect(retries).toEqual([
      [1, 2],
      [2, 4],
    ]);
  });

  it("retries nothing else", async () => {
    let calls = 0;
    await expect(
      retryOnDeadlock(async () => {
        calls += 1;
        throw new Error("connection timeout");
      }),
    ).rejects.toThrow("connection timeout");
    expect(calls).toBe(1);
  });
});
