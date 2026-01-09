"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import Image from "@/layout/Image";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import StatusBar from "@/layout/StatusBar";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, Shield, Coins, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getShrineHpByLevel } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import {
  SHRINE_MAX_LEVEL,
  SHRINE_MAX_PER_VILLAGE,
  SHRINE_BOOST_COST,
  SHRINE_BOOST_TYPES,
  SHRINE_BOOST_BASE_PERC,
  SHRINE_BOOST_PER_SHRINE_PERC,
  SHRINE_WEEKLY_MAINTENANCE_COST,
  SHRINE_AI_UNLOCK_COST,
  SHRINE_UPGRADE_COST,
  SHRINE_MAX_AI_ASSIGNMENTS,
} from "@/drizzle/constants";
import { getTimeLeftStr, getDaysHoursMinutesSeconds } from "@/utils/time";
import { cn } from "src/libs/shadui";

/**
 * ShrineHall
 * Parent component – handles ONLY tab-switching logic.
 * Each tab lives in its own sub-component further below. Queries are gated by the
 * `isActive` prop so that they only execute while the corresponding tab is shown.
 */
interface ShrineHallProps {
  user: UserWithRelations;
  navTabs: React.ReactNode;
}

export const ShrineHall = ({ user, navTabs }: ShrineHallProps) => {
  const [activeTab, setActiveTab] = useState<
    "overview" | "boosts" | "defenders" | "maintenance"
  >("overview");

  if (!user) return <Loader explanation="Loading user data" />;

  return (
    <div className="space-y-6">
      <ContentBox
        title="Shrines"
        subtitle={`${user.village?.name} Shrines`}
        defaultBackHref="/village"
        topRightContent={navTabs}
        padding={false}
      >
        <Tabs
          value={activeTab}
          onValueChange={(v) =>
            setActiveTab(v as "overview" | "boosts" | "defenders" | "maintenance")
          }
          className="w-full"
        >
          <div className="p-2">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="boosts">Boosts</TabsTrigger>
              <TabsTrigger value="defenders">Defenders</TabsTrigger>
              <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview">
            <OverviewTab user={user} isActive={activeTab === "overview"} />
          </TabsContent>
          <TabsContent value="boosts">
            <BoostsTab user={user} isActive={activeTab === "boosts"} />
          </TabsContent>
          <TabsContent value="defenders">
            <DefendersTab user={user} isActive={activeTab === "defenders"} />
          </TabsContent>
          <TabsContent value="maintenance">
            <MaintenanceTab user={user} isActive={activeTab === "maintenance"} />
          </TabsContent>
        </Tabs>
      </ContentBox>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

interface TabProps {
  user: NonNullable<UserWithRelations>;
  isActive: boolean;
}

/* -------------------------------------------------------------------------- */
/*                              Overview Tab                                  */
/* -------------------------------------------------------------------------- */

const OverviewTab = ({ user, isActive }: TabProps) => {
  // Utils
  const utils = api.useUtils();

  // Queries
  const { data: shrineData } = api.travel.getSectorData.useQuery(
    { sector: user.sector ?? 0 },
    {
      enabled: isActive,
      refetchInterval: isActive ? 30_000 : false,
    },
  );
  const { data: capturedSectors } = api.shrine.getCapturedSectors.useQuery(
    { villageId: user.villageId || "" },
    { enabled: isActive && !!user.villageId },
  );

  // Mutations
  const { mutate: upgradeShrine, isPending: isUpgrading } =
    api.shrine.upgradeShrine.useMutation({
      onSuccess: (res) => {
        showMutationToast(res);
        void utils.travel.getSectorData.invalidate();
        void utils.shrine.getCapturedSectors.invalidate();
        void utils.profile.getUser.invalidate();
      },
    });

  const isKage = user.userId === user.village?.kageId;

  // Fetch all active wars for this village once – used for shrine HP display
  const { data: activeWars } = api.war.getActiveWars.useQuery(
    { villageId: user.villageId || "" },
    {
      enabled: isActive && !!user.villageId,
      refetchInterval: isActive ? 10_000 : false,
    },
  );

  if (!shrineData) return <Loader explanation="Loading shrine data" />;

  const activeShrines = (capturedSectors || []).filter(
    (s) => s.shrineLevel && s.shrineLevel > 0,
  );

  type CapturedShrineRow = {
    sector: number;
    shrineLevel: number;
    health: React.ReactNode;
    capturedAt: Date;
    action?: React.ReactNode;
  };

  const capturedShrineColumns: ColumnDefinitionType<
    CapturedShrineRow,
    keyof CapturedShrineRow
  >[] = [
    { key: "sector", header: "Sector", type: "number" },
    { key: "shrineLevel", header: "Level", type: "number" },
    { key: "health", header: "HP", type: "jsx" },
  ];

  if (isKage) {
    capturedShrineColumns.push({ key: "action", header: "", type: "jsx" });
  }

  const capturedShrineRows: CapturedShrineRow[] = activeShrines.map((shrine) => {
    // All sector wars for the relevant sector
    const sectorWars =
      activeWars?.filter(
        (war) => war.type === "SECTOR_WAR" && war.sector === shrine.sector,
      ) ?? [];

    return {
      sector: shrine.sector,
      shrineLevel: shrine.shrineLevel,
      health:
        sectorWars.length === 0 ? (
          <StatusBar
            key={`${shrine.sector}-${shrine.shrineLevel}`}
            title="HP"
            tooltip="Shrine Health"
            color="bg-green-500"
            showText
            status="AWAKE"
            current={getShrineHpByLevel(shrine.shrineLevel)}
            total={getShrineHpByLevel(shrine.shrineLevel)}
          />
        ) : (
          <div className="space-y-1">
            {sectorWars.map((war) => (
              <StatusBar
                key={war.id}
                title="HP"
                tooltip={`Shrine Health – ${war.attackerVillage.name} vs ${war.defenderVillage.name}`}
                color="bg-red-500"
                showText
                status="AWAKE"
                current={Math.max(0, war.shrineHp)}
                total={war.shrineMaxHp}
              />
            ))}
          </div>
        ),
      capturedAt: shrine.capturedAt ? new Date(shrine.capturedAt) : new Date(),
      action: isKage ? (
        shrine.shrineLevel < SHRINE_MAX_LEVEL ? (
          user.village?.tokens !== undefined &&
          user.village.tokens < SHRINE_UPGRADE_COST ? (
            <div>
              <Badge variant="destructive">Insufficient</Badge>
              <p className="text-sm text-muted-foreground">
                {SHRINE_UPGRADE_COST.toLocaleString()} tokens
              </p>
            </div>
          ) : (
            <Button
              size="sm"
              disabled={isUpgrading}
              onClick={(e) => {
                e.stopPropagation();
                upgradeShrine({ sectorNumber: shrine.sector });
              }}
            >
              Upgrade to L{shrine.shrineLevel + 1}
            </Button>
          )
        ) : (
          <Badge variant="secondary">Max</Badge>
        )
      ) : undefined,
    };
  });

  return (
    <div className="flex flex-col">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 p-3">
        <StatsCard
          icon={Coins}
          label="Village Tokens"
          value={user.village?.tokens?.toLocaleString() ?? 0}
        />
        <StatsCard
          icon={Shield}
          label="Active Shrines"
          value={`${activeShrines.length}/${SHRINE_MAX_PER_VILLAGE}`}
        />
      </div>

      {/* Captured Shrines List */}
      <div className="space-y-4">
        {activeShrines.length === 0 ? (
          <div className="px-3 pb-3">
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">No shrines currently captured</p>
                <p className="text-sm mt-2">
                  Defeat enemy shrines in combat to capture sectors for your village!
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Table data={capturedShrineRows} columns={capturedShrineColumns} />
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                               Boosts Tab                                   */
/* -------------------------------------------------------------------------- */

const BoostsTab = ({ user, isActive }: TabProps) => {
  // Utils
  const utils = api.useUtils();

  // Query
  const { data: sectorData } = api.travel.getSectorData.useQuery(
    { sector: user.sector ?? 0 },
    { enabled: isActive && typeof user.sector === "number" },
  );
  const { data: capturedSectors } = api.shrine.getCapturedSectors.useQuery(
    { villageId: user.villageId || "" },
    { enabled: isActive && !!user.villageId },
  );

  // Mutation
  const { mutate: activateBoost, isPending: isActivatingBoost } =
    api.shrine.activateBoost.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          void utils.profile.getUser.invalidate();
        }
      },
    });

  // Guard
  if (!sectorData) return <Loader explanation="Loading shrine data" />;

  const isKage = user.userId === user.village?.kageId;
  const level3Shrines = (capturedSectors || []).filter(
    (s) => s.shrineLevel === 3,
  ).length;
  const boostSettings = user.village?.shrineSettings?.activeBoosts;
  const activeBoosts = Object.entries(boostSettings || {})
    .map(([boostType, expiry]) => {
      const secondsLeft = expiry
        ? new Date(expiry).getTime() - new Date().getTime()
        : 0;
      return { boostType, secondsLeft };
    })
    .filter(({ secondsLeft }) => secondsLeft > 0);
  // Base 10% with 1+ shrines, plus ~3.33% per additional shrine (10-20% range)
  const boostPercentage =
    level3Shrines > 0
      ? SHRINE_BOOST_BASE_PERC + (level3Shrines - 1) * SHRINE_BOOST_PER_SHRINE_PERC
      : 0;

  return (
    <div className={cn("grid grid-cols-1 gap-4 p-3")}>
      {/* Active Boosts */}
      <Card>
        <CardHeader>
          <CardTitle>Active Boosts</CardTitle>
          <CardDescription>Currently active village-wide bonuses</CardDescription>
        </CardHeader>
        <CardContent>
          {activeBoosts && activeBoosts.length > 0 ? (
            <div className="space-y-2">
              {activeBoosts.map(({ boostType, secondsLeft }) => {
                const timeLeft = getTimeLeftStr(
                  ...getDaysHoursMinutesSeconds(secondsLeft),
                );
                return (
                  <div
                    key={boostType}
                    className="flex justify-between items-center p-2 bg-muted rounded"
                  >
                    <div>
                      <div className="font-medium">{boostType}</div>
                      <div className="text-sm text-muted-foreground">
                        +{boostPercentage}% bonus
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">{timeLeft} left</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground">No active boosts</p>
          )}
        </CardContent>
      </Card>

      {/* Boost Activation */}
      {user.villageId && isKage && (
        <Card>
          <CardHeader>
            <CardTitle>Activate Boost</CardTitle>
            <CardDescription>
              Requires Level 3 shrine • Cost: {SHRINE_BOOST_COST.toLocaleString()}{" "}
              tokens
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!level3Shrines ? (
              <p className="text-sm text-muted-foreground">
                Need at least one Level 3 shrine to activate boosts
              </p>
            ) : (
              SHRINE_BOOST_TYPES.map((boostType) => {
                const currentlyActive = activeBoosts.some(
                  ({ boostType: activeBoostType }) => activeBoostType === boostType,
                );

                return (
                  <Button
                    key={boostType}
                    className="w-full justify-between"
                    variant={currentlyActive ? "secondary" : "default"}
                    disabled={isActivatingBoost || currentlyActive}
                    onClick={() =>
                      activateBoost({ boostType, villageId: user.villageId! })
                    }
                  >
                    <span>
                      {boostType} [+{boostPercentage}%]
                    </span>
                  </Button>
                );
              })
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                              Defenders Tab                                 */
/* -------------------------------------------------------------------------- */

const DefendersTab = ({ user, isActive }: TabProps) => {
  const [selectedAiId, setSelectedAiId] = useState<string>("");

  // Utils
  const utils = api.useUtils();

  // Queries
  const { data: aiData } = api.shrine.getShrineAis.useQuery(undefined, {
    enabled: isActive,
  });
  const { data: capturedSectors } = api.shrine.getCapturedSectors.useQuery(
    { villageId: user.villageId || "" },
    { enabled: isActive && !!user.villageId },
  );

  // Mutations
  const { mutate: unlockAi, isPending: isUnlockingAi } =
    api.shrine.unlockAiDefender.useMutation({
      onSuccess: (res) => {
        showMutationToast(res);
        void utils.profile.getUser.invalidate();
      },
    });

  const { mutate: toggleVillageAi, isPending: isTogglingAi } =
    api.shrine.toggleVillageAiDefender.useMutation({
      onSuccess: (res) => {
        showMutationToast(res);
        void utils.profile.getUser.invalidate();
      },
    });

  if (!aiData || !capturedSectors)
    return <Loader explanation="Loading defender data" />;
  if (!user.village) return <Loader explanation="Looking for village data" />;

  const isKage = user.userId === user.village?.kageId;
  const activeShrines = capturedSectors.filter(
    (s) => s.shrineLevel && s.shrineLevel > 0,
  );

  // Get shrine settings from user data
  const shrineSettings = user.village.shrineSettings;
  const unlockedAiIds = shrineSettings?.unlockedAiIds || [];
  const currentVillageAiIds = shrineSettings?.activeAiIds || [];

  // Get assigned AI data for display
  const assignedAis =
    currentVillageAiIds.length > 0
      ? aiData.filter((ai) => currentVillageAiIds.includes(ai.userId))
      : [];

  // Available AIs for unlocking (those not yet unlocked)
  const availableToUnlock = aiData.filter((ai) => !unlockedAiIds.includes(ai.userId));

  // Unlocked AIs that can be assigned
  const unlockedAis = aiData.filter((ai) => unlockedAiIds.includes(ai.userId));

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* Currently Assigned AI - for everyone */}
      <Card>
        <CardHeader>
          <CardTitle>Current Village Defenders</CardTitle>
          <CardDescription>
            {activeShrines.length > 0
              ? `Defending ${activeShrines.length} active shrine${activeShrines.length === 1 ? "" : "s"}`
              : "No active shrines to defend"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assignedAis?.map((ai) => (
            <ItemWithEffects
              key={ai.userId}
              item={{
                id: ai.userId,
                name: ai.username,
                description: `Level ${ai.level} AI Defender`,
                image: ai.avatar || undefined,
                createdAt: new Date(),
                updatedAt: new Date(),
                attacks: ai.jutsus?.map((jutsu) =>
                  "jutsu" in jutsu ? jutsu.jutsu?.name : "Unknown",
                ),
                ...ai,
              }}
            />
          ))}
          {assignedAis?.length === 0 && (
            <div className="text-center py-4">
              <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">Using default AI defender</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kage-only sections */}
      {isKage && (
        <>
          {/* Unlock New AI Defenders */}
          {availableToUnlock.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Unlock AI Defender</CardTitle>
                <CardDescription>
                  Cost: {SHRINE_AI_UNLOCK_COST.toLocaleString()} tokens each •{" "}
                  {unlockedAiIds.length} already unlocked
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={selectedAiId} onValueChange={setSelectedAiId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select AI to unlock" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableToUnlock.map((ai) => (
                      <SelectItem key={ai.userId} value={ai.userId}>
                        {ai.username} (Level {ai.level})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full"
                  disabled={!selectedAiId || isUnlockingAi}
                  onClick={() => {
                    if (selectedAiId) {
                      unlockAi({ aiId: selectedAiId });
                      setSelectedAiId("");
                    }
                  }}
                >
                  {isUnlockingAi ? "Unlocking..." : "Unlock AI Defender"}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Manage AI Defenders */}
          {activeShrines.length > 0 && unlockedAis.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Manage Village Defenders</CardTitle>
                <CardDescription>
                  Toggle your unlocked AI defenders on/off
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2">
                  {unlockedAis.map((ai) => {
                    const isAssigned = currentVillageAiIds.includes(ai.userId);
                    const canAssign =
                      !isAssigned &&
                      currentVillageAiIds.length < SHRINE_MAX_AI_ASSIGNMENTS;

                    return (
                      <div
                        key={ai.userId}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0">
                            {ai.avatar && (
                              <Image
                                src={ai.avatar}
                                alt={ai.username}
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-full"
                              />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{ai.username}</p>
                            <p className="text-sm text-muted-foreground">
                              Level {ai.level}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant={isAssigned ? "default" : "outline"}
                          size="sm"
                          disabled={isTogglingAi || (!isAssigned && !canAssign)}
                          onClick={() => toggleVillageAi({ aiId: ai.userId })}
                        >
                          {isTogglingAi ? "..." : isAssigned ? "Remove" : "Assign"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
                {currentVillageAiIds.length >= SHRINE_MAX_AI_ASSIGNMENTS && (
                  <p className="text-sm text-muted-foreground text-center">
                    Maximum defenders assigned ({SHRINE_MAX_AI_ASSIGNMENTS}). Remove one
                    to assign another.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                              Maintenance Tab                               */
/* -------------------------------------------------------------------------- */

const MaintenanceTab = ({ user }: TabProps) => {
  // Utils
  const utils = api.useUtils();

  // Query for captured sectors
  const { data: capturedSectors } = api.shrine.getCapturedSectors.useQuery(
    { villageId: user.villageId! },
    { enabled: !!user.villageId },
  );

  // Mutations
  const { mutate: payMaintenance, isPending: isPaying } =
    api.shrine.payWeeklyMaintenance.useMutation({
      onSuccess: (res) => {
        showMutationToast(res);
        if (res.success) {
          void utils.profile.getUser.invalidate();
          void utils.shrine.getCapturedSectors.invalidate();
        }
      },
    });

  const isKage = user.userId === user.village?.kageId;

  if (!capturedSectors) {
    return <Loader explanation="Loading sector maintenance information..." />;
  }

  return (
    <div className="p-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" /> Shrine Maintenance
          </CardTitle>
          <CardDescription>
            Keep your shrines maintained to prevent level degradation. Each sector
            requires individual maintenance payments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-poppopover rounded">
              <span>Maintenance Cost (per shrine)</span>
              <span className="font-semibold">
                {SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens
              </span>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold">Captured Sectors</h4>
              {capturedSectors.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No captured sectors. Capture sectors to build shrines that require
                  maintenance.
                </p>
              ) : (
                capturedSectors.map((sector) => {
                  const dueDate = sector.nextMaintainanceDueDate
                    ? new Date(sector.nextMaintainanceDueDate)
                    : new Date();
                  const isOverdue = dueDate <= new Date();
                  const secondsToNextPayment = dueDate
                    ? dueDate.getTime() - new Date().getTime()
                    : 0;
                  const nextPaymentAt = getTimeLeftStr(
                    ...getDaysHoursMinutesSeconds(secondsToNextPayment),
                  );

                  return (
                    <div
                      key={sector.id}
                      className={cn(
                        "p-4 border rounded-lg space-y-3",
                        isOverdue
                          ? "border-red-200 bg-red-50"
                          : "border-border bg-card",
                      )}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <h5 className="font-medium">Sector {sector.sector}</h5>
                          <p className="text-sm text-muted-foreground">
                            Shrine Level {sector.shrineLevel}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">Next Payment</p>
                          <p
                            className={cn(
                              "text-sm font-medium",
                              isOverdue && "text-red-600",
                            )}
                          >
                            {isOverdue ? "Payment overdue" : nextPaymentAt}
                          </p>
                        </div>
                      </div>

                      {isOverdue && (
                        <div className="flex items-center gap-2 p-2 bg-red-100 border border-red-200 rounded">
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                          <span className="text-xs text-red-700">
                            Maintenance overdue! This shrine may lose levels without
                            payment.
                          </span>
                        </div>
                      )}

                      {isKage && (
                        <Button
                          size="sm"
                          variant={isOverdue ? "destructive" : "default"}
                          disabled={isPaying}
                          onClick={() => payMaintenance({ sectorId: sector.id })}
                        >
                          Pay Maintenance (
                          {SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens)
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                           Helper Components                                */
/* -------------------------------------------------------------------------- */

interface StatsCardProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
}

const StatsCard = ({ icon: Icon, label, value }: StatsCardProps) => (
  <div className="flex items-center justify-between rounded-md border bg-card p-3">
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold leading-tight">{value}</p>
    </div>
    <Icon className="h-4 w-4 text-muted-foreground" />
  </div>
);
