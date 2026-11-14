"use client";

import { getMutationKey } from "@trpc/react-query";
import type { Grid } from "honeycomb-grid";
import { useAtomValue, useSetAtom } from "jotai";
import { Minimize2, Swords } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { getInventoryQuantities } from "@/deltas/item";
import type { UserUpdateOptions } from "@/deltas/profile";
import {
  IMG_AVATAR_DEFAULT,
  IMG_SCENE_BACKGROUND,
  SECTOR_WALK_STEP_MS,
  STRUCTURE_ADJACENTS,
  WAR_SHRINE_IMAGE_BY_BIOME,
} from "@/drizzle/constants";
import type { UserData, VillageStructure } from "@/drizzle/schema";
import { AUTO_ATTACK_SETTINGS, readAutoAttackSetting } from "@/hooks/autoAttack";
import { useGameScene } from "@/hooks/game-scene";
import { useLocalStorage } from "@/hooks/localstorage";
import { useTutorialStep } from "@/hooks/tutorial";
import { useDungeonAvailability } from "@/hooks/useDungeonAvailability";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { usePublicQuestLocations } from "@/hooks/usePublicQuestLocations";
import { useSceneMutation } from "@/hooks/useSceneMutation";
import { useSectorCacheUpdate } from "@/hooks/useSectorCacheUpdate";
import { useVillageDutyPursuit } from "@/hooks/useVillageDuty";
import AvatarImage from "@/layout/Avatar";
import { DayNightIndicator } from "@/layout/DayNightIndicator";
import HealingPopover from "@/layout/HealingPopover";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { QuestDialogScene, QuestUpdateModal } from "@/layout/Logbook";
import { MapLocationActions } from "@/layout/MapLocationActions";
import Modal from "@/layout/Modal";
import RaidBrowser from "@/layout/RaidBrowser";
import { useOpenRewardChoice } from "@/layout/RewardChoice";
import { SurroundingUsers } from "@/layout/SurroundingUsers";
import { TravelUserCard } from "@/layout/TravelUserCard";
import WebGlError from "@/layout/WebGLError";
import { showActionReadinessToast } from "@/libs/actionFeedback";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { getWorldCycleBrightness } from "@/libs/dayNight";
import { expandedWorldAtom } from "@/libs/expandedWorld";
import type { TerrainHex } from "@/libs/hexgrid";
import { findHex, oddQHexDistance, PathCalculator } from "@/libs/hexgrid";
import { LIGHT_LAYOUT_STORAGE_KEY } from "@/libs/layoutPreference";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import type { LpcCatalog } from "@/libs/lpc/catalog";
import { getQuestMapLocations, groupMapLocations } from "@/libs/mapLocations";
import { dialogChoiceContentId } from "@/libs/objectives";
import {
  arrivalPromptDecision,
  findActionableBoundObjective,
  isArrivalPromptStale,
  liveNpcTiles,
  npcCopyKey,
  npcReach,
  resolveArrivalPromptCta,
} from "@/libs/overworldAi";
import type { WanderTile } from "@/libs/overworldWander";
import {
  GATHERING_CANCEL_PREFIX,
  getArrivalQuestTriggers,
  getBoundObjectiveCandidates,
} from "@/libs/quest";
import { findConsecutiveQuestId } from "@/libs/questRun";
import {
  createTravelScene,
  type TravelPick,
  type TravelSnapshot,
  travelLightingMode,
} from "@/libs/rendering/scenes/travel";
import {
  type TravelMotionStep,
  travelAvatar,
} from "@/libs/rendering/scenes/travelActors";
import { worldMotionHeading } from "@/libs/rendering/worldArt";
import type { WorldWeather } from "@/libs/rendering/worldWeather";
import {
  beyondSectorMapEdge,
  findNearestWalkableEdgeTile,
  isOnSectorMapEdge,
  type SectorMapEdge,
  sectorMapEdgeCell,
  sectorMapEdgeOffset,
} from "@/libs/sector-map/crossing";
import { mergeDecorationAssets } from "@/libs/sector-map/decorations";
import { buildWindowNav } from "@/libs/sector-map/navigation";
import { createGenericStructure, withSectorShrine } from "@/libs/sector-map/structures";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { sectorGridNeighbors } from "@/libs/sector-map/world-grid";
import type {
  GlobalTile,
  SectorPoint,
  SectorUser,
} from "@/libs/sector-map/world-types";
import { subscribeSharedChannel } from "@/libs/sharedChannel";
import { isUserCurrentlyStealthed } from "@/libs/stealth";
import { showMutationToast } from "@/libs/toast";
import {
  isSectorPresenceStatus,
  isTravelKeyBlocked,
  SECTOR_ARRIVAL_BATCH_LIMIT,
  SECTOR_ARRIVAL_BATCH_MS,
} from "@/libs/travel";
import { isTutorialActive, isTutorialCaptureStep } from "@/libs/tutorial";
import { getAllyStatus, isAutoAttackTarget, mapAttackRelation } from "@/utils/alliance";
import { isStaffRole } from "@/utils/permissions";
import { sleep } from "@/utils/time";
import {
  blockingPopupOpenAtom,
  selectUserWithoutPosition,
  useRequiredUserDataSelector,
  useUserDataRef,
} from "@/utils/UserContext";
import type { MapLocation } from "@/validators/mapLocation";

/**
 * Renders the player's current sector plus its 8 neighbors (the sectorWindow
 * prop) as one continuous, seamlessly scrollable world. Moves and border
 * crossings animate client-side and reconcile with the server afterwards;
 * window changes patch the live scene in place instead of rebuilding it.
 */
const Sector = (props: SectorProps) => {
  const centerEntry = props.sectorWindow.sectors.find(
    (entry) => entry.sector === props.sector,
  );
  if (!centerEntry) throw new Error(`Sector ${props.sector} missing from window`);
  return <SectorScene {...props} centerEntry={centerEntry} />;
};

/** Own the travel renderer while reconciling live movement with the visible sector window. */
const SectorScene = (props: SectorProps & { centerEntry: SectorWindowEntry }) => {
  const { sector, sectorWindow, target, showActive, autoAttackMode, centerEntry } =
    props;
  const isActiveRef = useRef(props.isActive);
  isActiveRef.current = props.isActive;
  const sectorMap = centerEntry.map;
  const { setPosition } = props;
  const { isWorldExpanded, setWorldExpanded } = props;
  const expandedExitRef = useRef<HTMLButtonElement>(null);
  const setExpandedWorld = useSetAtom(expandedWorldAtom);
  useEffect(() => {
    setExpandedWorld(isWorldExpanded);
    return () => setExpandedWorld(false);
  }, [isWorldExpanded, setExpandedWorld]);
  useEffect(() => {
    if (!isWorldExpanded) return;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const exit = expandedExitRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const page = document.querySelector<HTMLElement>("body > [data-world-page]");
    const height = page?.style.height ?? "";
    if (page) {
      // The world is portalled to body. Preserve the covered page's scroll extent while suspending its paint.
      page.style.height = `${Math.max(page.offsetHeight, page.scrollHeight)}px`;
      page.setAttribute("data-world-covered", "true");
    }
    exit?.focus({ preventScroll: true });
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"][data-state="open"]')
      )
        setWorldExpanded(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = overflow;
      if (page) {
        page.removeAttribute("data-world-covered");
        page.style.height = height;
      }
      document.removeEventListener("keydown", onEscape);
      // Do not steal focus from a dialog or navigation target that took it during dismissal.
      if (
        returnFocus?.isConnected &&
        (document.activeElement === document.body || document.activeElement === exit)
      )
        returnFocus.focus({ preventScroll: true });
    };
  }, [isWorldExpanded, setWorldExpanded]);

  // Light layout preference state
  const [lightLayout] = useLocalStorage<boolean>(LIGHT_LAYOUT_STORAGE_KEY, false);

  // State pertaining to the sector
  const [targetUser, setTargetUser] = useState<SectorUser | null>(null);
  const [healTargetUser, setHealTargetUser] = useState<SectorUser | null>(null);
  // Each tap opens a new card; the previous card's outside-tap dismissal can land after it.
  const [profileCard, setProfileCard] = useState<{
    user: SectorUser;
    anchor: { x: number; y: number };
    openedAt: number;
  } | null>(null);
  const [sorrounding, setSorrounding] = useState<SectorUser[]>([]);
  const publishSurroundingsRef = useRef(false);
  publishSurroundingsRef.current =
    props.showSorrounding || autoAttackMode || !!healTargetUser;
  const [allyAttack, setAllyAttack] = useLocalStorage<boolean>("friendlyAttack", false);
  const [storedBrackets, setStoredBrackets] = useLocalStorage<number[] | null>(
    "scoutingBrackets",
    null,
  );
  const [excludeAllies, setExcludeAllies] = useLocalStorage<boolean>(
    "scoutingExcludeAllies",
    true,
  );
  const [storedZoom, setStoredZoom] = useLocalStorage<number>("sectorZoom", 2.4);
  const liveZoomRef = useRef<number | null>(null);
  // Global travel lands a tutorial player within a few tiles of the capture
  // target, so that step opens zoomed right in: the puppy and its marker fill
  // the view rather than being a speck somewhere on a 26x26 map. Only the
  // opening view -- zooming back out afterwards sticks, as it does anywhere
  // else, and every other step keeps the player's stored zoom.
  const { currentStep } = useTutorialStep();
  const openSectorZoomedIn = isTutorialCaptureStep(currentStep);
  const [currentStructure, setCurrentStructure] = useState<VillageStructure | null>(
    null,
  );
  const currentStructureRef = useRef<VillageStructure | null>(null);
  // Structure under the pointer (sticky while interacting with the panel so
  // the pointer can leave the canvas to click "Go to" without clearing).
  const [hoveredStructure, setHoveredStructure] = useState<VillageStructure | null>(
    null,
  );
  const [logbookModalQuestId, setLogbookModalQuestId] = useState<string | null>(null);
  const [showRaidModal, setShowRaidModal] = useState<boolean>(false);
  const [npcDialog, setNpcDialog] = useState<NpcDialog | null>(null);
  const [arrivalNpc, setArrivalNpc] = useState<SectorUser | null>(null);
  // A blocking global popup (e.g. daily rewards) is up or still loading — hold the arrival prompt.
  const isBlockingPopupOpen = useAtomValue(blockingPopupOpenAtom);

  // References which shouldn't update
  const originRef = useRef<TerrainHex | undefined>(undefined);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const pathFinderRef = useRef<PathCalculator | null>(null);
  const gridRef = useRef<Grid<TerrainHex> | null>(null);
  const usersRef = useRef<SectorUser[]>([]);
  const actorRevisionRef = useRef(0);
  // Server-clock offset for the render loop, which must not re-subscribe when it changes.
  const timeDiffRef = useRef(0);
  const showUsersRef = useRef<boolean>(showActive);
  const showSorroundingRef = useRef<boolean>(props.showSorrounding);
  const ignoreMapClicksUntilRef = useRef<number>(0);
  const hoveredStructureIdRef = useRef<string | null>(null);
  const structuresRef = useRef<VillageStructure[]>([]);
  const userRef = useUserDataRef(() => positionChangedRef.current());
  const positionChangedRef = useRef(() => {});
  const lastAutoAttackTimeRef = useRef<number | null>(null);
  // Mirror the attack-pending flag into a ref so the render loop's click guard
  // can read it without the flag being a scene-build effect dependency (which
  // would tear down and rebuild the whole 3x3 world on every attack).
  const isAttackingRef = useRef<boolean>(false);
  // Same for the NPC-interaction flag: the click guard reads it from a ref so a
  // pending interaction never rebuilds the world.
  const isInteractingRef = useRef<boolean>(false);
  const pendingCrossRef = useRef<SectorMapEdge | null>(null);
  // One logical grid over the whole 3x3 window, so paths and hover highlights
  // cross sector borders as if the world were a single map
  // Account/quest refreshes leave map topology unchanged. Scene readiness must not rebuild this grid.
  const windowNav = useMemo(
    () => buildWindowNav(sectorWindow.sectors, 10),
    [sectorWindow.sectors],
  );
  const windowNavRef = useRef(windowNav);
  windowNavRef.current = windowNav;
  // Incremented whenever a completed crossing changes the window center, so
  // stale async window patches cannot win a race against the latest crossing.
  // The character's live tile during walk animations; authoritative for
  // scene rebuilds that land mid-walk (userData only updates on completion)
  const animatedPositionRef = useRef<{ x: number; y: number } | null>(null);
  const pendingWorldTargetRef = useRef<{ sector: number; x: number; y: number } | null>(
    null,
  );
  const walkAnimatingRef = useRef(false);
  const motionStepsRef = useRef(new Map<string, TravelMotionStep>());
  /** Unique walk ownership survives cancellation while an earlier callback is still awaiting sleep. */
  const remoteWalksRef = useRef(new Map<string, symbol>());
  /** Announced players missing from the snapshot; a burst resolves through one narrow read. */
  const arrivalsRef = useRef({
    wanted: new Set<string>(),
    queued: new Set<string>(),
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const movePendingRef = useRef(false);
  const moveTargetRef = useRef<TravelSnapshot["routeTarget"]>(null);
  const mountedRef = useRef(true);
  // Client-authoritative sector id: updated imperatively the moment a
  // crossing commits (the prop lags a render behind), synced on prop change
  const sectorRef = useRef(sector);
  useEffect(() => {
    sectorRef.current = sector;
  }, [sector]);
  const routeTargetRef = useRef<TravelSnapshot["routeTarget"]>(
    target ? { sector, ...target } : null,
  );
  /** Qualify a selected tile before crossings advance the sector ahead of React's props. */
  const setTarget = (point: SectorPoint | null) => {
    if (point) travel.scene.current?.recenter();
    routeTargetRef.current = point ? { sector: sectorRef.current, ...point } : null;
    continueMovement();
  };
  const pendingNpcInteractRef = useRef<{
    placementId: string;
    positionVersion: number;
    copy: number;
  } | null>(null);
  /** Reachable tiles per roaming NPC anchor, for live tiles in prompts and taps. */
  const wanderSpotsRef = useRef(new Map<string, WanderTile[]>());
  /** Interactive NPCs where they stand now; ambient ones are scenery and never prompt. */
  const liveNpcs = () =>
    liveNpcTiles(
      (data?.overworldAis ?? []).filter((npc) => npc.npcInteractionType !== "AMBIENT"),
      sectorMap,
      Date.now() - timeDiffRef.current,
      wanderSpotsRef.current,
    );
  // Mirror of `npcDialog` for the long-lived scene click closure, so a new NPC interaction can't
  // overwrite `pendingNpcInteractRef` (and mis-target the open dialog's next branch click) while a
  // dialog is up. Continuing the current dialog uses `interactNpc` directly, so it stays unblocked.
  const npcDialogRef = useRef(npcDialog);
  const lastPromptedPlacementIdRef = useRef<string | null>(null);
  // Latest window data for imperative journey/scene code: click handlers and
  // crossings outlive the render that created them
  const sectorWindowRef = useRef(sectorWindow);
  // The terrain + decoration registries are window-level (identical for all 9
  // sectors), so merge the built-ins with the window's DB libraries ONCE per
  // window change rather than rebuilding a fresh Map inside every per-sector
  // draw. Mirrored to refs for the imperative build/nav functions below.
  const mergedTerrains = useMemo(
    () => mergeTerrainSpecs(sectorWindow.mapTerrains),
    [sectorWindow.mapTerrains],
  );
  const mergedDecorations = useMemo(
    () => mergeDecorationAssets(sectorWindow.mapAssets),
    [sectorWindow.mapAssets],
  );
  // Library data is stable across unchanged polls; include its contents so
  // asset/terrain edits cannot reuse geometry built with an older library.
  const libraryVersion = useMemo(
    () => JSON.stringify([sectorWindow.mapAssets, sectorWindow.mapTerrains]),
    [sectorWindow.mapAssets, sectorWindow.mapTerrains],
  );
  // tRPC utility
  const utils = api.useUtils();
  const loadLpcCatalog = props.loadLpcCatalog;
  const openRewardChoice = useOpenRewardChoice();

  // Data from db
  const {
    data: profile,
    pusher,
    timeDiff,
    updateUser,
    prepareUserUpdate,
  } = useRequiredUserDataSelector(selectUserWithoutPosition);
  const userData = profile ? userRef.current : undefined;
  const { prepareSectorUpdate, updateSector, isSectorFetching, addArrivals } =
    useSectorCacheUpdate(props.sector);
  const { prepareInventoryUpdate, updateInventory, invalidateInventory } =
    useInventoryCacheUpdate();
  const appearanceSignature = useMemo(
    () => JSON.stringify(resolveSpriteAppearance(userData ?? {})),
    [userData],
  );
  const lastAppearanceSignature = useRef<string | null>(null);
  // Only a changed visual recipe refetches sector art; unrelated user stat patches do not.
  useEffect(() => {
    const previous = lastAppearanceSignature.current;
    lastAppearanceSignature.current = appearanceSignature;
    if (previous !== null && previous !== appearanceSignature)
      void utils.travel.getSectorData.invalidate({ sector });
  }, [appearanceSignature, sector, utils]);
  timeDiffRef.current = timeDiff;
  const [lightingPreviewDate, setLightingPreviewDate] = useState<Date | null>(null);
  const lightingPreviewRef = useRef<Date | null>(null);
  const [weatherPreview, setWeatherPreview] = useState<WorldWeather | null>(null);
  const weatherPreviewRef = useRef<typeof weatherPreview>(null);
  // The render loop reads only an authorized local preview; gameplay keeps the server clock.
  lightingPreviewRef.current = isStaffRole(userData?.role) ? lightingPreviewDate : null;
  weatherPreviewRef.current = isStaffRole(userData?.role) ? weatherPreview : null;
  const { data } = api.travel.getSectorData.useQuery(
    { sector: sector },
    {
      // Prepare an uncached destination offscreen, then sleep until its scene is visible.
      enabled: (query) => props.isActive || query.state.data === undefined,
      placeholderData: (previous) => previous,
      notifyOnChangeProps: ["data"],
      // Keep own vitals/appearance and all other presence reactive; own coordinates come from the scene.
      select: (data) => {
        const own = data.users?.find((user) => user.userId === profile?.userId);
        const viewer = own
          ? (({ longitude, latitude, location, updatedAt, ...info }) => info)(own)
          : undefined;
        return {
          ...data,
          viewer,
          users: data.users?.filter((user) => user.userId !== profile?.userId),
        };
      },
      // Recover missed presence events only while the sector is visible.
      refetchInterval: props.isActive ? 10_000 : false,
      // A confirmed movement patch is fresh for the same window as the presence poll.
      staleTime: 10_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: props.isActive,
      refetchOnReconnect: props.isActive,
    },
  );
  useVillageDutyPursuit({
    sector,
    enabled: props.isActive && !!data?.patrolThreat && profile?.status === "AWAKE",
    protectors: data?.protectors ?? [],
    startedAt: data?.patrolShiftAt,
    revision: data?.patrolRevision,
  });
  const villageData = data?.village;
  /** Combines player records and overworld AIs for the shared sector-user rendering path. */
  const fetchedUsers = useMemo(() => {
    if (data?.users === undefined) return undefined;
    const own = userRef.current;
    const viewer =
      data.viewer && own && own.sector === sector
        ? [
            {
              ...data.viewer,
              longitude: own.longitude,
              latitude: own.latitude,
              location: own.location,
              updatedAt: own.updatedAt,
            },
          ]
        : [];
    return [
      ...data.users,
      ...(data.overworldAis ?? []),
      ...(data.protectors ?? []),
      ...viewer,
    ];
  }, [
    data?.users,
    data?.viewer,
    data?.overworldAis,
    data?.protectors,
    profile,
    sector,
  ]);
  const warData = data?.warData;
  const {
    data: sectorDungeons,
    onContentUpdated: refreshDungeonEntrances,
    onContentSubscribed: recoverDungeonEntrances,
  } = useDungeonAvailability(
    sector,
    props.isActive && userData?.sector === sector,
    timeDiff,
  );
  const dungeonStructures = useMemo(
    () =>
      (sectorDungeons ?? []).map((d) => ({
        ...createGenericStructure({
          name: d.content.name,
          route: "/dungeon",
          image:
            sectorWindow.mapAssets.find(
              (asset) => asset.id === d.content.structureAssetId,
            )?.imageUrl ??
            WAR_SHRINE_IMAGE_BY_BIOME[
              d.content.background === "default"
                ? "ground"
                : d.content.background === "arena"
                  ? "ground"
                  : d.content.background
            ],
          longitude: d.content.longitude,
          latitude: d.content.latitude,
        }),
        id: `dungeon-${d.id}`,
        hasPage: d.content.structureAssetId ? 0 : 1,
      })),
    [sectorDungeons, sectorWindow.mapAssets],
  );
  const firstDungeon = dungeonStructures[0];
  // Add dynamic entrances and the shrine without mutating cached village structures.
  const structures = useMemo(
    () =>
      withSectorShrine(
        [...(villageData?.structures ?? []), ...dungeonStructures],
        sectorMap,
        props.tile.t,
      ),
    [villageData?.structures, sectorMap, props.tile.t, dungeonStructures],
  );
  structuresRef.current = structures;
  const currentServices = structures.filter(
    (structure) =>
      (structure.hasPage || structure.id === currentStructure?.id) &&
      structure.longitude === currentStructure?.longitude &&
      structure.latitude === currentStructure?.latitude,
  );

  // Query for raids in this sector (only when user is in this sector)
  const { data: sectorRaidsData } = api.raids.getAvailableRaids.useQuery(
    { sector: sector },
    { enabled: userData?.sector === sector },
  );
  const activeRaid = sectorRaidsData?.raids?.[0] ?? null;

  const dialogSceneAssetIds = npcDialog
    ? [npcDialog.sceneBackground, ...npcDialog.sceneCharacters].filter(Boolean)
    : [];
  const { data: dialogSceneAssets } = api.gameAsset.getSceneAssets.useQuery(
    { assetIds: dialogSceneAssetIds },
    { enabled: dialogSceneAssetIds.length > 0 },
  );

  const {
    data: publicLocations = [],
    updatePublicLocations,
    recoverPublicLocations,
  } = usePublicQuestLocations(timeDiff, props.isActive);
  // Read current handlers without restarting the subscription when scene activity changes.
  const contentHandlers = useRef({
    updatePublicLocations,
    recoverPublicLocations,
    refreshDungeonEntrances,
    recoverDungeonEntrances,
  });
  contentHandlers.current = {
    updatePublicLocations,
    recoverPublicLocations,
    refreshDungeonEntrances,
    recoverDungeonEntrances,
  };
  useEffect(() => {
    if (!pusher) return;
    const channel = pusher.subscribe("map-content");
    const update = (event: { revision: number }) => {
      if (!Number.isSafeInteger(event.revision) || event.revision < 0) return;
      contentHandlers.current.updatePublicLocations(event.revision);
      void utils.mapAsset.getAll.invalidate();
      contentHandlers.current.refreshDungeonEntrances();
      // Active runs carry their private presentation in the profile snapshot.
      if (userRef.current?.userQuests.some((entry) => !entry.completed && !entry.endAt))
        void utils.profile.getUser.invalidate();
    };
    /** Recover current public scenery and dungeon availability after subscription reconnects. */
    const recover = () => {
      contentHandlers.current.recoverPublicLocations();
      contentHandlers.current.recoverDungeonEntrances();
    };
    channel.bind("updated", update);
    channel.bind("pusher:subscription_succeeded", recover);
    return () => {
      channel.unbind("updated", update);
      channel.unbind("pusher:subscription_succeeded", recover);
      pusher.unsubscribe("map-content");
    };
  }, [pusher, utils]);
  // Quest locations read only quest progress, the sector and the role; the profile object
  // itself changes on every step, and a new list rebuilds the travel window.
  const userQuests = userData?.userQuests;
  const questData = userData?.questData;
  const userSector = userData?.sector;
  const userRole = userData?.role;
  const questLocations = useMemo<MapLocation[]>(
    () => [
      ...(userQuests && userSector !== undefined && userRole
        ? getQuestMapLocations(
            {
              userQuests,
              questData: questData ?? null,
              sector: userSector,
              role: userRole,
            },
            publicLocations,
            data?.questPlacements ?? [],
          )
        : []),
      ...(sectorDungeons ?? [])
        .filter((d) => d.content.structureAssetId)
        .map((d) => ({
          id: `dungeon:${d.id}`,
          sector: d.content.sector,
          longitude: d.content.longitude,
          latitude: d.content.latitude,
          name: d.content.name,
          description: d.content.description,
          assetId: d.content.structureAssetId,
          scale: d.content.structureScale ?? 1,
        })),
    ],
    [
      userQuests,
      questData,
      userSector,
      userRole,
      publicLocations,
      sectorDungeons,
      data?.questPlacements,
    ],
  );
  const questLocationsRef = useRef(questLocations);
  questLocationsRef.current = questLocations;
  const structureObjectiveIdsRef = useRef(new Set<string | undefined>());
  structureObjectiveIdsRef.current = new Set(
    questLocations.filter((l) => l.active).map((l) => l.objectiveId),
  );
  const [hoveredLocationId, setHoveredLocationId] = useState<string | null>(null);
  const hoveredLocationIdRef = useRef<string | null>(null);
  const [inspectLocationId, setInspectLocationId] = useState<string | null>(null);
  const inspectTriggerRef = useRef<HTMLButtonElement>(null);
  const locationGroups = useMemo(
    () => groupMapLocations(questLocations.filter((l) => l.sector === sector)),
    [questLocations, sector],
  );
  const hoveredLocation = questLocations.find(
    (l) => l.id === hoveredLocationId && l.sector === sector,
  );
  const [arrivedLocations, setArrivedLocations] = useState<MapLocation[]>([]);
  const arrivedLocationsRef = useRef(arrivedLocations);

  useEffect(() => {
    if (
      inspectLocationId &&
      !arrivedLocations.some((location) => location.id === inspectLocationId)
    )
      setInspectLocationId(null);
  }, [inspectLocationId, arrivedLocations]);
  const inspectedLocations = locationGroups.find((entries) =>
    entries.some((l) => l.id === inspectLocationId),
  );

  // Router for forwarding
  const router = useRouter();

  // Movement based on ASDQWE keys
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (!isActiveRef.current || isTravelKeyBlocked(event)) return;
    if (originRef.current && pathFinderRef.current) {
      const x = originRef.current.col;
      const y = originRef.current.row;
      switch (event.key) {
        // Up & Down
        case "w":
          setTarget({ x: x, y: y + 1 });
          break;
        case "s":
          setTarget({ x: x, y: y - 1 });
          break;
        // High left & right
        case "q":
          setTarget({ x: x - 1, y: x % 2 === 0 ? y : y + 1 });
          break;
        case "e":
          setTarget({ x: x + 1, y: x % 2 === 0 ? y : y + 1 });
          break;
        // Low left & right
        case "a":
          setTarget({ x: x - 1, y: x % 2 === 0 ? y - 1 : y });
          break;
        case "d":
          setTarget({ x: x + 1, y: x % 2 === 0 ? y - 1 : y });
          break;
      }
    }
  };

  const { mutate: checkQuest } = api.quests.checkLocationQuest.useMutation({
    onMutate: () => ({
      userRevision: prepareUserUpdate(),
      inventory: prepareInventoryUpdate(),
    }),
    onSuccess: async (result, _input, context) => {
      if (result.success) {
        // Push any notifications
        result.notifications.forEach((notification) => {
          const isCancellation = notification.startsWith(GATHERING_CANCEL_PREFIX);
          showMutationToast({
            success: !isCancellation,
            message: notification,
          });
        });
        // Profile recovery can settle additional item rewards, so it also requires inventory recovery.
        const profileApplied =
          result.questData && result.updateAt
            ? await updateUser(
                { questData: result.questData, updatedAt: result.updateAt },
                { revision: context.userRevision },
              )
            : false;
        if (result.itemsChanged) {
          await updateInventory(
            profileApplied
              ? (rows) => getInventoryQuantities(rows, result.inventoryChanges)
              : undefined,
            context.inventory,
          );
        }
      }
      // If there are any quest ids that have been updated,
      // let's see if we should show a modal with new objective for consecutive quests.
      // The tutorial presents its own quest's dialogs in the assistant panel.
      if (result.questIdsUpdated && !isTutorialActive(userData)) {
        const questId = findConsecutiveQuestId(
          userData?.userQuests,
          result.questIdsUpdated,
        );
        if (questId) setLogbookModalQuestId(questId);
      }
    },
  });

  /** Publish only a real path edge; a newer edge owns cleanup if movement callbacks overlap. */
  const publishMotionStep = (
    userId: string,
    from: TravelMotionStep["from"],
    to: TravelMotionStep["to"],
    heading: ReturnType<typeof worldMotionHeading>,
  ) => {
    if (from.sector === to.sector && from.x === to.x && from.y === to.y) return null;
    const step = { from, to, ...heading, startedAt: performance.now() };
    motionStepsRef.current.set(userId, step);
    return step;
  };

  /** Copy the live user list into React while something displays or acts on it. */
  const publishSurroundings = () => {
    if (publishSurroundingsRef.current) setSorrounding([...usersRef.current]);
  };

  /** Mark this sector's presence stale; a visible scene rereads its whole snapshot. */
  const reloadSectorPresence = () =>
    void utils.travel.getSectorData.invalidate(
      { sector: sectorRef.current },
      { refetchType: isActiveRef.current ? "active" : "none" },
    );

  /** Resolve the queued newcomers that the snapshot still lacks and add them to it. */
  const flushArrivals = async () => {
    const arrivals = arrivalsRef.current;
    arrivals.timer = undefined;
    const sector = sectorRef.current;
    if (!isActiveRef.current || sector !== props.sector) {
      // A hidden or crossing scene reads its snapshot when it is shown.
      arrivals.queued.clear();
      arrivals.wanted.clear();
      return reloadSectorPresence();
    }
    // An unfinished snapshot read may predate the arrivals; resolve them after it settles.
    if (isSectorFetching()) {
      arrivals.timer = setTimeout(() => void flushArrivals(), SECTOR_ARRIVAL_BATCH_MS);
      return;
    }
    // The live list, not the snapshot: a player who left and returned has a stale snapshot row.
    const shown = new Set(usersRef.current.map((u) => u.userId));
    const queued = [...arrivals.queued];
    arrivals.queued.clear();
    const userIds: string[] = [];
    for (const userId of queued) {
      if (shown.has(userId)) arrivals.wanted.delete(userId);
      else if (userIds.length < SECTOR_ARRIVAL_BATCH_LIMIT) userIds.push(userId);
      else arrivals.queued.add(userId);
    }
    if (arrivals.queued.size > 0) {
      arrivals.timer = setTimeout(() => void flushArrivals(), SECTOR_ARRIVAL_BATCH_MS);
    }
    if (userIds.length === 0) return;
    const snapshot = prepareSectorUpdate();
    if (snapshot.query.revision === undefined) {
      for (const userId of userIds) arrivals.wanted.delete(userId);
      return reloadSectorPresence();
    }
    try {
      const users = await utils.client.travel.getSectorUsers.query({ sector, userIds });
      // Players who left while the read was pending stay off the map.
      const arrived = users.filter((user) => arrivals.wanted.has(user.userId));
      for (const userId of userIds) arrivals.wanted.delete(userId);
      if (!mountedRef.current || sectorRef.current !== sector) return;
      const positions = new Map(
        usersRef.current.map((user) => [
          user.userId,
          { longitude: user.longitude, latitude: user.latitude },
        ]),
      );
      await addArrivals(snapshot, arrived, positions);
    } catch {
      for (const userId of userIds) arrivals.wanted.delete(userId);
      reloadSectorPresence();
    }
  };

  /**
   * Queue an announced player the snapshot lacks. Only the statuses the snapshot shows can
   * add a player, so other broadcasts, such as a global traveller's departure, read nothing.
   */
  const requestArrival = (data: UserData) => {
    if (!isSectorPresenceStatus(data.status)) return;
    const arrivals = arrivalsRef.current;
    if (arrivals.wanted.has(data.userId)) return;
    arrivals.wanted.add(data.userId);
    arrivals.queued.add(data.userId);
    arrivals.timer ??= setTimeout(() => void flushArrivals(), SECTOR_ARRIVAL_BATCH_MS);
  };

  /** Forget a pending arrival for a player who left or hid. */
  const cancelArrival = (userId: string) => {
    arrivalsRef.current.wanted.delete(userId);
    arrivalsRef.current.queued.delete(userId);
  };

  // Convenience method for updating user list
  const updateUsersList = async (
    data: UserData,
    instantMove = false,
    skipStateUpdate = false,
  ) => {
    // The own marker is animated exclusively by the walk loop (per-step
    // instant updates); pathfinding it here would walk it across the map
    // whenever a stale snapshot or sync effect supplies old coordinates
    if (data.userId && data.userId === userRef.current?.userId) {
      instantMove = true;
    }
    if (data.userId) {
      // Filter out stealthed users (defense in depth - server should already filter these)
      // Only filter if it's not the current user (user should always see themselves)
      // Uses isUserCurrentlyStealthed to check expiry, mirroring server-side logic
      if (isUserCurrentlyStealthed(data) && data.userId !== userData?.userId) {
        // Remove from local users list if they went stealth
        cancelArrival(data.userId);
        const idx = usersRef.current.findIndex((u) => u.userId === data.userId);
        if (idx !== -1) {
          usersRef.current.splice(idx, 1);
          actorRevisionRef.current++;
          if (!skipStateUpdate) publishSurroundings();
        }
        return;
      }

      const allianceStatus =
        usersRef.current.find((u) => u.userId === data.userId)?.allianceStatus ??
        mapAttackRelation(userData, data, warData);
      const idx = usersRef.current.findIndex((u) => u.userId === data.userId);
      if (idx !== -1 && usersRef.current[idx]) {
        if (instantMove) {
          // User exists - instant movement, which also ends any walk in progress
          if (remoteWalksRef.current.delete(data.userId))
            motionStepsRef.current.delete(data.userId);
          usersRef.current[idx] = {
            ...usersRef.current[idx],
            ...data,
            allianceStatus,
            experience: data.experience ?? usersRef.current[idx].experience,
            rank: data.rank ?? usersRef.current[idx].rank,
          };
        } else {
          // User exists - animate movement
          const currentHex = findHex(gridRef.current, {
            x: usersRef.current[idx]?.longitude ?? 0,
            y: usersRef.current[idx]?.latitude ?? 0,
          });
          const targetHex = findHex(gridRef.current, {
            x: data.longitude,
            y: data.latitude,
          });
          if (pathFinderRef.current && currentHex && targetHex) {
            const path = pathFinderRef.current.getShortestPath(currentHex, targetHex);
            if (path) {
              const heading = worldMotionHeading(currentHex, targetHex);
              const walks = remoteWalksRef.current;
              const walk = Symbol();
              walks.set(data.userId, walk);
              for (const tile of path) {
                // The list changes while a walk sleeps: others leave and arrive, and a newer
                // move or this user's departure ends the walk.
                const index = usersRef.current.findIndex(
                  (u) => u.userId === data.userId,
                );
                const before = usersRef.current[index];
                if (!before || walks.get(data.userId) !== walk) break;
                if (!isActiveRef.current) {
                  // A retained scene keeps the destination without animating hidden tiles.
                  await updateUsersList(data, true, true);
                  break;
                }
                const motion = publishMotionStep(
                  data.userId,
                  { sector: data.sector, x: before.longitude, y: before.latitude },
                  { sector: data.sector, x: tile.col, y: tile.row },
                  heading,
                );
                usersRef.current[index] = {
                  ...before,
                  ...data,
                  avatar: before.avatar,
                  avatarLight: before.avatarLight,
                  username: before.username,
                  experience: data.experience ?? before.experience,
                  rank: data.rank ?? before.rank,
                  allianceStatus,
                  longitude: tile.col,
                  latitude: tile.row,
                };
                actorRevisionRef.current++;
                await sleep(SECTOR_WALK_STEP_MS);
                if (motion && motionStepsRef.current.get(data.userId) === motion)
                  motionStepsRef.current.delete(data.userId);
              }
              if (walks.get(data.userId) === walk) walks.delete(data.userId);
            }
          }
        }
      } else if (data.userId !== userRef.current?.userId) {
        // New identities come from the authenticated, masked sector reads. The viewer's
        // own marker comes from the snapshot's merge, which an arrival read cannot change.
        requestArrival(data);
      }
      // Remove users who are no longer in the sector; compare against the
      // live sector ref, which crossings advance before the prop catches up.
      // The viewer stands wherever the map is, whatever sector its profile last recorded.
      usersRef.current = usersRef.current.filter(
        (user) =>
          user.userId === userRef.current?.userId || user.sector === sectorRef.current,
      );
    }
    actorRevisionRef.current++;
    // Only update state if not explicitly skipped (to avoid excessive updates during animation)
    if (!skipStateUpdate) publishSurroundings();
  };

  /** Stand the own marker on a tile instantly; state publishes when the walk settles. */
  const placeOwnMarker = (hex: TerrainHex, sector: number, location: string) => {
    originRef.current = hex;
    animatedPositionRef.current = { x: hex.col, y: hex.row };
    void updateUsersList(
      {
        ...userData,
        sector,
        longitude: hex.col,
        latitude: hex.row,
        location,
      } as UserData,
      true,
      true,
    );
  };

  /** Client-side quest triggers after arriving at a position */
  const runQuestTriggers = (
    data: {
      sector: number;
      longitude: number;
      latitude: number;
    },
    forceCheck = false,
  ) => {
    const userData = userRef.current;
    if (!userData) return;
    const { shouldCheckQuest, dialogQuestIds } = getArrivalQuestTriggers(
      userData,
      data,
    );
    for (const questId of dialogQuestIds) setLogbookModalQuestId(questId);
    if (shouldCheckQuest || forceCheck) checkQuest();
  };

  /** Animate the marker tile-by-tile along a path, keeping the camera on it */
  const animateWalk = async (
    path: NonNullable<ReturnType<PathCalculator["getShortestPath"]>>,
    location: string,
  ) => {
    const first = path[0],
      last = path.at(-1);
    if (!userData || !first || !last) return;
    walkAnimatingRef.current = true;
    const heading = worldMotionHeading(first, last);
    for (const tile of path) {
      if (!mountedRef.current || !canAttemptAwakeAction(userRef.current)) break;
      const before = animatedPositionRef.current ?? {
        x: userData.longitude,
        y: userData.latitude,
      };
      const motion = publishMotionStep(
        userData.userId,
        { sector: sectorRef.current, ...before },
        { sector: sectorRef.current, x: tile.col, y: tile.row },
        heading,
      );
      placeOwnMarker(tile, sectorRef.current, location);
      await sleep(SECTOR_WALK_STEP_MS);
      if (motion && motionStepsRef.current.get(userData.userId) === motion)
        motionStepsRef.current.delete(userData.userId);
    }
    walkAnimatingRef.current = false;
  };

  /**
   * Re-anchor the character into an already-rendered window sector (no server
   * round trip): re-point the grid/pathfinder and the marker layer,
   * follow the camera, background and hover-highlight into it.
   */
  const reAnchorToSector = (sector: number, col: number, row: number): boolean => {
    const registry = travel.scene.current;
    const wrapper = registry?.sectors.get(sector);
    const grid = registry?.sectors.get(sector)?.grid;
    if (!wrapper || !grid) return false;
    sectorRef.current = sector;
    gridRef.current = grid;
    pathFinderRef.current = new PathCalculator(grid);
    originRef.current = grid.getHex({ col, row });
    animatedPositionRef.current = { x: col, y: row };
    // The hover path follows the character into the new sector; any tiles
    // lit in the old window (across all sectors) are cleared so a stale
    // window offset can't leave an orphaned highlight behind
    clearAllHighlights();
    const map = sectorWindowRef.current.sectors.find(
      (candidate) => candidate.sector === sector,
    )?.map;
    if (map) registry?.setBackground(map);
    return true;
  };

  /**
   * Animate the marker along a path expressed in unified window coordinates,
   * re-anchoring into each sector as the path crosses a border - so a
   * cross-border walk plays as one continuous motion with no pause.
   */
  const animateWindowPath = async (
    unifiedPath: NonNullable<ReturnType<PathCalculator["getShortestPath"]>>,
    location: string,
  ) => {
    const nav = windowNavRef.current;
    const first = unifiedPath[0],
      last = unifiedPath.at(-1);
    if (!userData || !nav || !first || !last) return;
    walkAnimatingRef.current = true;
    const heading = worldMotionHeading(first, last);
    // Keep the origin for heading, but only animate tiles ahead of the actor.
    for (const unifiedTile of unifiedPath.slice(1)) {
      if (!mountedRef.current || !canAttemptAwakeAction(userRef.current)) break;
      const before = {
        sector: sectorRef.current,
        ...(animatedPositionRef.current ?? {
          x: userData.longitude,
          y: userData.latitude,
        }),
      };
      const local = nav.fromUnified(unifiedTile);
      const sector = nav.sectorAt(local.dx, local.dy);
      if (sector === undefined) break;
      if (sector !== sectorRef.current) {
        if (!reAnchorToSector(sector, local.col, local.row)) break;
      }
      const hex = gridRef.current?.getHex({ col: local.col, row: local.row });
      if (!hex) continue;
      const motion = publishMotionStep(
        userData.userId,
        before,
        { sector, x: local.col, y: local.row },
        heading,
      );
      placeOwnMarker(hex, sector, location);
      await sleep(SECTOR_WALK_STEP_MS);
      if (motion && motionStepsRef.current.get(userData.userId) === motion)
        motionStepsRef.current.delete(userData.userId);
    }
    walkAnimatingRef.current = false;
  };

  /**
   * Animate one leg of a journey and pipeline what follows it: a border
   * crossing (carrying the landing tile when the click was in the adjacent
   * sector) is requested while the steps animate, so its round trip is
   * hidden behind the walk and the border costs no extra pause.
   */
  const runJourneySegment = async (
    data: {
      sector: number;
      longitude: number;
      latitude: number;
      location: string;
    },
    walk: Promise<void>,
    mutation: UserUpdateOptions,
    requestTarget: TravelSnapshot["routeTarget"],
  ): Promise<void> => {
    if (!userData || !mountedRef.current) return;
    // The crossing round trip is fired while the steps animate. When the
    // clicked tile lies in the sector across this border, the character keeps
    // walking straight across it CLIENT-SIDE the instant it reaches the edge,
    // and the server response is reconciled in the background - so the border
    // never stalls the animation.
    let crossingPromise: ReturnType<typeof moveStepAsync> | null = null;
    let crossDest: { sector: number; x: number; y: number } | null = null;
    const cross = pendingCrossRef.current;
    if (isActiveRef.current && cross && routeTargetRef.current === requestTarget) {
      if (
        isOnSectorMapEdge(sectorMap, cross, { x: data.longitude, y: data.latitude })
      ) {
        pendingCrossRef.current = null;
        const dest = peekPendingCrossDestination(cross);
        const pending = pendingWorldTargetRef.current;
        if (dest && pending)
          crossDest = { sector: pending.sector, x: dest.x, y: dest.y };
        crossingPromise = moveStepAsync(
          buildCrossingPayload(cross, { x: data.longitude, y: data.latitude }, dest),
        );
        // Attach a rejection handler immediately; handleCrossing awaits the
        // original promise after the walk and lets the movement error handler recover.
        void crossingPromise.catch(() => undefined);
      }
    }
    // onMutate already started this walk; crossing requests may overlap it
    // only after the preceding move has committed.
    await walk;
    if (!mountedRef.current) {
      // Finish any pre-fired crossing before onSettled refreshes the profile.
      await crossingPromise?.catch(() => undefined);
      return;
    }
    if (crossingPromise) {
      await handleCrossing(
        crossingPromise,
        crossDest,
        { x: data.longitude, y: data.latitude },
        data.location,
        mutation,
        requestTarget,
      );
      return;
    }
    // Reconcile even when a stale client map could not animate a path.
    snapMovementPosition(data);
    // Update all state only once at the end to avoid excessive re-renders
    setPosition({ x: data.longitude, y: data.latitude });
    await commitMovePosition(
      {
        sector: data.sector,
        location: data.location,
        longitude: data.longitude,
        latitude: data.latitude,
      },
      mutation,
    );
    // Update surrounding users state at the end
    publishSurroundings();
    runQuestTriggers(data);
  };

  // Crossing steps that are pre-fired during walk animations resolve
  // through this handler-less mutation; their responses are applied via
  // applyCrossing exactly when the local animation reaches the border
  const moveStepAsync = useSceneMutation({
    mutationKey: getMutationKey(api.travel.moveInSector),
    mutationFn: (input: RouterInputs["travel"]["moveInSector"]) =>
      utils.client.travel.moveInSector.mutate(input),
    meta: { handlesTransportError: true },
    onSuccess: async (result) => {
      if (result.success && result.data) showActionReadinessToast(result);
    },
  });

  /**
   * Assemble the travel.moveInSector input for a single step from `from` to
   * `dest` within `sectorId`, including the avatar/identity fields the server
   * broadcasts to other clients. The avatar falls back to IMG_AVATAR_DEFAULT
   * so users without a custom avatar can still move.
   */
  const buildStepPayload = (
    from: SectorPoint,
    dest: SectorPoint,
    sectorId: number,
  ) => ({
    curLongitude: from.x,
    curLatitude: from.y,
    longitude: dest.x,
    latitude: dest.y,
    sector: sectorId,
    avatar: userData?.avatar || IMG_AVATAR_DEFAULT,
    avatarLight: userData?.avatarLight || userData?.avatar || IMG_AVATAR_DEFAULT,
    villageId: userData?.villageId ?? null,
    battleId: userData?.battleId ?? null,
    username: userData?.username ?? "",
    level: userData?.level ?? 0,
  });

  /**
   * Build a moveInSector payload that targets a tile ONE step beyond the
   * border (an out-of-range coordinate like y=-1 or x=map.width), which the
   * server resolves as a sector crossing rather than an in-sector move. An
   * optional `dest` rides along as destLongitude/destLatitude so the crossing
   * lands directly on the clicked tile in the adjacent sector.
   */
  const buildCrossingPayload = (
    direction: SectorMapEdge,
    from: SectorPoint,
    dest?: SectorPoint | null,
  ) => {
    return {
      ...buildStepPayload(
        from,
        beyondSectorMapEdge(sectorMap, direction, from),
        sectorRef.current,
      ),
      ...(dest ? { destLongitude: dest.x, destLatitude: dest.y } : {}),
    };
  };

  /**
   * When the clicked world target lies in the sector directly across the
   * given border, it can ride along as the crossing's landing tile so no
   * separate resume move is needed. The pending ref stays set until the
   * crossing lands (applyCrossing routing clears it), keeping the journey
   * marked active until its sector data is ready.
   */
  const peekPendingCrossDestination = (
    direction: SectorMapEdge,
  ): SectorPoint | null => {
    const pending = pendingWorldTargetRef.current;
    if (!pending) return null;
    const window = sectorWindowRef.current;
    const current = window.sectors.find(
      (candidate) => candidate.sector === sectorRef.current,
    );
    if (!current) return null;
    const { dx, dy } = sectorMapEdgeOffset(direction);
    const adjacent = window.sectors.find(
      (candidate) =>
        candidate.dx === current.dx + dx && candidate.dy === current.dy + dy,
    );
    if (!adjacent || adjacent.sector !== pending.sector) return null;
    return { x: pending.x, y: pending.y };
  };

  /**
   * Re-anchor the character into the (already rendered) destination sector
   * at the border entry tile, then animate the server-committed remainder of
   * the walk to the landing tile - all client-side, no further round trips.
   */
  const applyCrossing = async (
    data: {
      sector: number;
      longitude: number;
      latitude: number;
      location: string;
      entryLongitude?: number | null;
      entryLatitude?: number | null;
    },
    mutation: UserUpdateOptions,
    requestTarget: TravelSnapshot["routeTarget"],
  ) => {
    if (!userData) return;
    const hasQueuedTarget = routeTargetRef.current !== requestTarget;
    if (!hasQueuedTarget) pendingCrossRef.current = null;
    sectorRef.current = data.sector;
    const entry = {
      x: data.entryLongitude ?? data.longitude,
      y: data.entryLatitude ?? data.latitude,
    };
    // A rendered destination keeps walking in its frame, with no scene rebuild.
    const anchored = reAnchorToSector(data.sector, entry.x, entry.y);
    if (anchored) {
      // Place the marker at the entry tile instantly: the userData sync
      // effect would otherwise ANIMATE it from the old edge coordinates,
      // which sit at the far side of the new sector's frame
      void updateUsersList(
        {
          ...userData,
          sector: data.sector,
          longitude: entry.x,
          latitude: entry.y,
          location: data.location,
        } as UserData,
        true,
        true,
      );
    } else {
      // Destination not in the rendered window (rapid multi-cross):
      // resume when the new window arrives
      originRef.current = undefined;
    }
    setPosition({ x: data.longitude, y: data.latitude });
    // Route onward or re-point the target NOW: any await below yields to
    // the movement effect, which must never see the pre-crossing target
    // coordinates against the new sector's grid
    const pendingTarget = pendingWorldTargetRef.current;
    // Queued tiles retain their sector; continueMovement routes them from the committed landing.
    if (!hasQueuedTarget && pendingTarget) {
      // Continue toward the clicked tile; offsets are recomputed relative
      // to the sector just landed in, so diagonal targets take their
      // second hop instead of stopping here
      const landedEntry = sectorWindowRef.current.sectors.find(
        (candidate) => candidate.sector === data.sector,
      );
      const targetEntry = sectorWindowRef.current.sectors.find(
        (candidate) => candidate.sector === pendingTarget.sector,
      );
      const landedMap = landedEntry?.map;
      if (landedEntry && targetEntry && landedMap) {
        routeTowardWorldTarget(
          pendingTarget,
          { col: data.longitude, row: data.latitude },
          landedMap,
          targetEntry.dx - landedEntry.dx,
          targetEntry.dy - landedEntry.dy,
        );
      } else {
        pendingWorldTargetRef.current = null;
        setTarget(null);
      }
    } else if (!hasQueuedTarget) {
      setTarget({ x: data.longitude, y: data.latitude });
    }
    await commitMovePosition(
      {
        sector: data.sector,
        longitude: data.longitude,
        latitude: data.latitude,
        location: data.location,
      },
      mutation,
    );
    // Walk the committed remainder from the entry tile to the landing tile
    const hasRemainder = data.longitude !== entry.x || data.latitude !== entry.y;
    if (anchored && hasRemainder && originRef.current) {
      const finalHex = findHex(gridRef.current, {
        x: data.longitude,
        y: data.latitude,
      });
      const path = finalHex
        ? pathFinderRef.current?.getShortestPath(originRef.current, finalHex)
        : undefined;
      if (path) {
        await animateWalk(path, data.location);
      } else if (finalHex) {
        // The server committed the landing tile; without a client path,
        // reconcile instantly rather than desync
        placeOwnMarker(finalHex, data.sector, data.location);
      }
      continueMovement();
      publishSurroundings();
    }
    runQuestTriggers(data, true);
  };

  /**
   * Resolve a border crossing. When the clicked tile is in the adjacent
   * sector, the character walks straight across CLIENT-SIDE (via the unified
   * window path) without waiting for the server, and the crossing mutation is
   * reconciled once it returns. Otherwise (multi-hop, or no client path) it
   * falls back to the server-driven re-anchor.
   */
  const handleCrossing = async (
    crossingPromise: ReturnType<typeof moveStepAsync>,
    crossDest: { sector: number; x: number; y: number } | null,
    edge: SectorPoint,
    location: string,
    mutation: UserUpdateOptions,
    requestTarget: TravelSnapshot["routeTarget"],
  ) => {
    const nav = windowNavRef.current;
    // Every cylindrical-grid neighbor is aligned, so a click into an adjacent
    // sector can animate across the border without a scene rebuild. Rapid
    // crossings can leave the window centered elsewhere, so the edge sits at
    // its own sector's offset rather than the center's.
    if (crossDest && nav) {
      const here = nav.offsetOf(sectorRef.current);
      const destOffset = nav.offsetOf(crossDest.sector);
      const startU = here && nav.toUnified(here.dx, here.dy, edge.x, edge.y);
      const goalU = destOffset
        ? nav.toUnified(destOffset.dx, destOffset.dy, crossDest.x, crossDest.y)
        : undefined;
      const navPath =
        startU && goalU ? nav.pathFinder.getShortestPath(startU, goalU) : undefined;
      if (navPath && navPath.length > 1) {
        const isCurrentTarget = routeTargetRef.current === requestTarget;
        if (isCurrentTarget) {
          routeTargetRef.current = crossDest;
          pendingWorldTargetRef.current = null;
        }
        await animateWindowPath(navPath, location);
        await reconcileCrossing(
          await crossingPromise,
          mutation,
          isCurrentTarget ? crossDest : requestTarget,
        );
        return;
      }
    }
    // Server-driven fallback: wait for the crossing, then re-anchor
    const crossingRes = await crossingPromise;
    if (crossingRes.success && crossingRes.data) {
      await applyCrossing(
        crossingRes.data,
        {
          ...mutation,
          userRecovery: crossingRes.userRecovery ?? mutation.userRecovery,
        },
        requestTarget,
      );
      return;
    }
    await reconcileCrossing(crossingRes, mutation, requestTarget);
  };

  /**
   * Record a committed move in the profile. Moves are serialized, so its tile is the latest
   * position even when another mutation, such as a quest check sent in the same batch,
   * reconciled the profile first and the move's revision no longer matches. Leaving that
   * profile on the old sector would hide the viewer's own marker in the new one.
   */
  const commitMovePosition = async (
    position: { sector: number; longitude: number; latitude: number; location: string },
    mutation: UserUpdateOptions,
  ) => {
    const patch = { ...position, updatedAt: new Date() };
    if (await updateUser(patch, mutation)) return;
    const current = userRef.current;
    if (
      current &&
      (current.sector !== position.sector ||
        current.longitude !== position.longitude ||
        current.latitude !== position.latitude ||
        current.location !== position.location)
    )
      await updateUser(patch);
  };

  /** Restore every movement ref together so the next request uses the server tile. */
  const snapMovementPosition = (data: {
    sector: number;
    longitude: number;
    latitude: number;
    location: UserData["location"];
  }) => {
    if (!userData || !mountedRef.current) return;
    if (data.sector !== sectorRef.current) {
      if (!reAnchorToSector(data.sector, data.longitude, data.latitude)) {
        sectorRef.current = data.sector;
        originRef.current = undefined;
      }
    } else {
      originRef.current = gridRef.current?.getHex({
        col: data.longitude,
        row: data.latitude,
      });
    }
    animatedPositionRef.current = { x: data.longitude, y: data.latitude };
    void updateUsersList({ ...userData, ...data } as UserData, true, true);
  };

  const refreshMovementPosition = async () => {
    pendingCrossRef.current = null;
    pendingWorldTargetRef.current = null;
    setTarget(null);
    await utils.profile.getUser.invalidate();
    if (!mountedRef.current) return;
    const freshUser = utils.profile.getUser.getData()?.userData;
    if (freshUser) {
      snapMovementPosition(freshUser);
      setPosition({ x: freshUser.longitude, y: freshUser.latitude });
      publishSurroundings();
    }
  };

  /** Commit the server result after an optimistic client walk. */
  const reconcileCrossing = async (
    res: Awaited<ReturnType<typeof moveStepAsync>>,
    mutation: UserUpdateOptions,
    requestTarget: TravelSnapshot["routeTarget"],
  ) => {
    if (res.success && res.data) {
      const d = res.data;
      snapMovementPosition(d);
      // A completed request owns only its destination; later clicks must survive reconciliation.
      if (routeTargetRef.current === requestTarget) setTarget(null);
      setPosition({ x: d.longitude, y: d.latitude });
      await commitMovePosition(
        {
          sector: d.sector,
          longitude: d.longitude,
          latitude: d.latitude,
          location: d.location,
        },
        { ...mutation, userRecovery: res.userRecovery ?? mutation.userRecovery },
      );
      publishSurroundings();
      // runQuestTriggers(…, true) issues checkQuest itself
      runQuestTriggers(d, true);
    } else {
      // Attacked (success without data) or rejected: re-sync from the server
      showMutationToast(res);
      if (res.userRecovery) await updateUser(res, { ...mutation, refetch: false });
      await refreshMovementPosition();
    }
  };

  const clearAllHighlights = () => travel.scene.current?.clearHighlights();

  const [isMoving, setMoving] = useState(false);
  const movementUiPending = useRef(false);
  const autoAttackRef = useRef(() => {});
  const publishMovementStatus = (pending: boolean) => {
    const next = pending && !!(arrivalNpc || npcDialog);
    if (next !== movementUiPending.current) {
      movementUiPending.current = next;
      setMoving(next);
    }
  };
  const executeMove = useSceneMutation({
    mutationKey: getMutationKey(api.travel.moveInSector),
    mutationFn: (input: RouterInputs["travel"]["moveInSector"]) =>
      utils.client.travel.moveInSector.mutate(input),
    onMutate: (input) => {
      movePendingRef.current = true;
      publishMovementStatus(true);
      document.body.style.cursor = "wait";
      const targetHex = gridRef.current?.getHex({
        col: input.longitude,
        row: input.latitude,
      });
      const path =
        input.sector === sectorRef.current && originRef.current && targetHex
          ? pathFinderRef.current?.getShortestPath(originRef.current, targetHex)
          : undefined;
      // Returning the promise inside the context lets the request start now.
      // Awaiting it here would put the animation in front of the network call.
      const walk = path
        ? animateWalk(path, userRef.current?.location ?? "")
        : Promise.resolve();
      void walk.catch(() => undefined);
      return {
        walk,
        target: moveTargetRef.current,
        sector: prepareSectorUpdate(),
        userRevision: prepareUserUpdate(),
      };
    },
    onSuccess: async (res, input, context) => {
      if (res.success && res.data) showActionReadinessToast(res);
      const walk = context?.walk ?? Promise.resolve();
      const mutation = {
        revision: context?.userRevision,
        refetch: false,
        userRecovery: res.userRecovery,
      };
      const data = res.data;
      if (!res.success || !data) {
        await walk;
        if (mountedRef.current) await reconcileCrossing(res, mutation, context?.target);
        return;
      }
      if (data.sector !== input.sector) {
        await walk;
        if (mountedRef.current) await applyCrossing(data, mutation, context?.target);
        return;
      }
      if (data.longitude !== input.longitude || data.latitude !== input.latitude) {
        await walk;
        if (mountedRef.current) {
          if (routeTargetRef.current === context?.target) {
            pendingCrossRef.current = null;
            pendingWorldTargetRef.current = null;
          }
          await reconcileCrossing(res, mutation, context?.target);
        }
        return;
      }
      await runJourneySegment(data, walk, mutation, context?.target);
      // Crossings retain their destination read; ordinary movement keeps this exact key current.
      if (userRef.current?.sector === input.sector && context?.sector) {
        await updateSector(true, context.sector);
      }
    },
    onError: async (_error, _input, context) => {
      await context?.walk.catch(() => undefined);
      if (!mountedRef.current) return;
      showMutationToast({
        success: false,
        message: "Could not confirm your move. Please try again.",
      });
      await refreshMovementPosition();
    },
    // React Query stays pending until animation, reconciliation and any
    // crossing finish, preserving the ANBU auto-attack and movement gates.
    onSettled: async () => {
      walkAnimatingRef.current = false;
      movePendingRef.current = false;
      if (mountedRef.current) {
        publishMovementStatus(false);
        document.body.style.cursor = "default";
        continueMovement();
        autoAttackRef.current();
      } else {
        // Navigation can outlive a committed move. Refresh rather than apply an
        // older location over a later action in this account's profile cache.
        await utils.profile.getUser.invalidate();
      }
    },
  });

  const move = (input: Parameters<typeof executeMove>[0]) => {
    // Global mutation guards may yield before onMutate; reserve the move and its selected route now.
    movePendingRef.current = true;
    moveTargetRef.current = routeTargetRef.current;
    void executeMove(input).catch(() => undefined);
  };

  /** Step one tile beyond the border: the server resolves this as a crossing */
  const moveAcrossBorder = (direction: SectorMapEdge, from: SectorPoint) => {
    if (!userData) return;
    const dest = peekPendingCrossDestination(direction);
    move(buildCrossingPayload(direction, from, dest));
  };

  /**
   * Route toward a tile in another sector: walk to the matching border and
   * step across; called again after each crossing until the target sector is
   * reached (relDx/relDy are the target's window offsets relative to where
   * the character currently is).
   */
  const routeTowardWorldTarget = (
    worldTarget: { sector: number; x: number; y: number },
    origin: { col: number; row: number },
    currentMap: NormalizedSectorMap,
    relDx: number,
    relDy: number,
  ) => {
    if (relDx === 0 && relDy === 0) {
      pendingCrossRef.current = null;
      pendingWorldTargetRef.current = null;
      setTarget({ x: worldTarget.x, y: worldTarget.y });
      return;
    }
    const primary =
      relDx > 0 ? "east" : relDx < 0 ? "west" : relDy > 0 ? "north" : "south";
    const along = primary === "north" || primary === "south" ? origin.col : origin.row;
    const edge = findNearestWalkableEdgeTile(
      currentMap,
      primary,
      sectorMapEdgeCell(currentMap, primary, along),
    );
    if (!edge) return;
    pendingWorldTargetRef.current = worldTarget;
    // Even an already-reached edge goes through the movement effect, so a
    // click during an optimistic walk cannot issue an overlapping crossing.
    pendingCrossRef.current = primary;
    setTarget(edge);
  };

  const { mutate: rob, isPending: isRobbing } = api.travel.robPlayer.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      if (result.success || result.battleId || result.userRecovery)
        await updateUser(result, { revision, refetch: false });
      showMutationToast(result);
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
  });

  const { mutate: attack, isPending: isAttacking } = api.combat.attackUser.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      document.body.style.cursor = "default";
      if (data.success) {
        showActionReadinessToast(data);
        await updateUser(data, { revision, refetch: false });
      } else {
        if (data.userRecovery) await updateUser(data, { revision, refetch: false });
        showMutationToast({
          success: false,
          message: data.message,
        });
      }
    },
    onError: () => {
      document.body.style.cursor = "default";
    },
  });

  /** Start a battle with a user standing on the player's tile, in this tile's biome. */
  const attackSectorUser = (target: SectorUser) =>
    attack({
      originSocketId: pusher?.connection.socket_id,
      userId: target.userId,
      longitude: target.longitude,
      latitude: target.latitude,
      sector: sectorRef.current,
      asset: originRef.current?.battleBiome,
    });

  const { mutate: interactNpc, isPending: isInteracting } =
    api.overworldAi.interactWithOverworldAi.useMutation({
      /** Applies battle/dialog results and refreshes state after an overworld NPC interaction. */
      onMutate: prepareUserUpdate,
      onSuccess: async (data, variables, revision) => {
        await updateUser(data, { revision });
        showMutationToast(data);
        // A dialog choice either continues with the NPC's next dialog or ends the conversation.
        if (data.success && data.dialog) {
          setNpcDialog(data.dialog);
        } else if (variables.dialogContentId) {
          setNpcDialog(null);
        }
        if (
          data.success &&
          !data.battleId &&
          (variables.dialogContentId || !data.dialog)
        ) {
          // A claimed objective can pay items and profile rewards; refresh their views now
          // rather than leaving them stale until a page reload.
          void Promise.allSettled([
            invalidateInventory(),
            utils.profile.getDashboard.invalidate(),
            utils.quests.getQuestHistory.invalidate(),
          ]);
        }
        if (!data.success || (!data.battleId && !data.dialog)) {
          // Placements and public quest locations can change with the interaction.
          await utils.travel.getSectorData.invalidate();
        }
        if (data.rewardChoicePending) {
          void openRewardChoice();
        }
      },
      onError: (_error, variables) => {
        // A failed choice must not leave a dialog whose branch may already be spent.
        if (variables.dialogContentId) setNpcDialog(null);
      },
    });

  /**
   * Starts interaction with an overworld NPC on the player's tile.
   * Records the placement version so subsequent dialog requests target the same NPC instance.
   */
  const interactWithNpc = (npc: SectorUser): boolean => {
    // Read through refs: the scene's click handler closes over this callback for the lifetime of the
    // build, so state values would go stale. Skip while a dialog is open so its pending-interaction
    // ref isn't overwritten before the player finishes (or closes) that dialog.
    if (
      movePendingRef.current ||
      isInteractingRef.current ||
      !npc.npcPlacementId ||
      npcDialogRef.current
    )
      return false;
    pendingNpcInteractRef.current = {
      placementId: npc.npcPlacementId,
      positionVersion: npc.npcPositionVersion ?? 0,
      copy: npc.npcCopy ?? 0,
    };
    interactNpc({
      placementId: npc.npcPlacementId,
      positionVersion: npc.npcPositionVersion ?? 0,
      copy: npc.npcCopy ?? 0,
    });
    return true;
  };

  /**
   * Handles an overworld NPC sprite click by interacting when adjacent or routing toward the NPC.
   * Returns whether the placement still resolves to a live NPC, allowing an attack-icon caller
   * to fall through to the normal player-interaction path when its sprite is stale.
   */
  const handleNpcTileInteraction = (
    placementId: string | undefined,
    copy = 0,
  ): boolean => {
    if (!placementId) return false;
    const origin = originRef.current;
    // A roaming group is addressed through whichever member is closest to the player.
    const members = liveNpcs().filter(
      (u) => u.npcPlacementId === placementId && (u.npcCopy ?? 0) === copy,
    );
    const distance = (u: SectorUser) =>
      origin
        ? oddQHexDistance(u.longitude, u.latitude, origin.col, origin.row)
        : Number.POSITIVE_INFINITY;
    const npc = members.sort((a, b) => distance(a) - distance(b))[0];
    if (!npc) {
      // Sprite is stale (placement despawned between scene build and click): refresh the sector so
      // the ghost sprite disappears, and report not-consumed so the caller isn't left with silent
      // no-op feedback.
      void utils.travel.getSectorData.invalidate();
      return false;
    }
    if (distance(npc) <= npcReach(npc)) {
      interactWithNpc(npc);
    } else {
      setTarget({ x: npc.longitude, y: npc.latitude });
    }
    return true;
  };

  // Track mount state and reset the cursor on unmount
  useEffect(() => {
    mountedRef.current = true;
    const arrivals = arrivalsRef.current;
    return () => {
      mountedRef.current = false;
      clearTimeout(arrivals.timer);
      arrivals.timer = undefined;
      arrivals.queued.clear();
      arrivals.wanted.clear();
      document.body.style.cursor = "default";
    };
  }, []);

  // Listen to websocket events for this sector
  useEffect(() => {
    if (pusher) {
      return subscribeSharedChannel(pusher, props.sector.toString(), {
        event: (data: UserData) => {
          if (data.userId && data.userId !== userRef.current?.userId) {
            // A broadcast with another sector means the user left this one
            if (data.sector !== props.sector) {
              cancelArrival(data.userId);
              const idx = usersRef.current.findIndex((u) => u.userId === data.userId);
              if (idx !== -1) {
                usersRef.current.splice(idx, 1);
                actorRevisionRef.current++;
                publishSurroundings();
              }
              return;
            }
            void updateUsersList(data, !isActiveRef.current);
          }
        },
      });
    }
  }, [pusher, props.sector]);

  useEffect(() => {
    showUsersRef.current = showActive;
  }, [showActive]);

  // The canvas click listener lives in the long-lived scene effect, so it
  // reads this from a ref. After the menu closes, keep ignoring clicks long
  // enough to swallow the mobile ghost-click on the map.
  useEffect(() => {
    const wasOpen = showSorroundingRef.current;
    showSorroundingRef.current = props.showSorrounding;
    const mount = mountRef.current;
    if (props.showSorrounding) {
      publishSurroundings();
      if (mount) mount.style.pointerEvents = "none";
      return;
    }
    if (wasOpen) {
      ignoreMapClicksUntilRef.current =
        performance.now() + MAP_CLICK_BLOCK_AFTER_MODAL_MS;
    }
    const timeout = window.setTimeout(
      () => {
        if (mount) mount.style.pointerEvents = "";
      },
      wasOpen ? MAP_CLICK_BLOCK_AFTER_MODAL_MS : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [props.showSorrounding]);

  useEffect(() => {
    isAttackingRef.current = isAttacking;
  }, [isAttacking]);

  useEffect(() => {
    isInteractingRef.current = isInteracting;
  }, [isInteracting]);

  useEffect(() => {
    npcDialogRef.current = npcDialog;
  }, [npcDialog]);

  /** Refresh arrival UI only when the player's actionable surroundings actually change. */
  const updatePositionActions = () => {
    const userData = userRef.current;
    if (!userData) return;
    const live = liveNpcs();
    const arrived = locationGroups
      .filter(
        (entries) =>
          entries[0]?.longitude === userData.longitude &&
          entries[0]?.latitude === userData.latitude,
      )
      .flat();
    if (
      arrived.length !== arrivedLocationsRef.current.length ||
      arrived.some((location, index) => location !== arrivedLocationsRef.current[index])
    ) {
      arrivedLocationsRef.current = arrived;
      setArrivedLocations(arrived);
    }
    if (arrivalNpc) {
      if (
        isArrivalPromptStale({
          promptedPlacementId: npcCopyKey(arrivalNpc),
          npcs: live,
          playerLongitude: userData?.longitude,
          playerLatitude: userData?.latitude,
        })
      ) {
        setArrivalNpc(null);
      }
    }
    if (npcDialog) {
      const pending = pendingNpcInteractRef.current;
      if (
        !pending ||
        isArrivalPromptStale({
          promptedPlacementId: npcCopyKey({
            npcPlacementId: pending.placementId,
            npcCopy: pending.copy,
          }),
          npcs: live,
          playerLongitude: userData?.longitude,
          playerLatitude: userData?.latitude,
        })
      ) {
        setNpcDialog(null);
      }
    }
    const longitude = userData?.longitude;
    const latitude = userData?.latitude;
    if (longitude === undefined || latitude === undefined) return;

    // Keep arrival prompts behind other dialogs and permit explicit recovery-capable
    // interactions. Only the player's chosen action wakes or checks out the character.
    if (
      !isActiveRef.current ||
      isInteracting ||
      !canAttemptAwakeAction(userRef.current) ||
      npcDialog ||
      isBlockingPopupOpen
    )
      return;

    const decision = arrivalPromptDecision({
      playerLongitude: longitude,
      playerLatitude: latitude,
      npcs: live,
      lastPromptedPlacementId: lastPromptedPlacementIdRef.current,
    });
    lastPromptedPlacementIdRef.current = decision.lastPromptedPlacementId;
    if (decision.prompt) setArrivalNpc(decision.prompt);
  };
  positionChangedRef.current = () => {
    updatePositionActions();
    updateCurrentStructure();
  };
  // Roaming NPCs move without new data, so their prompts are rechecked while any are here.
  const hasRoamingNpc = (data?.overworldAis ?? []).some(
    (npc) => npc.npcWander && npc.npcInteractionType !== "AMBIENT",
  );
  useEffect(() => {
    if (!props.isActive || !hasRoamingNpc) return;
    const timer = window.setInterval(() => positionChangedRef.current(), 1000);
    return () => window.clearInterval(timer);
  }, [hasRoamingNpc, props.isActive]);
  useEffect(() => {
    updatePositionActions();
  }, [
    data?.overworldAis,
    locationGroups,
    arrivalNpc,
    npcDialog,
    isInteracting,
    isBlockingPopupOpen,
    userData?.status,
    props.isActive,
  ]);

  // Auto-attack logic for ANBU users
  const maybeAutoAttack = () => {
    const userData = userRef.current;
    if (
      isActiveRef.current &&
      autoAttackMode &&
      userData?.anbuId &&
      userData?.status === "AWAKE" &&
      originRef.current &&
      !movePendingRef.current &&
      !walkAnimatingRef.current &&
      !isAttacking &&
      sector === userData?.village?.sector
    ) {
      // Check if enough time has passed since last attack
      const now = Date.now();
      const lastAttackTime = lastAutoAttackTimeRef.current;
      const attackDelayMs = readAutoAttackSetting(AUTO_ATTACK_SETTINGS.delay) * 1000;

      if (lastAttackTime && now - lastAttackTime < attackDelayMs) {
        return; // Not enough time has passed, wait
      }

      // Find nearby enemies to attack
      const minLevel = readAutoAttackSetting(AUTO_ATTACK_SETTINGS.minLevel);
      const nearbyEnemies = usersRef.current.filter((user) =>
        isAutoAttackTarget(userData, user, warData, minLevel),
      );
      if (nearbyEnemies.length > 0) {
        // Find the closest enemy
        const closestEnemy = nearbyEnemies.reduce((closest, enemy) => {
          const originCol = originRef.current?.col ?? 0;
          const originRow = originRef.current?.row ?? 0;
          const currentDistance =
            Math.abs(enemy.longitude - originCol) +
            Math.abs(enemy.latitude - originRow);
          const closestDistance =
            Math.abs(closest.longitude - originCol) +
            Math.abs(closest.latitude - originRow);

          return currentDistance < closestDistance ? enemy : closest;
        });
        // If on the same tile, attack, otherwise setTarget
        if (
          closestEnemy.longitude === originRef.current.col &&
          closestEnemy.latitude === originRef.current.row
        ) {
          // Update last attack time and attack
          lastAutoAttackTimeRef.current = now;
          attackSectorUser(closestEnemy);
        } else {
          setTarget({ x: closestEnemy.longitude, y: closestEnemy.latitude });
        }
      }
    }
  };
  autoAttackRef.current = maybeAutoAttack;
  useEffect(() => {
    maybeAutoAttack();
  }, [sorrounding, autoAttackMode, isAttacking, userData?.status, props.isActive]);

  // Clear heal target if user moves away or target moves away
  useEffect(() => {
    if (healTargetUser && userData && originRef.current) {
      const isOnSameTile =
        healTargetUser.longitude === originRef.current.col &&
        healTargetUser.latitude === originRef.current.row;

      if (!isOnSameTile) {
        setHealTargetUser(null);
      }
    }
  }, [healTargetUser, userData, sorrounding]);

  /** Advance the latest scene destination without a React render for each retarget. */
  function continueMovement() {
    if (
      !isActiveRef.current ||
      !mountedRef.current ||
      walkAnimatingRef.current ||
      movePendingRef.current
    )
      return;
    const destination = routeTargetRef.current;
    const user = userRef.current;
    if (!destination || !originRef.current || !pathFinderRef.current || !user) return;
    if (!canAttemptAwakeAction(user)) {
      routeTargetRef.current = null;
      return;
    }
    if (destination.sector !== sectorRef.current) {
      const worldTarget = pendingWorldTargetRef.current ?? destination;
      const window = sectorWindowRef.current;
      const current = window.sectors.find(
        (entry) => entry.sector === sectorRef.current,
      );
      const target = window.sectors.find(
        (entry) => entry.sector === worldTarget.sector,
      );
      if (current && target)
        routeTowardWorldTarget(
          worldTarget,
          originRef.current,
          current.map,
          target.dx - current.dx,
          target.dy - current.dy,
        );
      return;
    }
    const targetHex = gridRef.current?.getHex({
      col: destination.x,
      row: destination.y,
    });
    if (!targetHex) return;
    if (
      destination.x === originRef.current.col &&
      destination.y === originRef.current.row
    ) {
      const cross = pendingCrossRef.current;
      if (cross) {
        pendingCrossRef.current = null;
        moveAcrossBorder(cross, destination);
      }
      return;
    }
    if (healTargetUser) setHealTargetUser(null);
    movePendingRef.current = true;
    document.body.style.cursor = "wait";
    move(
      buildStepPayload(
        { x: originRef.current.col, y: originRef.current.row },
        { x: targetHex.col, y: targetHex.row },
        sectorRef.current,
      ),
    );
  }
  // Parent commands (quest destinations and revealed players) share the scene's request path.
  const requestTargetRef = useRef(setTarget);
  requestTargetRef.current = setTarget;
  useEffect(() => {
    requestTargetRef.current(target);
  }, [target]);

  // Update the state containing sorrounding users on first load
  useEffect(() => {
    if (userData) {
      const enrichedData =
        fetchedUsers
          ?.map((user) => {
            const allianceStatus =
              ("warRelationship" in user ? user.warRelationship : undefined) ??
              getAllyStatus(userData?.village, user.villageId);
            return {
              ...user,
              allianceStatus,
            };
          })
          .filter(
            (u) =>
              u?.userId &&
              (u.userId === userData.userId || u.sector === sectorRef.current),
          ) || [];
      // Keep the live client-side position for the own marker: a stale
      // in-flight snapshot must not move it
      setSorrounding(enrichedData);
      actorRevisionRef.current++;
      usersRef.current = enrichedData.map((user) =>
        user.userId === userData.userId && animatedPositionRef.current
          ? {
              ...user,
              longitude: animatedPositionRef.current.x,
              latitude: animatedPositionRef.current.y,
            }
          : user,
      );
    }
  }, [fetchedUsers]);

  // Update information whenever we fetch new user data
  useEffect(() => {
    if (userData) {
      // Profile refreshes may contain the last committed tile while the
      // marker is walking; leave its speculative position to reconciliation.
      const animated = animatedPositionRef.current;
      void updateUsersList(
        movePendingRef.current && animated
          ? {
              ...userData,
              sector: sectorRef.current,
              longitude: animated.x,
              latitude: animated.y,
            }
          : userData,
      );
      userRef.current = userData;

      updateCurrentStructure();
    }
  }, [userData, villageData, structures]);

  const updateCurrentStructure = () => {
    const userData = userRef.current;
    if (!userData) return;
    const structure = structures.find((s) =>
      STRUCTURE_ADJACENTS.some(
        ({ dCol, dRow }) =>
          s.longitude === userData.longitude + dCol &&
          s.latitude === userData.latitude + dRow,
      ),
    );
    if (currentStructureRef.current !== (structure ?? null)) {
      currentStructureRef.current = structure ?? null;
      setCurrentStructure(structure ?? null);
    }
  };

  const onTravelTap = (hit: TravelPick, client: { x: number; y: number }) => {
    if (
      showSorroundingRef.current ||
      performance.now() < ignoreMapClicksUntilRef.current
    )
      return;
    const { locationId, structureId } = hit;
    const hitLocation = questLocationsRef.current.find(
      (location) => location.id === locationId,
    );
    if (structureId && structureId !== hoveredStructureIdRef.current) {
      hoveredStructureIdRef.current = structureId;
      setHoveredStructure(
        structuresRef.current.find((structure) => structure.id === structureId) ?? null,
      );
    }
    const candidates: {
      type: string;
      tile?: TerrainHex;
      sector?: number;
      longitude?: number;
      latitude?: number;
      npcPlacementId?: string;
      npcCopy?: number;
      userId?: string;
      battleId?: string;
    }[] = [];
    if (hit.actor) candidates.push(hit.actor);
    if (hit.tile)
      candidates.push({ type: "tile", tile: hit.tile.hex, sector: hit.tile.sector });
    const canSelectLocation = candidates.every((i) => {
      const questMarker = i.type === "questMarker" ? i : null;
      if (questMarker?.type === "questMarker") {
        const x = questMarker.longitude as number;
        const y = questMarker.latitude as number;
        const target = findHex(gridRef.current, { x, y });
        if (!target) {
          showMutationToast({
            id: "sector-missing-tile",
            success: false,
            message: "That location is outside the map",
          });
          return false;
        }
        pendingCrossRef.current = null;
        pendingWorldTargetRef.current = null;
        setTarget({ x, y });
        return false;
      }
      if (i.type === "tile") {
        const target = i.tile;
        if (!target) return true;
        const clickedSector = i.sector as number;
        // Select only the entrance tile; transparent artwork over nearby tiles must allow walking.
        if (
          hitLocation?.sector === clickedSector &&
          clickedSector === sectorRef.current &&
          hitLocation.longitude === target.col &&
          hitLocation.latitude === target.row
        )
          return true;
        if (clickedSector === sectorRef.current) {
          pendingCrossRef.current = null;
          pendingWorldTargetRef.current = null;
          setTarget({ x: target.col, y: target.row });
          return false;
        }
        // A tile in a neighboring sector: walk to the border, step
        // across, and keep going (multi-hop for diagonal targets).
        // Offsets come from the live window, relative to the sector
        // the character currently stands in
        const liveWindow = sectorWindowRef.current;
        const currentEntry = liveWindow.sectors.find(
          (candidate) => candidate.sector === sectorRef.current,
        );
        const targetEntry = liveWindow.sectors.find(
          (candidate) => candidate.sector === clickedSector,
        );
        const origin = originRef.current;
        if (!currentEntry || !targetEntry || !origin) return false;
        routeTowardWorldTarget(
          { sector: clickedSector, x: target.col, y: target.row },
          { col: origin.col, row: origin.row },
          currentEntry.map,
          targetEntry.dx - currentEntry.dx,
          targetEntry.dy - currentEntry.dy,
        );
        return false;
      } else if (showUsersRef.current && i.type === "avatar" && i.npcPlacementId) {
        // An NPC's body is a click target like its interaction icon;
        // without this, the click would fall through the sprite onto
        // the tile visually behind the NPC and walk the player there.
        if (
          handleNpcTileInteraction(i.npcPlacementId as string | undefined, i.npcCopy)
        ) {
          return false;
        }
        return true;
      } else if (showUsersRef.current && i.type === "talk") {
        if (
          handleNpcTileInteraction(i.npcPlacementId as string | undefined, i.npcCopy)
        ) {
          return false;
        }
        // Stale sprite (placement despawned): keep the tile clickable
        return true;
      } else if (showUsersRef.current && i.type === "attack") {
        const npcPlacementId = i.npcPlacementId as string | undefined;
        if (npcPlacementId) {
          if (handleNpcTileInteraction(npcPlacementId, i.npcCopy)) {
            return false;
          }
          // Stale NPC sprite: fall through to the tile rather than
          // re-targeting whatever user shares the template's userId
          return true;
        }
        const target = usersRef.current?.find((u) => u.userId === i.userId);
        if (target) {
          if (
            target.longitude === originRef.current?.col &&
            target.latitude === originRef.current?.row &&
            !isAttackingRef.current &&
            !movePendingRef.current
          ) {
            document.body.style.cursor = "wait";
            setTargetUser(target);
            attackSectorUser(target);
          } else {
            setTarget({ x: target.longitude, y: target.latitude });
          }
        }
        return false;
      } else if (showUsersRef.current && i.type === "heal") {
        const target = usersRef.current?.find((u) => u.userId === i.userId);
        if (target) {
          if (
            target.longitude === originRef.current?.col &&
            target.latitude === originRef.current?.row &&
            !movePendingRef.current
          ) {
            setHealTargetUser(target);
          } else {
            setTarget({ x: target.longitude, y: target.latitude });
          }
        }
        return false;
      } else if (showUsersRef.current && i.type === "info") {
        const target = usersRef.current?.find((u) => u.userId === i.userId);
        if (target)
          setProfileCard({ user: target, anchor: client, openedAt: performance.now() });
        return false;
      } else if (showUsersRef.current && i.type === "marker") {
        return true;
      } else if (i.type === "battleMarker" && i.battleId) {
        void router.push(`/battlelog/${i.battleId}`);
        return false;
      }
      return true;
    });
    if (canSelectLocation && typeof locationId === "string") {
      hoveredLocationIdRef.current = locationId;
      setHoveredLocationId(locationId);
    }
  };
  const travelCallbacks = useRef({ onTap: onTravelTap, onReady: () => {} });
  travelCallbacks.current = {
    onTap: onTravelTap,
    onReady: () => {
      const entry = travel.scene.current?.sectors.get(sectorRef.current);
      if (!entry) return;
      gridRef.current = entry.grid;
      if (pathFinderRef.current?.grid !== entry.grid)
        pathFinderRef.current = new PathCalculator(entry.grid);
      const position = animatedPositionRef.current ?? {
        x: userRef.current?.longitude ?? 0,
        y: userRef.current?.latitude ?? 0,
      };
      originRef.current = entry.grid.getHex({ col: position.x, row: position.y });
      continueMovement();
    },
  };
  const travelSnapshot = useRef<TravelSnapshot | null>(null);
  travelSnapshot.current = {
    actorRevision: actorRevisionRef.current,
    sector: sectorRef.current,
    viewer: userData,
    users: usersRef.current,
    col: animatedPositionRef.current?.x ?? userData?.longitude ?? 0,
    row: animatedPositionRef.current?.y ?? userData?.latitude ?? 0,
    window: sectorWindow.sectors.map((entry) => ({
      ...entry,
      structures: withSectorShrine(
        [
          ...entry.structures,
          ...(entry.sector === sectorRef.current ? dungeonStructures : []),
        ],
        entry.map,
        entry.globalTileType,
      ),
    })),
    showUsers: showActive,
    bracketFilter: storedBrackets,
    friendlyAttack: allyAttack,
    wars: warData,
    structureObjectiveIds: structureObjectiveIdsRef.current,
    nav: windowNavRef.current,
    enabled: !props.showSorrounding && canAttemptAwakeAction(userData),
    brightness: 1,
    lightDate: null,
    decorations: mergedDecorations,
    terrains: mergedTerrains,
    libraryVersion,
    locations: questLocations,
    mapAssets: sectorWindow.mapAssets,
  };
  const travel = useGameScene(
    "travel",
    mountRef,
    async (mount, signal, onError) =>
      createTravelScene({
        // Keep one artwork snapshot for this scene; later scene loads pick up saved edits.
        lpcCatalog: await loadLpcCatalog(),
        mount,
        signal,
        onError,
        lightLayout,
        initialZoom:
          liveZoomRef.current ?? (openSectorZoomedIn ? SECTOR_MAX_ZOOM : storedZoom),
        onZoom: (zoom) => {
          liveZoomRef.current = zoom;
          setStoredZoom(zoom);
        },
        getSnapshot: () => {
          const snapshot = travelSnapshot.current;
          if (!snapshot) throw new Error("Travel snapshot unavailable");
          const lightDate =
            lightingPreviewRef.current ?? new Date(Date.now() - timeDiffRef.current);
          return {
            ...snapshot,
            actorRevision: actorRevisionRef.current,
            motionSteps: motionStepsRef.current,
            routeTarget: pendingWorldTargetRef.current ?? routeTargetRef.current,
            sector: sectorRef.current,
            viewer: userRef.current,
            users: usersRef.current,
            col: animatedPositionRef.current?.x ?? userRef.current?.longitude ?? 0,
            row: animatedPositionRef.current?.y ?? userRef.current?.latitude ?? 0,
            nav: windowNavRef.current,
            enabled:
              isActiveRef.current &&
              canAttemptAwakeAction(userRef.current) &&
              !showSorroundingRef.current &&
              performance.now() >= ignoreMapClicksUntilRef.current,
            lightDate,
            weather: weatherPreviewRef.current,
            weatherTime: Date.now() - timeDiffRef.current,
            brightness: getWorldCycleBrightness(lightDate),
          };
        },
        onTap: (hit, client) => travelCallbacks.current.onTap(hit, client),
        onReady: () => travelCallbacks.current.onReady(),
        onHover: (structureId, locationId) => {
          if (structureId !== hoveredStructureIdRef.current) {
            hoveredStructureIdRef.current = structureId;
            setHoveredStructure(
              structuresRef.current.find((structure) => structure.id === structureId) ??
                null,
            );
          }
          if (locationId !== hoveredLocationIdRef.current) {
            hoveredLocationIdRef.current = locationId;
            setHoveredLocationId(locationId);
          }
        },
      }),
    `${lightLayout}:${isWorldExpanded}:${travelLightingMode(sector)}`,
  );
  const [showWorldLoader, setShowWorldLoader] = useState(false);
  useEffect(() => {
    if (travel.isReady || travel.error) {
      setShowWorldLoader(false);
      return;
    }
    // Cached terrain normally renders before loading feedback needs to appear.
    const timer = setTimeout(() => setShowWorldLoader(true), 200);
    return () => clearTimeout(timer);
  }, [travel.isReady, travel.error]);
  // Invalidate the paused destination on arrival so character tracking can resume.
  useEffect(() => {
    if (travel.isReady) travel.scene.current?.recenter();
  }, [travel.isReady, props.cameraFocusRevision, profile?.status]);
  useEffect(() => {
    if (!props.isActive || !travel.isReady || !canAttemptAwakeAction(profile)) return;
    travelCallbacks.current.onReady();
    continueMovement();
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [travel.isReady, profile?.status, props.isActive]);
  useEffect(() => {
    sectorWindowRef.current = sectorWindow;
    if (!travel.isReady) return;
    void travel.scene.current
      ?.updateWindow()
      .catch((error: unknown) => console.error("Travel window unavailable", error));
  }, [sectorWindow, dungeonStructures, questLocations, travel.isReady]);

  // Arrival-modal CTA. `interactWithOverworldAi` dispatches on an actionable bound objective
  // (dialog / defeat / deliver) before falling back to a mission grant, so the prompt names the
  // real action rather than always promising a mission. Reuses the same server-side projection +
  // matcher; the one thing the client can't see is item possession (userData.items holds only
  // equipped items), so deliveries are predicted by reachability alone via `ignoreItemOwnership`.
  const arrivalBound =
    arrivalNpc &&
    arrivalNpc.npcInteractionType !== "HOSTILE" &&
    arrivalNpc.npcPlacementId &&
    userData
      ? findActionableBoundObjective({
          activeQuests: getBoundObjectiveCandidates(userData),
          ownedItemIds: [],
          placementId: arrivalNpc.npcPlacementId,
          ignoreItemOwnership: true,
        })
      : null;
  const arrivalCta = arrivalNpc
    ? resolveArrivalPromptCta(arrivalNpc, arrivalBound?.objective.task ?? null)
    : null;
  const dialogBackground =
    dialogSceneAssets?.find((asset) => asset.type === "SCENE_BACKGROUND")?.image ??
    IMG_SCENE_BACKGROUND;
  const dialogCharacters =
    dialogSceneAssets
      ?.filter((asset) => asset.type === "SCENE_CHARACTER")
      .map((asset) => asset.image) ?? [];

  const content = (
    <div
      data-world-expanded={isWorldExpanded ? "true" : undefined}
      className={isWorldExpanded ? "fixed inset-0 z-50 bg-[#263c36]" : "relative"}
    >
      <div className="relative">
        <div
          id="tutorial-travel-sector"
          ref={mountRef}
          aria-busy={!travel.isReady && !travel.error}
          className={!travel.isReady && !travel.error ? "min-h-60" : undefined}
        ></div>
        {showWorldLoader && !travel.isReady && !travel.error && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div
              role="status"
              className="bg-background/95 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-md motion-reduce:[&_img]:animate-none"
            >
              <Loader noPadding size={20} />
              <span>Loading world…</span>
            </div>
          </div>
        )}
        <aside
          aria-label="Map compass and neighboring sectors"
          className="bg-background/90 pointer-events-none absolute top-3 left-3 z-10 rounded-lg border p-2 text-center text-xs shadow-md backdrop-blur-sm"
        >
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1 tabular-nums">
            <span className="col-span-3">
              N ·{" "}
              {sectorGridNeighbors(sector)[0] < 0
                ? "Polar boundary"
                : sectorGridNeighbors(sector)[0]}
            </span>
            <span className="text-right whitespace-nowrap">
              {sectorGridNeighbors(sector)[3]} · W
            </span>
            <span className="border-foreground/20 bg-muted min-w-8 rounded border px-1.5 py-0.5 font-bold">
              <span className="sr-only">Current sector </span>
              {sector}
            </span>
            <span className="text-left whitespace-nowrap">
              E · {sectorGridNeighbors(sector)[1]}
            </span>
            <span className="col-span-3">
              S ·{" "}
              {sectorGridNeighbors(sector)[2] < 0
                ? "Polar boundary"
                : sectorGridNeighbors(sector)[2]}
            </span>
          </div>
        </aside>
        <div className="absolute top-3 right-3 z-10 flex items-start gap-2">
          <DayNightIndicator
            className="bg-background/90 rounded-lg border px-3 py-2 shadow-md backdrop-blur-sm"
            previewDate={lightingPreviewDate}
            onPreviewDateChange={setLightingPreviewDate}
            previewWeather={weatherPreview}
            onPreviewWeatherChange={setWeatherPreview}
          />
          {isWorldExpanded && (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="bg-background/90"
              ref={expandedExitRef}
              aria-label="Exit expanded world"
              onClick={() => setWorldExpanded(false)}
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {travel.error && <WebGlError />}
      {inspectedLocations && (
        <Modal
          title={inspectedLocations[0]?.name ?? "Location"}
          isOpen={!!inspectLocationId}
          returnFocusRef={inspectTriggerRef}
          setIsOpen={(open) => {
            if (!(typeof open === "function" ? open(!!inspectLocationId) : open))
              setInspectLocationId(null);
          }}
        >
          {inspectedLocations.map((location) => (
            <div key={location.id} className="space-y-2">
              {inspectedLocations.length > 1 && (
                <h3 className="font-semibold">{location.name}</h3>
              )}
              <p className="whitespace-pre-wrap">{location.description}</p>
            </div>
          ))}
        </Modal>
      )}
      {currentStructure && (
        <div className="absolute bottom-3 left-3 z-20 max-w-[calc(50%-40px)] rounded-lg bg-black/80 p-3 text-white shadow-lg sm:bottom-4 sm:left-4 sm:max-w-xs">
          <h3 className="text-sm font-semibold">
            {currentServices.map((service) => service.name).join(" · ")}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {currentServices.map((service) => (
              <Button key={service.id} asChild size="sm" className="min-h-10">
                <Link href={service.route}>Enter {service.name}</Link>
              </Button>
            ))}
          </div>
        </div>
      )}
      {/* Stack corner actions so dungeon, hover and raid cards share the map without overlap. */}
      <div className="pointer-events-none absolute right-3 bottom-3 z-20 flex max-w-[calc(50%-40px)] flex-col items-end gap-2 sm:right-4 sm:bottom-4 sm:max-w-xs">
        <MapLocationActions
          arrived={arrivedLocations}
          hovered={hoveredLocation}
          onInspect={(location, trigger) => {
            inspectTriggerRef.current = trigger;
            setInspectLocationId(location.id);
          }}
          onQuest={setLogbookModalQuestId}
          onGoTo={(location) =>
            setTarget({ x: location.longitude, y: location.latitude })
          }
        />
        {hoveredStructure && hoveredStructure.id !== currentStructure?.id && (
          <div className="pointer-events-auto w-full rounded-lg bg-black/80 p-3 text-white shadow-lg">
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <h3
                  className="truncate text-sm font-semibold"
                  title={hoveredStructure.name}
                >
                  {hoveredStructure.name}
                </h3>
                <Button
                  size="sm"
                  onClick={() =>
                    setTarget({
                      x: hoveredStructure.longitude,
                      y: hoveredStructure.latitude,
                    })
                  }
                  className="mt-2 min-h-10"
                >
                  Go to {hoveredStructure.name}
                </Button>
              </div>
            </div>
          </div>
        )}
        {activeRaid && (
          <div className="pointer-events-auto w-full rounded-lg bg-black/80 p-3 text-white shadow-lg">
            <div className="flex items-center gap-3">
              <Swords className="hidden h-6 w-6 shrink-0 text-red-500 sm:block" />
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold" title={activeRaid.name}>
                  {activeRaid.name}
                </h3>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setShowRaidModal(true)}
                  className="mt-2 min-h-10"
                >
                  View Raid
                </Button>
              </div>
            </div>
          </div>
        )}
        {firstDungeon && (
          <div className="pointer-events-auto w-full rounded-lg bg-black/70 p-2 text-white shadow-lg sm:p-4">
            <div className="flex items-center gap-4">
              <Image
                src={firstDungeon.image}
                alt=""
                width={48}
                height={48}
                className="hidden shrink-0 rounded-md sm:block"
              />
              <div className="min-w-0">
                <h3
                  className="truncate text-sm font-semibold sm:text-lg"
                  title={dungeonStructures.length === 1 ? firstDungeon.name : undefined}
                >
                  {dungeonStructures.length === 1
                    ? firstDungeon.name
                    : `Dungeons (${dungeonStructures.length})`}
                </h3>
                <Link
                  href="/dungeon"
                  className="mt-2 inline-block rounded-md bg-blue-500 px-2 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:px-4 sm:text-sm"
                >
                  {dungeonStructures.length === 1 ? "Enter Dungeon" : "View Dungeons"}
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
      {showRaidModal && userData && (
        <Modal isOpen={showRaidModal} setIsOpen={setShowRaidModal} title="Sector Raid">
          <RaidBrowser
            title="Sector Raid"
            subtitle={`Sector ${userData.sector}`}
            initialBreak={false}
            viewOnly={false}
            sectorFilter={userData.sector}
          />
        </Modal>
      )}
      {props.showSorrounding && sorrounding && userData && originRef.current && (
        <SurroundingUsers
          setIsOpen={props.setShowSorrounding}
          users={sorrounding}
          userData={userData}
          hex={originRef.current}
          allyAttack={allyAttack}
          wars={warData}
          setAllyAttack={setAllyAttack}
          storedBrackets={storedBrackets}
          setStoredBrackets={setStoredBrackets}
          excludeAllies={excludeAllies}
          setExcludeAllies={setExcludeAllies}
          attackUser={(userId) => {
            const target = sorrounding.find((u) => u.userId === userId);
            if (target && !isAttacking && !movePendingRef.current) {
              attackSectorUser(target);
            }
          }}
          robUser={(userId) => {
            const target = sorrounding.find((u) => u.userId === userId);
            if (target && !isRobbing && !movePendingRef.current) {
              rob({
                originSocketId: pusher?.connection.socket_id,
                userId: target.userId,
                longitude: target.longitude,
                latitude: target.latitude,
                sector: sectorRef.current,
              });
            }
          }}
          move={(longitude, latitude) => {
            setTarget({ x: longitude, y: latitude });
          }}
        />
      )}
      {props.isActive && logbookModalQuestId && (
        <QuestUpdateModal
          questId={logbookModalQuestId}
          onClose={() => setLogbookModalQuestId(null)}
        />
      )}
      {targetUser && (isAttacking || userData?.status === "BATTLE") && (
        <div className="absolute top-0 right-0 bottom-0 left-0 z-20 m-auto flex flex-col justify-center bg-black">
          <div className="m-auto text-center text-white">
            <p className="p-5 text-3xl">
              <AvatarImage
                href={targetUser.avatar}
                alt={targetUser.username}
                size={256}
                priority
              />
            </p>
            <p className="text-5xl">Attacking {targetUser.username}</p>
          </div>
        </div>
      )}
      {healTargetUser && userData && originRef.current && (
        <div className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transform">
          <HealingPopover
            targetUser={healTargetUser}
            side="top"
            open={!!healTargetUser}
            onOpenChange={(open) => {
              if (!open) {
                setHealTargetUser(null);
              }
            }}
            onHealComplete={() => setHealTargetUser(null)}
            trigger={<div className="h-1 w-1 opacity-0" />}
          />
        </div>
      )}
      {profileCard && (
        <TravelUserCard
          key={profileCard.openedAt}
          user={profileCard.user}
          anchor={profileCard.anchor}
          onClose={() =>
            setProfileCard((current) => (current === profileCard ? null : current))
          }
        />
      )}
      {/* Hunting can receive focus later without dismissing this NPC arrival. */}
      {props.isActive && arrivalNpc && (
        <Modal
          isOpen={!!arrivalNpc}
          dismissOnInteractOutside={false}
          setIsOpen={(open) => {
            if (!open) setArrivalNpc(null);
          }}
          title={arrivalNpc.username}
        >
          <div className="flex flex-col items-center gap-4 p-2">
            {/* biome-ignore lint/performance/noImgElement: dynamic CDN avatar, variable intrinsic size */}
            <img
              src={travelAvatar(arrivalNpc)}
              alt={arrivalNpc.username}
              className="h-28 w-28 rounded-md object-contain"
            />
            <p className="text-center text-sm">{arrivalCta?.question}</p>
            <div className="flex w-full gap-2">
              <Button
                type="button"
                variant={
                  arrivalNpc.npcInteractionType === "HOSTILE" ? "destructive" : "info"
                }
                disabled={isInteracting || isMoving}
                className="flex-1"
                onClick={() => {
                  if (interactWithNpc(arrivalNpc)) setArrivalNpc(null);
                }}
              >
                {arrivalCta?.action}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setArrivalNpc(null)}
              >
                {arrivalCta?.dismiss}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {props.isActive && npcDialog && pendingNpcInteractRef.current && (
        <Modal
          isOpen={!!npcDialog}
          setIsOpen={(open) => {
            if (!open) setNpcDialog(null);
          }}
          title="NPC Dialog"
        >
          <div className="flex flex-col gap-3 p-2">
            <QuestDialogScene
              background={dialogBackground}
              characters={dialogCharacters}
              description={npcDialog.description}
            />
            {npcDialog.branches.map((branch, index) => (
              <Button
                key={`${index}-${branch.text}`}
                type="button"
                variant="info"
                disabled={isInteracting}
                className="h-auto w-full justify-start text-left whitespace-normal"
                onClick={() => {
                  const ctx = pendingNpcInteractRef.current;
                  if (!ctx) {
                    setNpcDialog(null);
                    return;
                  }
                  // Keep the dialog open while the choice is sent: the response either carries
                  // the NPC's next dialog or closes it (see interactNpc onSuccess / onError).
                  if (isInteracting) return;
                  interactNpc({
                    placementId: ctx.placementId,
                    positionVersion: ctx.positionVersion,
                    copy: ctx.copy,
                    dialogContentId: dialogChoiceContentId(
                      branch.nextObjectiveId,
                      npcDialog.objectiveId,
                    ),
                  });
                }}
              >
                {branch.text}
              </Button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
  // Escape the shell's stacking context while keeping Radix dialogs above the world.
  return isWorldExpanded ? createPortal(content, document.body) : content;
};

export default Sector;

/** Most zoomed-in the sector camera may go. */
const SECTOR_MAX_ZOOM = 3;

/**
 * Mobile browsers synthesize a click on whatever sits under a dialog after the
 * overlay unmounts from the same tap. Keep the sector canvas deaf for that
 * window so closing scouting cannot also walk to a tile.
 */
const MAP_CLICK_BLOCK_AFTER_MODAL_MS = 400;

type SectorWindowEntry =
  RouterOutputs["worldMap"]["getSectorWindow"]["sectors"][number];

type NpcDialog = NonNullable<
  RouterOutputs["overworldAi"]["interactWithOverworldAi"]["dialog"]
>;

/**
 * The assembled window the travel page passes in: the 3x3 sector entries
 * (assembled client-side from per-sector data so crossings need no refetch)
 * plus the session-cached asset/terrain libraries from mapAsset.getAll and
 * mapTerrain.getAll.
 */
export interface SectorWindowData {
  mapAssets: Omit<
    RouterOutputs["mapAsset"]["getAll"][number],
    "createdAt" | "updatedAt"
  >[];
  mapTerrains: RouterOutputs["mapTerrain"]["getAll"];
  sectors: SectorWindowEntry[];
}

interface SectorProps {
  loadLpcCatalog: () => Promise<LpcCatalog>;
  sector: number;
  tile: GlobalTile;
  sectorWindow: SectorWindowData;
  target: SectorPoint | null;
  showSorrounding: boolean;
  showActive: boolean;
  /** Retain the scene between tabs without initiating hidden player actions. */
  isActive: boolean;
  autoAttackMode: boolean;
  isWorldExpanded: boolean;
  /** Re-selecting the player tab resumes camera follow without remounting the scene. */
  cameraFocusRevision: number;
  setWorldExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSorrounding: React.Dispatch<React.SetStateAction<boolean>>;
  setPosition: (position: SectorPoint | null) => void;
}
