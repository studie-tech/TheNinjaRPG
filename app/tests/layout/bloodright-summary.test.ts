import { describe, expect, it } from "bun:test";
import { MAX_BLOODRIGHT_TIERS } from "@/drizzle/constants";
import { describeBloodright } from "@/layout/Bloodright";
import {
  DecreasePotencyTag,
  IncreasePotencyTag,
  PoisonTag,
  StunTag,
} from "@/validators/combat";

const light = IncreasePotencyTag.parse({
  affectedTag: "afterburn",
  power: 2,
  affectedElements: ["Light"],
});

describe("Bloodright summary", () => {
  it("names the qualifying element and a shared node cost", () => {
    expect(
      describeBloodright([
        { effects: [light], seichiSilverCost: 20 },
        { effects: [light, StunTag.parse({})], seichiSilverCost: 20 },
      ]),
    ).toEqual({
      jutsu: "Light jutsu",
      note: `Effects modify the power of matching tags on Light jutsu. Each node costs 20 Seichi Silver; up to ${MAX_BLOODRIGHT_TIERS} active.`,
    });
  });
  it("covers all jutsu without elements and shows a cost range", () => {
    const any = IncreasePotencyTag.parse({ affectedTag: "damage", power: 1 });
    expect(
      describeBloodright([
        { effects: [any], seichiSilverCost: 10 },
        { effects: [any], seichiSilverCost: 30 },
      ]),
    ).toEqual({
      jutsu: null,
      note: `Effects modify the power of matching tags on all jutsu. Nodes cost 10 to 30 Seichi Silver; up to ${MAX_BLOODRIGHT_TIERS} active.`,
    });
  });
  it("covers all jutsu when any effect is unrestricted", () => {
    const any = IncreasePotencyTag.parse({ affectedTag: "damage", power: 1 });
    expect(
      describeBloodright([
        { effects: [light], seichiSilverCost: 20 },
        { effects: [any], seichiSilverCost: 20 },
      ]).jutsu,
    ).toBeNull();
  });
  it("shows only costs for paths without effective potency", () => {
    for (const effect of [
      PoisonTag.parse({}),
      IncreasePotencyTag.parse({ affectedTag: "none" }),
    ]) {
      expect(describeBloodright([{ effects: [effect], seichiSilverCost: 20 }])).toEqual(
        {
          jutsu: null,
          note: `Each node costs 20 Seichi Silver; up to ${MAX_BLOODRIGHT_TIERS} active.`,
        },
      );
    }
  });
  it("ignores potency that affects neither tags nor elements", () => {
    expect(
      describeBloodright([
        {
          effects: [light, IncreasePotencyTag.parse({ affectedTag: "none" })],
          seichiSilverCost: 20,
        },
      ]).jutsu,
    ).toBe("Light jutsu");
  });
  it("describes percentage decreases without claiming an additive boost", () => {
    const decrease = DecreasePotencyTag.parse({
      affectedTag: "damage",
      calculation: "percentage",
      power: 10,
    });
    expect(
      describeBloodright([{ effects: [decrease], seichiSilverCost: 20 }]).note,
    ).toBe(
      `Effects modify the power of matching tags on all jutsu. Each node costs 20 Seichi Silver; up to ${MAX_BLOODRIGHT_TIERS} active.`,
    );
  });
  it("has no note without tiers", () => {
    expect(describeBloodright([])).toEqual({ jutsu: null, note: null });
  });
});
