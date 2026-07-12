import {
  IMG_MANUAL_SAGE_MODE,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
} from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import type { ZodAllTags } from "@/validators/combat";

/**
 * Fallback definition backing the in-combat Activation action. No DB row is seeded for
 * this jutsu; it is injected into battle state from this constant during initiateBattle,
 * and its image is overridden per equipped sage mode at action-build time.
 */
const effects: ZodAllTags[] = [
  {
    type: "activatesagemode",
    description: "Enter sage mode",
    target: "SELF",
    direction: "offence",
    calculation: "static",
    power: 1,
    powerPerLevel: 0,
    rounds: 0,
    staticAssetPath: "",
    staticAnimation: "",
    appearAnimation: "",
    disappearAnimation: "",
    appearSfx: "",
    disappearSfx: "",
  },
];

export const SAGE_MODE_ACTIVATION_JUTSU_FALLBACK: Jutsu = {
  id: SAGE_MODE_ACTIVATION_JUTSU_ID,
  name: "Activation",
  description:
    "Channel natural energy to enter sage mode. Activation costs and combat effects are defined on your sage mode.",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  extraBaseCost: 0,
  effects,
  target: "SELF",
  range: 0,
  cooldown: 0,
  bloodlineId: null,
  requiredLevel: 1,
  requiredRank: "STUDENT",
  jutsuType: "SPECIAL",
  image: IMG_MANUAL_SAGE_MODE,
  jutsuWeapon: "NONE",
  statClassification: "Ninjutsu",
  battleDescription: "%user enters sage mode!",
  jutsuRank: "D",
  actionCostPerc: 80,
  staminaCost: 0,
  chakraCost: 0,
  staminaCostReducePerLvl: 0,
  chakraCostReducePerLvl: 0,
  healthCostReducePerLvl: 0,
  healthCost: 0,
  villageId: null,
  method: "SINGLE",
  hidden: true,
  injectableInBattle: true,
  battleUsageType: "BOTH",
  parentJutsuId: null,
  requiredNinjutsuOffence: null,
  requiredNinjutsuDefence: null,
  requiredGenjutsuOffence: null,
  requiredGenjutsuDefence: null,
  requiredTaijutsuOffence: null,
  requiredTaijutsuDefence: null,
  requiredBukijutsuOffence: null,
  requiredBukijutsuDefence: null,
  requiredStrength: null,
  requiredSpeed: null,
  requiredIntelligence: null,
  requiredWillpower: null,
  requiredBloodlineItemId: null,
};
