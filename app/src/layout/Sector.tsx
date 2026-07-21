"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import alea from "alea";
import type { Grid } from "honeycomb-grid";
import { useAtomValue } from "jotai";
import { Swords } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  Group,
  type Material,
  type MeshBasicMaterial,
  OrthographicCamera,
  type Sprite,
  Vector2,
} from "three";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  HEX_ASPECT_RATIO,
  HEX_STACKING_DISPLACEMENT,
  IMG_AVATAR_DEFAULT,
  IMG_ICON_MOVE,
  IMG_SCENE_BACKGROUND,
  IMG_SECTOR_ATTACK,
  IMG_SECTOR_INFO,
  IMG_SECTOR_ROB,
  MEDNIN_MIN_RANK,
  RANKS_RESTRICTED_FROM_PVP,
  STRUCTURE_ADJACENTS,
  TERMINAL_DIALOG_PREFIX,
  WAR_SHRINE_IMAGE_BY_BIOME,
  XP_BRACKETS,
} from "@/drizzle/constants";
import type { UserData, VillageStructure } from "@/drizzle/schema";
import { safeLocalStorageGetItem, useLocalStorage } from "@/hooks/localstorage";
import { usePerformanceMonitor } from "@/hooks/performance-monitor";
import AvatarImage from "@/layout/Avatar";
import HealingPopover from "@/layout/HealingPopover";
import Image from "@/layout/Image";
import { LogbookEntry } from "@/layout/Logbook";
import Modal2 from "@/layout/Modal2";
import RaidBrowser from "@/layout/RaidBrowser";
import SliderField from "@/layout/SliderField";
import WebGlError from "@/layout/WebGLError";
import type { HexagonalFaceMesh, TerrainHex } from "@/libs/hexgrid";
import { findHex, PathCalculator } from "@/libs/hexgrid";
import { isQuestObjectiveAvailable } from "@/libs/objectives";
import {
  arrivalPromptDecision,
  findActionableBoundObjective,
  isArrivalPromptStale,
  pickSpriteAvatar,
  resolveArrivalPromptCta,
} from "@/libs/overworldAi";
import { calcLevel, getExpBracket, passesBracketFilter } from "@/libs/profile";
import {
  GATHERING_CANCEL_PREFIX,
  getBoundObjectiveCandidates,
  isLocationObjective,
} from "@/libs/quest";
import { mergeDecorationAssets } from "@/libs/sector-map/decorations";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { isUserCurrentlyStealthed } from "@/libs/stealth";
import { getBackgroundColor } from "@/libs/threejs/biome";
import { OrbitControls } from "@/libs/threejs/OrbitControls";
import {
  buildWindowNav,
  createGenericStructure,
  drawQuest,
  drawSector,
  drawUsers,
  drawVillage,
  intersectStructures,
  intersectUsers,
  intersectWindowTiles,
  sortSectorAssetsByGroundContact,
  type WindowNav,
} from "@/libs/threejs/sector";
import { updateWaveAnimation, updateWindAnimation } from "@/libs/threejs/shaders";
import type { GlobalTile, SectorPoint, SectorUser } from "@/libs/threejs/types";
import {
  cleanUp,
  disposeGroupPreservingShared,
  isRendererContextValid,
  profiler,
  safeRemoveRendererElement,
  setRaycasterFromMouse,
  setupContextLossHandling,
  setupScene,
  smoothCameraFollow,
} from "@/libs/threejs/util";
import { showMutationToast } from "@/libs/toast";
import { hasRequiredRank } from "@/libs/train";
import { getBiomeAtSectorAnchor } from "@/libs/travel";
import { isWarAllies } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import { findVillageUserRelationship, getAllyStatus } from "@/utils/alliance";
import { round } from "@/utils/math";
import { parseHtml } from "@/utils/parse";
import { sleep } from "@/utils/time";
import { blockingPopupOpenAtom, useRequiredUserData } from "@/utils/UserContext";
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
  mapAssets: RouterOutputs["mapAsset"]["getAll"];
  mapTerrains: RouterOutputs["mapTerrain"]["getAll"];
  sectors: SectorWindowEntry[];
}

/** Everything rendered for one sector of the 3x3 window */
interface SectorRenderEntry {
  wrapper: Group;
  grid: Grid<TerrainHex>;
  interaction: Group;
  assets: Group;
  animatedMaterials: MeshBasicMaterial[];
  /** Identity of the rendered content; a mismatch re-renders the sector */
  renderKey: string;
}

/** Content identity of a window entry: map version plus dynamic structures */
const renderKeyOf = (entry: SectorWindowEntry) => {
  const structuresKey = entry.structures
    .map((s) => `${s.id}:${s.level}:${s.image}:${s.longitude}:${s.latitude}`)
    .join(",");
  return [
    entry.map.metadata.importedAt,
    entry.map.metadata.sourceHash ?? "",
    entry.villageType ?? "",
    structuresKey,
  ].join("|");
};

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
    if (tile.blocked || tile.walkCost <= 0) return false;
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
const Sector: React.FC<SectorProps> = (props) => {
  // Incoming props
  const { sector, sectorWindow, target, showActive, autoAttackMode } = props;
  // The window always contains the current sector: crossings move into a
  // sector that was part of the previous window
  const centerEntry = sectorWindow.sectors.find((entry) => entry.sector === sector);
  if (!centerEntry) throw new Error(`Sector ${sector} missing from window`);
  const sectorMap = centerEntry.map;
  const { setTarget, setPosition } = props;

  // Light layout preference state
  const [lightLayout] = useLocalStorage<boolean>("lightLayout", false);

  // Performance monitoring
  const performanceMonitor = usePerformanceMonitor(false);

  // State pertaining to the sector
  const [webglError, setWebglError] = useState<boolean>(false);
  const [targetUser, setTargetUser] = useState<SectorUser | null>(null);
  const [healTargetUser, setHealTargetUser] = useState<SectorUser | null>(null);
  const [moves, setMoves] = useState(0);
  const [sorrounding, setSorrounding] = useState<SectorUser[]>([]);
  const [allyAttack, setAllyAttack] = useLocalStorage<boolean>("friendlyAttack", false);
  const [storedBracket, setStoredBracket] = useLocalStorage<number>(
    "minBracketOnScout",
    -1,
  );
  const [storedZoom, setStoredZoom] = useLocalStorage<number>("sectorZoom", 2);
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
  const showUsersRef = useRef<boolean>(showActive);
  const minBracketDrawRef = useRef<number>(storedBracket);
  const hoveredStructureIdRef = useRef<string | null>(null);
  const structuresRef = useRef<VillageStructure[]>([]);
  const showAllyAttackRef = useRef<boolean>(allyAttack);
  const userRef = useRef<UserWithRelations>(undefined);
  const lastAutoAttackTimeRef = useRef<number | null>(null);
  // Mirror the attack-pending flag into a ref so the render loop's click guard
  // can read it without the flag being a scene-build effect dependency (which
  // would tear down and rebuild the whole 3x3 world on every attack).
  const isAttackingRef = useRef<boolean>(false);
  // Same for the NPC-interaction flag: the click guard reads it from a ref so a
  // pending interaction never rebuilds the world.
  const isInteractingRef = useRef<boolean>(false);
  // The hover-path raycast scans ~6000 window interaction meshes; only re-run it
  // when the pointer moved or the player's origin changed, reusing the previous
  // highlights on idle frames.
  const pathDirtyRef = useRef<boolean>(true);
  const lastPathKeyRef = useRef<string>("");
  // The hover raycast also depends on the camera pose and the window nav; track
  // both so a zoom/pan or a freshly-loaded neighbor re-runs it even if the
  // pointer and origin held still.
  const lastCamKeyRef = useRef<string>("");
  const lastNavRef = useRef<unknown>(null);
  const pendingCrossRef = useRef<"north" | "east" | "south" | "west" | null>(null);
  const worldRegistryRef = useRef<{
    wrappers: Map<number, Group>;
    grids: Map<number, Grid<TerrainHex>>;
    entries: Map<number, SectorRenderEntry>;
    groupUsers: Group | null;
    groupQuest: Group | null;
    worldRoot: Group | null;
    buildWidth: number;
    spanX: number;
    spanY: number;
    setBackground: ((map: NormalizedSectorMap) => void) | null;
  }>({
    wrappers: new Map(),
    grids: new Map(),
    entries: new Map(),
    groupUsers: null,
    groupQuest: null,
    worldRoot: null,
    buildWidth: 0,
    spanX: 0,
    spanY: 0,
    setBackground: null,
  });
  // Render-loop collections; window updates swap sectors in and out of these
  // without rebuilding the scene
  const interactionGroupsRef = useRef<Group[]>([]);
  const assetsGroupsRef = useRef<Group[]>([]);
  // The window's building sprites, so the per-frame label hover raycast only
  // tests a handful of structures instead of every decoration sprite
  const structureSpritesRef = useRef<Sprite[]>([]);
  const animatedMaterialsRef = useRef<
    ReturnType<typeof drawSector>["animatedMaterials"]
  >([]);
  // Flat, deduped list of the window's wind-shader sprite materials, collected
  // once per window patch so the per-frame loop updates the handful of unique
  // materials instead of re-traversing every decoration sprite across 9 sectors
  const windMaterialsRef = useRef<Material[]>([]);
  // One logical grid over the whole 3x3 window, so paths and hover highlights
  // cross sector borders as if the world were a single map
  const windowNavRef = useRef<WindowNav | null>(null);
  const rebuildSceneRef = useRef<(() => void) | null>(null);
  // Incremented whenever a completed crossing changes the window center, so
  // stale async window patches cannot win a race against the latest crossing.
  const windowUpdateTokenRef = useRef(0);
  const centerOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // The character's live tile during walk animations; authoritative for
  // scene rebuilds that land mid-walk (userData only updates on completion)
  const animatedPositionRef = useRef<{ x: number; y: number } | null>(null);
  const pendingWorldTargetRef = useRef<{ sector: number; x: number; y: number } | null>(
    null,
  );
  // Client-authoritative sector id: updated imperatively the moment a
  // crossing commits (the prop lags a render behind), synced on prop change
  const walkAnimatingRef = useRef(false);
  const activeSceneTeardownRef = useRef<(() => void) | null>(null);
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
  const cameraRef = useRef<OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraTargetPositionRef = useRef<{ x: number; y: number } | null>(null);
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
  const mergedTerrainsRef = useRef(mergedTerrains);
  mergedTerrainsRef.current = mergedTerrains;
  const mergedDecorationsRef = useRef(mergedDecorations);
  mergedDecorationsRef.current = mergedDecorations;
  const mouse = new Vector2();
  // False while the pointer is off the map, so the render loop clears the
  // hover path instead of leaving it frozen at the last tile
  const pointerOnMapRef = useRef(false);

  // tRPC utility
  const utils = api.useUtils();

  // Data from db
  const { data: userData, pusher, timeDiff, updateUser } = useRequiredUserData();
  const { data } = api.travel.getSectorData.useQuery(
    { sector: sector },
    { enabled: sector !== undefined, placeholderData: (previous) => previous },
  );
  const villageData = data?.village;
  // Overworld AIs share the sector-user rendering path, so merge them into the
  // fetched user list before it reaches the scene
  const fetchedUsers = useMemo(
    () =>
      data?.users === undefined
        ? undefined
        : [...data.users, ...(data.overworldAis ?? [])],
    [data?.users, data?.overworldAis],
  );
  const usersReady = fetchedUsers !== undefined;
  const warData = data?.warData;
  // Ensure a shrine exists for the sector without mutating the cached tRPC
  // structures array (pushing into it corrupts the query cache and could leave a
  // shrine at stale coordinates when anchors change).
  const structures = useMemo(() => {
    const base = villageData?.structures ?? [];
    if (base.some((s) => s.route === "/shrine")) return base;
    return [...base, createShrineStructure(sectorMap, props.tile.t)];
  }, [villageData?.structures, sectorMap, props.tile.t]);
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

  // Router for forwarding
  const router = useRouter();

  // Convenience calculations
  const isInSector = userData?.sector === props.sector;

  // Background color for the map
  const { color } = getBackgroundColor(
    sectorMap.tiles.find((tile) => !tile.blocked)?.battleBiome ?? props.tile,
  );

  // If new objective is available, then show a modal
  const modalUserQuest = userData?.userQuests?.find(
    (q) => q.questId === logbookModalQuestId,
  );
  const modalTracker = userData?.questData?.find((q) => q.id === logbookModalQuestId);

  // Update mouse position on mouse move
  const onDocumentMouseMove = (event: MouseEvent) => {
    if (mountRef.current) {
      const bounding_box = mountRef.current.getBoundingClientRect();
      mouse.x = (event.offsetX / bounding_box.width) * 2 - 1;
      mouse.y = -((event.offsetY / bounding_box.height) * 2 - 1);
      pointerOnMapRef.current = true;
      pathDirtyRef.current = true;
    }
  };

  // When the pointer leaves the map (e.g. flicked off the edge) no more
  // mousemove events fire, which would otherwise freeze the hover path where
  // it was. Flag it so the render loop clears every highlight next frame.
  const onDocumentMouseLeave = () => {
    pointerOnMapRef.current = false;
    pathDirtyRef.current = true;
  };

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
        // Invalidate user items
        await utils.item.getUserItems.invalidate();
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
            if (!skipStateUpdate) {
              setSorrounding(usersRef.current.filter((u) => u?.userId) || []);
            }
          }
          return;
        }

        const allianceStatus = getAllyStatus(userData?.village, data.villageId);
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
                  await sleep(50);
                }
              }
            }
          }
        } else {
          // New user enters — do not invent experience; unknown XP fails closed in bracket filters
          usersRef.current.push({ ...data, allianceStatus });
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
        if (objective.task === "dialog" && isOnLocation) {
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
      cameraTargetPositionRef.current = {
        x: tile.center.x - centerOffsetRef.current.x,
        y: tile.center.y - centerOffsetRef.current.y,
      };
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
   * round trip): re-parent the marker layers, re-point the grid/pathfinder,
   * follow the camera, background and hover-highlight into it.
   */
  const reAnchorToSector = (sector: number, col: number, row: number): boolean => {
    const registry = worldRegistryRef.current;
    const wrapper = registry.wrappers.get(sector);
    const grid = registry.grids.get(sector);
    if (!wrapper || !grid || !registry.groupUsers || !registry.groupQuest) return false;
    sectorRef.current = sector;
    wrapper.add(registry.groupUsers);
    wrapper.add(registry.groupQuest);
    gridRef.current = grid;
    pathFinderRef.current = new PathCalculator(grid);
    originRef.current = grid.getHex({ col, row });
    animatedPositionRef.current = { x: col, y: row };
    centerOffsetRef.current = { x: wrapper.position.x, y: wrapper.position.y };
    clearAllHighlights();
    const map = sectorWindowRef.current.sectors.find(
      (candidate) => candidate.sector === sector,
    )?.map;
    if (map) registry.setBackground?.(map);
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
      cameraTargetPositionRef.current = {
        x: hex.center.x - centerOffsetRef.current.x,
        y: hex.center.y - centerOffsetRef.current.y,
      };
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
  const runJourneySegment = async (data: {
    sector: number;
    longitude: number;
    latitude: number;
    location: string;
  }): Promise<void> => {
    if (!userData || !pathFinderRef.current || !originRef.current) return;
    const target = findHex(gridRef.current, {
      x: data.longitude,
      y: data.latitude,
    });
    if (!target) return;
    const path = pathFinderRef.current.getShortestPath(originRef.current, target);
    if (!path) return;
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
      }
    }
    // Show movement 1 step at a time with a small sleep between moves
    await animateWalk(path, data.location);
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
  const { mutateAsync: moveStepAsync } = api.travel.moveInSector.useMutation();

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
   * marked active for the deferred scene rebuild.
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
    const registry = worldRegistryRef.current;
    const wrapper = registry.wrappers.get(data.sector);
    const grid = registry.grids.get(data.sector);
    const anchored = !!(wrapper && grid && registry.groupUsers && registry.groupQuest);
    if (wrapper && grid && registry.groupUsers && registry.groupQuest) {
      // The destination sector is already rendered: move the character
      // layers into its frame and keep walking - no scene rebuild
      wrapper.add(registry.groupUsers);
      wrapper.add(registry.groupQuest);
      gridRef.current = grid;
      pathFinderRef.current = new PathCalculator(grid);
      originRef.current = grid.getHex({ col: entry.x, row: entry.y });
      animatedPositionRef.current = { x: entry.x, y: entry.y };
      centerOffsetRef.current = { x: wrapper.position.x, y: wrapper.position.y };
      // The hover path follows the character into the new sector; any tiles
      // lit in the old window (across all sectors) are cleared so a stale
      // window offset can't leave an orphaned highlight behind
      clearAllHighlights();
      const entryMap = sectorWindowRef.current.sectors.find(
        (candidate) => candidate.sector === data.sector,
      )?.map;
      if (entryMap) registry.setBackground?.(entryMap);
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
      if (originRef.current) {
        cameraTargetPositionRef.current = {
          x: originRef.current.center.x - centerOffsetRef.current.x,
          y: originRef.current.center.y - centerOffsetRef.current.y,
        };
      }
    } else {
      // Destination not in the rendered window (rapid multi-cross):
      // fall back to a rebuild once the new window arrives
      originRef.current = undefined;
      cameraTargetPositionRef.current = null;
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
        cameraTargetPositionRef.current = {
          x: finalHex.center.x - centerOffsetRef.current.x,
          y: finalHex.center.y - centerOffsetRef.current.y,
        };
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
    pendingWorldTargetRef.current = null;
    setTarget(null);
    if (!crossingRes.success) showMutationToast(crossingRes);
  };

  /** Commit the server's crossing result after an optimistic client walk */
  const reconcileCrossing = async (res: Awaited<ReturnType<typeof moveStepAsync>>) => {
    if (res.success && res.data) {
      const d = res.data;
      // If the server landed somewhere other than where we optimistically
      // walked, snap the marker to the authoritative position
      const drifted =
        d.sector !== sectorRef.current ||
        d.longitude !== animatedPositionRef.current?.x ||
        d.latitude !== animatedPositionRef.current?.y;
      if (drifted && userData) {
        if (d.sector !== sectorRef.current) {
          reAnchorToSector(d.sector, d.longitude, d.latitude);
        } else {
          originRef.current =
            gridRef.current?.getHex({ col: d.longitude, row: d.latitude }) ??
            originRef.current;
          animatedPositionRef.current = { x: d.longitude, y: d.latitude };
        }
        void updateUsersList(
          {
            ...userData,
            sector: d.sector,
            longitude: d.longitude,
            latitude: d.latitude,
            location: d.location,
          } as UserData,
          true,
          true,
        );
        if (originRef.current) {
          cameraTargetPositionRef.current = {
            x: originRef.current.center.x - centerOffsetRef.current.x,
            y: originRef.current.center.y - centerOffsetRef.current.y,
          };
        }
      }
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
      setTarget(null);
      showMutationToast(res);
      await utils.profile.getUser.invalidate();
    }
  };

  /** Draw one sector of the window and register it in the rendered world */
  const buildSectorIntoWorld = (
    entry: SectorWindowEntry,
    position: { x: number; y: number } | null,
  ) => {
    const registry = worldRegistryRef.current;
    if (!registry.worldRoot) return null;
    // Always render from the window entry's own data (never the center
    // query's), so a sector looks identical from every window position
    const entryStructures = [...entry.structures];
    if (!entryStructures.find((st) => st.route === "/shrine")) {
      entryStructures.push(createShrineStructure(entry.map, entry.globalTileType));
    }
    const groups = drawSector(
      registry.buildWidth,
      alea(entry.sector + 1),
      entry.globalTileType,
      lightLayout,
      entryStructures,
      entry.map,
      // Built-ins overlaid with the creator asset + terrain libraries that
      // ride on the window query, merged once per window (see mergedTerrainsRef)
      mergedDecorationsRef.current,
      mergedTerrainsRef.current,
      entry.villageType,
    );
    drawVillage(
      groups.group_assets,
      entryStructures,
      groups.honeycombGrid,
      entry.map,
      entry.villageType,
      groups.villageWallPlan,
    );
    sortSectorAssetsByGroundContact(groups.group_assets);
    groups.group_interaction.children.forEach((mesh) => {
      mesh.userData.sector = entry.sector;
    });
    // Whole-sector pixel spans, sampled from the sector's own grid
    const h00 = groups.honeycombGrid.getHex({ col: 0, row: 0 });
    const h10 = groups.honeycombGrid.getHex({ col: 1, row: 0 });
    const h01 = groups.honeycombGrid.getHex({ col: 0, row: 1 });
    if (h00 && h10 && h01) {
      registry.spanX = entry.map.width * (h10.x - h00.x);
      registry.spanY = entry.map.height * (h01.y - h00.y);
    }
    const wrapper = new Group();
    const target = position ?? {
      x: entry.dx * registry.spanX,
      y: entry.dy * registry.spanY,
    };
    wrapper.position.set(target.x, target.y, 0);
    wrapper.add(groups.group_dirt);
    wrapper.add(groups.group_tiles);
    wrapper.add(groups.group_edges);
    wrapper.add(groups.group_interaction);
    wrapper.add(groups.group_assets);
    registry.worldRoot.add(wrapper);
    registry.wrappers.set(entry.sector, wrapper);
    registry.grids.set(entry.sector, groups.honeycombGrid);
    registry.entries.set(entry.sector, {
      wrapper,
      grid: groups.honeycombGrid,
      interaction: groups.group_interaction,
      assets: groups.group_assets,
      animatedMaterials: groups.animatedMaterials,
      renderKey: renderKeyOf(entry),
    });
    return groups;
  };

  /**
   * Dispose one sector's rendered content. Geometries and per-sector
   * materials are freed; materials tagged shared (biome palettes, cached
   * sprite materials) stay alive for the other sectors.
   */
  const disposeSectorRender = (sectorId: number) => {
    const registry = worldRegistryRef.current;
    const render = registry.entries.get(sectorId);
    if (!render) return;
    // The character layers must survive their wrapper: hand them to the
    // world root until the sector is rendered again
    if (registry.groupUsers && render.wrapper.children.includes(registry.groupUsers)) {
      registry.worldRoot?.add(registry.groupUsers);
    }
    if (registry.groupQuest && render.wrapper.children.includes(registry.groupQuest)) {
      registry.worldRoot?.add(registry.groupQuest);
    }
    registry.worldRoot?.remove(render.wrapper);
    disposeGroupPreservingShared(render.wrapper);
    registry.entries.delete(sectorId);
    registry.wrappers.delete(sectorId);
    registry.grids.delete(sectorId);
  };

  /** Rebuild the render-loop collections from the registry */
  const refreshRenderCollections = () => {
    const registry = worldRegistryRef.current;
    const entries = [...registry.entries.values()];
    interactionGroupsRef.current = entries.map((render) => render.interaction);
    assetsGroupsRef.current = entries.map((render) => render.assets);
    // The HTML structure card can route only within the active sector. Keep
    // neighboring-sector structures out of this raycast collection so their
    // local coordinates cannot be mistaken for a destination in this sector.
    const currentAssets = registry.entries.get(sectorRef.current)?.assets;
    structureSpritesRef.current =
      currentAssets?.children.filter(
        (child): child is Sprite => child.userData.type === "structure",
      ) ?? [];
    animatedMaterialsRef.current = entries.flatMap(
      (render) => render.animatedMaterials,
    );
    // Collect the window's unique wind-shader materials ONCE here (per window
    // patch) so the frame loop iterates a short flat list rather than recursively
    // walking every decoration sprite of all 9 sectors 60x/sec.
    const windMaterials = new Set<Material>();
    for (const assets of assetsGroupsRef.current) {
      assets.traverse((object) => {
        const material = (object as Sprite).material as Material | undefined;
        if ((object as Sprite).isSprite && material?.userData?.shader?.uniforms?.time) {
          windMaterials.add(material);
        }
      });
    }
    windMaterialsRef.current = [...windMaterials];
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
      mergedTerrainsRef.current,
    );
  };

  /** The interaction group for a window sector at the given offset, if drawn */
  const interactionForOffset = (dx: number, dy: number): Group | null => {
    const entry = sectorWindowRef.current.sectors.find(
      (candidate) => candidate.dx === dx && candidate.dy === dy,
    );
    if (!entry) return null;
    return worldRegistryRef.current.entries.get(entry.sector)?.interaction ?? null;
  };

  /** Turn off every lit hover-path tile across all rendered sectors */
  const clearAllHighlights = () => {
    for (const render of worldRegistryRef.current.entries.values()) {
      render.interaction.children.forEach((child) => {
        const mesh = child as HexagonalFaceMesh;
        if (mesh.userData?.highlight) {
          mesh.userData.highlight = false;
          mesh.material.visible = false;
        }
      });
    }
  };

  /**
   * Patch the rendered world to match the latest window: sectors that
   * entered are drawn in place (one per task, so frames stay smooth),
   * sectors that left are disposed, and everything else is untouched -
   * crossings and window refetches never rebuild the scene.
   */
  const applyWindowToScene = async () => {
    const registry = worldRegistryRef.current;
    const window = sectorWindowRef.current;
    if (!registry.worldRoot || registry.entries.size === 0) return;
    const token = ++windowUpdateTokenRef.current;
    const windowCenter = window.sectors.find(
      (candidate) => candidate.dx === 0 && candidate.dy === 0,
    );
    if (!windowCenter) return;
    const centerRender = registry.entries.get(windowCenter.sector);
    // Global travel (or a frame drifted too far to stay precise): the new
    // center was never rendered next to the old one - full re-anchor
    const maxDrift = 60;
    if (
      !centerRender ||
      Math.abs(centerRender.wrapper.position.x) > Math.abs(registry.spanX) * maxDrift ||
      Math.abs(centerRender.wrapper.position.y) > Math.abs(registry.spanY) * maxDrift
    ) {
      rebuildSceneRef.current?.();
      return;
    }
    const anchor = {
      x: centerRender.wrapper.position.x,
      y: centerRender.wrapper.position.y,
    };
    // Drop sectors that left the window or whose content changed
    const wanted = new Map(window.sectors.map((entry) => [entry.sector, entry]));
    let droppedCurrent = false;
    for (const [sectorId, render] of [...registry.entries]) {
      const entry = wanted.get(sectorId);
      if (entry && renderKeyOf(entry) === render.renderKey) continue;
      disposeSectorRender(sectorId);
      if (sectorId === sectorRef.current) droppedCurrent = true;
    }
    // Draw sectors that entered the window
    for (const entry of window.sectors) {
      if (token !== windowUpdateTokenRef.current) return;
      if (registry.entries.has(entry.sector)) continue;
      buildSectorIntoWorld(entry, {
        x: anchor.x + (entry.dx - windowCenter.dx) * registry.spanX,
        y: anchor.y + (entry.dy - windowCenter.dy) * registry.spanY,
      });
      refreshRenderCollections();
      await sleep(0);
    }
    if (token !== windowUpdateTokenRef.current) return;
    // Re-attach the character layers and grid if their sector re-rendered
    if (droppedCurrent) {
      const currentRender = registry.entries.get(sectorRef.current);
      if (currentRender) {
        if (registry.groupUsers) currentRender.wrapper.add(registry.groupUsers);
        if (registry.groupQuest) currentRender.wrapper.add(registry.groupQuest);
        gridRef.current = currentRender.grid;
        pathFinderRef.current = new PathCalculator(currentRender.grid);
        const livePosition = animatedPositionRef.current ?? {
          x: userRef.current?.longitude ?? 0,
          y: userRef.current?.latitude ?? 0,
        };
        originRef.current = currentRender.grid.getHex({
          col: livePosition.x,
          row: livePosition.y,
        });
        centerOffsetRef.current = {
          x: currentRender.wrapper.position.x,
          y: currentRender.wrapper.position.y,
        };
      }
    }
    refreshRenderCollections();
    rebuildWindowNav();
    registry.setBackground?.(windowCenter.map);
  };

  const { mutate: move, isPending: isMoving } = api.travel.moveInSector.useMutation({
    onSuccess: async (res) => {
      // Stop moving if failed
      if (res.success === false) {
        pendingCrossRef.current = null;
        setTarget(null);
      }
      // If success without data, then we got attacked
      if (res.success && !res.data) {
        pendingCrossRef.current = null;
        setTarget(null);
        showMutationToast(res);
        await utils.profile.getUser.invalidate();
      }
      // If success with data, then we moved
      const data = res.data;
      // Border crossings re-anchor the world on the new sector; the scene
      // rebuilds from prefetched neighbor data with the camera on the user
      if (userData && res.success && data && data.sector !== sectorRef.current) {
        await applyCrossing(data);
        return;
      }
      if (userData && res.success && data) {
        await runJourneySegment(data);
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
    if (origin.col === edge.x && origin.row === edge.y) {
      pendingCrossRef.current = null;
      moveAcrossBorder(primary, { x: origin.col, y: origin.row });
    } else {
      pendingCrossRef.current = primary;
      setTarget(edge);
    }
  };

  const { mutate: rob, isPending: isRobbing } = api.travel.robPlayer.useMutation({
    onSuccess: async (result) => {
      if (result?.battleId || result?.money) {
        await updateUser({
          ...(result.money ? { money: result.money } : {}),
          ...(result.battleId
            ? { battleId: result.battleId, updatedAt: new Date() }
            : {}),
        });
      }
      showMutationToast(result);
    },
  });

  const { mutate: attack, isPending: isAttacking } = api.combat.attackUser.useMutation({
    onSuccess: async (data) => {
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
  });

  const { mutate: interactNpc, isPending: isInteracting } =
    api.overworldAi.interactWithOverworldAi.useMutation({
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
      },
    });

  // Single entry point for interacting with an overworld NPC the player is standing on:
  // sets the pending-interaction ref (so the dialog-continuation flow keeps working) and
  // fires the existing mutation. Used by both the sprite click and the arrival modal.
  const interactWithNpc = (npc: SectorUser) => {
    // Read through refs: the scene's click handler closes over this callback for the lifetime of the
    // build, so state values would go stale. Skip while a dialog is open so its pending-interaction
    // ref isn't overwritten before the player finishes (or closes) that dialog.
    if (isInteractingRef.current || !npc.npcPlacementId || npcDialogRef.current) return;
    pendingNpcInteractRef.current = {
      placementId: npc.npcPlacementId,
      positionVersion: npc.npcPositionVersion ?? 0,
    };
    interactNpc({
      placementId: npc.npcPlacementId,
      positionVersion: npc.npcPositionVersion ?? 0,
    });
  };

  // Shared NPC-tile interaction for the sprite click handler: locate the placement's NPC and, when
  // the player is standing on its tile, interact — otherwise route toward it. Returns true when the
  // click resolved to a live NPC, false when the sprite carries no placement OR its placement has
  // despawned, so the attack branch can fall through to the normal player-attack path. Reads through
  // refs because the click handler lives in a long-lived scene closure that captures stale state.
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

  useEffect(() => {
    minBracketDrawRef.current = storedBracket;
  }, [storedBracket]);

  useEffect(() => {
    showAllyAttackRef.current = allyAttack;
  }, [allyAttack]);

  // Listening to webcket events
  // Dispose the live scene when the component unmounts
  useEffect(() => {
    return () => {
      windowUpdateTokenRef.current++;
      activeSceneTeardownRef.current?.();
      activeSceneTeardownRef.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resubscribe only when the sector changes
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
        const areWarAllies = isWarAllies(warData, userData.villageId, user.villageId);
        if (areWarAllies) {
          return false;
        }

        // Check if user is an enemy (different village and not ally)
        const isAlly =
          user.villageId === userData.villageId || user.allianceStatus === "ALLY";

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
  }, [sorrounding]);

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
    if (walkAnimatingRef.current) return;
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
      if (target.x === originRef.current.col && target.y === originRef.current.row)
        return;
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
            const allianceStatus = getAllyStatus(userData?.village, user.villageId);
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
          .filter((u) => u?.userId) || [];
      // Keep the live client-side position for the own marker: a stale
      // in-flight snapshot must not move it
      setSorrounding(enrichedData);
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
      void updateUsersList(userData);
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
  }, [userData, villageData]);

  // Window changes patch the rendered world in place: crossings and
  // refetches draw only the sectors that entered the window and dispose the
  // ones that left - no scene rebuild, no visual change to shared sectors
  // biome-ignore lint/correctness/useExhaustiveDependencies: imperative scene patching keyed on window data only
  useEffect(() => {
    sectorWindowRef.current = sectorWindow;
    void applyWindowToScene();
  }, [sectorWindow]);

  useEffect(() => {
    const sceneRef = mountRef.current;
    if (!(sceneRef && userRef.current && fetchedUsers !== undefined)) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const journeyActive = () =>
      walkAnimatingRef.current ||
      pendingCrossRef.current !== null ||
      pendingWorldTargetRef.current !== null;
    /**
     * Build the full 3x3-window Three.js scene from scratch (re-invocable via
     * rebuildSceneRef); teardown happens here rather than in the effect cleanup
     * so scene swaps are gap-free, and the prior camera pose/zoom is restored
     * shifted by the re-anchor offset so background rebuilds are pixel-identical.
     */
    const buildScene = () => {
      // The previous scene keeps rendering until this replacement is ready;
      // tearing it down here makes the swap back-to-back with no gap.
      // In-flight window patches belong to the old frame - invalidate them
      windowUpdateTokenRef.current++;
      activeSceneTeardownRef.current?.();
      activeSceneTeardownRef.current = null;
      // Used for map size calculations
      const width2height =
        ((sectorMap.height + 2) * HEX_ASPECT_RATIO) /
        (sectorMap.width - HEX_STACKING_DISPLACEMENT * (sectorMap.width - 1));

      // Map size
      const WIDTH = sceneRef.getBoundingClientRect().width;
      const HEIGHT = WIDTH * width2height;

      // Re-anchor continuity: capture the previous camera pose and world
      // offset so a background rebuild is pixel-identical (the world shifts
      // by the old center offset; the camera must shift with it)
      const prevOffset = { ...centerOffsetRef.current };
      const prevTarget = controlsRef.current
        ? {
            x: controlsRef.current.target.x,
            y: controlsRef.current.target.y,
          }
        : null;
      const prevZoom = cameraRef.current?.zoom ?? null;

      // Listeners
      sceneRef.addEventListener("mousemove", onDocumentMouseMove, false);
      sceneRef.addEventListener("mouseleave", onDocumentMouseLeave, false);
      document.addEventListener("keydown", onDocumentKeyDown, false);

      // Setup scene, renderer and raycaster
      const { scene, renderer, raycaster, handleResize } = setupScene({
        mountRef: mountRef,
        width: WIDTH,
        height: HEIGHT,
        sortObjects: false,
        color: color,
        colorAlpha: 0.5,
        width2height: width2height,
      });

      // If no renderer, then we have an error with the browser, let the user know
      if (!renderer) {
        setWebglError(true);
        return;
      }

      // Create scene
      sceneRef.appendChild(renderer.domElement);

      // Track WebGL context loss to prevent shader errors on iOS mobile browsers
      // Clear texture caches when context is lost to free memory
      const contextHandlers = setupContextLossHandling(renderer, { clearCaches: true });

      // EDGE CASE DEFENSE: Double-check context is valid after setup
      // Even if renderer was created, the context might become invalid immediately on iOS
      if (!isRendererContextValid(renderer)) {
        console.error(
          "WebGL context became invalid immediately after setup - aborting scene creation",
        );
        // Clean up DOM element and event listeners before returning
        contextHandlers.cleanup();
        safeRemoveRendererElement(renderer, sceneRef);
        setWebglError(true);
        return;
      }

      // Setup camara
      const camera = new OrthographicCamera(0, WIDTH, HEIGHT, 0, -10, 10);
      camera.zoom = prevZoom ?? storedZoom;
      camera.updateProjectionMatrix();
      cameraRef.current = camera;

      // Draw every sector of the 3x3 window with the full pipeline, each
      // wrapped in a group offset by whole-sector spans so the world reads
      // as one continuous map. Later window changes patch this world
      // incrementally (applyWindowToScene); a full rebuild only happens on
      // mount, attack-mode toggles or a re-anchor after global travel.
      const registry = worldRegistryRef.current;
      const buildWindow = sectorWindowRef.current;
      registry.wrappers.clear();
      registry.grids.clear();
      registry.entries.clear();
      const worldRoot = new Group();
      registry.worldRoot = worldRoot;
      registry.buildWidth = WIDTH;
      registry.setBackground = (map) => {
        const biome = map.tiles.find((tile) => !tile.blocked)?.battleBiome ?? "ground";
        renderer.setClearColor(getBackgroundColor(biome).color, 0.5);
      };
      const centerMapNow = buildWindow.sectors.find(
        (entry) => entry.sector === sectorRef.current,
      )?.map;
      if (centerMapNow) registry.setBackground(centerMapNow);
      buildWindow.sectors.forEach((entry) => {
        buildSectorIntoWorld(entry, null);
      });
      const centerRender =
        registry.entries.get(sectorRef.current) ??
        registry.entries.get(
          buildWindow.sectors.find((entry) => entry.dx === 0 && entry.dy === 0)
            ?.sector ?? -1,
        );
      if (!centerRender) return;
      gridRef.current = centerRender.grid;

      // Store current highlights and create a path calculator object
      pathFinderRef.current = new PathCalculator(gridRef.current);
      refreshRenderCollections();
      rebuildWindowNav();

      // Intersections & highlights from interactions
      let highlights = new Set<string>();
      let currentTooltips = new Set<string>();

      // js groups for organization; they live in the character's sector frame
      const group_users = new Group();
      const group_quest = new Group();
      centerRender.wrapper.add(group_users);
      centerRender.wrapper.add(group_quest);
      registry.groupUsers = group_users;
      registry.groupQuest = group_quest;
      centerOffsetRef.current = {
        x: centerRender.wrapper.position.x,
        y: centerRender.wrapper.position.y,
      };

      // (Re-)set the origin against this build's grid instance, preferring
      // the live animated position over the (walk-completion) user state
      const liveUser = userRef.current;
      originRef.current = gridRef?.current?.getHex({
        col: animatedPositionRef.current?.x ?? liveUser?.longitude ?? 0,
        row: animatedPositionRef.current?.y ?? liveUser?.latitude ?? 0,
      });

      // Enable controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableRotate = false;
      // The camera is code-driven across the 3x3 world window; the legacy
      // origin-centered pan clamp would pin it in place
      controls.clampPan = false;
      // The camera stays focused on the user; zooming out is capped at about
      // half a neighboring sector in every direction
      controls.enablePan = false;
      controls.zoomSpeed = 1.0;
      controls.minZoom = 0.8;
      controls.maxZoom = 3;
      controlsRef.current = controls;

      // Save zoom level to localStorage when it changes (debounced to avoid excessive updates)
      let zoomTimeout: ReturnType<typeof setTimeout> | null = null;
      const onZoomChange = () => {
        if (zoomTimeout) clearTimeout(zoomTimeout);
        zoomTimeout = setTimeout(() => {
          setStoredZoom(camera.zoom);
        }, 300); // Wait 300ms after last change before saving
      };
      controls.addEventListener("change", onZoomChange);

      // Set initial position of controls & camera. Rebuilds preserve the
      // exact previous camera pose shifted by the re-anchor offset, so
      // background window swaps are invisible even mid-walk; only the first
      // mount centers on the character (tile.center is the world-space
      // center of the hex in this scene's coordinate frame).
      if (prevTarget) {
        const newOffset = centerOffsetRef.current;
        controls.target.set(
          prevTarget.x - prevOffset.x + newOffset.x,
          prevTarget.y - prevOffset.y + newOffset.y,
          0,
        );
        camera.position.copy(controls.target);
        if (cameraTargetPositionRef.current) {
          cameraTargetPositionRef.current = {
            x: cameraTargetPositionRef.current.x + prevOffset.x - newOffset.x,
            y: cameraTargetPositionRef.current.y + prevOffset.y - newOffset.y,
          };
        }
      } else if (isInSector && originRef.current) {
        const { x, y } = originRef.current.center;
        controls.target.set(
          -WIDTH / 2 - x + centerOffsetRef.current.x,
          -HEIGHT / 2 - y + centerOffsetRef.current.y,
          0,
        );
        camera.position.copy(controls.target);
      }

      // Add the world to the scene
      scene.add(worldRoot);

      // Capture clicks to update move direction
      const onClick = (e: MouseEvent) => {
        // Find intersects with the scene
        setRaycasterFromMouse(raycaster, sceneRef, e, camera);
        // Sticky-select a structure under the pointer so touch / click can
        // open the "Go to" card the same way desktop hover does.
        const structureHit = raycaster.intersectObjects(
          structureSpritesRef.current,
          false,
        )[0];
        const structureId = structureHit?.object.userData.structureId;
        if (typeof structureId === "string") {
          if (structureId !== hoveredStructureIdRef.current) {
            hoveredStructureIdRef.current = structureId;
            setHoveredStructure(
              structuresRef.current.find((s) => s.id === structureId) ?? null,
            );
          }
        }
        // PERFORMANCE: Only raycast against interaction and users/quest groups
        const intersects = raycaster.intersectObjects([
          ...interactionGroupsRef.current,
          group_users,
          group_quest,
        ]);
        intersects
          .filter((i) => i.object.visible)
          .every((i) => {
            if (i.object.userData.type === "tile") {
              const target = i.object.userData.tile as TerrainHex;
              const clickedSector = i.object.userData.sector as number;
              if (target.blocked) return false;
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
            } else if (showUsersRef.current && i.object.userData.type === "talk") {
              handleNpcTileInteraction(
                i.object.userData.npcPlacementId as string | undefined,
              );
              return false;
            } else if (showUsersRef.current && i.object.userData.type === "attack") {
              if (
                handleNpcTileInteraction(
                  i.object.userData.npcPlacementId as string | undefined,
                )
              ) {
                return false;
              }
              const target = usersRef.current?.find(
                (u) => u.userId === i.object.userData.userId,
              );
              if (target) {
                if (
                  target.longitude === originRef.current?.col &&
                  target.latitude === originRef.current?.row &&
                  !isAttackingRef.current
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
            } else if (showUsersRef.current && i.object.userData.type === "heal") {
              const target = usersRef.current?.find(
                (u) => u.userId === i.object.userData.userId,
              );
              if (target) {
                if (
                  target.longitude === originRef.current?.col &&
                  target.latitude === originRef.current?.row
                ) {
                  setHealTargetUser(target);
                } else {
                  setTarget({ x: target.longitude, y: target.latitude });
                }
              }
              return false;
            } else if (showUsersRef.current && i.object.userData.type === "info") {
              const userId = i.object.userData.userId as string;
              void router.push(`/userid/${userId}`);
              return false;
            } else if (showUsersRef.current && i.object.userData.type === "marker") {
              return true;
            } else if (
              i.object.userData.type === "battleMarker" &&
              i.object.userData.battleId
            ) {
              void router.push(`/battlelog/${i.object.userData.battleId}`);
              return false;
            }
            return true;
          });
      };
      const rendererElement = renderer.domElement;
      rendererElement.addEventListener("click", onClick, true);

      // Render the image
      let lastTime = Date.now();
      let animationId = 0;
      let userAngle = 0;

      // PERFORMANCE: Cache dimensions to avoid getBoundingClientRect reflows in render loop
      let cachedWidth = WIDTH;
      let cachedHeight = HEIGHT;

      // The mount div can be measured before the page layout settles (fonts
      // and sidebar images shift it), which would bake a wrong width into
      // the renderer, camera frustum and click mapping. A ResizeObserver
      // keeps all three in sync with the real width and re-centers the
      // camera on the user.
      const applySize = (width: number) => {
        const height = width * width2height;
        cachedWidth = width;
        cachedHeight = height;
        renderer?.setSize(width, height);
        camera.right = width;
        camera.top = height;
        camera.updateProjectionMatrix();
        if (originRef.current) {
          const { x, y } = originRef.current.center;
          controls.target.set(-width / 2 - x, -height / 2 - y, 0);
          camera.position.copy(controls.target);
        }
      };
      const resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width && Math.abs(width - cachedWidth) > 1) {
          applySize(width);
        }
      });
      resizeObserver.observe(sceneRef);

      /**
       * Per-frame animation loop: draws users/quests, updates camera follow,
       * controls and shader animations, then renders. The expensive hover-path
       * raycast across the window's ~6000 tile meshes is only recomputed when
       * an input changed (pointer, origin, camera pose or window nav - tracked
       * via pathDirtyRef); idle frames skip it entirely.
       */
      function render() {
        // Performance monitor
        profiler.beginFrame();
        performanceMonitor.begin();
        const endTotal = profiler.mark("animate_total");

        // Use raycaster to detect mouse intersections
        raycaster.setFromCamera(mouse, camera);

        // Assume we have user, users and a grid
        if (userRef.current && usersRef.current && gridRef.current) {
          // Draw all users on the map + indicators for positions with multiple users
          const endUsers = profiler.mark("animate_users");
          userAngle = drawUsers({
            group_users: group_users,
            users: showUsersRef.current
              ? usersRef.current
              : usersRef.current.filter((u) => u.userId === userRef?.current?.userId),
            grid: gridRef.current,
            lastTime: lastTime,
            angle: userAngle,
            minBracket: minBracketDrawRef.current,
          });
          lastTime = Date.now();
          endUsers();

          // Draw interactions with user sprites
          const endIntersectUsers = profiler.mark("animate_intersect_users");
          currentTooltips = intersectUsers({
            group_users,
            raycaster,
            allyAttack: showAllyAttackRef.current,
            users: usersRef.current,
            userData: userRef.current,
            currentTooltips,
          });
          endIntersectUsers();

          // Draw quests
          const endQuest = profiler.mark("animate_quest");
          drawQuest({ group_quest, user: userRef.current, grid: gridRef.current });
          endQuest();
        }

        // Building hover for the fixed HTML "Go to" card. Only update while the
        // pointer is on the map so moving onto the card itself keeps the selection.
        const endStructures = profiler.mark("animate_intersect_structures");
        if (pointerOnMapRef.current) {
          const hoveredId = intersectStructures({
            structureSprites: structureSpritesRef.current,
            raycaster,
            pointerOnMap: true,
          });
          if (hoveredId !== hoveredStructureIdRef.current) {
            hoveredStructureIdRef.current = hoveredId;
            const next = structuresRef.current.find((s) => s.id === hoveredId) ?? null;
            setHoveredStructure(next);
          }
        }
        endStructures();

        // Highlight the hover path across the whole 3x3 window (offsetOfSector
        // is the component-scope helper defined above)
        const originOffset = offsetOfSector(sectorRef.current);
        // Recompute the hover path only when an input to the raycast changed: the
        // pointer (mousemove/leave flags), the player's origin, the camera pose
        // (zoom/pan remaps the fixed cursor to a different tile), or the window
        // nav (a neighbor sector finished loading). Otherwise the ~6000-mesh
        // raycast is repeated for an identical result every frame while idle.
        const pathKey = `${sectorRef.current}:${originRef.current?.col},${originRef.current?.row}`;
        const camKey = `${camera.zoom.toFixed(2)}:${Math.round(camera.position.x)},${Math.round(camera.position.y)}`;
        if (
          pathKey !== lastPathKeyRef.current ||
          camKey !== lastCamKeyRef.current ||
          windowNavRef.current !== lastNavRef.current
        ) {
          lastPathKeyRef.current = pathKey;
          lastCamKeyRef.current = camKey;
          lastNavRef.current = windowNavRef.current;
          pathDirtyRef.current = true;
        }
        if (
          originRef.current &&
          windowNavRef.current &&
          originOffset &&
          pathDirtyRef.current
        ) {
          pathDirtyRef.current = false;
          const endIntersectTiles = profiler.mark("animate_intersect_tiles");
          highlights = intersectWindowTiles({
            raycaster,
            interactionGroups: interactionGroupsRef.current,
            nav: windowNavRef.current,
            origin: {
              dx: originOffset.dx,
              dy: originOffset.dy,
              col: originRef.current.col,
              row: originRef.current.row,
            },
            offsetOfSector,
            groupOfOffset: interactionForOffset,
            currentHighlights: highlights,
            active: pointerOnMapRef.current,
          });
          endIntersectTiles();
        }

        // Smooth camera following
        if (cameraRef.current && controlsRef.current) {
          const endCamera = profiler.mark("animate_camera");
          smoothCameraFollow({
            camera: cameraRef.current,
            controls: controlsRef.current,
            targetPosition: cameraTargetPositionRef.current,
            width: cachedWidth,
            height: cachedHeight,
            minZoom: 0,
          });
          endCamera();
        }

        // Trackball updates
        const endControls = profiler.mark("animate_controls");
        controls.update();
        endControls();

        // Update wind + wave animation from the flat material lists collected at
        // window-build time (no per-frame scene-graph traversal or allocation)
        if (!lightLayout) {
          const endShaders = profiler.mark("animate_shaders");
          const shaderTime = performance.now() / 1000;
          updateWindAnimation(windMaterialsRef.current, shaderTime);
          updateWaveAnimation(animatedMaterialsRef.current, shaderTime);
          endShaders();
        }

        // Render the scene (skip if WebGL context is lost)
        const endRender = profiler.mark("animate_render");
        if (!contextHandlers.isContextLost() && renderer) {
          renderer.render(scene, camera);
        }
        endRender();

        if (renderer) {
          profiler.setRendererInfo(renderer.info);
        }

        // Performance monitor
        performanceMonitor.end();
        endTotal();
        profiler.log(2000);

        animationId = performanceMonitor.requestFrame(render);
      }
      render();

      // Every time we refresh this component, fire off a move counter to make sure other useEffects are updated
      setMoves((prev) => prev + 1);

      // Resume a cross-sector walk once the world is centered on its sector
      if (pendingWorldTargetRef.current?.sector === sectorRef.current) {
        const worldTarget = pendingWorldTargetRef.current;
        pendingWorldTargetRef.current = null;
        setTarget({ x: worldTarget.x, y: worldTarget.y });
      }

      // Remove the mouseover listener
      activeSceneTeardownRef.current = () => {
        performanceMonitor.cancelFrame(animationId);
        if (zoomTimeout) clearTimeout(zoomTimeout);

        // Remove event listeners safely
        try {
          window.removeEventListener("resize", handleResize);
          resizeObserver.disconnect();
          document.removeEventListener("keydown", onDocumentKeyDown, false);
          sceneRef.removeEventListener("mousemove", onDocumentMouseMove);
          sceneRef.removeEventListener("mouseleave", onDocumentMouseLeave);
          controls.removeEventListener("change", onZoomChange);
          rendererElement.removeEventListener("click", onClick, true);
          contextHandlers.cleanup();
        } catch {
          // Ignore errors if elements are already removed
        }

        // Safely remove renderer DOM element
        safeRemoveRendererElement(renderer, sceneRef);

        profiler.reset();
        cleanUp(scene, renderer);

        // Note: Do NOT call clearTextureCaches() here as it clears module-wide caches
        // that may be in use by other Sector instances. Texture caches are shared across
        // all scenes for performance. Individual texture cleanup happens in cleanUp().
      };
    };

    // Full rebuilds wait for an idle moment so they never stall a walk
    // animation; the first mount builds right away
    const tryBuild = () => {
      if (disposed) return;
      if (journeyActive() && controlsRef.current) {
        retryTimer = setTimeout(tryBuild, 250);
        return;
      }
      buildScene();
    };
    rebuildSceneRef.current = tryBuild;
    tryBuild();
    return () => {
      // The built scene is NOT torn down here: it keeps rendering until the
      // next build replaces it (or the component unmounts)
      disposed = true;
      rebuildSceneRef.current = null;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // Window data flows through applyWindowToScene; a full rebuild is only
    // needed when the renderer itself must change. isAttacking is read via
    // isAttackingRef in the click guard so it does not rebuild the world.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [usersReady]);

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

  return (
    <>
      <div id="tutorial-travel-sector" ref={mountRef}></div>
      {webglError && <WebGlError />}
      {currentStructure && (
        <div className="absolute bottom-4 left-4 z-20 rounded-lg bg-black/70 p-4 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <Image
                src={currentStructure.image}
                alt={currentStructure.name}
                width={48}
                height={48}
                className="rounded-md"
              />
            </div>
            <div>
              <h3 className="font-semibold text-lg">{currentStructure.name}</h3>
              <Link
                href={currentStructure.route}
                className="mt-2 inline-block rounded-md bg-blue-500 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-blue-600"
              >
                Enter {currentStructure.name}
              </Link>
            </div>
          </div>
        </div>
      )}
      {hoveredStructure && hoveredStructure.id !== currentStructure?.id && (
        <div className="absolute right-4 bottom-4 z-20 rounded-lg bg-black/70 p-4 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <Image
                src={hoveredStructure.image}
                alt={hoveredStructure.name}
                width={48}
                height={48}
                className="rounded-md"
              />
            </div>
            <div>
              <h3 className="font-semibold text-lg">{hoveredStructure.name}</h3>
              <button
                type="button"
                onClick={() =>
                  setTarget({
                    x: hoveredStructure.longitude,
                    y: hoveredStructure.latitude,
                  })
                }
                className="mt-2 inline-block rounded-md bg-blue-500 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-blue-600"
              >
                Go to {hoveredStructure.name}
              </button>
            </div>
          </div>
        </div>
      )}
      {activeRaid && (
        <div
          className={`absolute right-4 z-20 rounded-lg bg-black/70 p-4 text-white shadow-lg ${
            hoveredStructure && hoveredStructure.id !== currentStructure?.id
              ? "bottom-28"
              : "bottom-4"
          }`}
        >
          <div className="flex items-center gap-4">
            <Swords className="h-12 w-12 text-red-500" />
            <div>
              <h3 className="font-semibold text-lg">{activeRaid.name}</h3>
              <p className="text-gray-300 text-sm">Active Raid in this sector</p>
              <button
                type="button"
                onClick={() => setShowRaidModal(true)}
                className="mt-2 inline-block rounded-md bg-red-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-red-700"
              >
                View Raid
              </button>
            </div>
          </div>
        </div>
      )}
      {showRaidModal && userData && (
        <Modal2 isOpen={showRaidModal} setIsOpen={setShowRaidModal} title="Sector Raid">
          <RaidBrowser
            title="Sector Raid"
            subtitle={`Sector ${userData.sector}`}
            initialBreak={false}
            viewOnly={false}
            sectorFilter={userData.sector}
          />
        </Modal2>
      )}
      {props.showSorrounding && sorrounding && userData && originRef.current && (
        <SorroundingUsers
          setIsOpen={props.setShowSorrounding}
          users={sorrounding}
          userData={userData}
          timeDiff={timeDiff}
          updateUser={updateUser}
          hex={originRef.current}
          allyAttack={allyAttack}
          setAllyAttack={setAllyAttack}
          storedBracket={storedBracket}
          setStoredBracket={setStoredBracket}
          attackUser={(userId) => {
            const target = sorrounding.find((u) => u.userId === userId);
            if (target && !isAttacking) {
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
            if (target && !isRobbing) {
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
        <Modal2
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
        </Modal2>
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
            updateUser={updateUser}
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
      {arrivalNpc && (
        <Modal2
          isOpen={!!arrivalNpc}
          setIsOpen={(open) => {
            if (!open) setArrivalNpc(null);
          }}
          title={arrivalNpc.username}
        >
          <div className="flex flex-col items-center gap-4 p-2">
            {/* biome-ignore lint/performance/noImgElement: dynamic CDN avatar, variable intrinsic size */}
            <img
              src={pickSpriteAvatar(arrivalNpc)}
              alt={arrivalNpc.username}
              className="h-28 w-28 rounded-md object-contain"
            />
            <p className="text-center text-sm">{arrivalCta?.question}</p>
            <div className="flex w-full gap-2">
              <button
                type="button"
                disabled={isInteracting}
                className={`flex-1 rounded-md px-4 py-2 text-sm text-white transition-colors disabled:opacity-50 ${
                  arrivalNpc.npcInteractionType === "HOSTILE"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
                onClick={() => {
                  interactWithNpc(arrivalNpc);
                  setArrivalNpc(null);
                }}
              >
                {arrivalCta?.action}
              </button>
              <button
                type="button"
                className="flex-1 rounded-md bg-gray-500 px-4 py-2 text-sm text-white transition-colors hover:bg-gray-600"
                onClick={() => setArrivalNpc(null)}
              >
                {arrivalCta?.dismiss}
              </button>
            </div>
          </div>
        </Modal2>
      )}
      {npcDialog && pendingNpcInteractRef.current && (
        <Modal2
          isOpen={!!npcDialog}
          setIsOpen={(open) => {
            if (!open) setNpcDialog(null);
          }}
          title="NPC Dialog"
        >
          <div className="flex flex-col gap-3 p-2">
            {(() => {
              const background =
                dialogSceneAssets?.find((a) => a.type === "SCENE_BACKGROUND")?.image ??
                IMG_SCENE_BACKGROUND;
              const characters =
                dialogSceneAssets
                  ?.filter((a) => a.type === "SCENE_CHARACTER")
                  .map((a) => a.image) ?? [];
              return (
                <div className="relative w-full overflow-hidden rounded-md bg-black">
                  {/* biome-ignore lint/performance/noImgElement: dynamic CDN scene background; next/image is impractical for this composited modal */}
                  <img
                    src={background}
                    alt="scene"
                    className="h-44 w-full object-cover"
                  />
                  {characters.length > 0 && (
                    <div className="absolute inset-x-0 bottom-0 flex items-end justify-center gap-2">
                      {characters.map((img, i) => (
                        // biome-ignore lint/performance/noImgElement: dynamic CDN character sprite, variable intrinsic size
                        <img
                          key={`dlg-char-${i}`}
                          src={img}
                          alt=""
                          className="h-40 object-contain"
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {npcDialog.description && (
              <div className="rounded-md bg-popover p-2 text-popover-foreground text-sm">
                {parseHtml(npcDialog.description)}
              </div>
            )}
            {npcDialog.branches.map((branch, idx) => (
              <button
                key={`${idx}-${branch.text}`}
                type="button"
                disabled={isInteracting}
                className="rounded-md bg-blue-600 px-4 py-2 text-left text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
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
              </button>
            ))}
          </div>
        </Modal2>
      )}
    </>
  );
};

export default Sector;

/**
 * Identity of the synthetic shrine, which is created once for the sector state
 * and again for the rendered scene. Both copies must share an id so a raycast
 * hit on the shrine sprite resolves back to a structure, the same way it does
 * for database-backed buildings.
 */
const SECTOR_SHRINE_ID = "sector-shrine";

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
  updateUser: (data: Partial<NonNullable<UserWithRelations>>) => Promise<void>;
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

const SorroundingUsers: React.FC<SorroundingUsersProps> = (props) => {
  // Destructure props
  const { userData, timeDiff, updateUser, storedBracket, setStoredBracket } = props;

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

  // Filter users
  const users = props.users
    // Overworld NPCs ride along in this list to render on the map; they are not
    // scoutable players (their userId is the AI template's), so exclude them here.
    .filter((user) => !user.isNpc)
    .filter((user) => user.userId !== userData.userId)
    .filter((user) => user.status === "AWAKE")
    .filter((user) => passesBracketFilter(user, watchedBracket));

  // Update the localStorage whenever we change
  useEffect(() => {
    setStoredBracket(watchedBracket);
  }, [watchedBracket]);

  return (
    <Modal2
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
            user.villageId === userData.villageId || relationship?.status === "ALLY";
          const isPvpRestrictedRank = RANKS_RESTRICTED_FROM_PVP.includes(user.rank);
          const showAttack = !isPvpRestrictedRank && (props.allyAttack || !isAlly);
          const showRob = !isPvpRestrictedRank && sameHex && userData.isOutlaw;
          const userBracket =
            user.experience == null ? null : getExpBracket(user.experience, user.rank);
          const userLevel = user.experience == null ? null : calcLevel(user.experience);

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
                <div className="absolute bottom-0 left-0 z-50 max-w-1/3 hover:cursor-pointer hover:opacity-80">
                  {user.curHealth < user.maxHealth &&
                    hasRequiredRank(userData.rank, MEDNIN_MIN_RANK) && (
                      <HealingPopover
                        targetUser={user}
                        userData={userData}
                        timeDiff={timeDiff}
                        updateUser={updateUser}
                        side="top"
                      />
                    )}
                </div>
                <AvatarImage
                  href={user.avatar}
                  userId={user.userId}
                  alt={user.username}
                  size={512}
                  priority
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
                {userBracket == null ? "?" : `${userBracket}/${XP_BRACKETS.length}`} [
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
          max={XP_BRACKETS.length}
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
    </Modal2>
  );
};
