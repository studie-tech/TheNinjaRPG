import { beforeEach, describe, expect, it, vi } from "bun:test";

import { eq, sql } from "drizzle-orm";
import { RYO_CAP } from "@/drizzle/constants";
import { bankTransfers, userData } from "@/drizzle/schema";
import { fetchBankAccount } from "@/queries/bank";
import { bankRouter } from "@/server/api/routers/bank";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describe("fetchBankAccount", () => {
  it("selects only the balances, name and bank access state", async () => {
    const account = {
      username: "BankUser",
      money: 900,
      bank: 1100,
      isBanned: false,
      status: "AWAKE" as const,
    };
    const findFirst = vi.fn().mockResolvedValue(account);
    const client = { query: { userData: { findFirst } } };
    await expect(fetchBankAccount(client as never, "user-1")).resolves.toEqual(account);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
      columns: {
        username: true,
        money: true,
        bank: true,
        isBanned: true,
        status: true,
      },
    });
  });

  it("throws when the user row is missing", async () => {
    const client = {
      query: { userData: { findFirst: vi.fn().mockResolvedValue(undefined) } },
    };
    await expect(fetchBankAccount(client as never, "missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

const caller = (userId: string) => callerFor(bankRouter, userId);

const seedUsers = async (patch: Record<string, unknown> = {}) => {
  await insertUsers([
    {
      userId: "bank-user",
      username: "BankUser",
      money: 1000,
      bank: 2000,
      ...patch,
    } as never,
    { userId: "bank-target", username: "BankTarget", money: 0, bank: 300 } as never,
  ]);
};

const readBalances = async (userId = "bank-user") => {
  const database = await getTestDatabase();
  const [row] = await database
    .select({ money: userData.money, bank: userData.bank })
    .from(userData)
    .where(eq(userData.userId, userId));
  return row;
};

/** Spend `amount` of a column on the same connection, between the caller's read and write. */
const spend = async (column: "money" | "bank", amount: number) => {
  const database = await getTestDatabase();
  await database
    .update(userData)
    .set({ [column]: sql`${userData[column]} - ${amount}` })
    .where(eq(userData.userId, "bank-user"));
};

describeWithDatabase("bank toBank/toPocket/transfer return committed deltas", () => {
  beforeEach(async () => {
    await resetTables(bankTransfers, userData);
  });

  it("deposits pocket ryo and returns the committed delta", async () => {
    await seedUsers();
    const result = await (await caller("bank-user")).toBank({ amount: 250 });
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({ money: -250, bank: 250 });
    expect(await readBalances()).toEqual({ money: 750, bank: 2250 });
  });

  it("withdraws bank ryo and returns the committed delta", async () => {
    await seedUsers();
    const result = await (await caller("bank-user")).toPocket({ amount: 400 });
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({ money: 400, bank: -400 });
    expect(await readBalances()).toEqual({ money: 1400, bank: 1600 });
  });

  it("returns the clamped deposit when the bank is near the ryo cap", async () => {
    await seedUsers({ bank: RYO_CAP - 30 });
    const result = await (await caller("bank-user")).toBank({ amount: 250 });
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({ money: -30, bank: 30 });
    expect(await readBalances()).toEqual({ money: 970, bank: RYO_CAP });
  });

  it("rejects a deposit when pocket funds are insufficient", async () => {
    await seedUsers({ money: 10, bank: 2000 });
    const result = await (await caller("bank-user")).toBank({ amount: 50 });
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    expect(await readBalances()).toEqual({ money: 10, bank: 2000 });
  });

  it("debits the sender, credits the target and returns the sender's delta", async () => {
    await seedUsers();
    const result = await (await caller("bank-user")).transfer({
      amount: 500,
      targetId: "bank-target",
    });
    expect(result).toEqual({
      success: true,
      message: "Successfully transferred 500 ryo to BankTarget",
      userDelta: { bank: -500 },
    });
    expect(await readBalances()).toEqual({ money: 1000, bank: 1500 });
    expect(await readBalances("bank-target")).toEqual({ money: 0, bank: 800 });
  });

  for (const [endpoint, column] of [
    ["toBank", "money"],
    ["toPocket", "bank"],
  ] as const) {
    it(`${endpoint} returns no delta when the source was spent after the read`, async () => {
      await seedUsers();
      const database = await getTestDatabase();
      const racing = beforeStatements(
        database,
        userData,
        [() => spend(column, column === "money" ? 900 : 1900)],
        {
          operations: ["update"],
        },
      );
      const stale = callerForDatabase(bankRouter, "bank-user", racing);
      const result = await stale[endpoint]({ amount: 200 });
      expect(result.success).toBe(false);
      expect(result.userDelta).toBeUndefined();
      expect(await readBalances()).toEqual(
        column === "money" ? { money: 100, bank: 2000 } : { money: 1000, bank: 100 },
      );
    });
  }

  it("rejects a transfer to yourself before moving ryo or writing the ledger", async () => {
    await seedUsers();
    const result = await (await caller("bank-user")).transfer({
      amount: 400,
      targetId: "bank-user",
    });
    expect(result.success).toBe(false);
    expect(result.message).toBe("Cannot transfer to yourself");
    expect(result.userDelta).toBeUndefined();
    expect(await readBalances()).toEqual({ money: 1000, bank: 2000 });
    const database = await getTestDatabase();
    expect(await database.select().from(bankTransfers)).toEqual([]);
  });

  it("transfer credits nobody when the sender's bank was spent after the read", async () => {
    await seedUsers();
    const database = await getTestDatabase();
    const racing = beforeStatements(database, userData, [() => spend("bank", 1900)], {
      operations: ["update"],
    });
    const stale = callerForDatabase(bankRouter, "bank-user", racing);
    const result = await stale.transfer({ amount: 500, targetId: "bank-target" });
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    expect(await readBalances()).toEqual({ money: 1000, bank: 100 });
    expect(await readBalances("bank-target")).toEqual({ money: 0, bank: 300 });
    expect(await database.select().from(bankTransfers)).toEqual([]);
  });
});
