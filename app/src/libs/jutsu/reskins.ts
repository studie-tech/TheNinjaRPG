import type { Jutsu } from "@/drizzle/schema";
import type { ZodAllTags, ZodJutsuType } from "@/validators/combat";

/**
 * Shared by the editor preview and authoritative server saves. Operational flags,
 * identity, cosmetics and links stay local; all other fields inherit by default,
 * including newly added mechanics. Rank and effects are handled by the caller.
 * Normalize empty database/cache classifications to the validator's "None" value.
 */
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
    statClassification: mechanics.statClassification || "None",
    elementClassification: mechanics.elementClassification || "None",
  };
};

/** The same cosmetic allowlist governs effect editing and server inheritance. */
export const JUTSU_EFFECT_COSMETICS = [
  "description",
  "appearAnimation",
  "appearSfx",
  "disappearAnimation",
  "disappearSfx",
  "staticAssetPath",
  "staticAnimation",
] as const;

/**
 * Keep the parent's effect order and mechanics, pairing repeated types by occurrence
 * to preserve the child's cosmetics. Added types use the parent's visuals; removed
 * types disappear. Neither input is mutated.
 */
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
