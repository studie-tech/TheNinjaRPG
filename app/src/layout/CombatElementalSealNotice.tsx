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
  const hasElementalSeal = !!getUserElementalSeal(userId, battle.usersEffects);

  return (
    <p
      role="status"
      aria-atomic="true"
      className={
        hasElementalSeal ? "bg-muted rounded-md border px-3 py-2 text-sm" : "sr-only"
      }
    >
      {hasElementalSeal && (
        <>
          <strong>Elemental Seal is active.</strong> Affected elemental jutsu are hidden
          until the seal ends.
        </>
      )}
    </p>
  );
};
