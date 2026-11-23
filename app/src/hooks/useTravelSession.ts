"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm, useWatch } from "react-hook-form";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  MAP_WAR_TORN_BATTLEGROUND_COLOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import type { UserItemWithItem } from "@/drizzle/schema";
import { useAutoAttackMode } from "@/hooks/autoAttack";
import { useLocalStorage } from "@/hooks/localstorage";
import { useLpcCatalogLoader } from "@/hooks/lpc";
import { useMap } from "@/hooks/map";
import { useTutorialStep } from "@/hooks/tutorial";
import { useConsumeItem } from "@/hooks/useItemActions";
import { useMapAssetLibrary } from "@/hooks/useMapAssetLibrary";
import { useSectorCacheUpdate } from "@/hooks/useSectorCacheUpdate";
import { showActionReadinessToast } from "@/libs/actionFeedback";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import {
  findNearestWalkableCoordinate,
  isReachableCoordinate,
  isWalkableCoordinate,
} from "@/libs/sector-map/validation";
import type { GlobalTile, SectorPoint } from "@/libs/sector-map/world-types";
import { showMutationToast } from "@/libs/toast";
import {
  calcGlobalTravelTime,
  globalTravelFinishPatch,
  optimisticGlobalTravelStart,
  resolveGlobeJourney,
} from "@/libs/travel";
import { isTutorialActive } from "@/libs/tutorial";
import { MINUTE_S } from "@/utils/time";
import {
  selectUserWithoutPosition,
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
} from "@/validators/travel";

/**
 * Own travel data, destinations, mutations and arrival state once per mounted host.
 * Share the returned controller with its view; URL requests and activity redirects belong to the host.
 */
export function useTravelSession(isInteractive = true) {
  // Display preferences and travel controls
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

  const [locationRequest, setLocationRequest] = useState<TravelLocation | null>(null);
  const [autoDestination, setAutoDestination] = useState<TravelLocation | null>(null);
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
  // The visible sector observes this key on a 10s interval. Selecting only the village
  // name keeps unrelated presence changes from re-rendering the travel page.
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

  // Re-ingest a cached bootstrap on return; walking may have pruned its outer sectors.
  useEffect(() => {
    if (!bootWindow || bootWindow.center !== userData?.sector) return;
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
  }, [bootWindow, userData?.sector]);

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

  // Retain the queued attack while a building owns input; live coordinates confirm arrival.
  useEffect(() => {
    if (
      isInteractive &&
      pendingAttackTarget &&
      currentPosition &&
      userData &&
      userData.longitude === pendingAttackTarget.longitude &&
      userData.latitude === pendingAttackTarget.latitude &&
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
    isInteractive,
    currentPosition,
    pendingAttackTarget,
    userData,
    isAttackingRevealed,
    attackRevealedUser,
  ]);

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

  return {
    showActive,
    setShowActive,
    setRevealOthersInTutorial,
    showOwnership,
    setShowOwnership,
    autoAttackMode,
    setAutoAttackMode,
    showModal,
    setShowModal,
    showSorrounding,
    setShowSorrounding,
    showAutoAttackModal,
    setShowAutoAttackModal,
    revealedPlayers,
    setRevealedPlayers,
    showRevealedPlayersModal,
    setShowRevealedPlayersModal,
    pendingAttackTarget,
    setPendingAttackTarget,
    activeTab,
    setActiveTab,
    focusSector,
    setFocusSector,
    isWorldExpanded,
    setWorldExpanded,
    cameraFocusRevision,
    setCameraFocusRevision,
    isArrivalRejected,
    hasOpenedGlobal,
    hasOpenedSector,
    locationRequest,
    setLocationRequest,
    setAutoDestination,
    pinLabel,
    setPinLabel,
    isQuickTravelOpen,
    setQuickTravelOpen,
    globe,
    mapError,
    currentTile,
    targetPosition,
    setTargetPosition,
    targetSector,
    pusher,
    timeDiff,
    userRef,
    userData,
    isRetryingAdmission,
    admissionRecovery,
    travelState,
    retryAdmission,
    loadLpcCatalog,
    setScenePosition,
    pins,
    savePins,
    tutorialRunning,
    showOtherUsers,
    villageData,
    sectorVillageName,
    sectorWindow,
    currentSectorMap,
    villages,
    travelDestinations,
    sectorNames,
    describeSector,
    trackedBounties,
    sectorVillage,
    userItems,
    isFetchingItems,
    useritem,
    setUserItem,
    isOpen,
    setIsOpen,
    currentSector,
    hasCurrentSector,
    sectorLink,
    globalLink,
    quickTravelForm,
    quickTravelSector,
    isStartingTravel,
    finishGlobalMove,
    isFinishingTravel,
    joinVillage,
    isJoining,
    purchaseHideout,
    isCreatingHideout,
    consume,
    isConsuming,
    attackRevealedUser,
    isAttackingRevealed,
    handleGlobalMove,
    canTravelTo,
    initiateTravelToSector,
    isTraveling,
    globeJourney,
    isGlobal,
    showGlobal,
    isPreparingSector,
    globeFocusSector,
    showSector,
  };
}

/** Bootstrap sector windows stay cached this long after travel unmounts. */
const BOOT_WINDOW_RETENTION_MS = 30 * MINUTE_S * 1000;

/** A stored per-sector window entry (position within a window comes from the layout) */
type StoredSectorEntry =
  RouterOutputs["worldMap"]["getSectorEntries"]["entries"][number];
/** One sector's dx/dy placement within a specific window */
type WindowLayoutEntry =
  RouterOutputs["worldMap"]["getSectorWindow"]["windowLayouts"][number]["entries"][number];
type ConfirmedTravelAdmission = NonNullable<
  RouterOutputs["travel"]["startGlobalMove"]["data"]
> & { userId: string };

/** Public player fields shown by sensory reveals and their map markers. */
export type RevealedPlayer = NonNullable<
  RouterOutputs["stealth"]["useSensory"]["data"]
>["detectedUsers"][number];

/** A revealed player the user is walking to attack on arrival. */
export type AttackTarget = Pick<
  RevealedPlayer,
  "userId" | "username" | "longitude" | "latitude"
>;

/** The controller shared by travel views and their host. */
export type TravelSession = ReturnType<typeof useTravelSession>;
