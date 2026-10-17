import { z } from "zod";
import {
  HUNTING_RANKS,
  MAP_SECTOR_ID_MAX,
  MAP_SECTOR_ID_MIN,
} from "@/drizzle/constants";

/** Sector IDs stay within the world map; published-map reachability is checked server-side. */
const sectorSchema = z.number().int().min(MAP_SECTOR_ID_MIN).max(MAP_SECTOR_ID_MAX);
/** A 100% drop is guaranteed; lower chances are rolled once per victorious encounter. */
export const huntingRewardSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(1000),
  chance: z.number().min(0.01).max(100),
});
/** Authored target, allowance and rewards; every contract guarantees at least one material. */
export const huntingContractSchema = z
  .object({
    id: z.string().min(1).max(191),
    name: z.string().trim().min(1).max(100),
    aiId: z.string().min(1),
    rank: z.enum(HUNTING_RANKS),
    difficulty: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    sectors: z.array(sectorSchema).min(1).max(100),
    preparationSeconds: z.number().int().min(0).max(86400),
    hunts: z.number().int().min(1).max(1000),
    cooldownSeconds: z.number().int().min(1).max(2592000),
    experience: z.number().int().min(0).max(1000000),
    rewards: z.array(huntingRewardSchema).min(1).max(20),
  })
  .refine((c) => c.rewards.some((r) => r.chance === 100), {
    message: "Every contract needs at least one guaranteed material.",
    path: ["rewards"],
  });
/** Keep contract IDs unique within a habitat and encounter sectors inside its region. */
export const huntingHabitatSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(2000),
    enabled: z.boolean(),
    sectors: z.array(sectorSchema).min(1).max(100),
    contracts: z.array(huntingContractSchema).max(100),
  })
  .superRefine((h, ctx) => {
    const ids = new Set<string>();
    h.contracts.forEach((c, i) => {
      if (ids.has(c.id))
        ctx.addIssue({
          code: "custom",
          path: ["contracts", i, "id"],
          message: "Contract IDs must be unique.",
        });
      ids.add(c.id);
      if (c.sectors.some((s) => !h.sectors.includes(s)))
        ctx.addIssue({
          code: "custom",
          path: ["contracts", i, "sectors"],
          message: "Encounter locations must belong to the habitat.",
        });
    });
  });
/** An omitted ID creates a habitat; an existing ID updates the same authored definition. */
export const saveHuntingHabitatSchema = z.object({
  id: z.string().optional(),
  content: huntingHabitatSchema,
});
/** Identify the habitat or personal session addressed by its procedure. */
export const huntingIdSchema = z.object({ id: z.string().min(1) });
/** A null version creates a session; an existing version guards contract switching. */
export const acceptHuntingContractSchema = z.object({
  habitatId: z.string().min(1),
  contractId: z.string().min(1),
  version: z.number().int().nullable(),
});
/** Both preparation and finish must claim the exact session version displayed to the player. */
export const huntingSessionActionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int(),
  action: z.enum(["prepare", "finish"]),
});
export type HuntingHabitatContent = z.infer<typeof huntingHabitatSchema>;
export type HuntingContract = z.infer<typeof huntingContractSchema>;
/** Committed encounter outcome shared by the persisted session and combat result screen. */
export type HuntingReceipt = {
  battleId: string;
  outcome: "Won" | "Lost" | "Draw" | "Fled";
  contractName: string;
  experience: number;
  totalExperience: number;
  remaining: number;
  cooldownUntil: string | null;
  materials: { itemId: string; name: string; quantity: number; bonus: boolean }[];
};
/** Current contract rules are loaded at each start; a running battle carries all settlement data. */
export type HuntingBattleState = {
  userId: string;
  sessionId: string;
  sessionVersion: number;
  contract: HuntingContract;
  habitatId: string;
  habitatUpdatedAt: string;
  progressVersion: number;
  used: number;
  huntingExperience: number;
  materialNames: Record<string, string>;
  materialStacks: Record<string, number>;
};
