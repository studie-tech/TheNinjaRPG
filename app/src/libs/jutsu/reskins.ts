import type { Jutsu } from "@/drizzle/schema";
import type { ZodAllTags, ZodJutsuType } from "@/validators/combat";

// Operational flags and evolution links belong to each content entry. All other
// non-cosmetic fields, including future mechanics, come from its reskin parent.
export const getJutsuReskinMechanics = (parent: Jutsu | ZodJutsuType) => {
  const {
    name,
    image,
    description,
    battleDescription,
    hidden,
    injectableInBattle,
    parentJutsuId,
    reskinParentJutsuId,
    bloodlineReskinId,
    jutsuRank,
    effects,
    ...fields
  } = parent;
  const { id, createdAt, updatedAt, ...mechanics } = fields as typeof fields &
    Partial<Jutsu>;
  return {
    ...mechanics,
    statClassification: mechanics.statClassification ?? "None",
    elementClassification: mechanics.elementClassification ?? "None",
  };
};

export const JUTSU_EFFECT_COSMETICS = [
  "description",
  "appearAnimation",
  "appearSfx",
  "disappearAnimation",
  "disappearSfx",
  "staticAssetPath",
  "staticAnimation",
] as const;

/** Pair repeated effect types by occurrence; new types use the parent's visuals. */
export const inheritJutsuReskinEffects = (
  parent: ZodAllTags[],
  child: ZodAllTags[],
) => {
  const remaining = [...child];
  return parent.map((effect) => {
    const index = remaining.findIndex((candidate) => candidate.type === effect.type);
    const cosmetic = index >= 0 ? remaining.splice(index, 1)[0] : undefined;
    const inherited = { ...effect };
    for (const key of JUTSU_EFFECT_COSMETICS) {
      if (key in inherited && cosmetic && key in cosmetic) {
        Object.assign(inherited, { [key]: cosmetic[key as keyof typeof cosmetic] });
      }
    }
    return inherited;
  });
};
