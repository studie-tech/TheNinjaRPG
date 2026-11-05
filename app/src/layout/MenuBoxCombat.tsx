import { useAtomValue } from "jotai";
import { Link2 } from "lucide-react";
import type React from "react";
import { SideBannerTitle } from "@/components/layout/shared/LayoutSidebars";
import { useEffectivePools } from "@/hooks/useEffectivePools";
import AvatarImage from "@/layout/Avatar";
import { BattleUserTraits } from "@/layout/BattleUserTraits";
import Link from "@/layout/Link";
import { VisualizeEffects } from "@/layout/MenuBoxProfile";
import { PoolStatusBars } from "@/layout/PoolStatusBars";
import { userBattleAtom, useUserData } from "@/utils/UserContext";

const MenuBoxCombat: React.FC = () => {
  // State
  const { data: userData, timeDiff } = useUserData();
  const battle = useAtomValue(userBattleAtom);

  // Battle user state (enemy)
  const battleUser = battle?.usersState.find(
    (u) => u.userId !== userData?.userId && !u.isSummon,
  );

  // Calculate effective pool values with fallbacks
  const pools = useEffectivePools({
    battleUser,
    usersEffects: battle?.usersEffects,
  });

  // Guard
  if (!battleUser) return null;

  return (
    <>
      <SideBannerTitle>
        {/* AI combatants are given a synthetic id when the battle starts, so they have
            no profile to link to. The link used to land on a "user does not exist" body
            served with HTTP 200; it now resolves to a real 404, so do not offer it. */}
        {battleUser.isAi || battleUser.isMasked ? (
          battleUser.username
        ) : (
          <Link
            href={`/userid/${battleUser.userId}`}
            className="inline-block flex flex-row hover:text-orange-500"
          >
            {battleUser.username} <Link2 className="inline-block h-5 w-5" />
          </Link>
        )}
      </SideBannerTitle>
      <div className="grid grid-cols-2 items-center justify-center md:grid-cols-1">
        <Link href="/profile">
          <AvatarImage
            href={battleUser.avatar}
            alt={battleUser.username}
            size={100}
            hover_effect={true}
            priority
          />
        </Link>

        <div className="pt-5">
          <PoolStatusBars
            pools={pools}
            remountOnChange
            lastRegenAt={battleUser.regenAt}
            regen={0}
            status={"AWAKE"}
            timeDiff={timeDiff}
          />
        </div>
      </div>
      {battle && (
        <BattleUserTraits
          battle={battle}
          battleUser={battleUser}
          className="contents"
        />
      )}
      {/* Active Effects on opponent */}
      {battle?.usersEffects && (
        <div className="mt-2">
          <VisualizeEffects
            effects={battle.usersEffects}
            userId={battleUser.userId}
            diffuseDamage={battleUser.diffuseDamage}
          />
        </div>
      )}
    </>
  );
};

export default MenuBoxCombat;
