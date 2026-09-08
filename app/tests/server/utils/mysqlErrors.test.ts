// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  isMysqlDuplicateKeyError,
  retryOnDeadlock,
} from "@/server/utils/mysqlErrors";

describe("isMysqlDuplicateKeyError", () => {
  it("returns true for common MySQL duplicate messages", () => {
    expect(
      isMysqlDuplicateKeyError(
        new Error(
          "Duplicate entry 'x' for key 'BloodlineRolls.BloodlineRolls_natural_roll_per_user_key'",
        ),
      ),
    ).toBe(true);
    expect(isMysqlDuplicateKeyError(new Error("ER_DUP_ENTRY: duplicate"))).toBe(
      true,
    );
    expect(isMysqlDuplicateKeyError(new Error("UNIQUE constraint failed"))).toBe(
      true,
    );
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
