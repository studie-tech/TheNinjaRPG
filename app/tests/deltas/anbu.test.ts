import { describe, expect, it } from "bun:test";
import {
  applyAnbuSquadDelta,
  getEspionageSquadUpdate,
  getSquadUpgradeUpdate,
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
    const update = getSquadUpgradeUpdate(cachedSquad, {
      levelColumn: "stealthLevel",
      cost: 200,
    });
    expect(update).toEqual({
      squadDelta: { id: "squad", points: -200, stealthLevel: 1 },
      squadExpected: { id: "squad", points: 500, stealthLevel: 1 },
    });
    expect(
      applyAnbuSquadDelta(cachedSquad, update.squadDelta, update.squadExpected),
    ).toEqual({
      ...cachedSquad,
      points: 300,
      stealthLevel: 2,
    });
  });

  it("debits the espionage charge whatever the mission's outcome", () => {
    const update = getEspionageSquadUpdate(cachedSquad);
    expect(
      applyAnbuSquadDelta(cachedSquad, update.squadDelta, update.squadExpected),
    ).toEqual({
      ...cachedSquad,
      points: 500 - ANBU_ESPIONAGE_POINTS_COST,
    });
  });

  it("refetches a different or missing squad instead of patching it", () => {
    const update = getEspionageSquadUpdate({ ...cachedSquad, id: "other" });
    expect(
      applyAnbuSquadDelta(cachedSquad, update.squadDelta, update.squadExpected),
    ).toBe(undefined);
    expect(applyAnbuSquadDelta(null, update.squadDelta, update.squadExpected)).toBe(
      undefined,
    );
  });

  it("refetches when another member's spend changed the server baseline", () => {
    const update = getEspionageSquadUpdate({ ...cachedSquad, points: 300 });
    expect(
      applyAnbuSquadDelta(cachedSquad, update.squadDelta, update.squadExpected),
    ).toBe(undefined);
    expect(applyAnbuSquadDelta(cachedSquad, update.squadDelta, undefined)).toBe(
      undefined,
    );
  });

  it("refetches when the purchased level changed outside this browser", () => {
    const update = getSquadUpgradeUpdate(
      { ...cachedSquad, stealthLevel: 2 },
      {
        levelColumn: "stealthLevel",
        cost: 200,
      },
    );
    expect(
      applyAnbuSquadDelta(cachedSquad, update.squadDelta, update.squadExpected),
    ).toBe(undefined);
  });
});
