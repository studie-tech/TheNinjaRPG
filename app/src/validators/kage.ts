import { z } from "zod";
import { KAGE_DEFENSE_MIN_DAYS, KAGE_DEFENSE_WINDOW_HOURS } from "@/drizzle/constants";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const kageVillageSchema = z.object({ villageId: z.string().min(1) });
/** Weekly UTC window start; Sunday is day zero and the full window must fit within its day. */
export const kageWindowSchema = z.object({
  day: z.number().int().min(0).max(6),
  hour: z
    .number()
    .int()
    .min(0)
    .max(24 - KAGE_DEFENSE_WINDOW_HOURS),
});
/** Shared client/server publication rules: distinct days and the configured minimum availability. */
export const kageScheduleSchema = kageVillageSchema.extend({
  windows: z
    .array(kageWindowSchema)
    .min(KAGE_DEFENSE_MIN_DAYS)
    .max(7)
    .refine(
      (windows) => new Set(windows.map((w) => w.day)).size === windows.length,
      "Choose different days for each defense window",
    ),
});
export const kageBattleResponseSchema = userDeltaResponseSchema.extend({
  battleId: z.string().optional(),
});

export type KageWindow = z.infer<typeof kageWindowSchema>;
/** Persisted JSON for one Kage tenure; timestamps are ISO strings rather than Date objects. */
export type KageDefenseSchedule = {
  kageId: string;
  tenure: string;
  windows: KageWindow[];
  publishedAt: string | null;
  /** Publication deadline extended when war or service gaps prevent participation. */
  setupDueAt?: string;
  missedStarts: number;
  paused: boolean;
  /** Last reconciliation, used to avoid treating unobserved service gaps as player absences. */
  observedAt: string;
  /** One short-lived invitation, bound to this tenure and an unchanged appointment. */
  instantChallenge?: {
    id: string;
    matchId: string;
    scheduledAt: string;
    expiresAt: string;
    ai: boolean;
  };
  vacancy?: { removedUserId: string; reason: string };
  /** Why the previous incumbent lost the title when an elder was appointed in their place. */
  predecessor?: {
    removedUserId: string;
    removedUsername: string;
    removedAt: string;
    reason: string;
  };
};
