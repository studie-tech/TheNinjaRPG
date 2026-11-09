import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { REP_TRADE_MIN_LEVEL } from "@/drizzle/constants";
import { ryoTrade, userData } from "@/drizzle/schema";
import { blackMarketRouter } from "@/server/api/routers/blackmarket";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const SELLER = "rep-seller";
/** Reputation points a seller keeps after every listing. */
const RESERVE = 10;
const REPS = 20;
const RYO = 5_000;

const reputation = async () =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({ where: eq(userData.userId, SELLER) })
  )?.reputationPoints;

const offers = async () => (await getTestDatabase()).select().from(ryoTrade);

const setReputation = async (reputationPoints: number) =>
  (await getTestDatabase())
    .update(userData)
    .set({ reputationPoints })
    .where(eq(userData.userId, SELLER));

/** List REPS for RYO through a client that runs `race` just before the reputation debit. */
const createOfferAfter = async (race?: () => Promise<unknown>) => {
  const database = await getTestDatabase();
  const client = race ? beforeStatements(database, userData, [race]) : database;
  return callerForDatabase(blackMarketRouter, SELLER, client).createOffer({
    reps: REPS,
    ryo: RYO,
  });
};

/** A seller may list reputation only while keeping the reserve once the listing is debited. */
describeWithDatabase("blackmarket.createOffer", () => {
  beforeEach(async () => {
    await resetTables(ryoTrade, userData);
    await insertUsers([
      {
        userId: SELLER,
        username: "Seller",
        level: REP_TRADE_MIN_LEVEL,
        reputationPoints: REPS + RESERVE,
      },
    ]);
  });

  it("lists reputation that leaves exactly the reserve", async () => {
    const result = await createOfferAfter();
    expect(result).toMatchObject({ success: true, message: "Offer created" });
    expect(await reputation()).toBe(RESERVE);
    expect((await offers()).map((offer) => offer.repsForSale)).toEqual([REPS]);
  });

  it("rejects a listing that would leave less than the reserve", async () => {
    await setReputation(REPS + RESERVE - 1);
    const result = await createOfferAfter();
    expect(result).toEqual({ success: false, message: "Not enough reputation points" });
    expect(await reputation()).toBe(REPS + RESERVE - 1);
    expect(await offers()).toEqual([]);
  });

  it("lists nothing when a concurrent spend drops the seller below the reserve", async () => {
    const result = await createOfferAfter(() => setReputation(REPS + RESERVE - 1));
    expect(result).toEqual({ success: false, message: "Not enough reputation points" });
    expect(await reputation()).toBe(REPS + RESERVE - 1);
    expect(await offers()).toEqual([]);
  });
});
