"use client";

import QuestPicker from "@/layout/QuestPicker";
import { isLeadQuest } from "@/libs/storyGuidance";

/**
 * The Global ANBU HQ's story missions. Leads belong to the Blacksteel Thread and are
 * picked up at the Academy, so they are left out here.
 */
export const StoryMissionPicker: React.FC = () => (
  <QuestPicker
    questType="story"
    title="Story Missions"
    subtitle="Global Anbu HQ"
    introduction="Story missions are special assignments that advance the game's narrative. They can only be started here at the Global Anbu HQ."
    initialBreak={true}
    filterQuest={(quest) => !isLeadQuest(quest.id)}
  />
);
