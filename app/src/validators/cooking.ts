/** Shared editor/validation restrictions keep meals out of equipment and combat actions. */
export const MEAL_ITEM_DEFAULTS = {
  destroyOnUse: true,
  preventBattleUsage: true,
  target: "SELF",
  method: "SINGLE",
  methodSize: null,
  slot: "ITEM",
  weaponType: "NONE",
  canBeImbued: false,
  maxEquips: 0,
  isFarmSeed: false,
  isFarmFertilizer: false,
  parentItemId: null,
  requiredSkillId: null,
  bloodlineId: null,
} as const;
