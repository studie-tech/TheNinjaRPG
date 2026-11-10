import type { RouterOutputs } from "@/app/_trpc/client";
import type { VillageDutyShift } from "@/drizzle/schema";
import { villageDutyActorId } from "@/libs/villageDuty";

/** Publish only copy availability and pursuit changes already known from the guarded patrol mutation. */
export const buildVillageDutyPatrolUpdate = (
  shift: VillageDutyShift,
  sector: number,
  eligibleUserIds: ReadonlySet<string>,
  claimedSlot?: number,
) => ({
  sector,
  startedAt: shift.startedAt,
  revision: shift.revision + Number(claimedSlot !== undefined),
  patrols: shift.patrols.map((patrol, index) => ({
    userId: villageDutyActorId(patrol.userId),
    available:
      eligibleUserIds.has(patrol.userId) &&
      !patrol.defeated &&
      !patrol.battleId &&
      claimedSlot !== index,
    pursuit: patrol.pursuit ?? null,
  })),
});

/** Keep loaded artwork while applying known motion; new hourly identities require one authoritative read. */
export const getVillageDutySectorUpdate = (
  current: RouterOutputs["travel"]["getSectorData"],
  update: ReturnType<typeof buildVillageDutyPatrolUpdate>,
): RouterOutputs["travel"]["getSectorData"] | undefined => {
  if (
    !current.protectors ||
    current.sectorData?.sector !== update.sector ||
    current.patrolShiftAt?.getTime() !== update.startedAt.getTime()
  )
    return;
  const states = new Map(update.patrols.map((patrol) => [patrol.userId, patrol]));
  const existing = new Set(current.protectors?.map((patrol) => patrol.userId));
  if (update.patrols.some((patrol) => patrol.available && !existing.has(patrol.userId)))
    return;
  return {
    ...current,
    patrolRevision: update.revision,
    patrolThreat:
      !!current.patrolThreat && update.patrols.some((patrol) => patrol.available),
    protectors: (current.protectors ?? []).flatMap((patrol) => {
      const state = states.get(patrol.userId);
      return state?.available
        ? [
            {
              ...patrol,
              npcWander: patrol.npcWander
                ? { ...patrol.npcWander, pursuit: state.pursuit ?? undefined }
                : undefined,
            },
          ]
        : [];
    }),
  };
};
