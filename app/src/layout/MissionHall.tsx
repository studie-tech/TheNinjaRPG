"use client";

import Loader from "@/layout/Loader";
import { LogbookEntry } from "@/layout/Logbook";
import Image from "next/image";
import { showMutationToast } from "@/libs/toast";
import { api } from "@/app/_trpc/client";
import { availableQuestLetterRanks } from "@/libs/train";
import { getMissionHallSettings } from "@/libs/quest";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MISSIONS_PER_DAY,
  ERRANDS_PER_DAY,
  MEDICAL_MISSIONS_PER_DAY,
  IMG_BUILDING_MISSIONHALL,
  MEDNIN_RANKS,
} from "@/drizzle/constants";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { capitalizeFirstLetter } from "@/utils/sanitize";
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
import { cn } from "src/libs/shadui";
import { calcMedninRank } from "@/libs/hospital/hospital";
import React from "react";
import type { UserWithRelations } from "@/server/api/routers/profile";

interface MissionHallProps {
  userData: NonNullable<UserWithRelations>;
}

export default function MissionHall({ userData }: MissionHallProps) {
  const util = api.useUtils();

  const currentQuest = userData?.userQuests?.find(
    (q) =>
      ["mission", "crime", "errand", "medical"].includes(q.quest.questType) && !q.endAt,
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
    onSuccess: async (data) => {
      showMutationToast(data);
      await util.profile.getUser.invalidate();
    },
  });

  const { mutate: startQuest } = api.quests.startQuest.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await Promise.all([
        util.profile.getUser.invalidate(),
        util.quests.missionHall.invalidate(),
      ]);
    },
  });

  // Derived
  const availableUserRanks = availableQuestLetterRanks(userData.rank);
  const errandsLeft = ERRANDS_PER_DAY - userData.dailyErrands;
  const classifier = userData.isOutlaw ? "crime" : "mission";
  const aRanks = hallData?.filter(
    (m) => m.questType === classifier && m.questRank === "A",
  );
  const medicalRanks = hallData?.filter((m) => m.questType === "medical");
  const userMedicalRank = calcMedninRank({
    medicalExperience: userData.medicalExperience,
    rank: userData.rank,
  });

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
          <p className="text-center text-xl font-bold mb-4 p-3">
            Missions are special assignments that advance the game&apos;s narrative.
            They can only be started here at the Mission Hall.
          </p>
          <p className="text-center p-3 text-xl font-bold">
            Errands [{userData.dailyErrands} / {ERRANDS_PER_DAY}] -{" "}
            {capitalizeFirstLetter(classifier)}s [{userData.dailyMissions} /{" "}
            {MISSIONS_PER_DAY}] - Medical [{userData.dailyMedicalMissions} /{" "}
            {MEDICAL_MISSIONS_PER_DAY}]
          </p>
        </>
      )}

      {isPending && <Loader explanation="Accepting..." />}
      {currentQuest && currentTracker && (
        <div className="p-3">
          <LogbookEntry userQuest={currentQuest} tracker={currentTracker} showScene />
        </div>
      )}
      {!currentQuest && !isPending && (
        <div className="grid grid-cols-3 italic p-3 gap-4 text-center">
          {getMissionHallSettings(userData.isOutlaw).map((setting, i) => {
            // Check is user rank is high enough for this quest
            const isErrand = setting.type === "errand";
            const isMedical = setting.type === "medical";
            const capped = isErrand
              ? errandsLeft <= 0
              : isMedical
                ? userData.dailyMedicalMissions >= MEDICAL_MISSIONS_PER_DAY
                : userData.dailyMissions >= MISSIONS_PER_DAY;
            // Count how many of this type and rank are available
            let count =
              hallData?.filter(
                (point) =>
                  point.questType === setting.type && point.questRank === setting.rank,
              )?.length ?? 0;

            // For medical missions, calculate fallback counts
            let fallbackRank = "";
            if (isMedical) {
              const userMedicalRankIndex = MEDNIN_RANKS.indexOf(userMedicalRank);
              let fallbackCount = 0;

              // Try each rank from user's rank down to NONE
              for (let i = userMedicalRankIndex; i >= 0; i--) {
                const currentRank = MEDNIN_RANKS[i];
                if (!currentRank) continue;

                const rankCount =
                  medicalRanks?.filter(
                    (q) =>
                      q.questRank === setting.rank &&
                      (q.medicalRank === "NONE" || q.medicalRank === currentRank),
                  )?.length ?? 0;

                if (rankCount > 0) {
                  fallbackCount = rankCount;
                  fallbackRank = currentRank;
                  break;
                }
              }

              count = fallbackCount;
            }
            // Checks
            const rankCheck = availableUserRanks.includes(setting.rank) || isErrand;
            const medicalCheck = isMedical
              ? (medicalRanks?.some(
                  (q) =>
                    q.questRank === setting.rank &&
                    (q.medicalRank === "NONE" || q.medicalRank === userMedicalRank),
                ) ?? false)
              : true;
            const grayScale = count === 0 || capped || !rankCheck || !medicalCheck;

            if (setting.rank === "A") {
              return (
                <Popover key={`mission-${i}`}>
                  <PopoverTrigger asChild>
                    <div
                      key={i}
                      className={cn(
                        grayScale
                          ? "filter grayscale"
                          : "hover:cursor-pointer hover:opacity-30",
                      )}
                    >
                      <Image alt="small" src={setting.image} width={256} height={256} />
                      <p className="font-bold">{setting.name}</p>
                      <p>[Select out of {count} available]</p>
                    </div>
                  </PopoverTrigger>
                  <PopoverContent>
                    <div className="grid grid-cols-3 gap-2">
                      {aRanks?.map((mission, i) => (
                        <AlertDialog key={`specific-mission-${i}`}>
                          <AlertDialogTrigger asChild>
                            <div className="hover:opacity-70 hover:cursor-pointer">
                              <div className="flex flex-col justify-center items-center">
                                <Image
                                  alt="small"
                                  className="rounded-lg"
                                  src={mission.image || setting.image}
                                  width={128}
                                  height={128}
                                />
                                <p className="font-bold text-xs text-center">
                                  {mission.name}
                                </p>
                                {userData.dailyMissions >= 9 &&
                                  userData.dailyMissions < MISSIONS_PER_DAY && (
                                    <p className="text-sm text-yellow-500">
                                      40% Rewards
                                    </p>
                                  )}
                                {userData.dailyMissions >= MISSIONS_PER_DAY && (
                                  <p className="text-sm text-red-500">
                                    Daily Limit Reached
                                  </p>
                                )}
                              </div>
                            </div>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Accept Mission: {mission.name}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {userData.dailyMissions >= MISSIONS_PER_DAY ? (
                                  `You have reached your daily mission limit of ${MISSIONS_PER_DAY} missions. Please try again tomorrow.`
                                ) : (
                                  <>
                                    Are you sure you want to accept the mission &quot;
                                    {mission.name}&quot;? You can only have one active
                                    mission at a time.
                                    {userData.dailyMissions >= 9 && (
                                      <>
                                        <br />
                                        <br />
                                        <span className="text-yellow-500">
                                          Note: You have completed more than 9 missions
                                          today. This mission will only give 40% of its
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
                              {userData.dailyMissions >= MISSIONS_PER_DAY ? (
                                <AlertDialogAction disabled>
                                  Daily Limit Reached
                                </AlertDialogAction>
                              ) : (
                                <AlertDialogAction
                                  onClick={() =>
                                    startQuest({
                                      questId: mission.id,
                                      userSector: userData.sector,
                                    })
                                  }
                                >
                                  Accept Mission
                                </AlertDialogAction>
                              )}
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              );
            } else {
              return (
                <>
                  {setting.rank === "S" && <div></div>}
                  <AlertDialog key={i}>
                    <AlertDialogTrigger asChild>
                      <div
                        className={cn(
                          grayScale
                            ? "filter grayscale"
                            : "hover:cursor-pointer hover:opacity-30",
                        )}
                      >
                        <Image
                          alt="small"
                          src={setting.image}
                          width={256}
                          height={256}
                        />
                        <p className="font-bold">{setting.name}</p>
                        <p>
                          [Random out of {count} available
                          {isMedical &&
                            fallbackRank &&
                            fallbackRank !== userMedicalRank && (
                              <span className="text-yellow-500">
                                {" "}
                                ({fallbackRank} rank)
                              </span>
                            )}
                          ]
                        </p>
                        {!isErrand &&
                          userData.dailyMissions >= 9 &&
                          userData.dailyMissions < MISSIONS_PER_DAY && (
                            <p className="text-sm text-yellow-500">40% Rewards</p>
                          )}
                        {!isErrand && userData.dailyMissions >= MISSIONS_PER_DAY && (
                          <p className="text-sm text-red-500">Daily Limit Reached</p>
                        )}
                        {isErrand && userData.dailyErrands >= ERRANDS_PER_DAY && (
                          <p className="text-sm text-red-500">Daily Limit Reached</p>
                        )}
                        {isMedical &&
                          userData.dailyMedicalMissions >= MEDICAL_MISSIONS_PER_DAY && (
                            <p className="text-sm text-red-500">Daily Limit Reached</p>
                          )}
                      </div>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Accept Random Mission</AlertDialogTitle>
                        <AlertDialogDescription>
                          {!isErrand &&
                          !isMedical &&
                          userData.dailyMissions >= MISSIONS_PER_DAY ? (
                            `You have reached your daily mission limit of ${MISSIONS_PER_DAY} missions. Please try again tomorrow.`
                          ) : isErrand && userData.dailyErrands >= ERRANDS_PER_DAY ? (
                            `You have reached your daily errand limit of ${ERRANDS_PER_DAY} errands. Please try again tomorrow.`
                          ) : isMedical &&
                            userData.dailyMedicalMissions >=
                              MEDICAL_MISSIONS_PER_DAY ? (
                            `You have reached your daily medical mission limit of ${MEDICAL_MISSIONS_PER_DAY} medical missions. Please try again tomorrow.`
                          ) : (
                            <>
                              Are you sure you want to accept a random{" "}
                              {isMedical
                                ? "medical mission"
                                : `${setting.rank}-rank ${setting.type}`}
                              ? You can only have one active {classifier} at a time.
                              {!isErrand &&
                                !isMedical &&
                                userData.dailyMissions >= 9 && (
                                  <>
                                    <br />
                                    <br />
                                    <span className="text-yellow-500">
                                      Note: You have already completed 9 missions today.
                                      This mission will only give 40% of its normal
                                      rewards.
                                    </span>
                                  </>
                                )}
                            </>
                          )}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        {(!isErrand &&
                          !isMedical &&
                          userData.dailyMissions >= MISSIONS_PER_DAY) ||
                        (isErrand && userData.dailyErrands >= ERRANDS_PER_DAY) ||
                        (isMedical &&
                          userData.dailyMedicalMissions >= MEDICAL_MISSIONS_PER_DAY) ? (
                          <AlertDialogAction disabled>
                            Daily Limit Reached
                          </AlertDialogAction>
                        ) : (
                          <AlertDialogAction
                            onClick={(e) => {
                              e.preventDefault();
                              startRandom({
                                type: setting.type,
                                rank: setting.rank,
                                userLevel: userData.level,
                                userSector: userData.sector,
                                userVillageId: userData.isOutlaw
                                  ? VILLAGE_SYNDICATE_ID
                                  : userData.villageId,
                              });
                            }}
                          >
                            Accept Mission
                          </AlertDialogAction>
                        )}
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              );
            }
          })}
        </div>
      )}
    </>
  );
}
