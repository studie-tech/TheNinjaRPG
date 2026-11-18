import type { LpcAnimation } from "@/validators/lpc";

/** Presentation follows action semantics without revealing an unrevealed content identifier. */
export const spriteActionAnimation = (action: {
  id: string;
  type: string;
  data?: { statClassification?: string | null; weaponType?: string };
  effects: { type: string }[];
}): LpcAnimation => {
  if (["move", "flee", "replacementTechnique"].includes(action.id)) return "walk";
  if (["wait", "meditate", "defensiveStance", "offensiveStance"].includes(action.id))
    return "idle";
  const weapon = action.data?.weaponType;
  if (weapon === "BOW" || weapon === "SHURIKEN") return "shoot";
  if (["DAGGER", "POLEARM", "STAFF"].includes(weapon ?? "")) return "thrust";
  if (weapon && weapon !== "NONE") return "slash";
  if (
    action.id === "basicAttack" ||
    ["Taijutsu", "Bukijutsu"].includes(action.data?.statClassification ?? "")
  )
    return "slash";
  return "spellcast";
};
