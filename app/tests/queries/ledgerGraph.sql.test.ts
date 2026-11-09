import { beforeEach, expect, it } from "bun:test";
import { bankTransfers, ryoTrade, userData } from "@/drizzle/schema";
import { selectBankTransfersForGetGraph } from "@/queries/bank";
import { selectRyoTradeForGetGraph } from "@/queries/blackmarket";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

describeWithDatabase("ledger graph totals", () => {
  beforeEach(async () => {
    await resetTables(bankTransfers, ryoTrade, userData);
    await insertUsers([{ userId: "sender" }, { userId: "receiver" }]);
  });

  it("sums bank transfers per pair as numbers and drops pairs under the minimum", async () => {
    const db = await getTestDatabase();
    await db.insert(bankTransfers).values([
      { senderId: "sender", receiverId: "receiver", amount: 600 },
      { senderId: "sender", receiverId: "receiver", amount: 700 },
      { senderId: "receiver", receiverId: "sender", amount: 50 },
    ]);
    const rows = await selectBankTransfersForGetGraph(db, new Date(0), 1000);
    expect(rows).toEqual([
      expect.objectContaining({
        senderId: "sender",
        receiverId: "receiver",
        total: 1300,
      }),
    ]);
  });

  it("sums completed ryo trades per pair as numbers", async () => {
    const db = await getTestDatabase();
    await db.insert(ryoTrade).values([
      {
        id: "t1",
        creatorUserId: "sender",
        purchaserUserId: "receiver",
        repsForSale: 3,
        requestedRyo: 3000,
        ryoPerRep: 1000,
      },
      {
        id: "t2",
        creatorUserId: "sender",
        purchaserUserId: "receiver",
        repsForSale: 2,
        requestedRyo: 2500,
        ryoPerRep: 1250,
      },
      {
        id: "t3",
        creatorUserId: "sender",
        repsForSale: 9,
        requestedRyo: 9000,
        ryoPerRep: 1000,
      },
    ]);
    const rows = await selectRyoTradeForGetGraph(db);
    expect(rows).toEqual([
      expect.objectContaining({
        senderId: "sender",
        receiverId: "receiver",
        totalReps: 5,
        totalRyo: 5500,
      }),
    ]);
  });
});
