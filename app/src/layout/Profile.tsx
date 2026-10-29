"use client";

import { differenceInDays, differenceInHours } from "date-fns";
import {
  History,
  Info,
  LayoutDashboard,
  PawPrint,
  Settings,
  Share2,
  Trophy,
  UserRound,
  Wrench,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { lazy, Suspense, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PVP_EXPERIENCE_BOOST_TIERS,
  PVP_EXPERIENCE_DAILY_DECAY,
  PVP_EXPERIENCE_PARTICIPATION_REWARD,
  PVP_EXPERIENCE_WIN_REWARD,
  PVP_WEEKLY_KILL_BOOST,
  PVP_WEEKLY_KILL_BOOST_CAP,
  VILLAGE_LOYALTY_TIERS,
} from "@/drizzle/constants";
import { safeLocalStorageSetItem } from "@/hooks/localstorage";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import { DashboardSettings } from "@/layout/DashboardSettings";
import ItemWithEffects from "@/layout/ItemWithEffects";
import LevelUpBtn from "@/layout/LevelUpBtn";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Logbook, {
  LogbookAchievements,
  LogbookBattles,
  LogbookHistory,
} from "@/layout/Logbook";
import Modal from "@/layout/Modal";
import NavTabs from "@/layout/NavTabs";
import ProfileDashboard from "@/layout/ProfileDashboard";
import { QuestTeams } from "@/layout/QuestTeams";
import StrengthWeaknesses from "@/layout/StrengthWeaknesses";
import { WarDashboardNotices } from "@/layout/WarDashboardNotices";
import { calcMedninRank } from "@/libs/hospital";
import { calcLevelRequirements, showUserRank } from "@/libs/profile";
import { getRankedRank } from "@/libs/ranked_pvp";
import { getSageMasteryDisplayRank } from "@/libs/sageMode";
import { isTutorialActive } from "@/libs/tutorial";
import {
  getVillageLoyaltyDays,
  getVillageLoyaltyTierDescription,
} from "@/libs/villageLoyalty";
import { capitalizeFirstLetter } from "@/utils/string";
import { nextRegenerationTickAt } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";

const profileTabs = [
  "Dashboard",
  "Character",
  "Pet",
  "Achievements",
  "History",
  "Edit Character",
  "Sharing",
] as const;
const iconProfileTabs = [
  "Achievements",
  "History",
  "Edit Character",
  "Sharing",
] as const;
const tutorialProfileTabs = ["Character", "Pet", ...iconProfileTabs] as const;
type ProfileTab = (typeof profileTabs)[number];
const profileTabValues: Record<ProfileTab, string> = {
  Dashboard: "dashboard",
  Character: "character",
  Pet: "pet",
  Achievements: "achievements",
  History: "history",
  "Edit Character": "edit",
  Sharing: "sharing",
};

export function Profile() {
  const { data: userData, updateUser, notifications } = useRequiredUserData();
  const [tab, setTab] = useState<ProfileTab | null>(null);
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const urlTab = profileTabs.find(
    (option) => option === requestedTab || profileTabValues[option] === requestedTab,
  );

  if (!userData) return <Loader explanation="Loading profile page..." />;

  const tutorialActive = isTutorialActive(userData);
  const selectedTab = urlTab ?? tab ?? "Dashboard";
  const activeTab =
    tutorialActive && selectedTab === "Dashboard" ? "Character" : selectedTab;
  const visibleTabs = tutorialActive ? tutorialProfileTabs : profileTabs;
  const newInRecruit =
    notifications?.find((n) => n.href.includes("/profile/recruit"))
      ?.notificationCount || 0;

  const dashboardSettings = !tutorialActive ? (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label="Dashboard settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[80dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto"
      >
        <DashboardSettings userData={userData} />
      </PopoverContent>
    </Popover>
  ) : null;

  const selectTab = (value: string) => {
    const next = profileTabs.find(
      (option) => option === value || profileTabValues[option] === value,
    );
    if (!next) return;
    const allowed = tutorialActive && next === "Dashboard" ? "Character" : next;
    if (userData.rememberProfileTab) {
      safeLocalStorageSetItem(`profileTab:${userData.userId}`, allowed);
    }
    setTab(allowed);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", profileTabValues[allowed]);
    window.history.replaceState(null, "", `/profile?${params}`);
  };

  return (
    <div id="tutorial-profile">
      <WarDashboardNotices />
      <Tabs
        value={profileTabValues[activeTab]}
        onValueChange={(value) => selectTab(value)}
      >
        <div className="@container mb-3">
          <NavTabs
            id={`profileTab:${userData.userId}`}
            remember={userData.rememberProfileTab}
            current={urlTab || tab !== null ? activeTab : null}
            options={visibleTabs}
            onChange={selectTab}
            accessibleTabs
            label="Profile sections"
            icons={{
              Dashboard: (
                <LayoutDashboard
                  className="@min-[480px]:hidden h-[20px] w-[20px]"
                  aria-hidden="true"
                />
              ),
              Character: (
                <UserRound
                  className="@min-[480px]:hidden h-[20px] w-[20px]"
                  aria-hidden="true"
                />
              ),
              Pet: (
                <PawPrint
                  className="@min-[480px]:hidden h-[20px] w-[20px]"
                  aria-hidden="true"
                />
              ),
              Achievements: <Trophy className="h-[20px] w-[20px]" aria-hidden="true" />,
              History: <History className="h-[20px] w-[20px]" aria-hidden="true" />,
              "Edit Character": (
                <Wrench className="h-[20px] w-[20px]" aria-hidden="true" />
              ),
              Sharing: <Share2 className="h-[20px] w-[20px]" aria-hidden="true" />,
            }}
            iconOnlyOptions={profileTabs}
            labelClassName={(option) =>
              option === "Dashboard" || option === "Character" || option === "Pet"
                ? "@min-[480px]:not-sr-only"
                : ""
            }
            values={profileTabValues}
            counts={{ Sharing: newInRecruit }}
            listClassName="w-full flex-nowrap justify-start gap-[4px]"
            itemClassName={(option) =>
              `shrink-0 w-[min(44px,calc((100cqw_-_24px)/7))] ${option === "Pet" ? "mr-auto" : "mr-0"} ${option === "Dashboard" || option === "Character" || option === "Pet" ? "@min-[480px]:w-auto" : ""}`
            }
            className="min-h-[44px] w-full min-w-0 @min-[480px]:px-[12px] px-0 text-base"
          />
        </div>
        <TabsContent value="dashboard">
          <ContentBox padding={false}>
            <ProfileDashboard settings={dashboardSettings} />
          </ContentBox>
        </TabsContent>
        <TabsContent value="character">
          <CharacterProfile />
        </TabsContent>
        <TabsContent value="pet">
          <Suspense fallback={<Loader explanation="Loading your companion..." />}>
            <PetProfile />
          </Suspense>
        </TabsContent>
        <TabsContent value="achievements">
          <ContentBox title="Achievements" padding={false}>
            <div className="p-3">
              <LogbookAchievements />
            </div>
          </ContentBox>
        </TabsContent>
        <TabsContent value="history">
          <ContentBox title="History" padding={false}>
            <ProfileHistory />
          </ContentBox>
        </TabsContent>
        <TabsContent value="edit">
          <Suspense fallback={<Loader explanation="Loading character settings..." />}>
            <ProfileEdit />
          </Suspense>
        </TabsContent>
        <TabsContent value="sharing">
          <Suspense fallback={<Loader explanation="Loading sharing..." />}>
            <ProfileSharing />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CharacterProfile() {
  // State
  const { data: userData, timeDiff } = useRequiredUserData();
  const [pvpInfoModal, setPvpInfoModal] = useState<"rank" | "experience" | null>(null);

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

  const equippedSageMode = userData.sageMode;
  const loyaltyDays = getVillageLoyaltyDays(userData);
  const activeLoyaltyTiers = VILLAGE_LOYALTY_TIERS.filter(
    (tier) => loyaltyDays >= tier.days,
  );
  const nextLoyaltyTier = VILLAGE_LOYALTY_TIERS.find((tier) => loyaltyDays < tier.days);

  return (
    <>
      <ContentBox title="Profile" subtitle="An overview of basic information">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <b>General</b>
            <p>
              Lvl. {userData.level} {showUserRank(userData)}
            </p>
            <p>Money: {userData.money?.toLocaleString()}</p>
            <p>Bank: {userData.bank?.toLocaleString()}</p>
            <p>Status: {userData.status}</p>
            <p>
              Regen per minute: {userData.regeneration?.toFixed(2)} (
              <RegenerationCountdown
                key={userData.regenAt.getTime()}
                regenAt={userData.regenAt}
                timeDiff={timeDiff}
              />
              )
            </p>
            <p>Gender: {userData.gender}</p>
          </div>
          <div className="flex flex-col items-start">
            <b>Activity</b>
            <p>Exp: {userData.experience?.toLocaleString()}</p>
            {userData.rank === "ELITE JONIN" ? (
              <p>Level progression: Academy milestones</p>
            ) : (
              <p>Exp for lvl: {expRequired ? expRequired.toFixed(2) : "--"}</p>
            )}
            <p>PvE Fights: {userData.pveFights}</p>
            <p>PvP Fights: {userData.pvpFights}</p>
            <p>PvP Streak: {userData.pvpStreak}</p>
            {/* The profile owner uses the same display preference as public viewers. */}
            {userData.showPvpRecord && (
              <>
                <p>PvP Wins: {userData.pvpWins}</p>
                <p>PvP Losses: {userData.pvpLosses}</p>
                <p>
                  PvP Win Rate:{" "}
                  {userData.pvpWins + userData.pvpLosses > 0
                    ? (
                        (userData.pvpWins / (userData.pvpWins + userData.pvpLosses)) *
                        100
                      ).toFixed(1)
                    : "0"}
                  %
                </p>
              </>
            )}
            <button
              type="button"
              className="flex items-center gap-1 text-left underline decoration-dotted underline-offset-4"
              onClick={() => setPvpInfoModal("experience")}
            >
              PvP XP:{" "}
              {userData.pvpExperience.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              (+{userData.pvpBoost?.totalPercent ?? 0}%) <Info className="h-4 w-4" />
            </button>
            {topPlayers && (
              <TooltipProvider delayDuration={50}>
                <div className="flex flex-row items-center gap-1">
                  <p>PvP Rank: {getRankedRank(userData.rankedLp, topPlayers)}</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="PvP rank details"
                        onClick={() => setPvpInfoModal("rank")}
                      >
                        <Info className="mb-1 h-4 w-4 shrink-0" />
                      </button>
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
                </div>
              </TooltipProvider>
            )}
            <p>Medical Exp: {userData.medicalExperience?.toLocaleString()}</p>
          </div>
          <div>
            <b>Reputation</b>
            <p>Reputation points: {userData.reputationPoints?.toLocaleString()}</p>
            <p>Seichi Silver: {userData.seichiSilver.toLocaleString()}</p>
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
            {!userData.isOutlaw && userData.villageId && (
              <div className="flex items-center gap-1">
                <span>
                  Village loyalty: {loyaltyDays} day{loyaltyDays === 1 ? "" : "s"} (
                  {activeLoyaltyTiers.length}/{VILLAGE_LOYALTY_TIERS.length} bonuses)
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Village loyalty details"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[360px] max-w-[90vw]">
                    <p className="font-semibold">Village loyalty</p>
                    <p className="mb-2 text-muted-foreground text-sm">
                      Bonuses stack while you remain in your village and reset when you
                      leave your village.
                    </p>
                    <ul className="space-y-1 text-sm">
                      {VILLAGE_LOYALTY_TIERS.map((tier) => (
                        <li
                          key={`${tier.days}-${tier.bonus}`}
                          className={
                            loyaltyDays >= tier.days
                              ? "text-green-600 dark:text-green-400"
                              : "text-muted-foreground"
                          }
                        >
                          {tier.days} days: {getVillageLoyaltyTierDescription(tier)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-sm">
                      {nextLoyaltyTier
                        ? `${nextLoyaltyTier.days - loyaltyDays} day${nextLoyaltyTier.days - loyaltyDays === 1 ? "" : "s"} until the next bonus.`
                        : "All loyalty bonuses are active."}
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
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
            <p>
              Sage Mode:{" "}
              {equippedSageMode ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="cursor-pointer font-bold hover:text-orange-500"
                    >
                      {equippedSageMode.name}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[500px] max-w-[90vw]">
                    <ItemWithEffects item={equippedSageMode} />
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
              Sage Mode Rank:{" "}
              {capitalizeFirstLetter(
                getSageMasteryDisplayRank(
                  userData.sageMasteryExperience ?? 0,
                  !!userData.sageModeId,
                ),
              )}
            </p>
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

      <Modal
        title="PvP experience & boost"
        isOpen={pvpInfoModal === "experience"}
        setIsOpen={(open) => setPvpInfoModal(open ? "experience" : null)}
      >
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3">
            <p>
              PvP experience:{" "}
              <b>
                {userData.pvpExperience.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </b>
            </p>
            <p>
              Global average:{" "}
              <b>
                {userData.pvpBoost?.average.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                }) ?? 0}
              </b>
            </p>
            <p>
              Base boost: <b>+{userData.pvpBoost?.basePercent ?? 0}%</b>
            </p>
            <p>
              Weekly kills: <b>{userData.pvpBoost?.weeklyKills ?? 0}</b>
            </p>
            <p>
              Weekly bonus: <b>+{userData.pvpBoost?.weeklyPercent ?? 0}%</b>
            </p>
            <p>
              Total boost: <b>+{userData.pvpBoost?.totalPercent ?? 0}%</b>
            </p>
          </div>
          <p>
            Earn {PVP_EXPERIENCE_PARTICIPATION_REWARD} PvP XP for a match, plus{" "}
            {PVP_EXPERIENCE_WIN_REWARD} for winning. Repeated opponents give diminishing
            XP. Sparring, AI battles and fleeing give none. Open-world combat against
            your own village gives no PvP XP or weekly kill credit outside the war-torn
            sector.
          </p>
          <p>
            Each eligible kill adds {PVP_WEEKLY_KILL_BOOST}% to your boost, up to +
            {PVP_WEEKLY_KILL_BOOST_CAP}%. The kill bonus resets on Monday at 00:00 UTC.
            PvP XP decays by {PVP_EXPERIENCE_DAILY_DECAY * 100}% at the daily reset.
          </p>
          <div className="space-y-1">
            <p className="font-bold">Base boost tiers</p>
            <p>
              Below {PVP_EXPERIENCE_BOOST_TIERS[3].ratio * 100}% of average: no base
              boost
            </p>
            {[...PVP_EXPERIENCE_BOOST_TIERS].reverse().map((tier) => (
              <p key={tier.ratio}>
                At least {tier.ratio * 100}% of average: +{tier.percent}%
              </p>
            ))}
            <p>No base boost until you have PvP XP and the average is above zero.</p>
          </div>
          <p>
            Boosts training, mastery, missions, ryo rewards, errands, village prestige,
            crafting/hunting/gathering XP, village tokens, clan points and regeneration.
          </p>
        </div>
      </Modal>

      {topPlayers && (
        <Modal
          title="PvP rank"
          className="md:!max-w-[17rem] w-full max-w-[min(17rem,calc(100%-2rem))] gap-2 p-4"
          centerText
          isOpen={pvpInfoModal === "rank"}
          setIsOpen={(open) => setPvpInfoModal(open ? "rank" : null)}
        >
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Rank:</span>{" "}
              {getRankedRank(userData.rankedLp, topPlayers)}
            </p>
            <p>
              <span className="text-muted-foreground">LP:</span> {userData.rankedLp}
            </p>
            <p>
              <span className="text-muted-foreground">Battles:</span>{" "}
              {userData.rankedBattles}
            </p>
            <p>
              <span className="text-muted-foreground">Wins:</span> {userData.rankedWins}
            </p>
            <p>
              <span className="text-muted-foreground">Win rate:</span>{" "}
              {userData.rankedBattles > 0
                ? ((userData.rankedWins / userData.rankedBattles) * 100).toFixed(1)
                : "0"}
              %
            </p>
            <p>
              <span className="text-muted-foreground">Current streak:</span>{" "}
              {userData.rankedStreak}
            </p>
            <p>
              <span className="text-muted-foreground">Seichi Silver:</span>{" "}
              {userData.seichiSilver}
            </p>
          </div>
        </Modal>
      )}

      <StrengthWeaknesses />
      {isTutorialActive(userData) && <Logbook />}
    </>
  );
}

function ProfileHistory() {
  const [tab, setTab] = useState<"Quests" | "Battles" | null>(null);
  return (
    <div>
      <div className="flex justify-end border-b px-3">
        <NavTabs
          id="profileHistoryTab"
          current={tab}
          options={["Battles", "Quests"]}
          onChange={(value) => setTab(value === "Quests" ? "Quests" : "Battles")}
          className="min-h-11 px-3"
        />
      </div>
      <QuestTeams compact />
      {tab === "Quests" ? <LogbookHistory /> : <LogbookBattles />}
    </div>
  );
}

function RegenerationCountdown({
  regenAt,
  timeDiff,
}: {
  regenAt: Date;
  timeDiff: number;
}) {
  const nextTick = () => nextRegenerationTickAt(regenAt, timeDiff);
  const [targetDate, setTargetDate] = useState(nextTick);
  return (
    <Countdown
      targetDate={targetDate}
      timeDiff={timeDiff}
      onFinish={() => setTargetDate(nextTick())}
    />
  );
}

const ProfileEdit = lazy(() =>
  import("@/layout/ProfileEdit").then((module) => ({ default: module.ProfileEdit })),
);
const PetProfile = lazy(() =>
  import("@/layout/PetProfile").then((module) => ({ default: module.PetProfile })),
);
const ProfileSharing = lazy(() =>
  import("@/layout/ProfileSharing").then((module) => ({
    default: module.ProfileSharing,
  })),
);
