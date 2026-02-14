"use client";

import { Gamepad2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { QuestType } from "@/drizzle/constants";
import { useTutorialStep } from "@/hooks/tutorial";
import Accordion from "@/layout/Accordion";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { LogbookEntry, useCheckRewards } from "@/layout/Logbook";
import { getActiveObjective } from "@/libs/objectives";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

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

  // Rewards check hook
  const { checkRewards } = useCheckRewards();

  // Handle certain tutorial syncronization steps
  useEffect(() => {
    // If we're on the dialog option of a quest which we don't have access to, then proceed the tutorial
    if (
      currentStep?.title === "Academy Dialog Option" &&
      currentStep?.relatedValue &&
      currentStep?.hideDialog &&
      quests !== undefined
    ) {
      const quest = quests.find((q) => q.id === currentStep?.relatedValue);
      if (!quest) {
        console.log("Quest not found, proceeding to next step in tutorial");
        void handleNextStepAsync();
      }
    }

    // If we're instructed to take a quest, but we already have it, proceed the tutorial
    if (
      currentStep?.elementIds?.find((id) => id.startsWith("tutorial-take-quest-")) &&
      currentStep?.relatedValue &&
      userData?.userQuests?.find((uq) => uq.questId === currentStep?.relatedValue)
    ) {
      const quest = quests?.find((q) => q.id === currentStep?.relatedValue);
      const tracker = userData?.questData?.find((q) => q.id === quest?.id);
      if (quest && tracker) {
        const activeObjective = getActiveObjective(quest, tracker);
        if (activeObjective?.task !== "dialog") {
          void checkRewards({ questId: currentStep?.relatedValue as string });
        }
      }
    }
  }, [currentStep, userData, quests]);

  // Default active tab
  useEffect(() => {
    // Ensure that we are using the correct active element
    const activeQuest = activeElement && quests?.find((q) => q.name === activeElement);
    if (!activeQuest && quests) setActiveElement("");
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
        <p className="mb-4 px-3 pt-3 text-center font-bold text-xl">
          {props.introduction}
        </p>
      )}
      {isPending && <Loader explanation="Starting quest..." />}
      {!userData && <Loader explanation="Loading userdata..." />}
      {!isPending && userData && (
        <div className="bg-popover">
          {availableQuests.length === 0 && (
            <p className="p-3 font-bold">
              {props.unavailableText
                ? props.unavailableText
                : `No current ${props.questType} quests available`}
            </p>
          )}
          {availableQuests.map((quest) => {
            const currentQuest = userData?.userQuests?.find(
              (uq) => uq.quest.id === quest.id && !uq.endAt,
            );
            const currentTracker = userData?.questData?.find((q) => q.id === quest.id);
            const active = currentQuest && currentTracker;

            return (
              <div key={quest.id}>
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
                          id={`tutorial-take-quest-${quest.id}`}
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
