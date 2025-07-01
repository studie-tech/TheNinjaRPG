"use client";

import Link from "next/link";
import ContentBox from "@/layout/ContentBox";
import DeleteUserButton from "@/layout/DeleteUserButton";
import StrengthWeaknesses from "@/layout/StrengthWeaknesses";
import Logbook from "@/layout/Logbook";
import Loader from "@/layout/Loader";
import LevelUpBtn from "@/layout/LevelUpBtn";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getRankedRank } from "@/libs/ranked_pvp";
import { Wrench, Share2, Info } from "lucide-react";
import { useRequiredUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { showUserRank } from "@/libs/profile";
import { calcMedninRank } from "@/libs/hospital/hospital";
import { calcLevelRequirements } from "@/libs/profile";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { differenceInDays, differenceInHours } from "date-fns";

export default function Profile() {
  // State
  const { data: userData } = useRequiredUserData();

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

  return (
    <>
      <ContentBox
        id="tutorial-profile"
        title="Profile"
        subtitle="An overview of basic information"
        topRightContent={
          <div className="flex flex-row gap-1">
            <Link href="/profile/recruit">
              <Share2 className="h-6 w-6 cursor-pointer hover:text-orange-500 animate-[wiggle_1s_ease-in-out_infinite]" />
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
            <p>Money: {userData.money.toFixed(2)}</p>
            <p>Bank: {userData.bank.toFixed(2)}</p>
            <p>Status: {userData.status}</p>
            <p>Regen per minute: {userData.regeneration.toFixed(2)}</p>
            <p>Gender: {userData.gender}</p>
          </div>
          <div className="flex flex-col items-start">
            <b>Activity</b>
            <p>Exp: {userData.experience.toFixed(2)}</p>
            <p>Exp for lvl: {expRequired ? expRequired.toFixed(2) : "--"}</p>
            <p>PvE Fights: {userData.pveFights}</p>
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger>
                  <div className="flex flex-row items-center justify-center gap-1">
                    <p>PvP Activity: {userData.pvpActivity}</p>{" "}
                    <Info className="h-4 w-4 mb-1" />
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
                      <Info className="h-4 w-4 mb-1" />
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
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <p>Medical Exp: {userData.medicalExperience}</p>
          </div>
          <div>
            <b>Reputation</b>
            <p>Reputation points: {userData.reputationPoints.toFixed(2)}</p>
            <p>Federal Support: {userData.federalStatus.toLowerCase()}</p>
            <p>Activity Streak: {userData.activityStreak}</p>
            {userData.isOutlaw && <p>Notoriety: {userData.villagePrestige}</p>}
            {!userData.isOutlaw && <p>Village prestige: {userData.villagePrestige}</p>}
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
            <p>Bloodline: {userData.bloodline?.name || "None"}</p>
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
                      {i >= 1 ? ", " + x.username : x.username}
                    </Link>
                  ))
                : "None"}
            </p>
          </div>
        </div>
        <LevelUpBtn />
      </ContentBox>
      <StrengthWeaknesses />
      <Logbook />
    </>
  );
}
