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
        { target: "SELF", effects: [light], seichiSilverCost: 20 },
        { target: "SELF", effects: [light], seichiSilverCost: 20 },
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
        { target: "SELF", effects: [any], seichiSilverCost: 10 },
        { target: "SELF", effects: [any], seichiSilverCost: 30 },
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
        { target: "SELF", effects: [light], seichiSilverCost: 20 },
        { target: "SELF", effects: [any], seichiSilverCost: 20 },
      ]).jutsu,
    ).toBeNull();
  });
  it("shows only costs for paths without effective potency", () => {
    for (const effect of [
      PoisonTag.parse({}),
      IncreasePotencyTag.parse({ affectedTag: "none" }),
    ]) {
      expect(
        describeBloodright([
          { target: "SELF", effects: [effect], seichiSilverCost: 20 },
        ]),
      ).toEqual({
        jutsu: null,
        note: `Each node costs 20 Seichi Silver; up to ${MAX_BLOODRIGHT_TIERS} active.`,
      });
    }
  });
  it("ignores potency that affects neither tags nor elements", () => {
    expect(
      describeBloodright([
        {
          target: "SELF",
          effects: [light, IncreasePotencyTag.parse({ affectedTag: "none" })],
          seichiSilverCost: 20,
        },
      ]).jutsu,
    ).toBe("Light jutsu");
  });
  it("omits jutsu claims for mixed effects, reductions and other targets", () => {
    const decrease = DecreasePotencyTag.parse({
      affectedTag: "damage",
      calculation: "percentage",
      power: 10,
    });
    for (const tier of [
      { target: "SELF" as const, effects: [light, StunTag.parse({})] },
      { target: "SELF" as const, effects: [decrease] },
      { target: "ENEMIES" as const, effects: [light] },
      { target: "ALLIES" as const, effects: [light] },
      {
        target: "SELF" as const,
        effects: [{ ...light, target: "COORDINATES" as const }],
      },
    ]) {
      expect(describeBloodright([{ ...tier, seichiSilverCost: 20 }])).toEqual({
        jutsu: null,
        note: `Each node costs 20 Seichi Silver; up to ${MAX_BLOODRIGHT_TIERS} active.`,
      });
    }
  });
  it("has no note without tiers", () => {
    expect(describeBloodright([])).toEqual({ jutsu: null, note: null });
  });
});
