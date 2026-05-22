"use client";

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Clock, Coins, Shield } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  SHRINE_BOOST_DISPLAY,
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
  isNewSlotDue,
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
  const now = useUtcNow(isActive, 60_000);
  const nowMs = now.getTime();

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
        .filter(([, expiry]) => expiry && new Date(expiry).getTime() > nowMs)
        .map(([boostType]) => boostType),
    ),
  );

  // Show notification when a scheduled boost becomes active
  useEffect(() => {
    const currentBoosts = user.village?.shrineSettings?.activeBoosts ?? {};
    const currentTypes = new Set(
      Object.entries(currentBoosts)
        .filter(([, expiry]) => expiry && new Date(expiry).getTime() > nowMs)
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
  }, [nowMs, user.village?.shrineSettings?.activeBoosts]);

  // When a UTC slot boundary just passed, the maintenance cron may have auto-activated
  // a template boost. Refetch the user so activeBoosts updates and the toast effect above
  // can fire. Global tRPC uses staleTime: Infinity, so without this nothing refreshes.
  // Gated on template presence so the hot path scales with template users, not all viewers.
  const invalidateUser = useCallback(
    () => utils.profile.getUser.invalidate(),
    [utils.profile.getUser],
  );
  useInvalidateOnSlotBoundary(
    nowMs,
    !!user.village?.shrineSettings?.boostTemplate?.length,
    invalidateUser,
  );

  if (!sectorData) return <Loader explanation="Loading shrine data" />;

  const isKage = user.userId === user.village?.kageId;
  const isElder = user.rank === "ELDER";

  const level3Shrines = (capturedSectors || []).filter(
    (s) => s.shrineLevel === 3,
  ).length;

  const boostSettings = user.village?.shrineSettings?.activeBoosts;
  const activeBoosts = Object.entries(boostSettings || {})
    .map(([boostType, expiry]) => {
      const secondsLeft = expiry ? new Date(expiry).getTime() - nowMs : 0;
      return { boostType, secondsLeft };
    })
    .filter(({ secondsLeft }) => secondsLeft > 0);
  // Base 10% with 1+ shrines, plus ~3.33% per additional shrine (10-20% range)
  const boostPercentage =
    level3Shrines > 0
      ? Math.round(
          (SHRINE_BOOST_BASE_PERC +
            (level3Shrines - 1) * SHRINE_BOOST_PER_SHRINE_PERC) *
            10,
        ) / 10
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
              SHRINE_BOOST_TYPES.map((boostType, i) => {
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
              })
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

const useUtcNow = (enabled: boolean, intervalMs: number) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;

    setNow(new Date());
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [enabled, intervalMs]);

  return now;
};

/**
 * Calls `invalidate` once each time a 2-hour UTC slot boundary is crossed while
 * `nowMs` ticks forward. Used to refresh server state (e.g. cron-activated boosts)
 * that won't otherwise update with the global `staleTime: Infinity` cache.
 */
const useInvalidateOnSlotBoundary = (
  nowMs: number,
  enabled: boolean,
  invalidate: () => unknown,
) => {
  const prevTickMsRef = useRef<number>(nowMs);
  useEffect(() => {
    if (enabled && isNewSlotDue(new Date(nowMs), new Date(prevTickMsRef.current))) {
      void invalidate();
    }
    prevTickMsRef.current = nowMs;
  }, [nowMs, enabled, invalidate]);
};

/* -------------------------------------------------------------------------- */
/*                         Boost Template Grid                                */
/* -------------------------------------------------------------------------- */

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
  const now = useUtcNow(isActive, 60_000);
  const currentDayOfWeek = now.getUTCDay();
  const currentSlotIndex = getSlotIndex(now.getUTCHours());

  const { data: templateData, isLoading } = api.shrine.getBoostTemplate.useQuery(
    { villageId },
    { enabled: !!villageId && isActive },
  );

  const [localTemplate, setLocalTemplate] = useState<BoostTemplateEntry[]>([]);
  const [openCell, setOpenCell] = useState<{ day: number; slot: number } | null>(null);
  const [openAllDay, setOpenAllDay] = useState<number | null>(null);
  const [allDayBoosts, setAllDayBoosts] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (templateData?.boostTemplate && !isDirty) {
      setLocalTemplate(templateData.boostTemplate as BoostTemplateEntry[]);
    }
  }, [templateData, isDirty]);

  // Close panels on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenCell(null);
        setOpenAllDay(null);
        setAllDayBoosts([]);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const allDayFilledDays = useMemo(() => {
    const filled = new Set<number>();
    for (let day = 0; day < 7; day++) {
      const dayEntries = localTemplate.filter((e) => e.dayOfWeek === day);
      const filledSlots = new Set(dayEntries.map((e) => e.slotIndex));
      if (filledSlots.size === 12) {
        filled.add(day);
      }
    }
    return filled;
  }, [localTemplate]);

  const templateBySlot = useMemo(() => {
    const map = new Map<string, BoostTemplateEntry[]>();
    for (const entry of localTemplate) {
      const key = `${entry.dayOfWeek}-${entry.slotIndex}`;
      const existing = map.get(key) ?? [];
      existing.push(entry);
      map.set(key, existing);
    }
    return map;
  }, [localTemplate]);

  const { mutate: saveTemplate, isPending: isSaving } =
    api.shrine.setBoostTemplate.useMutation({
      onSuccess: (res) => {
        showMutationToast(res);
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

  const fillAllDay = (day: number, boosts: string[]) => {
    // Defense in depth: the UI disables Fill Day when boosts is empty, but never let a
    // future caller silently wipe a day by passing an empty list.
    if (boosts.length === 0) return;
    setLocalTemplate((prev) => {
      const filtered = prev.filter((e) => e.dayOfWeek !== day);
      const newEntries: BoostTemplateEntry[] = [];
      for (let slot = 0; slot < 12; slot++) {
        for (const bt of boosts) {
          newEntries.push({
            boostType: bt as BoostTemplateEntry["boostType"],
            dayOfWeek: day,
            slotIndex: slot,
          });
        }
      }
      return [...filtered, ...newEntries];
    });
    setIsDirty(true);
    setOpenAllDay(null);
    setAllDayBoosts([]);
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
          Auto-activates at each 2-hour UTC slot boundary · requires tokens
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader explanation="Loading boost template..." />
        ) : (
          <div ref={containerRef}>
            {/* 7×12 grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="w-14 py-1 pr-2 text-right text-muted-foreground font-normal text-[10px]">
                      UTC
                    </th>
                    {DAY_LABELS.map((day, dayIdx) => (
                      <th key={day} className="min-w-[72px] py-1 text-center">
                        <div
                          className={cn(
                            "mb-1 text-[11px] font-semibold",
                            dayIdx === currentDayOfWeek
                              ? "text-amber-400"
                              : "text-foreground",
                          )}
                        >
                          {day}
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenAllDay(openAllDay === dayIdx ? null : dayIdx);
                              setAllDayBoosts([]);
                              setOpenCell(null);
                            }}
                            className={cn(
                              "w-full rounded border px-1 py-0.5 text-[9px] transition-colors",
                              allDayFilledDays.has(dayIdx)
                                ? "border-blue-700 bg-blue-700 text-blue-200"
                                : "border-border bg-muted text-muted-foreground hover:border-blue-500",
                            )}
                          >
                            {allDayFilledDays.has(dayIdx) ? "✓ All Day" : "All Day"}
                          </button>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SLOT_LABELS.map((slotLabel, slotIdx) => (
                    <tr
                      key={slotIdx}
                      className={cn(
                        "border-t border-border/40",
                        slotIdx === currentSlotIndex && "bg-amber-950/30",
                      )}
                    >
                      <td className="py-1 pr-2 text-right text-[10px] text-muted-foreground">
                        {slotLabel}
                      </td>
                      {DAY_LABELS.map((_, dayIdx) => {
                        const key = `${dayIdx}-${slotIdx}`;
                        const cellBoosts = templateBySlot.get(key) ?? [];
                        const isCurrentCell =
                          dayIdx === currentDayOfWeek && slotIdx === currentSlotIndex;
                        const isCellOpen =
                          openCell?.day === dayIdx && openCell?.slot === slotIdx;
                        const isAllDayCol = allDayFilledDays.has(dayIdx);

                        return (
                          <td
                            key={dayIdx}
                            className={cn("p-0.5", isAllDayCol && "bg-blue-950/20")}
                          >
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => {
                                setOpenCell(
                                  isCellOpen ? null : { day: dayIdx, slot: slotIdx },
                                );
                                setOpenAllDay(null);
                              }}
                              className={cn(
                                "flex min-h-[32px] w-full flex-wrap gap-0.5 rounded p-0.5 text-left transition-colors",
                                isCellOpen && "ring-2 ring-amber-400 ring-offset-1",
                                isCurrentCell &&
                                  !isCellOpen &&
                                  "ring-1 ring-amber-400/40",
                                canEdit && "cursor-pointer hover:bg-muted/40",
                              )}
                              aria-label={`${DAY_LABELS[dayIdx]} ${slotLabel} boost slot`}
                            >
                              {cellBoosts.map((entry) => {
                                // Defensive lookup: `templateData.boostTemplate` is type-cast
                                // from JSON without runtime validation, so a stale DB row could
                                // contain a boostType outside SHRINE_BOOST_TYPES.
                                const display = SHRINE_BOOST_DISPLAY[entry.boostType];
                                return (
                                  <span
                                    key={entry.boostType}
                                    className={cn(
                                      "rounded px-1 py-0 text-[10px]",
                                      display?.color ?? "bg-gray-700 text-gray-200",
                                    )}
                                  >
                                    {display?.abbrev ?? entry.boostType}
                                  </span>
                                );
                              })}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Persistent cell panel */}
            {canEdit && openCell && (
              <div className="mt-3 rounded-lg border border-amber-500/50 bg-muted p-3">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-amber-400">
                    {DAY_LABELS[openCell.day]} · {SLOT_LABELS[openCell.slot]} –{" "}
                    {`${String(((openCell.slot + 1) * 2) % 24).padStart(2, "0")}:00`}{" "}
                    UTC
                  </span>
                  <span className="text-xs text-muted-foreground">
                    click away to close
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {SHRINE_BOOST_TYPES.map((bt) => {
                    const checked = (
                      templateBySlot.get(`${openCell.day}-${openCell.slot}`) ?? []
                    ).some((e) => e.boostType === bt);
                    return (
                      <button
                        key={bt}
                        type="button"
                        onClick={() =>
                          toggleBoostInCell(openCell.day, openCell.slot, bt)
                        }
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-md px-2 py-3 text-center text-xs transition-colors",
                          checked
                            ? SHRINE_BOOST_DISPLAY[bt].color
                            : "border border-border bg-background text-muted-foreground hover:border-muted-foreground",
                        )}
                      >
                        {checked && <span>✓</span>}
                        <span>{bt}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* All Day panel */}
            {canEdit && openAllDay !== null && (
              <div className="mt-3 rounded-lg border border-blue-500/50 bg-muted p-3">
                <div className="mb-3">
                  <span className="text-sm font-semibold text-blue-400">
                    {DAY_LABELS[openAllDay]} · All Day (fills all 12 slots)
                  </span>
                </div>
                <div className="mb-3 grid grid-cols-5 gap-2">
                  {SHRINE_BOOST_TYPES.map((bt) => {
                    const checked = allDayBoosts.includes(bt);
                    return (
                      <button
                        key={bt}
                        type="button"
                        onClick={() => {
                          setAllDayBoosts((prev) =>
                            prev.includes(bt)
                              ? prev.filter((b) => b !== bt)
                              : [...prev, bt],
                          );
                        }}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-md px-2 py-3 text-center text-xs transition-colors",
                          checked
                            ? SHRINE_BOOST_DISPLAY[bt].color
                            : "border border-border bg-background text-muted-foreground hover:border-muted-foreground",
                        )}
                      >
                        {checked && <span>✓</span>}
                        <span>{bt}</span>
                      </button>
                    );
                  })}
                </div>
                <Button
                  size="sm"
                  disabled={allDayBoosts.length === 0}
                  onClick={() => fillAllDay(openAllDay, allDayBoosts)}
                >
                  Fill Day
                </Button>
              </div>
            )}

            {/* Footer */}
            <div className="mt-4 flex items-center justify-between">
              {updatedAt && updatedBy ? (
                <p className="text-xs text-muted-foreground">
                  Last saved by {updatedBy} · {formatDateTimeShort(updatedAt)} UTC
                </p>
              ) : (
                <span />
              )}
              {canEdit && (
                <div className="flex gap-2">
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
                  <Button
                    size="sm"
                    disabled={!isDirty || isSaving}
                    onClick={handleSave}
                  >
                    {isSaving ? "Saving..." : "Save Template"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
