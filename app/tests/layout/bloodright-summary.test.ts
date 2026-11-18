import { describe, expect, it } from "bun:test";
import { MAX_BLOODRIGHT_TIERS } from "@/drizzle/constants";
import { describeBloodright } from "@/layout/Bloodright";
import { IncreasePotencyTag, StunTag } from "@/validators/combat";

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
      note: `Stats are added to matching tags on Light jutsu. Each node costs 20 Seichi Silver; up to ${MAX_BLOODRIGHT_TIERS} active.`,
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
      note: `Stats are added to matching tags on all jutsu. Nodes cost 10 to 30 Seichi Silver; up to ${MAX_BLOODRIGHT_TIERS} active.`,
    });
  });
  it("has no note without tiers", () => {
    expect(describeBloodright([])).toEqual({ jutsu: null, note: null });
  });
});
