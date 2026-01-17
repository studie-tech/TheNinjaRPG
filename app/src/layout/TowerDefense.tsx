import React, {
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  useState,
  memo,
} from "react";
import { OrthographicCamera, Group, Clock } from "three";
import type {
  Scene,
  WebGLRenderer,
  Raycaster,
  Sprite,
  InstancedMesh,
  Material,
} from "three";
import WebGlError from "@/layout/WebGLError";
import { OrbitControls } from "@/libs/threejs/OrbitControls";
import { FrameAnimator } from "@/libs/threejs/FrameAnimator";
import {
  loadTexture,
  setupScene,
  cleanUp,
  setRaycasterFromMouse,
  profiler,
} from "@/libs/threejs/util";
import { SpriteMixer } from "@/libs/threejs/SpriteMixer";
import { usePerformanceMonitor } from "@/hooks/performance-monitor";
import {
  getTowerDefenseGrid,
  drawTowerDefenseBackground,
  drawTowerDefensePlayer,
  drawTowerDefenseEnemies,
  updateEnemyHealthBars,
  drawRangeIndicator,
  resetEnemyInstancedMeshes,
  resetRangeIndicatorCache,
  type PlayerState,
} from "@/libs/threejs/towerDefense";
import {
  showImpactAnimation,
  preloadProjectileTextures,
  updateProjectiles,
  spawnProjectile,
  spawnDamageNumber,
  createEnemyPositionMap,
  initDamageNumberPool,
} from "@/libs/threejs/towerDefenseEffects";
import { updateWindAnimation, updateWaveAnimation } from "@/libs/threejs/shaders";
import {
  calculateEnemyDirection,
  calculateHexDistance,
} from "@/libs/towerDefense/game";
import { calculateWidth2Height } from "@/libs/threejs/hexgrid";
// PERFORMANCE: Import audio functions at module level to avoid dynamic imports in animation loop
import { playPreloadedAudio, preloadAudioBuffers } from "@/utils/audio";

import { TD_HEX_SIZE } from "@/drizzle/constants";
import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";
import type {
  HexPosition,
  TowerDefenseProjectile,
  EntityStore,
  RuntimeState,
  HitEvent,
} from "@/validators/towerDefense";
import type { GameAsset } from "@/drizzle/schema";

/**
 * PERFORMANCE: Stable props interface - only contains refs and stable callbacks.
 * The ThreeJS scene reads all dynamic data from refs, never from props.
 */
interface TowerDefenseProps {
  /** STABLE: Seed for procedural generation - set once at game start */
  seed: string;
  /** STABLE: Initial grid size */
  initialGridSize: number;
  /** STABLE: Initial player position */
  initialPlayerPosition: HexPosition;
  /** STABLE: Click handler - should be memoized with useCallback */
  onTileClick: (position: HexPosition) => void;
  /** REF: Entity store for animation loop */
  entitiesRef: React.RefObject<EntityStore>;
  /** REF: Runtime state for animation loop - always current values */
  runtimeStateRef: React.RefObject<RuntimeState>;
  /** REF: Player hit events */
  playerHitEventsRef: React.RefObject<HitEvent[]>;
  /** STABLE: Impact animation asset (cached externally) */
  impactAsset?: GameAsset;
  /** STABLE: Sound effect URL (cached externally) */
  sfxUrl?: string;
}

/**
 * Imperative handle for parent to trigger rare updates without re-rendering.
 */
export interface TowerDefenseHandle {
  /** Update grid when size changes (rare - grid expansion) */
  updateGrid: (gridSize: number) => void;
  /** Update range indicator when ability range changes (rare - upgrade) */
  updateRange: (range: number) => void;
}

/**
 * PERFORMANCE-CRITICAL: TowerDefense ThreeJS Scene Component
 *
 * This component is designed to NEVER re-render after initial mount.
 * All dynamic data is read from refs in the animation loop.
 * Rare updates (grid resize, range change) are handled via imperative handle.
 *
 * Architecture:
 * - Props are stable (refs, callbacks, initial values)
 * - Animation loop reads from refs each frame
 * - Parent triggers rare updates via ref.current.updateGrid/updateRange
 * - React.memo with custom comparison prevents any re-renders
 */
const TowerDefenseInner = ({
  seed,
  initialGridSize,
  initialPlayerPosition,
  onTileClick,
  entitiesRef,
  runtimeStateRef,
  playerHitEventsRef,
  impactAsset,
  sfxUrl,
  ref,
}: TowerDefenseProps & { ref?: React.Ref<TowerDefenseHandle> }) => {
  // Performance monitoring - use bounded mode (requestAnimationFrame) for proper vsync
  const performanceMonitor = usePerformanceMonitor(false);

  // Refs for Three.js objects
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const cameraRef = useRef<OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const raycasterRef = useRef<Raycaster | null>(null);
  const gridRef = useRef<Grid<TerrainHex> | null>(null);
  const mouseHexRef = useRef<TerrainHex | null>(null);
  const isMountedRef = useRef<boolean>(false);
  const onTileClickRef = useRef(onTileClick);

  useEffect(() => {
    onTileClickRef.current = onTileClick;
  }, [onTileClick]);

  // PERFORMANCE: Track initialization without useState to avoid re-renders
  const isInitializedRef = useRef<boolean>(false);
  // WebGL error state uses useState to trigger re-render and show error component
  const [webglError, setWebglError] = useState(false);

  // Groups
  const groupsRef = useRef<{
    tiles: Group;
    ground: Group;
    edges: Group;
    assets: Group;
    range: Group;
    player: Group;
    enemies: Group;
    projectiles: Group;
    effects: Group;
    ui: Group;
  } | null>(null);

  // Optimization: Keep track of animated objects to avoid group.traverse
  const animatedAssetsRef = useRef<Material[]>([]);
  const animatedTilesRef = useRef<Material[]>([]);

  // Optimization: Spatial map for assets to speed up proximity checks
  const assetsSpatialMapRef = useRef<Map<string, (Sprite | InstancedMesh)[]>>(
    new Map(),
  );

  // Frame animator for character animations
  const frameAnimatorRef = useRef<FrameAnimator | null>(null);

  // SpriteMixer for impact animations
  const spriteMixerRef = useRef<SpriteMixer | null>(null);

  // Tracking damage numbers for animation
  const damageNumbersRef = useRef<{ update: (delta: number) => boolean }[]>([]);

  // Track state for animation loop
  const prevProjectilesRef = useRef<TowerDefenseProjectile[]>([]);
  const lastPlayerHitCountRef = useRef<number>(0);
  const punchingEnemiesRef = useRef<Set<string>>(new Set());

  // Player state for direction and throw animation
  const playerStateRef = useRef<PlayerState>({
    direction: "s",
    isThrowingAnimation: false,
  });

  // Timeout refs for proper cleanup
  const throwingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const punchingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // PERFORMANCE: Track current grid size and range for imperative updates
  const currentGridSizeRef = useRef<number>(initialGridSize);
  const currentRangeRef = useRef<number>(1);
  const currentSeedRef = useRef<string>(seed);
  const currentPlayerPositionRef = useRef<HexPosition>(initialPlayerPosition);

  // PERFORMANCE: Cache assets refs to avoid prop access in animation loop
  const impactAssetRef = useRef(impactAsset);
  const sfxUrlRef = useRef(sfxUrl);

  // Update asset refs when props change (rare)
  useEffect(() => {
    impactAssetRef.current = impactAsset;
    sfxUrlRef.current = sfxUrl;
    // Preload sound if available
    if (sfxUrl) {
      void preloadAudioBuffers([sfxUrl]);
    }
  }, [impactAsset, sfxUrl]);

  /**
   * Internal ref to hold update functions (avoids circular dependency issues)
   */
  const updateFunctionsRef = useRef<{
    updateRangeInternal: (range: number) => void;
    updateGrid: (gridSize: number) => void;
  }>({
    updateRangeInternal: () => {},
    updateGrid: () => {},
  });

  // Initialize updateRangeInternal
  updateFunctionsRef.current.updateRangeInternal = (range: number) => {
    const groups = groupsRef.current;
    const grid = gridRef.current;
    if (!groups || !grid || !isInitializedRef.current) return;

    const playerPosition =
      runtimeStateRef.current?.state?.playerPosition ??
      currentPlayerPositionRef.current;

    drawRangeIndicator({
      group_range: groups.range,
      grid: grid,
      playerPosition: playerPosition,
      range: range,
      hexWidth: TD_HEX_SIZE,
    });
  };

  // Initialize updateGrid
  updateFunctionsRef.current.updateGrid = (newGridSize: number) => {
    const groups = groupsRef.current;
    const mount = mountRef.current;
    if (!groups || !mount || !isInitializedRef.current) return;

    currentGridSizeRef.current = newGridSize;

    // Recalculate dimensions
    if (rendererRef.current) {
      const width2height = calculateWidth2Height(newGridSize, newGridSize + 2);
      const WIDTH = mount.clientWidth;
      const HEIGHT = WIDTH * width2height;
      mount.style.height = `${HEIGHT}px`;
      rendererRef.current.setSize(WIDTH, HEIGHT);
    }

    gridRef.current = getTowerDefenseGrid(TD_HEX_SIZE, newGridSize);

    // Clear optimization lists
    animatedAssetsRef.current = [];
    animatedTilesRef.current = [];
    assetsSpatialMapRef.current.clear();

    // Get current player position from runtime ref
    const playerPosition =
      runtimeStateRef.current?.state?.playerPosition ??
      currentPlayerPositionRef.current;
    currentPlayerPositionRef.current = playerPosition;

    drawTowerDefenseBackground({
      group_tiles: groups.tiles,
      group_ground: groups.ground,
      group_edges: groups.edges,
      group_assets: groups.assets,
      grid: gridRef.current,
      hexsize: TD_HEX_SIZE,
      seed: currentSeedRef.current,
      centerPosition: playerPosition,
      onAssetAdded: (asset) => {
        const mat = asset.material as Material;
        if (mat?.userData?.isAnimated) {
          animatedAssetsRef.current.push(mat);
        }
        const tileKey = asset.userData.tileKey as string;
        if (tileKey) {
          if (!assetsSpatialMapRef.current.has(tileKey)) {
            assetsSpatialMapRef.current.set(tileKey, []);
          }
          assetsSpatialMapRef.current.get(tileKey)!.push(asset);
        }
      },
      onTileAdded: (tile) => {
        const mat = tile.material as Material;
        if (mat?.userData?.isAnimated) {
          animatedTilesRef.current.push(mat);
        }
      },
    });

    groups.assets.children.sort((a, b) => b.position.y - a.position.y);

    // Configure camera
    if (cameraRef.current && gridRef.current) {
      const gridArray = gridRef.current.toArray();
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      gridArray.forEach((tile) => {
        tile.corners.forEach((corner) => {
          minX = Math.min(minX, corner.x);
          maxX = Math.max(maxX, corner.x);
          minY = Math.min(minY, corner.y);
          maxY = Math.max(maxY, corner.y);
        });
      });

      const padding = TD_HEX_SIZE * 0.5;
      const viewWidth = maxX - minX + padding * 2;
      const viewHeight = maxY - minY + padding * 2;
      const containerAspect = mount.clientWidth / mount.clientHeight;
      const gridAspect = viewWidth / viewHeight;

      let left = minX - padding,
        right = maxX + padding,
        top = maxY + padding,
        bottom = minY - padding;

      if (containerAspect > gridAspect) {
        const newWidth = viewHeight * containerAspect;
        const centerX = (minX + maxX) / 2;
        left = centerX - newWidth / 2;
        right = centerX + newWidth / 2;
      } else {
        const newHeight = viewWidth / containerAspect;
        const centerY = (minY + maxY) / 2;
        bottom = centerY - newHeight / 2;
        top = centerY + newHeight / 2;
      }

      cameraRef.current.left = left;
      cameraRef.current.right = right;
      cameraRef.current.top = top;
      cameraRef.current.bottom = bottom;
      cameraRef.current.updateProjectionMatrix();
    }

    // Update range indicator with new grid
    updateFunctionsRef.current.updateRangeInternal(currentRangeRef.current);
  };

  /**
   * Stable reference to updateGrid for imperative handle
   */
  const updateGrid = useCallback((newGridSize: number) => {
    updateFunctionsRef.current.updateGrid(newGridSize);
  }, []);

  /**
   * Stable reference to updateRange for imperative handle
   */
  const updateRange = useCallback((newRange: number) => {
    currentRangeRef.current = newRange;
    updateFunctionsRef.current.updateRangeInternal(newRange);
  }, []);

  // Expose imperative handle to parent
  useImperativeHandle(ref, () => ({ updateGrid, updateRange }), [
    updateGrid,
    updateRange,
  ]);

  // Initialize Three.js scene (runs once, never re-runs)
  useEffect(() => {
    isMountedRef.current = true;
    const mount = mountRef.current;
    // Capture refs for cleanup
    const punchingTimeouts = punchingTimeoutsRef.current;
    if (!mount) return;

    // Calculate proper dimensions based on grid size
    const gridSize = initialGridSize;
    const width2height = calculateWidth2Height(gridSize, gridSize + 2);
    const WIDTH = mount.clientWidth;
    const HEIGHT = WIDTH * width2height;

    mount.style.height = `${HEIGHT}px`;

    // Setup scene
    const {
      scene,
      renderer,
      raycaster,
      handleResize: onResize,
    } = setupScene({
      mountRef,
      width: WIDTH,
      height: HEIGHT,
      sortObjects: false,
      color: 0x1a1a2e,
      colorAlpha: 1,
      width2height,
    });

    sceneRef.current = scene;
    rendererRef.current = renderer ?? null;
    raycasterRef.current = raycaster;

    if (!renderer) {
      setWebglError(true);
      return;
    }

    // Track WebGL context loss to prevent shader errors on iOS mobile browsers
    let isContextLost = false;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      isContextLost = true;
    };
    const handleContextRestored = () => {
      isContextLost = false;
    };
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored);

    // Camera and Controls
    const camera = new OrthographicCamera(0, WIDTH, HEIGHT, 0, -10, 10);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enablePan = false;
    controls.enableZoom = false;
    controlsRef.current = controls;

    // Initialize Groups
    groupsRef.current = {
      tiles: new Group(),
      ground: new Group(),
      edges: new Group(),
      assets: new Group(),
      range: new Group(),
      player: new Group(),
      enemies: new Group(),
      projectiles: new Group(),
      effects: new Group(),
      ui: new Group(),
    };

    Object.values(groupsRef.current).forEach((group) => scene.add(group));

    // Animators
    frameAnimatorRef.current = new FrameAnimator(loadTexture);
    spriteMixerRef.current = new SpriteMixer();

    mount.appendChild(renderer.domElement);

    preloadProjectileTextures();
    initDamageNumberPool();

    isInitializedRef.current = true;

    // Draw initial grid (use ref to avoid stale closure)
    updateFunctionsRef.current.updateGrid(initialGridSize);

    const onMouseMove = (event: MouseEvent) => {
      if (!rendererRef.current || !cameraRef.current || !raycasterRef.current) return;
      setRaycasterFromMouse(raycasterRef.current, mount, event, cameraRef.current);

      const groups = groupsRef.current;
      if (gridRef.current && groups?.tiles) {
        const intersects = raycasterRef.current.intersectObjects(groups.tiles.children);
        const firstIntersect = intersects[0];
        mouseHexRef.current =
          firstIntersect && firstIntersect.object.userData.tile
            ? (firstIntersect.object.userData.tile as TerrainHex)
            : null;
      }
    };

    const onClick = () => {
      if (mouseHexRef.current) {
        onTileClickRef.current({
          col: mouseHexRef.current.col,
          row: mouseHexRef.current.row,
        });
      }
    };

    mount.addEventListener("mousemove", onMouseMove);
    mount.addEventListener("click", onClick);

    // Animation loop
    const clock = new Clock();
    clock.start();
    let animationId: number;

    const animate = () => {
      if (!isMountedRef.current) return;

      profiler.beginFrame();
      performanceMonitor.begin();
      const endTotal = profiler.mark("animate_total");

      const delta = clock.getDelta();
      const groups = groupsRef.current;
      const grid = gridRef.current;
      const animator = frameAnimatorRef.current;
      const mixer = spriteMixerRef.current;

      const endAnimators = profiler.mark("animate_animators");
      if (animator) animator.update(delta);
      if (mixer) mixer.update(delta);
      endAnimators();

      // Update damage numbers
      const endDamageNumbers = profiler.mark("animate_damage_numbers");
      if (damageNumbersRef.current.length > 0) {
        damageNumbersRef.current = damageNumbersRef.current.filter(
          (dn) => dn && typeof dn.update === "function" && dn.update(delta),
        );
      }
      profiler.reportCount("draw_damage_numbers", damageNumbersRef.current.length);
      endDamageNumbers();

      if (
        groups &&
        grid &&
        rendererRef.current &&
        sceneRef.current &&
        cameraRef.current
      ) {
        // PERFORMANCE: Read all dynamic data from refs
        const currentEnemies = entitiesRef.current?.enemiesArray ?? [];
        const currentProjectiles = entitiesRef.current?.projectilesArray ?? [];
        const runtimeState = runtimeStateRef.current;

        // Check if grid size changed (rare - grid expansion)
        const newGridSize = runtimeState?.state?.gridSize;
        if (newGridSize && newGridSize !== currentGridSizeRef.current) {
          updateFunctionsRef.current.updateGrid(newGridSize);
        }

        // Check if range changed (rare - upgrade)
        const newRange = runtimeState?.abilities[0]?.range ?? 1;
        if (newRange !== currentRangeRef.current) {
          currentRangeRef.current = newRange;
          updateFunctionsRef.current.updateRangeInternal(newRange);
        }

        // Handle projectile spawning and impacts
        const endProjectiles = profiler.mark("animate_projectiles");

        const enemyPositionMap = createEnemyPositionMap(currentEnemies);
        const currentProjectileIds = new Set(currentProjectiles.map((p) => p.id));
        const prevProjectiles = prevProjectilesRef.current;

        // Spawn new projectiles
        for (const projectile of currentProjectiles) {
          if (!groups.projectiles.getObjectByName(projectile.id)) {
            spawnProjectile({
              group_projectiles: groups.projectiles,
              projectile,
              grid: grid,
              hexWidth: TD_HEX_SIZE,
            });

            if (animator) {
              playerStateRef.current.direction = calculateEnemyDirection(
                projectile.origin.col,
                projectile.origin.row,
                projectile.target.col,
                projectile.target.row,
              );
              playerStateRef.current.isThrowingAnimation = true;
              if (throwingTimeoutRef.current) clearTimeout(throwingTimeoutRef.current);
              throwingTimeoutRef.current = setTimeout(() => {
                playerStateRef.current.isThrowingAnimation = false;
              }, 420);
            }
          }
        }

        // Detect impacts (projectiles that were removed)
        for (const prevProjectile of prevProjectiles) {
          if (!currentProjectileIds.has(prevProjectile.id)) {
            const sprite = groups.projectiles.getObjectByName(prevProjectile.id);
            if (sprite) groups.projectiles.remove(sprite);

            const targetTile = grid.getHex(prevProjectile.target);
            if (targetTile && mixer && groups.effects) {
              const posKey = `${prevProjectile.target.col},${prevProjectile.target.row}`;
              const targetEnemy = enemyPositionMap.get(posKey);

              let impactX = targetTile.x;
              let impactY = targetTile.y;

              if (targetEnemy && targetEnemy.movementProgress > 0) {
                const nextWaypoint = targetEnemy.path[targetEnemy.pathIndex];
                if (nextWaypoint) {
                  const nextTile = grid.getHex(nextWaypoint);
                  if (nextTile) {
                    impactX +=
                      (nextTile.x - targetTile.x) * targetEnemy.movementProgress;
                    impactY +=
                      (nextTile.y - targetTile.y) * targetEnemy.movementProgress;
                  }
                }
              }

              // Impact animation and sound (using refs)
              const cachedImpactAsset = impactAssetRef.current;
              const cachedSfxUrl = sfxUrlRef.current;

              if (cachedImpactAsset) {
                showImpactAnimation({
                  group_effects: groups.effects,
                  position: { x: impactX, y: impactY },
                  gameAsset: cachedImpactAsset,
                  spriteMixer: mixer,
                  hexWidth: TD_HEX_SIZE,
                });
              }

              if (cachedSfxUrl) {
                void playPreloadedAudio(cachedSfxUrl, 0.8);
              }

              // Calculate and show damage number
              const ability = runtimeState?.abilities[0];
              const distance = calculateHexDistance(
                prevProjectile.origin,
                prevProjectile.target,
              );
              const distanceBonus = Math.floor(
                distance * (ability?.damagePerTile ?? 0),
              );
              let finalDamage = prevProjectile.damage + distanceBonus;

              const isCrit =
                prevProjectile.critRoll !== undefined &&
                prevProjectile.critRoll < (ability?.critChance ?? 0);
              if (isCrit) {
                finalDamage *= 2;
              }

              if (groups.ui) {
                damageNumbersRef.current.push(
                  spawnDamageNumber({
                    group_ui: groups.ui,
                    position: { x: impactX, y: impactY },
                    damage: finalDamage,
                    isCrit,
                    hexWidth: TD_HEX_SIZE,
                  }),
                );
              }
            }
          }
        }

        prevProjectilesRef.current = [...currentProjectiles];

        updateProjectiles({
          group_projectiles: groups.projectiles,
          projectiles: currentProjectiles,
          enemies: currentEnemies,
          grid: grid,
          delta: delta,
          enemyPositionMap,
        });
        profiler.reportCount("draw_impact_effects", groups.effects.children.length);
        endProjectiles();

        // Get player position from runtime ref
        const playerPosition =
          runtimeState?.state?.playerPosition ?? currentPlayerPositionRef.current;
        currentPlayerPositionRef.current = playerPosition;

        // Update player direction based on closest enemy
        if (!playerStateRef.current.isThrowingAnimation && currentEnemies.length > 0) {
          let closestEnemy = null;
          let closestDistance = Infinity;

          for (const enemy of currentEnemies) {
            if (enemy.health <= 0) continue;
            const dx = enemy.position.col - playerPosition.col;
            const dy = enemy.position.row - playerPosition.row;
            const distance = dx * dx + dy * dy;
            if (distance < closestDistance) {
              closestDistance = distance;
              closestEnemy = enemy;
            }
          }

          if (closestEnemy) {
            playerStateRef.current.direction = calculateEnemyDirection(
              playerPosition.col,
              playerPosition.row,
              closestEnemy.position.col,
              closestEnemy.position.row,
            );
          }
        }

        // Draw/update player
        if (animator) {
          drawTowerDefensePlayer({
            group_player: groups.player,
            grid: grid,
            playerPosition: playerPosition,
            frameAnimator: animator,
            playerState: playerStateRef.current,
          });
        }

        // Update enemies
        const endEnemies = profiler.mark("animate_enemies");
        if (animator) {
          drawTowerDefenseEnemies({
            group_enemies: groups.enemies,
            assetsSpatialMap: assetsSpatialMapRef.current,
            grid: grid,
            enemies: currentEnemies,
            deltaTime: delta,
            frameAnimator: animator,
            playerPosition: playerPosition,
            punchingEnemies: punchingEnemiesRef.current,
          });
        }
        endEnemies();

        // Update health bars
        const endHealthBars = profiler.mark("animate_health_bars");
        updateEnemyHealthBars({
          group_enemies: groups.enemies,
          enemies: currentEnemies,
          hexWidth: TD_HEX_SIZE,
        });
        endHealthBars();

        // Update shaders
        const endShaders = profiler.mark("animate_shaders");
        updateWindAnimation(animatedAssetsRef.current, performance.now() / 1000);
        updateWaveAnimation(animatedTilesRef.current, performance.now() / 1000);
        endShaders();

        // Handle player hit events
        const endPlayerHits = profiler.mark("animate_player_hits");
        const hitEvents = playerHitEventsRef.current ?? [];
        const currentHitCount = hitEvents.length;
        const lastHitCount = lastPlayerHitCountRef.current;

        if (currentHitCount > lastHitCount) {
          const newHits = hitEvents.slice(lastHitCount);

          newHits.forEach(() => {
            const playerTile = grid.getHex(playerPosition);
            if (playerTile && runtimeState?.state && mixer) {
              const cachedImpactAsset = impactAssetRef.current;
              const cachedSfxUrl = sfxUrlRef.current;

              if (cachedImpactAsset) {
                showImpactAnimation({
                  group_effects: groups.effects,
                  position: { x: playerTile.x, y: playerTile.y },
                  gameAsset: cachedImpactAsset,
                  spriteMixer: mixer,
                  hexWidth: TD_HEX_SIZE,
                });
              }

              if (cachedSfxUrl) {
                void playPreloadedAudio(cachedSfxUrl, 0.8);
              }

              // Trigger punches for adjacent enemies
              for (const enemy of currentEnemies) {
                if (enemy.health <= 0) continue;
                const isAdjacent =
                  Math.abs(enemy.position.col - playerPosition.col) <= 1 &&
                  Math.abs(enemy.position.row - playerPosition.row) <= 1 &&
                  !(
                    enemy.position.col === playerPosition.col &&
                    enemy.position.row === playerPosition.row
                  );

                if (isAdjacent && enemy.lastAttackTime !== undefined) {
                  punchingEnemiesRef.current.add(enemy.id);
                  const existingTimeout = punchingTimeoutsRef.current.get(enemy.id);
                  if (existingTimeout) clearTimeout(existingTimeout);
                  // Timeout is stored in Map and cleared via punchingTimeouts.forEach in cleanup
                  // eslint-disable-next-line @eslint-react/web-api/no-leaked-timeout
                  const newTimeout = setTimeout(() => {
                    punchingEnemiesRef.current.delete(enemy.id);
                    punchingTimeoutsRef.current.delete(enemy.id);
                  }, 300);
                  punchingTimeoutsRef.current.set(enemy.id, newTimeout);
                }
              }
            }
          });
          lastPlayerHitCountRef.current = currentHitCount;
        }

        if (currentHitCount < lastHitCount) lastPlayerHitCountRef.current = 0;
        endPlayerHits();

        // Render (skip if WebGL context is lost)
        const endRender = profiler.mark("animate_render");
        controlsRef.current?.update();
        if (!isContextLost) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
        endRender();

        profiler.setRendererInfo(rendererRef.current.info);
      }

      endTotal();
      profiler.log(2000);
      performanceMonitor.end();
      animationId = performanceMonitor.requestFrame(animate);
    };

    animationId = performanceMonitor.requestFrame(animate);

    // Cleanup
    return () => {
      isMountedRef.current = false;
      isInitializedRef.current = false;
      performanceMonitor.cancelFrame(animationId);
      mount.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
      try {
        renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
        renderer.domElement.removeEventListener(
          "webglcontextrestored",
          handleContextRestored,
        );
      } catch {
        // Ignore errors if elements are already removed
      }
      if (scene && renderer) cleanUp(scene, renderer);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      if (frameAnimatorRef.current) frameAnimatorRef.current.dispose();
      if (throwingTimeoutRef.current) clearTimeout(throwingTimeoutRef.current);
      punchingTimeouts.forEach((timeout) => clearTimeout(timeout));
      punchingTimeouts.clear();
      damageNumbersRef.current = [];
      resetEnemyInstancedMeshes();
      resetRangeIndicatorCache();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (webglError) return <WebGlError />;

  return <div ref={mountRef} className="w-full" />;
};

/**
 * PERFORMANCE: Memoized wrapper that NEVER re-renders.
 * Custom comparison always returns true (props are considered equal).
 * All dynamic updates happen via refs and imperative handle.
 */
const TowerDefense = memo(TowerDefenseInner, () => true);

export default TowerDefense;
