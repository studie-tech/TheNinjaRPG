import type { ReturnedBattle } from "@/libs/combat/types";

export type CombatInspection = { battleId: string; userId: string } | null;

/** Resolve inspection only from the snapshot currently visible on the battlefield. */
export function resolveCombatInspection(
  battle: ReturnedBattle | null | undefined,
  viewerId: string | undefined,
  selection: CombatInspection,
) {
  const users = battle?.usersState ?? [];
  const selected =
    selection?.battleId === battle?.id
      ? users.find(
          (user) =>
            user.userId === selection?.userId && !user.leftBattle && !user.fledBattle,
        )
      : undefined;
  if (selected) return selected;
  const viewer = users.find((user) => user.userId === viewerId);
  const enemies = users.filter(
    (user) =>
      user.userId !== viewerId &&
      !user.isSummon &&
      (!viewer || user.direction !== viewer.direction),
  );
  const remaining = enemies.filter((user) => !user.leftBattle && !user.fledBattle);
  return remaining.find((user) => user.curHealth > 0) ?? remaining[0] ?? enemies[0];
}
