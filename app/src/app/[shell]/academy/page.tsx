"use client";

import { useState } from "react";
import {
  getUserCaps,
  IMG_BUILDING_ACADEMY,
  MAX_PLAYER_LEVEL,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import QuestPicker from "@/layout/QuestPicker";
import { eliteJoninExamBlockMessage } from "@/libs/profile";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

export default function Academy() {
  const { data: userData } = useRequiredUserDataSelector((u) => ({
    rank: u.rank,
    level: u.level,
    offence: u.offence,
    defence: u.defence,
    strength: u.strength,
    speed: u.speed,
    intelligence: u.intelligence,
    willpower: u.willpower,
  }));
  const isElite = userData?.rank === "ELITE JONIN";
  const hasCompletedMilestones = isElite && userData.level >= MAX_PLAYER_LEVEL;
  const caps = getUserCaps("ELITE JONIN");
  const subtitle = isElite
    ? hasCompletedMilestones
      ? "Elite Jonin milestones complete"
      : "Elite Jonin milestones"
    : "Learning the ropes";
  // State
  const [activeElement, setActiveElement] = useState<string>("");

  // Show board
  return (
    <>
      {activeElement === "" && (
        <ContentBox
          title="Academy"
          subtitle={subtitle}
          defaultBackHref="/village"
          padding={false}
        >
          <Image
            alt="academy-image"
            src={IMG_BUILDING_ACADEMY}
            width={512}
            height={195}
            className="w-full"
            priority={true}
          />
          {hasCompletedMilestones ? (
            <p className="p-3">
              You have reached the maximum level of {MAX_PLAYER_LEVEL}.
            </p>
          ) : isElite ? (
            <p className="p-3">
              Complete milestones to reach level {MAX_PLAYER_LEVEL}. Each milestone
              grants a level, combat stats and larger health, chakra, stamina and energy
              pools. Elite Jonin cannot assign experience to stats. Rank caps:{" "}
              {caps.gens_cap.toLocaleString()} per general and{" "}
              {caps.stats_cap.toLocaleString()} offence and defence.
            </p>
          ) : userData && ["JONIN", "ELDER"].includes(userData.rank) ? (
            <p className="p-3">
              {eliteJoninExamBlockMessage(userData) ??
                "You qualify for the Elite Jonin exam. Choose an available exam below."}
            </p>
          ) : null}
        </ContentBox>
      )}
      <QuestPicker
        questType="starter"
        title={activeElement === "" ? (isElite ? "Milestones" : "Lessons") : "Academy"}
        subtitle={activeElement === "" ? undefined : subtitle}
        unavailableText={
          hasCompletedMilestones
            ? "All Elite Jonin milestones are complete. No lessons available."
            : isElite
              ? "No milestones available right now."
              : "No lessons available right now."
        }
        initialBreak={activeElement === ""}
        activeQuestId={activeElement}
        setActiveQuestId={setActiveElement}
        defaultBackHref={activeElement === "" ? undefined : "/village"}
      />
    </>
  );
}
