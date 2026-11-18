import { describe, expect, it } from "bun:test";
import { getStatTypeLabels } from "@/libs/combat/util";

describe("getStatTypeLabels", () => {
  it("labels stat tags by the combat stats their direction moves", () => {
    const offence = { type: "increasestat", direction: "offence" };
    const defence = { type: "decreasestat", direction: "defence" };
    const both = { type: "increasestat", direction: "both" };
    expect(getStatTypeLabels(offence)).toEqual(["Offence"]);
    expect(getStatTypeLabels(defence)).toEqual(["Defence"]);
    expect(getStatTypeLabels(both)).toEqual(["Offence", "Defence"]);
  });

  it("gives no combat stat to a generals-only stat tag", () => {
    const tag = { type: "increasestat", direction: "none" };
    expect(getStatTypeLabels(tag)).toEqual([]);
  });

  it("labels damage modifiers as universal", () => {
    const tag = {
      type: "increasedamagegiven",
    };
    expect(getStatTypeLabels(tag)).toEqual(["All damage"]);
  });
});
