import type { ReturnedBattle } from "@/libs/combat/types";
import { getUserElementalSeal } from "@/libs/combat/util";

/** Explain temporary action removal for the actor whose action bar is displayed. */
export const CombatElementalSealNotice = ({
  battle,
  userId,
}: {
  battle: ReturnedBattle;
  userId: string | undefined;
}) => {
  if (!getUserElementalSeal(userId, battle.usersEffects)) return null;

  return (
    <p role="status" className="bg-muted rounded-md border px-3 py-2 text-sm">
      <strong>Elemental Seal is active.</strong> Affected elemental jutsu are hidden
      until the seal ends.
    </p>
  );
};
