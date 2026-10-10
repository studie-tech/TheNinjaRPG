import { describe, expect, it } from "bun:test";
import { getStatTypeLabels } from "@/libs/combat/util";

describe("getStatTypeLabels", () => {
  const statTypes = ["Ninjutsu", "Genjutsu"] as const;

  it("labels stat tags by the combat stats their direction moves", () => {
    const offence = { type: "increasestat", statTypes, direction: "offence" };
    const defence = { type: "decreasestat", statTypes, direction: "defence" };
    const both = { type: "increasestat", statTypes, direction: "both" };
    expect(getStatTypeLabels(offence)).toEqual(["Offence"]);
    expect(getStatTypeLabels(defence)).toEqual(["Defence"]);
    expect(getStatTypeLabels(both)).toEqual(["Offence", "Defence"]);
  });

  it("gives no combat stat to a stat tag without statTypes", () => {
    const tag = { type: "increasestat", statTypes: [], direction: "both" };
    expect(getStatTypeLabels(tag)).toEqual([]);
  });

  it("labels damage modifiers as universal", () => {
    const tag = { type: "increasedamagegiven", statTypes: ["Taijutsu", "None"] as const };
    expect(getStatTypeLabels(tag)).toEqual(["All damage"]);
  });
});
