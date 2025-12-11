import React, { useRef, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import alea from "alea";
import { Vector2, OrthographicCamera, Group, Clock } from "three";
import Countdown from "./Countdown";
import WebGlError from "@/layout/WebGLError";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { drawCombatBackground, drawCombatEffects } from "@/libs/threejs/combat";
import { OrbitControls } from "@/libs/threejs/OrbitControls";
import { COMBAT_SECONDS, COMBAT_LOBBY_SECONDS } from "@/libs/combat/constants";
import { SpriteMixer } from "@/libs/threejs/SpriteMixer";
import {
  cleanUp,
  setupScene,
  setRaycasterFromMouse,
  smoothCameraFollow,
} from "@/libs/threejs/util";
import { getBackgroundColor } from "@/libs/threejs/biome";
import { highlightTiles } from "@/libs/threejs/combat";
import { highlightTooltips, highlightTileTooltips } from "@/libs/threejs/combat";
import { highlightUsers } from "@/libs/threejs/combat";
import { calcActiveUser, availableUserActions } from "@/libs/combat/actions";
import { drawCombatUsers } from "@/libs/threejs/combat";
import { updateWindAnimation, updateWaveAnimation } from "@/libs/threejs/shaders";
import { useRequiredUserData } from "@/utils/UserContext";
import { api, useGlobalOnMutateProtect } from "@/app/_trpc/client";
import { secondsFromNow } from "@/utils/time";
import { showMutationToast } from "@/libs/toast";
import { useSetAtom } from "jotai";
import { userBattleAtom } from "@/utils/UserContext";
import { Check } from "lucide-react";
import { PvpBattleTypes } from "@/drizzle/constants";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import {
  IMG_INITIATIVE_D20,
  HEX_STACKING_DISPLACEMENT,
  HEX_ASPECT_RATIO,
} from "@/drizzle/constants";
import type { Grid } from "honeycomb-grid";
import type { ReturnedBattle, StatSchemaType } from "@/libs/combat/types";
import type { CachedIntersections } from "@/libs/combat/types";
import type { CombatAction } from "@/libs/combat/types";
import type { BattleState } from "@/libs/combat/types";
import type { TerrainHex } from "@/libs/hexgrid";
import { useLocalStorage } from "@/hooks/localstorage";
import { useBattleMaps } from "@/hooks/combat";
import type { CombatPreferences } from "@/hooks/combat";
import { usePerformanceMonitor } from "@/hooks/performance-monitor";
import Modal2 from "@/layout/Modal2";
import { useTutorialStep } from "@/hooks/tutorial";
import { LogbookEntry } from "@/layout/Logbook";
import { preloadTextures } from "@/libs/threejs/util";
import { preloadAudioBuffers } from "@/utils/audio";
import { VisualizeEffects, VisualizeGroundEffects } from "@/layout/MenuBoxProfile";

interface CombatProps {
  action?: CombatAction | undefined;
  battleState: BattleState;
  userId: string;
  setBattleState: React.Dispatch<React.SetStateAction<BattleState | undefined>>;
  config: CombatPreferences;
}

const Combat: React.FC<CombatProps> = (props) => {
  // Destructure props
  const { battleState, setBattleState, config } = props;
  const result = battleState.result;
  const utils = api.useUtils();

  // State
  const [isInLobby, setIsInLobby] = useState<boolean>(true);
  const [logbookModalOpen, setLogbookModalOpen] = useState<boolean>(false);
  const [logbookModalQuestId, setLogbookModalQuestId] = useState<string | null>(null);

  // Hover tooltip state for effects (can include both user and ground effects)
  const [hoveredEffect, setHoveredEffect] = useState<{
    tileKey: string;
    userId?: string;
    position: { x: number; y: number };
  } | null>(null);

  // Light layout preference state
  const [lightLayout] = useLocalStorage<boolean>("lightLayout", false);
  const [storedZoom, setStoredZoom] = useLocalStorage<number>("combatZoom", 1.5);

  // Performance monitoring (unbounded for max FPS testing in dev)
  const performanceMonitor = usePerformanceMonitor(true);

  // References which shouldn't update
  const [webglError, setWebglError] = useState<boolean>(false);
  const [hasFocus, setHasFocus] = useState<boolean>(true);
  const lastActions = useRef<Date[]>([]);
  const battle = useRef<ReturnedBattle | null | undefined>(battleState.battle);
  const action = useRef<CombatAction | undefined>(props.action);
  const userId = useRef<string>(props.userId);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const grid = useRef<Grid<TerrainHex> | null>(null);
  const mouse = new Vector2();
  const mouseScreen = useRef({ x: 0, y: 0 });
  const battleId = battle.current?.id;
  const battleType = battle.current?.battleType;

  // Reference to group holding tile names for toggling visibility
  const groupNamesRef = useRef<Group | null>(null);

  // Camera following refs
  const cameraRef = useRef<OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraTargetPosition = useRef<{ x: number; y: number } | null>(null);
  
  // Track if component is mounted to prevent stale render callbacks
  const isMounted = useRef<boolean>(false);

  // Tutorial step
  const { currentStep, handleNextStepAsync } = useTutorialStep();

  // Mutation protection
  const onMutateCheck = useGlobalOnMutateProtect();

  // Data from the DB
  const setBattleAtom = useSetAtom(userBattleAtom);
  const { data: userData, pusher, timeDiff, updateUser } = useRequiredUserData();
  const [statDistribution] = useLocalStorage<StatSchemaType | undefined>(
    "statDistribution",
    undefined,
  );
  const suid = userData?.userId;
  // Precompute available actions for the session user; recompute on version change
  const precomputedActions = useMemo(() => {
    if (battle.current && suid) {
      return availableUserActions(battle.current, suid);
    }
    return [] as CombatAction[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.current?.version, suid]);

  // Precompute maps for ground effects, user effects, and user positions
  const battleMaps = useBattleMaps(battle.current ?? null);

  // Get effects for hovered element (can include both user and ground effects)
  const hoveredEffects = useMemo(() => {
    if (!hoveredEffect) return null;

    const groundEffects =
      battleMaps.groundEffectsByTile.get(hoveredEffect.tileKey) || [];
    const userEffects = hoveredEffect.userId
      ? battleMaps.userEffectsByUserId.get(hoveredEffect.userId) || []
      : [];

    if (groundEffects.length === 0 && userEffects.length === 0) return null;

    return {
      groundEffects,
      userEffects,
      userId: hoveredEffect.userId,
    };
  }, [hoveredEffect, battleMaps]);

  // Store precomputed maps in refs for use in render loop
  const battleMapsRef = useRef(battleMaps);
  const setHoveredEffectRef = useRef(setHoveredEffect);
  const lastHoverKeyRef = useRef<string | null>(null);

  // Update refs when memos change
  useEffect(() => {
    battleMapsRef.current = battleMaps;
    setHoveredEffectRef.current = setHoveredEffect;
  }, [battleMaps, setHoveredEffect]);

  // Session battle user state
  const battleSessionUser = battle.current?.usersState.find(
    (u) => u.userId === userData?.userId,
  );

  // Asset IDs to fetch
  const textureAssets = battle.current?.extraState.textureAssets || [];
  const sfxAssets = battle.current?.extraState.sfxAssets || [];
  const allAssets = [...textureAssets, ...sfxAssets];

  // Query data
  const { data: gameAssets } = api.misc.getAllGameAssetNames.useQuery(
    { ids: allAssets },
    { enabled: !!battle.current },
  );

  // Preload all combat-related asset textures once assets list is ready
  useEffect(() => {
    if (!gameAssets || gameAssets.length === 0) return;
    const ids = battle.current?.extraState.textureAssets || [];
    if (ids.length === 0) return;
    const urls = gameAssets
      .filter((a) => ids.includes(a.id))
      .map((a) => a.image)
      .filter(Boolean);
    void preloadTextures(urls);
  }, [battle.current?.id, battle.current?.version, gameAssets]);

  // Preload combat-related SFX (AudioBuffers via Web Audio API) once assets list is ready
  useEffect(() => {
    if (!gameAssets || gameAssets.length === 0) return;
    const sfxIds = battle.current?.extraState.sfxAssets || [];
    if (!sfxIds || sfxIds.length === 0) return;
    const urls = gameAssets
      .filter((a) => sfxIds.includes(a.id))
      .map((a) => a.url)
      .filter(Boolean);
    void preloadAudioBuffers(urls);
  }, [battle.current?.id, battle.current?.version, gameAssets]);

  // Convenience method for helping people to not move too fast
  const canPerformAction = () => {
    const minuteAgo = secondsFromNow(-60);
    const newActions = lastActions.current.filter((a) => a > minuteAgo);
    newActions.push(new Date());
    if (newActions.length < 55) {
      lastActions.current = newActions;
      return true;
    } else {
      document.body.style.cursor = "default";
      showMutationToast({
        success: false,
        message: "You are acting very fast. Much faster and you will be penalized.",
      });
      return false;
    }
  };

  // Mutation for starting a fight
  const { mutate: battleArenaHealAndGo } = api.combat.battleArenaHeal.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        showMutationToast({
          success: data.success,
          message: "You enter the arena again",
        });
        startArenaBattle({
          aiId: arenaOpponentId!,
          stats:
            battle.current?.battleType === "TRAINING" ? statDistribution : undefined,
        });
      } else {
        showMutationToast(data);
      }
    },
  });

  // Mutation for starting a fight
  const { mutate: startArenaBattle } = api.combat.startArenaBattle.useMutation({
    onSuccess: async (result) => {
      if (result.success && result.battleId) {
        showMutationToast({
          success: result.success,
          message: "You enter the arena again",
        });
        setBattleAtom(undefined);
        setBattleState({ battle: undefined, result: null, isPending: true });
        await updateUser({
          status: "BATTLE",
          battleId: result.battleId,
          updatedAt: new Date(),
        });
        await utils.combat.getBattle.invalidate();
      } else {
        showMutationToast(result);
      }
    },
  });

  // User Action
  const { mutate: performAction, isPending } = api.combat.performAction.useMutation({
    onMutate: () => {
      onMutateCheck();
      document.body.style.cursor = "wait";
      setBattleState({ battle: battle.current, result: null, isPending: true });
    },
    onSuccess: async (data) => {
      // Notifications (if any)
      if (data.notification) {
        showMutationToast({ success: true, message: data.notification });
      }
      if (data?.result?.notifications.length !== 0) {
        data?.result?.notifications.forEach((notification) => {
          // Check if this is a durability warning (contains "durability is now" or "has broken")
          const isDurabilityWarning =
            notification.includes("durability is now") ||
            notification.includes("durability is critically low") ||
            notification.includes("has broken");
          const isBrokenItem = notification.includes("has broken");
          showMutationToast({
            success: !isDurabilityWarning, // Durability warnings are not "success" (they're warnings)
            title: isDurabilityWarning
              ? isBrokenItem
                ? "Item Broken"
                : "Low Durability Warning"
              : "Quest Update",
            message: notification,
          });
        });
      }
      // Check for quest updates
      if (data.updatedQuestIds && data.updatedQuestIds.length > 0) {
        // Ignore popup for tutorial step
        if (currentStep?.title !== "Capture Target") {
          // Show popup for consecutive quests
          data.updatedQuestIds.forEach((questId) => {
            const quest = userData?.userQuests?.find((q) => q.questId === questId);
            if (quest?.quest?.consecutiveObjectives) {
              setLogbookModalOpen(true);
              setLogbookModalQuestId(questId);
            }
          });
        }
      }
      // Update battle history
      if (battleId && data.logEntries) {
        const prevData = utils.combat.getBattleEntries.getData({
          battleId,
          refreshKey: battle.current?.version,
        });
        utils.combat.getBattleEntries.setData(
          { battleId, refreshKey: data.battle.version },
          () => {
            if (data.logEntries) {
              return prevData ? [...data.logEntries, ...prevData] : data.logEntries;
            }
          },
        );
      }
      // Check if tutorial should progress
      if (data.result) {
        if (currentStep?.onCombatWin && data.result?.outcome === "Won") {
          await handleNextStepAsync(currentStep.onCombatWin);
        } else if (currentStep?.onCombatLoss && data.result?.outcome !== "Won") {
          await handleNextStepAsync(currentStep.onCombatLoss);
        }
      }
      // Update battle state
      if (data.updateClient) {
        battle.current = data.battle;
        setBattleState({
          battle: data.battle,
          result: data.result,
          isPending: false,
        });
        setBattleAtom(battle.current);
      }
    },
  });

  // I am here call
  const { mutate: iAmHere } = api.combat.iAmHere.useMutation({
    onSuccess: (data) => {
      if ("battle" in data && data.success && data.battle) {
        battle.current = data.battle;
        setBattleAtom(battle.current);
        setBattleState({ battle: data.battle, result: null, isPending: false });
      } else {
        showMutationToast({ success: false, message: data.message });
      }
    },
  });

  // Mutation for selecting loadouts
  const { mutate: selectLoadout } = api.combat.updateCombatLoadout.useMutation({
    onSuccess: (data) => {
      if ("battle" in data && data.success && data.battle) {
        battle.current = data.battle;
        setBattleAtom(battle.current);
        setBattleState({ battle: data.battle, result: null, isPending: false });
      } else {
        showMutationToast({ success: false, message: data.message });
      }
    },
  });

  // Handle key-presses
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (battle.current) {
      const { actor } = calcActiveUser(battle.current, suid, timeDiff, {
        precomputedUserId: suid,
        precomputedActions,
      });
      switch (event.key) {
        case "w":
          if (actor.userId === suid) {
            document.body.style.cursor = "wait";
            if (canPerformAction()) {
              performAction({
                battleId: battle.current.id,
                userId: userId.current,
                actionId: "wait",
                longitude: actor.longitude,
                latitude: actor.latitude,
                version: battle.current.version,
              });
            }
          }
          break;
      }
    }
  };
  useEffect(() => {
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update mouse position on mouse move
  const onDocumentMouseMove = (event: MouseEvent) => {
    if (mountRef.current) {
      const bounding_box = mountRef.current.getBoundingClientRect();
      mouse.x = (event.offsetX / bounding_box.width) * 2 - 1;
      mouse.y = -((event.offsetY / bounding_box.height) * 2 - 1);
      // Also track screen coordinates for tooltips
      mouseScreen.current.x = event.clientX;
      mouseScreen.current.y = event.clientY;
    }
  };
  const onDocumentMouseLeave = () => {
    if (mountRef.current) {
      mouse.x = 9999999;
      mouse.y = 9999999;
    }
  };

  // If user has no actions left / round is over, propagate battle & potentially - perform AI actions
  useEffect(() => {
    const interval = setInterval(() => {
      const focusCheck = document.hasFocus();
      if (!focusCheck && process.env.NODE_ENV !== "development") setHasFocus(false);
      if (!hasFocus || !focusCheck) return;
      if (suid && battle.current && userId.current && !isPending && !result) {
        const { actor, changedActor } = calcActiveUser(battle.current, suid, timeDiff, {
          precomputedUserId: suid,
          precomputedActions,
        });
        // Scenario 1: it is now AIs turn, perform action
        if (actor.isAi && !isPending) {
          if (canPerformAction()) {
            performAction({
              battleId: battle.current.id,
              version: battle.current.version,
            });
          }
        } else {
          // Scenario 2: more than 10 seconds passed, or actor is no longer the same as active user - refetch
          const updatePassed =
            Date.now() - timeDiff - battle.current.roundStartAt.getTime();
          const createPassed =
            Date.now() - timeDiff - battle.current.createdAt.getTime();
          const check1 = updatePassed > COMBAT_SECONDS * 1000;
          const check2 = createPassed > (COMBAT_LOBBY_SECONDS + COMBAT_SECONDS) * 1000;
          if ((check1 && check2) || changedActor) {
            battle.current.roundStartAt = new Date();
            void utils.combat.getBattle.invalidate();
          }
        }
      }
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, timeDiff, result, suid]);

  useEffect(() => {
    action.current = props.action;
    userId.current = props.userId;
    battle.current = props.battleState.battle;
    if (props.battleState.result) {
      void Promise.all([
        utils.profile.getUser.invalidate(),
        utils.travel.getSectorData.invalidate(),
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props]);

  useEffect(() => {
    if (battleId && pusher) {
      const channel = pusher.subscribe(battleId);
      channel.bind("event", (data: { version: number }) => {
        if (battle.current?.version !== data.version && !result) {
          void utils.combat.getBattle.invalidate();
        }
      });
      return () => {
        pusher.unsubscribe(battleId);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId]);

  // Lobby for non-arena battles, letting both oppoenents join
  useEffect(() => {
    if (isInLobby) {
      const interval = setInterval(() => {
        const syncedTime = Date.now() - timeDiff;
        if (battle.current && battle.current.createdAt.getTime() > syncedTime) {
          setIsInLobby(true);
        } else {
          setIsInLobby(false);
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [battle, timeDiff, isInLobby]);

  useEffect(() => {
    // Reference to the mount
    const sceneRef = mountRef.current;

    if (sceneRef && battle.current && gameAssets !== undefined) {
      // Mark component as mounted
      isMounted.current = true;
      // Used for map size calculations
      const width2height =
        ((battle.current.height + 2) * HEX_ASPECT_RATIO) /
        (battle.current.width - HEX_STACKING_DISPLACEMENT * (battle.current.width - 1));

      // Map size
      const WIDTH = sceneRef.getBoundingClientRect().width;
      const HEIGHT = WIDTH * width2height;

      // Listeners
      sceneRef.addEventListener("mousemove", onDocumentMouseMove, false);
      sceneRef.addEventListener("mouseleave", onDocumentMouseLeave, false);

      // Get background color based on battle background/biome
      const { color } = getBackgroundColor(battle.current.background);

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

      // Setup camara
      const camera = new OrthographicCamera(0, WIDTH, HEIGHT, 0, -10, 10);
      camera.zoom = storedZoom;
      camera.updateProjectionMatrix();
      cameraRef.current = camera;

      // Seeded noise generator for map gen from battle ID
      const prng = alea(battle.current.id);

      // Draw the background
      const {
        group_dirt,
        group_tiles,
        group_edges,
        group_names,
        group_assets,
        honeycombGrid,
      } = drawCombatBackground(WIDTH, battle.current, prng, lightLayout);
      grid.current = honeycombGrid;

      // Set initial visibility based on prop and store reference
      group_names.visible = config.showGridNumbers;
      groupNamesRef.current = group_names;

      // Intersections & highlights from interactions
      let highlights = new Set<string>();
      let tooltips = new Set<string>();
      let userHighlights = new Set<string>();

      // js groups for organization
      const group_users = new Group();
      const group_ground = new Group();
      const group_effects = new Group();

      // Enable controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableRotate = false;
      controls.zoomSpeed = 0.3;
      controls.minZoom = 1;
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

      // Add the group to the scene
      scene.add(group_dirt);
      scene.add(group_tiles);
      scene.add(group_edges);
      scene.add(group_names);
      scene.add(group_assets);
      scene.add(group_ground);
      scene.add(group_users);
      scene.add(group_effects);

      // Capture clicks to update move direction
      const onClick = (e: MouseEvent) => {
        setRaycasterFromMouse(raycaster, sceneRef, e, camera);
        const intersects = raycaster.intersectObjects(scene.children);
        intersects
          .filter((i) => i.object.visible)
          .every((i) => {
            if (
              i.object.userData.type === "tile" &&
              document.body.style.cursor !== "wait"
            ) {
              if (
                i.object.userData.canClick === true &&
                action.current &&
                battle.current
              ) {
                const target = i.object.userData.tile as TerrainHex;
                document.body.style.cursor = "wait";
                if (canPerformAction()) {
                  performAction({
                    battleId: battle.current.id,
                    userId: userId.current,
                    actionId: action.current.id,
                    longitude: target.col,
                    latitude: target.row,
                    version: battle.current.version,
                  });
                }
                return false;
              }
            }
            return true;
          });
      };
      const rendererElement = renderer.domElement;
      rendererElement.addEventListener("click", onClick, true);

      // Sprite mixer for sprite animations
      const spriteMixer = new SpriteMixer();

      // Callback on sprite animations
      // spriteMixer.addEventListener("finished", function (event) {});

      // Get SFX volume from localStorage
      const sfxVolume =
        typeof window !== "undefined"
          ? (() => {
              const saved = localStorage.getItem("sfxVolume");
              return saved !== null ? (JSON.parse(saved) as number) : 0.8;
            })()
          : 0.8;

      // Render the image
      let animationId = 0;
      const clock = new Clock();
      clock.start();
      function render() {
        // Guard against stale render callbacks after unmount
        if (!isMounted.current) return;
        
        // Performance monitor
        performanceMonitor.begin();

        // Use clock for animating sprites
        spriteMixer.update(clock.getDelta());

        // Use raycaster to detect mouse intersections
        raycaster.setFromCamera(mouse, camera);

        // Assume we have battle and a grid
        if (userData && battle.current && grid.current) {
          // Get the selected user
          const user = battle.current.usersState.find(
            (u) => u.userId === userId.current,
          );

          // Draw all users on the map
          const isAnyUserMoving = drawCombatUsers({
            group_users: group_users,
            users: battle.current.usersState,
            grid: grid.current,
            playerId: suid,
            userData: userData,
            group_assets: group_assets,
            sfxEnabled: Boolean(userData?.sfxOn ?? true),
            sfxVolume: sfxVolume,
            gameAssets: gameAssets ?? [],
          });

          // Update camera target to follow player's character
          if (user && cameraRef.current && cameraRef.current.zoom > 1.5) {
            const tile = grid.current.getHex({
              col: user.longitude,
              row: user.latitude,
            });
            if (tile) {
              const { x, y } = tile.center;
              cameraTargetPosition.current = { x, y };
            }
          }

          // Draw all ground effects on the map (non-movement SFX delayed until movement completes)
          drawCombatEffects({
            groupEffects: group_effects,
            battle: battle.current,
            grid: grid.current,
            animationId,
            spriteMixer,
            gameAssets: gameAssets ?? [],
            sfxEnabled: Boolean(userData?.sfxOn ?? true),
            sfxVolume: sfxVolume,
            isAnyUserMoving,
          });

          // Performance optimization: Run raycaster intersections once per frame
          const tilesIntersects = raycaster.intersectObjects(group_tiles.children);
          const cachedIntersections: CachedIntersections = {
            tiles: tilesIntersects,
            battleTiles: tilesIntersects,
            ground: raycaster.intersectObjects(group_effects.children),
          };

          // Highlight information on user hover
          userHighlights = highlightUsers({
            group_users,
            cachedIntersections,
            userId: userId.current,
            users: battle.current.usersState,
            currentHighlights: userHighlights,
          });

          // Detect intersections with tiles for movement/action
          if (user) {
            highlights = highlightTiles({
              group_tiles,
              cachedIntersections,
              user,
              timeDiff,
              action: action.current,
              battle: battle.current,
              grid: grid.current,
              currentHighlights: highlights,
              precomputedActions,
            });
          }

          // Highlight tooltips when hovering on battlefield
          tooltips = highlightTooltips({
            group_ground,
            cachedIntersections,
            battle: battle.current,
            currentTooltips: tooltips,
          });

          // Highlight tile tooltips when hovering on tiles with ground effects or users
          highlightTileTooltips({
            group_tiles,
            cachedIntersections,
            battleMaps: battleMapsRef.current,
            mouseX: mouseScreen.current.x,
            mouseY: mouseScreen.current.y,
            onHoverChange: (hover) => {
              // Only update state if hover target actually changed
              const newKey = hover
                ? hover.userId
                  ? `${hover.tileKey}-${hover.userId}`
                  : hover.tileKey
                : null;
              if (newKey !== lastHoverKeyRef.current) {
                lastHoverKeyRef.current = newKey;
                setHoveredEffectRef.current(hover);
              }
            },
          });
        }

        // Smooth camera following
        if (cameraRef.current && controlsRef.current) {
          const WIDTH = mountRef.current?.getBoundingClientRect().width || 0;
          const HEIGHT = WIDTH * width2height;
          smoothCameraFollow({
            camera: cameraRef.current,
            controls: controlsRef.current,
            targetPosition: cameraTargetPosition.current,
            width: WIDTH,
            height: HEIGHT,
          });
        }

        // Trackball updates
        controls.update();

        // Update wind and wave animations for sprites and tiles
        if (!lightLayout) {
          updateWindAnimation(group_assets, performance.now() / 1000);
          updateWaveAnimation(group_tiles, performance.now() / 1000);
        }

        // Render the scene
        renderer?.render(scene, camera);

        // Performance monitor
        performanceMonitor.end();

        animationId = performanceMonitor.requestFrame(render);
      }
      render();

      // Remove the mouseover listener
      return () => {
        // Mark component as unmounted FIRST to prevent stale render callbacks
        isMounted.current = false;
        
        // Cancel animation frame before cleanup
        performanceMonitor.cancelFrame(animationId);
        
        if (zoomTimeout) clearTimeout(zoomTimeout);
        void setBattleAtom(undefined);
        
        // Remove event listeners safely
        try {
          window.removeEventListener("resize", handleResize);
          sceneRef.removeEventListener("mousemove", onDocumentMouseMove);
          sceneRef.removeEventListener("mouseleave", onDocumentMouseLeave);
          controls.removeEventListener("change", onZoomChange);
          rendererElement.removeEventListener("click", onClick, true);
        } catch (e) {
          // Ignore errors if elements are already removed
        }
        
        // Safely remove renderer DOM element
        try {
          if (renderer.domElement && renderer.domElement.parentNode === sceneRef) {
            sceneRef.removeChild(renderer.domElement);
          }
        } catch (e) {
          // Ignore errors if element is already removed
        }
        
        cleanUp(scene, renderer);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId, gameAssets, userData?.sfxOn]);

  // Update visibility when showGridNumbers flag changes
  useEffect(() => {
    if (groupNamesRef.current) {
      groupNamesRef.current.visible = config.showGridNumbers;
    }
  }, [config.showGridNumbers]);

  // Clear hover state on mouse leave from combat area
  useEffect(() => {
    const sceneRef = mountRef.current;
    if (!sceneRef) return;

    const handleMouseLeave = () => {
      setHoveredEffect(null);
    };

    sceneRef.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      sceneRef.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  // Derived variables
  const showNextMatch =
    result?.outcome === "Won" && (battleType === "ARENA" || battleType === "TRAINING");
  const showShrineAgain = result?.outcome === "Won" && battleType === "SHRINE_WAR";
  const showTravelBtn = battleType === "QUEST";
  const arenaOpponentId = battle.current?.usersState.find(
    (u) => u.userId !== suid && !u.isSummon && u.isAi,
  )?.controllerId;
  const initiveWinner = battle.current?.usersState.find(
    (u) => u.userId === battle.current?.activeUserId,
  );
  const modalUserQuest = userData?.userQuests?.find(
    (q) => q.questId === logbookModalQuestId,
  );
  const modalTracker = userData?.questData?.find((q) => q.id === logbookModalQuestId);
  const toHospital =
    battleType &&
    result &&
    result.curHealth <= 0 &&
    !["SPARRING", "RANKED_PVP"].includes(battleType);

  return (
    <>
      <div id="tutorial-combat-field" ref={mountRef}></div>

      {/* Effect hover tooltip (can show both user and ground effects) */}
      {hoveredEffect && hoveredEffects && (
        <div
          className="fixed z-50 bg-black/90 text-white p-3 rounded-lg shadow-xl pointer-events-none max-w-xs flex flex-col gap-3"
          style={{
            left: `${hoveredEffect.position.x + 15}px`,
            top: `${hoveredEffect.position.y - 10}px`,
            transform: "translateY(-100%)",
          }}
        >
          {hoveredEffects.userId && hoveredEffects.userEffects.length > 0 && (
            <VisualizeEffects
              effects={hoveredEffects.userEffects}
              userId={hoveredEffects.userId}
            />
          )}
          {hoveredEffects.groundEffects.length > 0 && (
            <VisualizeGroundEffects effects={hoveredEffects.groundEffects} />
          )}
        </div>
      )}

      {webglError && <WebGlError />}
      {/* BATTLE LOBBY SCREEN */}
      {isInLobby &&
        battle.current &&
        PvpBattleTypes.includes(battle.current.battleType) && (
          <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto bg-black opacity-90">
            <div className="flex flex-col items-center justify-center text-white h-full">
              <p className="text-3xl">Waiting for opponent</p>
              <p className="text-xl">
                Time Left:{" "}
                <Countdown targetDate={battle.current.createdAt} timeDiff={timeDiff} />
              </p>
              <p className="text-lg mb-2 flex flex-row">
                Initiative Winner: {initiveWinner?.username}{" "}
                <Link href="/manual/combat">
                  <HelpCircle className="ml-2 h6 w-6 hover:text-orange-500" />
                </Link>
              </p>
              <div className="flex flex-row gap-4">
                {battle.current.usersState
                  .filter((u) => u.isOriginal && !u.isAi)
                  .map((u, i) => {
                    return (
                      <div
                        key={i}
                        className="flex flex-col items-center relative font-bold"
                      >
                        <Image
                          alt={`roll-${u.userId}`}
                          src={IMG_INITIATIVE_D20}
                          height={60}
                          width={60}
                        ></Image>
                        <p className="absolute text-md top-7">
                          {Math.floor(u.initiative)}
                        </p>
                        <p>
                          {u.username} {u.iAmHere ? "(✓)" : ""}
                        </p>
                      </div>
                    );
                  })}
              </div>
              <div className="flex flex-row gap-4 items-center mt-3">
                <ItemLoadoutSelector
                  size="small"
                  label="Item Loadout"
                  onSelectOverride={(loadoutId) => {
                    if (battle?.current) {
                      selectLoadout({
                        battleId: battle.current.id,
                        itemLoadoutId: loadoutId,
                      });
                    }
                  }}
                  selectedOverrideId={battleSessionUser?.itemLoadout}
                />
                <JutsuLoadoutSelector
                  size="small"
                  label="Jutsu Loadout"
                  onSelectOverride={(loadoutId) => {
                    if (battle?.current) {
                      selectLoadout({
                        battleId: battle.current.id,
                        jutsuLoadoutId: loadoutId,
                      });
                    }
                  }}
                  selectedOverrideId={battleSessionUser?.jutsuLoadout}
                />
                <Button
                  variant="secondary"
                  disabled={battleSessionUser?.iAmHere}
                  onClick={() => {
                    if (battle.current && suid) {
                      iAmHere({ battleId: battle.current.id });
                    }
                  }}
                >
                  {battleSessionUser?.iAmHere ? "Ready" : "I'm Ready"}
                </Button>
              </div>
            </div>
          </div>
        )}
      {/* FINAL DONE SCREEN */}
      {result && (
        <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto bg-black opacity-90">
          <div className="text-center text-white">
            <p className="p-5 pb-2 text-3xl">You {result.outcome}</p>
            <div className=" grid grid-cols-2">
              {result.lpDiff !== 0 && (
                <div>
                  {result.lpDiff > 0 ? (
                    <p>Ranked PvP LP: +{result.lpDiff.toFixed(2)}</p>
                  ) : (
                    <p>Ranked PvP LP: {result.lpDiff.toFixed(2)}</p>
                  )}
                </div>
              )}
              {result.experience > 0 && (
                <p>Experience Points: {result.experience.toFixed(2)}</p>
              )}
              {result.earnedExperience > 0 && (
                <p>Unassigned Experience: {result.earnedExperience.toFixed(2)}</p>
              )}
              {result.ninjutsuOffence > 0 && (
                <p>Offensive Ninjutsu: {result.ninjutsuOffence.toFixed(2)}</p>
              )}
              {result.ninjutsuDefence > 0 && (
                <p>Defensive Ninjutsu: {result.ninjutsuDefence.toFixed(2)}</p>
              )}
              {result.taijutsuOffence > 0 && (
                <p>Offensive Taijutsu: {result.taijutsuOffence.toFixed(2)}</p>
              )}
              {result.taijutsuDefence > 0 && (
                <p>Defensive Taijutsu: {result.taijutsuDefence.toFixed(2)}</p>
              )}
              {result.genjutsuOffence > 0 && (
                <p>Offensive Genjutsu: {result.genjutsuOffence.toFixed(2)}</p>
              )}
              {result.genjutsuDefence > 0 && (
                <p>Defensive Genjutsu: {result.genjutsuDefence.toFixed(2)}</p>
              )}
              {result.bukijutsuOffence > 0 && (
                <p>Offensive Bukijutsu: {result.bukijutsuOffence.toFixed(2)}</p>
              )}
              {result.bukijutsuDefence > 0 && (
                <p>Defensive Bukijutsu: {result.bukijutsuDefence.toFixed(2)}</p>
              )}
              {result.intelligence > 0 && (
                <p>Intelligence: {result.intelligence.toFixed(2)}</p>
              )}
              {userData?.isOutlaw && result.villagePrestige !== 0 && (
                <p>Notoriety: {result.villagePrestige.toFixed(2)}</p>
              )}
              {!userData?.isOutlaw && result.villagePrestige !== 0 && (
                <p>Village Prestige: {result.villagePrestige.toFixed(2)}</p>
              )}
              {result.villageTokens !== 0 && (
                <p>Village Tokens: {result.villageTokens.toFixed(2)}</p>
              )}
              {result.clanPoints !== 0 && (
                <p>Clan points: {result.clanPoints.toFixed(2)}</p>
              )}
              {result.money > 0 && <p>Money gained: {result.money.toFixed(2)}</p>}
              {result.money < 0 && <p>Money lost: {result.money.toFixed(2)}</p>}
              {result.seichiSilver > 0 && <p>Seichi Silver: {result.seichiSilver}</p>}
              {result.strength > 0 && <p>Strength: {result.strength.toFixed(2)}</p>}
              {result.willpower > 0 && <p>Willpower: {result.willpower.toFixed(2)}</p>}
              {result.speed > 0 && <p>Speed: {result.speed.toFixed(2)}</p>}
              {result.bountiesClaimed.map((bounty, i) => {
                return (
                  <p key={`bounty-${i}`}>
                    Bounty claimed: {bounty.amountRyo.toFixed(2)} Ryo
                  </p>
                );
              })}
              {Object.entries(result.townhallInfo).map(([villageName, change]) => {
                const key = `${villageName}-${change}`;
                if (change > 0) {
                  return (
                    <p key={key} className="text-green-500">
                      {villageName} Structure HP: +{change.toFixed(2)}
                    </p>
                  );
                } else if (change < 0) {
                  return (
                    <p key={key} className="text-red-500">
                      {villageName} Structure HP: {change.toFixed(2)}
                    </p>
                  );
                }
              })}
              {Object.entries(result.shrineInfo).map(([sectorId, change]) => {
                const key = `sector-${sectorId}-${change}`;
                if (change > 0) {
                  return (
                    <p key={key} className="text-green-500">
                      Shrine HP in sector {sectorId}: +{change.toFixed(2)}
                    </p>
                  );
                } else if (change < 0) {
                  return (
                    <p key={key} className="text-red-500">
                      Shrine HP in sector {sectorId}: {change.toFixed(2)}
                    </p>
                  );
                }
              })}
              {result.droppedItems &&
                result.droppedItems.length > 0 &&
                result.droppedItems.map((d) => (
                  <p key={d.itemId} className="text-green-500">
                    Looted: {d.name}
                  </p>
                ))}
            </div>

            <div className="p-5 flex flex-row justify-center gap-2 ">
              <Link
                href={toHospital ? "/hospital" : "/profile"}
                className={`${showNextMatch || showTravelBtn || showShrineAgain ? "basis-1/2" : "basis-1/1"} w-full `}
              >
                <Button id="return" className="w-full">
                  Return to {toHospital ? "Hospital" : "Profile"}
                </Button>
              </Link>
              {showShrineAgain && (
                <Link href="/shrine" className="basis-1/2 w-full ">
                  <Button id="return" className="w-full">
                    Back to Shrine
                  </Button>
                </Link>
              )}
              {showNextMatch &&
                arenaOpponentId &&
                (!currentStep || !userData?.tutorialOn) && (
                  <div>
                    <Button
                      id="return"
                      className="basis-1/2 w-full"
                      onClick={() =>
                        startArenaBattle({
                          aiId: arenaOpponentId,
                          stats:
                            battle.current?.battleType === "TRAINING"
                              ? statDistribution
                              : undefined,
                        })
                      }
                    >
                      Go Again
                    </Button>

                    <Button
                      id="heal-return"
                      className="basis-1/2 w-full mt-1"
                      onClick={() => battleArenaHealAndGo()}
                    >
                      Heal and Go Again (-500 Ryo)
                    </Button>
                  </div>
                )}
              {battleType === "RANKED_PVP" && (
                <Link href="/battlearena#PVP%20Rank" className="w-full">
                  <Button id="toPvpRank" className="w-full">
                    Back to PvP Queue
                  </Button>
                </Link>
              )}
              {showTravelBtn && (
                <Link href="/travel" className="basis-1/2">
                  <Button id="toTravel" className="w-full">
                    To Map
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
      {/* FINAL DONE SCREEN */}
      {!hasFocus && (
        <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto flex justify-center items-center bg-black">
          <div className="text-center text-white relative m-auto flex flex-col items-center">
            <p className="p-5  pb-2 text-3xl">Not in Focus</p>
            <p className="italic pb-2">
              Battle data can only be streamed to one browser tab at once
            </p>
            <Button size="xl" onClick={() => location.reload()}>
              <Check className="w-8 h-8 mr-3" />
              Activate this Tab
            </Button>
          </div>
        </div>
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
    </>
  );
};

export default Combat;
