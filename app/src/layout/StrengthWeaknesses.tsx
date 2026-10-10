"use client";

import { Chart as ChartJS } from "chart.js/auto";
import { CircleHelp, Eye, Leaf, Lock, Search } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import type { MasteryType } from "@/drizzle/constants";
import {
  CombatStatNames,
  getUserCaps,
  MasteryNames,
  STEALTH_SENSORY_CAP,
  STEALTH_SENSORY_DEFAULT,
  STEALTH_TRAIN_GAIN_PER_MINUTE,
  TOTAL_MASTERY_CAP,
  UserRolesWithSkillTreeAccess,
} from "@/drizzle/constants";
import { Bloodright } from "@/layout/Bloodright";
import ContentBox from "@/layout/ContentBox";
import ElementImage from "@/layout/ElementImage";
import NavTabs from "@/layout/NavTabs";
import SkillTreeFolderGrid from "@/layout/SkillTreeFolderGrid";
import SkillTreeFolderModal from "@/layout/SkillTreeFolderModal";
import { getMasteryRank, masteryTotal } from "@/libs/masteryProgression";
import { withCappedStats } from "@/libs/profile";
import { getSageMasteryDisplayRank } from "@/libs/sageMode";
import { getStealthStatus } from "@/libs/stealth";
import { getEffectiveThemeTextColor } from "@/libs/themePreference";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { useActiveLayout } from "@/utils/LayoutContext";
import { canAccessHiddenSkillTree } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import { getUserElements } from "@/validators/user";

// Main StrengthWeaknesses Component
const StrengthWeaknesses: React.FC = () => {
  // Nav tabs
  const tabOptions = ["Stats", "Graphs", "Skills", "Bloodright", "Covert"];

  // State
  type TabOptions = (typeof tabOptions)[number];
  const { data: storedUserData } = useRequiredUserData();
  const [currentTab, setCurrentTab] = useState<TabOptions>("Graphs");

  // Show rank-capped stats from a copy; the cached user keeps its stored values
  const userData = storedUserData ? withCappedStats(storedUserData) : undefined;

  // Render info button for Stats and Graphs tabs
  const renderInfoButton = () => (
    <Popover>
      <PopoverTrigger>
        <CircleHelp className="h-6 w-6" />
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex flex-col gap-2 text-xs">
          <div>
            <p className="font-bold">Stats Explained</p>
            <p className="italic">
              Your stats influence how strong your character is overall
            </p>
          </div>
          <ul>
            <li>
              <b>Strength:</b> physical strength
            </li>
            <li>
              <b>Intelligence:</b> mental strength
            </li>
            <li>
              <b>Speed:</b> movement speed
            </li>
            <li>
              <b>Willpower:</b> mental resistance
            </li>
          </ul>
          <ul>
            <li>
              <b>Offence:</b> how hard your attacks hit
            </li>
            <li>
              <b>Defence:</b> how well you resist incoming damage
            </li>
          </ul>
          <ul>
            <li>
              <b>Masteries:</b> unlock jutsu, items, and armor. They do not deal damage
              or grant experience.
            </li>
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );

  if (!userData) return null;

  return (
    <ContentBox
      id="tutorial-strength-weaknesses"
      title="User Stats"
      subtitle="Strengths & Weaknesses"
      topRightCorntentBreakpoint="sm"
      topRightContent={
        <div className="my-2 flex items-center gap-3">
          <NavTabs
            id="strength-weaknesses-tabs"
            current={currentTab}
            options={tabOptions}
            setValue={setCurrentTab}
          />
          {(currentTab === "Stats" || currentTab === "Graphs") && renderInfoButton()}
        </div>
      }
      initialBreak={true}
    >
      {currentTab === "Stats" && userData && <StatsTab userData={userData} />}
      {currentTab === "Graphs" && userData && <GraphsTab userData={userData} />}
      {currentTab === "Skills" && userData && <SkillsTab userData={userData} />}
      {currentTab === "Bloodright" && <Bloodright />}
      {currentTab === "Covert" && userData && <CovertTab userData={userData} />}
    </ContentBox>
  );
};

// StatsTab Component
interface StatsTabProps {
  userData: NonNullable<UserWithRelations>;
}

export const StatsTab: React.FC<StatsTabProps> = ({ userData }) => {
  const userElements = getUserElements(userData);
  const masteries = userData.effectiveMasteries ?? userData;

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-3">
        <div>
          <b>Combat</b>
          <div className="flex flex-row items-center">
            <ElementImage element="offensiveStance" className="mr-1 mb-1 h-6 w-6" />
            Offence: {Number((userData.offence ?? 0).toFixed(2)).toLocaleString()}
          </div>
          <div className="flex flex-row items-center">
            <ElementImage element="defensiveStance" className="mr-1 mb-1 h-6 w-6" />
            Defence: {Number((userData.defence ?? 0).toFixed(2)).toLocaleString()}
          </div>
        </div>
        <div>
          <b>Generals</b>
          <div className="flex flex-row items-center">
            <ElementImage element="Strength" className="mr-1 mb-1 h-6 w-6" />
            Strength: {Number((userData.strength ?? 0).toFixed(2)).toLocaleString()}
          </div>
          <div className="flex flex-row items-center">
            <ElementImage element="Intelligence" className="mr-1 mb-1 h-6 w-6" />
            Intelligence:{" "}
            {Number((userData.intelligence ?? 0).toFixed(2)).toLocaleString()}
          </div>
          <div className="flex flex-row items-center">
            <ElementImage element="Willpower" className="mr-1 mb-1 h-6 w-6" />
            Willpower: {Number((userData.willpower ?? 0).toFixed(2)).toLocaleString()}
          </div>
          <div className="flex flex-row items-center">
            <ElementImage element="Speed" className="mr-1 mb-1 h-6 w-6" />
            Speed: {Number((userData.speed ?? 0).toFixed(2)).toLocaleString()}
          </div>
        </div>
        <div>
          <b>Elemental Proficiency</b>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {userElements.map((element, i) => (
              <div key={`${element}-${i}`} className="flex flex-row pt-1">
                <ElementImage element={element} className="w-6" />
                <p className="pl-2">{element}</p>
              </div>
            ))}
          </div>
          {userElements.length === 0 && (
            <>
              <p>- 1st element at Genin</p>
              <p>- 2nd element at Chunin</p>
            </>
          )}
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <b>Masteries</b>
          <p className="text-muted-foreground text-xs">
            Earned total: {masteryTotal(userData).toLocaleString()} /{" "}
            {TOTAL_MASTERY_CAP.toLocaleString()}
          </p>
          {MasteryNames.map((name) => {
            const label =
              name.charAt(0).toUpperCase() + name.slice(1).replace("Mastery", "");
            const bonus = masteries[name] - userData[name];
            return (
              <div key={name} className="flex flex-wrap items-center">
                <ElementImage
                  element={label as MasteryType}
                  className="mr-1 mb-1 h-6 w-6"
                />
                {label} ({getMasteryRank(userData, name)}):{" "}
                {Number(userData[name].toFixed(2)).toLocaleString()}
                {bonus !== 0 && (
                  <span
                    className="ml-1 text-muted-foreground"
                    title="Equipment, bloodline and skill modifiers; total used for mastery requirements"
                  >
                    ({bonus > 0 ? "+" : ""}
                    {Number(bonus.toFixed(2)).toLocaleString()})
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div>
          <b>Sage Mode</b>
          <div className="flex flex-row items-center">
            <Leaf className="mr-1 mb-1 h-6 w-6" />
            Rank:{" "}
            {getSageMasteryDisplayRank(
              userData.sageMasteryExperience ?? 0,
              !!userData.sageModeId,
            )}{" "}
            ({(userData.sageMasteryExperience ?? 0).toLocaleString()} XP)
          </div>
        </div>
      </div>
    </div>
  );
};

// GraphsTab Component
interface GraphsTabProps {
  userData: NonNullable<UserWithRelations>;
}

export const GraphsTab: React.FC<GraphsTabProps> = ({ userData }) => {
  const masteryChartRef = useRef<HTMLCanvasElement>(null);
  const combatChartRef = useRef<HTMLCanvasElement>(null);
  const userElements = getUserElements(userData);
  const activeLayout = useActiveLayout();
  const { stats_cap, mastery_cap } = getUserCaps(userData.rank);

  useEffect(() => {
    const masteries = userData.effectiveMasteries ?? userData;
    const masteryCtx = masteryChartRef?.current?.getContext("2d");
    const combatCtx = combatChartRef?.current?.getContext("2d");
    if (masteryCtx && combatCtx && userData) {
      // Mastery distribution
      const chartTextColor = getEffectiveThemeTextColor(activeLayout);
      ChartJS.defaults.color = chartTextColor;
      const masteryChart = new ChartJS(masteryCtx, {
        type: "radar",
        options: {
          maintainAspectRatio: false,
          aspectRatio: 1.4,
          responsive: true,
          elements: {
            line: {
              borderWidth: 3,
            },
          },
          scales: {
            r: {
              angleLines: { color: "rgba(148, 163, 184, 0.35)", display: true },
              grid: { color: "rgba(148, 163, 184, 0.25)" },
              pointLabels: { color: chartTextColor, font: { size: 11 } },
              ticks: {
                backdropColor: "rgba(99, 255, 132, 0.0)",
                color: chartTextColor,
                maxTicksLimit: 4,
              },
              min: 0,
            },
          },
          plugins: {
            legend: {
              display: false,
            },
          },
        },
        data: {
          labels: MasteryNames.map(
            (stat) =>
              stat.charAt(0).toUpperCase() + stat.slice(1).replace("Mastery", ""),
          ),
          datasets: [
            {
              label: "Value",
              data: MasteryNames.map((stat) => masteries[stat]),
              fill: true,
              backgroundColor: "rgba(255, 99, 132, 0.2)",
              borderColor: "rgb(255, 99, 132)",
              pointBackgroundColor: "rgb(255, 99, 132)",
              pointBorderColor: "#fff",
              pointHoverBackgroundColor: "#fff",
              pointHoverBorderColor: "rgb(255, 99, 132)",
            },
          ],
        },
      });
      // Combat stat comparison
      const combatChart = new ChartJS(combatCtx, {
        type: "bar",
        options: {
          maintainAspectRatio: false,
          responsive: true,
          indexAxis: "y",
          scales: {
            x: {
              beginAtZero: true,
              ticks: { color: chartTextColor, maxTicksLimit: 4 },
              grid: { color: "rgba(148, 163, 184, 0.16)" },
            },
            y: {
              ticks: { color: chartTextColor },
              grid: { display: false },
            },
          },
          plugins: {
            legend: {
              display: false,
            },
          },
        },
        data: {
          labels: CombatStatNames.map(
            (stat) => stat.charAt(0).toUpperCase() + stat.slice(1),
          ),
          datasets: [
            {
              label: "Stat",
              data: CombatStatNames.map((stat) => userData[stat]),
              backgroundColor: "rgba(75, 192, 192, 0.5)",
              borderColor: "rgb(75, 192, 192)",
              borderWidth: 1,
              borderRadius: 4,
              maxBarThickness: 24,
            },
          ],
        },
      });
      // Remove on unmount
      return () => {
        masteryChart.destroy();
        combatChart.destroy();
      };
    }
  }, [activeLayout, userData]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <section className="min-w-0 rounded-lg border bg-background/40 p-3">
        <h3 className="font-bold">Combat stats</h3>
        <p className="text-muted-foreground text-xs">Offence, Defence and Generals</p>
        <div className="relative my-3 h-64">
          <canvas
            ref={combatChartRef}
            id="combatChartRef"
            role="img"
            aria-label="Combat stat comparison"
          />
        </div>
        <p className="mt-3 border-t pt-2 text-muted-foreground text-xs">
          Rank cap: {stats_cap.toLocaleString()} per stat
        </p>
      </section>
      <section className="min-w-0 rounded-lg border bg-background/40 p-3">
        <h3 className="font-bold">Masteries</h3>
        <p className="text-muted-foreground text-xs">
          Includes equipment, bloodline and skill modifiers; does not affect damage
        </p>
        <div className="relative my-3 h-64">
          <canvas
            ref={masteryChartRef}
            id="masteryChartRef"
            role="img"
            aria-label="Mastery distribution"
          />
        </div>
        <p className="mt-3 border-t pt-2 text-muted-foreground text-xs">
          Maximum: {mastery_cap.toLocaleString()} per mastery ·{" "}
          {TOTAL_MASTERY_CAP.toLocaleString()} earned total
        </p>
      </section>
      <p className="text-muted-foreground text-xs sm:col-span-2">
        Chart axes scale to your current stats, rather than the rank cap.
      </p>
      <section className="rounded-lg border bg-background/40 p-3 sm:col-span-2">
        <h3 className="font-bold">Elemental Proficiency</h3>
        <div className="flex flex-wrap gap-4 pt-2">
          {userElements.map((element) => (
            <div key={element} className="flex items-center gap-2 text-sm">
              <ElementImage element={element} className="w-8" />
              <span>{element}</span>
            </div>
          ))}
        </div>
        {userElements.length === 0 && (
          <p className="text-muted-foreground text-sm">
            First element unlocks at Genin; second at Chunin.
          </p>
        )}
      </section>
    </div>
  );
};

// SkillsTab Component
interface SkillsTabProps {
  userData: NonNullable<UserWithRelations>;
}

export const SkillsTab: React.FC<SkillsTabProps> = ({ userData }) => {
  const includeHidden = canAccessHiddenSkillTree(userData.role);
  // State for folder UI
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEffects, setSelectedEffects] = useState<string[]>([]);

  // Get tRPC utils
  const utils = api.useUtils();

  // Skill Tree Queries - only run when this component is mounted
  const { data: allSkills } = api.skillTree.getAll.useQuery(
    { limit: 500 },
    { enabled: !!userData },
  );

  const { data: userSkills } = api.skillTree.getUserSkills.useQuery(undefined, {
    enabled: !!userData,
  });

  const { data: folders } = api.skillTree.getAllFolders.useQuery(
    { includeHidden },
    { enabled: !!userData },
  );

  const { data: folderStats } = api.skillTree.getFolderStats.useQuery(undefined, {
    enabled: !!userData,
  });

  // Skill Tree Mutations
  const { mutate: purchaseSkill, isPending: isPurchasing } =
    api.skillTree.purchaseSkill.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.skillTree.getUserSkills.invalidate(),
            utils.skillTree.getAll.invalidate(),
            utils.skillTree.getFolderStats.invalidate(),
            utils.profile.getUser.invalidate(),
          ]);
        }
      },
    });

  // Skill tree derived data
  const allSkillsData = allSkills?.data ?? [];
  const ownedSkills = userSkills?.skills ?? [];
  const activatedSkillCount = userSkills?.activatedSkillCount ?? 0;
  const totalSkillPoints = userData?.skillPoints || 0;
  const usedSkillPoints = userSkills?.usedSkillPoints ?? 0;

  // Get selected folder
  const selectedFolder = folders?.find((f) => f.id === selectedFolderId) ?? null;

  // Handle folder click
  const handleFolderClick = (folderId: string) => {
    setSelectedFolderId(folderId);
    setIsModalOpen(true);
  };

  // Handle folder navigation (from prereq links)
  const handleNavigateToFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
  };

  // Check if user has chunin+ rank to access skill tree
  const hasSkillTreeAccess =
    userData && UserRolesWithSkillTreeAccess.includes(userData.rank);

  if (!hasSkillTreeAccess) {
    return (
      <div className="py-8 text-center">
        <Lock className="mx-auto mb-4 h-16 w-16" />
        <h3 className="mb-2 font-semibold text-xl">Skill Tree Locked</h3>
        <div className="text-gray-600">
          Reach <Badge variant="secondary">Chunin</Badge> rank to unlock the skill tree
          and start earning skill points!
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Skill Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center dark:border-green-800 dark:bg-green-950/30">
          <div className="font-bold text-2xl text-green-600 dark:text-green-400">
            {activatedSkillCount}
          </div>
          <div className="text-green-700 text-sm dark:text-green-300">
            Skills Activated
          </div>
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center dark:border-blue-800 dark:bg-blue-950/30">
          <div className="font-bold text-2xl text-blue-600 dark:text-blue-400">
            {totalSkillPoints}
          </div>
          <div className="text-blue-700 text-sm dark:text-blue-300">
            Total Skill Points
          </div>
        </div>

        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-center dark:border-yellow-800 dark:bg-yellow-950/30">
          <div className="font-bold text-2xl text-yellow-600 dark:text-yellow-400">
            {totalSkillPoints - usedSkillPoints}
          </div>
          <div className="text-sm text-yellow-700 dark:text-yellow-300">
            Available SP
          </div>
        </div>
      </div>

      {/* Skill Tree Folder Grid */}
      <div className="mb-6">
        <SkillTreeFolderGrid
          folders={folders ?? []}
          folderStats={folderStats ?? []}
          allSkills={allSkillsData}
          onFolderClick={handleFolderClick}
          selectedEffects={selectedEffects}
          onEffectsChange={setSelectedEffects}
        />
      </div>

      {/* Folder Modal */}
      <SkillTreeFolderModal
        includeHidden={includeHidden}
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        folder={selectedFolder}
        folders={folders ?? []}
        allSkills={allSkillsData}
        userSkills={ownedSkills}
        activatedSkillIds={userSkills?.activatedSkillIds ?? []}
        userSkillPoints={totalSkillPoints - usedSkillPoints}
        onPurchaseSkill={(skillId) => purchaseSkill({ skillId })}
        onNavigateToFolder={handleNavigateToFolder}
        selectedEffects={selectedEffects}
        isPurchasing={isPurchasing}
      />
    </>
  );
};

// CovertTab Component - For displaying Stealth and Sensory stats
interface CovertTabProps {
  userData: NonNullable<UserWithRelations>;
}

export const CovertTab: React.FC<CovertTabProps> = ({ userData }) => {
  const { timeDiff } = useRequiredUserData();

  // Stealth status derived from userData
  const stealthStatus = getStealthStatus(
    userData,
    STEALTH_SENSORY_CAP,
    STEALTH_TRAIN_GAIN_PER_MINUTE,
    timeDiff,
  );

  const stealthProgress =
    ((stealthStatus?.stealth ?? STEALTH_SENSORY_DEFAULT) / STEALTH_SENSORY_CAP) * 100;
  const sensoryProgress =
    ((stealthStatus?.sensory ?? STEALTH_SENSORY_DEFAULT) / STEALTH_SENSORY_CAP) * 100;

  return (
    <div className="space-y-6">
      {/* Stealth Section */}
      <div className="rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-5 w-5 text-purple-600" />
          <h3 className="font-bold text-lg">Stealth</h3>
        </div>
        <div className="mb-1 flex justify-between">
          <span className="text-sm">Progress</span>
          <span className="font-medium text-sm">
            {Math.floor(
              stealthStatus?.stealth ?? STEALTH_SENSORY_DEFAULT,
            ).toLocaleString()}{" "}
            / {STEALTH_SENSORY_CAP.toLocaleString()}
          </span>
        </div>
        <Progress value={stealthProgress} className="h-2" />
        <div className="mt-3 space-y-1 text-muted-foreground text-sm">
          <p>
            Duration: {Math.floor((stealthStatus?.stealthDurationMax ?? 60) / 60)} min
          </p>
          <p>Keep Chance: {(stealthStatus?.stealthKeepChance ?? 5).toFixed(1)}%</p>
        </div>
      </div>

      {/* Sensory Section */}
      <div className="rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-5 w-5 text-blue-600" />
          <h3 className="font-bold text-lg">Sensory</h3>
        </div>
        <div className="mb-1 flex justify-between">
          <span className="text-sm">Progress</span>
          <span className="font-medium text-sm">
            {Math.floor(
              stealthStatus?.sensory ?? STEALTH_SENSORY_DEFAULT,
            ).toLocaleString()}{" "}
            / {STEALTH_SENSORY_CAP.toLocaleString()}
          </span>
        </div>
        <Progress value={sensoryProgress} className="h-2" />
        <div className="mt-3 space-y-1 text-muted-foreground text-sm">
          <p>
            Detection Chance: {(stealthStatus?.sensoryDetectChance ?? 5).toFixed(1)}%
          </p>
          <p>Cooldown: {Math.floor(stealthStatus?.sensoryCooldown ?? 120)} sec</p>
        </div>
      </div>

      {/* Training Link */}
    </div>
  );
};

export default StrengthWeaknesses;
