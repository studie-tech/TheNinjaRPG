"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Cookie,
  Eye,
  EyeOff,
  Ghost,
  GitMerge,
  HousePlus,
  Loader2,
  Locate,
  MapPinned,
  Maximize2,
  Radar,
  Search,
  Swords,
  UserRoundSearch,
  Zap,
  ZapOff,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm, useWatch } from "react-hook-form";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HIDEOUT_COST,
  MAP_WAR_TORN_BATTLEGROUND_COLOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  MAX_TRAVEL_PIN_LABEL_LENGTH,
  MAX_TRAVEL_PINS,
  STEALTH_SENSORY_CAP,
  STEALTH_TRAIN_GAIN_PER_MINUTE,
  VILLAGE_LEAVE_REQUIRED_RANK,
  VILLAGE_REDUCED_GAINS_DAYS,
} from "@/drizzle/constants";
import type { UserItemWithItem } from "@/drizzle/schema";
import { useAutoAttackMode } from "@/hooks/autoAttack";
import { useLocalStorage } from "@/hooks/localstorage";
import { useLpcCatalogLoader } from "@/hooks/lpc";
import { useMap } from "@/hooks/map";
import { useTutorialStep } from "@/hooks/tutorial";
import { useConsumeItem } from "@/hooks/useItemActions";
import { useLiveCountdown } from "@/hooks/useLiveCountdown";
import { useMapAssetLibrary } from "@/hooks/useMapAssetLibrary";
import { useSectorCacheUpdate } from "@/hooks/useSectorCacheUpdate";
import AutoAttackModal from "@/layout/AutoAttackModal";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { FindSectorPopover, SectorIdField } from "@/layout/FindSectorPopover";
import { HuntingArrival } from "@/layout/HuntingArrival";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Loader from "@/layout/Loader";
import MapError from "@/layout/MapError";
import Modal from "@/layout/Modal";
import NavTabs from "@/layout/NavTabs";
import { TravelArrivalStatus } from "@/layout/TravelArrivalStatus";
import { TravelPositionLabel } from "@/layout/TravelPositionLabel";
import { WarFieldActions } from "@/layout/WarFieldActions";
import { showActionReadinessToast } from "@/libs/actionFeedback";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { nonCombatConsume } from "@/libs/item";
import { getItemConsumeInput } from "@/libs/itemConsumption";
import { hasRequiredRank } from "@/libs/rank";
import {
  findNearestWalkableCoordinate,
  isReachableCoordinate,
  isWalkableCoordinate,
} from "@/libs/sector-map/validation";
import type { GlobalTile, SectorPoint } from "@/libs/sector-map/world-types";
import { getRemainingSensoryCooldown, getStealthStatus } from "@/libs/stealth";
import { showMutationToast } from "@/libs/toast";
import {
  calcGlobalTravelTime,
  globalTravelFinishPatch,
  optimisticGlobalTravelStart,
  resolveGlobeJourney,
} from "@/libs/travel";
import { isTutorialActive } from "@/libs/tutorial";
import { getReadableVillageHexColor } from "@/utils/color";
import { useAwake } from "@/utils/routing";
import { MINUTE_S } from "@/utils/time";
import {
  selectUserWithoutPosition,
  type useRequiredUserData,
  useRequiredUserDataSelector,
  useUserDataRef,
} from "@/utils/UserContext";
import {
  parseTravelPins,
  type SectorForm,
  type SectorFormInput,
  sectorFormSchema,
  type TravelLocation,
  type TravelPin,
  travelLocationSchema,
} from "@/validators/travel";

const GlobalMap = dynamic(() => import("@/layout/Map"), {
  ssr: false,
  loading: () => <Loader explanation="Loading world map" />,
});
const Sector = dynamic(() => import("@/layout/Sector"), {
  ssr: false,
  loading: () => <SectorLoadingPlaceholder />,
});
/** Bootstrap sector windows stay cached this long after travel unmounts. */
const BOOT_WINDOW_RETENTION_MS = 30 * MINUTE_S * 1000;
// Start both renderers alongside hydration while the map queries load.
if (typeof window !== "undefined") {
  // The dynamic component reports a failed chunk load when it renders.
  void import("@/layout/Map").catch(() => undefined);
  void import("@/layout/Sector").catch(() => undefined);
}

/** A stored per-sector window entry (position within a window comes from the layout) */
type StoredSectorEntry =
  RouterOutputs["worldMap"]["getSectorEntries"]["entries"][number];
/** One sector's dx/dy placement within a specific window */
type WindowLayoutEntry =
  RouterOutputs["worldMap"]["getSectorWindow"]["windowLayouts"][number]["entries"][number];
type ConfirmedTravelAdmission = NonNullable<
  RouterOutputs["travel"]["startGlobalMove"]["data"]
> & { userId: string };

export default function TravelPage() {
  return (
    <Suspense fallback={<Loader explanation="Loading travel" />}>
      <Travel />
    </Suspense>
  );
}

/** Coordinate destination confirmation, map travel and personal sector encounters. */
function Travel() {
  // What is shown on this page
  const [showActive, setShowActive] = useLocalStorage<boolean>(
    "showActiveOnMap4",
    true,
  );
  // Other players start hidden for as long as the tutorial runs. A new player is
  // dropped into a sector that may already hold a crowd and cannot tell the
  // quest target from the bystanders -- which is exactly what the eye toggle is
  // for, they just have no reason to know that yet. The toggle still works and
  // the choice sticks for the session, so nobody is locked out of the sector.
  const [revealOthersInTutorial, setRevealOthersInTutorial] = useState(false);
  const [showOwnership, setShowOwnership] = useLocalStorage<boolean>(
    "showOwnership",
    false,
  );
  const [autoAttackMode, setAutoAttackMode] = useAutoAttackMode();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [showSorrounding, setShowSorrounding] = useState<boolean>(false);
  const [showAutoAttackModal, setShowAutoAttackModal] = useState<boolean>(false);
  const [revealedPlayers, setRevealedPlayers] = useState<RevealedPlayer[]>([]);
  const [showRevealedPlayersModal, setShowRevealedPlayersModal] =
    useState<boolean>(false);
  const [pendingAttackTarget, setPendingAttackTarget] = useState<AttackTarget | null>(
    null,
  );

  const [activeTab, setActiveTab] = useState<string>("");
  const [focusSector, setFocusSector] = useState<number | null>(null);
  const [isWorldExpanded, setWorldExpanded] = useState(false);
  const [cameraFocusRevision, setCameraFocusRevision] = useState(0);
  // A rejected arrival leaves the finished countdown in place with a manual retry.
  const [isArrivalRejected, setIsArrivalRejected] = useState(false);
  // Once opened, each scene stays mounted (hidden and paused) so switching tabs keeps
  // the globe's rotation and the sector's loaded terrain.
  const [hasOpenedGlobal, setHasOpenedGlobal] = useState(false);
  const [hasOpenedSector, setHasOpenedSector] = useState(false);

  const searchParams = useSearchParams();
  const [locationRequest, setLocationRequest] = useState<TravelLocation | null>(null);
  const [autoDestination, setAutoDestination] = useState<TravelLocation | null>(null);
  const requestedLocationRef = useRef<string | null>(null);
  const [pinLabel, setPinLabel] = useState("");
  const [isQuickTravelOpen, setQuickTravelOpen] = useState(false);
  const [storedPins, setStoredPins] = useLocalStorage<Record<string, TravelPin[]>>(
    "travelPins",
    {},
  );

  // Globe data
  const { globe, mapError } = useMap();

  // tRPC utility
  const utils = api.useUtils();

  // Current and target sectors & positions
  const [currentTile, setCurrentTile] = useState<GlobalTile | null>(null);
  const [currentPosition, setCurrentPosition] = useState<SectorPoint | null>(null);
  const [targetPosition, setTargetPosition] = useState<SectorPoint | null>(null);
  const [targetSector, setTargetSector] = useState<number | null>(null);
  const [storedJourney, setStoredJourney] = useLocalStorage<unknown>(
    "worldTravelJourney",
    null,
  );

  // Data from database
  const {
    data: profile,
    pusher,
    timeDiff,
    prepareUserUpdate,
    updateUser,
    refreshUser,
  } = useRequiredUserDataSelector(selectUserWithoutPosition);
  const positionChanged = useRef(() => {});
  const userRef = useUserDataRef(() => positionChanged.current());
  const userData = profile ? userRef.current : undefined;
  const [unreconciledAdmission, setUnreconciledAdmission] =
    useState<ConfirmedTravelAdmission | null>(null);
  const [isRetryingAdmission, setIsRetryingAdmission] = useState(false);
  const admissionRecovery =
    unreconciledAdmission?.userId === userData?.userId ? unreconciledAdmission : null;
  const travelState = admissionRecovery ?? userData;
  const retryAdmission = async () => {
    setIsRetryingAdmission(true);
    try {
      if (await refreshUser()) {
        setUnreconciledAdmission(null);
        setTargetSector(null);
      }
    } finally {
      setIsRetryingAdmission(false);
    }
  };
  const loadLpcCatalog = useLpcCatalogLoader({
    revalidateInBackground: true,
    preload: !!userData,
  });
  const { prepareSectorUpdate, updateSector } = useSectorCacheUpdate(userData?.sector);
  const setScenePosition = useCallback(
    (point: SectorPoint | null) => {
      // A pending travel action needs arrival state; ordinary walking only updates the coordinate label.
      if (pendingAttackTarget || autoDestination || isQuickTravelOpen) {
        setCurrentPosition((previous) =>
          previous?.x === point?.x && previous?.y === point?.y ? previous : point,
        );
      }
    },
    [pendingAttackTarget, autoDestination, isQuickTravelOpen],
  );
  positionChanged.current = () => {
    const user = userRef.current;
    if (user) setScenePosition({ x: user.longitude, y: user.latitude });
  };
  useEffect(() => {
    positionChanged.current();
  }, [setScenePosition]);
  const pins = parseTravelPins(storedPins?.[userData?.userId ?? ""]);
  const savePins = (next: TravelPin[]) => {
    if (userData) setStoredPins({ ...storedPins, [userData.userId]: next });
  };
  const tutorialRunning = isTutorialActive(userData);
  const showOtherUsers = tutorialRunning ? revealOthersInTutorial : showActive;
  const { data: villageData } = api.village.getAll.useQuery(undefined, {
    enabled: !!userData,
  });
  // Sector.tsx observes this same key on a 10s refetchInterval, and the payload carries Dates,
  // which defeat structural sharing, so reading the whole payload would re-render the page on
  // every poll. Selecting the one string it reads keeps the poll inside the sector scene.
  const { data: sectorVillageName } = api.travel.getSectorData.useQuery(
    { sector: userData?.sector ?? -1 },
    {
      enabled: !!userData && userData.sector !== undefined,
      select: (data) => data?.sectorData?.village?.name ?? null,
      notifyOnChangeProps: ["data"],
      // The visible sector scene owns presence recovery; the label must not wake a hidden one.
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );
  const { data: mapAssets } = useMapAssetLibrary(!!userData);
  // Terrain definitions remain cached for the session.
  const { data: mapTerrains } = api.mapTerrain.getAll.useQuery(undefined, {
    enabled: !!userData,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Per-sector store: each sector map (~90KB) is downloaded at most once per
  // session; windows are assembled locally from it so a border crossing needs
  // no blocking request. null marks a sector known to have no published map.
  const sectorStoreRef = useRef(new Map<number, StoredSectorEntry | null>());
  // Window layouts (aligned dx/dy topology) keyed by window-center sector
  const windowLayoutsRef = useRef(new Map<number, WindowLayoutEntry[]>());
  // storeTick re-runs assembly after ingests; visibleEpoch only bumps when data
  // for the currently visible window may have changed (bootstrap refetch), so
  // ring warm-ups do not needlessly re-patch the rendered scene
  const [storeTick, setStoreTick] = useState(0);
  const visibleEpochRef = useRef(0);
  const assembledEpochRef = useRef(-1);
  const [assembled, setAssembled] = useState<{
    center: number;
    sectors: RouterOutputs["worldMap"]["getSectorWindow"]["sectors"];
  } | null>(null);
  // Sector needing a full bootstrap window fetch (initial load, global travel)
  const [bootSector, setBootSector] = useState<number | null>(null);
  // Outlives a typical battle, so returning reassembles the window without a download;
  // older windows are released and refetched, which also picks up republished maps.
  const { data: bootWindow } = api.worldMap.getSectorWindow.useQuery(
    { sector: bootSector ?? 0 },
    { enabled: bootSector !== null, gcTime: BOOT_WINDOW_RETENTION_MS },
  );

  // Ingest a bootstrap window: layouts + all its entries into the store
  useEffect(() => {
    if (!bootWindow) return;
    for (const layout of bootWindow.windowLayouts) {
      windowLayoutsRef.current.set(layout.center, layout.entries);
    }
    for (const entry of bootWindow.sectors) {
      const { dx: _dx, dy: _dy, ...data } = entry;
      sectorStoreRef.current.set(entry.sector, data);
    }
    // Layout sectors absent from the response have no published map
    const centerLayout = bootWindow.windowLayouts.find(
      (layout) => layout.center === bootWindow.center,
    );
    centerLayout?.entries.forEach((entry) => {
      if (!sectorStoreRef.current.has(entry.sector)) {
        sectorStoreRef.current.set(entry.sector, null);
      }
    });
    visibleEpochRef.current += 1;
    setStoreTick((tick) => tick + 1);
  }, [bootWindow]);

  // Assemble the visible window from the store; fall back to a bootstrap fetch
  // when the store cannot serve the sector yet
  useEffect(() => {
    const sector = userData?.sector;
    if (sector === undefined) return;
    const store = sectorStoreRef.current;
    const layout = windowLayoutsRef.current.get(sector);
    const ready =
      !!layout && layout.every((e) => store.has(e.sector)) && !!store.get(sector);
    if (!layout || !ready) {
      setBootSector(sector);
      return;
    }
    // Skip when nothing visible changed (ring ingests only add outer sectors)
    if (
      assembled?.center === sector &&
      assembledEpochRef.current === visibleEpochRef.current
    ) {
      return;
    }
    assembledEpochRef.current = visibleEpochRef.current;
    setAssembled({
      center: sector,
      sectors: layout.flatMap((e) => {
        const data = store.get(e.sector);
        return data ? [{ ...data, dx: e.dx, dy: e.dy }] : [];
      }),
    });
  }, [userData?.sector, storeTick, assembled?.center]);

  // Warm the surrounding ring: ONE request for exactly the sectors of the
  // adjacent windows the store does not yet hold, so the next border crossing
  // assembles instantly. Skipped entirely when everything is already warm.
  const ringCenterRef = useRef<number | null>(null);
  useEffect(() => {
    if (!assembled) return;
    const center = assembled.center;
    if (ringCenterRef.current === center) return;
    ringCenterRef.current = center;
    const layouts = windowLayoutsRef.current;
    const store = sectorStoreRef.current;
    const cardinals = (layouts.get(center) ?? [])
      .filter((e) => Math.abs(e.dx) + Math.abs(e.dy) === 1)
      .map((e) => e.sector);
    const union = new Set(
      [center, ...cardinals].flatMap((c) =>
        (layouts.get(c) ?? []).map((e) => e.sector),
      ),
    );
    // Prune sectors no longer in or adjacent to the visible window, so the
    // store (~90KB per map) and the `known` list below stay bounded
    for (const key of [...store.keys()]) {
      if (!union.has(key)) store.delete(key);
    }
    const missingLayout = cardinals.some((c) => !layouts.has(c));
    const missingSector = [...union].some((s) => !store.has(s));
    if (!missingLayout && !missingSector) return;
    void utils.worldMap.getSectorEntries
      .fetch({ center, known: [...store.keys()] })
      .then((ring) => {
        for (const layout of ring.windowLayouts) {
          windowLayoutsRef.current.set(layout.center, layout.entries);
        }
        for (const entry of ring.entries) {
          if (!sectorStoreRef.current.has(entry.sector)) {
            sectorStoreRef.current.set(entry.sector, entry);
          }
        }
        for (const sector of ring.missingSectors) {
          if (!sectorStoreRef.current.has(sector)) {
            sectorStoreRef.current.set(sector, null);
          }
        }
        setStoreTick((tick) => tick + 1);
      })
      .catch(() => {
        // Allow the warm-up to retry on the next assembly instead of leaving
        // the ring cold until the player crosses into another sector
        ringCenterRef.current = null;
      });
  }, [assembled, utils]);

  // The window object handed to the Sector scene (entries + session libraries)
  const sectorWindow = useMemo(() => {
    if (!assembled || !mapAssets || !mapTerrains) return undefined;
    return { mapAssets, mapTerrains, sectors: assembled.sectors };
  }, [assembled, mapAssets, mapTerrains]);
  const currentSectorMap = sectorWindow?.sectors.find(
    (entry) => entry.sector === userData?.sector,
  )?.map;
  // Memoized so the array reference survives a re-render, since it feeds the map scene
  const villages = useMemo(() => {
    if (!villageData) return undefined;
    if (userData?.isOutlaw) return villageData;
    return villageData.filter((v) => ["VILLAGE", "SAFEZONE"].includes(v.type));
  }, [villageData, userData?.isOutlaw]);

  // Quick-travel destinations: main villages/safezones (+ outlaw hubs for outlaws),
  // plus a synthetic war-torn entry so the list uses one button template.
  const travelDestinations = useMemo(() => {
    if (!villages) return [];
    const villagesAsDestinations = villages
      .filter(
        (v) =>
          ["VILLAGE", "SAFEZONE", "OUTLAW"].includes(v.type) ||
          (v.type === "HIDEOUT" && v.id === userData?.clan?.villageId),
      )
      .sort((a, b) => (a.mapName || a.name).localeCompare(b.mapName || b.name))
      .map((v) => ({
        id: v.id,
        label: v.mapName || v.name,
        sector: v.sector,
        color: v.hexColor,
      }));
    return [
      ...villagesAsDestinations,
      {
        id: "war-torn",
        label: "War-Torn Battleground",
        sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
        color: MAP_WAR_TORN_BATTLEGROUND_COLOR,
        description: "Free-for-all PvP, no sleeping",
      },
    ];
  }, [villages, userData?.clan?.villageId]);

  // Names for the sectors the player can already see marked on the globe, so
  // the travel dialog can say where it is sending them rather than only which
  // number. A hideout is named only for the faction that owns it, matching how
  // the globe decides which hideout labels to draw.
  const sectorNames = useMemo(() => {
    const names = new Map<number, string>();
    names.set(MAP_WAR_TORN_BATTLEGROUND_SECTOR, "War-Torn Battleground");
    villages?.forEach((village) => {
      if (village.type === "HIDEOUT" && userData?.clan?.villageId !== village.id)
        return;
      names.set(village.sector, village.mapName || village.name);
    });
    return names;
  }, [villages, userData?.clan?.villageId]);

  /** "sector 222 (Wake Island)", or just the number for empty wilderness. */
  const describeSector = (sector: number) => {
    const name = sectorNames.get(sector);
    return name ? `sector ${sector} (${name})` : `sector ${sector}`;
  };

  // Fetch tracked bounties for map display
  const { data: trackedBounties } = api.bounty.getTrackedBounties.useQuery(undefined, {
    enabled: !!userData,
  });
  const sectorVillage = villages?.find((v) => v.sector === userData?.sector);

  // Consumable items
  const { data: userItems, isFetching: isFetchingItems } =
    api.item.getUserItems.useQuery(undefined, {
      enabled: !!userData,
    });
  const [useritem, setUserItem] = useState<UserItemWithItem | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  // Router for forwarding
  const router = useRouter();

  // Sector tab link
  const currentSector = userData?.sector;
  const hasCurrentSector = currentSector !== undefined && currentSector !== null;
  const sectorLink = hasCurrentSector ? "You" : "";
  const globalLink = `Global`;

  // Quick travel form
  const quickTravelForm = useForm<SectorFormInput, unknown, SectorForm>({
    mode: "all",
    resolver: zodResolver(sectorFormSchema),
    defaultValues: { sector: undefined },
  });
  const quickTravelSector = useWatch({
    control: quickTravelForm.control,
    name: "sector",
  }) as number | undefined;

  useEffect(() => {
    if (userData && globe) {
      const tile = globe.tiles[userData.sector];
      if (tile) setCurrentTile(tile);
    }
  }, [userData?.sector, globe]);

  useEffect(() => {
    // Only set initial tab, don't override user's selection
    if (activeTab === "" && sectorLink) {
      setActiveTab(sectorLink);
    }
  }, [sectorLink, activeTab]);

  useEffect(() => {
    if (userData?.status === "BATTLE") {
      // Not pushToCombat: this is the guard that bounces a battling player off the map, and it
      // has to fire again every time they come back to it, including with the same battle
      void router.push(`/combat`);
    }
  }, [userData?.status, router]);

  useAwake(userData, { allowActionRecovery: true });

  // Tutorial step
  const { currentStep, completeTutorialAction } = useTutorialStep();

  // While the tutorial is sending the player to one specific sector, open the
  // globe already centred on it and carrying the Target label. The camera
  // otherwise starts on the player's own sector, which leaves the destination
  // up to 40 degrees around the sphere -- far enough out that it draws
  // edge-on near the limb, with nothing telling a new player the globe turns.
  // Travel steps are the only ones whose relatedValue is a sector; everywhere
  // else it names a quest.
  const tutorialFocusSector =
    userData?.tutorialOn &&
    currentStep?.advanceOn === "travelArrive" &&
    typeof currentStep?.relatedValue === "number"
      ? currentStep.relatedValue
      : null;
  const tutorialSetFocusRef = useRef<number | null>(null);
  useEffect(() => {
    if (tutorialFocusSector !== null) {
      tutorialSetFocusRef.current = tutorialFocusSector;
      setFocusSector(tutorialFocusSector);
      return;
    }
    // Leaving a guided step drops the marker the tutorial put there, but never
    // one the player picked out themselves.
    setFocusSector((current) =>
      current !== null && current === tutorialSetFocusRef.current ? null : current,
    );
    tutorialSetFocusRef.current = null;
  }, [tutorialFocusSector]);

  // Mutations
  const { mutate: startGlobalMove, isPending: isStartingTravel } =
    api.travel.startGlobalMove.useMutation({
      onMutate: async (variables) => {
        // A pending local walk must not keep a target after we flip status;
        // Sector writes arrival coordinates only from UserContext, and a
        // leftover target could overwrite them once the start mutation lands.
        setTargetPosition(null);
        setWorldExpanded(false);
        if (!userData) return;
        const previous = {
          userId: userData.userId,
          status: userData.status,
          travelFinishAt: userData.travelFinishAt ?? null,
        };
        // startGlobalMoveSchema coerces the sector, so the mutate input type is unknown.
        const destinationSector = Number(variables.sector);
        setTargetSector(destinationSector);
        const travelTime = globe
          ? calcGlobalTravelTime(userData.sector, destinationSector, globe)
          : 0;
        await updateUser(optimisticGlobalTravelStart(travelTime));
        return {
          ...previous,
          revision: prepareUserUpdate(),
        };
      },
      onError: async (_error, _variables, previous) => {
        setAutoDestination(null);
        if (previous) {
          await updateUser(
            {
              status: previous.status,
              travelFinishAt: previous.travelFinishAt,
            },
            { revision: previous.revision, refetch: false },
          );
        }
      },
      onSuccess: async (result, _variables, previous) => {
        showMutationToast(result);
        if (result.success && result.data) {
          if (
            previous &&
            result.fromSector !== undefined &&
            result.durationMs !== undefined
          ) {
            setStoredJourney({
              userId: previous.userId,
              fromSector: result.fromSector,
              toSector: result.data.sector,
              finishAt: result.data.travelFinishAt.getTime(),
              durationMs: result.durationMs,
            });
          }
          // Clear any local-sector movement target before the destination
          // coordinates enter UserContext so it cannot overwrite the arrival.
          // Do not write sector/coords until this payload arrives — they are
          // server-chosen, and an in-flight sector walk must not land on them.
          setTargetPosition(null);
          setShowModal(false);
          setActiveTab(globalLink);

          const profileApplied = await updateUser(result.data, {
            revision: previous?.revision,
            refetch: false,
            userRecovery: result.userRecovery,
          });
          // Keep confirmed travel visible when a stale profile rejects its patch and the recovery read cannot complete.
          if (!profileApplied) {
            const admissionUserId = previous?.userId ?? userData?.userId;
            if (admissionUserId)
              setUnreconciledAdmission({ ...result.data, userId: admissionUserId });
            if (!(await refreshUser())) return;
          }
          setUnreconciledAdmission(null);
          setTargetSector(null);
        } else if (result.userRecovery) {
          setAutoDestination(null);
          await updateUser(result, { revision: previous?.revision, refetch: false });
        } else if (previous) {
          setAutoDestination(null);
          await updateUser(
            {
              status: previous.status,
              travelFinishAt: previous.travelFinishAt,
            },
            { revision: previous.revision, refetch: false },
          );
        }
      },
    });

  const { mutate: finishGlobalMove, isPending: isFinishingTravel } =
    api.travel.finishGlobalMove.useMutation({
      onMutate: () => {
        setIsArrivalRejected(false);
        return {
          revision: prepareUserUpdate(),
          sector: prepareSectorUpdate(),
          // Starting the trip already stored its server-confirmed destination.
          arrivalSector: userData?.sector,
        };
      },
      onSuccess: async (result, _variables, context) => {
        showMutationToast(result);
        if (!result.success) {
          setIsArrivalRejected(true);
          return;
        }
        // Keep the prepared destination mounted while profile and presence reconcile.
        setActiveTab(sectorLink);
        const patch = result.userPatch;
        const profileApplied = await updateUser(
          patch
            ? (current) =>
                globalTravelFinishPatch(current, patch, result.projectedQuestIds)
            : undefined,
          { revision: context.revision, delta: result.userDelta },
        );
        await updateSector(profileApplied, context.sector);
        // A step that names its destination is only finished by arriving there.
        if (
          tutorialFocusSector === null ||
          context.arrivalSector === tutorialFocusSector
        ) {
          await completeTutorialAction("travelArrive");
        }
      },
      onError: () => setIsArrivalRejected(true),
    });

  const { mutate: joinVillage, isPending: isJoining } =
    api.village.joinVillage.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success || data.userRecovery) await updateUser(data, { revision });
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

  const { consume, isConsuming } = useConsumeItem({
    useritem,
    inventoryQuery: "getUserItems",
    onSettled: () => {
      setIsOpen(false);
      setUserItem(undefined);
    },
  });

  const { mutate: attackRevealedUser, isPending: isAttackingRevealed } =
    api.combat.attackUser.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        if (data.success) {
          showActionReadinessToast(data);
          setShowRevealedPlayersModal(false);
          setRevealedPlayers([]);
          await updateUser(data, { revision, refetch: false });
        } else {
          if (data.userRecovery) await updateUser(data, { revision, refetch: false });
          showMutationToast({
            success: false,
            message: data.message,
          });
        }
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  // Convenience for starting global move
  const handleGlobalMove = useCallback(
    (sector: number) => {
      if (admissionRecovery) return;
      // Guards against global movement
      if (tutorialFocusSector !== null && sector !== tutorialFocusSector) {
        showMutationToast({
          success: false,
          message: `For now, you need to travel to sector ${tutorialFocusSector} first.`,
        });
        setAutoDestination(null);
        return;
      }
      // Stop any local-sector movement and begin global travel immediately.
      setTargetPosition(null);
      startGlobalMove({ sector });
    },
    [admissionRecovery, tutorialFocusSector, startGlobalMove],
  );

  // Whether world-travel can be started toward a given sector
  const canTravelTo = useCallback(
    (sector: number | undefined) =>
      Number.isFinite(sector) &&
      sector !== userData?.sector &&
      !admissionRecovery &&
      canAttemptAwakeAction(userData) &&
      !isStartingTravel,
    [
      userData?.sector,
      userData?.status,
      userData?.autoWakeUp,
      isStartingTravel,
      admissionRecovery,
    ],
  );

  // Stable identity for the globe click path: MapComponent is memoized to avoid
  // re-renders during countdown updates, so this callback must not change when
  // sector / isStartingTravel change. The guard is read from a ref instead.
  const travelGuardRef = useRef<{ sector: number | undefined; canTravel: boolean }>({
    sector: undefined,
    canTravel: false,
  });
  const canStartGlobalTravel =
    !admissionRecovery && canAttemptAwakeAction(userData) && !isStartingTravel;
  useLayoutEffect(() => {
    travelGuardRef.current = {
      sector: userData?.sector,
      canTravel: canStartGlobalTravel,
    };
  }, [userData?.sector, canStartGlobalTravel]);

  const initiateTravelToSector = useCallback((sector: number) => {
    const { sector: current, canTravel } = travelGuardRef.current;
    if (!canTravel) return;
    if (sector === current) {
      showMutationToast({
        success: false,
        message: "You are already in that sector",
      });
      return;
    }
    setAutoDestination(null);
    setTargetSector(sector);
    setShowModal(true);
  }, []);

  const isTraveling = travelState?.status === "TRAVEL";
  const globeJourney = useMemo(
    () => resolveGlobeJourney(storedJourney, travelState),
    [
      storedJourney,
      travelState?.userId,
      travelState?.sector,
      travelState?.status,
      travelState?.travelFinishAt,
    ],
  );
  const isGlobal = isTraveling || activeTab === globalLink;
  const showGlobal = villages && globe && isGlobal;
  // Admission supplies the destination coordinates. Prepare its scene during the
  // countdown, after admission settles, and keep that instance for arrival.
  const isPreparingSector = userData?.status === "TRAVEL" && !isStartingTravel;
  const globeFocusSector = isTraveling
    ? (targetSector ?? travelState?.sector)
    : focusSector;
  const showSector =
    villages &&
    hasCurrentSector &&
    currentTile &&
    currentSectorMap &&
    userData?.status !== "TRAVEL" &&
    !isGlobal;
  useEffect(() => {
    if (showGlobal) setHasOpenedGlobal(true);
  }, [showGlobal]);
  useEffect(() => {
    if (showSector) setHasOpenedSector(true);
  }, [showSector]);

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
        originSocketId: pusher?.connection.socket_id,
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
          highlights={villages}
          usersHighlighted={trackedBounties}
          userLocation={true}
          showOwnership={showOwnership && !userData?.tutorialOn}
          autoRotate={false}
          focusSector={globeFocusSector}
          actionExplanation={
            isTraveling ? "You are traveling to your destination" : undefined
          }
          routeTarget={showModal ? targetSector : null}
          journey={globeJourney}
          onTileClick={(sector) => initiateTravelToSector(sector)}
          hexasphere={globe}
        />
      )
    );
  }, [
    villages,
    globe,
    trackedBounties,
    showOwnership,
    globeFocusSector,
    isTraveling,
    globeJourney,
    showModal,
    targetSector,
    userData?.tutorialOn,
  ]);

  // Battle scene
  const SectorComponent = useMemo(() => {
    return (
      userData &&
      currentTile &&
      hasCurrentSector &&
      sectorWindow &&
      currentSectorMap && (
        <Sector
          loadLpcCatalog={loadLpcCatalog}
          tile={currentTile}
          sector={currentSector}
          sectorWindow={sectorWindow}
          target={targetPosition}
          showSorrounding={showSorrounding}
          showActive={showOtherUsers}
          isActive={!!showSector}
          autoAttackMode={autoAttackMode}
          isWorldExpanded={isWorldExpanded && !!showSector}
          cameraFocusRevision={cameraFocusRevision}
          setWorldExpanded={setWorldExpanded}
          setShowSorrounding={setShowSorrounding}
          setPosition={setScenePosition}
        />
      )
    );
  }, [
    loadLpcCatalog,
    currentTile,
    currentSector,
    currentSectorMap,
    sectorWindow,
    hasCurrentSector,
    setScenePosition,
    targetPosition,
    showSorrounding,
    showOtherUsers,
    autoAttackMode,
    isWorldExpanded,
    showSector,
    cameraFocusRevision,
    villages,
  ]);

  useEffect(() => {
    if (!searchParams.has("sector")) {
      requestedLocationRef.current = null;
      return;
    }
    if (!userData) return;
    const key = searchParams.toString();
    if (requestedLocationRef.current === key) return;
    requestedLocationRef.current = key;
    const parsed = travelLocationSchema.safeParse({
      sector: searchParams.get("sector"),
      longitude: searchParams.get("longitude") ?? undefined,
      latitude: searchParams.get("latitude") ?? undefined,
    });
    router.replace("/travel", { scroll: false });
    if (parsed.success) setLocationRequest(parsed.data);
    else showMutationToast({ success: false, message: "Invalid travel location" });
  }, [searchParams, userData, router]);

  useEffect(() => {
    if (
      !autoDestination ||
      !userData ||
      !canAttemptAwakeAction(userData) ||
      userData.sector !== autoDestination.sector ||
      !currentSectorMap ||
      isStartingTravel
    )
      return;
    if (
      autoDestination.longitude === undefined ||
      autoDestination.latitude === undefined
    ) {
      setActiveTab(sectorLink);
      setAutoDestination(null);
      return;
    }
    // Mirror the server's moveInSector checks so an unreachable target (blocked
    // terrain or a cut-off pocket) is reported once instead of starting a walk
    // that the server rejects step after step.
    const destination = {
      x: autoDestination.longitude,
      y: autoDestination.latitude,
    };
    const origin = findNearestWalkableCoordinate(currentSectorMap, {
      x: userData.longitude,
      y: userData.latitude,
    });
    if (
      !origin ||
      !isWalkableCoordinate(currentSectorMap, destination) ||
      !isReachableCoordinate(currentSectorMap, origin, destination)
    ) {
      showMutationToast({
        id: "auto-travel-unreachable",
        success: false,
        message: "That destination cannot be walked to",
      });
    } else {
      setActiveTab(sectorLink);
      setTargetPosition(destination);
    }
    setAutoDestination(null);
  }, [autoDestination, userData, currentSectorMap, isStartingTravel, sectorLink]);

  if (!userData) return <Loader explanation="Loading userdata" />;

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
  // Compare against the stable Global label rather than sectorLink: the sector
  // tab's label mutates from "Sector N" to "You (x, y)" once the scene reports
  // the player position, so a string match against it would go stale and drop
  // the subtitle back to the world name while on the sector view.
  const subtitle =
    hasCurrentSector && userData && !isGlobal
      ? `Sector ${currentSector} ${sectorVillageName ? `(${sectorVillageName})` : ""}`
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
      <HuntingArrival
        blocked={!!admissionRecovery || !!locationRequest || searchParams.has("sector")}
      />
      {locationRequest && (
        <Modal
          title="Auto Travel"
          isOpen={true}
          setIsOpen={() => setLocationRequest(null)}
          proceed_label="Travel"
          proceedDisabled={
            !!admissionRecovery || !canAttemptAwakeAction(userData) || isStartingTravel
          }
          onAccept={() => {
            if (!canAttemptAwakeAction(userData) || isStartingTravel) return;
            setAutoDestination(locationRequest);
            if (locationRequest.sector !== userData.sector)
              handleGlobalMove(locationRequest.sector);
            setLocationRequest(null);
          }}
        >
          Travel to {describeSector(locationRequest.sector)}
          {locationRequest.longitude !== undefined &&
          locationRequest.latitude !== undefined
            ? `, position [${locationRequest.longitude}, ${locationRequest.latitude}]`
            : ""}
          ?
          <p className="py-2">
            {locationRequest.longitude !== undefined &&
            locationRequest.latitude !== undefined
              ? "You will walk to the destination after arriving in its sector."
              : "You will travel to the destination sector."}
          </p>
          {locationRequest.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR && (
            <p className="text-red-600">Free-for-all PvP; sleeping is disabled.</p>
          )}
        </Modal>
      )}
      <ContentBox
        title="Travel"
        subtitle={subtitle}
        padding={false}
        topRightContent={
          <div className="flex cursor-pointer flex-row items-center">
            <WarFieldActions />
            {!isGlobal && activeTab !== "" && (
              <>
                {userData?.anbuId &&
                  (autoAttackMode ? (
                    <button
                      type="button"
                      aria-label="Stop auto-attack"
                      aria-pressed={true}
                      className={mapToolClassName}
                      onClick={() => setAutoAttackMode(false)}
                    >
                      <Zap className="h-7 w-7 text-red-500" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label="Start auto-attack"
                      aria-pressed={false}
                      className={mapToolClassName}
                      onClick={() => setShowAutoAttackModal(true)}
                    >
                      <ZapOff className="h-7 w-7 hover:text-red-500" />
                    </button>
                  ))}
                <StealthControls
                  onRevealed={(players) => {
                    setRevealedPlayers(players);
                    setShowRevealedPlayersModal(true);
                  }}
                />
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger
                      aria-label="Show other players on the map"
                      aria-pressed={showOtherUsers}
                      className={mapToolClassName}
                      onClick={() =>
                        tutorialRunning
                          ? setRevealOthersInTutorial((prev) => !prev)
                          : setShowActive(!showActive)
                      }
                    >
                      {showOtherUsers ? (
                        <Eye className="h-7 w-7 text-orange-500" />
                      ) : (
                        <EyeOff className="h-7 w-7" />
                      )}
                    </TooltipTrigger>
                    <TooltipContent>
                      {showOtherUsers
                        ? "Hide other players on the map"
                        : "Show other players on the map"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {userData.status === "AWAKE" && (
                  <button
                    type="button"
                    aria-label="Scout surrounding sectors"
                    aria-pressed={showSorrounding}
                    className={mapToolClassName}
                    onClick={() => setShowSorrounding((prev) => !prev)}
                  >
                    <UserRoundSearch
                      className={`h-7 w-7 hover:text-orange-500 ${showSorrounding ? "fill-orange-500" : ""}`}
                    />
                  </button>
                )}
              </>
            )}
            {isGlobal && !isTraveling && (
              <FindSectorPopover
                focusSector={globeFocusSector}
                onFocusSector={setFocusSector}
                trigger={
                  <Locate
                    className={`mr-2 h-7 w-7 hover:text-purple-500 ${focusSector !== null ? "text-purple-500" : ""}`}
                  />
                }
              />
            )}
            <Popover open={isQuickTravelOpen} onOpenChange={setQuickTravelOpen}>
              <PopoverTrigger aria-label="Quick Travel">
                <Search className={`mr-2 h-7 w-7 hover:text-orange-500`} />
              </PopoverTrigger>
              <PopoverContent className="w-72">
                <p className="py-2 font-semibold">Quick Travel</p>
                <p className="pb-2 text-muted-foreground text-sm">
                  Travel to a village, saved pin, or sector ID.
                </p>
                <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pb-3">
                  {(isQuickTravelOpen ? travelDestinations : []).map((destination) => {
                    const dotColor = getReadableVillageHexColor(destination.color);
                    const description =
                      "description" in destination
                        ? destination.description
                        : undefined;
                    const button = (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-auto justify-start py-1.5"
                        style={{ borderColor: dotColor }}
                        disabled={!canTravelTo(destination.sector)}
                        onClick={() => initiateTravelToSector(destination.sector)}
                      >
                        <span
                          className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/30 dark:ring-white/30"
                          style={{ backgroundColor: dotColor }}
                        />
                        <span className="flex min-w-0 flex-col items-start text-left">
                          <span>{destination.label}</span>
                          {description && (
                            <span className="font-normal text-[10px] text-red-600 dark:text-red-400">
                              {description}
                            </span>
                          )}
                        </span>
                        <span className="ml-auto text-muted-foreground text-xs">
                          {destination.sector}
                        </span>
                      </Button>
                    );
                    if (!description) {
                      return <Fragment key={destination.id}>{button}</Fragment>;
                    }
                    return (
                      <TooltipProvider key={destination.id} delayDuration={50}>
                        <Tooltip>
                          <TooltipTrigger asChild>{button}</TooltipTrigger>
                          <TooltipContent>{description}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                </div>
                <div className="flex flex-col gap-2 border-t py-3">
                  <p className="font-semibold text-sm">Saved pins</p>
                  <p className="text-muted-foreground text-xs">
                    Saved on this device for your account.
                  </p>
                  {pins.map((pin, index) => (
                    <div
                      key={`${pin.sector}-${pin.longitude}-${pin.latitude}`}
                      className="flex gap-1"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-auto min-w-0 flex-1 flex-col items-start whitespace-normal text-left"
                        disabled={
                          !!admissionRecovery ||
                          isStartingTravel ||
                          !canAttemptAwakeAction(userData)
                        }
                        onClick={() => setLocationRequest(pin)}
                      >
                        <span>{pin.label}</span>
                        <span className="text-muted-foreground text-xs">
                          Sector {pin.sector} [{pin.longitude}, {pin.latitude}]
                        </span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Remove pin ${pin.label}`}
                        onClick={() => savePins(pins.filter((_, i) => i !== index))}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <Input
                    aria-label="Pin name"
                    placeholder="Name this location"
                    maxLength={MAX_TRAVEL_PIN_LABEL_LENGTH}
                    value={pinLabel}
                    onChange={(event) => setPinLabel(event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !pinLabel.trim() ||
                      pins.length >= MAX_TRAVEL_PINS ||
                      !canAttemptAwakeAction(userData)
                    }
                    onClick={() => {
                      const next = pins.filter(
                        (pin) =>
                          pin.sector !== userData.sector ||
                          pin.longitude !== userData.longitude ||
                          pin.latitude !== userData.latitude,
                      );
                      savePins([
                        ...next,
                        {
                          label: pinLabel.trim(),
                          sector: userData.sector,
                          longitude: userRef.current?.longitude ?? userData.longitude,
                          latitude: userRef.current?.latitude ?? userData.latitude,
                        },
                      ]);
                      setPinLabel("");
                    }}
                  >
                    Save current location
                  </Button>
                </div>
                <Form {...quickTravelForm}>
                  <form
                    onSubmit={quickTravelForm.handleSubmit((data) => {
                      initiateTravelToSector(data.sector);
                    })}
                    className="flex flex-col gap-2 border-t pt-3"
                  >
                    <SectorIdField control={quickTravelForm.control} />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!canTravelTo(quickTravelSector)}
                    >
                      Travel to Sector{" "}
                      {Number.isFinite(quickTravelSector) ? quickTravelSector : "..."}
                    </Button>
                  </form>
                </Form>
              </PopoverContent>
            </Popover>
            {!isGlobal && activeTab !== "" && (
              <button
                type="button"
                aria-label="Expand world"
                aria-expanded={isWorldExpanded}
                disabled={!showSector || !SectorComponent}
                className="mr-2 hover:text-orange-500 disabled:opacity-50"
                onClick={() => setWorldExpanded(true)}
              >
                <Maximize2 className="h-7 w-7" />
              </button>
            )}
            {isGlobal && (
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
            )}
            {joinVillageBtn && (
              <Confirm
                title={`Join Village [${sectorVillage.name}]`}
                proceed_label="Join village"
                button={<GitMerge className={`mx-1 h-7 w-7 hover:text-orange-500`} />}
                triggerLabel={`Join ${sectorVillage.name}`}
                disabled={isJoining}
                isLoading={isJoining}
                keepOpenOnAccept
                onAccept={(_, { close }) =>
                  joinVillage({ villageId: sectorVillage.id }, { onSettled: close })
                }
              >
                Do you confirm that you wish to join {sectorVillage.name}? Please be
                aware that if you join this village your training benefits & regen will
                be reduced for {VILLAGE_REDUCED_GAINS_DAYS} days, and village loyalty
                bonuses will begin from day 0.
              </Confirm>
            )}
            {canCreateHideout && (
              <Confirm
                title="Purchase Hideout"
                proceed_label={canAffordHideout ? "Purchase hideout" : "Not enough ryo"}
                button={<HousePlus className={`mx-1 h-7 w-7 hover:text-orange-500`} />}
                triggerLabel="Purchase hideout"
                disabled={isCreatingHideout}
                isLoading={isCreatingHideout}
                keepOpenOnAccept
                onAccept={(_, { close }) => {
                  if (!canAffordHideout) return close();
                  purchaseHideout(
                    { clanId: userData.clanId || "", sector: currentSector ?? 0 },
                    { onSettled: close },
                  );
                }}
              >
                As a leader of a faction, you have the option of founding a hideout for
                your faction, thereby effectively de-coupling yourself from the common
                syndicate of outlaws. The purchase costs <b>{HIDEOUT_COST} ryo</b>, and
                the faction currently has <b>{userData?.clan?.bank} ryo</b>. Do you want
                to create your faction hideout in this sector?
              </Confirm>
            )}

            <NavTabs
              current={isGlobal ? globalLink : activeTab}
              options={isTraveling ? [globalLink] : [sectorLink, globalLink]}
              labels={{ [sectorLink]: <TravelPositionLabel /> }}
              setValue={setActiveTab}
              onChange={(value) => {
                if (value !== globalLink)
                  setCameraFocusRevision((previous) => previous + 1);
              }}
            />
          </div>
        }
      >
        {/* The countdown needs a viewport even while the destination scene is loading. */}
        <div className={userData.travelFinishAt ? "relative min-h-80" : "relative"}>
          {(showGlobal || (hasOpenedGlobal && villages && globe)) && (
            <div
              aria-hidden={!showGlobal}
              inert={!showGlobal}
              className={!showGlobal ? PAUSED_SCENE_CLASS : undefined}
            >
              {MapComponent}
            </div>
          )}
          {mapError && <MapError />}
          {/* Prepare the destination offscreen so its scene is ready on arrival. */}
          {(showSector ||
            isPreparingSector ||
            (hasOpenedSector && SectorComponent)) && (
            <div
              aria-hidden={!showSector}
              inert={!showSector}
              className={
                showSector
                  ? undefined
                  : isPreparingSector
                    ? "invisible absolute inset-0"
                    : PAUSED_SCENE_CLASS
              }
            >
              {SectorComponent}
            </div>
          )}
          {!villages && <Loader explanation="Loading data" />}
          {villages &&
            !isGlobal &&
            !mapError &&
            userData.status !== "TRAVEL" &&
            (!showSector || !SectorComponent) && <SectorLoadingPlaceholder />}
          {showModal && globe && userData && targetSector !== null && (
            <Modal
              id="tutorial-global-travel"
              title="World Travel"
              isOpen={showModal}
              setIsOpen={setShowModal}
              proceed_label={!isStartingTravel ? "Travel" : undefined}
              keepOpenOnAccept
              onAccept={() => handleGlobalMove(targetSector)}
            >
              {isStartingTravel && <Loader explanation="Preparing to Travel" />}
              {!isStartingTravel && (
                <div>
                  You are about to move from {describeSector(userData.sector)} to{" "}
                  {describeSector(targetSector)}.{" "}
                  <p className="py-2">
                    The travel time is estimated to be{" "}
                    {calcGlobalTravelTime(userData.sector, targetSector, globe)}{" "}
                    seconds.
                  </p>
                  {targetSector === MAP_WAR_TORN_BATTLEGROUND_SECTOR && (
                    <p className="mb-2 rounded-md border border-red-600/40 bg-red-600/10 p-2 text-red-700 text-sm dark:text-red-400">
                      Warning: this is a free-for-all PvP zone. Anyone can attack you
                      regardless of village or XP bracket, and you cannot sleep there.
                    </p>
                  )}
                  Do you confirm?
                </div>
              )}
            </Modal>
          )}
          {travelState?.travelFinishAt && (
            <TravelArrivalStatus
              sector={targetSector ?? travelState.sector}
              destinationName={sectorNames.get(targetSector ?? travelState.sector)}
              finishAt={travelState.travelFinishAt}
              timeDiff={timeDiff}
              isBusy={isFinishingTravel || isStartingTravel || !!admissionRecovery}
              isArrivalRejected={isArrivalRejected}
              onArrive={() => finishGlobalMove()}
              onRetrySync={
                admissionRecovery && !isStartingTravel ? retryAdmission : undefined
              }
              isSyncing={isRetryingAdmission}
            />
          )}
        </div>
      </ContentBox>
      <div className="flex flex-wrap items-start justify-between gap-2 p-1">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {showSector && <JutsuLoadoutSelector size="small" label="Jutsu" compact />}
          {showSector && <ItemLoadoutSelector size="small" label="Items" compact />}
        </div>
        {showSector && userData?.anbuId && autoAttackMode && (
          <div className="flex items-center font-semibold text-red-500 text-sm">
            <Zap className="mr-1 h-4 w-4" />
            Auto-Attack: Scanning for enemies to hunt...
          </div>
        )}
      </div>
      {shownConsumables && shownConsumables.length > 0 && (
        <div className="flex flex-col" inert={isFetchingItems}>
          <p className="font-bold">Consumables</p>
          {isFetchingItems && <Loader explanation="Refreshing items" />}
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
            <Modal
              title="Item Details"
              isOpen={isOpen}
              setIsOpen={setIsOpen}
              keepOpenOnAccept
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
                      disabled={isFetchingItems}
                      onClick={() =>
                        consume(getItemConsumeInput(userData?.userId ?? "", useritem))
                      }
                    >
                      <Cookie className="mr-2 h-5 w-5" />
                      Consume
                    </Button>
                  )}
                </div>
              )}
              {isConsuming && <Loader explanation="Using" />}
            </Modal>
          )}
        </div>
      )}

      {/* Auto Attack Configuration Modal */}
      {showAutoAttackModal && (
        <AutoAttackModal
          isOpen={showAutoAttackModal}
          setIsOpen={setShowAutoAttackModal}
          onEnable={() => setAutoAttackMode(true)}
        />
      )}

      {/* Revealed Players Modal (from Sensory Scan) */}
      {showRevealedPlayersModal && revealedPlayers.length > 0 && (
        <Modal
          title="Players Revealed by Sensory!"
          isOpen={showRevealedPlayersModal}
          setIsOpen={setShowRevealedPlayersModal}
          keepOpenOnAccept
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
                isAttackingRevealed={isAttackingRevealed}
                pendingAttackTarget={pendingAttackTarget}
                attackRevealedUser={attackRevealedUser}
                originSocketId={pusher?.connection.socket_id}
                setPendingAttackTarget={setPendingAttackTarget}
                setTargetPosition={setTargetPosition}
                setShowRevealedPlayersModal={setShowRevealedPlayersModal}
              />
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Stealth and sensory controls for the sector view.
 *
 * Owns the cooldown countdowns so their one-second updates only render the controls,
 * independently of the sector scene.
 */
const StealthControls: React.FC<{
  onRevealed: (players: RevealedPlayer[]) => void;
}> = ({ onRevealed }) => {
  const {
    data: userData,
    timeDiff,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector(selectUserWithoutPosition);
  const utils = api.useUtils();
  const currentSector = userData?.sector;
  const activationInFlightRef = useRef(false);
  const deactivationInFlightRef = useRef(false);
  const sensoryInFlightRef = useRef(false);
  const lastSuccessfulSensoryAtRef = useRef<Date | null>(null);
  const [lastSuccessfulSensoryAt, setLastSuccessfulSensoryAt] = useState<Date | null>(
    null,
  );

  const effectiveLastSensoryAt =
    lastSuccessfulSensoryAt &&
    (!userData?.lastSensoryAt ||
      lastSuccessfulSensoryAt.getTime() > userData.lastSensoryAt.getTime())
      ? lastSuccessfulSensoryAt
      : userData?.lastSensoryAt;

  const stealthStatus = userData
    ? getStealthStatus(
        { ...userData, lastSensoryAt: effectiveLastSensoryAt ?? null },
        STEALTH_SENSORY_CAP,
        STEALTH_TRAIN_GAIN_PER_MINUTE,
        timeDiff,
      )
    : undefined;
  const sensoryCooldown = useLiveCountdown(stealthStatus?.sensoryCooldownRemaining);
  const stealthCooldown = useLiveCountdown(stealthStatus?.stealthCooldownRemaining);
  const stealthDuration = useLiveCountdown(stealthStatus?.stealthDurationRemaining);
  // The live duration expires even when the compiler reuses the status snapshot.
  const isCurrentlyStealthed = Boolean(
    stealthStatus?.stealthActive && stealthDuration > 0,
  );

  const { mutate: activateStealth, isPending: isActivatingStealth } =
    api.stealth.activateStealth.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success && data.data) {
          await updateUser(
            {
              stealthActive: true,
              stealthActivatedAt: data.data.stealthActivatedAt,
            },
            { revision, refetch: false, userRecovery: data.userRecovery },
          );
        } else if (data.userRecovery) {
          await updateUser(data, { revision, refetch: false });
        }
      },
      onSettled: () => {
        activationInFlightRef.current = false;
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
      onSettled: () => {
        deactivationInFlightRef.current = false;
      },
    });

  const { mutate: scanSensory, isPending: isScanningSensory } =
    activateSensory.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success && data.data) {
          lastSuccessfulSensoryAtRef.current = data.data.lastSensoryAt;
          setLastSuccessfulSensoryAt(data.data.lastSensoryAt);
          if (data.data.detectedUsers.length > 0) {
            onRevealed(data.data.detectedUsers);
          }

          // The server has already consumed the scan. Keep cache maintenance best-effort so a
          // client refresh failure cannot hide results or make the Radar appear retryable.
          void Promise.allSettled([
            updateUser(
              { lastSensoryAt: data.data.lastSensoryAt },
              { revision, refetch: false, userRecovery: data.userRecovery },
            ),
            utils.travel.getSectorData.invalidate(),
          ]);
        } else if (data.userRecovery) {
          void updateUser(data, { revision, refetch: false });
        }
      },
      onSettled: () => {
        sensoryInFlightRef.current = false;
      },
    });

  return (
    <>
      {/* Stealth Toggle */}
      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger
            type="button"
            disabled={isActivatingStealth || isDeactivatingStealth}
            aria-busy={isActivatingStealth || isDeactivatingStealth}
            aria-disabled={isActivatingStealth || isDeactivatingStealth}
            aria-label={
              isActivatingStealth
                ? "Activating"
                : isDeactivatingStealth
                  ? "Deactivating"
                  : isCurrentlyStealthed
                    ? "Deactivate stealth"
                    : "Activate stealth"
            }
            className={
              isActivatingStealth || isDeactivatingStealth ? "cursor-wait" : undefined
            }
            onClick={() => {
              if (
                activationInFlightRef.current ||
                deactivationInFlightRef.current ||
                isActivatingStealth ||
                isDeactivatingStealth
              ) {
                return;
              }
              if (isCurrentlyStealthed) {
                deactivationInFlightRef.current = true;
                deactivateStealth();
              } else if (stealthCooldown <= 0) {
                activationInFlightRef.current = true;
                activateStealth();
              }
            }}
          >
            {isActivatingStealth || isDeactivatingStealth ? (
              <Loader2
                className="mr-2 h-7 w-7 animate-spin text-purple-500"
                aria-hidden="true"
              />
            ) : (
              <Ghost
                className={`mr-2 h-7 w-7 ${isCurrentlyStealthed ? "text-purple-500" : stealthCooldown > 0 ? "cursor-not-allowed text-gray-400" : "hover:text-purple-500"}`}
              />
            )}
          </TooltipTrigger>
          <TooltipContent aria-live="polite">
            {isActivatingStealth
              ? "Activating"
              : isDeactivatingStealth
                ? "Deactivating"
                : isCurrentlyStealthed
                  ? `Stealth Active (${Math.ceil(stealthDuration)}s remaining)`
                  : stealthCooldown > 0
                    ? `Stealth Cooldown (${Math.ceil(stealthCooldown)}s)`
                    : "Activate Stealth"}
          </TooltipContent>
        </Tooltip>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {isActivatingStealth
            ? "Activating"
            : isDeactivatingStealth
              ? "Deactivating"
              : ""}
        </span>
      </TooltipProvider>
      {/* Sensory Scan */}
      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <button
                type="button"
                disabled={
                  isScanningSensory ||
                  sensoryCooldown > 0 ||
                  currentSector === undefined
                }
                aria-busy={isScanningSensory}
                aria-disabled={
                  isScanningSensory ||
                  sensoryCooldown > 0 ||
                  currentSector === undefined
                }
                aria-label={isScanningSensory ? "Scanning" : "Scan sector"}
                className={isScanningSensory ? "cursor-wait" : undefined}
                onClick={() => {
                  const successfulScanCooldown = getRemainingSensoryCooldown(
                    lastSuccessfulSensoryAtRef.current,
                    userData?.sensory ?? 0,
                    timeDiff,
                  );
                  if (
                    sensoryInFlightRef.current ||
                    isScanningSensory ||
                    successfulScanCooldown > 0
                  ) {
                    return;
                  }
                  if (sensoryCooldown <= 0) {
                    if (currentSector !== undefined) {
                      sensoryInFlightRef.current = true;
                      scanSensory({ sector: currentSector });
                    }
                  }
                }}
              >
                {isScanningSensory ? (
                  <Loader2
                    className="mr-2 h-7 w-7 animate-spin text-blue-500"
                    aria-hidden="true"
                  />
                ) : (
                  <Radar
                    className={`mr-2 h-7 w-7 ${sensoryCooldown > 0 ? "cursor-not-allowed text-gray-400" : "hover:text-blue-500"}`}
                    aria-hidden="true"
                  />
                )}
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent aria-live="polite">
            {isScanningSensory
              ? "Scanning"
              : sensoryCooldown > 0
                ? `Sensory Cooldown (${Math.ceil(sensoryCooldown)}s)`
                : `Scan for Hidden Enemies (${(stealthStatus?.sensoryDetectChance ?? 5).toFixed(0)}% chance)`}
          </TooltipContent>
        </Tooltip>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {isScanningSensory ? "Scanning" : ""}
        </span>
      </TooltipProvider>
    </>
  );
};

/**
 * Revealed Player Card: a player revealed by sensing, with actions to travel to or
 * attack them.
 */
const RevealedPlayerCard = ({
  player,
  userData,
  villageData,
  isAttackingRevealed,
  pendingAttackTarget,
  attackRevealedUser,
  originSocketId,
  setPendingAttackTarget,
  setTargetPosition,
  setShowRevealedPlayersModal,
}: {
  player: RevealedPlayer;
  userData: ReturnType<typeof useRequiredUserData>["data"];
  villageData: { id: string; name: string; hexColor: string }[] | undefined;
  isAttackingRevealed: boolean;
  pendingAttackTarget: AttackTarget | null;
  originSocketId?: string;
  attackRevealedUser: (params: {
    originSocketId?: string;
    userId: string;
    longitude: number;
    latitude: number;
    sector: number;
  }) => void;
  setPendingAttackTarget: (target: AttackTarget) => void;
  setTargetPosition: (pos: { x: number; y: number }) => void;
  setShowRevealedPlayersModal: (show: boolean) => void;
}) => {
  const sameHex =
    player.latitude === userData?.latitude && player.longitude === userData?.longitude;

  const village = villageData?.find((v) => v.id === player.villageId);
  const villageName =
    village?.name ?? (player.villageId || player.isMasked ? "Unknown" : "Outlaw");
  const villageColor = village?.hexColor ?? "gray";

  const showAttack = player.canAttack;

  return (
    <div className="flex items-center justify-between rounded-lg bg-muted p-3">
      <div>
        <p className="font-semibold">{player.username}</p>
        <p className="text-muted-foreground text-sm">
          {player.level !== null && `Lvl. ${player.level} - `}
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
                originSocketId,
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
          <span className="text-muted-foreground text-sm italic">Cannot attack</span>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Hides a mounted scene and moves it out of the viewport, so the renderer's intersection
 * observer suspends its frame loop until the scene's tab is shown again.
 */
const PAUSED_SCENE_CLASS =
  "pointer-events-none invisible absolute inset-0 -translate-x-[200vw] overflow-hidden";

/** Holds the sector scene's space with its loading pill until its data and code arrive. */
const SectorLoadingPlaceholder = () => (
  <div className="flex min-h-60 items-center justify-center">
    <div
      role="status"
      className="bg-background/95 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-md motion-reduce:[&_img]:animate-none"
    >
      <Loader noPadding size={20} />
      <span>Loading world…</span>
    </div>
  </div>
);

// Alias the procedure so its action name is not interpreted as a React hook.
const activateSensory = api.stealth.useSensory;

/** A 40px icon toggle in the map's title bar. */
const mapToolClassName =
  "mr-1 inline-flex size-[40px] shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** Public player fields shown by sensory reveals and their map markers. */
type RevealedPlayer = NonNullable<
  RouterOutputs["stealth"]["useSensory"]["data"]
>["detectedUsers"][number];

/** A revealed player the user is walking to attack on arrival. */
type AttackTarget = Pick<
  RevealedPlayer,
  "userId" | "username" | "longitude" | "latitude"
>;
