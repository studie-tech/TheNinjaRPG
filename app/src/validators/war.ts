import { z } from "zod";
import {
  SHRINE_STATUSES,
  WAR_ALLY_OFFER_MIN,
  WAR_STATES,
  WAR_TYPES,
} from "@/drizzle/constants";

export const createAllianceOfferSchema = (maxTokens: number) =>
  z.object({
    amount: z.coerce.number().int().positive().min(WAR_ALLY_OFFER_MIN).max(maxTokens),
  });

export type AllianceOfferSchemaInput = z.input<
  ReturnType<typeof createAllianceOfferSchema>
>;
export type AllianceOfferSchema = z.infer<ReturnType<typeof createAllianceOfferSchema>>;

/**
 * Immutable client snapshot used to prove that an administrator reviewed the exact war state
 * that is being removed. Every mutable War column is included so a combat tick, shrine action,
 * or normal resolution makes an older confirmation stale instead of silently ending a newer
 * state.
 */
export const adminEndWarSnapshotSchema = z.object({
  id: z.string().min(1).max(191),
  attackerVillageId: z.string().min(1).max(191),
  defenderVillageId: z.string().min(1).max(191),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  status: z.enum(WAR_STATES),
  type: z.enum(WAR_TYPES),
  sector: z.number().int(),
  attackerShrineHp: z.number().int(),
  attackerShrineMaxHp: z.number().int(),
  attackerShrineStatus: z.enum(SHRINE_STATUSES),
  defenderShrineHp: z.number().int(),
  defenderShrineMaxHp: z.number().int(),
  defenderShrineStatus: z.enum(SHRINE_STATUSES),
  lastTokenReductionAt: z.string().datetime(),
  targetStructureRoute: z.string(),
  attackerWarHealth: z.number().int(),
  defenderWarHealth: z.number().int(),
  attackerWarHealthMax: z.number().int(),
  defenderWarHealthMax: z.number().int(),
});

export type AdminEndWarSnapshot = z.infer<typeof adminEndWarSnapshotSchema>;

export const adminEndWarInputSchema = z
  .object({
    warId: z.string().min(1).max(191),
    requestId: z.string().uuid().optional(),
    expectedRevision: z.string().min(1).max(191).optional(),
    expectedWar: adminEndWarSnapshotSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasAnySnapshotField =
      value.requestId !== undefined ||
      value.expectedRevision !== undefined ||
      value.expectedWar !== undefined;
    const hasEverySnapshotField =
      value.requestId !== undefined &&
      value.expectedRevision !== undefined &&
      value.expectedWar !== undefined;
    if (hasAnySnapshotField && !hasEverySnapshotField) {
      ctx.addIssue({
        code: "custom",
        message:
          "requestId, expectedRevision, and expectedWar must be supplied together",
      });
    }
    if (value.expectedWar && value.expectedWar.id !== value.warId) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedWar", "id"],
        message: "The expected war must match warId",
      });
    }
  });

/** Small deterministic display revision; the full snapshot is still compared for correctness. */
export const getAdminEndWarRevision = (snapshot: AdminEndWarSnapshot) => {
  const value = JSON.stringify([
    snapshot.id,
    snapshot.attackerVillageId,
    snapshot.defenderVillageId,
    snapshot.startedAt,
    snapshot.endedAt,
    snapshot.status,
    snapshot.type,
    snapshot.sector,
    snapshot.attackerShrineHp,
    snapshot.attackerShrineMaxHp,
    snapshot.attackerShrineStatus,
    snapshot.defenderShrineHp,
    snapshot.defenderShrineMaxHp,
    snapshot.defenderShrineStatus,
    snapshot.lastTokenReductionAt,
    snapshot.targetStructureRoute,
    snapshot.attackerWarHealth,
    snapshot.defenderWarHealth,
    snapshot.attackerWarHealthMax,
    snapshot.defenderWarHealthMax,
  ]);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `war-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const surrenderParticipationRoles = [
  "MAIN_ATTACKER",
  "MAIN_DEFENDER",
  "ALLY_ATTACKER",
  "ALLY_DEFENDER",
] as const;

export const surrenderWarAllySnapshotSchema = z.object({
  id: z.string().min(1).max(191),
  warId: z.string().min(1).max(191),
  villageId: z.string().min(1).max(191),
  supportVillageId: z.string().min(1).max(191),
  tokensPaid: z.number().int(),
  joinedAt: z.string().datetime(),
});

export const surrenderActorSnapshotSchema = z.object({
  userId: z.string().min(1).max(191),
  villageId: z.string().min(1).max(191),
  kageId: z.string().min(1).max(191),
});

export const surrenderWarInputSchema = z
  .object({
    warId: z.string().min(1).max(191),
    requestId: z.string().uuid(),
    expectedRevision: z.string().min(1).max(191),
    expectedWar: adminEndWarSnapshotSchema,
    expectedActor: surrenderActorSnapshotSchema,
    expectedParticipationRole: z.enum(surrenderParticipationRoles),
    expectedWarAlly: surrenderWarAllySnapshotSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.expectedWar.id !== value.warId) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedWar", "id"],
        message: "The expected war must match warId",
      });
    }
    if (getAdminEndWarRevision(value.expectedWar) !== value.expectedRevision) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedRevision"],
        message: "The expected revision must match the expected war",
      });
    }
    const isAlly = value.expectedParticipationRole.startsWith("ALLY_");
    if (isAlly !== (value.expectedWarAlly !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedWarAlly"],
        message: isAlly
          ? "An ally surrender must include the exact ally assignment"
          : "A main participant surrender cannot include an ally assignment",
      });
    }
    if (
      value.expectedWarAlly &&
      (value.expectedWarAlly.warId !== value.warId ||
        value.expectedWarAlly.villageId !== value.expectedActor.villageId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedWarAlly"],
        message: "The expected ally assignment must match this war and village",
      });
    }
  });

export type SurrenderParticipationRole = (typeof surrenderParticipationRoles)[number];
export type SurrenderWarAllySnapshot = z.infer<typeof surrenderWarAllySnapshotSchema>;
export type SurrenderWarInput = z.infer<typeof surrenderWarInputSchema>;
