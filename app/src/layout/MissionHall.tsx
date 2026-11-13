"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ADDITIONAL_MISSION_REWARD_MULTIPLIER,
  ERRANDS_PER_DAY,
  IMG_BUILDING_MISSIONHALL,
  IMG_MISSION_WAR,
  MEDICAL_MISSIONS_PER_DAY,
  MISSION_HALL_SOLO_QUEST_TYPES,
  MISSIONS_FULL_REWARD_COUNT,
  MISSIONS_PER_DAY,
  PVP_MISSIONS_PER_DAY,
  VILLAGE_SYNDICATE_ID,
  WAR_MISSIONS_PER_DAY,
} from "@/drizzle/constants";
import { useQuestStartCacheUpdate } from "@/hooks/useQuestStartCacheUpdate";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { LogbookEntry } from "@/layout/Logbook";
import MissionPicker, {
  MISSION_TILE_CLASSES,
  MISSION_TILE_IMAGE_CLASSES,
} from "@/layout/MissionPicker";
import { actionPrerequisiteUser } from "@/libs/actionReadiness";
import {
  filterMissionHallQuests,
  getMissionHallSettings,
  getMissionHallTileQuests,
  missionHallStartBlockedMessage,
  questDailyQuota,
} from "@/libs/quest/missionHall";
import { isReducedMissionReward } from "@/libs/quest/rewards";
import { availableQuestLetterRanks } from "@/libs/rank";
import { showRetryableErrorToast } from "@/libs/retryableToast";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { capitalizeFirstLetter } from "@/utils/string";
import { useUserInfo } from "@/utils/UserContext";

interface MissionHallProps {
  userData: NonNullable<UserWithRelations>;
}

/** Start mission and crime runs while reconciling entry costs, discovery lists and announcements. */
export default function MissionHall({ userData }: MissionHallProps) {
  const { prepareQuestStartUpdate, updateQuestStart } = useQuestStartCacheUpdate();
  const { prepareUserUpdate, updateUser } = useUserInfo();
  const activeContext = `${userData.userId}:${userData.sector}`;
  const activeUserIdRef = useRef(userData.userId);
  activeUserIdRef.current = userData.userId;
  const activeContextRef = useRef(activeContext);
  activeContextRef.current = activeContext;
  const startFlight = useSingleFlight<{
    context: string;
    questId: string;
    userSector: number;
  }>();
  const pendingQuestId = startFlight.pending?.questId ?? null;
  const randomStartRequestRef = useRef(false);
  const [committedStart, setCommittedStart] = useState<{
    context: string;
    questId: string;
  } | null>(null);

  const currentQuest = userData?.userQuests?.find(
    (q) => MISSION_HALL_SOLO_QUEST_TYPES.includes(q.quest.questType) && !q.endAt,
  );
  const currentTracker = userData?.questData?.find(
    (q) => q.id === currentQuest?.questId,
  );

  const { data: hallData } = api.quests.missionHall.useQuery(
    {
      villageId: userData?.isOutlaw
        ? VILLAGE_SYNDICATE_ID
        : (userData?.villageId ?? VILLAGE_SYNDICATE_ID),
      level: userData?.level ?? 0,
    },
    { enabled: !!userData },
  );

  const { mutate: startRandom, isPending } = api.quests.startRandom.useMutation({
    onMutate: () => ({
      userRevision: prepareUserUpdate(),
      quests: prepareQuestStartUpdate(),
    }),
    onSuccess: async (data, _variables, context) => {
      showMutationToast(data);
      const profileApplied = await updateUser(data, {
        revision: context?.userRevision,
      });
      await updateQuestStart(data, context.quests, profileApplied);
    },
  });

  const { mutateAsync: startQuest } = api.quests.startQuest.useMutation({
    meta: { handlesTransportError: true },
  });

  const startSpecificQuest = async (quest: { id: string }) => {
    // Capture the quest, sector, and user context so a late response cannot act on new props.
    if (randomStartRequestRef.current || isPending) return false;
    const request = {
      context: activeContext,
      questId: quest.id,
      userSector: userData.sector,
    };
    const started = await startFlight.run(request, async () => {
      const userRevision = prepareUserUpdate();
      const questSnapshot = prepareQuestStartUpdate();
      try {
        const data = await startQuest({
          questId: request.questId,
          userSector: request.userSector,
          supportsAnnouncements: true,
        });
        // Consumed announcements belong to this account even when its quest context changed.
        if (activeUserIdRef.current === userData.userId) showMutationToast(data);
        if (activeContextRef.current !== request.context) return false;

        if (!data.success) return false;

        // The server has committed a mutually-exclusive mission. Suppress every stale start action
        // before cache work; failed invalidation must not expose another start on old hall data.
        setCommittedStart({ context: request.context, questId: request.questId });
        void Promise.allSettled([
          updateUser(data, { revision: userRevision }).then((profileApplied) =>
            updateQuestStart(data, questSnapshot, profileApplied),
          ),
        ]);
        return true;
      } catch (error) {
        if (activeContextRef.current === request.context) {
          showRetryableErrorToast(
            error,
            "Could not start this quest. Check your connection and try again.",
          );
        }
        return false;
      }
    });
    return started ?? false;
  };

  // Derived
  const availableUserRanks = availableQuestLetterRanks(userData.rank);
  const classifier = userData.isOutlaw ? "crime" : "mission";
  const isInActiveWar = (userData.activeWars?.length ?? 0) > 0;
  const regularMissions = hallData?.filter((q) => q.questType !== "war") ?? [];
  const warMissions = hallData?.filter((q) => q.questType === "war") ?? [];
  const warMissionsLeft = WAR_MISSIONS_PER_DAY - (userData.dailyWarMissions ?? 0);
  const currentWarQuest = userData?.userQuests?.find(
    (q) => q.quest.questType === "war" && !q.endAt,
  );
  const currentWarTracker = userData?.questData?.find(
    (q) => q.id === currentWarQuest?.questId,
  );
  const availableWarMissions = warMissions.filter((q) =>
    availableUserRanks.includes(q.questRank),
  );
  const committedStartIsReflected =
    !!committedStart &&
    userData.userQuests?.some(
      (entry) =>
        entry.questId === committedStart.questId &&
        !entry.endAt &&
        committedStart.context === activeContext,
    );
  useEffect(() => {
    if (
      committedStart &&
      (committedStart.context !== activeContext || committedStartIsReflected)
    ) {
      setCommittedStart((current) => (current === committedStart ? null : current));
    }
  }, [activeContext, committedStart, committedStartIsReflected]);
  const hasUnrefreshedCommittedStart =
    !!committedStart &&
    committedStart.context === activeContext &&
    !committedStartIsReflected;
  // Recovery-capable actions reach the server; other activity blocks mission starts.
  const startBlockedMessage = missionHallStartBlockedMessage(
    "mission",
    actionPrerequisiteUser(userData).status,
  );
  // Mission/crime/medical/PvP/war starts are mutually exclusive on the server. Lock every start
  // entry point while one is pending or committed; leaving siblings active would invite a race.
  const isSpecificStartBlocked =
    isPending ||
    pendingQuestId !== null ||
    hasUnrefreshedCommittedStart ||
    !!startBlockedMessage;

  return (
    <>
      {!currentQuest && (
        <>
          <Image
            alt="welcome"
            src={IMG_BUILDING_MISSIONHALL}
            width={512}
            height={195}
            className="w-full"
            priority={true}
          />
          <p className="p-3 text-center font-bold">
            Missions are special assignments that advance the game&apos;s narrative.
            They can only be started here at the Mission Hall.
          </p>
          <ul
            aria-label="Daily limits"
            className="flex flex-wrap justify-center gap-2 p-3 font-bold text-md"
          >
            {[
              ["Errands", userData.dailyErrands, ERRANDS_PER_DAY],
              [
                `${capitalizeFirstLetter(classifier)}s`,
                userData.dailyMissions,
                MISSIONS_PER_DAY,
              ],
              ["Medical", userData.dailyMedicalMissions, MEDICAL_MISSIONS_PER_DAY],
              ["PvP", userData.dailyPvpMissions, PVP_MISSIONS_PER_DAY],
              ["War", userData.dailyWarMissions ?? 0, WAR_MISSIONS_PER_DAY],
            ].map(([label, done, limit]) => (
              <li
                key={label}
                className="whitespace-nowrap rounded-full border px-2.5 py-0.5"
              >
                {label} {done}/{limit}
              </li>
            ))}
          </ul>
          {startBlockedMessage && (
            <p role="status" className="px-3 text-center font-semibold text-orange-500">
              {startBlockedMessage}
            </p>
          )}
        </>
      )}

      {isPending && <Loader explanation="Accepting" />}
      {hasUnrefreshedCommittedStart && (
        <div role="status" aria-live="polite">
          <Loader explanation="Updating" />
        </div>
      )}
      {currentQuest && currentTracker && (
        <div className="p-3">
          <LogbookEntry userQuest={currentQuest} tracker={currentTracker} showScene />
        </div>
      )}
      {currentWarQuest && currentWarTracker && (
        <div className="p-3">
          <LogbookEntry
            userQuest={currentWarQuest}
            tracker={currentWarTracker}
            showScene
          />
        </div>
      )}
      {!currentQuest && !isPending && (
        <div className="grid grid-cols-3 gap-4 p-3 text-center italic">
          {getMissionHallSettings(userData.isOutlaw).map((setting) => {
            const { filtered, rankInfo } = filterMissionHallQuests(
              regularMissions,
              userData,
              setting.type,
            );
            // Check is user rank is high enough for this quest
            const isErrand = setting.type === "errand";
            const isMedical = setting.type === "medical";
            const isPvp = setting.type === "pvp";
            const available = getMissionHallTileQuests(
              setting,
              filtered,
              availableUserRanks,
            );
            const count = available.length;
            const quota = questDailyQuota(setting.type, userData);
            const capped = !!quota && quota.current >= quota.limit;
            // Checks
            const rankCheck =
              availableUserRanks.includes(setting.rank) || isErrand || isPvp;
            const medicalCheck = isMedical
              ? filtered.length > 0 // Show colored if ANY medical missions are available
              : true;
            const pvpCheck = isPvp
              ? filtered.length > 0 // Show colored if ANY pvp missions are available
              : true;
            const grayScale =
              count === 0 || capped || !rankCheck || !medicalCheck || !pvpCheck;

            // Handle mission picker cases (PvP, Medical, A-rank)
            if (isPvp || isMedical || setting.rank === "A") {
              const missions = available.map((q) => ({
                id: q.id,
                name: q.name,
                image: q.image || undefined,
              }));

              const typeName = isPvp ? "PvP" : isMedical ? "medical" : "";
              const dialogTitle = isPvp
                ? "Accept PvP Mission"
                : isMedical
                  ? "Accept Medical Mission"
                  : "Accept Mission";
              const isReducedRewards =
                setting.rank === "A" &&
                isReducedMissionReward(userData.dailyMissions, {
                  phase: "pre-start",
                }) &&
                userData.dailyMissions < MISSIONS_PER_DAY;

              const keyPrefix = isPvp ? "pvp" : isMedical ? "medical" : "mission";

              return (
                <MissionPicker
                  key={`${keyPrefix}-${setting.name}`}
                  setting={setting}
                  missions={missions}
                  disabled={grayScale}
                  interactionDisabled={isSpecificStartBlocked}
                  pendingMissionId={pendingQuestId}
                  onMissionSelect={startSpecificQuest}
                  dialogTitle={dialogTitle}
                  dialogDescription={(mission) =>
                    capped ? (
                      `You have reached your daily ${typeName ? `${typeName} ` : ""}mission limit of ${quota?.limit} ${typeName ? `${typeName} ` : ""}missions. Please try again tomorrow.`
                    ) : (
                      <>
                        Are you sure you want to accept the{" "}
                        {typeName ? `${typeName} ` : ""}mission &quot;
                        {mission.name}&quot;? You can only have one active{" "}
                        {setting.rank === "A" ? "mission" : classifier} at a time.
                        {isReducedRewards && (
                          <>
                            <br />
                            <br />
                            <span className="text-yellow-500">
                              Note: You have completed more than{" "}
                              {MISSIONS_FULL_REWARD_COUNT} missions today. This mission
                              will only give{" "}
                              {ADDITIONAL_MISSION_REWARD_MULTIPLIER * 100}% of its
                              normal rewards.
                            </span>
                          </>
                        )}
                      </>
                    )
                  }
                  actionDisabled={capped}
                  actionText={capped ? "Daily Limit Reached" : "Accept Mission"}
                  additionalContent={() => (
                    <>
                      {isReducedRewards && (
                        <p className="text-sm text-yellow-500">
                          {ADDITIONAL_MISSION_REWARD_MULTIPLIER * 100}% Rewards
                        </p>
                      )}
                      {capped && (
                        <p className="text-red-500 text-sm">Daily Limit Reached</p>
                      )}
                    </>
                  )}
                />
              );
            } else {
              const isReducedRewards =
                !isErrand &&
                isReducedMissionReward(userData.dailyMissions, {
                  phase: "pre-start",
                });
              const assignment = isErrand ? "errand" : "mission";
              return (
                <Fragment key={setting.name}>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        disabled={grayScale || isSpecificStartBlocked}
                        className={cn(
                          "disabled:cursor-not-allowed disabled:opacity-60",
                          grayScale || isSpecificStartBlocked
                            ? "grayscale filter"
                            : MISSION_TILE_CLASSES,
                        )}
                      >
                        <Image
                          alt=""
                          className={MISSION_TILE_IMAGE_CLASSES}
                          src={setting.image}
                          width={256}
                          height={256}
                        />
                        <p className="font-bold">{setting.name}</p>
                        <p className="flex flex-col">
                          {count} available · random
                          {rankInfo && (
                            <span className="text-yellow-500"> {rankInfo}</span>
                          )}
                        </p>
                        {isReducedRewards &&
                          userData.dailyMissions < MISSIONS_PER_DAY && (
                            <p className="text-sm text-yellow-500">
                              {ADDITIONAL_MISSION_REWARD_MULTIPLIER * 100}% Rewards
                            </p>
                          )}
                        {capped && (
                          <p className="text-red-500 text-sm">Daily Limit Reached</p>
                        )}
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Accept Random Mission</AlertDialogTitle>
                        <AlertDialogDescription>
                          {capped ? (
                            `You have reached your daily ${assignment} limit of ${quota?.limit} ${assignment}s. Please try again tomorrow.`
                          ) : (
                            <>
                              Are you sure you want to accept a random{" "}
                              {`${setting.rank}-rank ${setting.type}`}? You can only
                              have one active {classifier} at a time.
                              {isReducedRewards && (
                                <>
                                  <br />
                                  <br />
                                  <span className="text-yellow-500">
                                    Note: You have already completed{" "}
                                    {MISSIONS_FULL_REWARD_COUNT} missions today. This
                                    mission will only give{" "}
                                    {ADDITIONAL_MISSION_REWARD_MULTIPLIER * 100}% of its
                                    normal rewards.
                                  </span>
                                </>
                              )}
                            </>
                          )}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        {capped ? (
                          <AlertDialogAction disabled>
                            Daily Limit Reached
                          </AlertDialogAction>
                        ) : (
                          <AlertDialogAction
                            disabled={isSpecificStartBlocked}
                            onClick={(e) => {
                              e.preventDefault();
                              if (
                                startFlight.current() ||
                                randomStartRequestRef.current
                              ) {
                                return;
                              }
                              randomStartRequestRef.current = true;
                              startRandom(
                                {
                                  type: setting.type,
                                  rank: setting.rank,
                                  userLevel: userData.level,
                                  userSector: userData.sector,
                                  userVillageId: userData.isOutlaw
                                    ? VILLAGE_SYNDICATE_ID
                                    : userData.villageId,
                                  supportsAnnouncements: true,
                                },
                                {
                                  onSettled: () => {
                                    randomStartRequestRef.current = false;
                                  },
                                },
                              );
                            }}
                          >
                            Accept Mission
                          </AlertDialogAction>
                        )}
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </Fragment>
              );
            }
          })}
          <MissionPicker
            setting={{
              name: "War Mission",
              image: IMG_MISSION_WAR,
            }}
            missions={availableWarMissions.map((q) => ({
              id: q.id,
              name: q.name,
              image: q.image || undefined,
            }))}
            disabled={
              isSpecificStartBlocked ||
              !isInActiveWar ||
              !!currentWarQuest ||
              warMissionsLeft <= 0 ||
              availableWarMissions.length === 0
            }
            interactionDisabled={isSpecificStartBlocked}
            pendingMissionId={pendingQuestId}
            onMissionSelect={startSpecificQuest}
            dialogTitle="Accept War Mission"
            dialogDescription={(mission) =>
              !isInActiveWar ? (
                "Your village is not currently at war."
              ) : currentWarQuest ? (
                "You already have an active war mission. Complete it before accepting another."
              ) : warMissionsLeft <= 0 ? (
                `You have reached your daily war mission limit of ${WAR_MISSIONS_PER_DAY}. Please try again tomorrow.`
              ) : (
                <>
                  Are you sure you want to accept the war mission &quot;{mission.name}
                  &quot;?
                </>
              )
            }
            actionDisabled={!isInActiveWar || !!currentWarQuest || warMissionsLeft <= 0}
            actionText={
              !isInActiveWar
                ? "No Active War"
                : currentWarQuest
                  ? "Active Mission"
                  : warMissionsLeft <= 0
                    ? "Daily Limit Reached"
                    : "Accept Mission"
            }
            emptyContent={
              <p className="p-2 text-center text-muted-foreground text-sm">
                {!isInActiveWar
                  ? "Your village is not currently at war."
                  : currentWarQuest
                    ? "Complete your active war mission first."
                    : warMissionsLeft <= 0
                      ? `Daily limit of ${WAR_MISSIONS_PER_DAY} reached.`
                      : "No war missions available at your rank."}
              </p>
            }
            additionalContent={() => (
              <>
                {currentWarQuest && (
                  <p className="text-sm text-yellow-500">Active Mission</p>
                )}
                {!currentWarQuest && warMissionsLeft <= 0 && (
                  <p className="text-red-500 text-sm">Daily Limit Reached</p>
                )}
              </>
            )}
          />
        </div>
      )}
    </>
  );
}
