"use client";

import { CircleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { QuestType } from "@/drizzle/constants";
import { useTutorialStep } from "@/hooks/tutorial";
import { useQuestStartCacheUpdate } from "@/hooks/useQuestStartCacheUpdate";
import Accordion from "@/layout/Accordion";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { LogbookEntry } from "@/layout/Logbook";
import { PetTaskDispatch } from "@/layout/PetTasks";
import { QuestTeams } from "@/layout/QuestTeams";
import { QuestEntryStock, TakeQuestButton } from "@/layout/TakeQuestButton";
import { isPetTaskContract } from "@/libs/pets/tasks";
import { questTypeConcurrentBlockMessage } from "@/libs/quest/missionHall";
import { nameQuestEntryStock } from "@/libs/questRun";
import { showMutationToast } from "@/libs/toast";
import { getTutorialHighlightedQuestId } from "@/libs/tutorial";
import { useRequiredUserData } from "@/utils/UserContext";

interface QuestPickerProps {
  questType: QuestType;
  title: string;
  subtitle?: string;
  defaultBackHref?: string;
  introduction?: string;
  unavailableText?: string;
  initialBreak?: boolean;
  activeQuestId?: string;
  setActiveQuestId?: React.Dispatch<React.SetStateAction<string>>;
}

/** Start a selected quest and reconcile its profile, entry costs and discovery lists. */
const QuestPicker: React.FC<QuestPickerProps> = (props) => {
  // Utils
  const { prepareQuestStartUpdate, updateQuestStart } = useQuestStartCacheUpdate();

  // State
  const [startError, setStartError] = useState<{
    message: string;
    questId: string;
    /** True when another unfinished run of the same type is what blocks the start. */
    concurrent: boolean;
  } | null>(null);
  const [localActiveElement, setLocalActiveElement] = useState<string>("");
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();

  // State management
  const activeElement = props.activeQuestId || localActiveElement;
  const setActiveElement = props.setActiveQuestId || setLocalActiveElement;

  // Query
  const { data: quests } = api.quests.specificQuests.useQuery(
    {
      level: userData?.level ?? 0,
      questType: props.questType,
    },
    // Owned counts gate the button, and inventory changes elsewhere leave this list cached.
    { enabled: !!userData, refetchOnMount: "always" },
  );

  const { data: itemNames } = api.item.getAllNames.useQuery(undefined, {
    enabled: quests?.some((quest) => quest.entryRequirements.length > 0) ?? false,
  });

  // Tutorial step
  const { currentStep } = useTutorialStep();

  // Mutations
  const { mutate: startQuest, isPending } = api.quests.startQuest.useMutation({
    onMutate: () => {
      setStartError(null);
      return {
        userRevision: prepareUserUpdate(),
        quests: prepareQuestStartUpdate(),
      };
    },
    onSuccess: async (data, variables, context) => {
      // Failures are shown in the notice above the list, which stays put and can point
      // at the blocking run, so only successes get a toast. Announcements still go out.
      showMutationToast(data.success ? data : { ...data, message: "" });
      if (!data.success) {
        const quest = quests?.find((q) => q.id === variables.questId);
        setStartError({
          message: data.message,
          questId: variables.questId,
          // Only when the server refused for the concurrency slot, not e.g. for status
          concurrent:
            !!quest &&
            !!userData &&
            data.message === questTypeConcurrentBlockMessage(quest, userData),
        });
      }
      const profileApplied = await updateUser(data, {
        revision: context?.userRevision,
      });
      await updateQuestStart(data, context.quests, profileApplied);
    },
  });

  // Default active tab
  useEffect(() => {
    const tutorialQuestId = userData?.tutorialOn
      ? getTutorialHighlightedQuestId(currentStep)
      : undefined;
    const tutorialQuest =
      typeof tutorialQuestId === "string"
        ? quests?.find((q) => q.id === tutorialQuestId)
        : undefined;
    if (tutorialQuest && activeElement !== tutorialQuest.name) {
      setActiveElement(tutorialQuest.name);
      return;
    }

    const activeQuest = activeElement && quests?.find((q) => q.name === activeElement);
    if (!activeQuest && quests) setActiveElement("");
    if (userData && !activeElement) {
      const currentQuest = userData.userQuests?.find(
        (uq) => uq.quest.questType === props.questType && !uq.endAt,
      );
      if (currentQuest) {
        setActiveElement(currentQuest.quest.name);
        return;
      }
      if (quests?.[0]) {
        setActiveElement(quests[0].name);
      }
    }
  }, [userData, activeElement, props.questType, quests, currentStep, setActiveElement]);

  const availableQuests = quests ?? [];

  // Unfinished runs listed below that block the quest the user tried to start
  const attemptedQuest = availableQuests.find((q) => q.id === startError?.questId);
  const blockingQuests = startError?.concurrent
    ? availableQuests.filter(
        (q) =>
          q.id !== attemptedQuest?.id &&
          q.questType === attemptedQuest?.questType &&
          userData?.userQuests?.some((uq) => uq.questId === q.id && !uq.endAt),
      )
    : [];

  /** Opens a quest's entry in the list and scrolls to it. */
  const showQuest = (quest: { id: string; name: string }) => {
    setActiveElement(quest.name);
    requestAnimationFrame(() =>
      document
        .getElementById(`quest-entry-${quest.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

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
      {startError && (
        <div className="p-3">
          <Alert className="border-destructive/30 bg-destructive/5 [&>svg]:text-destructive pr-12">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>
              Couldn&apos;t start {attemptedQuest?.name ?? "this quest"}
            </AlertTitle>
            <AlertDescription className="gap-3">
              {blockingQuests.length > 0 ? (
                <p>
                  {blockingQuests.length === 1
                    ? `${blockingQuests[0]?.name} is still active. Abandon it from its entry below first.`
                    : `${blockingQuests.map((q) => q.name).join(", ")} are still active. Abandon one from its entry below first.`}
                </p>
              ) : (
                <p>{startError.message}</p>
              )}
              {blockingQuests.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {blockingQuests.map((q) => (
                    <Button key={q.id} size="sm" onClick={() => showQuest(q)}>
                      Show {q.name}
                    </Button>
                  ))}
                </div>
              )}
            </AlertDescription>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1.5 right-1.5 h-8 w-8"
              aria-label="Dismiss"
              onClick={() => setStartError(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </Alert>
        </div>
      )}
      {isPending && <Loader explanation="Starting quest..." />}
      {!userData && <Loader explanation="Loading userdata..." />}
      {!isPending && userData && (
        <div className="bg-popover">
          {availableQuests.length === 0 && (
            <p className="p-3 font-bold">
              {props.unavailableText ?? "No quests available right now."}
            </p>
          )}
          {availableQuests.map((quest) => {
            const currentQuest = userData?.userQuests?.find(
              (uq) => uq.quest.id === quest.id && !uq.endAt,
            );
            const currentTracker = userData?.questData?.find((q) => q.id === quest.id);
            const active = currentQuest && currentTracker;
            const entryStock = nameQuestEntryStock(quest.entryRequirements, itemNames);

            return (
              <div
                key={quest.id}
                id={`quest-entry-${quest.id}`}
                className="scroll-mt-16"
              >
                <Accordion
                  title={quest.name}
                  selectedTitle={activeElement}
                  titlePrefix={`${userData.petTask?.questId === quest.id ? "Companion task" : active ? "Active" : "Available"}: `}
                  onClick={(value) => {
                    setStartError(null);
                    setActiveElement(value);
                  }}
                >
                  {userData.petTask?.questId === quest.id ? (
                    <p className="p-3">
                      Your companion is completing this contract.{" "}
                      <Link className="underline" href="/profile?tab=pet">
                        Collect results in companion Tasks
                      </Link>
                      .
                    </p>
                  ) : active ? (
                    <div className="p-3">
                      <LogbookEntry
                        userQuest={currentQuest}
                        tracker={currentTracker}
                        hideTitle
                        showScene
                      />
                      {isPetTaskContract(quest) && (
                        <PetTaskDispatch
                          questId={quest.id}
                          questName={quest.name}
                          minutes={quest.petTaskMinutes}
                          entryRequirements={quest.entryRequirements}
                        />
                      )}
                    </div>
                  ) : (
                    <ItemWithEffects
                      item={quest}
                      showEdit="quest"
                      footer={
                        <div className="space-y-2">
                          <QuestEntryStock stock={entryStock} />
                          {quest.content.isolated && (
                            <p className="text-sm">
                              Isolated run: outside activities are blocked until
                              completion or abandonment.
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <TakeQuestButton
                              quest={quest}
                              entryCost={entryStock}
                              disabled={entryStock.some(
                                (required) => required.owned < required.quantity,
                              )}
                              onStart={() =>
                                startQuest({
                                  questId: quest.id,
                                  userSector: userData.sector,
                                  supportsAnnouncements: true,
                                })
                              }
                            />
                            <QuestTeams
                              questId={quest.id}
                              teamEnabled={quest.teamEnabled}
                              maxPlayers={quest.teamMaxPlayers}
                              asAction
                            />
                          </div>
                          {isPetTaskContract(quest) && (
                            <PetTaskDispatch
                              questId={quest.id}
                              questName={quest.name}
                              minutes={quest.petTaskMinutes}
                              entryRequirements={quest.entryRequirements}
                            />
                          )}
                        </div>
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
