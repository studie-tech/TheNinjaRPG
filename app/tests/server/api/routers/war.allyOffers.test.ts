import { beforeEach, expect, it } from "bun:test";
import { userData, userRequest, village } from "@/drizzle/schema";
import { warRouter } from "@/routers/war";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

/** Settlement deletes ally offers of ended wars, so a kage can act on one that is gone. */
const KAGE = "ally-offer-kage";
const VILLAGE = "ally-offer-village";
const GONE = "ally-offer-gone";

describeWithDatabase("war ally offers that no longer exist", () => {
  beforeEach(async () => {
    await resetTables(userRequest, userData, village);
    const database = await getTestDatabase();
    await database.insert(village).values({
      id: VILLAGE,
      name: "Allyville",
      sector: 120,
      kageId: KAGE,
      type: "VILLAGE",
    });
    await insertUsers([{ userId: KAGE, username: "AllyKage", villageId: VILLAGE }]);
  });

  it("answers declining a missing offer", async () => {
    const caller = await callerFor(warRouter, KAGE);
    expect(await caller.rejectAllyOffer({ id: GONE })).toEqual({
      success: false,
      message: "Request not found",
    });
  });

  it("answers delisting a missing offer", async () => {
    const caller = await callerFor(warRouter, KAGE);
    expect(await caller.cancelAllyOffer({ offerId: GONE })).toEqual({
      success: false,
      message: "Offer not found",
    });
  });

  it("answers accepting a missing offer", async () => {
    const caller = await callerFor(warRouter, KAGE);
    expect(await caller.acceptAllyOffer({ offerId: GONE })).toEqual({
      success: false,
      message: "Offer not found",
    });
  });
});
