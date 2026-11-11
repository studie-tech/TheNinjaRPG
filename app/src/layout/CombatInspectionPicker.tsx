import { useCombatInspection } from "@/hooks/useCombatInspection";
import type { ReturnedBattle } from "@/libs/combat/types";

/** Keyboard-accessible inspection that never submits a battlefield action. */
export function CombatInspectionPicker({
  battle,
  viewerId,
}: {
  battle: ReturnedBattle;
  viewerId?: string;
}) {
  const { selectedId, selectedUser, selectUser } = useCombatInspection(
    battle,
    viewerId,
  );
  const viewer = battle.usersState.find((user) => user.userId === viewerId);
  return (
    <label className="block text-sm">
      Inspect character
      <select
        aria-label="Inspect character"
        className="bg-background text-foreground border-input mt-1 w-full rounded-md border p-2"
        value={selectedId ?? ""}
        onChange={(event) => selectUser(event.target.value || undefined)}
      >
        <option value="" className="bg-background text-foreground">
          Automatic
        </option>
        {[true, false].map((allied) => (
          <optgroup
            key={String(allied)}
            label={allied ? "Allies" : "Enemies"}
            className="bg-background text-foreground"
          >
            {battle.usersState
              .filter(
                (user) =>
                  !user.leftBattle &&
                  !user.fledBattle &&
                  (user.direction === viewer?.direction) === allied,
              )
              .map((user, index) => (
                <option
                  key={user.userId}
                  value={user.userId}
                  className="bg-background text-foreground"
                >
                  {user.username} ({index + 1}){user.isSummon ? " · Summon" : ""}
                  {user.curHealth <= 0 ? " · Defeated" : ""}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {selectedUser && (
        <span className="text-muted-foreground text-xs">
          {selectedUser.direction === viewer?.direction ? "Ally" : "Enemy"}
        </span>
      )}
    </label>
  );
}
