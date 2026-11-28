import type { LpcAnimation } from "@/validators/lpc";

/** Presentation follows action semantics without revealing an unrevealed content identifier. */
export const spriteActionAnimation = (
  action: {
    id: string;
    type: string;
    data?: {
      statClassification?: string | null;
      weaponType?: string;
      lpcProfile?: string | null;
    };
    effects: { type: string }[];
  },
  equipmentProfile = action.data?.lpcProfile,
): LpcAnimation => {
  if (["move", "flee", "replacementTechnique"].includes(action.id)) return "walk";
  if (action.id === "defensiveStance") return "block";
  if (["wait", "meditate", "offensiveStance"].includes(action.id)) return "idle";
  const weapon = action.data?.weaponType;
  if (weapon === "BOW") return equipmentProfile === "crossbow" ? "crossbow" : "shoot";
  if (
    weapon === "SHURIKEN" ||
    ["shuriken", "boomerang"].includes(equipmentProfile ?? "")
  )
    return "throw";
  if (weapon === "FIST_WEAPON") return "punch";
  if (["DAGGER", "POLEARM", "STAFF"].includes(weapon ?? "")) return "thrust";
  if (weapon && weapon !== "NONE") return "slash";
  if (
    action.id === "basicAttack" ||
    ["Taijutsu", "Bukijutsu"].includes(action.data?.statClassification ?? "")
  )
    return "punch";
  return "spellcast";
};
