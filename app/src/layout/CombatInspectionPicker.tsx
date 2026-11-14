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
  const { pinnedId, isPinHeld, followedId, selectedUser, selectUser } =
    useCombatInspection(battle, viewerId);
  const viewer = battle.usersState.find((user) => user.userId === viewerId);
  const groups = [true, false].map((allied) => ({
    allied,
    options: battle.usersState
      .filter(
        (user) =>
          !user.leftBattle &&
          !user.fledBattle &&
          (user.direction === viewer?.direction) === allied,
      )
      .map((user, index) => ({
        userId: user.userId,
        label: `${user.username} (${index + 1})${user.isSummon ? " · Summon" : ""}${user.curHealth <= 0 ? " · Defeated" : ""}`,
      })),
  }));
  const followedLabel = groups
    .flatMap((group) => group.options)
    .find((option) => option.userId === followedId)?.label;
  return (
    <label className="block text-sm">
      Inspect character
      <select
        aria-label="Inspect character"
        className="bg-background text-foreground border-input mt-1 w-full rounded-md border p-2"
        value={pinnedId ?? (followedLabel ? FOLLOWING : "")}
        onChange={(event) => {
          if (event.target.value !== FOLLOWING)
            selectUser(event.target.value || undefined);
        }}
      >
        <option value="" className="bg-background text-foreground">
          Automatic
        </option>
        {/* A tapped fighter shows here, so Automatic and pinning them remain real changes. */}
        {followedLabel && (
          <option value={FOLLOWING} disabled className="bg-background text-foreground">
            Following: {followedLabel}
          </option>
        )}
        {groups.map(({ allied, options }) => (
          <optgroup
            key={String(allied)}
            label={allied ? "Allies" : "Enemies"}
            className="bg-background text-foreground"
          >
            {options.map((option) => (
              <option
                key={option.userId}
                value={option.userId}
                className="bg-background text-foreground"
              >
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selectedUser && (
        <span className="text-muted-foreground text-xs">
          {selectedUser.direction === viewer?.direction ? "Ally" : "Enemy"}
          {isPinHeld ? " · Pinned" : ""}
        </span>
      )}
    </label>
  );
}

const FOLLOWING = "__following";
