"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Grid } from "honeycomb-grid";
import { useAtomValue } from "jotai";
import { Swords } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  IMG_AVATAR_DEFAULT,
  IMG_ICON_MOVE,
  IMG_SCENE_BACKGROUND,
  IMG_SECTOR_ATTACK,
  IMG_SECTOR_INFO,
  IMG_SECTOR_ROB,
  MAX_PVP_BRACKET,
  MEDNIN_MIN_RANK,
  RANKS_RESTRICTED_FROM_PVP,
  STRUCTURE_ADJACENTS,
  TERMINAL_DIALOG_PREFIX,
  WAR_SHRINE_IMAGE_BY_BIOME,
} from "@/drizzle/constants";
import type { UserData, VillageStructure } from "@/drizzle/schema";
import { useDayNightMapOverlays } from "@/hooks/day-night-overlay";
import { useGameScene } from "@/hooks/game-scene";
import { safeLocalStorageGetItem, useLocalStorage } from "@/hooks/localstorage";
import { useTutorialStep } from "@/hooks/tutorial";
import AvatarImage from "@/layout/Avatar";
import { DayNightIndicator } from "@/layout/DayNightIndicator";
import HealingPopover from "@/layout/HealingPopover";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { LogbookEntry, QuestDialogScene } from "@/layout/Logbook";
import { MapLocationActions } from "@/layout/MapLocationActions";
import Modal from "@/layout/Modal";
import RaidBrowser from "@/layout/RaidBrowser";
import { useOpenRewardChoice } from "@/layout/RewardChoice";
import SliderField from "@/layout/SliderField";
import WebGlError from "@/layout/WebGLError";
import { getWorldCycleBrightness } from "@/libs/dayNight";
import type { TerrainHex } from "@/libs/hexgrid";
import { findHex, PathCalculator } from "@/libs/hexgrid";
import { LIGHT_LAYOUT_STORAGE_KEY } from "@/libs/layoutPreference";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { getQuestMapLocations, groupMapLocations } from "@/libs/mapLocations";
import { isQuestObjectiveAvailable } from "@/libs/objectives";
import {
  arrivalPromptDecision,
  findActionableBoundObjective,
  isArrivalPromptStale,
  resolveArrivalPromptCta,
} from "@/libs/overworldAi";
import { getEffectiveLevel, getExpBracket, getScoutingUsers } from "@/libs/profile";
import {
  GATHERING_CANCEL_PREFIX,
  getBoundObjectiveCandidates,
  isLocationObjective,
} from "@/libs/quest";
import {
  createTravelScene,
  type TravelPick,
  type TravelSnapshot,
} from "@/libs/rendering/scenes/travel";
import { travelAvatar } from "@/libs/rendering/scenes/travelActors";
import { mergeDecorationAssets } from "@/libs/sector-map/decorations";
import { buildWindowNav, type WindowNav } from "@/libs/sector-map/navigation";
import { createGenericStructure } from "@/libs/sector-map/structures";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { sectorGridNeighbors } from "@/libs/sector-map/world-grid";
import type {
  GlobalTile,
  SectorPoint,
  SectorUser,
} from "@/libs/sector-map/world-types";
import { isUserCurrentlyStealthed } from "@/libs/stealth";
import { showMutationToast } from "@/libs/toast";
import { hasRequiredRank } from "@/libs/train";
import { getBiomeAtSectorAnchor } from "@/libs/travel";
import { isTutorialCaptureStep } from "@/libs/tutorial";
import { isWarAllies } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import { findVillageUserRelationship, getAllyStatus } from "@/utils/alliance";
import { round } from "@/utils/math";
import { sleep } from "@/utils/time";
import { blockingPopupOpenAtom, useRequiredUserData } from "@/utils/UserContext";
import { MAP_LOCATION_REFRESH_MS, type MapLocation } from "@/validators/mapLocation";
import { type BracketSliderSchema, bracketSliderSchema } from "@/validators/travel";

type SectorWindowEntry =
  RouterOutputs["worldMap"]["getSectorWindow"]["sectors"][number];

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
  sector: number;
  tile: GlobalTile;
  sectorWindow: SectorWindowData;
  target: SectorPoint | null;
  showSorrounding: boolean;
  showActive: boolean;
  autoAttackMode: boolean;
  setShowSorrounding: React.Dispatch<React.SetStateAction<boolean>>;
  setTarget: React.Dispatch<React.SetStateAction<SectorPoint | null>>;
  setPosition: React.Dispatch<React.SetStateAction<SectorPoint | null>>;
}

/** Nearest walkable tile along the given border edge, closest to `preferred` */
const findNearestWalkableEdgeTile = (
  map: NormalizedSectorMap,
  edge: "north" | "east" | "south" | "west",
  preferred: SectorPoint,
): SectorPoint | null => {
  const candidates = map.tiles.filter((tile) => {
    if (edge === "north") return tile.y === map.height - 1;
    if (edge === "south") return tile.y === 0;
    if (edge === "west") return tile.x === 0;
    return tile.x === map.width - 1;
  });
  let best: SectorPoint | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  candidates.forEach((tile) => {
    const dist = Math.abs(tile.x - preferred.x) + Math.abs(tile.y - preferred.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: tile.x, y: tile.y };
    }
  });
  return best;
};

/**
 * Renders the player's current sector plus its 8 neighbors (the sectorWindow
 * prop) as one continuous, seamlessly scrollable world. Moves and border
 * crossings animate client-side and reconcile with the server afterwards;
 * window changes patch the live scene in place instead of rebuilding it.
 */
/** Most zoomed-in the sector camera may go. */
const SECTOR_MAX_ZOOM = 3;

const Sector = (props: SectorProps) => {
  const centerEntry = props.sectorWindow.sectors.find(
    (entry) => entry.sector === props.sector,
  );
  if (!centerEntry) throw new Error(`Sector ${props.sector} missing from window`);
  return <SectorScene {...props} centerEntry={centerEntry} />;
};

const SectorScene = (props: SectorProps & { centerEntry: SectorWindowEntry }) => {
  const { sector, sectorWindow, target, showActive, autoAttackMode, centerEntry } =
    props;
  const sectorMap = centerEntry.map;
  const { setTarget, setPosition } = props;

  // Light layout preference state
  const [lightLayout] = useLocalStorage<boolean>(LIGHT_LAYOUT_STORAGE_KEY, false);

  // Day/night map shading preference — ref so the long-running render loop
  // reacts without rebuilding the map
  const { showDayNightMapOverlays } = useDayNightMapOverlays();
  const showDayNightMapOverlaysRef = useRef(showDayNightMapOverlays);
  showDayNightMapOverlaysRef.current = showDayNightMapOverlays;

  // State pertaining to the sector
  const [targetUser, setTargetUser] = useState<SectorUser | null>(null);
  const [healTargetUser, setHealTargetUser] = useState<SectorUser | null>(null);
  const [moves, setMoves] = useState(0);
  const [sorrounding, setSorrounding] = useState<SectorUser[]>([]);
  const [allyAttack, setAllyAttack] = useLocalStorage<boolean>("friendlyAttack", false);
  const [storedBracket, setStoredBracket] = useLocalStorage<number>(
    "minBracketOnScout",
    -1,
  );
  const [storedZoom, setStoredZoom] = useLocalStorage<number>("sectorZoom", 2.4);
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
  // Structure under the pointer (sticky while interacting with the panel so
  // the pointer can leave the canvas to click "Go to" without clearing).
  const [hoveredStructure, setHoveredStructure] = useState<VillageStructure | null>(
    null,
  );
  const [logbookModalOpen, setLogbookModalOpen] = useState<boolean>(false);
  const [logbookModalQuestId, setLogbookModalQuestId] = useState<string | null>(null);
  const [showRaidModal, setShowRaidModal] = useState<boolean>(false);
  const [npcDialog, setNpcDialog] = useState<{
    objectiveId: string;
    description: string;
    sceneBackground: string;
    sceneCharacters: string[];
    branches: { text: string; nextObjectiveId?: string }[];
  } | null>(null);
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
  const userRef = useRef<UserWithRelations>(undefined);
  const lastAutoAttackTimeRef = useRef<number | null>(null);
  // Mirror the attack-pending flag into a ref so the render loop's click guard
  // can read it without the flag being a scene-build effect dependency (which
  // would tear down and rebuild the whole 3x3 world on every attack).
  const isAttackingRef = useRef<boolean>(false);
  // Same for the NPC-interaction flag: the click guard reads it from a ref so a
  // pending interaction never rebuilds the world.
  const isInteractingRef = useRef<boolean>(false);
  const pendingCrossRef = useRef<"north" | "east" | "south" | "west" | null>(null);
  // One logical grid over the whole 3x3 window, so paths and hover highlights
  // cross sector borders as if the world were a single map
  const windowNavRef = useRef<WindowNav | null>(null);
  // Incremented whenever a completed crossing changes the window center, so
  // stale async window patches cannot win a race against the latest crossing.
  // The character's live tile during walk animations; authoritative for
  // scene rebuilds that land mid-walk (userData only updates on completion)
  const animatedPositionRef = useRef<{ x: number; y: number } | null>(null);
  const pendingWorldTargetRef = useRef<{ sector: number; x: number; y: number } | null>(
    null,
  );
  // Client-authoritative sector id: updated imperatively the moment a
  // crossing commits (the prop lags a render behind), synced on prop change
  const walkAnimatingRef = useRef(false);
  const movePendingRef = useRef(false);
  const mountedRef = useRef(true);
  const sectorRef = useRef(sector);
  useEffect(() => {
    sectorRef.current = sector;
  }, [sector]);
  const pendingNpcInteractRef = useRef<{
    placementId: string;
    positionVersion: number;
  } | null>(null);
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
    () => mergeTerrainSpecs(sectorWindow.mapTerrains ?? []),
    [sectorWindow.mapTerrains],
  );
  const mergedDecorations = useMemo(
    () => mergeDecorationAssets(sectorWindow.mapAssets ?? []),
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
  const openRewardChoice = useOpenRewardChoice();

  // Data from db
  const {
    data: userData,
    pusher,
    timeDiff,
    updateUser,
    prepareUserUpdate,
  } = useRequiredUserData();
  const appearanceSignature = useMemo(
    () => JSON.stringify(resolveSpriteAppearance(userData ?? {})),
    [userData],
  );
  const lastAppearanceSignature = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastAppearanceSignature.current;
    lastAppearanceSignature.current = appearanceSignature;
    if (previous !== null && previous !== appearanceSignature)
      void utils.travel.getSectorData.invalidate({ sector });
  }, [appearanceSignature, sector, utils]);
  timeDiffRef.current = timeDiff;
  const { data } = api.travel.getSectorData.useQuery(
    { sector: sector },
    {
      enabled: sector !== undefined,
      placeholderData: (previous) => previous,
      // Presence and fights change while the tab is open; pusher events can be
      // missed, so poll the sector snapshot on a short interval. Pause that
      // interval while the tab is in the background.
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
    },
  );
  const villageData = data?.village;
  /** Combines player records and overworld AIs for the shared sector-user rendering path. */
  const fetchedUsers = useMemo(
    () =>
      data?.users === undefined
        ? undefined
        : [...data.users, ...(data.overworldAis ?? [])],
    [data?.users, data?.overworldAis],
  );
  const warData = data?.warData;
  // Poll authored entrances so publication and expiration update the current sector without reloads.
  const { data: sectorDungeons } = api.coop.dungeon.getAvailable.useQuery(
    { sector },
    {
      enabled: userData?.sector === sector,
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
    },
  );
  const dungeonStructures = useMemo(
    () =>
      (sectorDungeons ?? [])
        .filter((d) => d.content.sector === sector)
        .map((d) => ({
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
    [sectorDungeons, sector, sectorWindow.mapAssets],
  );
  const firstDungeon = dungeonStructures[0];
  // Add dynamic entrances and the shrine without mutating cached village structures.
  const structures = useMemo(() => {
    const base = [...(villageData?.structures ?? []), ...dungeonStructures];
    if (base.some((s) => s.route === "/shrine")) return base;
    return [...base, createShrineStructure(sectorMap, props.tile.t)];
  }, [villageData?.structures, sectorMap, props.tile.t, dungeonStructures]);
  structuresRef.current = structures;

  // Query for raids in this sector (only when user is in this sector)
  const { data: sectorRaidsData } = api.raids.getAvailableRaids.useQuery(
    { sector: sector },
    { enabled: userData?.sector === sector && sector !== undefined },
  );
  const activeRaid = sectorRaidsData?.raids?.[0] ?? null;

  const dialogSceneAssetIds = npcDialog
    ? [npcDialog.sceneBackground, ...(npcDialog.sceneCharacters ?? [])].filter(Boolean)
    : [];
  const { data: dialogSceneAssets } = api.gameAsset.getSceneAssets.useQuery(
    { assetIds: dialogSceneAssetIds },
    { enabled: dialogSceneAssetIds.length > 0 },
  );

  // Carry the edit timestamp to bypass stale public caches on other server workers.
  const [publicLocationRevision, setPublicLocationRevision] = useState(0);
  const { data: publicLocations = [] } = api.quests.getPublicLocations.useQuery(
    { revision: publicLocationRevision },
    {
      placeholderData: (previous) => previous,
      staleTime: MAP_LOCATION_REFRESH_MS,
      refetchInterval: MAP_LOCATION_REFRESH_MS,
      refetchIntervalInBackground: false,
    },
  );
  useEffect(() => {
    if (!pusher) return;
    const channel = pusher.subscribe("map-content");
    const update = (event: { revision: number }) => {
      if (!Number.isSafeInteger(event.revision) || event.revision < 0) return;
      setPublicLocationRevision((previous) => Math.max(previous, event.revision));
      void utils.mapAsset.getAll.invalidate();
      void utils.coop.dungeon.getAvailable.invalidate();
      // Active runs carry their private presentation in the profile snapshot.
      if (userRef.current?.userQuests.some((entry) => !entry.completed && !entry.endAt))
        void utils.profile.getUser.invalidate();
    };
    channel.bind("updated", update);
    return () => {
      channel.unbind("updated", update);
      pusher.unsubscribe("map-content");
    };
  }, [pusher, utils]);
  const questLocations = useMemo<MapLocation[]>(
    () => [
      ...(userData
        ? getQuestMapLocations(userData, publicLocations, data?.questPlacements ?? [])
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
    [userData, publicLocations, sectorDungeons, data?.questPlacements],
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
  const arrivedLocations = useMemo(
    () =>
      locationGroups
        .filter(
          (entries) =>
            entries[0]?.longitude === userData?.longitude &&
            entries[0]?.latitude === userData?.latitude,
        )
        .flat(),
    [locationGroups, userData?.longitude, userData?.latitude],
  );
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

  // Convenience calculations

  // If new objective is available, then show a modal
  const modalUserQuest = userData?.userQuests?.find(
    (q) => q.questId === logbookModalQuestId,
  );
  const modalTracker = userData?.questData?.find((q) => q.id === logbookModalQuestId);

  // Movement based on ASDQWE keys
  const onDocumentKeyDown = (event: KeyboardEvent) => {
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
    onSuccess: async (result) => {
      if (result.success) {
        // Push any notifications
        result.notifications.forEach((notification) => {
          const isCancellation = notification.startsWith(GATHERING_CANCEL_PREFIX);
          showMutationToast({
            success: !isCancellation,
            message: notification,
          });
        });
        // Update user quest data immidiately
        if (result.questData && result.updateAt) {
          await updateUser({ questData: result.questData, updatedAt: result.updateAt });
        }
        if (result.itemsChanged) {
          await Promise.all([
            utils.item.getUserItems.invalidate(),
            utils.item.getUserItemsWithVariants.invalidate(),
          ]);
        }
      }
      // If there are any quest ids that have been updated,
      // let's see if we should show a modal with new objective for consecutive quests
      if (result.questIdsUpdated && result.questIdsUpdated.length > 0) {
        result.questIdsUpdated.forEach((questId) => {
          const quest = userData?.userQuests?.find((q) => q.questId === questId);
          if (quest?.quest?.consecutiveObjectives) {
            setLogbookModalOpen(true);
            setLogbookModalQuestId(questId);
          }
        });
      }
    },
  });

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
      if (usersRef.current) {
        // Filter out stealthed users (defense in depth - server should already filter these)
        // Only filter if it's not the current user (user should always see themselves)
        // Uses isUserCurrentlyStealthed to check expiry, mirroring server-side logic
        if (isUserCurrentlyStealthed(data) && data.userId !== userData?.userId) {
          // Remove from local users list if they went stealth
          const idx = usersRef.current.findIndex((u) => u.userId === data.userId);
          if (idx !== -1) {
            usersRef.current.splice(idx, 1);
            actorRevisionRef.current++;
            if (!skipStateUpdate) {
              setSorrounding(usersRef.current.filter((u) => u?.userId) || []);
            }
          }
          return;
        }

        const allianceStatus =
          usersRef.current.find((u) => u.userId === data.userId)?.allianceStatus ??
          getAllyStatus(userData?.village, data.villageId);
        const idx = usersRef.current
          .filter((u) => u.userId)
          .findIndex((u) => u.userId === data.userId);
        if (idx !== -1 && usersRef.current[idx]) {
          if (instantMove) {
            // User exists - instant movement
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
                for (const tile of path) {
                  if (usersRef.current[idx]) {
                    usersRef.current[idx] = {
                      ...usersRef.current[idx],
                      ...data,
                      avatar: usersRef.current[idx].avatar,
                      avatarLight: usersRef.current[idx].avatarLight,
                      username: usersRef.current[idx].username,
                      experience: data.experience ?? usersRef.current[idx].experience,
                      rank: data.rank ?? usersRef.current[idx].rank,
                      allianceStatus,
                      longitude: tile.col,
                      latitude: tile.row,
                    };
                  }
                  actorRevisionRef.current++;
                  await sleep(50);
                }
              }
            }
          }
        } else {
          // New user enters — do not invent experience; unknown XP fails closed in bracket filters
          // New identities come from the authenticated, masked sector snapshot.
          void utils.travel.getSectorData.invalidate();
        }
        // Remove users who are no longer in the sector; compare against the
        // live sector ref, which crossings advance before the prop catches up
        usersRef.current
          .map((user, idx) => (user.sector !== sectorRef.current ? idx : null))
          .filter((idx): idx is number => idx !== null)
          .reverse()
          .map((idx) => usersRef.current?.splice(idx, 1));
      }
    }
    actorRevisionRef.current++;
    // Only update state if not explicitly skipped (to avoid excessive updates during animation)
    if (!skipStateUpdate) {
      setSorrounding(usersRef.current.filter((u) => u?.userId) || []);
    }
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
    if (!userData) return;
    let shouldCheckQuest = false;
    userData?.userQuests?.forEach((userquest) => {
      const tracker = userData.questData?.find((q) => q.id === userquest.questId);
      userquest.quest.content.objectives.forEach((objective, i) => {
        const isOnLocation = isLocationObjective(
          {
            sector: data.sector,
            longitude: data.longitude,
            latitude: data.latitude,
          },
          objective,
        );
        if (
          (!tracker || isQuestObjectiveAvailable(userquest.quest, tracker, i)) &&
          (isOnLocation ||
            // A masked target cannot be matched locally; the server owns its coordinates.
            ("hideLocation" in objective && objective.hideLocation) ||
            ("attackers" in objective &&
              objective.attackers &&
              objective.attackers.length > 0))
        ) {
          shouldCheckQuest = true;
        }
        const goal = tracker?.goals.find((g) => g.id === objective.id);
        if (
          (!tracker || isQuestObjectiveAvailable(userquest.quest, tracker, i)) &&
          objective.task === "collect_item" &&
          "collect_time_minutes" in objective &&
          objective.collect_time_minutes &&
          goal?.timestamp &&
          !goal.done &&
          !isOnLocation
        ) {
          shouldCheckQuest = true;
        }
        if (
          objective.task === "dialog" &&
          !objective.overworldPlacementId &&
          isOnLocation
        ) {
          setLogbookModalOpen(true);
          setLogbookModalQuestId(userquest.questId);
        }
      });
    });
    if (shouldCheckQuest || forceCheck) checkQuest();
  };

  /** Animate the marker tile-by-tile along a path, keeping the camera on it */
  const animateWalk = async (
    path: NonNullable<ReturnType<PathCalculator["getShortestPath"]>>,
    location: string,
  ) => {
    if (!userData) return;
    walkAnimatingRef.current = true;
    for (const tile of path) {
      if (!mountedRef.current || userRef.current?.status !== "AWAKE") break;
      originRef.current = tile;
      animatedPositionRef.current = { x: tile.col, y: tile.row };
      void updateUsersList(
        {
          ...userData,
          sector: sectorRef.current,
          longitude: tile.col,
          latitude: tile.row,
          location,
        } as UserData,
        true,
        true, // Skip state update during animation
      );
      await sleep(50);
    }
    walkAnimatingRef.current = false;
  };

  /** Window offset (dx,dy) of a sector currently in the 3x3 window */
  const offsetOfSector = (sector: number): { dx: number; dy: number } | null => {
    const entry = sectorWindowRef.current.sectors.find(
      (candidate) => candidate.sector === sector,
    );
    return entry ? { dx: entry.dx, dy: entry.dy } : null;
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
    if (!userData || !nav) return;
    walkAnimatingRef.current = true;
    for (const unifiedTile of unifiedPath) {
      if (!mountedRef.current || userRef.current?.status !== "AWAKE") break;
      const local = nav.fromUnified(unifiedTile);
      const entry = sectorWindowRef.current.sectors.find(
        (candidate) => candidate.dx === local.dx && candidate.dy === local.dy,
      );
      if (!entry) break;
      if (entry.sector !== sectorRef.current) {
        if (!reAnchorToSector(entry.sector, local.col, local.row)) break;
      }
      const hex = gridRef.current?.getHex({ col: local.col, row: local.row });
      if (!hex) continue;
      originRef.current = hex;
      animatedPositionRef.current = { x: local.col, y: local.row };
      void updateUsersList(
        {
          ...userData,
          sector: entry.sector,
          longitude: local.col,
          latitude: local.row,
          location,
        } as UserData,
        true,
        true,
      );
      await sleep(50);
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
    if (cross) {
      const atCrossEdge =
        (cross === "north" && data.latitude === sectorMap.height - 1) ||
        (cross === "south" && data.latitude === 0) ||
        (cross === "west" && data.longitude === 0) ||
        (cross === "east" && data.longitude === sectorMap.width - 1);
      if (atCrossEdge) {
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
    setMoves((prev) => prev + 1);
    if (crossingPromise) {
      await handleCrossing(
        crossingPromise,
        crossDest,
        { x: data.longitude, y: data.latitude },
        data.location,
      );
      return;
    }
    // Reconcile even when a stale client map could not animate a path.
    snapMovementPosition(data);
    // Update all state only once at the end to avoid excessive re-renders
    setPosition({ x: data.longitude, y: data.latitude });
    await updateUser({
      location: data.location,
      updatedAt: new Date(),
      longitude: data.longitude,
      latitude: data.latitude,
    });
    // Update surrounding users state at the end
    setSorrounding(usersRef.current.filter((u) => u?.userId) || []);
    runQuestTriggers(data);
  };

  // Crossing steps that are pre-fired during walk animations resolve
  // through this handler-less mutation; their responses are applied via
  // applyCrossing exactly when the local animation reaches the border
  const { mutateAsync: moveStepAsync } = api.travel.moveInSector.useMutation({
    meta: { handlesTransportError: true },
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
    direction: "north" | "east" | "south" | "west",
    from: SectorPoint,
    dest?: SectorPoint | null,
  ) => {
    const beyond =
      direction === "north"
        ? { x: from.x, y: sectorMap.height }
        : direction === "south"
          ? { x: from.x, y: -1 }
          : direction === "west"
            ? { x: -1, y: from.y }
            : { x: sectorMap.width, y: from.y };
    return {
      ...buildStepPayload(from, beyond, sectorRef.current),
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
    direction: "north" | "east" | "south" | "west",
  ): SectorPoint | null => {
    const pending = pendingWorldTargetRef.current;
    if (!pending) return null;
    const window = sectorWindowRef.current;
    const current = window.sectors.find(
      (candidate) => candidate.sector === sectorRef.current,
    );
    if (!current) return null;
    const ddx = direction === "east" ? 1 : direction === "west" ? -1 : 0;
    const ddy = direction === "north" ? 1 : direction === "south" ? -1 : 0;
    const adjacent = window.sectors.find(
      (candidate) =>
        candidate.dx === current.dx + ddx && candidate.dy === current.dy + ddy,
    );
    if (!adjacent || adjacent.sector !== pending.sector) return null;
    return { x: pending.x, y: pending.y };
  };

  /**
   * Re-anchor the character into the (already rendered) destination sector
   * at the border entry tile, then animate the server-committed remainder of
   * the walk to the landing tile - all client-side, no further round trips.
   */
  const applyCrossing = async (data: {
    sector: number;
    longitude: number;
    latitude: number;
    location: string;
    entryLongitude?: number | null;
    entryLatitude?: number | null;
  }) => {
    if (!userData) return;
    pendingCrossRef.current = null;
    sectorRef.current = data.sector;
    const entry = {
      x: data.entryLongitude ?? data.longitude,
      y: data.entryLatitude ?? data.latitude,
    };
    const registry = travel.scene.current;
    const wrapper = registry?.sectors.get(data.sector);
    const grid = registry?.sectors.get(data.sector)?.grid;
    const anchored = !!(wrapper && grid);
    if (wrapper && grid) {
      // The destination sector is already rendered: move the character
      // layers into its frame and keep walking - no scene rebuild
      gridRef.current = grid;
      pathFinderRef.current = new PathCalculator(grid);
      originRef.current = grid.getHex({ col: entry.x, row: entry.y });
      animatedPositionRef.current = { x: entry.x, y: entry.y };
      // The hover path follows the character into the new sector; any tiles
      // lit in the old window (across all sectors) are cleared so a stale
      // window offset can't leave an orphaned highlight behind
      clearAllHighlights();
      const entryMap = sectorWindowRef.current.sectors.find(
        (candidate) => candidate.sector === data.sector,
      )?.map;
      if (entryMap) registry?.setBackground(entryMap);
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
    if (pendingTarget) {
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
    } else {
      setTarget({ x: data.longitude, y: data.latitude });
    }
    await updateUser({
      sector: data.sector,
      longitude: data.longitude,
      latitude: data.latitude,
      location: data.location,
      updatedAt: new Date(),
    });
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
        originRef.current = finalHex;
        animatedPositionRef.current = { x: data.longitude, y: data.latitude };
        void updateUsersList(
          {
            ...userData,
            sector: data.sector,
            longitude: data.longitude,
            latitude: data.latitude,
            location: data.location,
          } as UserData,
          true,
          true,
        );
      }
      setMoves((prev) => prev + 1);
      setSorrounding(usersRef.current.filter((u) => u?.userId) || []);
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
  ) => {
    const nav = windowNavRef.current;
    // Every cylindrical-grid neighbor is aligned, so a click into an adjacent
    // sector can animate across the border without a scene rebuild.
    if (crossDest && nav) {
      const destOffset = offsetOfSector(crossDest.sector);
      const startU = nav.toUnified(0, 0, edge.x, edge.y);
      const goalU = destOffset
        ? nav.toUnified(destOffset.dx, destOffset.dy, crossDest.x, crossDest.y)
        : undefined;
      const navPath =
        startU && goalU ? nav.pathFinder.getShortestPath(startU, goalU) : undefined;
      if (navPath && navPath.length > 1) {
        pendingWorldTargetRef.current = null;
        // Walk across the border immediately (first tile is the edge we are
        // already standing on, so skip it)
        await animateWindowPath(navPath.slice(1), location);
        await reconcileCrossing(await crossingPromise);
        return;
      }
    }
    // Server-driven fallback: wait for the crossing, then re-anchor
    const crossingRes = await crossingPromise;
    if (crossingRes.success && crossingRes.data) {
      await applyCrossing(crossingRes.data);
      return;
    }
    await reconcileCrossing(crossingRes);
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
      setSorrounding(usersRef.current.filter((u) => u?.userId) || []);
    }
  };

  /** Commit the server result after an optimistic client walk. */
  const reconcileCrossing = async (res: Awaited<ReturnType<typeof moveStepAsync>>) => {
    if (res.success && res.data) {
      const d = res.data;
      snapMovementPosition(d);
      // The journey is complete; clear the target so the movement effect
      // does not re-issue a stale edge move against the new sector's grid
      setTarget(null);
      setPosition({ x: d.longitude, y: d.latitude });
      await updateUser({
        sector: d.sector,
        longitude: d.longitude,
        latitude: d.latitude,
        location: d.location,
        updatedAt: new Date(),
      });
      setSorrounding(usersRef.current.filter((u) => u?.userId) || []);
      // runQuestTriggers with forceCheck already issues checkQuest(), so calling
      // it here too fired the location-quest mutation twice per crossing (and,
      // through its invalidation, refetched the user's items twice)
      runQuestTriggers(d, true);
    } else {
      // Attacked (success without data) or rejected: re-sync from the server
      showMutationToast(res);
      await refreshMovementPosition();
    }
  };

  /** Rebuild the unified window pathfinder from the current window's maps */
  const rebuildWindowNav = () => {
    windowNavRef.current = buildWindowNav(
      sectorWindowRef.current.sectors.map((entry) => ({
        dx: entry.dx,
        dy: entry.dy,
        map: entry.map,
      })),
      // Adjacency only depends on grid coordinates, so the hex size is
      // arbitrary here (rendering uses the per-sector grids)
      10,
    );
  };

  const clearAllHighlights = () => travel.scene.current?.clearHighlights();

  const { mutate: move, isPending: isMoving } = api.travel.moveInSector.useMutation({
    onMutate: (input) => {
      movePendingRef.current = true;
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
      return { walk };
    },
    onSuccess: async (res, input, context) => {
      const walk = context?.walk ?? Promise.resolve();
      const data = res.data;
      if (!res.success || !data) {
        await walk;
        if (mountedRef.current) await reconcileCrossing(res);
        return;
      }
      if (data.sector !== input.sector) {
        await walk;
        if (mountedRef.current) await applyCrossing(data);
        return;
      }
      if (data.longitude !== input.longitude || data.latitude !== input.latitude) {
        await walk;
        if (mountedRef.current) {
          pendingCrossRef.current = null;
          pendingWorldTargetRef.current = null;
          await reconcileCrossing(res);
        }
        return;
      }
      await runJourneySegment(data, walk);
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
        document.body.style.cursor = "default";
      } else {
        // Navigation can outlive a committed move. Refresh rather than apply an
        // older location over a later action in this account's profile cache.
        await utils.profile.getUser.invalidate();
      }
    },
  });

  /** Step one tile beyond the border: the server resolves this as a crossing */
  const moveAcrossBorder = (
    direction: "north" | "east" | "south" | "west",
    from: SectorPoint,
  ) => {
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
    const rawEdge =
      primary === "north"
        ? { x: along, y: currentMap.height - 1 }
        : primary === "south"
          ? { x: along, y: 0 }
          : primary === "west"
            ? { x: 0, y: along }
            : { x: currentMap.width - 1, y: along };
    const edge = findNearestWalkableEdgeTile(currentMap, primary, rawEdge);
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
      if (result?.battleId || typeof result?.money === "number") {
        await updateUser(
          {
            ...(typeof result.money === "number" ? { money: result.money } : {}),
            ...(result.battleId
              ? { battleId: result.battleId, updatedAt: new Date() }
              : {}),
          },
          { revision },
        );
      }
      showMutationToast(result);
    },
  });

  const { mutate: attack, isPending: isAttacking } = api.combat.attackUser.useMutation({
    onSuccess: async (data) => {
      document.body.style.cursor = "default";
      if (data.success) {
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
    onError: () => {
      document.body.style.cursor = "default";
    },
  });

  const { mutate: interactNpc, isPending: isInteracting } =
    api.overworldAi.interactWithOverworldAi.useMutation({
      /** Applies battle/dialog results and refreshes state after an overworld NPC interaction. */
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success && data.battleId) {
          await updateUser({
            status: "BATTLE",
            battleId: data.battleId,
            updatedAt: new Date(),
          });
        } else if (data.success && data.dialog) {
          setNpcDialog(data.dialog);
        } else {
          // Refresh sector data (the NPC may have moved/disappeared) and the user profile so
          // a completed bound objective or granted mission shows immediately in the logbook.
          await Promise.all([
            utils.travel.getSectorData.invalidate(),
            utils.profile.getUser.invalidate(),
          ]);
        }
        if (data.rewardChoicePending) {
          void openRewardChoice();
        }
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
    };
    interactNpc({
      placementId: npc.npcPlacementId,
      positionVersion: npc.npcPositionVersion ?? 0,
    });
    return true;
  };

  /**
   * Handles an overworld NPC sprite click by interacting when adjacent or routing toward the NPC.
   * Returns whether the placement still resolves to a live NPC, allowing an attack-icon caller
   * to fall through to the normal player-interaction path when its sprite is stale.
   */
  const handleNpcTileInteraction = (placementId: string | undefined): boolean => {
    if (!placementId) return false;
    const npc = usersRef.current?.find((u) => u.npcPlacementId === placementId);
    if (!npc) {
      // Sprite is stale (placement despawned between scene build and click): refresh the sector so
      // the ghost sprite disappears, and report not-consumed so the caller isn't left with silent
      // no-op feedback.
      void utils.travel.getSectorData.invalidate();
      return false;
    }
    if (
      npc.longitude === originRef.current?.col &&
      npc.latitude === originRef.current?.row
    ) {
      interactWithNpc(npc);
    } else {
      setTarget({ x: npc.longitude, y: npc.latitude });
    }
    return true;
  };

  // Listening to webcket events
  // Dispose the live scene when the component unmounts
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      document.body.style.cursor = "default";
    };
  }, []);

  useEffect(() => {
    if (pusher) {
      const channel = pusher.subscribe(props.sector.toString());
      channel.bind("event", (data: UserData) => {
        if (data.userId && data.userId !== userRef.current?.userId) {
          // A broadcast with another sector means the user left this one
          if (data.sector !== props.sector) {
            const idx = usersRef.current.findIndex((u) => u.userId === data.userId);
            if (idx !== -1) {
              usersRef.current.splice(idx, 1);
              actorRevisionRef.current++;
              setSorrounding(usersRef.current.filter((u) => u?.userId) || []);
            }
            return;
          }
          void updateUsersList(data);
        }
      });
      return () => {
        pusher.unsubscribe(props.sector.toString());
      };
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

  // Close an open arrival prompt once it no longer describes reality: the NPC despawned out of the
  // sector data, or it and the player are no longer on the same tile (either one moved). Without the
  // position half, walking off the tile leaves the modal up and its CTA trips the server-side
  // "You are not standing on the NPC's tile" guard for a spurious error toast.
  useEffect(() => {
    if (!arrivalNpc) return;
    if (
      isArrivalPromptStale({
        promptedPlacementId: arrivalNpc.npcPlacementId ?? null,
        npcs: data?.overworldAis ?? [],
        playerLongitude: userData?.longitude,
        playerLatitude: userData?.latitude,
      })
    ) {
      setArrivalNpc(null);
    }
  }, [data?.overworldAis, arrivalNpc, userData?.longitude, userData?.latitude]);

  // Same stale-close for the dialog modal (keyed on the pending interaction's placement): close it
  // when the player walks off the NPC's tile or the NPC despawns, so a later branch click can't fire
  // an interaction against a tile the player no longer stands on (the server rejects it with a
  // spurious error toast).
  useEffect(() => {
    if (!npcDialog) return;
    const pending = pendingNpcInteractRef.current;
    if (
      !pending ||
      isArrivalPromptStale({
        promptedPlacementId: pending.placementId,
        npcs: data?.overworldAis ?? [],
        playerLongitude: userData?.longitude,
        playerLatitude: userData?.latitude,
      })
    ) {
      setNpcDialog(null);
    }
  }, [data?.overworldAis, npcDialog, userData?.longitude, userData?.latitude]);

  useEffect(() => {
    const longitude = userData?.longitude;
    const latitude = userData?.latitude;
    const status = userData?.status;
    if (longitude === undefined || latitude === undefined) return;

    // Suppression gates first: never stack on an in-flight interaction, an open dialog, or a
    // blocking global popup (e.g. daily rewards, which auto-opens on login and would otherwise
    // sit on top of this prompt), and only prompt when the interaction can actually succeed —
    // interactWithOverworldAi rejects every non-AWAKE status (BATTLE, HOSPITALIZED, ASLEEP,
    // TRAVEL, QUEUED, …), so gate on `!== "AWAKE"` rather than BATTLE alone to avoid showing a
    // modal whose CTA would immediately error. The gate runs before `arrivalPromptDecision`
    // arms `lastPromptedPlacementIdRef`, so a suppressed prompt is not consumed — once the popup
    // closes, `isBlockingPopupOpen` flips and this effect re-runs to fire the prompt.
    if (isInteracting || status !== "AWAKE" || npcDialog || isBlockingPopupOpen) return;

    const decision = arrivalPromptDecision({
      playerLongitude: longitude,
      playerLatitude: latitude,
      npcs: data?.overworldAis ?? [],
      lastPromptedPlacementId: lastPromptedPlacementIdRef.current,
    });
    lastPromptedPlacementIdRef.current = decision.lastPromptedPlacementId;
    if (decision.prompt) setArrivalNpc(decision.prompt);
  }, [
    userData?.longitude,
    userData?.latitude,
    userData?.status,
    data?.overworldAis,
    isInteracting,
    npcDialog,
    isBlockingPopupOpen,
  ]);

  // Auto-attack logic for ANBU users
  useEffect(() => {
    if (
      autoAttackMode &&
      userData?.anbuId &&
      userData?.status === "AWAKE" &&
      originRef.current &&
      !isMoving &&
      !movePendingRef.current &&
      !walkAnimatingRef.current &&
      !isAttacking &&
      sector === userData?.village?.sector
    ) {
      // Check if enough time has passed since last attack
      const now = Date.now();
      const lastAttackTime = lastAutoAttackTimeRef.current;
      const attackDelaySeconds = parseInt(
        safeLocalStorageGetItem("autoAttackDelay") || "5",
        10,
      );
      const attackDelayMs = attackDelaySeconds * 1000; // Convert seconds to milliseconds

      if (lastAttackTime && now - lastAttackTime < attackDelayMs) {
        return; // Not enough time has passed, wait
      }

      // Find nearby enemies to attack
      const nearbyEnemies = usersRef.current.filter((user) => {
        if (!user.userId || user.userId === userData.userId) return false;
        // Overworld NPCs share this list for map rendering/interaction, but are fought
        // through the overworld interact flow, not PvP attackUser — never auto-attack them.
        if (user.isNpc) return false;
        if (user.status !== "AWAKE") return false;

        // Don't attack banned users
        if (user.isBanned) return false;

        // Don't attack allies in active wars
        const areWarAllies =
          user.allianceStatus === "ALLY" ||
          (user.allianceStatus !== "ENEMY" &&
            isWarAllies(warData, userData.villageId, user.villageId));
        if (areWarAllies) {
          return false;
        }

        // Check if user is an enemy (different village and not ally)
        const isAlly =
          user.allianceStatus === "ALLY" ||
          (user.allianceStatus !== "ENEMY" && user.villageId === userData.villageId);

        if (isAlly) return false;

        // Check if user is in PvP restricted rank
        if (RANKS_RESTRICTED_FROM_PVP.includes(user.rank)) return false;

        // Check minimum level requirement
        const minLevel = parseInt(
          safeLocalStorageGetItem("autoAttackMinLevel") || "1",
          10,
        );
        if (user.level < minLevel) return false;

        return true;
      });
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
          attack({
            userId: closestEnemy.userId,
            longitude: closestEnemy.longitude,
            latitude: closestEnemy.latitude,
            sector: sectorRef.current,
            asset: originRef.current?.battleBiome,
          });
        } else {
          setTarget({ x: closestEnemy.longitude, y: closestEnemy.latitude });
        }
      }
    }
  }, [sorrounding, isMoving]);

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

  // This is where the actual movement happens
  useEffect(() => {
    // A journey animation is authoritative while it runs: its own pipeline
    // issues every needed move, so the effect must not double-request
    if (walkAnimatingRef.current || movePendingRef.current || isMoving) return;
    // The move payload falls back to IMG_AVATAR_DEFAULT, so a missing custom
    // avatar must not block movement (default-avatar users could not move).
    if (target && originRef.current && pathFinderRef.current && userData) {
      // Check user status
      if (userData.status !== "AWAKE") {
        setTarget(null);
        return;
      }
      // Get target hex
      const targetHex = gridRef?.current?.getHex({ col: target.x, row: target.y });
      // Guards
      if (!targetHex) return;
      if (target.x === originRef.current.col && target.y === originRef.current.row) {
        const cross = pendingCrossRef.current;
        if (cross) {
          pendingCrossRef.current = null;
          moveAcrossBorder(cross, { x: target.x, y: target.y });
        }
        return;
      }
      // Clear heal target if moving away
      if (healTargetUser) {
        setHealTargetUser(null);
      }
      // Get shortest path
      if (!isMoving) {
        document.body.style.cursor = "wait";
        move(
          buildStepPayload(
            { x: originRef.current.col, y: originRef.current.row },
            { x: targetHex.col, y: targetHex.row },
            sectorRef.current,
          ),
        );
      }
    }
  }, [target, userData, moves, sector, isMoving, move]);

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
              isBanned:
                "isBanned" in user
                  ? Boolean((user as { isBanned?: boolean }).isBanned)
                  : false,
              isOutlaw: user.isOutlaw || false,
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

      // Check if user is on a structure
      if (structures) {
        const structure = structures.find((s) => {
          if (s.longitude === userData.longitude && s.latitude === userData.latitude)
            return true;
          return STRUCTURE_ADJACENTS.some(
            ({ dCol, dRow }) =>
              s.longitude === userData.longitude + dCol &&
              s.latitude === userData.latitude + dRow,
          );
        });
        setCurrentStructure(structure || null);
      } else {
        setCurrentStructure(null);
      }
    }
  }, [userData, villageData, structures]);

  const onTravelTap = (hit: TravelPick) => {
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
        if (handleNpcTileInteraction(i.npcPlacementId as string | undefined)) {
          return false;
        }
        return true;
      } else if (showUsersRef.current && i.type === "talk") {
        if (handleNpcTileInteraction(i.npcPlacementId as string | undefined)) {
          return false;
        }
        // Stale sprite (placement despawned): keep the tile clickable
        return true;
      } else if (showUsersRef.current && i.type === "attack") {
        const npcPlacementId = i.npcPlacementId as string | undefined;
        if (npcPlacementId) {
          if (handleNpcTileInteraction(npcPlacementId)) {
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
            attack({
              userId: target.userId,
              longitude: target.longitude,
              latitude: target.latitude,
              sector: sectorRef.current,
              asset: originRef.current?.battleBiome,
            });
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
        const userId = i.userId as string;
        void router.push(`/userid/${userId}`);
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
      pathFinderRef.current = new PathCalculator(entry.grid);
      const position = animatedPositionRef.current ?? {
        x: userRef.current?.longitude ?? 0,
        y: userRef.current?.latitude ?? 0,
      };
      originRef.current = entry.grid.getHex({ col: position.x, row: position.y });
      rebuildWindowNav();
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
    window: sectorWindow.sectors.map((entry) => {
      const structures = [
        ...entry.structures,
        ...(entry.sector === sectorRef.current ? dungeonStructures : []),
      ];
      if (!structures.some((structure) => structure.route === "/shrine"))
        structures.push(createShrineStructure(entry.map, entry.globalTileType));
      return { ...entry, structures };
    }),
    showUsers: showActive,
    minBracket: storedBracket,
    friendlyAttack: allyAttack,
    structureObjectiveIds: structureObjectiveIdsRef.current,
    nav: windowNavRef.current,
    enabled: !props.showSorrounding,
    brightness: 1,
    decorations: mergedDecorations,
    terrains: mergedTerrains,
    libraryVersion,
    locations: questLocations,
    mapAssets: sectorWindow.mapAssets,
  };
  const travel = useGameScene(
    mountRef,
    async (mount, signal, onError) =>
      createTravelScene({
        mount,
        signal,
        onError,
        lightLayout,
        initialZoom: openSectorZoomedIn ? SECTOR_MAX_ZOOM : storedZoom,
        onZoom: setStoredZoom,
        getSnapshot: () => {
          const snapshot = travelSnapshot.current;
          if (!snapshot) throw new Error("Travel snapshot unavailable");
          return {
            ...snapshot,
            actorRevision: actorRevisionRef.current,
            sector: sectorRef.current,
            viewer: userRef.current,
            users: usersRef.current,
            col: animatedPositionRef.current?.x ?? userRef.current?.longitude ?? 0,
            row: animatedPositionRef.current?.y ?? userRef.current?.latitude ?? 0,
            nav: windowNavRef.current,
            enabled:
              !showSorroundingRef.current &&
              performance.now() >= ignoreMapClicksUntilRef.current,
            brightness: showDayNightMapOverlaysRef.current
              ? getWorldCycleBrightness(new Date(Date.now() - timeDiffRef.current))
              : 1,
          };
        },
        onTap: (hit) => travelCallbacks.current.onTap(hit),
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
    lightLayout,
  );
  useEffect(() => {
    if (!travel.isReady) return;
    travelCallbacks.current.onReady();
    setMoves((previous) => previous + 1);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [travel.isReady]);
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

  return (
    <>
      <div className="relative">
        <div id="tutorial-travel-sector" ref={mountRef}></div>
        <aside
          aria-label="Map compass and neighboring sectors"
          className="pointer-events-none absolute top-3 left-3 z-10 rounded-lg border bg-background/90 p-2 text-center text-xs shadow-md backdrop-blur-sm"
        >
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1 tabular-nums">
            <span className="col-span-3">
              N ·{" "}
              {sectorGridNeighbors(sector)[0] < 0
                ? "Polar boundary"
                : sectorGridNeighbors(sector)[0]}
            </span>
            <span className="whitespace-nowrap text-right">
              {sectorGridNeighbors(sector)[3]} · W
            </span>
            <span className="min-w-8 rounded border border-foreground/20 bg-muted px-1.5 py-0.5 font-bold">
              <span className="sr-only">Current sector </span>
              {sector}
            </span>
            <span className="whitespace-nowrap text-left">
              E · {sectorGridNeighbors(sector)[1]}
            </span>
            <span className="col-span-3">
              S ·{" "}
              {sectorGridNeighbors(sector)[2] < 0
                ? "Polar boundary"
                : sectorGridNeighbors(sector)[2]}
            </span>
          </div>
          <div className="mt-1 text-muted-foreground">
            Gold lines mark sector borders
          </div>
        </aside>
        <DayNightIndicator className="absolute top-3 right-3 z-10 rounded-lg border bg-background/90 px-3 py-2 shadow-md backdrop-blur-sm" />
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
        <div className="absolute bottom-3 left-3 z-20 max-w-[calc(50%-1.5rem)] rounded-lg bg-black/70 p-2 text-white shadow-lg sm:bottom-4 sm:left-4 sm:max-w-xs sm:p-4">
          <div className="flex items-center gap-4">
            <div className="hidden shrink-0 sm:block">
              <Image
                src={currentStructure.image}
                alt={currentStructure.name}
                width={48}
                height={48}
                className="rounded-md"
              />
            </div>
            <div className="min-w-0">
              <h3
                className="truncate font-semibold text-sm sm:text-lg"
                title={currentStructure.name}
              >
                {currentStructure.name}
              </h3>
              <Link
                href={currentStructure.route}
                className="mt-2 inline-block rounded-md bg-blue-500 px-2 py-2 font-medium text-white text-xs transition-colors hover:bg-blue-600 sm:px-4 sm:text-sm"
              >
                Enter {currentStructure.name}
              </Link>
            </div>
          </div>
        </div>
      )}
      {/* Stack corner actions so dungeon, hover and raid cards share the map without overlap. */}
      <div className="pointer-events-none absolute right-3 bottom-3 z-20 flex max-w-[calc(50%-1.5rem)] flex-col items-end gap-2 sm:right-4 sm:bottom-4 sm:max-w-xs">
        <MapLocationActions
          arrived={arrivedLocations}
          hovered={hoveredLocation}
          onInspect={(location, trigger) => {
            inspectTriggerRef.current = trigger;
            setInspectLocationId(location.id);
          }}
          onQuest={(questId) => {
            setLogbookModalQuestId(questId);
            setLogbookModalOpen(true);
          }}
          onGoTo={(location) =>
            setTarget({ x: location.longitude, y: location.latitude })
          }
        />
        {hoveredStructure && hoveredStructure.id !== currentStructure?.id && (
          <div className="pointer-events-auto w-full rounded-lg bg-black/70 p-2 text-white shadow-lg sm:p-4">
            <div className="flex items-center gap-4">
              <div className="hidden shrink-0 sm:block">
                <Image
                  src={hoveredStructure.image}
                  alt={hoveredStructure.name}
                  width={48}
                  height={48}
                  className="rounded-md"
                />
              </div>
              <div className="min-w-0">
                <h3
                  className="truncate font-semibold text-sm sm:text-lg"
                  title={hoveredStructure.name}
                >
                  {hoveredStructure.name}
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    setTarget({
                      x: hoveredStructure.longitude,
                      y: hoveredStructure.latitude,
                    })
                  }
                  className="mt-2 inline-block rounded-md bg-blue-500 px-2 py-2 font-medium text-white text-xs transition-colors hover:bg-blue-600 sm:px-4 sm:text-sm"
                >
                  Go to {hoveredStructure.name}
                </button>
              </div>
            </div>
          </div>
        )}
        {activeRaid && (
          <div className="pointer-events-auto w-full rounded-lg bg-black/70 p-2 text-white shadow-lg sm:p-4">
            <div className="flex items-center gap-4">
              <Swords className="hidden h-12 w-12 shrink-0 text-red-500 sm:block" />
              <div className="min-w-0">
                <h3
                  className="truncate font-semibold text-sm sm:text-lg"
                  title={activeRaid.name}
                >
                  {activeRaid.name}
                </h3>
                <p className="text-gray-300 text-sm">Active Raid in this sector</p>
                <button
                  type="button"
                  onClick={() => setShowRaidModal(true)}
                  className="mt-2 inline-block rounded-md bg-red-600 px-2 py-2 font-medium text-white text-xs transition-colors hover:bg-red-700 sm:px-4 sm:text-sm"
                >
                  View Raid
                </button>
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
                  className="truncate font-semibold text-sm sm:text-lg"
                  title={dungeonStructures.length === 1 ? firstDungeon.name : undefined}
                >
                  {dungeonStructures.length === 1
                    ? firstDungeon.name
                    : `Dungeons (${dungeonStructures.length})`}
                </h3>
                <Link
                  href="/dungeon"
                  className="mt-2 inline-block rounded-md bg-blue-500 px-2 py-2 font-medium text-white text-xs transition-colors hover:bg-blue-600 sm:px-4 sm:text-sm"
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
        <SorroundingUsers
          setIsOpen={props.setShowSorrounding}
          users={sorrounding}
          userData={userData}
          timeDiff={timeDiff}
          hex={originRef.current}
          allyAttack={allyAttack}
          setAllyAttack={setAllyAttack}
          storedBracket={storedBracket}
          setStoredBracket={setStoredBracket}
          attackUser={(userId) => {
            const target = sorrounding.find((u) => u.userId === userId);
            if (target && !isAttacking && !movePendingRef.current) {
              attack({
                userId: target.userId,
                longitude: target.longitude,
                latitude: target.latitude,
                sector: sectorRef.current,
                asset: originRef.current?.battleBiome,
              });
            }
          }}
          robUser={(userId) => {
            const target = sorrounding.find((u) => u.userId === userId);
            if (target && !isRobbing && !movePendingRef.current) {
              rob({
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
      {logbookModalOpen && modalUserQuest && modalTracker && (
        <Modal
          isOpen={logbookModalOpen}
          setIsOpen={setLogbookModalOpen}
          title="Quest Update"
        >
          <LogbookEntry
            userQuest={modalUserQuest}
            tracker={modalTracker}
            showScene={true}
            hideTitle={false}
          />
        </Modal>
      )}
      {targetUser && (isAttacking || userData?.status === "BATTLE") && (
        <div className="absolute top-0 right-0 bottom-0 left-0 z-20 m-auto flex flex-col justify-center bg-black">
          <div className="m-auto text-center text-white">
            <p className="p-5 text-3xl">
              <AvatarImage
                href={targetUser.avatar}
                userId={targetUser.userId}
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
            userData={userData}
            timeDiff={timeDiff}
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
      {/* Hunting can receive focus later without dismissing this NPC arrival. */}
      {arrivalNpc && (
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
      {npcDialog && pendingNpcInteractRef.current && (
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
                className="h-auto w-full justify-start whitespace-normal text-left"
                onClick={() => {
                  const ctx = pendingNpcInteractRef.current;
                  if (ctx && !isInteracting) {
                    interactNpc({
                      placementId: ctx.placementId,
                      positionVersion: ctx.positionVersion,
                      // A terminal branch has no follow-up objective; send an objective-scoped
                      // sentinel so the server completes this dialog objective instead of
                      // re-opening the same dialog.
                      dialogContentId:
                        branch.nextObjectiveId ??
                        `${TERMINAL_DIALOG_PREFIX}${npcDialog.objectiveId}`,
                    });
                  }
                  setNpcDialog(null);
                }}
              >
                {branch.text}
              </Button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
};

export default Sector;

/**
 * Identity of the synthetic shrine, which is created once for the sector state
 * and again for the rendered scene. Both copies must share an id so a hit test
 * hit on the shrine sprite resolves back to a structure, the same way it does
 * for database-backed buildings.
 */
const SECTOR_SHRINE_ID = "sector-shrine";

/**
 * Mobile browsers synthesize a click on whatever sits under a dialog after the
 * overlay unmounts from the same tap. Keep the sector canvas deaf for that
 * window so closing scouting cannot also walk to a tile.
 */
const MAP_CLICK_BLOCK_AFTER_MODAL_MS = 400;

const createShrineStructure = (map: NormalizedSectorMap, globalTileType: number) => {
  const shrineAnchor = map.anchors.find((anchor) => anchor.key === "shrine.default");
  return {
    ...createGenericStructure({
      name: "Sector Shrine",
      route: "/shrine",
      image:
        WAR_SHRINE_IMAGE_BY_BIOME[
          getBiomeAtSectorAnchor(map, "shrine.default", globalTileType)
        ],
      longitude: shrineAnchor?.x ?? 10,
      latitude: shrineAnchor?.y ?? 5,
    }),
    id: SECTOR_SHRINE_ID,
  };
};

interface SorroundingUsersProps {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  userData: NonNullable<UserWithRelations>;
  timeDiff: number;
  hex: TerrainHex;
  users: SectorUser[];
  allyAttack: boolean;
  setAllyAttack: (newValue: boolean) => void;
  storedBracket: number;
  setStoredBracket: (newValue: number) => void;
  attackUser: (userId: string) => void;
  robUser: (userId: string) => void;
  move: (longitude: number, latitude: number) => void;
}

export const SorroundingUsers: React.FC<SorroundingUsersProps> = (props) => {
  // Destructure props
  const { userData, timeDiff, storedBracket, setStoredBracket } = props;

  // Query
  const { data } = api.village.getAll.useQuery(undefined);

  // Form control
  const {
    register,
    setValue,
    control,
    formState: { errors },
  } = useForm<BracketSliderSchema>({
    resolver: zodResolver(bracketSliderSchema),
    defaultValues: { value: storedBracket ?? -1 },
  });
  const watchedBracket = round(useWatch({ control, name: "value" }));
  const isBracketFilterActive = watchedBracket >= 0;

  const users = getScoutingUsers(props.users, userData.userId, watchedBracket);

  // Update the localStorage whenever we change
  useEffect(() => {
    setStoredBracket(watchedBracket);
  }, [watchedBracket]);

  return (
    <Modal
      isOpen={true}
      title={`Scouting. Your position: [${props.hex.col}, ${props.hex.row}]`}
      setIsOpen={props.setIsOpen}
      isValid={false}
      className="md:max-w-[calc(100%-2rem)]"
    >
      {users.length === 0 && (
        <p className="text-red-500">
          {isBracketFilterActive
            ? `No awake users match your scouting filters (bracket ${watchedBracket})`
            : "No awake users in this sector"}
        </p>
      )}
      <div className="grid grid-cols-3 gap-4 pb-3 text-center sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 xl:grid-cols-14">
        {users.map((user) => {
          // Derived
          const sameHex =
            user.latitude === props.hex.row && user.longitude === props.hex.col;
          const village = data?.find((v) => v.id === user.villageId);
          const villageName = village ? village.name : "Unknown";
          const villageColor = village ? village.hexColor : "gray";
          const relationship =
            userData.village &&
            findVillageUserRelationship(userData.village, user.villageId);
          const isAlly =
            user.allianceStatus === "ALLY" ||
            (user.allianceStatus !== "ENEMY" &&
              (user.villageId === userData.villageId ||
                relationship?.status === "ALLY"));
          const isPvpRestrictedRank = RANKS_RESTRICTED_FROM_PVP.includes(user.rank);
          const showAttack = !isPvpRestrictedRank && (props.allyAttack || !isAlly);
          const showRob = !isPvpRestrictedRank && sameHex && userData.isOutlaw;
          // Elite rank/level remain known when a partial map update omits experience.
          const userBracket =
            user.rank === "ELITE JONIN"
              ? MAX_PVP_BRACKET
              : user.experience == null
                ? null
                : getExpBracket(user.experience, user.rank);
          const userLevel =
            user.rank === "ELITE JONIN"
              ? user.level
              : user.experience == null
                ? null
                : getEffectiveLevel({ ...user, experience: user.experience });

          // Show user
          return (
            <div key={`${user.userId}-sorrounding-${user.longitude}-${user.latitude}`}>
              <div className="relative">
                <div className="absolute top-0 right-0 z-50 max-w-1/3 hover:cursor-pointer hover:opacity-80">
                  {showAttack && sameHex && (
                    <Image
                      src={IMG_SECTOR_ATTACK}
                      onClick={() => props.attackUser(user.userId)}
                      width={40}
                      height={40}
                      alt={`Attack-${user.userId}`}
                    />
                  )}

                  {!sameHex && (
                    <Image
                      src={IMG_ICON_MOVE}
                      onClick={() => props.move(user.longitude, user.latitude)}
                      width={40}
                      height={40}
                      alt={`Move-${user.userId}`}
                    />
                  )}
                </div>
                {!user.isMasked && (
                  <div className="absolute top-0 left-0 z-50 max-w-1/3 hover:cursor-pointer hover:opacity-80">
                    <Link href={`/userid/${user.userId}`}>
                      <Image
                        src={IMG_SECTOR_INFO}
                        width={40}
                        height={40}
                        alt={`Info-${user.userId}`}
                      />
                    </Link>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 z-50 max-w-1/3 hover:cursor-pointer hover:opacity-80">
                  {user.curHealth < user.maxHealth &&
                    hasRequiredRank(userData.rank, MEDNIN_MIN_RANK) && (
                      <HealingPopover
                        targetUser={user}
                        userData={userData}
                        timeDiff={timeDiff}
                        side="top"
                      />
                    )}
                </div>
                <AvatarImage
                  href={user.avatar}
                  userId={user.userId}
                  alt={user.username}
                  size={512}
                />
              </div>
              <div className="relative">
                {showRob && (
                  <div className="absolute right-0 bottom-0 z-50 w-1/3 hover:cursor-pointer hover:opacity-80">
                    <Image
                      src={IMG_SECTOR_ROB}
                      onClick={() => {
                        if (
                          user.robImmunityUntil &&
                          user.robImmunityUntil > new Date()
                        ) {
                          showMutationToast({
                            success: false,
                            message: "Target is immune from being robbed",
                          });
                        } else {
                          props.robUser(user.userId);
                        }
                      }}
                      width={40}
                      height={40}
                      alt={`Rob-${user.userId}`}
                      className={`ml-1 ${user.robImmunityUntil && user.robImmunityUntil > new Date() ? "opacity-50" : ""}`}
                    />
                  </div>
                )}
              </div>
              <p>{user.username}</p>
              <p className="text-xs">
                Lvl. {userLevel ?? "?"} · Bracket{" "}
                {userBracket == null ? "?" : `${userBracket}/${MAX_PVP_BRACKET}`} [
                {user.longitude}, {user.latitude}]
              </p>
              <p style={{ color: villageColor }} className="font-bold">
                {villageName}
              </p>
            </div>
          );
        })}
      </div>
      <hr />
      <div className="pt-3">
        <SliderField
          id="value"
          default={-1}
          min={-1}
          max={MAX_PVP_BRACKET}
          unit="bracket"
          label="Select bracket to show"
          register={register}
          setValue={setValue}
          watchedValue={watchedBracket}
          formatWatchedValue={(value) =>
            value < 0 ? "Selected: Off (no filter)" : `Selected: bracket ${value}`
          }
          error={errors.value?.message}
        />
        <div className="flex flex-row items-center">
          <Checkbox
            className="m-1 mr-3"
            checked={props.allyAttack}
            onCheckedChange={() => props.setAllyAttack(!props.allyAttack)}
          />
          <Label>Attack button on allies</Label>
        </div>
      </div>
    </Modal>
  );
};
