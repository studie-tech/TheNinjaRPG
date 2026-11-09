"use client";

import { BattleLengthHistogram } from "@/layout/BattleLengthHistogram";
import ContentBox from "@/layout/ContentBox";
import { DmgConfigDialog } from "@/layout/DmgConfigDialog";
import Link from "@/layout/Link";
import {
  COMBAT_SECONDS,
  INITIATIVE_LEVEL_BONUS,
  INITIATIVE_PVP_STREAK_BONUSES,
  INITIATIVE_TERRITORY_BONUS,
} from "@/libs/combat/constants";
import { canModifyCombatSettings } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualCombat() {
  const { data: userData } = useUserData();
  const isAdmin = userData?.role ? canModifyCombatSettings(userData.role) : false;

  return (
    <>
      <ContentBox
        title="Combat"
        subtitle="Fighting for survival"
        defaultBackHref="/manual"
        topRightContent={isAdmin ? <DmgConfigDialog /> : undefined}
      >
        Combat is based on a turn-based system, where each user gets to perform their
        action in turns of {COMBAT_SECONDS} seconds. The user with the highest
        initiative goes first. Each action has a action point cost, and so one or more
        actions may be possible in each turn. For a full how-to, read the{" "}
        <Link
          href="/guide/combat"
          className="font-bold text-orange-500 hover:text-orange-700"
        >
          combat guide
        </Link>
        .<h2 className="mt-5 font-bold text-xl">Initiative</h2>
        Initiative is calculated by rolling a random number between 1 and 20 for each
        user. The roll is then adjusted by these modifiers:
        <ul className="ml-5 list-disc">
          <li>
            For each level above the average level of all combatants (including you), a
            bonus of {formatPercent(INITIATIVE_LEVEL_BONUS)} is added
          </li>
          <li>
            If in own territory, a bonus of {formatPercent(INITIATIVE_TERRITORY_BONUS)}{" "}
            is added
          </li>
          <li>
            If outside own territory, initiative is reduced by{" "}
            {formatPercent(INITIATIVE_TERRITORY_BONUS)}
          </li>
          <li>
            For consecutive PvP kills, the streak adds{" "}
            {streakSteps.map(formatPercent).join(", ")} for the first{" "}
            {streakSteps.length} kills, then {formatPercent(streakTail)} for each
            further kill
          </li>
        </ul>
      </ContentBox>

      <BattleLengthHistogram />
    </>
  );
}

const streakSteps = INITIATIVE_PVP_STREAK_BONUSES.slice(0, -1);
const streakTail =
  INITIATIVE_PVP_STREAK_BONUSES[INITIATIVE_PVP_STREAK_BONUSES.length - 1] ?? 0;

/** Display initiative rule fractions as percentages without redundant trailing zeroes. */
const formatPercent = (fraction: number) => `${Number((fraction * 100).toFixed(2))}%`;
