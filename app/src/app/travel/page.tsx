"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Cookie,
  Eye,
  EyeOff,
  Ghost,
  GitMerge,
  HousePlus,
  Locate,
  MapPinned,
  Radar,
  Search,
  Swords,
  UserRoundSearch,
  Zap,
  ZapOff,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HIDEOUT_COST,
  STEALTH_SENSORY_CAP,
  STEALTH_TRAIN_GAIN_PER_MINUTE,
  VILLAGE_LEAVE_REQUIRED_RANK,
  VILLAGE_REDUCED_GAINS_DAYS,
} from "@/drizzle/constants";
import type { UserItemWithItem } from "@/drizzle/schema";

type RevealedPlayer = {
  userId: string;
  username: string;
  longitude: number;
  latitude: number;
  villageId: string | null;
  level: number;
};

import { useLocalStorage } from "@/hooks/localstorage";
import { useMap } from "@/hooks/map";
import { useTutorialStep } from "@/hooks/tutorial";
import { useLiveCountdown } from "@/hooks/useLiveCountdown";
import AutoAttackModal from "@/layout/AutoAttackModal";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Loader from "@/layout/Loader";
import MapError from "@/layout/MapError";
import Modal2 from "@/layout/Modal2";
import NavTabs from "@/layout/NavTabs";
import { nonCombatConsume } from "@/libs/item";
import { getStealthStatus } from "@/libs/stealth";
import type { GlobalTile, SectorPoint } from "@/libs/threejs/types";
import { showMutationToast, showRewardToast } from "@/libs/toast";
import { hasRequiredRank } from "@/libs/train";
import { calcGlobalTravelTime, findNearestEdge, isAtEdge } from "@/libs/travel";
import { findVillageUserRelationship } from "@/utils/alliance";
import { useAwake } from "@/utils/routing";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  type FindSectorSchema,
  type FindSectorSchemaInput,
  findSectorSchema,
  type QuickTravelSchema,
  type QuickTravelSchemaInput,
  quickTravelSchema,
} from "@/validators/travel";

const GlobalMap = dynamic(() => import("@/layout/Map"), { ssr: false });
const Sector = dynamic(() => import("@/layout/Sector"), { ssr: false });

export default function Travel() {
  // What is shown on this page
  const [showActive, setShowActive] = useLocalStorage<boolean>(
    "showActiveOnMap3",
    false,
  );
  const [showOwnership, setShowOwnership] = useLocalStorage<boolean>(
    "showOwnership",
    false,
  );
  const [autoAttackMode, setAutoAttackMode] = useLocalStorage<boolean>(
    "autoAttackMode",
    false,
  );
  const [sensoryAllyAttack, setSensoryAllyAttack] = useLocalStorage<boolean>(
    "friendlyAttackSensory",
    false,
  );
  const [showModal, setShowModal] = useState<boolean>(false);
  const [showSorrounding, setShowSorrounding] = useState<boolean>(false);
  const [showAutoAttackModal, setShowAutoAttackModal] = useState<boolean>(false);
  const [revealedPlayers, setRevealedPlayers] = useState<RevealedPlayer[]>([]);
  const [showRevealedPlayersModal, setShowRevealedPlayersModal] =
    useState<boolean>(false);
  const [pendingAttackTarget, setPendingAttackTarget] = useState<{
    userId: string;
    username: string;
    longitude: number;
    latitude: number;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<string>("");
  const [focusSector, setFocusSector] = useState<number | null>(null);

  // Globe data
  const { globe, mapError } = useMap();

  // tRPC utility
  const utils = api.useUtils();

  // Current and target sectors & positions
  const [currentTile, setCurrentTile] = useState<GlobalTile | null>(null);
  const [currentPosition, setCurrentPosition] = useState<SectorPoint | null>(null);
  const [targetPosition, setTargetPosition] = useState<SectorPoint | null>(null);
  const [targetSector, setTargetSector] = useState<number | null>(null);

  // Data from database
  const { data: userData, timeDiff, updateUser } = useRequiredUserData();
  const { data: villageData } = api.village.getAll.useQuery(undefined, {
    enabled: !!userData,
  });
  const { data: sectorData } = api.travel.getSectorData.useQuery(
    { sector: userData?.sector ?? -1 },
    { enabled: !!userData && userData.sector !== undefined },
  );
  // Memoize villages to prevent re-creating array reference on every render
  // This is important because useLiveCountdown triggers re-renders every second
  const villages = useMemo(() => {
    if (!villageData) return undefined;
    if (userData?.isOutlaw) return villageData;
    return villageData.filter((v) => ["VILLAGE", "SAFEZONE"].includes(v.type));
  }, [villageData, userData?.isOutlaw]);

  // Fetch tracked bounties for map display
  const { data: trackedBounties } = api.bounty.getTrackedBounties.useQuery(undefined, {
    enabled: !!userData,
  });
  const sectorVillage = villages?.find((v) => v.sector === userData?.sector);

  // Consumable items
  const { data: userItems } = api.item.getUserItems.useQuery(undefined, {
    enabled: !!userData,
  });
  const [useritem, setUserItem] = useState<UserItemWithItem | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  // Router for forwarding
  const router = useRouter();

  // Sector tab link
  const currentSector = userData?.sector;
  const sectorLink = currentSector
    ? currentPosition
      ? `You (${currentPosition.x}, ${currentPosition.y})`
      : `Sector ${currentSector}`
    : "";
  const globalLink = `Global`;

  // Quick travel form
  const quickTravelForm = useForm<QuickTravelSchemaInput, unknown, QuickTravelSchema>({
    mode: "all",
    resolver: zodResolver(quickTravelSchema),
    defaultValues: { sector: undefined },
  });
  const quickTravelSector = useWatch({
    control: quickTravelForm.control,
    name: "sector",
  }) as number | undefined;

  // Find sector form
  const findSectorForm = useForm<FindSectorSchemaInput, unknown, FindSectorSchema>({
    mode: "all",
    resolver: zodResolver(findSectorSchema),
  });
  const findSectorValue = useWatch({
    control: findSectorForm.control,
    name: "sector",
  }) as number | undefined;

  useEffect(() => {
    if (userData && globe) {
      setCurrentPosition({ x: userData.longitude, y: userData.latitude });
      const tile = globe.tiles[userData.sector];
      if (tile) {
        setCurrentTile(tile);
      }
    }
  }, [userData, currentSector, globe]);

  useEffect(() => {
    // Only set initial tab, don't override user's selection
    if (activeTab === "" && sectorLink) {
      setActiveTab(sectorLink);
    }
  }, [sectorLink, activeTab]);

  useEffect(() => {
    if (userData?.status === "BATTLE") {
      void router.push(`/combat`);
    }
  }, [userData?.status, router]);

  useAwake(userData);

  // Tutorial step
  const { currentStep, handleNextStepAsync } = useTutorialStep();

  // Mutations
  const { mutate: startGlobalMove, isPending: isStartingTravel } =
    api.travel.startGlobalMove.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success && result.data) {
          await updateUser(result.data);
          setShowModal(false);
          setActiveTab(globalLink);
          if (globe) {
            const tile = globe.tiles[result.data.sector];
            if (tile) {
              setCurrentTile(tile);
            }
          }
        }
      },
    });

  const { mutate: finishGlobalMove, isPending: isFinishingTravel } =
    api.travel.finishGlobalMove.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success && currentStep?.title === "Travel") {
          await handleNextStepAsync();
        }
        if (result.success) {
          await updateUser({ status: "AWAKE", travelFinishAt: null });
          setActiveTab(sectorLink);
        }
      },
    });

  const { mutate: joinVillage, isPending: isJoining } =
    api.village.joinVillage.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
        }
      },
    });

  const { mutate: purchaseHideout, isPending: isCreatingHideout } =
    api.clan.purchaseHideout.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.village.getAll.invalidate(),
            utils.profile.getUser.invalidate(),
            utils.travel.getSectorData.invalidate(),
          ]);
        }
      },
    });

  const { mutate: consume, isPending: isConsuming } = api.item.consume.useMutation({
    onSuccess: async (data) => {
      if (data.success && "rewards" in data && data.rewards) {
        showRewardToast(data.notifications, data.rewards, data.message, false);
      } else {
        showMutationToast(data);
      }
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.item.getUserItems.invalidate();
        await utils.bloodline.getItemRolls.invalidate();
      }
    },
    onSettled: () => {
      setIsOpen(false);
      setUserItem(undefined);
    },
  });

  // Stealth and sensory - derived from userData
  const stealthStatus = getStealthStatus(
    userData,
    STEALTH_SENSORY_CAP,
    STEALTH_TRAIN_GAIN_PER_MINUTE,
    timeDiff,
  );

  // Live countdown hooks for stealth/sensory cooldowns
  const sensoryCooldown = useLiveCountdown(stealthStatus?.sensoryCooldownRemaining);
  const stealthCooldown = useLiveCountdown(stealthStatus?.stealthCooldownRemaining);
  const stealthDuration = useLiveCountdown(stealthStatus?.stealthDurationRemaining);

  const { mutate: activateStealth, isPending: isActivatingStealth } =
    api.stealth.activateStealth.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success && data.data) {
          await updateUser({
            stealthActive: true,
            stealthActivatedAt: data.data.stealthActivatedAt,
          });
        }
      },
    });

  const { mutate: deactivateStealth, isPending: isDeactivatingStealth } =
    api.stealth.deactivateStealth.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser({ stealthActive: false, stealthActivatedAt: null });
        }
      },
    });

  const { mutate: scanSensory, isPending: isScanningSensory } =
    api.stealth.useSensory.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success && data.data) {
          await updateUser({ lastSensoryAt: data.data.lastSensoryAt });
          await utils.travel.getSectorData.invalidate();
          if (data.data.detectedUsers.length > 0) {
            setRevealedPlayers(data.data.detectedUsers);
            setShowRevealedPlayersModal(true);
          }
        }
      },
    });

  const { mutate: attackRevealedUser, isPending: isAttackingRevealed } =
    api.combat.attackUser.useMutation({
      onSuccess: async (data) => {
        if (data.success) {
          setShowRevealedPlayersModal(false);
          setRevealedPlayers([]);
          await updateUser({
            status: "BATTLE",
            battleId: data.battleId,
            updatedAt: new Date(),
          });
        } else {
          showMutationToast({
            success: false,
            message: data.message,
          });
        }
      },
    });

  // Convenience for starting global move
  const handleGlobalMove = useCallback(
    (sector: number) => {
      // Guards against global movement
      if (
        currentStep?.title === "Travel" &&
        currentStep?.relatedValue !== undefined &&
        userData?.tutorialOn
      ) {
        if (sector !== currentStep?.relatedValue) {
          showMutationToast({
            success: false,
            message: `For now, you need to travel to sector ${currentStep?.relatedValue} first.`,
          });
          return;
        }
      }
      // Start global move
      startGlobalMove({ sector });
    },
    [currentStep, userData?.tutorialOn, startGlobalMove],
  );

  // Convenience variables
  const onEdge = isAtEdge(currentPosition);
  const isGlobal = activeTab === globalLink;
  const showGlobal = villages && globe && isGlobal;
  const showSector = villages && currentSector && currentTile && !isGlobal;

  useEffect(() => {
    // Check if user reached the target position on the current map
    const atTarget =
      currentPosition &&
      targetPosition &&
      currentPosition.x === targetPosition.x &&
      currentPosition.y === targetPosition.y;
    // Auto-initiate global move when: user is at target hex, on sector edge,
    // target sector differs from current, and not already traveling
    if (
      atTarget &&
      onEdge &&
      targetSector &&
      targetSector !== currentSector &&
      !isStartingTravel
    ) {
      handleGlobalMove(targetSector);
    }
  }, [
    currentPosition,
    targetPosition,
    targetSector,
    currentSector,
    onEdge,
    isStartingTravel,
    handleGlobalMove,
  ]);

  // Attack revealed stealthed player after moving to their position
  useEffect(() => {
    if (
      pendingAttackTarget &&
      currentPosition &&
      userData &&
      currentPosition.x === pendingAttackTarget.longitude &&
      currentPosition.y === pendingAttackTarget.latitude &&
      !isAttackingRevealed
    ) {
      attackRevealedUser({
        userId: pendingAttackTarget.userId,
        longitude: pendingAttackTarget.longitude,
        latitude: pendingAttackTarget.latitude,
        sector: userData.sector,
      });
      setPendingAttackTarget(null);
    }
  }, [
    currentPosition,
    pendingAttackTarget,
    userData,
    isAttackingRevealed,
    attackRevealedUser,
  ]);

  // Memoized Map component to prevent re-renders during countdown updates
  const MapComponent = useMemo(() => {
    return (
      villages &&
      globe && (
        <GlobalMap
          intersection={true}
          highlights={villages}
          usersHighlighted={trackedBounties}
          userLocation={true}
          showOwnership={showOwnership}
          focusSector={focusSector}
          focusSectorLabel="Target"
          onTileClick={(sector) => {
            setTargetSector(sector);
            setShowModal(true);
          }}
          hexasphere={globe}
        />
      )
    );
  }, [villages, globe, trackedBounties, showOwnership, focusSector]);

  // Battle scene
  const SectorComponent = useMemo(() => {
    return (
      userData &&
      currentTile &&
      currentSector && (
        <Sector
          tile={currentTile}
          sector={currentSector}
          target={targetPosition}
          showSorrounding={showSorrounding}
          showActive={showActive}
          autoAttackMode={autoAttackMode}
          setShowSorrounding={setShowSorrounding}
          setTarget={setTargetPosition}
          setPosition={setCurrentPosition}
        />
      )
    );
  }, [
    currentTile,
    currentSector,
    targetPosition,
    showSorrounding,
    showActive,
    autoAttackMode,
    villages,
  ]);

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isJoining) return <Loader explanation="Joining village" />;
  if (isCreatingHideout) return <Loader explanation="Purchasing hideout" />;

  // Derived
  const loadedVillages = villages && villages.length > 0;
  const isOutlaw = userData.isOutlaw;
  const canJoin = hasRequiredRank(userData.rank, VILLAGE_LEAVE_REQUIRED_RANK);
  const clanLeader = userData.clan?.leaderId === userData.userId;
  const hadHideout = userData?.village?.type !== "OUTLAW" && userData.isOutlaw;
  const canAffordHideout = (userData?.clan?.bank || 0) >= HIDEOUT_COST;
  const canCreateHideout =
    isOutlaw && !sectorVillage && clanLeader && !hadHideout && loadedVillages;
  const joinVillageBtn = userData.isOutlaw && canJoin && sectorVillage?.joinable;
  const subtitle =
    currentSector && userData && activeTab === sectorLink
      ? `Sector ${currentSector} ${sectorData?.sectorData?.village ? `(${sectorData.sectorData.village.name})` : ""}`
      : "The world of Seichi";
  const consumableItems = userItems?.filter(
    (i) =>
      nonCombatConsume(i.item, userData) &&
      (!i.craftingFinishedAt || i.craftingFinishedAt < new Date()),
  );
  const shownConsumables = consumableItems?.map((ui) => ({ ...ui.item, ...ui }));

  // Render
  return (
    <>
      <ContentBox
        title="Travel"
        subtitle={subtitle}
        padding={false}
        topRightContent={
          <div className="flex cursor-pointer flex-row items-center">
            {!isGlobal && activeTab !== "" && (
              <>
                {userData?.anbuId &&
                  (autoAttackMode ? (
                    <Zap
                      className={`mr-2 h-7 w-7 text-red-500`}
                      onClick={() => setAutoAttackMode(false)}
                    />
                  ) : (
                    <ZapOff
                      className={`mr-2 h-7 w-7 hover:text-red-500`}
                      onClick={() => setShowAutoAttackModal(true)}
                    />
                  ))}
                {/* Stealth Toggle */}
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger
                      onClick={() => {
                        if (isActivatingStealth || isDeactivatingStealth) return;
                        if (stealthStatus?.isCurrentlyStealthed) {
                          deactivateStealth();
                        } else if (stealthCooldown <= 0) {
                          activateStealth();
                        }
                      }}
                    >
                      <Ghost
                        className={`mr-2 h-7 w-7 ${stealthStatus?.isCurrentlyStealthed ? "text-purple-500" : stealthCooldown > 0 ? "cursor-not-allowed text-gray-400" : "hover:text-purple-500"}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {stealthStatus?.isCurrentlyStealthed
                        ? `Stealth Active (${Math.ceil(stealthDuration)}s remaining)`
                        : stealthCooldown > 0
                          ? `Stealth Cooldown (${Math.ceil(stealthCooldown)}s)`
                          : "Activate Stealth"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {/* Sensory Scan */}
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger
                      onClick={() => {
                        if (isScanningSensory) return;
                        if (sensoryCooldown <= 0) {
                          if (currentSector !== undefined) {
                            scanSensory({ sector: currentSector });
                          }
                        }
                      }}
                    >
                      <Radar
                        className={`mr-2 h-7 w-7 ${sensoryCooldown > 0 ? "cursor-not-allowed text-gray-400" : "hover:text-blue-500"}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {sensoryCooldown > 0
                        ? `Sensory Cooldown (${Math.ceil(sensoryCooldown)}s)`
                        : `Scan for Hidden Enemies (${(stealthStatus?.sensoryDetectChance ?? 5).toFixed(0)}% chance)`}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {showActive ? (
                  <Eye
                    className={`mr-2 h-7 w-7 text-orange-500`}
                    onClick={() => setShowActive(false)}
                  />
                ) : (
                  <EyeOff
                    className={`mr-2 h-7 w-7`}
                    onClick={() => setShowActive(true)}
                  />
                )}
                <UserRoundSearch
                  className={`mr-2 h-7 w-7 hover:text-orange-500 ${showSorrounding ? "fill-orange-500" : ""}`}
                  onClick={() => setShowSorrounding((prev) => !prev)}
                />
              </>
            )}
            {activeTab === globalLink && (
              <>
                <Popover>
                  <PopoverTrigger>
                    <Locate
                      className={`mr-2 h-7 w-7 hover:text-purple-500 ${focusSector !== null ? "text-purple-500" : ""}`}
                    />
                  </PopoverTrigger>
                  <PopoverContent>
                    <p className="py-2 font-semibold">Find Sector</p>
                    <p className="pb-2 text-muted-foreground text-sm">
                      Enter a sector ID to locate it on the map.
                    </p>
                    <Form {...findSectorForm}>
                      <form
                        onSubmit={findSectorForm.handleSubmit((data) => {
                          setFocusSector(data.sector);
                        })}
                        className="flex flex-col gap-2"
                      >
                        <FormField
                          control={findSectorForm.control}
                          name="sector"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  className="w-full"
                                  placeholder="Sector ID (0-492)"
                                  type="number"
                                  {...field}
                                  value={field.value as number}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            size="sm"
                            className="flex-1"
                            disabled={findSectorValue === undefined}
                          >
                            Find Sector {findSectorValue ?? "..."}
                          </Button>
                          {focusSector !== null && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setFocusSector(null)}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                      </form>
                    </Form>
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger>
                    <Search className={`mr-2 h-7 w-7 hover:text-orange-500`} />
                  </PopoverTrigger>
                  <PopoverContent>
                    <p className="py-2 font-semibold">Quick Travel</p>
                    <p className="pb-2 text-muted-foreground text-sm">
                      Enter a sector ID to travel there directly.
                    </p>
                    <Form {...quickTravelForm}>
                      <form
                        onSubmit={quickTravelForm.handleSubmit((data) => {
                          setTargetSector(data.sector);
                          setShowModal(true);
                        })}
                        className="flex flex-col gap-2"
                      >
                        <FormField
                          control={quickTravelForm.control}
                          name="sector"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  className="w-full"
                                  placeholder="Sector ID (0-492)"
                                  type="number"
                                  {...field}
                                  value={field.value as number}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          disabled={
                            quickTravelSector === undefined ||
                            quickTravelSector === userData?.sector ||
                            isStartingTravel
                          }
                        >
                          Travel to Sector {quickTravelSector ?? "..."}
                        </Button>
                      </form>
                    </Form>
                  </PopoverContent>
                </Popover>
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger onClick={() => setShowOwnership(!showOwnership)}>
                      <MapPinned
                        className={`mr-2 h-7 w-7 ${showOwnership ? "text-orange-500" : ""}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>Show sector ownerships and factions</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
            {joinVillageBtn && (
              <Confirm2
                title={`Join Village [${sectorVillage.name}]`}
                proceed_label="Submit"
                button={<GitMerge className={`mx-1 h-7 w-7 hover:text-orange-500`} />}
                onAccept={() => joinVillage({ villageId: sectorVillage.id })}
              >
                Do you confirm that you wish to join {sectorVillage.name}? Please be
                aware that if you join this village your training benefits & regen will
                be reduced for {VILLAGE_REDUCED_GAINS_DAYS} days.
              </Confirm2>
            )}
            {canCreateHideout && (
              <Confirm2
                title="Purchase Hideout"
                proceed_label={canAffordHideout ? "Submit" : "Not enough ryo"}
                button={<HousePlus className={`mx-1 h-7 w-7 hover:text-orange-500`} />}
                onAccept={() => {
                  if (canAffordHideout) {
                    purchaseHideout({
                      clanId: userData.clanId || "",
                      sector: currentSector || 0,
                    });
                  }
                }}
              >
                As a leader of a faction, you have the option of founding a hideout for
                your faction, thereby effectively de-coupling yourself from the common
                syndicate of outlaws. The purchase costs <b>{HIDEOUT_COST} ryo</b>, and
                the faction currently has <b>{userData?.clan?.bank} ryo</b>. Do you want
                to create your faction hideout in this sector?
              </Confirm2>
            )}

            <NavTabs
              current={activeTab}
              options={[sectorLink, globalLink]}
              setValue={setActiveTab}
            />
          </div>
        }
      >
        {showGlobal && MapComponent}
        {mapError && <MapError />}
        {showSector && SectorComponent}
        {!villages && <Loader explanation="Loading data" />}
        {showModal && globe && userData && targetSector && (
          <Modal2
            id="tutorial-global-travel"
            title="World Travel"
            isOpen={showModal}
            setIsOpen={setShowModal}
            proceed_label={!isStartingTravel ? "Travel" : undefined}
            isValid={false}
            onAccept={() => {
              if (!onEdge && currentPosition) {
                setShowModal(false);
                setTargetPosition(findNearestEdge(currentPosition));
                setActiveTab(sectorLink);
              } else {
                handleGlobalMove(targetSector);
              }
            }}
          >
            {isStartingTravel && <Loader explanation="Preparing to Travel" />}
            {!isStartingTravel && (
              <div>
                You are about to move from sector {userData.sector} to {targetSector}.{" "}
                <p className="py-2">
                  The travel time is estimated to be{" "}
                  {calcGlobalTravelTime(userData.sector, targetSector, globe)} seconds.
                </p>
                <p className="py-2">
                  Your character will first have to move to the edge of his current
                  sector.
                </p>
                <p className="pb-2">
                  Current location: {currentPosition?.x}, {currentPosition?.y}
                </p>
                Do you confirm?
              </div>
            )}
          </Modal2>
        )}
        {userData?.travelFinishAt && (
          <div className="absolute top-0 right-0 bottom-0 left-0 z-20 m-auto flex flex-col justify-center bg-black opacity-90">
            <div className="m-auto text-center text-white">
              <p className="p-5 text-3xl">Traveling to Sector {userData?.sector}</p>
              <p className="text-5xl">
                Time Left:{" "}
                <Countdown
                  targetDate={userData?.travelFinishAt}
                  timeDiff={timeDiff}
                  onFinish={() => {
                    if (!isFinishingTravel) finishGlobalMove();
                  }}
                />
              </p>
            </div>
          </div>
        )}
      </ContentBox>
      <div className="flex flex-row items-center justify-between p-1">
        <div className="flex gap-2">
          {showSector && <JutsuLoadoutSelector size="small" label="Jutsu" />}
          {showSector && <ItemLoadoutSelector size="small" label="Items" />}
        </div>
        {showSector && userData?.anbuId && autoAttackMode && (
          <div className="flex items-center font-semibold text-red-500 text-sm">
            <Zap className="mr-1 h-4 w-4" />
            Auto-Attack: Scanning for enemies to hunt...
          </div>
        )}
      </div>
      {shownConsumables && shownConsumables.length > 0 && (
        <div className="flex flex-col">
          <p className="font-bold">Consumables</p>
          <ActionSelector
            className="grid-cols-6"
            items={shownConsumables}
            counts={shownConsumables}
            selectedId={useritem?.id}
            showBgColor={false}
            showLabels={false}
            onClick={(id) => {
              if (id === useritem?.id) {
                setUserItem(undefined);
                setIsOpen(false);
              } else {
                setUserItem(shownConsumables?.find((item) => item.id === id));
                setIsOpen(true);
              }
            }}
          />
          {isOpen && useritem && (
            <Modal2
              title="Item Details"
              isOpen={isOpen}
              setIsOpen={setIsOpen}
              isValid={false}
            >
              <ItemWithEffects
                item={{
                  ...useritem.item,
                  curDurability: useritem.durability,
                }}
                key={useritem.id}
                showStatistic="item"
              />
              {!isConsuming && (
                <div className="flex flex-row gap-1">
                  {nonCombatConsume(useritem.item, userData) && (
                    <Button
                      variant="info"
                      onClick={() => consume({ userItemId: useritem.id })}
                    >
                      <Cookie className="mr-2 h-5 w-5" />
                      Consume
                    </Button>
                  )}
                </div>
              )}
              {isConsuming && <Loader explanation={`Using ${useritem.item.name}`} />}
            </Modal2>
          )}
        </div>
      )}

      {/* Auto Attack Configuration Modal */}
      <AutoAttackModal
        isOpen={showAutoAttackModal}
        setIsOpen={setShowAutoAttackModal}
        onEnable={() => setAutoAttackMode(true)}
      />

      {/* Revealed Players Modal (from Sensory Scan) */}
      {showRevealedPlayersModal && revealedPlayers.length > 0 && (
        <Modal2
          title="Players Revealed by Sensory!"
          isOpen={showRevealedPlayersModal}
          setIsOpen={setShowRevealedPlayersModal}
          isValid={false}
        >
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Your sensory ability detected the following stealthed players:
            </p>
            {revealedPlayers.map((player) => (
              <RevealedPlayerCard
                key={player.userId}
                player={player}
                userData={userData}
                villageData={villageData}
                sensoryAllyAttack={sensoryAllyAttack}
                isAttackingRevealed={isAttackingRevealed}
                pendingAttackTarget={pendingAttackTarget}
                attackRevealedUser={attackRevealedUser}
                setPendingAttackTarget={setPendingAttackTarget}
                setTargetPosition={setTargetPosition}
                setShowRevealedPlayersModal={setShowRevealedPlayersModal}
              />
            ))}
            {/* Ally attack toggle */}
            <div className="flex flex-row items-center pt-3">
              <Checkbox
                className="m-1 mr-3"
                checked={sensoryAllyAttack}
                onCheckedChange={() => setSensoryAllyAttack(!sensoryAllyAttack)}
              />
              <Label>Attack button on allies</Label>
            </div>
          </div>
        </Modal2>
      )}
    </>
  );
}

/**
 * Revealed Player Card
 * @param player - The revealed player
 * @param userData - The user data
 * @param villageData - The village data
 * @param sensoryAllyAttack - Whether to attack allies
 * @param isAttackingRevealed - Whether the user is attacking a revealed player
 * @param pendingAttackTarget - The target of the pending attack
 * @param attackRevealedUser - The function to attack a revealed player
 * @param setPendingAttackTarget - The function to set the pending attack target
 * @param setTargetPosition - The function to set the target position
 * @returns
 */
const RevealedPlayerCard = ({
  player,
  userData,
  villageData,
  sensoryAllyAttack,
  isAttackingRevealed,
  pendingAttackTarget,
  attackRevealedUser,
  setPendingAttackTarget,
  setTargetPosition,
  setShowRevealedPlayersModal,
}: {
  player: RevealedPlayer;
  userData: ReturnType<typeof useRequiredUserData>["data"];
  villageData: { id: string; name: string; hexColor: string }[] | undefined;
  sensoryAllyAttack: boolean;
  isAttackingRevealed: boolean;
  pendingAttackTarget: {
    userId: string;
    username: string;
    longitude: number;
    latitude: number;
  } | null;
  attackRevealedUser: (params: {
    userId: string;
    longitude: number;
    latitude: number;
    sector: number;
  }) => void;
  setPendingAttackTarget: (target: {
    userId: string;
    username: string;
    longitude: number;
    latitude: number;
  }) => void;
  setTargetPosition: (pos: { x: number; y: number }) => void;
  setShowRevealedPlayersModal: (show: boolean) => void;
}) => {
  const sameHex =
    player.latitude === userData?.latitude && player.longitude === userData?.longitude;

  const village = villageData?.find((v) => v.id === player.villageId);
  const villageName = village?.name ?? (player.villageId ? "Unknown" : "Outlaw");
  const villageColor = village?.hexColor ?? "gray";

  const relationship =
    userData?.village &&
    findVillageUserRelationship(userData.village, player.villageId);
  const isAlly =
    player.villageId === userData?.villageId || relationship?.status === "ALLY";
  const showAttack = sensoryAllyAttack || !isAlly;

  return (
    <div
      key={player.userId}
      className="flex items-center justify-between rounded-lg bg-muted p-3"
    >
      <div>
        <p className="font-semibold">{player.username}</p>
        <p className="text-muted-foreground text-sm">
          Lvl. {player.level} -{" "}
          <span style={{ color: villageColor }}>{villageName}</span>
        </p>
        <p className="text-muted-foreground text-sm">
          Position: ({player.longitude}, {player.latitude})
          {sameHex && " - Same hex as you!"}
        </p>
      </div>
      <div className="flex gap-2">
        {showAttack && sameHex && userData ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() =>
              attackRevealedUser({
                userId: player.userId,
                longitude: player.longitude,
                latitude: player.latitude,
                sector: userData.sector,
              })
            }
            disabled={isAttackingRevealed}
          >
            <Swords className="mr-1 h-4 w-4" />
            Attack
          </Button>
        ) : showAttack && !sameHex ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setPendingAttackTarget({
                userId: player.userId,
                username: player.username,
                longitude: player.longitude,
                latitude: player.latitude,
              });
              setTargetPosition({
                x: player.longitude,
                y: player.latitude,
              });
              setShowRevealedPlayersModal(false);
            }}
            disabled={isAttackingRevealed || !!pendingAttackTarget}
          >
            <Swords className="mr-1 h-4 w-4" />
            Attack
          </Button>
        ) : !showAttack ? (
          <span className="text-muted-foreground text-sm italic">Ally</span>
        ) : null}
      </div>
    </div>
  );
};
