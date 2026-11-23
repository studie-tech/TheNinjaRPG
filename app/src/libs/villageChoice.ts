import {
  VILLAGE_CHOICE_FULL_MIN_GAP,
  VILLAGE_CHOICE_FULL_RATIO,
  VILLAGE_CHOICE_MIN_OPEN,
} from "@/drizzle/constants";
import type { QuestContentType } from "@/validators/objectives";

/**
 * Ids of the joinable villages that new Genin cannot choose, because their players active
 * this week exceed the quietest village's by `VILLAGE_CHOICE_FULL_RATIO` and by at least
 * `VILLAGE_CHOICE_FULL_MIN_GAP`. The `VILLAGE_CHOICE_MIN_OPEN` quietest stay open, so the
 * choice never shrinks to a single village.
 */
export const getFullVillageIds = (
  villages: readonly VillageActivity[],
): ReadonlySet<string> => {
  const byActivity = [...villages].sort((a, b) => a.players - b.players);
  const quietest = byActivity[0]?.players ?? 0;
  const limit = Math.max(
    quietest * VILLAGE_CHOICE_FULL_RATIO,
    quietest + VILLAGE_CHOICE_FULL_MIN_GAP,
  );
  return new Set(
    byActivity
      .slice(VILLAGE_CHOICE_MIN_OPEN)
      .filter((village) => village.players > limit)
      .map((village) => village.id),
  );
};

/**
 * The village a dialog answer leads into: the membership reward of the objective that
 * `nextObjectiveId` names in this quest, or undefined when that objective grants none.
 */
export const getDialogVillageMembership = (
  content: Pick<QuestContentType, "objectives"> | undefined,
  nextObjectiveId: string,
) => {
  const objective = content?.objectives.find((entry) => entry.id === nextObjectiveId);
  const membership =
    objective && "reward_village_membership" in objective
      ? objective.reward_village_membership
      : undefined;
  return membership && membership !== "NONE" ? membership : undefined;
};

/** Message shown when a player picks a village that is not taking new Genin. */
export const villageFullMessage = (villageName: string) =>
  `${villageName} has the most active shinobi right now and isn't taking new Genin. Choose another village.`;

/** One joinable village with its players active this week. */
export type VillageActivity = { id: string; players: number };
