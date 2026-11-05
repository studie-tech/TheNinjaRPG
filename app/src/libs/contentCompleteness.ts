import { NonBattleItemTypes } from "@/drizzle/constants";
import type { ZodAllTags } from "@/validators/combat";

/** Item-level battle exclusion; such items need no effects or effect assets. */
export const isNonBattleItem = (item: {
  preventBattleUsage?: boolean | null;
  itemType?: string | null;
}) =>
  !!item.preventBattleUsage ||
  (NonBattleItemTypes as readonly (string | null | undefined)[]).includes(
    item.itemType,
  );

/** Whether any effect has a visual configured. */
export const hasEffectGraphics = (effects: ZodAllTags[]) =>
  effects.some(
    (e) =>
      e.appearAnimation ||
      e.disappearAnimation ||
      e.staticAnimation ||
      e.staticAssetPath,
  );

/** Whether any effect has a sound configured. */
export const hasEffectSfx = (effects: ZodAllTags[]) =>
  effects.some((e) => e.appearSfx || e.disappearSfx);

/** Whether any effect references a visual asset id missing from `assetIds`. */
export const hasInvalidEffectAssets = (
  effects: ZodAllTags[],
  assetIds: ReadonlySet<string>,
) =>
  effects.some((e) =>
    [
      e.appearAnimation,
      e.disappearAnimation,
      e.staticAnimation,
      e.staticAssetPath,
    ].some((v) => !!v && !assetIds.has(v)),
  );

/** Rows per key in first-seen order; rows without a key count as "N/A". */
export const countBy = <T>(
  rows: readonly T[] | undefined,
  keyOf: (row: T) => string | null | undefined,
) =>
  rows?.reduce<Record<string, number>>((acc, row) => {
    const key = keyOf(row) || "N/A";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

/** Effects per type and calculation, with the most used effect type first. */
export const countEffectCalculations = (
  rows: readonly { effects: ZodAllTags[] }[] | undefined,
) => {
  if (!rows) return undefined;
  const counts: Record<string, Record<string, number>> = {};
  for (const { effects } of rows) {
    for (const effect of effects) {
      const calculation = effect.calculation || "static";
      const calculations = counts[effect.type] ?? {};
      counts[effect.type] = calculations;
      calculations[calculation] = (calculations[calculation] || 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(counts)
      .map(([effectType, calculations]) => ({
        effectType,
        calculations,
        total: Object.values(calculations).reduce((sum, count) => sum + count, 0),
      }))
      .sort((a, b) => b.total - a.total)
      .map(({ effectType, calculations }) => [effectType, calculations]),
  );
};
