import { useSetAtom } from "jotai";
import { Gift, Loader2, X } from "lucide-react";
import type React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  ADDITIONAL_MISSION_REWARD_MULTIPLIER,
  IMG_SCENE_BACKGROUND,
  IMG_URL_ASSISTANT,
  LEMU_SCENE_CHARACTER_IDS,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";
import type { UserQuest } from "@/drizzle/schema";
import { useTutorialStep } from "@/hooks/tutorial";
import { useQuestRewardCacheUpdate } from "@/hooks/useQuestRewardCacheUpdate";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { storyDockPulseAtom } from "@/hooks/useStoryGuidance";
import Accordion from "@/layout/Accordion";
import { BattleHistoryTable } from "@/layout/BattleHistoryTable";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import NavTabs from "@/layout/NavTabs";
import { EventTimer, Objective, Reward } from "@/layout/Objective";
import Post from "@/layout/Post";
import { QuestTeams } from "@/layout/QuestTeams";
import { PendingRewardChoices, useOpenRewardChoice } from "@/layout/RewardChoice";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { showActionReadinessToast } from "@/libs/actionFeedback";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { trackConversion } from "@/libs/conversionTracking";
import {
  dialogChoiceContentId,
  getActiveObjective,
  getRewardClaimLabel,
  getSeenQuestDialogue,
  hasUnclaimedPredecessorReward,
  isObjectiveComplete,
  isQuestComplete,
  isQuestObjectiveAvailable,
  type QuestDialogueEntry,
} from "@/libs/objectives";
import { useInfinitePagination } from "@/libs/pagination";
import { questProgressBlockedMessage } from "@/libs/quest/missionHall";
import { isReducedMissionReward } from "@/libs/quest/rewards";
import {
  getIsolatedPyramid,
  hasQuestContentChanged,
  isBetweenPyramidBattles,
  isManagedQuestRun,
  isQuestAttemptPaused,
} from "@/libs/questRun";
import { sceneCharactersAtom } from "@/libs/questScene";
import { showRetryableErrorToast } from "@/libs/retryableToast";
import { getRewardPickCount, isRewardChoiceQuest } from "@/libs/rewardChoice";
import { collapseRewards } from "@/libs/rewards";
import { cn } from "@/libs/shadui";
import { getChapterForQuest, isLeadQuest } from "@/libs/storyGuidance";
import { showMutationToast, showRewardToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { parseHtml } from "@/utils/parse";
import { canAbandonQuestType, getContentRole } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/string";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserDataSelector, useUserInfo } from "@/utils/UserContext";
import type { QuestTrackerType } from "@/validators/objectives";
import { rewardPayloads } from "@/validators/rewardPackages";
import { hasAnyRewardValue, hasReward } from "@/validators/rewards";

const tabs = ["Active", "History", "Battles", "Achievements"] as const;
type tabType = (typeof tabs)[number];

/** Matches the interval `profile.getUser` refreshes its own achievement progress on. */
const CATALOGUE_REFRESH_MS = 5 * 60 * 1000;

/**
 * Session-scoped exact-attempt tombstones survive a cache-driven unmount/remount. Replication
 * lag can briefly return a just-abandoned history row again; its startedAt-bound identity keeps
 * that stale row non-actionable without hiding a later intentional restart of the same quest.
 */
const abandonedQuestAttemptTombstones = new Set<string>();

const Logbook: React.FC = () => {
  // State
  const [tab, setTab] = useState<tabType | null>(null);

  return (
    <ContentBox
      id="tutorial-logbook"
      title="Logbook"
      subtitle="Character Activities"
      initialBreak={true}
      padding={false}
      topRightContent={
        <NavTabs id="logbook-toggle" current={tab} options={tabs} setValue={setTab} />
      }
    >
      <PendingRewardChoices />
      <QuestTeams compact />
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
export const LogbookAchievements: React.FC = () => {
  const { data: userData, achievementProgress } =
    useRequiredUserDataSelector(selectQuestProgress);
  const [activeElement, setActiveElement] = useState<string>("");

  // Achievement definitions are the same for every player and change only when staff edit
  // content, so profile.getUser sends progress alone and they are fetched here instead.
  //
  // The refresh knobs together cover the three ways the cache can fall behind. An achievement
  // published or hidden since the last fetch shows up as a progress row with no definition, which
  // the effect below reacts to at once. An edit to an existing one changes no ids and so is
  // invisible to that check, which is what refetchInterval is for; staleTime covers the same case
  // on remount and refocus, since an interval only runs while this is mounted and focused.
  //
  // The poll runs only while the Achievements tab is open, on the cadence profile.getUser polls at
  // (UserContext). isLoading rather than isPending: a disabled query never stops being pending, which would
  // leave the tab on its spinner forever.
  const {
    data: catalogue,
    isFetched,
    isFetching,
    isLoading,
    refetch,
  } = api.quests.getAchievementCatalogue.useQuery(undefined, {
    enabled: !!userData,
    staleTime: CATALOGUE_REFRESH_MS,
    refetchInterval: CATALOGUE_REFRESH_MS,
  });

  const definitions = useMemo(
    () => new Map(catalogue?.map((q) => [q.id, q])),
    [catalogue],
  );

  // Progress rows the cached catalogue cannot resolve, which the join below would otherwise drop
  // in silence. Checked per row rather than as "did the catalogue arrive at all": one fetched
  // before staff published an achievement is present but short, and a failed refresh keeps
  // serving the older rows. Keyed on the data for the same reason `isError` is not used here - it
  // reads false across the query's retry backoff, so a guard on it renders nothing.
  const unresolvedIds = useMemo(
    () =>
      (achievementProgress ?? [])
        .filter((progress) => !definitions.has(progress.questId))
        .map((progress) => progress.questId)
        .join(","),
    [achievementProgress, definitions],
  );

  // Staleness alone never refetches a query that stays mounted, so a definition published after
  // this was cached would otherwise never arrive. Pull again as soon as a row cannot be resolved,
  // keyed on the ids themselves: a refetch that comes back with the same rows leaves the key
  // unchanged and does not fire a second time. `cancelRefetch: false` because progress can land
  // before the first catalogue fetch does, and the default would abort that request and reissue
  // it; joining it instead keeps a healthy mount at a single round-trip.
  useEffect(() => {
    if (unresolvedIds) void refetch({ cancelRefetch: false });
  }, [unresolvedIds, refetch]);

  const quests = useMemo(() => {
    return [
      // Tier quests, plus any achievement whose objectives kept it on the user object.
      ...(userData?.userQuests?.filter((uq) =>
        ["tier", "achievement"].includes(uq.quest.questType),
      ) ?? []),
      // A progress row whose definition is missing renders nothing rather than throwing on
      // `uq.quest`; the banner below tells the player the list is short.
      ...(achievementProgress ?? []).flatMap((progress) => {
        const quest = definitions.get(progress.questId);
        return quest ? [{ ...progress, quest }] : [];
      }),
    ];
  }, [userData?.userQuests, achievementProgress, definitions]);

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
      {/* Say so, and keep whatever did arrive on screen: a list that looks complete but is not
          hides achievements, and one that never renders never auto-claims either. Held back while
          fetch is in flight, or has yet to happen at all, so the refetch above can fix it
          without the banner flashing in between. */}
      {isFetched && !isFetching && unresolvedIds && (
        <div className="flex flex-row items-center gap-3 p-3">
          <span className="text-muted-foreground text-sm">
            Could not load every achievement. Your progress is safe.
          </span>
          <Button type="button" variant="info" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}
      <QuestAccordionList
        quests={quests.filter((uq) => uq.completed === 0)}
        trackers={userData?.questData}
        activeElement={activeElement}
        onSelect={setActiveElement}
      />
    </div>
  );
};

export default Logbook;

/**
 * Renders the active logbook component.
 * @returns The active logbook component.
 */
export const LogbookActive: React.FC = () => {
  const { data: userData } = useRequiredUserDataSelector(selectQuestProgress);
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
      <QuestAccordionList
        quests={quests}
        trackers={userData?.questData}
        activeElement={activeElement}
        onSelect={setActiveElement}
      />
      {quests?.length === 0 && (
        <div className="p-3 text-muted-foreground">No active quests</div>
      )}
    </div>
  );
};

/** One collapsible logbook entry per quest with a tracker. */
const QuestAccordionList: React.FC<{
  quests: UserQuest[] | undefined;
  trackers: QuestTrackerType[] | null | undefined;
  activeElement: string;
  onSelect: React.Dispatch<React.SetStateAction<string>>;
}> = ({ quests, trackers, activeElement, onSelect }) =>
  quests?.map((uq) => {
    const tracker = trackers?.find((q) => q.id === uq.questId);
    return (
      tracker && (
        <Accordion
          key={uq.questId}
          title={uq.quest.name}
          selectedTitle={activeElement}
          titlePrefix={`${capitalizeFirstLetter(uq.quest.questType)}: `}
          onClick={onSelect}
        >
          <LogbookEntry userQuest={uq} tracker={tracker} hideTitle />
        </Accordion>
      )
    );
  });

/**
 * Renders a logbook of battles.
 *
 * @component
 * @example
 * ```tsx
 * <LogbookBattles />
 * ```
 */
export const LogbookBattles: React.FC = () => (
  <BattleHistoryTable secondsBack={3600 * 3} />
);

/**
 * Renders a logbook history component.
 *
 * @component
 * @example
 * ```tsx
 * <LogbookHistory />
 * ```
 */
export const LogbookHistory: React.FC = () => {
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
  /** Narrow activity panel: one objective column and no abandon control. */
  compact?: boolean;
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
}) => {
  const setSceneCharacters = useSetAtom(sceneCharactersAtom);
  const characterKey = characters.join("\n");
  useEffect(() => {
    const shown = characterKey ? characterKey.split("\n") : [];
    setSceneCharacters((scenes) => [...scenes, shown]);
    return () =>
      setSceneCharacters((scenes) => scenes.filter((entry) => entry !== shown));
  }, [characterKey, setSceneCharacters]);
  return (
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
          <div
            data-reading-text
            className="pointer-events-auto mb-2 max-h-32 min-h-10 w-full max-w-[calc(100%-2rem)] overflow-y-auto rounded-lg border-2 bg-poppopover p-2"
          >
            {parseHtml(description)}
          </div>
        </div>
      )}
    </div>
  );
};

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
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({
    userQuests: u.userQuests,
    dailyMissions: u.dailyMissions,
    role: u.role,
    playsAsPlayer: u.playsAsPlayer,
    status: u.status,
    autoWakeUp: u.autoWakeUp,
    battleId: u.battleId,
  }));
  const { userQuest, tracker, hideTitle, showScene } = props;
  const quest = userQuest.quest;
  const tierOrDaily = ["tier", "daily"].includes(quest.questType);
  const missionOrCrime = ["mission", "crime"].includes(quest.questType);
  // Lemu teaches the Academy Trials, so their scenes show her whoever the content names.
  const isTrialsQuest =
    quest.id === TUTORIAL_STARTER_QUEST_ID || quest.id === TUTORIAL_GENIN_EXAM_QUEST_ID;
  const rewardMultiplier =
    userData &&
    missionOrCrime &&
    isReducedMissionReward(userData.dailyMissions, { phase: "in-progress" })
      ? ADDITIONAL_MISSION_REWARD_MULTIPLIER
      : 1;
  const allDone = isQuestComplete(quest, tracker);
  const isPaused =
    quest.questType === "battlepyramid" &&
    isQuestAttemptPaused(userQuest, userData ? getContentRole(userData) : "USER");
  const canProgress =
    !isPaused &&
    (canAttemptAwakeAction(userData) ||
      (isBetweenPyramidBattles(userData) &&
        getIsolatedPyramid(userData)?.questId === quest.id));
  const utils = api.useUtils();
  const questStartedAt = userQuest.startedAt;
  const abandonIdentity = `${userQuest.id}:${quest.id}:${questStartedAt?.toISOString() ?? "missing-start"}`;
  const activeAbandonIdentityRef = useRef(abandonIdentity);
  const abandonFlight = useSingleFlight<{ identity: string; revision?: number }>();
  const [abandonDialogIdentity, setAbandonDialogIdentity] = useState<string | null>(
    null,
  );
  const [abandonedIdentity, setAbandonedIdentity] = useState<string | null>(null);

  useEffect(() => {
    activeAbandonIdentityRef.current = abandonIdentity;
    setAbandonDialogIdentity(null);
    setAbandonedIdentity(null);
    // A response for the previous attempt remains harmless because both the client response
    // handler and server CAS are bound to that attempt. Let the new attempt have its own action.
    if (abandonFlight.current()?.identity !== abandonIdentity) abandonFlight.release();
  }, [abandonIdentity]);

  // Scene composition
  // - If not consecutive objectives, use background & scene from quest
  // - If consecutive objectives, use background & scene from active objective
  // - If no background or scene, use default background & scene from quest
  // - For starter quests, use the assistant image instead of quest characters
  const activeObjective = getActiveObjective(quest, tracker);
  // The reward just earned is claimed before the conversation moves on; an answer would
  // collect it unseen.
  const holdsDialogForClaim =
    activeObjective?.task === "dialog" &&
    hasUnclaimedPredecessorReward(quest, tracker, activeObjective.id);
  // An older reward still waiting, such as an opening level check, leads the entry, so
  // the claim comes before the conversation's next answer and the answer before the
  // objectives already behind the player.
  const isWaitingClaim = (index: number) => {
    const objective = quest.content.objectives[index];
    return (
      !!objective &&
      hasReward(objective) &&
      isObjectiveComplete(tracker, objective).canCollect &&
      isQuestObjectiveAvailable(quest, tracker, index)
    );
  };
  const leadsWithObjectiveClaim = quest.content.objectives.some((_, index) =>
    isWaitingClaim(index),
  );
  // Explain hidden dialog choices or reward collection instead of showing no actions at all.
  const awaitsPlayerAction =
    (activeObjective?.task === "dialog" && !activeObjective.overworldPlacementId) ||
    (allDone && !userQuest.completed && quest.questType !== "achievement");
  const progressBlockedMessage =
    !canProgress && !isPaused && awaitsPlayerAction
      ? questProgressBlockedMessage(userData?.status)
      : null;
  // The scene shows the current text itself; without it, keep what was said readable.
  const [latestDialogue, ...earlierDialogue] = showScene
    ? []
    : getSeenQuestDialogue(quest, tracker).reverse();
  const assetIds: string[] = [];
  let shownText = quest.description;
  if (quest.consecutiveObjectives) {
    if (activeObjective?.sceneBackground) {
      assetIds.push(activeObjective.sceneBackground);
    } else if (quest.content.sceneBackground) {
      assetIds.push(quest.content.sceneBackground);
    }
    if (!isTrialsQuest) {
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
    if (!isTrialsQuest) {
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
  // Lemu is drawn with her current portrait wherever a scene names her.
  const characters = isTrialsQuest
    ? [IMG_URL_ASSISTANT]
    : gameAssets
        ?.filter((asset) => asset.type === "SCENE_CHARACTER")
        .map((asset) =>
          LEMU_SCENE_CHARACTER_IDS.includes(asset.id) ? IMG_URL_ASSISTANT : asset.image,
        ) || [];

  // Mutations
  const { checkRewards, isCheckingRewards } = useCheckRewards();
  const lastAchievementAutoClaimKeyRef = useRef<string | null>(null);

  /** Auto-claim achievements when objectives are satisfied.
   * Deduplicate by quest + completion state + history counters so `userData` refetches from
   * `checkRewards` invalidation do not call `checkRewards` again in a tight loop. */
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

  const { mutateAsync: abandon } = api.quests.abandon.useMutation({
    meta: { handlesTransportError: true },
  });
  const isAbandoning = abandonFlight.pending?.identity === abandonIdentity;
  const isAbandoned =
    abandonedIdentity === abandonIdentity ||
    abandonedQuestAttemptTombstones.has(abandonIdentity);
  const isAbandonDialogOpen = abandonDialogIdentity === abandonIdentity;

  const abandonCurrentQuest = async () => {
    if (abandonFlight.current() || !questStartedAt) return;

    const request = { identity: abandonIdentity, revision: prepareUserUpdate() };
    await abandonFlight.run(request, async () => {
      // A parent may reuse this component for another attempt while the request is in flight.
      // The server committed only the captured attempt; never hide or toast for its successor.
      const isCurrentAttempt = () =>
        abandonFlight.owns(request) &&
        activeAbandonIdentityRef.current === request.identity;

      try {
        const data = await abandon({
          id: quest.id,
        });
        if (!isCurrentAttempt()) return;

        showMutationToast(data);
        if (!data.success) return;

        // Suppress and close before cache work. A failed/stale refresh must not immediately expose
        // a second destructive action for an attempt the server has already closed.
        abandonedQuestAttemptTombstones.add(request.identity);
        setAbandonedIdentity(request.identity);
        setAbandonDialogIdentity(null);
        await Promise.allSettled([
          utils.quests.allianceBuilding.invalidate(),
          updateUser(data, { revision: request.revision }),
        ]);
      } catch (error) {
        if (isCurrentAttempt()) {
          showRetryableErrorToast(
            error,
            "Could not abandon this quest. Check your connection and try again.",
          );
        }
      }
    });
  };

  const objectiveCards = (include: (index: number) => boolean) =>
    quest.content.objectives?.some((_, index) => include(index)) && (
      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          // Consecutive quests show only their active objective, so it gets the full width.
          props.compact ||
            tierOrDaily ||
            quest.consecutiveObjectives ||
            quest.content.objectives.length === 1
            ? "sm:grid-cols-1"
            : "sm:grid-cols-2",
          showScene ? "px-3 pb-3" : "",
        )}
      >
        <QuestObjectives
          quest={quest}
          tracker={tracker}
          checkRewards={() => checkRewards({ questId: quest.id })}
          locked={!canProgress}
          include={include}
          compact={props.compact}
        />
      </div>
    );
  // The quest's reward and story. The narrow dock leads with what the player does now,
  // so there they follow the objectives.
  const questSummary = !showScene && (
    <>
      <div className="pt-2">
        <Reward
          info={userQuest.quest.content.reward}
          rewardMultiplier={rewardMultiplier}
          pickCount={
            isRewardChoiceQuest(userQuest.quest.content)
              ? getRewardPickCount(userQuest.quest.content)
              : undefined
          }
        />
        <EventTimer quest={quest} />
      </div>
      <QuestStoryLinks
        key={abandonIdentity}
        briefing={
          !["tier", "daily"].includes(quest.questType) ? quest.description : undefined
        }
        earlierDialogue={earlierDialogue}
      />
    </>
  );
  // The finished quest's reward, named like the objective claims.
  const questClaim = allDone && !userQuest.completed && canProgress && (
    <div className={cn("w-full", showScene ? "p-3" : "", !props.compact && "grow")}>
      <Button
        id="return"
        data-quest-claim=""
        onClick={() => checkRewards({ questId: quest.id })}
        // A claim names every reward, so a long one wraps in a narrow column.
        className="h-auto min-h-9 w-full text-left text-balance whitespace-normal"
      >
        <Gift className="mr-2 h-5 w-5 shrink-0" aria-hidden="true" />
        {isRewardChoiceQuest(quest.content)
          ? "Choose your reward"
          : rewardMultiplier === 1
            ? getRewardClaimLabel(collapseRewards(rewardPayloads(quest.content.reward)))
            : "Claim reward"}
      </Button>
    </div>
  );

  return (
    <Post
      className={`${tierOrDaily ? "" : "col-span-2"} ${showScene ? "px-0 py-0" : "px-3"}`}
      options={
        <div className="ml-3">
          <div className="mt-2 flex flex-row items-center">
            {!isAbandoned &&
              !props.compact &&
              !!questStartedAt &&
              canAbandonQuestType(userData?.role ?? "USER", quest.questType) && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={
                    isAbandoning || (!!userData?.battleId && isManagedQuestRun(quest))
                  }
                  aria-label={`Abandon ${quest.name}`}
                  aria-busy={isAbandoning}
                  hoverText={`Abandon ${quest.name}`}
                  className="ml-2 h-8 w-8 rounded-full border-2 bg-popover p-1 hover:text-orange-500"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setAbandonDialogIdentity(abandonIdentity);
                  }}
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </Button>
              )}
          </div>
          <Modal
            id={`abandon-quest-${quest.id}`}
            title={`Abandon ${quest.name}?`}
            isOpen={isAbandonDialogOpen}
            setIsOpen={(open) =>
              setAbandonDialogIdentity(open ? abandonIdentity : null)
            }
            proceed_label="Abandon quest"
            proceed_loading_label="Abandoning"
            confirmClassName="bg-red-600 text-white hover:bg-red-700"
            isLoading={isAbandoning}
            keepOpenOnAccept
            onAccept={(event) => {
              event.preventDefault();
              void abandonCurrentQuest();
            }}
          >
            <p>
              This permanently ends your current attempt and removes all progress for
              this quest.
            </p>
            {quest.questType !== "special" && (
              <p className="font-semibold text-orange-500">
                This attempt still counts toward your daily limit.
              </p>
            )}
            {!!quest.content.entryItems?.length && (
              <p>Consumed entry items will not be returned.</p>
            )}
          </Modal>
        </div>
      }
    >
      <div
        className="flex h-full flex-col gap-3"
        id={`logbook-entry-${quest.id}`}
        data-spotlight-panel=""
      >
        {isPaused && (
          <p role="status" className="p-3 text-orange-500">
            {hasQuestContentChanged(userQuest)
              ? "This Pyramid was edited. Abandon this run and start again."
              : "This Pyramid is hidden. Your run is paused; you can still abandon it."}
          </p>
        )}
        {quest.teamEnabled && (
          <QuestTeams
            questId={quest.id}
            teamEnabled={quest.teamEnabled}
            maxPlayers={quest.teamMaxPlayers}
          />
        )}
        {!hideTitle && (
          <div className={cn(showScene ? "px-3 pt-3" : "")}>
            <div className={"text-xl font-bold"}>
              Current {capitalizeFirstLetter(quest.questType)}
            </div>
            <div className="font-bold text-sm">{quest.name}</div>
          </div>
        )}
        {/* The narrow dock scrolls; its claim leads the entry instead of trailing the objectives. */}
        {props.compact ? questClaim : questSummary}
        {showScene && (
          <QuestDialogScene
            background={background}
            characters={characters}
            description={shownText}
          />
        )}
        {latestDialogue && (
          <section aria-label="Quest dialogue">
            <h3 className="font-bold">Dialogue</h3>
            <QuestDialogueText entry={latestDialogue} />
          </section>
        )}
        {progressBlockedMessage && (
          <p
            role="status"
            className={cn("font-semibold text-orange-500", showScene ? "px-3" : "")}
          >
            {progressBlockedMessage}
          </p>
        )}
        {leadsWithObjectiveClaim ? objectiveCards(isWaitingClaim) : null}
        {/* Dialog options */}
        {canProgress &&
          !holdsDialogForClaim &&
          activeObjective?.task === "dialog" &&
          // Placement-bound dialog choices are only actionable at their NPC. The Sector dialog
          // renders them after the server verifies the player's authoritative placement tile.
          !activeObjective.overworldPlacementId && (
            // The tutorial ring frames the heading with the answers it names.
            <div id="tutorial-dialog-options" className="w-full">
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
                      className="h-auto max-w-full whitespace-normal text-left"
                      onClick={() =>
                        checkRewards({
                          questId: quest.id,
                          nextObjectiveId: dialogChoiceContentId(
                            entry.nextObjectiveId,
                            activeObjective.id,
                          ),
                        })
                      }
                    >
                      {entry.text}
                    </Button>
                  ))}
              </div>
            </div>
          )}
        {/* Placement-bound dialog: point the player to the NPC instead of showing nothing. */}
        {canProgress &&
          activeObjective?.task === "dialog" &&
          !!activeObjective.overworldPlacementId && (
            <p
              role="status"
              className={cn("font-semibold text-orange-500", showScene ? "px-3" : "")}
            >
              This conversation continues in person: walk up to the NPC on the travel
              map and talk to them to choose your answer.
            </p>
          )}

        {objectiveCards((index) => !leadsWithObjectiveClaim || !isWaitingClaim(index))}
        {props.compact ? questSummary : questClaim}
      </div>
    </Post>
  );
};

/**
 * The quest's briefing and the dialogue before the latest one, each folded behind a link
 * so the objectives stay near the quest name. Earlier dialogue reads oldest first, leading
 * into the current dialogue below it, and scrolls within a capped height so a long quest
 * keeps its card short.
 */
const QuestStoryLinks: React.FC<{
  briefing?: string | null;
  /** Dialogue before the latest, newest first. */
  earlierDialogue: QuestDialogueEntry[];
}> = ({ briefing, earlierDialogue }) => {
  const [isBriefingOpen, setIsBriefingOpen] = useState(false);
  const [isDialogueOpen, setIsDialogueOpen] = useState(false);
  const dialogueId = useId();
  if (!briefing && earlierDialogue.length === 0) return null;
  return (
    <div className="@container space-y-2">
      <div className="flex flex-wrap gap-x-4">
        {briefing && (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            aria-expanded={isBriefingOpen}
            onClick={() => setIsBriefingOpen((open) => !open)}
          >
            {isBriefingOpen ? "Hide briefing" : "Read briefing"}
          </Button>
        )}
        {earlierDialogue.length > 0 && (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            aria-expanded={isDialogueOpen}
            aria-controls={dialogueId}
            onClick={() => setIsDialogueOpen((open) => !open)}
          >
            {isDialogueOpen
              ? "Hide dialogue"
              : `Show dialogue (${earlierDialogue.length})`}
          </Button>
        )}
      </div>
      {isBriefingOpen && briefing && <div data-reading-text>{parseHtml(briefing)}</div>}
      {isDialogueOpen && (
        // One readable column in the classic 650px centre, two where a wide layout has 768px.
        <section
          id={dialogueId}
          aria-label="Earlier quest dialogue"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Browsers that leave scroll containers out of the tab order (Safari) would otherwise keep the clipped entries out of keyboard reach.
          tabIndex={0}
          className="grid max-h-96 grid-cols-1 gap-3 overflow-y-auto overscroll-contain rounded-md border p-2 @5xl:grid-cols-2"
        >
          {[...earlierDialogue].reverse().map((entry) => (
            <QuestDialogueText key={entry.objectiveId} entry={entry} />
          ))}
        </section>
      )}
    </div>
  );
};

/** A quest's objective cards, hiding those not yet relevant. Callers own the grid around them. */
export const QuestObjectives: React.FC<{
  quest: UserQuest["quest"];
  tracker: QuestTrackerType;
  checkRewards: () => void;
  /** Gray out every objective, for a player who cannot progress right now. */
  locked?: boolean;
  /** The objectives, by index, this part of the entry shows; all by default. */
  include?: (index: number) => boolean;
  /** The narrow dock: finished objectives with nothing to claim take one line. */
  compact?: boolean;
}> = ({ quest, tracker, checkRewards, locked, include, compact }) => {
  const allDone = isQuestComplete(quest, tracker);
  const activeObjective = getActiveObjective(quest, tracker);
  return quest.content.objectives.map((objective, i) => {
    if (include && !include(i)) return null;
    const status = tracker.goals.find((g) => g.id === objective.id);
    return (
      <Objective
        compact={compact}
        objective={objective}
        tracker={tracker}
        questType={quest.questType}
        checkRewards={checkRewards}
        key={objective.id}
        titlePrefix={quest.consecutiveObjectives ? "Objective: " : `${i + 1}. `}
        grayedOut={locked || !isQuestObjectiveAvailable(quest, tracker, i)}
        hideIfNoRewards={
          objective.task === "dialog" ||
          (activeObjective && objective.id !== activeObjective.id) ||
          (allDone && !status?.done)
        }
      />
    );
  });
};

/** One part of a quest's dialogue and the player's answer to it. */
const QuestDialogueText: React.FC<{ entry: QuestDialogueEntry }> = ({ entry }) => (
  <div className="min-w-0 border-l-4 pl-2 break-words">
    <div data-reading-text>{parseHtml(entry.text)}</div>
    {entry.answer && (
      <p className="text-muted-foreground mt-1 italic">You: {entry.answer}</p>
    )}
  </div>
);

/** The "Quest Update" dialog for a quest whose objective just changed on the map or in battle. */
export const QuestUpdateModal: React.FC<{
  questId: string;
  onClose: () => void;
}> = ({ questId, onClose }) => {
  const { data: userData } = useRequiredUserDataSelector(selectQuestProgress);
  const pulseDock = useSetAtom(storyDockPulseAtom);
  const userQuest = userData?.userQuests?.find((q) => q.questId === questId);
  const tracker = userData?.questData?.find((q) => q.id === questId);
  // Story progress pulses the dock, which already shows the objective, instead of
  // stopping play with a dialog.
  const isStory = !!getChapterForQuest(questId) || isLeadQuest(questId);
  useEffect(() => {
    if (!isStory) return;
    pulseDock((count) => count + 1);
    onClose();
  }, [isStory, questId]);
  if (!userQuest || !tracker || isStory) return null;
  return (
    <Modal
      isOpen
      setIsOpen={(open) => {
        if (!open) onClose();
      }}
      title="Quest Update"
    >
      <LogbookEntry
        userQuest={userQuest}
        tracker={tracker}
        showScene={true}
        hideTitle={false}
      />
    </Modal>
  );
};

/**
 * Checks rewards and reconciles their caches.
 * @returns The checkRewards mutation.
 */
export const useCheckRewards = () => {
  const { prepareUserUpdate, updateUser } = useUserInfo();
  const openRewardChoice = useOpenRewardChoice();
  const { prepareQuestRewardUpdate, updateQuestRewards } = useQuestRewardCacheUpdate();

  // Tutorial step
  const { currentStep, completeTutorialAction } = useTutorialStep();

  // Mutations
  const { mutate: checkRewards, isPending: isCheckingRewards } =
    api.quests.checkRewards.useMutation({
      onMutate: () => ({
        userRevision: prepareUserUpdate(),
        quests: prepareQuestRewardUpdate(),
      }),
      onSuccess: async (data, variables, context) => {
        if (data.success)
          trackConversion("tutorial_complete", data.tutorialCompletionId);
        // If a failure, show a toast
        if (!data.success && "message" in data) {
          showMutationToast({ success: data.success, message: data.message });
        }
        // Apply claimed progress before releasing the loader or opening the reward picker.
        const profileApplied = await updateUser(data, {
          revision: context?.userRevision,
          delta: data.userDelta,
        });
        // A finished "choose" quest (or one blocked by an earlier unpicked offer) opens the picker
        if (data.rewardChoicePending) {
          void openRewardChoice();
        }
        // If there is a userQuest, show the rewards
        if (data.userQuest && data.rewards) {
          const { rewards, userQuest, resolved } = data;
          const notifications = [
            ...(data.notifications ?? []),
            ...(data.actionNotice ? [data.actionNotice] : []),
          ];
          const badges = data.badges ?? [];
          const quest = userQuest.quest;
          const showToast =
            notifications.length > 0 ||
            (resolved && quest.successDescription) ||
            hasAnyRewardValue(rewards);
          // Show toast
          const message = resolved
            ? `Finished: ${quest.name}`
            : `Reward from ${quest.name}`;
          if (resolved || showToast)
            showRewardToast(notifications, rewards, message, resolved, quest, badges);
        }
        if (data.success && !(data.userQuest && data.rewards))
          showActionReadinessToast(data);
        // Reconcile other views without holding reward feedback or the collection loader.
        void Promise.allSettled([
          updateQuestRewards(data, context.quests, profileApplied),
        ]);
        // A dialog lesson moves on once the server has accepted the answer; a refused one
        // keeps the step and its answer buttons for another try. The next lesson's
        // highlight finds its target once the lists refresh.
        if (
          data.success &&
          variables?.nextObjectiveId &&
          currentStep?.relatedValue === variables.questId
        ) {
          await completeTutorialAction("questDialog");
        }
      },
    });

  return { checkRewards, isCheckingRewards };
};

/** Quest progress fields shared by the logbook views. */
const selectQuestProgress = (user: NonNullable<UserWithRelations>) => ({
  userQuests: user.userQuests,
  questData: user.questData,
});
