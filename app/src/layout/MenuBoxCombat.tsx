import { useAtomValue } from "jotai";
import { Link2 } from "lucide-react";
import type React from "react";
import { useCombatInspection } from "@/hooks/useCombatInspection";
import { useEffectivePools } from "@/hooks/useEffectivePools";
import AvatarImage from "@/layout/Avatar";
import { BattleUserTraits } from "@/layout/BattleUserTraits";
import { CombatInspectionPicker } from "@/layout/CombatInspectionPicker";
import Link from "@/layout/Link";
import { PoolStatusBars } from "@/layout/PoolStatusBars";
import { SideBannerTitle } from "@/layout/SideBannerTitle";
import { VisualizeEffects } from "@/layout/VisualizeEffects";
import {
  combatPresentedBattleAtom,
  userBattleAtom,
  useUserData,
} from "@/utils/UserContext";

/** Inspect the presented combatant snapshot while preserving masked-player and AI profile restrictions. */
const MenuBoxCombat: React.FC = () => {
  // State
  const { data: userData, timeDiff } = useUserData();
  const liveBattle = useAtomValue(userBattleAtom);
  const presentedBattle = useAtomValue(combatPresentedBattleAtom);
  // Follows the field, so a form never appears here before it has risen.
  const battle =
    presentedBattle?.id === liveBattle?.id
      ? (presentedBattle ?? liveBattle)
      : liveBattle;

  // Character inspection follows the visible snapshot.
  const { selectedUser: battleUser } = useCombatInspection(battle, userData?.userId);

  // Calculate effective pool values with fallbacks
  const pools = useEffectivePools({
    battleUser,
    usersEffects: battle?.usersEffects,
  });

  // Guard
  if (!battleUser)
    return battle ? (
      <CombatInspectionPicker battle={battle} viewerId={userData?.userId} />
    ) : null;

  return (
    <>
      {battle && <CombatInspectionPicker battle={battle} viewerId={userData?.userId} />}
      <SideBannerTitle>
        {/* AI combatants get a synthetic id when the battle starts and masked users
            hide theirs, so neither has a profile to link to. */}
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
        {battleUser.isAi || battleUser.isMasked ? (
          <AvatarImage
            href={battleUser.avatar}
            alt={battleUser.username}
            size={100}
            priority
          />
        ) : (
          <Link href={`/userid/${battleUser.userId}`}>
            <AvatarImage
              href={battleUser.avatar}
              alt={battleUser.username}
              size={100}
              hover_effect={true}
              priority
            />
          </Link>
        )}

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
      {/* Active effects on the inspected character */}
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
