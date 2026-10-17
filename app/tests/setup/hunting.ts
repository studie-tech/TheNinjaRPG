import { huntingContractSchema, type HuntingBattleState, type HuntingHabitatContent } from "@/validators/hunting";

/** Valid contract fixture with one guaranteed material and one optional bonus drop. */
export const huntingContract = () => huntingContractSchema.parse({
  id: "contract", name: "Forest boar", aiId: "enemy", rank: "D RANK", difficulty: "Easy", enabled: true, sectors: [1], preparationSeconds: 10, hunts: 3, cooldownSeconds: 60, experience: 50,
  rewards: [{ itemId: "hide", quantity: 2, chance: 100 }, { itemId: "tusk", quantity: 1, chance: 50 }],
});
/** Enabled habitat whose contract and encounter location belong to the same sector. */
export const huntingHabitatContent = (): HuntingHabitatContent => ({ name: "Forest", description: "Forest wildlife", enabled: true, sectors: [1], contracts: [huntingContract()] });
/** Complete preloaded settlement data, including the session/progress CAS versions. */
export const huntingBattleState = (): HuntingBattleState => ({ userId: "hunter", sessionId: "session", sessionVersion: 0, habitatId: "forest", habitatUpdatedAt: new Date(0).toISOString(), contract: huntingContract(), used: 0, progressVersion: 0, huntingExperience: 123, materialNames: { hide: "Boar hide", tusk: "Boar tusk" }, materialStacks: { hide: 1, tusk: 10 } });

/** Minimal traversable published-map content with the spawn anchor used by admission. */
export const huntingMap = (): import("@/libs/sector-map/types").NormalizedSectorMap => ({
  formatVersion: 1, sector: 1, name: "Forest", width: 1, height: 1,
  tiles: [{ x: 0, y: 0, terrain: "ground", walkCost: 1, blocked: false, zone: "wilderness", battleBiome: "ground" }],
  objects: [], anchors: [{ key: "spawn.default", x: 0, y: 0 }], exits: [], metadata: { importedAt: "2026-01-01T00:00:00Z", source: "tiled" },
});
