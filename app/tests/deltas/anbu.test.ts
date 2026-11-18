import { describe, expect, it } from "bun:test";
import {
  applyAnbuSquadDelta,
  getEspionageSquadDelta,
  getSquadUpgradeDelta,
} from "@/deltas/anbu";
import { ANBU_ESPIONAGE_POINTS_COST } from "@/drizzle/constants";

type CachedSquad = NonNullable<Parameters<typeof applyAnbuSquadDelta>[0]>;

const cachedSquad = {
  id: "squad",
  points: 500,
  espionageLevel: 2,
  stealthLevel: 1,
  members: [{ userId: "leader" }],
} as unknown as CachedSquad;

describe("ANBU squad cache deltas", () => {
  it("debits points and raises only the purchased level", () => {
    const delta = getSquadUpgradeDelta("squad", {
      levelColumn: "stealthLevel",
      cost: 200,
    });
    expect(delta).toEqual({ id: "squad", points: -200, stealthLevel: 1 });
    expect(applyAnbuSquadDelta(cachedSquad, delta)).toEqual({
      ...cachedSquad,
      points: 300,
      stealthLevel: 2,
    });
  });

  it("debits the espionage charge whatever the mission's outcome", () => {
    expect(applyAnbuSquadDelta(cachedSquad, getEspionageSquadDelta("squad"))).toEqual({
      ...cachedSquad,
      points: 500 - ANBU_ESPIONAGE_POINTS_COST,
    });
  });

  it("refetches a different or missing squad instead of patching it", () => {
    expect(applyAnbuSquadDelta(cachedSquad, getEspionageSquadDelta("other"))).toBe(
      undefined,
    );
    expect(applyAnbuSquadDelta(null, getEspionageSquadDelta("squad"))).toBe(undefined);
  });
});
