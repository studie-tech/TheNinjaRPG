import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { RYO_FOR_REP_DAYS_FROZEN } from "@/drizzle/constants";
import { ryoTrade, userData } from "@/drizzle/schema";
import { blackMarketRouter } from "@/server/api/routers/blackmarket";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const DAY_MS = 86_400_000;

const listOffer = async (ageDays: number) =>
  (await getTestDatabase()).insert(ryoTrade).values({
    id: "offer",
    creatorUserId: "seller",
    repsForSale: 10,
    requestedRyo: 100,
    ryoPerRep: 10,
    createdAt: new Date(Date.now() - ageDays * DAY_MS),
  });
const delist = async (userId: string) =>
  (await callerFor(blackMarketRouter, userId)).delistOffer({ offerId: "offer" });
const sellerReputation = async () =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({ where: eq(userData.userId, "seller") })
  )?.reputationPoints;

/** Creators delist their own offers once the freeze ends; the site owner may delist any offer at any time. */
describeWithDatabase("blackmarket.delistOffer", () => {
  beforeEach(async () => {
    await resetTables(ryoTrade, userData);
    await insertUsers([
      { userId: "seller", username: "Seller", reputationPoints: 0 },
      { userId: "stranger", username: "Stranger" },
      { userId: "owner", username: "Terriator" },
    ]);
  });

  it("keeps a frozen offer from its creator and other players", async () => {
    await listOffer(RYO_FOR_REP_DAYS_FROZEN - 1);
    expect(await delist("seller")).toEqual({
      success: false,
      message: "Offer is frozen",
    });
    expect(await delist("stranger")).toEqual({ success: false, message: "Not yours" });
    expect(await sellerReputation()).toBe(0);
  });

  it("lets the creator delist once the freeze ends and refunds the reputation", async () => {
    await listOffer(RYO_FOR_REP_DAYS_FROZEN + 1);
    expect(await delist("stranger")).toEqual({ success: false, message: "Not yours" });
    expect(await delist("seller")).toMatchObject({
      success: true,
      message: "Offer delisted",
    });
    expect(await sellerReputation()).toBe(10);
  });

  it("lets the site owner delist a frozen offer", async () => {
    await listOffer(0);
    expect(await delist("owner")).toMatchObject({
      success: true,
      message: "Offer delisted",
    });
    expect(await sellerReputation()).toBe(10);
  });
});
