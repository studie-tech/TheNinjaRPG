"use client";

import ContentBox from "@/layout/ContentBox";
import { QuestTeams } from "@/layout/QuestTeams";

/** Mount the full team roster, discovery controls and shared conversation in the game shell. */
export function QuestTeamsScreen() {
  return (
    <ContentBox title="Quest Teams" subtitle="Explore Seichi together" padding={false}>
      <QuestTeams />
    </ContentBox>
  );
}
