import type { CombatStatName, StatType } from "@/drizzle/constants";

export function toOffenceStat(_stat?: StatType): Extract<CombatStatName, "offence"> {
  return "offence";
}

export function toDefenceStat(_stat?: StatType): Extract<CombatStatName, "defence"> {
  return "defence";
}
