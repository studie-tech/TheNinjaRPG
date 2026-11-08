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

  it("rejects declining a missing offer", async () => {
    const caller = await callerFor(warRouter, KAGE);
    await expect(caller.rejectAllyOffer({ id: GONE })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects delisting a missing offer", async () => {
    const caller = await callerFor(warRouter, KAGE);
    await expect(caller.cancelAllyOffer({ offerId: GONE })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects accepting a missing offer", async () => {
    const caller = await callerFor(warRouter, KAGE);
    await expect(caller.acceptAllyOffer({ offerId: GONE })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
