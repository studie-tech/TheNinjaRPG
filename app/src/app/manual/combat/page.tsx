"use client";

import { BattleLengthHistogram } from "@/layout/BattleLengthHistogram";
import ContentBox from "@/layout/ContentBox";
import { COMBAT_SECONDS } from "@/libs/combat/constants";

export default function ManualCombat() {
  return (
    <>
      <ContentBox
        title="Combat"
        subtitle="Fighting for survival"
        defaultBackHref="/manual"
      >
        Combat is based on a turn-based system, where each user gets to perform their
        action in turns of {COMBAT_SECONDS} seconds. The user with the highest
        initiative goes first. Each action has a action point cost, and so one or more
        actions may be possible in each turn.
        <h2 className="mt-5 font-bold text-xl">Initiative</h2>
        Initiative is calculated by rolling a random number between 1 and 20 for each
        user. Several modifiers are added to this number:
        <ul className="ml-5 list-disc">
          <li>For each lvl above defender, a bonus of 3% is added</li>
          <li>If in own territory, a bonus of 10% is added</li>
          <li>If outside own territory, initiative is reduced by 10%</li>
          <li>For consecutive PVP kills, stacking bonus of 5-0.25% are added</li>
        </ul>
      </ContentBox>

      <BattleLengthHistogram />
    </>
  );
}
