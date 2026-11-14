import type { ReturnedBattle } from "@/libs/combat/types";

/** A chosen fighter; `pinned` marks a choice from the picker, which battlefield taps keep. */
export type CombatInspection = {
  battleId: string;
  userId: string;
  pinned?: boolean;
} | null;

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

/**
 * Whether tapping a fighter on the battlefield inspects them. On the viewer's turn, a tap that
 * aims the selected action at their own side, such as a buff on themselves or an ally, keeps
 * the panel where it is, even with too few action points or the action cooling down. Outside
 * their turn every tap inspects.
 */
export function inspectsBattlefieldTap(
  battle: ReturnedBattle | null | undefined,
  viewerId: string | undefined,
  tappedUserId: string,
  aimsAction: boolean,
) {
  if (!aimsAction) return true;
  const users = battle?.usersState ?? [];
  const viewer = users.find((user) => user.userId === viewerId);
  const tapped = users.find((user) => user.userId === tappedUserId);
  return !viewer || !tapped || tapped.direction !== viewer.direction;
}

/** Whether a picker pin still holds: a fighter of the shown battle who is still standing. */
export function holdsPin(
  battle: ReturnedBattle | null | undefined,
  selection: CombatInspection,
) {
  return (
    !!selection?.pinned &&
    selection.battleId === battle?.id &&
    !!battle?.usersState.some(
      (user) =>
        user.userId === selection.userId &&
        user.curHealth > 0 &&
        !user.leftBattle &&
        !user.fledBattle,
    )
  );
}
