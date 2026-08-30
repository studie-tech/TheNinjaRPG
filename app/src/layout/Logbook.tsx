import { Loader2, Sparkles, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  ADDITIONAL_MISSION_REWARD_MULTIPLIER,
  IMG_AVATAR_DEFAULT,
  IMG_SCENE_BACKGROUND,
  IMG_URL_ASSISTANT,
  IMG_URL_ASSISTANT_2,
  TERMINAL_DIALOG_PREFIX,
} from "@/drizzle/constants";
import type { UserQuest } from "@/drizzle/schema";
import { useTutorialStep } from "@/hooks/tutorial";
import { useAbVariant } from "@/hooks/useAbVariant";
import Accordion from "@/layout/Accordion";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import { EventTimer, Objective, Reward } from "@/layout/Objective";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import {
  getActiveObjective,
  isQuestComplete,
  isQuestObjectiveAvailable,
} from "@/libs/objectives";
import { useInfinitePagination } from "@/libs/pagination";
import { isReducedMissionReward } from "@/libs/quest";
import { cn } from "@/libs/shadui";
import { showMutationToast, showRewardToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import type { QuestTrackerType } from "@/validators/objectives";
import Post from "./Post";

const tabs = ["Active", "History", "Battles", "Achievements"] as const;
type tabType = (typeof tabs)[number];

const Logbook: React.FC = () => {
  // State
  const [tab, setTab] = useState<tabType | null>(null);

  return (
    <ContentBox
      id="tutorial-logbook"
      title="LogBook"
      subtitle="Character Activities"
      initialBreak={true}
      padding={false}
      topRightContent={
        <NavTabs id="logbook-toggle" current={tab} options={tabs} setValue={setTab} />
      }
    >
      {tab === "Active" && <LogbookActive />}
      {tab === "History" && <LogbookHistory />}
      {tab === "Battles" && <LogbookBattles />}
      {tab === "Achievements" && <LogbookAchievements />}
    </ContentBox>
  );
};

/**
 * Renders the achievements logbook component.
 * Shows quests marked as tier and achievement types.
 *
 * @component
 * @example
 * ```tsx
 * <LogbookAchievements />
 * ```
 */
const LogbookAchievements: React.FC = () => {
  const { data: userData, achievementProgress } = useRequiredUserData();
  const [activeElement, setActiveElement] = useState<string>("");

  // Achievement definitions are the same for every player and change only when staff edit
  // content, so profile.getUser sends progress alone and they are fetched here instead. The
  // staleTime overrides the app-wide Infinity: progress arrives on getUser's own five-minute
  // refetch, and a definition that stayed cached past that point would leave a freshly published
  // achievement rendering nothing. isLoading rather than isPending: a disabled query never stops
  // being pending, which would leave the tab on its spinner forever.
  const { data: catalogue, isLoading } = api.quests.getAchievementCatalogue.useQuery(
    undefined,
    { enabled: !!userData, staleTime: 5 * 60 * 1000 },
  );

  const quests = useMemo(() => {
    const definitions = new Map(catalogue?.map((q) => [q.id, q]));
    return [
      // Tier quests, plus any achievement whose objectives kept it on the user object.
      ...(userData?.userQuests?.filter((uq) =>
        ["tier", "achievement"].includes(uq.quest.questType),
      ) ?? []),
      // A progress row whose definition is missing - staff hid or deleted the achievement
      // between the two queries - renders nothing rather than throwing on `uq.quest`.
      ...(achievementProgress ?? []).flatMap((progress) => {
        const quest = definitions.get(progress.questId);
        return quest ? [{ ...progress, quest }] : [];
      }),
    ];
  }, [userData?.userQuests, achievementProgress, catalogue]);

  useEffect(() => {
    if (quests.length > 0 && !activeElement) {
      const firstAchievement = quests[0];
      if (firstAchievement) {
        setActiveElement(firstAchievement.quest.name);
      }
    }
  }, [quests, activeElement]);

  if (isLoading) return <Loader explanation="Loading achievements..." />;

  return (
    <div className="">
      {quests
        .filter((uq) => uq.completed === 0)
        .map((uq) => {
          const tracker = userData?.questData?.find((q) => q.id === uq.questId);

          return (
            tracker && (
              <Accordion
                key={uq.questId}
                title={uq.quest.name}
                selectedTitle={activeElement}
                titlePrefix={`${capitalizeFirstLetter(uq.quest.questType)}: `}
                onClick={setActiveElement}
              >
                <LogbookEntry userQuest={uq} tracker={tracker} hideTitle />
              </Accordion>
            )
          );
        })}
    </div>
  );
};

export default Logbook;

/**
 * Renders the active logbook component.
 * @returns The active logbook component.
 */
const LogbookActive: React.FC = () => {
  const { data: userData } = useRequiredUserData();
  const [activeElement, setActiveElement] = useState<string>("");
  const quests = userData?.userQuests?.filter(
    (uq) => !["tier", "achievement"].includes(uq.quest.questType),
  );

  useEffect(() => {
    if (quests && !activeElement && quests.length > 0) {
      const firstUserQuest = quests[0];
      if (firstUserQuest) {
        setActiveElement(firstUserQuest.quest.name);
      }
    }
  }, [quests]);

  return (
    <div className="">
      {quests?.map((uq) => {
        const tracker = userData?.questData?.find((q) => q.id === uq.questId);
        return (
          tracker && (
            <Accordion
              key={uq.questId}
              title={uq.quest.name}
              selectedTitle={activeElement}
              titlePrefix={`${capitalizeFirstLetter(uq.quest.questType)}: `}
              onClick={setActiveElement}
            >
              <LogbookEntry userQuest={uq} tracker={tracker} hideTitle />
            </Accordion>
          )
        );
      })}
      {quests?.length === 0 && (
        <div className="p-3 text-muted-foreground">No active quests</div>
      )}
    </div>
  );
};

/**
 * Renders a logbook of battles.
 *
 * @component
 * @example
 * ```tsx
 * <LogbookBattles />
 * ```
 */
const LogbookBattles: React.FC = () => {
  const { data: history, isPending } = api.combat.getBattleHistory.useQuery({
    secondsBack: 3600 * 3,
  });
  const allHistory = history?.map((e) => ({
    attackerUsername: e.attacker.username,
    attackerUserId: e.attacker.userId,
    attackerAvatar: e.attacker.avatar,
    defenderUsername: e.defender?.username || "Deleted User",
    defenderUserId: e.defender?.userId || "Deleted User",
    defenderAvatar: e.defender?.avatar || IMG_AVATAR_DEFAULT,
    battleId: e.battleId,
    createdAt: e.createdAt,
  }));

  type Entry = ArrayElement<typeof allHistory>;

  const columns: ColumnDefinitionType<Entry, keyof Entry>[] = [
    { key: "attackerAvatar", header: "Attacker", type: "avatar" },
    { key: "defenderAvatar", header: "Defender", type: "avatar" },
    { key: "battleId", header: "Battle ID", type: "string" },
    { key: "createdAt", header: "Date", type: "date" },
  ];

  if (isPending) return <Loader explanation="Loading battles..." />;

  return (
    <Table
      data={allHistory}
      columns={columns}
      linkPrefix="/battlelog/"
      linkColumn={"battleId"}
    />
  );
};

/**
 * Renders a logbook history component.
 *
 * @component
 * @example
 * ```tsx
 * <LogbookHistory />
 * ```
 */
const LogbookHistory: React.FC = () => {
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Queries
  const {
    data: history,
    fetchNextPage,
    hasNextPage,
    isPending,
  } = api.quests.getQuestHistory.useInfiniteQuery(
    {
      limit: 10,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allHistory = history?.pages
    .flatMap((page) => page.data)
    .filter((e) => e.quest)
    .map((e) => {
      return {
        image: e.quest.image,
        questType: e.questType,
        name: e.quest.name,
        info: (
          <div>
            <p>
              <b>Start:</b> {e.startedAt.toLocaleString()}
            </p>
            {e.endAt && (
              <p>
                <b>End:</b> {e.endAt.toLocaleString()}
              </p>
            )}
            {e.completed === 1 ? (
              <p className="text-green-500">Completed</p>
            ) : (
              <p className="text-red-500">Not Completed</p>
            )}
          </div>
        ),
      };
    });

  type Entry = ArrayElement<typeof allHistory>;
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  const columns: ColumnDefinitionType<Entry, keyof Entry>[] = [
    { key: "image", header: "", type: "avatar" },
    { key: "questType", header: "Type", type: "string" },
    { key: "name", header: "Title", type: "string" },
    { key: "info", header: "Info", type: "jsx" },
  ];

  if (isPending) return <Loader explanation="Loading history..." />;

  return <Table data={allHistory} columns={columns} setLastElement={setLastElement} />;
};

interface LogbookEntryProps {
  userQuest: UserQuest;
  tracker: QuestTrackerType;
  showScene?: boolean;
  hideTitle?: boolean;
}

interface QuestDialogSceneProps {
  background: string;
  characters: string[];
  description?: string | null;
}

/**
 * Renders the shared quest-dialog scene used by Logbook and overworld NPC dialogs.
 */
export const QuestDialogScene: React.FC<QuestDialogSceneProps> = ({
  background,
  characters,
  description,
}) => (
  <div className="relative aspect-3/2 w-full overflow-hidden">
    <Image
      src={background}
      alt="SceneBackground"
      className="relative aspect-3/2 w-full"
      width={512}
      height={341}
    />
    {characters.map((character, index) => (
      <div key={`${character}-${index}`} className="absolute bottom-0 w-2/5">
        <Image
          src={character}
          alt="Character"
          className="max-h-full w-auto object-contain"
          width={341}
          height={512}
        />
      </div>
    ))}
    {description && (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex max-h-1/3 flex-col items-center">
        <div className="pointer-events-auto mb-2 max-h-32 min-h-10 w-full max-w-[calc(100%-2rem)] overflow-y-auto rounded-lg border-2 bg-poppopover p-2">
          {parseHtml(description)}
        </div>
      </div>
    )}
  </div>
);

/**
 * Represents a logbook entry component.
 *
 * @component
 * @example
 * ```tsx
 * <LogbookEntry userQuest={userQuest} tracker={tracker} />
 * ```
 *
 * @param props - The component props.
 * @returns The rendered component.
 */
export const LogbookEntry: React.FC<LogbookEntryProps> = (props) => {
  const { data: userData } = useRequiredUserData();
  const { userQuest, tracker, hideTitle, showScene } = props;
  const quest = userQuest.quest;
  const tierOrDaily = ["tier", "daily"].includes(quest.questType);
  const missionOrCrime = ["mission", "crime"].includes(quest.questType);
  const isStarterQuest = quest.questType === "starter";
  const rewardMultiplier =
    userData &&
    missionOrCrime &&
    isReducedMissionReward(userData.dailyMissions, { phase: "in-progress" })
      ? ADDITIONAL_MISSION_REWARD_MULTIPLIER
      : 1;
  const allDone = isQuestComplete(quest, tracker);
  const utils = api.useUtils();

  // A/B test for starter quest assistant image
  const { variant } = useAbVariant("ab_lemu_replacement_2");
  const assistantImage =
    variant === "treatment" ? IMG_URL_ASSISTANT_2 : IMG_URL_ASSISTANT;

  // Scene composition
  // - If not consecutive objectives, use background & scene from quest
  // - If consecutive objectives, use background & scene from active objective
  // - If no background or scene, use default background & scene from quest
  // - For starter quests, use the A/B tested assistant image instead of quest characters
  const activeObjective = getActiveObjective(quest, tracker);
  const assetIds: string[] = [];
  let shownText = quest.description;
  if (quest.consecutiveObjectives) {
    if (activeObjective?.sceneBackground) {
      assetIds.push(activeObjective.sceneBackground);
    } else if (quest.content.sceneBackground) {
      assetIds.push(quest.content.sceneBackground);
    }
    // For starter quests, skip adding scene characters (we'll use assistantImage directly)
    if (!isStarterQuest) {
      if (
        activeObjective?.sceneCharacters &&
        activeObjective.sceneCharacters.length > 0
      ) {
        assetIds.push(...activeObjective.sceneCharacters);
      } else {
        assetIds.push(...(quest.content.sceneCharacters || []));
      }
    }
    if (activeObjective?.description) {
      shownText = activeObjective.description;
    }
  } else {
    if (quest.content.sceneBackground) {
      assetIds.push(quest.content.sceneBackground);
    }
    // For starter quests, skip adding scene characters (we'll use assistantImage directly)
    if (!isStarterQuest) {
      assetIds.push(...(quest.content.sceneCharacters || []));
    }
  }

  // Query to fetch the assets
  const { data: gameAssets } = api.gameAsset.getSceneAssets.useQuery(
    { assetIds },
    { enabled: assetIds.length > 0 },
  );

  // Defaults for the scene
  const background =
    gameAssets?.filter((asset) => asset.type === "SCENE_BACKGROUND")?.[0]?.image ||
    IMG_SCENE_BACKGROUND;
  // For starter quests, use the A/B tested assistant image instead of quest characters
  const characters = isStarterQuest
    ? [assistantImage]
    : gameAssets
        ?.filter((asset) => asset.type === "SCENE_CHARACTER")
        .map((asset) => asset.image) || [];

  // Mutations
  const { checkRewards, isCheckingRewards } = useCheckRewards();
  const lastAchievementAutoClaimKeyRef = useRef<string | null>(null);

  /** Auto-claim achievements when objectives are satisfied (same intent as the old effect).
   * Deduplicate by quest + completion state + history counters so `userData` refetches from
   * `checkRewards` invalidation do not call `checkRewards` again in a tight loop.
   * (Single-shot achievements resetting to incomplete after claim was fixed server-side.) */
  useEffect(() => {
    if (!allDone) {
      lastAchievementAutoClaimKeyRef.current = null;
      return;
    }

    const eligible =
      quest.questType === "achievement" &&
      !userQuest.completed &&
      allDone &&
      userData?.status === "AWAKE" &&
      !isCheckingRewards;
    if (!eligible) return;

    const dedupeKey = `${quest.id}:${String(allDone)}:${userQuest.completed}:${userQuest.previousCompletes}:${userQuest.previousAttempts}`;
    if (lastAchievementAutoClaimKeyRef.current === dedupeKey) return;
    lastAchievementAutoClaimKeyRef.current = dedupeKey;

    void checkRewards({ questId: quest.id });
  }, [
    allDone,
    checkRewards,
    isCheckingRewards,
    quest.id,
    quest.questType,
    userData?.status,
    userQuest.completed,
    userQuest.previousAttempts,
    userQuest.previousCompletes,
  ]);

  const { mutate: abandon } = api.quests.abandon.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await Promise.all([
        utils.quests.allianceBuilding.invalidate(),
        utils.profile.getUser.invalidate(),
      ]);
    },
  });

  return (
    <Post
      className={`${tierOrDaily ? "" : "col-span-2"} ${showScene ? "px-0 py-0" : "px-3"}`}
      options={
        <div className="ml-3">
          <div className="mt-2 flex flex-row items-center">
            {quest.questType !== "starter" &&
              [
                "mission",
                "crime",
                "event",
                "errand",
                "story",
                "medical",
                "hunting",
                "gathering",
                "battlepyramid",
                "pvp",
                "starter",
                "anbu",
                "overworld",
              ].includes(quest.questType) && (
                <Confirm2
                  title="Confirm deleting quest"
                  button={
                    <X className="ml-2 h-8 w-8 cursor-pointer rounded-full border-2 bg-popover p-1 hover:text-orange-500" />
                  }
                  onAccept={(e) => {
                    e.preventDefault();
                    void abandon({ id: quest.id });
                  }}
                >
                  Are you sure you want to abandon this quest? Note that even though you
                  abandon this quest, you have still used one of your daily attempts.
                </Confirm2>
              )}
          </div>
        </div>
      }
    >
      <div className="flex h-full flex-col gap-3" id={`logbook-entry-${quest.id}`}>
        {!hideTitle && (
          <div className={cn(showScene ? "px-3 pt-3" : "")}>
            <div className={"font-bold text-xl"}>
              Current {capitalizeFirstLetter(quest.questType)}
            </div>
            <div className="font-bold text-sm">{quest.name}</div>
          </div>
        )}
        {/* If we're not showing the scene, just show the text. Usefull when we're in the logbook */}
        {!showScene && (
          <>
            <div className="pt-2">
              <Reward
                info={userQuest.quest.content.reward}
                rewardMultiplier={rewardMultiplier}
              />
              <EventTimer quest={quest} tracker={tracker} />
            </div>
            {!["tier", "daily"].includes(quest.questType) && quest.description && (
              <div>{parseHtml(quest.description)}</div>
            )}
          </>
        )}
        {showScene && (
          <QuestDialogScene
            background={background}
            characters={characters}
            description={shownText}
          />
        )}
        {/* Dialog options */}
        {activeObjective?.task === "dialog" &&
          // Placement-bound dialog choices are only actionable at their NPC. The Sector dialog
          // renders them after the server verifies the player's authoritative placement tile.
          !activeObjective.overworldPlacementId && (
            <div className="w-full">
              <h2 className="flex items-center pl-2 font-bold text-lg">
                Dialog Options
                {isCheckingRewards && (
                  <Loader2
                    className="ml-2 inline h-4 w-4 shrink-0 animate-spin"
                    aria-label="Loading"
                  />
                )}
              </h2>
              <div className="pointer-events-auto flex w-full flex-wrap gap-1 px-2 pb-1">
                {!isCheckingRewards &&
                  activeObjective.nextObjectiveId.map((entry, index) => (
                    <Button
                      key={`${index}-${entry.text}`}
                      type="button"
                      variant="info"
                      className="h-auto max-w-full whitespace-normal text-left"
                      onClick={() =>
                        checkRewards({
                          questId: quest.id,
                          // A terminal branch has no follow-up objective; send an objective-scoped
                          // sentinel so the server completes this dialog objective instead of
                          // re-opening the same dialog.
                          nextObjectiveId:
                            entry.nextObjectiveId ??
                            `${TERMINAL_DIALOG_PREFIX}${activeObjective.id}`,
                        })
                      }
                    >
                      {entry.text}
                    </Button>
                  ))}
              </div>
            </div>
          )}

        {quest.content.objectives && (
          <div
            className={cn(
              "grid grid-cols-1 gap-4",
              tierOrDaily || quest.content.objectives.length === 1
                ? "sm:grid-cols-1"
                : "sm:grid-cols-2",
              showScene ? "px-3 pb-3" : "",
            )}
          >
            {quest.content.objectives.map((objective, i) => {
              // Clean up the shown objectives a bit to hide dialog
              const status = tracker?.goals.find((g) => g.id === objective.id);
              const hideIfNoRewards =
                objective.task === "dialog" ||
                (activeObjective && objective.id !== activeObjective?.id) ||
                (allDone && !status?.done);
              return (
                <Objective
                  objective={objective}
                  tracker={tracker}
                  checkRewards={() => checkRewards({ questId: quest.id })}
                  key={objective.id}
                  titlePrefix={
                    quest.consecutiveObjectives ? "Objective: " : `${i + 1}. `
                  }
                  grayedOut={!isQuestObjectiveAvailable(quest, tracker, i)}
                  hideIfNoRewards={hideIfNoRewards}
                />
              );
            })}
          </div>
        )}

        {allDone && !userQuest.completed && userData?.status === "AWAKE" && (
          <div className={cn("w-full grow", showScene ? "p-3" : "")}>
            <Button
              id="return"
              onClick={() => checkRewards({ questId: quest.id })}
              className="w-full"
            >
              <Sparkles className="mr-2 h-5 w-5" />
              Collect Reward
            </Button>
          </div>
        )}
      </div>
    </Post>
  );
};

/**
 * Hook for checking rewards.
 * @returns The checkRewards mutation.
 */
export const useCheckRewards = () => {
  const utils = api.useUtils();

  // Tutorial step
  const { currentStep, handleNextStepAsync } = useTutorialStep();

  // Mutations
  const { mutate: checkRewards, isPending: isCheckingRewards } =
    api.quests.checkRewards.useMutation({
      onSuccess: async (data, variables) => {
        // If a failutre, show a toast
        if (!data.success && "message" in data) {
          showMutationToast({ success: data.success, message: data.message });
        }
        // Update state
        await Promise.all([
          utils.profile.getUser.invalidate(),
          utils.quests.getQuestHistory.invalidate(),
          utils.quests.allianceBuilding.invalidate(),
          utils.quests.missionHall.invalidate(),
          utils.quests.specificQuests.invalidate(),
        ]);
        // If the quest is finished, handle the next step
        if (
          currentStep?.title === "Academy Dialog Option" &&
          variables?.nextObjectiveId
        ) {
          await handleNextStepAsync();
        }
        // If there is a userQuest, show the rewards
        if ("userQuest" in data && data.userQuest) {
          const { notifications, rewards, userQuest, resolved, badges } = data;
          const quest = userQuest.quest;
          const showToast =
            notifications.length > 0 ||
            (resolved && quest.successDescription) ||
            rewards.reward_money > 0 ||
            rewards.reward_seichi_silver > 0 ||
            rewards.reward_clanpoints > 0 ||
            rewards.reward_anbupoints > 0 ||
            rewards.reward_exp > 0 ||
            rewards.reward_tokens > 0 ||
            rewards.reward_prestige > 0 ||
            rewards.reward_reputation > 0 ||
            rewards.reward_skillpoints > 0 ||
            rewards.reward_jutsus.length > 0 ||
            rewards.reward_badges.length > 0 ||
            rewards.reward_bloodlines.length > 0 ||
            rewards.reward_sage_modes.length > 0 ||
            rewards.reward_items.length > 0;
          // Show toast
          const message = resolved
            ? `Finished: ${quest.name}`
            : `Reward from ${quest.name}`;
          if (resolved || showToast)
            showRewardToast(notifications, rewards, message, false, quest, badges);
        }
      },
    });

  return { checkRewards, isCheckingRewards };
};
