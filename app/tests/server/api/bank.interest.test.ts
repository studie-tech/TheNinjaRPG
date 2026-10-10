/// <reference types="bun-types/test" />

import { setSystemTime } from "bun:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { RYO_CAP } from "@/drizzle/constants";
import { dailyBankInterest, userData } from "@/drizzle/schema";
import { bankRouter, claimBankInterest } from "@/server/api/routers/bank";
import { getBankInterestDateRange } from "@/utils/time";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describe("bank interest UTC window", () => {
  it.each([
    ["2026-09-27T00:00:00.000Z", "2026-09-20", "2026-09-27"],
    ["2026-09-27T23:59:59.999Z", "2026-09-20", "2026-09-27"],
    ["2026-09-28T00:00:00.000Z", "2026-09-21", "2026-09-28"],
    ["2026-01-03T12:00:00.000Z", "2025-12-27", "2026-01-03"],
    ["2024-03-01T12:00:00.000Z", "2024-02-23", "2024-03-01"],
  ])("uses eight inclusive dates at %s", (now, oldestDate, today) => {
    expect(getBankInterestDateRange(new Date(now))).toEqual({ oldestDate, today });
  });
});

describeWithDatabase("bank interest claims", () => {
  beforeEach(async () => {
    setSystemTime(new Date("2026-09-27T12:00:00Z"));
    await resetTables(dailyBankInterest, userData);
    await insertUsers([
      {
        userId: "interest-user",
        username: "InterestUser",
        bank: 1000,
        status: "AWAKE",
      },
    ]);
  });
  afterEach(() => setSystemTime());

  const seedInterest = async (days: number) => {
    const db = await getTestDatabase();
    await db.insert(dailyBankInterest).values(
      Array.from({ length: days }, (_, i) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - i);
        return {
          id: `interest-${i}`,
          userId: "interest-user",
          date: date.toISOString().slice(0, 10),
          amount: 100,
          interestPercent: 1,
        };
      }),
    );
    return db;
  };

  it("shows and pays only eight days from a 52-day backlog, regardless of updatedAt", async () => {
    const db = await seedInterest(52);
    const caller = await callerFor(bankRouter, "interest-user");
    const pending = await caller.getPendingInterest();
    expect(pending.records).toHaveLength(8);
    expect(pending.totalPending).toBe(800);
    expect(await caller.claimInterest()).toMatchObject({
      success: true,
      data: { bank: 1800, claimedAmount: 800 },
    });
    const rows = await db.select().from(dailyBankInterest);
    expect(rows.filter((row) => row.claimed)).toHaveLength(8);
    expect((await caller.claimInterest()).success).toBe(false);
  });

  it("pays once for simultaneous claims", async () => {
    const db = await seedInterest(8);
    const results = await Promise.all([
      claimBankInterest(db, "interest-user"),
      claimBankInterest(db, "interest-user"),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const [user] = await db
      .select({ bank: userData.bank })
      .from(userData)
      .where(eq(userData.userId, "interest-user"));
    expect(user?.bank).toBe(1800);
  });

  it("rolls back claimed records if crediting the balance fails", async () => {
    const db = await seedInterest(8);
    const failingClient = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "transaction") {
          return (callback: Parameters<typeof db.transaction>[0]) =>
            target.transaction((tx) =>
              callback(
                new Proxy(tx, {
                  get(transaction, property, txReceiver) {
                    if (property === "update") {
                      return (table: Parameters<typeof tx.update>[0]) => {
                        if (table === userData)
                          throw new Error("Simulated credit failure");
                        return transaction.update(table);
                      };
                    }
                    return Reflect.get(transaction, property, txReceiver);
                  },
                }),
              ),
            );
        }
        return Reflect.get(target, key, receiver);
      },
    });
    await expect(claimBankInterest(failingClient, "interest-user")).rejects.toThrow(
      "Simulated credit failure",
    );
    expect(
      (await db.select().from(dailyBankInterest)).every((row) => !row.claimed),
    ).toBe(true);
    expect(await claimBankInterest(db, "interest-user")).toMatchObject({
      success: true,
      data: { bank: 1800, claimedAmount: 800 },
    });
  });

  it("expires records at the next UTC midnight", async () => {
    const db = await seedInterest(8);
    setSystemTime(new Date("2026-09-28T00:00:00Z"));
    expect(await claimBankInterest(db, "interest-user")).toMatchObject({
      success: true,
      data: { claimedAmount: 700 },
    });
  });

  it("does not pay future dates or expired interest", async () => {
    const db = await seedInterest(1);
    for (const date of ["2026-09-19", "2026-09-28"]) {
      await db.update(dailyBankInterest).set({ date });
      expect((await claimBankInterest(db, "interest-user")).success).toBe(false);
    }
  });

  it("preserves unclaimed interest at capacity and caps a partial payout", async () => {
    const db = await seedInterest(8);
    await db.update(userData).set({ bank: RYO_CAP });
    expect((await claimBankInterest(db, "interest-user")).success).toBe(false);
    expect(
      (await db.select().from(dailyBankInterest)).every((row) => !row.claimed),
    ).toBe(true);
    await db.update(userData).set({ bank: RYO_CAP - 50 });
    expect(await claimBankInterest(db, "interest-user")).toMatchObject({
      success: true,
      data: { bank: RYO_CAP, claimedAmount: 50 },
    });
  });

  it.each([{ isBanned: true }, { status: "BATTLE" as const }])(
    "rejects restricted accounts: %s",
    async (patch) => {
      const db = await seedInterest(8);
      await db.update(userData).set(patch);
      expect((await claimBankInterest(db, "interest-user")).success).toBe(false);
      expect(
        (await db.select().from(dailyBankInterest)).every((row) => !row.claimed),
      ).toBe(true);
    },
  );
});
