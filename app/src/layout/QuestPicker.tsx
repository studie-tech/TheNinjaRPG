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
import { useTutorialStep } from "@/hooks/tutorial";
import { useState, useEffect } from "react";
import { useRequiredUserData } from "@/utils/UserContext";
import type { QuestType } from "@/drizzle/constants";

interface QuestPickerProps {
  questType: QuestType;
  title: string;
  subtitle: string;
  defaultBackHref?: string;
  introduction?: string;
  unavailableText?: string;
  initialBreak?: boolean;
  activeQuestId?: string;
  setActiveQuestId?: React.Dispatch<React.SetStateAction<string>>;
}

const QuestPicker: React.FC<QuestPickerProps> = (props) => {
  // Utils
  const util = api.useUtils();

  // State
  const [localActiveElement, setLocalActiveElement] = useState<string>("");
  const { data: userData } = useRequiredUserData();

  // State management
  const activeElement = props.activeQuestId || localActiveElement;
  const setActiveElement = props.setActiveQuestId || setLocalActiveElement;

  // Query
  const { data: quests } = api.quests.specificQuests.useQuery({
    level: userData?.level ?? 0,
    questType: props.questType,
  });

  // Tutorial step
  const { currentStep, handleNextStepAsync } = useTutorialStep();

  // Mutations
  const { mutate: startQuest, isPending } = api.quests.startQuest.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (currentStep?.title === "Genin Exam") {
        await handleNextStepAsync();
      }
      await Promise.all([
        util.profile.getUser.invalidate(),
        util.quests.specificQuests.invalidate(),
      ]);
    },
  });

  // Default active tab
  useEffect(() => {
    // Ensure that we are using the correct active element
    const activeQuest = activeElement && quests?.find((q) => q.name === activeElement);
    if (!activeQuest) setActiveElement("");
    // If active element is set,
    if (userData && !activeElement) {
      // Try to set to current quest if exists
      const currentQuest = userData.userQuests?.find(
        (uq) => uq.quest.questType === props.questType,
      );
      if (currentQuest) {
        setActiveElement(currentQuest.quest.name);
        return;
      }
      // Otherwise, set to first available quest in the list
      if (quests?.[0]) {
        setActiveElement(quests[0].name);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData, activeElement, props.questType, quests]);

  // Filter for story quests only
  const availableQuests = quests ?? [];

  return (
    <ContentBox
      title={props.title}
      subtitle={props.subtitle}
      initialBreak={props.initialBreak}
      padding={false}
      defaultBackHref={props.defaultBackHref}
    >
      {props.introduction && (
        <p className="text-center text-xl font-bold mb-4 px-3 pt-3">
          {props.introduction}
        </p>
      )}
      {isPending && <Loader explanation="Starting quest..." />}
      {!userData && <Loader explanation="Loading userdata..." />}
      {!isPending && userData && (
        <div className="bg-popover">
          {availableQuests.length === 0 && (
            <p className="font-bold p-3">
              {props.unavailableText
                ? props.unavailableText
                : `No current ${props.questType} quests available`}
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
                          id="tutorial-take-quest"
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
