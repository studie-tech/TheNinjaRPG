import { describe, expect, it } from "bun:test";
import {
  applyClanDelta,
  getClanDonationUserUpdate,
  getConvertPointsToRyoUserUpdate,
  getPurchaseBoostClanUpdate,
  getToBankUserUpdate,
  getUnchangedClanUserUpdate,
} from "@/deltas/clan";
import { CLAN_BOOST_PERCENT_PER_LEVEL } from "@/drizzle/constants";
import { clanDeltaSchema } from "@/validators/clan";

type CachedClan = NonNullable<Parameters<typeof applyClanDelta>[0]>;

const cachedClan = {
  id: "clan",
  bank: 1000,
  points: 50,
  repTreasury: 20,
  trainingBoost: 4,
  members: [{ userId: "member" }],
} as unknown as CachedClan;

describe("clan cache deltas", () => {
  it("credits the treasury for deposits, donations and point conversions", () => {
    expect(
      getToBankUserUpdate({
        needsUserRefresh: true,
        inputAmount: 30,
        fetchedClanId: "clan",
      }),
    ).toEqual({ userDelta: undefined, clanDelta: { id: "clan", bank: 30 } });
    expect(
      getClanDonationUserUpdate({
        user: { energyQueueHead: 0, energyQueueTail: 1 },
        repsCost: 5,
        fetchedClanId: "clan",
      }),
    ).toEqual({ userDelta: undefined, clanDelta: { id: "clan", repTreasury: 5 } });
    expect(
      getConvertPointsToRyoUserUpdate({
        fetchedClanId: "clan",
        inputPoints: 3,
        ryo: 600,
      }),
    ).toMatchObject({ clanDelta: { id: "clan", points: -3, bank: 600 } });
    expect(getUnchangedClanUserUpdate({ clanId: "clan" }).clanDelta).toEqual({
      id: "clan",
    });
  });

  it("debits the boost cost and raises only the purchased boost by one level", () => {
    const { clanDelta } = getPurchaseBoostClanUpdate({
      clanId: "clan",
      boostType: "trainingBoost",
      cost: 400,
    });
    expect(clanDeltaSchema.parse(clanDelta)).toEqual({
      id: "clan",
      bank: -400,
      trainingBoost: CLAN_BOOST_PERCENT_PER_LEVEL,
    });
    expect(applyClanDelta(cachedClan, clanDelta)).toEqual({
      ...cachedClan,
      bank: 600,
      trainingBoost: 4 + CLAN_BOOST_PERCENT_PER_LEVEL,
    });
  });

  it("applies numeric changes on top of the cached values and keeps the relations", () => {
    const next = applyClanDelta(cachedClan, { id: "clan", points: -3, bank: 600 });
    expect(next).toMatchObject({ bank: 1600, points: 47, repTreasury: 20 });
    expect(next?.members).toBe(cachedClan.members);
    expect(cachedClan.bank).toBe(1000);
  });

  it("requests a fetch for a missing or different cached clan", () => {
    expect(applyClanDelta(null, { id: "clan", bank: 1 })).toBeUndefined();
    expect(applyClanDelta(undefined, { id: "clan", bank: 1 })).toBeUndefined();
    expect(applyClanDelta(cachedClan, { id: "other", bank: 1 })).toBeUndefined();
  });
});
