"use client";

import React, { useEffect, useState, useRef } from "react";
import ContentBox from "@/layout/ContentBox";
import NavTabs from "@/layout/NavTabs";
import ElementImage from "@/layout/ElementImage";
import SkillTreeGraph from "@/layout/SkillTreeGraph";
import Countdown from "@/layout/Countdown";
import { CircleHelp, Eye, Lock, Search, Timer, XCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  UserRolesWithSkillTreeAccess,
  STEALTH_SENSORY_CAP,
  STEALTH_SENSORY_DEFAULT,
} from "@/drizzle/constants";
import { capUserStats } from "@/libs/profile";
import { useRequiredUserData } from "@/utils/UserContext";
import { Chart as ChartJS } from "chart.js/auto";
import { safeLocalStorageGetItem } from "@/hooks/localstorage";
import { getUserElements } from "@/validators/user";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { getStealthStatus } from "@/libs/stealth";
import { STEALTH_TRAIN_GAIN_PER_MINUTE } from "@/drizzle/constants";
import type { UserWithRelations } from "@/routers/profile";

// Main StrengthWeaknesses Component
const StrengthWeaknesses: React.FC = () => {
  // Nav tabs
  const tabOptions = ["Stats", "Graphs", "Skills", "Covert"];

  // State
  type TabOptions = (typeof tabOptions)[number];
  const { data: userData } = useRequiredUserData();
  const [currentTab, setCurrentTab] = useState<TabOptions>("Graphs");

  // Implement stats cap
  if (userData) capUserStats(userData);

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
              <b>Ninjutsu:</b> Ninja techniques infused with chakra
            </li>
            <li>
              <b>Genjutsu:</b> Illusions and mental techniques
            </li>
            <li>
              <b>Taijutsu:</b> Physical combat techniques
            </li>
            <li>
              <b>Bukijutsu:</b> Proficiency with weapons
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
      topRightContent={
        <div className="flex items-center gap-3">
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

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <b>Offences</b>
          <div className="flex flex-row items-center">
            <ElementImage element="Ninjutsu" className="w-6 h-6 mr-1 mb-1" />
            Ninjutsu offence: {Number(userData.ninjutsuOffence.toFixed(2)).toLocaleString()}
          </div>
          <div className="flex flex-row items-center">
            <ElementImage element="Genjutsu" className="w-6 h-6 mr-1 mb-1" />
            Genjutsu offence: {Number(userData.genjutsuOffence.toFixed(2)).toLocaleString()}
          </div>
          <div className="flex flex-row items-center">
            <ElementImage element="Taijutsu" className="w-6 h-6 mr-1 mb-1" />
            Taijutsu offence: {Number(userData.taijutsuOffence.toFixed(2)).toLocaleString()}
          </div>
          <div className="flex flex-row items-center">
            <ElementImage element="Bukijutsu" className="w-6 h-6 mr-1 mb-1" />
            Bukijutsu offence: {Number(userData.bukijutsuOffence.toFixed(2)).toLocaleString()}
          </div>
        </div>

        <div>
          <b>Defences</b>
          <div className="flex flex-row items-center">
            <ElementImage element="Ninjutsu" className="w-6 h-6 mr-1 mb-1" />
            Ninjutsu defence: {Number(userData.ninjutsuDefence.toFixed(2)).toLocaleString()}
          </div>
          <div className="flex flex-row items-center">
            <ElementImage element="Genjutsu" className="w-6 h-6 mr-1 mb-1" />
            Genjutsu defence: {Number(userData.genjutsuDefence.toFixed(2)).toLocaleString()}
          </div>
          <div className="flex flex-row items-center">
            <ElementImage element="Taijutsu" className="w-6 h-6 mr-1 mb-1" />
            Taijutsu defence: {Number(userData.taijutsuDefence.toFixed(2)).toLocaleString()}
          </div>
          <div className="flex flex-row items-center">
            <ElementImage element="Bukijutsu" className="w-6 h-6 mr-1 mb-1" />
            Bukijutsu defence: {Number(userData.bukijutsuDefence.toFixed(2)).toLocaleString()}
          </div>
        </div>
      </div>
      <div className="pt-2">
        <div className="grid grid-cols-2">
          <div>
            <b>Generals</b>
            <div className="flex flex-row items-center">
              <ElementImage element="Strength" className="w-6 h-6 mr-1 mb-1" />
              Strength: {Number(userData.strength.toFixed(2)).toLocaleString()}
            </div>
            <div className="flex flex-row items-center">
              <ElementImage element="Intelligence" className="w-6 h-6 mr-1 mb-1" />
              Intelligence: {Number(userData.intelligence.toFixed(2)).toLocaleString()}
            </div>
            <div className="flex flex-row items-center">
              <ElementImage element="Willpower" className="w-6 h-6 mr-1 mb-1" />
              Willpower: {Number(userData.willpower.toFixed(2)).toLocaleString()}
            </div>
            <div className="flex flex-row items-center">
              <ElementImage element="Speed" className="w-6 h-6 mr-1 mb-1" />
              Speed: {Number(userData.speed.toFixed(2)).toLocaleString()}
            </div>
          </div>
          <div>
            <b>Elemental Proficiency</b>
            <div className="grid grid-cols-2 gap-1">
              {userElements.map((element) => (
                <div key={element} className="flex flex-row pt-1">
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
      </div>
    </>
  );
};

// GraphsTab Component
interface GraphsTabProps {
  userData: NonNullable<UserWithRelations>;
}

export const GraphsTab: React.FC<GraphsTabProps> = ({ userData }) => {
  const statsChart = useRef<HTMLCanvasElement>(null);
  const generalsChart = useRef<HTMLCanvasElement>(null);
  const userElements = getUserElements(userData);

  useEffect(() => {
    const statsCtx = statsChart?.current?.getContext("2d");
    const generalsCtx = generalsChart?.current?.getContext("2d");
    if (statsCtx && generalsCtx && userData) {
      // Update stats chart
      const localTheme = safeLocalStorageGetItem("theme");
      ChartJS.defaults.color = localTheme === "dark" ? "#FFFFFF" : "#000000";
      const myStatsChart = new ChartJS(statsCtx, {
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
              angleLines: { display: true },
              ticks: { backdropColor: "rgba(99, 255, 132, 0.0)" },
              suggestedMin: 0,
              backgroundColor: "rgba(99, 255, 132, 0.2)",
            },
          },
          plugins: {
            legend: {
              display: false,
            },
          },
        },
        data: {
          labels: [
            "Nin Off",
            "Gen Off",
            "Tai Off",
            "Buki Off",
            "Nin Def",
            "Gen Def",
            "Tai Def",
            "Buki Def",
          ],
          datasets: [
            {
              label: "Value",
              data: [
                userData.ninjutsuOffence,
                userData.genjutsuOffence,
                userData.taijutsuOffence,
                userData.bukijutsuOffence,
                userData.ninjutsuDefence,
                userData.genjutsuDefence,
                userData.taijutsuDefence,
                userData.bukijutsuDefence,
              ],
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
      // Update stats chart
      const myGeneralsChart = new ChartJS(generalsCtx, {
        type: "bar",
        options: {
          maintainAspectRatio: false,
          responsive: true,
          aspectRatio: 1.1,
          scales: {
            y: {
              beginAtZero: true,
            },
          },
          plugins: {
            legend: {
              display: false,
            },
          },
        },
        data: {
          labels: ["Strength", "Speed", "Intelligence", "Willpower"],
          datasets: [
            {
              data: [
                userData.strength,
                userData.speed,
                userData.intelligence,
                userData.willpower,
              ],
              backgroundColor: [
                "rgba(255, 99, 132, 0.5)",
                "rgba(255, 159, 64, 0.5)",
                "rgba(255, 205, 86, 0.5)",
                "rgba(75, 192, 192, 0.5)",
              ],
              borderColor: [
                "rgb(255, 99, 132)",
                "rgb(255, 159, 64)",
                "rgb(255, 205, 86)",
                "rgb(75, 192, 192)",
              ],
              borderWidth: 1,
            },
          ],
        },
      });
      // Remove on unmount
      return () => {
        myStatsChart.destroy();
        myGeneralsChart.destroy();
      };
    }
  }, [userData]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 pt-3">
      <div>
        <p className="font-bold">Generals</p>
        <div className="relative w-[99%] p-3">
          <canvas ref={generalsChart} id="generalsChart"></canvas>
        </div>
      </div>
      <div>
        <p className="font-bold">Strengths</p>
        <div className="relative w-[99%]">
          <canvas ref={statsChart} id="statsChart"></canvas>
        </div>
        <p className="font-bold pt-2">Elemental Proficiency</p>
        <div className="flex flex-row w-full justify-center gap-2 pt-2">
          {userElements.map((element) => (
            <ElementImage key={element} element={element} className="w-14" />
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
  );
};

// SkillsTab Component
interface SkillsTabProps {
  userData: NonNullable<UserWithRelations>;
}

export const SkillsTab: React.FC<SkillsTabProps> = ({ userData }) => {
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

  // Skill Tree Mutations
  const { mutate: purchaseSkill } = api.skillTree.purchaseSkill.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.skillTree.getUserSkills.invalidate(),
          utils.skillTree.getAll.invalidate(),
          utils.profile.getUser.invalidate(),
        ]);
      }
    },
  });

  // Skill tree derived data
  const allSkillsData = allSkills?.data ?? [];
  const ownedSkills = userSkills || [];
  const activatedSkills = ownedSkills.filter((us) => us.activated);
  const totalSkillPoints = userData?.skillPoints || 0;
  const usedSkillPoints = activatedSkills.reduce(
    (total, userSkill) => total + userSkill.skill.costSkillPoints,
    0,
  );

  // Check if user has chunin+ rank to access skill tree
  const hasSkillTreeAccess =
    userData && UserRolesWithSkillTreeAccess.includes(userData.rank);

  if (!hasSkillTreeAccess) {
    return (
      <div className="text-center py-8">
        <Lock className="h-16 w-16 mx-auto mb-4" />
        <h3 className="text-xl font-semibold mb-2">Skill Tree Locked</h3>
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
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-600">
            {activatedSkills.length}
          </div>
          <div className="text-sm text-green-700">Skills Activated</div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{totalSkillPoints}</div>
          <div className="text-sm text-blue-700">Total Skill Points</div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-yellow-600">{usedSkillPoints}</div>
          <div className="text-sm text-yellow-700">Used Skill Points</div>
        </div>
      </div>

      {/* Skill Tree View */}
      <div className="mb-6">
        <SkillTreeGraph
          skills={allSkillsData}
          userSkills={userSkills}
          userSkillPoints={totalSkillPoints - usedSkillPoints}
          onPurchaseSkill={(skillId) => purchaseSkill({ skillId })}
        />
      </div>
    </>
  );
};

// CovertTab Component - For Stealth and Sensory Training
interface CovertTabProps {
  userData: NonNullable<UserWithRelations>;
}

export const CovertTab: React.FC<CovertTabProps> = ({ userData }) => {
  // tRPC utils for invalidating queries after mutations
  const { timeDiff, updateUser } = useRequiredUserData();

  // Stealth status derived from userData
  const stealthStatus = getStealthStatus(
    userData,
    STEALTH_SENSORY_CAP,
    STEALTH_TRAIN_GAIN_PER_MINUTE,
    timeDiff,
  );

  // Training mutation
  const { mutate: trainCovert, isPending: isTrainingCovert } =
    api.stealth.trainCovert.useMutation({
      onSuccess: async (data, variables) => {
        if (data.success && data.data) {
          // Derive start time from server-provided finish time to avoid clock-skew issues
          const covertTrainingStartedAt = new Date(
            data.data.covertTrainingFinishAt.getTime() - variables.minutes * 60_000,
          );
          await updateUser({
            covertTrainingType: variables.type,
            covertTrainingStartedAt,
            covertTrainingMinutes: variables.minutes,
          });
        } else {
          showMutationToast(data);
        }
      },
    });

  const { mutate: stopTraining, isPending: isStoppingTraining } =
    api.stealth.stopCovertTraining.useMutation({
      onSuccess: async (data) => {        
        if (data.success && data.data) {
          const statUpdate =
            stealthStatus?.covertTrainingType === "stealth"
              ? { stealth: data.data.newValue }
              : { sensory: data.data.newValue };
          await updateUser({
            covertTrainingType: null,
            covertTrainingStartedAt: null,
            covertTrainingMinutes: null,
            ...statUpdate,
          });
        } else {
          showMutationToast(data);
        }
      },
    });

  const { mutate: cancelTraining, isPending: isCancellingTraining } =
    api.stealth.cancelCovertTraining.useMutation({
      onSuccess: async (data) => {
        if (data.success) {
          await updateUser({
            covertTrainingType: null,
            covertTrainingStartedAt: null,
            covertTrainingMinutes: null,
          });
        } else {
          showMutationToast(data);
        }
      },
    });

  const stealthProgress =
    ((stealthStatus?.stealth ?? STEALTH_SENSORY_DEFAULT) / STEALTH_SENSORY_CAP) * 100;
  const sensoryProgress =
    ((stealthStatus?.sensory ?? STEALTH_SENSORY_DEFAULT) / STEALTH_SENSORY_CAP) * 100;

  // Check if currently training
  const isTraining = !!stealthStatus?.covertTrainingType;
  const trainingType = stealthStatus?.covertTrainingType;
  const trainingFinishAt = stealthStatus?.covertTrainingFinishAt;
  const trainingGain = stealthStatus?.covertTrainingGain;

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="text-sm text-gray-600">
        Train your covert operations skills to become more effective at stealth and
        detection.
      </div>

      {/* Training Overlay - shown when training is in progress */}
      {isTraining && trainingFinishAt && (
        <div className="relative border rounded-lg p-6 bg-background">
          <div className="flex flex-col items-center justify-center text-center space-y-4">
            <div className="text-lg font-semibold">
              Training {trainingType === "stealth" ? "Stealth" : "Sensory"}
            </div>
            <div className="text-3xl font-bold">
              <Countdown targetDate={trainingFinishAt} timeDiff={timeDiff} />
            </div>
            {trainingGain && (
              <div className="text-sm text-muted-foreground">
                Expected gain: +{trainingGain.toFixed(0)} points
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => stopTraining()} disabled={isStoppingTraining}>
                {isStoppingTraining ? "Collecting..." : "Collect Reward"}
              </Button>
              <Button
                variant="outline"
                onClick={() => cancelTraining()}
                disabled={isCancellingTraining}
              >
                <XCircle className="h-4 w-4 mr-1" />
                {isCancellingTraining ? "Cancelling..." : "Cancel"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Stealth Section - hidden when training */}
      {!isTraining && (
        <div className="border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="h-5 w-5 text-purple-600" />
            <h3 className="font-bold text-lg">Stealth</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm">Progress</span>
                <span className="text-sm font-medium">
                  {Math.floor(
                    stealthStatus?.stealth ?? STEALTH_SENSORY_DEFAULT,
                  ).toLocaleString()}{" "}
                  / {STEALTH_SENSORY_CAP.toLocaleString()}
                </span>
              </div>
              <Progress value={stealthProgress} className="h-2" />
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                <p>
                  Duration:{" "}
                  {Math.floor((stealthStatus?.stealthDurationMax ?? 60) / 60)} min
                </p>
                <p>
                  Keep Chance: {(stealthStatus?.stealthKeepChance ?? 5).toFixed(1)}%
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => trainCovert({ type: "stealth", minutes: 10 })}
                disabled={isTrainingCovert || stealthProgress >= 100}
                className="w-full"
              >
                <Timer className="h-4 w-4 mr-1" />
                {isTrainingCovert ? "Starting..." : "Train 10 min"}
              </Button>
              <Button
                onClick={() => trainCovert({ type: "stealth", minutes: 30 })}
                disabled={isTrainingCovert || stealthProgress >= 100}
                className="w-full"
              >
                <Timer className="h-4 w-4 mr-1" />
                {isTrainingCovert ? "Starting..." : "Train 30 min"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Sensory Section - hidden when training */}
      {!isTraining && (
        <div className="border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Search className="h-5 w-5 text-blue-600" />
            <h3 className="font-bold text-lg">Sensory</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm">Progress</span>
                <span className="text-sm font-medium">
                  {Math.floor(
                    stealthStatus?.sensory ?? STEALTH_SENSORY_DEFAULT,
                  ).toLocaleString()}{" "}
                  / {STEALTH_SENSORY_CAP.toLocaleString()}
                </span>
              </div>
              <Progress value={sensoryProgress} className="h-2" />
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                <p>
                  Detection Chance:{" "}
                  {(stealthStatus?.sensoryDetectChance ?? 5).toFixed(1)}%
                </p>
                <p>Cooldown: {Math.floor(stealthStatus?.sensoryCooldown ?? 120)} sec</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => trainCovert({ type: "sensory", minutes: 10 })}
                disabled={isTrainingCovert || sensoryProgress >= 100}
                className="w-full"
              >
                <Timer className="h-4 w-4 mr-1" />
                {isTrainingCovert ? "Starting..." : "Train 10 min"}
              </Button>
              <Button
                onClick={() => trainCovert({ type: "sensory", minutes: 30 })}
                disabled={isTrainingCovert || sensoryProgress >= 100}
                className="w-full"
              >
                <Timer className="h-4 w-4 mr-1" />
                {isTrainingCovert ? "Starting..." : "Train 30 min"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-muted border border-border rounded-lg p-4 text-sm">
        <h4 className="font-bold mb-2">How Covert Operations Work</h4>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>
            <b>Stealth:</b> Go undetected in enemy territory. Higher stat = longer
            duration and better chance to stay hidden when performing actions.
          </li>
          <li>
            <b>Sensory:</b> Detect stealthed enemies. Higher stat = better detection
            chance and shorter cooldown.
          </li>
          <li>Actions like attacking or robbing may break your stealth.</li>
          <li>Being attacked will always break your stealth.</li>
        </ul>
      </div>
    </div>
  );
};

export default StrengthWeaknesses;
