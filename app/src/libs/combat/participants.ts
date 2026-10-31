import {
  type BattleType,
  type BattleUsageType,
  QuestBattleTypes,
} from "@/drizzle/constants";
import {
  COMBAT_BORDER_BOTTOM,
  COMBAT_BORDER_LEFT,
  COMBAT_BORDER_RIGHT,
  COMBAT_BORDER_TOP,
} from "@/libs/combat/constants";

/**
 * Whether quest content may add NPC templates to the initiating player's team.
 * QUEST objectives and quest-bound OVERWORLD fights carry these authored allies;
 * This is narrower than QuestBattleTypes, which also includes raids and random
 * encounters. It controls authored NPC eligibility, not combat allegiance.
 */
export const supportsNpcAllies = (battleType: BattleType): boolean =>
  battleType === "QUEST" || battleType === "OVERWORLD";

/**
 * Whether PvE-only or PvP-only jutsu and items may be used in a battle type.
 * Quest fights exclude PvP-only content. Battle Arena fights (ARENA, TRAINING)
 * are against NPCs, so they also allow PvE-only content next to PvP-only
 * content. Every other fight excludes PvE-only content.
 */
export const fitsBattleUsage = (
  battleType: BattleType,
  usage: BattleUsageType,
): boolean => {
  const isQuestBattle = QuestBattleTypes.includes(battleType);
  if (usage === "PVP") return !isQuestBattle;
  if (usage === "PVE") {
    return isQuestBattle || battleType === "ARENA" || battleType === "TRAINING";
  }
  return true;
};

/**
 * Each battle has two fixed teams, stored as its left/right side at initiation.
 * Movement never changes this side; summons and clones inherit their creator's.
 * Village, clan and controller identity do not determine combat allegiance.
 */
export const areBattleAllies = (
  first: { direction: "left" | "right" },
  second: { direction: "left" | "right" },
): boolean => first.direction === second.direction;

/**
 * Enumerate distinct spawn cells within one team's combat borders.
 * Capacity validation and placement share this finite list so an overcrowded
 * team is rejected instead of retrying occupied cells indefinitely. Small fields
 * retain the columns allowed by the combat border bounds, including inverted bounds.
 */
export const getBattleSpawnLocations = (
  width: number,
  height: number,
  direction: "left" | "right",
) => {
  const halfWidth = Math.floor(width / 2);
  const min = direction === "left" ? 1 : halfWidth + 1;
  const max = direction === "left" ? halfWidth : width - 3;
  const firstX = min + COMBAT_BORDER_LEFT;
  const lastX = max - COMBAT_BORDER_RIGHT;
  // Preserve the small-field columns produced by the existing random bounds.
  const minX = Math.min(firstX, lastX + 1);
  const maxX = Math.max(firstX, lastX);
  const locations: { x: number; y: number }[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = 1 + COMBAT_BORDER_BOTTOM; y <= height - COMBAT_BORDER_TOP - 1; y++) {
      locations.push({ x, y });
    }
  }
  return locations;
};
