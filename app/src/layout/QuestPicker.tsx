"use client";

import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { LogbookEntry } from "@/layout/Logbook";
import { showMutationToast } from "@/libs/toast";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Gamepad2 } from "lucide-react";
import Accordion from "@/layout/Accordion";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { useState, useEffect } from "react";
import { useRequiredUserData } from "@/utils/UserContext";
import type { QuestType } from "@/drizzle/constants";

interface QuestPickerProps {
  questType: QuestType;
  title: string;
  subtitle: string;
  introduction?: string;
}

const QuestPicker: React.FC<QuestPickerProps> = (props) => {
  // Utils
  const util = api.useUtils();

  // State
  const [activeElement, setActiveElement] = useState<string>("");
  const { data: userData } = useRequiredUserData();

  // Query
  const { data: quests } = api.quests.specificQuests.useQuery({
    level: userData?.level ?? 0,
    questType: props.questType,
  });

  const { mutate: startQuest, isPending } = api.quests.startQuest.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await Promise.all([
        util.profile.getUser.invalidate(),
        util.quests.specificQuests.invalidate(),
      ]);
    },
  });

  // Default active tab
  useEffect(() => {
    if (userData && !activeElement) {
      const currentQuest = userData?.userQuests?.find((uq) =>
        [props.questType].includes(uq.quest.questType),
      );
      if (currentQuest) {
        setActiveElement(currentQuest.quest.name);
      }
    }
  }, [userData, activeElement, props.questType]);

  if (!userData) return null;

  // Filter for story quests only
  const availableQuests = quests ?? [];

  return (
    <ContentBox
      title={props.title}
      subtitle={props.subtitle}
      initialBreak={true}
      padding={false}
    >
      {props.introduction && (
        <p className="text-center text-xl font-bold mb-4 px-3 pt-3">
          {props.introduction}
        </p>
      )}
      {isPending && <Loader explanation="Starting quest..." />}
      {!isPending && (
        <div className="bg-popover">
          {availableQuests.length === 0 && (
            <p className="font-bold p-3">
              No current {props.questType} quests available
            </p>
          )}
          {availableQuests.map((quest, i) => {
            const currentQuest = userData?.userQuests?.find(
              (uq) => uq.quest.id === quest.id && !uq.endAt,
            );
            const currentTracker = userData?.questData?.find((q) => q.id === quest.id);
            const active = currentQuest && currentTracker;

            return (
              <div key={i}>
                <Accordion
                  title={quest.name}
                  selectedTitle={activeElement}
                  titlePrefix={`${active ? "Active" : "Available"}: `}
                  onClick={setActiveElement}
                >
                  {active ? (
                    <div className="p-3">
                      <LogbookEntry
                        userQuest={currentQuest}
                        tracker={currentTracker}
                        hideTitle
                        showScene
                      />
                    </div>
                  ) : (
                    <ItemWithEffects
                      item={quest}
                      showEdit="quest"
                      imageExtra={
                        <Button
                          className="mt-2"
                          onClick={() =>
                            startQuest({
                              questId: quest.id,
                              userSector: userData.sector,
                            })
                          }
                        >
                          <Gamepad2 className="mr-1 h-6 w-6" />
                          Take Quest
                        </Button>
                      }
                      hideTitle
                    />
                  )}
                </Accordion>
              </div>
            );
          })}
        </div>
      )}
    </ContentBox>
  );
};

export default QuestPicker;
