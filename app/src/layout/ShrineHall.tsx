"use client";

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Clock, Coins, Shield } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SHRINE_AI_UNLOCK_COST,
  SHRINE_BOOST_BASE_PERC,
  SHRINE_BOOST_COST,
  SHRINE_BOOST_DURATION_HOURS,
  SHRINE_BOOST_PER_SHRINE_PERC,
  SHRINE_BOOST_TYPES,
  SHRINE_MAX_AI_ASSIGNMENTS,
  SHRINE_MAX_LEVEL,
  SHRINE_MAX_PER_VILLAGE,
  SHRINE_UPGRADE_COST,
  SHRINE_WEEKLY_MAINTENANCE_COST,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import StatusBar from "@/layout/StatusBar";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { getShrineHpByLevel } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import {
  formatDateTimeShort,
  getDaysHoursMinutesSeconds,
  getSlotIndex,
  getTimeLeftStr,
} from "@/utils/time";
import type { BoostTemplateEntry } from "@/validators/shrine";

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
  const utils = api.useUtils();

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

  if (isKage) capturedShrineColumns.push({ key: "action", header: "", type: "jsx" });

  const capturedShrineRows: CapturedShrineRow[] = activeShrines.map((shrine) => {
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
                current={Math.max(0, war.defenderShrineHp)}
                total={war.defenderShrineMaxHp}
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
              <p className="text-muted-foreground text-sm">
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

      <div className="space-y-4">
        {activeShrines.length === 0 ? (
          <div className="px-3 pb-3">
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">No shrines currently captured</p>
                <p className="mt-2 text-sm">
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
  const utils = api.useUtils();

  const { data: sectorData } = api.travel.getSectorData.useQuery(
    { sector: user.sector ?? 0 },
    { enabled: isActive && typeof user.sector === "number" },
  );

  const { data: capturedSectors } = api.shrine.getCapturedSectors.useQuery(
    { villageId: user.villageId || "" },
    { enabled: isActive && !!user.villageId },
  );

  const { mutate: activateBoost, isPending: isActivatingBoost } =
    api.shrine.activateBoost.useMutation({
      onSuccess: (res) => {
        showMutationToast(res);
        if (res.success) {
          void utils.profile.getUser.invalidate();
        }
      },
    });

  // Track previously active boost types for notifications (initialise with current state so
  // we only fire toasts for boosts that become active after this component mounts)
  const prevActiveBoostTypesRef = useRef<Set<string>>(
    new Set(
      Object.entries(user.village?.shrineSettings?.activeBoosts ?? {})
        .filter(([, expiry]) => expiry && new Date(expiry).getTime() > Date.now())
        .map(([boostType]) => boostType),
    ),
  );

  // Show notification when a scheduled boost becomes active
  useEffect(() => {
    const currentBoosts = user.village?.shrineSettings?.activeBoosts ?? {};
    const now = Date.now();
    const currentTypes = new Set(
      Object.entries(currentBoosts)
        .filter(([, expiry]) => expiry && new Date(expiry).getTime() > now)
        .map(([boostType]) => boostType),
    );
    for (const type of currentTypes) {
      if (!prevActiveBoostTypesRef.current.has(type)) {
        showMutationToast({
          success: true,
          title: "Village Boost Activated",
          message: `${type} boost is now active for ${SHRINE_BOOST_DURATION_HOURS} hours!`,
        });
      }
    }
    prevActiveBoostTypesRef.current = currentTypes;
  }, [user.village?.shrineSettings?.activeBoosts]);

  if (!sectorData) return <Loader explanation="Loading shrine data" />;

  const isKage = user.userId === user.village?.kageId;
  const isElder = user.rank === "ELDER";

  const level3Shrines = (capturedSectors || []).filter(
    (s) => s.shrineLevel === 3,
  ).length;

  const boostSettings = user.village?.shrineSettings?.activeBoosts;
  const activeBoosts = Object.entries(boostSettings || {})
    .map(([boostType, expiry]) => {
      const secondsLeft = expiry ? new Date(expiry).getTime() - Date.now() : 0;
      return { boostType, secondsLeft };
    })
    .filter(({ secondsLeft }) => secondsLeft > 0);
  // Base 10% with 1+ shrines, plus ~3.33% per additional shrine (10-20% range)
  const boostPercentage =
    level3Shrines > 0
      ? SHRINE_BOOST_BASE_PERC + (level3Shrines - 1) * SHRINE_BOOST_PER_SHRINE_PERC
      : 0;

  return (
    <div className="grid grid-cols-1 gap-4 p-3">
      <Card>
        <CardHeader>
          <CardTitle>Active Boosts</CardTitle>
          <CardDescription>Currently active village-wide bonuses</CardDescription>
        </CardHeader>
        <CardContent>
          {activeBoosts.length > 0 ? (
            <div className="space-y-2">
              {activeBoosts.map(({ boostType, secondsLeft }, i) => {
                const timeLeft = getTimeLeftStr(
                  ...getDaysHoursMinutesSeconds(secondsLeft),
                );

                return (
                  <div
                    key={`${boostType}-${i}`}
                    className="flex items-center justify-between rounded bg-muted p-2"
                  >
                    <div>
                      <div className="font-medium">{boostType}</div>
                      <div className="text-muted-foreground text-sm">
                        +{boostPercentage}% bonus
                      </div>
                    </div>
                    <div className="text-muted-foreground text-sm">{timeLeft} left</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground">No active boosts</p>
          )}
        </CardContent>
      </Card>

      {user.villageId && (isKage || isElder) && (
        <Card>
          <CardHeader>
            <CardTitle>Activate a Boost</CardTitle>
            <CardDescription>
              Requires Level 3 shrine • Cost: {SHRINE_BOOST_COST.toLocaleString()}{" "}
              tokens
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            {!level3Shrines ? (
              <p className="text-muted-foreground text-sm">
                Need at least one Level 3 shrine to activate boosts
              </p>
            ) : (
              <>
                {SHRINE_BOOST_TYPES.map((boostType, i) => {
                  const currentlyActive = activeBoosts.some(
                    ({ boostType: activeType }) => activeType === boostType,
                  );

                  return (
                    <div key={`${boostType}-${i}`} className="space-y-2">
                      <Button
                        className="w-full justify-between"
                        variant={currentlyActive ? "secondary" : "default"}
                        disabled={isActivatingBoost || currentlyActive}
                        onClick={() => {
                          if (user.villageId) {
                            activateBoost({
                              boostType,
                              villageId: user.villageId,
                            });
                          }
                        }}
                      >
                        <span>
                          {boostType} [+{boostPercentage}%]
                        </span>
                        <span className="ml-2 text-xs">Activate Now</span>
                      </Button>
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {user.villageId && (
        <BoostTemplateGrid
          villageId={user.villageId}
          canEdit={isKage || isElder}
          isActive={isActive}
        />
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                              Defenders Tab                                 */
/* -------------------------------------------------------------------------- */

const DefendersTab = ({ user, isActive }: TabProps) => {
  const [selectedAiId, setSelectedAiId] = useState<string>("");

  const utils = api.useUtils();

  const { data: aiData } = api.shrine.getShrineAis.useQuery(undefined, {
    enabled: isActive,
  });

  const { data: capturedSectors } = api.shrine.getCapturedSectors.useQuery(
    { villageId: user.villageId || "" },
    { enabled: isActive && !!user.villageId },
  );

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

  const shrineSettings = user.village.shrineSettings;
  const unlockedAiIds = shrineSettings?.unlockedAiIds || [];
  const currentVillageAiIds = shrineSettings?.activeAiIds || [];

  const assignedAis =
    currentVillageAiIds.length > 0
      ? aiData.filter((ai) => currentVillageAiIds.includes(ai.userId))
      : [];

  const availableToUnlock = aiData.filter((ai) => !unlockedAiIds.includes(ai.userId));
  const unlockedAis = aiData.filter((ai) => unlockedAiIds.includes(ai.userId));

  return (
    <div className="flex flex-col gap-4 p-3">
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
          {assignedAis.map((ai) => (
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

          {assignedAis.length === 0 && (
            <div className="py-4 text-center">
              <Shield className="mx-auto mb-2 h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">Using default AI defender</p>
            </div>
          )}
        </CardContent>
      </Card>

      {isKage && (
        <>
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
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0">
                            {ai.avatar && (
                              <Image
                                src={ai.avatar}
                                alt={ai.username}
                                width={32}
                                height={32}
                                className="h-8 w-8 rounded-full"
                              />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{ai.username}</p>
                            <p className="text-muted-foreground text-sm">
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
                  <p className="text-center text-muted-foreground text-sm">
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
  const utils = api.useUtils();

  const { data: capturedSectors } = api.shrine.getCapturedSectors.useQuery(
    { villageId: user.villageId ?? "" },
    { enabled: !!user.villageId },
  );

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
            <div className="flex items-center justify-between rounded bg-popover p-3">
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
                    ? dueDate.getTime() - Date.now()
                    : 0;

                  const nextPaymentAt = getTimeLeftStr(
                    ...getDaysHoursMinutesSeconds(secondsToNextPayment),
                  );

                  return (
                    <div
                      key={sector.id}
                      className={cn(
                        "space-y-3 rounded-lg border p-4",
                        isOverdue
                          ? "border-red-200 bg-red-50"
                          : "border-border bg-card",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h5 className="font-medium">Sector {sector.sector}</h5>
                          <p className="text-muted-foreground text-sm">
                            Shrine Level {sector.shrineLevel}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-muted-foreground text-sm">Next Payment</p>
                          <p
                            className={cn(
                              "font-medium text-sm",
                              isOverdue && "text-red-600",
                            )}
                          >
                            {isOverdue ? "Payment overdue" : nextPaymentAt}
                          </p>
                        </div>
                      </div>

                      {isOverdue && (
                        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-100 p-2">
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                          <span className="text-red-700 text-xs">
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
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-semibold text-lg leading-tight">{value}</p>
    </div>
    <Icon className="h-4 w-4 text-muted-foreground" />
  </div>
);

/* -------------------------------------------------------------------------- */
/*                         Boost Template Grid                                */
/* -------------------------------------------------------------------------- */

const BOOST_TYPE_COLORS: Record<string, string> = {
  Training: "bg-blue-500",
  PVP: "bg-red-500",
  Mission: "bg-yellow-500",
  Errands: "bg-green-500",
  Crafting: "bg-purple-500",
};

const SLOT_LABELS = [
  "00:00",
  "02:00",
  "04:00",
  "06:00",
  "08:00",
  "10:00",
  "12:00",
  "14:00",
  "16:00",
  "18:00",
  "20:00",
  "22:00",
];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface BoostTemplateGridProps {
  villageId: string;
  canEdit: boolean;
  isActive: boolean;
}

const BoostTemplateGrid = ({
  villageId,
  canEdit,
  isActive,
}: BoostTemplateGridProps) => {
  const utils = api.useUtils();
  const now = new Date();
  const currentDayOfWeek = now.getUTCDay();
  const currentSlotIndex = getSlotIndex(now.getUTCHours());

  const { data: templateData, isLoading } = api.shrine.getBoostTemplate.useQuery(
    { villageId },
    { enabled: !!villageId && isActive },
  );

  const [localTemplate, setLocalTemplate] = useState<BoostTemplateEntry[]>([]);
  const [openCell, setOpenCell] = useState<{ day: number; slot: number } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  useEffect(() => {
    if (templateData?.boostTemplate && !isDirty) {
      setLocalTemplate(templateData.boostTemplate as BoostTemplateEntry[]);
    }
  }, [templateData, isDirty]);

  const { mutate: saveTemplate, isPending: isSaving } =
    api.shrine.setBoostTemplate.useMutation({
      onSuccess: (res) => {
        if (res.success) {
          void utils.shrine.getBoostTemplate.invalidate({ villageId });
          setIsDirty(false);
        }
      },
    });

  const toggleBoostInCell = (day: number, slot: number, boostType: string) => {
    setLocalTemplate((prev) => {
      const exists = prev.some(
        (e) => e.dayOfWeek === day && e.slotIndex === slot && e.boostType === boostType,
      );
      if (exists) {
        return prev.filter(
          (e) =>
            !(e.dayOfWeek === day && e.slotIndex === slot && e.boostType === boostType),
        );
      }
      return [
        ...prev,
        {
          boostType: boostType as BoostTemplateEntry["boostType"],
          dayOfWeek: day,
          slotIndex: slot,
        },
      ];
    });
    setIsDirty(true);
  };

  const clearAll = () => {
    setLocalTemplate([]);
    setIsDirty(true);
    setClearConfirm(false);
  };

  const handleSave = () => {
    saveTemplate({ villageId, template: localTemplate });
  };

  const updatedAt = templateData?.boostTemplateUpdatedAt
    ? new Date(templateData.boostTemplateUpdatedAt)
    : null;
  const updatedBy = templateData?.boostTemplateUpdatedBy ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly Boost Template</CardTitle>
        <CardDescription>
          Schedule recurring boosts by slot (each slot = 2 UTC hours). The cron
          auto-activates scheduled boosts when a new slot starts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader explanation="Loading boost template..." />
        ) : (
          <>
            {/* Grid: rows = slots (time), cols = days */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="w-14 py-1 pr-2 text-right text-muted-foreground">
                      UTC
                    </th>
                    {DAY_LABELS.map((day) => (
                      <th
                        key={day}
                        className="min-w-[72px] py-1 text-center font-medium"
                      >
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SLOT_LABELS.map((slotLabel, slotIdx) => (
                    <tr key={slotIdx} className="border-border/40 border-t">
                      <td className="py-1 pr-2 text-right text-muted-foreground">
                        {slotLabel}
                      </td>
                      {DAY_LABELS.map((_, dayIdx) => {
                        const cellBoosts = localTemplate.filter(
                          (e) => e.dayOfWeek === dayIdx && e.slotIndex === slotIdx,
                        );
                        const isCurrentCell =
                          dayIdx === currentDayOfWeek && slotIdx === currentSlotIndex;
                        const isCellOpen =
                          openCell?.day === dayIdx && openCell?.slot === slotIdx;

                        const availableBoosts = SHRINE_BOOST_TYPES.filter(
                          (bt) => !cellBoosts.some((e) => e.boostType === bt),
                        );

                        return (
                          <td
                            key={dayIdx}
                            className={cn(
                              "min-h-[32px] p-0.5",
                              isCurrentCell && "ring-2 ring-white ring-offset-1",
                            )}
                          >
                            <div className="flex min-h-[32px] flex-wrap gap-0.5 rounded p-0.5">
                              {cellBoosts.map((entry) =>
                                canEdit ? (
                                  <button
                                    key={entry.boostType}
                                    type="button"
                                    onClick={() =>
                                      toggleBoostInCell(
                                        dayIdx,
                                        slotIdx,
                                        entry.boostType,
                                      )
                                    }
                                    aria-label={`Remove ${entry.boostType} from ${DAY_LABELS[dayIdx] ?? ""} ${slotLabel}`}
                                    className={cn(
                                      "cursor-pointer rounded px-1 py-0 text-[10px] text-white hover:opacity-70",
                                      BOOST_TYPE_COLORS[entry.boostType] ??
                                        "bg-gray-500",
                                    )}
                                  >
                                    {entry.boostType}
                                  </button>
                                ) : (
                                  <Badge
                                    key={entry.boostType}
                                    className={cn(
                                      "px-1 py-0 text-[10px]",
                                      BOOST_TYPE_COLORS[entry.boostType] ??
                                        "bg-gray-500",
                                    )}
                                  >
                                    {entry.boostType}
                                  </Badge>
                                ),
                              )}

                              {canEdit && availableBoosts.length > 0 && (
                                <Popover
                                  open={isCellOpen}
                                  onOpenChange={(open) => {
                                    setOpenCell(
                                      open ? { day: dayIdx, slot: slotIdx } : null,
                                    );
                                  }}
                                >
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-40 hover:bg-muted hover:opacity-100"
                                      aria-label={`Add boost to ${DAY_LABELS[dayIdx]} ${slotLabel}`}
                                    >
                                      +
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    align="start"
                                    side="bottom"
                                    className="w-auto p-2"
                                  >
                                    <div className="space-y-1">
                                      <p className="mb-1 font-medium text-muted-foreground text-xs">
                                        Add boost
                                      </p>
                                      {availableBoosts.map((bt) => (
                                        <button
                                          type="button"
                                          key={bt}
                                          className={cn(
                                            "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-white text-xs hover:opacity-80",
                                            BOOST_TYPE_COLORS[bt] ?? "bg-gray-500",
                                          )}
                                          onClick={() => {
                                            toggleBoostInCell(dayIdx, slotIdx, bt);
                                            setOpenCell(null);
                                          }}
                                        >
                                          {bt}
                                        </button>
                                      ))}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Controls */}
            {canEdit && (
              <div className="flex items-center gap-3">
                <Button size="sm" disabled={!isDirty || isSaving} onClick={handleSave}>
                  {isSaving ? "Saving..." : "Save Template"}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (clearConfirm) {
                      clearAll();
                    } else {
                      setClearConfirm(true);
                    }
                  }}
                  onBlur={() => setClearConfirm(false)}
                >
                  {clearConfirm ? "Confirm Clear?" : "Clear All"}
                </Button>
              </div>
            )}

            {updatedAt && updatedBy && (
              <p className="text-muted-foreground text-xs">
                Last updated by {updatedBy} on {formatDateTimeShort(updatedAt)} UTC
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
