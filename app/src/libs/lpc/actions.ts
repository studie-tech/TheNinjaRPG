import type { LpcAnimation } from "@/validators/lpc";

/** Presentation follows action semantics without revealing an unrevealed content identifier. */
export const spriteActionAnimation = (action: {
  id: string;
  type: string;
  data?: object;
  effects: { type: string; statTypes?: string[] }[];
}): LpcAnimation => {
  if (["move", "flee", "replacementTechnique"].includes(action.id)) return "walk";
  if (["wait", "meditate", "defensiveStance", "offensiveStance"].includes(action.id))
    return "idle";
  const weapon =
    action.data &&
    "weaponType" in action.data &&
    typeof action.data.weaponType === "string"
      ? action.data.weaponType
      : undefined;
  if (weapon === "BOW" || weapon === "SHURIKEN") return "shoot";
  if (["DAGGER", "POLEARM", "STAFF"].includes(weapon ?? "")) return "thrust";
  if (weapon && weapon !== "NONE") return "slash";
  if (
    action.id === "basicAttack" ||
    action.effects.some((effect) =>
      effect.statTypes?.some((stat) => stat === "Taijutsu" || stat === "Bukijutsu"),
    )
  )
    return "slash";
  return "spellcast";
};
