import { describe, expect, it } from "vitest";
import type { Jutsu } from "@/drizzle/schema";
import { canUseElementalContent, type ElementUser } from "@/libs/elements";
import { hasElementClassificationBackup, validateElementClassificationMapping } from "@/libs/elementClassificationMapping";
import { checkJutsuElements } from "@/libs/train";
import { IncreaseDamageGivenTag } from "@/validators/combat";
import { elementClassificationSchema } from "@/validators/elements";

const user: ElementUser = { primaryElement: "Fire", secondaryElement: "Water", bloodline: null, isAi: false };

describe("element classification eligibility", () => {
  it("allows unrestricted content and any matching classification", () => {
    expect(canUseElementalContent({ elements: [] }, user)).toBe(true);
    expect(canUseElementalContent({ elements: ["Fire"] }, user)).toBe(true);
    expect(canUseElementalContent({ elements: ["Wind", "Water"] }, user)).toBe(true);
    expect(canUseElementalContent({ elements: ["Wind", "Earth"] }, user)).toBe(false);
    expect(canUseElementalContent({ elements: ["Wind"] }, { ...user, isAi: true })).toBe(true);
  });

  it("uses bloodline replacement rules rather than a union of all natural elements", () => {
    const bloodlineUser = { ...user, bloodline: { effects: [IncreaseDamageGivenTag.parse({ elements: ["Ice"] })] } };
    expect(canUseElementalContent({ elements: ["Ice"] }, bloodlineUser)).toBe(true);
    expect(canUseElementalContent({ elements: ["Water"] }, bloodlineUser)).toBe(true);
    expect(canUseElementalContent({ elements: ["Fire"] }, bloodlineUser)).toBe(false);
  });

  it("does not infer jutsu eligibility from a modifier's target elements", () => {
    const jutsu = { elements: ["Fire"], effects: [IncreaseDamageGivenTag.parse({ elements: ["Water"] })] } as Jutsu;
    expect(checkJutsuElements(jutsu, new Set(["Fire"]))).toBe(true);
    expect(checkJutsuElements(jutsu, new Set(["Water"]))).toBe(false);
    expect(checkJutsuElements({ ...jutsu, elements: [] }, new Set())).toBe(true);
  });
});

describe("classification mapping", () => {
  it("recognizes classification columns in backups, not just mentions in descriptions", () => {
    expect(hasElementClassificationBackup("INSERT INTO `Item` (`id`, `elements`) VALUES ('i1', '[]');")).toBe(true);
    expect(hasElementClassificationBackup("INSERT INTO `Jutsu` (`id`, `description`) VALUES ('j1', 'mentions `elements`');")).toBe(false);
  });
  const catalog = { jutsus: [{ id: "j1" }], items: [{ id: "i1" }] };
  const mapping = { jutsus: [{ id: "j1", elements: ["Fire"] }], items: [{ id: "i1", elements: [] }] };
  it("requires explicit coverage, unique IDs and known content", () => {
    expect(validateElementClassificationMapping(mapping, catalog)).toEqual(mapping);
    expect(() => validateElementClassificationMapping({ ...mapping, jutsus: [] }, catalog)).toThrow(/Missing/);
    expect(() => validateElementClassificationMapping({ ...mapping, jutsus: [...mapping.jutsus, ...mapping.jutsus] }, catalog)).toThrow(/Duplicate/);
    expect(() => validateElementClassificationMapping({ ...mapping, items: [{ id: "unknown", elements: [] }] }, catalog)).toThrow(/Unknown/);
    expect(() => validateElementClassificationMapping({ ...mapping, items: [{ id: "i1", elements: ["Invalid"] }] }, catalog)).toThrow();
  });
  it("normalizes non-elemental and duplicate choices without accepting mixed None", () => {
    expect(elementClassificationSchema.parse(["None"])).toEqual([]);
    expect(elementClassificationSchema.parse(["Fire", "Fire"])).toEqual(["Fire"]);
    expect(elementClassificationSchema.safeParse(["None", "Fire"]).success).toBe(false);
  });
});
