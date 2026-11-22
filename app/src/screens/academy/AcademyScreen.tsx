"use client";

import { useState } from "react";
import {
  CHUNIN_EXAM_QUEST_ID,
  getUserCaps,
  IMG_BUILDING_ACADEMY,
  MAX_PLAYER_LEVEL,
} from "@/drizzle/constants";
import { useStoryGuidance } from "@/hooks/useStoryGuidance";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import QuestPicker from "@/layout/QuestPicker";
import { eliteJoninExamBlockMessage } from "@/libs/profile";
import { hasLeadsToShow, isLeadQuest, STORY_SO_FAR } from "@/libs/storyGuidance";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/** Render the academy screen independently of its route adapter. */
export function AcademyScreen() {
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
  const [activeLead, setActiveLead] = useState<string>("");
  // The story chapter is pinned first, so "new story starts at the Academy" holds.
  const { story, item } = useStoryGuidance();
  const pinnedQuestIds = [
    ...(item?.kind === "exam" || item?.kind === "examActive"
      ? [CHUNIN_EXAM_QUEST_ID]
      : []),
    ...(story?.currentQuestId ? [story.currentQuestId] : []),
  ];

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
        pinnedQuestIds={pinnedQuestIds}
      />
      {story && hasLeadsToShow(story) && (
        <QuestPicker
          questType="story"
          title="Leads"
          subtitle="Side cases from Archivist Sora"
          initialBreak
          filterQuest={(quest) => isLeadQuest(quest.id)}
          activeQuestId={activeLead}
          setActiveQuestId={setActiveLead}
          hideWhenEmpty
          // Leads sit under the pinned chapter, so they stay folded until picked.
          autoOpenFirst={false}
        />
      )}
      {story && story.finishedChapters.length > 0 && (
        <ContentBox
          title="Story so far"
          subtitle="The Blacksteel case file"
          initialBreak
        >
          <ol className="space-y-3">
            {story.finishedChapters.map((chapter) => (
              <li key={chapter.chapter} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 font-bold text-amber-600 text-sm dark:text-amber-300">
                  {chapter.chapter}
                </span>
                <div>
                  <p className="font-semibold">{chapter.title}</p>
                  <p className="text-muted-foreground text-sm">
                    {STORY_SO_FAR[chapter.chapter]}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </ContentBox>
      )}
    </>
  );
}
