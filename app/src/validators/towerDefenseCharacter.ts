import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { towerDefenseCharacter } from "@/drizzle/schema";
import { characterAssetConfigSchema } from "@/validators/towerDefense";

/**
 * Derived from the table definition, so it keeps the drizzle schema out of
 * validators/towerDefense.ts, which the tower-defense game itself imports.
 */
export const insertTowerDefenseCharacterSchema = createInsertSchema(
  towerDefenseCharacter,
  {
    name: z.string().min(1).max(191),
    isPlayer: z.boolean(),
    baseHealth: z.int().min(1),
    baseSpeed: z.number().min(0.01),
    baseDamage: z.int().min(0),
    attackCooldown: z.number().min(0.1),
    healthScaling: z.number().min(0),
    speedScaling: z.number().min(0),
    damageScaling: z.number().min(0),
    firstAppearWave: z.int().min(1),
    baseCount: z.int().min(1),
    countScaling: z.number().min(0),
    scaleFactor: z.number().min(0.1),
    assetConfig: characterAssetConfigSchema.nullable(),
  },
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTowerDefenseCharacter = z.output<
  typeof insertTowerDefenseCharacterSchema
>;
export type InsertTowerDefenseCharacterInput = z.input<
  typeof insertTowerDefenseCharacterSchema
>;
