import { describe, expect, it } from "bun:test";
import {
  decodeTdActions,
  encodeTdAction,
  isTdActionEncodable,
} from "@/libs/towerDefense/actionLog";
import type { TdAction } from "@/libs/towerDefense/sim";
import { TD_MAX_ACTIONS, TD_MAX_TICKS } from "@/validators/towerDefense";
import { encodeLog } from "./bot";

/** One action of every kind, with negative coordinates and large ids. */
const EVERY_KIND: TdAction[] = [
  [0, "buy", "damage"],
  [0, "max", "rate"],
  [3, "spend"],
  [3, "build", 5, "frost"],
  [40, "upgrade", 5],
  [41, "sell", 0],
  [41, "ult", "tempest", -3000, 3000],
  [100, "perk", 9],
  [100, "reroll"],
  [100, "aim", "support"],
  [2_000, "focus", 123_456_789],
  [2_000, "blink", -120, 90],
  [2_001, "sub"],
  [2_001, "seal", "tiger", 200, -150],
  [2_500, "trap", 0, -1],
  [2_500, "loot", 0],
  [9_999, "call"],
  [9_999, "auto", 1],
  [TD_MAX_TICKS, "quit"],
];

describe("tower defense action log encoding", () => {
  it("round-trips every action kind", () => {
    const text = encodeLog(EVERY_KIND);
    expect(decodeTdActions(text)).toEqual(EVERY_KIND);
    expect(decodeTdActions("")).toEqual([]);
  });

  it("stores ticks as distances and is far smaller than JSON", () => {
    expect(encodeTdAction([2_001, "seal", "tiger", 200, -150], 2_000)).toBe(
      "1Gtiger,5k,-46",
    );
    const text = encodeLog(EVERY_KIND);
    expect(text.length * 2).toBeLessThan(JSON.stringify(EVERY_KIND).length);
  });

  it("rejects malformed text, unknown values and logs beyond the limits", () => {
    for (const text of [
      ";",
      "0",
      "0Z",
      "0Bdamage,1",
      "0Bnotanitem",
      "0Gtiger,5k",
      "0Gtiger,5k,2bd",
      "0D6,frost",
      "0Ufoo!",
      "-1S",
      "0Ka",
      "0O2",
      "0S;",
      `${(TD_MAX_TICKS + 1).toString(36)}Q`,
    ])
      expect(decodeTdActions(text)).toBeNull();
    expect(
      decodeTdActions(
        Array(TD_MAX_ACTIONS + 1)
          .fill("0S")
          .join(";"),
      ),
    ).toBeNull();
  });

  it("refuses to encode an action recorded before the previous one", () => {
    expect(() => encodeTdAction([3, "sub"], 5)).toThrow(RangeError);
  });

  it("accepts exactly the actions the decoder would", () => {
    for (const action of EVERY_KIND) expect(isTdActionEncodable(action)).toBe(true);
    for (const action of [
      [0, "blink", 3001, 0],
      [0, "seal", "tiger", 0, -3001],
      [0, "ult", "tempest", 1.5, 0],
      [0, "buy", "notanitem"],
      [0, "perk", 10],
      [0, "focus", -1],
      [0, "sub", 1],
      [0, "nothing"],
      [-1, "sub"],
      [0.5, "sub"],
    ])
      expect(isTdActionEncodable(action)).toBe(false);
  });
});
