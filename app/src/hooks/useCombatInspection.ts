import { atom, useAtom } from "jotai";
import { useEffect } from "react";
import {
  type CombatInspection,
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
  return {
    selectedUser,
    selectedId:
      selection?.battleId === battle?.id && selectedUser?.userId === selection?.userId
        ? selection?.userId
        : undefined,
    selectUser: (userId?: string) =>
      setSelection(battle && userId ? { battleId: battle.id, userId } : null),
  };
}
