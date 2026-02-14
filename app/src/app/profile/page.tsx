"use client";

import { differenceInDays, differenceInHours } from "date-fns";
import { Info, Share2, Wrench } from "lucide-react";
import Link from "next/link";
import { api } from "@/app/_trpc/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ContentBox from "@/layout/ContentBox";
import DeleteUserButton from "@/layout/DeleteUserButton";
import ItemWithEffects from "@/layout/ItemWithEffects";
import LevelUpBtn from "@/layout/LevelUpBtn";
import Loader from "@/layout/Loader";
import Logbook from "@/layout/Logbook";
import StrengthWeaknesses from "@/layout/StrengthWeaknesses";
import { calcMedninRank } from "@/libs/hospital";
import { calcLevelRequirements, showUserRank } from "@/libs/profile";
import { getRankedRank } from "@/libs/ranked_pvp";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { useRequiredUserData } from "@/utils/UserContext";

export default function Profile() {
  // State
  const { data: userData, notifications } = useRequiredUserData();

  // Query
  const { data: marriages } = api.marriage.getMarriedUsers.useQuery(
    {},
    { enabled: !!userData, staleTime: 300000 },
  );

  const { data: topPlayers } = api.pvpRank.getCurrentTopPlayers.useQuery(undefined, {
    enabled: !!userData,
    staleTime: 300000,
  });

  // Derived
  const expRequired =
    userData &&
    Math.max(calcLevelRequirements(userData.level) - userData.experience, 0);

  // Loader
  if (!userData) {
    return <Loader explanation="Loading profile page..." />;
  }

  // News in profile/recruit
  const newInRecruit =
    notifications?.find((n) => n.href.includes("/profile/recruit"))
      ?.notificationCount || 0;

  return (
    <>
      <ContentBox
        id="tutorial-profile"
        title="Profile"
        subtitle="An overview of basic information"
        topRightContent={
          <div className="flex flex-row gap-3">
            <Link href="/profile/recruit" className="relative">
              <Share2 className="h-6 w-6 animate-[wiggle_1s_ease-in-out_infinite] cursor-pointer hover:text-orange-500" />
              {newInRecruit > 0 && (
                <div className="absolute top-[-10px] right-[-10px] z-50 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-orange-100 text-sm">
                  {newInRecruit}
                </div>
              )}
            </Link>
            <Link href="/profile/edit">
              <Wrench className="h-6 w-6 cursor-pointer hover:text-orange-500" />
            </Link>
            <DeleteUserButton userData={userData} />
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <b>General</b>
            <p>
              Lvl. {userData.level} {showUserRank(userData)}
            </p>
            <p>Money: {userData.money?.toLocaleString()}</p>
            <p>Bank: {userData.bank?.toLocaleString()}</p>
            <p>Status: {userData.status}</p>
            <p>Regen per minute: {userData.regeneration?.toFixed(2)}</p>
            <p>Gender: {userData.gender}</p>
          </div>
          <div className="flex flex-col items-start">
            <b>Activity</b>
            <p>Exp: {userData.experience?.toLocaleString()}</p>
            <p>Exp for lvl: {expRequired ? expRequired.toFixed(2) : "--"}</p>
            <p>PvE Fights: {userData.pveFights}</p>
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger>
                  <div className="flex flex-row items-center justify-center gap-1">
                    <p>PvP Activity: {userData.pvpActivity}</p>{" "}
                    <Info className="mb-1 h-4 w-4" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div>
                    <p>PVP Fights: {userData.pvpFights}</p>
                    <p>PvP Streak: {userData.pvpStreak}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {topPlayers && (
              <TooltipProvider delayDuration={50}>
                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex flex-row items-center justify-center gap-1">
                      <p>
                        PvP Rank:{" "}
                        {getRankedRank(
                          userData.rankedLp,
                          topPlayers.map((x) => x.rankedLp),
                        )}
                      </p>{" "}
                      <Info className="mb-1 h-4 w-4" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div>
                      <p>LP: {userData.rankedLp}</p>
                      <p>Battles: {userData.rankedBattles}</p>
                      <p>Wins: {userData.rankedWins}</p>
                      <p>
                        Win Rate:{" "}
                        {userData.rankedBattles > 0
                          ? (
                              (userData.rankedWins / userData.rankedBattles) *
                              100
                            ).toFixed(1)
                          : "0"}
                        %
                      </p>
                      <p>Current Streak: {userData.rankedStreak}</p>
                      <p>Seichi Silver: {userData.seichiSilver}</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <p>Medical Exp: {userData.medicalExperience?.toLocaleString()}</p>
          </div>
          <div>
            <b>Reputation</b>
            <p>Reputation points: {userData.reputationPoints?.toLocaleString()}</p>
            <p>Federal Support: {(userData.federalStatus || "NONE").toLowerCase()}</p>
            {userData.isOutlaw && (
              <p>Notoriety: {userData.villagePrestige?.toLocaleString()}</p>
            )}
            {!userData.isOutlaw && (
              <p>Village prestige: {userData.villagePrestige?.toLocaleString()}</p>
            )}
            {userData.joinedVillageAt && (
              <p>
                Village Member:{" "}
                {differenceInDays(new Date(), new Date(userData.joinedVillageAt))} days,{" "}
                {differenceInHours(new Date(), new Date(userData.joinedVillageAt)) % 24}{" "}
                hours
              </p>
            )}
          </div>
          <div>
            <b>Associations</b>
            <p>Village: {userData.village?.name}</p>
            <p>
              Bloodline:{" "}
              {userData.bloodline ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <span className="cursor-pointer font-bold hover:text-orange-500">
                      {userData.bloodline.name}
                    </span>
                  </PopoverTrigger>
                  <PopoverContent className="w-[500px] max-w-[90vw]">
                    <ItemWithEffects item={userData.bloodline} />
                  </PopoverContent>
                </Popover>
              ) : (
                "None"
              )}
            </p>
            <p>ANBU: {userData.anbuSquad?.name || "None"}</p>
            <p>
              {userData.isOutlaw ? "Faction" : "Clan"}: {userData.clan?.name || "None"}
            </p>
            <p>Medical: {capitalizeFirstLetter(calcMedninRank(userData))}</p>
            <p>
              Married:{" "}
              {marriages !== undefined && marriages.length > 0
                ? marriages.map((x, i) => (
                    <Link
                      key={x.username}
                      href={`/username/${x.username}`}
                      className="font-bold"
                    >
                      {i >= 1 ? `, ${x.username}` : x.username}
                    </Link>
                  ))
                : "None"}
            </p>
          </div>
        </div>
        <LevelUpBtn id="tutorial-level-up-btn" />
      </ContentBox>
      <StrengthWeaknesses />
      <Logbook />
    </>
  );
}
