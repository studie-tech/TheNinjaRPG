"use client";

import QuestPicker from "@/layout/QuestPicker";

/** Battle Pyramid: towers of increasingly difficult opponents. */
export const PyramidMode = () => (
  <>
    <BattlePyramid />
    <QuestPicker
      questType="battlepyramid"
      title="Battle Pyramids"
      subtitle="Select a tower to start"
      unavailableText="No current battle pyramid quests available"
      initialBreak={true}
    />
  </>
);

const BattlePyramid: React.FC = () => {
  return (
    <div className="p-3">
      Test your skills against increasingly difficult opponents as you climb battle
      pyramid towers. Each level brings new challenges and greater rewards for those
      brave enough to ascend. You can only climb one tower at a time.
    </div>
  );
};
