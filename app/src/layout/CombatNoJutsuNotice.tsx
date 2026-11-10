import Link from "@/layout/Link";
import type { ReturnedBattle } from "@/libs/combat/types";

/**
 * Tell a player who brought no jutsu into this battle why only basic actions show,
 * and where to equip jutsu for the next fight.
 */
export const CombatNoJutsuNotice = ({
  battle,
  userId,
}: {
  battle: ReturnedBattle;
  userId: string | undefined;
}) => {
  const sessionUser = battle.usersState.find(
    (user) => user.userId === userId && user.isOriginal,
  );
  if (!sessionUser || sessionUser.isAi || !sessionUser.jutsus) return null;
  if (sessionUser.jutsus.length > 0) return null;

  return (
    <p
      role="status"
      className="rounded-md border border-red-600 bg-red-600/10 px-3 py-2 text-sm"
    >
      <strong>You have no jutsu equipped.</strong> Only basic actions are available in
      this battle. Equip jutsu on the{" "}
      <Link href="/jutsus" className="font-bold underline">
        Jutsu page
      </Link>{" "}
      before your next fight.
    </p>
  );
};
