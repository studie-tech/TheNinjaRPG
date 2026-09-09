// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userData } from "@/drizzle/schema";
import { bankRouter, fetchUserBalances } from "@/server/api/routers/bank";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describe("fetchUserBalances", () => {
  it("selects only money and bank", async () => {
    const findFirst = vi.fn().mockResolvedValue({ money: 900, bank: 1100 });
    const client = { query: { userData: { findFirst } } };
    await expect(fetchUserBalances(client as never, "user-1")).resolves.toEqual({
      money: 900,
      bank: 1100,
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
      columns: { money: true, bank: true },
    });
  });

  it("throws when the user row is missing", async () => {
    const client = {
      query: { userData: { findFirst: vi.fn().mockResolvedValue(undefined) } },
    };
    await expect(fetchUserBalances(client as never, "missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

const caller = (userId: string) => callerFor(bankRouter, userId);

const seedUser = async (patch: Record<string, unknown> = {}) => {
  await insertUsers([
    {
      userId: "bank-user",
      username: "BankUser",
      money: 1000,
      bank: 2000,
      ...patch,
    } as never,
  ]);
};

describeWithDatabase("bank toBank/toPocket return committed balances", () => {
  beforeEach(async () => {
    await resetTables(userData);
  });

  it("deposits pocket ryo and returns the committed balances", async () => {
    await seedUser();
    const result = await (await caller("bank-user")).toBank({ amount: 250 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ money: 750, bank: 2250 });

    const database = await getTestDatabase();
    const [row] = await database
      .select({ money: userData.money, bank: userData.bank })
      .from(userData)
      .where(eq(userData.userId, "bank-user"));
    expect(row).toEqual({ money: 750, bank: 2250 });
  });

  it("withdraws bank ryo and returns the committed balances", async () => {
    await seedUser();
    const result = await (await caller("bank-user")).toPocket({ amount: 400 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ money: 1400, bank: 1600 });

    const database = await getTestDatabase();
    const [row] = await database
      .select({ money: userData.money, bank: userData.bank })
      .from(userData)
      .where(eq(userData.userId, "bank-user"));
    expect(row).toEqual({ money: 1400, bank: 1600 });
  });

  it("rejects a deposit when pocket funds are insufficient", async () => {
    await seedUser({ money: 10, bank: 2000 });
    const result = await (await caller("bank-user")).toBank({ amount: 50 });
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();

    const database = await getTestDatabase();
    const [row] = await database
      .select({ money: userData.money, bank: userData.bank })
      .from(userData)
      .where(eq(userData.userId, "bank-user"));
    expect(row).toEqual({ money: 10, bank: 2000 });
  });
});
