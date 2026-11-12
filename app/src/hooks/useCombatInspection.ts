import { atom, useAtom } from "jotai";
import { useEffect } from "react";
import {
  type CombatInspection,
  holdsPin,
  resolveCombatInspection,
} from "@/libs/combat/inspection";
import type { ReturnedBattle } from "@/libs/combat/types";

const combatInspectionAtom = atom<CombatInspection>(null);

/** Share inspection across battle layouts without storing stale combatant snapshots. */
export function useCombatInspection(
  battle: ReturnedBattle | null | undefined,
  viewerId?: string,
) {
  const [selection, setSelection] = useAtom(combatInspectionAtom);
  const selectedUser = resolveCombatInspection(battle, viewerId, selection);
  useEffect(() => {
    if (
      selection &&
      battle &&
      (selection.battleId !== battle.id ||
        !battle.usersState.some(
          (user) =>
            user.userId === selection.userId && !user.leftBattle && !user.fledBattle,
        ))
    ) {
      setSelection((current) => (current === selection ? null : current));
    }
  }, [battle, selection, setSelection]);
  const shownId =
    selection && selection.battleId === battle?.id ? selection.userId : undefined;
  const isShown = shownId !== undefined && selectedUser?.userId === shownId;
  return {
    selectedUser,
    /** The fighter pinned in the picker. */
    pinnedId: isShown && selection?.pinned ? shownId : undefined,
    /** Whether the pin still keeps battlefield taps from changing the panel. */
    isPinHeld: holdsPin(battle, selection),
    /** The fighter last tapped on the battlefield while nothing is pinned. */
    followedId: isShown && !selection?.pinned ? shownId : undefined,
    /** Pin a fighter from the picker, or return to automatic inspection. */
    selectUser: (userId?: string) =>
      setSelection(
        battle && userId ? { battleId: battle.id, userId, pinned: true } : null,
      ),
    /** Inspect a fighter tapped on the battlefield unless a pin holds. */
    inspectTapped: (userId: string) =>
      setSelection((current) =>
        !battle || holdsPin(battle, current)
          ? current
          : { battleId: battle.id, userId },
      ),
  };
}
