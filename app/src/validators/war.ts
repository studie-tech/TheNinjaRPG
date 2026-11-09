import { z } from "zod";
import { OBJECTIVE_WAR_DEFAULTS, WAR_ALLY_OFFER_MIN } from "@/drizzle/constants";

export const createAllianceOfferSchema = (maxTokens: number) =>
  z.object({
    amount: z.coerce.number().int().positive().min(WAR_ALLY_OFFER_MIN).max(maxTokens),
  });

export type AllianceOfferSchemaInput = z.input<
  ReturnType<typeof createAllianceOfferSchema>
>;
export type AllianceOfferSchema = z.infer<ReturnType<typeof createAllianceOfferSchema>>;

/** Frozen recipients and delivery receipts for a completed war. */
export type WarSettlement = {
  villageIds: string[];
  winningVillageIds: string[];
  warIds: string[];
  notificationContent: string;
  /** Epoch milliseconds captured by the terminal write; absent on older receipts. */
  cleanupCutoff?: number;
  boostsDelivered: boolean;
  structuresDelivered: boolean;
  notified: boolean;
};

const positiveRule = z.number().int().min(1).max(100000000);
const roleRule = z.number().int().min(0).max(10000);
/** Staff-editable rules validated before saving and frozen at declaration approval. */
export const warRulesSchema = z.object({
  enabled: z.boolean(),
  townhallHp: positiveRule,
  shrineHp: positiveRule.max(30000),
  declarationCost: positiveRule,
  noticeHours: positiveRule.max(168),
  durationDays: positiveRule.max(30),
  dailyDecay: roleRule,
  guardianDamage: roleRule,
  objectiveDamage: roleRule,
  campDamage: roleRule,
  regularDamage: roleRule,
  regularRecovery: roleRule,
  anbuDamage: roleRule,
  anbuRecovery: roleRule,
  assassinDamage: roleRule,
  assassinRecovery: roleRule,
  elderDamage: roleRule,
  elderRecovery: roleRule,
  coleaderDamage: roleRule,
  coleaderRecovery: roleRule,
  leaderDamage: roleRule,
  leaderRecovery: roleRule,
});
export type WarRules = z.infer<typeof warRulesSchema>;
/** Default-off settings used when staff have not saved an override. */
export const defaultWarRules: WarRules = { ...OBJECTIVE_WAR_DEFAULTS };
/** Original defending side stays fixed after capture so receipt indices remain stable. */
export type WarObjectiveState = {
  sector: number;
  villageId: string;
  hp: number;
  maxHp: number;
  isReserve: boolean;
  destroyed: boolean;
};
/** Shared war progress; location masking removes objectives but retains both counters. */
export type ObjectiveWarState = {
  objectives: WarObjectiveState[];
  attackerEspionage: number;
  defenderEspionage: number;
};
/** Authored mission values and ISO completion time captured independently of quest progress. */
export type WarMissionAttempt = {
  id: string;
  warId: string;
  questId: string;
  objectiveId: string;
  sideVillageId: string;
  villageId: string | null;
  sector: number;
  task: "espionage" | "sabotage";
  value: number;
  endsAt: string;
};
