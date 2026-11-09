import { describe, expect, it } from "bun:test";
import type { ReturnedBattle } from "@/libs/combat/types";
import {
  findTransformation,
  transformationEnvelope,
} from "@/libs/rendering/scenes/combatTransformation";

const STAGE = { hold: 1000, dim: 0.5, shake: 0.1 };
const fighter = (userId: string, tier?: number) => ({
  userId,
  ...(tier ? { transformation: { id: "cue", fromUserId: "old", tier } } : {}),
});
const battle = (users: object[], id = "battle") =>
  ({ id, usersState: users }) as unknown as ReturnedBattle;

describe("combat transformation", () => {
  it("starts when a transformed fighter first reaches the field", () => {
    const before = battle([fighter("old")]);
    const after = battle([fighter("old"), fighter("new", 2)]);
    expect(findTransformation(before, after)?.userId).toBe("new");
  });

  it("does not replay for a fighter already on the field or a reloaded battle", () => {
    const shown = battle([fighter("new", 2)]);
    expect(findTransformation(shown, battle([fighter("new", 2)]))).toBeUndefined();
    expect(
      findTransformation(battle([], "other"), battle([fighter("new", 2)])),
    ).toBeUndefined();
  });

  it("ignores a tier with no staged arrival", () => {
    expect(findTransformation(battle([]), battle([fighter("new", 9)]))).toBeUndefined();
  });

  it("builds through the clip, bursts at its end and then returns the field", () => {
    const building = transformationEnvelope(500, 1000, STAGE);
    expect(building).toMatchObject({ charge: 0.5, burst: false, flash: 0, banner: 0 });
    const burst = transformationEnvelope(1000, 1000, STAGE);
    expect(burst).toMatchObject({ charge: 1, burst: true, flash: 1 });
    expect(burst.shake).toBeGreaterThan(building.shake);
    const named = transformationEnvelope(1400, 1000, STAGE);
    expect(named.banner).toBe(1);
    expect(transformationEnvelope(2000, 1000, STAGE).finished).toBe(true);
    expect(transformationEnvelope(1999, 1000, STAGE).finished).toBe(false);
  });
});
